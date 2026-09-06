/* FCUSR Task Tracker — shared helpers (dates, formatting, small DOM utilities).
   All dates the user picks are stored as plain "YYYY-MM-DD" strings so they never
   drift across timezones. "Today" is always read in Asia/Manila. */
(function (global) {
  'use strict';

  var TZ = 'Asia/Manila';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MS_DAY = 86400000;

  /* ---------- dates ---------- */

  // "YYYY-MM-DD" for right now in Manila.
  function today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  // Current Manila wall-clock time as "Aug 12, 2026 (Wed) · 3:45 PM".
  function nowStamp() {
    var t = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(new Date());
    return fmtDate(today()) + ' · ' + t;
  }

  // Parse a date-only string at UTC noon: immune to DST and offset rounding.
  function parse(iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12, 0, 0));
    return isNaN(d.getTime()) ? null : d;
  }

  function isValidDate(iso) { return parse(iso) !== null; }

  // "Aug 12, 2026 (Wed)"
  function fmtDate(iso) {
    var d = parse(iso);
    if (!d) return '—';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() +
      ' (' + DAYS[d.getUTCDay()] + ')';
  }

  // "Aug 12, 2026"
  function fmtDateShort(iso) {
    var d = parse(iso);
    if (!d) return '—';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  // "Aug 12" — for tight rows on mobile.
  function fmtDateTiny(iso) {
    var d = parse(iso);
    if (!d) return '—';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  // Full timestamp for "last updated" lines.
  function fmtStamp(isoTime) {
    if (!isoTime) return '—';
    var d = new Date(isoTime);
    if (isNaN(d.getTime())) return '—';
    var datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
    var timePart = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(d);
    return fmtDate(datePart) + ' · ' + timePart;
  }

  // Whole days from `from` to `to`. Negative means `to` is in the past.
  function daysBetween(from, to) {
    var a = parse(from), b = parse(to);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / MS_DAY);
  }

  function daysLeft(dueDate) { return daysBetween(today(), dueDate); }

  // Compact chip text for the screen: "3 days late", "Due today", "In 4 days".
  // The printed report uses daysLeftPrint instead, which spells things out.
  function daysLeftLabel(dueDate) {
    var n = daysLeft(dueDate);
    if (n === null) return 'No date';
    if (n === 0) return 'Due today';
    if (n === 1) return 'Tomorrow';
    if (n < 0) {
      var d = Math.abs(n);
      return d + (d === 1 ? ' day late' : ' days late');
    }
    return 'In ' + n + ' days';
  }

  // All-caps variant used in the printed report.
  function daysLeftPrint(dueDate) {
    var n = daysLeft(dueDate);
    if (n === null) return '—';
    if (n === 0) return 'DUE TODAY';
    if (n < 0) return 'OVERDUE by ' + Math.abs(n) + (Math.abs(n) === 1 ? ' day' : ' days');
    return n + (n === 1 ? ' day' : ' days');
  }

  function addDays(iso, n) {
    var d = parse(iso);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // "This week" is a rolling seven days from today. Anchoring it to the calendar
  // week made the count collapse to a single day when opened on a Sunday, which
  // reads as a bug; a rolling window is also what an officer actually means.
  function endOfWeek() { return addDays(today(), 6); }

  function startOfMonth() { return today().slice(0, 8) + '01'; }

  function isWithin(iso, startIso, endIso) {
    if (!iso) return false;
    return iso >= startIso && iso <= endIso;
  }

  // "Aug 12 – 14, 2026" / "Aug 30 – Sep 2, 2026" / single date.
  function fmtRange(startIso, endIso) {
    if (!startIso) return '—';
    if (!endIso || endIso === startIso) return fmtDate(startIso);
    var a = parse(startIso), b = parse(endIso);
    if (!a || !b) return fmtDate(startIso);
    if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
      return MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' + b.getUTCDate() + ', ' + a.getUTCFullYear();
    }
    if (a.getUTCFullYear() === b.getUTCFullYear()) {
      return MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' +
        MONTHS[b.getUTCMonth()] + ' ' + b.getUTCDate() + ', ' + a.getUTCFullYear();
    }
    return fmtDateShort(startIso) + ' – ' + fmtDateShort(endIso);
  }

  // "In 5 days" / "Today" / "Ended 3 days ago" for an event countdown.
  function countdown(startIso, endIso) {
    var t = today();
    var end = endIso || startIso;
    if (!startIso) return '';
    if (t < startIso) {
      var n = daysBetween(t, startIso);
      return n === 1 ? 'Starts tomorrow' : 'In ' + n + ' days';
    }
    if (t >= startIso && t <= end) return startIso === end ? 'Happening today' : 'Happening now';
    var past = daysBetween(end, t);
    return past === 1 ? 'Ended yesterday' : 'Ended ' + past + ' days ago';
  }

  /* ---------- text ---------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function pct(done, total) { return total > 0 ? Math.round((done / total) * 100) : 0; }

  function slug(s) {
    return String(s || '').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'Event';
  }

  /* Identity has to survive the trip to the server and back, and be agreed on by
     two phones that have never met — so a record is a uuid, made here rather
     than by the database. A council works offline half the time; an id that only
     exists once a server has seen it is no id at all.

     The prefix argument is kept because forty call sites pass one, and reading
     `U.uid('tsk')` still says what is being made. It no longer appears in the
     value: Postgres wants a uuid, not a label. */
  function uid(prefix) {
    void prefix;
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();

    var b = new Array(16);
    if (c && typeof c.getRandomValues === 'function') {
      var arr = new Uint8Array(16);
      c.getRandomValues(arr);
      for (var i = 0; i < 16; i++) b[i] = arr[i];
    } else {
      // No crypto at all — an old in-app browser, or a test sandbox.
      for (var j = 0; j < 16; j++) b[j] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;      // version 4
    b[8] = (b[8] & 0x3f) | 0x80;      // variant 1
    var h = b.map(function (n) { return (n + 0x100).toString(16).slice(1); });
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
           h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' +
           h.slice(10, 16).join('');
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

  /* ---------- tiny DOM helpers ---------- */

  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Delegated event binding — views re-render wholesale, so listeners live on the shell.
  function on(root, type, sel, fn) {
    root.addEventListener(type, function (ev) {
      var t = ev.target.closest(sel);
      if (t && root.contains(t)) fn(ev, t);
    });
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  }

  global.U = {
    TZ: TZ, MONTHS: MONTHS, DAYS: DAYS,
    today: today, nowStamp: nowStamp, parse: parse, isValidDate: isValidDate,
    fmtDate: fmtDate, fmtDateShort: fmtDateShort, fmtDateTiny: fmtDateTiny, fmtStamp: fmtStamp,
    daysBetween: daysBetween, daysLeft: daysLeft, daysLeftLabel: daysLeftLabel, daysLeftPrint: daysLeftPrint,
    addDays: addDays, endOfWeek: endOfWeek, startOfMonth: startOfMonth, isWithin: isWithin,
    fmtRange: fmtRange, countdown: countdown,
    esc: esc, plural: plural, initials: initials, pct: pct, slug: slug, uid: uid, isUuid: isUuid,
    el: el, els: els, on: on, debounce: debounce
  };
})(window);
