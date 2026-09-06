/* Syncing, driven as two phones against one server.

       node tests/run-sync.js

   Two independent copies of the app — separate windows, separate localStorage,
   exactly as two officers' phones are — talking to a fake server that behaves
   the way PostgREST does: rows keyed by id, filtered by `updated_at` greater
   than a mark, upserts that merge.

   The questions worth answering here are not "does a request get sent". They
   are: does an edit made in a corridor reach the other phone; does a deletion
   stay deleted; when two people edit the same task, is the outcome one anybody
   would defend; and does a device that has been offline for a week come back
   without losing its own work. Those cannot be answered by looking at source.
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

const FILES = [
  'assets/js/util.js', 'assets/js/store.js', 'assets/js/sync.js'
];

/* ---------------- the server ----------------
   Rows in tables, and the three behaviours the sync layer actually leans on:
   `updated_at=gt.X` ordered ascending, upsert-by-id, delete-by-id. Its clock is
   its own and deliberately ahead of both devices, because a phone with a wrong
   watch is the failure this design is meant to survive. */
// What each table actually has, taken from backend/supabase/sync.sql.
const COLUMNS = {
  people:    ['id', 'unit_id', 'name', 'active', 'body', 'updated_at'],
  events:    ['id', 'unit_id', 'title', 'status', 'body', 'updated_at'],
  tasks:     ['id', 'event_id', 'title', 'status', 'body', 'updated_at'],
  reports:   ['id', 'event_id', 'drive_link', 'drive_owned', 'status', 'body', 'updated_at'],
  letters:   ['id', 'unit_id', 'subject', 'status', 'stops', 'internal', 'body', 'updated_at'],
  offices:   ['id', 'code', 'name', 'active', 'body', 'updated_at'],
  deletions: ['entity', 'entity_id', 'unit_id', 'deleted_at', 'deleted_by'],
  term:      ['id', 'end_date', 'body', 'updated_at'],
  units:     ['id', 'name', 'code', 'kind', 'tracker_name', 'active', 'body', 'updated_at'],
  council:   ['id', 'body', 'updated_at']
};

function makeServer() {
  const tables = { people: {}, events: {}, tasks: {}, reports: {}, letters: {},
                   offices: {}, deletions: {}, term: {}, units: {}, council: {} };
  let tick = 0;
  const now = () => {
    tick += 1;
    return new Date(Date.UTC(2026, 8, 6, 12, 0, 0) + tick * 1000).toISOString();
  };
  return {
    tables,
    now,
    requests: [],
    /* Refuses what PostgREST refuses. It used to be helpful — it knew that a
       deletion is timed by `deleted_at` and quietly used the right column
       whatever it was asked for. The client was asking for `updated_at`, which
       the real table does not have, so every pull of deletions failed with a
       400 while these tests passed: a deleted task came back on every other
       phone, for ever, and nothing anywhere said so. A stand-in that is kinder
       than the real thing is worse than no stand-in at all. */
    changed(table, since, limit, column) {
      const key = column || 'updated_at';
      this.requests.push({ op: 'changed', table, since, key });
      const cols = COLUMNS[table] || [];
      if (cols.indexOf(key) < 0) {
        const e = new Error('column ' + table + '.' + key + ' does not exist');
        e.status = 400;
        return Promise.reject(e);
      }
      return Promise.resolve(Object.keys(tables[table] || {})
        .map((k) => tables[table][k])
        .filter((r) => !since || String(r[key]) > String(since))
        .sort((a, b) => String(a[key]).localeCompare(String(b[key]))));
    },
    upsert(table, rows) {
      this.requests.push({ op: 'upsert', table, n: rows.length });
      rows.forEach((r) => {
        // The server stamps its own clock on arrival, exactly as a database does.
        const key = table === 'deletions' ? r.entity + ':' + r.entity_id : r.id;
        /* A deep copy, because a real server does not share memory with the
           client. Storing the row by reference let a later edit on the device
           appear to have been uploaded when nothing had been sent — the test
           agreeing with the code because they were the same object. */
        const stamped = JSON.parse(JSON.stringify(r));
        if (table === 'deletions') stamped.deleted_at = now();
        else stamped.updated_at = now();
        tables[table][key] = stamped;
      });
      return Promise.resolve([]);
    },
    remove(table, ids) {
      this.requests.push({ op: 'remove', table, n: ids.length });
      ids.forEach((id) => { delete tables[table][id]; });
      return Promise.resolve(null);
    },
    serverNow() { return Promise.resolve(now()); },
    /* The unit list as PostgREST would answer it: whatever has been written to
       the table, plus the National unit every council starts with. */
    units() {
      const rows = Object.keys(tables.units).map((k) => tables.units[k]);
      if (rows.length) return Promise.resolve(rows);
      return Promise.resolve([
        { id: '11111111-1111-4111-8111-111111111111', code: 'NAT', name: 'FCUSR Nationals', kind: 'national' }
      ]);
    }
  };
}

