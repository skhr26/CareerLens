const cheerio = require("cheerio");
const axios = require("axios");
const { launchBrowser } = require("./browser.service");

const DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/**
 * Only heavy media is blocked. Stylesheets MUST be allowed through:
 * aborting them makes Naukri serve a ~2 KB stub instead of the ~400 KB results
 * page, which is what previously made the Naukri scraper return zero jobs.
 */
const BLOCKED_ASSETS = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";

const NAV_TIMEOUT = 45000;
const SELECTOR_TIMEOUT = 25000;

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function slugify(text) {
    return String(text || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Text extraction that keeps element boundaries as spaces.
 *
 * Wellfound renders a "3 – 5 years of exp" range as separate DOM nodes, so plain
 * `.text()` concatenates the digits into "35 years of exp". Joining on boundaries
 * keeps the two numbers apart so the range can be read back correctly.
 */
function spacedText($, el) {
    return clean(
        $(el)
            .find("*")
            .addBack()
            .contents()
            .filter((_, node) => node.type === "text")
            .map((_, node) => $(node).text())
            .get()
            .join(" ")
    );
}

function titleCaseSlug(slug) {
    return String(slug || "")
        .replace(/-/g, " ")
        .replace(/\b[a-z]/g, char => char.toUpperCase())
        .trim();
}

/**
 * Age of a posting in days, or null when the source did not say.
 * Accepts ISO dates (LinkedIn), "3 days ago" (Naukri/Wellfound) and epoch seconds.
 */
function parsePostedAgeDays(postedAt) {
    if (!postedAt) return null;
    const value = clean(postedAt).toLowerCase();

    if (/^(just now|today|few hours ago|a few hours ago)$/.test(value)) return 0;
    if (value === "yesterday") return 1;

    const relative = value.match(/(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s+ago/);
    if (relative) {
        const amount = Number(relative[1]);
        const perUnit = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
        return Math.round(amount * perUnit[relative[2]]);
    }

    const parsed = new Date(postedAt);
    if (!Number.isNaN(parsed.getTime())) {
        return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 86400000));
    }
    return null;
}

/** Postings older than this are almost always filled; they only add noise. */
const MAX_POSTING_AGE_DAYS = 365;

/**
 * Strips tracking params so the same posting seen twice compares equal.
 *
 * Indeed is the exception: it carries the job id in `?jk=` rather than in the path,
 * so blanking the query string would collapse every Indeed posting onto
 * `https://in.indeed.com/m/viewjob` and let dedupe merge them into one card.
 * Only `jk` is kept — the `bb` param is a per-session tracking token.
 */
function canonicalUrl(rawUrl) {
    const value = clean(rawUrl);
    if (!value) return null;
    try {
        const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
        const jobKey = /indeed\./i.test(parsed.hostname) ? parsed.searchParams.get("jk") : null;

        parsed.search = jobKey ? `?jk=${jobKey}` : "";
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return null;
    }
}

/**
 * A link is only kept if it points at one specific posting.
 * Search pages, signup pages and company homepages are rejected rather than
 * dressed up as a job — a dead "Apply" link is worse than an absent one.
 */
function isRealJobPostingUrl(rawUrl) {
    const url = canonicalUrl(rawUrl);
    if (!url) return false;
    if (/\/(login|signup|register|authwall)/i.test(url)) return false;
    if (/[?&]keywords=|[?&]q=/i.test(rawUrl || "")) return false;

    return (
        /naukri\.com\/job-listings-/i.test(url) ||
        /linkedin\.com\/jobs\/view\/[^/]+/i.test(url) ||
        /wellfound\.com\/jobs\/\d+-/i.test(url) ||
        /wellfound\.com\/company\/[^/]+\/jobs\/\d+-/i.test(url) ||
        // Indeed identifies a posting by `jk`, not by path. `/m/viewjob` is used
        // deliberately: plain `/viewjob?jk=` answers 401 and redirects to a login page,
        // while the mobile route serves the real posting to a signed-out visitor.
        /indeed\.[a-z.]+\/m\/viewjob\?jk=[a-z0-9]+/i.test(url)
    );
}

/**
 * Absolutises a scraped href and returns null when it is not a real posting.
 * Callers surface "link unavailable" for null instead of inventing a search URL.
 */
function normalizeJobLink(rawLink, platform = "Naukri.com") {
    let link = clean(rawLink);
    if (!link) return null;

    if (link.startsWith("//")) link = `https:${link}`;

    if (link.startsWith("/")) {
        const origin =
            platform === "LinkedIn" ? "https://www.linkedin.com"
            : platform === "Wellfound" ? "https://wellfound.com"
            : platform === "Indeed" ? "https://in.indeed.com"
            : "https://www.naukri.com";
        link = origin + link;
    }

    if (!/^https?:\/\//i.test(link)) link = `https://${link}`;

    return isRealJobPostingUrl(link) ? canonicalUrl(link) : null;
}

const STOP_WORDS = new Set([
    "the", "and", "for", "with", "job", "jobs", "role", "roles", "developer",
    "engineer", "senior", "junior", "lead", "staff", "years", "experience"
]);

function tokenize(text) {
    return clean(text)
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Keeps a listing only when its title genuinely relates to what the candidate
 * searched for. Without this, Wellfound's unfiltered feed returns things like
 * "Community Manager" for a full-stack search.
 */
function isRelevantTitle(title, query, skills = []) {
    const titleTokens = new Set(tokenize(title));
    if (!titleTokens.size) return false;

    const queryTokens = tokenize(query);
    if (queryTokens.some(token => titleTokens.has(token))) return true;

    // "developer"/"engineer" are stop-worded above, so match them explicitly:
    // a plain "Engineer" title is still a valid hit for an engineering search.
    const roleWords = /(developer|engineer|programmer|architect|sde|full.?stack|frontend|backend|data|devops|analyst|designer|scientist)/i;
    if (roleWords.test(title) && roleWords.test(query)) return true;

    return skills.some(skill => {
        const skillTokens = tokenize(skill);
        return skillTokens.length > 0 && skillTokens.every(token => titleTokens.has(token));
    });
}

/**
 * Boards title the same posting differently depending on where it appears. LinkedIn
 * appends the city ("Full Stack Development Internship in Noida") and companies
 * routinely post one role once per office, which is how two identical cards for the
 * same job reached the results page differing only in their location column.
 */
const TITLE_LOCATION_SUFFIX = /\s+in\s+([A-Za-z\s,.'()\-]+)$/i;
// "Software Engineer in Test" is a role, not a place. Stripping these would merge
// genuinely different postings at the same company.
const NOT_A_LOCATION = /^(test|testing|training|progress|residence|charge)\b/i;

function normalizeTitleForIdentity(title) {
    const value = clean(title);
    const match = value.match(TITLE_LOCATION_SUFFIX);
    if (!match || NOT_A_LOCATION.test(clean(match[1]))) return value;

    const stripped = value.slice(0, match.index).trim();
    return stripped.length >= 3 ? stripped : value;
}

/** Identity of a posting, independent of which board published it or under which URL. */
function postingIdentity(job) {
    return `${slugify(normalizeTitleForIdentity(job.title))}::${slugify(job.company)}`;
}

/** How much this copy of a posting actually published — used to pick the richer of two. */
function fieldRichness(job) {
    const filled = [job.description, job.salary, job.experience, job.location, job.postedAt, job.employmentType]
        .filter(Boolean).length;
    return filled + (job.skills ? job.skills.length : 0);
}

const MAX_MERGED_LOCATIONS = 3;

function addLocation(list, value) {
    const next = clean(value);
    if (!next) return;

    const lower = next.toLowerCase();
    // "Bengaluru" and "Bengaluru, Karnataka" are one office, not two.
    const alreadyCovered = list.some(item => {
        const existing = item.toLowerCase();
        return existing === lower || existing.includes(lower) || lower.includes(existing);
    });
    if (!alreadyCovered) list.push(next);
}

function formatLocations(list) {
    if (!list.length) return null;
    if (list.length <= MAX_MERGED_LOCATIONS) return list.join(", ");
    return `${list.slice(0, MAX_MERGED_LOCATIONS).join(", ")} +${list.length - MAX_MERGED_LOCATIONS} more`;
}

/**
 * postedAt and ageDays are two views of one fact, so they have to travel together.
 * Taking one copy's date alongside another's age would misreport freshness.
 */
function pickFresher(a, b) {
    const ageOf = job => (Number.isFinite(job.ageDays) ? job.ageDays : Number.MAX_SAFE_INTEGER);
    const source = ageOf(a) <= ageOf(b) ? a : b;
    return {
        postedAt: source.postedAt || null,
        ageDays: Number.isFinite(source.ageDays) ? source.ageDays : null
    };
}

/**
 * Collapses every copy of a posting into one card.
 *
 * This used to key on `job.link` first, so the same role advertised under two URLs —
 * one per city, or once per board — survived as separate results that looked
 * identical to the user. Copies are now merged rather than dropped: the richest row
 * wins, its locations are unioned, and the other boards it appeared on are recorded.
 */
function dedupeJobs(jobs) {
    const byIdentity = new Map();

    for (const job of jobs) {
        const key = postingIdentity(job);
        const existing = byIdentity.get(key);

        if (!existing) {
            const locations = [];
            addLocation(locations, job.location);
            byIdentity.set(key, {
                job,
                locations,
                platforms: new Set([job.platform]),
                skills: new Set(job.skills || [])
            });
            continue;
        }

        existing.platforms.add(job.platform);
        for (const skill of job.skills || []) existing.skills.add(skill);
        addLocation(existing.locations, job.location);

        // Prefer the copy carrying a real description — without one the matcher is
        // scoring on a job title alone.
        const challengerWins =
            (Boolean(job.description) && !existing.job.description) ||
            (Boolean(job.description) === Boolean(existing.job.description) &&
                fieldRichness(job) > fieldRichness(existing.job));

        const winner = challengerWins ? job : existing.job;
        const loser = challengerWins ? existing.job : job;
        const fresher = pickFresher(winner, loser);

        existing.job = {
            ...loser,
            ...winner,
            // Spreading alone would let the winner's nulls overwrite the loser's real values.
            description: winner.description || loser.description,
            salary: winner.salary || loser.salary,
            experience: winner.experience || loser.experience,
            employmentType: winner.employmentType || loser.employmentType,
            postedAt: fresher.postedAt,
            ageDays: fresher.ageDays
        };
    }

    return [...byIdentity.values()].map(entry => ({
        ...entry.job,
        location: formatLocations(entry.locations) || entry.job.location,
        skills: [...entry.skills],
        // Lets a merged card say "also on LinkedIn" instead of looking like a
        // posting we quietly discarded.
        alsoOn: [...entry.platforms].filter(name => name !== entry.job.platform)
    }));
}

async function newScrapeContext(browser, extraHeaders = {}) {
    const context = await browser.newContext({
        userAgent: DESKTOP_UA,
        viewport: { width: 1440, height: 900 },
        locale: "en-US",
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9", ...extraHeaders }
    });
    await context.route(BLOCKED_ASSETS, route => route.abort());
    return context;
}

/* ------------------------------------------------------------------ *
 * Naukri
 * ------------------------------------------------------------------ */

/**
 * Naukri actively rate-limits scrapers: after a burst of requests it serves a
 * ~300 byte "Access Denied" page with HTTP 403 for every URL, including its
 * homepage. That has to be reported rather than swallowed, or the app claims the
 * candidate has no matches when it was simply blocked.
 */
async function scrapeJobsFromNaukri(browser, query = "software developer", { pages = 2 } = {}) {
    const context = await newScrapeContext(browser);
    const jobs = [];
    let blocked = false;

    try {
        const role = slugify(query) || "software-developer";

        for (let pageNo = 1; pageNo <= pages; pageNo++) {
            const url = pageNo === 1
                ? `https://www.naukri.com/${role}-jobs`
                : `https://www.naukri.com/${role}-jobs-${pageNo}`;

            const page = await context.newPage();
            try {
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
                const status = response ? response.status() : 0;

                if (status === 403 || status === 429) {
                    blocked = true;
                    console.warn(`[naukri] blocked with HTTP ${status} — skipping Naukri for this search`);
                    break;
                }

                const ready = await page
                    .waitForSelector(".cust-job-tuple", { timeout: SELECTOR_TIMEOUT })
                    .then(() => true)
                    .catch(() => false);

                if (!ready) {
                    if (/access denied|unusual traffic|are you a robot/i.test(await page.content())) {
                        blocked = true;
                        console.warn("[naukri] blocked by bot protection — skipping Naukri for this search");
                    } else {
                        console.warn(`[naukri] no job cards rendered on page ${pageNo} (${url})`);
                    }
                    break;
                }

                const $ = cheerio.load(await page.content());

                // Only `.cust-job-tuple` — it and `.srp-jobtuple-wrapper` wrap the
                // same card, so matching both yielded every job twice.
                $(".cust-job-tuple").each((_, el) => {
                    const $el = $(el);
                    const title = clean($el.find("a.title").first().text());
                    const company = clean($el.find("a.comp-name, .comp-name").first().text());
                    const link = normalizeJobLink($el.find("a.title").first().attr("href"), "Naukri.com");

                    if (!title || !company || !link) return;

                    const skills = $el.find(".tag-li").map((__, tag) => clean($(tag).text())).get().filter(Boolean);
                    const postedAt = clean($el.find(".job-post-day").first().text()) || null;

                    jobs.push({
                        platform: "Naukri.com",
                        title,
                        company,
                        location: clean($el.find(".locWdth, span.loc").first().text()) || null,
                        experience: clean($el.find(".expwdth, span.exp").first().text()) || null,
                        salary: clean($el.find(".sal-wrap span, .sal, .salary").first().text()) || null,
                        description: clean($el.find(".job-desc").first().text()) || null,
                        skills,
                        employmentType: null,
                        postedAt,
                        ageDays: parsePostedAgeDays(postedAt),
                        link
                    });
                });

                // Pace the requests — back-to-back loads are what trips the block.
                if (pageNo < pages) await page.waitForTimeout(1200);
            } finally {
                if (!page.isClosed()) await page.close();
            }
        }

        // As with Indeed: report a block only when it cost us everything. Naukri
        // rate-limits mid-run, and page 1's postings are still real postings.
        if (blocked && !jobs.length) {
            const error = new Error("Naukri blocked the request (bot protection)");
            error.blocked = true;
            throw error;
        }

        return dedupeJobs(jobs);
    } catch (error) {
        if (error.blocked) throw error;
        // Partial results are worth keeping; nothing at all is not — see the note in
        // scrapeJobsFromIndeed. An empty array reads to the user as "no matches".
        if (!jobs.length) throw error;
        console.error("[naukri] scrape failed:", error.message);
        return dedupeJobs(jobs);
    } finally {
        await context.close();
    }
}

/* ------------------------------------------------------------------ *
 * LinkedIn
 * ------------------------------------------------------------------ */

/**
 * Uses LinkedIn's public guest endpoint rather than the /jobs/search/ page.
 * It returns a bare list of cards (~28 KB vs ~360 KB), is not behind the auth
 * wall, exposes a stable posting id, and pages cleanly via `start`.
 */
async function scrapeJobsFromLinkedIn(browser, query = "software developer", { location = "India", pages = 3 } = {}) {
    const context = await newScrapeContext(browser, { Referer: "https://www.linkedin.com/jobs" });
    const jobs = [];

    try {
        for (let pageNo = 0; pageNo < pages; pageNo++) {
            const url =
                "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search" +
                `?keywords=${encodeURIComponent(query)}` +
                `&location=${encodeURIComponent(location)}` +
                `&start=${pageNo * 10}`;

            const page = await context.newPage();
            try {
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

                if (!response || !response.ok()) {
                    console.warn(`[linkedin] guest endpoint returned ${response ? response.status() : "no response"} at start=${pageNo * 10}`);
                    await page.close();
                    break;
                }

                const $ = cheerio.load(await page.content());
                const cards = $("li");
                if (!cards.length) break;

                cards.each((_, el) => {
                    const $el = $(el);
                    const title = clean($el.find(".base-search-card__title").first().text());
                    const company = clean($el.find(".base-search-card__subtitle").first().text());
                    const link = normalizeJobLink($el.find("a.base-card__full-link").first().attr("href"), "LinkedIn");

                    if (!title || !company || !link) return;

                    const postedAt = $el.find("time").first().attr("datetime") || null;

                    jobs.push({
                        platform: "LinkedIn",
                        title,
                        company,
                        location: clean($el.find(".job-search-card__location").first().text()) || null,
                        experience: null, // Not published on the guest card — left blank rather than guessed.
                        salary: clean($el.find(".job-search-card__salary-info").first().text()) || null,
                        description: null,
                        skills: [],
                        // Filled in by the detail pass below, where LinkedIn publishes it.
                        employmentType: null,
                        postedAt,
                        ageDays: parsePostedAgeDays(postedAt),
                        link
                    });
                });
            } finally {
                if (!page.isClosed()) await page.close();
            }
        }

        return dedupeJobs(jobs);
    } catch (error) {
        if (!jobs.length) throw error;
        console.error("[linkedin] scrape failed:", error.message);
        return dedupeJobs(jobs);
    } finally {
        await context.close();
    }
}

/* ------------------------------------------------------------------ *
 * LinkedIn posting detail (guest endpoint, no auth)
 * ------------------------------------------------------------------ */

const LINKEDIN_DETAIL_CONCURRENCY = 5;
const MAX_DESCRIPTION_CHARS = 1500;

/**
 * The guest search card carries no description and no experience level, so both used
 * to come back null for every LinkedIn result — which left the matcher scoring on a
 * job title alone. This companion guest endpoint publishes the real posting body and
 * LinkedIn's own criteria list, unauthenticated.
 */
async function fetchLinkedInDetail(job) {
    const idMatch = String(job.link || "").match(/\/jobs\/view\/(?:[^/?]*-)?(\d+)/);
    if (!idMatch) return job;

    try {
        const response = await axios.get(
            `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${idMatch[1]}`,
            { headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" }, timeout: 12000 }
        );

        const $ = cheerio.load(response.data);

        const description = clean(
            $(".show-more-less-html__markup, .description__text").first().text()
        )
            // "Show more Show less" is the expander's own label, not posting content.
            .replace(/\s*Show more\s*Show less\s*$/i, "")
            .slice(0, MAX_DESCRIPTION_CHARS) || null;

        // LinkedIn's own criteria table — read, never inferred.
        const criteria = {};
        $(".description__job-criteria-item").each((_, el) => {
            const key = clean($(el).find(".description__job-criteria-subheader").text()).toLowerCase();
            const value = clean($(el).find(".description__job-criteria-text").text());
            if (key && value) criteria[key] = value;
        });

        const seniority = criteria["seniority level"];
        const employmentType = criteria["employment type"];

        return {
            ...job,
            description: description || job.description,
            // "Not Applicable" is LinkedIn's way of saying unspecified.
            experience: seniority && !/not applicable/i.test(seniority) ? seniority : job.experience,
            // LinkedIn's own "Employment type" row. This is the only authoritative
            // internship signal any of these boards publishes — their internship
            // *filters* are ignored server-side (f_E=1 returns senior roles).
            employmentType: employmentType || job.employmentType || null
        };
    } catch (error) {
        // Enrichment is best-effort; a failure keeps the posting with its list-view facts.
        return job;
    }
}

/** Enriches postings in small concurrent batches so one search does not hammer the endpoint. */
async function enrichLinkedInJobs(jobs) {
    const targets = jobs.filter(job => job.platform === "LinkedIn");
    if (!targets.length) return jobs;

    const detailByLink = new Map();
    for (let index = 0; index < targets.length; index += LINKEDIN_DETAIL_CONCURRENCY) {
        const batch = targets.slice(index, index + LINKEDIN_DETAIL_CONCURRENCY);
        const results = await Promise.all(batch.map(fetchLinkedInDetail));
        for (const job of results) detailByLink.set(job.link, job);
    }

    const enriched = jobs.map(job => detailByLink.get(job.link) || job);
    const withDescription = enriched.filter(job => job.platform === "LinkedIn" && job.description).length;
    console.log(`[linkedin] enriched ${withDescription}/${targets.length} postings with real descriptions`);

    return enriched;
}

/* ------------------------------------------------------------------ *
 * Wellfound
 * ------------------------------------------------------------------ */

const SALARY_PATTERN = /[$₹€£]\s?[\d,.]+\s?[kKlLmM]?(?:\s?[–—-]\s?[$₹€£]?\s?[\d,.]+\s?[kKlLmM]?)?/;
const POSTED_PATTERN = /(\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago|today|yesterday)/i;
// Wellfound publishes a single minimum, never a range. The digits before it can be the
// location overflow count ("• Delhi + 2 3 years of exp"), so match the number adjacent
// to "years" only — an earlier two-number pattern read that count as a range bound and
// invented values like "2-3", "3-2" and "1-0 years of exp".
const EXPERIENCE_PATTERN = /(\d+)\+?\s*(years?)\s+of\s+exp/i;
const LOCATION_PATTERN = /((?:Remote only|Remote|Onsite or remote|In office|Onsite|Hybrid)(?:\s*•\s*[A-Za-z ,.'()\-]+)?)/i;
// "• Bangalore Urban + 1" means one further location, not part of the city name.
const LOCATION_OVERFLOW_PATTERN = /•[^•]*?\+\s*(\d+)\s/;

/** Markers that prove an ancestor row carries the job's detail line, not just its title. */
const ROW_DETAIL_PATTERN = /[$₹€£]|Remote|In office|Onsite|Hybrid|years? of exp|ago|equity/i;

function parseWellfoundExperience(rowText) {
    const match = rowText.match(EXPERIENCE_PATTERN);
    // Keep the source's own singular/plural ("1 year of exp", not "1 years of exp").
    return match ? `${match[1]} ${match[2].toLowerCase()} of exp` : null;
}

function parseWellfoundLocation(rowText) {
    const match = rowText.match(LOCATION_PATTERN);
    if (!match) return null;

    const base = clean(match[1]).replace(/[•|,]\s*$/, "").trim();
    if (!base) return null;

    const overflow = rowText.match(LOCATION_OVERFLOW_PATTERN);
    return overflow ? `${base} +${overflow[1]} more` : base;
}

/**
 * Wellfound renders each startup as a card holding an `a[href^="/company/"]`
 * plus one row per open role. Company is read off that card instead of being
 * hardcoded (it used to be stamped "Innovative AI Startup" for every result).
 */
function parseWellfoundCards($, query, skills) {
    const jobs = [];

    $("a[href]").each((_, anchor) => {
        const $anchor = $(anchor);
        const href = $anchor.attr("href") || "";
        if (!/^\/jobs\/\d+-/.test(href) && !/^https?:\/\/wellfound\.com\/jobs\/\d+-/.test(href)) return;

        const title = clean($anchor.text());
        const link = normalizeJobLink(href, "Wellfound");
        if (!title || !link) return;
        if (!isRelevantTitle(title, query, skills)) return;

        // Walk up to the ancestor that carries the detail line. Stopping at the
        // first ancestor merely longer than the title lands on "<title>Full-time",
        // which is why pay and experience came back empty.
        let $row = $anchor.parent();
        for (let depth = 0; depth < 4 && $row.length; depth++) {
            if (ROW_DETAIL_PATTERN.test(clean($row.text()))) break;
            $row = $row.parent();
        }
        const rowText = spacedText($, $row);

        // Walk further up to the startup card that owns the company link.
        let $card = $row;
        let companyHref = "";
        for (let depth = 0; depth < 6 && $card.length; depth++) {
            const $companyLink = $card.find("a[href^='/company/']").first();
            if ($companyLink.length) {
                companyHref = $companyLink.attr("href") || "";
                break;
            }
            $card = $card.parent();
        }
        if (!companyHref) return;

        // The card's text opens with the startup name, before its "Actively Hiring" badge.
        const cardText = clean($card.text());
        let company = cardText.split(/Actively Hiring|\d+-\d+ Employees/)[0].trim();
        if (!company || company.length > 60) {
            company = titleCaseSlug(companyHref.replace("/company/", ""));
        }
        if (!company) return;

        const salaryMatch = rowText.match(SALARY_PATTERN);
        const postedMatch = rowText.match(POSTED_PATTERN);
        const postedAt = postedMatch ? clean(postedMatch[1]) : null;

        jobs.push({
            platform: "Wellfound",
            title,
            company,
            location: parseWellfoundLocation(rowText),
            experience: parseWellfoundExperience(rowText),
            salary: salaryMatch ? clean(salaryMatch[0]) : null,
            description: null,
            skills: [],
            employmentType: null,
            postedAt,
            ageDays: parsePostedAgeDays(postedAt),
            link
        });
    });

    return jobs;
}

async function scrapeJobsFromWellfound(browser, query = "software developer", { skills = [] } = {}) {
    const context = await newScrapeContext(browser);
    let jobs = [];

    try {
        // `/role/r/<slug>` actually filters by role; `/jobs?q=` returns an
        // unfiltered trending feed, so it is only a fallback.
        const candidateUrls = [
            `https://wellfound.com/role/r/${slugify(query)}`,
            `https://wellfound.com/jobs?q=${encodeURIComponent(query)}`
        ];

        for (const url of candidateUrls) {
            const page = await context.newPage();
            try {
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
                if (!response || response.status() >= 400) {
                    await page.close();
                    continue;
                }

                await page
                    .waitForSelector("a[href^='/jobs/']", { timeout: SELECTOR_TIMEOUT })
                    .catch(() => null);
                await page.waitForTimeout(1500); // let the React list settle

                const $ = cheerio.load(await page.content());
                jobs = parseWellfoundCards($, query, skills);
            } finally {
                if (!page.isClosed()) await page.close();
            }

            if (jobs.length) break;
        }

        if (!jobs.length) console.warn("[wellfound] no relevant postings extracted");
        return dedupeJobs(jobs);
    } catch (error) {
        if (!jobs.length) throw error;
        console.error("[wellfound] scrape failed:", error.message);
        return dedupeJobs(jobs);
    } finally {
        await context.close();
    }
}

/* ------------------------------------------------------------------ *
 * Indeed
 * ------------------------------------------------------------------ */

// Indeed tags pay and job type with the same `attribute_snippet_testid` prefix and in
// no guaranteed order, so each is recognised by what it says rather than by position.
const INDEED_PAY = /(₹|\$|£|€)|\b(lpa|per\s+(?:hour|day|week|month|year)|a\s+(?:hour|day|week|month|year))\b/i;
const INDEED_JOB_TYPE = /\b(full[\s-]?time|part[\s-]?time|internship|contract|permanent|temporary|freelance|apprenticeship|fresher)\b/i;

/**
 * Indeed refuses plain HTTP outright (403 "Security Check"), so this has to go
 * through the real browser like Naukri does.
 *
 * Two things about its links matter. The card's own href is
 * `/rc/clk?jk=<id>&bb=<session-token>` — a click tracker that is not stable across
 * sessions — so the posting URL is rebuilt from `data-jk`. And that URL uses
 * `/m/viewjob`, not `/viewjob`: the desktop route answers 401 and bounces a
 * signed-out visitor to a login page, while the mobile route serves the posting.
 *
 * One page only, and that is not a shortcut. Indeed does not serve pagination to a
 * signed-out visitor: `start=10` came back either 403 or 200-with-zero-cards on every
 * attempt, including as the first request of a fresh context and after a 10s pause,
 * while `start=0` requested twice in a row returned its full 16 cards both times. So
 * page 2 costs a request, yields nothing, and — before this was understood — tripped
 * the block detector that then threw page 1's results away.
 */
async function scrapeJobsFromIndeed(browser, query = "software developer", { pages = 1, location = "India" } = {}) {
    const context = await newScrapeContext(browser, { Referer: "https://in.indeed.com/" });
    const jobs = [];
    let blocked = false;

    try {
        for (let pageNo = 0; pageNo < pages; pageNo++) {
            const url =
                "https://in.indeed.com/jobs" +
                `?q=${encodeURIComponent(query)}` +
                `&l=${encodeURIComponent(location)}` +
                `&start=${pageNo * 10}`;

            const page = await context.newPage();
            try {
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
                const status = response ? response.status() : 0;

                if (status === 403 || status === 429) {
                    blocked = true;
                    console.warn(`[indeed] blocked with HTTP ${status} — skipping Indeed for this search`);
                    break;
                }

                const ready = await page
                    .waitForSelector("a.jcs-JobTitle", { timeout: SELECTOR_TIMEOUT })
                    .then(() => true)
                    .catch(() => false);

                if (!ready) {
                    if (/security check|just a moment|verifying you are human/i.test(await page.content())) {
                        blocked = true;
                        console.warn("[indeed] blocked by bot protection — skipping Indeed for this search");
                    } else {
                        console.warn(`[indeed] no job cards rendered on page ${pageNo + 1}`);
                    }
                    break;
                }

                const $ = cheerio.load(await page.content());

                $("a.jcs-JobTitle").each((_, el) => {
                    const $anchor = $(el);
                    const jobKey = clean($anchor.attr("data-jk"));
                    const title = clean($anchor.text());
                    if (!jobKey || !title) return;

                    const link = normalizeJobLink(`/m/viewjob?jk=${jobKey}`, "Indeed");
                    if (!link) return;

                    const $card = $anchor.closest("li, .job_seen_beacon, div.cardOutline");
                    const company = clean($card.find("[data-testid='company-name']").first().text());
                    if (!company) return;

                    // The snippet sits outside `.job_seen_beacon`, which is the nearest
                    // ancestor `closest()` returns above — so it needs the wider container.
                    const $outer = $anchor.closest("li, div.cardOutline");
                    const description = clean($outer.find("[data-testid='belowJobSnippet']").first().text());

                    // Pay and job type share the `attribute_snippet_testid` prefix and appear
                    // in no fixed order, so each one is identified by its content. Reading
                    // `.first()` as the salary stored "Full-time" as a pay range.
                    const attributes = $card
                        .find("[data-testid^='attribute_snippet_testid']")
                        .toArray()
                        .map(node => clean($(node).text()))
                        .filter(Boolean);

                    jobs.push({
                        platform: "Indeed",
                        title,
                        company,
                        location: clean($card.find("[data-testid='text-location']").first().text()) || null,
                        experience: null,
                        salary: attributes.find(value => INDEED_PAY.test(value)) || null,
                        // Short, but it is the posting's own words and it costs no extra
                        // request — which matters because Indeed's detail pages answer 403.
                        description: description ? description.slice(0, MAX_DESCRIPTION_CHARS) : null,
                        skills: [],
                        employmentType: attributes.find(value => INDEED_JOB_TYPE.test(value)) || null,
                        // Indeed's result cards carry no posting date at all. Left null so
                        // these sort last on the recency tiebreaker rather than being
                        // stamped with a date we invented.
                        postedAt: null,
                        ageDays: null,
                        link
                    });
                });

                if (pageNo < pages - 1) await page.waitForTimeout(1200);
            } finally {
                if (!page.isClosed()) await page.close();
            }
        }

        // Only a block that yielded nothing is worth reporting as a block. A later page
        // failing after an earlier one succeeded is Indeed refusing to paginate, not
        // Indeed refusing us — throwing there discarded a full page of real postings.
        if (blocked && !jobs.length) {
            const error = new Error("Indeed blocked the request (bot protection)");
            error.blocked = true;
            throw error;
        }

        // Indeed also throttles by serving a 200 with an empty results list, which would
        // otherwise be indistinguishable from "no such jobs exist" and disappear silently.
        if (!jobs.length) {
            throw new Error("Indeed returned no job cards — the results page came back empty");
        }

        if (blocked) {
            console.warn(`[indeed] kept ${jobs.length} postings from the pages that did answer`);
        }

        return dedupeJobs(jobs);
    } catch (error) {
        if (error.blocked) throw error;
        // Partial results are worth keeping; nothing at all is not. Returning [] here
        // would reach the user as "no jobs matched your profile", which is a different
        // claim from "Indeed did not answer".
        if (!jobs.length) throw error;
        console.error("[indeed] scrape failed:", error.message);
        return dedupeJobs(jobs);
    } finally {
        await context.close();
    }
}

/* ------------------------------------------------------------------ *
 * Indeed posting detail
 * ------------------------------------------------------------------ */

// Indeed 403s the second back-to-back detail request, so this pass is deliberately
// slow, serial and short. Whatever it manages to fetch is a bonus on top of the
// list-view facts; nothing depends on it succeeding.
const INDEED_DETAIL_LIMIT = 8;
const INDEED_DETAIL_DELAY_MS = 1500;
const INDEED_MAX_CONSECUTIVE_BLOCKS = 2;

/** Indeed's detail markup leaves literal `&nbsp;` entities and camel-joins adjacent labels. */
function normalizeIndeedText(text) {
    // clean() collapses non-breaking spaces already; the entity form has to be handled explicitly.
    return clean(String(text || "").replace(/&nbsp;/gi, " "));
}

function parseIndeedDetail(html) {
    const $ = cheerio.load(html);
    const raw = normalizeIndeedText($("#jobDescriptionText, [data-testid='jobDescriptionText']").first().text());
    if (!raw) return null;

    // The mobile route prepends its own "Job details" summary block. The posting body
    // starts after the "Full job description" heading.
    const bodyIndex = raw.search(/Full job description/i);
    const description = bodyIndex >= 0
        ? clean(raw.slice(bodyIndex + "Full job description".length))
        : raw;

    // "Job type Permanent Full-time" — Indeed's own field, read rather than inferred.
    const typeMatch = raw.match(/Job\s*type\s*(.*?)(?:\s*(?:Location|Shift|Schedule|Benefits|Pay|Full job description)\b|$)/i);
    const employmentType = typeMatch
        // "PermanentFull-time" -> "Permanent Full-time"
        ? clean(typeMatch[1].replace(/([a-z])([A-Z])/g, "$1 $2")).slice(0, 60) || null
        : null;

    const pageText = normalizeIndeedText($("body").text());
    const postedMatch = pageText.match(/(just posted|today|\d+\+?\s*(?:hour|day|week|month)s?\s+ago)/i);
    const postedAt = postedMatch ? clean(postedMatch[1]).replace(/just posted/i, "today") : null;

    return {
        description: description ? description.slice(0, MAX_DESCRIPTION_CHARS) : null,
        employmentType,
        postedAt,
        ageDays: parsePostedAgeDays(postedAt)
    };
}

async function enrichIndeedJobs(browser, jobs) {
    const targets = jobs.filter(job => job.platform === "Indeed").slice(0, INDEED_DETAIL_LIMIT);
    if (!targets.length) return jobs;

    const context = await newScrapeContext(browser, { Referer: "https://in.indeed.com/" });
    const detailByLink = new Map();
    let consecutiveBlocks = 0;

    try {
        for (const job of targets) {
            const page = await context.newPage();
            try {
                const response = await page.goto(job.link, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
                const status = response ? response.status() : 0;

                if (status === 403 || status === 429) {
                    if (++consecutiveBlocks >= INDEED_MAX_CONSECUTIVE_BLOCKS) {
                        console.warn("[indeed] detail endpoint rate-limited — stopping enrichment early");
                        break;
                    }
                    continue;
                }

                consecutiveBlocks = 0;
                const detail = parseIndeedDetail(await page.content());
                if (!detail) continue;

                detailByLink.set(job.link, {
                    ...job,
                    description: detail.description || job.description,
                    employmentType: detail.employmentType || job.employmentType,
                    postedAt: detail.postedAt || job.postedAt,
                    ageDays: Number.isFinite(detail.ageDays) ? detail.ageDays : job.ageDays
                });
            } catch (error) {
                // Best-effort: the posting keeps its list-view facts.
            } finally {
                if (!page.isClosed()) await page.close();
            }

            await new Promise(resolve => setTimeout(resolve, INDEED_DETAIL_DELAY_MS));
        }
    } finally {
        await context.close();
    }

    console.log(`[indeed] enriched ${detailByLink.size}/${targets.length} postings with real descriptions`);
    return jobs.map(job => detailByLink.get(job.link) || job);
}

/* ------------------------------------------------------------------ *
 * aggregator
 * ------------------------------------------------------------------ */

// `cooldownMs` is how long this board must be left alone after a pass finishes.
// Measured, not guessed: two Indeed searches 2.5s apart returned 200 with zero cards
// (and, on an earlier run, a flat 403), while the same two searches 8s apart returned
// 16 cards each. LinkedIn and Wellfound showed no such sensitivity, so they only need
// the queue, not the wait.
const PROVIDERS = [
    { name: "LinkedIn", cooldownMs: 0, run: (browser, label) => scrapeJobsFromLinkedIn(browser, label) },
    { name: "Wellfound", cooldownMs: 0, run: (browser, label, skills) => scrapeJobsFromWellfound(browser, label, { skills }) },
    { name: "Indeed", cooldownMs: 6000, run: (browser, label) => scrapeJobsFromIndeed(browser, label) }
];

const PROVIDER_NAMES = PROVIDERS.map(provider => provider.name).join(", ");

/**
 * Serializes one board's work, so the job pass and the internship pass never hit the
 * same host at once — they still overlap across *different* hosts, which is where the
 * time saving actually comes from.
 */
function createProviderGate(cooldownMs = 0) {
    let tail = Promise.resolve();
    return function gate(task) {
        const started = tail.then(task);
        // The chain must absorb a rejection, or one blocked pass strands every pass
        // queued behind it on a promise that never settles.
        tail = started
            .catch(() => null)
            .then(() => (cooldownMs ? new Promise(resolve => setTimeout(resolve, cooldownMs)) : undefined));
        return started;
    };
}

/**
 * Gates are per search, not per process: two passes of one search must not double up
 * on a board, but making one user's search queue behind another's would trade a
 * scrape failure for a much worse wait.
 */
function createProviderGates() {
    return new Map(PROVIDERS.map(provider => [provider.name, createProviderGate(provider.cooldownMs)]));
}

/**
 * One search pass across every provider, interleaved so no single board can crowd
 * the others out.
 *
 * Counts accumulate into the shared `diagnostics`, so a caller running two passes
 * still reports one honest set of totals and one list of boards that blocked us.
 */
async function runProviderPass(browser, label, coreSkills, perPlatform, diagnostics, gates = createProviderGates()) {
    const settled = await Promise.allSettled(
        PROVIDERS.map(provider =>
            gates.get(provider.name)(() => provider.run(browser, label, coreSkills))
        )
    );

    const collected = [];

    settled.forEach((result, index) => {
        const name = PROVIDERS[index].name;
        const alreadyFound = diagnostics.platforms[name] || 0;

        if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
            diagnostics.platforms[name] = alreadyFound;
            const reason = result.reason ? result.reason.message : "unknown error";
            if (result.reason && result.reason.blocked && !diagnostics.blocked.includes(name)) {
                diagnostics.blocked.push(name);
            }
            diagnostics.errors.push(`${name}: ${reason}`);
            return;
        }

        // Year-old listings are almost always filled; they pushed live roles down the page.
        const fresh = result.value.filter(job => {
            const tooOld = Number.isFinite(job.ageDays) && job.ageDays > MAX_POSTING_AGE_DAYS;
            if (tooOld) diagnostics.staleDropped = (diagnostics.staleDropped || 0) + 1;
            return !tooOld;
        });

        diagnostics.platforms[name] = alreadyFound + fresh.length;
        collected.push(fresh.slice(0, perPlatform));
    });

    const jobs = [];
    const depth = Math.max(0, ...collected.map(list => list.length));
    for (let i = 0; i < depth; i++) {
        for (const list of collected) {
            if (list[i]) jobs.push(list[i]);
        }
    }
    return jobs;
}

/** Fills in descriptions from each board's own detail page. Best-effort throughout. */
async function enrichPostings(browser, jobs) {
    const withLinkedIn = await enrichLinkedInJobs(jobs);
    return enrichIndeedJobs(browser, withLinkedIn);
}

function logPassSummary(count, diagnostics) {
    console.log(
        `[scraper] ${count} unique postings ` +
        `(${Object.entries(diagnostics.platforms).map(([k, v]) => `${k}:${v}`).join(", ")})` +
        (diagnostics.blocked.length ? ` | blocked: ${diagnostics.blocked.join(", ")}` : "") +
        (diagnostics.staleDropped ? ` | ${diagnostics.staleDropped} stale dropped` : "")
    );
}

/* ------------------------------------------------------------------ *
 * jobs vs internships
 * ------------------------------------------------------------------ */

const INTERNSHIP_TITLE = /\b(intern|interns|internship|internships|trainee|apprentice|apprenticeship)\b/i;
// The internship keyword pass also returns senior roles, and Indeed's own
// `jt=internship` filter surfaced a ₹20-40 LPA "Distinguished Full Stack Engineer".
// These words veto the internship label.
const SENIOR_TITLE = /\b(senior|sr|lead|principal|staff|architect|manager|head|director|distinguished|vp|chief)\b/i;

/**
 * Decides whether a posting is a job or an internship.
 *
 * Employment type can only promote a posting to "internship", never demote one:
 * internships are routinely listed as full-time, so a full-time tag is no evidence
 * against a posting that calls itself an internship.
 */
function classifyPosting(job) {
    if (/intern/i.test(clean(job.employmentType))) return "internship";

    const title = clean(job.title);
    if (!INTERNSHIP_TITLE.test(title)) return "job";

    return SENIOR_TITLE.test(title) ? "job" : "internship";
}

// Even with the per-provider gate, the two passes should not start in lockstep: the
// first pass gets a head start so each board is answering one search at a time.
const PASS_STAGGER_MS = 2500;

/**
 * Runs every provider against one browser instance.
 *
 * Returns `{ jobs, diagnostics }`. The diagnostics matter: when the browser cannot
 * launch or a site changes its markup, the caller can tell the user that scraping
 * broke instead of showing "no jobs match your profile".
 */
async function scrapeMultiPlatformJobs(query = "software developer", coreSkills = [], { perPlatform = 20 } = {}) {
    const label = clean(query) || "software developer";
    console.log(`[scraper] searching "${label}" across ${PROVIDER_NAMES}...`);

    const diagnostics = { browserOk: false, platforms: {}, blocked: [], errors: [] };
    let browser = null;

    try {
        browser = await launchBrowser();
        diagnostics.browserOk = true;
    } catch (error) {
        diagnostics.errors.push(error.message);
        console.error("[scraper] browser unavailable:", error.message);
        return { jobs: [], diagnostics };
    }

    try {
        const found = await runProviderPass(browser, label, coreSkills, perPlatform, diagnostics);

        // Enrich only the postings that survived the cut, so we do not fetch detail
        // pages for results the caller will never see.
        const enriched = await enrichPostings(browser, dedupeJobs(found));

        logPassSummary(enriched.length, diagnostics);
        return { jobs: enriched, diagnostics };
    } catch (error) {
        diagnostics.errors.push(error.message);
        console.error("[scraper] aggregation failed:", error.message);
        return { jobs: [], diagnostics };
    } finally {
        if (browser) await browser.close().catch(() => null);
    }
}

/**
 * Finds jobs across multiple platforms.
 *
 * Runs a single scraping pass and classifies all results as jobs.
 */
async function scrapeJobsAndInternships(
    query = "software developer",
    coreSkills = [],
    { perPlatform = 20 } = {}
) {
    const label = clean(query) || "software developer";
    console.log(`[scraper] searching "${label}" across ${PROVIDER_NAMES}...`);

    const diagnostics = { browserOk: false, platforms: {}, blocked: [], errors: [] };
    let browser = null;

    try {
        browser = await launchBrowser();
        diagnostics.browserOk = true;
    } catch (error) {
        diagnostics.errors.push(error.message);
        console.error("[scraper] browser unavailable:", error.message);
        return { jobs: [], internships: [], diagnostics };
    }

    try {
        const jobPass = await runProviderPass(
            browser, label, coreSkills, perPlatform, diagnostics, createProviderGates()
        );
        const enriched = await enrichPostings(browser, dedupeJobs(jobPass));
        const jobs = enriched
            .filter(posting => classifyPosting(posting) === "job")
            .map(posting => ({ ...posting, kind: "job" }));

        logPassSummary(enriched.length, diagnostics);
        console.log(`[scraper] kept ${jobs.length} jobs`);

        return { jobs, internships: [], diagnostics };
    } catch (error) {
        diagnostics.errors.push(error.message);
        console.error("[scraper] aggregation failed:", error.message);
        return { jobs: [], internships: [], diagnostics };
    } finally {
        if (browser) await browser.close().catch(() => null);
    }
}

module.exports = {
    normalizeJobLink,
    isRealJobPostingUrl,
    isRelevantTitle,
    parsePostedAgeDays,
    dedupeJobs,
    postingIdentity,
    classifyPosting,
    scrapeJobsFromNaukri,
    scrapeJobsFromLinkedIn,
    scrapeJobsFromWellfound,
    scrapeJobsFromIndeed,
    scrapeMultiPlatformJobs,
    scrapeJobsAndInternships
};
