/* Event detail — where tasks are created, tracked, and printed.
   Header, progress, add, list. Event admin (edit / archive / delete) lives behind
   the ⋯ menu so it stays out of the way of the daily work. */
(function (global) {
  'use strict';

  var state = { tab: 'tasks', groupBy: 'flat', addOpen: false, collapsed: {},
                draft: null, focusAfterRender: false };

  function blankDraft(e) {
    return {
      title: '', assigneeId: '', priority: 'Medium', remarks: '',
      dueDate: e && e.dateStart ? e.dateStart : U.today()
    };
  }

  function openAddTaskOnLoad() { state.addOpen = true; state.draft = null; state.focusAfterRender = true; }

  function canEdit(e) {
    if (!global.Auth || !Auth.signedIn()) return true;
    return Auth.canEditEvent(e.id);
  }

  function render(params) {
    var e = Store.event(params.id);
    if (!e) {
      return '<a class="breadcrumb" href="#/events">' + UI.icon('back') + 'All events</a>' +
        UI.empty('That event is gone', 'It may have been deleted on this device.',
          '<a class="btn btn-primary" href="#/events">Back to events</a>');
    }

    var all = Store.tasks({ eventId: e.id });
    var s = Store.stats(all);
    if (!state.draft) state.draft = blankDraft(e);

    var meta = [U.fmtRange(e.dateStart, e.dateEnd)];
    if (e.venue) meta.push(e.venue);
    if (e.headId) meta.push(Store.personName(e.headId));
    meta.push(U.countdown(e.dateStart, e.dateEnd));

    var mine = canEdit(e);
    var owner = Store.unit(e.unitId);

    var html = '<a class="breadcrumb" href="#/events">' + UI.icon('back') + 'All events</a>';

    html += '<div class="detail-head">' +
      '<div class="page-head" style="margin-bottom:6px">' +
        '<h1 style="min-width:0">' + U.esc(e.title) + '</h1>' +
        '<div class="row" style="gap:6px;flex-wrap:nowrap">' +
          '<button type="button" class="btn btn-primary" data-export>' + UI.icon('pdf') + 'Export PDF</button>' +
          (mine
            ? '<button type="button" class="icon-btn" data-more aria-label="Event options" aria-haspopup="menu">' +
              UI.icon('more') + '</button>'
            : '') +
        '</div>' +
      '</div>' +
      (mine ? '' :
        '<div class="readonly-note">' + UI.icon('alert') +
        '<span>This is <strong>' + U.esc(owner ? owner.name : 'another unit') + '</strong>&rsquo;s activity. ' +
        'You can read everything here; only they can change it.</span></div>') +
      '<div class="detail-meta">' + meta.map(U.esc).join('<span class="sep">·</span>') + '</div>' +
      (all.length
        ? '<div class="row" style="margin-top:14px;gap:12px">' +
            '<div style="flex:1;min-width:150px">' + UI.progressBar(s.done, s.total) + '</div>' +
            (s.overdue ? '<span class="chip st-overdue"><span class="dot"></span>' + s.overdue + ' overdue</span>' : '') +
          '</div>'
        : '') +
      '</div>';

    html += feedbackBanner(e, mine);
    html += reportBanner(e, s);

    var letterCount = Store.letters({ eventId: e.id }).length;
    var volCount = Store.volunteersFor(e.id).length;
    var showVols = !!(global.Auth && Auth.canEnrolVolunteers()) && mine;
    var showLetters = !(global.Auth && Auth.isVolunteer());
    if (state.tab === 'volunteers' && !showVols) state.tab = 'tasks';
    if (state.tab === 'letters' && !showLetters) state.tab = 'tasks';

    var tabs = [['tasks', 'Tasks', all.length]];
    if (showLetters) tabs.push(['letters', 'Letters', letterCount]);
    if (showVols) tabs.push(['volunteers', 'Volunteers', volCount]);

    if (tabs.length > 1) {
      html += '<div class="sub-tabs" role="tablist" aria-label="Sections of this activity">' +
        tabs.map(function (t) {
          var on = state.tab === t[0];
          return '<button type="button" class="sub-tab' + (on ? ' is-active' : '') + '" role="tab" ' +
            'aria-selected="' + on + '" data-tab="' + t[0] + '">' + U.esc(t[1]) +
            (t[2] ? '<span class="st-n">' + t[2] + '</span>' : '') + '</button>';
        }).join('') + '</div>';
    }

    if (state.tab === 'letters') return html + letterSection(e, true);
    if (state.tab === 'volunteers') return html + volunteerSection(e, true);

    html += '<div class="section-head">' +
      (mine ? '<button type="button" class="btn btn-primary" data-open-add>' + UI.icon('plus') + 'Add task</button>' : '') +
      (all.length
        ? '<div class="segmented" role="group" aria-label="Group tasks">' +
            seg('flat', 'All') + seg('assignee', 'By person') + '</div>'
        : '') +
      '</div>';

    if (state.addOpen && mine) html += addForm(e);

    if (!all.length) {
      return html + UI.empty(
        mine ? 'No tasks under this event yet — add the first one.' : 'No tasks under this event yet.',
        'Every task belongs to an event, and this one is empty.');
    }

    var sorted = all.slice().sort(Store.byUrgency);

    if (state.groupBy === 'flat') {
      html += '<div class="list">' + sorted.map(function (t) {
        return UI.taskRow(t, [
          Store.personName(t.assigneeId),
          t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date'
        ]);
      }).join('') + '</div>';
    } else {
      html += groupByAssignee(sorted).map(function (g) {
        var gs = Store.stats(g.tasks);
        var isCollapsed = !!state.collapsed[g.key];
        return '<div class="group" data-collapsed="' + isCollapsed + '" data-group="' + U.esc(g.key) + '">' +
          '<button type="button" class="group-head" data-toggle="' + U.esc(g.key) + '" aria-expanded="' + !isCollapsed + '">' +
            UI.icon('chevronDown', 'caret') +
            '<span class="group-title">' + U.esc(g.name) +
              (g.position ? ' <span class="muted small">' + U.esc(g.position) + '</span>' : '') + '</span>' +
            '<span class="group-meta">' + gs.done + ' of ' + gs.total + ' done' +
              (gs.overdue ? ' · <span class="late">' + gs.overdue + ' overdue</span>' : '') + '</span>' +
          '</button>' +
          '<div class="group-body"><div class="list">' +
          g.tasks.map(function (t) {
            return UI.taskRow(t, [t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date']);
          }).join('') + '</div></div></div>';
      }).join('');
    }

    return html;
  }

  /* Every activity is evaluated. The form has to exist before the activity
     runs, so this sits at the top of the screen from the day it is created —
     not tucked inside the report wizard, which is opened afterwards. */
  function feedbackBanner(e, mine) {
    if (e.status === 'Archived') return '';

    if (e.feedbackRequired === false) {
      return '<div class="fb-banner is-waived">' + UI.icon('alert') +
        '<div><div class="fb-title">No feedback form for this activity.</div>' +
        '<div class="fb-sub">' +
        (e.feedbackWaivedReason
          ? '&ldquo;' + U.esc(e.feedbackWaivedReason) + '&rdquo;' +
            (e.feedbackWaivedBy ? ' &mdash; ' + U.esc(e.feedbackWaivedBy) : '')
          : 'The requirement was set aside.') + '</div>' +
        (mine ? '<div class="fb-actions">' +
          '<button type="button" class="btn btn-sm" data-fb-restore>Require one again</button></div>' : '') +
        '</div></div>';
    }

    if (e.feedbackLink) {
      return '<div class="fb-banner is-done">' + UI.icon('check') +
        '<div><div class="fb-title">Feedback form ready.</div>' +
        '<div class="fb-sub"><a href="' + U.esc(e.feedbackLink) + '" target="_blank" rel="noopener">' +
        'Open the form</a>' + (mine ? ' &middot; <button type="button" class="linkish" data-fb-edit>' +
        'Change the link</button>' : '') + '</div></div></div>';
    }

    return '<div class="fb-banner is-missing">' + UI.icon('alert') +
      '<div><div class="fb-title">This activity still needs a feedback form.</div>' +
      '<div class="fb-sub">Every activity is evaluated. Make a Google Form and add its link &mdash; ' +
      'the activity cannot be marked completed without one.</div>' +
      (mine ? '<div class="fb-actions">' +
        '<button type="button" class="btn btn-sm btn-primary" data-fb-edit>Add the link</button>' +
        '<button type="button" class="btn btn-sm" data-fb-waive>Not needed for this one</button>' +
        '</div>' : '') +
      '</div></div>';
  }

  /* Once the tasks are finished the activity is not finished — the report is the
     last piece. This is where that hand-off happens. */
  function reportBanner(e, s) {
    var tasksDone = s.total > 0 && s.pending === 0;
    var confirmed = e.status === 'Completed';
    if (!tasksDone && !confirmed) return '';

    var report = Store.report(e.id);
    var draft = report || Accomplishment.draftFor(e.id);
    var p = Accomplishment.progress(draft);
    var filed = report && report.driveLink;

    if (!confirmed) {
      // Tasks are all done but nobody has said the activity itself is over.
      return '<div class="report-banner">' +
        '<div class="rb-title">Every task is done.</div>' +
        '<div class="rb-sub">Confirm the activity is finished and the accomplishment report becomes the last step.</div>' +
        '<div class="row" style="margin-top:12px">' +
        '<button type="button" class="btn btn-primary" data-mark-complete>' + UI.icon('check') +
        'Activity is completed</button></div></div>';
    }

    // Overall progress: the tasks are 90% of the job, the report is the last 10%.
    var overall = Math.round(90 + (p.pct * 0.1));
    return '<div class="report-banner">' +
      '<div class="row" style="justify-content:space-between;gap:10px">' +
        '<div style="min-width:180px;flex:1">' +
          '<div class="rb-title">Accomplishment report</div>' +
          '<div class="rb-sub">' +
            (filed ? 'Filed — the archive has the Drive link.'
                   : (p.done ? p.done + ' of ' + p.total + ' sections filled in.'
                             : 'Not started. This is the last thing left.')) +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-primary" data-open-report>' + UI.icon('pdf') +
        (p.done ? 'Continue report' : 'Start report') + '</button>' +
      '</div>' +
      '<div class="progress-row" style="margin-top:12px">' +
        '<div class="progress' + (overall === 100 ? ' is-complete' : '') + '" role="progressbar" ' +
        'aria-valuenow="' + overall + '" aria-valuemin="0" aria-valuemax="100">' +
        '<span style="width:' + overall + '%"></span></div>' +
        '<span class="progress-label">' + overall + '% of the whole activity</span>' +
      '</div>' +
      (filed ? '<p class="tiny muted" style="margin:8px 0 0">' + U.esc(report.driveLink) + '</p>' : '') +
      '</div>';
  }

  /* The paperwork this activity is waiting on. Same row as the Letters screen,
     because a letter should look like the same object wherever it appears. */
  function letterSection(e, asTab) {
    if (global.Auth && Auth.isVolunteer()) return '';
    var mine = canEdit(e);

    var list = Store.letters({ eventId: e.id });
    var chase = list.filter(Store.letterNeedsAttention).length;

    var html = '<div class="section">' +
      (asTab
        ? (chase ? '<p class="small" style="margin:0 2px 10px"><span class="late">' +
            U.plural(chase, 'letter') + ' needing a chase</span></p>' : '')
        : '<div class="section-head">' +
          '<h2>Letters' + (list.length ? ' <span class="chip chip-plain">' + list.length + '</span>' : '') + '</h2>' +
          '<span class="section-note">' +
          (chase ? '<span class="late">' + U.plural(chase, 'letter') + ' needing a chase</span>'
                 : 'Paperwork for this activity.') + '</span></div>');

    html += list.length
      ? '<div class="list">' + list.map(ViewLetters.row).join('') + '</div>'
      : '<p class="small muted" style="margin:2px 2px 10px">Nothing being tracked yet. ' +
        'A letter records where the paper has got to — no document is stored here.</p>';

    html += mine
      ? '<div style="margin-top:10px">' +
        '<button type="button" class="btn" data-add-letter>' + UI.icon('plus') + 'Track a letter</button>' +
        '</div>'
      : '';
    html += '</div>';

    return html;
  }

  /* The volunteers taken on for this activity, and the button that adds one.

     Enrolling a helper is something you do while looking at the activity they are
     helping with, not by leaving for a settings page — so it lives here. The unit
     and the event are already known, which is why the form asks for three things
     and not seven. */
  function volunteerSection(e, asTab) {
    if (!global.Auth || !Auth.canEnrolVolunteers()) return '';
    if (!canEdit(e)) return '';

    var list = Store.volunteersFor(e.id);
    var html = '<div class="section">' +
      (asTab ? ''
        : '<div class="section-head">' +
          '<h2>Volunteers' + (list.length ? ' <span class="chip chip-plain">' + list.length + '</span>' : '') + '</h2>' +
          '<span class="section-note">Helpers for this activity only.</span></div>');

    if (list.length) {
      html += '<div class="list">' + list.map(function (v) {
        return '<div class="task"><span class="task-main" style="cursor:default">' +
          '<span class="task-title">' + U.esc(v.name) + '</span>' +
          '<span class="task-meta">' + U.esc(v.position || 'Volunteer') +
            '<span class="sep">·</span>' + U.esc(v.email) +
            (v.claimed ? '' : '<span class="sep">·</span>has not set a password yet') +
          '</span></span>' +
          '<span class="task-right">' +
          '<button type="button" class="btn btn-sm" data-drop-volunteer="' + U.esc(v.id) + '">Remove</button>' +
          '</span></div>';
      }).join('') + '</div>';
    } else {
      html += '<p class="small muted" style="margin:2px 2px 10px">Nobody yet. A volunteer reaches ' +
        'this activity and nothing else, and only while it is running.</p>';
    }

    html += '<div style="margin-top:10px" class="row" style="gap:8px">' +
      '<button type="button" class="btn" data-add-volunteer>' + UI.icon('plus') + 'Add volunteer</button>' +
      '<button type="button" class="btn" data-import-volunteers>' + UI.icon('upload') + 'Import a list</button>' +
      '</div></div>';

    return html;
  }

  function seg(key, label) {
    return '<button type="button" data-group-by="' + key + '"' +
      (state.groupBy === key ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      U.esc(label) + '</button>';
  }

  function addForm(e) {
    var d = state.draft;
    return '<div class="card" style="border-color:var(--gold-300);background:var(--gold-50);margin-bottom:14px">' +
      '<div class="field"><label for="a-title">Task <span class="req">*</span></label>' +
      '<input type="text" id="a-title" maxlength="160" value="' + U.esc(d.title) + '" placeholder="e.g. Secure the venue reservation">' +
      '<div class="error-text" hidden>Give the task a title.</div></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="a-assignee">Assigned to</label>' +
        '<select id="a-assignee">' + UI.peopleOptions(d.assigneeId, true, e.id) + '</select></div>' +
        '<div class="field"><label for="a-due">Due date</label>' +
        '<input type="date" id="a-due" value="' + U.esc(d.dueDate) + '"></div>' +
      '</div>' +
      '<div class="field"><label for="a-priority">Priority</label>' +
      '<select id="a-priority">' + UI.selectOptions(Store.PRIORITIES, d.priority) + '</select></div>' +
      '<div class="row">' +
        '<button type="button" class="btn btn-primary" data-save-task>' + UI.icon('plus') + 'Add task</button>' +
        '<button type="button" class="btn btn-ghost" data-close-add>Done adding</button>' +
        '<span class="small muted">Stays open for the next one.</span>' +
      '</div></div>';
  }

  function groupByAssignee(list) {
    var map = {}, order = [];
    list.forEach(function (t) {
      var key = t.assigneeId || '';
      if (!map[key]) { map[key] = { id: key, key: key || 'unassigned', tasks: [] }; order.push(key); }
      map[key].tasks.push(t);
    });
    return order.map(function (k) {
      var g = map[k];
      var p = k ? Store.person(k) : null;
      g.name = p ? p.name : 'Unassigned';
      g.position = p ? p.position : '';
      return g;
    }).sort(function (a, b) {
      if (!a.id !== !b.id) return a.id ? -1 : 1;           // Unassigned last
      var ao = a.tasks.filter(Store.isOverdue).length, bo = b.tasks.filter(Store.isOverdue).length;
      if (ao !== bo) return bo - ao;                        // most overdue first
      return a.name.localeCompare(b.name);
    });
  }

  function mount(root, params) {
    var e = Store.event(params.id);
    if (!e) return;

    U.els('[data-tab]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        App.render();
      });
    });

    U.els('[data-add-letter]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.letterForm(null, { eventId: e.id }); });
    });
    U.els('[data-open-letter]', root).forEach(function (b) {
      b.addEventListener('click', function () { App.go('#/letters/' + b.getAttribute('data-open-letter')); });
    });

    U.els('[data-add-volunteer]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.volunteerForm(e.id); });
    });
    U.els('[data-import-volunteers]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.importVolunteersForm(e.id); });
    });
    U.els('[data-drop-volunteer]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var p = Store.person(b.getAttribute('data-drop-volunteer'));
        if (!p) return;
        UI.confirm({
          title: 'Take ' + p.name + ' off this activity?',
          message: 'They lose access to ' + e.title + '.',
          detail: (p.eventIds || []).length > 1
            ? 'They stay on the other activities they were enrolled for.'
            : 'This was their only one, so their access ends entirely.',
          confirmLabel: 'Remove'
        }).then(function (ok) {
          if (!ok) return;
          Store.removeVolunteerFrom(p.id, e.id);
          UI.toast(p.name + ' removed.');
        });
      });
    });

    var exportBtn = root.querySelector('[data-export]');
    if (exportBtn) exportBtn.addEventListener('click', function () { Report.openExportDialog(e.id); });

    var more = root.querySelector('[data-more]');
    if (more) more.addEventListener('click', function () {
      var items =
        '<button type="button" data-set="edit">' + UI.icon('edit') + 'Edit event</button>' +
        (e.status === 'Archived'
          ? '<button type="button" data-set="unarchive">' + UI.icon('archive') + 'Restore from archive</button>'
          : '<button type="button" data-set="archive">' + UI.icon('archive') + 'Archive event</button>') +
        '<div class="sep"></div>' +
        '<button type="button" class="danger" data-set="delete">' + UI.icon('trash') + 'Delete event</button>';
      UI.openMenu(more, items, function (action) {
        if (action === 'edit') return Forms.eventForm(e.id);
        if (action === 'archive') { Store.updateEvent(e.id, { status: 'Archived' }); return UI.toast('Event archived.'); }
        if (action === 'unarchive') { Store.updateEvent(e.id, { status: 'Upcoming' }); return UI.toast('Event restored.'); }
        if (action === 'delete') {
          UI.confirm({
            title: 'Delete this event?',
            message: '“' + e.title + '” and its ' + U.plural(Store.tasks({ eventId: e.id }).length, 'task') + ' will be removed.',
            detail: 'This cannot be undone. Archiving keeps the record instead.',
            confirmLabel: 'Delete event'
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteEvent(e.id);
            UI.toast('Event deleted.');
            App.go('#/events');
          });
        }
      });
    });

    var markDone = root.querySelector('[data-mark-complete]');
    if (markDone) markDone.addEventListener('click', function () {
      if (Store.needsFeedback(e)) {
        return UI.toast('Add the feedback form first — every activity is evaluated.', 'error');
      }
      Store.updateEvent(e.id, { status: 'Completed' });
      UI.toast('Activity marked completed. The report is the last step.');
    });

    U.els('[data-fb-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.feedbackForm(e.id); });
    });
    U.els('[data-fb-waive]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.waiveFeedbackForm(e.id); });
    });
    U.els('[data-fb-restore]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        Store.restoreFeedback(e.id);
        UI.toast('A feedback form is required again.');
      });
    });

    var openReport = root.querySelector('[data-open-report]');
    if (openReport) openReport.addEventListener('click', function () {
      AccomplishmentUI.open(e.id);
    });

    U.els('[data-open-add]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        state.addOpen = true;
        state.focusAfterRender = true;
        App.render();
      });
    });

    var closeAdd = root.querySelector('[data-close-add]');
    if (closeAdd) closeAdd.addEventListener('click', function () {
      state.addOpen = false;
      state.draft = null;
      App.render();
    });

    bindAddForm(root, e);

    U.els('[data-group-by]', root).forEach(function (b) {
      b.addEventListener('click', function () { state.groupBy = b.getAttribute('data-group-by'); App.render(); });
    });

    U.els('[data-toggle]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-toggle');
        state.collapsed[key] = !state.collapsed[key];
        var g = root.querySelector('[data-group="' + key + '"]');
        g.setAttribute('data-collapsed', String(!!state.collapsed[key]));
        b.setAttribute('aria-expanded', String(!state.collapsed[key]));
      });
    });

    U.els('[data-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.taskForm(b.getAttribute('data-edit')); });
    });

    if (state.focusAfterRender) {
      state.focusAfterRender = false;
      var title = root.querySelector('#a-title');
      if (title) title.focus();
    }
  }

  function bindAddForm(root, e) {
    var title = root.querySelector('#a-title');
    if (!title) return;

    var assignee = root.querySelector('#a-assignee');
    var due = root.querySelector('#a-due');
    var priority = root.querySelector('#a-priority');

    // Keep the draft in sync so an unrelated redraw never eats what was typed.
    function sync() {
      state.draft = {
        title: title.value, assigneeId: assignee.value,
        dueDate: due.value, priority: priority.value, remarks: ''
      };
    }
    [title, assignee, due, priority].forEach(function (n) {
      n.addEventListener('input', sync);
      n.addEventListener('change', sync);
    });

    function submit() {
      var value = title.value.trim();
      if (!value) {
        var field = title.closest('.field');
        field.classList.add('has-error');
        field.querySelector('.error-text').hidden = false;
        title.focus();
        return;
      }
      var payload = {
        eventId: e.id, title: value, assigneeId: assignee.value,
        dueDate: due.value, priority: priority.value
      };
      // Reset the draft *before* saving: adding the task redraws the page, and the
      // form has to come back empty and focused. The assignee, date and priority
      // carry over, because the next task in a run is usually similar.
      state.draft = {
        title: '', assigneeId: payload.assigneeId, dueDate: payload.dueDate,
        priority: payload.priority, remarks: ''
      };
      state.focusAfterRender = true;
      Store.addTask(payload);
      UI.toast('Task added.');
    }

    root.querySelector('[data-save-task]').addEventListener('click', submit);
    title.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    });
  }

  global.ViewEventDetail = { render: render, mount: mount, openAddTaskOnLoad: openAddTaskOnLoad };
})(window);
