require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const BLOCKED = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";

async function search(browser, label, q) {
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  await context.route(BLOCKED, r => r.abort());
  const page = await context.newPage();
  const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(q)}&l=India&start=0`;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = await page.content();
    console.log(`${label.padEnd(24)} status=${res && res.status()} cards=${(html.match(/data-jk=/g)||[]).length}`);
    return res && res.status();
  } finally { await context.close(); }
}

(async () => {
  const browser = await launchBrowser();
  console.log('--- two passes, 2500ms stagger (current behaviour) ---');
  await Promise.all([
    search(browser, 'pass A (jobs)', 'Full Stack Developer'),
    (async () => { await new Promise(r => setTimeout(r, 2500)); return search(browser, 'pass B (intern)', 'Full Stack Developer Internship'); })()
  ]);
  console.log('\n--- same two, fully serial with 8s gap ---');
  await new Promise(r => setTimeout(r, 8000));
  await search(browser, 'serial A', 'Backend Developer');
  await new Promise(r => setTimeout(r, 8000));
  await search(browser, 'serial B', 'Backend Developer Internship');
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
