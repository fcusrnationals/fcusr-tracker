/* Who is signed in, and what that entitles them to.

   Access is decided by two server-controlled facts and nothing else:

     unit    — National, a province, COMELEC, or the Judiciary
     access  — 'officer' or 'volunteer'

   A typed position is a label printed on reports; it grants nothing. That is why
   no wording in it can widen anyone's access — there is no field to widen.

   While the Supabase project is still being set up, Backend falls back to local
   and this module signs in a standing national officer so the app keeps working
   offline exactly as before. */
(function (global) {
  'use strict';

  var SESSION_KEY = 'fcusr.tracker.session';
  var me = null;

  /* A volunteer's rights end with the activity they were enrolled for. */
  function eventIdsFor(profile) {
    if (!profile) return [];
    return (profile.eventIds || []).filter(function (id) {
      var e = Store.event(id);
      return e && e.status !== 'Completed' && e.status !== 'Archived';
    });
  }

  function isOffline() { return !global.Backend || Backend.isFallback(); }

  function current() { return me; }
  function signedIn() { return !!me; }

  function isNational() {
    return !!me && me.access === 'officer' && me.unitKind === 'national';
  }

  // The executives: the only people who may enrol anyone or open Settings.
  function isExecutive() { return isNational(); }

  function isVolunteer() { return !!me && me.access === 'volunteer'; }

  /* Which unit this person belongs to. A session saved before units existed
     carries no unit, and the only unit that existed then was the National one. */
  function myUnitId() {
    if (!me) return '';
    if (me.unitId && Store.unit(me.unitId)) return me.unitId;
    return Store.nationalUnitId();
  }

  /* Which events this person may open.

     The National government sees itself and the provinces. It does not see
     COMELEC, the Judiciary or the other independent bodies — not their tasks,
     not their events, not how far along they are. Those answer for themselves
     and are read only at the end of the term, through the accomplishment report
     they file. A province officer sees their own unit. A volunteer sees only
     what they were enrolled into, and only while it runs.

     This is the same rule the database enforces in events_read, kept here so the
     screens agree with the server rather than showing rows it would refuse. */
  function visibleEvents() {
    var all = Store.events();
    if (!me) return [];
    if (isVolunteer()) {
      var allowed = eventIdsFor(me);
      return all.filter(function (e) { return allowed.indexOf(e.id) >= 0; });
    }
    var mine = myUnitId();
    if (isNational()) {
      return all.filter(function (e) { return !Store.isIndependent(e.unitId); });
    }
    return all.filter(function (e) { return e.unitId === mine; });
  }

  function canSee(eventId) {
    if (!me) return false;
    if (isVolunteer()) return eventIdsFor(me).indexOf(eventId) >= 0;
    var e = Store.event(eventId);
    if (!e) return false;
    if (isNational()) return !Store.isIndependent(e.unitId);
    return e.unitId === myUnitId();
  }

  /* Seeing is not the same as touching.

     The National government oversees the provinces: it reads their events, their
     tasks and how far along they are, and that is where it stops. A college's
     work is that college's to change — a national officer opening it gets the
     same screen with nothing to press. Editing is always your own unit's work,
     and a volunteer only ever moves a task that was given to them. */
  function canEditUnit(unitId) {
    if (!me || !unitId) return false;
    if (isVolunteer()) return false;
    return me.access === 'officer' && unitId === myUnitId();
  }

  function canEditEvent(eventId) {
    var e = Store.event(eventId);
    return !!e && canEditUnit(e.unitId);
  }

  function canEditTask(t) {
    if (!me || !t) return false;
    if ((t.kind || 'event') === 'directive') return isNational();
    if (isVolunteer()) return t.assigneeId === me.id || canSee(t.eventId);
    return canEditEvent(t.eventId);
  }

  /* A letter follows the same rule as an event: it belongs to a unit, and the
     independent bodies are sealed from the National government. Typing the
     address of a letter must not get round that, which is why this is checked
     when the screen opens and not only when the list is drawn. */
  function canSeeLetter(l) {
    if (!me || !l) return false;
    if (isVolunteer()) return false;
    if (isNational()) return !Store.isIndependent(l.unitId);
    return l.unitId === myUnitId();
  }

  /* An officer may take on helpers for their own unit's activities. That is not
     the same as opening Settings, which stays with the National executives. */
  function canEnrolVolunteers() {
    return !!me && me.access === 'officer';
  }

  function restore() {
    try {
      var raw = global.localStorage.getItem(SESSION_KEY);
      if (raw) me = JSON.parse(raw);
    } catch (e) { me = null; }
    return me;
  }

  function remember() {
    try {
      if (me) global.localStorage.setItem(SESSION_KEY, JSON.stringify(me));
      else global.localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* storage blocked; the session lasts this visit only */ }
  }

  function adopt(profile) {
    me = {
      id: profile.id || 'local',
      email: profile.email || '',
      name: profile.full_name || profile.name || 'Officer',
      position: profile.position || '',
      unitId: profile.unit_id || '',
      unitName: profile.unit_name || 'FCUSR Nationals',
      unitKind: profile.unit_kind || 'national',
      access: profile.access === 'volunteer' ? 'volunteer' : 'officer',
      eventIds: profile.eventIds || []
    };
    remember();
    return me;
  }

  function signIn(email, password) {
    if (isOffline()) {
      // No project configured yet: the app runs as it always has, with the
      // person at the keyboard treated as a national officer.
      return Promise.resolve(adopt({
        id: 'local', full_name: 'National Officer', position: 'President',
        unit_id: Store.nationalUnitId(), unit_name: Store.unitName(Store.nationalUnitId()),
        unit_kind: 'national', access: 'officer'
      }));
    }
    return Backend.signIn(email, password).then(function (profile) {
      if (!profile) throw new Error('That account is not enrolled yet.');
      return adopt(profile);
    });
  }

  /* Claiming an enrolment: the person sets their own password on an address an
     executive has already enrolled. If nobody enrolled it, the backend makes no
     profile and this fails with a plain explanation rather than a blank app. */
  function signUp(email, password) {
    if (isOffline()) return signIn(email, password);
    return Backend.signUp(email, password).then(function (profile) {
      if (!profile) throw new Error('That address has not been enrolled yet.');
      return adopt(profile);
    });
  }

  function signOut() {
    me = null;
    remember();
    if (global.ViewSignIn) ViewSignIn.reset();
    var p = global.Backend ? Backend.signOut() : Promise.resolve();
    return p.then(function () { if (global.App) App.render(); });
  }

  /* Settings holds enrolment, so it asks who you are before it opens — even
     offline, where the prompt is a reminder rather than a wall. */
  function requireExecutive(onGranted) {
    if (isExecutive()) return onGranted();
    if (!signedIn()) return promptSignIn(function () { requireExecutive(onGranted); });
    UI.modal({
      title: 'Executives only',
      body: '<p class="small">Enrolment and access are handled by the national executives. ' +
        'You are signed in as <strong>' + U.esc(me.name) + '</strong> (' +
        U.esc(me.access === 'volunteer' ? 'volunteer' : 'officer') + ', ' +
        U.esc(me.unitName) + '), which does not include this.</p>' +
        '<p class="small muted">Ask a national executive if you need someone enrolled.</p>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn btn-primary" data-switch>Sign in as someone else</button>',
      onMount: function (root, close) {
        root.querySelector('[data-switch]').addEventListener('click', function () {
          close();
          signOut().then(function () { promptSignIn(function () { requireExecutive(onGranted); }); });
        });
      }
    });
  }

  /* Start-up. The device remembers who was signed in, so the first screen is not
     blank while the network is asked; then the backend confirms it. A session
     that has lapsed signs out quietly rather than leaving the app pretending. */
  /* False until the backend has had its say about whoever this device
     remembers. It matters because `restore()` above is instant and trusting: it
     reads a name out of localStorage and the app would happily draw the whole
     Republic around it. Confirming that name takes a moment, and for that moment
     nothing of the council's may be on screen — a lapsed session, or a phone
     picked up by somebody else, would otherwise get a good look at it first. */
  var confirmed = false;
  function settled() { return isOffline() || confirmed; }

  function resume() {
    /* Asking again means not knowing again. The flag says "the backend has
       answered the question being asked now", not "it answered one once". */
    confirmed = false;
    restore();
    if (isOffline()) { confirmed = true; return Promise.resolve(me); }
    return Backend.restore().then(function (profile) {
      if (profile) adopt(profile);
      else if (me) { me = null; remember(); }
      return me;
    }).catch(function () {
      /* The backend could not be reached. A remembered session is not proof of
         anything, so it is not honoured — signing in again needs the network
         anyway, and guessing in favour of access is the wrong way to guess. */
      if (me) { me = null; remember(); }
      return me;
    }).then(function (out) {
      confirmed = true;
      if (global.App) App.render();
      return out;
    });
  }

  /* Sign in, or set a password for the first time.

     There is no "register" here in the usual sense. An executive enrols an email
     address first; setting a password is how that person claims the enrolment
     already waiting for them. Doing it in this order means the app never handles
     anyone else's password, and a stranger who finds the site can make himself a
     login and still see nothing at all. */
  /* Signing in without leaving the screen you were on — reached from Settings,
     or when switching accounts. It shows the same card as the front door rather
     than a second, plainer form: two sign-in screens that look different is how
     people end up wondering which one is the real one. */
  function promptSignIn(after) {
    if (!global.ViewSignIn) return;

    var close = UI.modal({
      title: 'Sign in',
      body: '<div id="signin-host">' + ViewSignIn.card({ inModal: true }) + '</div>',
      onMount: function (root) {
        var host = root.querySelector('#signin-host');

        function wire() {
          ViewSignIn.mount(host, {
            // Redrawing the card in place, so a typed password is not lost to a
            // full re-render of the page behind the dialog.
            redraw: function () {
              host.innerHTML = ViewSignIn.card({ inModal: true });
              wire();
            },
            onDone: function () {
              close();
              if (global.App) App.render();
              UI.toast('Signed in as ' + me.name + '.');
              if (after) after();
            }
          });
        }
        wire();
      }
    });
  }

  /* Each person changes their own password; nobody else can, and the app never
     sees the old one. */
  function changePassword() {
    UI.modal({
      title: 'Change your password',
      body: '<div class="field"><label for="pw1">New password</label>' +
        '<input type="password" id="pw1" data-autofocus autocomplete="new-password"></div>' +
        '<div class="field"><label for="pw2">Type it again</label>' +
        '<input type="password" id="pw2" autocomplete="new-password">' +
        '<div class="error-text" hidden></div></div>' +
        '<p class="small muted">At least eight characters.</p>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-go>Change it</button>',
      onMount: function (root, close) {
        root.querySelector('[data-go]').addEventListener('click', function () {
          var a = root.querySelector('#pw1').value;
          var b = root.querySelector('#pw2').value;
          var f = root.querySelector('#pw2').closest('.field');
          var err = f.querySelector('.error-text');
          function fail(msg) {
            f.classList.add('has-error');
            err.textContent = msg;
            err.hidden = false;
          }
          if (a.length < 8) return fail('Too short — use at least eight characters.');
          if (a !== b) return fail('Those two do not match.');
          Backend.changePassword(a).then(function () {
            close();
            UI.toast('Password changed.');
          }).catch(function (e) { fail(e.message || 'That could not be changed.'); });
        });
      }
    });
  }

  global.Auth = {
    current: current, signedIn: signedIn, isNational: isNational,
    isExecutive: isExecutive, isVolunteer: isVolunteer,
    canEnrolVolunteers: canEnrolVolunteers, canSeeLetter: canSeeLetter,
    canEditUnit: canEditUnit, canEditEvent: canEditEvent, canEditTask: canEditTask,
    visibleEvents: visibleEvents, canSee: canSee, eventIdsFor: eventIdsFor,
    myUnitId: myUnitId,
    signIn: signIn, signUp: signUp, signOut: signOut,
    restore: restore, resume: resume, adopt: adopt, settled: settled,
    promptSignIn: promptSignIn, requireExecutive: requireExecutive,
    changePassword: changePassword, isOffline: isOffline
  };
})(window);
