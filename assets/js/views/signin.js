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
        'First time here? Use the address a national executive enrolled you with. ' +
        'You will be asked to choose your password once you do.' +
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

  /* Shown when an address is used for the first time: the password the door was
     given was not accepted, and no account has ever existed on that address, so
     the only thing left to do is set one. It cannot be dismissed by clicking
     away or pressing Escape — there is nothing behind it to go back to, and a
     half-claimed enrolment is worse than none. */
  function firstTime(email, typed, onDone) {
    var working = false;

    UI.modal({
      title: 'Set your password',
      dismissible: false,
      body:
        '<div class="card" style="background:var(--gold-50);border-color:var(--gold-300)">' +
        '<div class="strong" style="margin-bottom:3px">This is the first time ' +
        U.esc(email) + ' has signed in.</div>' +
        '<div class="small">Choose the password you will use from now on. ' +
        'You cannot go any further until you do.</div></div>' +

        '<div class="field" style="margin-top:16px"><label for="ft-a">New password</label>' +
        '<input type="password" id="ft-a" autocomplete="new-password" data-autofocus value="' +
        U.esc(typed || '') + '">' +
        '<div class="hint">At least eight characters. Nobody else — here or in the council — ' +
        'ever sees it, and no executive can look it up.</div></div>' +

        '<div class="field"><label for="ft-b">Type it again</label>' +
        '<input type="password" id="ft-b" autocomplete="new-password"></div>' +

        '<div class="error-text" data-err hidden></div>' +

        '<p class="small muted">Signed in before? This address would already have a password, ' +
        'so close this and check what you typed.</p>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn btn-primary" data-go>Set it and sign in</button>',
      onMount: function (root, close) {
        var a = root.querySelector('#ft-a');
        var b = root.querySelector('#ft-b');
        var err = root.querySelector('[data-err]');
        var go = root.querySelector('[data-go]');

        function fail(msg) {
          working = false;
          go.disabled = false;
          go.textContent = 'Set it and sign in';
          err.hidden = false;
          err.textContent = msg;
        }

        function submit() {
          if (working) return;
          var pw = a.value || '';
          if (pw.length < 8) return fail('Too short — use at least eight characters.');
          if (pw !== (b.value || '')) return fail('The two do not match.');

          working = true;
          err.hidden = true;
          go.disabled = true;
          go.textContent = 'One moment…';

          Auth.signUp(email, pw).then(function () {
            close();
            onDone();
          }).catch(function (e) {
            /* The dead end this used to be. The address has an account, so
               there is nothing to set — and the person standing here is almost
               always somebody who has forgotten theirs. Hand them the way out
               rather than the fact. */
            if (e && e.alreadyClaimed) {
              close();
              return forgot(email);
            }
            fail((e && e.message) || 'That could not be set.');
          });
        }

        go.addEventListener('click', submit);
        [a, b].forEach(function (el) {
          el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
        });
      }
    });
  }

  /* Nobody in the council can look a password up or set one for somebody else,
     so the only way back is a link sent to the address itself. Before this
     there was no way back at all: an officer who forgot theirs was offered
     "Set your password", which failed because the address already had an
     account, and that was the end of it. */
  function forgot(prefill) {
    var working = false;
    UI.modal({
      title: 'Forgotten password',
      body:
        '<p class="small">We will email a link to the address below. Open it on this ' +
        'phone or computer and you can choose a new password.</p>' +
        '<div class="field" style="margin-top:14px"><label for="fp-email">Email</label>' +
        '<input type="email" id="fp-email" inputmode="email" autocapitalize="off" ' +
        'spellcheck="false" data-autofocus value="' + U.esc(prefill || '') + '"></div>' +
        '<div class="error-text" data-err hidden></div>' +
        '<p class="small muted">Use the address you were enrolled with. Nobody here can ' +
        'see or set your password &mdash; not even the President &mdash; which is why it ' +
        'has to go to your inbox.</p>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn btn-primary" data-go>Send the link</button>',
      onMount: function (root, close) {
        var input = root.querySelector('#fp-email');
        var err = root.querySelector('[data-err]');
        var go = root.querySelector('[data-go]');

        go.addEventListener('click', function () {
          if (working) return;
          var addr = (input.value || '').trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
            err.hidden = false;
            err.textContent = 'That email address does not look right.';
            return;
          }
          working = true;
          go.disabled = true;
          go.textContent = 'Sending\u2026';
          Auth.sendReset(addr).then(function () {
            close();
            /* Deliberately the same words whether or not the address is one we
               know. Saying "no such account" would let anybody test addresses
               against the Republic's roster. */
            UI.modal({
              title: 'Check your email',
              body: '<p class="small">If ' + U.esc(addr) + ' has an account, a link is on ' +
                'its way. It expires after an hour, and it only works once.</p>' +
                '<p class="small muted">Nothing in your inbox after a few minutes? Look in ' +
                'spam, then ask a national executive &mdash; the address may not be enrolled.</p>',
              footer: '<button type="button" class="btn btn-primary" data-close>Right</button>'
            });
          }).catch(function (e) {
            working = false;
            go.disabled = false;
            go.textContent = 'Send the link';
            err.hidden = false;
            err.textContent = (e && e.message) || 'That could not be sent.';
          });
        });
      }
    });
  }

  /* Where the emailed link lands. The token in it is good for exactly one act
     and is never kept. */
  function chooseNew(token, onDone) {
    var working = false;
    UI.modal({
      title: 'Choose a new password',
      dismissible: false,
      body:
        '<p class="small">This link is good once. Choose the password you will use from ' +
        'now on.</p>' +
        '<div class="field" style="margin-top:14px"><label for="np-a">New password</label>' +
        '<input type="password" id="np-a" autocomplete="new-password" data-autofocus></div>' +
        '<div class="field"><label for="np-b">Type it again</label>' +
        '<input type="password" id="np-b" autocomplete="new-password"></div>' +
        '<div class="error-text" data-err hidden></div>',
      footer: '<button type="button" class="btn btn-primary" data-go>Set it</button>',
      onMount: function (root, close) {
        var a = root.querySelector('#np-a');
        var b = root.querySelector('#np-b');
        var err = root.querySelector('[data-err]');
        var go = root.querySelector('[data-go]');

        function fail(msg) {
          working = false; go.disabled = false; go.textContent = 'Set it';
          err.hidden = false; err.textContent = msg;
        }

        function submit() {
          if (working) return;
          var pw = a.value || '';
          if (pw.length < 8) return fail('Too short \u2014 use at least eight characters.');
          if (pw !== (b.value || '')) return fail('The two do not match.');
          working = true; err.hidden = true;
          go.disabled = true; go.textContent = 'One moment\u2026';
          Auth.finishReset(token, pw).then(function () {
            close();
            UI.toast('Password changed. Sign in with it now.');
            if (onDone) onDone();
          }).catch(function (e) {
            fail((e && e.message) ||
              'That link has expired or was already used. Ask for another.');
          });
        }

        go.addEventListener('click', submit);
        [a, b].forEach(function (el) {
          el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
        });
      }
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
        /* The pair was refused. Either the password is wrong or this address has
           never had one — and the second is the common case on a system nobody
           has used yet, so it is handled rather than reported. */
        if (err && err.badCredentials && !Auth.isOffline()) {
          if (opts.redraw) opts.redraw(); else App.render();
          return firstTime(addr, pw, arrived);
        }
        problem = err.message || 'That did not work.';
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
    reset: reset, forgot: forgot, chooseNew: chooseNew };
})(window);
