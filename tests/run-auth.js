/* The credential path, driven end to end against a stand-in Supabase.

       node tests/run-auth.js

   There is no live project here, and that is the point: the fake below answers
   the same URLs the real one does and records every request, so the questions
   that actually decide whether people can sign in on deployment day get answered
   now rather than in front of the council.

   What it walks: an executive enrols an address · that person sets their own
   password · the app asks who they are · the page is refreshed · the hour runs
   out and the token is exchanged · a volunteer sees only their own activities ·
   signing out leaves nothing behind.
*/
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '   — ' + extra : '')); }
};

const vc = new VirtualConsole();
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/index.html', runScripts: 'dangerously',
  virtualConsole: vc, pretendToBeVisual: true
});
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};

/* ---------------- the stand-in ----------------
   Small on purpose. It enforces only the things the client is being tested
   against: a token proves who you are, an unknown token proves nothing, and a
   profile appears only where an enrolment was recorded first. */

const SB = {
  url: 'https://stand-in.supabase.co',
  anonKey: 'anon-key-for-the-test',
  users: {},          // email → { id, password }
  enrolments: {},     // email → { unit_id, access, event_ids, full_name, position }
  profiles: {},       // id → profile row
  members: [],        // { event_id, profile_id }
  tokens: {},         // access token → { userId, expiresAt }
  refreshes: {},      // refresh token → userId
  requests: [],       // every call the client made
  n: 0
};

const NAT = 'unit-nat-uuid';
const CN = 'unit-cn-uuid';
const units = [
  { id: NAT, name: 'FCUSR Nationals', kind: 'national', code: 'NAT' },
  { id: CN, name: 'College of Nursing', kind: 'province', code: 'CN' }
];

function issue(userId, ttl = 3600) {
  const access = 'acc-' + (++SB.n);
  const refresh = 'ref-' + (++SB.n);
  SB.tokens[access] = { userId, expiresAt: Date.now() + ttl * 1000 };
  SB.refreshes[refresh] = userId;
  return { access_token: access, refresh_token: refresh, expires_in: ttl };
}

function bearerUser(headers) {
  const auth = (headers && (headers.Authorization || headers.authorization)) || '';
  const tok = auth.replace(/^Bearer /, '');
  const rec = SB.tokens[tok];
  if (!rec) return null;
  if (rec.expiresAt < Date.now()) return null;   // the server refuses a lapsed token
  return rec.userId;
}

// The trigger the schema installs on auth.users: sign-up turns a waiting
// enrolment into a profile, and nothing otherwise.
function claimEnrolment(user) {
  const e = SB.enrolments[user.email];
  if (!e) return;
  SB.profiles[user.id] = {
    id: user.id, email: user.email, full_name: e.full_name, position: e.position,
    unit_id: e.unit_id, access: e.access, is_head: false, active: true,
    units: units.find((u) => u.id === e.unit_id)
  };
  (e.event_ids || []).forEach((ev) => SB.members.push({ event_id: ev, profile_id: user.id }));
  e.claimed_at = new Date().toISOString();
}

