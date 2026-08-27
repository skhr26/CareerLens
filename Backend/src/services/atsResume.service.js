const { GoogleGenAI } = require("@google/genai");
const pdfParse = require("pdf-parse");
const { generatePdfFromHtml } = require("./pdf.service");

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

const MODEL = "gemini-3.5-flash";

/* ------------------------------------------------------------------ *
 * what the model is allowed to return
 * ------------------------------------------------------------------ */

/**
 * The model returns structured facts, never markup.
 *
 * This is the whole ATS guarantee: an LLM asked for "ATS-friendly HTML" will happily
 * emit a two-column layout table, and an applicant tracking system reading that table
 * cell by cell interleaves the columns into nonsense. Because the model cannot express
 * a layout here, it cannot produce one that breaks parsing.
 */
const atsResumeJsonSchema = {
    type: "object",
    properties: {
        name: { type: "string", description: "The candidate's full name, exactly as written in the profile." },
        headline: { type: "string", description: "Target role in 2-5 words, e.g. 'Full Stack Developer'. Omit if the profile gives no clear target." },
        contact: {
            type: "object",
            description: "Only details that literally appear in the profile. Omit every field the profile does not state.",
            properties: {
                email: { type: "string" },
                phone: { type: "string" },
                location: { type: "string" },
                links: { type: "array", items: { type: "string" }, description: "Portfolio / GitHub / LinkedIn URLs stated in the profile." }
            }
        },
        summary: { type: "string", description: "2-3 sentences, first person implied (no 'I'), naming real skills and real experience only." },
        skillGroups: {
            type: "array",
            description: "Skills grouped by kind, most relevant to the target posting first.",
            items: {
                type: "object",
                properties: {
                    label: { type: "string", description: "e.g. 'Languages', 'Frontend', 'Backend', 'Databases', 'Tools'." },
                    items: { type: "array", items: { type: "string" } }
                },
                required: ["label", "items"]
            }
        },
        experience: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    role: { type: "string" },
                    company: { type: "string" },
                    location: { type: "string" },
                    start: { type: "string", description: "e.g. 'Jan 2024'. Omit if the profile does not state it." },
                    end: { type: "string", description: "e.g. 'Present'. Omit if the profile does not state it." },
                    bullets: {
                        type: "array",
                        items: { type: "string" },
                        description: "Up to 4 bullets. Each starts with a past-tense verb and states what was built and with what."
                    }
                },
                required: ["role", "company", "bullets"]
            }
        },
        projects: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    tech: { type: "string", description: "Comma-separated stack, taken from the profile." },
                    bullets: { type: "array", items: { type: "string" }, description: "Up to 2 bullets." }
                },
                required: ["name", "bullets"]
            }
        },
        education: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    degree: { type: "string" },
                    institution: { type: "string" },
                    year: { type: "string" },
                    detail: { type: "string", description: "CGPA or percentage, only if the profile states one." }
                },
                required: ["degree", "institution"]
            }
        },
        certifications: { type: "array", items: { type: "string" } }
    },
    required: ["name", "summary", "skillGroups"]
};

/** Retries the transient 429/503 responses the Gemini endpoint returns under load. */
async function withRetry(operation, { attempts = 3, baseDelayMs = 1200, label = "ats-resume" } = {}) {
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

async function buildAtsResumeData({ resume = "", selfDescription = "", jobDescription = "" }) {
    const tailoring = jobDescription.trim()
        ? `Target posting (tailor to this):
${jobDescription.trim().slice(0, 6000)}

Tailoring rules — selection and ordering only:
- Put the skills, roles, projects and bullets most relevant to this posting first.
- Prefer the profile's own wording for a technology when the posting names the same one.
- Drop bullets that are irrelevant to this posting rather than rewriting them into something the profile does not support.
- Do NOT add a skill, tool or responsibility because the posting asks for it. If the profile does not show it, it does not go in.`
        : `No target posting was given, so order sections by general relevance to the candidate's stated target role.`;

    const prompt = `Convert the candidate profile below into structured resume data.

Candidate resume text:
${resume || "Not provided"}

Candidate self-description:
${selfDescription || "Not provided"}

${tailoring}

Hard rules:
- Every fact must come from the profile above. Invent nothing: no employers, job titles, dates, degrees, institutions, certifications, metrics, or technologies.
- If the profile does not state a field, OMIT that field entirely. Never emit a placeholder such as "N/A", "XXXXXXXX", "[Your Email]" or "Not provided" — an applicant tracking system indexes placeholders as if they were real values.
- Never invent contact details. Include an email, phone, location or link only if that exact value appears in the profile.
- Do not include a metric ("reduced load time by 40%") unless that number appears in the profile.
- Keep it to roughly one page: at most 4 roles, 3 projects, 4 bullets per role, 2 per project.
- Bullets are single sentences, no trailing period needed, starting with a verb. Write them as a person would, not as marketing copy.
- Write plain text only. No markdown, no HTML, no bullet characters, no emoji.`;

    const response = await withRetry(
        () => ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: atsResumeJsonSchema
            }
        }),
        { label: "ats-resume" }
    );

    return sanitizeAtsResumeData(JSON.parse(response.text));
}

