/* The Term Report — one academic year, summarised.

   Fetched only when exported (views/archive.js). A concise administrative
   record for turnover, year-end reporting and the institution's files: how
   many activities there were and how they ended, the work inside them, the
   directives, the correspondence, the reports filed, and each unit's share.

   What it deliberately does not do: name officers, count what each person
   did, or rank anybody. A council hands this to the next administration and
   to the University; neither needs a leaderboard.

   Everything is counted from records that already exist, so the report and
   the screens can never disagree. The independent bodies are left out, as
   they are everywhere a National officer looks. */
(function (global) {
  'use strict';

  /* ---------- the numbers ---------- */

  function model(yid, unitId) {
    yid = yid || 'current';
    var year = Store.yearInfo(yid);
    var inYear = function (kind) { return function (r) { return Store.yearOf(kind, r) === yid; }; };
    var governed = {};
    Store.units({ governed: true }).forEach(function (u) { governed[u.id] = u; });
    var inScope = function (uid) { return unitId ? uid === unitId : !!governed[uid]; };

    var allEvents = Store.events({ kind: 'any' }).filter(inYear('event')).filter(function (e) { return inScope(e.unitId); });
    var activities = allEvents.filter(function (e) { return !Store.isDirectiveSet(e); });
    var sets = allEvents.filter(Store.isDirectiveSet);
    var actIds = {};
    activities.forEach(function (e) { actIds[e.id] = 1; });
    var setIds = {};
    sets.forEach(function (e) { setIds[e.id] = 1; });

    var tasks = Store.tasks().filter(function (t) { return actIds[t.eventId]; });
    var dirTasks = Store.tasks().filter(function (t) {
      if (setIds[t.eventId]) return true;
      return (t.kind || 'event') === 'directive' && inYear('task')(t) && inScope(t.unitId || Store.nationalUnitId());
    });
    var letters = Store.letters().filter(inYear('letter')).filter(function (l) { return inScope(l.unitId); });
    var announcements = unitId ? [] : Store.announcements().filter(inYear('announcement'))
      .filter(function (a) { return a.published !== false; });

    var by = function (list, test) { return list.filter(test).length; };
    var reportOf = function (e) { return Store.report(e.id); };
    var cancelled = activities.filter(Store.isCancelled);
    var held = activities.filter(function (e) { return !Store.isCancelled(e); });
    var completed = held.filter(function (e) { return e.status === 'Completed' || e.status === 'Archived'; });

    var volunteers = {};
    Store.people().forEach(function (p) {
      if (p.access !== 'volunteer') return;
      (p.eventIds || []).forEach(function (id) { if (actIds[id]) volunteers[p.id] = 1; });
    });

    var summary = [
      ['Activities', 'Total', activities.length],
      ['Activities', 'Completed', completed.length],
      ['Activities', 'Ongoing', by(held, function (e) { return e.status === 'Ongoing'; })],
      ['Activities', 'Upcoming', by(held, function (e) { return e.status === 'Upcoming'; })],
      ['Activities', 'Cancelled', cancelled.length],
      ['Tasks', 'Total', tasks.length],
      ['Tasks', 'Completed', by(tasks, function (t) { return t.status === 'Done'; })],
      ['Tasks', 'Outstanding', by(tasks, Store.isPending)],
      ['Tasks', 'Outstanding and past due', by(tasks, Store.isOverdue)],
      ['Directives', 'Directives with tasks', sets.length],
      ['Directives', 'Directive tasks in total', dirTasks.length],
      ['Directives', 'Completed', by(dirTasks, function (t) { return t.status === 'Done'; })],
      ['Directives', 'Still open', by(dirTasks, Store.isPending)],
      ['Letters', 'Tracked', letters.length],
      ['Letters', 'Approved', by(letters, function (l) { return l.status === 'Approved'; })],
      ['Letters', 'Declined', by(letters, function (l) { return l.status === 'Declined'; })],
      ['Letters', 'Withdrawn', by(letters, function (l) { return l.status === 'Withdrawn'; })],
      ['Letters', 'Still in circulation', by(letters, function (l) { return l.status === 'Routing'; })],
      ['Accomplishment reports', 'Filed (Drive link recorded)', by(held, function (e) { var r = reportOf(e); return !!(r && r.driveLink); })],
      ['Accomplishment reports', 'Started, not filed', by(held, function (e) { var r = reportOf(e); return !!(r && !r.driveLink); })],
      ['Accomplishment reports', 'Completed activities with no report yet', by(completed, function (e) { return !reportOf(e); })],
      ['Feedback forms', 'Linked', by(held, function (e) { return !!e.feedbackLink; })],
      ['Feedback forms', 'Waived, with a reason', by(held, function (e) { return e.feedbackRequired === false; })],
      ['Feedback forms', 'Still missing', by(held, Store.needsFeedback)],
      ['Volunteers', 'Taken on for these activities', Object.keys(volunteers).length]
    ];
    if (!unitId) summary.push(['Bulletin Board', 'Announcements published', announcements.length]);

    // Each unit's share. Counts of work, never of people.
    var unitRows = Object.keys(governed).map(function (id) { return governed[id]; }).filter(function (u) {
      return inScope(u.id);
    }).map(function (u) {
      var evs = activities.filter(function (e) { return e.unitId === u.id; });
      var ids = {};
      evs.forEach(function (e) { ids[e.id] = 1; });
      var ts = tasks.filter(function (t) { return ids[t.eventId]; });
      var heldU = evs.filter(function (e) { return !Store.isCancelled(e); });
      return {
        unit: u,
        activities: evs.length,
        completed: heldU.filter(function (e) { return e.status === 'Completed' || e.status === 'Archived'; }).length,
        tasksDone: ts.filter(function (t) { return t.status === 'Done'; }).length,
        tasks: ts.length,
        filed: heldU.filter(function (e) { var r = reportOf(e); return !!(r && r.driveLink); }).length,
        owed: heldU.length
      };
    }).filter(function (r) { return r.activities > 0 || unitId; })
      .sort(function (a, b) { return Store.units().indexOf(a.unit) - Store.units().indexOf(b.unit); });

    var activityRows = activities.slice().sort(function (a, b) {
      return (a.dateStart || '9') < (b.dateStart || '9') ? -1 : 1;
    }).map(function (e) {
      var s = Store.eventStats(e.id);
      var r = reportOf(e);
      var u = Store.unit(e.unitId);
      return {
        title: e.title, unit: u ? (u.code || u.name) : '', dates: U.fmtRange(e.dateStart, e.dateEnd),
        status: e.status, tasks: s.done + ' of ' + s.total,
        report: Store.isCancelled(e) ? 'Not owed (cancelled)' : r && r.driveLink ? 'Filed' : r ? 'Started' :
          (e.status === 'Completed' || e.status === 'Archived') ? 'Not started' : 'After the activity',
        link: r && r.driveLink ? r.driveLink : ''
      };
    });

    return {
      year: year, yid: yid, scope: unitId ? Store.unitName(unitId) : 'The whole Republic',
      summary: summary, units: unitRows, activities: activityRows,
      openDirectives: dirTasks.filter(Store.isPending).sort(Store.byDueDate),
      openLetters: letters.filter(function (l) { return l.status === 'Routing'; })
    };
  }

  function stem(m) {
    return 'FCUSR-TermReport-AY' + String(m.year.label).replace(/[^0-9]+/g, '-') +
      (m.scope !== 'The whole Republic' ? '-' + U.slug(m.scope) : '') + '-' + U.today();
  }

  /* ---------- the spreadsheet ---------- */

  function cell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    // A cell beginning with = + - or @ is a formula to a spreadsheet; this one is only ever text.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function line(arr) { return arr.map(cell).join(','); }

  function csv(yid, unitId) {
    var m = model(yid, unitId);
    var rows = [];
    rows.push(line(['FCUSR Term Report', 'AY ' + m.year.label]));
    rows.push(line(['Covering', m.scope]));
    rows.push(line(['Printed', U.fmtDate(U.today())]));
    rows.push('');
    rows.push(line(['Section', 'Measure', 'Count']));
    m.summary.forEach(function (r) { rows.push(line(r)); });
    rows.push('');
    rows.push(line(['Unit', 'Activities', 'Completed', 'Tasks done', 'Tasks in total', 'Reports filed', 'Reports owed']));
    m.units.forEach(function (r) {
      rows.push(line([r.unit.name, r.activities, r.completed, r.tasksDone, r.tasks, r.filed, r.owed]));
    });
    rows.push('');
    rows.push(line(['Activity', 'Unit', 'Dates', 'Status', 'Tasks done', 'Accomplishment report', 'Report link']));
    m.activities.forEach(function (a) {
      rows.push(line([a.title, a.unit, a.dates, a.status, a.tasks, a.report, a.link]));
    });
    // A byte-order mark, so Excel reads the accents and dashes correctly.
    return { text: '﻿' + rows.join('\r\n') + '\r\n', name: stem(m) + '.csv', model: m };
  }

  function saveCsv(yid, unitId) {
    var out = csv(yid, unitId);
    UI.downloadFile(out.name, out.text, 'text/csv;charset=utf-8');
    return Promise.resolve(out);
  }

  /* ---------- the PDF ----------
     A4 portrait on the council's letterhead, like the end-of-term record, and
     built the same way: the letterhead drawn BEFORE the rows on every sheet a
     table spills onto (willDrawPage, counted per table), never after. */

  function pdf(yid, unitId) {
    var A = global.Accomplishment;
    if (!A) return Promise.reject(new Error('The report tools did not load.'));
    var A4 = A.A4, BOX = A.BOX, C = A.C;
    var m = model(yid, unitId);
    var org = Store.org();
    var FONT = 'helvetica';

    return Promise.all([A.loadLetterhead(), A.loadPdfFonts()]).then(function (res) {
      var letterhead = res[0];
      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');
      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      var f = global.FCU_PDF_FONTS;
      if (f) {
        try {
          doc.addFileToVFS('Montserrat-Regular.ttf', f.regular);
          doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
          doc.addFileToVFS('Montserrat-Bold.ttf', f.bold);
          doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
          FONT = 'Montserrat';
        } catch (e) { FONT = 'helvetica'; }
      }
      var bg = function () {
        if (!letterhead) return;
        try { doc.addImage(letterhead, 'JPEG', 0, 0, A4.w, A4.h, undefined, 'FAST'); } catch (e) { /* plain */ }
      };
      var table = function (startY, head, body, widths, extra) {
        var opts = {
          startY: startY, head: [head], body: body, theme: 'grid',
          margin: { left: BOX.left, right: BOX.left, top: BOX.top, bottom: A4.h - BOX.bottomY },
          styles: { font: FONT, fontSize: 8.5, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
                    lineColor: C.line, lineWidth: 0.15, textColor: C.ink, overflow: 'linebreak' },
          headStyles: { font: FONT, fontStyle: 'bold', fontSize: 7.8, fillColor: C.goldPale,
                        textColor: C.goldDark, lineColor: C.gold, lineWidth: 0.2 },
          columnStyles: {},
          willDrawPage: function (data) { if (data.pageNumber > 1) bg(); }
        };
        widths.forEach(function (w, i) { opts.columnStyles[i] = { cellWidth: BOX.width * w }; });
        Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
        doc.autoTable(opts);
        return doc.lastAutoTable.finalY;
      };
      var heading = function (text, y) {
        doc.setFont(FONT, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
        doc.text(text, BOX.left, y);
        return y + 3;
      };
      var fresh = function () { doc.addPage(); bg(); return BOX.top + 6; };

      bg();
      var y = BOX.top + 12;
      doc.setFont(FONT, 'bold');
      doc.setFontSize(16);
      doc.setTextColor(C.goldDark[0], C.goldDark[1], C.goldDark[2]);
      doc.text('TERM REPORT', A4.w / 2, y, { align: 'center' });
      y += 8;
      doc.setFontSize(12);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      doc.text('Academic Year ' + m.year.label, A4.w / 2, y, { align: 'center' });
      y += 7;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      [org.name, m.scope, (m.yid === 'current' ? 'The year so far · ' : '') + 'Printed ' + U.fmtDate(U.today())]
        .filter(Boolean).forEach(function (t) {
          doc.text(String(t), A4.w / 2, y, { align: 'center' });
          y += 5.5;
        });
      y += 4;

      // The summary, grouped by section.
      y = heading('Summary', y + 2);
      var rows = [];
      var last = '';
      m.summary.forEach(function (r) {
        rows.push([r[0] === last ? '' : r[0], r[1], String(r[2])]);
        last = r[0];
      });
      y = table(y + 1, ['Area', 'Measure', 'Count'], rows, [0.3, 0.55, 0.15], {
        didParseCell: function (d) {
          if (d.section === 'body' && d.column.index === 0) d.cell.styles.fontStyle = 'bold';
          if (d.section === 'body' && d.column.index === 2) d.cell.styles.halign = 'right';
        }
      });

      if (m.units.length) {
        y = y + 10 > BOX.bottomY - 30 ? fresh() : y + 10;
        y = heading('Units', y);
        y = table(y + 1, ['Unit', 'Activities', 'Completed', 'Tasks done', 'Reports filed'],
          m.units.map(function (r) {
            return [r.unit.name, String(r.activities), String(r.completed),
              r.tasksDone + ' of ' + r.tasks, r.filed + ' of ' + r.owed];
          }), [0.4, 0.14, 0.14, 0.16, 0.16]);
      }

      if (m.activities.length) {
        y = fresh();
        y = heading('Activities', y);
        table(y + 1, ['Activity', 'Unit', 'Dates', 'Status', 'Tasks', 'Report'],
          m.activities.map(function (a) { return [a.title, a.unit, a.dates, a.status, a.tasks, a.report]; }),
          [0.32, 0.1, 0.2, 0.12, 0.1, 0.16], {
            didParseCell: function (d) {
              if (d.section === 'body' && d.column.index === 5 && /^Not started/.test(String(d.cell.raw))) {
                d.cell.styles.textColor = [170, 40, 40];
                d.cell.styles.fontStyle = 'bold';
              }
            }
          });
      }

      /* What the next administration inherits unfinished. Titles and where
         they stand; still no names beyond the office carrying a letter. */
      if (m.openDirectives.length || m.openLetters.length) {
        y = fresh();
        if (m.openDirectives.length) {
          y = heading('Directives still open', y);
          y = table(y + 1, ['Directive', 'Due', 'Status'], m.openDirectives.map(function (t) {
            var set = Store.event(t.eventId);
            return [(set ? set.title + ' — ' : '') + t.title, t.dueDate ? U.fmtDateTiny(t.dueDate) : '—', t.status];
          }), [0.66, 0.14, 0.2]) + 10;
        }
        if (m.openLetters.length) {
          if (y > BOX.bottomY - 30) y = fresh();
          y = heading('Letters still in circulation', y);
          table(y + 1, ['Subject', 'Where it is'], m.openLetters.map(function (l) {
            return [l.subject, Store.letterWhere(l)];
          }), [0.55, 0.45]);
        }
      }

      var pages = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
        doc.text('Term Report · AY ' + m.year.label + '  ·  Page ' + i + ' of ' + pages,
          A4.w - BOX.right, A4.h - 19, { align: 'right' });
      }
      return { doc: doc, name: stem(m) + '.pdf', model: m, pages: pages };
    });
  }

  function savePdf(yid, unitId) {
    return pdf(yid, unitId).then(function (out) {
      out.doc.save(out.name);
      return out;
    });
  }

  global.TermReport = { model: model, csv: csv, saveCsv: saveCsv, pdf: pdf, savePdf: savePdf };
})(window);
