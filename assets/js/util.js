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

  /* The same uuid for the same words, on every phone.

     An acknowledgement is one person saying they have read one announcement.
     Minted at random, the same person pressing the button on their phone and
     again on the office laptop would be two records and counted twice. Derived
     from the pair instead, both devices make the one id, and the second simply
     arrives as the same record.

     Four 32-bit FNV-1a passes with different seeds. Not cryptographic, and it
     does not need to be: it only has to agree with itself. */
  function hashUuid(text) {
    var s = String(text || '');
    var seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
    var hex = seeds.map(function (seed) {
      var h = seed >>> 0;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
      return (h >>> 0).toString(16);
    }).map(function (x) { return ('00000000' + x).slice(-8); }).join('');
    // Shaped as a version-5 uuid, so it reads as a derived one to anybody looking.
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) + '-' +
      ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20) + '-' +
      hex.slice(20, 32);
  }

  /* The Manila calendar day a moment fell on. A stamp is UTC, and slicing it
     would put anything done after 4 PM here on the next day's date. */
  function dayOf(isoTime) {
    if (!isoTime) return '';
    var d = new Date(isoTime);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  }

  // "3:45 PM" in Manila.
  function fmtTime(isoTime) {
    if (!isoTime) return '';
    var d = new Date(isoTime);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(d);
  }

  // "Sep 2" this year, "Sep 2, 2025" otherwise — how a history line reads.
  function fmtWhen(isoTime) {
    var day = dayOf(isoTime);
    if (!day) return '';
    return day.slice(0, 4) === today().slice(0, 4) ? fmtDateTiny(day) : fmtDateShort(day);
  }

  /* ---------- sign-in names ----------

     A login is a username the system makes from somebody's name. Supabase will
     only sign in an email address, so each username is kept as one nobody sees
     or types: juan.delacruz is stored as juan.delacruz@fcusr.invalid. ".invalid"
     is reserved worldwide for exactly this — it can never be a real address, so
     nothing can ever be mailed to it or reach a stranger.

     The server makes the final choice and adds a number where a name is taken
     (backend/supabase/usernames.sql); this only suggests. */
  var LOGIN_DOMAIN = 'fcusr.invalid';

  // What was typed at the door, as the address Supabase knows it by.
  function loginToEmail(v) {
    var t = String(v || '').trim().toLowerCase();
    if (!t) return '';
    return t.indexOf('@') >= 0 ? t : t + '@' + LOGIN_DOMAIN;
  }

  function isUsernameLogin(addr) {
    var t = String(addr || '').trim().toLowerCase();
    return t.length > LOGIN_DOMAIN.length + 1 &&
      t.slice(-(LOGIN_DOMAIN.length + 1)) === '@' + LOGIN_DOMAIN;
  }

  // How a login is shown: the username alone, or the address for somebody who
  // still signs in with one.
  function loginLabel(addr) {
    var t = String(addr || '').trim().toLowerCase();
    return isUsernameLogin(t) ? t.slice(0, -(LOGIN_DOMAIN.length + 1)) : t;
  }

  var NAME_PARTICLES = ['de', 'del', 'dela', 'la', 'las', 'los', 'delos', 'san', 'santa', 'sta',
                        'sto', 'santo', 'van', 'von', 'di', 'da', 'dos', 'das', 'le'];
  var NAME_SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv', 'v'];

  /* "Juan D. Dela Cruz" and "Dela Cruz, Juan D." both suggest juan.delacruz.
     First given name, then the whole surname; middle initials and Jr./III left
     out; accents taken off (Dueño → dueno). */
  function usernameFor(name) {
    var s = String(name || '');
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase();
    var clean = function (w) { return w.replace(/[^a-z0-9]/g, ''); };
    var words = function (t) {
      return t.split(/[\s]+/).map(clean).filter(function (w) {
        return w && NAME_SUFFIXES.indexOf(w) < 0;
      });
    };

    var given, surname;
    var comma = s.indexOf(',');
    if (comma >= 0) {
      surname = words(s.slice(0, comma));
      given = words(s.slice(comma + 1)).filter(function (w) { return w.length > 1; });
    } else {
      var all = words(s);
      var first = all.shift() || '';
      var rest = all.filter(function (w) { return w.length > 1; });
      surname = rest.length ? [rest.pop()] : [];
      while (rest.length && NAME_PARTICLES.indexOf(rest[rest.length - 1]) >= 0) {
        surname.unshift(rest.pop());
      }
      given = first ? [first] : [];
    }
    var out = (given[0] || '') + (given[0] && surname.length ? '.' : '') + surname.join('');
    out = out.slice(0, 24).replace(/\.$/, '');
    return /^[a-z]/.test(out) ? out : 'member' + out;
  }

  /* Two spellings of one name compare equal: "Dela Cruz, Juan" and "Juan Dela
     Cruz", with or without accents and full stops. */
  function nameKey(n) {
    var s = String(n || '');
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(Boolean).sort().join(' ');
  }

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
    LOGIN_DOMAIN: LOGIN_DOMAIN, loginToEmail: loginToEmail, loginLabel: loginLabel,
    isUsernameLogin: isUsernameLogin, usernameFor: usernameFor, nameKey: nameKey,
    TZ: TZ, MONTHS: MONTHS, DAYS: DAYS,
    today: today, nowStamp: nowStamp, parse: parse, isValidDate: isValidDate,
    fmtDate: fmtDate, fmtDateShort: fmtDateShort, fmtDateTiny: fmtDateTiny, fmtStamp: fmtStamp,
    daysBetween: daysBetween, daysLeft: daysLeft, daysLeftLabel: daysLeftLabel, daysLeftPrint: daysLeftPrint,
    addDays: addDays, endOfWeek: endOfWeek, startOfMonth: startOfMonth, isWithin: isWithin,
    fmtRange: fmtRange, countdown: countdown,
    esc: esc, plural: plural, initials: initials, pct: pct, slug: slug, uid: uid, isUuid: isUuid,
    hashUuid: hashUuid, dayOf: dayOf, fmtTime: fmtTime, fmtWhen: fmtWhen,
    el: el, els: els, on: on, debounce: debounce
  };
})(window);
