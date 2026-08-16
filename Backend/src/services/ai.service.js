// here we will write  all the ai related logic like generating the interview report and all the other things
const {GoogleGenAI }=require('@google/genai')
const { zodToJsonSchema } = require("zod-to-json-schema")
const puppeteer = require("puppeteer")
const {z} =require("zod")
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
  resume,
  selfDescription,
  jobDescription
}) {

  const prompt = `
Generate an interview report for a candidate based on the following details.

Resume:
${resume}

Self Description:
${selfDescription}

Job Description:
${jobDescription}

Analyze the candidate carefully and generate:
1. A match score between 0 and 100.
2. Technical interview questions.
3. Behavioral interview questions.
4. Skill gaps with severity.
5. A day-wise interview preparation plan.
6. The job title.

Make the questions and preparation plan specific to the candidate and job description.
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



async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch()
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" })

    const pdfBuffer = await page.pdf({
        format: "A4", margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm"
        }
    })

    await browser.close()

    return pdfBuffer
}

async function generateResumePdf({ resume, selfDescription, jobDescription }) {

    const resumePdfSchema = z.object({
        html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
    })

    const prompt = `Generate resume for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}

                        the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
                        The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
                        The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
                        you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
                        The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
                        The resume should not be so lengthy, it should ideally be 1 page long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description. Use compact but readable typography:
                      - body font around 10-11px
                      - headings around 12-14px
                      - small but readable spacing
                      - minimal margins
                      - avoid excessive whitespace
                      - avoid unnecessary paragraphs
                      - use concise bullet points
                      - avoid repeating information
                      - prioritize relevant experience, projects, skills and education
                      - do not invent any information
                      - do not include unnecessary sections
                    `

    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(resumePdfSchema),
        }
    })


    const jsonContent = JSON.parse(response.text)

    const pdfBuffer = await generatePdfFromHtml(jsonContent.html)

    return pdfBuffer

}


module.exports={generateInterviewReport,generatePdfFromHtml,generateResumePdf}

