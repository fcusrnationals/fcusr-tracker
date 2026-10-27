/* Push notifications, on a real (throwaway) Postgres.

       npm install pg                 (or NODE_PATH to a folder that has it)
       node tests/run-push-db.js

   Needs the PostgreSQL server binaries. Starts its own cluster in a temporary
   folder with stand-ins for Supabase's auth, roles, Vault, pg_cron and pg_net,
   applies every one of the council's SQL files in order and then push.sql, and
   drives it the way the app and the Edge Function do: tasks written as the
   signed-in officer through RLS, exactly as sync writes them. Nothing here can
   reach the live project. */
const P = require('./push/pg.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '   — ' + detail : '')); }
}

const U = {
  nat: null,
  officer: '11111111-1111-4111-8111-111111111111',     // Arron, national officer
  vol: '22222222-2222-4222-8222-222222222222',          // a volunteer
  other: '33333333-3333-4333-8333-333333333333',        // another officer
  pOfficer: 'a1111111-1111-4111-8111-111111111111',
  pVol: 'a2222222-2222-4222-8222-222222222222',
  pOther: 'a3333333-3333-4333-8333-333333333333',
  pNobody: 'a4444444-4444-4444-8444-444444444444',      // in the directory, no account
  pGone: 'a5555555-5555-4555-8555-555555555555',        // deactivated
  ev: 'e1111111-1111-4111-8111-111111111111',
  ev2: 'e2222222-2222-4222-8222-222222222222',
  evCancelled: 'e3333333-3333-4333-8333-333333333333'
};