/* ---------------- a phone ---------------- */
function makeDevice(server, name) {
  const vc = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body><div id="view"></div></body></html>', {
    url: 'http://localhost/index.html', runScripts: 'dangerously',
    virtualConsole: vc, pretendToBeVisual: true
  });
  const w = dom.window;
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));

  FILES.forEach((f) => {
    const s = w.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    w.document.head.appendChild(s);
  });

  // app.js normally does this at boot; these devices load the store alone.
  w.Store.load();

  // Signed in as a national officer, with the server standing in for Supabase.
  w.Auth = {
    isOffline: () => false,
    signedIn: () => true,
    current: () => ({ name: name, email: name + '@filamer.edu.ph' }),
    myUnitId: () => w.Store.nationalUnitId()
  };
  w.Backend = {
    changed: (t, s2, l, c) => server.changed(t, s2, l, c),
    upsert: (t, r) => server.upsert(t, r),
    remove: (t, i) => server.remove(t, i),
    serverNow: () => server.serverNow(),
    units: () => server.units()
  };

  return { w, S: w.Store, Sync: w.Sync, name, errors };
}

(async function main() {
  const server = makeServer();
  const A = makeDevice(server, 'Althea');
  const B = makeDevice(server, 'Bea');

  const natA = A.S.nationalUnitId();

  console.log('--- identity ---');
  const ev = A.S.addEvent({ title: 'Leadership Summit', unitId: natA, dateStart: '2026-10-01' });
  check('a new record gets a uuid', A.w.U.isUuid(ev.id), ev.id);
  check('so does a task', A.w.U.isUuid(A.S.addTask({ eventId: ev.id, title: 'Book the hall' }).id));

  /* Ids from before this existed have to be carried over, references and all —
     a task pointing at an event id that no longer exists is a task nobody can
     find, and it would happen to every record the council already had. */
  console.log('\n--- data saved before uuids ---');
  {
    const old = JSON.parse(A.S.toJSON());
    const d = old.data;
    d.events = [{ id: 'evt_old1', unitId: natA, title: 'Old Assembly', status: 'Upcoming',
                  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }];
    d.tasks = [{ id: 'tsk_old1', eventId: 'evt_old1', title: 'Old task', status: 'Not Started',
                 createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }];
    d.reports = [{ id: 'rep_old1', eventId: 'evt_old1',
                   createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }];
    A.S.fromJSON(JSON.stringify(old));

    const e2 = A.S.events()[0];
    const t2 = A.S.tasks()[0];
    check('an old id becomes a uuid', A.w.U.isUuid(e2.id), e2.id);
    check('and its task followed it', t2.eventId === e2.id, t2.eventId + ' vs ' + e2.id);
    check('so did its report', A.S.report(e2.id) !== null);
    check('nothing was orphaned', A.S.tasks().every((t) => !!A.S.event(t.eventId)));
  }

  /* ---------------- one way ---------------- */
  console.log('\n--- what one phone does reaches the other ---');
  A.S.fromJSON(JSON.stringify({ data: { units: A.S.units(), offices: A.S.offices(),
    people: [], events: [], tasks: [], reports: [], letters: [] } }));
  B.S.fromJSON(JSON.stringify({ data: { units: B.S.units(), offices: B.S.offices(),
    people: [], events: [], tasks: [], reports: [], letters: [] } }));

  const summit = A.S.addEvent({ title: 'General Assembly', unitId: A.S.nationalUnitId() });
  const task = A.S.addTask({ eventId: summit.id, title: 'Reserve the gym', priority: 'High' });

  await A.Sync.now();
  check('the event was sent', !!server.tables.events[summit.id]);
  check('and the task with it', !!server.tables.tasks[task.id]);
  check('the whole record travels, not just its columns',
    server.tables.events[summit.id].body.title === 'General Assembly');

  await B.Sync.now();
  check('the other phone has the event', !!B.S.event(summit.id), B.S.events().length + ' events');
  check('and the task', !!B.S.task(task.id));
  check('with its priority intact', B.S.task(task.id).priority === 'High');

  /* ---------------- both ways ---------------- */
  console.log('\n--- and back again ---');
  B.S.updateTask(task.id, { status: 'Done' });
  await B.Sync.now();
  await A.Sync.now();
  check('a change made on the second phone comes back', A.S.task(task.id).status === 'Done');

  /* ---------------- the same task, twice ---------------- */
  console.log('\n--- two people, one task ---');
  A.S.updateTask(task.id, { remarks: 'Althea got the gym' });
  await new Promise((r) => setTimeout(r, 5));
  B.S.updateTask(task.id, { remarks: 'Bea booked the AVR' });

  await A.Sync.now();
  await B.Sync.now();
  await A.Sync.now();
  check('both phones end up saying the same thing',
    A.S.task(task.id).remarks === B.S.task(task.id).remarks,
    A.S.task(task.id).remarks + ' / ' + B.S.task(task.id).remarks);
  check('and it is the later edit that stands',
    A.S.task(task.id).remarks === 'Bea booked the AVR', A.S.task(task.id).remarks);

  /* ---------------- deleting ----------------
     The one that goes wrong quietly. A phone that still holds a deleted record
     sees it missing from the server, decides the server is behind, and puts it
     back — so the record returns days later with no explanation. */
  console.log('\n--- a deletion stays deleted ---');
  const doomed = A.S.addTask({ eventId: summit.id, title: 'Print the tarpaulin' });
  await A.Sync.now();
  await B.Sync.now();
  check('both phones have it', !!A.S.task(doomed.id) && !!B.S.task(doomed.id));

  A.S.deleteTask(doomed.id);
  await A.Sync.now();
  check('it is gone from the server', !server.tables.tasks[doomed.id]);
  check('and the deletion was recorded', !!server.tables.deletions['task:' + doomed.id]);

  await B.Sync.now();
  check('the other phone drops it too', !B.S.task(doomed.id));

  await B.Sync.now();
  await A.Sync.now();
  await B.Sync.now();
  check('and it does not come back', !A.S.task(doomed.id) && !B.S.task(doomed.id));

  /* Deleting an event takes its tasks with it, on every device. */
  console.log('\n--- deleting an event takes its work with it ---');
  const scrapped = A.S.addEvent({ title: 'Cancelled Fun Run', unitId: A.S.nationalUnitId() });
  const under = A.S.addTask({ eventId: scrapped.id, title: 'Order the medals' });
  await A.Sync.now(); await B.Sync.now();
  check('the second phone has both', !!B.S.event(scrapped.id) && !!B.S.task(under.id));

  A.S.deleteEvent(scrapped.id);
  await A.Sync.now(); await B.Sync.now();
  check('the event is gone from both', !A.S.event(scrapped.id) && !B.S.event(scrapped.id));
  check('and so is the task under it', !B.S.task(under.id));

  /* ---------------- a week in a drawer ---------------- */
  console.log('\n--- a phone that was offline all week ---');
  const offlineEvent = B.S.addEvent({ title: 'Recollection', unitId: B.S.nationalUnitId() });
  const offlineTask = B.S.addTask({ eventId: offlineEvent.id, title: 'Book the retreat house' });
  // Meanwhile the other phone carried on.
  const meanwhile = A.S.addEvent({ title: 'Sportsfest', unitId: A.S.nationalUnitId() });
  await A.Sync.now();

  await B.Sync.now();
  check('nothing it made while away was lost',
    !!B.S.event(offlineEvent.id) && !!B.S.task(offlineTask.id));
  check('and it caught up on what it missed', !!B.S.event(meanwhile.id));
  await A.Sync.now();
  check('its work reached the others', !!A.S.event(offlineEvent.id));

  /* ---------------- letters ---------------- */
  console.log('\n--- letters carry their whole trail ---');
  const letter = A.S.addLetter({
    subject: 'Request for the gymnasium', unitId: A.S.nationalUnitId(),
    route: [{ officeId: A.S.officeByCode('PRES').id }, { label: 'Sen. Kyla Villanueva' }]
  });
  A.S.receiveStop(letter.id, letter.stops[0].id, { receivedBy: 'Mrs. Ferrer' });
  await A.Sync.now(); await B.Sync.now();
  const there = B.S.letter(letter.id);
  check('the letter arrived', !!there);
  check('with both signatories', there && there.stops.length === 2);
  check('the office one by office', there && there.stops[0].officeId === A.S.officeByCode('PRES').id);
  check('the person one by name', there && there.stops[1].label === 'Sen. Kyla Villanueva');
  check('and who received it', there && there.stops[0].receivedBy === 'Mrs. Ferrer');

  /* ---------------- offline is not an error ---------------- */
  console.log('\n--- no server, no complaints ---');
  {
    const C = makeDevice(server, 'Carlo');
    C.w.Auth.isOffline = () => true;
    const before = server.requests.length;
    const st = await C.Sync.now();
    check('an offline device does not call out', server.requests.length === before);
    check('and reports no error', !st.error, st.error);
    check('it just says it cannot sync', st.able === false);
  }

  /* ---------------- a server that is down ---------------- */
  console.log('\n--- a server that will not answer ---');
  {
    const wasChanged = A.w.Backend.changed;
    A.w.Backend.changed = () => Promise.reject(new Error('Failed to fetch'));
    const before = A.S.events().length;
    const st = await A.Sync.now();
    check('the failure is caught, not thrown', !!st.error, st.error);
    check('and nothing on the device was lost', A.S.events().length === before);
    A.w.Backend.changed = wasChanged;
    const ok = await A.Sync.now();
    check('the next round recovers', !ok.error, ok.error);
  }

  /* ---------------- it must not chase its own tail ----------------
     The sync layer listens for changes so it can send them, and a sync that
     ends by announcing a change schedules the next one. That loop is invisible
     in every screenshot and would run every few seconds on every phone for as
     long as the app is open. */
  console.log('\n--- syncing does not trigger syncing ---');
  {
    let woke = 0;
    A.S.subscribe(() => { woke += 1; });

    await A.Sync.now();
    check('a round that changed nothing wakes no view', woke === 0, woke + ' wake-ups');

    const fresh = B.S.addEvent({ title: 'Officers\u2019 Retreat', unitId: B.S.nationalUnitId() });
    await B.Sync.now();
    woke = 0;
    await A.Sync.now();
    check('but one that brought something in does', woke > 0);
    check('and it arrived', !!A.S.event(fresh.id));

    woke = 0;
    await A.Sync.now();
    check('and the round after that is quiet again', woke === 0, woke + ' wake-ups');
  }

  /* ---------------- the server owns the clock ----------------
     `updated_at` is what a pull filters on, so every row must be stamped by one
     clock. The fake server above stamps its own — as Postgres does with the
     trigger the migration installs — and this holds the client to never sending
     one, because for a while it did, and two phones with watches a few minutes
     apart would then have quietly stopped seeing each other's work. */
  console.log('\n--- the clock belongs to the server ---');
  {
    const row = A.Sync.toRow('event', {
      id: '22222222-2222-4222-8222-222222222222', title: 'X',
      unitId: natA, updatedAt: '2099-01-01T00:00:00.000Z'
    });
    check('a pushed row carries no timestamp of its own',
      !('updated_at' in row), JSON.stringify(Object.keys(row)));
    check('but the edit time travels inside the record',
      row.body.updatedAt === '2099-01-01T00:00:00.000Z');

    // And a device whose watch is wrong still receives everything.
    const fast = makeDevice(server, 'Fast');
    const realNow = Date.now;
    fast.w.Date.now = () => realNow() + 9 * 60 * 1000;   // nine minutes fast
    const seen = A.S.addEvent({ title: 'Clock Test', unitId: natA });
    await A.Sync.now();
    await fast.Sync.now();
    check('a phone with a wrong clock still gets what it missed', !!fast.S.event(seen.id));
    fast.w.Date.now = realNow;
  }

  /* ---------------- the tombstone table is timed differently ---------------- */
  console.log('\n--- deletions are asked for by their own clock ---');
  {
    const asked = server.requests.filter((r) => r.op === 'changed' && r.table === 'deletions');
    check('the deletions pull happened', asked.length > 0);
    check('and asked on deleted_at, which is the column it has',
      asked.every((r) => r.key === 'deleted_at'),
      JSON.stringify(asked.slice(-1)));
    check('while everything else is asked on updated_at',
      server.requests.filter((r) => r.op === 'changed' && r.table !== 'deletions')
        .every((r) => r.key === 'updated_at'));
  }

  /* A pull that fails must be reported, not swallowed. It was swallowed, which
     is how a deletion that never propagated looked exactly like one that did. */
  console.log('\n--- a refused pull is not silence ---');
  {
    const real = A.w.Backend.changed;
    A.w.Backend.changed = (t, s2, l, c) => {
      if (t === 'deletions') {
        const e = new Error('column deletions.updated_at does not exist');
        e.status = 400;
        return Promise.reject(e);
      }
      return real(t, s2, l, c);
    };
    const st = await A.Sync.now();
    check('a broken deletions pull is reported', !!st.error, st.error);
    A.w.Backend.changed = real;

    // A server that has never had the table is the one honest exception.
    A.w.Backend.changed = (t, s2, l, c) => {
      if (t === 'deletions') {
        const e = new Error('Not Found');
        e.status = 404;
        return Promise.reject(e);
      }
      return real(t, s2, l, c);
    };
    const st2 = await A.Sync.now();
    check('but a server without the table is not an error', !st2.error, st2.error);
    A.w.Backend.changed = real;
  }

  /* ---------------- the rehearsal stays at home ----------------
     Each device seeds its own dry run, with its own ids. Pushing it means two
     phones merge two rehearsals and the council sees every invented officer
     twice — which is exactly what was reported. */
  console.log('\n--- the dry run does not travel ---');
  {
    const D1 = makeDevice(server, 'Seeded');
    const sampleCount = D1.S.people().filter((p) => p.sample).length;
    check('the device seeded a rehearsal', sampleCount > 0, sampleCount + ' invented people');

    const before = Object.keys(server.tables.people).length;
    await D1.Sync.now();
    check('none of it was sent', Object.keys(server.tables.people).length === before,
      before + ' → ' + Object.keys(server.tables.people).length);

    // And a rehearsal already on the server, from a version that did push it,
    // is not taken in by anybody.
    server.tables.people['ghost-sample'] = {
      id: '33333333-3333-4333-8333-333333333333',
      body: { id: '33333333-3333-4333-8333-333333333333', name: 'Invented Officer',
              sample: true, active: true, unitId: natA, updatedAt: '2030-01-01T00:00:00.000Z' },
      updated_at: '2030-01-01T00:00:00.000Z'
    };
    await A.Sync.now();
    check('and one already up there is ignored',
      !A.S.people().some((p) => p.name === 'Invented Officer'));
    delete server.tables.people['ghost-sample'];
  }

  /* ---------------- the closing date ----------------
     The one thing that must read the same on every phone. A term that ends on
     the 6th here and nowhere else is worse than no term at all. */
  console.log('\n--- the term reaches everyone ---');
  {
    /* Two phones of their own, so ending the rehearsal here disturbs nothing
       the earlier sections built. */
    const server2 = makeServer();
    const P = makeDevice(server2, 'President');
    const G = makeDevice(server2, 'Governor');
    P.S.endDryRun();
    G.S.endDryRun();
    await P.Sync.now();
    await G.Sync.now();

    P.S.declareTerm('2026-10-06', { note: 'End of the 2026 term.', by: 'Arron D. Aperocho' });
    const stP = await P.Sync.now();
    check('the round itself did not fault', !stP.error, stP.error);
    check('the declaration was sent', !!server2.tables.term[1],
      JSON.stringify(Object.keys(server2.tables.term)));

    await G.Sync.now();
    check('the other phone has the date', G.S.termStatus().endDate === '2026-10-06',
      G.S.termStatus().endDate);
    check('and who declared it', G.S.term().declaredBy === 'Arron D. Aperocho');
    check('and the note with it', G.S.term().note === 'End of the 2026 term.');

    G.S.declareTerm('2026-10-20', { note: 'Moved by the executive board.', by: 'Bea' });
    await G.Sync.now();
    await P.Sync.now();
    check('a change of date travels back', P.S.termStatus().endDate === '2026-10-20',
      P.S.termStatus().endDate);

    await P.Sync.now();
    check('a quiet round leaves it alone', P.S.termStatus().endDate === '2026-10-20');

    /* A rehearsal's date is part of the rehearsal: a council that never started
       one should not be told its term ends next month. */
    const R = makeDevice(server2, 'Rehearsing');
    check('a device in a dry run has its own date', R.S.dryRun().active);
    const before = server2.tables.term[1] && server2.tables.term[1].body.endDate;
    await R.Sync.now();
    check('and does not push it over the real one',
      server2.tables.term[1].body.endDate === before, server2.tables.term[1].body.endDate);
  }

  /* ---------------- clearing a rehearsal that already spread ----------------
     Before the dry run was kept off the server, every device pushed its own
     copy — so a council ends up with the same invented activity three or four
     times over, each carrying a "sample" chip. Ending the rehearsal has to
     clear it everywhere, not just on the phone that presses the button. */
  console.log('\n--- ending the dry run reaches the other phones ---');
  {
    const s3 = makeServer();
    const X = makeDevice(s3, 'Nationals');
    const Y = makeDevice(s3, 'Senator');

    /* What a device on the old version left behind: the rehearsal, on the
       server, under ids nobody else agrees with. */
    X.S.people().filter((p) => p.sample).slice(0, 3).forEach((p) => {
      s3.tables.people[p.id] = { id: p.id, body: p, unit_id: p.unitId, updated_at: '2026-01-01T00:00:00.000Z' };
    });
    X.S.events().filter((e) => e.sample).forEach((e) => {
      s3.tables.events[e.id] = { id: e.id, body: e, unit_id: e.unitId, updated_at: '2026-01-01T00:00:00.000Z' };
    });
    const strayIds = Object.keys(s3.tables.events);
    check('the rehearsal is on the server, as it would be', strayIds.length > 0, strayIds.length);

    await Y.Sync.now();
    check('a device today does not take it in',
      Y.S.events().filter((e) => e.sample && s3.tables.events[e.id]).length === 0);

    // Ending it sweeps the server too.
    X.S.endDryRun();
    await X.Sync.now();
    check('ending the rehearsal removes it from the server',
      Object.keys(s3.tables.events).length === 0,
      JSON.stringify(Object.keys(s3.tables.events).length));
    check('and records the deletions so they travel',
      Object.keys(s3.tables.deletions).length > 0);

    await Y.Sync.now();
    /* Y is left holding its own rehearsal, which was never shared and is Y's to
       end — but not one copy of anybody else's, which is the duplication a
       council actually sees. */
    check('the other phone is left with none of the copies',
      strayIds.every((id) => !Y.S.event(id)),
      strayIds.filter((id) => !!Y.S.event(id)).length + ' copies left');
    check('and still has its own rehearsal to end itself',
      Y.S.events().filter((e) => e.sample).length > 0);
  }

  /* ---------------- setup travels too ----------------
     The letterhead every report is printed on, the unit list, and the posts a
     form offers. Left out of the first sync because they change rarely — and
     "the template the President uploaded is on the President's laptop and
     nowhere else" is exactly the disagreement this layer exists to prevent. */
  console.log('\n--- the setup reaches everyone ---');
  {
    const s4 = makeServer();
    const P2 = makeDevice(s4, 'President');
    const G2 = makeDevice(s4, 'Governor');
    await P2.Sync.now();
    await G2.Sync.now();

    // A unit renamed, and one added.
    const nat = P2.S.unit(P2.S.nationalUnitId());
    P2.S.updateUnit(nat.id, { trackerName: 'FCUSR Nationals 2026' });
    const fresh = P2.S.addUnit({ kind: 'province', name: 'College of Maritime Studies', code: 'CMS' });

    // The Republic's own details.
    P2.S.updateOrg({ address: 'Roxas Avenue, Roxas City, Capiz 5800', email: 'sr@filamer.edu.ph' });
    P2.S.addListValue('positions', 'Sergeant-at-Arms');

    await P2.Sync.now();
    await G2.Sync.now();

    check('a new unit reaches the other phone', !!G2.S.unit(fresh.id), G2.S.units().length + ' units');
    check('and it is named the same', G2.S.unit(fresh.id).name === 'College of Maritime Studies');
    check('a renamed unit travels', G2.S.unit(nat.id).trackerName === 'FCUSR Nationals 2026',
      G2.S.unit(nat.id).trackerName);
    check('the council\u2019s details travel', G2.S.org().email === 'sr@filamer.edu.ph',
      G2.S.org().email);
    check('and so do the posts a form offers',
      G2.S.positions().indexOf('Sergeant-at-Arms') >= 0);

    // A letter template is the one everybody most needs to agree on.
    P2.S.updateOrg({ letterhead: 'data:image/png;base64,iVBORw0KGgo=', letterheadBy: 'Arron' });
    await P2.Sync.now();
    await G2.Sync.now();
    check('the Republic\u2019s letter template travels',
      G2.S.org().letterhead === 'data:image/png;base64,iVBORw0KGgo=',
      String(G2.S.org().letterhead).slice(0, 32));
    check('with who uploaded it', G2.S.org().letterheadBy === 'Arron');
  }

  /* ---------------- catching up after a long time away ----------------
     A pull used to take one page a round. The mark advanced, so the next round
     collected the rest — but a device coming back after a term would need a
     dozen rounds to catch up while showing "Synced" the whole way. */
  console.log('\n--- a big catch-up finishes in one round ---');
  {
    const s5 = makeServer();
    const M = makeDevice(s5, 'Maker');
    const L = makeDevice(s5, 'Latecomer');
    await M.Sync.now();
    await L.Sync.now();

    const unit = M.S.nationalUnitId();
    for (let i = 0; i < 1200; i++) {
      s5.tables.events['e' + i] = {
        id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
        unit_id: unit, title: 'Activity ' + i, status: 'Upcoming',
        body: { id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
                unitId: unit, title: 'Activity ' + i, status: 'Upcoming',
                updatedAt: '2026-05-01T00:00:00.000Z', createdAt: '2026-05-01T00:00:00.000Z' },
        // After this device's mark, or they would rightly be filtered out.
        updated_at: new Date(Date.UTC(2027, 0, 1, 0, 0, i)).toISOString()
      };
    }

    const before = L.S.events().length;
    const st = await L.Sync.now();
    const gained = L.S.events().length - before;
    check('a thousand activities arrive in one round', gained === 1200, gained + ' arrived');
    check('and the round says how many it took in',
      st.last && st.last.added === 1200, st.last && st.last.added);

    // Nothing is fetched twice on the next round.
    const reqs = s5.requests.filter((r) => r.op === 'changed' && r.table === 'events').length;
    await L.Sync.now();
    const after = s5.requests.filter((r) => r.op === 'changed' && r.table === 'events').length;
    check('a quiet round afterwards asks once, not again for everything',
      after - reqs === 1, (after - reqs) + ' asks');
    check('and takes nothing in', L.S.events().length - before === 1200);
  }

  /* ---------------- saying where things are ----------------
     "The sync is broken" is not something anybody can act on. */
  console.log('\n--- what is where ---');
  {
    const s6 = makeServer();
    const D = makeDevice(s6, 'Device');
    D.S.addEvent({ title: 'Held here only', unitId: D.S.nationalUnitId() });

    const before = await D.Sync.diagnose();
    const ev = before.rows.filter((r) => r.kind === 'event')[0];
    check('it counts what this device holds', ev.here > 0, JSON.stringify(ev));
    check('and that the server has none of it', ev.there === 0, JSON.stringify(ev));
    check('the rehearsal is counted apart from real work', ev.real !== null && ev.real < ev.here,
      JSON.stringify(ev));

    await D.Sync.now();
    const after = await D.Sync.diagnose();
    const ev2 = after.rows.filter((r) => r.kind === 'event')[0];
    check('after a sync the server has the real work', ev2.there === ev2.real,
      JSON.stringify(ev2));

    // It must never change what it is looking at.
    const counts = D.S.events().length;
    await D.Sync.diagnose();
    check('asking does not alter anything', D.S.events().length === counts);

    // A refused table is reported, not hidden.
    const real = D.w.Backend.changed;
    D.w.Backend.changed = (t, s7, l, c) => (t === 'letters'
      ? Promise.reject(Object.assign(new Error('permission denied for table letters'), { status: 403 }))
      : real(t, s7, l, c));
    const bad = await D.Sync.diagnose();
    const lt = bad.rows.filter((r) => r.kind === 'letter')[0];
    check('a refused table shows as refused', lt.there === null, JSON.stringify(lt));
    check('and says what the server said', /permission denied/.test(bad.error || ''), bad.error);
    D.w.Backend.changed = real;
  }

  /* ---------------- an empty device asks for everything ----------------
     The mark can be true and useless together: a device that was emptied keeps
     a mark from before there was anything to take in, and then sits reporting
     "Synced, 0 taken in" beside another phone full of the council's work. */
  console.log('\n--- an empty device does not stay empty ---');
  {
    const s7 = makeServer();
    const Full = makeDevice(s7, 'Full');
    const Empty = makeDevice(s7, 'Empty');

    // Both have synced once, so both carry a mark.
    await Full.Sync.now();
    await Empty.Sync.now();

    /* One is emptied but keeps its mark — which is what ending a rehearsal
       does, and what a browser restored from a backup does. resetAll clears
       the mark as well, so the mark is put back to model the real case. */
    const markBefore = Empty.S.syncState().pulled;
    Empty.S.resetAll();
    Empty.S.markSynced({ pulled: markBefore, pushed: markBefore });
    check('it really is empty', Empty.S.events().length === 0 && Empty.S.people().length === 0);
    check('and it still carries a mark from before', Empty.S.syncState().pulled === markBefore,
      Empty.S.syncState().pulled);

    // Meanwhile the other does some real work.
    const ev = Full.S.addEvent({ title: 'Foundation Week', unitId: Full.S.nationalUnitId() });
    Full.S.addTask({ eventId: ev.id, title: 'Book the gym' });
    await Full.Sync.now();

    const st = await Empty.Sync.now();
    check('the empty one takes it in rather than reporting nothing',
      !!Empty.S.event(ev.id), JSON.stringify(st.last));
    check('and says how much came back', st.last && st.last.added > 0, st.last && st.last.added);
  }

  /* ---------------- it corrects itself, without anybody pressing anything ----
     Most officers cannot open Settings at all, so a repair that lives behind a
     button in Settings is not a repair. A device with a wrong mark has to come
     right on its own. */
  console.log('\n--- a wrong mark corrects itself ---');
  {
    const s8 = makeServer();
    const One = makeDevice(s8, 'One');
    const Two = makeDevice(s8, 'Two');
    await One.Sync.now();
    await Two.Sync.now();

    // One holds work and is convinced it has already sent it — the exact state
    // a half-finished round leaves behind.
    const ev = One.S.addEvent({ title: 'General Assembly', unitId: One.S.nationalUnitId() });
    One.S.addTask({ eventId: ev.id, title: 'Reserve the gym' });
    One.S.markSynced({ pushed: new Date(Date.now() + 60000).toISOString() });

    const stuck = await One.Sync.now();
    check('an ordinary round sends nothing, as it believes', stuck.last.sent === 0,
      JSON.stringify(stuck.last));
    check('and the other phone has none of it', !Two.S.event(ev.id));

    /* The next time the app is opened. No button, no Settings, nobody told to
       do anything. */
    const Reopened = makeDevice(s8, 'One again');
    Reopened.S.fromJSON(One.S.toJSON());
    await Reopened.Sync.now();
    check('opening the app sends it anyway', !!s8.tables.events[ev.id],
      Object.keys(s8.tables.events).length + ' on the server');

    await Two.Sync.now();
    check('and the other phone finally has it', !!Two.S.event(ev.id));
    check('with its task', !!Two.S.task(One.S.tasks({ eventId: ev.id })[0].id));
  }

  /* A full round must never put an old copy over a newer one: it pulls before
     it pushes, so everything here has already won or lost on its own merits. */
  console.log('\n--- a full round does not trample newer work ---');
  {
    const s9 = makeServer();
    const A2 = makeDevice(s9, 'A2');
    const B2 = makeDevice(s9, 'B2');
    const ev = A2.S.addEvent({ title: 'Sportsfest', unitId: A2.S.nationalUnitId() });
    await A2.Sync.now();
    await B2.Sync.now();

    // B2 makes the later edit; A2 still holds the older copy.
    await new Promise((r) => setTimeout(r, 5));
    B2.S.updateEvent(ev.id, { venue: 'FCU Gymnasium' });
    await B2.Sync.now();

    // A2 now does a full round, offering its stale copy.
    await A2.Sync.now({ full: true });
    check('the later edit survives a full send', A2.S.event(ev.id).venue === 'FCU Gymnasium',
      A2.S.event(ev.id).venue);
    check('and is still the one on the server',
      s9.tables.events[ev.id].body.venue === 'FCU Gymnasium',
      s9.tables.events[ev.id].body.venue);
  }

  console.log('\n--- no console errors ---');
  check('device A stayed quiet', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));
  check('device B stayed quiet', B.errors.length === 0, B.errors.slice(0, 2).join(' | '));

  console.log('\n========================================');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
