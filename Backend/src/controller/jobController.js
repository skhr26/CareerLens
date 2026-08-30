const pdfParse = require("pdf-parse");
const { generateJobMatches, generateColdEmail } = require("../services/job.service");
const { sendRealEmail } = require("../services/email.service");
const { generateAtsResume } = require("../services/atsResume.service");

/**
 * Helper to safely extract text from uploaded PDF buffer without printing PDF.js font warnings
 */
async function extractPdfText(buffer) {
    if (!buffer) return "";
    const originalWarn = console.warn;
    console.warn = (...args) => {
        if (args[0] && typeof args[0] === "string" && args[0].includes("standardFontDataUrl")) {
            return;
        }
        originalWarn(...args);
    };
    try {
        const pdfData = await new pdfParse.PDFParse(Uint8Array.from(buffer)).getText();
        return pdfData.text || "";
    } catch (err) {
        console.error("Error parsing PDF text:", err);
        return "";
    } finally {
        console.warn = originalWarn;
    }
}

/**
 * Controller to fetch matched jobs and internships based on uploaded resume and/or self-description
 */
async function getJobMatchesController(req, res) {
    try {
        let resumeContent = "";

        if (req.file?.buffer) {
            resumeContent = await extractPdfText(req.file.buffer);
        }

        const { selfDescription } = req.body;

        if (!resumeContent.trim() && (!selfDescription || !selfDescription.trim())) {
            return res.status(400).json({
                message: "Please provide at least a Resume or a Self Description to find jobs."
            });
        }

        const matchResults = await generateJobMatches({
            resume: resumeContent,
            selfDescription: selfDescription || ""
        });

        // A broken scraper and a genuinely empty result set need different messages —
        // telling users "no matches" when Chromium failed to launch sends them off to
        // rewrite a resume that was never the problem.
        if (matchResults.scrapeFailed) {
            return res.status(200).json({
                message: "Job scraping is not available on the hosted version. Please run the app locally to use this feature.",
                searchQuery: matchResults.searchQuery,
                jobs: [],
                internships: [],
                diagnostics: matchResults.diagnostics
            });
        }

        const total = matchResults.jobs.length + matchResults.internships.length;

        res.status(200).json({
            message: total
                ? `Found ${matchResults.jobs.length} jobs and ${matchResults.internships.length} internships.`
                : `No current openings matched "${matchResults.searchQuery}". Try a broader self-description.`,
            searchQuery: matchResults.searchQuery,
            jobs: matchResults.jobs,
            internships: matchResults.internships,
            diagnostics: matchResults.diagnostics,
            // Returned so the cold-email step can quote the candidate's real background.
            // Without it that prompt received "Resume: Not provided" and the model
            // invented experience the applicant would then send to a real employer.
            resumeText: resumeContent
        });
    } catch (error) {
        console.error("Error in getJobMatchesController:", error);
        res.status(500).json({
            message: error.message || "Failed to find matching jobs."
        });
    }
}

/**
 * Controller to generate cold email for a selected job
 */
async function generateColdEmailController(req, res) {
    try {
        const {
            recipientName,
            recipientRole,
            jobTitle,
            jobDescription,
            companyName,
            selfDescription,
            resumeText
        } = req.body;

        // With no candidate facts the model can only invent a background, and the user
        // would be sending those invented claims to a real employer.
        if (!String(resumeText || "").trim() && !String(selfDescription || "").trim()) {
            return res.status(400).json({
                message: "We need your resume or self-description to write this email — otherwise it would be based on invented experience. Please run a job search again from the home page."
            });
        }

        const coldEmailResult = await generateColdEmail({
            resume: resumeText || "",
            selfDescription: selfDescription || "",
            recipientName: recipientName || "Hiring Team",
            recipientRole: recipientRole || "Founder / Hiring Manager",
            jobTitle: jobTitle || "Software Engineer",
            jobDescription: jobDescription || "",
            companyName: companyName || "Company"
        });

        res.status(200).json({
            message: "Cold email generated successfully.",
            subject: coldEmailResult.subject,
            body: coldEmailResult.body
        });
    } catch (error) {
        console.error("Error in generateColdEmailController:", error);
        res.status(500).json({
            message: error.message || "Failed to generate cold email."
        });
    }
}

