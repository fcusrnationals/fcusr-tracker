/* Opens the app with nothing in it and walks every screen.

   The app used to ship seeded with an invented council, and every other suite
   still asks for that fixture by name so it has something to walk through. It
   ships empty now — which means the state an officer actually meets on their
   first morning was the one state nothing tested. An empty list that renders
   "undefined", a screen that comes up blank, a total divided by no tasks: none
   of it would show up anywhere else.

       npm install puppeteer-core       (once)
       python3 -m http.server 4399      (in the project folder)
       node tests/empty-app.js
*/
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://localhost:4399/';
const ROUTES = [
  ['dashboard', ''], ['my tasks', '#/mytasks'], ['events', '#/events'],
  ['letters', '#/letters'], ['reports', '#/reports'], ['settings', '#/settings'],
  ['overview', '#/overview'], ['directives', '#/directives']
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('threw: ' + e.message));

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().indexOf('config.js') >= 0) {
      return req.respond({ status: 200, contentType: 'application/javascript',
        body: "window.FCU_BACKEND = { driver: 'supabase', supabase: { url: '', anonKey: '' }, appsscript: { url: '' } };" });
    }
    req.continue();
  });

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  const counts = await page.evaluate(() => ({
    people: Store.people().length, events: Store.events().length,
    tasks: Store.tasks().length, letters: Store.letters().length,
    reports: Store.reports().length, units: Store.units().length,
    offices: Store.offices().length, term: Store.term().declaredAt || '(none)'
  }));
  console.log('  holding: ' + JSON.stringify(counts));
  if (counts.people || counts.events || counts.tasks || counts.letters || counts.reports) {
    problems.push('the app opened with data in it');
  }
  if (!counts.units || !counts.offices) problems.push('the units or offices are missing');
  if (counts.term !== '(none)') problems.push('a closing date was declared by nobody');

  for (const [name, hash] of ROUTES) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));
    const s = await page.evaluate(() => {
      const v = document.getElementById('view');
      return {
        text: (v ? v.innerText : '').replace(/\s+/g, ' ').trim(),
        wide: document.documentElement.scrollWidth,
        vw: window.innerWidth
      };
    });
    const bad = [];
    if (s.text.length < 12) bad.push('the screen is blank');
    if (s.wide > s.vw + 1) bad.push('it scrolls sideways (' + s.wide + ' > ' + s.vw + ')');
    if (/NaN|undefined|\[object Object\]/.test(s.text)) bad.push('unfinished text on screen');
    if (bad.length) { problems.push(name + ': ' + bad.join('; ')); console.log('  FAULT ' + name + ' — ' + bad.join('; ')); }
    else console.log('  ok  ' + name + '  "' + s.text.slice(0, 58) + '"');
  }

  await browser.close();
  if (problems.length) { console.log('\n' + problems.length + ' problems:'); problems.forEach((p) => console.log('  - ' + p)); process.exit(1); }
  console.log('\nThe empty app is clean.');
  process.exit(0);
})();
