/* Archive — academic years, and looking back at them.

   Closing a year keeps it. Its activities, tasks, directives, letters, reports
   and announcements stay exactly where they are, readable, and read-only; they
   simply stop appearing on the working screens, which start the new year
   empty of last year's work. Choosing an archived year here shows its records
   everywhere, under a banner, until "Back to the current year".

   Only the President closes a year, opens one for corrections, or returns the
   latest one to current. The Term Report — a concise summary of a year, for
   turnover and the institution's records — is exported from here. */
(function (global) {
  'use strict';

  function canManage() { return !global.Auth || Auth.canManageYears(); }
  function canExport() { return !global.Auth || Auth.canExportTermReport(); }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];

  function countsLine(c) {
    var parts = [
      U.plural(c.events, 'activity', 'activities'),
      U.plural(c.tasks, 'task'),
      U.plural(c.directives, 'directive'),
      U.plural(c.letters, 'letter')
    ];
    if (c.announcements) parts.push(U.plural(c.announcements, 'announcement'));
    return parts.join(' · ');
  }

  function yearCard(y, latest) {
    var cur = y.id === 'current';
    var viewing = Workspace.viewYear() === y.id;
    var c = Store.yearCounts(y.id);
    var open = !cur && !Store.yearLocked(y.id);
    return '<article class="ay-card' + (cur ? ' is-current' : '') + (viewing ? ' is-viewing' : '') + '">' +
      '<div class="ay-top"><div>' +
        '<div class="ay-label">AY ' + U.esc(y.label) + '</div>' +
        '<div class="ay-sub">' + (cur
          ? 'Current · ' + (y.start ? U.fmtDateShort(y.start) + ' – ' + U.fmtDateShort(y.end) : '')
          : 'Archived' + (y.archivedAt ? ' ' + U.esc(U.fmtWhen(y.archivedAt)) : '') +
            (y.archivedBy ? ' by ' + U.esc(y.archivedBy) : '') +
            ' · ' + (y.start ? U.fmtDateShort(y.start) : 'the beginning') + ' – ' + U.fmtDateShort(y.end)) +
        '</div></div>' +
        '<span class="chip ' + (cur ? 'st-done' : open ? 'st-for-review' : 'chip-plain') + '">' +
          (cur ? 'Current' : open ? 'Open for corrections' : UI.icon('lock') + 'Read-only') + '</span>' +
      '</div>' +
      '<p class="small muted" style="margin:8px 0 0">' + U.esc(countsLine(c)) + '</p>' +
      (y.note ? '<p class="small" style="margin:6px 0 0">“' + U.esc(y.note) + '”</p>' : '') +
      (open ? '<p class="small" style="margin:6px 0 0">Open for corrections until <strong>' +
        U.esc(U.fmtTime(y.unlockedUntil)) + '</strong>' + (y.unlockedBy ? ', opened by ' + U.esc(y.unlockedBy) : '') + '.</p>' : '') +
      '<div class="ay-actions">' +
        (viewing ? '<span class="chip chip-plain">On screen now</span>'
          : '<button type="button" class="btn btn-sm' + (cur ? '' : ' btn-primary') + '" data-ay-view="' + y.id + '">' +
            (cur ? 'Back to the current year' : 'View its records') + '</button>') +
        (canExport() ? '<button type="button" class="btn btn-sm" data-report="' + y.id + '">' + UI.icon('download') +
          'Term report</button>' : '') +
        (canManage() && !cur
          ? (open ? '<button type="button" class="btn btn-sm" data-lock="' + y.id + '">' + UI.icon('lock') + 'Close it again</button>'
                  : '<button type="button" class="btn btn-sm btn-ghost" data-unlock="' + y.id + '">' + UI.icon('unlock') +
                    'Open for corrections</button>') +
            (latest ? '<button type="button" class="btn btn-sm btn-ghost" data-restore="' + y.id + '">Return to current</button>' : '')
          : '') +
      '</div></article>';
  }

  function render() {
    var years = Store.years();
    var cur = years[0];
    var html = '<div class="page-head"><div><h1>Archive</h1>' +
      '<div class="sub">Academic years, and the records each one leaves behind.</div></div></div>';

    html += '<div class="field ay-pick"><label for="ay-pick">Showing records from</label>' +
      '<select id="ay-pick">' + years.map(function (y) {
        return '<option value="' + y.id + '"' + (Workspace.viewYear() === y.id ? ' selected' : '') + '>AY ' +
          U.esc(y.label) + (y.id === 'current' ? ' (current)' : ' (archived)') + '</option>';
      }).join('') + '</select>' +
      '<div class="hint">Every screen follows this choice until you come back to the current year.</div></div>';

    html += Workspace.hint('archive', 'Closing a year deletes nothing. Its records stay readable here, and ' +
      'read-only, while the working screens start the new year clean.');

    if (canManage() && cur.overdue) {
      html += '<div class="term-banner is-urgent"><div class="tb-head">' + UI.icon('alert') +
        '<strong>AY ' + U.esc(cur.label) + ' ended on ' + U.esc(U.fmtDateShort(cur.end)) + '.</strong></div>' +
        '<div class="tb-body">Close it when the council is ready, so the new year’s screens start clean. ' +
        'Nothing is deleted.</div></div>';
    }

    html += '<div class="ay-list">' + years.map(function (y, i) {
      return yearCard(y, i === 1);
    }).join('') + '</div>';

    if (canManage()) {
      html += '<section class="section" style="margin-top:22px"><div class="section-head"><h2>The academic year</h2></div>' +
        '<div class="card"><div class="row" style="justify-content:space-between;gap:12px">' +
        '<div style="flex:1 1 260px;min-width:0"><div class="strong">Close AY ' + U.esc(cur.label) + '</div>' +
        '<div class="small muted">Its records become read-only and leave the working screens. The next year starts the day after.</div></div>' +
        '<button type="button" class="btn btn-primary" data-close-year>' + UI.icon('archive') + 'Close this year…</button>' +
        '</div><div class="divider"></div>' +
        '<div class="field" style="margin:0"><label for="ay-month">A new academic year begins in</label>' +
        '<select id="ay-month" style="max-width:240px">' + MONTHS.map(function (m, i) {
          return '<option value="' + (i + 1) + '"' + (Store.yearStartMonth() === i + 1 ? ' selected' : '') + '>' + m + '</option>';
        }).join('') + '</select>' +
        '<div class="hint">Used to name the years and to suggest where one ends.</div></div></div></section>';
    }

    // The record an older, deleting term close left behind, if there is one.
    if (global.TermUI) html += TermUI.archive();
    return html;
  }

  function mount(root) {
    if (global.TermUI) TermUI.mountBanner(root);
    var pick = root.querySelector('#ay-pick');
    if (pick) pick.addEventListener('change', function () { Workspace.setViewYear(pick.value); });
    U.els('[data-ay-view]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var y = b.getAttribute('data-ay-view');
        Workspace.setViewYear(y);
        UI.toast(y === 'current' ? 'Back to the current year.' : 'Showing AY ' + Store.yearInfo(y).label + '. Everything is read-only.');
        App.go('#/events');
      });
    });
    U.els('[data-report]', root).forEach(function (b) {
      b.addEventListener('click', function () { exportDialog(b.getAttribute('data-report')); });
    });
    U.els('[data-unlock]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var y = Store.yearInfo(b.getAttribute('data-unlock'));
        UI.confirm({
          title: 'Open AY ' + y.label + ' for corrections?',
          message: 'Its records can be changed for the next 30 minutes, by anybody who could change them before. ' +
            'Then it closes again by itself.',
          tone: 'primary', confirmLabel: 'Open for 30 minutes'
        }).then(function (ok) {
          if (!ok) return;
          try { Store.unlockYear(y.id, 30); UI.toast('Open for corrections until ' + U.fmtTime(Store.yearInfo(y.id).unlockedUntil) + '.'); }
          catch (err) { UI.toast(err.message, 'error'); }
        });
      });
    });
    U.els('[data-lock]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        try { Store.lockYear(b.getAttribute('data-lock')); UI.toast('Closed again. Its records are read-only.'); }
        catch (err) { UI.toast(err.message, 'error'); }
      });
    });
    U.els('[data-restore]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var y = Store.yearInfo(b.getAttribute('data-restore'));
        UI.confirm({
          title: 'Return AY ' + y.label + ' to current?',
          message: 'It stops being archived. Its records come back onto the working screens and can be changed again.',
          detail: 'Use this if a year was closed by mistake.',
          tone: 'primary', confirmLabel: 'Return it to current'
        }).then(function (ok) {
          if (!ok) return;
          try {
            Store.restoreYear(y.id);
            if (Workspace.viewYear() === y.id) Workspace.setViewYear('current');
            UI.toast('AY ' + y.label + ' is current again.');
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      });
    });
    var close = root.querySelector('[data-close-year]');
    if (close) close.addEventListener('click', closeYearDialog);
    var month = root.querySelector('#ay-month');
    if (month) month.addEventListener('change', function () {
      try { Store.setYearStartMonth(Number(month.value)); UI.toast('Saved.'); } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* Closing a year: when its last day was, and a look at what that makes
     read-only before anything happens. */
  function closeYearDialog() {
    var cur = Store.currentYear();
    var suggested = U.today() > cur.end ? cur.end : U.addDays(U.today(), -1);
    if (suggested < cur.start && Store.archivedYears().length) suggested = U.today();

    function preview(end) {
      var n = { events: 0, tasks: 0, letters: 0, later: 0 };
      Store.events({ kind: 'any' }).forEach(function (e) {
        if (Store.yearOf('event', e) !== 'current') return;
        var d = Store.anchorOf('event', e);
        if (d <= end) n.events++; else n.later++;
      });
      Store.tasks().forEach(function (t) {
        if (Store.yearOf('task', t) === 'current' && Store.anchorOf('task', t) <= end) n.tasks++;
      });
      Store.letters().forEach(function (l) {
        if (Store.yearOf('letter', l) === 'current' && Store.anchorOf('letter', l) <= end) n.letters++;
      });
      var open = Store.tasks({ pendingOnly: true }).filter(function (t) {
        return Store.yearOf('task', t) === 'current' && Store.anchorOf('task', t) <= end;
      }).length;
      return '<ul class="small" style="padding-left:18px;line-height:1.8;margin:6px 0 0">' +
        '<li><strong>' + U.plural(n.events, 'activity or directive', 'activities and directives') + '</strong>, ' +
          U.plural(n.tasks, 'task') + ' and ' + U.plural(n.letters, 'letter') + ' become read-only</li>' +
        (open ? '<li>' + U.plural(open, 'task is', 'tasks are') + ' still unfinished and will be kept as they are</li>' : '') +
        (n.later ? '<li>' + U.plural(n.later, 'activity', 'activities') + ' dated after that day stay in the new year</li>' : '') +
        '<li>Nothing is deleted, from this device or anywhere else</li></ul>';
    }

    UI.modal({
      title: 'Close AY ' + cur.label,
      body: '<div class="field"><label for="cy-end">Last day of the year</label>' +
        '<input type="date" id="cy-end" value="' + suggested + '" max="' + U.today() + '">' +
        '<div class="hint">Everything dated on or before this day becomes part of the archived year.</div></div>' +
        '<div id="cy-preview">' + preview(suggested) + '</div>' +
        '<div class="field" style="margin-top:12px"><label for="cy-note">A note for the record (optional)</label>' +
        '<input type="text" id="cy-note" maxlength="200" placeholder="e.g. Turnover to the 2027 administration"></div>' +
        '<p class="tiny muted" style="margin:0">The President can open it again for corrections, or return it to ' +
        'current if it was closed by mistake. Export the term report first if you need it on paper.</p>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-do>' + UI.icon('archive') + 'Close the year</button>',
      onMount: function (root, closeIt) {
        var end = root.querySelector('#cy-end');
        end.addEventListener('change', function () {
          if (end.value) root.querySelector('#cy-preview').innerHTML = preview(end.value);
        });
        root.querySelector('[data-do]').addEventListener('click', function () {
          try {
            var y = Store.archiveYear({ end: end.value, note: root.querySelector('#cy-note').value });
            closeIt();
            UI.toast('AY ' + y.label + ' is archived. AY ' + Store.currentYear().label + ' has begun.');
            if (global.Sync && Sync.able()) Sync.now().catch(function () { /* the pill says so */ });
          } catch (err) { UI.toast(err.message, 'error'); }
        });
      }
    });
  }

  /* ---------- the term report ---------- */

  function exportDialog(yid) {
    if (!canExport()) return UI.toast('The term report is exported by FCUSR Nationals.', 'error');
    var years = Store.years();
    var units = Store.units({ activeOnly: true, governed: true });
    yid = yid && Store.yearInfo(yid) ? yid : 'current';
    UI.modal({
      title: 'Export term report',
      body: '<p class="small muted" style="margin-top:0">A concise summary of a year for turnover, year-end ' +
        'reporting and the institution’s records: activities, tasks, directives, letters, reports and the ' +
        'units. It names no officer and compares nobody.</p>' +
        '<div class="field"><label for="tr-year">Academic year</label><select id="tr-year">' +
        years.map(function (y) {
          return '<option value="' + y.id + '"' + (y.id === yid ? ' selected' : '') + '>AY ' + U.esc(y.label) +
            (y.id === 'current' ? ' (current, so far)' : '') + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field"><label for="tr-unit">Covering</label><select id="tr-unit">' +
        '<option value="">The whole Republic</option>' + units.map(function (u) {
          return '<option value="' + U.esc(u.id) + '">' + U.esc(u.name) + '</option>';
        }).join('') + '</select>' +
        '<div class="hint">COMELEC, the Judiciary and the independent bodies keep their own records and are not included.</div></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn" data-csv>' + UI.icon('download') + 'Spreadsheet (CSV)</button>' +
        '<button type="button" class="btn btn-primary" data-pdf>' + UI.icon('pdf') + 'PDF</button>',
      onMount: function (root) {
        function run(kind, btn) {
          var y = root.querySelector('#tr-year').value;
          var u = root.querySelector('#tr-unit').value;
          btn.disabled = true;
          var label = btn.innerHTML;
          btn.textContent = 'Preparing…';
          Workspace.load('assets/js/term-report.js', function () { return !!global.TermReport; })
            .then(function () { return kind === 'pdf' ? TermReport.savePdf(y, u) : TermReport.saveCsv(y, u); })
            .then(function () { UI.toast('Term report downloaded.'); })
            .catch(function (err) { UI.toast('The term report could not be made: ' + err.message, 'error'); })
            .then(function () { btn.disabled = false; btn.innerHTML = label; });
        }
        var pdf = root.querySelector('[data-pdf]');
        var csv = root.querySelector('[data-csv]');
        pdf.addEventListener('click', function () { run('pdf', pdf); });
        csv.addEventListener('click', function () { run('csv', csv); });
      }
    });
  }

  global.ViewArchive = { render: render, mount: mount, exportDialog: exportDialog, closeYearDialog: closeYearDialog };
})(window);
