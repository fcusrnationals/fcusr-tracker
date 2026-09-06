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
  let faultsTotal = 0;
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

  /* ---------------- running the current version ----------------
     GitHub Pages lets a browser keep index.html for ten minutes, and a tab left
     open keeps it indefinitely — so a council can be running three versions of
     the app against one database with nobody aware. The page has to notice. */
  {
    const v = await page.evaluate(() => {
      const el = document.querySelector('script[src*="app.js?v="]');
      const m = el && el.getAttribute('src').match(/\?v=(\d+)/);
      return m ? Number(m[1]) : 0;
    });
    console.log('  running v' + v);

    const served = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
    if (v !== served.version) {
      console.log('  FAULT  index.html is v' + v + ' but version.json says v' + served.version +
        ' — every open tab would be told to reload, for ever');
      faultsTotal++;
    }

    // Pretend the server moved on, and check the page says so.
    await page.evaluate(() => {
      const real = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('version.json') >= 0
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 99999 }) })
        : real(u, o));
    });
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await new Promise((r) => setTimeout(r, 300));
    const bar = await page.evaluate(() => {
      const b = document.getElementById('update-bar');
      return b ? { text: b.textContent.replace(/\s+/g, ' '), reload: !!b.querySelector('[data-reload]') } : null;
    });
    if (!bar || !bar.reload) {
      console.log('  FAULT  a stale tab is never told a newer version exists');
      faultsTotal++;
    } else {
      console.log('  ok  stale tab notices: "' + bar.text.slice(0, 60) + '"');
    }
    await page.reload({ waitUntil: 'networkidle0' });
  }

  let faults = 0;
  for (const [name, hash] of SCREENS) {
    await page.goto(BASE + (hash || '#/events/' + eventId), { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 250));

    /* Menus and dialogs are drawn on demand, so an audit that only walks screens
       never measures them. The popup menu shipped with a delete icon a hundred
       and sixty pixels tall — bigger than the button holding it — because its
       icons had no size rule and nothing here ever opened one. */
    await page.evaluate(() => {
      const m = document.querySelector('[data-more]');
      if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));

    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const wide = [];
      const huge = [];
      document.querySelectorAll('.ico').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 32 || r.height > 32) {
          huge.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' in ' +
            (el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' +
              String(el.parentElement.className || '').trim().split(/\s+/)[0] : '?'));
        }
      });
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
      return { vw, sw: doc.scrollWidth, wide: wide.slice(0, 6), small: small.slice(0, 6),
               huge: huge.slice(0, 6) };
    });

    const bad = report.sw > report.vw || report.wide.length || report.small.length ||
      report.huge.length;
    if (bad) faults++;
    console.log((bad ? 'FAULT ' : '  ok  ') + name + '  (viewport ' + report.vw +
      ', scrollWidth ' + report.sw + ')');
    report.wide.forEach((w) => console.log('        overflows: ' + w));
    report.small.forEach((s) => console.log('        small target: ' + s));
    report.huge.forEach((h) => console.log('        oversized icon: ' + h));

    await page.screenshot({ path: path.join(OUT, tag + '-' + name + '.png'), fullPage: true });
  }

  await browser.close();
  var all = faults + faultsTotal;
  console.log(all ? '\n' + all + ' fault(s)' : '\nAll screens clean.');
  process.exit(all ? 1 : 0);
})();
