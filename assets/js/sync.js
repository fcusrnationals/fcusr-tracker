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

  var state = { running: false, at: '', error: '', last: null };
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
    if (kind === 'task')   { row.event_id = rec.eventId || null; row.title = rec.title || ''; row.status = rec.status || 'Not Started'; }
    if (kind === 'report') { row.event_id = rec.eventId || null; row.drive_link = rec.driveLink || ''; row.drive_owned = !!rec.driveOwned; row.status = rec.status || 'draft'; }
    if (kind === 'letter') { row.unit_id = u; row.subject = rec.subject || ''; row.status = rec.status || 'Routing'; row.stops = rec.stops || []; row.internal = !!rec.internal; }
    if (kind === 'office') { row.name = rec.name || ''; row.code = rec.code || null; row.active = rec.active !== false; }
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
    if (kind === 'office' && !rec.name) rec.name = row.name || '';
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

  function pull(since) {
    var counts = { added: 0, updated: 0, removed: 0 };
    var high = since || '';

    var PAGE = 500;

    /* One table, however many pages it takes.

       A single page per round looked fine because the mark advances and the
       next round picks up the rest — but a council coming back after a term,
       or a device restored from a backup, would take a dozen rounds to catch
       up while showing "Synced" throughout. And a page that ends exactly on a
       shared timestamp would leave the rows sharing it behind for good, because
       the next ask is strictly newer than the last one seen.

       Bounded, because a loop that trusts a server to stop is not a loop. */
    function page(t, from, guard) {
      return Backend.changed(t.table, from, PAGE).then(function (rows) {
        rows = rows || [];
        var last = from;
        rows.forEach(function (row) {
          var what = Store.applyRemote(t.kind, fromRow(t.kind, row));
          if (what === 'added') counts.added++;
          else if (what === 'updated') counts.updated++;
          if (row.updated_at && row.updated_at > high) high = row.updated_at;
          if (row.updated_at) last = row.updated_at;
        });
        // A short page is the end of the table; an unmoved mark means the rest
        // share one timestamp and asking again would fetch the same rows for ever.
        if (rows.length < PAGE || last === from || guard <= 0) return null;
        return page(t, last, guard - 1);
      });
    }

    var chain = Promise.resolve();
    TABLES.forEach(function (t) {
      chain = chain.then(function () { return page(t, since, 40); });
    });

    // Deletions last: applying them after the records means a row deleted and
    // re-created within one window ends up in the state it was left in.
    chain = chain.then(function () {
      // `deleted_at`, not `updated_at`: a tombstone has no other clock, and
      // asking for a column a table does not have is a refusal, not an empty list.
      return Backend.changed('deletions', since, 1000, 'deleted_at').then(function (rows) {
        (rows || []).forEach(function (row) {
          if (Store.applyRemoteDeletion(row.entity, row.entity_id, row.deleted_at)) counts.removed++;
          if (row.deleted_at && row.deleted_at > high) high = row.deleted_at;
        });
      }).catch(function (err) {
        /* Only a server that has never had the table gets a free pass — a
           council that has not run the sync migration yet. Anything else is a
           real fault, and swallowing it is how a deletion that never propagates
           looks exactly like one that did. */
        if (err && err.status === 404) return;
        throw err;
      });
    });

    return chain.then(function () { return { counts: counts, high: high }; });
  }

  /* ---------- the push ---------- */

  function push(since) {
    var out = Store.outbound(since);
    var sent = 0;
    var chain = Promise.resolve();

    TABLES.forEach(function (t) {
      var rows = (out.records[t.kind] || []).map(function (r) { return toRow(t.kind, r); });
      if (!rows.length) return;
      // In batches, because one letter with forty photos' worth of body is not
      // the same size as forty tasks, and a request that is too big fails whole.
      for (var i = 0; i < rows.length; i += 50) {
        (function (slice) {
          chain = chain.then(function () {
            return Backend.upsert(t.table, slice).then(function () { sent += slice.length; });
          });
        })(rows.slice(i, i + 50));
      }
    });

    if (out.deletions.length) {
      chain = chain.then(function () {
        return Backend.upsert('deletions', out.deletions.map(function (d) {
          return {
            entity: d.kind, entity_id: d.id, deleted_at: d.at,
            deleted_by: (global.Auth && Auth.current() && Auth.current().name) || '',
            unit_id: (global.Auth && Auth.myUnitId()) || null
          };
        }));
      }).then(function () {
        var byTable = {};
        out.deletions.forEach(function (d) {
          var t = TABLES.filter(function (x) { return x.kind === d.kind; })[0];
          if (!t) return;
          (byTable[t.table] = byTable[t.table] || []).push(d.id);
        });
        var c = Promise.resolve();
        Object.keys(byTable).forEach(function (table) {
          c = c.then(function () { return Backend.remove(table, byTable[table]); });
        });
        return c;
      });
    }

    return chain.then(function () { return sent; });
  }

  /* ISO strings compare as text, which is the whole reason the app stamps them
     that way. The store has its own copy of this; the two must not disagree. */
  function newer(a, b) { return String(a || '') > String(b || ''); }

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
      if (!row || !row.body || !row.body.declaredAt) return false;
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
    if (!t.declaredAt) return Promise.resolve(0);
    /* The rehearsal's closing date is part of the rehearsal. Everything else
       invented stays on the device that invented it, and a date that says the
       term ends next month has no business reaching a council that never
       started a dry run. */
    if (Store.dryRun().active) return Promise.resolve(0);
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
    /* Two marks, because there are two clocks and they must never be compared.

       `pulled` is on the server's clock: the newest arrival this device has
       taken in. `pushed` is on this device's: the moment of the last successful
       send. Asking the server for "rows changed since <a phone's watch>" is how
       a device with a fast clock quietly stops receiving; filtering local edits
       by "newer than <a server stamp>" is how a device stops sending. Both were
       one field once, and both faults were in it. */
    var since = mark.pulled || '';
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

    if (full) { since = ''; pushedSince = ''; }
    var startedAt = '';
    var deviceStart = new Date().toISOString();

    return Backend.serverNow().then(function (t) {
      // Read before anything else: a row written while this sync runs must be
      // caught by the next one, not skipped because the mark was taken at the end.
      startedAt = t || new Date().toISOString();
      /* Whenever anything is still on a local id, not only on the very first
         round. A device that synced under an older version never reconciled,
         and pushing `unit-nat` where a uuid belongs is refused by the server. */
      var needsCodes = Store.units().some(function (u) { return !U.isUuid(u.id); }) ||
        Store.offices().some(function (o) { return !U.isUuid(o.id); });
      return needsCodes ? reconcileUnits().then(reconcileOffices) : Promise.resolve({});
    }).then(function () {
      return pull(since);
    }).then(function (res) {
      return pullTerm().then(function (tookTerm) {
        if (tookTerm) res.counts.updated++;
        return pullCouncil();
      }).then(function (tookCouncil) {
        if (tookCouncil) res.counts.updated++;
        return res;
      });
    }).then(function (res) {
      return push(pushedSince).then(function (sent) {
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
          pushed: new Date(Date.parse(deviceStart) - 1).toISOString(),
          at: startedAt
        });
        state.last = {
          added: res.counts.added, updated: res.counts.updated,
          removed: res.counts.removed, sent: sent, at: startedAt, full: full
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

  var EVERY = 3 * 60 * 1000;
  var AFTER_CHANGE = 4000;
  // Rounds between full reconciliations: 20 × 3 minutes is roughly an hour.
  var FULL_EVERY = 20;
  var rounds = 0;

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () { now(); }, EVERY);
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
        if (!document.hidden) now();
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
      event: Store.events().length,
      task: Store.tasks().length,
      report: Store.reports().length,
      letter: Store.letters().length,
      office: Store.offices().length
    };
    var mine = {
      event: Store.events().filter(function (e) { return !e.sample; }).length,
      task: Store.tasks().filter(function (t) { return !t.sample; }).length,
      person: Store.people().filter(function (p) { return !p.sample; }).length
    };

    var rows = [];
    var chain = Promise.resolve();
    var trouble = '';

    TABLES.forEach(function (t) {
      chain = chain.then(function () {
        return Backend.changed(t.table, null, 1000).then(function (server) {
          rows.push({
            kind: t.kind,
            table: t.table,
            here: local[t.kind] || 0,
            real: mine[t.kind] === undefined ? null : mine[t.kind],
            there: (server || []).length
          });
        }).catch(function (err) {
          trouble = trouble || (t.table + ': ' + (err && err.message ? err.message : 'refused'));
          rows.push({ kind: t.kind, table: t.table, here: local[t.kind] || 0,
                      real: null, there: null });
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
    able: able, toRow: toRow, fromRow: fromRow
  };
})(window);
