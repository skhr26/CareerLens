const { chromium } = require("playwright");

/**
 * Chromium bootstrap for the scrapers.
 *
 * Playwright ships without a browser binary — it has to be downloaded by
 * `npx playwright install chromium`. When that step is missing, `chromium.launch()`
 * throws immediately ("Executable doesn't exist at ...") and every scraper silently
 * returns an empty list, which looks exactly like "no jobs found".
 *
 * Puppeteer, which is also a dependency, downloads its Chrome build automatically on
 * `npm install`. So if Playwright's own binary is absent we drive Puppeteer's Chrome
 * through Playwright instead of failing the whole request.
 */

const LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled"
];

let cachedExecutablePath;

async function resolvePuppeteerChrome() {
    if (cachedExecutablePath !== undefined) return cachedExecutablePath;
    try {
        const puppeteer = require("puppeteer");
        // executablePath() is a promise in Puppeteer v23+, a string before that.
        cachedExecutablePath = (await puppeteer.executablePath()) || null;
    } catch (err) {
        console.warn("[browser] Could not resolve Puppeteer's Chrome path:", err.message);
        cachedExecutablePath = null;
    }
    return cachedExecutablePath;
}

/**
 * Launches Chromium, falling back to Puppeteer's bundled Chrome.
 * Throws a message that names the actual remedy instead of returning nothing.
 */
async function launchBrowser() {
    try {
        return await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    } catch (primaryError) {
        const executablePath = await resolvePuppeteerChrome();

        if (executablePath) {
            try {
                const fs = require("fs");
                if (!fs.existsSync(executablePath)) {
                    throw new Error(`Puppeteer Chrome binary not found at: ${executablePath}`);
                }

                const browser = await chromium.launch({ headless: true, executablePath, args: LAUNCH_ARGS });
                console.warn(
                    "[browser] Playwright's Chromium is not installed; using Puppeteer's Chrome instead.\n" +
                    "          Run `npm run install:browsers` to install the Playwright build."
                );
                return browser;
            } catch (fallbackError) {
                throw new Error(
                    `No usable Chromium found. Playwright: ${primaryError.message.split("\n")[0]}. ` +
                    `Puppeteer fallback: ${fallbackError.message.split("\n")[0]}. ` +
                    "Fix with: npm run install:browsers"
                );
            }
        }

        throw new Error(
            `No usable Chromium found. ${primaryError.message.split("\n")[0]}. ` +
            "Fix with: npm run install:browsers"
        );
    }
}

module.exports = { launchBrowser };
