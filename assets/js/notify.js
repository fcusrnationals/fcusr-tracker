/* Notifications — what needs this person, without them opening every screen.

   Nothing here is stored. Every notification is read off a record that
   already exists — a task given to them, a deadline, a letter they carry, an
   announcement addressed to them — so there is no second copy to fall out of
   step, and a notification goes away by itself the moment the thing behind it
   is dealt with. The one thing kept is which ones this person has already
   looked at, on this device, so the count on the bell means "new".

   Deliberately quiet. A notification is something a person would want to be
   told: work given to them, a date arriving, something only they can do. An
   edit to a task's remarks is not news, and saying it would teach people to
   ignore the bell. */
(function (global) {
  'use strict';

  var RECENT_DAYS = 14;        // how long "X gave you a task" stays news
  var ANNOUNCE_DAYS = 30;      // how long an announcement stays in the list
  var SOON_DAYS = 2;           // "due soon" means today, tomorrow, the day after
  var COMING_DAYS = 3;         // an activity you are part of, starting within this

  var CATS = [
    { key: 'action', title: 'Needs your action' },
    { key: 'update', title: 'Updates' },
    { key: 'announce', title: 'Announcements' }
  ];

  /* ---------- what has been looked at ---------- */

  function seenKey() {
    var who = global.Auth && Auth.signedIn() ? Auth.current() : null;
    return 'fcusr.tracker.seen.' + (who && who.id ? who.id : 'local');
  }

  function seenMap() {
    try { return JSON.parse(global.localStorage.getItem(seenKey()) || '{}') || {}; } catch (e) { return {}; }
  }

  function saveSeen(map) {
    try { global.localStorage.setItem(seenKey(), JSON.stringify(map)); } catch (e) { /* this visit only */ }
  }

  function isSeen(key) { return !!seenMap()[key]; }

  function markSeen(keys) {
    var map = seenMap();
    var now = Store.now();
    (keys || []).forEach(function (k) { if (!map[k]) map[k] = now; });
    /* Kept small: anything looked at more than three months ago that is no
       longer in the list can be forgotten without anybody noticing. */
    var cut = new Date(Date.now() - 90 * 86400000).toISOString();
    Object.keys(map).forEach(function (k) { if (map[k] < cut) delete map[k]; });
    saveSeen(map);
  }

  /* ---------- reading them off the records ---------- */

  function within(iso, days) {
    return !!iso && Date.now() - Date.parse(iso) < days * 86400000;
  }

  function signedOut() {
    return !!(global.Auth && !Auth.isOffline() && !Auth.signedIn());
  }

  /* The last time this task was given to this person, and by whom — read off
     its history, because that is the only record of the moment it changed
     hands. A task that predates the history counts from when it was made. */
  function assignment(t, p) {
    var h = t.history || [];
    for (var i = h.length - 1; i >= 0; i--) {
      var text = h[i].text || '';
      if (/ (gave it to|to) /.test(text) && text.slice(-p.name.length) === p.name) {
        return { at: h[i].at, by: h[i].by };
      }
    }
    return h.length ? null : { at: t.createdAt, by: '' };
  }

  function taskWhere(t) {
    var ev = t.eventId ? Store.event(t.eventId) : null;
    if ((t.kind || 'event') === 'directive') return 'Directive';
    return ev ? ev.title : 'An activity';
  }

  function taskGo(t) {
    if ((t.kind || 'event') === 'directive') return '#/directives';
    return t.eventId && Store.event(t.eventId) ? '#/events/' + t.eventId : '#/my-tasks';
  }

  function isDirectiveWork(t) {
    if ((t.kind || 'event') === 'directive') return true;
    return Store.isDirectiveSet(Store.event(t.eventId));
  }

  function mentions(text, p) {
    if (!text || !p) return false;
    return String(text).toLowerCase().indexOf('@' + p.name.toLowerCase()) >= 0;
  }

  function items() {
    if (signedOut()) return [];
    var p = global.Workspace ? Workspace.me() : null;
    var myName = global.Auth && Auth.signedIn() ? Auth.current().name : '';
    var today = U.today();
    var out = [];

    if (p) {
      Store.tasks({ assigneeId: p.id, pendingOnly: true }).forEach(function (t) {
        if (Store.yearOf('task', t) !== 'current') return;
        var ev = t.eventId ? Store.event(t.eventId) : null;
        if (ev && Store.isShelved(ev)) return;
        var dir = isDirectiveWork(t);
        var where = taskWhere(t);

        // One deadline notice per task: overdue replaces "due soon", never both.
        if (Store.isOverdue(t)) {
          out.push({
            key: 'late:' + t.id + ':' + t.dueDate, cat: 'action', icon: 'alert', tone: 'late',
            title: 'Overdue: ' + t.title,
            sub: where + ' · was due ' + U.fmtDateShort(t.dueDate),
            at: t.dueDate, go: taskGo(t)
          });
        } else if (t.dueDate && U.daysBetween(today, t.dueDate) <= SOON_DAYS) {
          out.push({
            key: 'soon:' + t.id + ':' + t.dueDate, cat: 'action', icon: 'calendar', tone: 'soon',
            title: (t.dueDate === today ? 'Due today: ' : 'Due soon: ') + t.title,
            sub: where + ' · ' + U.daysLeftLabel(t.dueDate),
            at: t.dueDate, go: taskGo(t)
          });
        }

        var given = assignment(t, p);
        if (given && within(given.at, RECENT_DAYS) && given.by !== myName) {
          out.push({
            key: 'give:' + t.id + ':' + p.id, cat: 'update', icon: dir ? 'directive' : 'check',
            title: (given.by ? given.by + ' gave you ' : 'New for you: ') +
              (dir ? 'a directive' : 'a task'),
            sub: t.title + ' · ' + where,
            at: given.at, go: taskGo(t)
          });
        }
      });

      /* Activities this person is part of — heading them, or holding work in
         them — that start in the next few days. */
      var involved = {};
      Store.tasks({ assigneeId: p.id }).forEach(function (t) { if (t.eventId) involved[t.eventId] = 1; });
      Store.events().forEach(function (e) {
        if (Store.isShelved(e) || !e.dateStart || Store.yearOf('event', e) !== 'current') return;
        if (e.headId !== p.id && !involved[e.id]) return;
        var n = U.daysBetween(today, e.dateStart);
        if (n < 0 || n > COMING_DAYS) return;
        out.push({
          key: 'soonev:' + e.id + ':' + e.dateStart, cat: 'update', icon: 'event',
          title: (n === 0 ? 'Today: ' : 'Coming up: ') + e.title,
          sub: U.countdown(e.dateStart, e.dateEnd) + (e.venue ? ' · ' + e.venue : ''),
          at: e.dateStart, go: '#/events/' + e.id
        });
      });

      /* The report, once the activity is over, is on whoever headed it — and
         nobody else is told, so it is not five people's reminder. */
      Store.events().forEach(function (e) {
        if (e.headId !== p.id || e.status !== 'Completed' || Store.yearOf('event', e) !== 'current') return;
        var r = Store.report(e.id);
        if (r && r.driveLink) return;
        out.push({
          key: 'report:' + e.id, cat: 'action', icon: 'pdf',
          title: 'Accomplishment report to finish: ' + e.title,
          sub: 'The activity is complete. The report is the last step.',
          at: e.dateEnd || e.dateStart || '', go: '#/events/' + e.id
        });
      });

      // Letters this person is carrying that are stuck or past their deadline.
      Store.letters({ openOnly: true }).forEach(function (l) {
        if (l.inChargeId !== p.id || !Store.letterNeedsAttention(l) || Store.yearOf('letter', l) !== 'current') return;
        var cur = Store.currentStop(l);
        out.push({
          key: 'letter:' + l.id + ':' + (cur ? cur.id + (cur.receivedAt || '') : ''),
          cat: 'action', icon: 'letter',
          title: 'Letter needs a follow-up: ' + l.subject,
          sub: Store.letterWhere(l),
          at: l.updatedAt, go: '#/letters/' + l.id
        });
      });

      // Somebody wrote @their name in a task's remarks.
      Store.tasks({ pendingOnly: true }).forEach(function (t) {
        if (!mentions(t.remarks, p) || Store.yearOf('task', t) !== 'current') return;
        out.push({
          key: 'mention:task:' + t.id + ':' + t.updatedAt, cat: 'update', icon: 'users',
          title: 'You were mentioned in ' + t.title,
          sub: taskWhere(t), at: t.updatedAt, go: taskGo(t)
        });
      });
    }

    // The Bulletin Board: one entry per announcement, pointing at the one record.
    var who = global.Workspace ? Workspace.viewer() : null;
    var profileId = global.Auth && Auth.signedIn() ? Auth.current().id : 'local';
    Store.announcements().forEach(function (a) {
      if (Store.announcementState(a) !== 'active' || !Store.announcementFor(a, who)) return;
      var go = '#/bulletin/' + a.id;
      if (a.requireAck && !Store.hasAcked(a.id, profileId)) {
        out.push({
          key: 'ack:' + a.id, cat: 'action', icon: 'megaphone',
          tone: a.priority === 'Urgent' ? 'late' : '',
          title: 'Please confirm you have read: ' + a.title,
          sub: 'Bulletin Board · ' + a.priority, at: a.publishAt, go: go
        });
      } else if (within(a.publishAt, ANNOUNCE_DAYS)) {
        out.push({
          key: 'ann:' + a.id, cat: 'announce', icon: 'megaphone',
          tone: a.priority === 'Urgent' ? 'late' : a.priority === 'Important' ? 'soon' : '',
          title: a.title,
          sub: (a.priority !== 'Normal' ? a.priority + ' · ' : '') + 'Posted ' + U.fmtWhen(a.publishAt),
          at: a.publishAt, go: go
        });
      }
      if (p && mentions(a.message, p)) {
        out.push({
          key: 'mention:ann:' + a.id + ':' + a.updatedAt, cat: 'update', icon: 'users',
          title: 'You were mentioned in an announcement', sub: a.title, at: a.updatedAt, go: go
        });
      }
    });

    // Duplicates by key collapse to one.
    var byKey = {};
    return out.filter(function (x) {
      if (byKey[x.key]) return false;
      byKey[x.key] = 1;
      return true;
    });
  }

  function sorted(list, cat) {
    var mine = list.filter(function (x) { return x.cat === cat; });
    if (cat === 'action') {
      var rank = { late: 0, soon: 1 };
      return mine.sort(function (a, b) {
        var ra = rank[a.tone] !== undefined ? rank[a.tone] : 2;
        var rb = rank[b.tone] !== undefined ? rank[b.tone] : 2;
        if (ra !== rb) return ra - rb;
        return String(a.at) < String(b.at) ? -1 : 1;
      });
    }
    return mine.sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; });
  }

  function unread() {
    var seen = seenMap();
    return items().filter(function (x) { return !seen[x.key]; });
  }

  /* ---------- the bell ---------- */

  function paint() {
    var badge = document.getElementById('bell-count');
    var bell = document.getElementById('btn-bell');
    if (!badge || !bell) return;
    var n = unread().length;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.hidden = n === 0;
    bell.setAttribute('aria-label', n ? 'Notifications, ' + n + ' new' : 'Notifications');
  }

  function row(x, seen) {
    return '<button type="button" class="note-item' + (seen[x.key] ? '' : ' is-new') +
      (x.tone ? ' is-' + x.tone : '') + '" data-note="' + U.esc(x.key) + '" data-go="' + U.esc(x.go) + '">' +
      '<span class="ni-icon">' + UI.icon(x.icon) + '</span>' +
      '<span class="ni-text"><span class="ni-title">' + U.esc(x.title) + '</span>' +
      '<span class="ni-sub">' + U.esc(x.sub) + '</span></span>' +
      (seen[x.key] ? '' : '<span class="ni-dot" aria-label="New"></span>') +
      '</button>';
  }

  function open() {
    var list = items();
    var seen = seenMap();
    var groups = CATS.map(function (c) {
      var rows = sorted(list, c.key).slice(0, 25);
      if (!rows.length) return '';
      return '<section class="note-group"><h3>' + U.esc(c.title) +
        ' <span class="chip chip-plain">' + rows.length + '</span></h3>' +
        '<div class="list">' + rows.map(function (x) { return row(x, seen); }).join('') + '</div></section>';
    }).join('');
    var fresh = list.filter(function (x) { return !seen[x.key]; }).length;

    UI.modal({
      title: 'Notifications',
      sheet: true,
      cls: 'notes-modal',
      body: groups ||
        UI.empty('You’re all caught up',
          'Nothing needs you right now. New assignments, deadlines and announcements will appear here.',
          '', 'calm'),
      footer: list.length
        ? '<span class="tiny muted left">Shown from your tasks, activities, letters and the Bulletin Board.</span>' +
          '<button type="button" class="btn" data-read-all' + (fresh ? '' : ' disabled') + '>Mark all as read</button>'
        : '<button type="button" class="btn btn-primary" data-close>Close</button>',
      onMount: function (root, close) {
        U.els('[data-note]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            markSeen([b.getAttribute('data-note')]);
            close();
            paint();
            App.go(b.getAttribute('data-go'));
          });
        });
        var all = root.querySelector('[data-read-all]');
        if (all) all.addEventListener('click', function () {
          markSeen(list.map(function (x) { return x.key; }));
          U.els('.note-item.is-new', root).forEach(function (n) {
            n.classList.remove('is-new');
            var dot = n.querySelector('.ni-dot');
            if (dot) dot.remove();
          });
          all.disabled = true;
          paint();
          if (global.App) App.render();
        });
      }
    });
  }

  global.Notify = {
    items: items, unread: unread, paint: paint, open: open,
    isSeen: isSeen, markSeen: markSeen
  };
})(window);
