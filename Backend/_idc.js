require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const s = require('./src/services/scraper.service');
(async () => {
  const browser = await launchBrowser();
  try {
    const jobs = await s.scrapeJobsFromIndeed(browser, 'Full Stack Developer');
    console.log(`${jobs.length} Indeed postings`);
    const withDesc = jobs.filter(j => j.description);
    const withType = jobs.filter(j => j.employmentType);
    const badSalary = jobs.filter(j => j.salary && /full[\s-]?time|part[\s-]?time|internship|contract|permanent/i.test(j.salary));
    console.log(`  description: ${withDesc.length}/${jobs.length}`);
    console.log(`  employmentType: ${withType.length}/${jobs.length}`);
    console.log(`  salary misfiled as job type: ${badSalary.length} (must be 0)`);
    jobs.slice(0, 4).forEach(j => console.log(
      `\n  ${j.title} @ ${j.company}\n    loc=${j.location} | pay=${j.salary} | type=${j.employmentType} | date=${j.postedAt}\n    desc(${j.description ? j.description.length : 0}): ${(j.description || '').slice(0, 110)}\n    ${j.link}`));
  } catch (e) { console.log('THREW:', e.message); }
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
