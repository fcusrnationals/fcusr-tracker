/* The workspace — the pieces the newer screens share.

   Calendar, Bulletin Board, People, Tools and Archive live behind one More
   button rather than five more tabs: the row across the bottom of a phone
   holds five things, and those five are the work people open the app to do.
   Everything here is reached when it is needed and is out of the way when it
   is not.

   What is in this file:
     load()          fetching a heavy tool's code only when it is opened
     me()/viewer()   who is looking, as the directory and the Bulletin know them
     the year view   which academic year the screens are showing
     history()       the "••• → Activity history" dialog
     hint()          one-line first-use notes, dismissed for good
     openMore()      the More menu itself */
(function (global) {
  'use strict';

  /* ---------- loading a tool only when it is opened ----------

     The Watermark Studio and the term report are the two heavy pieces, and
     most visits never touch either. They are fetched the first time they are
     opened, with the same version number as everything else so a new release
     is never mixed with an old one. */
  var loading = {};

  function version() {
    var el = document.querySelector('script[src*="app.js?v="]');
    var m = el && el.getAttribute('src').match(/\?v=(\d+)/);
    return m ? m[1] : '';
  }

  function load(src, ready) {
    // Already here — loaded with the page, or by a test.
    if (ready && ready()) return Promise.resolve(true);
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var v = version();
      s.src = src + (v ? '?v=' + v : '');
      s.onload = function () { resolve(true); };
      s.onerror = function () {
        delete loading[src];
        reject(new Error('That part of the app could not be loaded. Check your connection ' +
          'and try again — it only needs the internet the first time.'));
      };
      document.head.appendChild(s);
    });
    return loading[src];
  }

  /* ---------- who is looking ---------- */

  function onlineAccount() {
    return !!(global.Auth && Auth.signedIn() && !Auth.isOffline());
  }

  /* The directory entry of whoever is signed in — by the address their account
     was made with, and failing that by a name only one entry has. With no
     server behind the tracker, whoever was last picked on My tasks. */
  function me() {
    if (onlineAccount()) {
      var byMail = Auth.myPerson ? Auth.myPerson() : null;
      if (byMail) return byMail;
      var want = U.nameKey(Auth.current().name);
      if (!want) return null;
      var same = Store.people().filter(function (p) { return U.nameKey(p.name) === want; });
      return same.length === 1 ? same[0] : null;
    }
    var id = Store.lastPerson();
    return id ? Store.person(id) : null;
  }

  /* The shape Store.announcementFor asks for. Offline, the one person at the
     one device is treated as national, as everywhere else. */
  function viewer() {
    var p = me();
    if (!onlineAccount()) {
      return { national: true, officer: true, unitId: Store.nationalUnitId(), personId: p ? p.id : '' };
    }
    return {
      national: Auth.isNational(), officer: !Auth.isVolunteer(),
      unitId: Auth.myUnitId(), personId: p ? p.id : ''
    };
  }

  // A unit this person works in, for filtering "mine".
  function myUnitId() {
    return (global.Auth && Auth.signedIn()) ? Auth.myUnitId() : Store.nationalUnitId();
  }

  /* ---------- which academic year is on screen ----------

     The current one, unless somebody has chosen to look back. The choice lasts
     for this visit only: opening the app tomorrow on last year's records, with
     nothing but a banner to say so, is exactly the confusion the banner is for. */
  var VIEW_KEY = 'fcusr.tracker.viewYear';

  function viewYear() {
    var v = '';
    try { v = global.sessionStorage.getItem(VIEW_KEY) || ''; } catch (e) { v = ''; }
    if (v && v !== 'current' && Store.yearInfo(v)) return v;
    return 'current';
  }

  function setViewYear(yid) {
    try {
      if (!yid || yid === 'current') global.sessionStorage.removeItem(VIEW_KEY);
      else global.sessionStorage.setItem(VIEW_KEY, yid);
    } catch (e) { /* a private window: the choice lasts until the next redraw */ }
    if (global.App) App.render();
  }

  function viewingArchive() { return viewYear() !== 'current'; }

  // Whether a record belongs on the screens for the year being looked at.
  function inView(kind, rec) {
    return Store.yearOf(kind, rec) === viewYear();
  }

  /* The band across the top of every screen while an archived year is showing,
     so nobody takes last year's list for this year's work. */
  function yearBanner() {
    if (!viewingArchive()) return '';
    var y = Store.yearInfo(viewYear());
    var cur = Store.currentYear();
    return '<div class="ay-banner" role="status">' + UI.icon('lock') +
      '<span>You’re viewing archived records from <strong>AY ' + U.esc(y.label) + '</strong>. ' +
      'They’re read-only.</span>' +
      '<button type="button" class="btn btn-sm" data-year-current>Back to AY ' + U.esc(cur.label) +
      '</button></div>';
  }

  function wireYearBanner(root) {
    U.els('[data-year-current]', root).forEach(function (b) {
      b.addEventListener('click', function () { setViewYear('current'); });
    });
  }

  /* A single record opened from an archived year says so at the top, whatever
     year the rest of the screens are showing. */
  function lockedNote(kind, rec) {
    var yid = Store.yearOf(kind, rec);
    if (yid === 'current') return '';
    var y = Store.yearInfo(yid);
    if (!y) return '';
    if (!Store.yearLocked(yid)) {
      return '<div class="readonly-note is-open">' + UI.icon('unlock') +
        '<span>Part of <strong>AY ' + U.esc(y.label) + '</strong>, which is archived and open for ' +
        'corrections until ' + U.esc(U.fmtTime(y.unlockedUntil)) + '.</span></div>';
    }
    return '<div class="readonly-note">' + UI.icon('lock') +
      '<span>Part of <strong>AY ' + U.esc(y.label) + '</strong>, which is archived. ' +
      'Everything here is read-only.</span></div>';
  }

  /* ---------- activity history ---------- */

  function historyDialog(kind, rid, title) {
    var rows = Store.historyFor(kind, rid);
    var body = rows.length
      ? '<ol class="history">' + rows.map(function (h) {
          return '<li><span class="h-text"><strong>' + U.esc(h.by || 'Someone') + '</strong> ' +
            U.esc(h.text) + '</span><span class="h-when">' + U.esc(U.fmtWhen(h.at)) +
            ' · ' + U.esc(U.fmtTime(h.at)) + '</span></li>';
        }).join('') + '</ol>'
      : '<p class="small muted" style="margin:0">Nothing recorded yet. Changes made from now on ' +
        'will appear here.</p>';
    UI.modal({
      title: 'Activity history',
      body: (title ? '<p class="small muted" style="margin-top:0">' + U.esc(title) + '</p>' : '') + body +
        '<p class="tiny muted" style="margin:14px 0 0">Creation, assignments, status and date changes, ' +
        'and removals. Records made before this was added start with whatever happened next.</p>',
      footer: '<button type="button" class="btn btn-primary" data-close>Done</button>'
    });
  }

  /* ---------- first-use hints ----------

     One line under a heading the first time a screen is opened, then gone for
     good on this device once dismissed. Not a tour: nobody has to click
     through anything to reach their work. */
  var HINT_KEY = 'fcusr.tracker.hints';

  function dismissed() {
    try { return JSON.parse(global.localStorage.getItem(HINT_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function hint(key, text) {
    if (dismissed()[key]) return '';
    return '<div class="hint-card" data-hint="' + U.esc(key) + '">' + UI.icon('info') +
      '<span>' + text + '</span>' +
      '<button type="button" class="icon-btn" data-hint-close aria-label="Dismiss this tip">' +
      UI.icon('close') + '</button></div>';
  }

  function dismissHint(key) {
    var d = dismissed();
    d[key] = 1;
    try { global.localStorage.setItem(HINT_KEY, JSON.stringify(d)); } catch (e) { /* not vital */ }
  }

  function wireHints(root) {
    U.els('[data-hint-close]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var card = b.closest('[data-hint]');
        dismissHint(card.getAttribute('data-hint'));
        card.remove();
      });
    });
  }

  /* ---------- a table the database does not have yet ---------- */

  function waitingFor(table) {
    if (!global.Sync || !Sync.able()) return false;
    return (Sync.status().missing || []).indexOf(table) >= 0;
  }

  /* Said where it matters and to whoever can do something about it. The
     President is told which file to run; everybody else, that it is coming. */
  function setupNotice(table, what) {
    if (!waitingFor(table)) return '';
    var admin = global.Auth && (Auth.isPresident() || Auth.isNational());
    return '<div class="readonly-note">' + UI.icon('info') + '<span>' +
      (admin
        ? U.esc(what) + ' needs one setup step on the database: run ' +
          '<strong>backend/supabase/workspace.sql</strong> in Supabase → SQL Editor. ' +
          'Until then, what you add here stays on this device.'
        : U.esc(what) + ' is waiting for one setup step on the council’s database. ' +
          'Until it is done, what you add here stays on this device.') +
      '</span></div>';
  }

  /* ---------- the More menu ---------- */

  var ROUTES = ['calendar', 'bulletin', 'people', 'tools', 'archive'];

  function isVolunteer() { return !!(global.Auth && Auth.isVolunteer()); }

  function moreItems() {
    var unread = global.Bulletin ? Bulletin.unreadCount() : 0;
    var cur = Store.currentYear();
    var list = [
      { route: 'calendar', icon: 'calendar', title: 'Calendar', sub: 'Events and deadlines by date' },
      { route: 'bulletin', icon: 'megaphone', title: 'Bulletin Board', sub: 'Announcements from FCUSR Nationals',
        badge: unread },
      { route: 'people', icon: 'users', title: 'People', sub: 'Officers and volunteers', hide: isVolunteer() },
      { route: 'tools', icon: 'tools', title: 'Tools', sub: 'Watermark Studio and council apps' },
      { route: 'archive', icon: 'archive', title: 'Archive',
        sub: viewingArchive() ? 'Viewing AY ' + Store.yearInfo(viewYear()).label
                              : 'AY ' + cur.label + ' · past years',
        hide: isVolunteer() }
    ];
    return list.filter(function (x) { return !x.hide; });
  }

  // On a phone the header drops the gear, so Settings is reached from here.
  function settingsItem() {
    if (!global.Auth || isVolunteer()) return null;
    return { route: 'settings', icon: 'settings', title: 'Settings', sub: 'Council setup, accounts and the term' };
  }

  function narrow() {
    return !!(global.matchMedia && global.matchMedia('(max-width: 700px)').matches);
  }

  function openMore(anchor) {
    var items = moreItems();
    var set = settingsItem();

    if (!narrow()) {
      var html = items.map(function (it) {
        return '<button type="button" class="rich" data-set="' + it.route + '">' +
          UI.icon(it.icon) + '<span class="rich-text"><span class="rich-title">' + U.esc(it.title) +
          (it.badge ? ' <span class="count">' + it.badge + '</span>' : '') + '</span>' +
          '<span class="rich-sub">' + U.esc(it.sub) + '</span></span></button>';
      }).join('');
      var menu = UI.openMenu(anchor, html, function (route) { App.go('#/' + route); },
        { cls: 'menu-rich' });
      menu.setAttribute('aria-label', 'Workspace');
      return menu;
    }

    var tiles = items.concat(set ? [set] : []);
    UI.modal({
      title: 'Workspace',
      sheet: true,
      cls: 'more-sheet',
      body: '<div class="more-grid">' + tiles.map(function (it) {
        return '<button type="button" class="more-tile" data-go="' + it.route + '">' +
          '<span class="mt-icon">' + UI.icon(it.icon) +
          (it.badge ? '<span class="count">' + it.badge + '</span>' : '') + '</span>' +
          '<span class="mt-title">' + U.esc(it.title) + '</span>' +
          '<span class="mt-sub">' + U.esc(it.sub) + '</span></button>';
      }).join('') + '</div>',
      onMount: function (root, close) {
        U.els('[data-go]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            close();
            var r = b.getAttribute('data-go');
            if (r === 'settings' && global.Auth && !Auth.isExecutive()) {
              return Auth.requireExecutive(function () { App.go('#/settings'); });
            }
            App.go('#/' + r);
          });
        });
      }
    });
  }

  /* A one-time pointer to where the new screens went, the first time the app
     is opened after the update. It sits beside the button it is about and
     goes the moment it is read. */
  var TOUR_KEY = 'fcusr.tracker.moreIntro';
  function introduceMore() {
    try { if (global.localStorage.getItem(TOUR_KEY)) return; } catch (e) { return; }
    var tab = document.querySelector('[data-route="more"]');
    if (!tab || tab.hidden || document.querySelector('.modal-backdrop')) return;
    var tip = document.createElement('div');
    tip.className = 'intro-tip';
    tip.setAttribute('role', 'status');
    tip.innerHTML = '<strong>New:</strong> Calendar, Bulletin Board, People, Tools and Archive ' +
      'are under <strong>More</strong>.' +
      '<button type="button" class="btn btn-sm" data-intro-ok>Got it</button>';
    document.body.appendChild(tip);
    var done = function () {
      try { global.localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* not vital */ }
      tip.remove();
    };
    tip.querySelector('[data-intro-ok]').addEventListener('click', done);
    tab.addEventListener('click', done, { once: true });
  }

  /* ---------- small shared pieces ---------- */

  // A link that leaves the app, marked as one.
  function extLink(url, label, cls) {
    return '<a class="' + (cls || 'btn') + '" href="' + U.esc(url) + '" target="_blank" rel="noopener noreferrer">' +
      U.esc(label) + UI.icon('external') + '</a>';
  }

  function isWorkspaceRoute(name) { return ROUTES.indexOf(name) >= 0; }

  global.Workspace = {
    load: load, me: me, viewer: viewer, myUnitId: myUnitId,
    viewYear: viewYear, setViewYear: setViewYear, viewingArchive: viewingArchive, inView: inView,
    yearBanner: yearBanner, wireYearBanner: wireYearBanner, lockedNote: lockedNote,
    history: historyDialog,
    hint: hint, wireHints: wireHints, dismissHint: dismissHint,
    waitingFor: waitingFor, setupNotice: setupNotice,
    openMore: openMore, moreItems: moreItems, introduceMore: introduceMore, narrow: narrow,
    extLink: extLink, isWorkspaceRoute: isWorkspaceRoute, ROUTES: ROUTES
  };
})(window);
