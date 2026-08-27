require('dotenv').config({ quiet: true });
const { launchBrowser } = require('./src/services/browser.service');
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://in.indeed.com/' }
  });
  const page = await context.newPage();
  const url = 'https://in.indeed.com/jobs?q=Full+Stack+Developer&l=India&start=0';
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('status:', response && response.status());
  console.log('final url:', page.url());
  console.log('title:', JSON.stringify(await page.title()));
  const html = await page.content();
  console.log('html length:', html.length);
  console.log('jcs-JobTitle occurrences:', (html.match(/jcs-JobTitle/g) || []).length);
  console.log('data-jk occurrences:', (html.match(/data-jk=/g) || []).length);
  console.log('--- visible text (600) ---');
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 600)));
  await browser.close();
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
