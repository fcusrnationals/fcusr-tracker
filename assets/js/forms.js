/* FCUSR Task Tracker — the dialogs shared by more than one screen:
   create/edit an event, edit a task, add/edit a person. */
(function (global) {
  'use strict';

  function field(opts) {
    return '<div class="field" data-field="' + opts.name + '">' +
      '<label for="f-' + opts.name + '">' + U.esc(opts.label) +
      (opts.required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' +
      opts.control +
      (opts.hint ? '<div class="hint">' + U.esc(opts.hint) + '</div>' : '') +
      '<div class="error-text" hidden></div></div>';
  }

  function showError(root, name, message) {
    var f = root.querySelector('[data-field="' + name + '"]');
    if (!f) return;
    f.classList.add('has-error');
    var e = f.querySelector('.error-text');
    e.textContent = message;
    e.hidden = false;
    var input = f.querySelector('input,select,textarea');
    if (input) input.focus();
  }

  function clearErrors(root) {
    U.els('.field.has-error', root).forEach(function (f) {
      f.classList.remove('has-error');
      var e = f.querySelector('.error-text');
      if (e) e.hidden = true;
    });
  }

  /* ---------- event ---------- */

  /* One form for an activity and for a directive that holds tasks. They are the
     same record and the same questions, minus the three an instruction has no
     answers for: where it is held, its feedback form, and the accomplishment
     report that follows from both. */
  function eventForm(eventId, opts) {
    opts = opts || {};
    var ev = eventId ? Store.event(eventId) : null;
    var isNew = !ev;
    var kind = ev ? (ev.kind || 'event') : (opts.kind === 'directive' ? 'directive' : 'event');
    var dir = kind === 'directive';
    var noun = dir ? 'directive' : 'event';
    var e = ev || {
      title: '', description: '', dateStart: dir ? '' : U.today(), dateEnd: '', venue: '',
      headId: '', status: 'Upcoming', feedbackRequired: !dir, feedbackLink: '',
      unitId: opts.unitId || (global.Auth ? Auth.myUnitId() : Store.nationalUnitId())
    };


    var body =
      field({
        name: 'title', label: dir ? 'Directive' : 'Event title', required: true,
        control: '<input type="text" id="f-title" data-autofocus maxlength="120" value="' + U.esc(e.title) +
          '" placeholder="' + (dir ? 'e.g. Prepare the General Assembly' : 'e.g. Foundation Week 2026') + '">'
      }) +
      field({
        name: 'description', label: dir ? 'What it is for' : 'Short description',
        control: '<textarea id="f-description" maxlength="400" placeholder="' +
          (dir ? 'What the council wants done, and why.' : 'What is this event or program about?') +
          '">' + U.esc(e.description) + '</textarea>'
      }) +
      '<div class="field-row">' +
      field({
        name: 'dateStart', label: dir ? 'Due by' : 'Event date', required: !dir,
        control: '<input type="date" id="f-dateStart" value="' + U.esc(e.dateStart) + '">',
        hint: dir ? 'Optional. A standing instruction may have no date at all.' : ''
      }) +
      field({
        name: 'dateEnd', label: dir ? 'Until' : 'End date',
        control: '<input type="date" id="f-dateEnd" value="' + U.esc(e.dateEnd) + '">',
        hint: dir ? 'Optional.' : 'Leave blank for a one-day event.'
      }) +
      '</div>' +
      (dir ? '' : field({
        name: 'venue', label: 'Venue',
        control: '<input type="text" id="f-venue" maxlength="120" value="' + U.esc(e.venue) + '" placeholder="e.g. FCU Gymnasium">'
      })) +
      /* Every activity is evaluated. The field sits here rather than in the
         report wizard because the form has to exist before the activity runs —
         asking for it afterwards is asking too late to be any use. Nobody
         evaluates a directive, so it is not asked for one. */
      (dir ? '' : field({
        name: 'feedbackLink', label: 'Feedback form',
        control: '<input type="text" id="f-feedback" maxlength="300" value="' +
          U.esc(e.feedbackLink || '') + '" placeholder="https://forms.gle/…">',
        hint: e.feedbackRequired === false
          ? 'Not required for this activity. The requirement can be put back from the activity itself.'
          : 'Required by standard. Make a Google Form and paste its link. You can add it later, ' +
            'but the activity cannot be marked completed without one.'
      })) +
      '<div class="field-row">' +
      field({
        name: 'headId', label: dir ? 'Who is answerable' : 'Event head',
        control: '<select id="f-headId">' + UI.peopleOptions(e.headId, true, e.id).replace('>Unassigned<', '>Not set yet<') + '</select>'
      }) +
      field({
        name: 'status', label: 'Status',
        /* Cancelled is not offered here. Calling an activity off asks for a
           reason and whether it will be held later, which a dropdown cannot —
           it has a button of its own on the activity. */
        control: '<select id="f-status">' + UI.selectOptions(
          Store.EVENT_STATUSES.filter(function (x) { return x !== 'Cancelled' || e.status === 'Cancelled'; }),
          e.status) + '</select>'
      }) +
      '</div>';

    UI.modal({
      title: (isNew ? 'New ' : 'Edit ') + noun,
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' +
        (isNew ? 'Create ' + noun : 'Save changes') + '</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var data = {
            title: root.querySelector('#f-title').value.trim(),
            description: root.querySelector('#f-description').value,
            dateStart: root.querySelector('#f-dateStart').value,
            dateEnd: root.querySelector('#f-dateEnd').value,
            venue: dir ? '' : root.querySelector('#f-venue').value,
            headId: root.querySelector('#f-headId').value,
            status: root.querySelector('#f-status').value,
            kind: kind
          };
          /* There is no "whose event" to choose. You are signed in to one
             unit's tracker, so an event you create there is that unit's — the
             question only ever had one answer. */
          if (isNew) data.unitId = e.unitId;

          data.feedbackLink = dir ? '' : root.querySelector('#f-feedback').value.trim();
          if (data.feedbackLink &&
              !/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(data.feedbackLink)) {
            return showError(root, 'feedbackLink',
              'That needs to be a Google Forms link \u2014 forms.gle or docs.google.com/forms.');
          }

          if (!data.title) {
            return showError(root, 'title', dir ? 'Say what the directive is.' : 'Give the event a title.');
          }
          if (!dir && !data.dateStart) return showError(root, 'dateStart', 'Pick the event date.');
          if (data.dateEnd && data.dateEnd < data.dateStart) {
            return showError(root, 'dateEnd', 'The end date cannot be before the start date.');
          }
          if (isNew) {
            var created = Store.addEvent(data);
            close();
            UI.toast(dir ? 'Directive created.' : 'Event created.');
            // Straight into it, ready for its first task.
            global.ViewEventDetail.openAddTaskOnLoad();
            App.go('#/events/' + created.id);
          } else {
            Store.updateEvent(eventId, data);
            close();
            UI.toast(dir ? 'Directive saved.' : 'Event saved.');
          }
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#f-title').addEventListener('keydown', function (e2) {
          if (e2.key === 'Enter') { e2.preventDefault(); submit(); }
        });
      }
    });
  }

  /* ---------- task ---------- */

  function taskForm(taskId) {
    var t = Store.task(taskId);
    if (!t) return;
    /* The full form is for whoever may edit the task. Anybody else who reaches
       it — the person it was given to, most often — reads it instead. */
    if (global.Auth && Auth.signedIn() && !UI.taskEditable(t)) return taskView(taskId);
    var ev = Store.event(t.eventId);
    /* A directive belongs to no activity. This form asked for one anyway, with
       the first activity in the list already chosen, so saving any change to a
       directive quietly filed it under whichever activity came first — moving
       it into that unit, and out of sight of the people it was meant for. */
    var directive = (t.kind || 'event') === 'directive';
    var inDirective = Store.isDirectiveSet(ev);

    var body =
      field({
        name: 'title', label: 'Task', required: true,
        control: '<input type="text" id="f-title" data-autofocus maxlength="160" value="' + U.esc(t.title) + '">'
      }) +
      '<div class="field-row">' +
      field({
        name: 'assigneeId', label: 'Assigned to',
        control: '<select id="f-assigneeId">' + UI.peopleOptions(t.assigneeId, true, t.eventId) + '</select>'
      }) +
      field({
        name: 'dueDate', label: 'Due date',
        control: '<input type="date" id="f-dueDate" value="' + U.esc(t.dueDate) + '">'
      }) +
      '</div>' +
      '<div class="field-row">' +
      field({
        name: 'priority', label: 'Priority',
        control: '<select id="f-priority">' + UI.selectOptions(Store.PRIORITIES, t.priority) + '</select>'
      }) +
      field({
        name: 'status', label: 'Status',
        control: '<select id="f-status">' + UI.selectOptions(Store.STATUSES, t.status) + '</select>'
      }) +
      '</div>' +
      '<div id="blocked-wrap"' + (t.status === 'On hold' ? '' : ' hidden') + '>' +
      field({
        name: 'blockedReason', label: 'Why is it on hold?', required: true,
        control: '<input type="text" id="f-blockedReason" maxlength="140" value="' + U.esc(t.blockedReason) + '" placeholder="e.g. Waiting for the adviser to sign.">'
      }) + '</div>' +
      field({
        name: 'remarks', label: 'Remarks',
        control: '<textarea id="f-remarks" maxlength="400" placeholder="Anything the officer should know.">' + U.esc(t.remarks) + '</textarea>'
      }) +
      '<div class="field-row">' +
      (directive ? '' : field({
        name: 'eventId', label: inDirective ? 'Directive' : 'Event', required: true,
        /* A task under a directive that holds tasks belongs to that directive,
           not to an activity. Offering it the list of activities would move it
           into the first one on the list the moment anything was saved. */
        control: '<select id="f-eventId">' + UI.selectOptions(
          Store.events({ kind: inDirective ? 'directive' : 'event' })
            .map(function (e2) { return { value: e2.id, label: e2.title }; }), t.eventId
        ) + '</select>',
        hint: inDirective ? 'Every task belongs to a directive or an activity.'
                          : 'Every task belongs to an event.'
      })) + '</div>' +
      '<p class="tiny muted" style="margin:2px 0 0">Last updated ' + U.esc(U.fmtStamp(t.updatedAt)) +
      (t.completedAt ? ' · Completed ' + U.esc(U.fmtStamp(t.completedAt)) : '') + '</p>';

    UI.modal({
      title: 'Edit task',
      body: body,
      footer:
        '<button type="button" class="btn btn-danger left" data-delete>' + UI.icon('trash') + 'Delete</button>' +
        '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Save changes</button>',
      onMount: function (root, close) {
        var statusSel = root.querySelector('#f-status');
        var blockedWrap = root.querySelector('#blocked-wrap');
        statusSel.addEventListener('change', function () {
          blockedWrap.hidden = statusSel.value !== 'On hold';
        });

        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var data = {
            title: root.querySelector('#f-title').value.trim(),
            assigneeId: root.querySelector('#f-assigneeId').value,
            dueDate: root.querySelector('#f-dueDate').value,
            priority: root.querySelector('#f-priority').value,
            status: statusSel.value,
            remarks: root.querySelector('#f-remarks').value,
            blockedReason: root.querySelector('#f-blockedReason').value.trim()
          };
          if (!directive) data.eventId = root.querySelector('#f-eventId').value;
          if (!data.title) return showError(root, 'title', 'Give the task a title.');
          if (data.status === 'On hold' && !data.blockedReason) {
            return showError(root, 'blockedReason', 'Add a one-line reason.');
          }
          Store.updateTask(taskId, data);
          close();
          UI.toast('Task saved.');
        });

        root.querySelector('[data-delete]').addEventListener('click', function () {
          UI.confirm({
            title: 'Delete this task?',
            message: '“' + t.title + '” will be removed from ' +
              (directive ? 'the directives' : (ev ? ev.title : 'this event')) + '.',
            detail: 'This cannot be undone.',
            confirmLabel: 'Delete task'
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteTask(taskId);
            close();
            UI.toast('Task deleted.');
          });
        });
      }
    });
  }


  /* A task opened by somebody who may read it and not edit it. Where it is
     theirs, they can still say how it is going — which is most of what anybody
     given a task needs to do. */
  function taskView(taskId) {
    var t = Store.task(taskId);
    if (!t) return;
    var ev = Store.event(t.eventId);
    var directive = (t.kind || 'event') === 'directive';
    var inDirective = Store.isDirectiveSet(ev);
    var mine = !global.Auth || !Auth.signedIn() || UI.taskStatusEditable(t);

    function row(label, value) {
      return '<div class="field"><div class="small muted">' + U.esc(label) + '</div>' +
        '<div>' + value + '</div></div>';
    }

    var body =
      row('Task', '<strong>' + U.esc(t.title) + '</strong>') +
      row(directive || inDirective ? 'Directive' : 'Activity',
        directive ? 'Council business, not part of an activity'
          : U.esc(ev ? ev.title : 'An activity you cannot open')) +
      '<div class="field-row">' +
      row('Assigned to', U.esc(Store.personName(t.assigneeId))) +
      row('Due', U.esc(t.dueDate ? U.fmtDate(t.dueDate) : 'No due date')) +
      '</div>' +
      row('Priority', U.esc(t.priority)) +
      (t.remarks ? row('Remarks', U.esc(t.remarks)) : '') +
      (mine
        ? field({
            name: 'status', label: 'How is it going?',
            control: '<select id="f-status">' + UI.selectOptions(Store.STATUSES, t.status) + '</select>'
          }) +
          '<div id="blocked-wrap"' + (t.status === 'On hold' ? '' : ' hidden') + '>' +
          field({
            name: 'blockedReason', label: 'Why is it on hold?', required: true,
            control: '<input type="text" id="f-blockedReason" maxlength="140" value="' +
              U.esc(t.blockedReason) + '" placeholder="e.g. Waiting for the adviser to sign.">'
          }) + '</div>'
        : row('Status', UI.statusChip(t, false)) +
          (t.status === 'On hold' && t.blockedReason ? row('On hold because', U.esc(t.blockedReason)) : ''));

    UI.modal({
      title: mine ? 'Your task' : 'Task',
      body: body,
      footer: '<button type="button" class="btn" data-close>' + (mine ? 'Cancel' : 'Close') + '</button>' +
        (mine ? '<button type="button" class="btn btn-primary" data-save>Save</button>' : ''),
      onMount: function (root, close) {
        var sel = root.querySelector('#f-status');
        if (!sel) return;
        var wrap = root.querySelector('#blocked-wrap');
        sel.addEventListener('change', function () { wrap.hidden = sel.value !== 'On hold'; });
        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var reason = root.querySelector('#f-blockedReason').value.trim();
          if (sel.value === 'On hold' && !reason) {
            return showError(root, 'blockedReason', 'Add a one-line reason.');
          }
          Store.setTaskStatus(taskId, sel.value, reason);
          close();
          UI.toast(sel.value === 'Done' ? 'Marked done.' : 'Saved.');
        });
      }
    });
  }

  /* ---------- enrolment ----------
     The single door through which access is created. Position is free text and
     grants nothing; the toggle and the event list are what actually decide what
     the person can reach. */

  /* A unit — the National government, a province (a college or school level),
     COMELEC, or the Supreme Court. Names and codes are edited here rather than in
     code, because the roster of colleges changes and the app must not need a
     developer when it does. */
  function unitForm(unitId) {
    var u = unitId ? Store.unit(unitId) : null;
    var isNew = !u;
    var isNational = !!u && u.kind === 'national';
    var held = u ? Store.unitEventCount(u.id) : 0;
    var d = u || { name: '', code: '', kind: 'province', active: true };

    var KINDS = [
      ['province', 'Province — a college or school level'],
      ['comelec', 'COMELEC'],
      ['judiciary', 'Judiciary'],
      ['branch', 'Independent body — runs its own tracker']
    ];

    var body =
      field({
        name: 'name', label: 'Name', required: true,
        control: '<input type="text" id="f-uname" data-autofocus maxlength="120" value="' +
          U.esc(d.name) + '" placeholder="e.g. College of Nursing">'
      }) +
      field({
        name: 'code', label: 'Short code',
        control: '<input type="text" id="f-ucode" maxlength="16" value="' + U.esc(d.code) + '" placeholder="e.g. CN">',
        hint: 'Shown as a badge beside their events. Letters and numbers only.'
      }) +
      field({
        name: 'trackerName', label: 'Name in the header',
        control: '<input type="text" id="f-utracker" maxlength="120" value="' +
          U.esc(Store.trackerName(d)) + '" placeholder="e.g. FCUSR COE">',
        hint: 'What their people see at the top of the screen, with ' +
          '&ldquo;Task Tracker&rdquo; added after it.'
      }) +
      (isNational
        ? '<p class="small muted">This is the National government. It cannot be renamed to another kind, ' +
          'made inactive, or removed &mdash; council-wide work is filed here.</p>'
        : field({
            name: 'kind', label: 'Kind',
            control: '<select id="f-ukind">' + KINDS.map(function (k) {
              return '<option value="' + k[0] + '"' + (d.kind === k[0] ? ' selected' : '') + '>' +
                U.esc(k[1]) + '</option>';
            }).join('') + '</select>'
          })) +
      (!isNew && !isNational
        ? '<p class="small muted">' + (held
            ? U.plural(held, 'event') + ' filed here. A unit holding events can be set inactive but not removed, ' +
              'so past work keeps its unit.'
            : 'Nothing is filed here yet, so it can be removed outright.') + '</p>'
        : '');

    UI.modal({
      title: isNew ? 'Add unit' : 'Edit unit',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        (!isNew && !isNational && !held
          ? '<button type="button" class="btn btn-danger" data-remove>Remove</button>' : '') +
        '<button type="button" class="btn btn-primary" data-save>' + (isNew ? 'Add unit' : 'Save') + '</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var kindEl = root.querySelector('#f-ukind');
          var data = {
            name: root.querySelector('#f-uname').value.trim(),
            code: root.querySelector('#f-ucode').value.trim(),
            trackerName: root.querySelector('#f-utracker').value.trim(),
            kind: kindEl ? kindEl.value : d.kind
          };
          if (!data.name) return showError(root, 'name', 'Give the unit a name.');
          if (isNew) {
            Store.addUnit(data);
            close();
            UI.toast(data.name + ' added.');
          } else {
            Store.updateUnit(unitId, data);
            close();
            UI.toast('Unit saved.');
          }
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#f-uname').addEventListener('keydown', function (e2) {
          if (e2.key === 'Enter') { e2.preventDefault(); submit(); }
        });

        var rm = root.querySelector('[data-remove]');
        if (rm) rm.addEventListener('click', function () {
          UI.confirm({
            title: 'Remove ' + d.name + '?',
            message: 'It disappears from the unit list and from every picker.',
            detail: 'Nothing is filed under it, so no work is lost. You can add it back later.',
            confirmLabel: 'Remove unit'
          }).then(function (ok) {
            if (!ok) return;
            try {
              Store.deleteUnit(unitId);
              close();
              UI.toast(d.name + ' removed.');
            } catch (err) {
              UI.toast(err.message, 'error');
            }
          });
        });
      }
    });
  }

  /* ---------- offices ---------- */

  /* An office a letter passes through. The turnaround is the only number here
     and it earns its place: it is what lets the tracker say "this has been
     sitting there too long" instead of only "it is there". */
  function officeForm(officeId) {
    var o = officeId ? Store.office(officeId) : null;
    var isNew = !o;
    var held = o ? Store.officeLetterCount(o.id) : 0;
    var d = o || { name: '', code: '', turnaroundDays: 3 };

    var body =
      field({
        name: 'name', label: 'Office', required: true,
        control: '<input type="text" id="f-oname" data-autofocus maxlength="120" value="' +
          U.esc(d.name) + '" placeholder="e.g. Office of Student Affairs">'
      }) +
      '<div class="field-row">' +
      field({
        name: 'code', label: 'Short code',
        control: '<input type="text" id="f-ocode" maxlength="16" value="' + U.esc(d.code) +
          '" placeholder="e.g. OSA">'
      }) +
      field({
        name: 'turnaround', label: 'Usually takes', required: true,
        control: '<input type="number" id="f-odays" min="1" max="120" value="' +
          U.esc(String(d.turnaroundDays)) + '">',
        hint: 'Days. A letter left longer than this is flagged for chasing.'
      }) +
      '</div>' +
      (!isNew
        ? '<p class="small muted">' + (held
            ? U.plural(held, 'letter') + ' has passed through here. An office with a trail can be ' +
              'set inactive but not removed, so old trails still read correctly.'
            : 'No letter has been through here yet, so it can be removed outright.') + '</p>'
        : '');

    UI.modal({
      title: isNew ? 'Add an office' : 'Edit office',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        (!isNew && !held ? '<button type="button" class="btn btn-danger" data-remove>Remove</button>' : '') +
        '<button type="button" class="btn btn-primary" data-save>' + (isNew ? 'Add office' : 'Save') + '</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var data = {
            name: root.querySelector('#f-oname').value.trim(),
            code: root.querySelector('#f-ocode').value.trim(),
            turnaroundDays: root.querySelector('#f-odays').value
          };
          if (!data.name) return showError(root, 'name', 'Give the office a name.');
          var days = Number(data.turnaroundDays);
          if (!isFinite(days) || days < 1) {
            return showError(root, 'turnaround', 'How many days does it usually take?');
          }
          if (isNew) Store.addOffice(data); else Store.updateOffice(officeId, data);
          close();
          UI.toast(isNew ? data.name + ' added.' : 'Office saved.');
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#f-oname').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });

        var rm = root.querySelector('[data-remove]');
        if (rm) rm.addEventListener('click', function () {
          try {
            Store.deleteOffice(officeId);
            close();
            UI.toast(d.name + ' removed.');
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }
    });
  }

  /* ---------- letters ---------- */

  /* Whoever is walking the letter round. Usually an officer already in the
     directory, but a letter is sometimes carried by someone who is not, so a
     typed name is allowed rather than forcing a fake directory entry. */
  function inChargeControl(l) {
    var chosen = l && l.inChargeId ? l.inChargeId : (l && l.inChargeName ? '__typed' : '');
    return '<select id="f-lcharge">' +
      '<option value="">Not decided yet</option>' +
      Store.people({ activeOnly: true }).map(function (p) {
        return '<option value="' + U.esc(p.id) + '"' + (chosen === p.id ? ' selected' : '') + '>' +
          U.esc(p.name) + (p.position ? ' — ' + U.esc(p.position) : '') + '</option>';
      }).join('') +
      '<option value="__typed"' + (chosen === '__typed' ? ' selected' : '') + '>Someone else…</option>' +
      '</select>' +
      '<input type="text" id="f-lchargename" maxlength="80" placeholder="Their name" ' +
      'style="margin-top:8px"' + (chosen === '__typed' ? '' : ' hidden') + ' value="' +
      U.esc(l ? l.inChargeName : '') + '">';
  }

  /* The FCUSR President signs the council's papers. The one exception anybody
     could name is a letter that never leaves the council, so that is exactly
     what this asks — and the answer is kept on the letter, because "we decided
     this one is internal" is a fact worth being able to see later. */
  function askIfInternal(subject) {
    return UI.confirm({
      title: 'The FCUSR President signs this',
      message: 'The President signs every letter and communication the council ' +
        'sends out. Taking them off the list is only right if ' +
        (subject ? '\u201c' + subject + '\u201d' : 'this letter') +
        ' stays inside the FCUSR and goes to no University office.',
      detail: 'If it is going to an adviser, a dean, the OSA or anyone else outside ' +
        'the council, the President signs it first.',
      tone: 'primary',
      cancelLabel: 'Keep the President',
      confirmLabel: 'It is internal — remove'
    });
  }

  function letterForm(letterId, opts) {
    opts = opts || {};
    var l = letterId ? Store.letter(letterId) : null;
    var isNew = !l;
    var d = l || {
      subject: '', eventId: opts.eventId || '', inChargeId: '', inChargeName: '',
      deadline: '', stops: []
    };

    // The offices already chosen, in order. Stops that have happened cannot be
    // moved, so they are shown locked.
    /* Entries, not office ids: most signatories are an office, but a letter can
       also be signed by somebody who holds none. */
    var route = (d.stops || []).map(function (s) {
      return { officeId: s.officeId, label: s.label };
    });
    var lockedCount = (d.stops || []).filter(function (s) { return s.receivedAt || s.releasedAt; }).length;
    var templates = Store.routeTemplates();
    var openEvents = Store.events({ activeOnly: true });

    var body =
      field({
        name: 'subject', label: 'What the letter is about', required: true,
        control: '<input type="text" id="f-lsubject" data-autofocus maxlength="200" value="' +
          U.esc(d.subject) + '" placeholder="e.g. Request to use the gymnasium">',
        hint: 'The subject line. No document is stored here — this only tracks where it has got to.'
      }) +
      field({
        name: 'eventId', label: 'For which activity',
        control: '<select id="f-levent">' +
          '<option value="">Council business — no activity</option>' +
          openEvents.map(function (e) {
            return '<option value="' + U.esc(e.id) + '"' + (d.eventId === e.id ? ' selected' : '') + '>' +
              U.esc(e.title) + '</option>';
          }).join('') + '</select>'
      }) +
      '<div class="field-row">' +
      field({ name: 'inCharge', label: 'Who is processing it', control: inChargeControl(l) }) +
      field({
        name: 'deadline', label: 'Needed by',
        control: '<input type="date" id="f-ldeadline" value="' + U.esc(d.deadline) + '">',
        hint: 'Optional.'
      }) +
      '</div>' +
      '<div class="field"><span class="field-label">Signatories, in order <span class="req">*</span></span>' +
      '<p class="hint" style="margin:-2px 0 8px">Every desk the letter has to be signed at, ' +
      'from the person who wrote it to the last signature. Start from one of the council&rsquo;s ' +
      'three usual letters and change what does not apply.</p>' +
      (templates.length
        ? '<select id="f-ltemplate" style="margin-bottom:10px">' +
          '<option value="">Start from a common letter…</option>' +
          templates.map(function (t, i) {
            return '<option value="' + i + '">' + U.esc(t.name) + '</option>';
          }).join('') + '</select>'
        : '') +
      '<div id="tpl-note" hidden></div>' +
      '<div id="route-list"></div>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:8px">' +
      '<select id="f-laddoffice" style="flex:1">' +
      '<option value="">Add an office or person…</option>' +
      Store.offices({ activeOnly: true }).map(function (o) {
        return '<option value="' + U.esc(o.id) + '">' + U.esc(o.name) + '</option>';
      }).join('') +
      '<option value="__office">An office that is not listed…</option>' +
      '<option value="__typed">Somebody with no office…</option>' +
      '</select></div>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:6px" id="f-lnamerow" hidden>' +
      '<input type="text" id="f-laddname" maxlength="80" style="flex:1">' +
      '<button type="button" class="btn" data-addname>Add</button></div>' +
      '<p class="hint" id="f-lnamehint" hidden style="margin:6px 2px 0"></p>' +
      '<div class="error-text" hidden>Choose at least one office or person.</div></div>';

    UI.modal({
      title: isNew ? 'Track a letter' : 'Edit letter',
      wide: true,
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' +
        (isNew ? 'Start tracking' : 'Save changes') + '</button>',
      onMount: function (root, close) {
        var listEl = root.querySelector('#route-list');
        var noteEl = root.querySelector('#tpl-note');
        var presidentId = Store.presidentOfficeId();
        var internal = !!d.internal;

        function indexOfPresident() {
          if (!presidentId) return -1;
          for (var i = 0; i < route.length; i++) if (route[i].officeId === presidentId) return i;
          return -1;
        }
        function hasPresident() { return !presidentId || indexOfPresident() >= 0; }

        function drawRoute() {
          if (!route.length) {
            listEl.innerHTML = '<p class="small muted" style="margin:0">Nothing chosen yet — ' +
              'pick a common route above, or add offices one at a time.</p>';
            return;
          }
          listEl.innerHTML = '<ol class="route-pick">' + route.map(function (e, i) {
            var locked = i < lockedCount;
            var pres = presidentId && e.officeId === presidentId;
            return '<li' + (locked ? ' class="is-locked"' : '') + '>' +
              '<span class="rp-n">' + (i + 1) + '</span>' +
              '<span class="rp-name">' + U.esc(Store.stopName(e)) +
                (!e.officeId ? ' <span class="chip chip-plain">person</span>' : '') +
                (pres ? ' <span class="chip st-done">signs everything</span>' : '') +
                (locked ? ' <span class="chip chip-plain">already been</span>' : '') + '</span>' +
              (locked ? '' :
                '<span class="rp-bar">' +
                '<button type="button" class="btn btn-sm btn-ghost" data-rmove="' + i + ':-1"' +
                  (i <= lockedCount ? ' disabled' : '') + ' aria-label="Move up">↑</button>' +
                '<button type="button" class="btn btn-sm btn-ghost" data-rmove="' + i + ':1"' +
                  (i === route.length - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button>' +
                '<button type="button" class="btn btn-sm btn-ghost" data-rdrop="' + i + '" ' +
                  'aria-label="Remove">' + UI.icon('close') + '</button></span>') +
              '</li>';
          }).join('') + '</ol>';

          U.els('[data-rmove]', listEl).forEach(function (b) {
            b.addEventListener('click', function () {
              var parts = b.getAttribute('data-rmove').split(':');
              var i = Number(parts[0]), dir = Number(parts[1]);
              var j = i + dir;
              if (j < lockedCount || j >= route.length) return;
              var t = route[i]; route[i] = route[j]; route[j] = t;
              drawRoute();
            });
          });
          U.els('[data-rdrop]', listEl).forEach(function (b) {
            b.addEventListener('click', function () {
              var i = Number(b.getAttribute('data-rdrop'));
              if (presidentId && route[i].officeId === presidentId && !internal) {
                return askIfInternal(root.querySelector('#f-lsubject').value.trim())
                  .then(function (ok) {
                    if (!ok) return;
                    internal = true;
                    route.splice(i, 1);
                    drawRoute();
                  });
              }
              route.splice(i, 1);
              drawRoute();
            });
          });

          // Said under the list, where the gap is, rather than only on removal.
          if (!hasPresident()) {
            listEl.insertAdjacentHTML('beforeend',
              '<div class="gate-note" style="margin:10px 0 0">' + UI.icon('alert') +
              '<span><strong>No FCUSR President on this letter.</strong> That is only right ' +
              'for a letter that stays inside the council. ' +
              '<button type="button" class="linkish" data-readd>Put the President back</button>' +
              '</span></div>');
            var re = listEl.querySelector('[data-readd]');
            if (re) re.addEventListener('click', function () {
              internal = false;
              route.splice(Math.min(lockedCount + 2, route.length), 0, { officeId: presidentId, label: '' });
              drawRoute();
            });
          }
        }
        drawRoute();

        var tpl = root.querySelector('#f-ltemplate');
        if (tpl) tpl.addEventListener('change', function () {
          if (tpl.value === '') return;
          var picked = templates[Number(tpl.value)];
          // Anything already visited stays; the rest is replaced by the template.
          var head = route.slice(0, lockedCount);
          route = head.concat(picked.officeIds.filter(function (oid) {
            return !head.some(function (e) { return e.officeId === oid; });
          }).map(function (oid) { return { officeId: oid, label: '' }; }));
          internal = false;
          tpl.value = '';
          // Some routes carry an instruction of their own; it belongs on screen
          // at the moment the route is chosen, not in a handbook nobody opens.
          if (picked.note) {
            noteEl.innerHTML = '<div class="gate-note" style="margin:0 0 10px">' + UI.icon('alert') +
              '<span>' + U.esc(picked.note) + '</span></div>';
            noteEl.hidden = false;
          } else {
            noteEl.hidden = true;
            noteEl.innerHTML = '';
          }
          drawRoute();
        });

        var add = root.querySelector('#f-laddoffice');
        var nameRow = root.querySelector('#f-lnamerow');
        var nameIn = root.querySelector('#f-laddname');
        var nameHint = root.querySelector('#f-lnamehint');
        var typedMode = 'person';   // 'person' = this letter only · 'office' = added to the list

        add.addEventListener('change', function () {
          if (!add.value) return;
          if (add.value === '__typed' || add.value === '__office') {
            typedMode = add.value === '__office' ? 'office' : 'person';
            nameRow.hidden = false;
            nameHint.hidden = false;
            nameIn.placeholder = typedMode === 'office'
              ? 'Name of the office' : 'Who has to sign — name or title';
            nameHint.textContent = typedMode === 'office'
              ? 'Added to the council\u2019s list of offices, so the next letter can pick it ' +
                'straight from the dropdown. Edit or remove it later in Settings.'
              : 'Kept on this letter only. Use an office instead wherever there is one \u2014 ' +
                'an office outlasts whoever is sitting in it.';
            nameIn.value = '';
            nameIn.focus();
            add.value = '';
            return;
          }
          var oid = add.value;
          if (!route.some(function (e) { return e.officeId === oid; })) {
            route.push({ officeId: oid, label: '' });
          }
          add.value = '';
          drawRoute();
        });

        function addTypedName() {
          var name = nameIn.value.trim();
          if (!name) return nameIn.focus();

          if (typedMode === 'office') {
            var existing = Store.offices().filter(function (o) {
              return o.name.toLowerCase() === name.toLowerCase();
            })[0];
            var made;
            try {
              made = existing || Store.addOffice({ name: name });
            } catch (err) {
              return UI.toast(err.message || 'That office could not be added.', 'error');
            }
            if (existing && existing.active === false) Store.setOfficeActive(existing.id, true);
            if (!route.some(function (e) { return e.officeId === made.id; })) {
              route.push({ officeId: made.id, label: '' });
            }
            // The dropdown has to learn the new office without redrawing the form.
            if (!add.querySelector('option[value="' + made.id + '"]')) {
              var opt = document.createElement('option');
              opt.value = made.id;
              opt.textContent = made.name;
              add.insertBefore(opt, add.querySelector('option[value="__office"]'));
            }
            UI.toast(existing ? made.name + ' was already on the list.' : made.name + ' added to the offices.');
          } else {
            route.push({ officeId: '', label: name });
          }

          nameIn.value = '';
          nameRow.hidden = true;
          nameHint.hidden = true;
          drawRoute();
        }
        root.querySelector('[data-addname]').addEventListener('click', addTypedName);
        nameIn.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); addTypedName(); }
        });

        var charge = root.querySelector('#f-lcharge');
        var chargeName = root.querySelector('#f-lchargename');
        charge.addEventListener('change', function () {
          chargeName.hidden = charge.value !== '__typed';
          if (!chargeName.hidden) chargeName.focus();
        });

        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var subject = root.querySelector('#f-lsubject').value.trim();
          if (!subject) return showError(root, 'subject', 'What is the letter about?');
          if (!route.length) {
            var f = listEl.closest('.field');
            f.classList.add('has-error');
            f.querySelector('.error-text').hidden = false;
            return;
          }

          var data = {
            subject: subject,
            eventId: root.querySelector('#f-levent').value,
            deadline: root.querySelector('#f-ldeadline').value,
            inChargeId: charge.value === '__typed' ? '' : charge.value,
            inChargeName: charge.value === '__typed' ? chargeName.value.trim() : '',
            route: route,
            internal: !hasPresident() && internal
          };

          /* A route can lose the President without the remove button — a
             template picked over the top of one, say — so the question is asked
             again here rather than trusted to have been asked already. */
          if (!hasPresident() && !internal) {
            return askIfInternal(subject).then(function (ok) {
              if (!ok) {
                internal = false;
                route.splice(Math.min(lockedCount + 2, route.length), 0,
                  { officeId: presidentId, label: '' });
                return drawRoute();
              }
              internal = true;
              data.internal = true;
              commit();
            });
          }
          commit();

          function commit() {
          if (isNew) {
            data.unitId = global.Auth ? Auth.myUnitId() : Store.nationalUnitId();
            var made = Store.addLetter(data);
            close();
            UI.toast('Now tracking that letter.');
            App.go('#/letters/' + made.id);
          } else {
            Store.updateLetter(letterId, data);
            close();
            UI.toast('Letter saved.');
          }
          }
        });
      }
    });
  }

  /* ---------- an office asks for another signature first ----------

     A dean who will not sign until the OSA has, an accountant who wants the
     adviser's name on it first. The letter is already out, so the route is not
     a plan any more — it is a thing in someone's hands. This puts one desk in,
     immediately before or after the desk holding it, and leaves everything
     already signed exactly as it was. */

  function insertStopForm(letterId, stopId) {
    var l = Store.letter(letterId);
    if (!l) return;
    var at = -1;
    l.stops.forEach(function (s, i) { if (s.id === stopId) at = i; });
    if (at < 0) return;

    var here = Store.stopName(l.stops[at]);
    var choices = Store.offices({ activeOnly: true });

    var body =
      '<p class="small" style="margin-top:0">' + U.esc(here) + ' has the letter. ' +
      'Add whoever they are waiting on — the route keeps everything already signed.</p>' +
      field({
        name: 'office', label: 'Who has to sign', required: true,
        control: '<select id="f-isoffice" data-autofocus>' +
          '<option value="">Choose an office or person…</option>' +
          choices.map(function (o) {
            return '<option value="' + U.esc(o.id) + '">' + U.esc(o.name) + '</option>';
          }).join('') +
          '<option value="__office">An office that is not listed…</option>' +
          '<option value="__typed">Somebody with no office…</option>' +
          '</select>' +
          '<input type="text" id="f-isname" maxlength="80" style="margin-top:8px" hidden>',
        hint: 'An office wherever there is one — it outlasts whoever is sitting in it. ' +
          'Type a name only when the signature belongs to no office.'
      }) +
      field({
        name: 'where', label: 'Signs when',
        control: '<select id="f-iswhere">' +
          '<option value="before">Before ' + U.esc(here) + ' — they are waiting on it</option>' +
          '<option value="after">After ' + U.esc(here) + ' — sent on there next</option>' +
          '</select>'
      });

    UI.modal({
      title: 'Add an office to the route',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Add the office</button>',
      onMount: function (root, close) {
        var pick = root.querySelector('#f-isoffice');
        var typed = root.querySelector('#f-isname');
        pick.addEventListener('change', function () {
          typed.hidden = pick.value !== '__typed' && pick.value !== '__office';
          typed.placeholder = pick.value === '__office'
            ? 'Name of the office — added to the list'
            : 'Their name or title — this letter only';
          if (!typed.hidden) typed.focus();
        });

        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var entry;
          if (pick.value === '__typed' || pick.value === '__office') {
            var name = typed.value.trim();
            if (!name) {
              return showError(root, 'office', pick.value === '__office'
                ? 'What is the office called?' : 'Who has to sign it?');
            }
            if (pick.value === '__office') {
              var existing = Store.offices().filter(function (o) {
                return o.name.toLowerCase() === name.toLowerCase();
              })[0];
              var made;
              try {
                made = existing || Store.addOffice({ name: name });
              } catch (err) {
                return showError(root, 'office', err.message);
              }
              if (existing && existing.active === false) Store.setOfficeActive(existing.id, true);
              entry = { officeId: made.id, label: '' };
            } else {
              entry = { officeId: '', label: name };
            }
          } else if (pick.value) {
            entry = { officeId: pick.value, label: '' };
          } else {
            return showError(root, 'office', 'Who has to sign first?');
          }

          var where = root.querySelector('#f-iswhere').value;
          try {
            Store.insertStop(letterId, entry, where === 'before' ? at : at + 1);
          } catch (err) {
            return showError(root, 'office', err.message);
          }
          close();
          UI.toast((entry.label || Store.officeName(entry.officeId)) +
            ' added ' + where + ' ' + here + '.');
        });
      }
    });
  }

  /* ---------- the hand-over ----------
     The clerk who takes the letter in will never use this app, so their name is
     typed by whoever handed it over. That makes this a logbook rather than a
     signature, which is worth being plain about on the form itself. */
  /* ---------- walking a letter round ----------

     Every step used to be a dialog: open the letter, find the office holding
     it, press a button, fill in who took it, save; come back later, press
     another, choose the outcome, save. Two forms per office, and an executive
     with six letters out gave up on the screen and kept the trail in their
     head.

     What actually happens is nearly always the same: it was handed in today,
     and it was signed. So that is one tap, from the list or from the letter,
     with the way back on the message it leaves behind. The dialogs are still
     there for the day somebody needs to record a different date, a note, or a
     letter that was sent back. */

  function stepKey(l, s) { return U.esc(l.id + '|' + s.id); }

  function letterSteps(l, opts) {
    opts = opts || {};
    if (!l || l.status !== 'Routing') return '';
    var s = Store.currentStop(l);
    if (!s) return '';
    var here = Store.stopName(s);
    var k = stepKey(l, s);
    var small = opts.compact ? ' btn-sm' : '';
    var btn = function (attr, cls, label) {
      return '<button type="button" class="btn' + small + cls + '" ' + attr + '="' + k + '">' +
        U.esc(label) + '</button>';
    };

    if (!s.receivedAt) {
      return btn('data-step-in', ' btn-primary', opts.compact ? 'Hand in at ' + here : 'Handed in today') +
        btn('data-step-both', '', opts.compact ? 'Handed in &amp; signed' : 'Handed in and signed today') +
        (opts.compact ? '' : btn('data-step-more', ' btn-ghost', 'Another date…'));
    }
    return btn('data-step-ok', ' btn-primary', opts.compact ? here + ' signed it' : 'Signed and passed on') +
      btn('data-step-back', '', 'Sent back') +
      (opts.compact ? '' : btn('data-step-note', ' btn-ghost', 'Seen, not signed') +
        btn('data-step-more', ' btn-ghost', 'Another date…'));
  }

  /* Recorded, said plainly, with the way back beside it. */
  function stepDone(letterId, message) {
    UI.toast(message, 'success', {
      undo: function () {
        try {
          var res = Store.undoLastStep(letterId);
          UI.toast('Put back — ' + res.undone + ' was undone.');
        } catch (err) { UI.toast(err.message, 'error'); }
      }
    });
  }

  function wireLetterSteps(root) {
    var parse = function (b, name) {
      var parts = String(b.getAttribute(name) || '').split('|');
      return { letterId: parts[0], stopId: parts[1] };
    };
    var run = function (b, name, fn) {
      var at = parse(b, name);
      var l = Store.letter(at.letterId);
      var s = l && l.stops.filter(function (x) { return x.id === at.stopId; })[0];
      if (!l || !s) return;
      try { fn(l, s, at); } catch (err) { UI.toast(err.message, 'error'); }
    };

    U.els('[data-step-in]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        run(b, 'data-step-in', function (l, s, at) {
          Store.receiveStop(at.letterId, at.stopId, {
            forwardedBy: Store.letterInCharge(l) === 'Unassigned' ? '' : Store.letterInCharge(l),
            receivedAt: U.today()
          });
          stepDone(at.letterId, Store.stopName(s) + ' has it.');
        });
      });
    });

    U.els('[data-step-both]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        run(b, 'data-step-both', function (l, s, at) {
          Store.passStop(at.letterId, at.stopId, {
            forwardedBy: Store.letterInCharge(l) === 'Unassigned' ? '' : Store.letterInCharge(l),
            on: U.today(), outcome: 'Approved'
          });
          var after = Store.letter(at.letterId);
          stepDone(at.letterId, after.status === 'Approved'
            ? 'Fully approved — that was the last office.'
            : Store.stopName(s) + ' signed it. ' + Store.letterWhere(after) + '.');
        });
      });
    });

    U.els('[data-step-ok]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        run(b, 'data-step-ok', function (l, s, at) {
          Store.releaseStop(at.letterId, at.stopId, { outcome: 'Approved', releasedAt: U.today() });
          var after = Store.letter(at.letterId);
          stepDone(at.letterId, after.status === 'Approved'
            ? 'Fully approved — that was the last office.'
            : Store.stopName(s) + ' signed it. ' + Store.letterWhere(after) + '.');
        });
      });
    });

    U.els('[data-step-note]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        run(b, 'data-step-note', function (l, s, at) {
          Store.releaseStop(at.letterId, at.stopId, { outcome: 'Noted', releasedAt: U.today() });
          stepDone(at.letterId, Store.stopName(s) + ' saw it and passed it on.');
        });
      });
    });

    // Sent back always needs a reason, so it opens the form with that chosen.
    U.els('[data-step-back]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var at = parse(b, 'data-step-back');
        releaseForm(at.letterId, at.stopId, { outcome: 'Returned for revision' });
      });
    });

    U.els('[data-step-more]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var at = parse(b, 'data-step-more');
        var l = Store.letter(at.letterId);
        var s = l && l.stops.filter(function (x) { return x.id === at.stopId; })[0];
        if (!l || !s) return;
        if (s.receivedAt) releaseForm(at.letterId, at.stopId);
        else receiveForm(at.letterId, at.stopId);
      });
    });
  }

  function receiveForm(letterId, stopId) {
    var l = Store.letter(letterId);
    if (!l) return;
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return;

    var carrier = Store.letterInCharge(l);
    var body =
      '<p class="small">Handing <strong>' + U.esc(l.subject) + '</strong> in at ' +
      '<strong>' + U.esc(Store.stopName(s)) + '</strong>.</p>' +
      field({
        name: 'receivedBy', label: 'Who received it',
        control: '<input type="text" id="f-rby" data-autofocus maxlength="80" ' +
          'placeholder="' + U.esc(Store.stopName(s)) + '">',
        hint: 'Optional. Left empty it records the office itself, which is the honest ' +
          'answer when nobody at the counter gave a name.'
      }) +
      '<div class="field-row">' +
      field({
        name: 'forwardedBy', label: 'Who handed it over',
        control: '<input type="text" id="f-rfrom" maxlength="80" value="' +
          U.esc(carrier === 'Unassigned' ? '' : carrier) + '">'
      }) +
      field({
        name: 'receivedAt', label: 'Date',
        control: '<input type="date" id="f-rwhen" value="' + U.esc(U.today()) + '">'
      }) +
      '</div>';

    UI.modal({
      title: 'Record the hand-over',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Record it</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var who = root.querySelector('#f-rby').value.trim();
          try {
            Store.receiveStop(letterId, stopId, {
              receivedBy: who,
              forwardedBy: root.querySelector('#f-rfrom').value.trim(),
              receivedAt: root.querySelector('#f-rwhen').value
            });
            close();
            UI.toast('Recorded — ' + Store.stopName(s) + ' has it.');
          } catch (err) { showError(root, 'receivedBy', err.message); }
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#f-rby').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
      }
    });
  }

  /* What came back out of the office. "Returned for revision" is the one that
     matters most: it sends the letter backwards, not forwards. */
  function releaseForm(letterId, stopId, opts) {
    opts = opts || {};
    var l = Store.letter(letterId);
    if (!l) return;
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return;

    var outcome = Store.STOP_OUTCOMES.indexOf(opts.outcome) >= 0 ? opts.outcome : 'Approved';
    var body =
      '<p class="small"><strong>' + U.esc(Store.stopName(s)) + '</strong> has finished with ' +
      '<strong>' + U.esc(l.subject) + '</strong>.</p>' +
      '<div class="field"><span class="field-label">What happened <span class="req">*</span></span>' +
      '<div class="segmented" style="width:100%">' +
        Store.STOP_OUTCOMES.map(function (o) {
          var on = o === outcome;
          return '<button type="button" data-outcome="' + U.esc(o) + '"' +
            (on ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
            U.esc(o === 'Returned for revision' ? 'Sent back' : o) + '</button>';
        }).join('') +
      '</div><div class="hint" id="outcome-hint">' +
      (outcome === 'Returned for revision'
        ? 'It comes back to you. The office is not cleared, and the letter goes in again once it is fixed.'
        : outcome === 'Noted' ? 'Seen and passed on without a signature.'
        : 'Signed and passed on.') + '</div></div>' +
      '<div class="field-row">' +
      field({
        name: 'releasedAt', label: 'Date',
        control: '<input type="date" id="f-xwhen" value="' + U.esc(U.today()) + '">'
      }) +
      '</div>' +
      field({
        name: 'note', label: 'Note',
        control: '<textarea id="f-xnote" maxlength="300" placeholder="Anything worth remembering"></textarea>',
        hint: 'Optional — but say why if it was sent back.'
      });

    UI.modal({
      title: 'Record the outcome',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Record it</button>',
      onMount: function (root, close) {
        var hint = root.querySelector('#outcome-hint');
        U.els('[data-outcome]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            outcome = b.getAttribute('data-outcome');
            U.els('[data-outcome]', root).forEach(function (o) {
              var on = o === b;
              o.classList.toggle('is-active', on);
              o.setAttribute('aria-pressed', String(on));
            });
            hint.textContent = outcome === 'Returned for revision'
              ? 'It comes back to you. The office is not cleared, and the letter goes in again once it is fixed.'
              : outcome === 'Noted'
                ? 'Seen and passed on without a signature.'
                : 'Signed and passed on.';
          });
        });

        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var note = root.querySelector('#f-xnote').value.trim();
          if (outcome === 'Returned for revision' && !note) {
            return showError(root, 'note', 'Say what has to be fixed, or nobody will know.');
          }
          try {
            Store.releaseStop(letterId, stopId, {
              outcome: outcome,
              releasedAt: root.querySelector('#f-xwhen').value,
              note: note
            });
            close();
            var after = Store.letter(letterId);
            UI.toast(after.status === 'Approved'
              ? 'Fully approved — that is the last office.'
              : outcome === 'Returned for revision'
                ? 'Sent back. It is with ' + Store.letterInCharge(after) + ' now.'
                : 'Recorded. ' + Store.letterWhere(after) + '.');
          } catch (err) { showError(root, 'note', err.message); }
        });
      }
    });
  }

  /* ---------- the feedback form ---------- */

  function feedbackForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;

    UI.modal({
      title: 'Feedback form',
      body:
        '<p class="small">Make a Google Form for <strong>' + U.esc(e.title) + '</strong> and paste ' +
        'its link here. The form itself lives in Google &mdash; this only records where it is, ' +
        'the same way the accomplishment report does.</p>' +
        field({
          name: 'link', label: 'Link to the form', required: true,
          control: '<input type="text" id="fb-link" data-autofocus maxlength="300" value="' +
            U.esc(e.feedbackLink || '') + '" placeholder="https://forms.gle/…">',
          hint: 'Either shape works: forms.gle/… or docs.google.com/forms/…'
        }) +
        '<p class="small muted">Set the form to accept responses from anyone, or the people you ' +
        'are asking will be turned away.</p>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Save the link</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var v = root.querySelector('#fb-link').value.trim();
          if (!v) return showError(root, 'link', 'Paste the link to the form.');
          try {
            Store.setFeedbackLink(eventId, v);
            close();
            UI.toast('Feedback form saved.');
          } catch (err) { showError(root, 'link', err.message); }
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#fb-link').addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
        });
      }
    });
  }

  /* Setting the requirement aside. The standard is that every activity is
     evaluated, so a departure from it is written down rather than toggled. */
  function waiveFeedbackForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;

    UI.modal({
      title: 'No feedback form for this one?',
      body:
        '<p class="small">Every activity is evaluated &mdash; that is the standing rule, and this ' +
        'sets it aside for <strong>' + U.esc(e.title) + '</strong> only.</p>' +
        field({
          name: 'reason', label: 'Why this activity does not need one', required: true,
          control: '<textarea id="fb-why" data-autofocus maxlength="300" ' +
            'placeholder="e.g. An internal working meeting with no participants to survey."></textarea>',
          hint: 'A sentence. It is kept on the activity and read at handover.'
        }),
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Set it aside</button>',
      onMount: function (root, close) {
        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var why = root.querySelector('#fb-why').value.trim();
          var who = (global.Auth && Auth.current() && Auth.current().name) || '';
          try {
            Store.waiveFeedback(eventId, why, who);
            close();
            UI.toast('Recorded. No feedback form is required for this activity.');
          } catch (err) { showError(root, 'reason', err.message); }
        });
      }
    });
  }

  /* ---------- calling an activity off ----------

     Deleting it loses the record; archiving it says nothing about why. A
     council that calls off its Foundation Week wants both things kept: that it
     was planned, and that it was called off — and, most of the time, whether it
     is coming back. */
  function cancelEventForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    var pending = Store.tasks({ eventId: e.id }).filter(Store.isPending).length;

    UI.modal({
      title: 'Cancel ' + e.title + '?',
      body:
        '<p class="small" style="margin-top:0">It stays on the record with everything it holds ' +
        '&mdash; its tasks, its letters, its place in the year&rsquo;s report &mdash; and stops ' +
        'appearing in anybody&rsquo;s work.' +
        (pending ? ' The <strong>' + U.plural(pending, 'task') + '</strong> still open under it ' +
          'will drop out of My tasks.' : '') + '</p>' +
        field({
          name: 'reason', label: 'Why is it called off', required: true,
          control: '<input type="text" id="c-why" data-autofocus maxlength="140" ' +
            'placeholder="e.g. Typhoon warning — classes suspended.">',
          hint: 'One line. It is shown on the activity and printed in the end-of-term record.'
        }) +
        '<div class="field"><label class="checkbox"><input type="checkbox" id="c-again" checked>' +
        '<span>It will be held on another date<span class="hint">Leave this ticked if the ' +
        'council means to reschedule it, even if the new date is not settled yet.</span></span></label></div>' +
        '<div class="field" id="c-when-wrap"><label for="c-when">New date, if you have one</label>' +
        '<input type="date" id="c-when" value="' + U.esc(e.rescheduleDate || '') + '">' +
        '<div class="hint">Optional. The activity stays cancelled either way until you ' +
        'reschedule it.</div></div>',
      footer: '<button type="button" class="btn" data-close>Keep it</button>' +
        '<button type="button" class="btn btn-danger" data-go>Cancel the activity</button>',
      onMount: function (root, close) {
        var again = root.querySelector('#c-again');
        var wrap = root.querySelector('#c-when-wrap');
        var sync = function () { wrap.hidden = !again.checked; };
        again.addEventListener('change', sync);
        sync();

        root.querySelector('[data-go]').addEventListener('click', function () {
          clearErrors(root);
          try {
            Store.cancelEvent(e.id, {
              reason: root.querySelector('#c-why').value,
              rescheduleWanted: again.checked,
              rescheduleDate: again.checked ? root.querySelector('#c-when').value : '',
              by: (global.Auth && Auth.current()) ? Auth.current().name : ''
            });
            close();
            UI.toast(e.title + ' is cancelled.');
          } catch (err) { showError(root, 'reason', err.message); }
        });
      }
    });
  }

  /* Holding it after all: new dates, and everything it was carrying comes back
     with it. */
  function rescheduleEventForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    var suggested = e.rescheduleDate || '';

    UI.modal({
      title: 'Reschedule ' + e.title,
      body:
        '<p class="small" style="margin-top:0">Its tasks, letters and volunteers come back with ' +
        'it, and it counts as work in hand again.</p>' +
        '<div class="field-row">' +
        field({
          name: 'dateStart', label: 'New start date', required: true,
          control: '<input type="date" id="r-start" data-autofocus value="' + U.esc(suggested) + '">'
        }) +
        field({
          name: 'dateEnd', label: 'Ends',
          control: '<input type="date" id="r-end" value="">',
          hint: 'Leave empty for a single day.'
        }) +
        '</div>' +
        (e.cancelReason
          ? '<p class="small muted">It was called off because: &ldquo;' + U.esc(e.cancelReason) +
            '&rdquo;. That note is cleared when it goes back on.</p>'
          : ''),
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-go>Put it back on</button>',
      onMount: function (root, close) {
        root.querySelector('[data-go]').addEventListener('click', function () {
          clearErrors(root);
          var start = root.querySelector('#r-start').value;
          if (!start) return showError(root, 'dateStart', 'Pick the new date.');
          try {
            Store.reinstateEvent(e.id, { dateStart: start, dateEnd: root.querySelector('#r-end').value });
            close();
            UI.toast(e.title + ' is back on for ' + U.fmtDate(start) + '.');
          } catch (err) { showError(root, 'dateEnd', err.message); }
        });
      }
    });
  }

  /* ---------- volunteers ---------- */

  /* Taking on one helper for one activity. Two questions — their name and what
     they are doing — because the unit and the event are already settled by where
     you were standing when you pressed the button, and the login is made for
     them. */
  function volunteerForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;

    var body =
      field({
        name: 'name', label: 'Full name', required: true,
        control: '<input type="text" id="v-name" data-autofocus maxlength="80" placeholder="Juan D. Dela Cruz">'
      }) +
      field({
        name: 'position', label: 'Role in this activity',
        control: '<input type="text" id="v-position" maxlength="60" placeholder="e.g. Logistics Volunteer">',
        hint: 'A label printed on reports. It does not change what they can open.'
      }) +
      '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
      '<div class="small">They get a username and password to sign in with, shown on the next ' +
      'screen. They reach <strong>' + U.esc(e.title) + '</strong> only, and only while it is ' +
      'running.</div></div>';

    UI.modal({
      title: 'Add a volunteer',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Add volunteer</button>',
      onMount: function (root, close) {
        var save = root.querySelector('[data-save]');
        function submit() {
          clearErrors(root);
          var name = root.querySelector('#v-name').value.trim();
          var position = root.querySelector('#v-position').value.trim();
          if (!name) return showError(root, 'name', 'Enter their name.');

          var already = findInUnit(name, e.unitId);
          if (already && (already.eventIds || []).indexOf(eventId) >= 0) {
            return showError(root, 'name', already.name + ' is already on this activity.');
          }

          save.disabled = true;
          save.textContent = 'One moment…';
          enrolVolunteer({ name: name, position: position }, e)
            .then(function (login) {
              close();
              if (login) return invitedDialog(login);
              UI.toast(name + ' added to ' + e.title + '.');
            })
            .catch(function (err) {
              save.disabled = false;
              save.textContent = 'Add volunteer';
              if (err && err.setupMissing) { close(); return setupNeeded(err.message); }
              showError(root, 'name', err.message || 'That could not be added.');
            });
        }
        save.addEventListener('click', submit);
        root.querySelector('#v-name').addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
        });
      }
    });
  }

  /* Somebody in this unit's directory under this name — exactly one of them.
     Two people sharing a name is exactly when guessing would put the wrong one
     on an activity, so then the answer is nobody and a new entry is made. */
  function findInUnit(name, unitId) {
    var want = U.nameKey(name);
    if (!want) return null;
    var same = Store.people({ unitId: unitId }).filter(function (p) {
      return U.nameKey(p.name) === want;
    });
    return same.length === 1 ? same[0] : null;
  }

  /* One helper onto one activity, recorded on the device and — once Supabase is
     connected — on the server. Somebody already in the unit is put on this
     activity as well rather than entered twice.

     Answers with the login made for them, to hand over, or null when they
     already had one (or there is no server to make one on). */
  function enrolVolunteer(v, e) {
    var existing = findInUnit(v.name, e.unitId);
    var eventIds = existing
      ? (existing.eventIds || []).concat([e.id]).filter(function (x, i, a) { return a.indexOf(x) === i; })
      : [e.id];

    /* An officer helping at an activity is still an officer. This used to send
       'volunteer' whoever it was, so an executive who promoted somebody and then
       put them on an activity sent them quietly back down — and the person found
       out by signing in to the wrong app. Being enrolled onto an activity adds an
       activity; it is not a demotion. */
    var keepsOfficer = !!(existing && existing.access !== 'volunteer');
    var access = keepsOfficer ? 'officer' : 'volunteer';
    var p;

    if (existing) {
      p = Store.updatePerson(existing.id, {
        eventIds: eventIds, access: access, active: true,
        position: v.position || existing.position
      });
    } else {
      p = Store.addPerson({
        name: v.name, position: v.position,
        unitId: e.unitId, access: 'volunteer', eventIds: eventIds
      });
    }

    // Offline there is no server. The helper is on the activity so work can be
    // assigned; a login follows once it is connected.
    if (!global.Auth || Auth.isOffline()) return Promise.resolve(null);

    if (p.email) {
      return Backend.enrol({
        email: p.email, full_name: p.name, position: p.position,
        /* An officer keeps the unit they hold office in. Filing them under the
           activity's unit would move a National officer into a college for the
           sake of one afternoon's help. */
        unit_id: keepsOfficer ? (p.unitId || e.unitId) : e.unitId,
        access: access, eventIds: eventIds, isHead: !!p.isHead
      }).then(function () { return null; });
    }
    return makeLogin(p);
  }

  /* ---------- importing a list ----------
     Hundreds of helpers is a spreadsheet, not a form filled in three hundred
     times. A file exported from Excel or Google Sheets goes straight in. */

  /* A small CSV reader: quoted fields, doubled quotes inside them, and any of
     the three line endings a spreadsheet might produce. */
  function parseCSV(text) {
    var rows = [], row = [], field = '', quoted = false, i = 0;
    text = String(text).replace(/^﻿/, '');       // Excel's byte-order mark
    while (i < text.length) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { quoted = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = ''; i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
  }

  /* A list of people, pasted or from a file, as rows of name, position and
     committee.

     Pasted straight out of Google Sheets or Excel, the columns arrive separated
     by tabs; typed, it is one name per line — and a name may carry a comma
     ("Dela Cruz, Juan"), which is why a pasted line is never split on commas. A
     file is CSV. Either may start with a header row naming the columns, in any
     order. An email column, from a sheet made for the old way, is ignored. */
  function readPeopleList(text, fromFile, unitId) {
    var rows = fromFile
      ? parseCSV(text)
      : String(text || '').split(/\r\n|\r|\n/).map(function (l) { return l.split('\t'); })
          .filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
    if (!rows.length) return [];

    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var hasHeader = head.some(function (h) {
      return h === 'name' || h === 'full name' || h === 'full_name' ||
        h === 'position' || h === 'role' || h === 'email';
    });
    var col = { name: 0, position: 1, committee: 2 };
    if (hasHeader) {
      col = { name: -1, position: -1, committee: -1 };
      head.forEach(function (h, i) {
        if (col.name < 0 && (h === 'name' || h === 'full name' || h === 'full_name')) col.name = i;
        else if (col.position < 0 && (h === 'position' || h === 'role')) col.position = i;
        else if (col.committee < 0 && h === 'committee') col.committee = i;
      });
      if (col.name < 0) col.name = 0;
      rows = rows.slice(1);
    }

    var seen = {};
    return rows.map(function (r, n) {
      // Without a header, an address from an old sheet is simply stepped over.
      var cells = hasHeader ? r : r.filter(function (c) { return c.indexOf('@') < 0; });
      var cell = function (i) { return i >= 0 ? String(cells[i] || '').trim() : ''; };
      var name = cell(col.name);
      var key = U.nameKey(name);
      var problem = '';
      if (!name) problem = 'No name';
      else if (seen[key]) problem = 'Listed twice';
      else if (unitId && findInUnit(name, unitId)) problem = 'Already in this unit';
      if (key) seen[key] = true;
      return {
        line: n + (hasHeader ? 2 : 1),
        name: name, position: cell(col.position), committee: cell(col.committee),
        problem: problem
      };
    }).filter(function (r) { return r.name || r.position; });
  }

  /* The paste box and the file button, shared by both lists so they cannot
     drift apart. `onRows` is told what was read, every time it changes. */
  function listInput(prefix, example) {
    return '<div class="field" style="margin-top:12px"><label for="' + prefix + '-paste">' +
      'Paste the names</label>' +
      '<textarea id="' + prefix + '-paste" rows="7" spellcheck="false" placeholder="' +
      U.esc(example) + '"></textarea>' +
      '<div class="hint">One person per line. Copying the columns straight out of Google Sheets ' +
      'or Excel works: name first, then position.</div></div>' +
      '<div class="row" style="margin:6px 0 12px">' +
      '<label class="btn btn-sm">' + UI.icon('upload') + 'Or choose a CSV file' +
      '<input type="file" id="' + prefix + '-csv" accept=".csv,text/csv,text/plain" hidden></label>' +
      '</div>' +
      '<div id="' + prefix + '-preview"></div>';
  }

  function wireListInput(root, prefix, unitId, onRows) {
    var paste = root.querySelector('#' + prefix + '-paste');
    var file = root.querySelector('#' + prefix + '-csv');
    paste.addEventListener('input', U.debounce(function () {
      onRows(readPeopleList(paste.value, false, unitId));
    }, 150));
    file.addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) return UI.toast('That file is very large — split it into smaller ones.', 'error');
      var reader = new FileReader();
      reader.onload = function () {
        paste.value = '';
        onRows(readPeopleList(String(reader.result), true, unitId));
      };
      reader.onerror = function () { UI.toast('That file could not be read.', 'error'); };
      reader.readAsText(f);
    });
  }

  function listPreview(rows, noun, nouns) {
    var good = rows.filter(function (r) { return !r.problem; });
    var bad = rows.filter(function (r) { return r.problem; });
    if (!rows.length) return '';
    return '<p class="small strong" style="margin:4px 0 8px">' + U.plural(good.length, noun, nouns) +
      ' ready' + (bad.length ? ', ' + bad.length + ' skipped' : '') + '</p>' +
      '<div class="list" style="max-height:240px;overflow:auto">' +
      rows.slice(0, 200).map(function (r) {
        return '<div class="task"><span class="task-main" style="cursor:default">' +
          '<span class="task-title">' + U.esc(r.name || '(no name)') + '</span>' +
          '<span class="task-meta">' + U.esc(r.position || 'No position') +
          (r.name ? '<span class="sep">·</span>' + U.esc(U.usernameFor(r.name)) : '') +
          '</span></span>' +
          (r.problem
            ? '<span class="task-right"><span class="chip st-overdue"><span class="dot"></span>' +
              U.esc(r.problem) + '</span></span>'
            : '') +
          '</div>';
      }).join('') + '</div>' +
      (rows.length > 200 ? '<p class="tiny muted">Showing the first 200 of ' + rows.length + '.</p>' : '') +
      '<p class="tiny muted" style="margin-top:6px">The username beside each name is a suggestion. ' +
      'Where one is taken a number is added, and the sheet at the end shows the real ones.</p>';
  }

  function importVolunteersForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    var parsed = [];

    UI.modal({
      title: 'Add a list of volunteers',
      wide: true,
      body:
        '<p class="small" style="margin-top:0">Everyone here joins <strong>' + U.esc(e.title) +
        '</strong> as a volunteer, and each gets a username and password — all shown on one ' +
        'sheet at the end.</p>' +
        listInput('v', 'Juan D. Dela Cruz Logistics\nMaria S. Santos Registration'),
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save disabled>Add them</button>',
      onMount: function (root, close) {
        var save = root.querySelector('[data-save]');
        var preview = root.querySelector('#v-preview');

        wireListInput(root, 'v', e.unitId, function (rows) {
          parsed = rows;
          preview.innerHTML = listPreview(rows, 'volunteer');
          var n = rows.filter(function (r) { return !r.problem; }).length;
          save.disabled = !n;
          save.textContent = n ? 'Add ' + U.plural(n, 'volunteer') : 'Add them';
        });

        save.addEventListener('click', function () {
          var queue = parsed.filter(function (r) { return !r.problem; });
          if (!queue.length) return;
          save.disabled = true;

          var logins = [], failed = [], added = 0;
          // One at a time, so a refused row names itself instead of the whole
          // list failing as one lump.
          queue.reduce(function (chain, r, i) {
            return chain.then(function () {
              save.textContent = 'Adding ' + (i + 1) + ' of ' + queue.length + '…';
              return enrolVolunteer(r, e).then(function (login) {
                added++;
                if (login) logins.push(login);
              }, function (err) {
                failed.push({ name: r.name, why: (err && err.message) || 'refused' });
              });
            });
          }, Promise.resolve()).then(function () {
            close();
            if (logins.length || failed.length) return passwordSheet(logins, failed);
            UI.toast(U.plural(added, 'volunteer') + ' added to ' + e.title + '.');
          });
        });
      }
    });
  }

  var SITE = 'https://fcusrnationals.github.io/fcusr-tracker/';

  /* What to hand somebody who has just been given a login: the site, their
     username and their password. There is nothing for them to set up and
     nothing to change — this is the whole of it. */
  function invitedDialog(login) {
    var line = 'FCUSR Task Tracker\n' + SITE + '\n' +
      'Username: ' + login.username + '\n' +
      'Password: ' + login.password;

    UI.modal({
      title: login.name + ' can sign in now',
      body:
        '<p class="small">Give them these. It is the whole of what they need.</p>' +
        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
        '<div class="small" style="line-height:2">' +
        '<div>Username: <strong style="font-size:16px">' + U.esc(login.username) + '</strong></div>' +
        '<div>Password: <strong style="font-size:16px;letter-spacing:.3px">' +
        U.esc(login.password) + '</strong></div>' +
        '</div></div>' +
        '<button type="button" class="btn btn-block" style="margin-top:12px" data-copy-line>' +
        'Copy the message to send them</button>' +
        '<p class="small muted" style="margin-top:12px">This is the only time the password is ' +
        'shown. If it is lost, set a new one from <strong>Who can sign in</strong> — their ' +
        'username stays the same.</p>',
      footer: '<button type="button" class="btn btn-primary" data-close>Done</button>',
      onMount: function (root) {
        var b = root.querySelector('[data-copy-line]');
        if (b) b.addEventListener('click', function () {
          UI.copyText(line).then(function () { UI.toast('Copied — send it to ' + login.name + '.'); })
            .catch(function (e) { UI.toast(e.message, 'error'); });
        });
      }
    });
  }

  /* Makes one person's login and writes it onto their directory entry, which is
     what joins the entry to the account: whose tasks are whose, what they may
     read. Answers with what goes on the sheet. */
  function makeLogin(person, opts) {
    opts = opts || {};
    var pw = suggestPassword();
    return Backend.createLogin({
      username: U.usernameFor(person.name),
      password: pw,
      full_name: person.name, position: person.position || '',
      unit_id: person.unitId || Store.nationalUnitId(),
      access: person.access === 'volunteer' ? 'volunteer' : 'officer',
      eventIds: person.access === 'volunteer' ? (person.eventIds || []) : [],
      isHead: !!person.isHead,
      replaces: opts.replaces || null
    }).then(function (username) {
      username = typeof username === 'string' ? username : '';
      if (!username) throw new Error('The server made no username.');
      if (person.id && Store.person(person.id)) {
        Store.updatePerson(person.id, { email: U.loginToEmail(username), claimed: true });
      }
      return {
        name: person.name, position: person.position || '',
        access: person.access === 'volunteer' ? 'volunteer' : 'officer',
        username: username, password: pw
      };
    });
  }

  // Everybody in a list, one at a time, so one refusal does not lose the rest.
  function makeLogins(people, btn) {
    var done = [], failed = [];
    return people.reduce(function (chain, person, i) {
      return chain.then(function () {
        if (btn) btn.textContent = 'Making logins ' + (i + 1) + ' of ' + people.length + '…';
        return makeLogin(person).then(function (login) { done.push(login); }, function (err) {
          if (err && err.setupMissing) throw err;
          failed.push({ name: person.name, why: (err && err.message) || 'refused' });
        });
      });
    }, Promise.resolve()).then(function () { return { done: done, failed: failed }; });
  }

  /* ---------- one unit's roster ----------

     Opened from the unit itself, because that is where somebody is standing
     when they think "the College of Nursing needs its officers in". Choosing
     the college from a dropdown on a page headed "Access" was asking them to
     start again somewhere else.

     It carries the whole job: who is in this unit, adding one, adding a list
     from a spreadsheet, and naming the Governor and Vice Governor — who get
     their own council's settings and nothing beyond it. */

  function unitPeopleForm(unitId) {
    var u = Store.unit(unitId);
    if (!u) return;
    var president = !global.Auth || Auth.isPresident() || Auth.isOffline();

    function body() {
      var list = Store.people({ unitId: unitId });
      var heads = list.filter(function (p) { return p.isHead; });

      var html = '<p class="small" style="margin-top:0">' +
        U.plural(list.length, 'person', 'people') + ' in ' + U.esc(u.name) + '. ' +
        'Anybody here can be given work on this unit\u2019s activities.</p>';

      html += '<div class="row" style="margin-bottom:14px">' +
        '<button type="button" class="btn btn-primary" data-up-add>' + UI.icon('plus') +
        'Add someone</button>' +
        '<button type="button" class="btn" data-up-import>' + UI.icon('upload') +
        'Add a list</button>' + '</div>';

      /* Standing, said before the list, because it is the question somebody
         opens this to answer. */
      html += '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin-bottom:14px">' +
        '<div class="strong" style="margin-bottom:4px">Who runs ' + U.esc(u.name) + '</div>' +
        (heads.length
          ? '<div class="small">' + heads.map(function (p) {
              return U.esc(p.name) + (p.position ? ' \u2014 ' + U.esc(p.position) : '');
            }).join('<br>') + '</div>'
          : '<div class="small muted">Nobody named yet. The Governor and Vice Governor open ' +
            'this unit\u2019s settings \u2014 their own roster and nothing else.</div>') +
        (president ? '' :
          '<div class="tiny muted" style="margin-top:6px">Only the FCUSR President names them.</div>') +
        '</div>';

      if (!list.length) {
        html += UI.empty('Nobody yet', 'Add the Governor first, then the rest of the council.');
        return html;
      }

      html += '<div class="list">' + list.map(function (p) {
        return '<div class="task"><span class="task-main" style="cursor:default">' +
          '<span class="task-title">' + U.esc(p.name) +
            (p.isHead ? ' <span class="chip st-done">runs this unit</span>' : '') +
            (p.active === false ? ' <span class="chip st-not-started">Inactive</span>' : '') +
            (p.access === 'volunteer' ? ' <span class="chip chip-plain">volunteer</span>' : '') +
          '</span>' +
          '<span class="task-meta">' + U.esc(p.position || 'No position') +
            '<span class="sep">\u00b7</span>' +
            U.esc(p.email ? U.loginLabel(p.email) : 'no login yet') + '</span></span>' +
          (president && p.access !== 'volunteer'
            ? '<span class="task-right"><button type="button" class="btn btn-sm" ' +
              'data-up-head="' + U.esc(p.id) + '">' +
              (p.isHead ? 'Stand down' : 'Make head') + '</button></span>'
            : '') +
          '</div>';
      }).join('') + '</div>';

      return html;
    }

    UI.modal({
      title: u.name,
      wide: true,
      body: body(),
      footer: '<button type="button" class="btn btn-primary" data-close>Done</button>',
      onMount: function (root, close) {
        function redraw() {
          root.querySelector('.modal-body').innerHTML = body();
          wire();
        }

        function wire() {
          var add = root.querySelector('[data-up-add]');
          if (add) add.addEventListener('click', function () {
            close();
            personForm(null, { unitId: unitId });
          });

          var imp = root.querySelector('[data-up-import]');
          if (imp) imp.addEventListener('click', function () {
            close();
            importPeopleForm(unitId);
          });

          U.els('[data-up-head]', root).forEach(function (b) {
            b.addEventListener('click', function () {
              var p = Store.person(b.getAttribute('data-up-head'));
              if (!p) return;
              var making = !p.isHead;

              UI.confirm({
                title: making ? 'Put ' + p.name + ' in charge of ' + u.name + '?' : p.name + ' stands down?',
                message: making
                  ? p.name + ' will be able to open this unit\u2019s settings \u2014 its roster, ' +
                    'and nothing belonging to any other unit or to the Republic.'
                  : p.name + ' keeps their place in ' + u.name + ' but no longer opens its settings.',
                detail: making
                  ? 'The Governor and the Vice Governor are both heads. Naming somebody does not ' +
                    'unname anybody else.'
                  : '',
                tone: 'primary',
                cancelLabel: 'Leave it',
                confirmLabel: making ? 'Put them in charge' : 'Stand them down'
              }).then(function (ok) {
                if (!ok) return;
                Store.updatePerson(p.id, { isHead: making });

                // The server decides standing; without an address there is no
                // account to decide anything about yet.
                if (p.email && global.Auth && !Auth.isOffline()) {
                  Backend.setHead(p.email, making).catch(function (err) {
                    UI.toast(err.message || 'Saved here, but the server refused.', 'error');
                  });
                }
                UI.toast(making ? p.name + ' now runs ' + u.name + '.'
                                : p.name + ' has stood down.');
                redraw();
              });
            });
          });
        }
        wire();
      }
    });
  }

  /* ---------- a whole council at once ----------

     Typing sixteen officers in one at a time is how a system gets abandoned in
     week one. Paste the names, or choose a spreadsheet, and every one of them
     comes out with a username and a password on one sheet. */

  function importPeopleForm(unitId) {
    var u = Store.unit(unitId);
    if (!u) return;
    var parsed = [];
    var online = !!(global.Auth && !Auth.isOffline());

    UI.modal({
      title: 'Add a list to ' + u.name,
      wide: true,
      body:
        '<p class="small" style="margin-top:0">Everybody here joins <strong>' + U.esc(u.name) +
        '</strong>' + (online
          ? ' and gets a username and password to sign in with — all of them on one sheet ' +
            'at the end, ready to copy or download.'
          : '. Logins are made once the tracker is connected to its server.') + '</p>' +
        listInput('r', 'Juan D. Dela Cruz Governor\nMaria S. Santos Secretary'),
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save disabled>Add them</button>',
      onMount: function (root, close) {
        var save = root.querySelector('[data-save]');
        var preview = root.querySelector('#r-preview');

        wireListInput(root, 'r', unitId, function (rows) {
          parsed = rows;
          preview.innerHTML = listPreview(rows, 'person', 'people');
          var n = rows.filter(function (r) { return !r.problem; }).length;
          save.disabled = !n;
          save.textContent = n ? 'Add ' + U.plural(n, 'person', 'people') : 'Add them';
        });

        save.addEventListener('click', function () {
          var good = parsed.filter(function (r) { return !r.problem; });
          if (!good.length) return;
          save.disabled = true;
          save.textContent = 'Adding…';

          /* Everybody first, in one write. Going through addPerson per line saved
             the whole store and redrew the whole app once per name. */
          var made = Store.addPeople(good.map(function (r) {
            return {
              name: r.name, position: r.position, committee: r.committee,
              unitId: unitId, access: 'officer'
            };
          }));

          if (!online) {
            close();
            return UI.toast(U.plural(made.length, 'person', 'people') + ' added to ' + u.name + '.');
          }

          makeLogins(made, save).then(function (res) {
            close();
            passwordSheet(res.done, res.failed);
          }).catch(function (err) {
            close();
            if (err && err.setupMissing) return setupNeeded(err.message);
            UI.toast(err.message || 'They were added here, but no logins could be made.', 'error');
          });
        });
      }
    });
  }

  /* ---------- who can sign in ----------

     Everybody with a login, from the server, filtered by the same rules that
     decide what anyone may see — so a Governor gets their own college and the
     National government the Republic. From here an executive sets a forgotten
     password, moves somebody still signing in with an email address onto a
     username, gives a login to anybody enrolled the old way who never had one,
     and removes people. */

  function rosterList() {
    var offline = !global.Auth || Auth.isOffline();

    UI.modal({
      title: 'Who can sign in',
      wide: true,
      body: '<div data-acc>' + (offline ? offlineBody() :
        '<p class="small muted" style="margin:0">Asking the server…</p>') + '</div>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn btn-primary" data-download>' +
        UI.icon('pdf') + 'Download as PDF</button>',
      onMount: function (root) {
        var host = root.querySelector('[data-acc]');
        var last = { pending: [], roster: [] };

        var dl = root.querySelector('[data-download]');
        dl.addEventListener('click', function () {
          /* On the council's letterhead rather than as a text file: this is a
             document an adviser asks for and somebody files, not a data dump. */
          if (!global.RosterPDF) {
            UI.downloadFile('FCUSR-WhoCanSignIn-' + U.today() + '.txt', asText(last), 'text/plain');
            return UI.toast('List downloaded.');
          }
          dl.disabled = true;
          RosterPDF.save(last).then(function () {
            UI.toast('Downloaded. It carries no passwords.');
          }).catch(function (err) {
            UI.toast(err.message || 'The list could not be made.', 'error');
          }).then(function () { dl.disabled = false; });
        });

        if (offline) return;
        load();

        function load() {
          Promise.all([Backend.pending(), Backend.roster()]).then(function (r) {
            last = { pending: r[0] || [], roster: r[1] || [] };
            /* While we have the server's version, put the directory right. It
               knows which unit each login was enrolled into, and until this
               existed the local copy could disagree without anybody noticing —
               which is how officers went missing from their own Governor's
               assignee list. */
            var fixed = Store.reconcileDirectory(last.roster.concat(last.pending));
            if (fixed) UI.toast(U.plural(fixed, 'person', 'people') + ' put in the right unit.');
            paint();
          }).catch(function (err) {
            host.innerHTML = '<div class="empty" style="border-color:var(--st-overdue-bd);' +
              'background:var(--st-overdue-bg)"><strong>The list could not be read.</strong>' +
              '<p>' + U.esc(err.message || 'The server did not answer.') + '</p></div>';
          });
        }

        function paint() {
          host.innerHTML = view(last.pending, last.roster);
          wire();
        }

        function busy(b, text) { b.disabled = true; b.textContent = text; }
        function idle(b, text) { b.disabled = false; b.textContent = text; }

        /* The people still signing in with an email address, other than whoever
           is holding the phone — switching your own sign-in would throw you out
           halfway through the list. */
        function emailLogins() {
          var mine = String((Auth.current() && Auth.current().email) || '').toLowerCase();
          return merge(last.pending, last.roster).filter(function (p) {
            return p.hasAccount && !U.isUsernameLogin(p.email) &&
              String(p.email || '').toLowerCase() !== mine;
          });
        }

        /* One person, or everybody, off an email address and onto a username.
           Same account: their tasks, activities and history stay theirs. */
        function switchAll(rows) {
          var done = [], failed = [];
          return rows.reduce(function (chain, r) {
            return chain.then(function () {
              var pw = suggestPassword();
              var name = r.full_name || r.email;
              return Backend.switchToUsername(r.email, U.usernameFor(name), pw).then(function (username) {
                username = typeof username === 'string' ? username : '';
                if (!username) throw new Error('The server made no username.');
                var person = Store.personByEmail(r.email);
                if (person) Store.updatePerson(person.id, { email: U.loginToEmail(username), claimed: true });
                done.push({ name: name, position: r.position || '', access: r.access,
                            username: username, password: pw });
              }).catch(function (err) {
                if (err && err.setupMissing) throw err;
                failed.push({ name: name, why: (err && err.message) || 'refused' });
              });
            });
          }, Promise.resolve()).then(function () { return { done: done, failed: failed }; });
        }

        /* Anybody enrolled the old way, by an address, who never got a login. */
        function giveLogins(rows) {
          var done = [], failed = [];
          return rows.reduce(function (chain, r) {
            return chain.then(function () {
              var person = Store.personByEmail(r.email) || {
                name: r.full_name || r.email.split('@')[0], position: r.position,
                unitId: r.unit_id, access: r.access, eventIds: r.event_ids, isHead: r.is_head
              };
              return makeLogin({
                id: person.id, name: person.name, position: r.position || person.position,
                unitId: r.unit_id || person.unitId, access: r.access || person.access,
                eventIds: r.event_ids || person.eventIds || [], isHead: !!r.is_head
              }, { replaces: r.email }).then(function (login) { done.push(login); }, function (err) {
                if (err && err.setupMissing) throw err;
                failed.push({ name: person.name, why: (err && err.message) || 'refused' });
              });
            });
          }, Promise.resolve()).then(function () { return { done: done, failed: failed }; });
        }

        function finished(res) {
          load();
          passwordSheet(res.done, res.failed);
        }
        function trouble(err) {
          load();
          if (err && err.setupMissing) return setupNeeded(err.message);
          UI.toast((err && err.message) || 'That could not be done.', 'error');
        }

        function wire() {
          var unitPick = host.querySelector('#acc-unit');
          if (unitPick) unitPick.addEventListener('change', function () {
            shownAccountUnit = unitPick.value;
            paint();
          });

          U.els('[data-switch-one]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              var addr = String(b.getAttribute('data-switch-one') || '').toLowerCase();
              var row = emailLogins().filter(function (p) { return p.email.toLowerCase() === addr; })[0];
              if (!row) return;
              UI.confirm({
                title: 'Give ' + (row.full_name || addr) + ' a username?',
                message: 'From now on they sign in with a username and a new password instead of ' +
                  addr + '. Both are shown on the next screen.',
                detail: 'They are signed out everywhere until they use the new ones. Their tasks, ' +
                  'activities and history stay exactly as they are.',
                confirmLabel: 'Give them a username',
                tone: 'primary'
              }).then(function (ok) {
                if (!ok) return;
                busy(b, 'One moment…');
                switchAll([row]).then(finished, trouble);
              });
            });
          });

          var switchEvery = host.querySelector('[data-switch-all]');
          if (switchEvery) switchEvery.addEventListener('click', function () {
            var rows = emailLogins();
            if (!rows.length) return UI.toast('Everybody already signs in with a username.');
            UI.confirm({
              title: 'Move ' + U.plural(rows.length, 'person', 'people') + ' to usernames?',
              message: 'Each one gets a username and a new password, all on one sheet you can copy ' +
                'or download. Their old email sign-in stops working.',
              detail: 'Everybody moved is signed out until they use the new ones, so hand the ' +
                'sheet out straight away. You stay as you are.',
              confirmLabel: 'Move them all',
              tone: 'primary'
            }).then(function (ok) {
              if (!ok) return;
              busy(switchEvery, 'Moving them…');
              switchAll(rows).then(finished, trouble);
            });
          });

          U.els('[data-give-one]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              var addr = String(b.getAttribute('data-give-one') || '').toLowerCase();
              busy(b, 'One moment…');
              Backend.waiting().then(function (rows) {
                var mine = (rows || []).filter(function (r) {
                  return String(r.email || '').toLowerCase() === addr;
                });
                if (!mine.length) {
                  idle(b, 'Give a login');
                  return UI.toast('They already have a login — use Set password instead.');
                }
                return giveLogins(mine).then(finished);
              }).catch(trouble);
            });
          });

          var giveAll = host.querySelector('[data-give-all]');
          if (giveAll) giveAll.addEventListener('click', function () {
            busy(giveAll, 'Finding them…');
            Backend.waiting().then(function (rows) {
              rows = rows || [];
              if (!rows.length) {
                idle(giveAll, 'Give them all a login');
                return UI.toast('Nobody is waiting — everyone enrolled has a login.');
              }
              return UI.confirm({
                title: 'Give ' + U.plural(rows.length, 'person', 'people') + ' a login?',
                message: 'Each one gets a username and a password, all on one sheet you can copy or ' +
                  'download.',
                confirmLabel: 'Give them all a login',
                tone: 'primary'
              }).then(function (ok) {
                if (!ok) return idle(giveAll, 'Give them all a login');
                busy(giveAll, 'Making logins…');
                return giveLogins(rows).then(finished);
              });
            }).catch(trouble);
          });

          /* Somebody has forgotten theirs. The executive makes a new one and
             hands it over; the username does not change. */
          U.els('[data-setpw]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              var email = b.getAttribute('data-setpw');
              var name = b.getAttribute('data-name');
              var working = false;

              UI.modal({
                title: 'New password for ' + name,
                body:
                  '<p class="small">They are signed out everywhere and use this from now on. ' +
                  'If their login was switched off, this switches it back on.</p>' +
                  '<div class="field" style="margin-top:14px"><label for="sp-a">New password</label>' +
                  '<input type="text" id="sp-a" autocomplete="off" spellcheck="false" ' +
                  'data-autofocus value="' + U.esc(suggestPassword()) + '"></div>' +
                  '<div class="hint">Made for you, and shown as plain text so it can be read out. ' +
                  'You can type a different one — at least eight characters.</div>' +
                  '<div class="error-text" data-err hidden></div>' +
                  '<p class="small muted">Nobody can look up the password they had. It is stored ' +
                  'scrambled, which is why a new one is set rather than found.</p>',
                footer: '<button type="button" class="btn" data-close>Cancel</button>' +
                  '<button type="button" class="btn btn-primary" data-go>Set it</button>',
                onMount: function (root2, close) {
                  var input = root2.querySelector('#sp-a');
                  var err = root2.querySelector('[data-err]');
                  var go = root2.querySelector('[data-go]');
                  go.addEventListener('click', function () {
                    if (working) return;
                    var pw = (input.value || '').trim();
                    if (pw.length < 8) {
                      err.hidden = false;
                      err.textContent = 'Too short — use at least eight characters.';
                      return;
                    }
                    working = true;
                    busy(go, 'One moment…');
                    Auth.setMemberPassword(email, pw).then(function () {
                      close();
                      invitedDialog({ name: name, username: U.loginLabel(email), password: pw });
                    }).catch(function (e) {
                      working = false;
                      idle(go, 'Set it');
                      if (e && e.setupMissing) { close(); return setupNeeded(e.message); }
                      err.hidden = false;
                      err.textContent = (e && e.message) || 'That could not be set.';
                    });
                  });
                }
              });
            });
          });

          /* One word, one meaning. Remove takes them off the list and their login
             with them; Add someone puts them back, with a new login. */
          U.els('[data-remove]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              var email = b.getAttribute('data-remove');
              var name = b.getAttribute('data-name');
              var waiting = b.getAttribute('data-waiting') === '1';
              UI.confirm({
                title: 'Remove ' + name + '?',
                message: waiting
                  ? 'Their enrolment is removed. Use this when the person is no longer coming in.'
                  : 'Their login (' + U.loginLabel(email) + ') is deleted and they can no longer ' +
                    'sign in. Their tasks, letters and everything they filed stay where they are, ' +
                    'and their name still reads correctly on all of it.',
                detail: 'This cannot be undone. Adding them again gives them a new username and ' +
                  'password.',
                confirmLabel: 'Remove'
              }).then(function (ok) {
                if (!ok) return;
                b.disabled = true;
                Backend.removeMember(email).then(function () {
                  UI.toast(name + ' removed. Add them again any time.');
                  load();
                }).catch(function (err) {
                  b.disabled = false;
                  if (err && err.setupMissing) return setupNeeded(err.message);
                  UI.toast(err.message || 'That could not be done.', 'error');
                });
              });
            });
          });
        }
      }
    });
  }

  function offlineBody() {
    var people = Store.people();
    return '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
      '<div class="strong" style="margin-bottom:3px">No logins yet</div>' +
      '<div class="small">The tracker has not been connected to its server, so nobody signs in and ' +
      'everything stays on this device. The people below are names on tasks, not logins.</div></div>' +
      (people.length
        ? '<div class="list" style="margin-top:14px">' + people.map(function (p) {
            return '<div class="task"><span class="task-main" style="cursor:default">' +
              '<span class="task-title">' + U.esc(p.name) + '</span>' +
              '<span class="task-meta">' + U.esc(p.position || 'No position') + '</span>' +
              '</span></div>';
          }).join('') + '</div>'
        : '<p class="small muted">Nobody has been added yet.</p>');
  }

  /* One person, one row.

     Waiting enrolments come from one table and logins from another, and
     somebody can be in both. It is whether a login exists that decides what can
     be done — set a password, or give one — and merging the two lists on the
     sign-in is what makes that answerable at all. */
  function merge(pending, roster) {
    var byEmail = {};
    var key = function (e) { return String(e || '').trim().toLowerCase(); };

    (roster || []).forEach(function (p) {
      if (!key(p.email)) return;
      byEmail[key(p.email)] = {
        email: p.email, full_name: p.full_name, position: p.position,
        units: p.units, access: p.access,
        hasAccount: true, active: p.active !== false, waiting: false
      };
    });

    (pending || []).forEach(function (e) {
      var k = key(e.email);
      if (!k) return;
      if (byEmail[k]) {
        if (e.full_name) byEmail[k].full_name = e.full_name;
        if (e.position) byEmail[k].position = e.position;
        return;
      }
      byEmail[k] = {
        email: e.email, full_name: e.full_name, position: e.position,
        units: e.units, access: e.access,
        hasAccount: false, active: true, waiting: true
      };
    });

    return Object.keys(byEmail).map(function (k) { return byEmail[k]; })
      .sort(function (x, y) {
        return String(x.full_name || x.email).localeCompare(String(y.full_name || y.email));
      });
  }

  function view(pending, roster) {
    var all = merge(pending, roster);
    var waiting = all.filter(function (p) { return p.waiting; });
    var accounts = all.filter(function (p) { return p.hasAccount; });
    var canSignIn = accounts.filter(function (p) { return p.active; });
    var mine = (global.Auth && Auth.current()) ? Auth.current().email : '';
    var onEmail = accounts.filter(function (p) {
      return !U.isUsernameLogin(p.email) &&
        String(p.email || '').toLowerCase() !== String(mine || '').toLowerCase();
    });

    var html = '<div class="where-now" style="margin-bottom:16px">' +
      '<span class="wn-label">Where things stand</span>' +
      '<span class="wn-line">' + U.plural(canSignIn.length, 'person', 'people') + ' can sign in' +
      (waiting.length ? ' · ' + waiting.length + ' without a login' : '') + '</span>' +
      (onEmail.length
        ? '<span class="wn-note">' + U.plural(onEmail.length, 'person', 'people') +
          ' still sign in with an email address.</span>'
        : '') +
      '</div>';

    if (onEmail.length) {
      html += '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin-bottom:16px">' +
        '<div class="strong" style="margin-bottom:4px">Move everyone to usernames</div>' +
        '<div class="small" style="margin-bottom:10px">Each person gets a username and a new ' +
        'password, all on one sheet. Try it on one person first with <strong>Give them a ' +
        'username</strong> on their row, and check they can sign in.</div>' +
        '<button type="button" class="btn btn-sm btn-primary" data-switch-all>Move ' +
        U.plural(onEmail.length, 'person', 'people') + ' to usernames</button></div>';
    }

    if (waiting.length) {
      html += '<div class="section" style="margin-bottom:18px">' +
        '<div class="section-head"><h2>Without a login ' +
        '<span class="chip st-overdue"><span class="dot"></span>' + waiting.length + '</span></h2></div>' +
        '<p class="small muted" style="margin:0 2px 10px">Enrolled the old way, by an email address, ' +
        'and never given a login.</p>' +
        '<div class="row" style="margin-bottom:10px">' +
        '<button type="button" class="btn btn-sm btn-primary" data-give-all>' +
        'Give them all a login</button></div>' +
        '<div class="list">' + waiting.map(function (e) { return row(e, mine); }).join('') +
        '</div></div>';
    }

    html += '<div class="section">' +
      '<div class="section-head"><h2>Can sign in' +
      (accounts.length ? ' <span class="chip chip-plain">' + accounts.length + '</span>' : '') +
      '</h2></div>';
    html += accounts.length
      ? accountsByUnit(accounts, mine)
      : '<p class="small muted" style="margin:0 2px">Nobody has a login yet.</p>';
    html += '</div>';

    return html;
  }

  /* Who can sign in, one unit at a time.

     The National government looking at this screen was handed every account in
     the Republic in one run: thirty-odd names, ten colleges, no way to answer
     "who from Nursing can sign in" except by reading all of them. The unit is
     picked from a dropdown instead, and a Governor — who has one unit — is not
     asked to pick anything. */
  var shownAccountUnit = '';

  function accountsByUnit(rows, mine) {
    var natName = Store.unitName(Store.nationalUnitId());
    var myUnitName = '';
    rows.forEach(function (p) {
      if (String(p.email || '').toLowerCase() === String(mine || '').toLowerCase()) {
        myUnitName = (p.units && p.units.name) || '';
      }
    });
    if (!myUnitName && global.Auth && Auth.signedIn()) myUnitName = Auth.current().unitName || '';

    var groups = {}, order = [];
    rows.forEach(function (p) {
      var name = (p.units && p.units.name) || 'No unit';
      if (!groups[name]) { groups[name] = []; order.push(name); }
      groups[name].push(p);
    });

    var draw = function (list) {
      return '<div class="list">' + list.map(function (p) { return row(p, mine); }).join('') + '</div>';
    };
    if (order.length === 1) return draw(rows);

    order.sort(function (a, b) {
      if (a === b) return 0;
      if (a === natName) return -1;
      if (b === natName) return 1;
      if (a === 'No unit') return 1;
      if (b === 'No unit') return -1;
      return a.localeCompare(b);
    });

    var picked = order.indexOf(shownAccountUnit) >= 0 ? shownAccountUnit
      : order.indexOf(myUnitName) >= 0 ? myUnitName : order[0];

    return '<div class="field" style="margin:0 0 12px"><label for="acc-unit">Show</label>' +
      '<select id="acc-unit">' + order.map(function (name) {
        var off = groups[name].filter(function (p) { return !p.active; }).length;
        return '<option value="' + U.esc(name) + '"' + (name === picked ? ' selected' : '') + '>' +
          U.esc(name) + ' \u2014 ' + U.esc(U.plural(groups[name].length, 'person', 'people')) +
          (off ? ' \u00b7 ' + off + ' cannot sign in' : '') + '</option>';
      }).join('') + '</select></div>' + draw(groups[picked]);
  }

  /* Shown once. Everything needed to hand each person their way in, to copy
     into a group chat or download and print. */
  function passwordSheet(done, failed) {
    done = done || [];
    failed = failed || [];
    var lines = ['FCUSR Task Tracker — ' + SITE, ''];
    done.forEach(function (d) {
      lines.push(d.name + '  —  username: ' + d.username + '  —  password: ' + d.password);
    });

    var csvCell = function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; };
    var csv = ['Name,Position,Username,Password'].concat(done.map(function (d) {
      return [d.name, d.position, d.username, d.password].map(csvCell).join(',');
    })).join('\r\n') + '\r\n';

    UI.modal({
      title: U.plural(done.length, 'person', 'people') + ' can sign in now',
      wide: true,
      body:
        (done.length
          ? '<p class="small">Give each person their username and password. <strong>Copy or ' +
            'download this before closing</strong> — the passwords are not shown again, ' +
            'though any of them can be set again from Who can sign in.</p>' +
            '<p class="small muted">Sign in at ' + U.esc(SITE) + '</p>' +
            '<div class="list">' + done.map(function (d) {
              return '<div class="task"><span class="task-main" style="cursor:default">' +
                '<span class="task-title">' + U.esc(d.name) +
                (d.access === 'volunteer' ? ' <span class="chip chip-plain">volunteer</span>' : '') +
                '</span>' +
                '<span class="task-meta">Username <strong>' + U.esc(d.username) + '</strong>' +
                '<span class="sep">·</span>Password <strong>' + U.esc(d.password) +
                '</strong></span></span></div>';
            }).join('') + '</div>' +
            '<div class="row" style="margin-top:12px">' +
            '<button type="button" class="btn btn-primary" data-copy-sheet>Copy them all</button>' +
            '<button type="button" class="btn" data-csv-sheet>' + UI.icon('download') +
            'Download as a spreadsheet</button></div>'
          : '<p class="small">Nobody was given a login.</p>') +

        (failed.length
          ? '<div class="gate-note" style="margin-top:14px">' + UI.icon('alert') +
            '<span><strong>' + U.plural(failed.length, 'person', 'people') +
            ' could not be given one.</strong><br>' +
            failed.map(function (f) {
              return U.esc(f.name) + ' — ' + U.esc(f.why);
            }).join('<br>') + '</span></div>'
          : ''),
      footer: '<button type="button" class="btn btn-primary" data-close>Done</button>',
      onMount: function (root) {
        var b = root.querySelector('[data-copy-sheet]');
        if (b) b.addEventListener('click', function () {
          UI.copyText(lines.join('\n'))
            .then(function () { UI.toast('Copied.'); })
            .catch(function (e) { UI.toast(e.message, 'error'); });
        });
        var c = root.querySelector('[data-csv-sheet]');
        if (c) c.addEventListener('click', function () {
          UI.downloadFile('FCUSR-logins-' + U.today() + '.csv', csv, 'text/csv');
          UI.toast('Downloaded. Keep it somewhere only you can open.');
        });
      }
    });
  }

  /* Which file, taken from the message the backend put the name into, so this
     does not have to be kept in step with it by hand. */
  function fileOf(why) {
    var m = /backend\/supabase\/([\w.-]+)/.exec(String(why || ''));
    return m ? m[1] : 'usernames.sql';
  }

  function setupNeeded(why) {
    UI.modal({
      title: 'One setup step is missing',
      body:
        '<p class="small">The site has been updated but the database has not, so this cannot ' +
        'work yet. Nothing is broken and nothing has been lost.</p>' +
        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin-top:14px">' +
        '<div class="strong" style="margin-bottom:4px">What to do</div>' +
        '<ol class="small" style="padding-left:18px;line-height:1.8;margin:0">' +
        '<li>Open <strong>backend/supabase/' + U.esc(fileOf(why)) + '</strong> in the project.</li>' +
        '<li>Copy all of it.</li>' +
        '<li>Supabase &rarr; <strong>SQL Editor</strong> &rarr; New query &rarr; paste &rarr; ' +
        '<strong>Run</strong>.</li>' +
        '</ol></div>' +
        '<p class="small muted">It only has to be done once, and it is safe to run twice.</p>',
      footer: '<button type="button" class="btn btn-primary" data-close>Right</button>'
    });
  }

  /* Something that can be read out across a room without spelling it: two
     ordinary words and a number with no 0 or 1 in it. */
  var PASSWORD_WORDS = ['filamer', 'republic', 'roxas', 'capiz', 'gazette', 'session', 'quorum',
    'charter', 'plenary', 'banner', 'council', 'senate', 'motion', 'ballot', 'summit', 'harbor',
    'mango', 'island', 'river', 'lantern', 'anchor', 'garden', 'thunder', 'candle', 'compass',
    'marble', 'meadow', 'orchid', 'pepper', 'rocket', 'silver', 'tiger', 'violet', 'window',
    'basket', 'cotton', 'falcon', 'guitar', 'jasmine', 'kettle'];
  function suggestPassword() {
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    var c = global.crypto;
    if (c && c.getRandomValues) {
      pick = function (a) {
        var n = new Uint32Array(1);
        c.getRandomValues(n);
        return a[n[0] % a.length];
      };
    }
    var digits = String(100 + Math.floor(Math.random() * 900)).replace(/[01]/g, '7');
    return pick(PASSWORD_WORDS) + '-' + pick(PASSWORD_WORDS) + '-' + digits;
  }

  function row(p, mine) {
    var email = p.email || '';
    var name = p.full_name || U.loginLabel(email) || 'Somebody';
    var isMe = mine && email && mine.toLowerCase() === email.toLowerCase();
    var waiting = !!p.waiting;
    var onEmail = p.hasAccount && !U.isUsernameLogin(email);

    var meta = [p.position || 'No position'];
    if (p.units && p.units.name) meta.push(p.units.name);

    var note = '';
    if (p.hasAccount && !p.active) {
      note = ' <span class="chip st-overdue"><span class="dot"></span>cannot sign in</span>';
    }

    return '<div class="task"><span class="task-main" style="cursor:default">' +
      '<span class="task-title">' + U.esc(name) +
        (isMe ? ' <span class="chip chip-plain">you</span>' : '') + note + '</span>' +
      '<span class="task-meta">' + meta.map(U.esc).join('<span class="sep">·</span>') + '</span>' +
      '<span class="task-meta">' + (waiting ? 'Enrolled as ' + U.esc(email)
        : (onEmail ? 'Signs in with ' : 'Username ') + '<strong>' + U.esc(U.loginLabel(email)) + '</strong>') +
      '</span>' +
      '</span>' +
      (isMe ? '' :
        '<span class="task-right" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
        (waiting
          ? '<button type="button" class="btn btn-sm btn-primary" data-give-one="' + U.esc(email) +
            '" data-name="' + U.esc(name) + '">Give a login</button>'
          : '') +
        (onEmail
          ? '<button type="button" class="btn btn-sm btn-primary" data-switch-one="' + U.esc(email) +
            '" data-name="' + U.esc(name) + '">Give them a username</button>'
          : '') +
        (p.hasAccount
          ? '<button type="button" class="btn btn-sm" data-setpw="' + U.esc(email) +
            '" data-name="' + U.esc(name) + '">Set password</button>'
          : '') +
        '<button type="button" class="btn btn-sm btn-ghost" data-remove="' + U.esc(email) +
        '" data-name="' + U.esc(name) + '" data-waiting="' + (waiting ? '1' : '0') +
        '">Remove</button></span>') +
      '</div>';
  }

  /* The same grouping the screen uses, so a list printed from it agrees with it. */
  function asText(last) {
    var all = merge(last.pending, last.roster);
    var waiting = all.filter(function (p) { return p.waiting; });
    var accounts = all.filter(function (p) { return p.hasAccount; });
    var line = function (p) {
      return '  ' + (p.full_name || '—') + '  —  ' + (p.position || 'No position') +
        '  —  ' + U.loginLabel(p.email) +
        (p.hasAccount && !p.active ? '  —  CANNOT SIGN IN' : '');
    };

    var lines = ['FCUSR Task Tracker — who can sign in', U.fmtDate(U.today()), ''];
    if (waiting.length) {
      lines.push('WITHOUT A LOGIN (' + waiting.length + ')');
      waiting.forEach(function (e) { lines.push(line(e)); });
      lines.push('');
    }
    lines.push('CAN SIGN IN (' + accounts.length + ')');
    if (!accounts.length) lines.push('  nobody yet');
    accounts.forEach(function (p) { lines.push(line(p)); });
    return lines.join('\n') + '\n';
  }

  /* ---------- person ---------- */

  /* How this person signs in, said on the form rather than asked. */
  function loginNote(p, isNew) {
    if (!global.Auth || Auth.isOffline()) return '';
    var body;
    if (p && p.email) {
      body = U.isUsernameLogin(p.email)
        ? 'Signs in as <strong>' + U.esc(U.loginLabel(p.email)) + '</strong>. Changing their ' +
          'name, position or unit does not change it, or their password.'
        : 'Signs in with <strong>' + U.esc(p.email) + '</strong>. To move them to a username, ' +
          'use <strong>Who can sign in</strong>.';
    } else {
      body = (isNew ? 'When you add them' : 'When you save') + ', a username and password are ' +
        'made for them and shown on the next screen to hand over.';
    }
    return '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);' +
      'margin-bottom:14px"><div class="small">' + body + '</div></div>';
  }

  function personForm(personId, opts) {
    opts = opts || {};
    var p = personId ? Store.person(personId) : null;
    var isNew = !p;
    // Opened from a unit, that unit is the answer — not wherever the person
    // doing it happens to belong.
    var myUnit = opts.unitId ||
      ((global.Auth && Auth.signedIn()) ? Auth.myUnitId() : Store.nationalUnitId());
    var d = p || { name: '', position: '', committee: '', active: true, unitId: myUnit };
    // Only the President moves people between units; a Governor's people are theirs.
    var canPickUnit = !global.Auth || Auth.isPresident() || Auth.isOffline();
    var provinceHead = !!(global.Auth && Auth.signedIn() && !Auth.isOffline() &&
      !Auth.isNational() && (Auth.current().unitKind === 'province'));

    var body =
      field({
        name: 'name', label: 'Full name', required: true,
        control: '<input type="text" id="f-name" data-autofocus maxlength="80" value="' + U.esc(d.name) + '">'
      }) +
      /* Which unit somebody belongs to decides where they can be given work, so
         it cannot be left to a default. It was, and every person added this way
         landed in FCUSR Nationals whoever added them. */
      (canPickUnit
        ? field({
            name: 'unitId', label: 'Unit', required: true,
            control: '<select id="f-unit">' + Store.units({ activeOnly: true }).map(function (u) {
              return '<option value="' + U.esc(u.id) + '"' +
                (u.id === (d.unitId || myUnit) ? ' selected' : '') + '>' + U.esc(u.name) + '</option>';
            }).join('') + '</select>',
            hint: 'They can be given work on this unit\u2019s activities.'
          })
        : '<input type="hidden" id="f-unit" value="' + U.esc(d.unitId || myUnit) + '">') +
      '<div class="field-row">' +
      field({
        name: 'position', label: 'Position',
        control: UI.suggestInput('f-position', d.position, Store.positions(), 'Start typing, or pick one'),
        hint: 'The posts in the FCUSR Constitution are offered as you type. Anything else is fine too — ' +
          'a position is a label printed on reports, and it grants nobody anything.'
      }) +
      field({
        name: 'committee', label: 'Committee',
        control: UI.suggestInput('f-committee', d.committee, Store.committees(), 'Optional')
      }) +
      '</div>' +
      /* No email address to type. Somebody added here is given a username made
         from their name and a password, both shown when they are saved. An
         address was the one thing on this form that could be mistyped into a
         login nobody could use. */
      loginNote(p, isNew) +

      /* What this person IS, asked plainly.

         It was never asked. It was implied by whichever form you happened to
         open: this one always enrolled an officer, the helper form always
         enrolled a volunteer, and the roster import always enrolled an officer.
         So moving somebody between the two was not something the app could do —
         an executive promoting a volunteer changed the account and left the
         directory saying volunteer, or put them on an activity afterwards and
         silently sent them back down again. */
      /* A province takes on volunteers; its elected and appointed posts are
         filled by the National government. The database has always refused
         anything else, and the form used to offer it anyway — so a Governor
         added an officer, the person landed in the directory, and the login was
         refused afterwards with a sentence about provinces. */
      field({
        name: 'access', label: 'What they are',
        control: provinceHead
          ? '<select id="f-access"><option value="volunteer" selected>' +
            'Volunteer &mdash; only the activities they are put on</option></select>'
          : '<select id="f-access">' +
            '<option value="officer"' + (d.access !== 'volunteer' ? ' selected' : '') + '>' +
            'Officer &mdash; their unit\u2019s work</option>' +
            '<option value="volunteer"' + (d.access === 'volunteer' ? ' selected' : '') + '>' +
            'Volunteer &mdash; only the activities they are put on</option>' +
            '</select>',
        hint: provinceHead
          ? 'A college takes on volunteers. Its elected and appointed officers are added by the ' +
            'National government.'
          : 'An officer of the National government reaches the whole Republic. A volunteer ' +
            'sees only the activities somebody enrols them into.'
      }) +
      (isNew ? '' :
        '<div class="field"><label class="checkbox"><input type="checkbox" id="f-active"' + (d.active !== false ? ' checked' : '') + '>' +
        '<span>Active officer<span class="hint">Deactivated officers keep their past tasks but no longer appear in assignee lists.</span></span></label></div>');

    UI.modal({
      title: isNew ? 'Add person' : 'Edit person',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' + (isNew ? 'Add person' : 'Save changes') + '</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var data = {
            name: root.querySelector('#f-name').value.trim(),
            position: root.querySelector('#f-position').value,
            committee: root.querySelector('#f-committee').value
          };
          var uSel = root.querySelector('#f-unit');
          if (uSel) data.unitId = uSel.value;
          if (!data.name) return showError(root, 'name', 'Enter their name.');

          var accSel = root.querySelector('#f-access');
          data.access = accSel && accSel.value === 'volunteer' ? 'volunteer' : 'officer';

          var saved;
          try {
            if (isNew) saved = Store.addPerson(data);
            else {
              data.active = root.querySelector('#f-active').checked;
              saved = Store.updatePerson(personId, data);
            }
          } catch (err) {
            return showError(root, 'name', err.message);
          }

          if (!global.Auth || Auth.isOffline()) {
            close();
            return UI.toast(isNew ? 'Person added.' : 'Person saved.');
          }

          /* Somebody who already has a login is having their details changed:
             name, position, unit, what they are. That goes through the path that
             never touches a password or a username, so promoting, demoting or
             moving somebody changes nothing about how they sign in. */
          if (saved.email) {
            Backend.enrol({
              email: saved.email, full_name: saved.name, position: saved.position,
              unit_id: saved.unitId || Store.nationalUnitId(),
              access: saved.access,
              eventIds: saved.access === 'volunteer' ? (saved.eventIds || []) : [],
              isHead: !!saved.isHead
            }).then(function () {
              close();
              UI.toast(saved.name + ' saved. Their username and password are unchanged.');
            }).catch(function (err) {
              close();
              if (err && err.setupMissing) return setupNeeded(err.message);
              UI.toast(err.message || 'Saved here, but the change did not reach the server.', 'error');
            });
            return;
          }

          // Nobody with a login yet: make one, and show it to hand over.
          var btn = root.querySelector('[data-save]');
          btn.disabled = true;
          btn.textContent = 'Making their login…';
          makeLogin(saved).then(function (login) {
            close();
            invitedDialog(login);
          }).catch(function (err) {
            close();
            if (err && err.setupMissing) return setupNeeded(err.message);
            UI.toast((err && err.message) ||
              'Saved here, but their login could not be made. Open them and save again to retry.', 'error');
          });
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#f-name').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
      }
    });
  }

  global.Forms = {
    mergeRoster: merge, asText: asText,
    unitForm: unitForm,
    feedbackForm: feedbackForm, waiveFeedbackForm: waiveFeedbackForm,
    officeForm: officeForm, letterForm: letterForm,
    letterSteps: letterSteps, wireLetterSteps: wireLetterSteps,
    receiveForm: receiveForm, releaseForm: releaseForm, insertStopForm: insertStopForm,
    askIfInternal: askIfInternal,
    volunteerForm: volunteerForm, importVolunteersForm: importVolunteersForm,
    readPeopleList: readPeopleList, parseCSV: parseCSV,
    eventForm: eventForm, cancelEventForm: cancelEventForm,
    rescheduleEventForm: rescheduleEventForm,
    taskForm: taskForm, taskView: taskView, personForm: personForm,
    rosterList: rosterList, unitPeopleForm: unitPeopleForm,
    importPeopleForm: importPeopleForm,
    field: field, showError: showError, clearErrors: clearErrors
  };
})(window);
