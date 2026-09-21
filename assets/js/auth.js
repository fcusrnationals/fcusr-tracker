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
      // Finished, archived, or called off: either way there is nothing to help with.
      return e && e.status !== 'Completed' && !Store.isShelved(e);
    });
  }

  function isOffline() { return !global.Backend || Backend.isFallback(); }

  function current() { return me; }
  function signedIn() { return !!me; }

  function isNational() {
    return !!me && me.access === 'officer' && me.unitKind === 'national';
  }

  /* The President of the Republic. Settings is theirs: the letterhead every
     report is printed on, the closing date, the unit list, and deleting
     everything. None of that is a national officer's to change simply for being
     national. */
  function isPresident() {
    return !!me && me.access === 'officer' && me.unitKind === 'national' && me.isHead;
  }

  /* A Governor, or the head of one of the independent bodies. They run their
     own college's roster and nothing else. */
  function isUnitHead() {
    return !!me && me.access === 'officer' && me.unitKind !== 'national' && me.isHead;
  }

  /* Who may open Settings at all.

     Signed in, never a volunteer, and then: the President, or a unit head for
     their own unit. Offline there is no council and no server — one device, one
     person, and no is_head to read from anywhere — so it falls back to the rule
     that held before accounts existed. */
  function canOpenSettings() {
    if (!signedIn() || isVolunteer()) return false;
    if (isOffline()) return isNational();
    return isPresident() || isUnitHead();
  }

  // Kept as the name the rest of the app already asks by.
  function isExecutive() { return canOpenSettings(); }

  function isVolunteer() { return !!me && me.access === 'volunteer'; }

  /* Which unit this person belongs to. A session saved before units existed
     carries no unit, and the only unit that existed then was the National one. */
  function myUnitId() {
    if (!me) return '';

    /* Their unit, whether or not this device has heard of it yet.

       This used to fall back to the National unit when Store.unit() did not
       recognise the id — and it does not recognise it for a while. A device
       seeds its colleges under ids of its own and only adopts the server's on
       the first completed sync, so between signing in and that moment a college
       officer was being treated as a national one. Every scoped list then
       offered them the National government's roster, which is exactly what a
       Governor reported seeing when assigning a task. If the remap never
       happened, it was not a moment; it was permanent.

       A fallback that widens what somebody can reach is the wrong way round.
       An id this device does not know yet matches nothing, so the lists come
       back empty until the first sync fills them in — which is the truthful
       answer and the safe one. */
    if (me.unitId) return me.unitId;

    // No unit named at all: a session saved before units existed, and the only
    // unit that existed then was the National one.
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
    if (isVolunteer()) return canSee(t.eventId);
    return canEditEvent(t.eventId);
  }

  /* The directory entry of whoever is signed in. An account and a directory
     entry are different records, joined by the address the account was made
     with — they do not share an id. */
  function myPerson() {
    if (!me || !me.email) return null;
    return Store.personByEmail(me.email);
  }

  /* Whether this task was given to the person signed in.

     Whoever holds a task may mark how it is going, whatever unit it belongs to.
     That was meant to be true all along and was not: the check compared the
     task's holder with the account's id, which is never a directory entry's
     id, so it matched nobody. A volunteer could not tick off their own
     directive, and a Governor given a task in a National activity could see it
     and not touch it — tapping it did nothing at all. */
  function isMyTask(t) {
    var p = myPerson();
    return !!(p && t && t.assigneeId && t.assigneeId === p.id);
  }

  /* Changing a task's status: whoever may edit it, and whoever holds it. */
  function canUpdateTask(t) {
    return canEditTask(t) || isMyTask(t);
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

  /* Whoever was last signed in on this device. If somebody else signs in, the
     copy on the device is not theirs to see, so it goes before they get in. */
  var LAST_KEY = 'fcusr.tracker.lastAccount';

  function forgetIfSomebodyElse(id) {
    var last = '';
    try { last = global.localStorage.getItem(LAST_KEY) || ''; } catch (e) { last = ''; }
    if (last && id && last !== id && !isOffline() && global.Store && Store.clearLocalCopy) {
      Store.clearLocalCopy();
    }
    try { if (id) global.localStorage.setItem(LAST_KEY, id); } catch (e) { /* not vital */ }
  }

  function adopt(profile) {
    forgetIfSomebodyElse(profile && profile.id);
    me = {
      id: profile.id || 'local',
      email: profile.email || '',
      name: profile.full_name || profile.name || 'Officer',
      position: profile.position || '',
      unitId: profile.unit_id || '',
      unitName: profile.unit_name || 'FCUSR Nationals',
      unitKind: profile.unit_kind || 'national',
      access: profile.access === 'volunteer' ? 'volunteer' : 'officer',
      /* Whether they hold the post rather than merely belong to the unit: the
         FCUSR President nationally, a Governor in a college. It was on the
         server all along and never carried across, which is why every national
         officer could open Settings — the app had no way to tell them apart. */
      isHead: !!(profile.is_head || profile.isHead),
      eventIds: profile.eventIds || []
    };
    remember();
    return me;
  }

  /* Ask the server who this person is now, rather than who they were when they
     signed in.

     An executive moving somebody from volunteer to officer changes the account
     on the server; the app was only reading it at sign-in, so the person kept
     the volunteer screens until they thought to close the tab and come back —
     and nothing on screen suggested they should. Returns true when something
     that decides what they can see actually changed. */
  /* Out, and told why.

     `force`, because an account that has been removed can no longer write, so
     it can never finish the "your work has not reached the server yet" round
     that an ordinary sign-out waits for — it would be held inside the app by
     the very thing meant to remove it. */
  function gone(message) {
    if (global.UI && UI.toast) UI.toast(message, 'error');
    signOut({ force: true });
    return true;
  }

  function refresh() {
    if (isOffline() || !me) return Promise.resolve(false);
    var was = me.access + '|' + me.unitId + '|' + (me.isHead ? 'head' : '') +
      '|' + (me.eventIds || []).join(',');
    return Backend.whoami().then(function (profile) {
      /* Nothing behind the token, and this person was signed in a moment ago —
         so their account has been removed while they were holding the phone.

         That used to read as "nothing changed". They carried on working: every
         screen, every record, the council's whole directory, for as long as
         the tab stayed open. Removing somebody has to mean removing them from
         the device they are holding, not only from the database. */
      if (!profile) return gone('That account has been removed. Ask a national ' +
        'executive to add you again.');
      adopt(profile);
      var now = me.access + '|' + me.unitId + '|' + (me.isHead ? 'head' : '') +
        '|' + (me.eventIds || []).join(',');
      return now !== was;
    }).catch(function (err) {
      /* Only an answer from the server counts. A connection that failed is not
         an answer and must never sign anybody out — a council works in
         corridors and lifts, and being thrown out of the app every time the
         signal drops would be worse than the fault this is fixing. */
      if (err && err.gone) return gone(err.message);
      return false;
    });
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

  /* A volunteer joining with the code an officer gave them.

     The code is the password; the app holds it for them so there is nothing to
     remember and nothing to lose. The server makes the account if this is their
     first time and hands back the username, and the ordinary sign-in follows —
     so from here on a volunteer is somebody signed in like anybody else. */
  function joinWithCode(code, name) {
    var clean = String(code || '').trim().toUpperCase();
    return Backend.joinWithCode(clean, String(name || '').trim()).then(function (username) {
      username = typeof username === 'string' ? username : '';
      if (!username) throw new Error('That code did not open anything. Ask the officer to read it out again.');
      return signIn(username, clean);
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

  /* Signing out has to take the council's work off the device.

     It did not, and a student council runs on shared computers — the library
     PC, the org room laptop. The President would sign out and the next person
     to sign in would open the app onto the President's data: every unit's
     activities, tasks and letters, still there, because syncing only ever adds
     and updates and never removes what somebody should not be seeing.

     So the work is sent first, then the local copy is cleared. Sent first
     because a wipe that loses somebody's afternoon is worse than the problem
     it solves; if the send fails, nothing is cleared and the person is told.

     Offline there is no server and no other copy, so nothing is cleared —
     wiping would be destroying the council's only record. */
  function signOut(opts) {
    opts = opts || {};
    var wasOffline = isOffline();

    function finish() {
      me = null;
      confirmed = true;
      remember();
      if (global.ViewSignIn) ViewSignIn.reset();
      var p = global.Backend ? Backend.signOut() : Promise.resolve();
      return p.then(function () { if (global.App) App.render(); });
    }

    if (wasOffline || !global.Sync || !global.Store) return finish();

    return Sync.now({ full: true }).then(function (st) {
      if (st.error && !opts.force) {
        var e = new Error('Your work has not reached the server yet, so it has not been ' +
          'cleared from this computer. ' + st.error);
        e.unsent = true;
        throw e;
      }
      Store.clearLocalCopy();
      return finish();
    });
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

  /* changePassword() was here. Passwords are made by the system and handed over,
     and nobody changes their own: a list an executive keeps stays true, and a
     forgotten password is one question to them rather than a lost account.
     An executive sets a new one from the account list. */

  /* ---------- a forgotten password ----------

     No email. An emailed link needs a sender configured in Supabase, and until
     one is it is a button that reports an error — which is what this council
     got when they tried it.

     So an executive sets the password instead and tells the person. The server
     decides whether they may; this only carries the request. */
  function setMemberPassword(email, password) {
    return Backend.setPassword(String(email || '').trim().toLowerCase(), password);
  }

  global.Auth = {
    current: current, signedIn: signedIn, isNational: isNational,
    isExecutive: isExecutive, isVolunteer: isVolunteer,
    isPresident: isPresident, isUnitHead: isUnitHead, canOpenSettings: canOpenSettings,
    canEnrolVolunteers: canEnrolVolunteers, canSeeLetter: canSeeLetter,
    canEditUnit: canEditUnit, canEditEvent: canEditEvent, canEditTask: canEditTask,
    canUpdateTask: canUpdateTask, isMyTask: isMyTask, myPerson: myPerson,
    visibleEvents: visibleEvents, canSee: canSee, eventIdsFor: eventIdsFor,
    myUnitId: myUnitId,
    signIn: signIn, signUp: signUp, signOut: signOut, joinWithCode: joinWithCode,
    restore: restore, resume: resume, adopt: adopt, settled: settled,
    refresh: refresh,
    promptSignIn: promptSignIn, requireExecutive: requireExecutive,
    isOffline: isOffline,
    setMemberPassword: setMemberPassword
  };
})(window);
