require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');

const UA_152 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const UA_125 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const BLOCKED = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";
const URL = 'https://in.indeed.com/jobs?q=Full+Stack+Developer&l=India&start=0';

async function probe(browser, label, { ua, block }) {
  const context = await browser.newContext({
    userAgent: ua, viewport: { width: 1440, height: 900 }, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  if (block) await context.route(BLOCKED, r => r.abort());
  const page = await context.newPage();
  try {
    const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = await page.content();
    console.log(`${label.padEnd(28)} status=${res && res.status()}  cards=${(html.match(/data-jk=/g) || []).length}  html=${html.length}`);
  } catch (e) {
    console.log(`${label.padEnd(28)} ERROR ${e.message.split('\n')[0]}`);
  } finally { await context.close(); }
}

(async () => {
  const browser = await launchBrowser();
  console.log('real chromium UA:', await (await (await browser.newContext()).newPage()).evaluate(() => navigator.userAgent));
  await probe(browser, 'UA152 + assetBlock (ours)', { ua: UA_152, block: true });
  await new Promise(r => setTimeout(r, 3000));
  await probe(browser, 'UA152 + no block', { ua: UA_152, block: false });
  await new Promise(r => setTimeout(r, 3000));
  await probe(browser, 'UA125 + assetBlock', { ua: UA_125, block: true });
  await new Promise(r => setTimeout(r, 3000));
  await probe(browser, 'UA125 + no block', { ua: UA_125, block: false });
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