/* ------------------------------------------------------------------ *
 * sanitising
 * ------------------------------------------------------------------ */

// Placeholders the model reaches for when the profile is missing a field. They must not
// survive into the PDF: an ATS stores "[Your Email]" as the candidate's email address.
const PLACEHOLDER = /^(n\/?a|none|null|undefined|not provided|not specified|tbd|xx+|\[.*\]|<.*>|-+)$/i;

function text(value) {
    const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned || PLACEHOLDER.test(cleaned)) return "";
    // Strip markdown and bullet glyphs the model sometimes adds despite being asked not to.
    return cleaned.replace(/^[•▪●·*\-–—]\s*/, "").replace(/\*\*/g, "").trim();
}

function list(value, limit = 50) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        const cleaned = text(item);
        const key = cleaned.toLowerCase();
        if (!cleaned || seen.has(key)) continue;
        seen.add(key);
        out.push(cleaned);
        if (out.length >= limit) break;
    }
    return out;
}

function dateRange(start, end) {
    const from = text(start);
    const to = text(end);
    if (from && to) return `${from} – ${to}`;
    return from || to || "";
}

function sanitizeAtsResumeData(raw) {
    const contact = raw.contact || {};

    const data = {
        name: text(raw.name),
        headline: text(raw.headline),
        contact: {
            email: text(contact.email),
            phone: text(contact.phone),
            location: text(contact.location),
            links: list(contact.links, 3)
        },
        summary: text(raw.summary),
        skillGroups: (Array.isArray(raw.skillGroups) ? raw.skillGroups : [])
            .map(group => ({ label: text(group && group.label), items: list(group && group.items, 14) }))
            .filter(group => group.label && group.items.length)
            .slice(0, 6),
        experience: (Array.isArray(raw.experience) ? raw.experience : [])
            .map(role => ({
                role: text(role && role.role),
                company: text(role && role.company),
                location: text(role && role.location),
                period: dateRange(role && role.start, role && role.end),
                bullets: list(role && role.bullets, 4)
            }))
            .filter(role => role.role && role.company)
            .slice(0, 4),
        projects: (Array.isArray(raw.projects) ? raw.projects : [])
            .map(project => ({
                name: text(project && project.name),
                tech: text(project && project.tech),
                bullets: list(project && project.bullets, 2)
            }))
            .filter(project => project.name)
            .slice(0, 3),
        education: (Array.isArray(raw.education) ? raw.education : [])
            .map(entry => ({
                degree: text(entry && entry.degree),
                institution: text(entry && entry.institution),
                year: text(entry && entry.year),
                detail: text(entry && entry.detail)
            }))
            .filter(entry => entry.degree || entry.institution)
            .slice(0, 3),
        certifications: list(raw.certifications, 6)
    };

    if (!data.name) throw new Error("Could not read a name from your profile, so we cannot build a resume from it.");
    if (!data.skillGroups.length && !data.experience.length && !data.projects.length) {
        throw new Error("Your profile does not contain enough detail to build a resume. Add your skills, projects or experience and try again.");
    }

    return data;
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Every rule an ATS parser cares about is encoded here rather than requested from a
 * model: one linear column, no layout tables, no multi-column CSS, no images or icons,
 * standard section headings, real <ul>/<li> bullets, and selectable black-on-white text.
 */
const ATS_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10.5pt;
    line-height: 1.35;
    color: #000000;
    background: #ffffff;
    margin: 0;
  }
  h1 { font-size: 17pt; margin: 0 0 2pt 0; letter-spacing: 0.3pt; }
  h2 {
    font-size: 11.5pt;
    margin: 12pt 0 4pt 0;
    padding-bottom: 2pt;
    border-bottom: 1px solid #000000;
    text-transform: uppercase;
  }
  h3 { font-size: 10.5pt; margin: 7pt 0 1pt 0; }
  p { margin: 0 0 4pt 0; }
  ul { margin: 2pt 0 0 0; padding-left: 15pt; }
  li { margin: 0 0 2pt 0; }
  .headline { font-size: 11pt; margin: 0 0 2pt 0; }
  .contact { font-size: 9.5pt; margin: 0 0 2pt 0; }
  .meta { font-size: 9.5pt; margin: 0; }
  .skill-line { margin: 0 0 3pt 0; }
