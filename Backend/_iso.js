require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const s = require('./src/services/scraper.service');

(async () => {
  const browser = await launchBrowser();

  console.log('--- A: real scrapeJobsFromIndeed, alone ---');
  try {
    const jobs = await s.scrapeJobsFromIndeed(browser, 'Full Stack Developer');
    console.log(`  OK ${jobs.length} jobs; first=${jobs[0] && jobs[0].link}`);
  } catch (e) { console.log('  THREW:', e.message, 'blocked=' + !!e.blocked); }

  await new Promise(r => setTimeout(r, 10000));

  console.log('--- B: real scrapeJobsFromIndeed, concurrent with the other three ---');
  const results = await Promise.allSettled([
    s.scrapeJobsFromNaukri(browser, 'Full Stack Developer'),
    s.scrapeJobsFromLinkedIn(browser, 'Full Stack Developer'),
    s.scrapeJobsFromWellfound(browser, 'Full Stack Developer', { skills: [] }),
    s.scrapeJobsFromIndeed(browser, 'Full Stack Developer')
  ]);
  ['Naukri', 'LinkedIn', 'Wellfound', 'Indeed'].forEach((n, i) => {
    const r = results[i];
    console.log(`  ${n.padEnd(10)} ${r.status === 'fulfilled' ? r.value.length + ' jobs' : 'THREW: ' + r.reason.message}`);
  });

  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
