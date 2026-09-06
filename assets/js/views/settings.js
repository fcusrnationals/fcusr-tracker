/* Settings — directory, letterhead, backup.
   Everything except the directory and backup starts collapsed, so the page opens
   short instead of as one long wall. */
(function (global) {
  'use strict';

  var open = { access: true, term: false, units: false, offices: false, people: false, roles: false,
               letterhead: false, backup: true, data: false };

  function render() {
    var org = Store.org();
    var people = Store.people();
    var counts = Store.raw();

    var html = '<div class="page-head"><div><h1>Settings</h1>' +
      '<div class="sub">Directory, letterhead and backup.</div></div></div>';

    if (Store.dryRun().active) {
      var invented = Store.events().filter(function (e) { return e.sample; }).length;
      var real = Store.events().filter(function (e) { return !e.sample; }).length;
      html += '<div class="card" style="background:var(--st-on-hold-bg);' +
        'border-color:var(--st-on-hold-bd);margin-bottom:16px">' +
        '<div class="strong" style="margin-bottom:4px">The system is in a dry run.</div>' +
        '<div class="small">' + U.plural(invented, 'invented activity', 'invented activities') +
        ' and a rehearsal closing date are in place so the end of term can be walked through. ' +
        (real
          ? U.plural(real, 'activity', 'activities') + ' of your own ' +
            (real === 1 ? 'is' : 'are') + ' kept separately and will survive.'
          : 'Anything you create yourself is kept separately and will survive.') +
        '</div>' +
        '<button type="button" class="btn btn-sm" style="margin-top:12px" data-end-dryrun>' +
        'End the dry run</button></div>';
    }

    /* ---- access and enrolment ---- */
    html += section('access', 'Access and enrolment', 'Executives only',
      '<div style="padding:14px">' +
      '<p class="small muted">This is where access to the site is created. A person&rsquo;s ' +
      '<strong>position</strong> is only a label printed on reports &mdash; what they can actually ' +
      'reach is decided by the two settings below.</p>' +
      '<div class="row" style="margin:12px 0">' +
        '<button type="button" class="btn btn-primary" data-enrol>' + UI.icon('plus') + 'Enrol someone</button>' +
        '<button type="button" class="btn" data-roster>' + UI.icon('users') + 'Who can sign in</button>' +
        '<button type="button" class="btn" data-change-pw>Change my password</button>' +
        '<button type="button" class="btn" data-my-handover>' + UI.icon('check') + 'Before you hand over</button>' +
      '</div>' +
      '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
        '<div class="strong" style="margin-bottom:6px">The two levels</div>' +
        '<ul class="small" style="padding-left:18px;line-height:1.75;margin:0">' +
          '<li><strong>Officer</strong> &mdash; every event of the unit they belong to. An officer of ' +
          'the <strong>National</strong> government reaches the whole Republic: every unit&rsquo;s events, ' +
          'the Overview, Directives, and this page.</li>' +
          '<li><strong>Volunteer</strong> &mdash; only the events you enrol them into, and only while ' +
          'those events are running. When an event is completed their access to it ends by itself. ' +
          'Enrol them in another and it returns.</li>' +
        '</ul>' +
      '</div></div>');

    /* ---- the term ---- */
    var st = Store.termStatus();
    html += section('term', 'The term',
      st.closed ? 'Closed'
        : st.declared ? (st.passed ? 'Ended ' + U.fmtDateShort(st.endDate)
                                   : U.plural(st.daysLeft, 'day') + ' left')
        : 'No closing date',
      '<div style="padding:14px">' +
      (st.declared
        ? '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
          '<div class="strong">' +
          (st.passed ? 'The term ended on ' : 'The term closes on ') +
          U.esc(U.fmtDate(st.endDate)) + '.</div>' +
          '<div class="small muted">' +
          (st.allFiled
            ? 'Every unit has filed.'
            : U.plural(st.outstandingUnits.length, 'unit') + ' still to file: ' +
              U.esc(st.outstandingUnits.map(function (c) { return c.unit.name; }).join(', ')) + '.') +
          '</div></div>'
        : '<p class="small muted">Nothing is set. Declaring a closing date tells every unit ' +
          'when the administration ends and what it still owes, and reminds them until they ' +
          'have filed. It does not stop anyone working.</p>') +
      '<div class="row" style="margin-top:12px">' +
        '<button type="button" class="btn btn-primary" data-term>' +
          (st.declared ? 'Change the closing date' : 'Close the term') + '</button>' +
        '<button type="button" class="btn" data-term-export>' + UI.icon('pdf') +
          'Export all reports</button>' +
        (st.declared && st.passed
          ? '<button type="button" class="btn btn-danger" data-handover>Hand over</button>' : '') +
      '</div>' +
      '<p class="tiny muted" style="margin:10px 0 0">The export lists every unit&rsquo;s ' +
      'accomplishment reports as links, and names any unit that has not complied. Nothing is ' +
      'ever deleted without a backup and an explicit confirmation.</p>' +
      '</div>');

    /* ---- units ---- */
    var units = Store.units();
    html += section('units', 'Units', U.plural(units.length, 'unit'),
      '<div style="padding:14px 14px 4px">' +
      '<p class="small muted">The Republic&rsquo;s units: the National government, the provinces ' +
      '&mdash; the colleges and school levels &mdash; the Commission on Elections, and the Supreme Court. ' +
      'Every event is filed under one, and that is what decides who sees it.</p></div>' +
      '<div class="list">' + units.map(unitRow).join('') + '</div>' +
      '<div style="padding:12px"><button type="button" class="btn btn-block" data-add-unit>' +
      UI.icon('plus') + 'Add unit</button>' +
      '<p class="tiny muted" style="margin:10px 0 0">A unit holding events is set inactive rather than ' +
      'removed, so past work keeps the unit it was filed under.</p></div>');

    /* ---- offices letters pass through ---- */
    var offs = Store.offices();
    html += section('offices', 'Offices', U.plural(offs.length, 'office'),
      '<div style="padding:14px 14px 4px">' +
      '<p class="small muted">The desks a letter has to pass through. ' +
      '<strong>Usually takes</strong> is what turns the tracker into something useful: ' +
      'a letter sitting somewhere longer than that is flagged for chasing rather than ' +
      'quietly forgotten.</p></div>' +
      '<div class="list">' + offs.map(officeRow).join('') + '</div>' +
      '<div style="padding:12px"><button type="button" class="btn btn-block" data-add-office>' +
      UI.icon('plus') + 'Add office</button>' +
      '<p class="tiny muted" style="margin:10px 0 0">An office letters have already passed ' +
      'through is set inactive rather than removed, so old trails still read correctly.</p></div>');

    /* ---- directory ---- */
    html += section('people', 'People', U.plural(people.length, 'officer'),
      (people.length
        ? '<div class="list">' + people.map(personRow).join('') + '</div>'
        : UI.empty('No one yet', 'Add your officers so tasks can be assigned.')) +
      '<div style="padding:12px"><button type="button" class="btn btn-block" data-add-person>' +
      UI.icon('plus') + 'Add person</button>' +
      '<p class="tiny muted" style="margin:10px 0 0">People are deactivated, never deleted, so past tasks keep their assignee.</p></div>');

    /* ---- positions & committees ---- */
    html += section('roles', 'Positions and committees',
      Store.positions().length + ' · ' + Store.committees().length,
      '<div style="padding:14px">' +
      listEditor('positions', 'Positions', Store.positions()) +
      '<div class="divider"></div>' +
      listEditor('committees', 'Committees', Store.committees()) +
      '</div>');

    /* ---- letterhead ---- */
    html += section('letterhead', 'Report letterhead', org.emblem ? 'Custom emblem' : 'Council seal',
      '<div style="padding:14px">' +
      '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin-bottom:14px">' +
      '<div class="strong" style="margin-bottom:4px">What this changes, and what it does not</div>' +
      '<div class="small muted">The <strong>Accomplishment Report</strong> is printed on the ' +
      'official FCUSR letterhead. That letterhead is a fixed design and nothing on this page ' +
      'alters it &mdash; not the emblem, not the wording below.<br><br>' +
      'These settings apply only to the <strong>Event Task Report</strong> and the end-of-term ' +
      'summary, which are long bond landscape and so cannot carry the A4 letterhead. They build ' +
      'their own header from the seal and the three lines below.</div></div>' +
      '<div class="row" style="align-items:flex-start;margin-bottom:14px">' +
        '<div class="emblem" style="width:56px;height:56px;flex:0 0 56px">' +
          (org.emblem ? '<img src="' + U.esc(org.emblem) + '" alt="Current emblem">'
                      : '<svg viewBox="0 0 24 24"><path d="M12 3.5 21 20H3z" fill="#C9A227"/></svg>') +
        '</div>' +
        '<div style="flex:1;min-width:170px">' +
          '<div class="strong">FCU seal / FCUSR emblem</div>' +
          '<div class="small muted" style="margin-bottom:8px">Printed at the top of every report.</div>' +
          '<div class="row" style="gap:6px">' +
            '<label class="btn btn-sm">' + UI.icon('upload') + 'Upload' +
            '<input type="file" id="emblem-file" accept="image/png,image/jpeg" hidden></label>' +
            (org.emblem ? '<button type="button" class="btn btn-sm btn-ghost" data-clear-emblem>Remove</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="field"><label for="org-name">Organization</label>' +
      '<input type="text" id="org-name" maxlength="120" value="' + U.esc(org.name) + '"></div>' +
      '<div class="field"><label for="org-address">Address</label>' +
      '<input type="text" id="org-address" maxlength="140" value="' + U.esc(org.address) + '"></div>' +
      '<div class="field"><label for="org-email">Email</label>' +
      '<input type="text" id="org-email" maxlength="120" value="' + U.esc(org.email) + '"></div>' +
      '<button type="button" class="btn btn-primary" data-save-org>' + UI.icon('check') + 'Save letterhead</button>' +

      /* Changing this changes every accomplishment report the council files, so
         the constraint is spelled out and then actually checked on upload —
         a warning nobody can act on is not a safeguard. */
      '<div class="divider"></div>' +
      '<div class="field-label" style="margin-bottom:6px">Accomplishment report letterhead</div>' +
      (org.letterhead
        ? '<div class="card" style="background:var(--st-done-bg);border-color:var(--st-done-bd);margin-bottom:12px">' +
          '<div class="small strong">Using a replacement letterhead.</div>' +
          '<div class="small muted">Uploaded' +
          (org.letterheadBy ? ' by ' + U.esc(org.letterheadBy) : '') +
          (org.letterheadAt ? ' on ' + U.esc(U.fmtDate(org.letterheadAt.slice(0, 10))) : '') +
          '.</div></div>'
        : '<p class="small muted" style="margin:0 0 12px">Using the letterhead that ships with the app.</p>') +

      '<div class="card" style="background:var(--st-on-hold-bg);border-color:var(--st-on-hold-bd);margin-bottom:12px">' +
      '<div class="strong" style="margin-bottom:6px">A new letterhead must keep the same measurements.</div>' +
      '<div class="small" style="line-height:1.7">The report is written into a fixed area of the page. ' +
      'Artwork that strays into it will sit underneath the text, and every report the council files ' +
      'afterwards will carry the fault.' +
      '<ul style="padding-left:18px;margin:8px 0 0">' +
      '<li><strong>A4 portrait</strong>, 210 &times; 297 mm. Ideally 1240 &times; 1754 pixels.</li>' +
      '<li>Leave the middle of the page <strong>empty</strong>: the top 58 mm and bottom 52 mm are ' +
      'yours, and the 22 mm down each side.</li>' +
      '<li>Keep the writable area pale. The text is dark and thin.</li>' +
      '<li>PNG or JPG, under 3 MB.</li></ul></div></div>' +

      '<div class="row" style="gap:6px">' +
      '<label class="btn">' + UI.icon('upload') + 'Upload a letterhead' +
      '<input type="file" id="letterhead-file" accept="image/png,image/jpeg" hidden></label>' +
      (org.letterhead
        ? '<button type="button" class="btn btn-ghost" data-clear-letterhead>Back to the default</button>'
        : '') +
      '</div>' +
      '</div>');

    /* ---- backup ---- */
    html += section('backup', 'Backup', 'Important',
      '<div style="padding:14px">' +
      '<p class="small muted">Everything lives in this browser only. A backup file is the only way to move the tracker to another device, or to get it back if the browser is cleared. Download one after every meeting.</p>' +
      '<div class="row" style="margin-top:12px">' +
        '<button type="button" class="btn btn-primary" data-backup>' + UI.icon('download') + 'Download backup</button>' +
        '<label class="btn">' + UI.icon('upload') + 'Restore backup' +
        '<input type="file" id="restore-file" accept="application/json,.json" hidden></label>' +
      '</div>' +
      '<p class="tiny muted" style="margin-top:10px">Holding ' +
        U.plural(counts.people.length, 'person', 'people') + ', ' +
        U.plural(counts.events.length, 'event') + ' and ' +
        U.plural(counts.tasks.length, 'task') + '.</p></div>');

    /* ---- data ---- */
    html += section('data', 'Data', '',
      '<div style="padding:14px" class="stack">' +
      (Store.hasSampleData()
        ? '<button type="button" class="btn btn-block" data-clear-sample>' + UI.icon('trash') + 'Clear sample data</button>'
        : '') +
      '<button type="button" class="btn btn-danger btn-block" data-reset>' + UI.icon('trash') + 'Delete all data</button>' +
      '</div>');

    return html;
  }

  function section(key, title, meta, body) {
    var collapsed = !open[key];
    return '<div class="group" data-collapsed="' + collapsed + '" data-group="' + key + '" style="margin-bottom:10px">' +
      '<button type="button" class="group-head" data-toggle="' + key + '" aria-expanded="' + !collapsed + '">' +
        UI.icon('chevronDown', 'caret') +
        '<span class="group-title">' + U.esc(title) + '</span>' +
        (meta ? '<span class="group-meta">' + U.esc(meta) + '</span>' : '') +
      '</button>' +
      '<div class="group-body">' + body + '</div></div>';
  }

  function unitRow(u) {
    var s = Store.unitStats(u.id);
    var held = Store.unitEventCount(u.id);
    return '<div class="task">' +
      '<button type="button" class="task-main" data-edit-unit="' + U.esc(u.id) + '">' +
        '<span class="task-title">' +
          (u.code ? '<span class="unit-code">' + U.esc(u.code) + '</span>' : '') + U.esc(u.name) +
          (u.active === false ? ' <span class="chip st-not-started">Inactive</span>' : '') + '</span>' +
        '<span class="task-meta">' + U.esc(Store.trackerName(u)) +
          '<span class="sep">·</span>' + U.esc(Store.unitKindLabel(u.kind)) +
          (Store.isIndependent(u) ? '<span class="sep">·</span>sealed' : '') +
          '<span class="sep">·</span>' + U.plural(held, 'event') +
          (s.overdue ? '<span class="sep">·</span><span class="late">' + s.overdue + ' overdue</span>' : '') +
        '</span></button>' +
      '<span class="task-right">' +
        (u.kind === 'national' ? '' :
          '<button type="button" class="btn btn-sm" data-toggle-unit="' + U.esc(u.id) + '">' +
          (u.active === false ? 'Reactivate' : 'Deactivate') + '</button>') +
      '</span></div>';
  }

  function officeRow(o) {
    var held = Store.officeLetterCount(o.id);
    return '<div class="task">' +
      '<button type="button" class="task-main" data-edit-office="' + U.esc(o.id) + '">' +
        '<span class="task-title">' +
          (o.code ? '<span class="unit-code">' + U.esc(o.code) + '</span>' : '') + U.esc(o.name) +
          (o.active === false ? ' <span class="chip st-not-started">Inactive</span>' : '') + '</span>' +
        '<span class="task-meta">Usually ' + U.plural(o.turnaroundDays, 'day') +
          '<span class="sep">·</span>' + U.plural(held, 'letter') + '</span></button>' +
      '<span class="task-right"><button type="button" class="btn btn-sm" data-toggle-office="' +
        U.esc(o.id) + '">' + (o.active === false ? 'Reactivate' : 'Deactivate') + '</button></span>' +
    '</div>';
  }

  function personRow(p) {
    var s = Store.stats(Store.tasks({ assigneeId: p.id }));
    return '<div class="task">' +
      '<button type="button" class="task-main" data-edit-person="' + U.esc(p.id) + '">' +
        '<span class="task-title">' + U.esc(p.name) +
          (p.active === false ? ' <span class="chip st-not-started">Inactive</span>' : '') + '</span>' +
        '<span class="task-meta">' + U.esc(p.position || 'No position') +
          '<span class="sep">·</span>' + s.done + ' of ' + s.total + ' done' +
          (s.overdue ? '<span class="sep">·</span><span class="late">' + s.overdue + ' overdue</span>' : '') +
        '</span></button>' +
      '<span class="task-right"><button type="button" class="btn btn-sm" data-toggle-active="' + U.esc(p.id) + '">' +
        (p.active === false ? 'Reactivate' : 'Deactivate') + '</button></span>' +
    '</div>';
  }

  function listEditor(kind, label, values) {
    return '<div class="field-label">' + U.esc(label) + '</div>' +
      '<div class="row" style="gap:6px;margin-bottom:10px">' +
      (values.length ? values.map(function (v) {
        return '<span class="chip chip-plain">' + U.esc(v) +
          '<button type="button" class="icon-btn" style="width:20px;height:20px" ' +
          'data-remove-list="' + kind + '" data-value="' + U.esc(v) + '" aria-label="Remove ' + U.esc(v) + '">' +
          UI.icon('close') + '</button></span>';
      }).join('') : '<span class="small muted">None yet.</span>') +
      '</div>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap">' +
      '<input type="text" data-list-input="' + kind + '" maxlength="60" placeholder="Add…" style="flex:1">' +
      '<button type="button" class="btn btn-sm" data-add-list="' + kind + '">Add</button></div>';
  }

  function mount(root) {
    U.els('[data-toggle]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-toggle');
        open[key] = !open[key];
        var g = root.querySelector('[data-group="' + key + '"]');
        g.setAttribute('data-collapsed', String(!open[key]));
        b.setAttribute('aria-expanded', String(open[key]));
      });
    });

    var enrol = root.querySelector('[data-enrol]');
    if (enrol) enrol.addEventListener('click', function () { Forms.enrolForm(); });

    var roster = root.querySelector('[data-roster]');
    if (roster) roster.addEventListener('click', function () { Forms.rosterList(); });

    var cpw = root.querySelector('[data-change-pw]');
    if (cpw) cpw.addEventListener('click', function () { Auth.changePassword(); });

    var endDry = root.querySelector('[data-end-dryrun]');
    if (endDry && global.TermUI) endDry.addEventListener('click', TermUI.endDryRunForm);

    var mh = root.querySelector('[data-my-handover]');
    if (mh && global.TermUI) mh.addEventListener('click', TermUI.myHandoverForm);

    var termBtn = root.querySelector('[data-term]');
    if (termBtn) termBtn.addEventListener('click', function () { TermUI.declareForm(); });

    var handover = root.querySelector('[data-handover]');
    if (handover) handover.addEventListener('click', function () { TermUI.handoverForm(); });

    var termExport = root.querySelector('[data-term-export]');
    if (termExport) termExport.addEventListener('click', function () {
      termExport.disabled = true;
      TermPDF.save().then(function (out) {
        termExport.disabled = false;
        UI.toast(out.outstanding
          ? 'Exported. ' + U.plural(out.outstanding, 'unit') + ' named as outstanding.'
          : 'Exported. Every unit has filed.');
      }).catch(function (err) {
        termExport.disabled = false;
        UI.toast(err.message || 'That could not be exported.', 'error');
      });
    });

    U.els('[data-add-unit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.unitForm(null); });
    });
    U.els('[data-edit-unit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.unitForm(b.getAttribute('data-edit-unit')); });
    });
    U.els('[data-toggle-unit]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var u = Store.unit(b.getAttribute('data-toggle-unit'));
        if (!u) return;
        var next = u.active === false;
        Store.setUnitActive(u.id, next);
        UI.toast(next ? u.name + ' reactivated.' : u.name + ' set inactive.');
      });
    });

    U.els('[data-add-office]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.officeForm(null); });
    });
    U.els('[data-edit-office]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.officeForm(b.getAttribute('data-edit-office')); });
    });
    U.els('[data-toggle-office]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var o = Store.office(b.getAttribute('data-toggle-office'));
        if (!o) return;
        var next = o.active === false;
        Store.setOfficeActive(o.id, next);
        UI.toast(next ? o.name + ' reactivated.' : o.name + ' set inactive.');
      });
    });

    U.els('[data-add-person]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.personForm(null); });
    });
    U.els('[data-edit-person]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.personForm(b.getAttribute('data-edit-person')); });
    });
    U.els('[data-toggle-active]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var p = Store.person(b.getAttribute('data-toggle-active'));
        if (!p) return;
        var next = p.active === false;
        Store.setPersonActive(p.id, next);
        UI.toast(next ? p.name + ' reactivated.' : p.name + ' deactivated.');
      });
    });

    U.els('[data-add-list]', root).forEach(function (b) {
      var kind = b.getAttribute('data-add-list');
      var input = root.querySelector('[data-list-input="' + kind + '"]');
      function add() {
        var v = input.value.trim();
        if (!v) return;
        if (Store.addListValue(kind, v)) UI.toast('Added “' + v + '”.');
        else UI.toast('“' + v + '” is already there.', 'error');
        input.value = '';
      }
      b.addEventListener('click', add);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    });

    U.els('[data-remove-list]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        Store.removeListValue(b.getAttribute('data-remove-list'), b.getAttribute('data-value'));
      });
    });

    var emblemFile = root.querySelector('#emblem-file');
    if (emblemFile) emblemFile.addEventListener('change', function () {
      var f = emblemFile.files && emblemFile.files[0];
      if (!f) return;
      if (f.size > 900 * 1024) return UI.toast('Too large — use an image under 900 KB.', 'error');
      var reader = new FileReader();
      reader.onload = function () { Store.updateOrg({ emblem: String(reader.result) }); UI.toast('Emblem saved.'); };
      reader.onerror = function () { UI.toast('Could not read that image.', 'error'); };
      reader.readAsDataURL(f);
    });

    var lhFile = root.querySelector('#letterhead-file');
    if (lhFile) lhFile.addEventListener('change', function () {
      var f = lhFile.files && lhFile.files[0];
      lhFile.value = '';
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) {
        return UI.toast('Too large — keep the letterhead under 3 MB.', 'error');
      }
      var reader = new FileReader();
      reader.onerror = function () { UI.toast('That image could not be read.', 'error'); };
      reader.onload = function () {
        var src = String(reader.result);
        // The proportions are checked, not just described. A landscape or
        // square image would stretch across the sheet and ruin every report.
        var img = new Image();
        img.onerror = function () { UI.toast('That image could not be read.', 'error'); };
        img.onload = function () {
          var ratio = img.width / img.height;
          var a4 = 210 / 297;                       // 0.707
          var off = Math.abs(ratio - a4) / a4;
          if (off > 0.02) {
            return UI.confirm({
              title: 'That is not A4 portrait',
              message: 'The image is ' + img.width + ' × ' + img.height + ' pixels, which is ' +
                (ratio > a4 ? 'wider' : 'taller') + ' than A4. It will be stretched to fit the ' +
                'page, so the artwork will look distorted on every report.',
              detail: 'A4 portrait is 210 × 297 mm — 1240 × 1754 pixels is the right size.',
              confirmLabel: 'Use it anyway'
            }).then(function (ok) {
              if (ok) applyLetterhead(src);
            });
          }
          applyLetterhead(src);
        };
        img.src = src;
      };
      reader.readAsDataURL(f);
    });

    function applyLetterhead(src) {
      var who = (global.Auth && Auth.current() && Auth.current().name) || '';
      Store.updateOrg({ letterhead: src, letterheadBy: who });
      UI.toast('Letterhead replaced. Export one report and check it before filing anything.');
    }

    var clearLh = root.querySelector('[data-clear-letterhead]');
    if (clearLh) clearLh.addEventListener('click', function () {
      UI.confirm({
        title: 'Go back to the default letterhead?',
        message: 'Reports will print on the letterhead that ships with the app.',
        confirmLabel: 'Use the default'
      }).then(function (ok) {
        if (!ok) return;
        Store.updateOrg({ letterhead: '', letterheadBy: '' });
        UI.toast('Back to the default letterhead.');
      });
    });

    var clearEmblem = root.querySelector('[data-clear-emblem]');
    if (clearEmblem) clearEmblem.addEventListener('click', function () {
      Store.updateOrg({ emblem: '' });
      UI.toast('Emblem removed.');
    });

    var saveOrg = root.querySelector('[data-save-org]');
    if (saveOrg) saveOrg.addEventListener('click', function () {
      Store.updateOrg({
        name: root.querySelector('#org-name').value.trim(),
        address: root.querySelector('#org-address').value.trim(),
        email: root.querySelector('#org-email').value.trim()
      });
      UI.toast('Letterhead saved.');
    });

    var backup = root.querySelector('[data-backup]');
    if (backup) backup.addEventListener('click', function () {
      UI.downloadFile('FCUSR-TaskTracker-Backup-' + U.today() + '.json', Store.toJSON(), 'application/json');
      UI.toast('Backup downloaded.');
    });

    var restore = root.querySelector('#restore-file');
    if (restore) restore.addEventListener('change', function () {
      var f = restore.files && restore.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        UI.confirm({
          title: 'Restore from this backup?',
          message: 'Everything on this device will be replaced by the contents of ' + f.name + '.',
          detail: 'Download a backup of the current data first if you are unsure.',
          confirmLabel: 'Restore backup'
        }).then(function (ok) {
          restore.value = '';
          if (!ok) return;
          try {
            var n = Store.fromJSON(String(reader.result));
            UI.toast('Restored ' + n.events + ' events and ' + n.tasks + ' tasks.');
          } catch (err) {
            UI.toast(err.message || 'That file could not be read.', 'error');
          }
        });
      };
      reader.readAsText(f);
    });

    var clearSample = root.querySelector('[data-clear-sample]');
    if (clearSample) clearSample.addEventListener('click', function () {
      UI.confirm({
        title: 'Clear the sample data?',
        message: 'The example events, their tasks and the sample officers will be removed.',
        detail: 'Anything you created yourself stays.',
        confirmLabel: 'Clear sample data'
      }).then(function (ok) {
        if (!ok) return;
        Store.clearSampleData();
        UI.toast('Sample data cleared.');
      });
    });

    var reset = root.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      UI.confirm({
        title: 'Delete all data?',
        message: 'Every person, event and task on this device will be removed.',
        detail: 'This cannot be undone. Download a backup first if there is any chance you will want it back.',
        confirmLabel: 'Delete everything'
      }).then(function (ok) {
        if (!ok) return;
        Store.resetAll();
        Store.setLastPerson('');
        UI.toast('All data deleted.');
      });
    });
  }

  global.ViewSettings = { render: render, mount: mount };
})(window);
