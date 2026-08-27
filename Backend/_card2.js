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
      const timing = card && card.querySelector('[data-testid="timing-attribute"]');
      const attrs = card ? [...card.querySelectorAll('[data-testid^="attribute_snippet_testid"]')].map(e => e.innerText.trim()) : [];
      return {
        title: a.innerText.trim().slice(0, 45),
        cardTag: card && card.tagName + '.' + String(card.className).slice(0, 60),
        timing: timing ? timing.innerText.replace(/\s+/g,' ').trim() : null,
        attributes: attrs,
        fullCardText: card ? card.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : null
      };
    });
  });
  console.log(JSON.stringify(out, null, 2));

  // Where does the prose live? Search the whole page for a long sentence-like block.
  const prose = await page.evaluate(() => {
    const hits = [];
    document.querySelectorAll('div,li,ul,p,td').forEach(el => {
      if (el.children.length > 3) return;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length > 90 && t.length < 700 && /\b(develop|experience|responsib|requir|build|work)/i.test(t)) {
        hits.push({ sel: el.tagName + '.' + String(el.className).slice(0, 55), testid: el.getAttribute('data-testid'), text: t.slice(0, 130) });
      }
    });
    return hits.slice(0, 6);
  });
  console.log('\nprose blocks:'); console.log(JSON.stringify(prose, null, 2));
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
