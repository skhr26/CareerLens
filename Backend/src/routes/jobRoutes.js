const express = require("express");
const {
    getJobMatchesController,
    generateColdEmailController,
    sendColdEmailController,
    previewAtsResumeController
} = require("../controller/jobController");
const { authMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/file.middleware");

const router = express.Router();

/**
 * @route POST /api/jobs/match
 * @description Find matching jobs and internships across Naukri, LinkedIn, Wellfound & Indeed
 * @access Private
 */
router.post("/match", authMiddleware, upload.single("resume"), getJobMatchesController);

/**
 * @route POST /api/jobs/cold-email
 * @description Generate personalized cold email for a job position
 * @access Private
 */
router.post("/cold-email", authMiddleware, generateColdEmailController);

/**
 * @route POST /api/jobs/send-email
 * @description Direct dispatch cold email endpoint, optionally with a resume attached
 * @access Private
 */
router.post("/send-email", authMiddleware, upload.single("resume"), sendColdEmailController);

/**
 * @route POST /api/jobs/ats-resume
 * @description Build the ATS-safe resume as a PDF so the user can preview what they attach
 * @access Private
 */
router.post("/ats-resume", authMiddleware, previewAtsResumeController);

module.exports = router;
