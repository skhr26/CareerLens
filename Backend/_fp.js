require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const BLOCKED = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";
const UA_FAKE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const URL = 'https://in.indeed.com/jobs?q=Full%20Stack%20Developer&l=India&start=0';

const STEALTH = () => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true });
  if (!window.chrome) window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
};

async function trial(browser, label, { ua, stealth }) {
  const context = await browser.newContext({
    userAgent: ua, viewport: { width: 1440, height: 900 }, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  await context.route(BLOCKED, r => r.abort());
  if (stealth) await context.addInitScript(STEALTH);
  const page = await context.newPage();
  try {
    const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = await page.content();
    const cards = (html.match(/data-jk=/g) || []).length;
    console.log(`  ${label.padEnd(22)} status=${res && res.status()} cards=${cards}`);
    return cards;
  } catch (e) { console.log(`  ${label.padEnd(22)} ERROR ${e.message.split('\n')[0].slice(0,60)}`); return 0; }
  finally { await context.close(); }
}

(async () => {
  const browser = await launchBrowser();
  console.log('browser.version():', browser.version());
  const c0 = await browser.newContext();
  const p0 = await c0.newPage();
  console.log('fingerprint:', JSON.stringify(await p0.evaluate(() => ({
    ua: navigator.userAgent, webdriver: navigator.webdriver,
    chrome: typeof window.chrome, plugins: navigator.plugins.length
  }))));
  await c0.close();

  const realMajor = browser.version().match(/(\d+)\./)[1];
  const UA_REAL = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${realMajor}.0.0.0 Safari/537.36`;
  console.log('UA_REAL:', UA_REAL, '\n');

  const score = { baseline: 0, realUA: 0, stealth: 0, both: 0 };
  for (let i = 1; i <= 3; i++) {
    console.log(`round ${i}`);
    score.baseline += await trial(browser, 'baseline(UA152)', { ua: UA_FAKE, stealth: false });
    await new Promise(r => setTimeout(r, 7000));
    score.realUA += await trial(browser, 'realUA', { ua: UA_REAL, stealth: false });
    await new Promise(r => setTimeout(r, 7000));
    score.stealth += await trial(browser, 'stealth+UA152', { ua: UA_FAKE, stealth: true });
    await new Promise(r => setTimeout(r, 7000));
    score.both += await trial(browser, 'stealth+realUA', { ua: UA_REAL, stealth: true });
    await new Promise(r => setTimeout(r, 7000));
  }
  console.log('\ntotal cards over 3 rounds:', JSON.stringify(score));
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
