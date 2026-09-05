/* My tasks — one officer's work.
   Pick a name once; the device remembers it. A single segmented filter replaced
   the four dropdowns that used to sit here. Sorting is always soonest first. */
(function (global) {
  'use strict';

  var filter = 'open';        // open | overdue | done
  var collapsed = {};

  var FILTERS = {
    open:    { label: 'To do',   test: Store.isPending,   empty: 'Nothing left to do — every task is done.' },
    overdue: { label: 'Overdue', test: Store.isOverdue,   empty: 'Nothing overdue. Well kept.' },
    done:    { label: 'Done',    test: function (t) { return t.status === 'Done'; }, empty: 'Nothing finished yet.' }
  };

  function currentPersonId() {
    var id = Store.lastPerson();
    return id && Store.person(id) ? id : '';
  }

  function render() {
    var people = Store.people();
    if (!people.length) {
      return heading() + UI.empty('No one in the directory yet',
        'Add your officers first, then tasks can be assigned to them.',
        '<a class="btn btn-primary" href="#/settings">Open settings</a>');
    }

    var pid = currentPersonId();
    if (!pid) {
      return heading() +
        '<div class="person-bar" style="display:block">' +
        '<div class="field" style="margin:0"><label for="person-select">Select your name</label>' +
        '<select id="person-select">' + UI.peopleOptions('', false) + '</select>' +
        '<div class="hint">Just a filter for viewing — not a login, and it does not limit what you can edit.</div>' +
        '</div></div>';
    }

    var person = Store.person(pid);
    var all = Store.tasks({ assigneeId: pid, excludeArchived: true });
    var s = Store.stats(all);
    var f = FILTERS[filter];
    var list = all.filter(f.test).sort(Store.byDueDate);

    var html = heading() +
      '<div class="person-bar">' + UI.avatar(person.name) +
      '<div style="flex:1;min-width:120px"><div class="person-name">' + U.esc(person.name) + '</div>' +
      '<div class="person-role">' + U.esc(person.position || 'No position') +
      '<span class="sep"> · </span>' + s.pending + ' pending' +
      (s.overdue ? ' · <span style="color:var(--st-overdue-fg);font-weight:700">' + s.overdue + ' overdue</span>' : '') +
      '</div></div>' +
      '<button type="button" class="btn btn-sm" data-switch>' + UI.icon('users') + 'Switch</button>' +
      '</div>';

    html += '<div class="segmented" role="group" aria-label="Filter tasks" style="margin-bottom:14px">' +
      Object.keys(FILTERS).map(function (k) {
        var n = all.filter(FILTERS[k].test).length;
        return '<button type="button" data-filter="' + k + '"' +
          (filter === k ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
          U.esc(FILTERS[k].label) + ' ' + n + '</button>';
      }).join('') + '</div>';

    if (!all.length) {
      return html + UI.empty('Nothing assigned yet',
        person.name.split(' ')[0] + ' has no tasks. Open an event to assign one.',
        '<a class="btn btn-primary" href="#/events">Go to events</a>');
    }
    if (!list.length) return html + UI.empty('Nothing here', f.empty);

    // Grouped by event, because that is how the work is actually organised.
    var groups = {}, order = [];
    list.forEach(function (t) {
      if (!groups[t.eventId]) { groups[t.eventId] = []; order.push(t.eventId); }
      groups[t.eventId].push(t);
    });

    html += order.map(function (eid) {
      var e = Store.event(eid);
      var rows = groups[eid];
      var g = Store.stats(rows);
      var isCollapsed = !!collapsed[eid];
      return '<div class="group" data-collapsed="' + isCollapsed + '" data-group="' + U.esc(eid) + '">' +
        '<button type="button" class="group-head" data-toggle="' + U.esc(eid) + '" aria-expanded="' + !isCollapsed + '">' +
          UI.icon('chevronDown', 'caret') +
          '<span class="group-title">' + U.esc(e ? e.title : 'Event') + '</span>' +
          '<span class="group-meta">' + rows.length + (g.overdue ? ' · <span class="late">' + g.overdue + ' overdue</span>' : '') + '</span>' +
        '</button>' +
        '<div class="group-body"><div class="list">' +
        rows.map(function (t) {
          return UI.taskRow(t, [t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date']);
        }).join('') + '</div></div></div>';
    }).join('');

    return html;
  }

  function heading() {
    return '<div class="page-head"><div><h1>My tasks</h1>' +
      '<div class="sub">Soonest deadline first.</div></div></div>';
  }

  function mount(root) {
    var sel = root.querySelector('#person-select');
    if (sel) sel.addEventListener('change', function () {
      if (!sel.value) return;
      Store.setLastPerson(sel.value);
      App.render();
    });

    var sw = root.querySelector('[data-switch]');
    if (sw) sw.addEventListener('click', function () {
      UI.modal({
        title: 'Switch person',
        body: '<div class="field"><label for="sw-person">Select your name</label>' +
          '<select id="sw-person" data-autofocus>' + UI.peopleOptions(currentPersonId(), false) + '</select></div>',
        footer: '<button type="button" class="btn" data-close>Cancel</button>' +
          '<button type="button" class="btn btn-primary" data-ok>Show their tasks</button>',
        onMount: function (m, close) {
          m.querySelector('[data-ok]').addEventListener('click', function () {
            var v = m.querySelector('#sw-person').value;
            if (!v) return;
            Store.setLastPerson(v);
            close();
            App.render();
          });
        }
      });
    });

    U.els('[data-filter]', root).forEach(function (b) {
      b.addEventListener('click', function () { filter = b.getAttribute('data-filter'); App.render(); });
    });

    U.els('[data-toggle]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-toggle');
        collapsed[id] = !collapsed[id];
        var g = root.querySelector('[data-group="' + id + '"]');
        g.setAttribute('data-collapsed', String(!!collapsed[id]));
        b.setAttribute('aria-expanded', String(!collapsed[id]));
      });
    });

    U.els('[data-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.taskForm(b.getAttribute('data-edit')); });
    });
  }

  global.ViewMyTasks = { render: render, mount: mount };
})(window);
