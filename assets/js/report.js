/* Event Task Report — the council's paper record.
   One event per document, printed in colour on 345 mm × 215 mm ("Indian Legal")
   landscape. Page geometry is declared in exactly two places that must agree:
   PAGE below, and the @page rule in assets/css/print.css. */
(function (global) {
  'use strict';

  /* ---------- page geometry (mm) ---------- */

  /* Paper. Long bond is the default because that is what the council prints on.
     Everything downstream is expressed as a fraction of the printable width, so
     changing paper does not require re-tuning a single column. */
  var PAPERS = {
    longbond:    { w: 330, h: 216, label: 'Long bond (8.5 × 13 in), landscape' },
    indianLegal: { w: 345, h: 215, label: 'Indian Legal (215 × 345 mm), landscape' },
    a4:          { w: 297, h: 210, label: 'A4, landscape' },
    letter:      { w: 279, h: 216, label: 'Letter (8.5 × 11 in), landscape' }
  };

  var PAGE = {
    width: 330, height: 216,
    marginX: 12, marginTop: 10, marginBottom: 10,
    footerH: 11
  };
  PAGE.contentW = PAGE.width - PAGE.marginX * 2;

  function usePaper(key) {
    var p = PAPERS[key] || PAPERS.longbond;
    PAGE.width = p.w;
    PAGE.height = p.h;
    PAGE.contentW = p.w - PAGE.marginX * 2;
    return PAGE;
  }

  // Column widths are ratios of the printable width, not millimetres.
  function share(ratios) {
    return ratios.map(function (r) { return r * PAGE.contentW; });
  }

  /* ---------- colours (mirror the CSS custom properties exactly) ---------- */

  var C = {
    gold: [201, 162, 39], goldDark: [126, 98, 16], goldPale: [253, 250, 241], goldLine: [235, 217, 160],
    ink: [23, 23, 27], ink2: [69, 69, 79], muted: [113, 113, 127],
    line: [214, 214, 209], white: [255, 255, 255], track: [232, 230, 222],
    zebra: [250, 250, 248],
    rowOverdue: [253, 238, 238], rowDone: [240, 247, 242],
    status: {
      'Not Started': { fg: [75, 85, 99], bg: [242, 242, 240] },
      'In Progress': { fg: [29, 78, 216], bg: [233, 239, 253] },
      'For Review': { fg: [154, 83, 9], bg: [252, 242, 227] },
      'Done': { fg: [21, 109, 59], bg: [230, 244, 234] },
      'On hold': { fg: [185, 62, 18], bg: [253, 236, 227] }
    },
    overdue: [196, 33, 33],
    priority: { High: [179, 38, 30], Medium: [69, 69, 79], Low: [113, 113, 127] }
  };

  var FONT = 'helvetica';   // replaced by 'Montserrat' once the embedded font loads
  var fontsPromise = null;

  /* Montserrat is ~500 KB of base64, so it only loads the first time a report is made. */
  function loadFonts() {
    if (global.FCU_PDF_FONTS) return Promise.resolve(true);
    if (fontsPromise) return fontsPromise;
    fontsPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'vendor/montserrat-pdf-fonts.js';
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };   // fall back to Helvetica
      document.head.appendChild(s);
    });
    return fontsPromise;
  }

  function registerFonts(doc) {
    var f = global.FCU_PDF_FONTS;
    if (!f) { FONT = 'helvetica'; return; }
    try {
      doc.addFileToVFS('Montserrat-Regular.ttf', f.regular);
      doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
      doc.addFileToVFS('Montserrat-Bold.ttf', f.bold);
      doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
      FONT = 'Montserrat';
    } catch (e) {
      console.warn('Montserrat could not be embedded; using Helvetica.', e);
      FONT = 'helvetica';
    }
  }

  /* ---------- report model (shared by the PDF and the print fallback) ---------- */

  function buildModel(eventId, pendingOnly) {
    var e = Store.event(eventId);
    if (!e) throw new Error('That event no longer exists.');

    var all = Store.tasks({ eventId: eventId });
    var overall = Store.stats(all);
    var included = pendingOnly ? all.filter(Store.isPending) : all;

    // One group per officer with tasks in this event; Unassigned always last.
    var map = {}, order = [];
    included.forEach(function (t) {
      var key = t.assigneeId || '';
      if (!map[key]) { map[key] = []; order.push(key); }
      map[key].push(t);
    });

    var groups = order.map(function (key) {
      var p = key ? Store.person(key) : null;
      var list = map[key];
      var pending = list.filter(Store.isPending).sort(Store.byDueDate);
      var done = list.filter(function (t) { return t.status === 'Done'; }).sort(function (a, b) {
        return (a.completedAt || '').localeCompare(b.completedAt || '');
      });
      var overdueCount = list.filter(Store.isOverdue).length;
      var soonest = pending.reduce(function (acc, t) {
        if (!t.dueDate) return acc;
        return (!acc || t.dueDate < acc) ? t.dueDate : acc;
      }, '');
      return {
        id: key,
        name: p ? p.name : 'UNASSIGNED',
        position: p ? (p.position || '') : '',
        isUnassigned: !key,
        tasks: list, pending: pending, done: done,
        stats: Store.stats(list),
        overdueCount: overdueCount,
        soonest: soonest || '9999-12-31'
      };
    });

    // Most overdue first, then soonest deadline. Unassigned is pinned to the end.
    groups.sort(function (a, b) {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
      if (a.soonest !== b.soonest) return a.soonest < b.soonest ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // The officer summary always describes the whole event, never the filtered subset.
    var summaryMap = {}, summaryOrder = [];
    all.forEach(function (t) {
      var key = t.assigneeId || '';
      if (!summaryMap[key]) { summaryMap[key] = []; summaryOrder.push(key); }
      summaryMap[key].push(t);
    });
    var summary = summaryOrder.map(function (key) {
      var p = key ? Store.person(key) : null;
      var s = Store.stats(summaryMap[key]);
      return {
        id: key,
        name: p ? p.name : 'Unassigned',
        position: p ? (p.position || '—') : '—',
        isUnassigned: !key,
        stats: s
      };
    }).sort(function (a, b) {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (a.stats.overdue !== b.stats.overdue) return b.stats.overdue - a.stats.overdue;
      return a.name.localeCompare(b.name);
    });

    return {
      event: e,
      org: Store.org(),
      generatedAt: U.nowStamp(),
      pendingOnly: !!pendingOnly,
      overall: overall,
      groups: groups,
      summary: summary,
      headName: e.headId ? Store.personName(e.headId) : 'Not set'
    };
  }

  /* ---------- PDF ---------- */

  function makeDoc() {
    var jsPDF = global.jspdf && global.jspdf.jsPDF;
    if (!jsPDF) throw new Error('The PDF library did not load.');
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAGE.width, PAGE.height] });
    // Guard against any format normalisation: the page must end up 345 wide × 215 tall.
    var w = doc.internal.pageSize.getWidth();
    var h = doc.internal.pageSize.getHeight();
    if (Math.round(w) !== PAGE.width || Math.round(h) !== PAGE.height) {
      doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAGE.height, PAGE.width] });
    }
    return doc;
  }

  function drawDocumentHeader(doc, m, opts) {
    var tight = opts.density !== 'full';
    var x = PAGE.marginX, y = PAGE.marginTop;
    var emblemSize = tight ? 16 : 20;
    var titleSize = tight ? 17 : 21;

    // Emblem slot, left.
    // An emblem uploaded in Settings wins; otherwise the council's own seal,
    // which ships with the app and is loaded ready at start-up.
    var emblemSrc = m.org.emblem || global.FCU_SEAL || '';
    var drewEmblem = false;
    if (emblemSrc) {
      try {
        var fmt = /^data:image\/png/i.test(emblemSrc) ? 'PNG'
          : /^data:image\/jpe?g/i.test(emblemSrc) ? 'JPEG' : '';
        if (fmt) { doc.addImage(emblemSrc, fmt, x, y, emblemSize, emblemSize); drewEmblem = true; }
      } catch (err) { drewEmblem = false; }
    }
    if (!drewEmblem) {
      doc.setFillColor(C.gold[0], C.gold[1], C.gold[2]);
      doc.triangle(x + emblemSize / 2, y + 1, x + emblemSize - 0.5, y + emblemSize - 1.5,
        x + 0.5, y + emblemSize - 1.5, 'F');
    }

    var tx = x + emblemSize + 5;

    // The centred title is the anchor; the letterhead text is fitted into the space
    // left of it, so a longer organization name shrinks instead of colliding.
    doc.setFont(FONT, 'bold');
    doc.setFontSize(titleSize);
    var titleW = doc.getTextWidth('EVENT TASK REPORT');
    var orgMaxW = (PAGE.width / 2 - titleW / 2) - tx - 7;

    var nameSize = tight ? 9.5 : 10.5;
    doc.setFont(FONT, 'bold');
    while (nameSize > 6.5) {
      doc.setFontSize(nameSize);
      if (doc.getTextWidth(m.org.name || '') <= orgMaxW) break;
      nameSize -= 0.25;
    }
    doc.setFontSize(nameSize);
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.text(m.org.name || '', tx, y + (tight ? 5.5 : 6.5), { maxWidth: orgMaxW });

    doc.setFont(FONT, 'normal');
    doc.setFontSize(tight ? 7.5 : 8.5);
    doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
    if (tight) {
      // Address and email share one line to save a row of height — but only if
      // they actually fit. Letting them wrap leaves the separator dangling.
      var contact = [m.org.address, m.org.email].filter(Boolean).join('   ·   ');
      if (contact && doc.getTextWidth(contact) <= orgMaxW) {
        doc.text(contact, tx, y + 10.5);
      } else {
        if (m.org.address) doc.text(m.org.address, tx, y + 9.5, { maxWidth: orgMaxW });
        if (m.org.email) doc.text(m.org.email, tx, y + 13.5, { maxWidth: orgMaxW });
      }
    } else {
      if (m.org.address) doc.text(m.org.address, tx, y + 11.5, { maxWidth: orgMaxW });
      if (m.org.email) doc.text(m.org.email, tx, y + 16, { maxWidth: orgMaxW });
    }

    // Title — the largest text on the page.
    doc.setFont(FONT, 'bold');
    doc.setFontSize(titleSize);
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.text('EVENT TASK REPORT', PAGE.width / 2, y + (tight ? 9.5 : 12), { align: 'center' });

    // Thin gold band, tying the document to the FCUSR letterhead.
    var bandY = y + (tight ? 17.5 : 23);
    doc.setFillColor(C.gold[0], C.gold[1], C.gold[2]);
    doc.rect(x, bandY, PAGE.contentW, tight ? 1.4 : 1.8, 'F');

    return bandY + (tight ? 1.4 : 1.8);
  }

  function drawEventBand(doc, m, top, opts) {
    var tight = opts.density !== 'full';
    var x = PAGE.marginX;
    var y = top + (tight ? 3 : 4);
    var h = tight ? 19 : 28;
    var e = m.event;
    var s = m.overall;

    doc.setFillColor(C.goldPale[0], C.goldPale[1], C.goldPale[2]);
    doc.setDrawColor(C.goldLine[0], C.goldLine[1], C.goldLine[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, PAGE.contentW, h, 2, 2, 'FD');

    var lx = x + 5;
    var rx = x + PAGE.contentW * (tight ? 0.615 : 0.59);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(tight ? 12 : 13);
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.text(e.title, lx, y + (tight ? 7 : 9), { maxWidth: rx - lx - 8 });

    doc.setFont(FONT, 'normal');
    doc.setFontSize(tight ? 8 : 9);

    if (tight) {
      // One meta line instead of two.
      var meta = [
        U.fmtRange(e.dateStart, e.dateEnd),
        e.venue,
        'Head: ' + m.headName,
        'Generated ' + m.generatedAt,
        m.pendingOnly ? 'Pending only' : ''
      ].filter(Boolean).join('   ·   ');
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      doc.text(meta, lx, y + 13.5, { maxWidth: rx - lx - 8 });
    } else {
      doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      doc.text(U.fmtRange(e.dateStart, e.dateEnd) + (e.venue ? '   ·   ' + e.venue : ''), lx, y + 15.5);
      doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
      doc.text('Event head: ' + m.headName + '   ·   Generated ' + m.generatedAt +
        (m.pendingOnly ? '   ·   Pending tasks only' : ''), lx, y + 21.5);
    }

    // Progress, right side.
    doc.setFont(FONT, 'bold');
    doc.setFontSize(tight ? 9.5 : 10.5);
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.text(s.done + ' of ' + s.total + ' tasks done (' + s.percent + '%)', rx, y + (tight ? 6.5 : 9));

    var barW = PAGE.contentW - (rx - x) - 6;
    var barY = y + (tight ? 9 : 12.5);
    var barH = tight ? 3.6 : 4.5;
    doc.setFillColor(C.track[0], C.track[1], C.track[2]);
    doc.roundedRect(rx, barY, barW, barH, 1.2, 1.2, 'F');
    if (s.percent > 0) {
      var fill = Math.max(2.4, barW * s.percent / 100);
      var col = s.percent === 100 ? C.status.Done.fg : C.gold;
      doc.setFillColor(col[0], col[1], col[2]);
      doc.roundedRect(rx, barY, fill, barH, 1.2, 1.2, 'F');
    }

    doc.setFont(FONT, 'normal');
    doc.setFontSize(tight ? 8 : 9);
    var cy = y + (tight ? 16.5 : 23);
    doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
    doc.text('Pending: ' + s.pending, rx, cy);
    var w1 = doc.getTextWidth('Pending: ' + s.pending);
    doc.setTextColor(C.overdue[0], C.overdue[1], C.overdue[2]);
    doc.setFont(FONT, s.overdue > 0 ? 'bold' : 'normal');
    doc.text('Overdue: ' + s.overdue, rx + w1 + 7, cy);
    var w2 = doc.getTextWidth('Overdue: ' + s.overdue);
    doc.setFont(FONT, 'normal');
    doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
    doc.text('Due this week: ' + s.dueThisWeek, rx + w1 + w2 + 14, cy);

    return y + h;
  }

  function sectionHeading(doc, text, y) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(C.goldDark[0], C.goldDark[1], C.goldDark[2]);
    doc.text(text.toUpperCase(), PAGE.marginX, y);
    doc.setDrawColor(C.gold[0], C.gold[1], C.gold[2]);
    doc.setLineWidth(0.6);
    doc.line(PAGE.marginX, y + 1.8, PAGE.marginX + 22, y + 1.8);
    return y + 5;
  }

  function drawOfficerSummary(doc, m, startY, opts) {
    var d = DENSITY[opts.density] || DENSITY.compact;
    var y = sectionHeading(doc, 'Officer summary', startY + (opts.density === 'full' ? 9 : 6));

    var totals = { total: 0, done: 0, pending: 0, overdue: 0 };
    var body = m.summary.map(function (r) {
      totals.total += r.stats.total;
      totals.done += r.stats.done;
      totals.pending += r.stats.pending;
      totals.overdue += r.stats.overdue;
      return [
        r.name, r.position,
        String(r.stats.total), String(r.stats.done), String(r.stats.pending),
        {
          content: String(r.stats.overdue),
          styles: r.stats.overdue > 0
            ? { textColor: C.overdue, fontStyle: 'bold', fillColor: C.rowOverdue } : {}
        },
        { content: '', _percent: r.stats.percent }
      ];
    });

    body.push([
      { content: 'TOTAL', styles: { fontStyle: 'bold' } },
      { content: '', styles: { fontStyle: 'bold' } },
      { content: String(totals.total), styles: { fontStyle: 'bold' } },
      { content: String(totals.done), styles: { fontStyle: 'bold' } },
      { content: String(totals.pending), styles: { fontStyle: 'bold' } },
      {
        content: String(totals.overdue),
        styles: { fontStyle: 'bold', textColor: totals.overdue ? C.overdue : C.ink }
      },
      { content: '', _percent: U.pct(totals.done, totals.total), _totalRow: true }
    ]);

    doc.autoTable({
      startY: y,
      head: [['Officer', 'Position', 'Total', 'Done', 'Pending', 'Overdue', 'Progress']],
      body: body,
      theme: 'grid',
      margin: { left: PAGE.marginX, right: PAGE.marginX, top: PAGE.marginTop + 4, bottom: PAGE.footerH + 4 },
      styles: {
        font: FONT, fontSize: d.body, cellPadding: d.pad,
        lineColor: C.line, lineWidth: 0.15, textColor: C.ink, valign: 'middle', overflow: 'linebreak'
      },
      headStyles: {
        font: FONT, fontStyle: 'bold', fontSize: d.head, fillColor: C.goldPale,
        textColor: C.goldDark, lineColor: C.goldLine, lineWidth: 0.25
      },
      columnStyles: (function () {
        var w = share([0.2430, 0.1931, 0.0685, 0.0685, 0.0779, 0.0779, 0.2710]);
        return {
          0: { cellWidth: w[0], fontStyle: 'bold' },
          1: { cellWidth: w[1], textColor: C.ink2 },
          2: { cellWidth: w[2], halign: 'center' },
          3: { cellWidth: w[3], halign: 'center', textColor: C.status.Done.fg },
          4: { cellWidth: w[4], halign: 'center' },
          5: { cellWidth: w[5], halign: 'center' },
          6: { cellWidth: w[6] }
        };
      })(),
      didParseCell: function (data) {
        if (data.section !== 'body') return;
        var isTotal = data.row.index === body.length - 1;
        if (isTotal) {
          data.cell.styles.fillColor = C.goldPale;
          data.cell.styles.lineWidth = 0.25;
          data.cell.styles.lineColor = C.goldLine;
        } else if (data.row.index % 2 === 1 && !data.cell.styles.fillColor) {
          data.cell.styles.fillColor = C.zebra;
        }
      },
      didDrawCell: function (data) {
        // The progress column is drawn, not typed.
        if (data.section !== 'body' || data.column.index !== 6) return;
        var raw = data.row.raw[6];
        if (!raw || typeof raw._percent !== 'number') return;
        var p = raw._percent;
        var cx = data.cell.x + 2.5;
        var cy = data.cell.y + data.cell.height / 2 - 1.8;
        var w = data.cell.width - 21;
        doc.setFillColor(C.track[0], C.track[1], C.track[2]);
        doc.roundedRect(cx, cy, w, 3.6, 1, 1, 'F');
        if (p > 0) {
          var col = p === 100 ? C.status.Done.fg : C.gold;
          doc.setFillColor(col[0], col[1], col[2]);
          doc.roundedRect(cx, cy, Math.max(2, w * p / 100), 3.6, 1, 1, 'F');
        }
        doc.setFont(FONT, raw._totalRow ? 'bold' : 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(C.ink2[0], C.ink2[1], C.ink2[2]);
        doc.text(p + '%', cx + w + 2.5, data.cell.y + data.cell.height / 2 + 1.4);
      }
    });

    return doc.lastAutoTable.finalY;
  }

  var DETAIL_HEAD = ['#', 'Task', 'Deadline', 'Days left', 'Priority', 'Status', 'Completed', 'Notes'];

  /* Two densities. "Compact" is the default because the old layout gave every
     officer their own table — a group band plus a repeated column header each,
     roughly 20 mm of chrome per person before a single task was printed. Compact
     draws ONE continuous table with the officer as a full-width row inside it, so
     the column header is paid for once per page instead of once per officer. */
  var DENSITY = {
    compact: {
      body: 8.5, head: 8, group: 9.5,
      pad: { top: 1.1, bottom: 1.1, left: 2, right: 2 },
      groupPad: { top: 1.4, bottom: 1.4, left: 2.5, right: 2.5 },
      showCompletedDivider: false
    },
    full: {
      body: 9, head: 8.5, group: 11,
      pad: { top: 1.8, bottom: 1.8, left: 2.4, right: 2.4 },
      groupPad: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
      showCompletedDivider: true
    }
  };

  // Widths total 321 mm (the printable width). Without the Notes column its
  // width is shared out so nothing has to wrap.
  function detailWidths(withNotes) {
    var w = withNotes
      ? share([0.0280, 0.3115, 0.1153, 0.1153, 0.0592, 0.0779, 0.0997, 0.1931])
      : share([0.0280, 0.4424, 0.1246, 0.1246, 0.0685, 0.0935, 0.1184]);
    var out = {};
    w.forEach(function (v, i) { out[i] = v; });
    return out;
  }

  function detailRow(t, n, withNotes) {
    var overdue = Store.isOverdue(t);
    var done = t.status === 'Done';
    var st = C.status[t.status] || C.status['Not Started'];

    var extra = '';
    if (t.status === 'On hold' && t.blockedReason) extra += '\n' + 'On hold: ' + t.blockedReason;
    if (t.remarks) extra += '\n' + t.remarks;

    var row = [
      {
        // A bold "!" survives a black-and-white photocopy, which the tints do not.
        content: overdue ? '! ' + n : String(n),
        styles: overdue
          ? { fontStyle: 'bold', textColor: C.overdue, halign: 'center' }
          : { halign: 'center', textColor: C.muted }
      },
      { content: t.title + extra, styles: { fontStyle: 'bold' } },
      { content: t.dueDate ? U.fmtDate(t.dueDate) : '—' },
      {
        content: done ? '' : U.daysLeftPrint(t.dueDate),
        styles: overdue || (!done && t.dueDate && U.daysLeft(t.dueDate) === 0)
          ? { textColor: C.overdue, fontStyle: 'bold' } : {}
      },
      { content: t.priority, styles: { textColor: C.priority[t.priority] || C.ink2 } },
      { content: t.status, styles: { fillColor: st.bg, textColor: st.fg, fontStyle: 'bold', halign: 'center' } },
      { content: t.completedAt ? U.fmtDateShort(t.completedAt.slice(0, 10)) : '', styles: { textColor: C.status.Done.fg } }
    ];
    // Notes stays blank on purpose — room to write during the meeting.
    if (withNotes) row.push({ content: '' });
    return row;
  }

  /* The whole detail section as one table. Officer names are rows, not bands. */
  function drawDetail(doc, m, startY, opts) {
    var d = DENSITY[opts.density] || DENSITY.compact;
    var withNotes = opts.notes !== false;
    var widths = detailWidths(withNotes);
    var cols = withNotes ? 8 : 7;
    var head = withNotes ? DETAIL_HEAD : DETAIL_HEAD.slice(0, 7);
    var bottomLimit = PAGE.height - PAGE.footerH - 4;

    var headingY = startY + (opts.density === 'full' ? 10 : 7);
    if (headingY + 5 + 26 > bottomLimit) {
      doc.addPage();
      headingY = PAGE.marginTop + 8;
    }
    var y = sectionHeading(doc, 'Task detail by officer', headingY);

    // Build one body: officer row, their pending tasks, then their completed ones.
    var body = [];
    var taskAt = {};        // body row index → task, for the row tints
    var groupRows = {};     // body row index → true, for the officer rows

    m.groups.forEach(function (g) {
      var tally = g.stats.done + ' of ' + g.stats.total + ' done';
      if (g.overdueCount) tally = g.overdueCount + ' overdue  ·  ' + tally;
      var label = (g.isUnassigned ? 'UNASSIGNED' : g.name) +
        (g.position ? '  —  ' + g.position : '');

      groupRows[body.length] = true;
      body.push([{
        content: label + ' '.repeat(4) + '·' + ' '.repeat(4) + tally,
        colSpan: cols,
        styles: {
          fillColor: C.goldPale, textColor: C.ink, fontStyle: 'bold',
          fontSize: d.group, cellPadding: d.groupPad,
          lineColor: C.goldLine, lineWidth: 0.25
        }
      }]);

      var n = 0;
      g.pending.forEach(function (t) {
        taskAt[body.length] = t;
        body.push(detailRow(t, ++n, withNotes));
      });

      if (g.done.length && d.showCompletedDivider) {
        body.push([{
          content: 'Completed', colSpan: cols,
          styles: {
            fillColor: C.rowDone, textColor: C.status.Done.fg, fontStyle: 'bold',
            fontSize: d.body - 0.5, cellPadding: { top: 1.2, bottom: 1.2, left: 2.4, right: 2.4 }
          }
        }]);
      }
      g.done.forEach(function (t) {
        taskAt[body.length] = t;
        body.push(detailRow(t, ++n, withNotes));
      });

      if (!g.pending.length && !g.done.length) {
        body.push([{
          content: 'No tasks in this section.', colSpan: cols,
          styles: { textColor: C.muted, fontStyle: 'italic', halign: 'center' }
        }]);
      }
    });

    var columnStyles = {};
    for (var i = 0; i < cols; i++) {
      columnStyles[i] = { cellWidth: widths[i] };
    }
    columnStyles[0].halign = 'center';
    if (withNotes) columnStyles[7].fillColor = C.white;

    doc.autoTable({
      startY: y,
      head: [head],
      body: body,
      theme: 'grid',
      margin: { left: PAGE.marginX, right: PAGE.marginX, top: PAGE.marginTop + 4, bottom: PAGE.footerH + 4 },
      rowPageBreak: 'avoid',
      styles: {
        font: FONT, fontSize: d.body, cellPadding: d.pad,
        lineColor: C.line, lineWidth: 0.15, textColor: C.ink,
        valign: 'middle', overflow: 'linebreak'
      },
      headStyles: {
        font: FONT, fontStyle: 'bold', fontSize: d.head, fillColor: C.goldPale,
        textColor: C.goldDark, lineColor: C.goldLine, lineWidth: 0.25, halign: 'left'
      },
      columnStyles: columnStyles,
      didParseCell: function (data) {
        if (data.section !== 'body') return;
        var idx = data.row.index;
        if (groupRows[idx]) return;              // officer rows keep their own styling
        var task = taskAt[idx];
        if (!task) return;
        // The status cell keeps its chip colour; the rest of the row carries the tint.
        if (data.column.index === 5) return;
        if (withNotes && data.column.index === 7) { data.cell.styles.fillColor = C.white; return; }
        if (Store.isOverdue(task)) data.cell.styles.fillColor = C.rowOverdue;
        else if (task.status === 'Done') data.cell.styles.fillColor = C.rowDone;
        else if (idx % 2 === 1) data.cell.styles.fillColor = C.zebra;
      },
      // An officer row must never be the last thing on a page.
      willDrawCell: function (data) {
        if (data.section === 'body' && groupRows[data.row.index] && data.column.index === 0) {
          var remaining = bottomLimit - data.cursor.y;
          if (remaining < 22) {
            doc.addPage();
            data.cursor.y = PAGE.marginTop + 4;
          }
        }
      }
    });

    return doc.lastAutoTable.finalY;
  }

  function drawSignatures(doc, y, opts) {
    var tight = !opts || opts.density !== 'full';
    var need = tight ? 26 : 34;
    var bottomLimit = PAGE.height - PAGE.footerH - 4;
    if (y + need > bottomLimit) {
      doc.addPage();
      y = PAGE.marginTop + 6;
    } else {
      y += tight ? 8 : 12;
    }

    var colW = (PAGE.contentW - 40) / 2;
    [['Prepared by:', PAGE.marginX], ['Noted by:', PAGE.marginX + colW + 40]].forEach(function (col) {
      var label = col[0], x = col[1];
      doc.setFont(FONT, 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
      doc.text(label, x, y);

      doc.setDrawColor(C.ink2[0], C.ink2[1], C.ink2[2]);
      doc.setLineWidth(0.3);
      doc.line(x + 24, y + 0.8, x + colW, y + 0.8);
      doc.line(x + 24, y + 12, x + colW, y + 12);

      doc.setFont(FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
      doc.text('Name over printed name', x + 24, y + 4.2);
      doc.text('Position', x + 24, y + 15.4);
    });
    return y + 18;
  }

  function drawFooters(doc, m) {
    var pages = doc.internal.getNumberOfPages();
    var label = 'FCUSR Task Tracker  ·  ' + m.event.title + '  ·  Page ';
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      var y = PAGE.height - PAGE.footerH + 3;
      doc.setDrawColor(C.line[0], C.line[1], C.line[2]);
      doc.setLineWidth(0.25);
      doc.line(PAGE.marginX, y - 3, PAGE.width - PAGE.marginX, y - 3);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
      doc.text(label + i + ' of ' + pages, PAGE.width / 2, y + 1.5, { align: 'center' });
    }
  }

  function filenameFor(e) {
    return 'FCUSR-TaskReport-' + U.slug(e.title) + '-' + U.today() + '.pdf';
  }

  // Builds the document without writing it, so it can be inspected or tested.
  // opts: { pendingOnly, density: 'compact'|'full', notes: bool }
  function buildDoc(eventId, opts) {
    opts = normalizeOpts(opts);
    // Montserrat is fetched on demand; if it has not arrived yet this document
    // is set in Helvetica rather than made to wait. Every later export has it.
    if (global.Accomplishment && !global.FCU_PDF_FONTS) Accomplishment.loadPdfFonts();
    usePaper(opts.paper);
    var m = buildModel(eventId, opts.pendingOnly);
    var doc = makeDoc();
    registerFonts(doc);
    doc.setFont(FONT, 'normal');

    var y = drawDocumentHeader(doc, m, opts);
    y = drawEventBand(doc, m, y, opts);
    y = drawOfficerSummary(doc, m, y, opts);
    y = drawDetail(doc, m, y, opts);
    drawSignatures(doc, y, opts);
    drawFooters(doc, m);

    return { doc: doc, model: m, opts: opts };
  }

  // Older call sites passed a bare `pendingOnly` boolean; keep that working.
  function normalizeOpts(opts) {
    if (typeof opts === 'boolean' || opts === undefined || opts === null) {
      opts = { pendingOnly: !!opts };
    }
    return {
      pendingOnly: !!opts.pendingOnly,
      density: opts.density === 'full' ? 'full' : 'compact',
      notes: opts.notes !== false,
      paper: PAPERS[opts.paper] ? opts.paper : 'longbond'
    };
  }

  function generate(eventId, opts) {
    var built = buildDoc(eventId, opts);
    built.doc.save(filenameFor(built.model.event));
    return built.model;
  }

  // How many pages each setting would produce, so the dialog can say so up front.
  function pageCount(eventId, opts) {
    try {
      return buildDoc(eventId, opts).doc.internal.getNumberOfPages();
    } catch (e) {
      return null;
    }
  }

  /* ---------- print fallback ---------- */

  function printHTML(eventId, pendingOnly) {
    var m = buildModel(eventId, pendingOnly);
    var host = document.getElementById('print-report') || document.createElement('div');
    host.id = 'print-report';
    host.innerHTML = renderPrintable(m);
    if (!host.parentNode) document.body.appendChild(host);
    document.body.classList.add('printing');
    setTimeout(function () {
      global.print();
      setTimeout(function () { document.body.classList.remove('printing'); }, 400);
    }, 120);
  }

  function renderPrintable(m) {
    var e = m.event, s = m.overall;

    var html = '<header class="p-head">' +
      '<div class="p-emblem">' + (m.org.emblem || global.FCU_SEAL
        ? '<img src="' + U.esc(m.org.emblem || global.FCU_SEAL) + '" alt="">' :
        '<svg viewBox="0 0 24 24"><path d="M12 3.5 21 20H3z" fill="#C9A227"/></svg>') + '</div>' +
      '<div class="p-org"><div class="p-org-name">' + U.esc(m.org.name) + '</div>' +
      '<div>' + U.esc(m.org.address) + '</div><div>' + U.esc(m.org.email) + '</div></div>' +
      '<h1 class="p-title">EVENT TASK REPORT</h1></header><div class="p-band"></div>';

    html += '<section class="p-info"><div class="p-info-left">' +
      '<div class="p-event">' + U.esc(e.title) + '</div>' +
      '<div>' + U.esc(U.fmtRange(e.dateStart, e.dateEnd)) + (e.venue ? ' &middot; ' + U.esc(e.venue) : '') + '</div>' +
      '<div class="p-muted">Event head: ' + U.esc(m.headName) + ' &middot; Generated ' + U.esc(m.generatedAt) +
      (m.pendingOnly ? ' &middot; Pending tasks only' : '') + '</div></div>' +
      '<div class="p-info-right"><div class="p-progress-label">' + s.done + ' of ' + s.total + ' tasks done (' + s.percent + '%)</div>' +
      '<div class="p-bar"><span style="width:' + s.percent + '%"></span></div>' +
      '<div class="p-counts">Pending: ' + s.pending + '<span class="p-od">Overdue: ' + s.overdue + '</span>Due this week: ' + s.dueThisWeek + '</div>' +
      '</div></section>';

    html += '<h2 class="p-section">OFFICER SUMMARY</h2>' +
      '<table class="p-table p-summary"><thead><tr><th>Officer</th><th>Position</th><th>Total</th>' +
      '<th>Done</th><th>Pending</th><th>Overdue</th><th>Progress</th></tr></thead><tbody>';
    var tot = { total: 0, done: 0, pending: 0, overdue: 0 };
    m.summary.forEach(function (r) {
      tot.total += r.stats.total; tot.done += r.stats.done;
      tot.pending += r.stats.pending; tot.overdue += r.stats.overdue;
      html += '<tr><td class="p-strong">' + U.esc(r.name) + '</td><td>' + U.esc(r.position) + '</td>' +
        '<td class="p-c">' + r.stats.total + '</td><td class="p-c p-done">' + r.stats.done + '</td>' +
        '<td class="p-c">' + r.stats.pending + '</td>' +
        '<td class="p-c' + (r.stats.overdue ? ' p-od-cell' : '') + '">' + r.stats.overdue + '</td>' +
        '<td><div class="p-bar sm"><span style="width:' + r.stats.percent + '%"></span></div>' +
        '<span class="p-pct">' + r.stats.percent + '%</span></td></tr>';
    });
    html += '<tr class="p-total"><td>TOTAL</td><td></td><td class="p-c">' + tot.total + '</td>' +
      '<td class="p-c">' + tot.done + '</td><td class="p-c">' + tot.pending + '</td>' +
      '<td class="p-c' + (tot.overdue ? ' p-od-cell' : '') + '">' + tot.overdue + '</td>' +
      '<td><div class="p-bar sm"><span style="width:' + U.pct(tot.done, tot.total) + '%"></span></div>' +
      '<span class="p-pct">' + U.pct(tot.done, tot.total) + '%</span></td></tr>';
    html += '</tbody></table>';

    html += '<h2 class="p-section">TASK DETAIL BY OFFICER</h2>';

    m.groups.forEach(function (g) {
      html += '<div class="p-group">' +
        '<div class="p-group-head"><span class="p-group-name">' + U.esc(g.isUnassigned ? 'UNASSIGNED' : g.name) + '</span>' +
        (g.position ? '<span class="p-group-role">— ' + U.esc(g.position) + '</span>' : '') +
        '<span class="p-group-tally">' + (g.overdueCount ? '<span class="p-od">' + g.overdueCount + ' overdue</span> &middot; ' : '') +
        g.stats.done + ' of ' + g.stats.total + ' done</span></div>' +
        '<table class="p-table"><thead><tr><th>#</th><th>Task</th><th>Deadline</th><th>Days left</th>' +
        '<th>Priority</th><th>Status</th><th>Date completed</th><th>Notes</th></tr></thead><tbody>';

      var n = 0;
      g.pending.forEach(function (t) { html += printRow(t, ++n); });
      if (g.done.length) {
        html += '<tr class="p-sub"><td colspan="8">Completed</td></tr>';
        g.done.forEach(function (t) { html += printRow(t, ++n); });
      }
      if (!g.pending.length && !g.done.length) {
        html += '<tr><td colspan="8" class="p-empty">No tasks in this section.</td></tr>';
      }
      html += '</tbody></table></div>';
    });

    html += '<div class="p-sign"><div class="p-sign-col"><span class="p-sign-label">Prepared by:</span>' +
      '<div class="p-sign-lines"><div class="p-line"></div><div class="p-line-label">Name over printed name</div>' +
      '<div class="p-line"></div><div class="p-line-label">Position</div></div></div>' +
      '<div class="p-sign-col"><span class="p-sign-label">Noted by:</span>' +
      '<div class="p-sign-lines"><div class="p-line"></div><div class="p-line-label">Name over printed name</div>' +
      '<div class="p-line"></div><div class="p-line-label">Position</div></div></div></div>';

    html += '<div class="p-foot">FCUSR Task Tracker &nbsp;·&nbsp; ' + U.esc(e.title) + '</div>';

    return html;
  }

  function printRow(t, n) {
    var overdue = Store.isOverdue(t);
    var done = t.status === 'Done';
    var cls = overdue ? 'p-row-od' : done ? 'p-row-done' : '';
    return '<tr class="' + cls + '">' +
      '<td class="p-c' + (overdue ? ' p-bang' : '') + '">' + (overdue ? '! ' : '') + n + '</td>' +
      '<td class="p-strong">' + U.esc(t.title) +
        (t.status === 'On hold' && t.blockedReason ? '<span class="p-note">On hold: ' + U.esc(t.blockedReason) + '</span>' : '') +
        (t.remarks ? '<span class="p-note">' + U.esc(t.remarks) + '</span>' : '') + '</td>' +
      '<td>' + (t.dueDate ? U.esc(U.fmtDate(t.dueDate)) : '—') + '</td>' +
      '<td class="' + (overdue || (t.dueDate && !done && U.daysLeft(t.dueDate) === 0) ? 'p-od' : '') + '">' +
        (done ? '' : U.esc(U.daysLeftPrint(t.dueDate))) + '</td>' +
      '<td class="p-pri-' + t.priority.toLowerCase() + '">' + U.esc(t.priority) + '</td>' +
      '<td class="p-c p-st ' + UI.statusClass(t.status) + '">' + U.esc(t.status) + '</td>' +
      '<td class="p-done">' + (t.completedAt ? U.esc(U.fmtDateShort(t.completedAt.slice(0, 10))) : '') + '</td>' +
      '<td class="p-notes"></td></tr>';
  }

  /* ---------- export dialog ---------- */

  function openExportDialog(eventId) {
    var e = Store.event(eventId);
    if (!e) return;
    // Start fetching the font while the paper and options are being chosen, so
    // it is in place by the time Export is pressed.
    if (global.Accomplishment) Accomplishment.loadPdfFonts();
    var s = Store.stats(Store.tasks({ eventId: eventId }));

    UI.modal({
      title: 'Export report',
      body:
        '<p class="small muted">A printed record of <strong>' + U.esc(e.title) + '</strong>: ' +
        'a summary per officer, then every task grouped by the person holding it.</p>' +

        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin:14px 0">' +
          '<div class="strong">' + U.plural(s.total, 'task') + '</div>' +
          '<div class="small muted">' + s.done + ' done, ' + s.pending + ' pending' +
          (s.overdue ? ', <span style="color:var(--st-overdue-fg);font-weight:700">' +
            s.overdue + ' overdue</span>' : '') + '.</div>' +
        '</div>' +

        '<div class="field"><label for="paper">Paper size</label>' +
        '<select id="paper">' + Object.keys(PAPERS).map(function (k) {
          return '<option value="' + k + '"' + (k === 'longbond' ? ' selected' : '') + '>' +
            U.esc(PAPERS[k].label) + '</option>';
        }).join('') + '</select></div>' +

        '<label class="checkbox" style="margin-bottom:12px"><input type="checkbox" id="pending-only">' +
        '<span>Leave out finished tasks' +
        '<span class="hint">The report normally lists everything, finished work included. ' +
        'Tick this for a shorter working copy.</span></span></label>' +

        '<label class="checkbox"><input type="checkbox" id="with-notes" checked>' +
        '<span>Leave a blank column for handwritten notes' +
        '<span class="hint">An empty column down the right-hand side, for writing on during meetings.</span>' +
        '</span></label>' +

        '<p class="small" id="page-estimate" style="margin:16px 0 0"></p>' +
        '<p class="tiny muted" style="margin:4px 0 0">Saves as <code>' + U.esc(filenameFor(e)) + '</code>.</p>',
      footer:
        '<button type="button" class="btn btn-ghost left" data-print>Print view</button>' +
        '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-go data-autofocus>' + UI.icon('pdf') + 'Export</button>',
      onMount: function (root, close) {
        var go = root.querySelector('[data-go]');
        var estimate = root.querySelector('#page-estimate');

        // The layout is always the compact one; there is no reason to print the
        // same information across more sheets than it needs.
        function currentOpts() {
          return {
            pendingOnly: root.querySelector('#pending-only').checked,
            notes: root.querySelector('#with-notes').checked,
            density: 'compact',
            paper: root.querySelector('#paper').value
          };
        }

        function refreshEstimate() {
          estimate.textContent = 'Working out the length…';
          loadFonts().then(function () {
            var n = pageCount(eventId, currentOpts());
            estimate.textContent = n === null ? ''
              : (n === 1 ? 'This will print on one sheet.' : 'This will print on ' + n + ' sheets.');
          });
        }

        ['#paper', '#pending-only', '#with-notes'].forEach(function (sel) {
          root.querySelector(sel).addEventListener('change', refreshEstimate);
        });
        refreshEstimate();

        go.addEventListener('click', function () {
          go.disabled = true;
          go.textContent = 'Building…';
          loadFonts().then(function () {
            try {
              generate(eventId, currentOpts());
              close();
              UI.toast('Report exported.');
            } catch (err) {
              console.error(err);
              go.disabled = false;
              go.textContent = 'Export';
              UI.toast(err.message || 'The report could not be built.', 'error');
            }
          });
        });

        root.querySelector('[data-print]').addEventListener('click', function () {
          var o = currentOpts();
          close();
          printHTML(eventId, o.pendingOnly);
        });
      }
    });
  }

  global.Report = {
    PAGE: PAGE,
    PAPERS: PAPERS,
    usePaper: usePaper,
    buildModel: buildModel,
    buildDoc: buildDoc,
    pageCount: pageCount,
    generate: generate,
    renderPrintable: renderPrintable,
    printHTML: printHTML,
    openExportDialog: openExportDialog,
    filenameFor: filenameFor
  };
})(window);
