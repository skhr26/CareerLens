require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const BLOCKED = "**/*.{png,jpg,jpeg,gif,webp,avif,ico,mp4,webm,mp3,woff,woff2,ttf,otf,eot}";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({
    userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  await ctx.route(BLOCKED, r => r.abort());

  // Get real jk values from a live search first.
  const sp = await ctx.newPage();
  await sp.goto('https://in.indeed.com/jobs?q=Full%20Stack%20Developer&l=India&start=0', { waitUntil: 'domcontentloaded' });
  const jks = await sp.evaluate(() =>
    [...document.querySelectorAll('a.jcs-JobTitle[data-jk]')].slice(0, 4).map(a => a.getAttribute('data-jk')));
  await sp.close();
  console.log('jks:', jks.join(', '));

  for (const [i, jk] of jks.entries()) {
    for (const route of ['/m/viewjob', '/viewjob']) {
      const page = await ctx.newPage();
      const url = `https://in.indeed.com${route}?jk=${jk}`;
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const html = await page.content();
        const hasDesc = /id="jobDescriptionText"|data-testid="jobDescriptionText"/.test(html);
        const txt = await page.evaluate(() => {
          const el = document.querySelector('#jobDescriptionText, [data-testid="jobDescriptionText"]');
          return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 90) : null;
        });
        console.log(`  #${i} ${route.padEnd(11)} ${res && res.status()} descSel=${hasDesc} title="${(await page.title()).slice(0,45)}"`);
        if (txt) console.log(`      desc: ${txt}`);
      } catch (e) { console.log(`  #${i} ${route.padEnd(11)} ERROR ${e.message.split('\n')[0].slice(0,50)}`); }
      finally { await page.close(); }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
