/* Push notifications in a real Chromium.

       npm install puppeteer-core
       python3 -m http.server 4399          # in the project folder, another terminal
       node tests/push-browser.js [out-folder]

   1. Registers the real sw.js, then hands it a push message through the
      browser's own DevTools protocol (ServiceWorker.deliverPushMessage) — the
      same path a message from Google's or Mozilla's push service takes once it
      reaches the browser — and reads back the notification it showed.
   2. Tries a real pushManager.subscribe(). That needs the browser vendor's push
      service on the internet; where it cannot be reached the result is said,
      not hidden.
   3. Photographs the Notifications sheet in each state, on a phone and on a
      desktop, for review. The account and server answers in the screenshots
      are stand-ins; what each state does is tested in run-auth.js against the
      real backend.js. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const BASE = process.env.BASE_URL || 'http://localhost:4399/';
const OUT = process.argv[2] || path.join(__dirname, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '   — ' + detail : '')); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--hide-scrollbars'] });
  const origin = new URL(BASE).origin;
  await browser.defaultBrowserContext().overridePermissions(origin, ['notifications']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The deployed config would put the front door up; the stand-in keeps it offline-capable.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/assets\/js\/backend\/config\.js/.test(req.url())) {
      return req.respond({ status: 200, contentType: 'application/javascript',
        body: "window.FCU_BACKEND = { driver: 'supabase', supabase: { url: '', anonKey: '' }, appsscript: { url: '' } };" });
    }
    req.continue();
  });

  console.log('\n--- the real service worker, given a real push ---');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => { Store._seedRehearsal(); });
  await page.reload({ waitUntil: 'networkidle0' });

  const cdp = await page.createCDPSession();
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    return reg.scope;
  });
  check('sw.js registers, with the whole site as its scope', scope === BASE, scope);
  await sleep(300);
  const reg = regs.find((r) => r.scopeURL === BASE && !r.isDeleted);
  check('the browser lists the registration', !!reg);

  const taskId = await page.evaluate(() => Store.tasks().find((t) => t.eventId).id);
  const payload = { v: 1, title: 'You have a new task', body: 'Open the tracker to see it.',
    url: './#/task/' + taskId, tag: 'fcusr-task-' + taskId };
  if (reg) {
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: reg.registrationId, data: JSON.stringify(payload) });
    await sleep(800);
  }
  const shown = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return (await r.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data }));
  });
  check('the push is shown as a notification', shown.length === 1 && shown[0].title === payload.title, JSON.stringify(shown));
  check('tagged with its task', shown[0] && shown[0].tag === payload.tag);
  check('and opens that task when tapped', shown[0] && shown[0].data && shown[0].data.url === BASE + '#/task/' + taskId,
    shown[0] && JSON.stringify(shown[0].data));
  if (reg) {
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: reg.registrationId, data: 'not json at all' });
    await sleep(600);
  }
  const plain = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
    .map((n) => n.title));
  check('an unreadable push is still shown, plainly', plain.indexOf('FCUSR Tracker') >= 0, JSON.stringify(plain));

  // What the tracker does with a tap while it is open: the worker posts this.
  await page.evaluate((u) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'fcusr-open', url: u } }));
  }, BASE + '#/task/' + taskId);
  await sleep(400);
  const landed = await page.evaluate(() => ({ hash: location.hash, open: !!document.querySelector('.modal-backdrop') }));
  check('a tap with the tracker open goes to the task, without a reload', /^#\/events\//.test(landed.hash) && landed.open,
    JSON.stringify(landed));

  console.log('\n--- a real subscription ---');
  const real = await page.evaluate(async () => {
    try {
      const r = await navigator.serviceWorker.ready;
      // Any valid P-256 public key will do to ask; nothing is ever sent to it.
      const key = Uint8Array.from(atob('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
        .replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const s = await Promise.race([
        r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
        new Promise((_, no) => setTimeout(() => no(new Error('no answer from the push service in 15 s')), 15000))]);
      const host = new URL(s.endpoint).host;
      await s.unsubscribe();
      return { ok: true, host };
    } catch (e) { return { ok: false, error: e.name + ': ' + e.message }; }
  });
  console.log('  info  pushManager.subscribe here: ' + (real.ok ? 'worked (' + real.host + ')' : real.error));

  console.log('\n--- the sheet, photographed ---');
  /* Stand-ins for a signed-in officer and the server's answers, so each state
     can be seen. The behaviour of each is tested against the real backend.js
     in run-auth.js. */
  const stage = async (setup) => {
    await page.evaluate(() => { document.querySelectorAll('.modal-backdrop,.menu,.toast').forEach((x) => x.remove()); });
    await page.evaluate(setup);
    await page.evaluate(() => { Push._reset(); Push.openSheet(); });
    await sleep(500);
  };
  const fakeOnline = () => {
    Auth.adopt({ id: '11111111-1111-4111-8111-111111111111', email: 'arron@example.com', full_name: 'Arron D. Aperocho',
      position: 'National President', unit_id: Store.nationalUnitId(), unit_name: 'FCUSR Nationals',
      unit_kind: 'national', access: 'officer', is_head: true });
    Auth.isOffline = () => false;
    window.__push = window.__push || { prefs: { assigned: true, moved: true, due: true, overdue: true, details: false } };
    Backend.push = (fn, args) => {
      if (fn === 'push_public_key') return Promise.resolve(window.__push.key === undefined ? 'B' + 'Q'.repeat(86) : window.__push.key);
      if (fn === 'push_my_devices') {
        return Promise.resolve(window.__push.devices || []);
      }
      if (fn === 'push_set_prefs') { Object.assign(window.__push.prefs, args.prefs); return Promise.resolve(window.__push.prefs); }
      return Promise.resolve(1);
    };
  };
  const shot = async (name) => {
    const el = await page.$('.modal');
    if (el) await el.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  shot  ' + name + '.png');
  };

  await stage(() => {
    localStorage.removeItem('fcusr.tracker.push.11111111-1111-4111-8111-111111111111');
  });
  await page.evaluate(fakeOnline);
  await stage(() => { localStorage.removeItem('fcusr.tracker.push.11111111-1111-4111-8111-111111111111'); });
  check('off: the sheet offers one clear button', await page.$eval('.modal', (m) => !!m.querySelector('[data-push-on]')));
  await shot('push-phone-off');

  await stage(() => {
    localStorage.setItem('fcusr.tracker.push.11111111-1111-4111-8111-111111111111',
      JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/this-phone', prefs: window.__push.prefs }));
    window.__push.devices = [
      { id: 'd1', label: 'Android phone · Chrome', created_at: '2026-10-20T08:00:00Z', last_sent_at: '2026-10-26T23:30:00Z', failing: false,
        endpoint_hash: '' },
      { id: 'd2', label: 'Windows computer · Edge', created_at: '2026-10-22T03:00:00Z', last_sent_at: null, failing: false, endpoint_hash: 'x' }];
  });
  // Mark the first device as this one, as the real hash would.
  await page.evaluate(async () => {
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('https://fcm.googleapis.com/fcm/send/this-phone'))))
      .map((b) => ('0' + b.toString(16)).slice(-2)).join('');
    window.__push.devices[0].endpoint_hash = h;
    document.querySelectorAll('.modal-backdrop').forEach((x) => x.remove());
    Push.openSheet();
  });
  await sleep(500);
  check('on: the switches, privacy setting and devices show',
    await page.$eval('.modal', (m) => !!m.querySelector('[data-pref="details"]') && /this one/.test(m.textContent)));
  await shot('push-phone-on');

  await stage(() => { window.__push.key = null; localStorage.removeItem('fcusr.tracker.push.11111111-1111-4111-8111-111111111111'); });
  check('not set up on the server: says so', await page.$eval('.modal', (m) => /has not switched notifications on/.test(m.textContent)));
  await shot('push-phone-not-ready');

  await page.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach((x) => x.remove()); });
  const ctx = browser.defaultBrowserContext();
  await ctx.clearPermissionOverrides();
  await page.evaluate(() => {
    window.__push.key = undefined;
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
  });
  await stage(() => {});
  check('blocked: explains how to allow it', await page.$eval('.modal', (m) => /blocked/.test(m.textContent)));
  await shot('push-phone-blocked');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' });
    window.__pm = window.PushManager;
    delete window.PushManager;
  });
  await stage(() => {});
  check('iPhone not on the Home Screen: says how', await page.$eval('.modal', (m) => /Home Screen/.test(m.textContent)));
  await shot('push-phone-iphone');
  await page.evaluate(() => { window.PushManager = window.__pm; });

  // The account menu entry, on a desktop.
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' });
    document.querySelectorAll('.modal-backdrop').forEach((x) => x.remove());
    App.render();
  });
  await sleep(300);
  await page.evaluate(() => {
    document.querySelectorAll('.intro-tip').forEach((x) => x.remove());
    document.getElementById('btn-account').hidden = false;
  });
  await page.click('#btn-account');
  await sleep(400);
  check('the account menu offers notifications on this device',
    await page.evaluate(() => Array.from(document.querySelectorAll('.menu button')).some((b) => /Notifications on this device/.test(b.textContent))));
  await page.screenshot({ path: path.join(OUT, 'push-desktop-menu.png') });
  console.log('  shot  push-desktop-menu.png');
  await page.evaluate(() => { document.querySelectorAll('.menu').forEach((x) => x.remove());
    localStorage.setItem('fcusr.tracker.push.11111111-1111-4111-8111-111111111111',
      JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/this-phone', prefs: window.__push.prefs }));
    Push.openSheet(); });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'push-desktop-on.png') });
  console.log('  shot  push-desktop-on.png');

  check('no page errors along the way', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\n========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  FAILED: ' + failures.join('\n  FAILED: ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
