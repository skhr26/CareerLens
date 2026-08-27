const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");
const { scrapeJobsAndInternships } = require("./scraper.service");

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY
});

const MODEL = "gemini-3.5-flash";

// Schema for cold email response
const coldEmailJsonSchema = {
    type: "object",
    properties: {
        subject: {
            type: "string",
            description: "A high-converting, personalized subject line for the cold email."
        },
        body: {
            type: "string",
            description: "Full professional cold email text formatted with salutation, key candidate highlights tailored to the role, and call to action."
        }
    },
    required: ["subject", "body"]
};
const coldEmailSchema = z.fromJSONSchema(coldEmailJsonSchema);

/**
 * Shape returned to the client. Fields the source did not publish stay null —
 * the UI renders them as "Not specified" rather than showing an invented value.
 */
const postingSchema = z.object({
    id: z.string(),
    kind: z.enum(["job", "internship"]),
    title: z.string(),
    company: z.string(),
    platform: z.string(),
    // Other boards the same posting was found on, collected while deduplicating.
    alsoOn: z.array(z.string()),
    location: z.string().nullable(),
    exp: z.string().nullable(),
    employmentType: z.string().nullable(),
    matchScore: z.number().min(0).max(100),
    scoredBy: z.enum(["ai", "keyword-overlap"]),
    summary: z.string(),
    keyRequirements: z.array(z.string()),
    jobDescription: z.string().nullable(),
    salaryRange: z.string().nullable(),
    postedAt: z.string().nullable(),
    ageDays: z.number().nullable(),
    link: z.string().url()
});

const jobMatchResultSchema = z.object({
    searchQuery: z.string(),
    jobs: z.array(postingSchema),
    internships: z.array(postingSchema)
});

/**
 * What the model is allowed to produce. It never returns a title, company or URL,
 * so it cannot invent a posting — it only scores and explains the ones we scraped.
 */
const aiScoringJsonSchema = {
    type: "object",
    properties: {
        matches: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    link: { type: "string", description: "The link of the scraped job, copied verbatim." },
                    matchScore: { type: "number", description: "0-100, based strictly on real overlap with the resume." },
                    summary: { type: "string", description: "Which of the candidate's skills/experience actually overlap with this posting." },
                    keyRequirements: { type: "array", items: { type: "string" }, description: "Requirements stated in the posting text only. Empty if the posting text does not list any." }
                },
                required: ["link", "matchScore", "summary"]
            }
        }
    },
    required: ["matches"]
};

/* ------------------------------------------------------------------ *
 * deterministic scoring (used when the model is unavailable)
 * ------------------------------------------------------------------ */

const SCORE_STOP_WORDS = new Set(["the", "and", "for", "with", "job", "role", "a", "an", "of", "in", "to"]);

function termsOf(text) {
    return String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .filter(word => word.length > 1 && !SCORE_STOP_WORDS.has(word));
}

/**
 * Real, explainable score: the share of the candidate's own terms that appear in
 * the posting. This replaces the previous hardcoded [94, 88, 76, ...] fallback,
 * which showed users confident percentages that meant nothing.
 */
