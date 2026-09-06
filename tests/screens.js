/* Screenshots every screen at a given width and reports layout faults:
   horizontal overflow and touch targets under 44px.

       npm install puppeteer-core          (once)
       python3 -m http.server 4399         (in the project folder)
       node tests/screens.js 390 844 m     (phone)
       node tests/screens.js 1280 900 d    (desktop)

   Images land in tests/out/.
*/
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://localhost:4399/';
const OUT = path.join(__dirname, 'out');

const SCREENS = [
  ['dashboard', '#/dashboard'],
  ['mytasks', '#/my-tasks'],
  ['events', '#/events'],
  ['letters', '#/letters'],
  ['detail', null],
  ['settings', '#/settings']
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const width = Number(process.argv[2] || 390);
  const height = Number(process.argv[3] || 844);
  const tag = process.argv[4] || 'm';

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars']
  });
  const page = await browser.newPage();

  /* Without this the deployed config.js applies, the front door stands, and
     every screen below audits the same sign-in card — a clean result that means
     nothing. The audit is about the app behind the door. */
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/assets\/js\/backend\/config\.js/.test(req.url())) {
      return req.respond({
        status: 200,
        contentType: 'application/javascript',
        body: "window.FCU_BACKEND = { driver: 'supabase', " +
              "supabase: { url: '', anonKey: '' }, appsscript: { url: '' } };"
      });
    }
    req.continue();
  });
  await page.setViewport({ width, height, deviceScaleFactor: 2 });

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const eventId = await page.evaluate(() => {
    Store.setLastPerson(Store.people()[0].id);
    return Store.events().find((e) => e.title.startsWith('Foundation')).id;
  });

  let faults = 0;
  for (const [name, hash] of SCREENS) {
    await page.goto(BASE + (hash || '#/events/' + eventId), { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));

    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const wide = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).position === 'fixed') return;
        if (r.right > vw + 1) {
          wide.push(el.tagName.toLowerCase() + '.' +
            String(el.className || '').trim().split(/\s+/).slice(0, 2).join('.') +
            ' right=' + Math.round(r.right));
        }
      });
      /* Effective hit area, so an invisible ::before that enlarges a target counts.

         The floor depends on what is doing the pointing. 44px is the figure for
         a fingertip, and it is the right one at the widths a phone reports; on a
         desktop it is the wrong test, and applying it there would push every
         control on the page out to finger size for the benefit of a mouse that
         does not need it. Above the layout's own touch breakpoint the floor is
         WCAG 2.5.8's 24px instead. */
      const touch = vw <= 700;
      const floor = touch ? 44 : 24;
      const reach = floor / 2 - 1;

      const small = [];
      document.querySelectorAll('button, a, select, input').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.height >= floor - 0.5) return;
        const cx = Math.round(r.left + r.width / 2), cy = r.top + r.height / 2;
        const hits = (y) => {
          if (y < 0 || y > innerHeight) return true;
          const h = document.elementFromPoint(cx, y);
          return !!h && (h === el || el.contains(h) || h.contains(el));
        };
        if (!hits(cy - reach) || !hits(cy + reach)) {
          small.push(el.tagName.toLowerCase() + '.' +
            String(el.className || '').trim().split(/\s+/).slice(0, 2).join('.') +
            ' h=' + Math.round(r.height) + '/' + floor +
            ' "' + (el.textContent || '').trim().slice(0, 20) + '"');
        }
      });
      return { vw, sw: doc.scrollWidth, wide: wide.slice(0, 6), small: small.slice(0, 6) };
    });

    const bad = report.sw > report.vw || report.wide.length || report.small.length;
    if (bad) faults++;
    console.log((bad ? 'FAULT ' : '  ok  ') + name + '  (viewport ' + report.vw +
      ', scrollWidth ' + report.sw + ')');
    report.wide.forEach((w) => console.log('        overflows: ' + w));
    report.small.forEach((s) => console.log('        small target: ' + s));

    await page.screenshot({ path: path.join(OUT, tag + '-' + name + '.png'), fullPage: true });
  }

  await browser.close();
  console.log(faults ? '\n' + faults + ' screen(s) with faults' : '\nAll screens clean.');
  process.exit(faults ? 1 : 0);
})();
