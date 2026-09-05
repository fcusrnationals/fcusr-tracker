/* The front door.

   Shown instead of the app whenever a backend is connected and nobody has said
   who they are. Offline there is nothing to sign in to — the data is on this
   device and a password box would be theatre — so the gate only stands once
   Supabase has been configured.

   There is no "register" here in the usual sense. An executive enrols an email
   address first; setting a password is how that person claims the enrolment
   already waiting for them. Someone who finds the address of the site and signs
   themselves up gets a login that opens onto nothing at all. */
(function (global) {
  'use strict';

  var mode = 'in';        // 'in' = sign in · 'new' = set a password
  var busy = false;
  var problem = '';

  function render() {
    var offline = Auth.isOffline();

    return '<div class="gate">' +
      '<div class="gate-card">' +

      /* The campus across the top of the card, with the seal sitting over the
         join. Both are the council's own marks and both should be plainly
         visible here — this is the first screen anybody sees. */
      '<div class="gate-hero">' +
        '<img class="gate-hero-img" src="assets/img/campus.jpg" alt="" aria-hidden="true">' +
      '</div>' +

      '<div class="gate-brand">' +
        '<img class="gate-seal" src="assets/img/fcusr-seal.png" alt="">' +
        '<div class="gate-name">' + U.esc(Store.trackerTitle(Store.nationalUnitId())) + '</div>' +
        '<div class="gate-org">' + U.esc(Store.org().name) + '</div>' +
      '</div>' +

      (offline
        ? '<div class="gate-note">' + UI.icon('alert') +
          '<span>No accounts yet. The Supabase project has not been connected, so everything ' +
          'stays on this device.</span></div>'
        : '') +

      '<div class="segmented gate-modes">' +
        '<button type="button" data-mode="in"' +
          (mode === 'in' ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') +
          '>Sign in</button>' +
        '<button type="button" data-mode="new"' +
          (mode === 'new' ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') +
          '>Set my password</button>' +
      '</div>' +

      '<div class="field"><label for="gate-email">Email</label>' +
      '<input type="email" id="gate-email" autocomplete="username" inputmode="email" ' +
      'autocapitalize="off" spellcheck="false" placeholder="you@filamer.edu.ph"></div>' +

      '<div class="field"><label for="gate-pass">Password</label>' +
      '<input type="password" id="gate-pass" autocomplete="' +
      (mode === 'new' ? 'new-password' : 'current-password') + '">' +
      (mode === 'new'
        ? '<div class="hint">At least eight characters. Choose it yourself &mdash; nobody else, ' +
          'here or in the council, ever sees it.</div>'
        : '') +
      (problem ? '<div class="error-text">' + U.esc(problem) + '</div>' : '') +
      '</div>' +

      '<button type="button" class="btn btn-primary btn-block gate-go"' +
        (busy ? ' disabled' : '') + '>' +
        U.esc(busy ? 'One moment…' : mode === 'new' ? 'Set my password' : 'Sign in') +
      '</button>' +

      '<p class="gate-foot">' +
        (mode === 'new'
          ? 'Your address has to be enrolled by a national executive first. ' +
            'Setting a password on an address nobody enrolled will not let you in.'
          : 'First time here? Choose <strong>Set my password</strong> above and use the ' +
            'address you were enrolled with.') +
      '</p>' +

      '</div></div>';
  }

  function mount(root) {
    var email = root.querySelector('#gate-email');
    var pass = root.querySelector('#gate-pass');

    U.els('[data-mode]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-mode');
        problem = '';
        App.render();
      });
    });

    function submit() {
      if (busy) return;
      var addr = (email.value || '').trim();
      var pw = pass.value || '';

      if (!Auth.isOffline()) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
          problem = 'That email address does not look right.';
          return App.render();
        }
        if (mode === 'new' && pw.length < 8) {
          problem = 'Too short — use at least eight characters.';
          return App.render();
        }
      }

      busy = true;
      problem = '';
      App.render();

      var work = (mode === 'new' && !Auth.isOffline())
        ? Auth.signUp(addr, pw)
        : Auth.signIn(addr, pw);

      work.then(function () {
        busy = false;
        problem = '';
        App.go('#/overview');
        App.render();
        UI.toast('Signed in as ' + Auth.current().name + '.');
      }).catch(function (err) {
        busy = false;
        problem = err.message || 'That did not work.';
        App.render();
      });
    }

    var go = root.querySelector('.gate-go');
    if (go) go.addEventListener('click', submit);
    [email, pass].forEach(function (el) {
      if (el) el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    });

    // Put the cursor where the person has to start, without stealing it back on
    // every redraw once they are already typing.
    if (!busy && email && !email.value) email.focus();
  }

  // Called on sign-out so the next person does not land on the last one's mode.
  function reset() { mode = 'in'; busy = false; problem = ''; }

  global.ViewSignIn = { render: render, mount: mount, reset: reset };
})(window);
