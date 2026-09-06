/* Closing the term.

   The National executives declare the date the administration ends. From then on
   every officer is told the date and, more usefully, what their own unit still
   owes — because "the term ends in March" is not an instruction and "you have
   four activities still to file" is.

   Nothing here locks anything. Work carries on before the date and after it. The
   only thing the date changes is that the wipe becomes possible, and even then a
   national executive has to press it, after a backup, and only once every unit
   has filed. */
(function (global) {
  'use strict';

  var REMINDED_KEY = 'fcusr.tracker.termReminded';

  function myUnitId() {
    return (global.Auth && Auth.signedIn()) ? Auth.myUnitId() : Store.nationalUnitId();
  }

  /* ---------- the standing banner ---------- */

  /* Shown at the top of the Overview for as long as a term is declared. It says
     the date, and then the only part that is actionable: what this unit owes. */
  /* The closing date, folded into the photograph at the top of the Overview
     rather than stacked above it as one more coloured box. It is a standing
     fact about the year, not an alert — so it belongs with the date and the
     headline, and it earns its place by being one line with a way in. */
  function heroStrip() {
    var st = Store.termStatus();
    if (!st.declared || st.closed) return '';

    var mine = Store.unitCompliance(myUnitId());
    var urgent = st.passed || st.daysLeft <= 14 || !mine.complies;

    /* Two lines, because one could not say the thing that matters. "Term ends
       Oct 6" reads as a diary note; what an officer needs to know is that
       everything they hold has to be finished and filed BEFORE that day, and
       how much of it is still outstanding.

       The whole band is the way in. A white button beside the words pushed the
       band onto three rows on a phone and turned the foot of the photograph
       into a poster; a row you press is smaller, and there is nothing to miss. */
    /* A name for the phase, above the instruction. "Finish and file everything
       before Oct 6" says what to do without saying what is going on; an officer
       who has been told the term is closing recognises the band on sight and
       reads the date underneath as the deadline it is. */
    var kicker = st.passed ? 'The term has ended' : 'End-of-term phase';
    var head, sub;

    if (st.passed) {
      head = 'The term ended on ' + U.fmtDateShort(st.endDate);
      sub = mine.complies
        ? 'Everything here is filed — nothing further is owed'
        : U.plural(mine.outstanding.length, 'activity', 'activities') +
          ' still to finish and file';
    } else {
      head = 'Finish and file everything before ' + U.fmtDateShort(st.endDate);
      sub = (st.daysLeft === 0 ? 'That is today' : U.plural(st.daysLeft, 'day') + ' left') +
        (mine.complies
          ? ' · everything here is filed'
          : ' · ' + U.plural(mine.outstanding.length, 'activity', 'activities') + ' still owed');
    }

    return '<button type="button" class="ph-term' + (urgent ? ' is-urgent' : '') +
      '" data-my-handover>' +
      UI.icon('alert', 'pht-mark') +
      '<span class="pht-text">' +
        '<span class="pht-kicker">' + U.esc(kicker) + '</span>' +
        '<span class="pht-head">' + U.esc(head) + '</span>' +
        '<span class="pht-sub">' + U.esc(sub) + '</span>' +
      '</span>' +
      UI.icon('chevronRight', 'pht-chev') +
      '</button>';
  }

  function banner() {
    var st = Store.termStatus();
    if (!st.declared || st.closed) return '';

    var mine = Store.unitCompliance(myUnitId());
    var national = global.Auth ? Auth.isNational() : true;

    var when;
    if (st.passed) {
      when = 'The term ended on <strong>' + U.esc(U.fmtDate(st.endDate)) + '</strong>.';
    } else if (st.daysLeft === 0) {
      when = 'The term ends <strong>today</strong>.';
    } else {
      when = 'The term ends on <strong>' + U.esc(U.fmtDate(st.endDate)) + '</strong> — ' +
        U.plural(st.daysLeft, 'day') + ' left.';
    }

    var tone = st.passed || st.daysLeft <= 14 ? ' is-urgent' : '';
    var html = '<div class="term-banner' + tone + '">' +
      '<div class="tb-head">' + UI.icon('alert') + '<span>' + when + '</span></div>';

    if (mine.complies) {
      html += '<div class="tb-body ok">Everything in this unit is finished and filed. ' +
        'Nothing further is owed.</div>';
    } else {
      html += '<div class="tb-body">' +
        U.plural(mine.outstanding.length, 'activity', 'activities') +
        ' still to finish and file before the term can close:' +
        '<ul class="tb-list">' +
        mine.outstanding.slice(0, 6).map(function (e) {
          var r = Store.report(e.id);
          var finished = e.status === 'Completed' || e.status === 'Archived';
          return '<li><button type="button" class="linkish" data-term-open="' + U.esc(e.id) + '">' +
            U.esc(e.title) + '</button> — ' +
            (!finished ? 'not marked finished' : 'no accomplishment report link yet') + '</li>';
        }).join('') +
        (mine.outstanding.length > 6
          ? '<li class="muted">and ' + (mine.outstanding.length - 6) + ' more</li>' : '') +
        '</ul></div>';
    }

    if (national && st.outstandingUnits.length) {
      html += '<div class="tb-body muted">Across the Republic, ' +
        U.plural(st.outstandingUnits.length, 'unit') + ' ' +
        (st.outstandingUnits.length === 1 ? 'has' : 'have') + ' not finished filing. ' +
        'Nothing can be deleted until they do.</div>';
    }

    if (st.note) html += '<div class="tb-note">' + U.esc(st.note) + '</div>';

    // One place that answers "what is left for me", rather than four screens.
    html += '<div class="tb-actions">' +
      '<button type="button" class="btn btn-sm" data-my-handover>' +
      'Before you hand over</button></div>';

    return html + '</div>';
  }

  /* ---------- the reminder ----------
     Once a visit, not once a minute. A notice that appears constantly stops
     being read; one that appears when you arrive, and a banner that never
     leaves, is what actually gets acted on. */
  var DRYRUN_KEY = 'fcusr.tracker.dryrun.seen';

  /* Said every time somebody signs in, for as long as the rehearsal lasts.

     The point is not decoration. Somebody looking at this site is about to see
     nine activities, sixteen officers and a term closing next month, and almost
     none of it is real. Being told once, plainly, at the door is the difference
     between a useful rehearsal and a council that thinks it has lost its data. */
  function dryRunNotice() {
    if (!Store.dryRun().active) return false;

    var seen = '';
    try { seen = global.sessionStorage.getItem(DRYRUN_KEY) || ''; } catch (e) { seen = ''; }
    if (seen === Store.dryRun().startedAt) return false;
    try { global.sessionStorage.setItem(DRYRUN_KEY, Store.dryRun().startedAt); } catch (e) { /* not vital */ }

    var st = Store.termStatus();
    var national = !global.Auth || !Auth.signedIn() || Auth.isNational();

    UI.modal({
      title: 'This is a dry run',
      dismissible: false,
      body:
        '<div class="card" style="background:var(--st-on-hold-bg);border-color:var(--st-on-hold-bd)">' +
        '<div class="strong" style="margin-bottom:4px">Most of what you are about to see is invented.</div>' +
        '<div class="small">The activities, the officers, the letters and the closing date were all ' +
        'put here to rehearse the end of term. They are not council records.</div></div>' +

        '<p class="small" style="margin-top:14px"><strong>What is real:</strong> anything you create ' +
        'yourself. Your own activities, tasks, letters and reports are kept apart from the invented ' +
        'ones and will survive when the rehearsal ends.</p>' +

        (st.declared
          ? '<p class="small">The term is set to close on <strong>' +
            U.esc(U.fmtDate(st.endDate)) + '</strong> so the closing can be walked through. ' +
            'That date is part of the rehearsal too.</p>'
          : '') +

        (national
          ? '<p class="small muted">When the council is ready to use this for real, a national ' +
            'executive ends the dry run from <strong>Settings</strong>. Everything invented is ' +
            'removed in one go and everything real is kept.</p>'
          : '<p class="small muted">A national executive ends the rehearsal when the council is ' +
            'ready to use this for real.</p>'),
      footer: '<button type="button" class="btn btn-primary" data-close>I understand</button>',
      // One dialog at a time, but not one instead of the other: what the term
      // still owes is the reason the rehearsal exists.
      onClose: function () { global.setTimeout(maybeRemind, 220); }
    });
    return true;
  }

  /* The off switch, for the National executives. */
  function endDryRunForm() {
    var counts = {
      sampleEvents: Store.events().filter(function (e) { return e.sample; }).length,
      realEvents: Store.events().filter(function (e) { return !e.sample; }).length,
      realLetters: Store.letters().filter(function (l) { return !l.sample; }).length
    };

    UI.confirm({
      title: 'End the dry run?',
      message: U.plural(counts.sampleEvents, 'invented activity', 'invented activities') +
        ' and everything that came with them — the invented officers, letters and the rehearsal ' +
        'closing date — will be removed.',
      detail: counts.realEvents || counts.realLetters
        ? 'Your own work is kept: ' + U.plural(counts.realEvents, 'activity', 'activities') +
          ' and ' + U.plural(counts.realLetters, 'letter') + ' that you created stay exactly as ' +
          'they are. This cannot be undone, so download a backup first if you are unsure.'
        : 'You have not created anything of your own yet, so this leaves the tracker empty and ' +
          'ready for real work. This cannot be undone.',
      confirmLabel: 'End the dry run'
    }).then(function (ok) {
      if (!ok) return;
      var left = Store.endDryRun();
      UI.toast(left.events
        ? 'Dry run ended. ' + U.plural(left.events, 'activity', 'activities') + ' kept.'
        : 'Dry run ended. The tracker is ready for real work.');
    });
  }

  /* Said when the app opens, once a day for as long as a term is declared.

     It used to be a notice about a date with a button on it, and the checklist
     it pointed at only ever opened if somebody pressed that button. If a unit
     is still holding work, the checklist IS the message — so it opens itself,
     and the notice is kept only for a unit that has nothing left to do. */
  function maybeRemind() {
    var st = Store.termStatus();
    if (!st.declared || st.closed) return;

    var t = Store.term();
    var seen = '';
    try { seen = global.sessionStorage.getItem(REMINDED_KEY) || ''; } catch (e) { seen = ''; }
    /* Re-declaring the term or moving the date makes it worth saying again, and
       so does a new day: a deadline six weeks out and a deadline on Friday are
       not the same message, and being told once in September does not carry to
       the week it matters. */
    var stamp = t.declaredAt + '|' + t.endDate + '|' + U.today();
    if (seen === stamp) return;
    try { global.sessionStorage.setItem(REMINDED_KEY, stamp); } catch (e) { /* not vital */ }

    var mine = Store.unitCompliance(myUnitId());
    var unitName = Store.unitName(myUnitId());

    if (!mine.complies) return myHandoverForm();

    UI.modal({
      title: st.passed ? 'The term has ended' : 'The term closes ' + U.fmtDate(st.endDate),
      body:
        '<p class="small">' +
        (st.passed
          ? 'The administration closed on <strong>' + U.esc(U.fmtDate(st.endDate)) + '</strong>.'
          : 'This administration ends on <strong>' + U.esc(U.fmtDate(st.endDate)) + '</strong> — ' +
            (st.daysLeft === 0 ? '<strong>today</strong>' : U.plural(st.daysLeft, 'day') + ' from today') +
            '. Every activity must be marked finished and its accomplishment report filed ' +
            '<strong>before that day</strong>, not after it.') +
        '</p>' +
        (t.note ? '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
          '<div class="small">' + U.esc(t.note) + '</div></div>' : '') +
        '<div class="card" style="margin-top:12px;background:var(--st-done-bg);border-color:var(--st-done-bd)">' +
        '<div class="strong">' + U.esc(unitName) + ' is up to date.</div>' +
        '<div class="small muted">Every activity is finished and filed. Nothing is owed.</div></div>' +
        '<p class="small muted" style="margin-top:12px">Work is not stopped by this date — ' +
        'you can carry on afterwards. But nothing is deleted, and the next administration ' +
        'cannot be set up, until every unit has filed.</p>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn btn-primary" data-review data-close>Review what I hold</button>',
      onMount: function (root) {
        var r = root.querySelector('[data-review]');
        if (r) r.addEventListener('click', function () { global.setTimeout(myHandoverForm, 220); });
      }
    });
  }

  function mountBanner(root) {
    U.els('[data-term-open]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        App.go('#/events/' + b.getAttribute('data-term-open'));
      });
    });
    U.els('[data-my-handover]', root).forEach(function (b) {
      b.addEventListener('click', function () { myHandoverForm(); });
    });
  }

  /* ---------- declaring it ---------- */

  function declareForm() {
    var t = Store.term();
    var st = Store.termStatus();

    UI.modal({
      title: st.declared ? 'The closing of the term' : 'Close the term',
      wide: true,
      body:
        '<p class="small">Set the date this administration ends. Every unit — the provinces, ' +
        'the Commission, the Judiciary and the independent bodies — is told the date and what ' +
        'it still owes, and is reminded until it has filed.</p>' +
        '<div class="field"><label for="t-date">Closing date <span class="req">*</span></label>' +
        '<input type="date" id="t-date" value="' + U.esc(t.endDate) + '"></div>' +
        '<div class="field"><label for="t-note">Anything to add</label>' +
        '<textarea id="t-note" maxlength="600" placeholder="e.g. Turnover ceremony follows on the 30th.">' +
        U.esc(t.note) + '</textarea>' +
        '<div class="hint">Shown with every reminder. Optional.</div></div>' +
        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
        '<div class="small strong" style="margin-bottom:4px">What this does not do</div>' +
        '<div class="small muted">It does not stop anyone working, before the date or after it. ' +
        'It does not delete anything. When the date has passed <em>and</em> every unit has filed, ' +
        'the option to hand over to the next administration appears here — and even then it has to ' +
        'be pressed, after a backup.</div></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        (st.declared ? '<button type="button" class="btn btn-danger" data-withdraw>Withdraw</button>' : '') +
        '<button type="button" class="btn btn-primary" data-save>' +
        (st.declared ? 'Update' : 'Declare it') + '</button>',
      onMount: function (root, close) {
        root.querySelector('[data-save]').addEventListener('click', function () {
          var d = root.querySelector('#t-date').value;
          if (!d) return UI.toast('Pick the date the term ends.', 'error');
          if (d < U.today()) return UI.toast('That date has already gone by.', 'error');
          try {
            Store.declareTerm(d, {
              note: root.querySelector('#t-note').value,
              by: (global.Auth && Auth.current()) ? Auth.current().name : ''
            });
            try { global.sessionStorage.removeItem(REMINDED_KEY); } catch (e) { /* fine */ }
            close();
            UI.toast('The term closes on ' + U.fmtDate(d) + '. Every unit has been told.');
          } catch (err) { UI.toast(err.message, 'error'); }
        });

        var w = root.querySelector('[data-withdraw]');
        if (w) w.addEventListener('click', function () {
          UI.confirm({
            title: 'Withdraw the closing date?',
            message: 'The reminders stop and no date is set.',
            detail: 'Nothing that has been filed is lost.',
            confirmLabel: 'Withdraw it'
          }).then(function (ok) {
            if (!ok) return;
            Store.withdrawTerm();
            close();
            UI.toast('The closing date has been withdrawn.');
          });
        });
      }
    });
  }

  /* ---------- the archive ----------
     Every filed report, by unit, as a link. This is what survives the handover,
     so it is also what the Overview shows all year: the running record of what
     the administration has actually finished. */
  function archive() {
    var national = !global.Auth || !Auth.signedIn() || Auth.isNational();
    var t = Store.term();
    var mine = myUnitId();
    var rows;

    if (t.closedAt && t.archive.length) {
      /* The term is closed and the working data is gone. The record kept at the
         moment of closing is what is read from here on — titles and links, which
         is all a finished administration needs to leave behind. */
      rows = t.archive.filter(function (a) {
        return national || a.unitId === mine;
      }).map(function (a) {
        return {
          unit: { id: a.unitId, name: a.unitName, code: a.unitCode },
          events: a.events.filter(function (e) { return e.driveLink; })
        };
      }).filter(function (r) { return r.events.length; });
    } else {
      // A unit sees its own record; the nationals see the units they govern. The
      // independent bodies are not listed for anyone but themselves.
      var list = national
        ? Store.units({ activeOnly: true, governed: true })
        : [Store.unit(mine)].filter(Boolean);

      rows = list.map(function (u) {
        var evs = Store.events({ unitId: u.id }).filter(function (e) {
          var r = Store.report(e.id);
          return r && r.driveLink;
        }).map(function (e) {
          var r = Store.report(e.id);
          return {
            title: e.title, dateStart: e.dateStart, dateEnd: e.dateEnd,
            driveLink: r.driveLink, driveOwned: !!r.driveOwned
          };
        });
        return { unit: u, events: evs };
      }).filter(function (r) { return r.events.length; });
    }

    if (!rows.length && !t.overallLink) return '';

    var html = '<div class="section"><div class="section-head">' +
      '<h2>Accomplishment reports</h2>' +
      '<span class="section-note">' +
      (t.closedAt ? 'The closed term, kept as links.' : 'Filed, and kept as links.') +
      '</span></div>' +
      (t.closedAt
        ? '<p class="small muted" style="margin:0 2px 10px">This administration closed on ' +
          U.esc(U.fmtDate(t.closedAt.slice(0, 10))) + '. Its working records were cleared; ' +
          'what remains is the archive below.</p>'
        : '');

    if (t.overallLink) {
      html += '<a class="event-row" href="' + U.esc(t.overallLink) + '" target="_blank" rel="noopener">' +
        UI.icon('pdf') +
        '<span class="er-main"><span class="er-title">The whole administration</span>' +
        '<span class="er-meta">Every unit&rsquo;s reports in one record</span></span></a>';
    }

    html += rows.map(function (r) {
      return '<div class="group" style="margin-top:10px">' +
        '<div class="group-head" style="cursor:default">' +
        '<span class="group-title">' +
          (r.unit.code ? '<span class="unit-code">' + U.esc(r.unit.code) + '</span>' : '') +
          U.esc(r.unit.name) + '</span>' +
        '<span class="group-meta">' + U.plural(r.events.length, 'report') + '</span></div>' +
        '<div class="group-body"><div class="list">' +
        r.events.map(function (e) {
          return '<a class="task" href="' + U.esc(e.driveLink) + '" target="_blank" rel="noopener">' +
            '<span class="task-main"><span class="task-title">' + U.esc(e.title) + '</span>' +
            '<span class="task-meta">' + U.esc(U.fmtRange(e.dateStart, e.dateEnd)) +
            '<span class="sep">·</span>Open in Drive' +
            (e.driveOwned ? '' : '<span class="sep">·</span><span class="late">drive not vouched for</span>') +
            '</span></span></a>';
        }).join('') +
        '</div></div></div>';
    }).join('');

    return html + '</div>';
  }

  /* ---------- handing over ----------
     The last act of an administration. Everything it did is removed so the next
     one starts on a clean tracker; the units, the letterhead and the links to
     the reports are what carry over.

     Three things have to be true before the button does anything: the date has
     passed, every unit has filed (or an executive has recorded why not), and a
     backup has been downloaded in this sitting. */
  /* ---------- what my own unit still owes ----------

     The national closing screen answers "can the term close". This answers the
     question an outgoing officer actually asks — "what is left for me?" — and it
     is a different question with a different audience. Everything on it already
     existed, scattered across four screens; the work here is putting it in one
     place and saying plainly what is still owed. */

  /* What is still owed, and by whom.

     A National executive is answerable for the Republic, not only for their own
     desk, so for them this reaches across every unit they may see and each line
     says which department it belongs to. A Governor sees their own college, and
     naming the department on every row would be repeating the page title. */
  function seesRepublic() {
    return !global.Auth || !Auth.signedIn() || Auth.isNational();
  }

  function owedUnits(unitId) {
    if (!seesRepublic()) return [unitId];
    return Store.units({ activeOnly: true, governed: true }).map(function (u) { return u.id; });
  }

  function myOwed(unitId) {
    var evs = [];
    owedUnits(unitId).forEach(function (uid) {
      evs = evs.concat(Store.events({ unitId: uid }));
    });
    var unfinished = [], unfiled = [], unvouched = [];

    evs.forEach(function (e) {
      if (e.status === 'Archived') return;
      var r = Store.report(e.id);
      var done = e.status === 'Completed';
      var pending = Store.tasks({ eventId: e.id }).filter(Store.isPending).length;

      if (!done || pending) unfinished.push({ event: e, pending: pending });
      else if (!r || !r.driveLink) unfiled.push({ event: e });
      else if (!r.driveOwned) unvouched.push({ event: e, report: r });
    });

    var letters = [];
    owedUnits(unitId).forEach(function (uid) {
      letters = letters.concat(Store.letters({ unitId: uid, openOnly: true }));
    });

    return {
      unfinished: unfinished, unfiled: unfiled, unvouched: unvouched, letters: letters,
      total: unfinished.length + unfiled.length + unvouched.length + letters.length
    };
  }

  function myHandoverForm() {
    var unitId = myUnitId();
    var unit = Store.unit(unitId);
    var owed = myOwed(unitId);
    var st = Store.termStatus();
    var wide = seesRepublic();

    function block(title, note, items, render) {
      if (!items.length) return '';
      return '<div class="section" style="margin-bottom:16px">' +
        '<div class="section-head"><h2>' + U.esc(title) +
        ' <span class="chip st-overdue"><span class="dot"></span>' + items.length + '</span></h2></div>' +
        '<p class="small muted" style="margin:0 2px 8px">' + note + '</p>' +
        '<div class="list">' + items.map(render).join('') + '</div></div>';
    }

    /* The department goes first in the meta line, because when the list spans
       the Republic "which college is this" is the question you are asking as you
       read it, and a title alone does not answer it. */
    function row(title, meta, goto, ownerUnitId) {
      var dept = (wide && ownerUnitId) ? Store.unitName(ownerUnitId) : '';
      return '<button type="button" class="task" data-goto="' + U.esc(goto) + '" ' +
        'style="width:100%;text-align:left;border:0;background:transparent">' +
        '<span class="task-main" style="cursor:pointer">' +
        '<span class="task-title">' + U.esc(title) + '</span>' +
        '<span class="task-meta">' +
          (dept ? '<span class="owner-unit">' + U.esc(dept) + '</span><span class="sep">·</span>' : '') +
          U.esc(meta) + '</span></span></button>';
    }

    var body = '';

    if (st.declared) {
      body += '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin-bottom:16px">' +
        '<div class="strong">Everything below must be finished and filed before ' +
        U.esc(U.fmtDate(st.endDate)) + '</div>' +
        '<div class="small muted">' +
        (st.passed
          ? 'That day has passed. Nothing is deleted while anything below is outstanding.'
          : (st.daysLeft === 0 ? 'That is today.' : U.plural(st.daysLeft, 'day') + ' left') +
            '. Work carries on afterwards, but the handover is not complete until this list is empty.') +
        '</div></div>';
    }

    if (!owed.total) {
      body += '<div class="empty" style="border-color:var(--st-done-bd);background:var(--st-done-bg)">' +
        '<strong>' + U.esc(unit ? unit.name : 'This unit') + ' is clear.</strong>' +
        '<p>Every activity is finished, every report is filed on a drive the council owns, ' +
        'and no letter is still out. Nothing is owed.</p></div>';
    } else {
      body += '<p class="small" style="margin-top:0">' +
        U.plural(owed.total, 'thing') + ' still owed before ' +
        (wide ? 'the Republic' : U.esc(unit ? unit.name : 'this unit')) + ' can hand over.</p>';

      body += block('Activities not finished',
        'Mark the activity complete once its tasks are done.',
        owed.unfinished, function (x) {
          return row(x.event.title,
            x.pending ? U.plural(x.pending, 'task') + ' still open' : 'Not marked complete',
            '#/events/' + x.event.id, x.event.unitId);
        });

      body += block('Reports not filed',
        'Finished, but the accomplishment report has not been uploaded and linked.',
        owed.unfiled, function (x) {
          return row(x.event.title, 'No Drive link yet', '#/events/' + x.event.id, x.event.unitId);
        });

      body += block('Links nobody has vouched for',
        'Filed, but nobody has confirmed the file is on a drive the FCUSR owns. ' +
        'A link to a personal account dies when its owner graduates.',
        owed.unvouched, function (x) {
          return row(x.event.title, 'Open the report and confirm the drive',
            '#/events/' + x.event.id, x.event.unitId);
        });

      body += block('Letters still out',
        'Still moving between offices, or waiting to be revised.',
        owed.letters, function (l) {
          return row(l.subject, Store.letterWhere(l), '#/letters/' + l.id, l.unitId);
        });
    }

    UI.modal({
      title: 'Before you hand over',
      wide: true,
      body: body,
      footer: '<button type="button" class="btn btn-primary" data-close>Close</button>',
      onMount: function (root, close) {
        U.els('[data-goto]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            close();
            App.go(b.getAttribute('data-goto'));
          });
        });
      }
    });
  }

  function handoverForm() {
    var st = Store.termStatus();
    var backedUp = false;

    function outstandingList() {
      return '<ul class="small" style="padding-left:18px;line-height:1.8;margin:6px 0 0">' +
        st.outstandingUnits.map(function (c) {
          var bits = [];
          if (c.outstanding.length) {
            bits.push(U.plural(c.outstanding.length, 'activity', 'activities') + ' not filed');
          }
          if (c.unvouched.length) {
            bits.push(U.plural(c.unvouched.length, 'link') + ' nobody has vouched for');
          }
          return '<li><strong>' + U.esc(c.unit.name) + '</strong> — ' + bits.join(', ') + '</li>';
        }).join('') + '</ul>';
    }

    var body;
    if (!st.declared) {
      body = '<p class="small">No closing date has been declared yet. Set one first.</p>';
    } else if (!st.passed) {
      body = '<p class="small">The term closes on <strong>' + U.esc(U.fmtDate(st.endDate)) +
        '</strong>, which has not arrived yet — ' + U.plural(st.daysLeft, 'day') + ' to go.</p>' +
        '<p class="small muted">Work carries on until then, and afterwards. This becomes ' +
        'available once the date has passed and every unit has filed.</p>';
    } else if (st.outstandingUnits.length && !st.overridden) {
      body = '<div class="card" style="background:var(--st-overdue-bg);border-color:var(--st-overdue-bd)">' +
        '<div class="strong">' + U.plural(st.outstandingUnits.length, 'unit') +
        ' cannot be closed yet.</div>' + outstandingList() + '</div>' +
        '<p class="small muted" style="margin-top:12px">Nothing is deleted while any unit is ' +
        'outstanding. They keep working and filing; this opens by itself once they are done.</p>' +
        '<div class="field" style="margin-top:14px"><label for="t-override">Or pass them over</label>' +
        '<textarea id="t-override" maxlength="300" placeholder="Why the term is closing with units outstanding. This is kept on the record and printed in the report."></textarea>' +
        '<div class="hint">At least a sentence. It is printed in the final record.</div></div>';
    } else {
      body = '<p class="small">Every unit has filed. Closing hands the tracker to the next ' +
        'administration:</p>' +
        '<ul class="small" style="padding-left:18px;line-height:1.8">' +
        '<li>Every event, task, person and report on this device is <strong>deleted</strong>.</li>' +
        '<li>The units, the letterhead and the links to the filed reports are kept.</li>' +
        '<li>The reports themselves are in Drive and are not touched.</li></ul>' +
        (st.overridden
          ? '<div class="card" style="background:var(--st-overdue-bg);border-color:var(--st-overdue-bd)">' +
            '<div class="small strong">Closing with units outstanding</div>' +
            '<div class="small">' + U.esc(Store.term().override.reason) + '</div></div>'
          : '') +
        '<div class="card" style="margin-top:12px">' +
        '<div class="strong" style="margin-bottom:6px">Download a backup first</div>' +
        '<div class="small muted" style="margin-bottom:10px">This cannot be undone, and the ' +
        'backup file is the only way back. It is not optional.</div>' +
        '<button type="button" class="btn" data-backup>' + UI.icon('download') + 'Download backup</button>' +
        '</div>' +
        '<div class="field" style="margin-top:14px"><label for="t-overall">Link to the overall report</label>' +
        '<input type="text" id="t-overall" placeholder="https://drive.google.com/..." value="' +
        U.esc(Store.term().overallLink) + '">' +
        '<div class="hint">Kept after the wipe, so the next administration can still find it.</div></div>';
    }

    UI.modal({
      title: 'Hand over to the next administration',
      wide: true,
      body: body,
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        (st.declared && st.passed && st.outstandingUnits.length && !st.overridden
          ? '<button type="button" class="btn btn-danger" data-override>Pass them over</button>'
          : '') +
        (st.canClose
          ? '<button type="button" class="btn btn-danger" data-wipe disabled>Delete everything</button>'
          : ''),
      onMount: function (root, close) {
        var backup = root.querySelector('[data-backup]');
        var wipe = root.querySelector('[data-wipe]');

        if (backup) backup.addEventListener('click', function () {
          UI.downloadFile('FCUSR-TaskTracker-Turnover-' + U.today() + '.json',
            Store.toJSON(), 'application/json');
          backedUp = true;
          backup.textContent = 'Backup downloaded';
          if (wipe) wipe.disabled = false;
          UI.toast('Backup downloaded. Keep it somewhere safe.');
        });

        var ov = root.querySelector('[data-override]');
        if (ov) ov.addEventListener('click', function () {
          var reason = (root.querySelector('#t-override') || {}).value || '';
          try {
            Store.overrideCompliance(reason,
              (global.Auth && Auth.current()) ? Auth.current().name : '');
            close();
            UI.toast('Recorded. The outstanding units are named in the final report.');
            handoverForm();
          } catch (err) { UI.toast(err.message, 'error'); }
        });

        if (wipe) wipe.addEventListener('click', function () {
          if (!backedUp) return UI.toast('Download the backup first.', 'error');
          var link = (root.querySelector('#t-overall') || {}).value || '';
          UI.confirm({
            title: 'Delete everything and hand over?',
            message: 'Every event, task, person and report on this device is removed.',
            detail: 'This cannot be undone. You have the backup file; there is nothing else.',
            confirmLabel: 'Delete everything'
          }).then(function (ok) {
            if (!ok) return;
            try {
              Store.closeTerm({ overallLink: link });
              close();
              UI.toast('The term is closed. The tracker is ready for the next administration.');
              App.go('#/overview');
            } catch (err) { UI.toast(err.message, 'error'); }
          });
        });
      }
    });
  }

  global.TermUI = {
    banner: banner, mountBanner: mountBanner, archive: archive,
    maybeRemind: maybeRemind, declareForm: declareForm, handoverForm: handoverForm,
    heroStrip: heroStrip,
    myHandoverForm: myHandoverForm, myOwed: myOwed,
    dryRunNotice: dryRunNotice, endDryRunForm: endDryRunForm
  };
})(window);
