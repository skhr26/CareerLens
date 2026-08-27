require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const s = require('./src/services/scraper.service');

(async () => {
  const browser = await launchBrowser();
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    console.log('>> newContext opts:', JSON.stringify(opts));
    const ctx = await origNewContext(opts);
    ctx.on('request', r => {
      if (r.url().includes('indeed') && r.resourceType() === 'document') {
        console.log('   REQ', r.method(), r.url());
        console.log('   REQ headers:', JSON.stringify(r.headers(), null, 0).slice(0, 700));
      }
    });
    ctx.on('response', async r => {
      if (r.url().includes('indeed') && r.request().resourceType() === 'document') {
        console.log('   RES', r.status(), r.url());
        try {
          const body = await r.text();
          console.log('   RES len', body.length, '| snippet:', body.replace(/\s+/g, ' ').slice(0, 300));
        } catch (e) { console.log('   RES body unavailable:', e.message); }
      }
    });
    return ctx;
  };

  try {
    const jobs = await s.scrapeJobsFromIndeed(browser, 'Full Stack Developer');
    console.log('RESULT:', jobs.length, 'jobs');
  } catch (e) { console.log('THREW:', e.message); }
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
