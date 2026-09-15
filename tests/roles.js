/* Signs in as each kind of person the council has, and uses the whole app.

   Every other browser suite runs with no server behind it, where the tracker
   treats whoever is at the keyboard as a national officer. That is one of five
   ways of seeing this app, and most of the branches that matter — what a
   Governor is offered, what a volunteer can reach, whose tasks My tasks shows —
   are in the other four. They were never walked.

   A fake Supabase answers at the network layer, so the app runs its real
   sign-in, its real sync and its real permission checks; only the server is
   pretend. For each person it clicks every control on every screen, and every
   control inside every dialog those open — except whatever would confirm a
   deletion — and reports anything thrown and any unfinished text on screen.

       npm install puppeteer-core          (once)
       python3 -m http.server 4399         (in the project folder)
       node tests/roles.js                 (all five)
       node tests/roles.js volunteer       (one)
*/
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://localhost:4399/';
const FAKE = 'https://fake.supabase.co';

const uuid = (n) => '9' + String(n).padStart(2, '0') + 'aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa' +
  String(n).padStart(2, '0');
const CODES = [['national', 'NAT'], ['comelec', 'COMELEC'], ['judiciary', 'SC'], ['branch', 'DUAG'],
  ['province', 'CAS'], ['province', 'CBA'], ['province', 'CCJE'], ['province', 'CTE'],
  ['province', 'COE'], ['province', 'CN'], ['province', 'CHTM'], ['province', 'CCS'],
  ['province', 'ELEM'], ['province', 'JHS'], ['province', 'SHS'], ['province', 'GS']];
const UNITS = CODES.map(([kind, code], i) => ({ id: uuid(i + 1), code, kind, name: code,
  tracker_name: code, active: true, body: null, updated_at: '2026-01-01T00:00:00Z' }));
const NAT = UNITS.find((u) => u.code === 'NAT').id;
const CN = UNITS.find((u) => u.code === 'CN').id;

const ROLES = {
  president:          { access: 'officer',   unit: NAT, head: true },
  'national officer': { access: 'officer',   unit: NAT, head: false },
  governor:           { access: 'officer',   unit: CN,  head: true },
  'college officer':  { access: 'officer',   unit: CN,  head: false },
  volunteer:          { access: 'volunteer', unit: CN,  head: false }
};
const ROUTES = ['#/overview', '#/my-tasks', '#/directives', '#/events', '#/letters', '#/settings'];

