/* FCUSR Task Tracker — router and app shell wiring.
   Views re-render wholesale whenever the store changes; each view keeps its own
   filter state in module scope so nothing visible is lost on redraw. */
(function (global) {
  'use strict';

  var ROUTES = {
    'overview': global.ViewDashboard,
    'my-tasks': global.ViewMyTasks,
    'directives': global.ViewDirectives,
    'events': global.ViewEvents,
    'letters': global.ViewLetters,
    'settings': global.ViewSettings
  };

  var current = { name: 'overview', params: {} };
  var viewEl, tabsEl;

  function parseHash() {
    var raw = (location.hash || '#/overview').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    if (!parts.length) return { name: 'overview', params: {} };
    // The screen used to be called Dashboard; old links still work.
    if (parts[0] === 'dashboard') return { name: 'overview', params: {} };
    if (parts[0] === 'events' && parts[1]) return { name: 'event-detail', params: { id: parts[1] } };
    if (parts[0] === 'letters' && parts[1]) return { name: 'letter-detail', params: { id: parts[1] } };
    if (ROUTES[parts[0]]) return { name: parts[0], params: {} };
    return { name: 'overview', params: {} };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    UI.closeMenu();

    /* Nobody sees the Republic's work without saying who they are.

       The gate only stands once a backend is connected: offline there is nothing
       to authenticate against, the data is on this device alone, and a password
       box would be theatre. That is why the app opens straight in today and will
       not once Supabase is live. */
    /* Before the door, the doorstep. A remembered session is read from this
       device instantly and is not evidence of anything until the backend agrees,
       so until it has, neither the app nor the sign-in form is drawn. Skipping
       this is what made the Republic's work flash up for a moment in front of
       somebody who turned out not to be signed in at all. */
    if (global.Auth && !Auth.isOffline() && !Auth.settled()) {
      document.body.classList.add('is-gated');
      viewEl.innerHTML = global.ViewSignIn ? ViewSignIn.checking() : '';
      document.title = trackerTitle();
      return;
    }

    if (global.Auth && !Auth.isOffline() && !Auth.signedIn()) {
      document.body.classList.add('is-gated');
      if (global.ViewSignIn) {
        viewEl.innerHTML = ViewSignIn.render();
        ViewSignIn.mount(viewEl);
      } else {
        // The door still holds even if its own screen did not load.
        viewEl.innerHTML = UI.empty('Sign in to continue',
          'This tracker belongs to the FCUSR. Sign in with the address you were enrolled with.',
          '<button type="button" class="btn btn-primary" id="gate-fallback">Sign in</button>');
        var gf = viewEl.querySelector('#gate-fallback');
        if (gf) gf.addEventListener('click', function () { Auth.promptSignIn(); });
      }
      document.title = 'Sign in · ' + trackerTitle();
      return;
    }
    document.body.classList.remove('is-gated');
    /* Anything the app wants to say on arrival waits until there is an app to
       say it in front of. The closing date and the rehearsal notice used to be
       announced at boot, which meant a stranger at the sign-in screen was told
       what the council still owes before being asked who they were. */
    greet();
    var view = current.name === 'event-detail' ? global.ViewEventDetail
      : current.name === 'letter-detail' ? global.ViewLetterDetail
      : ROUTES[current.name];
    if (!view) view = global.ViewDashboard;

    // A volunteer may only open the events they were enrolled into.
    if (current.name === 'event-detail' && global.Auth && Auth.signedIn() &&
        !Auth.canSee(current.params.id)) {
      viewEl.innerHTML = UI.empty('Not your event',
        'You were not enrolled in this activity, so it is not yours to open.',
        '<a class="btn btn-primary" href="#/events">Back to your events</a>');
      syncTabs();
      return;
    }

    // A letter belongs to a unit, and typing its address is not a way in.
    if (current.name === 'letter-detail' && global.Auth && Auth.signedIn()) {
      var ltr = Store.letter(current.params.id);
      if (ltr && !Auth.canSeeLetter(ltr)) {
        viewEl.innerHTML = UI.empty('Not your letter',
          'That letter belongs to another unit, so it is not yours to open.',
          '<a class="btn btn-primary" href="#/letters">Back to your letters</a>');
        syncTabs();
        return;
      }
    }

    // Typing the hash must not get round the tab being hidden.
    if (global.Auth && Auth.isVolunteer() && NATIONAL_ONLY.indexOf(current.name) >= 0) {
      viewEl.innerHTML = UI.empty('Not available to volunteers',
        'This screen belongs to the national officers. Your activities are under Events.',
        '<a class="btn btn-primary" href="#/events">Go to your events</a>');
      syncTabs();
      return;
    }

    if (current.name === 'settings' && global.Auth && !Auth.canOpenSettings()) {
      /* Not "executives only" any more. Settings holds the letterhead every
         report is printed on, the closing date and the unit list, and none of
         that is a national officer's to change simply for being national. */
      viewEl.innerHTML = UI.empty('The President\u2019s settings',
        Auth.signedIn()
          ? 'Only the FCUSR President opens this. A Governor has their own unit\u2019s ' +
            'settings; everything else here belongs to the Republic.'
          : 'Sign in to continue.',
        '<button type="button" class="btn btn-primary" id="ask-exec">' +
        (Auth.signedIn() ? 'Sign in as someone else' : 'Sign in') + '</button>');
      var ask = viewEl.querySelector('#ask-exec');
      if (ask) ask.addEventListener('click', function () {
        Auth.requireExecutive(function () { render(); });
      });
      syncTabs();
      return;
    }

    try {
      viewEl.innerHTML = view.render(current.params);
      if (view.mount) view.mount(viewEl, current.params);
    } catch (err) {
      console.error(err);
      viewEl.innerHTML = '<div class="card"><h2>Something went wrong on this screen</h2>' +
        '<p class="muted small">' + U.esc(err.message) + '</p>' +
        '<p class="small muted">Your data is safe in this browser. Try reloading the page.</p></div>';
    }
    syncTabs();
    renderBrand();
    document.title = titleFor() + ' · ' + trackerTitle();
  }

  function titleFor() {
    if (current.name === 'event-detail') {
      var e = Store.event(current.params.id);
      return e ? e.title : 'Event';
    }
    if (current.name === 'letter-detail') {
      var l = Store.letter(current.params.id);
      return l ? l.subject : 'Letter';
    }
    return { 'overview': 'Overview', 'my-tasks': 'My tasks', 'directives': 'Directives',
      'events': 'Events', 'letters': 'Letters', 'settings': 'Settings' }[current.name] || 'Overview';
  }

  var NATIONAL_ONLY = ['overview', 'directives', 'letters'];

  function syncTabs() {
    var active = current.name === 'event-detail' ? 'events'
      : current.name === 'letter-detail' ? 'letters' : current.name;

    /* A volunteer is enrolled into an activity, not into the Republic's business,
       so the national screens are not theirs to open. */
    var volunteer = global.Auth && Auth.isVolunteer();
    U.els('.tab', tabsEl).forEach(function (t) {
      var r = t.getAttribute('data-route');
      t.hidden = volunteer && NATIONAL_ONLY.indexOf(r) >= 0;
    });
    document.getElementById('btn-settings').hidden = volunteer;

    U.els('.tab', tabsEl).forEach(function (t) {
      var on = t.getAttribute('data-route') === active;
      t.classList.toggle('is-active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    document.getElementById('btn-settings').classList.toggle('is-active', current.name === 'settings');

    // The My tasks tab carries the selected officer's overdue count.
    var badge = document.getElementById('tab-count');
    var pid = Store.lastPerson();
    var n = 0;
    if (pid && Store.person(pid)) {
      n = Store.tasks({ assigneeId: pid, excludeArchived: true }).filter(Store.isOverdue).length;
    }
    badge.textContent = n;
    badge.hidden = n === 0;
    if (n) badge.title = n + ' overdue';

    // And the Letters tab carries how many are worth chasing.
    var lb = document.getElementById('tab-letters');
    if (lb) {
      var mineUnit = (global.Auth && Auth.signedIn()) ? Auth.myUnitId() : '';
      var ls = Store.letters(mineUnit ? { unitId: mineUnit } : {}).filter(Store.letterNeedsAttention).length;
      lb.textContent = ls;
      lb.hidden = ls === 0;
      if (ls) lb.title = U.plural(ls, 'letter') + ' needing a chase';
    }
  }

  function onHashChange() {
    var next = parseHash();
    var changed = next.name !== current.name || next.params.id !== current.params.id;
    current = next;
    render();
    if (changed) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      viewEl.focus({ preventScroll: true });
    }
  }

  // The header wants a small file on a phone's data; the report wants the
  // full-resolution one, and only when a PDF is actually being made.
  var SEAL_SMALL = 'assets/img/fcusr-seal-small.png';
  var SEAL = 'assets/img/fcusr-seal.png';

  /* The council's seal ships with the app, so the header carries it from the
     first visit rather than waiting for somebody to upload something. An emblem
     uploaded in Settings still wins, for a unit that has its own. */
  function renderEmblem() {
    var slot = document.getElementById('emblem-slot');
    var src = Store.org().emblem || SEAL_SMALL;
    slot.innerHTML = '<img src="' + U.esc(src) + '" alt="">';
  }

  /* The task report draws its header itself, and does it synchronously, so the
     seal is turned into a data URL once at start-up and kept ready. If it never
     arrives the report falls back to the plain gold triangle, exactly as before. */
  function preloadSeal() {
    if (global.FCU_SEAL) return;
    /* Nothing here may throw. This runs during boot, and an exception at this
       point takes the whole app down before a single screen is wired — which is
       exactly what happened the first time, in a context with no fetch(). A
       missing seal costs the report its emblem and nothing else. */
    if (typeof global.fetch !== 'function' || typeof global.FileReader !== 'function') return;
    try {
      global.fetch(SEAL).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
        if (!b) return;
        var fr = new FileReader();
        fr.onload = function () { global.FCU_SEAL = String(fr.result); };
        fr.readAsDataURL(b);
      }).catch(function () { /* the report prints without it */ });
    } catch (e) { /* likewise */ }
  }

  /* Everyone works inside one unit, so the header says which one: FCUSR COE,
     FCU COMELEC, FCUSR Judiciary. Nobody has to wonder whose tracker they are
     looking at, and a screenshot says it too. */
  function trackerTitle() {
    var unitId = (global.Auth && Auth.signedIn()) ? Auth.myUnitId() : Store.nationalUnitId();
    return Store.trackerTitle(unitId);
  }

  function renderBrand() {
    paintAccount();
    renderEmblem();
    var el = document.querySelector('.brand-name');
    if (el) el.textContent = trackerTitle();
  }

  /* ---------- global search ---------- */

  function group(title, itemsHtml) {
    return '<div style="margin-top:14px"><div class="section-note strong">' + U.esc(title) + '</div>' +
      '<div class="list" style="margin-top:6px">' + itemsHtml + '</div></div>';
  }

  function item(iconName, title, sub, attrs, tail) {
    return '<button type="button" class="result-item" ' + attrs + '>' +
      UI.icon(iconName) +
      '<span class="rt"><span class="strong">' + U.esc(title) + '</span>' +
      '<span class="rs">' + U.esc(sub) + '</span></span>' +
      (tail || '') + '</button>';
  }

  function openSearch() {
    UI.modal({
      title: 'Search',
      wide: true,
      body:
        '<div class="field search-wrap">' + UI.icon('search') +
        '<input type="search" id="q" data-autofocus placeholder="Search tasks, events and people" autocomplete="off">' +
        '</div><div id="results"></div>',
      onMount: function (root, close) {
        var input = root.querySelector('#q');
        var out = root.querySelector('#results');

        function run() {
          var q = input.value.trim().toLowerCase();
          if (q.length < 2) {
            out.innerHTML = '<p class="small muted">Type at least two letters.</p>';
            return;
          }
          var events = Store.events().filter(function (e) {
            return e.title.toLowerCase().indexOf(q) >= 0 || e.description.toLowerCase().indexOf(q) >= 0;
          }).slice(0, 6);
          var tasks = Store.tasks().filter(function (t) {
            return t.title.toLowerCase().indexOf(q) >= 0 || (t.remarks || '').toLowerCase().indexOf(q) >= 0;
          }).sort(Store.byUrgency).slice(0, 10);
          var people = Store.people().filter(function (p) {
            return p.name.toLowerCase().indexOf(q) >= 0 || (p.position || '').toLowerCase().indexOf(q) >= 0;
          }).slice(0, 6);

          var anyLetters = Store.letters().some(function (l) {
            return l.subject.toLowerCase().indexOf(q) >= 0;
          });
          if (!events.length && !tasks.length && !people.length && !anyLetters) {
            out.innerHTML = '<p class="small muted">Nothing matched “' + U.esc(input.value.trim()) + '”.</p>';
            return;
          }

          var html = '';
          if (events.length) {
            html += group('Events', events.map(function (e) {
              var s = Store.eventStats(e.id);
              return item('calendar', e.title,
                U.fmtRange(e.dateStart, e.dateEnd) + ' · ' + s.done + ' of ' + s.total + ' done',
                'data-goto="#/events/' + e.id + '"');
            }).join(''));
          }
          if (tasks.length) {
            html += group('Tasks', tasks.map(function (t) {
              var e = Store.event(t.eventId);
              return item('check', t.title,
                (e ? e.title : '') + ' · ' + Store.personName(t.assigneeId) +
                ' · ' + (t.dueDate ? U.fmtDateShort(t.dueDate) : 'No due date'),
                'data-goto="#/events/' + t.eventId + '"', UI.statusChip(t, false));
            }).join(''));
          }
          var lettersFound = Store.letters().filter(function (l) {
            return l.subject.toLowerCase().indexOf(q) >= 0;
          }).slice(0, 6);
          if (lettersFound.length) {
            html += group('Letters', lettersFound.map(function (l) {
              return item('pdf', l.subject,
                Store.letterWhere(l) + ' · ' + Store.letterInCharge(l),
                'data-goto="#/letters/' + l.id + '"');
            }).join(''));
          }
          if (people.length) {
            html += group('People', people.map(function (p) {
              var st = Store.stats(Store.tasks({ assigneeId: p.id, excludeArchived: true }));
              return item('user', p.name,
                (p.position || 'No position') + ' · ' + st.pending + ' pending',
                'data-person="' + U.esc(p.id) + '"');
            }).join(''));
          }
          out.innerHTML = html;

          U.els('[data-goto]', out).forEach(function (b) {
            b.addEventListener('click', function () { close(); go(b.getAttribute('data-goto')); });
          });
          U.els('[data-person]', out).forEach(function (b) {
            b.addEventListener('click', function () {
              Store.setLastPerson(b.getAttribute('data-person'));
              close();
              go('#/my-tasks');
            });
          });
        }

        input.addEventListener('input', U.debounce(run, 140));
        run();
      }
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    viewEl = document.getElementById('view');
    tabsEl = document.getElementById('tabs');

    Store.load();
    // Picks the stored session back up, then quietly checks it with the backend.
    if (global.Auth) Auth.resume();
    renderBrand();
    preloadSeal();

    Store.subscribe(function () { renderBrand(); render(); });

    var acct = document.getElementById('btn-account');
    if (acct) acct.addEventListener('click', function () { accountMenu(acct); });

    // Inline status editing works from anywhere a task row is drawn.
    U.on(document.body, 'click', '[data-status-for]', function (ev, el) {
      ev.preventDefault();
      ev.stopPropagation();
      var id = el.getAttribute('data-status-for');
      // The chip is already plain text on a row you may not change; this is the
      // second lock, so a stray click cannot slip past the first.
      if (!UI.taskEditable(Store.task(id))) {
        return UI.toast('That belongs to another unit — you can read it, not change it.', 'error');
      }
      UI.openStatusMenu(el, id);
    });

    document.getElementById('btn-search').addEventListener('click', openSearch);

    /* Settings houses enrolment and access, so it asks who you are first. */
    document.getElementById('btn-settings').addEventListener('click', function (ev) {
      if (!global.Auth || Auth.isExecutive()) return;
      ev.preventDefault();
      Auth.requireExecutive(function () { go('#/settings'); });
    });

    document.addEventListener('keydown', function (ev) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;
      if ((ev.key === '/' && !typing) || ((ev.metaKey || ev.ctrlKey) && ev.key === 'k')) {
        ev.preventDefault();
        openSearch();
      }
    });

    window.addEventListener('hashchange', onHashChange);

    // The browser restores the previous scroll position before the view has been
    // drawn, which on a hash-routed page lands you in empty space below the
    // content — it reads as a blank screen. We place the view ourselves.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    current = parseHash();
    render();
    window.scrollTo(0, 0);

    // Said once a visit; the banner on the Overview says it for the rest of the time.
    /* One notice at a time. The rehearsal notice already explains the closing
       date, so stacking the term reminder behind it would greet somebody with
       two dialogs on top of each other saying overlapping things. */
    /* Syncing starts after the first screen is drawn and never before it. The
       app is local-first: everything on screen came from this device and is
       already correct; the network's job is to reconcile it afterwards. */
    /* Only where there is a version to compare against: a page assembled some
       other way — a test harness, an embedded copy — has nothing to poll for. */
    if (runningVersion) {
      checkVersion();
      setInterval(checkVersion, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkVersion();
      });
    }

    if (global.Sync) {
      Sync.start();
      Sync.subscribe(function () { paintSyncState(); });
      var ss = document.getElementById('sync-state');
      if (ss) ss.addEventListener('click', syncDetail);
      paintSyncState();
    }
  }

  /* ---------- is this still the current version? ----------

     GitHub Pages tells a browser it may keep index.html for ten minutes, and a
     tab left open keeps it for as long as it stays open. So a council can be
     running three different versions of the app against one database without
     anybody knowing — which is how "it works on mine" starts, and why a fixed
     bug keeps being reported.

     The running version is read off this page's own script tags rather than
     written down a second time; version.json is what the server currently
     serves. When they differ, the person is told, once, and can reload. Never
     reloaded from under them: they may be halfway through a report. */
  var runningVersion = (function () {
    var el = document.querySelector('script[src*="app.js?v="]');
    var m = el && el.getAttribute('src').match(/\?v=(\d+)/);
    return m ? Number(m[1]) : 0;
  })();

  var updateOffered = false;

  function checkVersion() {
    if (updateOffered || !runningVersion || typeof fetch !== 'function') return;
    // Cache-busted, or the answer would come from the same cache being asked about.
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.version || j.version <= runningVersion) return;
        updateOffered = true;
        showUpdateBar(j.version);
      })
      .catch(function () { /* offline, or the file is not deployed yet */ });
  }

  function showUpdateBar(version) {
    if (document.getElementById('update-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>A newer version of the tracker is ready' +
      ' <span class="muted">(v' + version + ' — you are on v' + runningVersion + ')</span></span>' +
      '<button type="button" class="btn btn-sm" data-reload>Reload</button>';
    document.body.appendChild(bar);
    bar.querySelector('[data-reload]').addEventListener('click', function () {
      location.reload(true);
    });
  }

  /* ---------- who is signed in, and the way out ----------
     A council runs on shared computers — the library PC, the org room laptop —
     and there was no way to leave one. Somebody signed in and stayed signed in
     for whoever sat down next. */
  function paintAccount() {
    var el = document.getElementById('btn-account');
    if (!el || !global.Auth) return;
    var who = Auth.signedIn() ? Auth.current() : null;
    if (!who || Auth.isOffline()) { el.hidden = true; return; }

    el.hidden = false;
    el.innerHTML = '<span class="who w' + (U.initials(who.name).charCodeAt(0) % 6) + '">' +
      U.esc(U.initials(who.name)) + '</span>';
    el.setAttribute('title', who.name + ' · ' + (who.unitName || ''));
    el.setAttribute('aria-label', 'Signed in as ' + who.name + '. Your account.');
  }

  function accountMenu(anchor) {
    var who = Auth.current();
    if (!who) return;
    var items =
      '<button type="button" data-set="who" disabled style="opacity:1;cursor:default">' +
        UI.icon('users') + '<span><strong>' + U.esc(who.name) + '</strong><br>' +
        '<span class="tiny muted">' + U.esc(who.position || '') +
        (who.position && who.unitName ? ' · ' : '') + U.esc(who.unitName || '') + '</span></span>' +
      '</button>' +
      '<div class="sep"></div>' +
      '<button type="button" data-set="password">Change my password</button>' +
      '<button type="button" class="danger" data-set="out">Sign out</button>';

    UI.openMenu(anchor, items, function (action) {
      if (action === 'password') return Auth.changePassword();
      if (action === 'out') return signOutFlow();
    });
  }

  /* Signing out sends everything first, then takes the council's work off the
     computer. If it cannot be sent, nothing is cleared and the person is asked
     what they want to do — leaving without their afternoon's work is a choice
     only they can make. */
  function signOutFlow() {
    UI.confirm({
      title: 'Sign out?',
      message: 'Your work is sent to the council\u2019s server first, and then removed ' +
        'from this computer so the next person cannot see it.',
      detail: 'Everything stays on the server. Signing back in brings it all down again.',
      tone: 'primary',
      cancelLabel: 'Stay signed in',
      confirmLabel: 'Sign out'
    }).then(function (ok) {
      if (!ok) return;
      return Auth.signOut().then(function () {
        UI.toast('Signed out. This computer no longer holds the council\u2019s work.');
      }).catch(function (err) {
        if (!err || !err.unsent) throw err;
        return UI.confirm({
          title: 'Your work has not been sent',
          message: err.message,
          detail: 'You can stay signed in and try again in a moment, or sign out anyway — ' +
            'which leaves anything unsent on this computer for the next person.',
          confirmLabel: 'Sign out anyway'
        }).then(function (force) {
          if (force) return Auth.signOut({ force: true });
        });
      });
    });
  }

  /* Said once a visit, and only to somebody who is actually inside. */
  var greeted = false;
  function greet() {
    if (greeted || !global.TermUI) return;
    greeted = true;
    // One notice at a time: the rehearsal notice already explains the closing
    // date, so stacking the term reminder behind it would greet somebody with
    // two dialogs saying overlapping things.
    if (!TermUI.dryRunNotice()) TermUI.maybeRemind();
  }

  /* Whether this device is behind. In the header rather than a settings page,
     because "did my change reach anyone" is a question people ask while looking
     at the change.

     It was a coloured dot, and a dot is not a sentence: it went red on a real
     failure and said nothing about what had failed or what syncing even was.
     So it carries the word — Synced, Syncing, Not synced — and when something is
     wrong it is a button that opens the whole story rather than a tooltip
     nobody hovers over on a phone. */
  function paintSyncState() {
    var el = document.getElementById('sync-state');
    if (!el || !global.Sync) return;
    var st = Sync.status();
    if (!st.able) { el.hidden = true; return; }

    /* "Synced" on its own has been telling people everything is fine while a
       second phone sat empty. When a round has just moved something, say so —
       a number is the only part anybody can check against what they expected. */
    var l = st.last;
    var moved = l ? (l.added + l.updated + l.removed + l.sent) : 0;
    var word = st.running ? 'Syncing'
      : st.error ? 'Not synced'
      : moved ? 'Synced · ' + moved
      : st.at ? 'Synced' : 'Waiting';
    var tone = st.running ? ' is-working' : st.error ? ' is-stuck' : st.at ? ' is-ok' : '';

    el.hidden = false;
    el.className = 'sync-state' + tone;
    el.innerHTML = '<span class="ss-dot" aria-hidden="true"></span><span class="ss-word">' +
      U.esc(word) + '</span>';
    el.setAttribute('title', st.error
      ? 'Not synced — ' + st.error + '. Tap for details.'
      : st.running ? 'Sending and receiving changes…'
      : moved ? ((l.added + l.updated) + ' came in, ' + l.sent + ' went out. Tap for details.')
      : st.at ? 'Everything on this device is on the council\u2019s server'
      : 'Waiting to sync');
    el.setAttribute('aria-label', 'Syncing: ' + el.getAttribute('title'));
  }

  /* Pressed, it explains itself. The error text is the part people need and the
     part a coloured dot cannot carry. */
  function syncDetail() {
    if (!global.Sync || !global.UI) return;
    var st = Sync.status();
    var l = st.last;

    UI.modal({
      title: st.error ? 'This device is not synced' : st.running ? 'Syncing' : 'Synced',
      body:
        (st.error
          ? '<div class="card" style="background:var(--st-overdue-bg);border-color:var(--st-overdue-bd)">' +
            '<div class="strong" style="margin-bottom:3px">The server could not be reached</div>' +
            '<div class="small">' + U.esc(st.error) + '</div></div>' +
            '<p class="small" style="margin-top:12px">Nothing has been lost. Everything you have ' +
            'done is saved on this device and will be sent as soon as the connection comes back.</p>'
          : '<p class="small" style="margin-top:0">Your activities, tasks, letters and reports are ' +
            'copied to the council\u2019s server and picked up by everyone else signed in. It ' +
            'happens by itself after every change and every few minutes.</p>') +
        (l ? '<p class="small muted">Last round: ' + (l.added + l.updated) + ' taken in, ' +
             l.sent + ' sent, ' + U.esc(U.fmtStamp(st.at)) + '.</p>' : '') +

        /* What the app is doing on its own, said plainly, because otherwise the
           only visible state is a word that has been wrong before. */
        '<p class="small muted">It checks by itself a few seconds after any change ' +
        'and every twenty seconds while this is open, and goes right through ' +
        'everything when you open the app and once an hour after that \u2014 so a ' +
        'device that has fallen behind catches up without anybody doing anything.</p>' +
        '<p class="tiny muted">Photographs are never synced — they stay in the browser that ' +
        'took them.</p>',
      footer: '<button type="button" class="btn" data-close>Close</button>' +
        '<button type="button" class="btn" data-resend data-close>Send everything again</button>' +
        '<button type="button" class="btn btn-primary" data-retry data-close>Try now</button>',
      onMount: function (root) {
        var r = root.querySelector('[data-retry]');
        if (r) r.addEventListener('click', function () { Sync.now({ loud: true }); });
        var again = root.querySelector('[data-resend]');
        if (again) again.addEventListener('click', function () {
          Store.resetSyncMarks();
          Sync.now({ loud: true }).then(function (out) {
            render();
            var l2 = out.last;
            if (!out.error) {
              UI.toast('Sent ' + ((l2 && l2.sent) || 0) + ', took in ' +
                ((l2 && (l2.added + l2.updated)) || 0) + '.');
            }
          });
        });
      }
    });
  }

  global.App = { go: go, render: render, openSearch: openSearch, route: function () { return current; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
