const interviewReportModel = require("../models/interviewReport.model");
const pdfParse = require("pdf-parse");
const { generateResumePdf, generateInterviewReport } = require("../services/ai.service");

/**
 * Helper to extract text from PDF buffer without printing PDF.js font warnings
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

async function generateReportController(req, res) {
    let resumeContent = "";

    if (req.file?.buffer) {
        resumeContent = await extractPdfText(req.file.buffer);
    }
    const { selfDescription, jobDescription } = req.body;

    const interViewReportByAi = await generateInterviewReport({
        resume: resumeContent,
        selfDescription,
        jobDescription
    });

    const interviewReport = await interviewReportModel.create({
        user: req.user.id,
        resume: resumeContent,
        selfDescription,
        jobDescription,
        ...interViewReportByAi
    });

    res.status(201).json({
        message: "Interview report generated successfully.",
        interviewReport
    });
}

async function getInterviewReportByIdController(req, res) {
    const { reportId } = req.params;

    const interviewReport = await interviewReportModel.findOne({ _id: reportId, user: req.user.id });

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found.",
        });
    }

    res.status(200).json({
        message: "Interview report fetched successfully.",
        interviewReport
    });
}

async function getAllInterviewReportsController(req, res) {
    const interviewReports = await interviewReportModel.find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan");

    res.status(200).json({
        message: "Interview reports fetched successfully.",
        interviewReports
    });
}

async function generateResumePdfController(req, res) {
    const { reportId } = req.params;

    const userReport = await interviewReportModel.findById(reportId);

    if (!userReport) {
        return res.status(404).json({
            message: "Interview report not found.",
        });
    }

    const { resume, jobDescription, selfDescription } = userReport;

    const pdfBuffer = await generateResumePdf({ resume, jobDescription, selfDescription });

    res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=resume_${reportId}.pdf`
    });
    res.send(pdfBuffer);
}

module.exports = {
    generateReportController,
    getInterviewReportByIdController,
    getAllInterviewReportsController,
    generateResumePdfController
};