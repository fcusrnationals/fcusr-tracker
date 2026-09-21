/* Syncing — making one council's work the same on every phone.

   The app stays local-first. Every screen reads and writes localStorage and
   never waits for a network, because a council works in corridors and jeepneys
   and the moment a button needs a signal is the moment people stop using it.
   Syncing is reconciliation that happens afterwards, in the background, and
   failing to sync is never allowed to fail a save.

   The rule is last-write-wins per record, on updatedAt. Two officers almost
   never hold the same task in the same minute, and when they do, the later edit
   was made knowing more. The cost is real and worth saying plainly: simultaneous
   edits to one record do not merge — the later one replaces the earlier.

   Order matters. Pull before push, so a record edited on both sides is compared
   before it is sent; and units and offices first, because everything else names
   them and a task whose event points at a unit this device has never heard of
   cannot be filed anywhere sensible. */
(function (global) {
  'use strict';

  // Local list ↔ server table. Reference data first, then what depends on it.
  var TABLES = [
    // Units first: everything else names one, and a unit this device has never
    // heard of leaves an activity with nowhere to be filed.
    { kind: 'unit',   table: 'units' },
    { kind: 'person', table: 'people' },
    { kind: 'event',  table: 'events' },
    { kind: 'task',   table: 'tasks' },
    { kind: 'report', table: 'reports' },
    { kind: 'letter', table: 'letters' },
    { kind: 'office', table: 'offices' }
  ];

  var state = { running: false, at: '', error: '', last: null, deletionColumn: 'synced_at', drift: null };
  var listeners = [];
  var timer = null;
  var pendingPush = null;

  function notify() { listeners.forEach(function (fn) { try { fn(status()); } catch (e) { /* a watcher must not break a sync */ } }); }
  function subscribe(fn) { listeners.push(fn); }

  function status() {
    return {
      running: state.running,
      at: state.at || Store.syncState().at,
      error: state.error,
      last: state.last,
      /* Work this device holds that the server has never been shown. Measured,
         not guessed, and the reason the header can stop saying Synced when it
         is not true. */
      drift: state.drift,
      able: able()
    };
  }

  /* Syncing needs somewhere to sync to and somebody to be. Offline the whole
     thing is a no-op rather than an error: that is the normal state of a council
     that has not connected Supabase, not a fault to report. */
  function able() {
    return !!(global.Backend && global.Auth && !Auth.isOffline() && Auth.signedIn());
  }

  /* ---------- shapes ----------
     The server keeps what it must reason about — who owns this, when it changed
     — and carries the app's own record in `body`. That way a field added to a
     report next term is not a migration somebody has to remember to run before
     the phones stop agreeing. */

  function unitOf(kind, rec) {
    if (kind === 'event' || kind === 'letter' || kind === 'person') return rec.unitId || null;
    return null;
  }

  /* No `updated_at` here on purpose. The server stamps it with its own clock
     and a trigger overrides anything sent, because that column is what a pull
     filters on and a filter is meaningless across two phones' watches. When the
     edit was made travels inside `body`, which is a different question answered
     by a different clock. */
  function toRow(kind, rec) {
    var row = { id: rec.id, body: rec };
    var u = unitOf(kind, rec);

    if (kind === 'unit')   { row.name = rec.name || ''; row.code = rec.code || null; row.kind = rec.kind || 'province'; row.tracker_name = rec.trackerName || ''; row.active = rec.active !== false; }
    if (kind === 'person') { row.unit_id = u; row.name = rec.name || ''; row.active = rec.active !== false; }
    if (kind === 'event')  { row.unit_id = u; row.title = rec.title || ''; row.status = rec.status || 'Upcoming'; }
    /* A directive has no activity, so it carries its own unit — otherwise the
       server has nothing to decide who may read it by, and until event_id was
       allowed to be empty it could not be stored at all. A task inside an
       activity sends no unit and is scoped through the activity, as ever. */
    if (kind === 'task')   {
      row.event_id = rec.eventId || null;
      /* Only an id the server could possibly know. A directive written before
         this device adopted the server's unit ids carries one of its own, and
         offering that back is a foreign key violation that takes the whole
         round down with it. */
      /* A unit this device can actually vouch for: a uuid, and one it holds a
         unit record for. Anything else is an id the server has no row for, and
         offering it is a foreign key violation. */
      var good = function (v) { return v && U.isUuid(v) && !!Store.unit(v); };
      var mine = (global.Auth && Auth.myUnitId && Auth.myUnitId()) || '';
      row.unit_id = rec.eventId ? null
        : (good(rec.unitId) ? rec.unitId : (good(mine) ? mine : null));
      row.title = rec.title || '';
      row.status = rec.status || 'Not Started';
    }
    if (kind === 'report') { row.event_id = rec.eventId || null; row.drive_link = rec.driveLink || ''; row.drive_owned = !!rec.driveOwned; row.status = rec.status || 'draft'; }
    if (kind === 'letter') { row.unit_id = u; row.subject = rec.subject || ''; row.status = rec.status || 'Routing'; row.stops = rec.stops || []; row.internal = !!rec.internal; }
    /* A desk belongs to the Republic or to one unit, and the server decides who
       may write it by that — so it travels in its own column, not only in body. */
    if (kind === 'office') {
      row.name = rec.name || '';
      row.code = rec.code || null;
      row.active = rec.active !== false;
      row.unit_id = rec.unitId && U.isUuid(rec.unitId) && Store.unit(rec.unitId) ? rec.unitId : null;
    }
    return row;
  }

  /* Coming the other way, `body` is the record — the columns beside it are the
     server's copy, kept for its own policies and for anyone reading the table.
     A row written by something other than this app still yields a usable record
     rather than nothing.

     The record keeps the timestamp of the edit that made it, NOT the server's.
     Two clocks are in play and they answer different questions: `updated_at` is
     when the row reached the server, which is how a pull knows what is new;
     `body.updatedAt` is when a person changed it, which is the only fair basis
     for deciding whose edit stands. Using arrival time would mean the last phone
     to find a signal wins, and the officer who edited first but syncs from a
     building with thicker walls would silently overwrite everyone. */
  function fromRow(kind, row) {
    var rec = (row.body && typeof row.body === 'object' && row.body.id) ? row.body : {};
    rec.id = row.id;
    if (!rec.updatedAt) rec.updatedAt = row.updated_at || '';
    if (!rec.createdAt) rec.createdAt = row.created_at || row.updated_at || '';

    if (kind === 'unit' && !rec.name) {
      rec.name = row.name || ''; rec.code = row.code || '';
      rec.kind = row.kind || 'province'; rec.trackerName = row.tracker_name || '';
    }
    if (kind === 'person' && !rec.name) { rec.name = row.name || ''; rec.unitId = row.unit_id || ''; }
    if (kind === 'event' && !rec.title) { rec.title = row.title || ''; rec.unitId = row.unit_id || ''; }
    if (kind === 'task' && !rec.title) { rec.title = row.title || ''; rec.eventId = row.event_id || ''; }
    if (kind === 'report' && !rec.eventId) rec.eventId = row.event_id || '';
    if (kind === 'letter' && !rec.subject) { rec.subject = row.subject || ''; rec.unitId = row.unit_id || ''; }
    if (kind === 'office' && !rec.name) { rec.name = row.name || ''; rec.unitId = row.unit_id || ''; }
    return rec;
  }

  /* ---------- reference data ----------
     Units and offices are seeded on both sides from the same fixed code list, so
     the two sides hold the same desks under different ids. They are matched by
     code once, and every local id rewritten to the server's, after which a unit
     is one thing everywhere. */
  function reconcileUnits() {
    return Backend.units().then(function (rows) {
      var map = {};
      (rows || []).forEach(function (r) {
        if (!r.code) return;
        Store.units().forEach(function (u) {
          if (u.code === r.code && u.id !== r.id) map[u.id] = r.id;
        });
      });
      if (Object.keys(map).length) Store.remapIds(map);
      return map;
    });
  }

  function reconcileOffices() {
    return Backend.changed('offices', null, 500).then(function (rows) {
      var map = {};
      (rows || []).forEach(function (r) {
        if (!r.code) return;
        Store.offices().forEach(function (o) {
          if (o.code === r.code && o.id !== r.id) map[o.id] = r.id;
        });
      });
      if (Object.keys(map).length) Store.remapIds(map);
      return map;
    });
  }

  /* ---------- the pull ---------- */

  /* How far back to re-ask, every time.

     A mark says "everything up to here is dealt with". That is only true if
     every row stamped before it was visible when it was taken — and in Postgres
     it need not be. `updated_at` is stamped with now(), which is the moment the
     transaction STARTED, while the row only appears once it has COMMITTED. A
     write that starts at 10:00:04 and commits at 10:00:07 is stamped :04 and is
     invisible at :05, so a device pulling at :05 takes a mark of :05 and asks
     for "newer than :05" ever after. That row is never offered to it again.

     Nobody sees an error. The phone says Synced, truthfully by its own
     bookkeeping, and is missing one activity for the rest of the term.

     So every round re-asks the last couple of minutes. Applying a record twice
     costs nothing — last-write-wins is the same answer every time — and two
     minutes of a small council's changes is a few kilobytes. */
  var OVERLAP_MS = 2 * 60 * 1000;

  function backOff(mark) {
    if (!mark) return '';
    var t = Date.parse(mark);
    if (!t) return mark;
    return new Date(t - OVERLAP_MS).toISOString();
  }

  /* A mark is never allowed past the server's own clock.

     The records mark is read off `updated_at`, which the server stamps, so it
     cannot run ahead on its own. The deletions mark is read off `deleted_at`,
     which the phone that did the deleting stamps — and a phone with a wrong
     date writes a tombstone dated next March. Every device that pulls it used
     to take that as its high-water mark, and from then on asked the server for
     everything newer than next March. Which is nothing. For months.

     One officer with a wrong clock silently froze every other phone in the
     council, and all of them said Synced. */
  function noLaterThan(mark, ceiling) {
    if (!mark) return '';
    if (!ceiling) return mark;
    return mark > ceiling ? ceiling : mark;
  }

  function pull(since, delSince, ceiling) {
    var counts = { added: 0, updated: 0, removed: 0 };
    /* Ask from a little before the mark; keep the mark itself as the floor, so
       the overlap re-reads the recent past without ever walking the high-water
       mark backwards a couple of minutes on every quiet round. */
    var askFrom = backOff(since);
    var askDelFrom = backOff(delSince);
    var high = since || '';
    var delHigh = delSince || '';

    var PAGE = 500;

    /* One table, however many pages it takes.

       A single page per round looked fine because the mark advances and the
       next round picks up the rest — but a council coming back after a term,
       or a device restored from a backup, would take a dozen rounds to catch
       up while showing "Synced" throughout. And a page that ends exactly on a
       shared timestamp would leave the rows sharing it behind for good, because
       the next ask is strictly newer than the last one seen.

       Bounded, because a loop that trusts a server to stop is not a loop. */
    /* What the server actually offered, on a round that asked for everything.

       This is the whole of the honesty check and it costs nothing: the rows are
       already in hand. Afterwards, anything this device holds that the server
       never offered is work that exists on one phone and nowhere else — which
       is the failure people describe as "it says Synced and the other phone is
       different", and the thing a green pill has never once been able to see. */
    var seen = since ? null : { unit: {}, person: {}, event: {}, task: {}, report: {}, letter: {}, office: {} };

    /* Each page continues from the last (stamp, id) actually seen, so a page
       edge falling inside a group of rows that share one stamp — which is
       every batch a phone sends — no longer leaves the rest of the group
       behind for ever. See Backend.changed. */
    function page(t, from, after, guard) {
      return Backend.changed(t.table, from, PAGE, null, after).then(function (rows) {
        rows = rows || [];
        var last = from;
        var lastId = after;
        rows.forEach(function (row) {
          if (seen && row.id) seen[t.kind][row.id] = 1;
          var what = Store.applyRemote(t.kind, fromRow(t.kind, row));
          if (what === 'added') counts.added++;
          else if (what === 'updated') counts.updated++;
          if (row.updated_at && row.updated_at > high) high = row.updated_at;
          if (row.updated_at) { last = row.updated_at; lastId = row.id; }
        });
        // A short page is the end of the table. An unmoved position means a
        // server that ignored the continuation, and asking again would fetch
        // the same rows for ever.
        if (rows.length < PAGE || guard <= 0) return null;
        if (last === from && lastId === after) return null;
        return page(t, last, lastId, guard - 1);
      });
    }

    var chain = Promise.resolve();
    TABLES.forEach(function (t) {
      chain = chain.then(function () { return page(t, askFrom, '', 40); });
    });

    // Deletions last: applying them after the records means a row deleted and
    // re-created within one window ends up in the state it was left in.
    /* Paged, exactly like the records above, and for a reason that took a
       thousand tombstones to show.

       This used to be one ask with a cap and no second one. On its own that
       would only have been slow — the mark would stop at the last tombstone
       seen and the rest would come next round. But records and deletions share
       ONE mark and the records run first, so anything edited after the last
       tombstone that fitted in the page carried the mark past the ones that did
       not, and they were never asked for again. A full reconcile did not save
       it either: it starts from the beginning and truncates in the same place.

       What a council saw was deleted work quietly back on one person's phone,
       for good, and nowhere else. */
    /* Which column orders the tombstones.

       `deleted_at` is the deleting phone's own watch, and ordering a table by a
       column fifty different watches wrote is how a tombstone from a slow phone
       lands BEHIND the mark and is never seen. sync3.sql adds `synced_at`,
       stamped by the server like every other arrival, and that is what this
       pages on. A council that has not run it yet falls back to the old column,
       which is the behaviour they have now rather than a new failure. */
    var delColumn = state.deletionColumn || 'synced_at';

    function deletionPage(from, after, guard) {
      return Backend.changed('deletions', from, PAGE, delColumn, after).then(function (rows) {
        rows = rows || [];
        var last = from;
        var lastId = after;
        rows.forEach(function (row) {
          if (Store.applyRemoteDeletion(row.entity, row.entity_id, row.deleted_at)) counts.removed++;
          /* The mark moves on the column that was ORDERED by, which is not
             always the one the tombstone is dated by. Mixing them is what put
             one phone's wrong date into everybody's high-water mark. */
          var at = row[delColumn];
          if (at && at > delHigh) delHigh = at;
          if (at) { last = at; lastId = row.entity_id; }
        });
        if (rows.length < PAGE || guard <= 0) return null;
        if (last === from && lastId === after) return null;
        return deletionPage(last, lastId, guard - 1);
      }).catch(function (err) {
        /* No `synced_at` on this database yet. Say so once, drop back to the
           old column, and carry on — the whole round must not fail because one
           migration is outstanding. */
        if (delColumn === 'synced_at' && err && (err.status === 400 || err.status === 404)) {
          state.deletionColumn = 'deleted_at';
          delColumn = 'deleted_at';
          delHigh = '';
          return deletionPage('', '', 40);
        }
        throw err;
      });
    }

    chain = chain.then(function () {
      return deletionPage(askDelFrom, '', 40).catch(function (err) {
        /* Only a server that has never had the table gets a free pass — a
           council that has not run the sync migration yet. Anything else is a
           real fault, and swallowing it is how a deletion that never propagates
           looks exactly like one that did. */
        if (err && err.status === 404) return;
        throw err;
      });
    });

    return chain.then(function () {
      return {
        counts: counts,
        // Neither mark may be later than the server's own clock, whatever a
        // phone with a wrong date wrote into a row.
        /* The records mark is NOT clamped. `updated_at` is stamped by the
           server on arrival, so it cannot run away on its own — and a row
           written while this round was in flight legitimately carries a stamp
           later than the moment the round started. Clamping that would make
           the next round re-read from the start of the overlap every time,
           which on a first sync of a whole term is the whole term, every
           twenty seconds. */
        high: high,
        // The deletions mark IS clamped, because a phone writes it.
        delHigh: noLaterThan(delHigh, ceiling),
        column: delColumn,
        seen: seen
      };
    });
  }

  /* ---------- the push ---------- */

  /* Records this device holds and the server will not take from it.

     An officer of a college is attached to a National activity so that it shows
     on their dashboard: they may read it, and they may not write it. Their phone
     holds it all the same, and a full round offers back everything the phone
     holds — so the server refuses, and row-level security refuses the REQUEST,
     not the row. One record they were deliberately given therefore broke every
     sync they would ever run, and their own college's work never left the phone
     either.

     Remembered for the session so a settled device is not re-offering them one
     at a time every hour. Not written down anywhere: what a person may write can
     change the moment somebody enrols them differently, and a refusal recorded
     for ever would outlive the reason for it. */
  var unwritable = {};
  /* How many refusals a row gets before it is left alone. */
  var GIVE_UP_AFTER = 3;
  function givenUpOn(key) { return (unwritable[key] || 0) >= GIVE_UP_AFTER; }

  /* `keyOf` because not every table is keyed by `id`. Deletions are keyed by the
     pair (entity, entity_id) and have no id column at all, so sending one would
     be refused by the server for a completely different reason. */
  /* A row the server will never accept, however many times it is offered.

     Permission was the only kind this knew about, so a row refused for any
     other reason — a foreign key pointing at something that is not there, a
     duplicate, a column out of range — still took the whole round down with it
     and every record that would otherwise have gone. A council watched "Not
     synced" with nothing sent because of one directive.

     4xx means the server has read the row and will not have it; offering it
     again changes nothing. 5xx and a dead connection are the opposite — those
     are worth the whole round failing, because they pass. */
  function permanent(err) {
    return !!err && err.status >= 400 && err.status < 500;
  }

  function offer(table, rows, keyOf, took) {
    var name = keyOf || function (r) { return table + ':' + r.id; };
    var accept = function (r) { if (took && r.id) took[r.id] = 1; };
    if (!rows.length) return Promise.resolve(0);
    return Backend.upsert(table, rows).then(function () {
      rows.forEach(accept);
      return rows.length;
    })
      .catch(function (err) {
        if (!permanent(err)) throw err;
        /* Something in here is not this device's to write, and the answer does
           not say which. Offer them singly to find out, take what is taken, and
           remember the rest so this only happens once. */
        var taken = 0;
        var c = Promise.resolve();
        rows.forEach(function (row) {
          c = c.then(function () {
            return Backend.upsert(table, [row]).then(function () { taken += 1; accept(row); })
              .catch(function (e) {
                if (permanent(e)) {
                  var key = name(row);
                  unwritable[key] = (unwritable[key] || 0) + 1;
                  refused += 1;
                  /* Said once, where somebody can see it. A row set aside for a
                     reason that is not permission is a fault in the record
                     rather than in who is holding it, and silence about it is
                     how one bad row becomes a mystery. */
                  if (e.status !== 401 && e.status !== 403) {
                    console.warn('Sync set a record aside: ' + table + ' ' +
                      name(row) + ' — ' + (e.message || e.status));
                  }
                  return;
                }
                throw e;
              });
          });
        });
        return c.then(function () { return taken; });
      });
  }

  var refused = 0;

  function push(since, placed) {
    var out = Store.outbound(since);
    var sent = 0;
    refused = 0;
    var chain = Promise.resolve();

    TABLES.forEach(function (t) {
      var rows = (out.records[t.kind] || [])
        .filter(function (r) { return !givenUpOn(t.table + ':' + r.id); })
        .map(function (r) { return toRow(t.kind, r); });
      if (!rows.length) return;
      // In batches, because one letter with forty photos' worth of body is not
      // the same size as forty tasks, and a request that is too big fails whole.
      for (var i = 0; i < rows.length; i += 50) {
        (function (slice) {
          chain = chain.then(function () {
            /* What the server took is remembered, because a record created and
               sent in THIS round was never offered back by the pull — the pull
               runs first — and counting it as stranded would put an amber
               warning on the header of every phone that had just done some
               work. */
            return offer(t.table, slice, null, placed && placed[t.kind])
              .then(function (n) { sent += n; });
          });
        })(rows.slice(i, i + 50));
      }
    });

    /* Deletions go the same way, and this is where the red bar was coming from.

       The records above were taught to survive a refusal; this was not, so one
       tombstone the server would not take broke the whole round and every round
       after it — the pill red, nothing sent, and the reason a row working
       exactly as designed.

       Two ordinary ways to earn that refusal. A volunteer is not an officer, so
       deletions_write refuses every tombstone they hold. And an officer offering
       back a tombstone the National government wrote is refused on the UPDATE's
       USING clause, because the row already there belongs to another unit —
       which is what "(USING expression) for table deletions" means, and a full
       round offers everything the phone holds. */
    if (out.deletions.length) {
      chain = chain.then(function () {
        var rows = out.deletions
          .filter(function (d) { return !givenUpOn('deletions:' + d.kind + ':' + d.id); })
          .map(function (d) {
            return {
              entity: d.kind, entity_id: d.id, deleted_at: d.at,
              deleted_by: (global.Auth && Auth.current() && Auth.current().name) || '',
              unit_id: (global.Auth && Auth.myUnitId()) || null
            };
          });
        if (!rows.length) return null;
        // In batches, like records: one request per fifty tombstones.
        var c = Promise.resolve();
        for (var i = 0; i < rows.length; i += 50) {
          (function (slice) {
            c = c.then(function () {
              return offer('deletions', slice, function (r) {
                return 'deletions:' + r.entity + ':' + r.entity_id;
              });
            });
          })(rows.slice(i, i + 50));
        }
        return c;
      }).then(function () {
        var byTable = {};
        out.deletions.forEach(function (d) {
          if (givenUpOn('deletions:' + d.kind + ':' + d.id)) return;
          var t = TABLES.filter(function (x) { return x.kind === d.kind; })[0];
          if (!t) return;
          (byTable[t.table] = byTable[t.table] || []).push(d.id);
        });
        var c = Promise.resolve();
        Object.keys(byTable).forEach(function (table) {
          c = c.then(function () {
            /* Removing the row itself can be refused for the same reasons, and
               a deletion that cannot be carried out is not a reason to stop
               carrying out the others. */
            return Backend.remove(table, byTable[table]).catch(function (err) {
              if (permanent(err)) { refused += 1; return; }
              throw err;
            });
          });
        });
        return c;
      });
    }

    return chain.then(function () { return sent; });
  }

  /* ISO strings compare as text, which is the whole reason the app stamps them
     that way. The store has its own copy of this; the two must not disagree. */
  function newer(a, b) { return String(a || '') > String(b || ''); }

  /* ---------- is this phone actually in step? ----------

     "Synced" has meant "the last round did not throw". That is not the same
     question, and the difference is the whole complaint: two phones, both
     green, holding different work. A round can finish cleanly having sent
     nothing, because everything it tried to send was refused; or having
     received nothing, because its mark was sitting in the future.

     So after a round that asked for EVERYTHING — which is every round when the
     app opens, and one an hour after that — the rows the server offered are
     compared against the rows this device holds. Anything here that was never
     offered is on one phone and nowhere else. It is counted, per kind, and the
     first few are named, because "3 tasks" is something somebody can go and
     look at and "out of sync" is not.

     Nothing is fetched for this. The rows were already in hand. */
  var LIST = {
    unit:   function () { return Store.units(); },
    person: function () { return Store.people(); },
    event:  function () { return Store.events({ kind: 'any' }); },
    task:   function () { return Store.tasks(); },
    report: function () { return Store.reports(); },
    letter: function () { return Store.letters(); },
    office: function () { return Store.offices(); }
  };

  var NOUN = {
    unit: 'unit', person: 'person', event: 'activity', task: 'task',
    report: 'report', letter: 'letter', office: 'office'
  };

  function measureDrift(seen, placed) {
    if (!seen) return null;
    var out = { total: 0, kinds: [], examples: [] };
    Object.keys(LIST).forEach(function (kind) {
      var rows;
      try { rows = LIST[kind]() || []; } catch (e) { return; }
      var only = rows.filter(function (r) {
        if (!r || r.sample) return false;
        if (!U.isUuid(r.id)) return false;
        if (seen[kind][r.id]) return false;
        // Sent in this same round, so the server has it — the pull simply ran
        // before the push and could not have offered it back.
        if (placed && placed[kind] && placed[kind][r.id]) return false;
        return true;
      });
      if (!only.length) return;
      out.total += only.length;
      out.kinds.push({ kind: kind, noun: NOUN[kind] || kind, n: only.length });
      only.slice(0, 3).forEach(function (r) {
        out.examples.push({ kind: kind, noun: NOUN[kind] || kind,
                            name: r.title || r.name || r.subject || r.id });
      });
    });
    return out;
  }

  /* ---------- the council's own details ----------
     What is printed at the top of every report, the Republic's letter template,
     and the lists a form offers. One row, like the term. */
  function pullCouncil() {
    return Backend.changed('council', null, 1).then(function (rows) {
      var row = (rows || [])[0];
      if (!row || !row.body) return false;
      return Store.applyRemoteCouncil(row.body);
    }).catch(function (err) {
      // A council that has not run the second migration yet.
      if (err && (err.status === 404 || err.status === 400)) return false;
      throw err;
    });
  }

  function pushCouncil(since) {
    var c = Store.council();
    if (!c.updatedAt) return Promise.resolve(0);
    if (since && !newer(c.updatedAt, since)) return Promise.resolve(0);
    return Backend.upsert('council', [{ id: 1, body: c }])
      .then(function () { return 1; })
      .catch(function (err) {
        if (err && (err.status === 404 || err.status === 400)) return 0;
        throw err;
      });
  }

  /* ---------- the closing date ----------
     One row, and the one thing that must read the same on every phone: a term
     that ends on the 6th here and nowhere else is worse than no term at all.
     It is not a collection, so it does not go through the record machinery —
     last write wins on its own stamp, like everything else. */
  function pullTerm() {
    return Backend.changed('term', null, 1).then(function (rows) {
      var row = (rows || [])[0];
      if (!row || !row.body || (!row.body.declaredAt && !row.body.updatedAt)) return false;
      // Somebody's rehearsal, from a version that used to push it.
      if (row.body.declaredBy === 'Dry run') return false;
      var mine = Store.term();
      if (!newer(row.body.updatedAt || row.updated_at, mine.updatedAt || '')) return false;
      Store.applyRemoteTerm(row.body);
      return true;
    }).catch(function (err) {
      if (err && (err.status === 404 || err.status === 400)) return false;
      throw err;
    });
  }

  function pushTerm(since) {
    var t = Store.term();
    // Declared, or withdrawn — a withdrawal is stamped so it can travel.
    if (!t.declaredAt && !t.updatedAt) return Promise.resolve(0);
    if (since && !newer(t.updatedAt || '', since)) return Promise.resolve(0);
    return Backend.upsert('term', [{ id: 1, body: t }]).then(function () { return 1; });
  }

  /* ---------- one round ---------- */

  function now(opts) {
    opts = opts || {};
    if (state.running) return Promise.resolve(status());
    if (!able()) return Promise.resolve(status());

    state.running = true;
    state.error = '';
    notify();

    var mark = Store.syncState();
    /* Three marks, because three different clocks write them and comparing any
       two of them is a fault that shows up as "both phones say Synced".

       `pulled` is on the server's clock: the newest arrival this device has
       taken in. `pushed` is on this device's: the moment of the last successful
       send. Asking the server for "rows changed since <a phone's watch>" is how
       a device with a fast clock quietly stops receiving; filtering local edits
       by "newer than <a server stamp>" is how a device stops sending. Both were
       one field once, and both faults were in it.

       `pulledDeletions` is the third, and it is on a phone's clock — whichever
       phone did the deleting wrote it. It shared the records mark until a
       council found out what that costs: one officer's handset with the wrong
       date wrote a tombstone dated next March, every phone that read it took
       that as its high-water mark, and every phone in the Republic quietly
       stopped receiving anything at all. All of them said Synced. */
    var since = mark.pulled || '';
    var delSince = mark.pulledDeletions || '';
    var pushedSince = mark.pushed || '';

    /* Every so often, forget both marks and reconcile properly.

       A mark says "I have already dealt with everything up to here", and it can
       be true and useless at the same time: a round that failed halfway, a
       version with a bug in it, a device emptied or restored — any of them
       leave a device certain it has nothing to do while another phone is full
       of work nobody else can see. Both devices then report "Synced", both
       truthfully, and the council is still looking at two different trackers.

       So it does not only trust the marks. Once when the app opens, and once an
       hour after that, it asks for everything and offers everything. That is
       safe in either direction because the pull happens first: whatever comes
       back has already won or lost against what is here before anything is
       sent, so a full send can never put an old copy over a newer one.

       It costs a few hundred kilobytes for a council this size, which is the
       right price for never again needing somebody to find a button. */
    var full = opts.full || rounds === 0 || (rounds % FULL_EVERY) === 0;
    rounds++;

    if (full) {
      since = ''; delSince = ''; pushedSince = '';
      /* The set-aside list is NOT cleared here, and the count in it is why.

         A refusal can be temporary: a directive whose unit had not arrived
         yet, a person enrolled a minute later, an office being renamed. Giving
         up on the first refusal left real work sitting on a phone for as long
         as the tab stayed open. Retrying it every round is the opposite
         mistake: a row the server will never accept then costs a request of
         its own, one at a time, for ever.

         So the list counts refusals instead of remembering a flag, a full
         round offers anything under the limit once more, and after three the
         row is left alone and counted where the person can see it. Pressing
         "Send everything again" clears the slate outright, because somebody
         asking for that is telling us the reason may have changed. */
    }
    var startedAt = '';
    var deviceStart = Store.now();

    return Backend.serverNow().then(function (t) {
      // Read before anything else: a row written while this sync runs must be
      // caught by the next one, not skipped because the mark was taken at the end.
      startedAt = t || Store.now();

      /* The server's time is read for the pull mark and for nothing else.

         Correcting this device's own clock by it was tried and taken out again.
         It sounded right — a phone two days fast writes stamps two days ahead —
         but the records it had already made stayed in its future, so they were
         "still to send" against every mark it wrote afterwards, and it pushed
         the same five rows every twenty seconds for ever.

         The skew is answered where it actually bites instead: an edit is always
         stamped later than the version it replaces, so a fast phone can be
         corrected by anybody and does not win by having the wrong clock. */
      /* Whenever anything is still on a local id, not only on the very first
         round. A device that synced under an older version never reconciled,
         and pushing `unit-nat` where a uuid belongs is refused by the server. */
      var needsCodes = Store.units().some(function (u) { return !U.isUuid(u.id); }) ||
        Store.offices().some(function (o) { return !U.isUuid(o.id); });
      return needsCodes ? reconcileUnits().then(reconcileOffices) : Promise.resolve({});
    }).then(function () {
      return pull(since, delSince, startedAt);
    }).then(function (res) {
      return pullTerm().then(function (tookTerm) {
        if (tookTerm) res.counts.updated++;
        return pullCouncil();
      }).then(function (tookCouncil) {
        if (tookCouncil) res.counts.updated++;
        return res;
      });
    }).then(function (res) {
      var placed = full
        ? { unit: {}, person: {}, event: {}, task: {}, report: {}, letter: {}, office: {} }
        : null;
      return push(pushedSince, placed).then(function (sent) {
        return pushTerm(pushedSince).then(function (n) {
          return pushCouncil(pushedSince).then(function (m) { return sent + n + m; });
        });
      }).then(function (sent) {
        /* deviceStart, not "now": anything edited while this round was in flight
           has a stamp after it and is caught by the next one. Marking the end
           would step over those edits and they would never be sent at all.

           And a millisecond before it, because a phone's clock has only that
           much resolution. Create a task and sync in the same millisecond — an
           ordinary thing, since a save triggers a sync — and its stamp equals
           the mark exactly; filtered with a strict "newer than", it would never
           be sent at all, and nobody would ever see an error. Stepping back one
           tick can only re-send a record that was already sent, which an upsert
           does not mind in the least. */
        Store.markSynced({
          pulled: res.high || startedAt,
          /* Tombstones keep their own mark. They are ordered by a different
             column, written by a different clock, and a single mark for both
             meant one wrong watch could stop a device receiving records at
             all. */
          pulledDeletions: res.delHigh || (res.column === 'synced_at' ? startedAt : ''),
          pushed: new Date(Date.parse(deviceStart) - 1).toISOString(),
          at: startedAt
        });
        /* A full round is also when to ask whether this person is still what
           they were. Somebody promoted from volunteer to officer kept the
           volunteer screens until they closed the tab, with nothing on screen
           to suggest they should. */
        if (full && global.Auth && Auth.refresh) {
          Auth.refresh().then(function (changed) {
            if (changed && global.App && App.render) App.render();
          });
        }

        /* Measured AFTER the push, not before: everything this device was
           holding back has just had its chance to go. What is left over is
           what the server would not take, or never heard about. */
        if (full) state.drift = measureDrift(res.seen, placed);

        state.last = {
          added: res.counts.added, updated: res.counts.updated,
          removed: res.counts.removed, sent: sent, at: startedAt, full: full,
          drift: state.drift,
          /* Records this phone holds that the server will not take from it.
             Not an error — it is usually correct, an officer holding sight of a
             National activity they may not edit — but it is not nothing either,
             and a number nobody can see is a number nobody can act on. */
          refused: refused
        };
        /* Something arrived, so whatever is on screen is out of date. This is
           the only place a sync is allowed to announce itself — and only when
           it actually brought something back, or it would wake the next sync
           and never stop. Not conditional on App existing: whether anything is
           listening is the listeners' business, not this layer's. */
        if (res.counts.added || res.counts.updated || res.counts.removed) Store.commit();
      });
    }).catch(function (err) {
      /* A sync that cannot run is not a fault the person needs to act on — they
         are on a jeepney, or the canteen wifi is a portal. It is remembered and
         shown quietly, and the next round tries again. */
      state.error = err && err.message ? err.message : 'Could not reach the server.';
      if (opts.loud && global.UI) UI.toast(state.error, 'error');
    }).then(function () {
      state.running = false;
      state.at = Store.syncState().at;
      notify();
      return status();
    });
  }

  /* ---------- when it happens ----------
     On sign-in, when a change is made, when the tab is looked at again, when the
     network comes back, and every few minutes regardless. The debounce is what
     stops a person typing a task title from sending nine versions of it. */

  /* Every twenty seconds while somebody is looking at it.

     A change already sends itself within a few seconds, so this is for the
     other direction: work somebody else did, appearing without anybody
     refreshing. Twenty seconds is short enough that two officers in the same
     meeting see the same screen.

     A round asks each table what has changed since a moment and usually gets
     an empty answer back, so the cost is small — but not nothing, so a tab
     nobody is looking at stops entirely and catches up the moment it is
     looked at again. That is most tabs, most of the time. */
  var EVERY = 20 * 1000;
  var AFTER_CHANGE = 4000;
  /* Rounds between full reconciliations. At twenty seconds this is about an
     hour, which is how often a device stops trusting its own bookkeeping and
     simply asks for everything. */
  var FULL_EVERY = 180;
  var rounds = 0;

  function schedule() {
    if (timer) clearInterval(timer);
    // Only while the tab is in front. A phone in a pocket is not waiting for
    // an answer, and polling it every twenty seconds costs battery and data
    // for nobody's benefit.
    if (global.document && document.hidden) return;
    timer = setInterval(function () { now(); }, EVERY);
  }

  function stopSchedule() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function onChange() {
    if (!able()) return;
    if (pendingPush) clearTimeout(pendingPush);
    pendingPush = setTimeout(function () { pendingPush = null; now(); }, AFTER_CHANGE);
  }

  function start() {
    if (!global.Store) return;
    Store.subscribe(onChange);
    schedule();

    if (global.document) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return stopSchedule();
        // Back in front: catch up at once, then resume the twenty seconds.
        schedule();
        now();
      });
    }
    global.addEventListener('online', function () { now(); });

    // Not on the first paint: the first screen should draw before the network
    // is asked for anything.
    setTimeout(function () { now(); }, 1200);
  }

  /* ---------- what is actually where ----------

     "The sync is broken" is not something anybody can act on, and neither is a
     green dot. This asks the server what it holds, counts what this device
     holds, and puts the two side by side — so the answer is "the server has
     nine activities and this phone has none" rather than a guess.

     Read-only: it applies nothing. Diagnosing a problem must not change the
     thing being diagnosed. */
  function diagnose() {
    if (!able()) {
      return Promise.resolve({ able: false, rows: [], error: 'Not signed in, or no server connected.' });
    }

    var local = {
      unit: Store.units().length,
      person: Store.people().length,
      // Activities and directive sets: both are rows in the same table.
      event: Store.events({ kind: 'any' }).length,
      task: Store.tasks().length,
      report: Store.reports().length,
      letter: Store.letters().length,
      office: Store.offices().length
    };
    var rows = [];
    var chain = Promise.resolve();
    var trouble = '';

    TABLES.forEach(function (t) {
      chain = chain.then(function () {
        return Backend.changed(t.table, null, 1000).then(function (server) {
          server = server || [];

          /* Counting was not enough, and the council found out how: nine here
             and nine there, and different nines. Two phones agreed on the
             number of activities and disagreed about which. So the ids are
             compared, and where an id is on both sides the stamp is compared
             too — which is the only way "they both say Synced and they are
             different" ever becomes a sentence anybody can act on. */
          var theirs = {};
          server.forEach(function (r) {
            theirs[r.id] = (r.body && r.body.updatedAt) || r.updated_at || '';
          });

          var mine = (LIST[t.kind] ? LIST[t.kind]() : []).filter(function (r) {
            return r && !r.sample && U.isUuid(r.id);
          });
          var seenHere = {};
          var onlyHere = [];
          var differ = [];
          mine.forEach(function (r) {
            seenHere[r.id] = 1;
            if (!Object.prototype.hasOwnProperty.call(theirs, r.id)) {
              onlyHere.push(r.title || r.name || r.subject || r.id);
              return;
            }
            if (theirs[r.id] !== (r.updatedAt || '')) {
              differ.push(r.title || r.name || r.subject || r.id);
            }
          });
          var onlyThere = server.filter(function (r) { return !seenHere[r.id]; })
            .map(function (r) {
              return (r.body && (r.body.title || r.body.name || r.body.subject)) || r.id;
            });

          rows.push({
            kind: t.kind,
            table: t.table,
            noun: NOUN[t.kind] || t.kind,
            here: local[t.kind] || 0,
            there: server.length,
            onlyHere: onlyHere,
            onlyThere: onlyThere,
            differ: differ
          });
        }).catch(function (err) {
          trouble = trouble || (t.table + ': ' + (err && err.message ? err.message : 'refused'));
          rows.push({ kind: t.kind, table: t.table, noun: NOUN[t.kind] || t.kind,
                      here: local[t.kind] || 0, there: null,
                      onlyHere: [], onlyThere: [], differ: [] });
        });
      });
    });

    return chain.then(function () {
      return {
        able: true,
        rows: rows,
        error: trouble || state.error,
        marks: Store.syncState(),
        last: state.last
      };
    });
  }

  global.Sync = {
    now: now, start: start, status: status, subscribe: subscribe, diagnose: diagnose,
    able: able, toRow: toRow, fromRow: fromRow,
    // A full round on demand: what "Send everything again" and the drift
    // warning both reach for.
    reconcile: function (opts) {
      unwritable = {};
      return now({ full: true, loud: !!(opts && opts.loud) });
    }
  };
})(window);
