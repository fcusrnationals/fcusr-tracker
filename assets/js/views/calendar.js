/* Calendar — everything with a date, on the date.

   Nothing is stored for it. An activity appears on the days it runs because
   it has a start and an end; a task on its due date; a directive on its due
   date; a letter on the day it is needed by; the end of term on the closing
   date. Change the record and the calendar has changed. Press anything and it
   opens the record itself.

   Month, week and a plain agenda. The agenda is where a phone starts, because
   a month grid on a 390px screen is a grid of dots. */
(function (global) {
  'use strict';

  var KINDS = [
    { key: 'event', label: 'Events', icon: 'event' },
    { key: 'task', label: 'Tasks', icon: 'check' },
    { key: 'directive', label: 'Directives', icon: 'directive' },
    { key: 'letter', label: 'Letters', icon: 'letter' },
    { key: 'deadline', label: 'Term deadlines', icon: 'alert' }
  ];

  var main = { mode: '', cursor: '', day: '', show: { event: 1, task: 1, directive: 1, letter: 1, deadline: 1 }, mine: false };
  var embedded = { mode: 'month', cursor: '', day: '', show: { event: 1 }, mine: false, embedded: true };

  function signed() { return !!(global.Auth && Auth.signedIn()); }
  function volunteer() { return !!(global.Auth && Auth.isVolunteer()); }

  /* ---------- what is on which day ---------- */

  function seesEvent(e) { return !signed() || Auth.canSee(e.id) || Auth.canEditEvent(e.id); }
  function seesTask(t) {
    if (!signed()) return true;
    if (Auth.isMyTask(t)) return true;
    if ((t.kind || 'event') === 'directive') return !volunteer();
    return Auth.canSee(t.eventId);
  }

  function isDirectiveWork(t) {
    return (t.kind || 'event') === 'directive' || Store.isDirectiveSet(Store.event(t.eventId));
  }

  /* Every dated thing between two days, as { kind, start, end, title, sub, go }.
     `mine` narrows it to what this person holds. */
  function items(from, to, st) {
    var me = Workspace.me();
    var pid = me ? me.id : '';
    var out = [];
    var overlaps = function (s, e) { return s <= to && (e || s) >= from; };
    var archived = function (kind, rec) { return Store.yearOf(kind, rec) !== 'current'; };

    if (st.show.event || st.show.directive) {
      Store.events({ kind: 'any' }).forEach(function (e) {
        if (!e.dateStart || Store.isShelved(e) || !seesEvent(e)) return;
        var dir = Store.isDirectiveSet(e);
        if (dir ? !st.show.directive : !st.show.event) return;
        var end = e.dateEnd || e.dateStart;
        if (!overlaps(e.dateStart, end)) return;
        if (st.mine && pid && e.headId !== pid &&
            !Store.tasks({ eventId: e.id, assigneeId: pid }).length) return;
        out.push({
          kind: dir ? 'directive' : 'event', start: e.dateStart, end: dir ? e.dateStart : end,
          title: e.title, go: '#/events/' + e.id, archived: archived('event', e),
          sub: dir ? 'Directive due' : (e.venue || U.countdown(e.dateStart, e.dateEnd)),
          unit: Store.unit(e.unitId)
        });
      });
    }

    if (st.show.task || st.show.directive) {
      Store.tasks({ pendingOnly: true }).forEach(function (t) {
        if (!t.dueDate || t.dueDate < from || t.dueDate > to || !seesTask(t)) return;
        var ev = t.eventId ? Store.event(t.eventId) : null;
        if (ev && Store.isShelved(ev)) return;
        var dir = isDirectiveWork(t);
        if (dir ? !st.show.directive : !st.show.task) return;
        if (st.mine && pid && t.assigneeId !== pid) return;
        out.push({
          kind: dir ? 'directive' : 'task', start: t.dueDate, end: t.dueDate, title: t.title,
          sub: (ev ? ev.title + ' · ' : '') + Store.personName(t.assigneeId),
          go: ev ? '#/events/' + ev.id : '#/directives', late: Store.isOverdue(t),
          archived: archived('task', t)
        });
      });
    }

    if (st.show.letter && !volunteer()) {
      Store.letters({ openOnly: true }).forEach(function (l) {
        if (!l.deadline || l.deadline < from || l.deadline > to) return;
        if (signed() && !Auth.canSeeLetter(l)) return;
        if (st.mine && pid && l.inChargeId !== pid) return;
        out.push({
          kind: 'letter', start: l.deadline, end: l.deadline, title: l.subject,
          sub: 'Needed by today · ' + Store.letterWhere(l), go: '#/letters/' + l.id,
          late: Store.isLetterOverdue(l), archived: archived('letter', l)
        });
      });
    }

    // The closing date: every unfinished report is due by then.
    if (st.show.deadline && !volunteer()) {
      var t2 = Store.termStatus();
      if (t2.declared && !t2.closed && t2.endDate >= from && t2.endDate <= to) {
        out.push({
          kind: 'deadline', start: t2.endDate, end: t2.endDate,
          title: 'End of term — reports due', sub: 'Every activity finished and its report filed',
          go: '#/overview'
        });
      }
    }

    // Longer things first on a day, then by what they are.
    var order = { deadline: 0, event: 1, directive: 2, letter: 3, task: 4 };
    return out.sort(function (a, b) {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return (order[a.kind] - order[b.kind]) || a.title.localeCompare(b.title);
    });
  }

  function onDay(list, day) {
    return list.filter(function (x) { return x.start <= day && x.end >= day; });
  }

  /* ---------- dates ---------- */

  function monthStart(d) { return d.slice(0, 8) + '01'; }
  function addMonths(d, n) {
    var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1) + '-01';
  }
  function weekday(d) { return U.parse(d).getUTCDay(); }
  function weekStart(d) { return U.addDays(d, -weekday(d)); }
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                     'September', 'October', 'November', 'December'];
  function monthTitle(d) { return MONTH_NAMES[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4); }

  /* ---------- drawing ---------- */

  function chip(x, withSub) {
    return '<button type="button" class="cal-item k-' + x.kind + (x.late ? ' is-late' : '') +
      (x.archived ? ' is-archived' : '') + '" data-go="' + U.esc(x.go) + '" title="' + U.esc(x.title) + '">' +
      '<span class="ci-bar" aria-hidden="true"></span>' +
      '<span class="ci-text"><span class="ci-title">' + U.esc(x.title) + '</span>' +
      (withSub ? '<span class="ci-sub">' + U.esc(kindLabel(x.kind)) + (x.sub ? ' · ' + U.esc(x.sub) : '') +
        (x.late ? ' · overdue' : '') + (x.archived ? ' · archived' : '') + '</span>' : '') +
      '</span></button>';
  }

  function kindLabel(k) {
    return { event: 'Event', task: 'Task', directive: 'Directive', letter: 'Letter', deadline: 'Deadline' }[k] || k;
  }

  function monthView(st) {
    var first = monthStart(st.cursor);
    var gridStart = weekStart(first);
    var gridEnd = U.addDays(gridStart, 41);
    var list = items(gridStart, gridEnd, st);
    var today = U.today();
    var sel = st.day || (st.cursor.slice(0, 7) === today.slice(0, 7) ? today : first);

    var html = '<div class="cal-month" role="grid" aria-label="' + U.esc(monthTitle(first)) + '">' +
      '<div class="cal-dow" role="row">' + U.DAYS.map(function (d) {
        return '<span role="columnheader">' + d + '</span>';
      }).join('') + '</div><div class="cal-grid">';
    for (var i = 0; i < 42; i++) {
      var day = U.addDays(gridStart, i);
      var here = onDay(list, day);
      var out = day.slice(0, 7) !== first.slice(0, 7);
      html += '<div class="cal-cell' + (out ? ' is-out' : '') + (day === today ? ' is-today' : '') +
        (day === sel ? ' is-sel' : '') + '" role="gridcell">' +
        '<button type="button" class="cal-day" data-day="' + day + '" aria-label="' + U.esc(U.fmtDate(day)) +
          (here.length ? ', ' + U.plural(here.length, 'item') : '') + '">' + Number(day.slice(8)) + '</button>' +
        '<div class="cal-chips">' + here.slice(0, 3).map(function (x) { return chip(x, false); }).join('') +
        (here.length > 3 ? '<button type="button" class="cal-more" data-day="' + day + '">+' + (here.length - 3) + ' more</button>' : '') +
        '</div>' +
        '<div class="cal-dots" aria-hidden="true">' + here.slice(0, 4).map(function (x) {
          return '<span class="k-' + x.kind + (x.late ? ' is-late' : '') + '"></span>';
        }).join('') + '</div>' +
        '</div>';
    }
    html += '</div></div>';
    html += dayPanel(sel, onDay(list, sel));
    return html;
  }

  function dayPanel(day, list) {
    return '<section class="cal-daypanel" aria-live="polite"><h3>' + U.esc(U.fmtDate(day)) + '</h3>' +
      (list.length
        ? '<div class="cal-list">' + list.map(function (x) { return chip(x, true); }).join('') + '</div>'
        : '<p class="small muted" style="margin:0">Nothing on this day.</p>') +
      '</section>';
  }

  function weekView(st) {
    var start = weekStart(st.cursor);
    var end = U.addDays(start, 6);
    var list = items(start, end, st);
    var today = U.today();
    var html = '<div class="cal-week">';
    for (var i = 0; i < 7; i++) {
      var day = U.addDays(start, i);
      var here = onDay(list, day);
      html += '<section class="cal-wday' + (day === today ? ' is-today' : '') + '">' +
        '<h3><span>' + U.DAYS[i] + '</span> ' + U.esc(U.fmtDateTiny(day)) + '</h3>' +
        (here.length ? here.map(function (x) { return chip(x, true); }).join('')
          : '<p class="tiny muted" style="margin:0">—</p>') + '</section>';
    }
    return html + '</div>';
  }

  function agendaView(st) {
    var from = st.cursor;
    var to = U.addDays(from, 41);
    var list = items(from, to, st);
    var html = '';
    // Anything already late belongs at the top, not six weeks back.
    if (from <= U.today()) {
      var late = items(U.addDays(U.today(), -365), U.addDays(U.today(), -1), st).filter(function (x) {
        return x.late && (x.kind === 'task' || x.kind === 'directive' || x.kind === 'letter');
      });
      if (late.length) {
        html += '<section class="cal-agenda-day is-late"><h3>Overdue</h3><div class="cal-list">' +
          late.map(function (x) { return chip(x, true); }).join('') + '</div></section>';
      }
    }
    var days = {};
    list.forEach(function (x) {
      var d = x.start < from ? from : x.start;
      (days[d] = days[d] || []).push(x);
    });
    var keys = Object.keys(days).sort();
    if (!keys.length && !html) {
      return UI.empty('Nothing in the next six weeks',
        'Events, deadlines and letters with a date will appear here.', '', 'events');
    }
    keys.forEach(function (d) {
      html += '<section class="cal-agenda-day' + (d === U.today() ? ' is-today' : '') + '"><h3>' +
        U.esc(U.fmtDate(d)) + (d === U.today() ? ' <span class="chip chip-plain">Today</span>' : '') + '</h3>' +
        '<div class="cal-list">' + days[d].map(function (x) { return chip(x, true); }).join('') + '</div></section>';
    });
    return '<div class="cal-agenda">' + html + '</div>';
  }

  function title(st) {
    if (st.mode === 'week') {
      var s = weekStart(st.cursor);
      return U.fmtRange(s, U.addDays(s, 6));
    }
    if (st.mode === 'agenda') return 'From ' + U.fmtDateShort(st.cursor);
    return monthTitle(st.cursor);
  }

  function controls(st) {
    var modes = [['month', 'Month'], ['week', 'Week'], ['agenda', 'Agenda']];
    return '<div class="cal-bar">' +
      '<div class="row cal-nav" style="gap:6px;flex-wrap:nowrap">' +
        '<button type="button" class="icon-btn" data-step="-1" aria-label="Earlier">' + UI.icon('back') + '</button>' +
        '<button type="button" class="btn btn-sm" data-today>Today</button>' +
        '<button type="button" class="icon-btn" data-step="1" aria-label="Later" style="transform:scaleX(-1)">' +
          UI.icon('back') + '</button>' +
        '<h2 class="cal-title">' + U.esc(title(st)) + '</h2>' +
      '</div>' +
      '<div class="segmented" role="group" aria-label="View">' + modes.map(function (m) {
        return '<button type="button" data-mode="' + m[0] + '" class="' + (st.mode === m[0] ? 'is-active' : '') +
          '" aria-pressed="' + (st.mode === m[0]) + '">' + m[1] + '</button>';
      }).join('') + '</div></div>';
  }

  function filters(st) {
    if (st.embedded) return '';
    var who = Workspace.me();
    return '<div class="cal-filters" role="group" aria-label="Show">' +
      KINDS.filter(function (k) { return !(volunteer() && (k.key === 'letter' || k.key === 'deadline')); })
        .map(function (k) {
          var on = !!st.show[k.key];
          return '<button type="button" class="cal-filter k-' + k.key + (on ? ' is-on' : '') + '" data-kind="' + k.key +
            '" aria-pressed="' + on + '"><span class="ci-bar" aria-hidden="true"></span>' + U.esc(k.label) + '</button>';
        }).join('') +
      (who ? '<label class="checkbox cal-mine"><input type="checkbox" data-mine' + (st.mine ? ' checked' : '') +
        '> Only mine</label>' : '') +
      '</div>';
  }

  function body(st) {
    if (!st.cursor) st.cursor = st.mode === 'agenda' ? U.today() : monthStart(U.today());
    var inner = st.mode === 'week' ? weekView(st) : st.mode === 'agenda' ? agendaView(st) : monthView(st);
    return '<div class="calendar' + (st.embedded ? ' is-embedded' : '') + '">' + controls(st) + filters(st) +
      '<div class="cal-body">' + inner + '</div></div>';
  }

  function pickMode(st) {
    if (!st.mode) st.mode = Workspace.narrow() ? 'agenda' : 'month';
  }

  function render() {
    pickMode(main);
    return '<div class="page-head"><div><h1>Calendar</h1>' +
      '<div class="sub">Events, deadlines and letters, by date.</div></div></div>' +
      Workspace.hint('calendar', 'Nothing here is entered twice: every item is read from the event, task, ' +
        'directive or letter itself. Press one to open it.') +
      body(main);
  }

  function wire(root, st) {
    var redraw = function () {
      if (st.embedded) {
        var host = root.querySelector('.calendar');
        host.outerHTML = body(st);
        wire(root, st);
      } else {
        App.render();
      }
    };
    U.els('.calendar [data-go]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.getAttribute('data-go')); });
    });
    U.els('.calendar [data-day]', root).forEach(function (b) {
      b.addEventListener('click', function () { st.day = b.getAttribute('data-day'); redraw(); });
    });
    U.els('.calendar [data-mode]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        st.mode = b.getAttribute('data-mode');
        st.cursor = st.mode === 'agenda' ? U.today() : st.mode === 'week' ? (st.day || U.today()) : monthStart(st.day || U.today());
        redraw();
      });
    });
    U.els('.calendar [data-step]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.getAttribute('data-step'));
        if (st.mode === 'month') { st.cursor = addMonths(st.cursor, n); st.day = ''; }
        else if (st.mode === 'week') st.cursor = U.addDays(weekStart(st.cursor), 7 * n);
        else st.cursor = U.addDays(st.cursor, 42 * n);
        redraw();
      });
    });
    U.els('.calendar [data-today]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        st.day = U.today();
        st.cursor = st.mode === 'month' ? monthStart(U.today()) : U.today();
        redraw();
      });
    });
    U.els('.calendar [data-kind]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-kind');
        st.show[k] = st.show[k] ? 0 : 1;
        redraw();
      });
    });
    var mine = root.querySelector('.calendar [data-mine]');
    if (mine) mine.addEventListener('change', function () { st.mine = mine.checked; redraw(); });
  }

  function mount(root) { wire(root, main); }

  /* ---------- elsewhere ---------- */

  // The Events screen's own calendar: activities only.
  function embed() { return body(embedded); }
  function mountEmbed(root) { wire(root, embedded); }

  /* A few lines for the Overview — the next week, compact, only when there is
     something in it. The calendar itself is one tap away. */
  function upcoming() {
    if (Workspace.viewingArchive()) return '';
    var today = U.today();
    var until = U.addDays(today, 7);
    // Everybody's activities and letters, but only this person's own deadlines —
    // the whole council's would fill it.
    var shared = items(today, until, { show: { event: 1, letter: 1, deadline: 1 }, mine: false });
    var mine = Workspace.me()
      ? items(today, until, { show: { task: 1, directive: 1 }, mine: true }) : [];
    var list = shared.concat(mine).sort(function (a, b) {
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    }).slice(0, 4);
    if (!list.length) return '';
    return '<div class="section cal-upcoming"><div class="section-head"><h2>Coming up</h2>' +
      '<a class="section-note" href="#/calendar">Open calendar</a></div>' +
      '<div class="list">' + list.map(function (x) {
        var d = x.start < today ? today : x.start;
        return '<button type="button" class="cu-row k-' + x.kind + '" data-go="' + U.esc(x.go) + '">' +
          '<span class="cu-date"><span>' + U.DAYS[weekday(d)] + '</span><strong>' + Number(d.slice(8)) + '</strong></span>' +
          '<span class="rt"><span class="strong">' + U.esc(x.title) + '</span>' +
          '<span class="rs">' + U.esc(kindLabel(x.kind)) + (x.sub ? ' · ' + U.esc(x.sub) : '') + '</span></span>' +
          '</button>';
      }).join('') + '</div></div>';
  }

  function mountUpcoming(root) {
    U.els('.cal-upcoming [data-go]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.getAttribute('data-go')); });
    });
  }

  global.ViewCalendar = {
    render: render, mount: mount, items: items,
    embed: embed, mountEmbed: mountEmbed, upcoming: upcoming, mountUpcoming: mountUpcoming
  };
})(window);
