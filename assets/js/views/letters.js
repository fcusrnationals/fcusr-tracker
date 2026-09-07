/* Letters — the pile, and where each one has got to.

   The question this screen answers is the one nobody can answer from memory:
   which letters are moving, which are sitting on somebody's desk, and who is
   walking each one round. Everything else is secondary to that. */
(function (global) {
  'use strict';

  var filter = 'open';   // open | attention | done | all

  var FILTERS = {
    open: {
      label: 'Still moving',
      note: 'Not yet approved.',
      test: function (l) { return l.status === 'Routing'; },
      emptyTitle: 'Nothing is out at the moment',
      emptyText: 'Every letter has come back. Start one when the next activity needs paperwork.'
    },
    attention: {
      label: 'Needs chasing',
      note: 'Sitting too long, sent back, or past its deadline.',
      test: Store.letterNeedsAttention,
      emptyTitle: 'Nothing needs chasing',
      emptyText: 'No letter is overdue, stuck at an office, or waiting to be revised.'
    },
    done: {
      label: 'Finished',
      note: 'Approved, declined or withdrawn.',
      test: function (l) { return l.status !== 'Routing'; },
      emptyTitle: 'Nothing finished yet',
      emptyText: 'Approved letters collect here.'
    },
    all: {
      label: 'All letters',
      note: 'Everything on record.',
      test: function () { return true; },
      emptyTitle: 'No letters yet',
      emptyText: 'Track the first one — a proposal, a venue request, a solicitation.'
    }
  };

  /* A volunteer is enrolled into an activity, not into the council's
     correspondence, so this screen is for officers. */
  function mine() {
    if (!global.Auth || !Auth.signedIn()) return Store.letters();
    if (Auth.isVolunteer()) return [];
    return Store.letters({ unitId: Auth.myUnitId() });
  }

  function render() {
    var all = mine();
    var s = Store.letterStats(all);
    var f = FILTERS[filter] || FILTERS.open;
    var list = all.filter(f.test);

    var html = '<div class="page-head"><div><h1>Letters</h1>' +
      '<div class="sub">' + U.plural(s.routing, 'letter') + ' still moving' +
      (s.attention ? ' · <span class="late">' + s.attention + ' needing a chase</span>' : '') +
      '</div></div>' +
      '<button type="button" class="btn btn-primary" data-new-letter>' +
      UI.icon('plus') + 'Track a letter</button></div>';

    html += '<div class="pills" role="group" aria-label="Filter the letters">' +
      pill('open', s.routing, 'Still moving') +
      pill('attention', s.attention, 'Needs chasing', s.attention > 0) +
      pill('done', s.approved, 'Finished') +
      '</div>';

    html += '<div class="section"><div class="section-head">' +
      '<h2>' + U.esc(f.label) + (list.length ? ' <span class="chip chip-plain">' + list.length + '</span>' : '') + '</h2>' +
      '<span class="section-note">' + U.esc(f.note) + '</span></div>';

    html += list.length
      ? '<div class="list">' + list.map(row).join('') + '</div>'
      : UI.empty(f.emptyTitle, f.emptyText,
          filter === 'all' || !all.length
            ? '<button type="button" class="btn btn-primary" data-new-letter>' +
              UI.icon('plus') + 'Track a letter</button>'
            : '', 'calm');
    html += '</div>';

    return html;
  }

  function pill(key, n, label, alert) {
    return '<button type="button" class="pill' + (filter === key ? ' is-active' : '') +
      (alert ? ' alert' : '') + '" data-filter="' + key + '" aria-pressed="' + (filter === key) + '">' +
      '<span class="n">' + n + '</span><span class="l">' + U.esc(label) + '</span></button>';
  }

  /* One line per letter: what it is, where it is, and who is carrying it.
     Shared with the section inside an event, so a letter looks like the same
     object wherever it appears. */
  function row(l) {
    var p = Store.letterProgress(l);
    var stuck = Store.isStuck(l);
    var late = Store.isLetterOverdue(l);
    var e = l.eventId ? Store.event(l.eventId) : null;

    return '<button type="button" class="event-row letter-row" data-open-letter="' + U.esc(l.id) + '">' +
      UI.ring(p.done, p.total) +
      '<span class="er-main">' +
      '<span class="er-title">' + U.esc(l.subject) + '</span>' +
      '<span class="er-meta">' + U.esc(Store.letterWhere(l)) +
        // Nobody is carrying this one. Same red as everywhere else it is true.
        '<span class="sep">·</span>' +
        (l.inChargeId || l.inChargeName
          ? U.esc(Store.letterInCharge(l))
          : '<span class="unassigned">' + U.esc(Store.letterInCharge(l)) + '</span>') +
        (e ? '<span class="sep">·</span>' + U.esc(e.title) : '') +
      '</span></span>' +
      '<span class="er-chips">' +
        (stuck ? '<span class="chip st-overdue"><span class="dot"></span>Chase it</span>' : '') +
        (late && !stuck ? '<span class="chip st-overdue"><span class="dot"></span>Past deadline</span>' : '') +
        (l.status === 'Approved' ? '<span class="chip st-done"><span class="dot"></span>Approved</span>' : '') +
        (l.status === 'Declined' ? '<span class="chip st-overdue"><span class="dot"></span>Declined</span>' : '') +
        (l.status === 'Withdrawn' ? '<span class="chip chip-plain">Withdrawn</span>' : '') +
      '</span></button>';
  }

  function mount(root) {
    U.els('[data-filter]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-filter');
        filter = filter === key && key !== 'open' ? 'open' : key;
        App.render();
      });
    });
    U.els('[data-new-letter]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.letterForm(null); });
    });
    U.els('[data-open-letter]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go('#/letters/' + b.getAttribute('data-open-letter')); });
    });
  }

  global.ViewLetters = { render: render, mount: mount, row: row };
})(window);
