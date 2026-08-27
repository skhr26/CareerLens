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
  const page = await ctx.newPage();
  await page.goto('https://in.indeed.com/jobs?q=Full%20Stack%20Developer&l=India&start=0', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a.jcs-JobTitle');

  const out = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('a.jcs-JobTitle[data-jk]')].slice(0, 3);
    return cards.map(a => {
      const card = a.closest('li, .job_seen_beacon, div.cardOutline');
      const q = sel => { const e = card && card.querySelector(sel); return e ? e.innerText.replace(/\s+/g,' ').trim().slice(0,160) : null; };
      const testids = card ? [...card.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')) : [];
      return {
        title: a.innerText.trim().slice(0, 50),
        snippet_belowJobSnippet: q('[data-testid="belowJobSnippet"]'),
        snippet_jobsnippet: q('.job-snippet'),
        snippet_ul: q('[class*="underShelf"] ul, .css-1x9pvv0, ul'),
        salary_attr: q('[data-testid^="attribute_snippet_testid"]'),
        salary_any: q('[class*="salary"], [data-testid*="salary"]'),
        metadata: q('.jobMetaDataGroup, [class*="metadataContainer"]'),
        testids: [...new Set(testids)].join(',')
      };
    });
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
