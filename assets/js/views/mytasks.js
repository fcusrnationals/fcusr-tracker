/* My tasks — one person's work.
   A dropdown at the top says whose tasks are showing. Signed in, it starts on
   the person signed in; with no server behind the tracker, a name is picked
   once and remembered. Work still to do is grouped by activity, soonest first,
   and finished work waits underneath in a "Done" dropdown of its own. */
(function (global) {
  'use strict';

  var filter = 'open';        // open | overdue
  var collapsed = {};
  var doneOpen = false;
  /* Whose tasks a signed-in officer chose to look at, and who was signed in when
     they chose. Kept in memory only: opening the page again starts on yourself,
     and the next person to sign in on a shared computer never inherits it. */
  var chosen = { by: '', id: '' };

  var DIRECTIVES = '__directives__';

  var FILTERS = {
    open:    { label: 'To do',   test: Store.isPending, empty: 'Nothing left to do — every task is done.' },
    overdue: { label: 'Overdue', test: Store.isOverdue, empty: 'Nothing overdue. Well kept.' }
  };

  /* Whether anybody is signed in to a real account, as opposed to the tracker
     running on one device with no server behind it. */
  function signedIn() {
    return !!(global.Auth && Auth.signedIn() && !Auth.isOffline());
  }

  function myEmail() {
    var who = signedIn() ? Auth.current() : null;
    return who && who.email ? String(who.email).toLowerCase() : '';
  }

  /* "Rutor, Angel" and "Angel Rutor" are one person. */
  function nameKey(n) {
    return String(n || '').toLowerCase().replace(/[^a-z0-9À-ɏ\s]/g, ' ')
      .split(/\s+/).filter(Boolean).sort().join(' ');
  }

  /* The signed-in person's directory entry.

     By the address their account was made with, first. An entry typed before
     accounts existed can carry a different address or none, and then My tasks
     came up empty for somebody with work waiting — so failing that, by name,
     but only where exactly one entry has it. */
  function me() {
    if (!signedIn()) return null;
    var byMail = Auth.myPerson ? Auth.myPerson() : Store.personByEmail(myEmail());
    if (byMail) return byMail;
    var want = nameKey(Auth.current().name);
    if (!want) return null;
    var same = Store.people().filter(function (p) { return nameKey(p.name) === want; });
    return same.length === 1 ? same[0] : null;
  }

  function isVolunteer() {
    return signedIn() && !!(Auth.isVolunteer && Auth.isVolunteer());
  }

  /* Who the dropdown offers. A volunteer is shown their own work and nobody
     else's; an officer, the people of their own unit; the National government,
     everybody outside the sealed bodies. Whoever is selected is always listed. */
  function pool(selectedId) {
    var list;
    if (!signedIn()) {
      list = Store.people();
    } else if (isVolunteer()) {
      list = [];
    } else if (Auth.isNational()) {
      list = Store.people().filter(function (p) {
        return !Store.isIndependent(p.unitId) || p.unitId === Auth.myUnitId();
      });
    } else {
      list = Store.people({ unitId: Auth.myUnitId() });
    }
    var self = me();
    [self, selectedId ? Store.person(selectedId) : null].forEach(function (p) {
      if (p && !list.some(function (x) { return x.id === p.id; })) list = [p].concat(list);
    });
    return list.filter(function (p) { return p.active !== false || p.id === selectedId; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /* Whose tasks are showing. */
  function currentPersonId() {
    if (signedIn()) {
      var self = me();
      if (isVolunteer()) return self ? self.id : '';
      if (chosen.by === myEmail() && chosen.id && Store.person(chosen.id)) return chosen.id;
      return self ? self.id : '';
    }
    var id = Store.lastPerson();
    return id && Store.person(id) ? id : '';
  }

  function choose(id) {
    if (signedIn()) chosen = { by: myEmail(), id: id };
    else Store.setLastPerson(id);
    filter = 'open';
    App.render();
  }

  function personPicker(pid) {
    var people = pool(pid);
    var self = me();
    if (isVolunteer() || (pid && people.length < 2)) return '';
    return '<div class="field" style="margin:0 0 12px">' +
      '<label for="person-select">Showing tasks for</label>' +
      '<select id="person-select">' +
      (pid ? '' : '<option value="">Select your name</option>') +
      people.map(function (p) {
        return '<option value="' + U.esc(p.id) + '"' + (p.id === pid ? ' selected' : '') + '>' +
          U.esc(p.name + (self && p.id === self.id ? ' (you)' : '') + (p.position ? ' — ' + p.position : '')) +
          '</option>';
      }).join('') +
      '</select></div>';
  }

  function groupTitle(key) {
    if (key === DIRECTIVES) return 'Directives';
    var e = Store.event(key);
    return e ? e.title : 'An activity you cannot open';
  }

  function render() {
    var pid = currentPersonId();
    var html = heading();

    if (isVolunteer() && !pid) {
      return html + UI.empty('Your tasks will show here',
        'Nothing is assigned to you on this device yet. If you have just signed in, give it ' +
        'a few seconds to catch up. If it stays empty, ask whoever gives you work to check ' +
        'you are in the directory.', '');
    }

    if (!pool(pid).length) {
      return html + UI.empty('No one in the directory yet',
        'Add your officers first, then tasks can be assigned to them.',
        signedIn() && !Auth.isExecutive() ? '' : '<a class="btn btn-primary" href="#/settings">Open settings</a>');
    }

    html += personPicker(pid);

    if (!pid) {
      return html + '<p class="small muted">' + (signedIn()
        ? 'Your account is not matched to a directory entry yet. Pick your name to see your tasks.'
        : 'Pick your name to see your tasks.') + '</p>';
    }

    var person = Store.person(pid);
    var self = me();
    var yours = !signedIn() || (self && self.id === pid);
    var all = Store.tasks({ assigneeId: pid, excludeArchived: true });
    var s = Store.stats(all);
    var f = FILTERS[filter] || FILTERS.open;
    var list = all.filter(f.test).sort(Store.byDueDate);
    var done = all.filter(function (t) { return t.status === 'Done'; }).sort(function (a, b) {
      return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
    });

    html += '<div class="person-bar">' + UI.avatar(person.name) +
      '<div style="flex:1;min-width:120px"><div class="person-name">' + U.esc(person.name) + '</div>' +
      '<div class="person-role">' + U.esc(person.position || 'No position') +
      '<span class="sep"> · </span>' + s.pending + ' to do' +
      (s.overdue ? ' · <span style="color:var(--st-overdue-fg);font-weight:700">' + s.overdue + ' overdue</span>' : '') +
      '<span class="sep"> · </span>' + done.length + ' done' +
      '</div></div></div>';

    html += '<div class="segmented" role="group" aria-label="Filter tasks" style="margin-bottom:14px">' +
      Object.keys(FILTERS).map(function (k) {
        var n = all.filter(FILTERS[k].test).length;
        return '<button type="button" data-filter="' + k + '"' +
          (filter === k ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
          U.esc(FILTERS[k].label) + ' ' + n + '</button>';
      }).join('') + '</div>';

    if (!all.length) {
      return html + (yours
        ? UI.empty('Nothing assigned to you yet', 'When somebody gives you a task it appears here.', '')
        : UI.empty('Nothing assigned yet',
            person.name.split(' ')[0] + ' has no tasks. Open an event to assign one.',
            '<a class="btn btn-primary" href="#/events">Go to events</a>'));
    }

    if (!list.length) {
      html += UI.empty('Nothing here', f.empty, '', 'calm');
    } else {
      // Grouped by activity, because that is how the work is organised.
      // Directives are council-wide and usually matter first.
      var groups = {}, order = [];
      list.forEach(function (t) {
        var key = t.kind === 'directive' || !t.eventId ? DIRECTIVES : t.eventId;
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(t);
      });
      order.sort(function (a, b) { return (a === DIRECTIVES ? -1 : 0) - (b === DIRECTIVES ? -1 : 0); });

      html += order.map(function (key) {
        var rows = groups[key];
        var g = Store.stats(rows);
        var isCollapsed = !!collapsed[key];
        return '<div class="group" data-collapsed="' + isCollapsed + '" data-group="' + U.esc(key) + '">' +
          '<button type="button" class="group-head" data-toggle="' + U.esc(key) + '" aria-expanded="' + !isCollapsed + '">' +
            UI.icon('chevronDown', 'caret') +
            '<span class="group-title">' + U.esc(groupTitle(key)) + '</span>' +
            '<span class="group-meta">' + rows.length +
              (g.overdue ? ' · <span class="late">' + g.overdue + ' overdue</span>' : '') + '</span>' +
          '</button>' +
          '<div class="group-body"><div class="list">' +
          rows.map(function (t) {
            return UI.taskRow(t, [t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date']);
          }).join('') + '</div></div></div>';
      }).join('');
    }

    /* Finished work, out of the way and one tap from view. Ticking a task off
       used to make it vanish from the list with nowhere obvious to find it. */
    if (done.length) {
      html += '<div class="group" data-collapsed="' + !doneOpen + '" data-group="__done__" style="margin-top:14px">' +
        '<button type="button" class="group-head" data-done-toggle aria-expanded="' + doneOpen + '">' +
          UI.icon('chevronDown', 'caret') +
          '<span class="group-title">Done</span>' +
          '<span class="group-meta">' + done.length + '</span>' +
        '</button>' +
        '<div class="group-body"><div class="list">' +
        done.map(function (t) {
          return UI.taskRow(t, [
            t.kind === 'directive' || !t.eventId ? 'Directive' : groupTitle(t.eventId),
            t.completedAt ? 'Done ' + U.fmtDateShort(String(t.completedAt).slice(0, 10)) : ''
          ]);
        }).join('') + '</div></div></div>';
    }

    return html;
  }

  function heading() {
    return '<div class="page-head"><div><h1>My tasks</h1>' +
      '<div class="sub">Soonest deadline first. Finished tasks are under Done.</div></div></div>';
  }

  function mount(root) {
    var sel = root.querySelector('#person-select');
    if (sel) sel.addEventListener('change', function () {
      if (!sel.value) return;
      choose(sel.value);
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

    var dt = root.querySelector('[data-done-toggle]');
    if (dt) dt.addEventListener('click', function () {
      doneOpen = !doneOpen;
      var g = root.querySelector('[data-group="__done__"]');
      g.setAttribute('data-collapsed', String(!doneOpen));
      dt.setAttribute('aria-expanded', String(doneOpen));
    });

    U.els('[data-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.taskForm(b.getAttribute('data-edit')); });
    });
  }

  global.ViewMyTasks = { render: render, mount: mount };
})(window);
