/* Accomplishment Report — the step-by-step wizard.

   One step on screen at a time, a progress bar across the top, and every step
   reachable from the chips so nothing is trapped behind a "next" button. The
   PDF preview is one tap away at any point, because people should be able to see
   what the system is making for them rather than trust it. */
(function (global) {
  'use strict';

  var A = global.Accomplishment;
  var STEPS = A.STEPS, MIN_PHOTOS = A.MIN_PHOTOS;

  var state = null;   // { eventId, step, draft, cache, busy }
  var rootEl = null;
  var closeModal = null;

  /* ---------- open / persist ---------- */

  function open(eventId) {
    var e = Store.event(eventId);
    if (!e) return;

    state = { eventId: eventId, step: 0, draft: A.draftFor(eventId), cache: {}, busy: false };
    A._setState(state);

    closeModal = UI.modal({
      title: 'Accomplishment Report',
      /* This one takes the screen. The report is built by looking at the page
         you are making — a preview you have to scroll to find is a preview
         nobody looks at, so on anything wide enough the two sit side by side. */
      full: true,
      body: '<div id="wiz"></div>',
      dismissible: false,
      footer: '<button type="button" class="btn btn-ghost left" data-save-close>Save and close</button>' +
        '<button type="button" class="btn" data-back>Back</button>' +
        '<button type="button" class="btn btn-primary" data-next>Next</button>',
      onMount: function (root) {
        rootEl = root;
        root.querySelector('[data-save-close]').addEventListener('click', function () {
          persist();
          closeModal();
          UI.toast('Draft saved.');
        });
        root.querySelector('[data-back]').addEventListener('click', function () { go(state.step - 1); });
        root.querySelector('[data-next]').addEventListener('click', onNext);
        /* Pictures live in IndexedDB, which some browsers refuse in private mode.
           A refusal must cost the thumbnails, not the whole wizard — without this
           the report screen opens blank and there is no way to work out why. */
        A._warmCache(A._allAssetIds(state.draft))
          .catch(function () { /* no thumbnails; the report still builds */ })
          .then(render);
      },
      onClose: function () { state = null; rootEl = null; }
    });
  }

  function persist() {
    if (!state) return;
    Store.saveReport(state.eventId, state.draft);
  }

  function go(i) {
    if (!state) return;
    state.step = Math.max(0, Math.min(STEPS.length - 1, i));
    persist();
    render();
  }

  function onNext() {
    var key = STEPS[state.step].key;
    if (key === 'review') return;
    if (!A.stepDone(state.draft, key) && key !== 'minutes') {
      UI.toast(A.blockingReason(state.draft, key), 'error');
      return;
    }
    go(state.step + 1);
  }

  /* ---------- chrome ---------- */

  function header() {
    var p = A.progress(state.draft);
    var e = Store.event(state.eventId);
    return '<div class="wiz-head">' +
      '<div class="wiz-event">' + U.esc(e ? e.title : '') + '</div>' +
      '<div class="progress-row" style="margin:8px 0 10px">' +
        '<div class="progress" role="progressbar" aria-valuenow="' + p.pct + '" aria-valuemin="0" aria-valuemax="100">' +
        '<span style="width:' + p.pct + '%"></span></div>' +
        '<span class="progress-label">' + p.done + ' of ' + p.total + ' done</span>' +
      '</div>' +
      '<div class="wiz-steps">' + STEPS.map(function (s, i) {
        var done = A.stepDone(state.draft, s.key);
        var cls = 'wiz-step' + (i === state.step ? ' is-current' : '') + (done ? ' is-done' : '');
        return '<button type="button" class="' + cls + '" data-step="' + i + '">' +
          '<span class="n">' + (done ? '✓' : (i + 1)) + '</span>' + U.esc(s.label) + '</button>';
      }).join('') + '</div></div>';
  }

  /* An upload block. `routes` decides which ways in are offered — activity photos
     are taken on phones and uploaded, so that step shows Upload only rather than
     pretending a group shot needs scanning. */
  function uploader(slot, opts) {
    opts = opts || {};
    var routes = opts.routes || ['upload'];
    var has = function (r) { return routes.indexOf(r) >= 0; };

    return '<div class="up" data-slot="' + U.esc(slot) + '">' +
      '<div class="up-actions">' +
        (has('upload')
          ? '<label class="btn btn-sm"><input type="file" accept="image/*" multiple hidden ' +
            'data-pick="' + U.esc(slot) + '">' + UI.icon('upload') + 'Upload file</label>' : '') +
        '<button type="button" class="icon-btn" data-howto="' + U.esc(opts.howto || 'scan') + '" ' +
          'aria-label="How this works">' + UI.icon('alert') + '</button>' +
      '</div>' +
      '<div class="up-grid" data-grid="' + U.esc(slot) + '"></div></div>';
  }

  function thumbs(slot, ids) {
    if (!ids.length) {
      return '<p class="small muted" style="margin:8px 0 0">Nothing added yet.</p>';
    }
    return ids.map(function (id, i) {
      var src = A._cache(id);
      return '<div class="thumb">' +
        '<span class="thumb-n">' + (i + 1) + '</span>' +
        (src ? '<img src="' + src + '" alt="">' : '<span class="thumb-ph">loading…</span>') +
        '<div class="thumb-bar">' +
          '<button type="button" class="btn btn-sm btn-ghost" data-move="' + U.esc(slot) + ':' + i + ':-1"' +
            (i === 0 ? ' disabled' : '') + ' aria-label="Move up">↑</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-move="' + U.esc(slot) + ':' + i + ':1"' +
            (i === ids.length - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-drop="' + U.esc(slot) + ':' + i + '" ' +
            'aria-label="Remove">' + UI.icon('trash') + '</button>' +
        '</div></div>';
    }).join('');
  }

  /* ---------- steps ---------- */

  function stepBody() {
    var d = state.draft;
    var key = STEPS[state.step].key;
    var title = '<h2 style="margin-bottom:4px">' + U.esc(STEPS[state.step].title) + '</h2>';

    if (key === 'description') {
      return title +
        '<p class="small muted">What was the activity, what happened, and what came of it. ' +
        'This is the opening paragraph of the report.</p>' +
        '<div class="field"><textarea id="desc" rows="9" maxlength="4000" ' +
        'placeholder="On September 12, 2026, the FCUSR conducted…">' + U.esc(d.description) + '</textarea>' +
        '<div class="hint"><span id="desc-count">' + d.description.length + '</span> of 4000 characters</div></div>';
    }

    if (key === 'program') {
      return title +
        '<p class="small muted">The programme flow — scan the printed copy, photograph it, or upload a file.</p>' +
        uploader('program', { howto: 'scan' });
    }

    if (key === 'photos') {
      var n = d.photos.length;
      return title +
        '<p class="small muted">At least ' + MIN_PHOTOS + ' photos. Any shape — each one is fitted to the same ' +
        'size in the report so the page stays even.</p>' +
        '<div class="row" style="margin-bottom:8px">' +
        '<span class="chip ' + (n >= MIN_PHOTOS ? 'st-done' : 'st-on-hold') + '">' +
        n + ' of ' + MIN_PHOTOS + ' minimum</span></div>' +
        uploader('photos', { howto: 'photos' });
    }

    if (key === 'letters') {
      return title +
        '<p class="small muted">One entry per document. Name it, then add its pages in order.</p>' +
        '<div id="letters">' + d.letters.map(function (l, i) {
          return '<div class="card" style="margin-bottom:10px">' +
            '<div class="row" style="flex-wrap:nowrap;gap:8px;margin-bottom:8px">' +
            '<input type="text" maxlength="160" placeholder="e.g. Letter of Intent" style="flex:1" ' +
            'data-letter-name="' + i + '" value="' + U.esc(l.name) + '">' +
            '<button type="button" class="btn btn-sm btn-danger" data-letter-drop="' + i + '">' +
            UI.icon('trash') + '</button></div>' +
            uploader('letter:' + i, { howto: 'letters' }) + '</div>';
        }).join('') + '</div>' +
        '<button type="button" class="btn btn-block" data-add-letter>' + UI.icon('plus') + 'Add another document</button>';
    }

    if (key === 'minutes') {
      var mode = d.minutes.mode;
      var tasks = Store.tasks({ eventId: state.eventId }).slice().sort(function (a, b) {
        return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
      });
      var body = title +
        '<p class="small muted">This is the only step you may skip.</p>' +
        '<div class="segmented" style="width:100%;margin-bottom:12px">' +
        ['tasks:From the tracker', 'upload:Scan or upload', 'skip:Skip this'].map(function (o) {
          var k = o.split(':')[0], label = o.split(':')[1];
          return '<button type="button" data-minutes="' + k + '"' +
            (mode === k ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
            U.esc(label) + '</button>';
        }).join('') + '</div>';

      if (mode === 'tasks') {
        body += '<p class="small muted">The agreed tasks for this activity, in deadline order. ' +
          'This is what will be printed.</p>' +
          (tasks.length
            ? '<div class="list">' + tasks.map(function (t) {
                return UI.taskRow(t, [t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date',
                  Store.personName(t.assigneeId)]);
              }).join('') + '</div>'
            : UI.empty('No tasks on this event', 'Nothing to print here — choose Scan or Skip.'));
      } else if (mode === 'upload') {
        body += uploader('minutes', { howto: 'scan' });
      } else {
        body += '<div class="empty"><strong>Skipped</strong><p>The report will leave this section out.</p></div>';
      }
      return body;
    }

    if (key === 'evaluation') {
      return title +
        '<p class="small muted">The evaluation results — scan the summary sheet or upload a photo of it.</p>' +
        uploader('evaluation', { howto: 'scan' });
    }

    if (key === 'liquidation') {
      return title +
        '<p class="small muted">Only if the activity handled money. Scan the liquidation ' +
        'report and its receipts, or skip this step.</p>' +
        uploader('liquidation', { howto: 'scan' });
    }

    if (key === 'signatories') {
      var sg = d.signatories;
      var org = Store.org().name;
      return title +
        '<p class="small muted">Whose names are printed under the signature lines on page one. ' +
        'Nobody signs here &mdash; these are typed so the printed report has the right names ' +
        'above the right positions.</p>' +

        '<div class="card" style="margin-bottom:12px">' +
        '<div class="field-label" style="margin-bottom:10px">Prepared by</div>' +
        '<div class="field"><label for="sg-prep-name">Name <span class="req">*</span></label>' +
        '<input type="text" id="sg-prep-name" maxlength="80" value="' + U.esc(sg.preparedBy.name) +
        '" placeholder="Juan D. Dela Cruz" list="sg-people"></div>' +
        '<div class="field" style="margin-bottom:0"><label for="sg-prep-pos">Position</label>' +
        '<input type="text" id="sg-prep-pos" maxlength="60" value="' + U.esc(sg.preparedBy.position) +
        '" placeholder="e.g. Secretary, ' + U.esc(org) + '"></div>' +
        '</div>' +

        '<div class="card" style="margin-bottom:12px">' +
        '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<span class="field-label" style="margin:0">Noted by</span>' +
        '<label class="checkbox" style="margin:0"><input type="checkbox" id="sg-pres-show"' +
        (sg.president.show !== false ? ' checked' : '') + '><span class="small">Include the President</span></label>' +
        '</div>' +
        '<div class="field" id="sg-pres-field"' + (sg.president.show === false ? ' hidden' : '') + '>' +
        '<label for="sg-pres-name">President</label>' +
        '<input type="text" id="sg-pres-name" maxlength="80" value="' + U.esc(sg.president.name) +
        '" placeholder="Name of the President" list="sg-people">' +
        '<div class="hint">Leave the President out when they are the one who prepared it &mdash; ' +
        'nobody signs the same page twice.</div></div>' +
        '<div class="field" style="margin-bottom:0"><label for="sg-adv-name">Adviser</label>' +
        '<input type="text" id="sg-adv-name" maxlength="80" value="' + U.esc(sg.adviser.name) +
        '" placeholder="Name of the Adviser"></div>' +
        '</div>' +

        // The directory offered as suggestions, while still allowing a name that
        // is not in it — an adviser is staff, not a council officer.
        '<datalist id="sg-people">' + Store.people({ activeOnly: true }).map(function (pp) {
          return '<option value="' + U.esc(pp.name) + '"></option>';
        }).join('') + '</datalist>';
    }

    /* review */
    var p = A.progress(d);
    var missing = STEPS.filter(function (s) {
      return s.key !== 'review' && s.key !== 'minutes' && !A.stepDone(d, s.key);
    });
    return title +
      (missing.length
        ? '<div class="empty" style="border-color:var(--st-on-hold-bd);background:var(--st-on-hold-bg)">' +
          '<strong>Not ready yet</strong><p>' +
          U.esc(missing.map(function (s) { return s.label; }).join(', ')) + ' still needed.</p></div>'
        : '<div class="empty" style="border-color:var(--st-done-bd);background:var(--st-done-bg)">' +
          '<strong>Ready to export</strong><p>All required sections are filled in.</p></div>') +
      '<div class="list" style="margin:12px 0">' +
        summaryRow('Description', d.description ? d.description.length + ' characters' : 'empty', !!d.description) +
        summaryRow('Program flow', U.plural(d.program.assets.length, 'page'), d.program.assets.length > 0) +
        summaryRow('Photos', U.plural(d.photos.length, 'photo'), d.photos.length >= MIN_PHOTOS) +
        summaryRow('Letters', U.plural(d.letters.length, 'document'), d.letters.length > 0) +
        summaryRow('Minutes', d.minutes.mode === 'tasks' ? 'From the tracker'
          : d.minutes.mode === 'upload' ? U.plural(d.minutes.assets.length, 'page') : 'Skipped', true) +
        summaryRow('Evaluation', U.plural(d.evaluation.assets.length, 'page'), d.evaluation.assets.length > 0) +
      '</div>' +
      '<div class="row">' +
        '<button type="button" class="btn btn-primary" data-export' + (missing.length ? ' disabled' : '') + '>' +
        UI.icon('download') + 'Download PDF</button>' +
        '<button type="button" class="btn" data-export-word' + (missing.length ? ' disabled' : '') + '>' +
        UI.icon('download') + 'Download Word</button>' +
      '</div>' +
      '<p class="small muted" style="margin-top:10px">' +
        'The Word file has the same pages as the PDF, so both read alike — but you can edit it, ' +
        'and the pictures sit in boxes you can drag.</p>' +
      (d.driveLink
        ? '<div class="card" style="margin-top:14px;background:var(--st-done-bg);border-color:var(--st-done-bd)">' +
          '<div class="strong">Filed.</div>' +
          '<div class="small" style="overflow-wrap:anywhere">' + U.esc(d.driveLink) + '</div>' +
          '<button type="button" class="btn btn-sm" style="margin-top:10px" data-open-upload>Change the link</button>' +
          '</div>'
        : '<div class="row" style="margin-top:14px">' +
          '<button type="button" class="btn" data-open-upload>' + UI.icon('upload') + 'I have uploaded it</button>' +
          '</div>') +
      '<p class="tiny muted" style="margin-top:12px">' + p.done + ' of ' + p.total + ' sections complete.</p>';
  }

  function summaryRow(label, value, ok) {
    return '<div class="task"><span class="task-main" style="cursor:default">' +
      '<span class="task-title">' + U.esc(label) + '</span>' +
      '<span class="task-meta">' + U.esc(value) + '</span></span>' +
      '<span class="task-right"><span class="chip ' + (ok ? 'st-done' : 'st-not-started') + '">' +
      (ok ? 'ok' : 'todo') + '</span></span></div>';
  }

  /* ---------- render ---------- */

  // Which section of the PDF the step on screen corresponds to.
  var STEP_PAGE = {
    description: 'description', program: 'program', photos: 'photos',
    letters: 'letters', minutes: 'minutes', evaluation: 'evaluation', review: 'cover'
  };

  function previewPane() {
    return '<div class="wiz-preview">' +
      '<div class="row" style="justify-content:space-between;margin-bottom:8px">' +
        '<span class="field-label" style="margin:0">Preview of this page</span>' +
        '<button type="button" class="btn btn-sm" data-refresh-preview>Refresh</button>' +
      '</div>' +
      '<div class="wiz-frame" id="pv-frame"><p class="small muted" style="padding:14px">Building…</p></div>' +
      '</div>';
  }

  /* Rebuilds the real PDF and points the frame at the page for this step, so what
     you see is the document itself rather than an impression of it. */
  var pvTimer = null;
  var pvURL = null;
  function refreshPreview(delay) {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(function () {
      if (!state || !rootEl) return;
      var frame = rootEl.querySelector('#pv-frame');
      if (!frame) return;
      AccomplishmentPDF.previewURL(state.eventId, state.draft).then(function (out) {
        if (!state || !rootEl) return;
        var frameNow = rootEl.querySelector('#pv-frame');
        if (!frameNow) return;
        if (pvURL) URL.revokeObjectURL(pvURL);
        pvURL = out.url;
        var key = STEP_PAGE[STEPS[state.step].key];
        var page = out.pageMap[key] || 1;
        frameNow.innerHTML = '<iframe title="Report preview" src="' +
          out.url + '#page=' + page + '&view=FitH&toolbar=0"></iframe>';
      }).catch(function (err) {
        var frameNow = rootEl && rootEl.querySelector('#pv-frame');
        if (frameNow) {
          frameNow.innerHTML = '<p class="small muted" style="padding:14px">' +
            U.esc(err.message || 'Preview unavailable.') + '</p>';
        }
      });
    }, delay || 250);
  }

  function render() {
    if (!state || !rootEl) return;
    var host = rootEl.querySelector('#wiz');
    host.innerHTML = header() +
      '<div class="wiz-layout">' +
        '<div class="wiz-body">' + stepBody() + '</div>' +
        previewPane() +
      '</div>';

    // Fill every upload grid from the draft.
    U.els('[data-grid]', host).forEach(function (g) {
      var slot = g.getAttribute('data-grid');
      var info = slotData(slot);
      g.innerHTML = thumbs(slot, info.ids);
    });

    var back = rootEl.querySelector('[data-back]');
    var next = rootEl.querySelector('[data-next]');
    back.disabled = state.step === 0;
    next.hidden = STEPS[state.step].key === 'review';

    bind(host);
    refreshPreview(120);
  }

  // One place that knows where each slot's ids live in the draft.
  function slotData(slot) {
    var d = state.draft;
    if (slot === 'program') return { ids: d.program.assets, set: function (v) { d.program.assets = v; } };
    if (slot === 'minutes') return { ids: d.minutes.assets, set: function (v) { d.minutes.assets = v; } };
    if (slot === 'evaluation') return { ids: d.evaluation.assets, set: function (v) { d.evaluation.assets = v; } };
    if (slot === 'photos') {
      return {
        ids: d.photos.map(function (p) { return p.assetId; }),
        set: function (v) { d.photos = v.map(function (id) { return { assetId: id, caption: '' }; }); }
      };
    }
    if (slot.indexOf('letter:') === 0) {
      var i = Number(slot.split(':')[1]);
      return { ids: (d.letters[i] || { assets: [] }).assets, set: function (v) { if (d.letters[i]) d.letters[i].assets = v; } };
    }
    return { ids: [], set: function () {} };
  }

  function addFiles(slot, files) {
    if (!files || !files.length) return;
    state.busy = true;
    UI.toast('Adding ' + U.plural(files.length, 'image') + '…');

    var reportId = state.draft.id || (state.draft.id = U.uid('rep'));
    var queue = Array.prototype.slice.call(files);

    queue.reduce(function (chain, f) {
      return chain.then(function () {
        return AssetDB.addFile(reportId, f, { maxDim: 1600, quality: 0.82 }).then(function (out) {
          state.cache[out.id] = out.dataUrl;
          var info = slotData(slot);
          var ids = info.ids.slice();
          ids.push(out.id);
          info.set(ids);
        });
      });
    }, Promise.resolve()).then(function () {
      state.busy = false;
      persist();
      render();
      UI.toast('Added.');
    }).catch(function (err) {
      state.busy = false;
      UI.toast(err.message || 'That image could not be added.', 'error');
      render();
    });
  }

  function bind(host) {
    U.els('[data-step]', host).forEach(function (b) {
      b.addEventListener('click', function () { go(Number(b.getAttribute('data-step'))); });
    });

    var rp = host.querySelector('[data-refresh-preview]');
    if (rp) rp.addEventListener('click', function () { refreshPreview(0); });

    var desc = host.querySelector('#desc');
    if (desc) desc.addEventListener('input', function () {
      state.draft.description = desc.value;
      var c = host.querySelector('#desc-count');
      if (c) c.textContent = desc.value.length;
      // Typing redraws the page you are writing, but not on every keystroke.
      refreshPreview(900);
    });

    U.els('[data-pick]', host).forEach(function (inp) {
      inp.addEventListener('change', function () {
        addFiles(inp.getAttribute('data-pick'), inp.files);
        inp.value = '';
      });
    });

    U.els('[data-camera]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var slot = b.getAttribute('data-camera');
        Camera.open({ document: true }).then(function (file) {
          if (file) addFiles(slot, [file]);
        });
      });
    });
    U.els('[data-howto]', host).forEach(function (b) {
      b.addEventListener('click', function () { A.howto(b.getAttribute('data-howto')); });
    });

    U.els('[data-move]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-move').split(':');
        var dir = Number(parts.pop()), idx = Number(parts.pop()), slot = parts.join(':');
        var info = slotData(slot);
        var ids = info.ids.slice();
        var j = idx + dir;
        if (j < 0 || j >= ids.length) return;
        var t = ids[idx]; ids[idx] = ids[j]; ids[j] = t;
        info.set(ids);
        persist();
        render();
      });
    });

    U.els('[data-drop]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-drop').split(':');
        var idx = Number(parts.pop()), slot = parts.join(':');
        var info = slotData(slot);
        var ids = info.ids.slice();
        var removed = ids.splice(idx, 1)[0];
        info.set(ids);
        if (removed) AssetDB.del(removed);
        persist();
        render();
      });
    });

    U.els('[data-letter-name]', host).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.getAttribute('data-letter-name'));
        if (state.draft.letters[i]) state.draft.letters[i].name = inp.value;
      });
    });

    U.els('[data-letter-drop]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-letter-drop'));
        var l = state.draft.letters[i];
        UI.confirm({
          title: 'Remove this document?',
          message: (l && l.name ? '“' + l.name + '”' : 'This document') + ' and its pages will be removed from the report.',
          confirmLabel: 'Remove'
        }).then(function (ok) {
          if (!ok) return;
          (l.assets || []).forEach(function (id) { AssetDB.del(id); });
          state.draft.letters.splice(i, 1);
          persist();
          render();
        });
      });
    });

    var addLetter = host.querySelector('[data-add-letter]');
    if (addLetter) addLetter.addEventListener('click', function () {
      state.draft.letters.push({ name: '', assets: [] });
      persist();
      render();
    });

    U.els('[data-minutes]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        state.draft.minutes.mode = b.getAttribute('data-minutes');
        persist();
        render();
      });
    });

    /* Signatories: every field writes straight onto the draft as it is typed, the
       same way the description does, so nothing is lost by stepping away. */
    function bindSig(sel, apply) {
      var el = host.querySelector(sel);
      if (el) el.addEventListener('input', function () { apply(el.value); persist(); });
    }
    bindSig('#sg-prep-name', function (v) { state.draft.signatories.preparedBy.name = v; });
    bindSig('#sg-prep-pos', function (v) { state.draft.signatories.preparedBy.position = v; });
    bindSig('#sg-pres-name', function (v) { state.draft.signatories.president.name = v; });
    bindSig('#sg-adv-name', function (v) { state.draft.signatories.adviser.name = v; });

    var presShow = host.querySelector('#sg-pres-show');
    if (presShow) presShow.addEventListener('change', function () {
      state.draft.signatories.president.show = presShow.checked;
      var f = host.querySelector('#sg-pres-field');
      if (f) f.hidden = !presShow.checked;
      persist();
    });

    var drive = host.querySelector('#drive');
    if (drive) drive.addEventListener('input', function () { state.draft.driveLink = drive.value.trim(); });

    var prev = host.querySelector('[data-preview]');
    if (prev) prev.addEventListener('click', function () { preview(); });

    var openUp = host.querySelector('[data-open-upload]');
    if (openUp) openUp.addEventListener('click', uploadWindow);

    var expW = host.querySelector('[data-export-word]');
    if (expW) expW.addEventListener('click', function () {
      persist();
      expW.disabled = true;
      expW.textContent = 'Building…';
      AccomplishmentWord.save(state.eventId, state.draft).then(function () {
        UI.toast('Word file downloaded.');
        render();
        uploadWindow();
      }).catch(function (err) {
        UI.toast(err.message || 'The Word file could not be built.', 'error');
        render();
      });
    });

    var exp = host.querySelector('[data-export]');
    if (exp) exp.addEventListener('click', function () {
      persist();
      exp.disabled = true;
      exp.textContent = 'Building…';
      AccomplishmentPDF.save(state.eventId, state.draft).then(function () {
        UI.toast('Accomplishment report exported.');
        render();
        uploadWindow();
      }).catch(function (err) {
        UI.toast(err.message || 'The report could not be built.', 'error');
        render();
      });
    });
  }

  /* The preview is the real PDF, shown in a frame — not a mock-up of one. */
  function preview() {
    persist();
    UI.toast('Building the preview…');
    AccomplishmentPDF.previewURL(state.eventId, state.draft).then(function (out) {
      UI.modal({
        title: 'Preview · ' + out.pages + (out.pages === 1 ? ' page' : ' pages'),
        wide: true,
        body: '<iframe src="' + out.url + '" title="Report preview" ' +
          'style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px"></iframe>',
        footer: '<button type="button" class="btn btn-primary" data-close>Close</button>'
      });
    }).catch(function (err) {
      UI.toast(err.message || 'The preview could not be built.', 'error');
    });
  }

  /* Shown after the file is downloaded. The app keeps only a link, so the file
     has to live somewhere that will outlast this year's officers — that is worth
     spelling out rather than assuming. */
  function uploadWindow() {
    var d = state.draft;
    UI.modal({
      title: 'Where the report will live',
      wide: true,
      body:
        '<p class="small">The system stores the <strong>link</strong>, never the file itself. ' +
        'That is deliberate: a finished report can run to hundreds of megabytes, and keeping ' +
        'the files would fill any free account within a term. Keeping links costs nothing and ' +
        'lasts for years.</p>' +

        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin:14px 0">' +
          '<div class="strong" style="margin-bottom:6px">It follows that the file must not be deleted.</div>' +
          '<ul class="small" style="padding-left:18px;line-height:1.75;margin:0">' +
            '<li>Upload it to a <strong>Google account owned by the FCUSR</strong>, not a personal one. ' +
            'A personal account leaves with its owner and takes every report with it.</li>' +
            '<li>Hand that account to next year\'s officers along with the office.</li>' +
            '<li>Never delete or move the file. If the link stops working, the report is gone ' +
            'from the archive even though this system still lists it.</li>' +
            '<li>Set sharing to <strong>Anyone with the link can view</strong>, so officers and ' +
            'the OSA can open it without asking for access each time.</li>' +
          '</ul>' +
        '</div>' +

        '<ol class="small" style="padding-left:18px;line-height:1.8">' +
          '<li>Open Google Drive in the FCUSR account.</li>' +
          '<li>Upload the file you just downloaded.</li>' +
          '<li>Right-click it, choose <strong>Share</strong>, then <strong>Copy link</strong>.</li>' +
          '<li>Paste it below.</li>' +
        '</ol>' +

        '<div class="field" style="margin-top:14px"><label for="drive">Drive link</label>' +
        '<input type="text" id="drive" data-autofocus placeholder="https://drive.google.com/…" ' +
        'value="' + U.esc(d.driveLink) + '">' +
        '<div class="error-text" hidden>That does not look like a Google Drive link.</div></div>' +

        /* The one promise the system cannot check for itself. A Shared Drive
           folder and somebody's personal one produce identical URLs, so there is
           nothing in the link to inspect — the term simply will not close until
           a person has put their name to this. */
        '<label class="checkbox drive-vouch"><input type="checkbox" id="drive-owned"' +
        (d.driveOwned ? ' checked' : '') + '>' +
        '<span class="small">This file is on a Google Drive the <strong>FCUSR owns</strong>, ' +
        'not a personal account, and it will still open after this administration ' +
        'has handed over.</span></label>' +
        '<div class="field"><label for="drive-by">Who is vouching for that</label>' +
        '<input type="text" id="drive-by" maxlength="80" value="' + U.esc(d.driveBy || '') + '" ' +
        'placeholder="Your name"></div>',
      footer: '<button type="button" class="btn" data-close>Not yet</button>' +
        '<button type="button" class="btn btn-primary" data-save-link>Save the link</button>',
      onMount: function (root, close) {
        root.querySelector('[data-save-link]').addEventListener('click', function () {
          var input = root.querySelector('#drive');
          var v = input.value.trim();
          if (!/^https:\/\/(drive|docs)\.google\.com\//.test(v)) {
            root.querySelector('.error-text').hidden = false;
            input.closest('.field').classList.add('has-error');
            input.focus();
            return;
          }
          var owned = root.querySelector('#drive-owned').checked;
          var by = root.querySelector('#drive-by').value.trim();
          if (owned && !by) {
            var f = root.querySelector('#drive-by').closest('.field');
            f.classList.add('has-error');
            root.querySelector('#drive-by').focus();
            return UI.toast('Put your name to it.', 'error');
          }

          state.draft.driveLink = v;
          state.draft.driveOwned = owned;
          state.draft.driveBy = owned ? by : '';
          state.draft.driveAt = owned ? new Date().toISOString() : '';
          state.draft.status = 'filed';
          persist();
          close();
          render();
          UI.toast(owned
            ? 'Report filed.'
            : 'Link saved — but the term cannot close until somebody vouches for the drive.');
        });
      }
    });
  }

  global.AccomplishmentUI = { open: open };
})(window);
