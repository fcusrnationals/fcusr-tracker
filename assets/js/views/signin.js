/* The front door.

   Shown instead of the app whenever a backend is connected and nobody has said
   who they are. Offline there is nothing to sign in to — the data is on this
   device and a password box would be theatre — so the gate only stands once
   Supabase has been configured.

   There is no "register" here in the usual sense. An executive enrols an email
   address first; setting a password is how that person claims the enrolment
   already waiting for them. Someone who finds the address of the site and signs
   themselves up gets a login that opens onto nothing at all.

   That used to be a second tab on this card, which asked people to know which
   of two things they were before they had done either. Now there is one form.
   The first time an address is used, the door works out that no password has
   ever been set on it and puts up a dialog that cannot be dismissed: choose one
   now, or go no further. Nobody has to be told which button they are. */
(function (global) {
  'use strict';

  var busy = false;
  var problem = '';

  /* The card itself, so the full-page door and the dialog you get when opening
     Settings are the same thing rather than two designs drifting apart. */
  function card(opts) {
    opts = opts || {};
    var offline = Auth.isOffline();

    return '<div class="gate-card' + (opts.inModal ? ' in-modal' : '') + '">' +

      /* The council's gold, with the campus inside it rather than pasted on top:
         the photograph is tinted into the gradient and fades out as it reaches
         the name, so the picture, the seal and the title read as one field
         instead of a banner sitting above a form. */
      '<div class="gate-top">' +
        '<img class="gate-hero-img" src="assets/img/campus.jpg" alt="" aria-hidden="true" decoding="async">' +
        '<div class="gate-brand">' +
          '<img class="gate-seal" src="assets/img/fcusr-seal.png" alt="">' +
          '<div class="gate-name">' + U.esc(Store.trackerTitle(Store.nationalUnitId())) + '</div>' +
          '<div class="gate-org">' + U.esc(Store.org().name) + '</div>' +
        '</div>' +
      '</div>' +

      (offline
        ? '<div class="gate-note">' + UI.icon('alert') +
          '<span>No accounts yet. The Supabase project has not been connected, so everything ' +
          'stays on this device.</span></div>'
        : '') +

      '<div class="field"><label for="gate-email">Email</label>' +
      '<input type="email" id="gate-email" autocomplete="username" inputmode="email" ' +
      'autocapitalize="off" spellcheck="false" placeholder="you@filamer.edu.ph"></div>' +

      '<div class="field"><label for="gate-pass">Password</label>' +
      '<input type="password" id="gate-pass" autocomplete="current-password">' +
      (problem ? '<div class="error-text">' + U.esc(problem) + '</div>' : '') +
      '</div>' +

      '<button type="button" class="btn btn-primary btn-block gate-go"' +
        (busy ? ' disabled' : '') + '>' +
        U.esc(busy ? 'One moment…' : 'Sign in') +
      '</button>' +

      (offline ? '' :
        '<button type="button" class="btn btn-ghost btn-block" data-forgot ' +
        'style="margin-top:8px">Forgot your password?</button>') +

      '<p class="gate-foot">' +
        'Your email and the password a national executive gave you. ' +
        'You can change it once you are in.' +
      '</p>' +

      '</div>';
  }

  function render() {
    return '<div class="gate">' + card() + '</div>';
  }

  /* The moment between opening the app and knowing who is holding it.

     Not the sign-in form, because most of the time the answer is "you, still",
     and a form that appears and vanishes reads as a glitch. Not the app either,
     which is the whole point. The council's marks and one honest sentence. */
  function checking() {
    return '<div class="gate"><div class="gate-card">' +
      '<div class="gate-top">' +
        '<span class="gate-wash" aria-hidden="true">' +
          '<img class="gate-hero-img" src="assets/img/campus.jpg" alt="" decoding="async">' +
        '</span>' +
        '<div class="gate-brand">' +
          '<img class="gate-seal" src="assets/img/fcusr-seal.png" alt="">' +
          '<div class="gate-name">' + U.esc(Store.trackerTitle(Store.nationalUnitId())) + '</div>' +
          '<div class="gate-org">' + U.esc(Store.org().name) + '</div>' +
        '</div>' +
      '</div>' +
      '<p class="gate-foot" role="status">Checking your sign-in\u2026</p>' +
      '</div></div>';
  }

  /* firstTime() was here, and it is gone.

     It existed because a person created their own account on their first visit:
     the door would try to sign them up with whatever they had typed. They do
     not create their own accounts any more — an executive adds them, the account
     is made then, and they are handed the password. There is no first visit left
     to catch.

     It is worth saying what that guess cost, because it is why this is gone
     rather than merely unused. A refused password could mean "wrong" or "no
     account yet", and the app assumed the second. When the sign-up underneath
     then failed for a reason nobody could read, a first-year volunteer opening
     the site for the first time was told their address already had a password
     and sent to ask an executive for one that had never existed. */

  /* There is no self-service reset and deliberately no emailed link: sending
     mail needs a sender configured in Supabase, and until one is, that button
     only reports an error. What a council has instead is an executive who can
     set the password and say it out loud — which is what actually happens when
     somebody has forgotten theirs. */
  function forgot(prefill) {
    UI.modal({
      title: 'Forgotten password',
      body:
        '<p class="small">Ask a national executive. They can set a new password for ' +
        (prefill ? U.esc(prefill) : 'your address') + ' in the app and tell you what it is, ' +
        'and you can change it yourself once you are in.</p>' +
        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300);margin-top:14px">' +
        '<div class="strong" style="margin-bottom:4px">For the executive</div>' +
        '<div class="small">Settings &rarr; People &rarr; Who can sign in &rarr; ' +
        '<strong>Set password</strong> beside their name.</div></div>' +
        '<p class="small muted">Nobody can look up the password you had. It is stored ' +
        'scrambled, and not even the President can read it back \u2014 which is why a new ' +
        'one has to be set rather than found.</p>',
      footer: '<button type="button" class="btn btn-primary" data-close>Right</button>'
    });
  }

  function mount(root, opts) {
    opts = opts || {};
    var email = root.querySelector('#gate-email');
    var pass = root.querySelector('#gate-pass');

    function submit() {
      if (busy) return;
      var addr = (email.value || '').trim();
      var pw = pass.value || '';

      if (!Auth.isOffline() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
        problem = 'That email address does not look right.';
        return (opts.redraw || App.render)();
      }

      busy = true;
      problem = '';
      if (opts.redraw) opts.redraw(); else App.render();

      function arrived() {
        busy = false;
        problem = '';
        if (opts.onDone) return opts.onDone();
        App.go('#/overview');
        App.render();
        UI.toast('Signed in as ' + Auth.current().name + '.');
      }

      Auth.signIn(addr, pw).then(arrived).catch(function (err) {
        busy = false;
        /* A refused pair is now simply a refused pair.

           It used to mean "or this address has never had a password", because
           people made their own accounts on their first visit — and that guess
           was the start of the worst road in this app: a sign-up that failed for
           a reason nobody could read, then an offer to email a link that could
           not be sent, and a first-year volunteer told to ask an executive for a
           password that had never existed.

           Accounts are made when somebody is added now. There is no first visit
           to handle, so the honest answer is the short one. */
        if (err && err.badCredentials && !Auth.isOffline()) {
          problem = 'That password was not accepted. Ask a national executive to ' +
            'set one for you \u2014 they can do it in a moment.';
        } else {
          problem = err.message || 'That did not work.';
        }
        if (opts.redraw) opts.redraw(); else App.render();
      });
    }

    var forgotBtn = root.querySelector('[data-forgot]');
    if (forgotBtn) {
      forgotBtn.addEventListener('click', function () {
        forgot((email && email.value) || '');
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

  // Called on sign-out so the next person does not land in the last one's state.
  function reset() { busy = false; problem = ''; }

  global.ViewSignIn = { render: render, checking: checking, mount: mount, card: card,
    reset: reset, forgot: forgot };
})(window);