function reply(status, body) {
  return Promise.resolve({
    ok: status < 400, status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

window.fetch = function (url, opts) {
  opts = opts || {};
  const u = String(url).replace(SB.url, '');
  const body = opts.body ? JSON.parse(opts.body) : {};
  const who = bearerUser(opts.headers);
  SB.requests.push({ url: u, method: opts.method || 'GET', auth: !!who });

  if (!(opts.headers || {}).apikey) return reply(401, { message: 'No API key.' });

  /* ---- auth ---- */
  if (u.indexOf('/auth/v1/signup') === 0) {
    if (SB.users[body.email]) return reply(400, { message: 'User already registered' });
    const user = { id: 'user-' + (++SB.n), email: body.email, password: body.password };
    SB.users[body.email] = user;
    claimEnrolment(user);                       // the trigger
    return reply(200, Object.assign(issue(user.id), { user: { id: user.id, email: user.email } }));
  }
  if (u.indexOf('/auth/v1/token?grant_type=password') === 0) {
    const user = SB.users[body.email];
    if (!user || user.password !== body.password) {
      return reply(400, { error_description: 'Invalid login credentials' });
    }
    return reply(200, Object.assign(issue(user.id), { user: { id: user.id, email: user.email } }));
  }
  if (u.indexOf('/auth/v1/token?grant_type=refresh_token') === 0) {
    const userId = SB.refreshes[body.refresh_token];
    if (!userId) return reply(400, { error_description: 'Invalid Refresh Token' });
    const email = Object.keys(SB.users).find((e) => SB.users[e].id === userId);
    return reply(200, Object.assign(issue(userId), { user: { id: userId, email } }));
  }
  if (u.indexOf('/auth/v1/logout') === 0) return reply(204);
  if (u.indexOf('/auth/v1/user') === 0) {
    if (!who) return reply(401, { message: 'invalid claim: missing sub claim' });
    if (opts.method === 'PUT') {
      const email = Object.keys(SB.users).find((e) => SB.users[e].id === who);
      SB.users[email].password = body.password;
      return reply(200, { id: who, email });
    }
    const email = Object.keys(SB.users).find((e) => SB.users[e].id === who);
    return reply(200, { id: who, email });
  }

  /* ---- rest ---- */
  if (!who) return reply(401, { message: 'JWT expired or missing' });

  if (u.indexOf('/rest/v1/units') === 0) return reply(200, units);

  if (u.indexOf('/rest/v1/profiles') === 0) {
    const m = u.match(/id=eq\.([^&]+)/);
    // Without a filter the database hands back everything this person may read.
    const all = Object.keys(SB.profiles).map((k) => SB.profiles[k]);
    return reply(200, m ? all.filter((p) => p.id === decodeURIComponent(m[1])) : all);
  }
  if (u.indexOf('/rest/v1/event_members') === 0) {
    const m = u.match(/profile_id=eq\.([^&]+)/);
    return reply(200, SB.members.filter((r) => !m || r.profile_id === decodeURIComponent(m[1]))
      .map((r) => ({ event_id: r.event_id })));
  }
  if (u.indexOf('/rest/v1/enrolments') === 0) {
    return reply(200, Object.keys(SB.enrolments)
      .filter((e) => !SB.enrolments[e].claimed_at)
      .map((e) => Object.assign({ email: e }, SB.enrolments[e])));
  }
  if (u.indexOf('/rest/v1/rpc/enroll_member') === 0) {
    const actor = SB.profiles[who];
    if (!actor || actor.access !== 'officer') return reply(403, { message: 'You may not enrol members.' });
    const actorUnit = units.find((x) => x.id === actor.unit_id);
    if (actorUnit.kind !== 'national' && actor.unit_id !== body.p_unit_id) {
      return reply(403, { message: 'You may not enrol members for that unit.' });
    }
    SB.enrolments[body.p_email.toLowerCase().trim()] = {
      full_name: body.p_full_name, position: body.p_position,
      unit_id: body.p_unit_id, access: body.p_access, event_ids: body.p_event_ids || []
    };
    return reply(200, body.p_email);
  }
  if (u.indexOf('/rest/v1/audit_log') === 0) return reply(200, []);

  return reply(404, { message: 'no route: ' + u });
};

const FILES = [
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
  'assets/js/util.js', 'assets/js/store.js', 'assets/js/ui.js', 'assets/js/report.js',
  'assets/js/asset-db.js', 'assets/js/camera.js', 'assets/js/accomplishment.js',
  'assets/js/accomplishment-pdf.js', 'assets/js/accomplishment-word.js',
  'assets/js/accomplishment-ui.js', 'assets/js/backend/config.js', 'assets/js/backend/backend.js',
  'assets/js/auth.js', 'assets/js/term-ui.js', 'assets/js/term-pdf.js', 'assets/js/letter-slip.js', 'assets/js/views/signin.js', 'assets/js/views/dashboard.js', 'assets/js/views/mytasks.js',
  'assets/js/views/directives.js', 'assets/js/views/events.js', 'assets/js/views/event-detail.js',
  'assets/js/views/letters.js', 'assets/js/views/letter-detail.js',
  'assets/js/views/settings.js', 'assets/js/forms.js', 'assets/js/app.js'
];

(async function main() {
  FILES.forEach((f) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    window.document.head.appendChild(s);
  });
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

  const { Backend, Auth, Store } = window;

  console.log('\n--- before anything is configured ---');
  check('with no credentials the app falls back to local', Backend.isFallback());
  check('and still runs, treating this device as national',
    await Auth.signIn('', '').then(() => Auth.isNational()));
  await Auth.signOut();

  // Point the app at the stand-in.
  Backend.config.supabase.url = SB.url;
  Backend.config.supabase.anonKey = SB.anonKey;
  check('once the two values are in, Supabase is live', !Backend.isFallback());
  check('and it is Supabase that answers', Backend.driverName() === 'Supabase');

  /* ---------------- the founding officer ---------------- */
  console.log('\n--- the founding national officer ---');
  // Set up by hand in the SQL editor, exactly as backend/SETUP.md describes.
  SB.users['president@filamer.edu.ph'] = { id: 'user-pres', password: 'presidentpass' };
  SB.profiles['user-pres'] = {
    id: 'user-pres', email: 'president@filamer.edu.ph', full_name: 'Althea Ramirez',
    position: 'President', unit_id: NAT, access: 'officer', is_head: true, active: true,
    units: units[0]
  };

  await Auth.signIn('president@filamer.edu.ph', 'presidentpass');
  check('the president signs in', Auth.signedIn());
  check('and is read as a national officer', Auth.isNational() && !Auth.isVolunteer());
  check('under the right name', Auth.current().name === 'Althea Ramirez');
  check('and the right unit', Auth.current().unitName === 'FCUSR Nationals');

  const wrong = await Auth.signIn('president@filamer.edu.ph', 'not-the-password')
    .then(() => null, (e) => e.message);
  check('a wrong password is refused', !!wrong, wrong || 'it was accepted');

  /* ---------------- who am I ---------------- */
  console.log('\n--- asking who is signed in ---');
  await Auth.signIn('president@filamer.edu.ph', 'presidentpass');
  // A national may read every profile in the Republic. Asking without naming
  // yourself is how you end up signed in as whoever the database returns first.
  const whoCalls = SB.requests.filter((r) => r.url.indexOf('/rest/v1/profiles?') === 0);
  check('the profile is asked for by id, never "the first row"',
    whoCalls.length > 0 && whoCalls.every((r) => /id=eq\./.test(r.url)),
    whoCalls.map((r) => r.url).join(' '));

  /* ---------------- enrolling a volunteer ---------------- */
  console.log('\n--- enrolling someone who has never signed in ---');
  const nurseEvent = 'event-cn-1';
  await Backend.enrol({
    email: 'Rhea.Solis@filamer.edu.ph', full_name: 'Rhea Solis',
    position: 'Logistics Volunteer', unit_id: CN, access: 'volunteer',
    eventIds: [nurseEvent]
  });
  check('the enrolment is recorded against the address',
    !!SB.enrolments['rhea.solis@filamer.edu.ph']);
  check('no login exists yet', !SB.users['rhea.solis@filamer.edu.ph']);
  check('and no profile has been invented',
    !Object.keys(SB.profiles).some((k) => SB.profiles[k].email === 'rhea.solis@filamer.edu.ph'));
  check('the events they may help with travel with the enrolment',
    SB.enrolments['rhea.solis@filamer.edu.ph'].event_ids[0] === nurseEvent);

  const pending = await Backend.pending();
  check('and it shows as waiting until they claim it',
    pending.some((p) => p.email === 'rhea.solis@filamer.edu.ph'));

  /* ---------------- claiming it ---------------- */
  console.log('\n--- that person sets their own password ---');
  await Auth.signOut();
  await Auth.signUp('rhea.solis@filamer.edu.ph', 'nursingpower');
  check('signing up gets them in', Auth.signedIn());
  check('as a volunteer, not an officer', Auth.isVolunteer() && !Auth.isNational());
  check('in the unit the executive chose, not one they picked',
    Auth.current().unitName === 'College of Nursing');
  check('carrying the activity they were taken on for',
    Auth.current().eventIds.indexOf(nurseEvent) >= 0);
  check('the password is their own — the app never held it',
    SB.users['rhea.solis@filamer.edu.ph'].password === 'nursingpower');

  /* ---------------- a stranger ---------------- */
  console.log('\n--- somebody nobody enrolled ---');
  await Auth.signOut();
  const stranger = await Auth.signUp('random.person@gmail.com', 'letmein12345')
    .then(() => null, (e) => e.message);
  check('can make a login and still get nothing', !!stranger);
  check('and is told plainly why', /enrolled/i.test(stranger || ''), stranger || '');
  check('no profile was created for them',
    !Object.keys(SB.profiles).some((k) => SB.profiles[k].email === 'random.person@gmail.com'));
  check('so the app does not consider them signed in', !Auth.signedIn());

  /* ---------------- a volunteer cannot enrol ---------------- */
  console.log('\n--- a volunteer tries to enrol somebody ---');
  await Auth.signIn('rhea.solis@filamer.edu.ph', 'nursingpower');
  const refused = await Backend.enrol({
    email: 'friend@filamer.edu.ph', full_name: 'A Friend', position: 'President',
    unit_id: NAT, access: 'officer', eventIds: []
  }).then(() => null, (e) => e.message);
  check('the server refuses, whatever the app would have allowed', !!refused, refused || '');
  check('no account appeared', !SB.enrolments['friend@filamer.edu.ph']);
  check('and a grand-sounding position changed nothing',
    Auth.isVolunteer() && !Auth.isExecutive());

  /* ---------------- refreshing the page ---------------- */
  console.log('\n--- the page is refreshed ---');
  await Auth.signIn('president@filamer.edu.ph', 'presidentpass');
  const stored = window.localStorage.getItem('fcusr.tracker.sb');
  check('the session is kept on the device, not only in memory', !!stored);
  check('with a refresh token to renew it', !!JSON.parse(stored || '{}').refresh);

  // What a reload does: the module's variables are gone, the storage is not.
  Backend.use('supabase');
  check('memory is cleared, as a reload would', !Backend.session());
  const back = await Backend.restore();
  check('the session is picked back up', !!back && back.email === 'president@filamer.edu.ph');
  check('and it is a real one — the calls are authorised',
    SB.requests[SB.requests.length - 1].auth);

  /* ---------------- the hour runs out ---------------- */
  console.log('\n--- the token expires mid-meeting ---');
  const live = Backend.session();
  const oldToken = live.token;
  // Both sides age: the server stops honouring it, and the client knows it is due.
  SB.tokens[oldToken].expiresAt = Date.now() - 1000;
  live.expiresAt = Date.now() - 1000;
  const after = await Backend.units();
  check('the request still succeeds', Array.isArray(after) && after.length === 2);
  check('because the token was exchanged, not reused',
    Backend.session().token !== oldToken);
  check('and nobody was signed out', !!Backend.session().token);

  /* ---------------- a dead refresh token ---------------- */
  console.log('\n--- the refresh token is revoked too ---');
  const s2 = Backend.session();
  SB.tokens[s2.token].expiresAt = Date.now() - 1000;
  s2.expiresAt = Date.now() - 1000;
  delete SB.refreshes[s2.refresh];
  const dead = await Backend.units().then(() => null, (e) => e.message);
  check('the app does not pretend it is still signed in', !Backend.session() || !!dead);

  /* ---------------- signing out ---------------- */
  console.log('\n--- signing out ---');
  await Auth.signIn('president@filamer.edu.ph', 'presidentpass');
  await Auth.signOut();
  check('nothing is left in storage', !window.localStorage.getItem('fcusr.tracker.sb'));
  check('and the app knows nobody is signed in', !Auth.signedIn() && !Backend.session());

  /* ---------------- the front door ---------------- */
  console.log('\n--- the gate ---');
  {
    const D = window.document;
    const view = () => D.getElementById('view');
    const txt = () => view().textContent.replace(/\s+/g, ' ');

    await Auth.signOut();
    window.App.render();
    check('signed out, the app shows the door instead', !!D.querySelector('.gate-card'), txt().slice(0, 60));
    check('and not the Overview', !/Needs attention/.test(txt()));
    check('the navigation goes with it', D.body.classList.contains('is-gated'));
    check('one form, not a choice of two', D.querySelectorAll('[data-mode]').length === 0);
    check('and it asks for both halves',
      !!D.querySelector('#gate-email') && !!D.querySelector('#gate-pass'));

    // A bad address never reaches the network.
    const before = SB.requests.length;
    D.querySelector('#gate-email').value = 'not-an-address';
    D.querySelector('#gate-pass').value = 'whatever';
    D.querySelector('.gate-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('a malformed address is caught here', SB.requests.length === before);
    check('and it says so', /does not look right/i.test(txt()), txt().slice(0, 80));

    /* ---- an address that has never had a password ----
       The door must not report this as a bad password: it must stop the person
       and make them set one, with no way past the dialog. */
    SB.enrolments['newbie@filamer.edu.ph'] = {
      full_name: 'Newbie Officer', position: 'Secretary',
      unit_id: CN, access: 'officer', event_ids: []
    };
    D.querySelector('#gate-email').value = 'newbie@filamer.edu.ph';
    D.querySelector('#gate-pass').value = 'whatever-they-typed';
    D.querySelector('.gate-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));

    const ftDialog = () => {
      const f = D.querySelector('#ft-a');
      return f ? f.closest('.modal-backdrop') : null;
    };
    const dlg = ftDialog();
    check('a first sign-in is stopped and asked for a password', !!dlg);
    check('and it is not signed in yet', !Auth.signedIn());
    check('it offers no corner to escape through', !dlg.querySelector('.modal-head [data-close]'));
    check('the dialog cannot be clicked away', (() => {
      dlg.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      return !!ftDialog();
    })());
    check('nor pressed away', (() => {
      D.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return !!ftDialog();
    })());

    // Too short, and the two must agree.
    D.querySelector('#ft-a').value = 'short';
    D.querySelector('#ft-b').value = 'short';
    dlg.querySelector('[data-go]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('a short password is refused', !SB.users['newbie@filamer.edu.ph']);
    D.querySelector('#ft-a').value = 'a-real-password';
    D.querySelector('#ft-b').value = 'a-real-passwrod';
    dlg.querySelector('[data-go]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('and so is a mistyped repeat', !SB.users['newbie@filamer.edu.ph']);

    D.querySelector('#ft-b').value = 'a-real-password';
    dlg.querySelector('[data-go]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    check('setting one claims the enrolment', !!SB.users['newbie@filamer.edu.ph']);
    check('and lets them straight in', Auth.signedIn() && Auth.current().name === 'Newbie Officer');
    check('the dialog is gone', !ftDialog());
    check('and so is the door', !D.querySelector('.gate-card'));

    // A wrong password on an address that DOES have one is still a wrong password.
    await Auth.signOut();
    window.App.render();
    D.querySelector('#gate-email').value = 'newbie@filamer.edu.ph';
    D.querySelector('#gate-pass').value = 'not-it';
    D.querySelector('.gate-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const dlg2 = ftDialog();
    D.querySelector('#ft-a').value = 'another-password';
    D.querySelector('#ft-b').value = 'another-password';
    dlg2.querySelector('[data-go]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    check('a claimed address cannot be re-claimed',
      SB.users['newbie@filamer.edu.ph'].password === 'a-real-password');
    check('and it says the address already has one',
      /already has a password/i.test(dlg2.querySelector('[data-err]').textContent));
    dlg2.querySelector('[data-close]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('closing it leaves you at the door, not inside',
      !Auth.signedIn() && !!D.querySelector('.gate-card'));

    // The real thing.
    D.querySelector('#gate-email').value = 'president@filamer.edu.ph';
    D.querySelector('#gate-pass').value = 'presidentpass';
    D.querySelector('.gate-go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    check('a good sign-in opens the app', Auth.signedIn());
    check('the door is gone', !D.querySelector('.gate-card'));
    check('and the navigation is back', !D.body.classList.contains('is-gated'));

    // Offline there is nothing to sign in to, so the door must not stand.
    const url = Backend.config.supabase.url;
    Backend.config.supabase.url = '';
    await Auth.signOut();
    window.App.render();
    check('with no backend the app opens straight in', !D.querySelector('.gate-card'));
    Backend.config.supabase.url = url;
  }

  /* ---------------- the anon key is never the credential ---------------- */
  console.log('\n--- what actually goes over the wire ---');
  check('every call carries the project key', SB.requests.length > 0);
  check('no password was ever sent to anything but the auth endpoint',
    SB.requests.filter((r) => /password|signup/.test(JSON.stringify(r)))
      .every((r) => r.url.indexOf('/auth/v1/') === 0));

  console.log('\n========================================');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('\nCRASHED: ' + e.message);
  console.log(e.stack);
  process.exit(1);
});
