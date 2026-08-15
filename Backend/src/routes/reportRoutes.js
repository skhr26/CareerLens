const express=require("express");
const {generateReportController,getAllInterviewReportsController,getInterviewReportByIdController,generateResumePdfController}=require('../controller/reportController')
const {authMiddleware}=require("../middleware/auth.middleware")
const upload=require('../middleware/file.middleware')
const router=express.Router();

// here we will be giving the data for the report
router.post("/",authMiddleware,upload.single("resume"),generateReportController);
router.get('/',authMiddleware,getAllInterviewReportsController);
router.get("/:reportId",authMiddleware,getInterviewReportByIdController)


/**
 * @route GET /api/report/resume-pdf/:reportId
 * @description generate resume pdf on the basis of user self description, resume content and job description.
 * @access private
 */

router.post("/resume-pdf/:reportId", authMiddleware,generateResumePdfController)


module.exports=router