const express = require("express");
const {
    getJobMatchesController,
    generateColdEmailController,
    sendColdEmailController
} = require("../controller/jobController");
const { authMiddleware } = require("../middleware/auth.middleware");
const upload = require("../middleware/file.middleware");

const router = express.Router();

/**
 * @route POST /api/jobs/match
 * @description Find matching jobs across Naukri, LinkedIn & Wellfound based on resume / self-description
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
 * @description Direct dispatch cold email endpoint
 * @access Private
 */
router.post("/send-email", authMiddleware, sendColdEmailController);

module.exports = router;
