/* The end-of-term record: every unit's accomplishment reports on one document.

   Links only, never files. A single accomplishment report has run to 320 MB;
   what belongs in a permanent record is the pointer to it, which costs a couple
   of hundred bytes and outlives the tracker.

   Units that have not filed are printed too, and said so plainly. A record that
   quietly omits the ones who did not comply is not a record. */
(function (global) {
  'use strict';

  var A = global.Accomplishment;
  var A4 = A.A4, BOX = A.BOX, C = A.C;
  var FONT = 'helvetica';
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

  function build() {
    var st = Store.termStatus();
    var org = Store.org();

    return Promise.all([A.loadLetterhead(), A.loadPdfFonts()]).then(function (res) {
      var letterhead = res[0];
      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');
      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      registerFonts(doc);

      // Which sheet each part of the record begins on, so the screens and the
      // tests can both point at it without counting pages by hand.
      var sections = { reports: 1 };

      bg(doc, letterhead);
      var y = BOX.top + 12;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(16);
      doc.setTextColor(C.goldDark[0], C.goldDark[1], C.goldDark[2]);
      doc.text('ACCOMPLISHMENT REPORTS', A4.w / 2, y, { align: 'center' });
      y += 9;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(12);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      doc.text('Record of the administration', A4.w / 2, y, { align: 'center' });
      y += 8;

      doc.setFont(FONT, 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      [
        org.name,
        st.declared ? 'Term closed ' + U.fmtDate(st.endDate) : 'No closing date declared',
        'Printed ' + U.fmtDate(U.today())
      ].filter(Boolean).forEach(function (line) {
        doc.text(String(line), A4.w / 2, y, { align: 'center' });
        y += 6;
      });
      y += 6;

      // The summary line first: how many units, how many still short.
      var rows = st.compliance || Store.compliance();
      var short = rows.filter(function (c) { return !c.complies; });
      doc.setFont(FONT, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      doc.text(rows.length + ' units · ' + (rows.length - short.length) + ' complete · ' +
        short.length + ' outstanding', BOX.left, y);
      y += 4;

      /* One table per unit, so a unit's record is never split across a heading
         that belongs to somebody else. */
      rows.forEach(function (c) {
        var evs = Store.events({ unitId: c.unit.id });
        var body = evs.map(function (e) {
          var r = Store.report(e.id);
          var finished = e.status === 'Completed' || e.status === 'Archived';
          var link = r && r.driveLink ? r.driveLink : '';
          return [
            e.title,
            U.fmtRange(e.dateStart, e.dateEnd),
            link || (finished ? 'NOT FILED' : 'NOT FINISHED')
          ];
        });
        if (!body.length) return;

        /* A table that cannot fit even its heading and one row in what is left
           of the sheet starts on the next one instead of being stranded against
           the bottom margin. */
        var startY = y + 6;
        if (startY > BOX.bottomY - 26) {
          doc.addPage();
          bg(doc, letterhead);
          startY = BOX.top;
        }

        doc.autoTable({
          startY: startY,
          head: [[
            c.unit.name + (c.complies ? '' : '   ·   OUTSTANDING'),
            '', ''
          ]],
          body: [['Activity', 'Dates', 'Accomplishment report']].concat(body),
          theme: 'grid',
          margin: { left: BOX.left, right: BOX.left, top: BOX.top, bottom: A4.h - BOX.bottomY },
          styles: {
            font: FONT, fontSize: 8, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
            lineColor: C.line, lineWidth: 0.15, textColor: C.ink, overflow: 'linebreak'
          },
          headStyles: {
            font: FONT, fontStyle: 'bold', fontSize: 9.5,
            fillColor: c.complies ? C.goldPale : [253, 235, 235],
            textColor: c.complies ? C.goldDark : [150, 40, 40],
            lineColor: c.complies ? C.gold : [200, 120, 120], lineWidth: 0.2
          },
          columnStyles: {
            0: { cellWidth: BOX.width * 0.40, fontStyle: 'bold' },
            1: { cellWidth: BOX.width * 0.22 },
            2: { cellWidth: BOX.width * 0.38 }
          },
          didParseCell: function (data) {
            // The column headings are a body row, so they are dressed as headings.
            if (data.row.index === 0 && data.section === 'body') {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.textColor = C.muted;
            }
            if (data.section === 'body' && data.column.index === 2 &&
                /^NOT /.test(String(data.cell.raw))) {
              data.cell.styles.textColor = [170, 40, 40];
              data.cell.styles.fontStyle = 'bold';
            }
          },
          /* Before the rows, never after — a full-page letterhead drawn last
             paints over everything it was meant to sit behind. The sheet this
             table starts on already carries it. */
          willDrawPage: function (data) {
            if (data.pageNumber > 1) bg(doc, letterhead);
          }
        });
        y = doc.lastAutoTable.finalY;
      });

      /* ---- the correspondence ----
         A turnover record is not only the reports. The next administration
         inherits letters that are still moving between offices, and standing
         directives nobody has closed — both vanish in the wipe unless they are
         written down here first. */
      var openLetters = Store.letters({ openOnly: true }).filter(function (l) {
        return !Store.isIndependent(l.unitId);
      });
      if (openLetters.length) {
        doc.addPage();
        sections.letters = doc.internal.getNumberOfPages();
        bg(doc, letterhead);
        var ly = BOX.top + 6;
        doc.setFont(FONT, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
        doc.text('LETTERS STILL IN CIRCULATION', A4.w / 2, ly, { align: 'center' });
        ly += 5;
        doc.setFont(FONT, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
        doc.text('Handed to the next administration as they stand.', A4.w / 2, ly + 4, { align: 'center' });
        ly += 12;

        doc.autoTable({
          startY: ly,
          head: [['Unit', 'Subject', 'Where it is', 'Carried by']],
          body: openLetters.map(function (l) {
            var u = Store.unit(l.unitId);
            return [u ? (u.code || u.name) : '—', l.subject,
              Store.letterWhere(l), Store.letterInCharge(l)];
          }),
          theme: 'grid',
          margin: { left: BOX.left, right: BOX.left, top: BOX.top, bottom: A4.h - BOX.bottomY },
          styles: {
            font: FONT, fontSize: 8.5, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
            lineColor: C.line, lineWidth: 0.15, textColor: C.ink, overflow: 'linebreak'
          },
          headStyles: {
            font: FONT, fontStyle: 'bold', fontSize: 7.6, fillColor: C.goldPale,
            textColor: C.goldDark, lineColor: C.gold, lineWidth: 0.2
          },
          columnStyles: {
            0: { cellWidth: BOX.width * 0.11 },
            1: { cellWidth: BOX.width * 0.37, fontStyle: 'bold' },
            2: { cellWidth: BOX.width * 0.32 },
            3: { cellWidth: BOX.width * 0.20 }
          },
          /* data.pageNumber counts pages of THIS table, not of the document.
             Testing the document's page count instead repaints the letterhead
             over the heading that was just drawn above the table — the sheet
             comes out with a table and no title. */
          willDrawPage: function (data) {
            if (data.pageNumber > 1) bg(doc, letterhead);
          }
        });
      }

      var directives = Store.tasks({ kind: 'directive' }).filter(Store.isPending);
      if (directives.length) {
        doc.addPage();
        sections.directives = doc.internal.getNumberOfPages();
        bg(doc, letterhead);
        var dy = BOX.top + 6;
        doc.setFont(FONT, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
        doc.text('STANDING DIRECTIVES NOT YET CLOSED', A4.w / 2, dy, { align: 'center' });
        dy += 12;

        doc.autoTable({
          startY: dy,
          head: [['Directive', 'Held by', 'Due', 'Status']],
          body: directives.sort(Store.byDueDate).map(function (t2) {
            return [t2.title, Store.personName(t2.assigneeId),
              t2.dueDate ? U.fmtDateTiny(t2.dueDate) : '—', t2.status];
          }),
          theme: 'grid',
          margin: { left: BOX.left, right: BOX.left, top: BOX.top, bottom: A4.h - BOX.bottomY },
          styles: {
            font: FONT, fontSize: 8.5, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
            lineColor: C.line, lineWidth: 0.15, textColor: C.ink, overflow: 'linebreak'
          },
          headStyles: {
            font: FONT, fontStyle: 'bold', fontSize: 7.6, fillColor: C.goldPale,
            textColor: C.goldDark, lineColor: C.gold, lineWidth: 0.2
          },
          columnStyles: {
            0: { cellWidth: BOX.width * 0.50, fontStyle: 'bold' },
            1: { cellWidth: BOX.width * 0.24 },
            2: { cellWidth: BOX.width * 0.12 },
            3: { cellWidth: BOX.width * 0.14 }
          },
          /* data.pageNumber counts pages of THIS table, not of the document.
             Testing the document's page count instead repaints the letterhead
             over the heading that was just drawn above the table — the sheet
             comes out with a table and no title. */
          willDrawPage: function (data) {
            if (data.pageNumber > 1) bg(doc, letterhead);
          }
        });
      }

      if (short.length) {
        var t = Store.term();
        doc.addPage();
        sections.outstanding = doc.internal.getNumberOfPages();
        bg(doc, letterhead);
        var ny = BOX.top + 6;
        doc.setFont(FONT, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
        doc.text('UNITS THAT HAVE NOT COMPLIED', A4.w / 2, ny, { align: 'center' });
        ny += 12;
        doc.setFont(FONT, 'normal');
        doc.setFontSize(10.5);
        short.forEach(function (c) {
          var why = [];
          if (c.outstanding.length) {
            why.push(U.plural(c.outstanding.length, 'activity', 'activities') + ' outstanding');
          }
          if (c.unvouched.length) {
            why.push(U.plural(c.unvouched.length, 'link') + ' on an unvouched drive');
          }
          doc.text('· ' + c.unit.name + ' — ' + why.join(', '), BOX.left, ny);
          ny += 6.5;
        });
        if (t.override) {
          ny += 6;
          doc.setFont(FONT, 'bold');
          doc.text('Passed over by decision of the National executives', BOX.left, ny);
          ny += 6;
          doc.setFont(FONT, 'normal');
          doc.splitTextToSize(t.override.reason + (t.override.by ? ' — ' + t.override.by : ''),
            BOX.width).forEach(function (ln) {
            doc.text(ln, BOX.left, ny);
            ny += 6;
          });
        }
      }

      var pages = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
        doc.text('Accomplishment Reports  ·  Page ' + i + ' of ' + pages,
          A4.w - BOX.right, FOOTER_Y, { align: 'right' });
      }

      return { doc: doc, pages: pages, outstanding: short.length, sections: sections };
    });
  }

  function filename() {
    return 'FCUSR-AccomplishmentReports-' + U.today() + '.pdf';
  }

  function save() {
    return build().then(function (out) {
      out.doc.save(filename());
      return out;
    });
  }

  global.TermPDF = { build: build, save: save, filename: filename };
})(window);
