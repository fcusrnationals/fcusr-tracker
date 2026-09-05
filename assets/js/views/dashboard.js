/* Dashboard — one list and the events, nothing else.
   The three numbers at the top are the filter for the list below them, so the
   counts and the detail are the same control instead of four stacked sections. */
(function (global) {
  'use strict';

  var filter = 'attention';   // attention | overdue | week | all
  var republicOpen = false;   // the fold holding units with nothing on the books

  var FILTERS = {
    attention: {
      label: 'Needs attention',
      note: 'Overdue and on hold.',
      test: function (t) { return Store.isOverdue(t) || t.status === 'On hold'; },
      emptyTitle: 'Nothing needs attention',
      emptyText: 'Nothing is overdue or on hold. The council is on schedule.'
    },
    overdue: {
      label: 'Overdue',
      note: 'Past their due date.',
      test: Store.isOverdue,
      emptyTitle: 'Nothing is overdue',
      emptyText: 'Every deadline so far has been met.'
    },
    week: {
      label: 'Due this week',
      note: 'Through ' + U.fmtDateShort(U.endOfWeek()) + '.',
      test: Store.isDueThisWeek,
      emptyTitle: 'No deadlines in the next seven days',
      emptyText: 'Nothing falls due this week.'
    },
    all: {
      label: 'All pending',
      note: 'Everything not yet done.',
      test: Store.isPending,
      emptyTitle: 'No pending tasks',
      emptyText: 'Everything under every event is done.'
    }
  };

  function render() {
    var live = Store.tasks({ excludeArchived: true, kind: 'event' });
    var events = Store.events({ activeOnly: true });
    var s = Store.stats(live);
    var attention = live.filter(FILTERS.attention.test).length;

    var f = FILTERS[filter] || FILTERS.attention;
    var list = live.filter(f.test).sort(Store.byDueDate);

    // A plain-language read of the day, so the first thing on screen is a sentence
    // rather than a grid of numbers.
    var headline;
    if (!s.total) headline = 'Nothing tracked yet — start with an event.';
    else if (s.overdue) headline = '<span class="hl">' + U.plural(s.overdue, 'task') + '</span> ' +
      (s.overdue === 1 ? 'is' : 'are') + ' overdue.';
    else if (attention) headline = '<span class="hl">' + U.plural(attention, 'task') + '</span> need attention.';
    else if (s.dueThisWeek) headline = U.plural(s.dueThisWeek, 'task') + ' due this week.';
    else if (s.pending) headline = 'Nothing overdue — <span class="ok">all on schedule.</span>';
    else headline = '<span class="ok">Everything is done.</span> Well run.';

    // What the term demands comes before what the day demands.
    var html = global.TermUI ? TermUI.banner() : '';

    /* The campus, the way the Hub opens. The photograph is decoration and every
       word over it is ordinary text, so nothing depends on the image arriving —
       without it the block is a dark gold panel and still reads. */
    html +=
      '<div class="photo-hero">' +
      '<img class="photo-hero-img" src="assets/img/campus.jpg" alt="" aria-hidden="true" ' +
      'decoding="async">' +
      '<div class="photo-hero-body">' +
      '<div class="hero-date">' + U.esc(U.fmtDate(U.today())) + '</div>' +
      '<div class="hero-line">' + headline + '</div>' +
      '<div class="hero-actions">' +
      '<button type="button" class="btn btn-glass" data-create-event>' + UI.icon('plus') + 'New event</button>' +
      '</div></div></div>';

    html += '<div class="pills" role="group" aria-label="Filter the task list">' +
      pill('attention', attention, 'Needs attention', attention > 0) +
      pill('week', s.dueThisWeek, 'Due this week') +
      pill('all', s.pending, 'All pending') +
      '</div>';

    html += '<div class="section"><div class="section-head">' +
      '<h2>' + U.esc(f.label) + (list.length ? ' <span class="chip chip-plain">' + list.length + '</span>' : '') + '</h2>' +
      '<span class="section-note">' + U.esc(f.note) + '</span></div>';

    html += list.length
      ? '<div class="list">' + list.map(function (t) {
          var e = Store.event(t.eventId);
          // Overview stays deliberately spare: who holds it, and the date only
          // when it is late. The event name is in the list below.
          return UI.taskRow(t, [Store.personName(t.assigneeId)], { who: true, lean: true });
        }).join('') + '</div>'
      : UI.empty(f.emptyTitle, f.emptyText, '', 'calm');
    html += '</div>';

    html += letterSection();

    html += republicSection();

    html += global.TermUI ? TermUI.archive() : '';

    html += '<div class="section"><div class="section-head"><h2>Events</h2>' +
      '<a class="section-note" href="#/events">See all</a></div>';
    html += events.length
      ? '<div class="list">' + events.map(eventRow).join('') + '</div>'
      : UI.empty('No events yet',
          'Events come first — tasks live inside them.',
          '<button type="button" class="btn btn-primary" data-create-event>' + UI.icon('plus') + 'New event</button>',
          'events');
    html += '</div>';

    return html;
  }

  /* ---------- across the Republic ----------
     The National officers answer for the whole council, not only for their own
     desk, so they get one more block: every unit on one screen, worst first.
     Nobody else sees it — a province officer's Overview is unchanged.

     Offline, before anyone has signed in, the person at the keyboard is treated
     as a national, which is how the rest of the app already behaves. */

  function seesRepublic() {
    return !global.Auth || !Auth.signedIn() || Auth.isNational();
  }

  function republicSection() {
    if (!seesRepublic()) return '';

    // Only what the National government actually governs. COMELEC, the Judiciary
    // and the independent bodies are not listed here at all, because there is
    // nothing about them a national is entitled to read before the term ends.
    var all = Store.units({ activeOnly: true, governed: true });
    if (all.length < 2) return '';

    var rows = all.map(function (u) { return { u: u, s: Store.unitStats(u.id) }; });
    var busy = rows.filter(function (r) { return r.s.events > 0; });
    if (!busy.length) return '';          // the Events empty state already says this
    var idle = rows.filter(function (r) { return r.s.events === 0; });

    // Worst first: whoever is furthest behind is what a national needs to see.
    busy.sort(function (a, b) {
      if (a.s.overdue !== b.s.overdue) return b.s.overdue - a.s.overdue;
      if (a.s.pending !== b.s.pending) return b.s.pending - a.s.pending;
      return a.u.name.localeCompare(b.u.name);
    });

    var events = busy.reduce(function (n, r) { return n + r.s.events; }, 0);

    var html = '<div class="section"><div class="section-head">' +
      '<h2>Across the Republic</h2>' +
      '<span class="section-note">' + U.plural(busy.length, 'unit') + ' with work · ' +
      U.plural(events, 'event') + '</span></div>';

    html += '<div class="list">' + busy.map(unitRow).join('') + '</div>';

    if (idle.length) {
      html += '<div class="group" style="margin-top:10px" data-collapsed="' + !republicOpen + '" data-group="idle">' +
        '<button type="button" class="group-head" data-toggle-idle aria-expanded="' + republicOpen + '">' +
        UI.icon('chevronDown', 'caret') +
        '<span class="group-title">' + U.plural(idle.length, 'unit') + ' with nothing on the books</span>' +
        '</button>' +
        '<div class="group-body"><div class="list">' +
        idle.sort(function (a, b) { return a.u.name.localeCompare(b.u.name); })
            .map(unitRow).join('') +
        '</div></div></div>';
    }

    var sealed = Store.units({ activeOnly: true, independentOnly: true });
    if (sealed.length) {
      html += '<p class="tiny muted" style="margin:10px 2px 0">' +
        U.esc(sealed.map(function (u) { return u.name; }).join(', ')) +
        ' run their own trackers. Their work is not shown here, and is read only ' +
        'at the end of the term through the report they file.</p>';
    }

    return html + '</div>';
  }

  function unitRow(r) {
    var u = r.u, s = r.s;
    var meta = s.events
      ? U.plural(s.events, 'event') + '<span class="sep">·</span>' + s.done + ' of ' + s.total + ' done'
      : 'No events yet';
    return '<button type="button" class="event-row unit-row" data-open-unit="' + U.esc(u.id) + '">' +
      UI.ring(s.done, s.total) +
      '<span class="er-main">' +
      '<span class="er-title">' +
        (u.code ? '<span class="unit-code">' + U.esc(u.code) + '</span>' : '') +
        U.esc(u.name) + '</span>' +
      '<span class="er-meta">' + meta + '</span></span>' +
      '<span class="er-chips">' +
        (s.overdue ? '<span class="chip st-overdue"><span class="dot"></span>' + s.overdue + ' overdue</span>'
         : s.pending ? '<span class="chip chip-plain">' + s.pending + ' pending</span>'
         : s.events ? '<span class="chip st-done"><span class="dot"></span>All done</span>' : '') +
      '</span></button>';
  }

  /* Letters do not get a tab — four already crowd a small phone — so this is
     the way in, and it carries the only number that needs watching: how many are
     sitting on somebody's desk for too long. */
  function letterSection() {
    if (global.Auth && Auth.isVolunteer()) return '';

    var all = (global.Auth && Auth.signedIn())
      ? Store.letters({ unitId: Auth.myUnitId() })
      : Store.letters();
    var s = Store.letterStats(all);
    if (!s.total) return '';

    var chase = all.filter(Store.letterNeedsAttention).slice(0, 3);

    var html = '<div class="section"><div class="section-head">' +
      '<h2>Letters</h2><a class="section-note" href="#/letters">See all</a></div>';

    html += chase.length
      ? '<div class="list">' + chase.map(ViewLetters.row).join('') + '</div>'
      : '<div class="card"><div class="small">' +
        U.plural(s.routing, 'letter') + ' out, nothing needing a chase. ' +
        '<a href="#/letters">Open the tracker</a>.</div></div>';

    return html + '</div>';
  }

  function pill(key, n, label, alert) {
    return '<button type="button" class="pill' + (filter === key ? ' is-active' : '') +
      (alert ? ' alert' : '') + '" data-filter="' + key + '" aria-pressed="' + (filter === key) + '">' +
      '<span class="n">' + n + '</span><span class="l">' + U.esc(label) + '</span></button>';
  }

  function eventRow(e) {
    var s = Store.eventStats(e.id);
    return '<button type="button" class="event-row" data-open-event="' + U.esc(e.id) + '">' +
      UI.ring(s.done, s.total) +
      '<span class="er-main"><span class="er-title">' + U.esc(e.title) + '</span>' +
      '<span class="er-meta">' + U.esc(U.fmtRange(e.dateStart, e.dateEnd)) +
        '<span class="sep">·</span>' + U.esc(U.countdown(e.dateStart, e.dateEnd)) +
        '<span class="sep">·</span>' + s.done + ' of ' + s.total + ' done</span></span>' +
      '<span class="er-chips">' +
        (s.overdue ? '<span class="chip st-overdue"><span class="dot"></span>' + s.overdue + ' overdue</span>'
                   : '<span class="chip chip-plain">' + s.pending + ' pending</span>') +
      '</span></button>';
  }

  function mount(root) {
    if (global.TermUI) TermUI.mountBanner(root);
    U.els('[data-filter]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-filter');
        filter = filter === key && key !== 'attention' ? 'attention' : key;
        App.render();
      });
    });
    U.els('[data-create-event]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.eventForm(null); });
    });
    U.els('[data-open-event]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go('#/events/' + b.getAttribute('data-open-event')); });
    });
    U.els('[data-open-letter]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go('#/letters/' + b.getAttribute('data-open-letter')); });
    });
    U.els('[data-open-unit]', root).forEach(function (b) {
      b.addEventListener('click', function () { ViewEvents.showUnit(b.getAttribute('data-open-unit')); });
    });

    var idle = root.querySelector('[data-toggle-idle]');
    if (idle) idle.addEventListener('click', function () {
      republicOpen = !republicOpen;
      var g = root.querySelector('[data-group="idle"]');
      g.setAttribute('data-collapsed', String(!republicOpen));
      idle.setAttribute('aria-expanded', String(republicOpen));
    });
    U.els('[data-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.taskForm(b.getAttribute('data-edit')); });
    });
  }

  global.ViewDashboard = { render: render, mount: mount };
})(window);
