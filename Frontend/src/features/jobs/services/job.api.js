import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:3000",
    withCredentials: true,
});

/**
 * Service to fetch matching jobs and internships across Naukri, LinkedIn, Wellfound & Indeed
 * based on resume / self-description.
 */
export const fetchMatchingJobsApi = async ({ selfDescription, resumeFile }) => {
    const formData = new FormData();
    if (selfDescription) formData.append("selfDescription", selfDescription);
    if (resumeFile) formData.append("resume", resumeFile);

    const response = await api.post("/api/jobs/match", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        }
    });
    return response.data;
};

/**
 * Service to generate personalized cold email for a job post.
 */
export const generateColdEmailApi = async (emailData) => {
    const response = await api.post("/api/jobs/cold-email", emailData);
    return response.data;
};

/**
 * Service to send/dispatch cold email, optionally with a resume attached.
 *
 * Always multipart: the backend reads the same fields either way, and one code path is
 * easier to keep correct than a JSON path plus a FormData path.
 */
export const sendColdEmailApi = async ({
    toEmail,
    subject,
    body,
    resumeSource = "none",
    resumeFile = null,
    resumeText = "",
    selfDescription = "",
    jobDescription = ""
}) => {
    const formData = new FormData();
    formData.append("toEmail", toEmail || "");
    formData.append("subject", subject || "");
    formData.append("body", body || "");
    formData.append("resumeSource", resumeSource);

    if (resumeSource === "upload" && resumeFile) {
        formData.append("resume", resumeFile);
    }
    if (resumeSource === "generated") {
        // The ATS resume is built server-side from these, so they have to travel with the send.
        formData.append("resumeText", resumeText);
        formData.append("selfDescription", selfDescription);
        formData.append("jobDescription", jobDescription);
    }

    const response = await api.post("/api/jobs/send-email", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        }
    });
    return response.data;
};

/**
 * Builds the ATS resume and returns it as a blob, so the user can read exactly what
 * they are about to attach before it reaches a founder's inbox.
 */
export const previewAtsResumeApi = async ({ resumeText, selfDescription, jobDescription }) => {
    const response = await api.post(
        "/api/jobs/ats-resume",
        { resumeText, selfDescription, jobDescription },
        { responseType: "blob" }
    );
    return response.data;
};