`;

function renderBullets(bullets) {
    if (!bullets.length) return "";
    return `<ul>${bullets.map(bullet => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`;
}

function renderSection(heading, inner) {
    return inner ? `<h2>${escapeHtml(heading)}</h2>${inner}` : "";
}

function renderAtsHtml(data) {
    const contactLine = [data.contact.email, data.contact.phone, data.contact.location]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" | ");

    const skills = data.skillGroups
        .map(group => `<p class="skill-line"><strong>${escapeHtml(group.label)}:</strong> ${escapeHtml(group.items.join(", "))}</p>`)
        .join("");

    const experience = data.experience
        .map(role => {
            const meta = [role.company, role.location, role.period].filter(Boolean).map(escapeHtml).join(" | ");
            return `<h3>${escapeHtml(role.role)}</h3>` +
                (meta ? `<p class="meta">${meta}</p>` : "") +
                renderBullets(role.bullets);
        })
        .join("");

    const projects = data.projects
        .map(project =>
            `<h3>${escapeHtml(project.name)}</h3>` +
            (project.tech ? `<p class="meta">${escapeHtml(project.tech)}</p>` : "") +
            renderBullets(project.bullets)
        )
        .join("");

    const education = data.education
        .map(entry => {
            const meta = [entry.institution, entry.year, entry.detail].filter(Boolean).map(escapeHtml).join(" | ");
            return `<h3>${escapeHtml(entry.degree || entry.institution)}</h3>` +
                (meta ? `<p class="meta">${meta}</p>` : "");
        })
        .join("");

    // Links go in their own text line rather than an anchor-only row, so a parser that
    // ignores href attributes still records the URL.
    const links = data.contact.links.length
        ? `<p class="contact">${data.contact.links.map(escapeHtml).join(" | ")}</p>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.name)} - Resume</title>
<style>${ATS_STYLES}</style>
</head>
<body>
<h1>${escapeHtml(data.name)}</h1>
${data.headline ? `<p class="headline">${escapeHtml(data.headline)}</p>` : ""}
${contactLine ? `<p class="contact">${contactLine}</p>` : ""}
${links}
${renderSection("Summary", data.summary ? `<p>${escapeHtml(data.summary)}</p>` : "")}
${renderSection("Skills", skills)}
${renderSection("Experience", experience)}
${renderSection("Projects", projects)}
${renderSection("Education", education)}
${renderSection("Certifications", renderBullets(data.certifications))}
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * the guarantee
 * ------------------------------------------------------------------ */

/**
 * Reads the finished PDF back the way an applicant tracking system would.
 *
 * A resume that looks perfect on screen is worthless if its text is not extractable,
 * so this refuses to hand back a file whose own name and skills cannot be recovered
 * from it. Better a clear error than an attachment that silently parses to nothing.
 */
async function assertAtsParseable(pdfBuffer, data) {
    const originalWarn = console.warn;
    console.warn = (...args) => {
        if (typeof args[0] === "string" && args[0].includes("standardFontDataUrl")) return;
        originalWarn(...args);
    };

    let extracted = "";
    try {
        const parsed = await new pdfParse.PDFParse(Uint8Array.from(pdfBuffer)).getText();
        extracted = String(parsed.text || "");
    } catch (error) {
        throw new Error(`The generated resume could not be read back as text (${error.message}), so it would not survive an ATS. Please try again.`);
    } finally {
        console.warn = originalWarn;
    }

    const flat = extracted.replace(/\s+/g, " ").toLowerCase();
    if (flat.length < 120) {
        throw new Error("The generated resume contained no extractable text, so an ATS could not read it. Please try again.");
    }

    // Names can wrap across lines in the extracted text, so check the parts.
    const nameParts = data.name.toLowerCase().split(/\s+/).filter(part => part.length > 1);
    if (nameParts.length && !nameParts.every(part => flat.includes(part))) {
        throw new Error("The generated resume's name was not recoverable as text. Please try again.");
    }

    const skills = data.skillGroups.flatMap(group => group.items);
    if (skills.length && !skills.some(skill => flat.includes(skill.toLowerCase()))) {
        throw new Error("The generated resume's skills were not recoverable as text. Please try again.");
    }

    return { characters: flat.length };
}

/**
 * Builds a genuinely machine-parseable resume, tailored to one posting.
 *
 * Returns the PDF plus the structured data it came from, so callers can name the file
 * after the candidate instead of guessing.
 */
async function generateAtsResume({ resume = "", selfDescription = "", jobDescription = "" }) {
    if (!String(resume).trim() && !String(selfDescription).trim()) {
        throw new Error("We need your resume text or a self-description to build an ATS resume.");
    }

    const data = await buildAtsResumeData({ resume, selfDescription, jobDescription });
    const pdf = await generatePdfFromHtml(renderAtsHtml(data));
    const { characters } = await assertAtsParseable(pdf, data);

    console.log(
        `[ats-resume] built for "${data.name}" ` +
        `(${data.experience.length} roles, ${data.projects.length} projects, ` +
        `${data.skillGroups.reduce((total, group) => total + group.items.length, 0)} skills; ` +
        `${characters} chars extractable)`
    );

    return { pdf, data, filename: atsResumeFilename(data.name) };
}

/** Buffer-only form, for callers that just stream the file back. */
async function generateAtsResumePdf(options) {
    const { pdf } = await generateAtsResume(options);
    return pdf;
}

/** A filesystem-safe attachment name derived from the candidate's own name. */
function atsResumeFilename(name = "resume") {
    const slug = String(name).trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return `${slug || "Candidate"}_ATS_Resume.pdf`;
}

module.exports = {
    generateAtsResume,
    generateAtsResumePdf,
    buildAtsResumeData,
    renderAtsHtml,
    sanitizeAtsResumeData,
    assertAtsParseable,
    atsResumeFilename
};
