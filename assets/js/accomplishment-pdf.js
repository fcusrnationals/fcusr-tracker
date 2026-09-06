/* Accomplishment Report → PDF.

   A4 portrait on the FCUSR letterhead. Two rules govern the layout:

   1. Every section starts on its own page. A letter of intent must never share a
      sheet with the tail of the programme flow — these are separate documents
      that get read, signed and filed separately.
   2. Page 1 is always the generated cover. The content begins on page 2.

   build() also returns a map of section → page number, so the wizard can show a
   live preview of the page you are actually working on. */
(function (global) {
  'use strict';

  var A = global.Accomplishment;
  var A4 = A.A4, BOX = A.BOX, C = A.C;
  var FONT = 'helvetica';

  /* The letterhead art occupies the top and bottom of the sheet. Body text lives
     between them; the footer line sits just above the bottom artwork. */
  var FOOTER_Y = A4.h - 19;

  function registerFonts(doc) {
    var f = global.FCU_PDF_FONTS;
    if (!f) { FONT = 'helvetica'; return; }
    try {
      doc.addFileToVFS('Montserrat-Regular.ttf', f.regular);
      doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
      doc.addFileToVFS('Montserrat-Bold.ttf', f.bold);
      doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
      FONT = 'Montserrat';
    } catch (e) { FONT = 'helvetica'; }
  }

  function bg(doc, letterhead) {
    if (!letterhead) return;
    try { doc.addImage(letterhead, 'JPEG', 0, 0, A4.w, A4.h, undefined, 'FAST'); } catch (e) { /* plain */ }
  }

  /* ---------- text ---------- */

  /* Justified body text, set by hand.

     jsPDF's own align:'justify' only stretches a line when it is given the whole
     block at once, and it silently leaves a single line alone — which is why
     drawing line by line came out flush left however the option was set. So the
     spacing is worked out here instead: the words of a line are measured, the
     slack is shared out between the gaps, and each word is placed at its own x.

     The last line of a paragraph is never stretched — that is what makes
     justified text look justified rather than broken. */
  function justifyLine(doc, line, x, y, width) {
    var words = String(line).split(/\s+/).filter(Boolean);
    if (words.length < 2) { doc.text(line, x, y); return; }

    var wordsW = 0;
    words.forEach(function (w) { wordsW += doc.getTextWidth(w); });
    var gap = (width - wordsW) / (words.length - 1);

    // A line with only a word or two on it would be pulled apart into a row of
    // islands. Past four normal spaces, leave it flush left.
    if (gap <= 0 || gap > doc.getTextWidth(' ') * 4) { doc.text(line, x, y); return; }

    var cx = x;
    words.forEach(function (w, i) {
      doc.text(w, cx, y);
      if (i < words.length - 1) cx += doc.getTextWidth(w) + gap;
    });
  }

  function paragraph(doc, text, x, y, width, opts) {
    opts = opts || {};
    var size = opts.size || 12;
    var lead = opts.lead || 6.6;
    doc.setFont(FONT, opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    var col = opts.color || C.ink;
    doc.setTextColor(col[0], col[1], col[2]);

    /* Typed paragraphs are kept apart: each one's own closing line stays flush
       left, instead of only the very last line of the whole passage. */
    var paras = String(text).split(/\n+/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length; });

    paras.forEach(function (para, pi) {
      var lines = doc.splitTextToSize(para, width);
      lines.forEach(function (line, i) {
        var last = i === lines.length - 1;
        if (opts.justify && !last) justifyLine(doc, line, x, y, width);
        else doc.text(line, x, y);
        y += lead;
      });
      if (pi < paras.length - 1) y += lead * 0.5;
    });
    return y;
  }

  /* Centred, no underline. The gold rules read as stray marks on the letterhead,
     which already carries the branding. */
  function sectionTitle(doc, text, y) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.text(String(text).toUpperCase(), A4.w / 2, y, { align: 'center' });
    return y + 12;
  }

  /* ---------- images ---------- */

  function place(doc, dataUrl, x, y, boxW, boxH) {
    var props;
    try { props = doc.getImageProperties(dataUrl); } catch (e) { return 0; }
    var scale = Math.min(boxW / props.width, boxH / props.height);
    var w = props.width * scale, h = props.height * scale;
    try {
      doc.addImage(dataUrl, 'JPEG', x + (boxW - w) / 2, y + (boxH - h) / 2, w, h, undefined, 'FAST');
    } catch (e) { return 0; }
    return h;
  }

  /* ---------- the document ---------- */

  function build(eventId, draft) {
    var e = Store.event(eventId);
    if (!e) throw new Error('That event no longer exists.');
    var report = draft || Store.report(eventId);
    if (!report) throw new Error('There is no report for this event yet.');

    var ids = A._allAssetIds(report);
    return Promise.all([A.loadLetterhead(), AssetDB.getMany(ids), A.loadPdfFonts()]).then(function (res) {
      var letterhead = res[0];
      var images = {};
      res[1].forEach(function (r) { if (r.dataUrl) images[r.id] = r.dataUrl; });

      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');
      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      registerFonts(doc);

      var headName = e.headId ? Store.personName(e.headId) : '';
      var pageMap = {};
      var started = false;

      // Opens a fresh page for a section and records where it began.
      function startSection(key, title) {
        if (started) doc.addPage(); else started = true;
        bg(doc, letterhead);
        pageMap[key] = doc.internal.getNumberOfPages();
        return title ? sectionTitle(doc, title, BOX.top) : BOX.top;
      }

      // A continuation page inside the same section.
      function continuePage() {
        doc.addPage();
        bg(doc, letterhead);
        return BOX.top;
      }

      /* ---- page 1: the cover, generated from the tracker ---- */
      startSection('cover');
      var y = BOX.top + 14;      // clear of the letterhead art

      doc.setFont(FONT, 'bold');
      doc.setFontSize(17);
      doc.setTextColor(C.goldDark[0], C.goldDark[1], C.goldDark[2]);
      doc.text('ACCOMPLISHMENT REPORT', A4.w / 2, y, { align: 'center' });
      y += 16;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(22);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      var titleLines = doc.splitTextToSize(e.title, BOX.width);
      titleLines.forEach(function (ln) { doc.text(ln, A4.w / 2, y, { align: 'center' }); y += 10; });
      y += 8;

      // Event particulars, centred as a block.
      doc.setFont(FONT, 'normal');
      doc.setFontSize(12);
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      [
        U.fmtRange(e.dateStart, e.dateEnd),
        e.venue,
        headName ? 'Event Head: ' + headName : ''
      ].filter(Boolean).forEach(function (line) {
        doc.text(line, A4.w / 2, y, { align: 'center' });
        y += 7.5;
      });

      /* ---- signatories, laid out the way the council writes them ----
         A label, a gap to sign in, then the name in bold with the position
         underneath. Positions for "Noted" are fixed; the names are not. */
      var sig = report.signatories || {};
      var prep = sig.preparedBy || { name: '', position: '' };
      var pres = sig.president || { name: '', show: true };
      var adv = sig.adviser || { name: '' };
      var others = sig.others || [];

      function signatory(x, yy, name, position) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
        doc.text((name || '').toUpperCase(), x, yy);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
        doc.text(position || '', x, yy + 5.5);
      }

      function label(x, yy, text) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(11);
        doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
        doc.text(text, x, yy);
      }

      // The president does not sign twice: if they wrote it, the slot is dropped.
      var noted = [];
      if (pres.show !== false && pres.name) noted.push([pres.name, 'President, FCUSR Nationals']);
      if (adv.name) noted.push([adv.name, 'Adviser, FCUSR Nationals']);
      others.forEach(function (o) { if (o.name) noted.push([o.name, o.position]); });

      /* Two to a row, and the block grows upward from the bottom margin as names
         are added — so a report with five signatories sits on the page the same
         way one with two does, instead of running off the bottom of the sheet. */
      var rows = Math.ceil(noted.length / 2);
      var rightX = BOX.left + BOX.width / 2 + 6;
      var rowGap = 26;
      var sy = BOX.bottomY - 56 - (rows ? 18 + rows * rowGap : 0);

      label(BOX.left, sy, 'Prepared by:');
      signatory(BOX.left, sy + 18, prep.name, prep.position);

      if (noted.length) {
        label(BOX.left, sy + 38, 'Noted:');
        noted.forEach(function (n, i) {
          var col = i % 2 === 0 ? BOX.left : rightX;
          var row = Math.floor(i / 2);
          signatory(col, sy + 56 + row * rowGap, n[0], n[1]);
        });
      }

      /* ---- page 2 onwards: the letter of intent comes first ---- */
      /* A section is only worth a sheet if something will actually be drawn on
         it. Entries whose pictures are missing — a scan that failed to load, or
         one deleted from storage — are dropped before the page is opened, which
         is what used to leave a titled page with nothing under it. */
      function documentSection(key, title, items) {
        items = items.filter(function (item) {
          return (item.assets || []).some(function (id) { return !!images[id]; });
        }).map(function (item) {
          return {
            heading: item.heading,
            assets: item.assets.filter(function (id) { return !!images[id]; })
          };
        });
        if (!items.length) return;
        var yy = startSection(key, title);
        items.forEach(function (item, i) {
          if (item.heading) {
            if (i > 0) yy = continuePage();
            doc.setFont(FONT, 'bold');
            doc.setFontSize(11);
            doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
            doc.text(item.heading, BOX.left, yy);
            yy += 7;
          }
          item.assets.forEach(function (id, j) {
            // One scanned page per sheet, so nothing is cramped.
            if (j > 0 || (!item.heading && i > 0)) yy = continuePage();
            place(doc, images[id], BOX.left, yy, BOX.width, BOX.bottomY - yy);
          });
        });
      }

      documentSection('letters', 'Letter of Intent and Documentary Requirements',
        report.letters.map(function (l) { return { heading: l.name, assets: l.assets }; }));

      /* ---- summary of the activity ---- */
      if (report.description && report.description.trim()) {
        var dy = startSection('description', 'Summary of the Activity');
        paragraph(doc, report.description, BOX.left, dy, BOX.width,
          { justify: true, size: 12, lead: 6.8 });
      }

      /* ---- programme flow ---- */
      documentSection('program', 'Program Flow', [{ assets: report.program.assets }]);

      /* ---- photos ---- */
      var shownPhotos = report.photos.filter(function (p) { return !!images[p.assetId]; });
      if (shownPhotos.length) {
        var py = startSection('photos', 'Photo Documentation');
        var cols = 2, gap = 8, rowGap = 10;
        var cellW = (BOX.width - gap) / cols;
        /* Four to a page, in a 2 x 2 grid, and nothing written underneath — the
           pictures speak for themselves and the council does not caption them.
           The cells are 4:3 landscape because that is the shape phones actually
           produce (4032 x 3024); a portrait shot still fits, it simply sits
           centred with white either side. */
        var rowsPerPage = 2;
        var cellH = Math.min(cellW * 0.75,
          ((BOX.bottomY - py) - rowGap) / rowsPerPage);

        shownPhotos.forEach(function (p, i) {
          var slot = i % (cols * rowsPerPage);
          if (i > 0 && slot === 0) py = continuePage();
          var col = slot % cols;
          var rowY = py + Math.floor(slot / cols) * (cellH + rowGap);
          var x = BOX.left + col * (cellW + gap);

          doc.setFillColor(247, 247, 245);
          doc.rect(x, rowY, cellW, cellH, 'F');
          place(doc, images[p.assetId], x, rowY, cellW, cellH);
          doc.setDrawColor(C.line[0], C.line[1], C.line[2]);
          doc.setLineWidth(0.2);
          doc.rect(x, rowY, cellW, cellH);
        });
      }

      /* ---- minutes ---- */
      if (report.minutes.mode === 'tasks') {
        var rows = Store.tasks({ eventId: eventId }).slice().sort(function (a, b) {
          return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
        }).map(function (t) {
          /* Three date columns on a portrait sheet is a squeeze, and
             "Aug 22, 2026" wraps onto two lines in every one of them. The year
             is dropped here because the cover page already states when the
             activity ran — inside one activity there is nothing to confuse. */
          return [
            // When the task was given out, not only when it fell due: the two
            // together are what show how long the council actually had.
            t.createdAt ? U.fmtDateTiny(t.createdAt.slice(0, 10)) : '—',
            t.dueDate ? U.fmtDateTiny(t.dueDate) : '—',
            t.title,
            Store.personName(t.assigneeId),
            t.status,
            t.completedAt ? U.fmtDateTiny(t.completedAt.slice(0, 10)) : ''
          ];
        });
        if (rows.length) {
          /* Drawn from the tracker rather than a stenographer: it records what was
             agreed, who took it and when it was due. Titled honestly so nobody
             mistakes it for actual minutes. */
          var my = startSection('minutes', 'Task Assignment and Deliberation');
          var firstTablePage = doc.internal.getNumberOfPages();
          doc.autoTable({
            startY: my,
            head: [['Assigned', 'Deadline', 'Task', 'Assigned to', 'Status', 'Completed']],
            body: rows,
            theme: 'grid',
            margin: { left: BOX.left, right: BOX.left, top: BOX.top, bottom: A4.h - BOX.bottomY },
            styles: {
              font: FONT, fontSize: 8.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
              lineColor: C.line, lineWidth: 0.15, textColor: C.ink, overflow: 'linebreak'
            },
            /* Six columns on a portrait sheet leaves the headings the tightest
               thing on the page, so they are set a little smaller than the rows
               and given narrower gutters. The alternative was abbreviating them,
               which costs a reader more than a point of type does. */
            headStyles: {
              font: FONT, fontStyle: 'bold', fontSize: 7.2, fillColor: C.goldPale,
              textColor: C.goldDark, lineColor: C.gold, lineWidth: 0.2,
              cellPadding: { top: 1.6, bottom: 1.6, left: 1.4, right: 1.4 }
            },
            columnStyles: {
              0: { cellWidth: BOX.width * 0.10 },
              1: { cellWidth: BOX.width * 0.10 },
              2: { cellWidth: BOX.width * 0.325, fontStyle: 'bold' },
              3: { cellWidth: BOX.width * 0.205 },
              4: { cellWidth: BOX.width * 0.135 },
              5: { cellWidth: BOX.width * 0.135 }
            },
            /* The letterhead has to go down BEFORE the table, not after: it is a
               full-page opaque image, so drawing it on the way out covered every
               row that had just been printed and the sheet came out looking
               blank. The section's own first page already carries it. */
            willDrawPage: function () {
              if (doc.internal.getNumberOfPages() !== firstTablePage) bg(doc, letterhead);
            }
          });
        }
      } else if (report.minutes.mode === 'upload') {
        documentSection('minutes', 'Minutes of the Meeting', [{ assets: report.minutes.assets }]);
      }

      /* ---- liquidation ---- */
      documentSection('liquidation', 'Liquidation', [{ assets: report.liquidation ? report.liquidation.assets : [] }]);

      /* ---- evaluation ---- */
      documentSection('evaluation', 'Evaluation Results', [{ assets: report.evaluation.assets }]);

      /* ---- no sheet leaves with nothing on it ----
         The sections above are careful not to open a page they cannot fill, but
         a page can still come out empty for reasons this code does not control —
         a table that breaks exactly on a boundary, or a picture the PDF library
         refuses at the last moment. So the finished document is read back before
         the footers go on: a sheet carrying only the letterhead is removed, and
         the section-to-page map is corrected to match. */
      var blanksRemoved = pruneEmptyPages();

      function pageIsEmpty(i) {
        var stream = (doc.internal.pages[i] || []).join('\n');
        if (/\bT[jJ]\b/.test(stream)) return false;     // any text at all
        if (/\bre\b/.test(stream)) return false;        // any box, rule or fill
        // One drawn image is the letterhead itself; two means real content.
        return (stream.match(/\/[A-Za-z0-9]+ Do/g) || []).length <= 1;
      }

      function pruneEmptyPages() {
        var removed = [];
        // Backwards, so deleting a page cannot renumber the ones still to check.
        for (var i = doc.internal.getNumberOfPages(); i > 1; i--) {
          if (pageIsEmpty(i)) { doc.deletePage(i); removed.push(i); }
        }
        if (!removed.length) return 0;
        Object.keys(pageMap).forEach(function (k) {
          var n = pageMap[k];
          if (removed.indexOf(n) >= 0) { delete pageMap[k]; return; }
          pageMap[k] = n - removed.filter(function (r) { return r < n; }).length;
        });
        return removed.length;
      }

      /* ---- footers: title and page number, bottom right ---- */
      var pages = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
        doc.text(e.title + '  ·  Page ' + i + ' of ' + pages,
          A4.w - BOX.right, FOOTER_Y, { align: 'right' });
      }

      return {
        doc: doc,
        model: { event: e, report: report, images: images, headName: headName },
        pageMap: pageMap,
        pages: pages,
        blanksRemoved: blanksRemoved
      };
    });
  }

  function filename(e) {
    return 'FCUSR-AccomplishmentReport-' + U.slug(e.title) + '-' + U.today() + '.pdf';
  }

  function save(eventId, draft) {
    return build(eventId, draft).then(function (out) {
      out.doc.save(filename(out.model.event));
      return out;
    });
  }

  // The wizard shows this in a frame, jumping to the page for the current step.
  function previewURL(eventId, draft) {
    return build(eventId, draft).then(function (out) {
      return { url: out.doc.output('bloburl'), pages: out.pages, pageMap: out.pageMap };
    });
  }

  global.AccomplishmentPDF = {
    build: build, save: save, previewURL: previewURL, filename: filename
  };
})(window);
