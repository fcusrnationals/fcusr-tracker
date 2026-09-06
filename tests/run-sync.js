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
function makeServer() {
  const tables = { people: {}, events: {}, tasks: {}, reports: {}, letters: {}, offices: {}, deletions: {} };
  let tick = 0;
  const now = () => {
    tick += 1;
    return new Date(Date.UTC(2026, 8, 6, 12, 0, 0) + tick * 1000).toISOString();
  };
  return {
    tables,
    now,
    requests: [],
    changed(table, since) {
      this.requests.push({ op: 'changed', table, since });
      const key = table === 'deletions' ? 'deleted_at' : 'updated_at';
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
        const stamped = Object.assign({}, r);
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
    units() {
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
    changed: (t, s2, l) => server.changed(t, s2, l),
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

  console.log('\n--- no console errors ---');
  check('device A stayed quiet', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));
  check('device B stayed quiet', B.errors.length === 0, B.errors.slice(0, 2).join(' | '));

  console.log('\n========================================');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
