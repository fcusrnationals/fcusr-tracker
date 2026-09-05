/* Accomplishment Report → Word.

   The same document as the PDF, in a file the council can edit. It is written as
   Word-flavoured HTML, which Word opens natively and treats as a normal editable
   document — no library, no server, nothing to install.

   Two decisions worth knowing:

   • Sections break onto their own page, exactly as the PDF does, so both versions
     read the same. Nothing else is force-broken, so text still reflows freely
     when you edit it.
   • Pictures are wrapped in VML text boxes. Word imports those as floating
     objects you can drag and resize, rather than characters locked into a line. */
(function (global) {
  'use strict';

  var A = global.Accomplishment;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* A floating, movable picture. `wIn` is the width in inches; Word sizes the box
     from that and keeps the picture's own proportions. */
  /* A picture on its own. Nothing is written beneath it — the council does not
     caption its documentation, and the PDF does not either. */
  function pictureBox(dataUrl, wIn, hIn) {
    var wPt = Math.round(wIn * 72), hPt = Math.round(hIn * 72);
    return '' +
      '<div style="margin:0 0 10pt 0">' +
        '<!--[if gte vml 1]>' +
        '<v:shape style="width:' + wPt + 'pt;height:' + hPt + 'pt" stroked="f">' +
        '<v:imagedata src="' + dataUrl + '"/></v:shape>' +
        '<![endif]-->' +
        '<![if !vml]>' +
        '<img src="' + dataUrl + '" width="' + Math.round(wIn * 96) + '" ' +
             'style="max-width:100%;height:auto" alt="">' +
        '<![endif]>' +
        (caption
          ? '<div style="font-size:9pt;color:#666;margin-top:3pt">' + esc(caption) + '</div>'
          : '') +
      '</div>';
  }

  function sectionHeading(text) {
    // The page break lives on the heading, so a section always opens a new sheet
    // — the same rule the PDF follows.
    return '<h2 style="page-break-before:always;text-align:center;font-family:Montserrat,Arial,sans-serif;' +
      'font-size:13pt;font-weight:bold;color:#17171B;margin:0 0 14pt 0">' +
      esc(String(text).toUpperCase()) + '</h2>';
  }

  function build(eventId, draft) {
    var e = Store.event(eventId);
    if (!e) throw new Error('That event no longer exists.');
    var report = draft || Store.report(eventId);
    if (!report) throw new Error('There is no report for this event yet.');

    var ids = A._allAssetIds(report);
    return Promise.all([A.loadLetterhead(), AssetDB.getMany(ids)]).then(function (res) {
      var letterhead = res[0];
      var images = {};
      res[1].forEach(function (r) { if (r.dataUrl) images[r.id] = r.dataUrl; });

      var sig = report.signatories || {};
      var prep = sig.preparedBy || { name: '', position: '' };
      var pres = sig.president || { name: '', show: true };
      var adv = sig.adviser || { name: '' };
      var headName = e.headId ? Store.personName(e.headId) : '';

      var body = '';

      /* ---- cover ---- */
      body +=
        '<div style="text-align:center">' +
          (letterhead ? '<img src="' + letterhead + '" style="width:100%" alt="">' : '') +
          '<p style="font-family:Montserrat,Arial,sans-serif;font-size:17pt;font-weight:bold;' +
            'color:#7E6210;margin:28pt 0 14pt 0">ACCOMPLISHMENT REPORT</p>' +
          '<p style="font-family:Montserrat,Arial,sans-serif;font-size:22pt;font-weight:bold;' +
            'margin:0 0 14pt 0">' + esc(e.title) + '</p>' +
          '<p style="font-size:12pt;color:#45454F;margin:0">' +
            [U.fmtRange(e.dateStart, e.dateEnd), e.venue,
             headName ? 'Event Head: ' + headName : ''].filter(Boolean).map(esc).join('<br>') +
          '</p>' +
        '</div>';

      // Signatories, laid out as the council writes them.
      function signatory(name, position) {
        return '<p style="margin:0 0 2pt 0;font-size:11pt"><b>' + esc((name || '').toUpperCase()) + '</b></p>' +
          '<p style="margin:0 0 18pt 0;font-size:10.5pt;color:#45454F">' + esc(position || '') + '</p>';
      }

      var noted = [];
      if (pres.show !== false && pres.name) noted.push([pres.name, 'President, FCUSR Nationals']);
      if (adv.name) noted.push([adv.name, 'Adviser, FCUSR Nationals']);

      body += '<div style="margin-top:44pt">' +
        '<p style="margin:0 0 22pt 0;font-size:11pt">Prepared by:</p>' +
        signatory(prep.name, prep.position);

      if (noted.length) {
        body += '<p style="margin:14pt 0 22pt 0;font-size:11pt">Noted:</p>' +
          '<table style="width:100%;border-collapse:collapse"><tr>' +
          '<td style="width:50%;vertical-align:top;border:none">' + signatory(noted[0][0], noted[0][1]) + '</td>' +
          '<td style="width:50%;vertical-align:top;border:none">' +
            (noted[1] ? signatory(noted[1][0], noted[1][1]) : '') + '</td>' +
          '</tr></table>';
      }
      body += '</div>';

      /* ---- letters ---- */
      if (report.letters.length) {
        body += sectionHeading('Letter of Intent and Documentary Requirements');
        report.letters.forEach(function (l, i) {
          if (i > 0) body += '<h3 style="page-break-before:always;font-size:11pt;margin:0 0 8pt 0">' +
            esc(l.name) + '</h3>';
          else body += '<h3 style="font-size:11pt;margin:0 0 8pt 0">' + esc(l.name) + '</h3>';
          l.assets.forEach(function (id) {
            if (images[id]) body += pictureBox(images[id], 6.3, 8.4);
          });
        });
      }

      /* ---- summary ---- */
      if (report.description) {
        body += sectionHeading('Summary of the Activity');
        String(report.description).split(/\n+/).filter(function (p) { return p.trim(); })
          .forEach(function (para) {
            body += '<p style="text-align:justify;font-size:12pt;line-height:1.5;margin:0 0 10pt 0">' +
              esc(para.trim()) + '</p>';
          });
      }

      /* ---- programme ---- */
      if (report.program.assets.length) {
        body += sectionHeading('Program Flow');
        report.program.assets.forEach(function (id) {
          if (images[id]) body += pictureBox(images[id], 6.3, 8.4);
        });
      }

      /* ---- photos, four to a page ---- */
      if (report.photos.length) {
        body += sectionHeading('Photo Documentation');
        body += '<table style="width:100%;border-collapse:separate;border-spacing:8pt">';
        report.photos.forEach(function (p, i) {
          if (i % 2 === 0) body += '<tr>';
          body += '<td style="width:50%;vertical-align:top;border:none">' +
            (images[p.assetId] ? pictureBox(images[p.assetId], 3.0, 2.25) : '') +
            '</td>';
          if (i % 2 === 1) body += '</tr>';
        });
        if (report.photos.length % 2 === 1) body += '<td style="border:none"></td></tr>';
        body += '</table>';
      }

      /* ---- minutes ---- */
      if (report.minutes.mode === 'tasks') {
        var rows = Store.tasks({ eventId: eventId }).slice().sort(function (a, b) {
          return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
        });
        if (rows.length) {
          body += sectionHeading('Task Assignment and Deliberation');
          body += '<table style="width:100%;border-collapse:collapse;font-size:10pt">' +
            '<tr style="background:#FDFAF1">' +
            ['Assigned', 'Deadline', 'Task', 'Assigned to', 'Status', 'Completed'].map(function (h) {
              return '<th style="border:0.5pt solid #D6D6D1;padding:4pt;text-align:left">' + h + '</th>';
            }).join('') + '</tr>';
          rows.forEach(function (t) {
            body += '<tr>' + [
              t.createdAt ? U.fmtDateTiny(t.createdAt.slice(0, 10)) : '—',
              t.dueDate ? U.fmtDateTiny(t.dueDate) : '—',
              t.title,
              Store.personName(t.assigneeId),
              t.status,
              t.completedAt ? U.fmtDateTiny(t.completedAt.slice(0, 10)) : ''
            ].map(function (c) {
              return '<td style="border:0.5pt solid #D6D6D1;padding:4pt">' + esc(c) + '</td>';
            }).join('') + '</tr>';
          });
          body += '</table>';
        }
      } else if (report.minutes.mode === 'upload' && report.minutes.assets.length) {
        body += sectionHeading('Minutes of the Meeting');
        report.minutes.assets.forEach(function (id) {
          if (images[id]) body += pictureBox(images[id], 6.3, 8.4);
        });
      }

      /* ---- liquidation ---- */
      var liq = (report.liquidation && report.liquidation.assets) || [];
      if (liq.length) {
        body += sectionHeading('Liquidation');
        liq.forEach(function (id) { if (images[id]) body += pictureBox(images[id], 6.3, 8.4); });
      }

      /* ---- evaluation ---- */
      if (report.evaluation.assets.length) {
        body += sectionHeading('Evaluation Results');
        report.evaluation.assets.forEach(function (id) {
          if (images[id]) body += pictureBox(images[id], 6.3, 8.4);
        });
      }

      var html =
        '<html xmlns:v="urn:schemas-microsoft-com:vml" ' +
              'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
              'xmlns:w="urn:schemas-microsoft-com:office:word">' +
        '<head><meta charset="utf-8">' +
        '<title>' + esc(e.title) + ' — Accomplishment Report</title>' +
        '<style>' +
          '@page { size: A4 portrait; margin: 22mm; }' +
          'body { font-family: Montserrat, Calibri, Arial, sans-serif; font-size: 12pt; color: #17171B; }' +
          'table { border-collapse: collapse; }' +
        '</style></head><body>' + body + '</body></html>';

      return { html: html, event: e };
    });
  }

  function filename(e) {
    return 'FCUSR-AccomplishmentReport-' + U.slug(e.title) + '-' + U.today() + '.doc';
  }

  function save(eventId, draft) {
    return build(eventId, draft).then(function (out) {
      UI.downloadFile(filename(out.event), out.html, 'application/msword');
      return out;
    });
  }

  global.AccomplishmentWord = { build: build, save: save, filename: filename };
})(window);
