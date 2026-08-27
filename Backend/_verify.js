require('dotenv').config({ quiet: true });
const { scrapeJobsAndInternships, postingIdentity } = require('./src/services/scraper.service');

(async () => {
  const t0 = Date.now();
  const { jobs, internships, diagnostics } = await scrapeJobsAndInternships(
    'Full Stack Developer',
    ['React.js', 'Node.js', 'MongoDB', 'Express.js']
  );
  console.log(`\n=== took ${Math.round((Date.now() - t0) / 1000)}s ===`);
  console.log('diagnostics:', JSON.stringify(diagnostics));

  const all = [...jobs, ...internships];
  const pass = (label, ok, extra = '') => console.log((ok ? '  PASS ' : '  FAIL ') + label + (extra ? ` -> ${extra}` : ''));

  console.log(`\n=== ${jobs.length} jobs + ${internships.length} internships = ${all.length} ===`);

  // 1. zero duplicates
  const ids = all.map(postingIdentity);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  pass('no duplicate title::company', dupes.length === 0, dupes.join(' | '));

  const links = all.map(j => j.link);
  pass('no duplicate links', new Set(links).size === links.length);

  // 2. Indeed
  const indeed = all.filter(j => j.platform === 'Indeed' || (j.alsoOn || []).includes('Indeed'));
  pass('Indeed returned postings', (diagnostics.platforms.Indeed || 0) > 0, `count=${diagnostics.platforms.Indeed || 0}`);
  const indeedOwn = all.filter(j => j.platform === 'Indeed');
  const badIndeed = indeedOwn.filter(j => !/^https:\/\/in\.indeed\.com\/m\/viewjob\?jk=[a-z0-9]+$/i.test(j.link));
  pass('every Indeed link is /m/viewjob?jk=', badIndeed.length === 0, badIndeed.map(j => j.link).join(' | '));
  const jks = indeedOwn.map(j => j.link.split('jk=')[1]);
  pass('every Indeed jk distinct (canonicalUrl exception works)', new Set(jks).size === jks.length, `${new Set(jks).size}/${jks.length}`);

  // 3. internships genuinely internships
  const SENIOR = /\b(senior|sr|lead|principal|staff|architect|manager|head|director|distinguished|vp|chief)\b/i;
  const INTERN = /\b(intern|interns|internship|internships|trainee|apprentice|apprenticeship)\b/i;
  const notIntern = internships.filter(j => !INTERN.test(j.title) && !/intern/i.test(j.employmentType || ''));
  pass('every internship reads as an internship', notIntern.length === 0, notIntern.map(j => j.title).join(' | '));
  const seniorIntern = internships.filter(j => SENIOR.test(j.title));
  pass('no senior/lead/distinguished role in internships', seniorIntern.length === 0, seniorIntern.map(j => j.title).join(' | '));

  // 4. no fabrication regressions
  const relative = all.filter(j => !/^https:\/\//.test(j.link));
  pass('all links absolute https', relative.length === 0);
  const searchLinks = all.filter(j => /[?&](keywords|q|k)=/.test(j.link));
  pass('no search-results links', searchLinks.length === 0, searchLinks.map(j => j.link).join(' | '));
  const guessedDates = indeedOwn.filter(j => j.postedAt && !j.description);
  pass('Indeed list-only rows carry no guessed date', guessedDates.length === 0);

  console.log('\n=== merged (alsoOn non-empty) ===');
  all.filter(j => j.alsoOn && j.alsoOn.length).forEach(j =>
    console.log(`  [${j.platform}+${j.alsoOn.join('+')}] ${j.title} @ ${j.company} — ${j.location}`));

  console.log('\n=== internships ===');
  internships.forEach(j => console.log(`  [${j.platform}] ${j.title} @ ${j.company} | type=${j.employmentType || '-'} | ${j.location}`));

  console.log('\n=== jobs (first 12) ===');
  jobs.slice(0, 12).forEach(j => console.log(`  [${j.platform}] ${j.title} @ ${j.company} | ${j.location} | ${j.postedAt || 'no date'} | desc=${j.description ? j.description.length : 0}`));
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
