// here we will write  all the ai related logic like generating the interview report and all the other things
const {GoogleGenAI }=require('@google/genai')
const { zodToJsonSchema } = require("zod-to-json-schema")
const {z} =require("zod")
const { generatePdfFromHtml } = require("./pdf.service")
const { generateAtsResumePdf } = require("./atsResume.service")
const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENAI_API_KEY,
});
// now we will be defining the ReportScehma

// using zod to make it structured

// ye wali details ham taiyaar kar rhe hai ai ke liye answer ka schema hai kind off 
const interviewReportJsonSchema = {
  type: "object",
  properties: {
    matchScore: {
      type: "number",
      description:
        "A score between 0 and 100 indicating how well the candidate's profile matches the job description."
    },

    technicalQuestions: {
      type: "array",
      description:
        "Technical questions that can be asked in the interview along with their intention and how to answer them.",
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The technical question that can be asked in the interview."
          },
          intention: {
            type: "string",
            description:
              "The intention of the interviewer behind asking this question."
          },
          answer: {
            type: "string",
            description:
              "How to answer this question, what points to cover, and what approach to take."
          }
        },
        required: ["question", "intention", "answer"]
      }
    },

    behavioralQuestions: {
      type: "array",
      description:
        "Behavioral questions that can be asked in the interview along with their intention and how to answer them.",
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The behavioral question that can be asked in the interview."
          },
          intention: {
            type: "string",
            description:
              "The intention of the interviewer behind asking this question."
          },
          answer: {
            type: "string",
            description:
              "How to answer this question, what points to cover, and what approach to take."
          }
        },
        required: ["question", "intention", "answer"]
      }
    },

    skillGaps: {
      type: "array",
      description:
        "List of skill gaps in the candidate's profile along with their severity.",
      items: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: "The skill which the candidate is lacking."
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "The severity of this skill gap based on its importance for the job and its potential impact on the candidate's chances."
          }
        },
        required: ["skill", "severity"]
      }
    },

    preparationPlan: {
      type: "array",
      description:
        "A day-wise preparation plan for the candidate to follow in order to prepare for the interview effectively.",
      items: {
        type: "object",
        properties: {
          day: {
            type: "integer",
            description:
              "The day number in the preparation plan, starting from 1."
          },
          focus: {
            type: "string",
            description:
              "The main focus of this day, such as data structures, system design, or mock interviews."
          },
          tasks: {
            type: "array",
            items: {
              type: "string"
            },
            description:
              "List of tasks to be completed on that day."
          }
        },
        required: ["day", "focus", "tasks"]
      }
    },

    title: {
      type: "string",
      description:
        "The title of the job for which the interview report is generated."
    }
  },

  required: [
    "matchScore",
    "technicalQuestions",
    "behavioralQuestions",
    "skillGaps",
    "preparationPlan",
    "title"
  ]
};

const interviewReportSchema = z.fromJSONSchema(interviewReportJsonSchema);


async function generateInterviewReport({
  resume="",
  selfDescription="",
  jobDescription
}) {

// At least one of resume or selfDescription is required
    if (!resume.trim() && !selfDescription.trim()) {
        throw new Error(
            "Either resume or self description is required."
        );
    }

    const prompt = `
Generate an interview report for a candidate based on the following details.

Resume:
${resume || "Not provided"}

Self Description:
${selfDescription || "Not provided"}

Job Description:
${jobDescription || "Not provided"}

Analyze the candidate carefully and generate:

1. A match score between 0 and 100.
2. Technical interview questions.
3. Behavioral interview questions.
4. Skill gaps with severity.
5. A day-wise interview preparation plan.
6. The job title.

IMPORTANT:
- At least one of the Resume or Self Description will be provided.
- If the Resume is not provided, analyze the candidate using the Self Description and Job Description.
- If the Self Description is not provided, analyze the candidate using the Resume and Job Description.
- Do not assume that missing information exists.
- Do not invent skills, experience, projects, education, or achievements that are not supported by the provided information.
- Make the questions and preparation plan specific to the candidate and job description.
`;

  const interaction = await ai.interactions.create({
    model: "gemini-3.5-flash",

    input: prompt,

    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: interviewReportJsonSchema
    }
  });

  const interviewReport = interviewReportSchema.parse(
    JSON.parse(interaction.output_text)
  );

  console.dir(interviewReport, { depth: null });

  return interviewReport;
}




/**
 * Builds the candidate's resume as a PDF.
 *
 * Delegates to the ATS service. The previous version asked Gemini for free-form HTML
 * and told it to "highlight the content using some colors", which produced a document
 * that looked designed and parsed badly — the model was free to emit layout tables and
 * multi-column CSS, both of which an applicant tracking system scrambles. The signature
 * is unchanged, so `POST /api/report/resume-pdf/:reportId` needs no edit.
 */
async function generateResumePdf({ resume, selfDescription, jobDescription }) {
    return generateAtsResumePdf({
        resume: resume || "",
        selfDescription: selfDescription || "",
        jobDescription: jobDescription || ""
    });
}


module.exports={generateInterviewReport,generatePdfFromHtml,generateResumePdf}

