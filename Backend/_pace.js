require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const BLOCKED = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const QUERIES = ['Full Stack Developer','Backend Developer','Frontend Developer','Node.js Developer','React Developer','Java Developer'];

async function burst(browser, intervalMs) {
  const context = await browser.newContext({
    userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  await context.route(BLOCKED, r => r.abort());
  let ok = 0; const detail = [];
  for (let i = 0; i < QUERIES.length; i++) {
    const page = await context.newPage();
    try {
      const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(QUERIES[i])}&l=India&start=0`;
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const cards = (await page.content()).match(/data-jk=/g);
      const n = cards ? cards.length : 0;
      detail.push(`${res && res.status()}/${n}`);
      if (n > 0) ok++;
    } catch (e) { detail.push('ERR'); }
    finally { await page.close(); }
    if (i < QUERIES.length - 1) await new Promise(r => setTimeout(r, intervalMs));
  }
  await context.close();
  console.log(`  interval=${String(intervalMs).padStart(5)}ms  ok=${ok}/${QUERIES.length}  [${detail.join(' ')}]`);
  return ok;
}

(async () => {
  const browser = await launchBrowser();
  console.log('6 consecutive Indeed searches at each interval (status/cards):');
  for (const ms of [1200, 3000, 5000]) {
    console.log(` cooling down 75s...`);
    await new Promise(r => setTimeout(r, 75000));
    await burst(browser, ms);
  }
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
