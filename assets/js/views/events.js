/* Events — the list. Compact rows, archived tucked away.
   There is no search box here on purpose: the header search (or the "/" key)
   already finds any event, task or person, and one search is simpler than two. */
(function (global) {
  'use strict';

  /* `unitId` is which unit's activities are on screen. It starts unset and is
     filled in on the first render with whoever is signed in, because your own
     unit is what you came here for — a national opening this tab wants the
     national activities, not nine colleges' worth to scroll through. "All units"
     is still one tap away for the times when the Republic is the question. */
  var state = { archivedOpen: false, unitId: '', picked: false };

  /* The National officers work across the whole Republic, so they get a unit
     picker here and a unit badge on each row. Everyone else only ever sees one
     unit's events, so neither would tell them anything. */
  function seesRepublic() {
    return !global.Auth || !Auth.signedIn() || Auth.isNational();
  }

  /* Opened from the Overview roll-up: show one unit's events. */
  function showUnit(unitId) {
    state.picked = true;
    state.unitId = Store.unit(unitId) ? unitId : '';
    App.go('#/events');
    App.render();
  }

  function render() {
    // A volunteer sees only the activities they were enrolled into, and only
    // while those activities are still running.
    var all = (global.Auth && Auth.signedIn()) ? Auth.visibleEvents() : Store.events();

    // A unit that has been removed or deactivated stops filtering rather than
    // showing an empty screen with no way back.
    var republic = seesRepublic();

    // Once, on the way in. Afterwards the choice is the person's.
    if (republic && !state.picked) {
      state.picked = true;
      state.unitId = (global.Auth && Auth.signedIn())
        ? Auth.myUnitId() : Store.nationalUnitId();
    }
    if (state.unitId && !Store.unit(state.unitId)) state.unitId = '';
    var picked = republic ? state.unitId : '';
    if (picked) all = all.filter(function (e) { return e.unitId === picked; });

    var archived = all.filter(function (e) { return e.status === 'Archived'; });
    var live = all.filter(function (e) { return e.status !== 'Archived'; });

    var units = republic ? Store.units({ activeOnly: true, governed: true }) : [];
    var html =
      '<div class="page-head"><div><h1>Events</h1>' +
      '<div class="sub">' + U.plural(live.length, 'event') +
        (picked ? ' · ' + U.esc(Store.unitName(picked)) : '') + '</div></div>' +
      (global.Auth && Auth.isVolunteer() ? '' :
        '<button type="button" class="btn btn-primary" data-create-event>' + UI.icon('plus') + 'New event</button>') +
      '</div>';

    if (units.length > 1) {
      html += '<div class="toolbar">' +
        '<label class="sr-only" for="unit-pick">Show one unit</label>' +
        '<select id="unit-pick" class="grow">' +
        '<option value=""' + (picked ? '' : ' selected') + '>All units</option>' +
        units.map(function (u) {
          var n = Store.unitStats(u.id).events;
          return '<option value="' + U.esc(u.id) + '"' + (picked === u.id ? ' selected' : '') + '>' +
            U.esc(u.name) + ' (' + n + ')</option>';
        }).join('') +
        '</select>' +
        (picked ? '<button type="button" class="btn" data-clear-unit>Show all</button>' : '') +
        '</div>';
    }

    if (!live.length) {
      html += (global.Auth && Auth.isVolunteer())
        ? UI.empty('Nothing assigned to you yet',
            'An executive enrols volunteers into an activity. Once that happens it appears here.', '', 'calm')
        : picked
          ? UI.empty('Nothing under ' + Store.unitName(picked),
              'This unit has no events yet. Create one for them, or show all units.',
              '<button type="button" class="btn btn-primary" data-create-event>' + UI.icon('plus') + 'New event</button>' +
              '<button type="button" class="btn" data-clear-unit>Show all units</button>', 'calm')
          : UI.empty('No events yet',
              'Create the first one — tasks live inside events, so this is where everything starts.',
              '<button type="button" class="btn btn-primary" data-create-event>' + UI.icon('plus') + 'New event</button>');
    } else {
      html += '<div class="list">' + live.map(function (e) {
        return row(e, republic && !picked);
      }).join('') + '</div>';
    }

    if (archived.length) {
      html += '<div class="section" style="margin-top:22px">' +
        '<div class="group" data-collapsed="' + !state.archivedOpen + '" data-group="archived">' +
        '<button type="button" class="group-head" data-toggle-archived aria-expanded="' + state.archivedOpen + '">' +
          UI.icon('chevronDown', 'caret') +
          '<span class="group-title">Archived</span>' +
          '<span class="group-meta">' + archived.length + '</span></button>' +
        '<div class="group-body"><div class="list">' + archived.map(function (e) {
          return row(e, republic && !picked);
        }).join('') + '</div></div>' +
        '</div></div>';
    }

    return html;
  }

  // Same row shape as the dashboard's event list, ring and all — an event should
  // look like the same object wherever it appears.
  function row(e, showUnitBadge) {
    var s = Store.eventStats(e.id);
    var u = showUnitBadge ? Store.unit(e.unitId) : null;
    return '<button type="button" class="event-row" data-open-event="' + U.esc(e.id) + '">' +
      UI.ring(s.done, s.total) +
      '<span class="er-main"><span class="er-title">' +
      (u && u.code ? '<span class="unit-code">' + U.esc(u.code) + '</span>' : '') +
      U.esc(e.title) +
      // Marked on sight during the rehearsal, so nobody mistakes an invented
      // activity for one of the council's own.
      (e.sample && Store.dryRun().active
        ? ' <span class="chip chip-plain">sample</span>' : '') + '</span>' +
      '<span class="er-meta">' + U.esc(U.fmtRange(e.dateStart, e.dateEnd)) +
        (e.venue ? '<span class="sep">·</span>' + U.esc(e.venue) : '') +
        '<span class="sep">·</span>' + s.done + ' of ' + s.total + ' done</span></span>' +
      '<span class="er-chips">' +
        (s.overdue ? '<span class="chip st-overdue"><span class="dot"></span>' + s.overdue + ' overdue</span>' : '') +
        '<span class="chip ' + (e.status === 'Ongoing' ? 'st-in-progress' : e.status === 'Completed' ? 'st-done' : 'chip-plain') + '">' +
          U.esc(e.status) + '</span>' +
      '</span></button>';
  }

  function mount(root) {
    U.els('[data-create-event]', root).forEach(function (b) {
      // Creating from inside a unit's list files it under that unit by default.
      b.addEventListener('click', function () { Forms.eventForm(null, { unitId: state.unitId }); });
    });

    var pick = root.querySelector('#unit-pick');
    if (pick) pick.addEventListener('change', function () {
      state.picked = true;
      state.unitId = pick.value;
      App.render();
    });
    U.els('[data-clear-unit]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        state.picked = true;          // "All units" is a choice, not the absence of one
        state.unitId = '';
        App.render();
      });
    });
    U.els('[data-open-event]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go('#/events/' + b.getAttribute('data-open-event')); });
    });

    var arch = root.querySelector('[data-toggle-archived]');
    if (arch) arch.addEventListener('click', function () {
      state.archivedOpen = !state.archivedOpen;
      var g = root.querySelector('[data-group="archived"]');
      g.setAttribute('data-collapsed', String(!state.archivedOpen));
      arch.setAttribute('aria-expanded', String(state.archivedOpen));
    });
  }

  global.ViewEvents = { render: render, mount: mount, showUnit: showUnit };
})(window);
