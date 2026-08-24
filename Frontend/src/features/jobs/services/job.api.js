import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:3000",
    withCredentials: true,
});

/**
 * Service to fetch matching jobs across Naukri, LinkedIn & Wellfound based on resume / self-description.
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
 * Service to send/dispatch cold email.
 */
export const sendColdEmailApi = async (dispatchData) => {
    const response = await api.post("/api/jobs/send-email", dispatchData);
    return response.data;
};
