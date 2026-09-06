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

  function eventForm(eventId, opts) {
    opts = opts || {};
    var ev = eventId ? Store.event(eventId) : null;
    var isNew = !ev;
    var e = ev || {
      title: '', description: '', dateStart: U.today(), dateEnd: '', venue: '',
      headId: '', status: 'Upcoming', feedbackRequired: true, feedbackLink: '',
      unitId: opts.unitId || (global.Auth ? Auth.myUnitId() : Store.nationalUnitId())
    };


    var body =
      field({
        name: 'title', label: 'Event title', required: true,
        control: '<input type="text" id="f-title" data-autofocus maxlength="120" value="' + U.esc(e.title) + '" placeholder="e.g. Foundation Week 2026">'
      }) +
      field({
        name: 'description', label: 'Short description',
        control: '<textarea id="f-description" maxlength="400" placeholder="What is this event or program about?">' + U.esc(e.description) + '</textarea>'
      }) +
      '<div class="field-row">' +
      field({
        name: 'dateStart', label: 'Event date', required: true,
        control: '<input type="date" id="f-dateStart" value="' + U.esc(e.dateStart) + '">'
      }) +
      field({
        name: 'dateEnd', label: 'End date',
        control: '<input type="date" id="f-dateEnd" value="' + U.esc(e.dateEnd) + '">',
        hint: 'Leave blank for a one-day event.'
      }) +
      '</div>' +
      field({
        name: 'venue', label: 'Venue',
        control: '<input type="text" id="f-venue" maxlength="120" value="' + U.esc(e.venue) + '" placeholder="e.g. FCU Gymnasium">'
      }) +
      /* Every activity is evaluated. The field sits here rather than in the
         report wizard because the form has to exist before the activity runs —
         asking for it afterwards is asking too late to be any use. */
      field({
        name: 'feedbackLink', label: 'Feedback form',
        control: '<input type="text" id="f-feedback" maxlength="300" value="' +
          U.esc(e.feedbackLink || '') + '" placeholder="https://forms.gle/…">',
        hint: e.feedbackRequired === false
          ? 'Not required for this activity. The requirement can be put back from the activity itself.'
          : 'Required by standard. Make a Google Form and paste its link. You can add it later, ' +
            'but the activity cannot be marked completed without one.'
      }) +
      '<div class="field-row">' +
      field({
        name: 'headId', label: 'Event head',
        control: '<select id="f-headId">' + UI.peopleOptions(e.headId, true).replace('>Unassigned<', '>Not set yet<') + '</select>'
      }) +
      field({
        name: 'status', label: 'Status',
        control: '<select id="f-status">' + UI.selectOptions(Store.EVENT_STATUSES, e.status) + '</select>'
      }) +
      '</div>';

    UI.modal({
      title: isNew ? 'Create event' : 'Edit event',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' + (isNew ? 'Create event' : 'Save changes') + '</button>',
      onMount: function (root, close) {
        function submit() {
          clearErrors(root);
          var data = {
            title: root.querySelector('#f-title').value.trim(),
            description: root.querySelector('#f-description').value,
            dateStart: root.querySelector('#f-dateStart').value,
            dateEnd: root.querySelector('#f-dateEnd').value,
            venue: root.querySelector('#f-venue').value,
            headId: root.querySelector('#f-headId').value,
            status: root.querySelector('#f-status').value
          };
          /* There is no "whose event" to choose. You are signed in to one
             unit's tracker, so an event you create there is that unit's — the
             question only ever had one answer. */
          if (isNew) data.unitId = e.unitId;

          data.feedbackLink = root.querySelector('#f-feedback').value.trim();
          if (data.feedbackLink &&
              !/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(data.feedbackLink)) {
            return showError(root, 'feedbackLink',
              'That needs to be a Google Forms link \u2014 forms.gle or docs.google.com/forms.');
          }

          if (!data.title) return showError(root, 'title', 'Give the event a title.');
          if (!data.dateStart) return showError(root, 'dateStart', 'Pick the event date.');
          if (data.dateEnd && data.dateEnd < data.dateStart) {
            return showError(root, 'dateEnd', 'The end date cannot be before the start date.');
          }
          if (isNew) {
            var created = Store.addEvent(data);
            close();
            UI.toast('Event created.');
            // Straight into the new event, ready for its first task.
            global.ViewEventDetail.openAddTaskOnLoad();
            App.go('#/events/' + created.id);
          } else {
            Store.updateEvent(eventId, data);
            close();
            UI.toast('Event saved.');
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
    var ev = Store.event(t.eventId);

    var body =
      field({
        name: 'title', label: 'Task', required: true,
        control: '<input type="text" id="f-title" data-autofocus maxlength="160" value="' + U.esc(t.title) + '">'
      }) +
      '<div class="field-row">' +
      field({
        name: 'assigneeId', label: 'Assigned to',
        control: '<select id="f-assigneeId">' + UI.peopleOptions(t.assigneeId, true) + '</select>'
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
      field({
        name: 'eventId', label: 'Event', required: true,
        control: '<select id="f-eventId">' + UI.selectOptions(
          Store.events().map(function (e) { return { value: e.id, label: e.title }; }), t.eventId
        ) + '</select>',
        hint: 'Every task belongs to an event.'
      }) + '</div>' +
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
            blockedReason: root.querySelector('#f-blockedReason').value.trim(),
            eventId: root.querySelector('#f-eventId').value
          };
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
            message: '“' + t.title + '” will be removed from ' + (ev ? ev.title : 'this event') + '.',
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
    var route = (d.stops || []).map(function (s) { return s.officeId; });
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
      '<div class="field"><span class="field-label">Where it has to go <span class="req">*</span></span>' +
      (templates.length
        ? '<select id="f-ltemplate" style="margin-bottom:10px">' +
          '<option value="">Start from a common route…</option>' +
          templates.map(function (t, i) {
            return '<option value="' + i + '">' + U.esc(t.name) + '</option>';
          }).join('') + '</select>'
        : '') +
      '<div id="route-list"></div>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:8px">' +
      '<select id="f-laddoffice" style="flex:1"><option value="">Add an office…</option>' +
      Store.offices({ activeOnly: true }).map(function (o) {
        return '<option value="' + U.esc(o.id) + '">' + U.esc(o.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="error-text" hidden>Choose at least one office.</div></div>';

    UI.modal({
      title: isNew ? 'Track a letter' : 'Edit letter',
      wide: true,
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' +
        (isNew ? 'Start tracking' : 'Save changes') + '</button>',
      onMount: function (root, close) {
        var listEl = root.querySelector('#route-list');

        function drawRoute() {
          if (!route.length) {
            listEl.innerHTML = '<p class="small muted" style="margin:0">Nothing chosen yet — ' +
              'pick a common route above, or add offices one at a time.</p>';
            return;
          }
          listEl.innerHTML = '<ol class="route-pick">' + route.map(function (oid, i) {
            var locked = i < lockedCount;
            return '<li' + (locked ? ' class="is-locked"' : '') + '>' +
              '<span class="rp-n">' + (i + 1) + '</span>' +
              '<span class="rp-name">' + U.esc(Store.officeName(oid)) +
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
              route.splice(Number(b.getAttribute('data-rdrop')), 1);
              drawRoute();
            });
          });
        }
        drawRoute();

        var tpl = root.querySelector('#f-ltemplate');
        if (tpl) tpl.addEventListener('change', function () {
          if (tpl.value === '') return;
          var picked = templates[Number(tpl.value)];
          // Anything already visited stays; the rest is replaced by the template.
          route = route.slice(0, lockedCount).concat(picked.officeIds.filter(function (oid) {
            return route.slice(0, lockedCount).indexOf(oid) < 0;
          }));
          tpl.value = '';
          drawRoute();
        });

        var add = root.querySelector('#f-laddoffice');
        add.addEventListener('change', function () {
          if (!add.value) return;
          if (route.indexOf(add.value) < 0) route.push(add.value);
          add.value = '';
          drawRoute();
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
            officeIds: route
          };

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
        });
      }
    });
  }

  /* ---------- the hand-over ----------
     The clerk who takes the letter in will never use this app, so their name is
     typed by whoever handed it over. That makes this a logbook rather than a
     signature, which is worth being plain about on the form itself. */
  function receiveForm(letterId, stopId) {
    var l = Store.letter(letterId);
    if (!l) return;
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return;

    var carrier = Store.letterInCharge(l);
    var body =
      '<p class="small">Handing <strong>' + U.esc(l.subject) + '</strong> in at ' +
      '<strong>' + U.esc(Store.officeName(s.officeId)) + '</strong>.</p>' +
      field({
        name: 'receivedBy', label: 'Who received it', required: true,
        control: '<input type="text" id="f-rby" data-autofocus maxlength="80" ' +
          'placeholder="Name of the person at the office">',
        hint: 'Typed in by you — nobody at that office signs in here.'
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
          if (!who) return showError(root, 'receivedBy', 'Write down who received it.');
          try {
            Store.receiveStop(letterId, stopId, {
              receivedBy: who,
              forwardedBy: root.querySelector('#f-rfrom').value.trim(),
              receivedAt: root.querySelector('#f-rwhen').value
            });
            close();
            UI.toast('Recorded — ' + Store.officeName(s.officeId) + ' has it.');
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
  function releaseForm(letterId, stopId) {
    var l = Store.letter(letterId);
    if (!l) return;
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return;

    var outcome = 'Approved';
    var body =
      '<p class="small"><strong>' + U.esc(Store.officeName(s.officeId)) + '</strong> has finished with ' +
      '<strong>' + U.esc(l.subject) + '</strong>.</p>' +
      '<div class="field"><span class="field-label">What happened <span class="req">*</span></span>' +
      '<div class="segmented" style="width:100%">' +
        Store.STOP_OUTCOMES.map(function (o, i) {
          return '<button type="button" data-outcome="' + U.esc(o) + '"' +
            (i === 0 ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
            U.esc(o === 'Returned for revision' ? 'Sent back' : o) + '</button>';
        }).join('') +
      '</div><div class="hint" id="outcome-hint">Signed and passed on.</div></div>' +
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

  /* ---------- volunteers ---------- */

  /* Taking on one helper for one activity. Three questions, because the other
     two — which unit, and which event — are already settled by where you were
     standing when you pressed the button. */
  function volunteerForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;

    var body =
      field({
        name: 'name', label: 'Full name', required: true,
        control: '<input type="text" id="v-name" data-autofocus maxlength="80" placeholder="Juan D. Dela Cruz">'
      }) +
      field({
        name: 'email', label: 'Email', required: true,
        control: '<input type="text" id="v-email" maxlength="120" placeholder="juan@filamer.edu.ph">',
        hint: 'This is how they sign in. They choose their own password afterwards.'
      }) +
      field({
        name: 'position', label: 'Role in this activity',
        control: '<input type="text" id="v-position" maxlength="60" placeholder="e.g. Logistics Volunteer">',
        hint: 'A label printed on reports. It does not change what they can open.'
      }) +
      '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
      '<div class="small"><strong>' + U.esc(e.title) + '</strong> only, and only while it is running. ' +
      'When this activity is completed their access ends by itself.</div></div>';

    UI.modal({
      title: 'Add a volunteer',
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Add volunteer</button>',
      onMount: function (root, close) {
        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var name = root.querySelector('#v-name').value.trim();
          var addr = root.querySelector('#v-email').value.trim();
          var position = root.querySelector('#v-position').value.trim();

          if (!name) return showError(root, 'name', 'Enter their name.');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
            return showError(root, 'email', 'That email address does not look right.');
          }
          var already = Store.personByEmail(addr);
          if (already && (already.eventIds || []).indexOf(eventId) >= 0) {
            return showError(root, 'email', already.name + ' is already on this activity.');
          }

          enrolVolunteer({ name: name, email: addr, position: position }, e)
            .then(function () {
              close();
              UI.toast(name + ' added to ' + e.title + '.');
            })
            .catch(function (err) { showError(root, 'email', err.message || 'That could not be added.'); });
        });
      }
    });
  }

  /* One helper, recorded on the device and — once Supabase is connected — with
     the backend too. Someone already in the directory is put on this activity as
     well rather than entered twice. */
  function enrolVolunteer(v, e) {
    var existing = Store.personByEmail(v.email);
    var eventIds = existing
      ? (existing.eventIds || []).concat([e.id]).filter(function (x, i, a) { return a.indexOf(x) === i; })
      : [e.id];

    if (existing) {
      Store.updatePerson(existing.id, {
        eventIds: eventIds, access: 'volunteer', active: true,
        position: v.position || existing.position
      });
    } else {
      Store.addPerson({
        name: v.name, position: v.position, email: v.email,
        unitId: e.unitId, access: 'volunteer', eventIds: eventIds
      });
    }

    return Backend.enrol({
      email: v.email, full_name: v.name, position: v.position,
      unit_id: e.unitId, access: 'volunteer', eventIds: eventIds
    }).catch(function (err) {
      // Offline there is no server to record it on. The helper is still on the
      // activity so work can be assigned; the login follows once it is connected.
      if (Auth.isOffline()) return;
      throw err;
    });
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

  /* Reads the header row so the columns can be in any order, and copes with a
     file that has no header at all by assuming name, email, role. */
  function readVolunteerCSV(text) {
    var rows = parseCSV(text);
    if (!rows.length) return { rows: [], error: 'That file is empty.' };

    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var looksLikeHeader = head.some(function (h) {
      return h === 'name' || h === 'email' || h.indexOf('e-mail') >= 0;
    });

    var col = { name: 0, email: 1, position: 2 };
    if (looksLikeHeader) {
      head.forEach(function (h, i) {
        if (h === 'name' || h === 'full name' || h === 'full_name') col.name = i;
        else if (h === 'email' || h === 'e-mail' || h === 'email address') col.email = i;
        else if (h === 'position' || h === 'role' || h === 'committee') col.position = i;
      });
      rows = rows.slice(1);
    }

    var seen = {};
    var out = rows.map(function (r, n) {
      var name = (r[col.name] || '').trim();
      var addr = (r[col.email] || '').trim().toLowerCase();
      var position = (r[col.position] || '').trim();
      var problem = '';
      if (!name) problem = 'No name';
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) problem = 'Email does not look right';
      else if (seen[addr]) problem = 'Listed twice in this file';
      if (!problem) seen[addr] = true;
      return { line: n + (looksLikeHeader ? 2 : 1), name: name, email: addr, position: position, problem: problem };
    });
    return { rows: out, error: '' };
  }

  function importVolunteersForm(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    var parsed = null;

    UI.modal({
      title: 'Import volunteers',
      wide: true,
      body:
        '<p class="small">A spreadsheet with one helper per row, saved as <strong>CSV</strong>. ' +
        'In Excel or Google Sheets: <em>File → Download → Comma-separated values</em>.</p>' +
        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
        '<div class="small strong" style="margin-bottom:4px">Columns</div>' +
        '<div class="small muted">A header row of <code>name, email, role</code>. ' +
        'The order does not matter, and anything else in the file is ignored. ' +
        'Everyone imported here joins <strong>' + U.esc(e.title) + '</strong> as a volunteer.</div></div>' +
        '<div class="row" style="margin:14px 0">' +
        '<label class="btn">' + UI.icon('upload') + 'Choose the file' +
        '<input type="file" id="v-csv" accept=".csv,text/csv,text/plain" hidden></label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-sample>Download a blank one</button>' +
        '</div>' +
        '<div id="v-preview"></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save disabled>Import</button>',
      onMount: function (root, close) {
        var save = root.querySelector('[data-save]');
        var preview = root.querySelector('#v-preview');

        root.querySelector('[data-sample]').addEventListener('click', function () {
          UI.downloadFile('FCUSR-volunteers-template.csv',
            'name,email,role\nJuan D. Dela Cruz,juan@filamer.edu.ph,Logistics Volunteer\n',
            'text/csv');
        });

        root.querySelector('#v-csv').addEventListener('change', function (ev) {
          var f = ev.target.files && ev.target.files[0];
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) {
            preview.innerHTML = '<p class="small error-text" hidden="false">That file is very large — ' +
              'split it into a few smaller ones.</p>';
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var res = readVolunteerCSV(String(reader.result));
            parsed = res.rows;
            var good = parsed.filter(function (r) { return !r.problem; });
            var bad = parsed.filter(function (r) { return r.problem; });

            preview.innerHTML =
              '<div class="section-head" style="margin-top:4px"><h2>' +
              U.plural(good.length, 'volunteer') + ' ready</h2>' +
              (bad.length ? '<span class="section-note">' + U.plural(bad.length, 'row') +
                ' will be skipped</span>' : '') + '</div>' +
              '<div class="list" style="max-height:260px;overflow:auto">' +
              parsed.slice(0, 200).map(function (r) {
                return '<div class="task"><span class="task-main" style="cursor:default">' +
                  '<span class="task-title">' + U.esc(r.name || '(no name)') + '</span>' +
                  '<span class="task-meta">' + U.esc(r.email || '—') +
                  (r.position ? '<span class="sep">·</span>' + U.esc(r.position) : '') +
                  '</span></span><span class="task-right">' +
                  (r.problem
                    ? '<span class="chip st-overdue"><span class="dot"></span>' + U.esc(r.problem) + '</span>'
                    : '<span class="chip st-done"><span class="dot"></span>Line ' + r.line + '</span>') +
                  '</span></div>';
              }).join('') + '</div>' +
              (parsed.length > 200 ? '<p class="tiny muted">Showing the first 200 of ' +
                parsed.length + '.</p>' : '');

            save.disabled = good.length === 0;
            save.textContent = 'Import ' + U.plural(good.length, 'volunteer');
          };
          reader.onerror = function () { UI.toast('That file could not be read.', 'error'); };
          reader.readAsText(f);
        });

        save.addEventListener('click', function () {
          var queue = (parsed || []).filter(function (r) { return !r.problem; });
          if (!queue.length) return;
          save.disabled = true;

          var done = 0, failed = [];
          // One at a time, so a rejected row names itself instead of the whole
          // import failing as one lump.
          queue.reduce(function (chain, r) {
            return chain.then(function () {
              return enrolVolunteer(r, e).then(function () { done++; }, function (err) {
                failed.push(r.email + ' — ' + (err.message || 'refused'));
              }).then(function () {
                save.textContent = 'Importing… ' + (done + failed.length) + ' of ' + queue.length;
              });
            });
          }, Promise.resolve()).then(function () {
            close();
            if (!failed.length) {
              UI.toast(U.plural(done, 'volunteer') + ' added to ' + e.title + '.');
            } else {
              UI.modal({
                title: 'Imported with ' + U.plural(failed.length, 'problem'),
                body: '<p class="small">' + U.plural(done, 'volunteer') + ' went in. These did not:</p>' +
                  '<ul class="small" style="padding-left:18px;line-height:1.7">' +
                  failed.slice(0, 30).map(function (m) { return '<li>' + U.esc(m) + '</li>'; }).join('') +
                  '</ul>',
                footer: '<button type="button" class="btn btn-primary" data-close>Close</button>'
              });
            }
          });
        });
      }
    });
  }

  /* The events a volunteer for this unit could be put on. Volunteers help with
     their own unit's activities, so the list follows the unit picker. */
  function unitEvents(unitId) {
    return Store.events({ activeOnly: true, unitId: unitId });
  }

  function eventPickList(unitId) {
    var events = unitEvents(unitId);
    if (!events.length) {
      return '<p class="small muted">' + U.esc(Store.unitName(unitId)) +
        ' has nothing running. Create an event for them first, then enrol helpers into it.</p>';
    }
    return '<div class="list">' + events.map(function (e) {
      return '<label class="task" style="cursor:pointer">' +
        '<span class="task-main" style="cursor:pointer">' +
        '<span class="task-title">' + U.esc(e.title) + '</span>' +
        '<span class="task-meta">' + U.esc(U.fmtRange(e.dateStart, e.dateEnd)) + '</span></span>' +
        '<span class="task-right"><input type="checkbox" data-event="' + U.esc(e.id) + '" ' +
        'style="width:22px;height:22px;accent-color:var(--gold-600)"></span></label>';
    }).join('') + '</div>';
  }

  function enrolForm() {
    var unitList = Store.units({ activeOnly: true });
    var startUnit = (global.Auth && Auth.myUnitId()) || Store.nationalUnitId();

    var body =
      field({
        name: 'name', label: 'Full name', required: true,
        control: '<input type="text" id="f-name" data-autofocus maxlength="80" placeholder="Juan D. Dela Cruz">'
      }) +
      field({
        name: 'email', label: 'Email', required: true,
        control: '<input type="text" id="f-email" maxlength="120" placeholder="juan@filamer.edu.ph">',
        hint: 'This is how they sign in.'
      }) +
      field({
        name: 'position', label: 'Position',
        control: '<input type="text" id="f-position" maxlength="60" placeholder="e.g. Secretary, or Logistics Volunteer">',
        hint: 'Free text, printed on reports. It does not affect what they can open.'
      }) +
      field({
        name: 'unitId', label: 'Which unit', required: true,
        control: '<select id="f-unitId">' + unitList.map(function (u) {
          return '<option value="' + U.esc(u.id) + '"' + (u.id === startUnit ? ' selected' : '') + '>' +
            U.esc(u.name) + '</option>';
        }).join('') + '</select>',
        hint: 'Where they belong. This, and the level below, are the only two things that decide what they can open.'
      }) +
      '<div class="field"><span class="field-label">Level of access <span class="req">*</span></span>' +
      '<div class="segmented" style="width:100%">' +
        '<button type="button" data-level="officer" class="is-active" aria-pressed="true">Officer</button>' +
        '<button type="button" data-level="volunteer" aria-pressed="false">Volunteer</button>' +
      '</div>' +
      '<div class="hint" id="level-hint">An officer reaches every event of the unit ' +
      'they belong to.</div></div>' +
      '<p class="tiny muted" style="margin:-6px 0 14px">This page is for officers. ' +
      'Volunteers are taken on from the activity they are helping with &mdash; open the ' +
      'event under <strong>Events</strong> and use <strong>Add volunteer</strong>, or import ' +
      'a whole list at once.</p>' +

      '<div class="field" id="event-pick" hidden>' +
      '<span class="field-label">Events they may work on</span>' +
      '<div id="event-pick-list">' + eventPickList(startUnit) + '</div>' +
      '<div class="error-text" hidden>Tick at least one event for a volunteer.</div></div>';

    UI.modal({
      title: 'Enrol someone',
      wide: true,
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Create access</button>',
      onMount: function (root, close) {
        var level = 'officer';
        var unitPick = root.querySelector('#f-unitId');

        function currentUnit() { return Store.unit(unitPick.value) || Store.nationalUnit(); }

        function syncHint() {
          var u = currentUnit();
          // Officers reach everything in their unit, so the per-event list is
          // only for volunteers.
          root.querySelector('#event-pick').hidden = level === 'officer';
          root.querySelector('#level-hint').textContent = level === 'officer'
            ? (u.kind === 'national'
                ? 'A National officer reaches the whole Republic, including this page.'
                : 'An officer of ' + u.name + ' reaches that unit\u2019s events and nothing else.')
            : 'A volunteer reaches only the events you tick below, and only while those events are running.';
        }

        unitPick.addEventListener('change', function () {
          // The events on offer belong to the unit, so the list follows it.
          root.querySelector('#event-pick-list').innerHTML = eventPickList(unitPick.value);
          syncHint();
        });

        U.els('[data-level]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            level = b.getAttribute('data-level');
            U.els('[data-level]', root).forEach(function (o) {
              var on = o === b;
              o.classList.toggle('is-active', on);
              o.setAttribute('aria-pressed', String(on));
            });
            syncHint();
          });
        });

        root.querySelector('[data-save]').addEventListener('click', function () {
          clearErrors(root);
          var name = root.querySelector('#f-name').value.trim();
          var email = root.querySelector('#f-email').value.trim();
          var position = root.querySelector('#f-position').value.trim();
          var picked = U.els('[data-event]:checked', root).map(function (c) {
            return c.getAttribute('data-event');
          });

          if (!name) return showError(root, 'name', 'Enter their name.');
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return showError(root, 'email', 'That email address does not look right.');
          }
          if (level === 'volunteer' && !picked.length) {
            var f = root.querySelector('#event-pick');
            f.classList.add('has-error');
            f.querySelector('.error-text').hidden = false;
            return;
          }

          var person = Store.addPerson({ name: name, position: position });

          Backend.enrol({
            email: email, full_name: name, position: position,
            unit_id: unitPick.value,
            access: level, eventIds: picked
          }).then(function () {
            close();
            // Enrolling records the decision; the person sets their own password
            // the first time they open the site, which is the only way the app
            // never handles anyone else's.
            UI.modal({
              title: name + ' is enrolled',
              body: '<p class="small">Send them the link to the tracker and this line:</p>' +
                '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
                '<p class="small" style="margin:0">Open the site, press <strong>Sign in</strong>, ' +
                'choose <strong>Set my password</strong>, and use <strong>' + U.esc(email) +
                '</strong> with a password of your own choosing.</p></div>' +
                '<p class="small muted">Nobody else ever sees that password, and the address only ' +
                'works because you have just enrolled it.</p>',
              footer: '<button type="button" class="btn btn-primary" data-close>Done</button>'
            });
          }).catch(function (err) {
            close();
            // Offline there is no server to create the login on; the person is
            // still added to the directory so work can be assigned to them.
            UI.toast(Auth.isOffline()
              ? name + ' added. Their login is created once Supabase is connected.'
              : (err.message || 'That could not be enrolled.'),
              Auth.isOffline() ? 'success' : 'error');
          });
          void person;
        });
      }
    });
  }

  /* The roster, generated rather than typed: names, positions and the emails
     they sign in with. */
  /* ---------- who can sign in ----------

     Enrolling somebody creates a row saying the address may have an account,
     not an account. Until that person turns up and sets a password there is
     nothing to sign in with — and with sixteen officers spread across nine
     colleges, the question that decides whether a term starts on time is
     simply "who still has not". Nothing showed it, so nobody could chase it.

     Two lists, then: waiting, and in. Both come from the server, filtered by
     the same rules that decide what anyone may see, so an LGU head gets their
     own college and the nationals get the Republic. */

  function inviteLink() {
    var l = global.location;
    return l ? (l.origin + l.pathname) : '';
  }

  function groupMessage() {
    return 'FCUSR Task Tracker — your account is ready.\n\n' +
      'Open: ' + inviteLink() + '\n' +
      'Type your Filamer email and a password you will remember, then press Sign in.\n\n' +
      'The first time, it will ask you to set that password. Choose it yourself — ' +
      'nobody in the council can see it, so do not send it to anyone.';
  }

  function personalMessage(name, email) {
    return 'Hi ' + (name || 'there') + ' — your FCUSR Task Tracker account is ready.\n\n' +
      'Open: ' + inviteLink() + '\n' +
      'Email: ' + email + '\n' +
      'Then type a password you will remember and press Sign in.\n\n' +
      'It will ask you to set that password the first time. Choose it yourself — ' +
      'nobody in the council can see it.';
  }

  function rosterList() {
    var offline = !global.Auth || Auth.isOffline();

    UI.modal({
      title: 'Who can sign in',
      wide: true,
      body: '<div data-acc>' + (offline ? offlineBody() :
        '<p class="small muted" style="margin:0">Asking the server…</p>') + '</div>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn btn-primary" data-download>' +
        UI.icon('download') + 'Download the list</button>',
      onMount: function (root) {
        var host = root.querySelector('[data-acc]');
        var last = { pending: [], roster: [] };

        root.querySelector('[data-download]').addEventListener('click', function () {
          UI.downloadFile('FCUSR-Accounts-' + U.today() + '.txt', asText(last), 'text/plain');
          UI.toast('List downloaded.');
        });

        if (offline) return;
        load();

        function load() {
          Promise.all([Backend.pending(), Backend.roster()]).then(function (r) {
            last = { pending: r[0] || [], roster: r[1] || [] };
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

        function wire() {
          var g = host.querySelector('[data-copy-group]');
          if (g) g.addEventListener('click', function () {
            UI.copyText(groupMessage())
              .then(function () { UI.toast('Message copied — paste it into the group chat.'); })
              .catch(function (e) { UI.toast(e.message, 'error'); });
          });

          U.els('[data-copy-one]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              UI.copyText(personalMessage(b.getAttribute('data-name'), b.getAttribute('data-copy-one')))
                .then(function () { UI.toast('Copied — send it to ' + b.getAttribute('data-name') + '.'); })
                .catch(function (e) { UI.toast(e.message, 'error'); });
            });
          });

          U.els('[data-withdraw]', host).forEach(function (b) {
            b.addEventListener('click', function () {
              var email = b.getAttribute('data-withdraw');
              var name = b.getAttribute('data-name');
              var waiting = b.getAttribute('data-waiting') === '1';
              UI.confirm({
                title: 'Withdraw ' + name + '?',
                message: waiting
                  ? 'The enrolment for ' + email + ' is removed, so nobody can claim it. ' +
                    'Use this when an address was wrong or the person is no longer coming in.'
                  : email + ' will not be able to sign in again. Their tasks and everything ' +
                    'they filed stay exactly where they are.',
                detail: 'You can enrol the address again afterwards.',
                confirmLabel: 'Withdraw'
              }).then(function (ok) {
                if (!ok) return;
                b.disabled = true;
                Backend.withdraw(email).then(function () {
                  UI.toast(name + ' withdrawn.');
                  load();
                }).catch(function (err) {
                  b.disabled = false;
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
      '<div class="strong" style="margin-bottom:3px">No accounts yet</div>' +
      '<div class="small">The Supabase project has not been connected, so nobody signs in and ' +
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

  function view(pending, roster) {
    var active = roster.filter(function (p) { return p.active !== false; });
    var gone = roster.filter(function (p) { return p.active === false; });
    var mine = (global.Auth && Auth.current()) ? Auth.current().email : '';

    /* Not styled as an alarm. On the first day of a term everybody is waiting,
       and a screen that is red the moment it is doing its job teaches people to
       stop reading it. The count on the section below carries the urgency. */
    var html = '<div class="where-now" style="margin-bottom:16px">' +
      '<span class="wn-label">Where things stand</span>' +
      '<span class="wn-line">' + U.plural(active.length, 'person', 'people') + ' can sign in' +
      (pending.length ? ' · ' + pending.length + ' still to set a password' : '') + '</span>' +
      (pending.length
        ? '<span class="wn-note">Nobody can be chased into a system they have not opened. ' +
          'Send them the link.</span>'
        : '') +
      '</div>';

    if (pending.length) {
      html += '<div class="section" style="margin-bottom:18px">' +
        '<div class="section-head"><h2>Waiting to sign in ' +
        '<span class="chip st-overdue"><span class="dot"></span>' + pending.length + '</span></h2></div>' +
        '<p class="small muted" style="margin:0 2px 10px">Enrolled, but they have not opened the site ' +
        'and set a password yet. Until they do there is no account — only your enrolment.</p>' +
        '<button type="button" class="btn btn-sm" style="margin-bottom:10px" data-copy-group>' +
        'Copy the message for the group chat</button>' +
        '<div class="list">' + pending.map(function (e) { return row(e, true, mine); }).join('') +
        '</div></div>';
    }

    html += '<div class="section"' + (gone.length ? ' style="margin-bottom:18px"' : '') + '>' +
      '<div class="section-head"><h2>Signed in' +
      (active.length ? ' <span class="chip chip-plain">' + active.length + '</span>' : '') +
      '</h2></div>';
    html += active.length
      ? '<div class="list">' + active.map(function (p) { return row(p, false, mine); }).join('') + '</div>'
      : '<p class="small muted" style="margin:0 2px">Nobody has set a password yet.</p>';
    html += '</div>';

    if (gone.length) {
      html += '<div class="section"><div class="section-head"><h2>Withdrawn ' +
        '<span class="chip chip-plain">' + gone.length + '</span></h2></div>' +
        '<p class="small muted" style="margin:0 2px 10px">They cannot sign in. Their work is ' +
        'untouched, and enrolling the address again lets them back.</p>' +
        '<div class="list">' + gone.map(function (p) { return row(p, false, mine); }).join('') +
        '</div></div>';
    }

    return html;
  }

  function row(p, waiting, mine) {
    var email = p.email || '';
    var name = p.full_name || email || 'Somebody';
    var isMe = mine && email && mine.toLowerCase() === email.toLowerCase();
    var withdrawn = !waiting && p.active === false;

    var meta = [p.position || 'No position'];
    if (p.units && p.units.name) meta.push(p.units.name);

    return '<div class="task"><span class="task-main" style="cursor:default">' +
      '<span class="task-title">' + U.esc(name) +
        (isMe ? ' <span class="chip chip-plain">you</span>' : '') +
        (withdrawn ? ' <span class="chip st-not-started">Withdrawn</span>' : '') + '</span>' +
      '<span class="task-meta">' + meta.map(U.esc).join('<span class="sep">·</span>') + '</span>' +
      '<span class="task-meta">' + U.esc(email) + '</span>' +
      '</span>' +
      (isMe || withdrawn ? '' :
        '<span class="task-right" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
        (waiting
          ? '<button type="button" class="btn btn-sm" data-copy-one="' + U.esc(email) +
            '" data-name="' + U.esc(name) + '">Copy invite</button>'
          : '') +
        '<button type="button" class="btn btn-sm btn-ghost" data-withdraw="' + U.esc(email) +
        '" data-name="' + U.esc(name) + '" data-waiting="' + (waiting ? '1' : '0') +
        '">Withdraw</button></span>') +
      '</div>';
  }

  function asText(last) {
    var lines = ['FCUSR Task Tracker — who can sign in', U.fmtDate(U.today()), ''];
    if (last.pending.length) {
      lines.push('WAITING TO SIGN IN (' + last.pending.length + ')');
      last.pending.forEach(function (e) {
        lines.push('  ' + (e.full_name || '—') + '  —  ' + (e.position || 'No position') +
          '  —  ' + (e.email || ''));
      });
      lines.push('');
    }
    var active = last.roster.filter(function (p) { return p.active !== false; });
    lines.push('SIGNED IN (' + active.length + ')');
    if (!active.length) lines.push('  nobody yet');
    active.forEach(function (p) {
      lines.push('  ' + (p.full_name || '—') + '  —  ' + (p.position || 'No position') +
        '  —  ' + (p.email || ''));
    });
    var gone = last.roster.filter(function (p) { return p.active === false; });
    if (gone.length) {
      lines.push('', 'WITHDRAWN (' + gone.length + ')');
      gone.forEach(function (p) { lines.push('  ' + (p.full_name || '—') + '  —  ' + (p.email || '')); });
    }
    return lines.join('\n') + '\n';
  }

  /* ---------- person ---------- */

  function personForm(personId) {
    var p = personId ? Store.person(personId) : null;
    var isNew = !p;
    var d = p || { name: '', position: '', committee: '', active: true };

    var body =
      field({
        name: 'name', label: 'Full name', required: true,
        control: '<input type="text" id="f-name" data-autofocus maxlength="80" value="' + U.esc(d.name) + '">'
      }) +
      '<div class="field-row">' +
      field({
        name: 'position', label: 'Position',
        control: '<select id="f-position">' + UI.selectOptions(Store.positions(), d.position, 'No position') + '</select>'
      }) +
      field({
        name: 'committee', label: 'Committee',
        control: '<select id="f-committee">' + UI.selectOptions(Store.committees(), d.committee, 'No committee') + '</select>'
      }) +
      '</div>' +
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
          if (!data.name) return showError(root, 'name', 'Enter the officer’s name.');
          if (isNew) {
            Store.addPerson(data);
            UI.toast('Person added.');
          } else {
            data.active = root.querySelector('#f-active').checked;
            Store.updatePerson(personId, data);
            UI.toast('Person saved.');
          }
          close();
        }
        root.querySelector('[data-save]').addEventListener('click', submit);
        root.querySelector('#f-name').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
      }
    });
  }

  global.Forms = {
    unitForm: unitForm,
    feedbackForm: feedbackForm, waiveFeedbackForm: waiveFeedbackForm,
    officeForm: officeForm, letterForm: letterForm,
    receiveForm: receiveForm, releaseForm: releaseForm,
    volunteerForm: volunteerForm, importVolunteersForm: importVolunteersForm,
    readVolunteerCSV: readVolunteerCSV, parseCSV: parseCSV,
    eventForm: eventForm, taskForm: taskForm, personForm: personForm,
    enrolForm: enrolForm, rosterList: rosterList,
    groupMessage: groupMessage, personalMessage: personalMessage,
    field: field, showError: showError, clearErrors: clearErrors
  };
})(window);
