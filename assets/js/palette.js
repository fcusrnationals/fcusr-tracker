/* One box for finding anything and doing anything.

   Search used to cover events, tasks, letters and people. It covers every kind
   of record now — directives, announcements, reports, volunteers, the tools —
   grouped by what they are, and it also answers with actions: type "create
   event" or "watermark" and the thing to do is the first result. Opened from
   the magnifier, with / or with Ctrl/⌘+K.

   Quick Create is the same list of actions without the typing: the + in the
   header, the round button on a phone, or N. It only ever offers what the
   person may actually do — a volunteer is offered nothing and sees no button;
   somebody who cannot post to the Bulletin Board is never offered to. */
(function (global) {
  'use strict';

  function signed() { return !!(global.Auth && Auth.signedIn()); }
  function volunteer() { return !!(global.Auth && Auth.isVolunteer()); }
  function allow(fn) { try { return !global.Auth || fn(); } catch (e) { return false; } }

  /* ---------- what can be done ---------- */

  function go(hash) { return function () { App.go(hash); }; }

  function commands() {
    var list = [
      { id: 'new-event', label: 'Create event', words: 'new activity add event program',
        icon: 'plus', run: function () { Forms.eventForm(null); },
        ok: function () { return Auth.canCreate(); }, create: true, sub: 'An activity, with tasks inside it' },
      { id: 'new-task', label: 'Add task', words: 'new task todo assign',
        icon: 'check', run: function () { newTaskForm(); },
        ok: function () { return Auth.canCreate(); }, create: true, sub: 'Inside one of your activities' },
      { id: 'new-directive', label: 'Create directive', words: 'new directive instruction order',
        icon: 'directive', run: function () { newDirectiveForm(); },
        ok: function () { return !Auth.isVolunteer(); }, create: true, sub: 'A standing instruction, outside any event' },
      { id: 'new-letter', label: 'Track letter', words: 'new letter paper route sign document',
        icon: 'letter', run: function () { Forms.letterForm(null); },
        ok: function () { return !Auth.isVolunteer(); }, create: true, sub: 'Follow a letter from desk to desk' },
      { id: 'new-announcement', label: 'Create announcement', words: 'new announcement bulletin post notice memo',
        icon: 'megaphone', run: function () { Bulletin.form(null); },
        ok: function () { return Auth.canPublishBulletin(); }, create: true, sub: 'Post to the Bulletin Board' },
      { id: 'from-template', label: 'Create event from a template', words: 'template seminar assembly competition reuse',
        icon: 'template', run: function () { Templates.pick(); },
        ok: function () { return Auth.canCreate(); }, sub: 'Start with the usual list of tasks' },
      { id: 'watermark', label: 'Open Watermark Studio', words: 'watermark photos logo documentation images',
        icon: 'stamp', run: go('#/tools/watermark'), ok: function () { return true; } },
      { id: 'calendar', label: 'View calendar', words: 'calendar dates month week schedule agenda',
        icon: 'calendar', run: go('#/calendar'), ok: function () { return true; } },
      { id: 'bulletin', label: 'Open Bulletin Board', words: 'bulletin announcements notices',
        icon: 'megaphone', run: go('#/bulletin'), ok: function () { return true; } },
      { id: 'people', label: 'Open People', words: 'people directory officers members volunteers',
        icon: 'users', run: go('#/people'), ok: function () { return !Auth.isVolunteer(); } },
      { id: 'tools', label: 'Open Tools', words: 'tools utilities apps download',
        icon: 'tools', run: go('#/tools'), ok: function () { return true; } },
      { id: 'ems', label: 'FCUSR Event Management System', words: 'event management system download install app',
        icon: 'layers', run: go('#/tools/event-management'), ok: function () { return true; } },
      { id: 'score', label: 'FCUSR Score Tracker', words: 'score tracker competition ranking tabulation download',
        icon: 'trophy', run: go('#/tools/score-tracker'), ok: function () { return true; } },
      { id: 'archive', label: 'Open Archive', words: 'archive past years academic year history',
        icon: 'archive', run: go('#/archive'), ok: function () { return !Auth.isVolunteer(); } },
      { id: 'term-report', label: 'Export term report', words: 'term report export pdf csv year summary turnover',
        icon: 'download', run: function () { ViewArchive.exportDialog(Workspace.viewYear()); },
        ok: function () { return Auth.canExportTermReport(); } },
      { id: 'templates', label: 'Manage event templates', words: 'templates manage edit',
        icon: 'template', run: function () { Templates.manager(); },
        ok: function () { return Auth.canCreate(); } },
      { id: 'notifications', label: 'Show notifications', words: 'notifications bell alerts inbox',
        icon: 'bell', run: function () { Notify.open(); }, ok: function () { return true; } },
      { id: 'overview', label: 'Go to Overview', words: 'overview home dashboard',
        icon: 'overview', run: go('#/overview'), ok: function () { return !Auth.isVolunteer(); } },
      { id: 'mytasks', label: 'Go to My tasks', words: 'my tasks mine',
        icon: 'mytasks', run: go('#/my-tasks'), ok: function () { return true; } },
      { id: 'directives', label: 'Go to Directives', words: 'directives',
        icon: 'directive', run: go('#/directives'), ok: function () { return !Auth.isVolunteer(); } },
      { id: 'letters', label: 'Go to Letters', words: 'letters correspondence',
        icon: 'letter', run: go('#/letters'), ok: function () { return !Auth.isVolunteer(); } },
      { id: 'events', label: 'Go to Events', words: 'events activities',
        icon: 'event', run: go('#/events'), ok: function () { return true; } },
      { id: 'settings', label: 'Open Settings', words: 'settings setup accounts enrol letterhead',
        icon: 'settings', run: function () { Auth.requireExecutive(function () { App.go('#/settings'); }); },
        ok: function () { return Auth.canOpenSettings(); } }
    ];
    return list.filter(function (c) { return allow(c.ok); });
  }

  // What Quick Create offers: the "create" commands this person may run.
  function createActions() {
    if (!global.Forms) return [];
    return commands().filter(function (c) { return c.create; });
  }

  function matchCommands(q) {
    var words = q.split(/\s+/).filter(Boolean);
    return commands().filter(function (c) {
      var hay = (c.label + ' ' + c.words).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  /* ---------- what can be found ---------- */

  function yearTag(kind, rec) {
    var yid = Store.yearOf(kind, rec);
    if (yid === 'current') return '';
    var y = Store.yearInfo(yid);
    return y ? ' · AY ' + y.label + ' (archived)' : '';
  }

  function seesEvent(e) {
    if (!signed()) return true;
    return Auth.canSee(e.id) || Auth.canEditEvent(e.id);
  }

  function seesTask(t) {
    if (!signed()) return true;
    if (Auth.isMyTask(t)) return true;
    if ((t.kind || 'event') === 'directive') return !volunteer();
    return Auth.canSee(t.eventId);
  }

  var TOOLS = [
    { title: 'Watermark Studio', sub: 'Watermark documentation photos in one go', hash: '#/tools/watermark',
      words: 'watermark photo logo image stamp' },
    { title: 'FCUSR Event Management System', sub: 'Downloadable app for larger events',
      hash: '#/tools/event-management', words: 'event management system install' },
    { title: 'FCUSR Score Tracker', sub: 'Downloadable app for competition scores',
      hash: '#/tools/score-tracker', words: 'score tracker competition ranking' }
  ];

  function has(text, q) { return String(text || '').toLowerCase().indexOf(q) >= 0; }

  function search(q) {
    var out = [];
    var events = Store.events({ kind: 'any' }).filter(function (e) {
      return seesEvent(e) && (has(e.title, q) || has(e.description, q) || has(e.venue, q));
    });
    var acts = events.filter(function (e) { return !Store.isDirectiveSet(e); }).slice(0, 6);
    var sets = events.filter(Store.isDirectiveSet);

    if (acts.length) out.push({ title: 'Events', items: acts.map(function (e) {
      var s = Store.eventStats(e.id);
      return { icon: 'event', title: e.title, go: '#/events/' + e.id,
        sub: U.fmtRange(e.dateStart, e.dateEnd) + ' · ' + s.done + ' of ' + s.total + ' done' +
          (Store.isShelved(e) ? ' · ' + e.status : '') + yearTag('event', e) };
    }) });

    var tasks = Store.tasks().filter(function (t) {
      return seesTask(t) && (has(t.title, q) || has(t.remarks, q));
    }).sort(Store.byUrgency);
    var plain = tasks.filter(function (t) { return (t.kind || 'event') === 'event' &&
      !Store.isDirectiveSet(Store.event(t.eventId)); }).slice(0, 8);
    var dirTasks = tasks.filter(function (t) { return (t.kind || 'event') === 'directive' ||
      Store.isDirectiveSet(Store.event(t.eventId)); });

    if (plain.length) out.push({ title: 'Tasks', items: plain.map(function (t) {
      var e = Store.event(t.eventId);
      return { icon: 'check', title: t.title, go: e ? '#/events/' + e.id : '#/my-tasks',
        sub: (e ? e.title : 'An activity') + ' · ' + Store.personName(t.assigneeId) +
          ' · ' + (t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date') + yearTag('task', t),
        tail: UI.statusChip(t, false) };
    }) });

    var dirItems = sets.slice(0, 4).map(function (d) {
      return { icon: 'directive', title: d.title, go: '#/events/' + d.id,
        sub: 'Directive with tasks' + yearTag('event', d) };
    }).concat(dirTasks.slice(0, 6).map(function (t) {
      var set = Store.event(t.eventId);
      return { icon: 'directive', title: t.title, go: set ? '#/events/' + set.id : '#/directives',
        sub: (set ? set.title + ' · ' : '') + Store.personName(t.assigneeId) + yearTag('task', t),
        tail: UI.statusChip(t, false) };
    }));
    if (dirItems.length) out.push({ title: 'Directives', items: dirItems });

    if (!volunteer()) {
      var letters = Store.letters().filter(function (l) {
        return (!signed() || Auth.canSeeLetter(l)) && (has(l.subject, q) || has(Store.letterInCharge(l), q));
      }).slice(0, 6);
      if (letters.length) out.push({ title: 'Letters', items: letters.map(function (l) {
        return { icon: 'letter', title: l.subject, go: '#/letters/' + l.id,
          sub: Store.letterWhere(l) + ' · ' + Store.letterInCharge(l) + yearTag('letter', l) };
      }) });
    }

    var who = Workspace.viewer();
    var nat = !signed() || Auth.canPublishBulletin();
    var anns = Store.announcements().filter(function (a) {
      var st = Store.announcementState(a);
      if (!nat && (st === 'draft' || st === 'scheduled')) return false;
      return Store.announcementFor(a, who) && (has(a.title, q) || has(a.message, q));
    }).slice(0, 5);
    if (anns.length) out.push({ title: 'Announcements', items: anns.map(function (a) {
      var st = Store.announcementState(a);
      return { icon: 'megaphone', title: a.title, go: '#/bulletin/' + a.id,
        sub: (st === 'active' ? 'Posted ' + U.fmtWhen(a.publishAt)
             : st === 'expired' ? 'Previous · ended ' + U.fmtWhen(a.expiresAt)
             : st === 'draft' ? 'Draft' : 'Scheduled for ' + U.fmtWhen(a.publishAt)) +
          (a.priority !== 'Normal' ? ' · ' + a.priority : '') };
    }) });

    /* A report is found by its activity's name — "Quiz Bowl Accomplishment
       Report" is what somebody types, and the report has no title of its own. */
    var reportHits = Store.reports().map(function (r) { return { r: r, e: Store.event(r.eventId) }; })
      .filter(function (x) {
        return x.e && seesEvent(x.e) &&
          (has(x.e.title, q) || (has('accomplishment report', q) && q.length > 5));
      }).slice(0, 5);
    if (reportHits.length) out.push({ title: 'Accomplishment reports', items: reportHits.map(function (x) {
      return { icon: 'pdf', title: x.e.title + ' — Accomplishment Report', go: '#/events/' + x.e.id,
        sub: (x.r.driveLink ? 'Filed' : x.r.status === 'filed' ? 'Filed' : 'Draft') + yearTag('report', x.r) };
    }) });

    if (!volunteer()) {
      var people = Store.people().filter(function (p) {
        return has(p.name, q) || has(p.position, q) || has(p.committee, q);
      });
      var officers = people.filter(function (p) { return p.access !== 'volunteer'; }).slice(0, 6);
      var vols = people.filter(function (p) { return p.access === 'volunteer'; }).slice(0, 4);
      if (officers.length) out.push({ title: 'People', items: officers.map(personItem) });
      if (vols.length) out.push({ title: 'Volunteers', items: vols.map(personItem) });
    }

    var tools = TOOLS.filter(function (t) { return has(t.title, q) || has(t.words, q); });
    if (tools.length) out.push({ title: 'Tools', items: tools.map(function (t) {
      return { icon: 'tools', title: t.title, sub: t.sub, go: t.hash };
    }) });

    return out;
  }

  function personItem(p) {
    var st = Store.stats(Store.tasks({ assigneeId: p.id, excludeArchived: true }));
    return { icon: 'user', title: p.name, go: '#/people/' + p.id,
      sub: (p.position || (p.access === 'volunteer' ? 'Volunteer' : 'No position')) +
        ' · ' + Store.unitName(p.unitId) + ' · ' + st.pending + ' pending' +
        (p.active === false ? ' · inactive' : '') };
  }

  /* ---------- drawing it ---------- */

  function itemHtml(it, i) {
    return '<button type="button" class="result-item" data-idx="' + i + '">' +
      UI.icon(it.icon) +
      '<span class="rt"><span class="strong">' + U.esc(it.title) + '</span>' +
      (it.sub ? '<span class="rs">' + U.esc(it.sub) + '</span>' : '') + '</span>' +
      (it.tail || '') + '</button>';
  }

  function groupHtml(title, items, offset) {
    return '<div class="pal-group"><div class="section-note strong">' + U.esc(title) + '</div>' +
      '<div class="list">' + items.map(function (it, i) { return itemHtml(it, offset + i); }).join('') +
      '</div></div>';
  }

  function open(initial) {
    UI.modal({
      title: 'Search',
      wide: true,
      cls: 'palette',
      body:
        '<div class="field search-wrap">' + UI.icon('search') +
        '<input type="search" id="q" data-autofocus placeholder="Search, or type what you want to do" ' +
        'autocomplete="off" aria-describedby="pal-help" value="' + U.esc(initial || '') + '">' +
        '</div><p class="tiny muted" id="pal-help" style="margin:-6px 2px 4px">Events, tasks, directives, ' +
        'letters, announcements, reports, people and tools. Try “create event” or “watermark”.</p>' +
        '<div id="results" role="region" aria-live="polite"></div>',
      onMount: function (root, close) {
        var input = root.querySelector('#q');
        var outEl = root.querySelector('#results');
        var flat = [];

        function draw() {
          var raw = input.value.trim();
          var q = raw.toLowerCase();
          flat = [];
          var html = '';
          var push = function (title, items) {
            if (!items.length) return;
            html += groupHtml(title, items, flat.length);
            flat = flat.concat(items);
          };

          if (q.length < 2) {
            // Nothing typed yet: the things people most often come here to do.
            var sug = commands().filter(function (c) {
              return ['new-event', 'new-task', 'new-letter', 'watermark', 'calendar', 'bulletin']
                .indexOf(c.id) >= 0;
            });
            push('Suggestions', sug.map(function (c) {
              return { icon: c.icon, title: c.label, sub: c.sub || '', run: c.run };
            }));
            outEl.innerHTML = html + '<p class="small muted" style="margin:12px 2px 0">Type at least two ' +
              'letters to search everything.</p>';
          } else {
            push('Actions', matchCommands(q).slice(0, 5).map(function (c) {
              return { icon: c.icon, title: c.label, sub: c.sub || '', run: c.run };
            }));
            search(q).forEach(function (g) { push(g.title, g.items); });
            outEl.innerHTML = html || UI.empty('Nothing matched “' + raw + '”',
              'Try a shorter word, or part of a name.', '', 'calm');
          }

          U.els('[data-idx]', outEl).forEach(function (b) {
            b.addEventListener('click', function () {
              var it = flat[Number(b.getAttribute('data-idx'))];
              if (!it) return;
              close();
              if (it.run) it.run(); else App.go(it.go);
            });
          });
        }

        // Up and down move through the results; Enter opens one.
        root.addEventListener('keydown', function (ev) {
          if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
          var items = U.els('.result-item', outEl);
          if (!items.length) return;
          ev.preventDefault();
          var at = items.indexOf(document.activeElement);
          var next = ev.key === 'ArrowDown' ? at + 1 : at - 1;
          if (next < 0) return input.focus();
          items[Math.min(next, items.length - 1)].focus();
        });
        input.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter') return;
          var first = outEl.querySelector('.result-item');
          if (first) { ev.preventDefault(); first.click(); }
        });

        input.addEventListener('input', U.debounce(draw, 110));
        draw();
      }
    });
  }

  /* ---------- quick create ---------- */

  function quickCreate(anchor) {
    var acts = createActions();
    if (!acts.length) return;
    if (!Workspace.narrow() && anchor && anchor.offsetParent !== null) {
      var html = acts.map(function (c) {
        return '<button type="button" class="rich" data-set="' + c.id + '">' + UI.icon(c.icon) +
          '<span class="rich-text"><span class="rich-title">' + U.esc(c.label) + '</span>' +
          '<span class="rich-sub">' + U.esc(c.sub || '') + '</span></span></button>';
      }).join('');
      var menu = UI.openMenu(anchor, html, function (id) {
        var c = acts.filter(function (x) { return x.id === id; })[0];
        if (c) c.run();
      }, { cls: 'menu-rich' });
      menu.setAttribute('aria-label', 'Create');
      return;
    }
    UI.modal({
      title: 'Create',
      sheet: true,
      body: '<div class="list">' + acts.map(function (c) {
        return '<button type="button" class="result-item" data-make="' + c.id + '">' + UI.icon(c.icon) +
          '<span class="rt"><span class="strong">' + U.esc(c.label) + '</span>' +
          '<span class="rs">' + U.esc(c.sub || '') + '</span></span></button>';
      }).join('') + '</div>',
      onMount: function (root, close) {
        U.els('[data-make]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var c = acts.filter(function (x) { return x.id === b.getAttribute('data-make'); })[0];
            close();
            if (c) c.run();
          });
        });
      }
    });
  }

  /* A task, from anywhere. It still has to live inside an activity — that rule
     stands — so the activity is the first thing asked, from the ones this
     person may add work to. */
  function editableEvents() {
    return Store.events({ kind: 'any', excludeArchived: true }).filter(function (e) {
      if (Store.isLocked('event', e)) return false;
      return !signed() || Auth.canEditEvent(e.id);
    });
  }

  function newTaskForm(presetEventId) {
    var evs = editableEvents();
    if (!evs.length) {
      return UI.modal({
        title: 'Add task',
        body: UI.empty('No activity to add it to yet',
          'Every task lives inside an event or a directive. Create the event first, then add its tasks.',
          '<button type="button" class="btn btn-primary" data-new-ev>' + UI.icon('plus') + 'Create event</button>',
          'events'),
        onMount: function (root, close) {
          root.querySelector('[data-new-ev]').addEventListener('click', function () {
            close();
            Forms.eventForm(null);
          });
        }
      });
    }
    var pick = presetEventId && evs.some(function (e) { return e.id === presetEventId; })
      ? presetEventId : evs[0].id;
    var options = evs.map(function (e) {
      return { value: e.id, label: (Store.isDirectiveSet(e) ? 'Directive: ' : '') + e.title +
        (e.dateStart ? ' (' + U.fmtDateTiny(e.dateStart) + ')' : '') };
    });

    UI.modal({
      title: 'Add task',
      body:
        '<div class="field" data-field="title"><label for="qt-title">Task <span class="req">*</span></label>' +
        '<input type="text" id="qt-title" data-autofocus maxlength="160" placeholder="e.g. Book the sound system">' +
        '<div class="error-text" hidden></div></div>' +
        '<div class="field"><label for="qt-event">Activity or directive</label>' +
        '<select id="qt-event">' + UI.selectOptions(options, pick) + '</select></div>' +
        '<div class="field-row">' +
        '<div class="field"><label for="qt-who">Assigned to</label>' +
        '<select id="qt-who">' + UI.peopleOptions('', true, pick) + '</select></div>' +
        '<div class="field"><label for="qt-due">Due date</label>' +
        '<input type="date" id="qt-due" value="' + U.esc(Store.event(pick).dateStart || U.today()) + '"></div>' +
        '</div>' +
        '<div class="field"><label for="qt-pri">Priority</label>' +
        '<select id="qt-pri">' + UI.selectOptions(Store.PRIORITIES, 'Medium') + '</select></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' + UI.icon('plus') + 'Add task</button>',
      onMount: function (root, close) {
        var ev = root.querySelector('#qt-event');
        var who = root.querySelector('#qt-who');
        ev.addEventListener('change', function () {
          // Who may be given it depends on whose activity it is.
          who.innerHTML = UI.peopleOptions(who.value, true, ev.value);
        });
        function save() {
          var title = root.querySelector('#qt-title').value.trim();
          var field = root.querySelector('[data-field="title"]');
          if (!title) {
            field.classList.add('has-error');
            field.querySelector('.error-text').textContent = 'Give the task a title.';
            field.querySelector('.error-text').hidden = false;
            return root.querySelector('#qt-title').focus();
          }
          try {
            var t = Store.addTask({
              eventId: ev.value, title: title, assigneeId: who.value,
              dueDate: root.querySelector('#qt-due').value, priority: root.querySelector('#qt-pri').value
            });
            close();
            UI.toast('Task added to ' + Store.event(t.eventId).title + '.');
          } catch (err) { UI.toast(err.message, 'error'); }
        }
        root.querySelector('[data-save]').addEventListener('click', save);
        root.querySelector('#qt-title').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
      }
    });
  }

  /* A single directive: one instruction, one person. The version with several
     tasks under it is one tap away, because that is a different shape of thing. */
  function newDirectiveForm() {
    UI.modal({
      title: 'Create directive',
      body:
        '<div class="field" data-field="title"><label for="qd-title">Directive <span class="req">*</span></label>' +
        '<input type="text" id="qd-title" data-autofocus maxlength="160" ' +
        'placeholder="e.g. Submit the liquidation of the Foundation Week budget">' +
        '<div class="error-text" hidden></div></div>' +
        '<div class="field-row">' +
        '<div class="field"><label for="qd-who">Assigned to</label>' +
        '<select id="qd-who">' + UI.peopleOptions('', true) + '</select></div>' +
        '<div class="field"><label for="qd-due">Due date</label>' +
        '<input type="date" id="qd-due" value="' + U.esc(U.addDays(U.today(), 7)) + '"></div>' +
        '</div>' +
        '<div class="field"><label for="qd-pri">Priority</label>' +
        '<select id="qd-pri">' + UI.selectOptions(Store.PRIORITIES, 'Medium') + '</select></div>' +
        '<p class="small muted" style="margin:0">Several people and tasks under one instruction? ' +
        '<button type="button" class="linkish" data-set-form>Make a directive with tasks</button> instead.</p>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Create directive</button>',
      onMount: function (root, close) {
        root.querySelector('[data-set-form]').addEventListener('click', function () {
          close();
          Forms.eventForm(null, { kind: 'directive' });
        });
        root.querySelector('[data-save]').addEventListener('click', function () {
          var title = root.querySelector('#qd-title').value.trim();
          if (!title) {
            var f = root.querySelector('[data-field="title"]');
            f.classList.add('has-error');
            f.querySelector('.error-text').textContent = 'Say what the directive is.';
            f.querySelector('.error-text').hidden = false;
            return root.querySelector('#qd-title').focus();
          }
          try {
            Store.addTask({
              kind: 'directive', title: title, assigneeId: root.querySelector('#qd-who').value,
              dueDate: root.querySelector('#qd-due').value, priority: root.querySelector('#qd-pri').value
            });
            close();
            UI.toast('Directive created.');
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }
    });
  }

  global.Palette = {
    open: open, quickCreate: quickCreate, createActions: createActions, commands: commands,
    search: search, newTaskForm: newTaskForm, newDirectiveForm: newDirectiveForm
  };
})(window);
