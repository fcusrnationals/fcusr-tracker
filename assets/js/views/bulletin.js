/* The Bulletin Board — official announcements from FCUSR Nationals.

   Administrative, not a feed: no likes, no comments, no scrolling past a
   stranger's lunch. Pinned first, then what is current, then what has ended —
   and an announcement ends by itself on its expiry date, because a notice
   about a deadline that passed last month is worse than no notice.

   One record per announcement. The notification about it, the line on the
   Overview and this board all read the same record, so editing it here edits
   it everywhere and deleting it removes it everywhere.

   Only the FCUSR Nationals post. That is checked on this screen, in the store,
   and by the database (workspace.sql), because hiding a button is not the same
   as refusing the thing it does. */
(function (global) {
  'use strict';

  var state = { previousOpen: false };
  var PRIORITY_RANK = { Urgent: 0, Important: 1, Normal: 2 };

  function canPost() { return !global.Auth || Auth.canPublishBulletin(); }
  function profileId() { return global.Auth && Auth.signedIn() ? Auth.current().id : 'local'; }

  /* What this person may see: everything addressed to them, and — for the
     Nationals, who write them — drafts and scheduled ones too. */
  function visible() {
    var who = Workspace.viewer();
    var nat = canPost();
    return Store.announcements().filter(function (a) {
      var st = Store.announcementState(a);
      if ((st === 'draft' || st === 'scheduled') && !nat) return false;
      return Store.announcementFor(a, who);
    });
  }

  function inYear(a) { return Workspace.inView('announcement', a); }

  /* ---------- how one reads ---------- */

  function audienceText(a) {
    var aud = a.audience || {};
    if (aud.kind === 'nationals') return 'FCUSR Nationals';
    if (aud.kind === 'units') {
      var names = (aud.unitIds || []).map(function (id) {
        var u = Store.unit(id);
        return u ? (u.code || u.name) : null;
      }).filter(Boolean);
      return names.length > 3 ? U.plural(names.length, 'unit') : names.join(', ') || 'Selected units';
    }
    if (aud.kind === 'people') return U.plural((aud.personIds || []).length, 'person', 'people');
    return 'Everyone';
  }

  function when(a) {
    var st = Store.announcementState(a);
    if (st === 'draft') return 'Draft — not published';
    if (st === 'scheduled') return 'Scheduled for ' + U.fmtStamp(a.publishAt);
    if (st === 'expired') return 'Ended ' + U.fmtWhen(a.expiresAt);
    return 'Posted ' + U.fmtWhen(a.publishAt) +
      (a.expiresAt ? ' · until ' + U.fmtWhen(a.expiresAt) : '');
  }

  function message(text) {
    return U.esc(text || '').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  }

  function linkButton(a) {
    if (!a.link || !a.link.url) return '';
    var label = a.link.label || (a.link.url.charAt(0) === '#' ? 'Open in the tracker' : 'Open link');
    if (a.link.url.charAt(0) === '#') {
      return '<a class="btn btn-sm" href="' + U.esc(a.link.url) + '">' + UI.icon('link') + U.esc(label) + '</a>';
    }
    return Workspace.extLink(a.link.url, label, 'btn btn-sm');
  }

  function ackBlock(a) {
    if (!a.requireAck || Store.announcementState(a) !== 'active') return '';
    var mine = Store.acks(a.id).filter(function (k) { return k.profileId === profileId(); })[0];
    var html = '<div class="bb-ack">';
    if (canPost()) {
      var st = Store.ackStatus(a.id);
      var pct = st.total ? Math.round(st.done.length / st.total * 100) : 0;
      /* With nobody in the audience holding a sign-in yet (a rehearsal, or a
         directory still being filled in) there is no "of", only a count. */
      html += '<div class="bb-ack-count"><strong>' + (st.total ? st.done.length + ' of ' + st.total : st.count) +
        '</strong> acknowledged' +
        '<button type="button" class="linkish" data-ack-who="' + U.esc(a.id) + '">See who</button></div>' +
        (st.total ? '<div class="progress"><span style="width:' + pct + '%"></span></div>' : '');
    }
    html += mine
      ? '<div class="bb-acked">' + UI.icon('check') + 'You confirmed you read this · ' + U.esc(U.fmtWhen(mine.at)) + '</div>'
      : '<button type="button" class="btn btn-primary btn-sm" data-ack="' + U.esc(a.id) + '">' + UI.icon('check') +
        'I have read this</button>';
    return html + '</div>';
  }

  function card(a, opts) {
    opts = opts || {};
    var st = Store.announcementState(a);
    var long = !opts.full && (a.message || '').length > 320;
    var locked = Store.isLocked('announcement', a);
    var tags = (a.pinned && st === 'active' ? '<span class="chip chip-plain">' + UI.icon('pin') + 'Pinned</span>' : '') +
      (a.priority !== 'Normal' ? '<span class="chip bb-prio">' + U.esc(a.priority) + '</span>' : '') +
      (st === 'draft' ? '<span class="chip st-not-started">Draft</span>' : '') +
      (st === 'scheduled' ? '<span class="chip st-in-progress">Scheduled</span>' : '') +
      (a.requireAck ? '<span class="chip chip-plain">Please confirm</span>' : '');
    var more = canPost() && !locked
      ? '<button type="button" class="icon-btn" data-ann-more="' + U.esc(a.id) + '" aria-label="Options for ' +
        U.esc(a.title) + '" aria-haspopup="menu">' + UI.icon('more') + '</button>'
      : '';
    // A plain announcement has no tags; its menu then sits beside the title
    // rather than above an empty row.
    return '<article class="bb-card prio-' + a.priority.toLowerCase() + (st !== 'active' ? ' is-' + st : '') +
      (!tags && more ? ' has-bare-menu' : '') + '" id="ann-' + U.esc(a.id) + '">' +
      (tags || more
        ? '<div class="bb-top' + (tags ? '' : ' is-bare') + '">' +
          (tags ? '<div class="bb-tags">' + tags + '</div>' : '') + more + '</div>'
        : '') +
      '<h2 class="bb-title">' + (opts.full ? U.esc(a.title)
        : '<a href="#/bulletin/' + U.esc(a.id) + '">' + U.esc(a.title) + '</a>') + '</h2>' +
      '<div class="bb-meta">' + U.esc(when(a)) + '<span class="sep">·</span>For ' + U.esc(audienceText(a)) +
        (a.createdBy ? '<span class="sep">·</span>' + U.esc(a.createdBy) : '') + '</div>' +
      (a.message ? '<div class="bb-msg' + (long ? ' is-clamped' : '') + '"><p>' + message(a.message) + '</p></div>' : '') +
      ((long || linkButton(a))
        ? '<div class="bb-actions">' + linkButton(a) +
          (long ? '<a class="btn btn-sm btn-ghost" href="#/bulletin/' + U.esc(a.id) + '">Read all of it</a>' : '') +
          '</div>'
        : '') +
      ackBlock(a) +
      '</article>';
  }

  /* ---------- the board ---------- */

  function render(params) {
    if (params && params.id) return detail(params.id);
    var all = visible().filter(inYear);
    var drafts = all.filter(function (a) {
      var st = Store.announcementState(a);
      return st === 'draft' || st === 'scheduled';
    });
    var active = all.filter(function (a) { return Store.announcementState(a) === 'active'; });
    var pinned = active.filter(function (a) { return a.pinned; });
    // Urgent before Important before the rest; newest first within each.
    var current = active.filter(function (a) { return !a.pinned; }).sort(function (x, y) {
      return PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority];
    });
    var previous = all.filter(function (a) { return Store.announcementState(a) === 'expired'; });
    var archived = Workspace.viewingArchive();

    var html = '<div class="page-head"><div><h1>Bulletin Board</h1>' +
      '<div class="sub">Official announcements from FCUSR Nationals.</div></div>' +
      (canPost() && !archived
        ? '<button type="button" class="btn btn-primary" data-new-ann>' + UI.icon('plus') + 'New announcement</button>'
        : '') + '</div>';
    html += Workspace.setupNotice('announcements', 'The Bulletin Board');
    html += Workspace.hint('bulletin', canPost()
      ? 'Post official updates here. Pinned announcements stay at the top, and each one moves to ' +
        '<strong>Previous</strong> by itself on the day it expires.'
      : 'Official updates from FCUSR Nationals appear here. You are told about new ones by the bell.');

    if (!all.length) {
      return html + UI.empty(archived ? 'No announcements that year' : 'No announcements yet',
        'Official updates from FCUSR Nationals will appear here.',
        canPost() && !archived
          ? '<button type="button" class="btn btn-primary" data-new-ann>' + UI.icon('plus') + 'Create announcement</button>'
          : '', 'calm');
    }

    if (drafts.length) html += group('Drafts and scheduled', drafts, 'Only FCUSR Nationals can see these.');
    if (pinned.length) html += group('Pinned', pinned);
    if (current.length) html += group(pinned.length ? 'Active' : 'Active', current);
    if (!pinned.length && !current.length && !drafts.length) {
      html += UI.empty('Nothing current', 'Every announcement has ended. They are kept under Previous.', '', 'calm');
    }
    if (previous.length) {
      html += '<div class="section" style="margin-top:22px">' +
        '<div class="group" data-collapsed="' + !state.previousOpen + '" data-group="previous">' +
        '<button type="button" class="group-head" data-toggle-previous aria-expanded="' + state.previousOpen + '">' +
          UI.icon('chevronDown', 'caret') + '<span class="group-title">Previous</span>' +
          '<span class="group-meta">' + previous.length + '</span></button>' +
        '<div class="group-body"><div class="bb-list" style="padding:12px">' +
          previous.map(function (a) { return card(a); }).join('') + '</div></div></div></div>';
    }
    return html;
  }

  function group(title, list, note) {
    return '<section class="section"><div class="section-head"><h2>' + U.esc(title) +
      ' <span class="chip chip-plain">' + list.length + '</span></h2>' +
      (note ? '<span class="section-note">' + U.esc(note) + '</span>' : '') + '</div>' +
      '<div class="bb-list">' + list.map(function (a) { return card(a); }).join('') + '</div></section>';
  }

  function detail(aid) {
    var a = Store.announcement(aid);
    var back = '<a class="breadcrumb" href="#/bulletin">' + UI.icon('back') + 'All announcements</a>';
    var ok = a && visible().some(function (x) { return x.id === aid; });
    if (!ok) {
      return back + UI.empty('That announcement is not here',
        'It may have been removed, or it was not addressed to you.',
        '<a class="btn btn-primary" href="#/bulletin">Back to the Bulletin Board</a>', 'calm');
    }
    return back + Workspace.lockedNote('announcement', a) + card(a, { full: true });
  }

  function mount(root) {
    // Looking at the board is reading it: what is on it stops being "new".
    var keys = [];
    visible().forEach(function (a) {
      if (Store.announcementState(a) === 'active') keys.push('board:' + a.id, 'ann:' + a.id);
    });
    if (global.Notify && keys.length) {
      var fresh = keys.some(function (k) { return !Notify.isSeen(k); });
      Notify.markSeen(keys);
      if (fresh) setTimeout(function () { Notify.paint(); paintMore(); }, 0);
    }

    U.els('[data-new-ann]', root).forEach(function (b) {
      b.addEventListener('click', function () { form(null); });
    });
    var prev = root.querySelector('[data-toggle-previous]');
    if (prev) prev.addEventListener('click', function () {
      state.previousOpen = !state.previousOpen;
      prev.closest('.group').setAttribute('data-collapsed', String(!state.previousOpen));
      prev.setAttribute('aria-expanded', String(state.previousOpen));
    });
    wireCards(root);
  }

  function paintMore() {
    var mb = document.getElementById('tab-more');
    if (!mb) return;
    var n = unreadCount();
    mb.textContent = n;
    mb.hidden = n === 0;
  }

  // The acknowledgement button and the Nationals' menu, wherever a card is drawn.
  function wireCards(root) {
    U.els('[data-ack]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        try {
          Store.acknowledge(b.getAttribute('data-ack'));
          if (global.Notify) Notify.markSeen(['ack:' + b.getAttribute('data-ack')]);
          UI.toast('Thank you — recorded that you have read it.');
        } catch (err) { UI.toast(err.message, 'error'); }
      });
    });
    U.els('[data-ack-who]', root).forEach(function (b) {
      b.addEventListener('click', function () { whoRead(b.getAttribute('data-ack-who')); });
    });
    U.els('[data-ann-more]', root).forEach(function (b) {
      b.addEventListener('click', function () { menu(b, b.getAttribute('data-ann-more')); });
    });
  }

  function menu(anchor, aid) {
    var a = Store.announcement(aid);
    if (!a) return;
    var st = Store.announcementState(a);
    var items =
      '<button type="button" data-set="edit">' + UI.icon('edit') + 'Edit</button>' +
      (st === 'draft' ? '<button type="button" data-set="publish">' + UI.icon('megaphone') + 'Publish now</button>' : '') +
      (st === 'active' ? '<button type="button" data-set="pin">' + UI.icon('pin') + (a.pinned ? 'Unpin' : 'Pin to the top') + '</button>' : '') +
      (st === 'active' ? '<button type="button" data-set="end">' + UI.icon('archive') + 'End it now</button>' : '') +
      '<button type="button" data-set="copy">' + UI.icon('copy') + 'Post again as new</button>' +
      '<button type="button" data-set="history">' + UI.icon('history') + 'Activity history</button>' +
      '<div class="sep"></div>' +
      '<button type="button" class="danger" data-set="delete">' + UI.icon('trash') + 'Delete</button>';
    UI.openMenu(anchor, items, function (act) {
      try {
        if (act === 'edit') return form(aid);
        if (act === 'publish') {
          Store.updateAnnouncement(aid, { published: true, publishAt: Store.now() });
          return UI.toast('Published.');
        }
        if (act === 'pin') {
          Store.updateAnnouncement(aid, { pinned: !a.pinned });
          return UI.toast(a.pinned ? 'Unpinned.' : 'Pinned to the top.');
        }
        if (act === 'end') {
          Store.updateAnnouncement(aid, { expiresAt: Store.now() });
          return UI.toast('Ended. It is under Previous now.');
        }
        if (act === 'copy') return form(null, a);
        if (act === 'history') return Workspace.history('announcement', aid, a.title);
        if (act === 'delete') {
          UI.confirm({
            title: 'Delete this announcement?',
            message: '“' + a.title + '” is removed from the Bulletin Board for everybody, with its acknowledgements.',
            detail: 'To keep it on record, end it instead — it stays under Previous.',
            confirmLabel: 'Delete'
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteAnnouncement(aid);
            UI.toast('Announcement deleted.');
            if (/^#\/bulletin\//.test(location.hash)) App.go('#/bulletin');
          });
        }
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* Who has confirmed and who has not. Names, not a leaderboard: this is for
     chasing the few who have not seen something that mattered. */
  function whoRead(aid) {
    var a = Store.announcement(aid);
    if (!a) return;
    var st = Store.ackStatus(aid);
    function list(rows, done) {
      if (!rows.length) return '<p class="small muted">' + (done ? 'Nobody yet.' : 'Everybody has confirmed.') + '</p>';
      return '<div class="list">' + rows.map(function (r) {
        return '<div class="result-item" style="cursor:default">' + UI.icon(done ? 'check' : 'user') +
          '<span class="rt"><span class="strong">' + U.esc(r.person.name) + '</span>' +
          '<span class="rs">' + U.esc(Store.unitName(r.person.unitId)) +
          (done ? ' · ' + U.esc(U.fmtWhen(r.ack.at)) : '') + '</span></span></div>';
      }).join('') + '</div>';
    }
    if (!st.total) {
      var got = Store.acks(aid);
      UI.modal({
        title: 'Who has read it',
        body: '<p class="small" style="margin-top:0">Nobody in the audience has a sign-in yet, so there is no ' +
          'list to count against. Confirmations so far:</p>' +
          (got.length
            ? '<div class="list">' + got.map(function (k) {
                return '<div class="result-item" style="cursor:default">' + UI.icon('check') +
                  '<span class="rt"><span class="strong">' + U.esc(k.name || k.email || 'Someone') + '</span>' +
                  '<span class="rs">' + U.esc(U.fmtWhen(k.at)) + '</span></span></div>';
              }).join('') + '</div>'
            : '<p class="small muted">Nobody yet.</p>'),
        footer: '<button type="button" class="btn btn-primary" data-close>Done</button>'
      });
      return;
    }
    UI.modal({
      title: 'Who has read it',
      wide: true,
      body: '<p class="small" style="margin-top:0"><strong>' + st.done.length + ' of ' + st.total +
        '</strong> people it was sent to have confirmed reading “' + U.esc(a.title) + '”.</p>' +
        '<p class="tiny muted">Counted: the people in the audience who have a sign-in. Somebody with no ' +
        'account has no way to press the button, so they are not counted.</p>' +
        '<div class="field-label" style="margin-top:12px">Not yet (' + st.waiting.length + ')</div>' +
        list(st.waiting, false) +
        '<div class="field-label" style="margin-top:14px">Confirmed (' + st.done.length + ')</div>' + list(st.done, true),
      footer: '<button type="button" class="btn btn-primary" data-close>Done</button>'
    });
  }

  /* ---------- writing one ---------- */

  function localValue(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fromLocal(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  // What was being typed, kept if the dialog is closed by accident.
  var unsaved = null;

  function form(aid, copyOf) {
    if (!canPost()) return UI.toast('Only FCUSR Nationals can post to the Bulletin Board.', 'error');
    var a = aid ? Store.announcement(aid) : null;
    var isNew = !a;
    var src = a || copyOf || (isNew && unsaved) || {};
    var aud = src.audience || { kind: 'everyone', unitIds: [], personIds: [] };
    var st = a ? Store.announcementState(a) : '';
    var mode = a ? (st === 'draft' ? 'draft' : st === 'scheduled' ? 'schedule' : 'now') : (src.mode || 'now');
    var units = Store.units({ activeOnly: true });
    var people = Store.people({ activeOnly: true }).filter(function (p) { return p.email; });
    var events = Store.events({ kind: 'any', excludeArchived: true }).slice(-40);
    var link = src.link || { url: '', label: '' };

    var body =
      '<div class="field" data-field="title"><label for="an-title">Title <span class="req">*</span></label>' +
      '<input type="text" id="an-title" data-autofocus maxlength="160" value="' + U.esc(src.title || '') +
      '" placeholder="e.g. Submission of Liquidation Reports"><div class="error-text" hidden></div></div>' +
      '<div class="field"><label for="an-msg">Message</label>' +
      '<textarea id="an-msg" rows="6" maxlength="4000" placeholder="What everybody needs to know, and by when.">' +
      U.esc(src.message || '') + '</textarea>' +
      '<div class="hint">Plain text. Type @ and a person’s full name to let them know they are mentioned.</div></div>' +
      '<div class="field"><div class="field-label">Priority</div>' +
      '<div class="segmented" role="radiogroup" aria-label="Priority">' + Store.BULLETIN_PRIORITIES.map(function (p) {
        var on = (src.priority || 'Normal') === p;
        return '<button type="button" data-prio="' + p + '" class="' + (on ? 'is-active' : '') + '" aria-pressed="' + on + '">' + p + '</button>';
      }).join('') + '</div><div class="hint">Urgent is red and Important is gold. Most announcements are Normal.</div></div>' +
      '<div class="field" data-field="audience"><label for="an-aud">Who is it for?</label>' +
      '<select id="an-aud">' + UI.selectOptions([
        { value: 'everyone', label: 'Everyone — every officer in every unit' },
        { value: 'nationals', label: 'FCUSR Nationals only' },
        { value: 'units', label: 'Selected units' },
        { value: 'people', label: 'Selected people' }
      ], aud.kind) + '</select>' +
      '<div id="an-units" class="pick-list"' + (aud.kind === 'units' ? '' : ' hidden') + '>' +
        units.map(function (u) {
          return '<label class="checkbox"><input type="checkbox" value="' + U.esc(u.id) + '"' +
            ((aud.unitIds || []).indexOf(u.id) >= 0 ? ' checked' : '') + '> ' + U.esc(u.name) + '</label>';
        }).join('') + '</div>' +
      '<div id="an-people"' + (aud.kind === 'people' ? '' : ' hidden') + '>' +
        '<input type="search" id="an-people-q" placeholder="Find a name" style="margin:8px 0">' +
        '<div class="pick-list">' + people.map(function (p) {
          return '<label class="checkbox" data-name="' + U.esc(p.name.toLowerCase()) + '"><input type="checkbox" value="' +
            U.esc(p.id) + '"' + ((aud.personIds || []).indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + U.esc(p.name) +
            ' <span class="tiny muted">' + U.esc(Store.unitName(p.unitId)) + '</span></label>';
        }).join('') + '</div>' +
        '<div class="hint">Only people with a sign-in are listed — nobody else could read it.</div></div>' +
      '<div class="error-text" hidden></div></div>' +
      '<div class="field"><div class="field-label">When</div>' +
      '<div class="segmented" role="radiogroup" aria-label="When to publish">' +
        [['now', 'Publish now'], ['schedule', 'Schedule'], ['draft', 'Save as draft']].map(function (m) {
          return '<button type="button" data-mode="' + m[0] + '" class="' + (mode === m[0] ? 'is-active' : '') +
            '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + '</button>';
        }).join('') + '</div>' +
      '<div id="an-sched" data-field="schedule"' + (mode === 'schedule' ? '' : ' hidden') + ' style="margin-top:8px">' +
        '<label for="an-at" class="small">Publish on</label>' +
        '<input type="datetime-local" id="an-at" value="' + U.esc(localValue(mode === 'schedule' && src.publishAt ? src.publishAt
          : new Date(Date.now() + 3600000).toISOString())) + '"><div class="error-text" hidden></div></div></div>' +
      '<div class="field" data-field="expiry"><label class="checkbox"><input type="checkbox" id="an-exp-on"' +
        (src.expiresAt ? ' checked' : '') + '> Take it down automatically</label>' +
        '<div id="an-exp"' + (src.expiresAt ? '' : ' hidden') + ' style="margin-top:8px">' +
        '<input type="datetime-local" id="an-exp-at" value="' + U.esc(localValue(src.expiresAt ||
          new Date(Date.now() + 7 * 86400000).toISOString())) + '">' +
        '<div class="hint">After this it moves to Previous by itself.</div><div class="error-text" hidden></div></div></div>' +
      '<details class="an-more"' + (link.url ? ' open' : '') + '><summary>Add a link</summary>' +
        '<div class="field" data-field="link" style="margin-top:8px"><label for="an-link">Link</label>' +
        '<input type="text" id="an-link" maxlength="500" value="' + U.esc(link.url) + '" placeholder="https://drive.google.com/…">' +
        '<div class="hint">A web address starting with https://, such as a form or a Drive file.</div>' +
        '<div class="error-text" hidden></div></div>' +
        '<div class="field"><label for="an-link-ev">Or point to an activity in the tracker</label>' +
        '<select id="an-link-ev"><option value="">—</option>' + events.map(function (e) {
          var h = '#/events/' + e.id;
          return '<option value="' + U.esc(h) + '"' + (link.url === h ? ' selected' : '') + '>' + U.esc(e.title) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field"><label for="an-link-label">Button text</label>' +
        '<input type="text" id="an-link-label" maxlength="60" value="' + U.esc(link.label) + '" placeholder="e.g. Open the form"></div>' +
      '</details>' +
      '<div class="field" style="margin-top:12px"><label class="checkbox"><input type="checkbox" id="an-pin"' +
        (src.pinned ? ' checked' : '') + '> Pin it to the top</label></div>' +
      '<div class="field"><label class="checkbox"><input type="checkbox" id="an-ack"' + (src.requireAck ? ' checked' : '') +
        '> Require acknowledgement</label>' +
        '<div class="hint">Each person is asked to press “I have read this”, and you can see who has. ' +
        'Keep it for notices that genuinely need confirming.</div></div>';

    var saved = false;
    var collectNow = null;
    UI.modal({
      title: a ? 'Edit announcement' : 'New announcement',
      wide: true,
      body: body,
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-save>' +
        (mode === 'draft' ? 'Save draft' : mode === 'schedule' ? 'Schedule' : a && st === 'active' ? 'Save changes' : 'Publish') +
        '</button>',
      onClose: function () { if (!saved && isNew && collectNow) unsaved = collectNow(); },
      onMount: function (root, close) {
        var prio = src.priority || 'Normal';
        U.els('[data-prio]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            prio = b.getAttribute('data-prio');
            U.els('[data-prio]', root).forEach(function (x) {
              x.classList.toggle('is-active', x === b);
              x.setAttribute('aria-pressed', String(x === b));
            });
          });
        });
        var saveBtn = root.querySelector('[data-save]');
        U.els('[data-mode]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            mode = b.getAttribute('data-mode');
            U.els('[data-mode]', root).forEach(function (x) {
              x.classList.toggle('is-active', x === b);
              x.setAttribute('aria-pressed', String(x === b));
            });
            root.querySelector('#an-sched').hidden = mode !== 'schedule';
            saveBtn.textContent = mode === 'draft' ? 'Save draft' : mode === 'schedule' ? 'Schedule'
              : a && st === 'active' ? 'Save changes' : 'Publish';
          });
        });
        var audSel = root.querySelector('#an-aud');
        audSel.addEventListener('change', function () {
          root.querySelector('#an-units').hidden = audSel.value !== 'units';
          root.querySelector('#an-people').hidden = audSel.value !== 'people';
        });
        var q = root.querySelector('#an-people-q');
        q.addEventListener('input', function () {
          var v = q.value.trim().toLowerCase();
          U.els('#an-people [data-name]', root).forEach(function (l) {
            l.hidden = !!v && l.getAttribute('data-name').indexOf(v) < 0;
          });
        });
        var expOn = root.querySelector('#an-exp-on');
        expOn.addEventListener('change', function () { root.querySelector('#an-exp').hidden = !expOn.checked; });
        var evLink = root.querySelector('#an-link-ev');
        evLink.addEventListener('change', function () {
          if (evLink.value) root.querySelector('#an-link').value = evLink.value;
        });

        function collect() {
          var checked = function (sel) {
            return U.els(sel + ' input[type="checkbox"]:checked', root).map(function (c) { return c.value; });
          };
          return {
            title: root.querySelector('#an-title').value.trim(),
            message: root.querySelector('#an-msg').value,
            priority: prio,
            audience: { kind: audSel.value, unitIds: checked('#an-units'), personIds: checked('#an-people') },
            mode: mode,
            publishAt: mode === 'schedule' ? fromLocal(root.querySelector('#an-at').value) : '',
            expiresAt: expOn.checked ? fromLocal(root.querySelector('#an-exp-at').value) : '',
            link: { url: root.querySelector('#an-link').value.trim(), label: root.querySelector('#an-link-label').value.trim() },
            pinned: root.querySelector('#an-pin').checked,
            requireAck: root.querySelector('#an-ack').checked
          };
        }

        collectNow = collect;

        function fail(name, text) {
          var f = root.querySelector('[data-field="' + name + '"]');
          if (!f) return UI.toast(text, 'error');
          f.classList.add('has-error');
          var e = f.querySelector('.error-text');
          e.textContent = text;
          e.hidden = false;
          var input = f.querySelector('input,select,textarea');
          if (input) input.focus();
        }

        saveBtn.addEventListener('click', function () {
          U.els('.has-error', root).forEach(function (f) { f.classList.remove('has-error'); });
          U.els('.error-text', root).forEach(function (e) { e.hidden = true; });
          var d = collect();
          if (!d.title) return fail('title', 'Give the announcement a title.');
          if (d.audience.kind === 'units' && !d.audience.unitIds.length) return fail('audience', 'Tick at least one unit.');
          if (d.audience.kind === 'people' && !d.audience.personIds.length) return fail('audience', 'Tick at least one person.');
          if (d.link.url && !/^https:\/\/\S{3,}$/.test(d.link.url) && !/^#\/[A-Za-z0-9\/_-]+$/.test(d.link.url)) {
            return fail('link', 'That needs to be a web address starting with https://.');
          }
          var now = Store.now();
          if (mode === 'schedule' && (!d.publishAt || d.publishAt <= now)) {
            return fail('schedule', 'Pick a date and time in the future.');
          }
          var pubAt = mode === 'schedule' ? d.publishAt
            : (a && st === 'active' ? a.publishAt : now);
          if (d.expiresAt && d.expiresAt <= (mode === 'draft' ? now : pubAt)) {
            return fail('expiry', 'It has to come down after it goes up.');
          }
          var data = {
            title: d.title, message: d.message, priority: d.priority, audience: d.audience,
            published: mode !== 'draft', publishAt: mode === 'draft' ? (a ? a.publishAt : now) : pubAt,
            expiresAt: d.expiresAt, link: d.link.url ? d.link : { url: '', label: '' },
            pinned: d.pinned, requireAck: d.requireAck
          };
          try {
            var out = a ? Store.updateAnnouncement(a.id, data) : Store.addAnnouncement(data);
            saved = true;
            unsaved = null;
            close();
            var s2 = Store.announcementState(out);
            UI.toast(s2 === 'draft' ? 'Draft saved. Only FCUSR Nationals can see it.'
              : s2 === 'scheduled' ? 'Scheduled for ' + U.fmtStamp(out.publishAt) + '.'
              : a ? 'Announcement updated.' : 'Announcement published.');
          } catch (err) {
            UI.toast('We couldn’t save the announcement: ' + err.message + ' Your draft is still here.', 'error');
          }
        });
      }
    });
  }

  /* ---------- elsewhere in the app ---------- */

  // Announcements this person has not yet seen on the board.
  function unreadCount() {
    if (!global.Notify || Workspace.viewingArchive()) return 0;
    if (global.Auth && !Auth.isOffline() && !Auth.signedIn()) return 0;
    return visible().filter(function (a) {
      return Store.announcementState(a) === 'active' && !Notify.isSeen('board:' + a.id);
    }).length;
  }

  /* One compact card on the Overview, only when something on the board
     deserves it: something to confirm, something urgent or important or
     pinned, or something posted in the last three days. Three at most. */
  function overviewPreview() {
    if (Workspace.viewingArchive()) return '';
    var pid = profileId();
    var rank = function (a) {
      if (a.requireAck && !Store.hasAcked(a.id, pid)) return 0;
      if (a.priority === 'Urgent') return 1;
      if (a.priority === 'Important') return 2;
      if (a.pinned) return 3;
      return 4;
    };
    var list = visible().filter(function (a) {
      if (Store.announcementState(a) !== 'active') return false;
      return rank(a) < 4 || Date.now() - Date.parse(a.publishAt) < 3 * 86400000;
    }).sort(function (x, y) {
      return rank(x) - rank(y) || (x.publishAt < y.publishAt ? 1 : -1);
    }).slice(0, 3);
    if (!list.length) return '';
    return '<div class="section bb-preview"><div class="section-head"><h2>' + UI.icon('megaphone') + 'Bulletin</h2>' +
      '<a class="section-note" href="#/bulletin">View all</a></div>' +
      '<div class="list">' + list.map(function (a) {
        var needs = a.requireAck && !Store.hasAcked(a.id, pid);
        return '<a class="bb-row prio-' + a.priority.toLowerCase() + '" href="#/bulletin/' + U.esc(a.id) + '">' +
          '<span class="bb-dot" aria-hidden="true"></span>' +
          '<span class="rt"><span class="strong">' + U.esc(a.title) + '</span>' +
          '<span class="rs">' + (a.expiresAt ? 'Until ' + U.esc(U.fmtDateShort(U.dayOf(a.expiresAt))) : 'Posted ' + U.esc(U.fmtWhen(a.publishAt))) +
          (a.priority !== 'Normal' ? ' · ' + U.esc(a.priority) : '') +
          (needs ? ' · <strong>please confirm you have read it</strong>' : '') + '</span></span>' +
          '<span class="bb-go">View announcement' + UI.icon('chevronRight') + '</span></a>';
      }).join('') + '</div></div>';
  }

  global.ViewBulletin = { render: render, mount: mount };
  global.Bulletin = {
    form: form, unreadCount: unreadCount, overviewPreview: overviewPreview,
    visible: visible, wireCards: wireCards, card: card
  };
})(window);
