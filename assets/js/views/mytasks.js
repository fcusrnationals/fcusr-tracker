/* My tasks — the signed-in person's work.
   With no server behind the tracker there is no login, and a name is picked once
   and remembered; signed in, it is simply whoever is signed in. A single
   segmented filter replaced the four dropdowns that used to sit here. Sorting is
   always soonest first. */
(function (global) {
  'use strict';

  var filter = 'open';        // open | overdue | done
  var collapsed = {};

  var FILTERS = {
    open:    { label: 'To do',   test: Store.isPending,   empty: 'Nothing left to do — every task is done.' },
    overdue: { label: 'Overdue', test: Store.isOverdue,   empty: 'Nothing overdue. Well kept.' },
    done:    { label: 'Done',    test: function (t) { return t.status === 'Done'; }, empty: 'Nothing finished yet.' }
  };

  /* Whether anybody is signed in to a real account, as opposed to the tracker
     running on one device with no server behind it. */
  function signedIn() {
    return !!(global.Auth && Auth.signedIn() && !Auth.isOffline());
  }

  /* Whose tasks these are.

     This screen was written before there were logins: "pick a name once; the
     device remembers it". It never asked who was signed in. So every officer
     opened their own task list to a dropdown asking them to find themselves; a
     volunteer was handed their college's whole roster to choose from, and could
     read anybody's work by choosing someone else; and on a shared computer the
     remembered name outlived signing out, so the next officer to sign in opened
     My tasks onto the previous one's tasks, under the previous one's name.

     Signed in, the answer is the person signed in — matched to the directory by
     the address their account was made with. The picker stays only for the
     tracker running with no server, where there is nobody to be. */
  function currentPersonId() {
    if (signedIn()) {
      var me = Auth.current();
      var p = me && me.email ? Store.personByEmail(me.email) : null;
      return p ? p.id : '';
    }
    var id = Store.lastPerson();
    return id && Store.person(id) ? id : '';
  }

  function render() {
    var pid = currentPersonId();

    if (signedIn() && !pid) {
      /* Not "select your name". Somebody signed in is somebody; if this device
         has no directory entry for them yet, that is either the first sync still
         arriving or an entry nobody has made — and neither is fixed by choosing
         a stranger from a list. */
      return heading() + UI.empty('Your tasks will show here',
        'Nothing is assigned to you on this device yet. If you have just signed in, give it ' +
        'a few seconds to catch up. If it stays empty, ask whoever gives you work to check ' +
        'you are in the directory under ' + U.esc(Auth.current().email) + '.',
        '');
    }

    var people = Store.people();
    if (!people.length) {
      return heading() + UI.empty('No one in the directory yet',
        'Add your officers first, then tasks can be assigned to them.',
        '<a class="btn btn-primary" href="#/settings">Open settings</a>');
    }

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
      (signedIn() ? '' :
        '<button type="button" class="btn btn-sm" data-switch>' + UI.icon('users') + 'Switch</button>') +
      '</div>';

    html += '<div class="segmented" role="group" aria-label="Filter tasks" style="margin-bottom:14px">' +
      Object.keys(FILTERS).map(function (k) {
        var n = all.filter(FILTERS[k].test).length;
        return '<button type="button" data-filter="' + k + '"' +
          (filter === k ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
          U.esc(FILTERS[k].label) + ' ' + n + '</button>';
      }).join('') + '</div>';

    if (!all.length) {
      return html + (signedIn()
        ? UI.empty('Nothing assigned to you yet', 'When somebody gives you a task it appears here.', '')
        : UI.empty('Nothing assigned yet',
            person.name.split(' ')[0] + ' has no tasks. Open an event to assign one.',
            '<a class="btn btn-primary" href="#/events">Go to events</a>'));
    }
    if (!list.length) return html + UI.empty('Nothing here', f.empty);

    // Grouped by event, because that is how the work is actually organised.
    /* A directive belongs to no activity, so it was grouped under the empty id and
       headed "Event" — which is exactly the thing it is not. They collect under
       "Directives" at the top, because they are council-wide and usually matter
       first. */
    var DIRECTIVES = '__directives__';
    var groups = {}, order = [];
    list.forEach(function (t) {
      var key = t.eventId || DIRECTIVES;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(t);
    });
    order.sort(function (a, b) { return (a === DIRECTIVES ? -1 : 0) - (b === DIRECTIVES ? -1 : 0); });

    html += order.map(function (eid) {
      var e = Store.event(eid);
      var rows = groups[eid];
      var g = Store.stats(rows);
      var isCollapsed = !!collapsed[eid];
      return '<div class="group" data-collapsed="' + isCollapsed + '" data-group="' + U.esc(eid) + '">' +
        '<button type="button" class="group-head" data-toggle="' + U.esc(eid) + '" aria-expanded="' + !isCollapsed + '">' +
          UI.icon('chevronDown', 'caret') +
          '<span class="group-title">' +
            U.esc(eid === DIRECTIVES ? 'Directives' : (e ? e.title : 'An activity no longer here')) +
          '</span>' +
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
