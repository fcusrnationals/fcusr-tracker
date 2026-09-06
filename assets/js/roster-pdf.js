/* Who can sign in, as a sheet of paper.

   The list was a .txt file, which is fine for a machine and wrong for a council:
   this is a document an adviser asks for, a President hands over, and somebody
   files. So it prints on the council's letterhead like everything else, with the
   two lists that actually matter kept apart — who holds an account, and who was
   enrolled and has never turned up.

   It carries no passwords and no tokens, because it holds none: this app never
   sees anybody's password. What it prints is the roster, which is exactly what a
   roster sheet should be. */
(function (global) {
  'use strict';

  var A = global.Accomplishment;
  var FONT = 'helvetica';

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

  function unitOf(row) {
    return (row.units && row.units.name) || row.unit_name || '';
  }

  function build(data) {
    var A4 = A.A4, BOX = A.BOX, C = A.C;
    var unitId = (global.Auth && Auth.signedIn()) ? Auth.myUnitId() : Store.nationalUnitId();

    return A.loadPdfFonts().then(function () {
      return A.loadLetterhead(unitId);
    }).then(function (letterhead) {
      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');

      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      registerFonts(doc);

      function bg() {
        if (!letterhead) return;
        try { doc.addImage(letterhead, 'JPEG', 0, 0, A4.w, A4.h, undefined, 'FAST'); }
        catch (e) { /* the sheet prints plain */ }
      }
      bg();

      var y = BOX.top;
      doc.setFont(FONT, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      doc.text('WHO CAN SIGN IN', A4.w / 2, y, { align: 'center' });
      y += 7;

      doc.setFont(FONT, 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      doc.text(Store.unitName(unitId) + '  ·  ' + U.fmtDate(U.today()), A4.w / 2, y, { align: 'center' });
      y += 10;

      var active = (data.roster || []).filter(function (p) { return p.active !== false; });
      var gone = (data.roster || []).filter(function (p) { return p.active === false; });
      var waiting = data.pending || [];

      function table(title, note, rows, head) {
        if (!rows.length) return;

        // Keep a heading with at least the first row of its table.
        if (y > A.BOX.bottomY - 34) { doc.addPage(); bg(); y = BOX.top; }

        doc.setFont(FONT, 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(C.goldDark[0], C.goldDark[1], C.goldDark[2]);
        doc.text(title + '  (' + rows.length + ')', BOX.left, y);
        y += 4.6;

        if (note) {
          doc.setFont(FONT, 'normal');
          doc.setFontSize(8.2);
          doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
          doc.text(note, BOX.left, y);
          y += 4.4;
        }

        doc.autoTable({
          startY: y,
          head: [head],
          body: rows,
          theme: 'grid',
          margin: { left: BOX.left, right: BOX.right, top: BOX.top, bottom: A4.h - BOX.bottomY },
          styles: {
            font: FONT, fontSize: 8.4, cellPadding: { top: 2.4, bottom: 2.4, left: 2.2, right: 2.2 },
            lineColor: C.line, lineWidth: 0.2, textColor: C.ink, overflow: 'linebreak'
          },
          headStyles: {
            font: FONT, fontStyle: 'bold', fontSize: 7.6, fillColor: C.goldPale,
            textColor: C.goldDark, lineColor: C.gold, lineWidth: 0.25
          },
          columnStyles: {
            0: { cellWidth: BOX.width * 0.30, fontStyle: 'bold' },
            1: { cellWidth: BOX.width * 0.24 },
            2: { cellWidth: BOX.width * 0.20 },
            3: { cellWidth: BOX.width * 0.26 }
          },
          /* The letterhead is a full-page opaque image. Drawn on the way out of
             a page it covers every row on it, which is a fault this project has
             shipped three times. Counted per table page, before anything is
             written, never by asking the document how many pages it has. */
          willDrawPage: function (d) { if (d.pageNumber > 1) bg(); }
        });

        y = (doc.lastAutoTable && doc.lastAutoTable.finalY) + 9;
      }

      table('Signed in', 'Holding an account they can use today.',
        active.map(function (p) {
          return [p.full_name || '—', p.position || '', unitOf(p), p.email || ''];
        }), ['Name', 'Position', 'Unit', 'Email']);

      table('Waiting to sign in',
        'Enrolled, but they have not set a password yet — until they do there is no account.',
        waiting.map(function (e) {
          return [e.full_name || '—', e.position || '', unitOf(e), e.email || ''];
        }), ['Name', 'Position', 'Unit', 'Email']);

      table('Withdrawn', 'They cannot sign in. Their work is untouched.',
        gone.map(function (p) {
          return [p.full_name || '—', p.position || '', unitOf(p), p.email || ''];
        }), ['Name', 'Position', 'Unit', 'Email']);

      if (!active.length && !waiting.length && !gone.length) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
        doc.text('Nobody has been enrolled yet.', BOX.left, y);
      }

      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
      doc.text('No passwords are held by this system, and none are printed here.',
        BOX.left, A4.h - 19);
      doc.text('Printed ' + U.fmtDate(U.today()), A4.w - BOX.right, A4.h - 19, { align: 'right' });

      return doc;
    });
  }

  function save(data) {
    return build(data).then(function (doc) {
      doc.save('FCUSR-WhoCanSignIn-' + U.today() + '.pdf');
      return doc;
    });
  }

  global.RosterPDF = { build: build, save: save };
})(window);
