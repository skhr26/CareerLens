const pdfParse = require("pdf-parse");
const { generateJobMatches, generateColdEmail } = require("../services/job.service");
const { sendRealEmail } = require("../services/email.service");

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
 * Controller to fetch matched jobs based on uploaded resume and/or self-description
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

        res.status(200).json({
            message: "Matched jobs fetched successfully.",
            searchQuery: matchResults.searchQuery,
            jobs: matchResults.jobs
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

/**
 * Controller to send real email to target recipient using Nodemailer
 */
async function sendColdEmailController(req, res) {
    try {
        const { toEmail, subject, body } = req.body;

        if (!toEmail || !toEmail.trim()) {
            return res.status(400).json({
                message: "Recipient email address is required."
            });
        }

        const emailResult = await sendRealEmail({ toEmail, subject, body });

        res.status(200).json({
            message: `Cold email successfully sent to ${toEmail}!`,
            toEmail,
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

module.exports = {
    getJobMatchesController,
    generateColdEmailController,
    sendColdEmailController
};