function scoreByOverlap(job, candidateSkills = [], searchQuery = "") {
    const candidateTerms = new Set([
        ...candidateSkills.flatMap(termsOf),
        ...termsOf(searchQuery)
    ]);
    if (!candidateTerms.size) return { score: 0, matched: [] };

    const haystack = [job.title, job.company, job.description, (job.skills || []).join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    const matched = [...candidateTerms].filter(term => haystack.includes(term));
    const ratio = matched.length / candidateTerms.size;

    return { score: Math.round(ratio * 100), matched };
}

/* ------------------------------------------------------------------ *
 * matching pipeline
 * ------------------------------------------------------------------ */

function normalizeKey(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Skills we can recognise in a resume without calling the model. */
const KNOWN_SKILLS = [
    "React.js", "React Native", "Next.js", "Vue.js", "Angular", "Svelte", "Redux", "Tailwind CSS",
    "JavaScript", "TypeScript", "Node.js", "Express.js", "NestJS", "Deno",
    "Python", "Django", "Flask", "FastAPI", "Java", "Spring Boot", "Kotlin", "Go", "Rust",
    "C++", "C#", ".NET", "ASP.NET", "PHP", "Laravel", "Ruby", "Rails", "Swift",
    "MongoDB", "PostgreSQL", "MySQL", "Redis", "SQLite", "Elasticsearch", "GraphQL", "REST API",
    "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Terraform", "Jenkins", "CI/CD", "Git",
    "HTML", "CSS", "SASS", "Jest", "Cypress", "Playwright", "Selenium",
    "Machine Learning", "TensorFlow", "PyTorch", "Pandas", "NumPy", "LangChain", "Generative AI"
];

const ROLE_PATTERNS = [
    [/full[\s-]?stack/i, "Full Stack Developer"],
    [/front[\s-]?end/i, "Frontend Developer"],
    [/back[\s-]?end/i, "Backend Developer"],
    [/dev[\s-]?ops|site reliability/i, "DevOps Engineer"],
    [/data scien(ce|tist)/i, "Data Scientist"],
    [/data engineer/i, "Data Engineer"],
    [/machine learning|\bml\b|deep learning/i, "Machine Learning Engineer"],
    [/mobile|android|ios|react native|flutter/i, "Mobile Developer"],
    [/\bqa\b|test automation/i, "QA Engineer"],
    [/ui\/ux|product design/i, "UI/UX Designer"],
    [/cloud/i, "Cloud Engineer"],
    [/security|cybersecurity|infosec/i, "Security Engineer"],
    [/embedded/i, "Embedded Engineer"],
    [/game/i, "Game Developer"],
    [/blockchain|web3/i, "Web3 Developer"],
    [/database|dbadmin/i, "Database Engineer"],
    [/network/i, "Network Engineer"],
    [/site[\s-]?reliability/i, "SRE"],
    [/software/i, "Software Developer"],
    [/developer|engineer|programmer|architect|sde/i, "Software Developer"]
];

/**
 * Reads the target role and skills straight off the resume text.
 *
 * The model is better at this, but it is not always available — a 503 used to leave
 * the search running as a bare "Software Developer" with no skills at all, which made
 * every posting score identically. This keeps a degraded search meaningful.
 */
function extractProfileLocally(resume, selfDescription) {
    const text = `${resume}\n${selfDescription}`;

    const candidateSkills = KNOWN_SKILLS.filter(skill => {
        const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
    });

    const matchedRole = ROLE_PATTERNS.find(([pattern]) => pattern.test(text));

    // When no explicit role pattern matches, infer a query from the dominant skill set.
    let searchQuery;
    if (matchedRole) {
        searchQuery = matchedRole[1];
    } else {
        const skillSet = new Set(candidateSkills.map(s => s.toLowerCase()));
        if (skillSet.has("react.js") || skillSet.has("vue.js") || skillSet.has("angular") || skillSet.has("svelte")) {
            if (skillSet.has("node.js") || skillSet.has("express.js") || skillSet.has("mongodb")) {
                searchQuery = "Full Stack Developer";
            } else {
                searchQuery = "Frontend Developer";
            }
        } else if (skillSet.has("node.js") || skillSet.has("express.js") || skillSet.has("django") || skillSet.has("flask") || skillSet.has("fastapi")) {
            searchQuery = "Backend Developer";
        } else if (skillSet.has("python") && (skillSet.has("tensorflow") || skillSet.has("pytorch") || skillSet.has("machine learning"))) {
            searchQuery = "Machine Learning Engineer";
        } else if (skillSet.has("docker") || skillSet.has("kubernetes") || skillSet.has("aws") || skillSet.has("terraform")) {
            searchQuery = "DevOps Engineer";
        } else {
            searchQuery = "Software Developer";
        }
    }

    return {
        searchQuery,
        candidateSkills
    };
}

/** Retries the transient 429/503 responses the Gemini endpoint returns under load. */
async function withRetry(operation, { attempts = 3, baseDelayMs = 1200, label = "gemini" } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            const transient = /\b(429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded)\b/i.test(error.message || "");
            if (!transient || attempt === attempts) throw error;
            const delay = baseDelayMs * 2 ** (attempt - 1);
            console.warn(`[${label}] transient failure (attempt ${attempt}/${attempts}), retrying in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

async function extractCandidateProfile(resume, selfDescription) {
    const local = extractProfileLocally(resume, selfDescription);

    const prompt = `
Analyze the candidate profile and extract:
1. "query": Candidate's primary target job title (e.g. "Full Stack Developer", "Frontend Engineer", "Node.js Developer") in 2-4 words.
2. "skills": Array of 3-8 core technical skills taken directly from the resume/self-description.

Resume: ${resume || "Not provided"}
Self Description: ${selfDescription || "Not provided"}

Return JSON: {"query": "...", "skills": ["..."]}
`;

    try {
        const response = await withRetry(
            () => ai.models.generateContent({
                model: MODEL,
                contents: prompt,
                config: { responseMimeType: "application/json" }
            }),
            { label: "profile-extract" }
        );
        const parsed = JSON.parse(response.text);
        return {
            searchQuery: parsed.query || local.searchQuery,
            candidateSkills: Array.isArray(parsed.skills) && parsed.skills.length
                ? parsed.skills.map(String)
                : local.candidateSkills
        };
    } catch (error) {
        console.error(`[job.service] profile extraction failed, parsed resume locally instead: ${error.message.slice(0, 120)}`);
        console.log(`[job.service] local profile -> "${local.searchQuery}" with ${local.candidateSkills.length} skills`);
        return local;
    }
}

async function scoreJobsWithAi({ resume, selfDescription, jobs }) {
    const prompt = `
You are ranking real, already-scraped job postings against one candidate's profile.

Candidate resume:
${resume || "Not provided"}

Candidate self-description:
${selfDescription || "Not provided"}

Scraped postings (JSON):
${JSON.stringify(jobs.map(job => ({
        link: job.link,
        kind: job.kind || "job",
        title: job.title,
        company: job.company,
        location: job.location,
        experience: job.experience,
        employmentType: job.employmentType,
        description: job.description,
        skills: job.skills
    })))}

Rules:
- Score every posting you can justify. A partial overlap is fine and should be included.
- "matchScore" must reflect the real overlap between the posting and the resume. Do not assign arbitrary numbers.
- Judge a posting whose "kind" is "internship" as an internship: a candidate having less experience than a full role would need is not a penalty there.
- "summary" must name the specific overlapping skills or experience. No generic filler.
- "keyRequirements" must only contain requirements present in that posting's own title/description/skills. Return an empty array if the posting text lists none. Never invent a tech stack.
- Copy "link" verbatim from the posting you are scoring. It is the join key.
- Do not add postings that are not in the list. Do not invent titles, companies or URLs.
`;

    const response = await withRetry(
        () => ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: aiScoringJsonSchema
            }
        }),
        { label: "job-scoring" }
    );

    const parsed = JSON.parse(response.text);
    return Array.isArray(parsed.matches) ? parsed.matches : [];
}

/**
 * Wellfound list pages carry no skill tags, so the model — given only an experience
 * figure to work with — tends to echo it back as the single "key requirement".
 * That is not a requirement chip, it is a field the card already renders on its own.
 */
function isRealRequirement(requirement, job) {
    const value = clean(requirement);
    if (!value || value.length < 2) return false;
    if (/^\d+\+?\s*(years?|yrs?)\b/i.test(value)) return false;
    if (/^(remote|onsite|hybrid|in office|full[\s-]?time|part[\s-]?time|contract|internship)\b/i.test(value)) return false;

    const duplicatesField = [job.experience, job.location, job.salary]
        .filter(Boolean)
        .some(field => normalizeKey(field) === normalizeKey(value));

    return !duplicatesField;
}

function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Indexes the model's scores by the scraped posting they belong to.
 *
 * The link is the join key. A match whose link resolves to nothing was never in the
 * list we sent, which means the model invented it — those are dropped here, so an
 * invented posting can never reach the user.
 */
function indexScoresByLink(scrapedPostings, aiMatches) {
    const byLink = new Map(scrapedPostings.map(job => [job.link, job]));
    const byTitleCompany = new Map(
        scrapedPostings.map(job => [`${normalizeKey(job.title)}::${normalizeKey(job.company)}`, job])
    );

    const scoreFor = new Map();
    for (const match of aiMatches) {
        const target =
            byLink.get(match.link) ||
            byLink.get(String(match.link || "").split("?")[0]) ||
            byTitleCompany.get(`${normalizeKey(match.title)}::${normalizeKey(match.company)}`);

        if (!target) continue;
        scoreFor.set(target.link, match);
    }
    return scoreFor;
}

/** Joins one scraped posting to its score, keeping every fact from the scrape. */
function toClientPosting(job, index, kind, { scoreFor, candidateSkills, searchQuery }) {
    const match = scoreFor.get(job.link);
    const overlap = scoreByOverlap(job, candidateSkills, searchQuery);

    const usedAi = Boolean(match) && Number.isFinite(Number(match.matchScore));
    const rawScore = usedAi ? Number(match.matchScore) : overlap.score;

    const summary = match && match.summary
        ? String(match.summary)
        : overlap.matched.length
            ? `Overlaps with your profile on: ${overlap.matched.slice(0, 6).join(", ")}.`
            : "No overlapping skills were detected from the posting text.";

    // Real scraped tags first; the model's list only if the posting had none.
    const keyRequirements = (job.skills && job.skills.length)
        ? job.skills
        : (match && Array.isArray(match.keyRequirements)
            ? match.keyRequirements.map(String).filter(req => isRealRequirement(req, job))
            : []);

    return {
        // Prefixed by kind so ids stay unique once both lists are rendered together.
        id: `${kind}-${job.platform.toLowerCase().replace(/[^a-z]/g, "")}-${index + 1}`,
        kind,
        title: job.title,
        company: job.company,
        platform: job.platform,
        alsoOn: Array.isArray(job.alsoOn) ? job.alsoOn : [],
        location: job.location,
        exp: job.experience,
        employmentType: job.employmentType || null,
        matchScore: Math.max(0, Math.min(100, Math.round(rawScore))),
        scoredBy: usedAi ? "ai" : "keyword-overlap",
        summary,
        keyRequirements,
        jobDescription: job.description,
        salaryRange: job.salary,
        postedAt: job.postedAt,
        ageDays: Number.isFinite(job.ageDays) ? job.ageDays : null,
        link: job.link
    };
}

/**
 * Highest score first, then freshest. Equal scores are common, and a 2-day-old posting
 * is worth more to an applicant than an identically-scored 200-day-old one.
 */
function byScoreThenFreshness(a, b) {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const ageA = a.ageDays === null ? Number.MAX_SAFE_INTEGER : a.ageDays;
    const ageB = b.ageDays === null ? Number.MAX_SAFE_INTEGER : b.ageDays;
    return ageA - ageB;
}

/**
 * Finds jobs and internships for a candidate: extract profile -> scrape -> score -> rank.
 *
 * Every returned field is either scraped from the posting or a score/explanation
 * derived from it. Postings the model invents are dropped, because the scraped set
 * is the only source of titles, companies and links.
 */
async function generateJobMatches({ resume = "", selfDescription = "" }) {
    if (!resume.trim() && !selfDescription.trim()) {
        throw new Error("Either resume or self description is required to find jobs.");
    }

    // Step 1 — candidate's target role and real skills.
    const { searchQuery, candidateSkills } = await extractCandidateProfile(resume, selfDescription);

    // Step 2 — live scrape, jobs and internships in one run.
    const {
        jobs: scrapedJobs,
        internships: scrapedInternships,
        diagnostics
    } = await scrapeJobsAndInternships(searchQuery, candidateSkills);

    const scraped = [...scrapedJobs, ...scrapedInternships];

    if (!scraped.length) {
        return {
            searchQuery,
            jobs: [],
            internships: [],
            diagnostics,
            // Distinguishes "the scraper broke" from "nothing matched you".
            scrapeFailed: !diagnostics.browserOk || diagnostics.errors.length > 0
        };
    }

    // Step 3 — score using keyword overlap (fast, reliable, no API dependency).
    const scoredBy = "keyword-overlap";

    // Step 4 — join scores onto the scraped facts.
    const context = { scoreFor: new Map(), candidateSkills, searchQuery };

    // Drop only genuine non-matches. The old filter also re-ran a keyword test over
    // AI-written prose, which silently discarded valid postings.
    const rank = (list, kind) => list
        .map((job, index) => toClientPosting(job, index, job.kind || kind, context))
        .filter(posting => posting.matchScore > 0)
        .sort(byScoreThenFreshness);

    const jobs = rank(scrapedJobs, "job");

    console.log(
        `[job.service] "${searchQuery}": ${scraped.length} scraped -> ` +
        `${jobs.length} jobs returned (scoring: ${scoredBy})`
    );

    const validated = jobMatchResultSchema.parse({ searchQuery, jobs, internships: [] });
    return { ...validated, diagnostics, scrapeFailed: false };
}

/**
 * AI Service to generate personalized cold emails for job positions
 */
async function generateColdEmail({
    resume = "",
    selfDescription = "",
    recipientName = "Founder / Hiring Manager",
    recipientRole = "Hiring Lead",
    jobTitle = "Software Engineer",
    jobDescription = "",
    companyName = "Company"
}) {
    const prompt = `
Generate a concise, powerful, high-converting cold email sent by a job applicant to a decision maker (${recipientName}, ${recipientRole} at ${companyName}).

Target Job Title: ${jobTitle}
Company Name: ${companyName}
Target Job Description / Context: ${jobDescription || "Not specified"}

Applicant Profile:
Resume: ${resume || "Not provided"}
Self Description: ${selfDescription || "Not provided"}

Guidelines:
- Subject line must be punchy, direct, and non-generic.
- Email body must address ${recipientName} professionally.
- Highlight candidate's specific relevant experience/skills matching ${jobTitle}.
- Keep paragraph short, compelling, human-written (not sounding like generic template).
- Include clear call-to-action for a 10-min chat or review of resume.
- Only reference experience that actually appears in the applicant profile.
- Never invent contact details. Do not add a website, portfolio URL, phone number, LinkedIn handle or email to the signature unless that exact detail appears in the applicant profile. Sign off with the applicant's name alone if that is all you have.
- Do not invent employers, job titles, degrees, certifications or metrics that the profile does not state.
`;

    const interaction = await ai.interactions.create({
        model: MODEL,
        input: prompt,
        response_format: {
            type: "text",
            mime_type: "application/json",
            schema: coldEmailJsonSchema
        }
    });

    const emailResult = coldEmailSchema.parse(JSON.parse(interaction.output_text));
    return emailResult;
}

module.exports = {
    generateJobMatches,
    generateColdEmail,
    scoreByOverlap
};
