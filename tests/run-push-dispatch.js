/* The push-dispatch Edge Function, run for real.

       npm install pg http_ece deno   (or NODE_PATH / PATH to where they are)
       node tests/run-push-dispatch.js

   Needs PostgreSQL server binaries, openssl and Deno. Starts a throwaway
   database with the council's SQL and push.sql on it, a local HTTPS server
   standing in for the browsers' push services (Google's, Mozilla's, Apple's),
   and runs the real supabase/functions/push-dispatch/index.ts under Deno, the
   way the cron job calls it.

   What arrives at the push service is checked the way a browser would check
   it, with code that shares nothing with the sender: the VAPID signature is
   verified against the public key the app is given, and the message is
   decrypted with http_ece (RFC 8188/8291) using the "phone's" own private key.
   Nothing here reaches the live project or any real push service. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const P = require('./push/pg.js');

let ece;
try { ece = require('http_ece'); } catch (e) {
  console.error('This suite needs http_ece: npm install http_ece (or set NODE_PATH).');
  process.exit(1);
}

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '   — ' + detail : '')); }
}

function findDeno() {
  const local = [process.env.DENO_BIN, path.join(os.homedir(), '.fcusr-tools', 'node_modules', '.bin', 'deno'),
    path.join(__dirname, '..', 'node_modules', '.bin', 'deno')].filter(Boolean);
  for (const p of local) if (fs.existsSync(p)) return p;
  try { return execFileSync('which', ['deno']).toString().trim(); } catch (e) { return null; }
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

(async () => {
  const deno = findDeno();
  if (!deno) { console.error('Deno is needed: npm install deno, or put deno on PATH.'); process.exit(1); }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fcusr-push-fn-'));
  /* A certificate for the stand-in push service, trusted by this run only: a
     throwaway authority and a server certificate signed by it (Deno will not
     accept a self-signed certificate used directly by a server). */
  const ossl = (args) => execFileSync('openssl', args, { stdio: 'pipe', cwd: work });
  ossl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'ca-key.pem',
    '-out', 'ca-cert.pem', '-days', '1', '-subj', '/CN=fcusr test authority',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  ossl(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem',
    '-out', 'leaf.csr', '-subj', '/CN=localhost']);
  fs.writeFileSync(path.join(work, 'leaf.ext'),
    'basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  ossl(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca-cert.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial',
    '-out', 'cert.pem', '-days', '1', '-extfile', 'leaf.ext']);
  const bundle = path.join(work, 'ca.pem');
  const extra = [process.env.DENO_CERT, '/etc/ssl/certs/ca-certificates.crt'].filter((f) => f && fs.existsSync(f));
  fs.writeFileSync(bundle, extra.map((f) => fs.readFileSync(f, 'utf8')).join('\n') + '\n' +
    fs.readFileSync(path.join(work, 'ca-cert.pem'), 'utf8'));

  // ------------------------------------------------ the stand-in push service
  const received = [];
  const behaviour = {};                // endpoint path → status to answer
  const server = https.createServer({ key: fs.readFileSync(path.join(work, 'key.pem')),
    cert: fs.readFileSync(path.join(work, 'cert.pem')) }, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = behaviour[req.url] || 201;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ep = (name) => 'https://localhost:' + server.address().port + '/push/' + name;

  // A "phone": its own key pair and auth secret, as a browser makes them.
  const phone = (name) => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = crypto.randomBytes(16);
    return { name, ecdh, auth, endpoint: ep(name), p256dh: b64u(ecdh.getPublicKey()), authB64: b64u(auth) };
  };
  const open = (msg, ph) => JSON.parse(ece.decrypt(msg.body, {
    version: 'aes128gcm', privateKey: ph.ecdh, authSecret: ph.auth }).toString('utf8'));

  const pg = await P.start();
  const db = pg.db;
  const q = (t, p) => db.query(t, p);
  const one = async (t, p) => (await q(t, p)).rows[0];
  const TOKEN = crypto.randomBytes(32).toString('hex');

  const runFn = (method, token) => new Promise((resolve) => {
    const env = Object.assign({}, process.env, { SUPABASE_DB_URL: pg.url, NO_COLOR: '1' });
    const p = spawn(deno, ['run', '--quiet', '--allow-net', '--allow-env', '--allow-read', '--cert', bundle,
      path.join(__dirname, 'push', 'run-function.ts'), method, token || ''], { env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const line = out.split('\n').find((l) => l.indexOf('RESULT ') === 0);
      resolve({ result: line ? JSON.parse(line.slice(7)) : null, log: out + err });
    });
  });

  try {
    await pg.run(pg.sql('push.sql'));
    await q("select vault.create_secret($1, 'push_dispatch_token')", [TOKEN]);

    // The council: one officer, one volunteer with two phones.
    const nat = (await one("select id from units where code = 'NAT'")).id;
    const officer = '11111111-1111-4111-8111-111111111111', vol = '22222222-2222-4222-8222-222222222222';
    const pVol = 'a2222222-2222-4222-8222-222222222222', ev = 'e1111111-1111-4111-8111-111111111111';
    for (const [id, email, name] of [[officer, 'arron@example.com', 'Arron'], [vol, 'juan@fcusr.invalid', 'Juan']]) {
      await q('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      await q("insert into profiles (id, email, full_name, position, unit_id, access) values ($1, $2, $3, 'Officer', $4, 'officer')",
        [id, email, name, nat]);
    }
    await q(`insert into people (id, unit_id, name, active, body) values ($1::uuid, $2::uuid, 'Juan', true,
             jsonb_build_object('id', $1::text, 'email', 'juan@fcusr.invalid', 'name', 'Juan'))`, [pVol, nat]);
    await q(`insert into events (id, unit_id, title, status, body) values ($1::uuid, $2::uuid, 'Foundation Week', 'Upcoming',
             jsonb_build_object('id', $1::text, 'title', 'Foundation Week', 'status', 'Upcoming'))`, [ev, nat]);
    let stamp = Date.parse('2026-10-02T00:00:00Z');
    const save = async (id, body) => {
      body = Object.assign({ id, kind: 'event', eventId: ev, status: 'Not Started', updatedAt: new Date(stamp += 60000).toISOString() }, body);
      await q('begin');
      await q("select set_config('request.jwt.claim.sub', $1, true)", [officer]);
      await q('set local role authenticated');
      await q(`insert into tasks (id, event_id, title, status, body) values ($1, $2, $3, $4, $5)
               on conflict (id) do update set body = excluded.body, title = excluded.title, status = excluded.status`,
        [id, ev, body.title, body.status, body]);
      await q('commit');
    };
    const subscribe = async (ph, prefs) => {
      await q('begin');
      await q("select set_config('request.jwt.claim.sub', $1, true)", [vol]);
      await q('set local role authenticated');
      await q('select push_subscribe($1, $2, $3, $4, $5)', [ph.endpoint, ph.p256dh, ph.authB64, ph.name, prefs || {}]);
      await q('commit');
    };
    const dueNow = () => q("update push_outbox set not_before = now() - interval '1 second' where sent_at is null and cancelled_at is null");

    console.log('\n--- only the cron job may knock ---');
    let r = await runFn('GET', TOKEN);
    check('anything but POST is refused', r.result && r.result.status === 405, r.log.slice(0, 300));
    r = await runFn('POST', '');
    check('no token: refused', r.result && r.result.status === 401, r.log.slice(0, 300));
    r = await runFn('POST', 'f'.repeat(64));
    check('the wrong token: refused', r.result && r.result.status === 401);
    check('and a refused knock makes no key and sends nothing', !(await one('select push_public_key() k')).k && received.length === 0);

    console.log('\n--- the first run makes the key; the lock screen stays private ---');
    const pocket = phone('pocket');
    await subscribe(pocket);                                     // details off: the default
    await save('b0000001-0000-4000-8000-000000000000', { title: 'Book the gymnasium', assigneeId: pVol, dueDate: '2026-11-03' });
    await dueNow();
    r = await runFn('POST', TOKEN);
    check('the knock with the token is answered', r.result && r.result.status === 200, r.log.slice(0, 400));
    const pub = (await one('select push_public_key() k')).k;
    check('the push key was made on the first run, and its public half is handed to the app', /^[A-Za-z0-9_-]{87}$/.test(pub || ''), pub);
    check('its private half is in Vault only',
      (await one("select count(*)::int n from vault.secrets where name = 'push_vapid_private'")).n === 1);
    check('one message reached the push service', received.length === 1, received.length);
    const m1 = received[0];
    check('encrypted the standard way', m1 && m1.headers['content-encoding'] === 'aes128gcm' && Number(m1.headers.ttl) > 0);

    // The VAPID signature, verified the way a push service verifies it.
    const auth = (m1.headers.authorization || '').match(/^vapid t=([^,]+), k=(.+)$/);
    check('it is signed with VAPID', !!auth, m1.headers.authorization);
    if (auth) {
      const [h, p, s] = auth[1].split('.');
      const claims = JSON.parse(unb64u(p));
      const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(unb64u(pub).slice(1, 33)), y: b64u(unb64u(pub).slice(33)) }, format: 'jwk' });
      check('the signature verifies against the key the app is given', auth[2] === pub &&
        crypto.verify('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' }, unb64u(s)));
      check('for this push service, naming the council site as contact',
        claims.aud === 'https://localhost:' + server.address().port && claims.sub === 'https://fcusrnationals.github.io/fcusr-tracker/' &&
        claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600 + 5, JSON.stringify(claims));
    }
    let msg = m1 && open(m1, pocket);
    check('the phone can decrypt it', !!msg && msg.v === 1, JSON.stringify(msg));
    check('the lock screen is told only that there is a new task',
      msg && msg.title === 'You have a new task' && !/gymnasium/i.test(JSON.stringify(msg)), JSON.stringify(msg));
    check('tapping it opens that task', msg && msg.url === './#/task/b0000001-0000-4000-8000-000000000000');
    check('the log carries counts, never a task name', !/gymnasium/i.test(r.log), r.log);

    r = await runFn('POST', TOKEN);
    check('a second run sends nothing more', received.length === 1 && r.result.body.lines === 0, JSON.stringify(r.result));
    const pub2 = (await one('select push_public_key() k')).k;
    check('and keeps the same key, so no phone is silenced', pub2 === pub);

    console.log('\n--- a phone that chose to show task names ---');
    const desk = phone('desk');
    await subscribe(desk, { details: true });
    await q("update push_subscriptions set prefs = prefs || '{\"assigned\":false}' where endpoint = $1", [pocket.endpoint]);
    await save('b0000002-0000-4000-8000-000000000000', { title: 'Print the programme', assigneeId: pVol, dueDate: '2026-11-04' });
    await dueNow();
    received.length = 0;
    await runFn('POST', TOKEN);
    check('it reaches only the phone that still wants new tasks', received.length === 1 && received[0].path === '/push/desk',
      received.map((x) => x.path).join());
    msg = received[0] && open(received[0], desk);
    check('with the task, where it is, and when', msg && msg.title === 'New task: Print the programme' &&
      /Foundation Week/.test(msg.body) && /Nov 4/.test(msg.body) && /Arron/.test(msg.body), JSON.stringify(msg));

    console.log('\n--- several at once are one notification ---');
    await q("update push_subscriptions set prefs = prefs || '{\"assigned\":true}' where endpoint = $1", [pocket.endpoint]);
    for (let i = 3; i <= 5; i++) {
      await save('b000000' + i + '-0000-4000-8000-000000000000', { title: 'Task ' + i, assigneeId: pVol });
    }
    await dueNow();
    received.length = 0;
    r = await runFn('POST', TOKEN);
    check('three new tasks: one push per phone', received.length === 2, received.length);
    const sp = received.find((x) => x.path === '/push/pocket');
    msg = sp && open(sp, pocket);
    check('saying how many, and opening My tasks', msg && msg.title === 'You have 3 new tasks' && msg.url === './#/my-tasks', JSON.stringify(msg));
    check('every line is closed after it', (await one('select count(*)::int n from push_outbox where sent_at is null and cancelled_at is null')).n === 0);

    console.log('\n--- a phone that has gone, and one that is down ---');
    behaviour['/push/pocket'] = 410;
    behaviour['/push/desk'] = 503;
    await save('b0000006-0000-4000-8000-000000000000', { title: 'Task 6', assigneeId: pVol });
    await dueNow();
    received.length = 0;
    r = await runFn('POST', TOKEN);
    check('both were tried', received.length === 2, JSON.stringify(r.result));
    check('the gone phone is forgotten', !(await one('select 1 x from push_subscriptions where endpoint = $1', [pocket.endpoint])));
    const o6 = await one("select * from push_outbox where task_id = 'b0000006-0000-4000-8000-000000000000'");
    check('the one that is down is tried again later', !o6.sent_at && !o6.cancelled_at && new Date(o6.not_before) > new Date(), JSON.stringify(o6));
    delete behaviour['/push/desk'];
    await dueNow();
    received.length = 0;
    await runFn('POST', TOKEN);
    check('and gets it once it is back', received.length === 1 && received[0].path === '/push/desk');
    check('after which the line is closed', !!(await one("select sent_at from push_outbox where task_id = 'b0000006-0000-4000-8000-000000000000'")).sent_at);

    console.log('\n--- a test from the Notifications sheet ---');
    await q('begin');
    await q("select set_config('request.jwt.claim.sub', $1, true)", [vol]);
    await q('set local role authenticated');
    await q('select push_test()');
    await q('commit');
    received.length = 0;
    r = await runFn('POST', TOKEN);
    msg = received[0] && open(received[0], desk);
    check('arrives at once and says it works', msg && msg.title === 'Notifications are working', JSON.stringify(msg));
  } catch (e) {
    fail++; failures.push('crashed: ' + e.message);
    console.log('  FAIL  crashed: ' + e.stack);
  } finally {
    server.close();
    await pg.stop();
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log('\n========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  FAILED: ' + failures.join('\n  FAILED: ')); process.exit(1); }
})();