async function asPerson(browser, role) {
  const R = ROLES[role];
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  const errors = [];
  const odd = [];
  page.on('pageerror', (e) => errors.push('threw: ' + e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });
  page.on('dialog', (d) => d.dismiss());

  const uid = 'u-' + role.replace(/ /g, '-');
  const email = role.replace(/ /g, '.') + '@filamer.edu.ph';
  let theirEvent = '';

  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('config.js')) {
      return r.respond({ status: 200, contentType: 'application/javascript',
        body: "window.FCU_BACKEND={driver:'supabase',supabase:{url:'" + FAKE +
          "',anonKey:'k'},appsscript:{url:''}};" });
    }
    if (!url.startsWith(FAKE)) return r.continue();
    const path = url.slice(FAKE.length);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*' };
    const json = (o, status) => r.respond({ status: status || 200, contentType: 'application/json',
      headers: cors, body: JSON.stringify(o) });
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    if (path.startsWith('/auth/v1/user')) return json({ id: uid, email });
    if (path.startsWith('/auth/v1/logout')) return json({}, 204);
    if (path.startsWith('/rest/v1/profiles') && path.includes('id=eq.')) {
      return json([{ id: uid, email, full_name: 'Test ' + role, position: role,
        unit_id: R.unit, access: R.access, is_head: R.head, active: true,
        units: { name: R.unit === NAT ? 'FCUSR Nationals' : 'College of Nursing',
                 kind: R.unit === NAT ? 'national' : 'province' } }]);
    }
    if (path.startsWith('/rest/v1/event_members')) {
      return json(R.access === 'volunteer' && theirEvent ? [{ event_id: theirEvent }] : []);
    }
    if (path.startsWith('/rest/v1/rpc/server_now')) return json(new Date().toISOString());
    if (path.startsWith('/rest/v1/units')) return json(UNITS);
    if (path.startsWith('/rest/v1/rpc/')) return json([]);
    if (r.method() === 'GET') return json([]);
    return json([], 201);
  });

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });

  // Some work to walk through, and this person made a real entry with work of their own.
  theirEvent = await page.evaluate((email) => {
    Store._seedRehearsal();
    const me = Store.people()[0];
    Store.updatePerson(me.id, { email: email });
    const ev = Store.events().find((e) => e.status !== 'Completed') || Store.events()[0];
    Store.addTask({ kind: 'event', eventId: ev.id, title: 'MY OWN TASK', assigneeId: me.id, dueDate: '2026-12-01' });
    Store.addTask({ kind: 'directive', title: 'MY OWN DIRECTIVE', assigneeId: me.id, dueDate: '2026-12-02' });
    Store.addTask({ kind: 'event', eventId: ev.id, title: 'SOMEBODY ELSES TASK',
      assigneeId: Store.people()[1].id, dueDate: '2026-12-03' });
    // What a previous officer on this computer would have left behind.
    Store.setLastPerson(Store.people()[1].id);
    return ev.id;
  }, email);

  await page.evaluate((uid, email) => {
    localStorage.setItem('fcusr.tracker.sb', JSON.stringify({
      token: 'tok', refresh: null, expiresAt: Date.now() + 36e5, email, userId: uid }));
  }, uid, email);
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  // ---- My tasks is theirs ----
  await page.goto(BASE + '#/my-tasks', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 500));
  const mine = await page.evaluate(() => {
    const v = document.getElementById('view');
    const sel = v.querySelector('#person-select');
    const row = [...v.querySelectorAll('.task')].find((r) => /MY OWN DIRECTIVE/.test(r.textContent));
    return {
      picker: !!sel,
      pickerOnSelf: !!sel && /\(you\)/.test(sel.options[sel.selectedIndex].textContent),
      own: /MY OWN TASK/.test(v.innerText),
      directive: /MY OWN DIRECTIVE/.test(v.innerText),
      headedDirectives: [...v.querySelectorAll('.group-title')].some((g) => g.textContent.trim() === 'Directives'),
      others: /SOMEBODY ELSES TASK/.test(v.innerText),
      canTick: !!(row && row.querySelector('[data-status-for]'))
    };
  });
  if (R.access === 'volunteer' && mine.picker) odd.push('a volunteer is offered other people\'s task lists');
  if (R.access !== 'volunteer' && !mine.pickerOnSelf) odd.push('the name dropdown does not start on the person signed in');
  if (!mine.own) odd.push('My tasks does not show their own task');
  if (!mine.directive || !mine.headedDirectives) odd.push('their directive is missing or mis-headed');
  if (mine.others) odd.push('My tasks shows somebody else\'s task');
  if (!mine.canTick) odd.push('they cannot change the status of a directive given to them');

  // Tapping their directive opens it — it used to do nothing at all.
  const opened = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#view .task')].find((r) => /MY OWN DIRECTIVE/.test(r.textContent));
    row.querySelector('.task-main').click();
    const md = [...document.querySelectorAll('.modal-backdrop')].pop();
    // Whoever may edit it gets the full form, with the title in a text box.
    const title = md && (md.textContent + ' ' + ((md.querySelector('#f-title') || {}).value || ''));
    const ok = !!md && /MY OWN DIRECTIVE/.test(title) && !!md.querySelector('#f-status') &&
      !md.querySelector('#f-eventId');
    if (md) {
      md.querySelector('#f-status').value = 'Done';
      md.querySelector('#f-status').dispatchEvent(new Event('change', { bubbles: true }));
      md.querySelector('[data-save]').click();
    }
    const t = Store.tasks().find((x) => x.title === 'MY OWN DIRECTIVE');
    return { ok, done: !!t && t.status === 'Done' };
  });
  if (!opened.ok) odd.push('tapping their own directive does not open it with a status to set');
  if (!opened.done) odd.push('marking their own directive done did not save');
  await new Promise((r) => setTimeout(r, 300));
  const underDone = await page.evaluate(() => {
    const g = document.querySelector('[data-group="__done__"]');
    return !!g && /MY OWN DIRECTIVE/.test(g.textContent);
  });
  if (!underDone) odd.push('the finished directive is not under Done');

  // ---- every control, everywhere ----
  let clicks = 0;
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 300));
    const before = errors.length;
    const text = await page.evaluate(() => document.getElementById('view').innerText);
    if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(text)) odd.push(route + ': unfinished text on screen');

    const n = await page.evaluate(() =>
      document.querySelectorAll('#view button, #view [role=button], #view select').length);
    for (let i = 0; i < n; i++) {
      const opened = await page.evaluate((i) => {
        const el = document.querySelectorAll('#view button, #view [role=button], #view select')[i];
        if (!el || el.disabled) return 0;
        if (el.tagName === 'SELECT') {
          if (el.options.length > 1) {
            el.selectedIndex = el.options.length - 1;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return 0;
        }
        el.click();
        return document.querySelectorAll('.modal-backdrop').length;
      }, i).catch(() => 0);
      clicks++;
      await new Promise((r) => setTimeout(r, 120));

      if (opened) {
        const inside = await page.evaluate(() => {
          const md = [...document.querySelectorAll('.modal-backdrop')].pop();
          if (!md) return 0;
          if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(md.innerText)) return -1;
          const title = (md.querySelector('.modal-head, h2, h3') || {}).textContent || '';
          const danger = /delete|remove|reset|clear|sign out|end the term|close the term/i.test(title);
          md.querySelectorAll('button, select, input[type=checkbox]').forEach((c) => {
            if (c.disabled || c.matches('[data-close]')) return;
            if (danger && (c.matches('[data-ok]') || /delete|remove|clear/i.test(c.textContent))) return;
            if (c.tagName === 'SELECT') {
              if (c.options.length > 1) { c.selectedIndex = 1; c.dispatchEvent(new Event('change', { bubbles: true })); }
              return;
            }
            try { c.click(); } catch (e) { /* recorded by pageerror if it matters */ }
          });
          return 1;
        });
        if (inside === -1) odd.push(route + ': a dialog shows unfinished text');
        await new Promise((r) => setTimeout(r, 200));
        await page.evaluate(() => {
          document.querySelectorAll('.modal-backdrop').forEach((x) => x.remove());
          const menu = document.querySelector('.menu');
          if (menu) menu.remove();
        });
      }
      if ((await page.evaluate(() => location.hash)) !== route) {
        await page.goto(BASE + route, { waitUntil: 'networkidle0' });
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (errors.length > before) odd.push(route + ': ' + (errors.length - before) + ' errors');
  }

  await page.close();
  return { clicks, errors: [...new Set(errors)], odd };
}

(async () => {
  const which = process.argv[2] ? [process.argv[2]] : Object.keys(ROLES);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  let faults = 0;
  for (const role of which) {
    const r = await asPerson(browser, role);
    const bad = r.errors.length + r.odd.length;
    faults += bad;
    console.log((bad ? '  FAULT ' : '  ok    ') + role.padEnd(18) + r.clicks + ' controls');
    r.odd.forEach((o) => console.log('        ! ' + o));
    r.errors.slice(0, 8).forEach((e) => console.log('        ' + e));
  }
  await browser.close();
  console.log(faults ? '\n' + faults + ' faults' : '\nEvery kind of person, every control: clean.');
  process.exit(faults ? 1 : 0);
})();