const PDF_MAGIC = "%PDF-";

/**
 * Resolves the attachment for a cold email.
 *
 * "upload" attaches the applicant's own file; "generated" builds an ATS-safe resume
 * from their profile, tailored to this posting. Anything else sends text only.
 */
async function resolveResumeAttachment({ resumeSource, file, resumeText, selfDescription, jobDescription }) {
    if (resumeSource === "upload") {
        if (!file?.buffer?.length) {
            throw new Error("You chose to attach your own resume but no file was uploaded.");
        }
        // Trusting the browser's Content-Type would let a renamed .exe through.
        if (file.buffer.subarray(0, 5).toString("latin1") !== PDF_MAGIC) {
            throw new Error("That file is not a readable PDF. Please upload your resume as a PDF.");
        }
        return {
            filename: file.originalname || "resume.pdf",
            content: file.buffer,
            contentType: "application/pdf"
        };
    }

    if (resumeSource === "generated") {
        const { pdf, filename } = await generateAtsResume({
            resume: resumeText || "",
            selfDescription: selfDescription || "",
            jobDescription: jobDescription || ""
        });
        return { filename, content: pdf, contentType: "application/pdf" };
    }

    return null;
}

/**
 * Controller to send real email to target recipient using Nodemailer
 */
async function sendColdEmailController(req, res) {
    try {
        const {
            toEmail,
            subject,
            body,
            resumeSource = "none",
            resumeText,
            selfDescription,
            jobDescription
        } = req.body;

        if (!toEmail || !toEmail.trim()) {
            return res.status(400).json({
                message: "Recipient email address is required."
            });
        }

        let attachment = null;
        try {
            attachment = await resolveResumeAttachment({
                resumeSource,
                file: req.file,
                resumeText,
                selfDescription,
                jobDescription
            });
        } catch (error) {
            // The attachment was the user's explicit choice, so failing to build it is a
            // bad request, not a server fault — and the email must not go out without it.
            return res.status(400).json({ message: error.message });
        }

        const emailResult = await sendRealEmail({
            toEmail,
            subject,
            body,
            attachments: attachment ? [attachment] : []
        });

        res.status(200).json({
            message: attachment
                ? `Cold email sent to ${toEmail} with ${attachment.filename} attached!`
                : `Cold email successfully sent to ${toEmail}!`,
            toEmail,
            attachedFile: attachment ? attachment.filename : null,
            sentAt: new Date().toISOString(),
            messageId: emailResult.messageId,
            previewUrl: emailResult.previewUrl
        });
    } catch (error) {
        console.error("Error in sendColdEmailController:", error);
        res.status(500).json({
            message: error.message || "Failed to send email."
        });
    }
}

/**
 * Streams back the ATS resume we would attach, so the user can read it before sending.
 */
async function previewAtsResumeController(req, res) {
    try {
        const { resumeText, selfDescription, jobDescription } = req.body;

        if (!String(resumeText || "").trim() && !String(selfDescription || "").trim()) {
            return res.status(400).json({
                message: "We need your resume or self-description to build an ATS resume. Please run a job search again from the home page."
            });
        }

        const { pdf, filename } = await generateAtsResume({
            resume: resumeText || "",
            selfDescription: selfDescription || "",
            jobDescription: jobDescription || ""
        });

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename=${filename}`,
            "Content-Length": pdf.length
        });
        res.send(pdf);
    } catch (error) {
        console.error("Error in previewAtsResumeController:", error);
        res.status(500).json({
            message: error.message || "Failed to build the ATS resume."
        });
    }
}

module.exports = {
    getJobMatchesController,
    generateColdEmailController,
    sendColdEmailController,
    previewAtsResumeController
};
