/* One interface, three drivers.

   Every screen talks to Backend.*, never to Supabase or Apps Script directly, so
   swapping the backend is a one-line change in config.js and no view has to know.

   Both remote drivers use plain fetch — no vendored SDK, nothing extra to keep
   up to date, and you can read exactly what goes over the wire. */
(function (global) {
  'use strict';

  var CFG = global.FCU_BACKEND || { driver: 'local' };
  var session = null;   // { token, email, profile }

  function now() { return (global.performance && performance.now()) ? performance.now() : Date.now(); }

  // Every call is timed, because "which of these feels faster on a phone"
  // is one of the things we are actually trying to find out.
  function timed(label, promise) {
    var t0 = now();
    return promise.then(function (v) {
      return { ok: true, ms: Math.round(now() - t0), label: label, value: v };
    }, function (e) {
      return { ok: false, ms: Math.round(now() - t0), label: label, error: e.message || String(e) };
    });
  }

  /* ================================================================ local */

  var localPeople = [];

  var localDriver = {
    name: 'This browser only',
    needsPassword: false,
    signIn: function () {
      session = { email: 'local', profile: { full_name: 'This device', access: 'officer', unit_name: 'Local' } };
      return Promise.resolve(session.profile);
    },
    signUp: function () { return localDriver.signIn(); },
    signOut: function () { session = null; return Promise.resolve(); },
    restore: function () { return Promise.resolve(session ? session.profile : null); },
    whoami: function () { return Promise.resolve(session ? session.profile : null); },
    units: function () {
      if (global.Store && Store.units) {
        return Promise.resolve(Store.units({ activeOnly: true }).map(function (u) {
          return { id: u.id, name: u.name, kind: u.kind, code: u.code };
        }));
      }
      return Promise.resolve([{ id: 'local', name: 'Local', kind: 'national' }]);
    },
    pending: function () { return Promise.resolve([]); },
    withdraw: function () { return Promise.resolve(true); },
    remove: function () { return Promise.resolve(true); },
    setHead: function () { return Promise.resolve(true); },
    // Offline there is nowhere to sync to, and saying so plainly here means the
    // sync layer needs no special case for it.
    changed: function () { return Promise.resolve([]); },
    upsert: function () { return Promise.resolve([]); },
    remove: function () { return Promise.resolve(null); },
    serverNow: function () { return Promise.resolve(null); },
    // Uses the tracker's own directory when the full app is loaded, and its own
    // list when it is not (the comparison page loads this driver on its own).
    roster: function () {
      if (global.Store && Store.people) {
        return Promise.resolve(Store.people().map(function (p) {
          return { id: p.id, full_name: p.name, position: p.position, email: '', access: 'officer' };
        }));
      }
      return Promise.resolve(localPeople.slice());
    },
    enrol: function (m) {
      if (global.Store && Store.addPerson) {
        Store.addPerson({ name: m.full_name, position: m.position });
        return Promise.resolve('local');
      }
      var id = U.uid('per');
      localPeople.push({ id: id, full_name: m.full_name, position: m.position, email: m.email, access: m.access });
      return Promise.resolve(id);
    },
    audit: function () { return Promise.resolve([]); }
  };

  /* ============================================================= supabase */

  /* The signed-in session is kept on the device, not only in memory, or a page
     refresh would leave the app believing someone is signed in while holding no
     token to prove it — every request would then go out as an anonymous one and
     quietly return nothing. */
  var SB_KEY = 'fcusr.tracker.sb';

  function saveSession() {
    try {
      if (session && session.token) global.localStorage.setItem(SB_KEY, JSON.stringify(session));
      else global.localStorage.removeItem(SB_KEY);
    } catch (e) { /* storage blocked; the session lasts this visit only */ }
  }

  function loadSession() {
    try {
      var raw = global.localStorage.getItem(SB_KEY);
      if (raw) session = JSON.parse(raw);
    } catch (e) { session = null; }
    return session;
  }

  function adoptTokens(res, email) {
    session = {
      token: res.access_token,
      refresh: res.refresh_token || null,
      // A minute of slack, so a request is never sent with a token about to lapse.
      expiresAt: Date.now() + ((res.expires_in || 3600) - 60) * 1000,
      email: email || (res.user && res.user.email) || (session && session.email) || '',
      userId: (res.user && res.user.id) || (session && session.userId) || '',
      profile: null
    };
    saveSession();
    return session;
  }

  function sbHeaders(withAuth) {
    var h = {
      'apikey': CFG.supabase.anonKey,
      'Content-Type': 'application/json'
    };
    if (withAuth && session && session.token) h['Authorization'] = 'Bearer ' + session.token;
    else h['Authorization'] = 'Bearer ' + CFG.supabase.anonKey;
    return h;
  }

  function sbRaw(path, opts) {
    opts = opts || {};
    var headers = sbHeaders(opts.auth !== false);
    if (opts.headers) Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
    return fetch(CFG.supabase.url.replace(/\/$/, '') + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
        if (!r.ok) {
          var msg = (data && (data.message || data.error_description || data.error || data.hint)) ||
            ('HTTP ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* Supabase access tokens last an hour. Nobody should be thrown out in the
     middle of a meeting, so an expiring token is exchanged for a fresh one
     before the request that needed it goes out. */
  function refreshIfStale() {
    if (!session || !session.refresh) return Promise.resolve();
    if (session.expiresAt && Date.now() < session.expiresAt) return Promise.resolve();
    var refresh = session.refresh;
    return sbRaw('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', auth: false, body: { refresh_token: refresh }
    }).then(function (res) {
      adoptTokens(res, session.email);
    }).catch(function () {
      // The refresh token has been revoked or has expired: sign out cleanly
      // rather than leaving a session that cannot do anything.
      session = null;
      saveSession();
    });
  }

  function sbFetch(path, opts) {
    return refreshIfStale().then(function () { return sbRaw(path, opts); });
  }

  var supabaseDriver = {
    name: 'Supabase',
    needsPassword: true,

    signIn: function (email, password) {
      return sbRaw('/auth/v1/token?grant_type=password', {
        method: 'POST', auth: false, body: { email: email, password: password }
      }).catch(function (err) {
        /* 400 from the token endpoint means the pair was not accepted — either
           the password is wrong or no account has ever been made on this
           address. The door needs to tell those apart, so the fact is carried
           on the error rather than sniffed out of its wording later. */
        if (err && err.status === 400) err.badCredentials = true;
        throw err;
      }).then(function (res) {
        adoptTokens(res, email);
        return supabaseDriver.whoami();
      }).then(function (profile) {
        if (!profile) {
          throw new Error('That login works, but nobody has enrolled this address yet. ' +
            'Ask a national executive to enrol you, then sign in again.');
        }
        return profile;
      });
    },

    /* Each person sets their own password, on an address an officer has already
       enrolled. Signing up grants nothing by itself: without a waiting enrolment
       the database makes no profile, and the app has nothing to show. */
    signUp: function (email, password) {
      return sbRaw('/auth/v1/signup', {
        method: 'POST', auth: false, body: { email: email, password: password }
      }).catch(function (err) {
        if (err && /already/i.test(err.message || '')) err.alreadyClaimed = true;
        throw err;
      }).then(function (res) {
        if (!res.access_token) {
          // Email confirmation is switched on for this project.
          throw new Error('Account created. Open the confirmation link sent to ' + email +
            ', then sign in.');
        }
        adoptTokens(res, email);
        return supabaseDriver.whoami();
      }).then(function (profile) {
        if (!profile) {
          throw new Error('This address has not been enrolled yet, so there is nothing to open. ' +
            'Ask a national executive to enrol you first.');
        }
        return profile;
      });
    },

    signOut: function () {
      var p = session ? sbRaw('/auth/v1/logout', { method: 'POST' }).catch(function () {}) : Promise.resolve();
      session = null;
      saveSession();
      return p;
    },

    restore: function () {
      loadSession();
      if (!session || !session.token) return Promise.resolve(null);
      return supabaseDriver.whoami().catch(function () { return null; });
    },

    /* Who am I — asked by id, never "the first row". A national officer is
       allowed to read every profile in the Republic, so a bare limit=1 returns
       whichever row the database happens to hand back first, which is how you
       end up signed in as somebody else. */
    whoami: function () {
      if (!session || !session.token) return Promise.resolve(null);
      return sbFetch('/auth/v1/user').then(function (u) {
        session.userId = u.id;
        session.email = u.email;
        saveSession();
        return sbFetch('/rest/v1/profiles?select=*,units(name,kind)&id=eq.' +
          encodeURIComponent(u.id) + '&limit=1');
      }).then(function (rows) {
        var p = rows && rows[0];
        if (!p) return null;
        p.unit_name = p.units ? p.units.name : '';
        p.unit_kind = p.units ? p.units.kind : '';
        if (p.active === false) {
          throw new Error('That account has been removed. Ask a national executive to add you again.');
        }
        // A volunteer's reach is the activities they were taken on for, so those
        // come back with the profile rather than being asked for separately.
        return sbFetch('/rest/v1/event_members?select=event_id&profile_id=eq.' +
          encodeURIComponent(p.id)).then(function (rows2) {
          p.eventIds = (rows2 || []).map(function (r) { return r.event_id; });
          session.profile = p;
          return p;
        });
      });
    },

    units: function () { return sbFetch('/rest/v1/units?select=id,name,kind,code&order=kind,name'); },

    /* ---------- the sync transport ----------
       Four calls, deliberately dumb: what changed, write these, delete these,
       what was deleted. Every decision about *which* records and who wins is
       made in sync.js and store.js, where it can be read and tested without a
       server. This part only carries things. */

    /* Rows changed since a moment, oldest first — so a pull interrupted halfway
       can be resumed from the last row it actually took in.

       The column is named by the caller because not every table calls it the
       same thing: a deletion has a `deleted_at` and no `updated_at` at all, and
       asking for one it does not have is a 400 rather than an empty list. */
    changed: function (table, since, limit, column) {
      var col = column || 'updated_at';
      var q = '/rest/v1/' + table + '?select=*&order=' + col + '.asc&limit=' + (limit || 500);
      if (since) q += '&' + col + '=gt.' + encodeURIComponent(since);
      return sbFetch(q);
    },

    /* Upsert. `merge-duplicates` makes this an insert that becomes an update
       when the id is already there, which is what an offline device coming back
       always needs and what a plain insert would refuse. */
    upsert: function (table, rows) {
      if (!rows || !rows.length) return Promise.resolve([]);
      return sbFetch('/rest/v1/' + table, {
        method: 'POST',
        body: rows,
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      });
    },

    remove: function (table, ids) {
      if (!ids || !ids.length) return Promise.resolve(null);
      return sbFetch('/rest/v1/' + table + '?id=in.(' + ids.map(encodeURIComponent).join(',') + ')', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' }
      });
    },

    /* The server's own clock.

       Every pull asks for "rows changed since X", and X has to be measured by
       the same clock that stamped them. A phone running four minutes fast would
       otherwise save a high-water mark from the future and quietly stop
       receiving anything at all — no error, no empty state, just a device that
       silently stops learning. */
    serverNow: function () {
      return sbFetch('/rest/v1/rpc/server_now', { method: 'POST', body: {} });
    },

    roster: function () {
      return sbFetch('/rest/v1/profiles?select=id,email,full_name,position,access,is_head,active,units(name)&order=full_name');
    },

    /* Waiting enrolments: people an officer has taken on who have not set a
       password yet. Shown in the roster so nobody is enrolled twice. */
    pending: function () {
      return sbFetch('/rest/v1/enrolments?select=email,full_name,position,access,claimed_at,units(name)' +
        '&claimed_at=is.null&order=created_at.desc');
    },

    /* Standing (Governor, Vice Governor) is passed here, but the database only
       accepts it once heads.sql has been run — and the site updates the moment
       it is deployed, which is not the moment somebody opens the SQL editor.
       PostgREST answers an argument it does not recognise with 404, so enrolling
       anybody at all would stop working in the gap between the two.

       So: ask for standing, and if the database has not learned about it yet,
       enrol without it. Nobody is turned away because a migration is late; the
       worst case is that a Governor is enrolled as a plain officer and has to be
       named again afterwards. */
    enrol: function (m) {
      var body = {
        p_email: m.email, p_full_name: m.full_name, p_position: m.position,
        p_unit_id: m.unit_id, p_access: m.access,
        p_event_ids: m.eventIds || []
      };
      var withHead = {};
      Object.keys(body).forEach(function (k) { withHead[k] = body[k]; });
      withHead.p_is_head = !!m.isHead;

      return sbFetch('/rest/v1/rpc/enroll_member', { method: 'POST', body: withHead })
        .catch(function (err) {
          if (!err || err.status !== 404) throw err;
          return sbFetch('/rest/v1/rpc/enroll_member', { method: 'POST', body: body });
        });
    },

    /* Naming, or unnaming, the head of a unit. The server decides whether the
       asker may — a Governor cannot appoint their own successor, and nobody
       changes their own standing. */
    setHead: function (email, isHead) {
      return sbFetch('/rest/v1/rpc/set_unit_head', {
        method: 'POST', body: { p_email: email, p_is_head: !!isHead }
      }).catch(function (err) {
        // The one place where saying why is better than a bare failure.
        if (err && err.status === 404) {
          throw new Error('Governors and Vice Governors need one more setup step on the ' +
            'database (heads.sql). Everything else works; ask for that to be run.');
        }
        throw err;
      });
    },

    /* Removing somebody. remove_member is the same act under a name that means
       what it does; withdraw_member is what older databases call it, and the
       site updates the moment it is deployed rather than the moment the SQL is
       run — so a 404 falls back rather than telling an executive the removal
       failed. */
    remove: function (email) {
      return sbFetch('/rest/v1/rpc/remove_member', {
        method: 'POST', body: { p_email: email }
      }).catch(function (err) {
        if (!err || err.status !== 404) throw err;
        return sbFetch('/rest/v1/rpc/withdraw_member', {
          method: 'POST', body: { p_email: email }
        });
      });
    },

    withdraw: function (email) {
      return sbFetch('/rest/v1/rpc/withdraw_member', {
        method: 'POST', body: { p_email: email }
      });
    },

    // Supabase Auth owns the password, so a change is one call and the app
    // never sees or stores the old one.
    changePassword: function (newPassword) {
      return sbFetch('/auth/v1/user', { method: 'PUT', body: { password: newPassword } });
    },

    audit: function () {
      return sbFetch('/rest/v1/audit_log?select=*&order=created_at.desc&limit=100');
    }
  };

  /* =========================================================== appsscript */

  /* Content-Type text/plain keeps the browser from sending a CORS preflight,
     which Apps Script web apps do not answer. The script still reads the body. */
  function gsCall(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch(CFG.appsscript.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      credentials: 'include',
      redirect: 'follow'
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || res.ok !== true) throw new Error((res && res.error) || 'The script refused that request.');
        return res;
      });
  }

  var appsScriptDriver = {
    name: 'Google Apps Script',
    // Identity is the Google account already signed in on the device, so the
    // app never handles a password at all.
    needsPassword: false,
    signIn: function () {
      return gsCall('whoami').then(function (res) {
        if (!res.profile) throw new Error('Signed in as ' + res.email + ', but that account is not enrolled yet.');
        session = { email: res.email, profile: res.profile };
        return res.profile;
      });
    },
    // Identity is Google's, so there is no sign-up step and no password here.
    signUp: function () {
      return Promise.reject(new Error(
        'Apps Script uses your Google account, so there is no account to create here.'));
    },
    signOut: function () { session = null; return Promise.resolve(); },
    restore: function () { return gsCall('whoami').then(function (r) { return r.profile; })
      .catch(function () { return null; }); },
    whoami: function () { return gsCall('whoami').then(function (r) { return r.profile; }); },
    pending: function () { return Promise.resolve([]); },
    withdraw: function (email) { return gsCall('withdraw', { email: email }); },
    remove: function (email) { return gsCall('withdraw', { email: email }); },
    units: function () { return gsCall('units').then(function (r) { return r.units; }); },
    roster: function () { return gsCall('roster').then(function (r) { return r.roster; }); },
    enrol: function (m) { return gsCall('enrol', m).then(function (r) { return r.id; }); },
    audit: function () { return gsCall('audit').then(function (r) { return r.entries; }); }
  };

  /* ================================================================ facade */

  var DRIVERS = { local: localDriver, supabase: supabaseDriver, appsscript: appsScriptDriver };

  // True once the chosen backend actually has credentials to work with.
  function configured(name) {
    if (name === 'supabase') return !!(CFG.supabase.url && CFG.supabase.anonKey);
    if (name === 'appsscript') return !!CFG.appsscript.url;
    return true;
  }

  /* If the chosen backend has not been set up yet, fall back to local rather than
     throwing. The app then still runs offline exactly as before, which is what
     you want while the Supabase project is still being created. */
  function driver() {
    var name = CFG.driver;
    var d = DRIVERS[name];
    if (!d) throw new Error('Unknown backend driver: ' + name);
    if (!configured(name)) return localDriver;
    return d;
  }

  function isFallback() { return !configured(CFG.driver); }

  function use(name) { CFG.driver = name; session = null; }

  global.Backend = {
    config: CFG,
    use: use,
    configured: configured,
    isFallback: isFallback,
    driverName: function () { try { return driver().name; } catch (e) { return 'not configured'; } },
    needsPassword: function () { try { return driver().needsPassword; } catch (e) { return true; } },
    session: function () { return session; },
    timed: timed,
    signIn: function (e, p) { return driver().signIn(e, p); },
    signUp: function (e, p) { return driver().signUp(e, p); },
    signOut: function () { return driver().signOut(); },
    /* Called once at start-up: picks a stored session back up so a refresh does
       not sign everyone out. Never rejects — a backend that cannot be reached
       simply means nobody is signed in yet. */
    restore: function () {
      var d = driver();
      if (!d.restore) return Promise.resolve(null);
      return d.restore().catch(function () { return null; });
    },
    whoami: function () { return driver().whoami(); },
    units: function () { return driver().units(); },
    remove: function (email) {
      var d = driver();
      return d.remove ? d.remove(email) : d.withdraw(email);
    },
    changed: function (t, since, limit, column) {
      var d = driver();
      return d.changed ? d.changed(t, since, limit, column) : Promise.resolve([]);
    },
    upsert: function (t, rows) {
      var d = driver();
      return d.upsert ? d.upsert(t, rows) : Promise.resolve([]);
    },
    remove: function (t, ids) {
      var d = driver();
      return d.remove ? d.remove(t, ids) : Promise.resolve(null);
    },
    serverNow: function () {
      var d = driver();
      return d.serverNow ? d.serverNow() : Promise.resolve(null);
    },
    roster: function () { return driver().roster(); },
    pending: function () { return driver().pending(); },
    enrol: function (m) { return driver().enrol(m); },
    setHead: function (e, h) {
      var d = driver();
      return d.setHead ? d.setHead(e, h) : Promise.resolve(true);
    },
    withdraw: function (email) { return driver().withdraw(email); },
    audit: function () { return driver().audit(); },
    changePassword: function (pw) {
      var d = driver();
      if (!d.changePassword) {
        return Promise.reject(new Error(
          d.name + ' uses your Google account for sign-in, so passwords are changed in Google, not here.'));
      }
      return d.changePassword(pw);
    }
  };
})(window);
