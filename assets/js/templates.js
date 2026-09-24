/* Event templates, and duplicating an event.

   Every Seminar needs a venue, a speaker, registration, certificates and the
   report afterwards; every General Assembly needs a notice, an agenda and the
   minutes. Typing that list again each time is how the certificates get
   forgotten. A template is the list, with when each item usually falls
   relative to the day, offered when an event is created — every suggestion
   can be unticked first, because no template knows this particular event.

   Six ship with the app. A unit keeps its own, and FCUSR Nationals may share
   one with every unit. They sync like everything else (templates in
   workspace.sql).

   Duplicating is for the events the council holds every year: Teachers' Day,
   the Founders' activities, Christian Emphasis Week. The copy is a fresh
   record — the shape of the work comes with it, never how last year went. */
(function (global) {
  'use strict';

  var POST = 'Post-event requirements: report and liquidation';

  var BUILTIN = [
    { id: 'builtin-seminar', name: 'Seminar', description: 'A talk or training with a guest speaker.',
      durationDays: 1, feedbackRequired: true, volunteers: false,
      tasks: [['Coordinate with the speaker', -21, 'High'], ['Reserve the venue', -14, 'High'],
              ['Prepare the program and invitations', -10, 'Medium'], ['Set up registration', -7, 'Medium'],
              ['Prepare the certificates', -3, 'Medium'], ['Venue preparation and technical check', -1, 'High'],
              ['Registration on the day', 0, 'High'], ['Documentation: photos and attendance', 0, 'Medium'],
              [POST, 7, 'High']] },
    { id: 'builtin-assembly', name: 'General Assembly', description: 'A called meeting of the council or the students.',
      durationDays: 1, feedbackRequired: true, volunteers: false,
      tasks: [['Reserve the venue', -14, 'High'], ['Draft the agenda', -10, 'High'],
              ['Send the notice of assembly', -7, 'High'], ['Prepare the attendance sheet', -2, 'Medium'],
              ['Sound system and technical setup', -1, 'Medium'], ['Documentation', 0, 'Medium'],
              ['Minutes of the assembly', 3, 'High']] },
    { id: 'builtin-competition', name: 'Competition', description: 'A contest with participants, judges and winners.',
      durationDays: 1, feedbackRequired: true, volunteers: true,
      tasks: [['Finalize the mechanics and criteria', -21, 'High'], ['Open registration of participants', -14, 'High'],
              ['Invite the judges and tabulators', -14, 'High'], ['Prepare the scoring sheets', -5, 'Medium'],
              ['Prizes, medals and certificates', -3, 'Medium'], ['Venue and equipment setup', -1, 'High'],
              ['Documentation', 0, 'Medium'], ['Announce and post the winners', 1, 'Medium'],
              [POST, 7, 'High']] },
    { id: 'builtin-registration', name: 'Registration Activity', description: 'Signing students up for something.',
      durationDays: 1, feedbackRequired: true, volunteers: true,
      tasks: [['Prepare the registration forms or links', -7, 'High'], ['Schedule the registration volunteers', -3, 'Medium'],
              ['Set up the registration booth', -1, 'Medium'], ['Registration proper', 0, 'High'],
              ['Consolidate the registration data', 2, 'High']] },
    { id: 'builtin-celebration', name: 'Celebration', description: 'Teachers’ Day, Founders’ activities, and the like.',
      durationDays: 1, feedbackRequired: true, volunteers: true,
      tasks: [['Plan the program flow', -21, 'High'], ['Send the invitations', -14, 'Medium'],
              ['Food and logistics', -7, 'Medium'], ['Decorations and venue', -1, 'Medium'],
              ['Documentation', 0, 'Medium'], ['Clean-up', 1, 'Low'], [POST, 7, 'High']] },
    { id: 'builtin-outreach', name: 'Outreach Activity', description: 'Community service with a partner community.',
      durationDays: 1, feedbackRequired: true, volunteers: true,
      tasks: [['Coordinate with the partner community', -21, 'High'], ['Letters and permits', -14, 'High'],
              ['Donations and materials', -7, 'Medium'], ['Transportation', -3, 'Medium'],
              ['Briefing of participants', -1, 'Medium'], ['Documentation', 0, 'Medium'],
              ['Post-activity report and liquidation', 7, 'High']] }
  ].map(function (t) {
    t.builtin = true;
    t.shared = true;
    t.venue = '';
    t.tasks = t.tasks.map(function (x) { return { title: x[0], offsetDays: x[1], priority: x[2] }; });
    return t;
  });

  function myUnit() { return Workspace.myUnitId(); }

  function all(includeArchived) {
    return BUILTIN.slice().concat(Store.templates({ usableBy: myUnit(), includeArchived: includeArchived }));
  }

  function find(id) {
    return BUILTIN.filter(function (t) { return t.id === id; })[0] || Store.template(id);
  }

  function mayEdit(t) { return !t.builtin && (!global.Auth || Auth.canEditTemplate(t)); }

  function when(offset) {
    if (offset === 0) return 'on the day';
    var n = Math.abs(offset);
    var unit = n % 7 === 0 && n >= 7 ? U.plural(n / 7, 'week') : U.plural(n, 'day');
    return unit + (offset < 0 ? ' before' : ' after');
  }

  /* ---------- choosing one ---------- */

  function pick() {
    var list = all(false);
    UI.modal({
      title: 'Start from a template',
      wide: true,
      sheet: true,
      body: '<p class="small muted" style="margin-top:0">Pick the kind of event. You can untick any of its ' +
        'suggested tasks before anything is created.</p>' +
        '<div class="tpl-grid">' + list.map(function (t) {
          return '<button type="button" class="tpl-card" data-tpl="' + U.esc(t.id) + '">' +
            '<span class="tpl-name">' + U.esc(t.name) + (t.builtin ? '' :
              ' <span class="chip chip-plain">' + (t.shared ? 'Shared' : 'Your unit') + '</span>') + '</span>' +
            (t.description ? '<span class="tpl-desc">' + U.esc(t.description) + '</span>' : '') +
            '<span class="tpl-count">' + U.plural(t.tasks.length, 'suggested task') + '</span></button>';
        }).join('') + '</div>',
      footer: '<button type="button" class="btn btn-ghost left" data-manage>Manage templates</button>' +
        '<button type="button" class="btn" data-blank>Blank event instead</button>',
      onMount: function (root, close) {
        U.els('[data-tpl]', root).forEach(function (b) {
          b.addEventListener('click', function () { close(); createFrom(find(b.getAttribute('data-tpl'))); });
        });
        root.querySelector('[data-blank]').addEventListener('click', function () { close(); Forms.eventForm(null); });
        root.querySelector('[data-manage]').addEventListener('click', function () { close(); manager(); });
      }
    });
  }

  /* The event, and its tasks with dates worked out from the day. The dates
     follow the event date as it is changed, so nobody recalculates anything. */
  function createFrom(t) {
    if (!t) return;
    var start = U.addDays(U.today(), 21);
    var body = (
      '<p class="small muted" style="margin-top:0">From the <strong>' + U.esc(t.name) + '</strong> template.</p>' +
      '<div class="field" data-field="title"><label for="tp-title">Event title <span class="req">*</span></label>' +
      '<input type="text" id="tp-title" data-autofocus maxlength="120" placeholder="e.g. Leadership Seminar 2026">' +
      '<div class="error-text" hidden></div></div>' +
      '<div class="field-row">' +
      '<div class="field" data-field="start"><label for="tp-start">Event date <span class="req">*</span></label>' +
      '<input type="date" id="tp-start" value="' + start + '"><div class="error-text" hidden></div></div>' +
      '<div class="field"><label for="tp-end">End date</label>' +
      '<input type="date" id="tp-end" value="' + (t.durationDays > 1 ? U.addDays(start, t.durationDays - 1) : '') + '">' +
      '<div class="hint">Leave blank for a one-day event.</div></div>' +
      '</div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="tp-venue">Venue</label>' +
      '<input type="text" id="tp-venue" maxlength="120" value="' + U.esc(t.venue || '') + '" placeholder="e.g. FCU Gymnasium"></div>' +
      '<div class="field"><label for="tp-head">Event head</label>' +
      '<select id="tp-head">' + UI.peopleOptions('', true).replace('>Unassigned<', '>Not set yet<') + '</select></div>' +
      '</div>' +
      '<div class="field"><div class="field-label">Suggested tasks</div>' +
      '<div class="row" style="gap:6px;margin:0 0 6px"><button type="button" class="btn btn-sm btn-ghost" data-all="1">Tick all</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-all="0">Untick all</button></div>' +
      '<ul class="tpl-tasks">' + t.tasks.map(function (x, i) {
        return '<li><label class="checkbox"><input type="checkbox" data-task="' + i + '" checked>' +
          '<span><strong>' + U.esc(x.title) + '</strong><br><span class="tiny muted" data-due="' + i + '"></span></span></label></li>';
      }).join('') + '</ul>' +
      '<div class="hint">Nobody is assigned yet. Give each task to someone once the event is created.</div></div>' +
      (t.volunteers
        ? '<label class="checkbox" style="margin-bottom:6px"><input type="checkbox" id="tp-code"> Make a code volunteers can join with</label>'
        : '') +
      (t.feedbackRequired === false
        ? '' : '<p class="tiny muted" style="margin:6px 0 0">Every activity is evaluated: add the Google Form link from the event once it exists.</p>'));

    UI.modal({
      title: 'New ' + t.name.toLowerCase(),
      wide: true,
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-create>Create event</button>',
      onMount: function (root, close) {
        var startEl = root.querySelector('#tp-start');
        function dates() {
          var s = startEl.value;
          t.tasks.forEach(function (x, i) {
            var el = root.querySelector('[data-due="' + i + '"]');
            el.textContent = s ? 'Due ' + U.fmtDateShort(U.addDays(s, x.offsetDays)) + ' · ' + when(x.offsetDays) +
              ' · ' + x.priority + ' priority' : when(x.offsetDays);
          });
        }
        startEl.addEventListener('change', dates);
        startEl.addEventListener('input', dates);
        dates();
        U.els('[data-all]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var on = b.getAttribute('data-all') === '1';
            U.els('[data-task]', root).forEach(function (c) { c.checked = on; });
          });
        });
        root.querySelector('[data-create]').addEventListener('click', function () {
          var fail = function (name, text) {
            var f = root.querySelector('[data-field="' + name + '"]');
            f.classList.add('has-error');
            f.querySelector('.error-text').textContent = text;
            f.querySelector('.error-text').hidden = false;
            f.querySelector('input').focus();
          };
          U.els('.has-error', root).forEach(function (f) { f.classList.remove('has-error'); });
          var title = root.querySelector('#tp-title').value.trim();
          var s = startEl.value;
          var e = root.querySelector('#tp-end').value;
          if (!title) return fail('title', 'Give the event a title.');
          if (!s) return fail('start', 'Pick the event date.');
          if (e && e < s) return fail('start', 'The end date cannot be before the start date.');
          var chosen = t.tasks.filter(function (x, i) { return root.querySelector('[data-task="' + i + '"]').checked; });
          try {
            var out = Store.createEventWithTasks({
              title: title, dateStart: s, dateEnd: e, venue: root.querySelector('#tp-venue').value,
              headId: root.querySelector('#tp-head').value, description: t.description || '',
              feedbackRequired: t.feedbackRequired !== false, unitId: myUnit(),
              historyNote: 'created this event from the “' + t.name + '” template'
            }, chosen.map(function (x) {
              return { title: x.title, priority: x.priority, dueDate: U.addDays(s, x.offsetDays) };
            }));
            var code = root.querySelector('#tp-code');
            if (code && code.checked) {
              try { Store.makeVolunteerCode(out.event.id); } catch (err2) { /* said on the event */ }
            }
            close();
            UI.toast('Event created with ' + U.plural(out.tasks.length, 'task') + '. Assign them next.');
            App.go('#/events/' + out.event.id);
          } catch (err) {
            UI.toast('The event could not be created: ' + err.message, 'error');
          }
        });
      }
    });
  }

  /* ---------- keeping them ---------- */

  function manager() {
    var list = all(true);
    var canMake = !global.Auth || Auth.canCreate();
    UI.modal({
      title: 'Event templates',
      wide: true,
      body: Workspace.setupNotice('templates', 'Sharing templates') +
        '<p class="small muted" style="margin-top:0">The six built-in ones come with the app. Copy one to make ' +
        'it your own, or build a new one from scratch.</p>' +
        '<div class="list">' + list.map(function (t) {
          return '<div class="tpl-row' + (t.archived ? ' is-archived' : '') + '">' +
            '<span class="rt"><span class="strong">' + U.esc(t.name) + '</span>' +
            '<span class="rs">' + (t.builtin ? 'Built in' : t.shared ? 'Shared with every unit' :
              Store.unitName(t.unitId)) + ' · ' + U.plural(t.tasks.length, 'task') +
              (t.archived ? ' · archived' : '') + '</span></span>' +
            '<button type="button" class="icon-btn" data-tmenu="' + U.esc(t.id) + '" aria-label="Options for ' +
              U.esc(t.name) + '" aria-haspopup="menu">' + UI.icon('more') + '</button></div>';
        }).join('') + '</div>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        (canMake ? '<button type="button" class="btn btn-primary" data-new-tpl>' + UI.icon('plus') + 'New template</button>' : ''),
      onMount: function (root, close) {
        var nt = root.querySelector('[data-new-tpl]');
        if (nt) nt.addEventListener('click', function () { close(); editor(null); });
        U.els('[data-tmenu]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var t = find(b.getAttribute('data-tmenu'));
            if (!t) return;
            var edit = mayEdit(t);
            var items =
              (t.archived ? '' : '<button type="button" data-set="use">' + UI.icon('plus') + 'Create an event from it</button>') +
              (edit ? '<button type="button" data-set="edit">' + UI.icon('edit') + 'Edit or rename</button>' : '') +
              (canMake ? '<button type="button" data-set="copy">' + UI.icon('copy') + (t.builtin ? 'Copy into my templates' : 'Duplicate') + '</button>' : '') +
              (edit ? '<button type="button" data-set="archive">' + UI.icon('archive') + (t.archived ? 'Bring it back' : 'Archive') + '</button>' : '') +
              (edit ? '<button type="button" data-set="history">' + UI.icon('history') + 'Activity history</button>' : '') +
              (edit ? '<div class="sep"></div><button type="button" class="danger" data-set="delete">' + UI.icon('trash') + 'Delete</button>' : '');
            UI.openMenu(b, items, function (act) {
              try {
                if (act === 'use') { close(); return createFrom(t); }
                if (act === 'edit') { close(); return editor(t.id); }
                if (act === 'copy') { close(); return editor(null, t); }
                if (act === 'history') return Workspace.history('template', t.id, t.name);
                if (act === 'archive') {
                  Store.updateTemplate(t.id, { archived: !t.archived });
                  close();
                  UI.toast(t.archived ? 'Template brought back.' : 'Template archived. It is no longer offered.');
                  return manager();
                }
                if (act === 'delete') {
                  close();
                  UI.confirm({ title: 'Delete “' + t.name + '”?',
                    message: 'Events already made from it are not touched.', confirmLabel: 'Delete template' })
                    .then(function (ok) {
                      if (ok) { Store.deleteTemplate(t.id); UI.toast('Template deleted.'); }
                      manager();
                    });
                }
              } catch (err) { UI.toast(err.message, 'error'); }
            });
          });
        });
      }
    });
  }

  function editor(tid, copyOf) {
    var t = tid ? Store.template(tid) : null;
    var src = t || copyOf || { name: '', description: '', venue: '', durationDays: 1, feedbackRequired: true,
      volunteers: false, shared: false, tasks: [{ title: '', offsetDays: -7, priority: 'Medium' }] };
    var tasks = src.tasks.map(function (x) { return { title: x.title, offsetDays: x.offsetDays, priority: x.priority }; });
    var share = !global.Auth || Auth.canShareTemplates();

    function taskRows() {
      return tasks.map(function (x, i) {
        return '<li class="tpl-edit-row" data-row="' + i + '">' +
          '<input type="text" data-k="title" value="' + U.esc(x.title) + '" maxlength="160" placeholder="Task" aria-label="Task ' + (i + 1) + '">' +
          '<input type="number" data-k="offsetDays" value="' + x.offsetDays + '" min="-365" max="365" step="1" aria-label="Days from the event">' +
          '<select data-k="priority" aria-label="Priority">' + UI.selectOptions(Store.PRIORITIES, x.priority) + '</select>' +
          '<button type="button" class="icon-btn" data-drop="' + i + '" aria-label="Remove this task">' + UI.icon('close') + '</button>' +
          '</li>';
      }).join('');
    }

    UI.modal({
      title: t ? 'Edit template' : 'New template',
      wide: true,
      body:
        '<div class="field" data-field="name"><label for="te-name">Name <span class="req">*</span></label>' +
        '<input type="text" id="te-name" data-autofocus maxlength="80" value="' + U.esc(t || !copyOf ? src.name : src.name + ' (copy)') + '" placeholder="e.g. Christian Emphasis Week">' +
        '<div class="error-text" hidden></div></div>' +
        '<div class="field"><label for="te-desc">What it is for</label>' +
        '<input type="text" id="te-desc" maxlength="200" value="' + U.esc(src.description || '') + '"></div>' +
        '<div class="field-row">' +
        '<div class="field"><label for="te-venue">Usual venue</label><input type="text" id="te-venue" maxlength="120" value="' + U.esc(src.venue || '') + '"></div>' +
        '<div class="field"><label for="te-days">How many days</label><input type="number" id="te-days" min="1" max="30" value="' + (src.durationDays || 1) + '"></div>' +
        '</div>' +
        '<div class="field"><div class="field-label">Tasks</div>' +
        '<div class="tiny muted" style="margin-bottom:6px">Days from the event: −7 is a week before, 0 is the day itself, 3 is three days after.</div>' +
        '<ul class="tpl-edit" id="te-tasks">' + taskRows() + '</ul>' +
        '<button type="button" class="btn btn-sm" data-add-row>' + UI.icon('plus') + 'Add a task</button></div>' +
        '<label class="checkbox" style="margin-top:8px"><input type="checkbox" id="te-fb"' + (src.feedbackRequired !== false ? ' checked' : '') + '> Needs a feedback form</label>' +
        '<label class="checkbox" style="margin-top:8px"><input type="checkbox" id="te-vol"' + (src.volunteers ? ' checked' : '') + '> Usually takes volunteers</label>' +
        '<div class="field" style="margin-top:12px"><div class="field-label">Who may use it</div>' +
        '<label class="checkbox"><input type="radio" name="te-share" value="unit"' + (src.shared && share ? '' : ' checked') + '> ' +
          U.esc(Store.unitName(myUnit())) + ' only</label>' +
        (share ? '<label class="checkbox" style="margin-top:6px"><input type="radio" name="te-share" value="all"' + (src.shared ? ' checked' : '') + '> Every unit in the Republic</label>' : '') +
        '</div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Save template</button>',
      onMount: function (root, close) {
        var ul = root.querySelector('#te-tasks');
        function readRows() {
          U.els('[data-row]', ul).forEach(function (li) {
            var i = Number(li.getAttribute('data-row'));
            U.els('[data-k]', li).forEach(function (inp) {
              var k = inp.getAttribute('data-k');
              tasks[i][k] = k === 'offsetDays' ? Number(inp.value) || 0 : inp.value;
            });
          });
        }
        function redraw() {
          ul.innerHTML = taskRows();
          U.els('[data-drop]', ul).forEach(function (b) {
            b.addEventListener('click', function () {
              readRows();
              tasks.splice(Number(b.getAttribute('data-drop')), 1);
              redraw();
            });
          });
        }
        redraw();
        root.querySelector('[data-add-row]').addEventListener('click', function () {
          readRows();
          tasks.push({ title: '', offsetDays: 0, priority: 'Medium' });
          redraw();
          var last = ul.querySelector('li:last-child input');
          if (last) last.focus();
        });
        root.querySelector('[data-save]').addEventListener('click', function () {
          readRows();
          var name = root.querySelector('#te-name').value.trim();
          if (!name) {
            var f = root.querySelector('[data-field="name"]');
            f.classList.add('has-error');
            f.querySelector('.error-text').textContent = 'Give the template a name.';
            f.querySelector('.error-text').hidden = false;
            return root.querySelector('#te-name').focus();
          }
          var sharedPick = root.querySelector('input[name="te-share"]:checked');
          var data = {
            name: name, description: root.querySelector('#te-desc').value,
            venue: root.querySelector('#te-venue').value, durationDays: Number(root.querySelector('#te-days').value) || 1,
            feedbackRequired: root.querySelector('#te-fb').checked, volunteers: root.querySelector('#te-vol').checked,
            shared: !!(sharedPick && sharedPick.value === 'all'),
            tasks: tasks.filter(function (x) { return String(x.title || '').trim(); })
          };
          try {
            if (t) Store.updateTemplate(t.id, data); else Store.addTemplate(data);
            close();
            UI.toast(t ? 'Template saved.' : 'Template added. It is offered whenever an event is created.');
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }
    });
  }

  function saveFromEvent(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    var share = !global.Auth || Auth.canShareTemplates();
    UI.modal({
      title: 'Save as a template',
      body: '<p class="small muted" style="margin-top:0">Its ' + U.plural(Store.tasks({ eventId: e.id }).length, 'task') +
        ' become the template’s list, each at the same distance from the event date. Nobody’s name ' +
        'and no status is kept.</p>' +
        '<div class="field"><label for="sf-name">Template name</label>' +
        '<input type="text" id="sf-name" data-autofocus maxlength="80" value="' + U.esc(e.title.replace(/\s*\b(19|20)\d{2}\b\s*/g, ' ').trim()) + '"></div>' +
        (share ? '<label class="checkbox"><input type="checkbox" id="sf-share"> Share it with every unit</label>' : ''),
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>Save template</button>',
      onMount: function (root, close) {
        root.querySelector('[data-save]').addEventListener('click', function () {
          var name = root.querySelector('#sf-name').value.trim();
          if (!name) return root.querySelector('#sf-name').focus();
          var sh = root.querySelector('#sf-share');
          try {
            Store.templateFromEvent(e.id, { name: name, shared: !!(sh && sh.checked) });
            close();
            UI.toast('Saved. It is offered the next time an event is created.');
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }
    });
  }

  /* ---------- duplicating ---------- */

  // "Teachers' Day 2026" becomes "Teachers' Day 2027".
  function nextTitle(title) {
    var m = String(title).match(/\b(19|20)(\d{2})\b/);
    if (!m) return title + ' (copy)';
    var y = Number(m[0]);
    return title.replace(m[0], String(y + 1));
  }

  function nextDate(e) {
    if (!e.dateStart) return '';
    // A past event is usually being set up for next year; a future one for a later date.
    if (e.dateStart < U.today()) {
      var d = U.parse(e.dateStart);
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d.toISOString().slice(0, 10);
    }
    return U.addDays(e.dateStart, 7);
  }

  function duplicateDialog(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    var dir = Store.isDirectiveSet(e);
    var taskCount = Store.tasks({ eventId: e.id }).length;
    var vols = dir ? [] : Store.volunteersFor(e.id);
    var mayVol = !global.Auth || Auth.canEnrolVolunteers();

    UI.modal({
      title: 'Duplicate ' + (dir ? 'directive' : 'event'),
      body:
        '<div class="field" data-field="title"><label for="du-title">New title</label>' +
        '<input type="text" id="du-title" data-autofocus maxlength="120" value="' + U.esc(nextTitle(e.title)) + '">' +
        '<div class="error-text" hidden></div></div>' +
        '<div class="field" data-field="date"><label for="du-date">' + (dir ? 'Due by' : 'New date') + '</label>' +
        '<input type="date" id="du-date" value="' + U.esc(nextDate(e)) + '">' +
        '<div class="hint">' + (e.dateStart ? 'Task due dates move by the same number of days.' : '') + '</div>' +
        '<div class="error-text" hidden></div></div>' +
        '<div class="field"><div class="field-label">Bring along</div>' +
        '<label class="checkbox"><input type="checkbox" id="du-info" checked disabled> The event’s information</label>' +
        '<label class="checkbox" style="margin-top:8px"><input type="checkbox" id="du-tasks"' + (taskCount ? ' checked' : ' disabled') + '> ' +
          'Its tasks (' + taskCount + ')</label>' +
        '<label class="checkbox" style="margin:8px 0 0 28px"><input type="checkbox" id="du-who"' + (taskCount ? ' checked' : ' disabled') + '> ' +
          'Keep who each task is given to</label>' +
        (!dir && mayVol ? '<label class="checkbox" style="margin-top:8px"><input type="checkbox" id="du-vols"' + (vols.length ? '' : ' disabled') + '> ' +
          'The same volunteers (' + vols.length + ')</label>' : '') +
        '<label class="checkbox" style="margin-top:8px"><input type="checkbox" id="du-settings" checked> ' +
          'Other settings: description, venue, event head and the feedback requirement</label>' +
        '</div>' +
        '<p class="tiny muted" style="margin:4px 0 0">The copy starts fresh: every task is Not Started, and no ' +
        'report, letter, feedback link, completion date or history comes with it.</p>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-dup>' + UI.icon('copy') + 'Duplicate</button>',
      onMount: function (root, close) {
        var tasks = root.querySelector('#du-tasks');
        var who = root.querySelector('#du-who');
        tasks.addEventListener('change', function () { who.disabled = !tasks.checked; });
        root.querySelector('[data-dup]').addEventListener('click', function () {
          var title = root.querySelector('#du-title').value.trim();
          var date = root.querySelector('#du-date').value;
          var fail = function (name, text) {
            var f = root.querySelector('[data-field="' + name + '"]');
            f.classList.add('has-error');
            f.querySelector('.error-text').textContent = text;
            f.querySelector('.error-text').hidden = false;
            f.querySelector('input').focus();
          };
          if (!title) return fail('title', 'Give the copy a title.');
          if (!date && !dir) return fail('date', 'Pick the new date.');
          var vol = root.querySelector('#du-vols');
          try {
            var own = !global.Auth || !Auth.signedIn() || Auth.canEditEvent(e.id);
            var out = Store.duplicateEvent(e.id, {
              title: title, dateStart: date, unitId: own ? e.unitId : Workspace.myUnitId(), includeTasks: tasks.checked, keepAssignees: who.checked,
              includeVolunteers: !!(vol && vol.checked), includeSettings: root.querySelector('#du-settings').checked
            });
            close();
            UI.toast('Duplicated with ' + U.plural(out.tasks.length, 'task') + '.');
            App.go('#/events/' + out.event.id);
          } catch (err) {
            fail(/date|year/i.test(err.message) ? 'date' : 'title', err.message);
          }
        });
      }
    });
  }

  global.Templates = {
    BUILTIN: BUILTIN, all: all, find: find, pick: pick, createFrom: createFrom,
    manager: manager, editor: editor, saveFromEvent: saveFromEvent,
    duplicateDialog: duplicateDialog, nextTitle: nextTitle
  };
})(window);
