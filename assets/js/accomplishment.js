/* Accomplishment Report — the document the OSA asks for after every activity.

   A step-by-step wizard, then an A4 portrait PDF printed onto the FCUSR
   letterhead. Pictures live in IndexedDB (see asset-db.js), never in
   localStorage, so a report with twenty scans cannot break the tracker. */
(function (global) {
  'use strict';

  /* ---------- page geometry (A4 portrait, mm) ---------- */

  var A4 = { w: 210, h: 297 };
  // The letterhead art occupies the top and bottom of the sheet, so the writable
  // area sits between them. Measured off the supplied template.
  var BOX = { left: 22, right: 22, top: 58, bottom: 52 };
  BOX.width = A4.w - BOX.left - BOX.right;
  BOX.bottomY = A4.h - BOX.bottom;

  var LETTERHEAD = 'assets/img/letterhead-print.jpg';
  var letterheadData = null;

  var C = {
    ink: [23, 23, 27], ink2: [69, 69, 79], muted: [113, 113, 127],
    gold: [201, 162, 39], goldDark: [126, 98, 16], goldPale: [253, 250, 241],
    line: [214, 214, 209], white: [255, 255, 255]
  };

  var STEPS = [
    { key: 'description', label: 'Description', title: 'Summary of the activity' },
    { key: 'program',     label: 'Program',     title: 'Program flow' },
    { key: 'photos',      label: 'Photos',      title: 'Activity photos' },
    { key: 'letters',     label: 'Letters',     title: 'Letter of intent and requirements' },
    { key: 'minutes',     label: 'Minutes',     title: 'Minutes of the meeting' },
    { key: 'evaluation',  label: 'Evaluation',  title: 'Evaluation results' },
    { key: 'liquidation', label: 'Liquidation', title: 'Liquidation' },
    { key: 'signatories', label: 'Signatories', title: 'Who signs the report' },
    { key: 'review',      label: 'Export',      title: 'Export the report' }
  ];

  var MIN_PHOTOS = 8;

  /* ---------- session state ---------- */

  var wiz = null;          // { eventId, step, draft, cache }

  function loadLetterhead(unitId) {
    /* The template this unit's papers are printed on: its own where a college
       has uploaded one, the Republic's otherwise, and the one that ships with
       the app if neither. Checked every time rather than cached, because it can
       change between two exports in the same sitting. */
    var own = (global.Store && Store.templateFor) ? Store.templateFor(unitId) : '';
    if (own) return Promise.resolve(own);

    if (letterheadData) return Promise.resolve(letterheadData);

    /* No fetch at all — an old browser, or a page opened straight off the disk
       with the network shut out. The catch below handles a fetch that FAILS;
       it cannot handle one that was never there, because that throws before
       there is a promise to catch on. The report prints plain either way, which
       is the answer to both. */
    if (typeof fetch !== 'function') return Promise.resolve(null);

    return fetch(LETTERHEAD)
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.blob(); })
      .then(function (b) {
        return new Promise(function (resolve) {
          var fr = new FileReader();
          fr.onload = function () { letterheadData = String(fr.result); resolve(letterheadData); };
          fr.onerror = function () { resolve(null); };
          fr.readAsDataURL(b);
        });
      })
      .catch(function () { return null; });   // report still prints, just plain
  }

  /* Montserrat for the PDFs, fetched only when a PDF is actually being made.

     The embedded font file is half a megabyte — worth it on the council's
     letterhead, and not worth it on every visit from a phone on mobile data. So
     it is pulled in the first time somebody exports something and cached from
     then on. If it cannot be fetched the report still prints, in Helvetica. */
  var fontsPromise = null;

  function loadPdfFonts() {
    if (global.FCU_PDF_FONTS) return Promise.resolve(true);
    if (fontsPromise) return fontsPromise;
    fontsPromise = new Promise(function (resolve) {
      var s = global.document.createElement('script');
      s.src = 'vendor/montserrat-pdf-fonts.js';
      s.onload = function () { resolve(!!global.FCU_PDF_FONTS); };
      s.onerror = function () { fontsPromise = null; resolve(false); };
      global.document.head.appendChild(s);
    });
    return fontsPromise;
  }

  function draftFor(eventId) {
    var saved = Store.report(eventId);
    return saved ? JSON.parse(JSON.stringify(saved)) : {
      eventId: eventId, description: '',
      program: { assets: [] }, photos: [], letters: [],
      minutes: { mode: 'tasks', assets: [] }, evaluation: { assets: [] },
      liquidation: { assets: [] },
      signatories: {
        preparedBy: { name: '', position: '' },
        president: { name: '', show: true },
        adviser: { name: '' },
        others: []
      },
      driveLink: '', status: 'draft'
    };
  }

  /* ---------- completeness ---------- */

  function stepDone(d, key) {
    switch (key) {
      case 'description': return d.description.trim().length >= 20;
      case 'program': return d.program.assets.length > 0;
      case 'photos': return d.photos.length >= MIN_PHOTOS;
      case 'letters': return d.letters.length > 0 &&
        d.letters.every(function (l) { return l.name.trim() && l.assets.length; });
      case 'minutes': return true;                       // the only optional step
      case 'evaluation': return d.evaluation.assets.length > 0;
      case 'liquidation': return true;          // only applies when there was money
      case 'signatories': return !!(d.signatories && d.signatories.preparedBy.name.trim());
      case 'review': return false;
      default: return false;
    }
  }

  /* Only the steps that are actually required count towards progress. "Minutes"
     is optional and always reports itself as satisfied, so including it made an
     untouched report open at "1 of 6 done" — which reads as credit for work
     nobody has done yet. */
  function progress(d) {
    var required = STEPS.filter(function (s) {
      // Minutes and liquidation do not apply to every activity, so they never
      // count against the bar.
      return s.key !== 'review' && s.key !== 'minutes' && s.key !== 'liquidation';
    });
    var done = required.filter(function (s) { return stepDone(d, s.key); }).length;
    return { done: done, total: required.length, pct: Math.round(done / required.length * 100) };
  }

  function blockingReason(d, key) {
    switch (key) {
      case 'description': return 'Write at least a short paragraph describing the activity.';
      case 'program': return 'Add the program flow — scan it, photograph it, or upload a file.';
      case 'photos': return 'Add at least ' + MIN_PHOTOS + ' photos (you have ' + d.photos.length + ').';
      case 'letters': return 'Add at least one letter, and give every letter a name.';
      case 'evaluation': return 'Add the evaluation results.';
      case 'signatories': return 'Enter the name of the person who prepared the report.';
      default: return '';
    }
  }

  /* ---------- image helpers ---------- */

  function cache(id) { return wiz && wiz.cache[id]; }

  function warmCache(ids) {
    var missing = ids.filter(function (i) { return !wiz.cache[i]; });
    if (!missing.length) return Promise.resolve();
    return AssetDB.getMany(missing).then(function (rows) {
      rows.forEach(function (r) { if (r.dataUrl) wiz.cache[r.id] = r.dataUrl; });
    });
  }

  function allAssetIds(d) {
    var ids = d.program.assets.concat(d.minutes.assets, d.evaluation.assets,
      (d.liquidation && d.liquidation.assets) || []);
    d.photos.forEach(function (p) { ids.push(p.assetId); });
    d.letters.forEach(function (l) { ids = ids.concat(l.assets); });
    return ids;
  }

  /* ---------- how-to popups ---------- */

  var HOWTO = {
    scan: {
      title: 'Adding a document',
      body: '<p class="small">Everything goes in as a picture. Take a photo of the page with your ' +
        'phone, or scan it on a printer and save the file, then upload it here.</p>' +
        '<ul class="small" style="padding-left:18px;line-height:1.7">' +
        '<li>Lay the page flat and photograph it from directly above.</li>' +
        '<li>Let the page fill the frame, and keep your shadow off it.</li>' +
        '<li>Scanning instead? Choose <strong>JPEG</strong> if the machine offers a format.</li>' +
        '<li>You can add several pages at once, then put them in order with the arrows.</li></ul>'
    },
    photos: {
      title: 'Activity photos',
      body: '<p class="small">At least ' + MIN_PHOTOS + ' photos, printed four to a page.</p>' +
        '<ul class="small" style="padding-left:18px;line-height:1.7">' +
        '<li><strong>Landscape shots work best</strong> — they fill the frame on the page.</li>' +
        '<li>Portrait and square photos are fine too; they sit centred instead.</li>' +
        '<li>Nothing is written under them &mdash; the pictures print on their own.</li></ul>'
    },
    letters: {
      title: 'Letters and requirements',
      body: '<p class="small">One entry per document — letter of intent, permits, requests, replies.</p>' +
        '<ul class="small" style="padding-left:18px;line-height:1.7">' +
        '<li>Give each one a <strong>name</strong>; it becomes the heading in the report.</li>' +
        '<li>Add its pages in order. Use the arrows to move a page that went in wrong.</li></ul>'
    }
  };

  function howto(key) {
    var h = HOWTO[key];
    if (!h) return;
    UI.modal({
      title: h.title, body: h.body,
      footer: '<button type="button" class="btn btn-primary" data-close>Got it</button>'
    });
  }

  global.Accomplishment = {
    A4: A4, BOX: BOX, STEPS: STEPS, MIN_PHOTOS: MIN_PHOTOS,
    stepDone: stepDone, progress: progress, blockingReason: blockingReason,
    draftFor: draftFor, loadLetterhead: loadLetterhead, loadPdfFonts: loadPdfFonts, howto: howto,
    _state: function () { return wiz; },
    _setState: function (s) { wiz = s; },
    _warmCache: warmCache, _cache: cache, _allAssetIds: allAssetIds, C: C
  };
})(window);
