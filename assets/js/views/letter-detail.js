/* One letter, and the trail it has left.

   The trail is drawn as a column of offices in order, each showing what actually
   happened there: who handed it over, who took it in, when, and what came back.
   Only the office currently holding the letter offers a button, so there is
   never a question about which line you are meant to fill in next. */
(function (global) {
  'use strict';

  function render(params) {
    var l = Store.letter(params.id);
    if (!l) {
      return '<a class="breadcrumb" href="#/letters">' + UI.icon('back') + 'All letters</a>' +
        UI.empty('That letter is gone', 'It may have been deleted on this device.',
          '<a class="btn btn-primary" href="#/letters">Back to letters</a>');
    }

    var p = Store.letterProgress(l);
    var cur = Store.currentStop(l);
    var e = l.eventId ? Store.event(l.eventId) : null;

    var meta = [Store.letterInCharge(l) + ' is carrying it'];
    if (e) meta.push(e.title);
    else meta.push('Council business');
    if (l.deadline) meta.push('Needed by ' + U.fmtDateShort(l.deadline));

    var html = '<a class="breadcrumb" href="#/letters">' + UI.icon('back') + 'All letters</a>';

    html += '<div class="detail-head">' +
      '<div class="page-head" style="margin-bottom:6px">' +
        '<h1 style="min-width:0">' + U.esc(l.subject) + '</h1>' +
        '<div class="row" style="gap:6px;flex-wrap:nowrap">' +
          '<button type="button" class="btn" data-slip>' + UI.icon('pdf') + 'Routing slip</button>' +
          '<button type="button" class="icon-btn" data-more aria-label="Letter options" aria-haspopup="menu">' +
          UI.icon('more') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="detail-meta">' + meta.map(U.esc).join('<span class="sep">·</span>') + '</div>';

    // The one sentence that matters, said loudly.
    html += '<div class="where-now' + (Store.letterNeedsAttention(l) ? ' is-alert' : '') + '">' +
      '<span class="wn-label">Where it is now</span>' +
      '<span class="wn-line">' + U.esc(Store.letterWhere(l)) + '</span>' +
      (Store.isStuck(l) && cur && !Store.wasReturned(cur)
        ? '<span class="wn-note">Longer than ' + U.esc(Store.officeName(cur.officeId)) +
          ' usually takes. Worth following up.</span>'
        : '') +
      '</div>';

    html += '<div class="row" style="margin-top:14px;gap:12px">' +
      '<div style="flex:1;min-width:150px">' + UI.progressBar(p.done, p.total) + '</div>' +
      '</div></div>';

    html += '<div class="section"><div class="section-head"><h2>The trail</h2>' +
      '<span class="section-note">' + p.done + ' of ' + p.total + ' offices cleared</span></div>' +
      '<ol class="trail">' + l.stops.map(function (s, i) {
        return stopRow(l, s, i, cur);
      }).join('') + '</ol></div>';

    return html;
  }

  function stopRow(l, s, i, cur) {
    var st = Store.stopState(s);
    var isCurrent = cur && s.id === cur.id && l.status === 'Routing';
    var o = Store.office(s.officeId);

    var lines = [];
    if (s.receivedAt) {
      lines.push('Received by <strong>' + U.esc(s.receivedBy) + '</strong> on ' +
        U.esc(U.fmtDateShort(s.receivedAt)) +
        (s.forwardedBy ? ', handed over by ' + U.esc(s.forwardedBy) : ''));
    }
    if (s.releasedAt) {
      lines.push('<strong>' + U.esc(s.outcome || 'Released') + '</strong> on ' +
        U.esc(U.fmtDateShort(s.releasedAt)));
    }
    if (s.note) lines.push('<span class="muted">&ldquo;' + U.esc(s.note) + '&rdquo;</span>');
    if (!lines.length) {
      lines.push('<span class="muted">Not sent here yet' +
        (o ? ' — usually takes ' + U.plural(o.turnaroundDays, 'day') : '') + '</span>');
    }

    var actions = '';
    if (isCurrent) {
      if (st === 'waiting') {
        actions = '<button type="button" class="btn btn-sm btn-primary" data-receive="' + U.esc(s.id) + '">' +
          'Record hand-over</button>';
      } else if (st === 'received') {
        actions = '<button type="button" class="btn btn-sm btn-primary" data-release="' + U.esc(s.id) + '">' +
          'Record the outcome</button>';
      }
    }

    // A repeat is the same desk a second time, after it sent the letter back.
    var repeat = Store.isRepeatOf(l, s);

    return '<li class="trail-stop is-' + st + (isCurrent ? ' is-current' : '') +
      (repeat ? ' is-repeat' : '') + '">' +
      '<span class="ts-mark" aria-hidden="true">' +
        (st === 'released' ? UI.icon('check') : st === 'returned' ? '!' :
         st === 'noted' ? '\u00b7' : (i + 1)) + '</span>' +
      '<div class="ts-body">' +
        '<div class="ts-office">' + U.esc(Store.officeName(s.officeId)) +
          (repeat ? ' <span class="chip chip-plain">second time</span>' : '') +
          (isCurrent ? ' <span class="chip chip-plain">here now</span>' : '') + '</div>' +
        '<div class="ts-lines">' + lines.join('<br>') + '</div>' +
        (actions ? '<div class="ts-actions">' + actions + '</div>' : '') +
      '</div></li>';
  }

  function mount(root, params) {
    var l = Store.letter(params.id);
    if (!l) return;

    U.els('[data-receive]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.receiveForm(l.id, b.getAttribute('data-receive')); });
    });
    U.els('[data-release]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.releaseForm(l.id, b.getAttribute('data-release')); });
    });
    var slip = root.querySelector('[data-slip]');
    if (slip) slip.addEventListener('click', function () {
      slip.disabled = true;
      LetterSlip.save(l.id).then(function () {
        UI.toast('Routing slip downloaded — staple it to the letter.');
      }).catch(function (err) {
        UI.toast(err.message || 'The slip could not be made.', 'error');
      }).then(function () { slip.disabled = false; });
    });

    var more = root.querySelector('[data-more]');
    if (more) more.addEventListener('click', function () {
      var items =
        '<button type="button" data-set="edit">' + UI.icon('edit') + 'Edit letter</button>' +
        (l.status === 'Routing'
          ? '<button type="button" data-set="declined">' + UI.icon('close') + 'Mark declined</button>' +
            '<button type="button" data-set="withdrawn">' + UI.icon('archive') + 'Withdraw it</button>'
          : '<button type="button" data-set="routing">' + UI.icon('back') + 'Put it back on the route</button>') +
        '<div class="sep"></div>' +
        '<button type="button" class="danger" data-set="delete">' + UI.icon('trash') + 'Delete letter</button>';

      UI.openMenu(more, items, function (action) {
        if (action === 'edit') return Forms.letterForm(l.id);
        if (action === 'declined') { Store.setLetterStatus(l.id, 'Declined'); return UI.toast('Marked declined.'); }
        if (action === 'withdrawn') { Store.setLetterStatus(l.id, 'Withdrawn'); return UI.toast('Withdrawn.'); }
        if (action === 'routing') { Store.setLetterStatus(l.id, 'Routing'); return UI.toast('Back on the route.'); }
        if (action === 'delete') {
          UI.confirm({
            title: 'Delete this letter?',
            message: '\u201c' + l.subject + '\u201d and its whole trail will be removed.',
            detail: 'This cannot be undone. Withdrawing keeps the record instead.',
            confirmLabel: 'Delete letter'
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteLetter(l.id);
            App.go('#/letters');
            UI.toast('Letter deleted.');
          });
        }
      });
    });
  }

  global.ViewLetterDetail = { render: render, mount: mount };
})(window);
