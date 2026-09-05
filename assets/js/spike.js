/* Drives the backend comparison page. Runs the same five calls against whichever
   driver is selected and reports how long each one took. */
(function (global) {
  'use strict';

  var NOTES = {
    supabase: 'Its own email and password, which people can change inside the app. ' +
      'Needs the project URL and anon key in config.js.',
    appsscript: 'Signs in with the Google account already on this device — no password for the app to keep. ' +
      'Needs the /exec web app URL in config.js, and your account must already be enrolled in the sheet.',
    local: 'No server. Everything stays in this browser, exactly as the app works today. ' +
      'Included as the baseline to compare speed against.'
  };

  var resultsEl, totalEl;

  function row(r) {
    var cls = r.ok ? 'st-done' : 'st-on-hold';
    var right = r.skipped
      ? '<span class="chip chip-plain">skipped</span>'
      : '<span class="chip ' + cls + '"><span class="dot"></span>' + (r.ok ? 'ok' : 'failed') + '</span>' +
        '<span class="chip chip-due">' + r.ms + ' ms</span>';
    return '<div class="task">' +
      '<span class="task-main" style="cursor:default">' +
      '<span class="task-title">' + U.esc(r.label) + '</span>' +
      (r.detail ? '<span class="task-meta">' + U.esc(r.detail) + '</span>' : '') +
      '</span><span class="task-right">' + right + '</span></div>';
  }

  function render(rows, totalMs) {
    resultsEl.innerHTML = rows.map(row).join('') || '<div class="task"><span class="task-main">' +
      '<span class="task-meta">Nothing run yet.</span></span></div>';
    totalEl.textContent = totalMs === null ? '' : Backend.driverName() + ' · ' + totalMs + ' ms total';
  }

  function describe(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.length + ' row' + (v.length === 1 ? '' : 's');
    if (typeof v === 'object') {
      return [v.full_name, v.position, v.unit_name, v.access].filter(Boolean).join(' · ') || 'ok';
    }
    return String(v).slice(0, 60);
  }

  function run() {
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    var rows = [];
    var t0 = Date.now();

    function step(label, fn) {
      return function () {
        return Backend.timed(label, Promise.resolve().then(fn)).then(function (r) {
          r.detail = r.ok ? describe(r.value) : r.error;
          rows.push(r);
          render(rows, null);
          if (!r.ok) throw new Error(r.error);   // stop the chain, keep what we have
          return r.value;
        });
      };
    }

    render([], null);

    Promise.resolve()
      .then(step('Sign in', function () { return Backend.signIn(email, password); }))
      .then(step('Who am I', function () { return Backend.whoami(); }))
      .then(step('Load units', function () { return Backend.units(); }))
      .then(step('Load roster', function () { return Backend.roster(); }))
      .then(step('Read the audit log', function () { return Backend.audit(); }))
      .catch(function () { /* the failing row is already on screen */ })
      .then(function () { render(rows, Date.now() - t0); });
  }

  function syncDriverUI() {
    var d = Backend.config.driver;
    U.els('[data-driver]').forEach(function (b) {
      var on = b.getAttribute('data-driver') === d;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.getElementById('driver-note').textContent = NOTES[d] || '';
    // Only Supabase has a password the app deals with.
    document.getElementById('pw-field').hidden = !Backend.needsPassword();
    document.getElementById('email').closest('.field').hidden = (d === 'appsscript' || d === 'local');
  }

  function boot() {
    resultsEl = document.getElementById('results');
    totalEl = document.getElementById('total');

    U.els('[data-driver]').forEach(function (b) {
      b.addEventListener('click', function () {
        Backend.use(b.getAttribute('data-driver'));
        syncDriverUI();
        render([], null);
      });
    });

    document.getElementById('run').addEventListener('click', run);
    document.getElementById('clear').addEventListener('click', function () { render([], null); });

    syncDriverUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
