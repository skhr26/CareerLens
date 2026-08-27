require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const BLOCKED = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

async function fresh(browser) {
  const ctx = await browser.newContext({
    userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  await ctx.route(BLOCKED, r => r.abort());
  return ctx;
}
async function hit(ctx, start, gapMs = 0) {
  if (gapMs) await new Promise(r => setTimeout(r, gapMs));
  const page = await ctx.newPage();
  try {
    const url = `https://in.indeed.com/jobs?q=Full%20Stack%20Developer&l=India&start=${start}`;
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const n = ((await page.content()).match(/data-jk=/g) || []).length;
    console.log(`    start=${String(start).padStart(2)} gap=${String(gapMs).padStart(5)}ms -> ${res && res.status()} cards=${n}`);
    return res && res.status();
  } finally { await page.close(); }
}

(async () => {
  const browser = await launchBrowser();

  console.log('T1: fresh context, start=0 then start=10 (1.2s gap) - the scraper pattern');
  let c = await fresh(browser); await hit(c, 0); await hit(c, 10, 1200); await c.close();

  console.log('T2: fresh context, start=0 then start=10 (10s gap)');
  c = await fresh(browser); await hit(c, 0); await hit(c, 10, 10000); await c.close();

  console.log('T3: fresh context, start=10 as the very FIRST request');
  c = await fresh(browser); await hit(c, 10); await c.close();

  console.log('T4: fresh context, start=0 twice (control - is it paging or just the 2nd request?)');
  c = await fresh(browser); await hit(c, 0); await hit(c, 0, 1200); await c.close();

  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
