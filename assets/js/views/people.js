/* People — the directory everyone assigns work from.

   It exists so that "Francine" on one task and "Francine D." on another are
   one person, so a name is picked rather than typed, and so anybody can see
   who holds which post. A person's page shows what they are holding right now
   — their open tasks, directives, events and letters — because that is what
   somebody opening it wants to know.

   Deliberately not a performance board: no completion rates, no rankings, no
   comparing one officer with another. It is a directory. */
(function (global) {
  'use strict';

  var state = { q: '', unit: '', kind: '', status: '' };

  function signed() { return !!(global.Auth && Auth.signedIn()); }
  function national() { return !signed() || Auth.isNational(); }
  /* Who may add and edit directory entries: whoever may open Settings, which
     is where the directory has always been kept. */
  function manages() {
    if (!global.Auth) return true;
    if (!Auth.signedIn()) return Auth.isOffline();
    return Auth.canOpenSettings();
  }

  /* Who this person may look up: the National government, everybody outside
     the sealed bodies; anybody else, their own unit. The same line My tasks
     draws. */
  function pool() {
    if (!signed()) return Store.people();
    if (Auth.isVolunteer()) return [];
    if (Auth.isNational()) {
      return Store.people().filter(function (p) {
        return !Store.isIndependent(p.unitId) || p.unitId === Auth.myUnitId();
      });
    }
    return Store.people({ unitId: Auth.myUnitId() });
  }

  function accountState(p) {
    if (p.active === false) return 'inactive';
    if (p.claimed) return 'login';
    return p.email ? 'waiting' : 'none';
  }

  var STATUS = {
    '': 'Everyone',
    active: 'Active',
    login: 'Has a sign-in',
    waiting: 'Sign-in not used yet',
    none: 'No sign-in',
    inactive: 'Inactive'
  };

  function matches(p) {
    var q = state.q.trim().toLowerCase();
    if (q) {
      var hay = [p.name, p.position, p.committee, p.email, Store.unitName(p.unitId)].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (state.unit && p.unitId !== state.unit) return false;
    if (state.kind && (p.access || 'officer') !== state.kind) return false;
    if (state.status === 'active') return p.active !== false;
    if (state.status && accountState(p) !== state.status) return false;
    return true;
  }

  /* Names that are probably the same person: the same words in any order,
     accents and full stops aside. Offered for a person to judge, never merged
     by itself — two real people can share a name. */
  function lookalikes(list) {
    var by = {};
    list.forEach(function (p) {
      var k = U.nameKey(p.name);
      if (k) (by[k] = by[k] || []).push(p);
    });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (g) { return g.length > 1; });
  }

  function row(p) {
    var open = Store.tasks({ assigneeId: p.id, pendingOnly: true, excludeArchived: true })
      .filter(function (t) { return !Store.isLocked('task', t); }).length;
    var u = Store.unit(p.unitId);
    var st = accountState(p);
    return '<a class="person-row" href="#/people/' + U.esc(p.id) + '">' +
      '<span class="who w' + UI.whoIndex(p.name) + '" aria-hidden="true">' + U.esc(U.initials(p.name)) + '</span>' +
      '<span class="rt"><span class="strong">' + U.esc(p.name) + '</span>' +
      '<span class="rs">' + U.esc([p.position || (p.access === 'volunteer' ? 'Volunteer' : 'No position set'),
        p.committee].filter(Boolean).join(' · ')) + '</span></span>' +
      '<span class="pr-tags">' +
        (u ? '<span class="unit-code">' + U.esc(u.code || u.name) + '</span>' : '') +
        (p.isHead ? '<span class="chip chip-plain">Head</span>' : '') +
        (p.access === 'volunteer' ? '<span class="chip chip-plain">Volunteer</span>' : '') +
        (st === 'inactive' ? '<span class="chip st-not-started">Inactive</span>'
          : st === 'none' && !Auth.isOffline() ? '<span class="chip chip-plain">No sign-in</span>' : '') +
        (open ? '<span class="pr-open">' + U.plural(open, 'open task') + '</span>' : '') +
      '</span></a>';
  }

  function render(params) {
    var all = pool();
    var list = all.filter(matches).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var units = national() ? Store.units({ activeOnly: true, governed: true }) : [];

    var html = '<div class="page-head"><div><h1>People</h1>' +
      '<div class="sub">' + U.plural(all.length, 'person', 'people') + ' in the directory.</div></div>' +
      (manages() ? '<button type="button" class="btn btn-primary" data-add-person>' + UI.icon('plus') + 'Add someone</button>' : '') +
      '</div>';
    html += Workspace.hint('people', 'Everyone the council gives work to. Assignments are picked from this ' +
      'list, so a task always belongs to a real person — no misspellings, no duplicates.');

    var dup = manages() ? Store.duplicatePeopleCount() : 0;
    var alike = manages() ? lookalikes(all).filter(function (g) {
      // Exact duplicates within one unit are already counted above.
      return !g.every(function (p) { return p.name.trim().toLowerCase() === g[0].name.trim().toLowerCase() && p.unitId === g[0].unitId; });
    }) : [];
    if (dup) {
      html += '<div class="readonly-note">' + UI.icon('alert') + '<span>' + U.plural(dup, 'name appears', 'names appear') +
        ' twice in the same unit. Merging keeps one entry and moves everything the others held onto it. ' +
        '<button type="button" class="linkish" data-merge>Merge duplicates</button></span></div>';
    }
    if (alike.length) {
      html += '<div class="readonly-note">' + UI.icon('info') + '<span>These look like the same person written ' +
        'differently: ' + alike.slice(0, 3).map(function (g) {
          return g.map(function (p) { return '<strong>' + U.esc(p.name) + '</strong> (' + U.esc(Store.unitName(p.unitId)) + ')'; }).join(' and ');
        }).join('; ') + '. If so, deactivate the extra entry from its page.</span></div>';
    }

    html += '<div class="toolbar people-tools">' +
      '<div class="search-wrap grow">' + UI.icon('search') +
        '<label class="sr-only" for="pp-q">Search people</label>' +
        '<input type="search" id="pp-q" placeholder="Name, position, committee or unit" value="' + U.esc(state.q) + '"></div>' +
      (units.length > 1
        ? '<label class="sr-only" for="pp-unit">Unit</label><select id="pp-unit">' +
          '<option value="">All units</option>' + units.map(function (u) {
            return '<option value="' + U.esc(u.id) + '"' + (state.unit === u.id ? ' selected' : '') + '>' + U.esc(u.name) + '</option>';
          }).join('') + '</select>'
        : '') +
      '<label class="sr-only" for="pp-kind">Officers or volunteers</label><select id="pp-kind">' +
        UI.selectOptions([{ value: '', label: 'All roles' }, { value: 'officer', label: 'Officers' },
          { value: 'volunteer', label: 'Volunteers' }], state.kind) + '</select>' +
      '<label class="sr-only" for="pp-status">Account</label><select id="pp-status">' +
        UI.selectOptions(Object.keys(STATUS).filter(function (k) {
          return !(global.Auth && Auth.isOffline()) || ['', 'active', 'inactive'].indexOf(k) >= 0;
        }).map(function (k) { return { value: k, label: STATUS[k] }; }), state.status) + '</select>' +
      '</div>';

    if (!all.length) {
      return html + UI.empty('Nobody in the directory yet',
        'People are added when they are enrolled, or from Settings. Tasks are assigned to them from here.',
        manages() ? '<button type="button" class="btn btn-primary" data-add-person>' + UI.icon('plus') + 'Add someone</button>' : '',
        'people');
    }
    if (!list.length) {
      return html + UI.empty('Nobody matches', 'Try a shorter search, or clear the filters.',
        '<button type="button" class="btn" data-clear>Clear the filters</button>', 'people');
    }
    return html + '<p class="tiny muted" style="margin:0 2px 8px">Showing ' + U.plural(list.length, 'person', 'people') + '</p>' +
      '<div class="list">' + list.map(row).join('') + '</div>';
  }

  function mount(root) {
    var q = root.querySelector('#pp-q');
    if (q) q.addEventListener('input', U.debounce(function () {
      state.q = q.value;
      App.render();
      var again = document.getElementById('pp-q');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 180));
    [['#pp-unit', 'unit'], ['#pp-kind', 'kind'], ['#pp-status', 'status']].forEach(function (x) {
      var el = root.querySelector(x[0]);
      if (el) el.addEventListener('change', function () { state[x[1]] = el.value; App.render(); });
    });
    U.els('[data-clear]', root).forEach(function (b) {
      b.addEventListener('click', function () { state = { q: '', unit: '', kind: '', status: '' }; App.render(); });
    });
    U.els('[data-add-person]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.personForm(null); });
    });
    var merge = root.querySelector('[data-merge]');
    if (merge) merge.addEventListener('click', function () {
      UI.confirm({
        title: 'Merge the duplicates?',
        message: 'For each name that appears twice in one unit, the first entry is kept and the tasks, events and ' +
          'letters of the others are moved onto it.',
        tone: 'primary', confirmLabel: 'Merge them'
      }).then(function (ok) {
        if (!ok) return;
        var n = Store.mergeDuplicatePeople();
        UI.toast(n ? 'Merged ' + U.plural(n, 'duplicate') + '.' : 'Nothing needed merging.');
      });
    });
  }

  /* ---------- one person ---------- */

  function detailRender(params) {
    var p = Store.person(params.id);
    var back = '<a class="breadcrumb" href="#/people">' + UI.icon('back') + 'All people</a>';
    if (!p || !pool().some(function (x) { return x.id === p.id; })) {
      return back + UI.empty('That person is not here', 'They may have been removed, or they belong to another unit.',
        '<a class="btn btn-primary" href="#/people">Back to People</a>', 'people');
    }
    var st = accountState(p);
    var open = Store.tasks({ assigneeId: p.id, pendingOnly: true }).filter(function (t) {
      return Workspace.inView('task', t);
    }).sort(Store.byDueDate);
    var plain = open.filter(function (t) {
      return (t.kind || 'event') === 'event' && !Store.isDirectiveSet(Store.event(t.eventId));
    });
    var directives = open.filter(function (t) { return plain.indexOf(t) < 0; });
    var evIds = {};
    Store.tasks({ assigneeId: p.id }).forEach(function (t) { if (t.eventId) evIds[t.eventId] = 1; });
    var events = Store.events({ activeOnly: true }).filter(function (e) {
      return (e.headId === p.id || evIds[e.id]) && Workspace.inView('event', e) &&
        (!signed() || Auth.canSee(e.id));
    });
    var letters = Store.letters({ openOnly: true }).filter(function (l) {
      return l.inChargeId === p.id && Workspace.inView('letter', l) && (!signed() || Auth.canSeeLetter(l));
    });

    var html = back + '<div class="person-head">' +
      '<span class="who w' + UI.whoIndex(p.name) + ' big" aria-hidden="true">' + U.esc(U.initials(p.name)) + '</span>' +
      '<div class="ph-text"><h1>' + U.esc(p.name) + '</h1>' +
        '<div class="detail-meta">' + U.esc([p.position || (p.access === 'volunteer' ? 'Volunteer' : ''),
          Store.unitName(p.unitId), p.committee].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="pr-tags" style="margin-top:8px">' +
          (p.isHead ? '<span class="chip chip-plain">Head of unit</span>' : '') +
          (p.access === 'volunteer' ? '<span class="chip chip-plain">Volunteer</span>' : '<span class="chip chip-plain">Officer</span>') +
          (st === 'inactive' ? '<span class="chip st-not-started">Inactive</span>'
            : st === 'login' ? '<span class="chip st-done"><span class="dot"></span>Signs in as ' + U.esc(U.loginLabel(p.email)) + '</span>'
            : st === 'waiting' ? '<span class="chip st-for-review">Sign-in not used yet</span>'
            : !Auth.isOffline() ? '<span class="chip chip-plain">No sign-in</span>' : '') +
        '</div></div>' +
      '<div class="row" style="gap:6px;align-self:flex-start">' +
        (manages() ? '<button type="button" class="btn" data-edit-person>' + UI.icon('edit') + 'Edit</button>' : '') +
        '<button type="button" class="icon-btn" data-person-more aria-label="More about ' + U.esc(p.name) + '" aria-haspopup="menu">' +
          UI.icon('more') + '</button>' +
      '</div></div>';

    html += block('Open tasks', plain.length, plain.length
      ? '<div class="list">' + plain.map(function (t) {
          var e = Store.event(t.eventId);
          return UI.taskRow(t, [e ? e.title : 'An activity', t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date']);
        }).join('') + '</div>'
      : '<p class="small muted">Nothing open.</p>');
    if (directives.length) {
      html += block('Directives', directives.length, '<div class="list">' + directives.map(function (t) {
        var set = Store.event(t.eventId);
        return UI.taskRow(t, [set ? set.title : 'Directive', t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date']);
      }).join('') + '</div>');
    }
    if (events.length) {
      html += block('Events', events.length, '<div class="list">' + events.map(function (e) {
        return '<a class="event-row" href="#/events/' + U.esc(e.id) + '">' +
          '<span class="er-main"><span class="er-title">' + U.esc(e.title) + '</span>' +
          '<span class="er-meta">' + U.esc(U.fmtRange(e.dateStart, e.dateEnd)) +
          (e.headId === p.id ? '<span class="sep">·</span>Event head' : '') + '</span></span></a>';
      }).join('') + '</div>');
    }
    if (letters.length) {
      html += block('Letters they are carrying', letters.length, '<div class="list">' + letters.map(function (l) {
        return '<a class="event-row" href="#/letters/' + U.esc(l.id) + '"><span class="er-main">' +
          '<span class="er-title">' + U.esc(l.subject) + '</span>' +
          '<span class="er-meta">' + U.esc(Store.letterWhere(l)) + '</span></span></a>';
      }).join('') + '</div>');
    }
    return html;
  }

  function block(title, n, inner) {
    return '<section class="section"><div class="section-head"><h2>' + U.esc(title) +
      (n ? ' <span class="chip chip-plain">' + n + '</span>' : '') + '</h2></div>' + inner + '</section>';
  }

  function detailMount(root, params) {
    var p = Store.person(params.id);
    if (!p) return;
    var edit = root.querySelector('[data-edit-person]');
    if (edit) edit.addEventListener('click', function () { Forms.personForm(p.id); });
    var more = root.querySelector('[data-person-more]');
    if (more) more.addEventListener('click', function () {
      UI.openMenu(more, '<button type="button" data-set="history">' + UI.icon('history') + 'Activity history</button>',
        function () { Workspace.history('person', p.id, p.name); });
    });
    U.els('[data-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.taskForm(b.getAttribute('data-edit')); });
    });
  }

  global.ViewPeople = {
    render: render, mount: mount, lookalikes: lookalikes,
    detail: { render: detailRender, mount: detailMount }
  };
})(window);