(async () => {
  const pg = await P.start();
  const db = pg.db;
  const q = (text, params) => db.query(text, params);
  const one = async (text, params) => (await q(text, params)).rows[0];
  const as = async (uid, fn) => {
    await q('begin');
    try {
      await q("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
      await q(uid ? 'set local role authenticated' : 'set local role anon');
      const out = await fn();
      await q('commit');
      return out;
    } catch (e) { await q('rollback'); throw e; }
  };
  const tries = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

  try {
    console.log('\n--- push.sql goes on cleanly, twice ---');
    const first = [].concat(await pg.run(pg.sql('push.sql'))).pop().rows;
    check('every check passes on the first run', first.every((r) => r.done), JSON.stringify(first));
    const second = [].concat(await pg.run(pg.sql('push.sql'))).pop().rows;
    check('and on the second', second.every((r) => r.done));

    // ---------------------------------------------------------- the council
    U.nat = (await one("select id from units where code = 'NAT'")).id;
    for (const [id, email, name, access] of [
      [U.officer, 'arron@example.com', 'Arron', 'officer'],
      [U.vol, 'juan.delacruz@fcusr.invalid', 'Juan', 'volunteer'],
      [U.other, 'kyla@example.com', 'Kyla', 'officer']]) {
      await q('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      await q(`insert into profiles (id, email, full_name, position, unit_id, access, is_head)
               values ($1, $2, $3, 'Officer', $4, $5, $6)`, [id, email, name, U.nat, access, id === U.officer]);
    }
    const person = (id, name, email, active) => q(
      `insert into people (id, unit_id, name, active, body) values ($1::uuid, $2::uuid, $3::text, $5::boolean,
         jsonb_build_object('id', $1::text, 'name', $3::text, 'email', $4::text, 'unitId', $2::text,
                            'active', $5::boolean, 'updatedAt', '2026-10-01T00:00:00.000Z'))`,
      [id, U.nat, name, email, active]);
    await person(U.pOfficer, 'Arron', 'arron@example.com', true);
    await person(U.pVol, 'Juan', 'Juan.DelaCruz@fcusr.invalid', true);   // case differs on purpose
    await person(U.pOther, 'Kyla', 'kyla@example.com', true);
    await person(U.pNobody, 'Nobody', '', true);
    await person(U.pGone, 'Gone', 'gone@example.com', false);
    const event = (id, title, status) => q(
      `insert into events (id, unit_id, title, status, body) values ($1::uuid, $2::uuid, $3::text, $4::text,
         jsonb_build_object('id', $1::text, 'title', $3::text, 'unitId', $2::text, 'status', $4::text,
                            'updatedAt', '2026-10-01T00:00:00.000Z'))`, [id, U.nat, title, status]);
    await event(U.ev, 'Foundation Week', 'Upcoming');
    await event(U.ev2, 'Leadership Seminar', 'Upcoming');
    await event(U.evCancelled, 'Called off', 'Cancelled');

    let stamp = Date.parse('2026-10-02T00:00:00.000Z');
    const nextStamp = () => new Date(stamp += 60000).toISOString();
    const manilaToday = (await one("select (now() at time zone 'Asia/Manila')::date::text as d")).d;
    const day = (n) => { const d = new Date(manilaToday + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

    /* Exactly what sync sends: id, body and a few columns, upserted. The guard
       merges bodies and skips anything not newer. */
    const tasks = {};
    const save = async (actor, id, patch, keepStamp) => {
      const body = Object.assign({ id, kind: 'event', eventId: U.ev, title: 'Task ' + id.slice(0, 4),
        status: 'Not Started', priority: 'Medium', assigneeId: '', dueDate: '' }, tasks[id] || {}, patch);
      if (!keepStamp) body.updatedAt = nextStamp();
      tasks[id] = body;
      await as(actor, () => q(
        `insert into tasks (id, event_id, title, status, body) values ($1, $2, $3, $4, $5)
         on conflict (id) do update set event_id = excluded.event_id, title = excluded.title,
                                        status = excluded.status, body = excluded.body`,
        [id, body.eventId || null, body.title, body.status, body]));
    };
    const outbox = (task) => q('select * from push_outbox where task_id = $1 order by id', [task]).then((r) => r.rows);
    const pending = (task) => outbox(task).then((rows) => rows.filter((r) => !r.sent_at && !r.cancelled_at));
    const T = (n) => 'b' + String(n).padStart(7, '0') + '-0000-4000-8000-000000000000';

    console.log('\n--- what a task change says ---');
    await save(U.officer, T(1), { assigneeId: U.pVol, dueDate: day(5) });
    let rows = await pending(T(1));
    check('a task given to a volunteer tells the volunteer', rows.length === 1 && rows[0].kind === 'assigned' &&
      rows[0].profile_id === U.vol, JSON.stringify(rows.map((r) => [r.kind, r.profile_id])));
    check('it names who gave it', rows[0] && rows[0].detail.actor === 'Arron');
    check('the address matched even though its case differed', rows.length === 1);
    check('and it waits for the morning if it is night in Manila',
      (await one('select bool_and(not_before = push_not_before(created_at)) ok from push_outbox where task_id = $1', [T(1)])).ok);

    await save(U.officer, T(1), {}, true);   // the hourly round: same stamp, offered again
    check('the hourly re-offer of the same task says nothing new', (await outbox(T(1))).length === 1);
    await save(U.officer, T(1), { remarks: 'bring the banner' });
    check('an edit that changes nothing about who or when says nothing', (await outbox(T(1))).length === 1);

    await save(U.officer, T(2), { assigneeId: U.pOfficer });
    check('nobody is told about their own change', (await outbox(T(2))).length === 0);
    await save(U.officer, T(3), { assigneeId: U.pNobody });
    check('a directory entry with no account is told nothing', (await outbox(T(3))).length === 0);
    await save(U.officer, T(4), { assigneeId: U.pGone });
    check('nor is a deactivated one', (await outbox(T(4))).length === 0);
    await save(U.officer, T(5), { assigneeId: U.pVol, eventId: U.evCancelled });
    check('nothing is said about a task in a cancelled activity', (await outbox(T(5))).length === 0);
    await save(U.officer, T(6), { assigneeId: U.pVol, sample: true });
    check('nor about rehearsal data', (await outbox(T(6))).length === 0);

    console.log('\n--- moved, and given to somebody else ---');
    await save(U.officer, T(1), { dueDate: day(7) });
    rows = await pending(T(1));
    check('a new due date tells the holder it moved',
      rows.some((r) => r.kind === 'moved' && r.detail.change === 'due' && r.detail.due === day(7)),
      JSON.stringify(rows.map((r) => [r.kind, r.detail])));
    const beforeRepeat = (await outbox(T(1))).length;
    await save(U.officer, T(1), { dueDate: day(7) });
    check('the same move again is not said twice', (await outbox(T(1))).length === beforeRepeat);
    await save(U.officer, T(1), { eventId: U.ev2 });
    rows = await pending(T(1));
    check('moving it to another activity is said too',
      rows.some((r) => r.kind === 'moved' && r.detail.change === 'event'));
    check('and the earlier move that had not gone out is superseded',
      (await outbox(T(1))).some((r) => r.kind === 'moved' && r.cancel_reason === 'superseded'));
    await save(U.officer, T(1), { status: 'In Progress' });
    check('a status change is not a move', (await pending(T(1))).filter((r) => r.kind === 'moved').length === 1);

    await save(U.officer, T(1), { assigneeId: U.pOther });
    rows = await outbox(T(1));
    check('given to somebody else: the new holder is told',
      rows.some((r) => r.kind === 'assigned' && r.profile_id === U.other && !r.cancelled_at));
    check('and nothing still waiting goes to the old one',
      rows.filter((r) => r.profile_id === U.vol && !r.sent_at && !r.cancelled_at).length === 0,
      JSON.stringify(rows.map((r) => [r.kind, r.profile_id === U.vol, r.cancel_reason])));
    await save(U.officer, T(1), { status: 'Done' });
    check('done: nothing about it is left waiting', (await pending(T(1))).length === 0);

    await save(U.officer, T(7), { assigneeId: U.pVol });
    await q('delete from tasks where id = $1', [T(7)]);
    check('deleted: nothing about it is left waiting', (await pending(T(7))).length === 0);

    console.log('\n--- a fault in push can never stop a task from saving ---');
    const err = await tries(() => save(U.officer, T(8), { assigneeId: 'not-a-uuid', dueDate: 'soon' }));
    check('a task with a malformed assignee and date still saves', err === null && !!(await one('select id from tasks where id = $1', [T(8)])), err);
    await q('alter table push_outbox rename to push_outbox_away');
    const err2 = await tries(() => save(U.officer, T(9), { assigneeId: U.pVol }));
    await q('alter table push_outbox_away rename to push_outbox');
    check('even with the outbox missing entirely, the task saves', err2 === null &&
      !!(await one('select id from tasks where id = $1', [T(9)])), err2);

    console.log('\n--- the morning deadline reminders ---');
    await q("update push_outbox set cancelled_at = now(), cancel_reason = 'test reset' where sent_at is null and cancelled_at is null");
    await save(U.officer, T(10), { assigneeId: U.pVol, dueDate: day(1) });
    await save(U.officer, T(11), { assigneeId: U.pVol, dueDate: day(0) });
    await save(U.officer, T(12), { assigneeId: U.pVol, dueDate: day(-3) });
    await save(U.officer, T(13), { assigneeId: U.pVol, dueDate: day(-20) });
    await save(U.officer, T(14), { assigneeId: U.pVol, dueDate: day(2) });
    await save(U.officer, T(15), { assigneeId: U.pVol, dueDate: day(1), status: 'Done' });
    await save(U.officer, T(16), { assigneeId: U.pVol, dueDate: day(1), eventId: U.evCancelled });
    await save(U.officer, T(17), { assigneeId: U.pVol, dueDate: day(0) });
    await q("insert into deletions (entity, entity_id, deleted_by) values ('task', $1, 'test')", [T(17)]);
    const n1 = (await one('select push_enqueue_deadlines() n')).n;
    const kinds = async (t) => (await outbox(t)).filter((r) => r.kind !== 'assigned').map((r) => r.kind);
    check('due tomorrow', (await kinds(T(10))).join() === 'due_soon', (await kinds(T(10))).join());
    check('due today', (await kinds(T(11))).join() === 'due_today');
    check('overdue', (await kinds(T(12))).join() === 'overdue');
    check('long overdue is not nagged about', (await kinds(T(13))).length === 0);
    check('two days away is not yet', (await kinds(T(14))).length === 0);
    check('a done task gets no reminder', (await kinds(T(15))).length === 0);
    check('nor one in a cancelled activity', (await kinds(T(16))).length === 0);
    check('nor a deleted one', (await kinds(T(17))).length === 0);
    const n2 = (await one('select push_enqueue_deadlines() n')).n;
    check('running it again the same day says nothing new', n1 === 3 && n2 === 0, n1 + ' then ' + n2);

    console.log('\n--- phones: only your own ---');
    const ENDPOINT = (n) => 'https://push.example.test/send/' + n;
    const KEY = 'B' + 'A'.repeat(86), AUTH = 'a'.repeat(22);
    const anonErr = await tries(() => as(null, () => q("select push_subscribe($1, $2, $3, 'x', '{}')", [ENDPOINT(1), KEY, AUTH])));
    check('without signing in a phone cannot be added', !!anonErr, anonErr);
    const sub = await as(U.vol, () => one("select push_subscribe($1, $2, $3, 'Juan''s phone', $4) r",
      [ENDPOINT(1), KEY, AUTH, { details: 'yes', moved: false, junk: 1 }]));
    check('a volunteer can turn it on for their phone', !!(sub && sub.r && sub.r.id));
    check('nonsense preferences are cleaned, and task names stay off the lock screen',
      JSON.stringify(sub.r.prefs) === JSON.stringify({ due: true, moved: false, details: false, overdue: true, assigned: true }),
      JSON.stringify(sub.r.prefs));
    const theirs = await as(U.other, () => q('select * from push_subscriptions').then((r) => r.rows));
    check('another account cannot see it', theirs.length === 0);
    const viaDevices = await as(U.vol, () => q('select * from push_my_devices()').then((r) => r.rows));
    check('its owner sees it, without the keys', viaDevices.length === 1 && !('p256dh' in viaDevices[0]) && !('endpoint' in viaDevices[0]));
    const readOutbox = await tries(() => as(U.vol, () => q('select * from push_outbox')));
    check('the app cannot read the outbox', !!readOutbox, readOutbox);
    const claimErr = await tries(() => as(U.officer, () => q('select * from push_claim(10)')));
    check('nor claim it and send on its own', !!claimErr, claimErr);
    const vapidErr = await tries(() => as(null, () => q('select * from push_vapid()')));
    check('nor read the private key', !!vapidErr, vapidErr);
    const badEp = await tries(() => as(U.vol, () => q("select push_subscribe('http://insecure.example/x', $1, $2)", [KEY, AUTH])));
    check('a push address that is not https is refused', !!badEp);
    await as(U.other, () => q("select push_subscribe($1, $2, $3, 'shared laptop', '{}')", [ENDPOINT(1), KEY, AUTH]));
    check('a shared computer moves to whoever signed in last',
      (await one('select profile_id from push_subscriptions where endpoint = $1', [ENDPOINT(1)])).profile_id === U.other);
    await as(U.vol, () => q("select push_subscribe($1, $2, $3, 'Juan''s phone', '{\"details\":true}')", [ENDPOINT(1), KEY, AUTH]));
    await as(U.vol, () => q("select push_subscribe($1, $2, $3, 'Juan''s laptop', '{\"overdue\":false}')", [ENDPOINT(2), KEY, AUTH]));
    const pk = await as(null, () => one('select push_public_key() k'));
    check('the public key can be asked for by anybody (empty until the sender has run)', pk && pk.k === null);

    console.log('\n--- sending: claim, check, report ---');
    await q("select vault.create_secret('t0ken-t0ken-t0ken-t0ken-t0ken-t0ken-00', 'push_dispatch_token')");
    check('the dispatch token is checked', (await one("select push_check_token('t0ken-t0ken-t0ken-t0ken-t0ken-t0ken-00') ok")).ok &&
      !(await one("select push_check_token('wrong') ok")).ok && !(await one('select push_check_token(null) ok')).ok);
    // Make what is waiting due now, and break one of them before it is sent.
    await q('update push_outbox set not_before = now() - interval \'1 minute\' where sent_at is null and cancelled_at is null');
    await save(U.officer, T(10), { dueDate: day(4) });          // its "due tomorrow" is no longer true
    const claimed = (await q('select * from push_claim(100)')).rows;
    // The assignments those tasks made are claimed too; these checks are about the deadlines.
    const forTask = (t) => claimed.filter((r) => r.task_id === t && r.kind !== 'assigned');
    check('the claim returns one row per phone that wants it',
      forTask(T(11)).length === 2 && forTask(T(12)).length === 1,
      JSON.stringify(claimed.map((r) => [r.kind, r.task_id && r.task_id.slice(0, 8), r.subscription_id.slice(0, 4)])));
    check('a phone that turned overdue off does not get the overdue one',
      forTask(T(12)).every((r) => r.details === true));
    check('a line that is no longer true is not sent', forTask(T(10)).filter((r) => r.kind === 'due_soon').length === 0);
    check('and is closed with the reason',
      (await outbox(T(10))).some((r) => r.kind === 'due_soon' && r.cancel_reason === 'deadline changed'));
    check('the claim carries the current title and activity, for phones that show them',
      forTask(T(11))[0] && forTask(T(11))[0].task_title === 'Task ' + T(11).slice(0, 4) &&
      forTask(T(11))[0].event_title === 'Foundation Week');
    const again = (await q('select * from push_claim(100)')).rows;
    check('what is claimed cannot be claimed a second time meanwhile', again.length === 0, again.length);

    // Report: one delivered, one phone gone, one network failure.
    const a = forTask(T(11)).find((r) => r.endpoint === ENDPOINT(1));
    const b = forTask(T(11)).find((r) => r.endpoint === ENDPOINT(2));
    const c = forTask(T(12))[0];
    const rep = (await one('select push_report($1) r', [JSON.stringify([
      { outbox_id: a.outbox_id, subscription_id: a.subscription_id, status: 201 },
      { outbox_id: b.outbox_id, subscription_id: b.subscription_id, status: 0, error: 'timeout' },
      { outbox_id: c.outbox_id, subscription_id: c.subscription_id, status: 201 }])])).r;
    check('the report counts what happened', rep.delivered === 2 && rep.retrying === 1, JSON.stringify(rep));
    const o11 = await one('select * from push_outbox where id = $1', [a.outbox_id]);
    check('a line one phone missed is tried again later, not marked sent', !o11.sent_at && !o11.claimed_at &&
      new Date(o11.not_before) > new Date(), JSON.stringify(o11));
    const o12 = await one('select * from push_outbox where id = $1', [c.outbox_id]);
    check('a line every phone got is closed', !!o12.sent_at);
    await q('update push_outbox set not_before = now() where id = $1', [a.outbox_id]);
    const retry = (await q('select * from push_claim(100)')).rows;
    check('the retry goes only to the phone that missed it',
      retry.length === 1 && retry[0].subscription_id === b.subscription_id, JSON.stringify(retry.map((r) => r.endpoint)));
    await q('select push_report($1)', [JSON.stringify([{ outbox_id: retry[0].outbox_id, subscription_id: retry[0].subscription_id, status: 410 }])]);
    check('a phone the push service says is gone is forgotten',
      !(await one('select 1 x from push_subscriptions where endpoint = $1', [ENDPOINT(2)])));
    check('and the line is then complete', !!(await one('select sent_at from push_outbox where id = $1', [a.outbox_id])).sent_at);

    console.log('\n--- "send me a test" ---');
    const n = (await as(U.vol, () => one('select push_test() n'))).n;
    await as(U.vol, () => q('select push_test()'));
    check('a test goes to every phone of mine, once a minute at most', n === 1 &&
      (await one("select count(*)::int n from push_outbox where kind = 'test' and profile_id = $1", [U.vol])).n === 1);
    const nobodyTest = (await as(U.officer, () => one('select push_test() n'))).n;
    check('with no phone turned on there is nothing to test', nobodyTest === 0);

    console.log('\n--- the private key is kept once, in Vault ---');
    const pub = 'B' + 'x'.repeat(86);
    await q("select push_store_vapid($1, '{\"kty\":\"EC\",\"d\":\"secret\"}')", [pub]);
    await q("select push_store_vapid($1, '{\"kty\":\"EC\",\"d\":\"another\"}')", ['B' + 'y'.repeat(86)]);
    const v = await one('select * from push_vapid()');
    check('the first key is kept; a second one cannot replace it', v.public_key === pub && JSON.parse(v.private_jwk).d === 'secret');
    check('the public key is now handed to the app', (await as(null, () => one('select push_public_key() k'))).k === pub);
    check('the private key is in Vault, not in a table the app can reach',
      (await one("select count(*)::int n from vault.secrets where name = 'push_vapid_private'")).n === 1 &&
      !(await one("select 1 x from push_settings where value like '%secret%'")));

    console.log('\n--- scheduling, and switching it all off ---');
    await q("delete from vault.secrets where name = 'push_dispatch_token'");
    const sched = [].concat(await pg.run(pg.sql('push-schedule.sql'), (s) =>
      s.replace(/create extension if not exists pg_cron;/, '').replace(/create extension if not exists pg_net;/, ''))).pop().rows;
    check('the jobs and the secrets are in place (extensions stood in for here)',
      sched.filter((r) => !/pg_cron/.test(r.needed)).every((r) => r.done), JSON.stringify(sched));
    await pg.run(pg.sql('push-schedule.sql'), (s) => s.replace(/create extension if not exists pg_(cron|net);/g, ''));
    check('scheduling twice keeps one of each job', (await one('select count(*)::int n from cron.job')).n === 2);
    const job = await one("select command from cron.job where jobname = 'fcusr-push-dispatch'");
    check('the job reads its token from Vault and sends no other secret',
      /push_dispatch_token/.test(job.command) && !/secret_key|service_role|sb_secret/.test(job.command));
    await q(job.command);
    const req = await one('select * from net.requests order by id desc limit 1');
    check('it calls push-dispatch on this project', req.url === 'https://wjpsztvvuplppzswnrdx.supabase.co/functions/v1/push-dispatch');
    check('with a 64-character random token', /^[0-9a-f]{64}$/.test(req.headers['x-dispatch-token']));
    check('and that token is accepted', (await one('select push_check_token($1) ok', [req.headers['x-dispatch-token']])).ok);

    const off = [].concat(await pg.run(pg.sql('push-off.sql'))).pop().rows;
    check('push-off.sql switches everything off', off.every((r) => r.done) && (await one('select count(*)::int n from cron.job')).n === 0);
    await save(U.officer, T(20), { assigneeId: U.pVol });
    check('with it off, a task change writes nothing', (await outbox(T(20))).length === 0);
    check('and nothing is left waiting',
      (await one('select count(*)::int n from push_outbox where sent_at is null and cancelled_at is null')).n === 0);
    await pg.run(pg.sql('push.sql'));
    await save(U.officer, T(20), { assigneeId: U.pOther });
    check('push.sql switches it back on', (await pending(T(20))).length === 1);
  } catch (e) {
    fail++; failures.push('crashed: ' + e.message);
    console.log('  FAIL  crashed: ' + e.stack);
  } finally {
    await pg.stop();
  }
  console.log('\n========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  FAILED: ' + failures.join('\n  FAILED: ')); process.exit(1); }
})();
