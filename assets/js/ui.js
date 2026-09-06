/* FCUSR Task Tracker — shared UI pieces.
   The important one is taskRow(): every screen draws a task the same way, so there
   is one row layout to learn and one place to change it. */
(function (global) {
  'use strict';

  var ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.6"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M17 5.2a3.6 3.6 0 0 1 0 6.9M18 14.5a6.5 6.5 0 0 1 3.5 5.8"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M5.5 6l1 14A1.5 1.5 0 0 0 8 21.5h8a1.5 1.5 0 0 0 1.5-1.5l1-14"/>',
    download: '<path d="M12 3v13M7 11l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 20V7M7 12l5-5 5 5M4 21h16"/>',
    pdf: '<path d="M8 2.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 6 20V4a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M15 2.5V8h5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/>',
    archive: '<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
  };

  /* Every icon carries `ico`, which is what gives it a size.

     Sizes used to come only from the selector of whatever contained the icon —
     `.btn svg`, `.tab svg`, and so on, one rule per place. Miss one and the SVG
     falls back to its own intrinsic size: the popup menu had no rule, so the
     delete icon rendered about a hundred and sixty pixels tall and swallowed
     the screen. A default on the icon itself means a forgotten container costs
     nothing, and the specific rules still override it wherever a place wants a
     different size. */
  function icon(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
  }

  function statusClass(status) {
    return 'st-' + String(status || '').toLowerCase().replace(/\s+/g, '-');
  }

  /* Colour never carries meaning alone — the label is always written out. */
  function statusChip(task, editable) {
    var cls = 'chip ' + statusClass(task.status);
    var label = U.esc(task.status);
    if (!editable) return '<span class="' + cls + '"><span class="dot"></span>' + label + '</span>';
    return '<button type="button" class="' + cls + ' status-edit" data-status-for="' + U.esc(task.id) + '" ' +
      'aria-haspopup="menu" aria-label="Status: ' + label + '. Change status">' +
      '<span class="dot"></span>' + label + '</button>';
  }

  /* Finished work has no countdown — showing "5 days late" on a Done task reads as
     a live problem when it is already closed. The Done chip carries the state and
     the meta line still carries the deadline. */
  function dueChip(task) {
    if (task.status === 'Done') return '';
    if (!task.dueDate) return '<span class="chip chip-due">No date</span>';
    var n = U.daysLeft(task.dueDate);
    var cls = 'chip chip-due';
    if (n < 0) cls += ' is-late';
    else if (n === 0) cls += ' is-today';
    else if (n <= 3) cls += ' is-soon';
    return '<span class="' + cls + '">' + U.esc(U.daysLeftLabel(task.dueDate)) + '</span>';
  }

  /* Officer badge. The colour is derived from the name, so the same person is the
     same colour on every screen and a long list becomes scannable by eye. */
  function whoIndex(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 8;
  }

  function who(personId, title) {
    var p = personId ? Store.person(personId) : null;
    if (!p) {
      return '<span class="who none" title="Unassigned" aria-hidden="true">–</span>';
    }
    return '<span class="who w' + whoIndex(p.name) + '" title="' + U.esc(title || p.name) + '" aria-hidden="true">' +
      U.esc(U.initials(p.name)) + '</span>';
  }

  /* Progress ring — an event's health in the space of an icon. */
  function ring(done, total) {
    var p = U.pct(done, total);
    var r = 15.5, c = 2 * Math.PI * r;
    var offset = c * (1 - p / 100);
    // A ring is still a progress indicator, so it reports its value the same way
    // the bar does rather than announcing as an image.
    return '<span class="ring' + (p === 100 && total > 0 ? ' is-complete' : '') + '" role="progressbar" ' +
      'aria-valuenow="' + p + '" aria-valuemin="0" aria-valuemax="100" ' +
      'aria-label="' + done + ' of ' + total + ' tasks done">' +
      '<svg viewBox="0 0 36 36" aria-hidden="true">' +
      '<circle class="track" cx="18" cy="18" r="' + r + '" fill="none" stroke-width="3.4"/>' +
      '<circle class="bar" cx="18" cy="18" r="' + r + '" fill="none" stroke-width="3.4" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>' +
      '</svg><span class="pctlabel">' + p + '%</span></span>';
  }

  /* The one task row used on every screen.
     `meta` is the context line: pass only what the surrounding screen does not
     already say (no assignee inside My tasks, no event inside an event).
     `opts.who` adds the officer badge, for screens where several people appear. */
  /* Whether this row may be changed by whoever is looking at it. Offline, with
     nobody signed in, everything is editable exactly as it always was. */
  function editable(task) {
    if (!global.Auth || !Auth.signedIn()) return true;
    return Auth.canEditTask(task);
  }

  function taskRow(task, meta, opts) {
    opts = opts || {};
    var parts = (meta || []).filter(Boolean);
    /* Lean rows carry only what has to be read at a glance: who holds it, and the
       deadline only when it has already slipped. Everything else is one tap away
       in the task itself, and leaving it out is what makes a long list scannable. */
    var late = Store.isOverdue(task);
    if (opts.lean) {
      // Exactly four things: who holds it, the date only once it has slipped,
      // the title, and the status. The red date and rail carry the lateness, so
      // a separate countdown chip would only say the same thing twice.
      parts = parts.slice(0, 1);
      if (late && task.dueDate) {
        parts.push({ text: 'Due ' + U.fmtDateShort(task.dueDate), cls: 'late' });
      }
    } else if (task.status === 'On hold' && task.blockedReason) {
      parts.push('On hold: ' + task.blockedReason);
    }
    var showWho = opts.who;

    var canEdit = editable(task);
    return '<div class="task' + (Store.isOverdue(task) ? ' is-overdue' : '') +
      (task.status === 'Done' ? ' is-done' : '') + '" data-row="' + U.esc(task.id) + '">' +
      (showWho ? '<span class="task-who">' + who(task.assigneeId) + '</span>' : '') +
      '<button type="button" class="task-main"' +
        (canEdit ? ' data-edit="' + U.esc(task.id) + '"' : ' data-view="' + U.esc(task.id) + '"') + '>' +
        '<span class="task-title">' +
          '<span class="pri-dot ' + task.priority.toLowerCase() + '" title="' + U.esc(task.priority) + ' priority"></span>' +
          U.esc(task.title) + '</span>' +
        (parts.length
          ? '<span class="task-meta">' + parts.map(function (part) {
              if (typeof part === 'string') return U.esc(part);
              return '<span class="' + part.cls + '">' + U.esc(part.text) + '</span>';
            }).join('<span class="sep">·</span>') + '</span>'
          : '') +
      '</button>' +
      '<span class="task-right">' +
        (opts.lean ? '' : dueChip(task)) +
        statusChip(task, editable(task)) + '</span>' +
    '</div>';
  }

  function progressBar(done, total, showLabel) {
    var p = U.pct(done, total);
    return '<div class="progress-row">' +
      '<div class="progress' + (p === 100 && total > 0 ? ' is-complete' : '') + '" role="progressbar" ' +
      'aria-valuenow="' + p + '" aria-valuemin="0" aria-valuemax="100" ' +
      'aria-label="' + done + ' of ' + total + ' tasks done"><span style="width:' + p + '%"></span></div>' +
      (showLabel === false ? '' : '<span class="progress-label">' + done + ' of ' + total + ' done</span>') +
      '</div>';
  }

  function avatar(name) {
    return '<span class="avatar" aria-hidden="true">' + U.esc(U.initials(name)) + '</span>';
  }

  var ART = {
    calm: '<circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="3"/>' +
      '<path d="M22 33l7 7 14-15" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
    tasks: '<rect x="14" y="10" width="36" height="46" rx="4" fill="none" stroke="currentColor" stroke-width="3"/>' +
      '<rect x="25" y="5" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="3"/>' +
      '<path d="M23 28h18M23 37h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    events: '<rect x="8" y="14" width="48" height="42" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>' +
      '<path d="M8 27h48M21 8v10M43 8v10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    people: '<circle cx="26" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="3"/>' +
      '<path d="M10 52a16 16 0 0 1 32 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M44 16a10 10 0 0 1 0 18M48 40a15 15 0 0 1 8 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
  };

  function empty(title, message, actionHtml, art) {
    var shape = ART[art] || ART.calm;
    return '<div class="empty">' +
      '<div class="art" aria-hidden="true"><svg viewBox="0 0 64 64">' + shape + '</svg></div>' +
      '<strong>' + U.esc(title) + '</strong>' +
      '<p>' + U.esc(message) + '</p>' + (actionHtml || '') + '</div>';
  }

  /* ---------- toasts ---------- */

  function toast(message, kind) {
    var host = document.getElementById('toasts');
    var node = document.createElement('div');
    node.className = 'toast ' + (kind || 'success');
    node.innerHTML = icon(kind === 'error' ? 'alert' : 'check') + '<span>' + U.esc(message) + '</span>';
    host.appendChild(node);
    setTimeout(function () {
      node.classList.add('leaving');
      setTimeout(function () { node.remove(); }, 220);
    }, kind === 'error' ? 4200 : 2500);
  }

  /* After a redraw, briefly highlight the row that just changed so the effect of
     a tap is visible even if the row moved in the sort order. */
  var flashId = null;
  function flashRow(taskId) { flashId = taskId; }
  function applyFlash(root) {
    if (!flashId) return;
    var row = root.querySelector('[data-row="' + flashId + '"]');
    flashId = null;
    if (row) {
      row.classList.add('just-changed');
      setTimeout(function () { row.classList.remove('just-changed'); }, 1200);
    }
  }

  /* ---------- scroll lock ----------
     body{overflow:hidden} alone does not hold on iOS Safari, so the class sets it
     on <html> and <body> together and is reference-counted across nested dialogs. */

  var lockCount = 0;
  function lockScroll() {
    if (lockCount === 0) document.documentElement.classList.add('is-locked');
    lockCount++;
  }
  function unlockScroll() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.documentElement.classList.remove('is-locked');
  }

  /* ---------- modal ---------- */

  function modal(opts) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal' + (opts.wide ? ' wide' : '') + (opts.full ? ' full' : '') +
        '" role="dialog" aria-modal="true" aria-label="' + U.esc(opts.title) + '">' +
        '<div class="modal-head"><h2>' + U.esc(opts.title) + '</h2>' +
          /* A dialog that must be answered offers no corner to escape through.
             Every one of them carries its own buttons saying what the answers
             are, so there is nothing to be stranded by. */
          (opts.dismissible === false ? '' :
            '<button type="button" class="icon-btn" data-close aria-label="Close">' + icon('close') + '</button>') +
        '</div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '') +
      '</div>';

    var lastFocused = document.activeElement;
    document.body.appendChild(backdrop);
    lockScroll();

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      unlockScroll();
      document.removeEventListener('keydown', onKey, true);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      if (opts.onClose) opts.onClose();
    }

    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        // dismissible:false means answered, not merely difficult.
        if (opts.dismissible !== false) close();
        return;
      }
      if (ev.key !== 'Tab') return;
      var f = U.els('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])', backdrop);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);

    backdrop.addEventListener('mousedown', function (ev) {
      if (ev.target === backdrop && opts.dismissible !== false) close();
    });
    U.els('[data-close]', backdrop).forEach(function (b) { b.addEventListener('click', close); });

    if (opts.onMount) opts.onMount(backdrop, close);

    var focusTarget = backdrop.querySelector('[data-autofocus]') || backdrop.querySelector('input,select,textarea,button');
    if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 30);

    return close;
  }

  /* Confirmations are mostly deletions, so that is the default shape: a red
     button and a plain Cancel. A few are a real question with two honest
     answers instead — those pass their own labels and tone:'primary'. */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      modal({
        title: opts.title,
        body: '<p>' + U.esc(opts.message) + '</p>' +
          (opts.detail ? '<p class="small muted">' + U.esc(opts.detail) + '</p>' : ''),
        footer: '<button type="button" class="btn" data-cancel>' +
          U.esc(opts.cancelLabel || 'Cancel') + '</button>' +
          '<button type="button" class="btn ' +
          (opts.tone === 'primary' ? 'btn-primary' : 'btn-danger') + '" data-ok data-autofocus>' +
          U.esc(opts.confirmLabel || 'Delete') + '</button>',
        onMount: function (root, close) {
          root.querySelector('[data-ok]').addEventListener('click', function () {
            settled = true; close(); resolve(true);
          });
          root.querySelector('[data-cancel]').addEventListener('click', function () {
            settled = true; close(); resolve(false);
          });
        },
        onClose: function () { if (!settled) resolve(false); }
      });
    });
  }

  /* ---------- popup menu ----------
     Positioned with position:fixed against the anchor's viewport rect. It closes
     when the *page* scrolls, but deliberately not on a capture-phase listener:
     that fired for every nested scroll container and shut the menu on contact. */

  var activeMenu = null;

  function closeMenu() {
    if (!activeMenu) return;
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('scroll', closeMenu);
    window.removeEventListener('resize', closeMenu);
  }

  function onDocDown(ev) { if (activeMenu && !activeMenu.contains(ev.target)) closeMenu(); }
  function onMenuKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); closeMenu(); } }

  function openMenu(anchor, itemsHtml, onPick) {
    closeMenu();
    var menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = itemsHtml;
    document.body.appendChild(menu);

    var r = anchor.getBoundingClientRect();
    var mh = menu.offsetHeight, mw = menu.offsetWidth;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) {
      top = r.top - mh - 6;                       // flip above when there is no room below
      if (top < 8) top = Math.max(8, window.innerHeight - mh - 8);
    }
    var left = Math.min(r.left, window.innerWidth - mw - 10);
    menu.style.top = Math.round(top) + 'px';
    menu.style.left = Math.round(Math.max(8, left)) + 'px';

    activeMenu = menu;
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('scroll', closeMenu);
    window.addEventListener('resize', closeMenu);

    U.els('button', menu).forEach(function (b) {
      b.addEventListener('click', function () {
        var value = b.getAttribute('data-set');
        closeMenu();
        onPick(value, b);
      });
    });
    var current = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (current) current.focus();
    return menu;
  }

  function openStatusMenu(anchor, taskId, afterChange) {
    var task = Store.task(taskId);
    if (!task) return;
    var html = Store.STATUSES.map(function (s) {
      return '<button type="button" role="menuitemradio" aria-checked="' + (s === task.status) + '" data-set="' + U.esc(s) + '">' +
        '<span class="chip ' + statusClass(s) + '"><span class="dot"></span>' + U.esc(s) + '</span></button>';
    }).join('');
    openMenu(anchor, html, function (next) { applyStatus(taskId, next, afterChange); });
  }

  // Blocked always carries a one-line reason, so the picker asks for it.
  function applyStatus(taskId, status, afterChange) {
    var task = Store.task(taskId);
    if (!task || task.status === status) return;

    function finish(reason) {
      flashRow(taskId);
      Store.setTaskStatus(taskId, status, reason);
      toast(status === 'Done' ? 'Marked done.' : 'Status set to ' + status + '.');
      if (afterChange) afterChange();
    }

    if (status !== 'On hold') return finish('');

    modal({
      title: 'Why is it on hold?',
      body: '<div class="field"><label for="blk">Reason <span class="req">*</span></label>' +
        '<input type="text" id="blk" data-autofocus maxlength="140" ' +
        'placeholder="e.g. Waiting for the adviser to sign." value="' + U.esc(task.blockedReason) + '">' +
        '<div class="hint">One line. It shows on the dashboard and in the report.</div>' +
        '<div class="error-text" hidden>Please give a short reason.</div></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-ok>Put on hold</button>',
      onMount: function (root, close) {
        var input = root.querySelector('#blk');
        function submit() {
          var v = input.value.trim();
          if (!v) {
            root.querySelector('.error-text').hidden = false;
            input.closest('.field').classList.add('has-error');
            input.focus();
            return;
          }
          close();
          finish(v);
        }
        root.querySelector('[data-ok]').addEventListener('click', submit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      }
    });
  }

  /* ---------- form helpers ---------- */

  function selectOptions(values, selected, placeholder) {
    var html = placeholder ? '<option value="">' + U.esc(placeholder) + '</option>' : '';
    return html + values.map(function (v) {
      var value = typeof v === 'string' ? v : v.value;
      var label = typeof v === 'string' ? v : v.label;
      return '<option value="' + U.esc(value) + '"' + (value === selected ? ' selected' : '') + '>' +
        U.esc(label) + '</option>';
    }).join('');
  }

  /* The people who may be given this work.

     `eventId` scopes it to the unit that owns the activity plus anybody taken on
     for that activity in particular. Without it the picker offered every person
     in the Republic, so a national officer scrolled past nine colleges' rosters
     to find one of their own. Whoever is already selected stays in the list
     even if they would not otherwise qualify — a picker that silently drops the
     current value is how an assignment gets lost by opening a form. */
  function peopleOptions(selectedId, includeUnassigned, eventId) {
    var pool = eventId ? Store.assignable(eventId)
      : Store.people({ unitId: (global.Auth && Auth.signedIn()) ? Auth.myUnitId() : '' });
    if (selectedId && !pool.some(function (p) { return p.id === selectedId; })) {
      var cur = Store.person(selectedId);
      if (cur) pool = [cur].concat(pool);
    }
    var list = pool.filter(function (p) {
      return p.active !== false || p.id === selectedId;
    }).map(function (p) {
      return {
        value: p.id,
        label: p.name + (p.position ? ' — ' + p.position : '') + (p.active === false ? ' (inactive)' : '')
      };
    });
    if (includeUnassigned) list.unshift({ value: '', label: 'Unassigned' });
    return selectOptions(list, selectedId || '', includeUnassigned ? null : 'Select a person');
  }

  /* Copying to the clipboard.

     navigator.clipboard needs a secure context, so it is missing on a plain
     http:// page and refuses in some in-app browsers. The old textarea trick
     still works everywhere, and copying a line into a group chat is the whole
     point of the button — so it falls back rather than failing. */
  function copyText(text) {
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve() : reject(new Error('This browser would not let the app copy.'));
    });
  }

  /* A field that suggests without insisting.

     A dropdown of positions was the wrong control: a council invents working
     titles its constitution never named, and a closed list makes somebody pick
     the nearest wrong one. A datalist offers the same suggestions, filters as
     you type, and still accepts anything — and where a browser does not support
     it, it degrades to a plain text box, which was always the honest fallback. */
  function suggestInput(id, value, options, placeholder) {
    var listId = id + '-options';
    return '<input type="text" id="' + U.esc(id) + '" list="' + U.esc(listId) + '" ' +
      'maxlength="60" autocomplete="off" value="' + U.esc(value || '') + '"' +
      (placeholder ? ' placeholder="' + U.esc(placeholder) + '"' : '') + '>' +
      '<datalist id="' + U.esc(listId) + '">' +
      (options || []).map(function (o) { return '<option value="' + U.esc(o) + '"></option>'; }).join('') +
      '</datalist>';
  }

  function downloadFile(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  global.UI = {
    icon: icon, statusClass: statusClass, statusChip: statusChip, dueChip: dueChip,
    taskRow: taskRow, taskEditable: editable,
    progressBar: progressBar, avatar: avatar, empty: empty,
    who: who, whoIndex: whoIndex, ring: ring, flashRow: flashRow, applyFlash: applyFlash,
    toast: toast, modal: modal, confirm: confirm,
    openMenu: openMenu, openStatusMenu: openStatusMenu, applyStatus: applyStatus, closeMenu: closeMenu,
    selectOptions: selectOptions, peopleOptions: peopleOptions, downloadFile: downloadFile,
    suggestInput: suggestInput,
    copyText: copyText
  };
})(window);
