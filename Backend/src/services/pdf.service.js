const puppeteer = require("puppeteer");

/**
 * Renders an HTML string to an A4 PDF.
 *
 * Lives in its own module so both the interview-report side and the ATS resume side
 * can render without importing each other.
 */
async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch();

    try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: "networkidle0" });

        // Puppeteer 25 returns a Uint8Array. Callers hand this to nodemailer and to
        // res.send(), both of which want a Buffer, so normalize it once here.
        const rendered = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }
        });

        return Buffer.from(rendered);
    } finally {
        await browser.close().catch(() => null);
    }
}

module.exports = { generatePdfFromHtml };
