/* The routing slip — the paper half of the letters tracker.

   A single sheet on the FCUSR letterhead, stapled to the letter itself, listing
   the offices it has to pass through with blank lines for each to sign. Offices
   already work this way; printing one means the paper trail and the digital one
   say the same thing, and it gives the person carrying the letter something to
   hand over rather than a phone screen to show.

   Stops already recorded are printed filled in, so a slip reprinted halfway
   round still reads as the letter's own history. */
(function (global) {
  'use strict';

  var A = global.Accomplishment;
  var A4 = A.A4, BOX = A.BOX, C = A.C;
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

  function build(letterId) {
    var l = Store.letter(letterId);
    if (!l) throw new Error('That letter no longer exists.');

    return A.loadPdfFonts().then(function () {
      return A.loadLetterhead();
    }).then(function (letterhead) {
      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');

      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      registerFonts(doc);
      if (letterhead) {
        try { doc.addImage(letterhead, 'JPEG', 0, 0, A4.w, A4.h, undefined, 'FAST'); } catch (e) { /* plain */ }
      }

      var y = BOX.top;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      doc.text('ROUTING SLIP', A4.w / 2, y, { align: 'center' });
      y += 11;

      // The subject, which is the only thing the offices need to recognise it by.
      doc.setFont(FONT, 'bold');
      doc.setFontSize(12);
      var lines = doc.splitTextToSize(l.subject, BOX.width);
      lines.forEach(function (ln) { doc.text(ln, BOX.left, y); y += 6.2; });
      y += 2;

      doc.setFont(FONT, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);

      var unit = Store.unit(l.unitId);
      var ev = l.eventId ? Store.event(l.eventId) : null;
      [
        'Carried by: ' + Store.letterInCharge(l),
        unit ? 'Unit: ' + unit.name : '',
        ev ? 'Activity: ' + ev.title : 'Council business',
        l.deadline ? 'Needed by: ' + U.fmtDate(l.deadline) : ''
      ].filter(Boolean).forEach(function (line) {
        doc.text(line, BOX.left, y);
        y += 5.4;
      });
      y += 5;

      /* Rows already recorded come through filled in; the rest are left blank
         for the office to complete by hand. Signature is always blank — this
         system never claims to hold anybody's signature. */
      var rows = l.stops.map(function (s, i) {
        var o = Store.office(s.officeId);
        return [
          String(i + 1),
          o ? o.name : 'Office',
          s.receivedBy || '',
          s.receivedAt ? U.fmtDateTiny(s.receivedAt) : '',
          s.outcome || '',
          ''
        ];
      });

      doc.autoTable({
        startY: y,
        head: [['#', 'Office', 'Received by', 'Date', 'Action taken', 'Signature']],
        body: rows,
        theme: 'grid',
        margin: { left: BOX.left, right: BOX.left, top: BOX.top, bottom: A4.h - BOX.bottomY },
        styles: {
          font: FONT, fontSize: 9, cellPadding: { top: 4.2, bottom: 4.2, left: 2.4, right: 2.4 },
          lineColor: C.line, lineWidth: 0.2, textColor: C.ink, overflow: 'linebreak',
          minCellHeight: 13
        },
        headStyles: {
          font: FONT, fontStyle: 'bold', fontSize: 8, fillColor: C.goldPale,
          textColor: C.goldDark, lineColor: C.gold, lineWidth: 0.25
        },
        columnStyles: {
          0: { cellWidth: BOX.width * 0.05, halign: 'center' },
          1: { cellWidth: BOX.width * 0.26, fontStyle: 'bold' },
          2: { cellWidth: BOX.width * 0.20 },
          3: { cellWidth: BOX.width * 0.11 },
          4: { cellWidth: BOX.width * 0.18 },
          5: { cellWidth: BOX.width * 0.20 }
        },
        // The letterhead goes down before the table, never after — drawn on the
        // way out it is an opaque image and covers every row beneath it.
        willDrawPage: function () {
          if (doc.internal.getNumberOfPages() > 1 && letterhead) {
            try { doc.addImage(letterhead, 'JPEG', 0, 0, A4.w, A4.h, undefined, 'FAST'); } catch (e) { /* plain */ }
          }
        }
      });

      var afterY = (doc.lastAutoTable && doc.lastAutoTable.finalY) || y;
      if (afterY + 20 < BOX.bottomY) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
        doc.text('Please return this slip with the letter. Each office fills in one row.',
          BOX.left, afterY + 8);
      }

      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
      doc.text('Routing slip  ·  printed ' + U.fmtDate(U.today()),
        A4.w - BOX.right, A4.h - 19, { align: 'right' });

      return { doc: doc, letter: l };
    });
  }

  function filename(l) {
    return 'FCUSR-RoutingSlip-' + U.slug(l.subject) + '-' + U.today() + '.pdf';
  }

  function save(letterId) {
    return build(letterId).then(function (out) {
      out.doc.save(filename(out.letter));
      return out;
    });
  }

  global.LetterSlip = { build: build, save: save, filename: filename };
})(window);
