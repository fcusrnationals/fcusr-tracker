/* FCUSR Task Tracker — push notifications on this device.

   The bell inside the app only helps somebody who has it open. This turns on
   real notifications — the kind that reach a phone in a pocket — for one
   device at a time, and only when the person presses the button. The browser's
   own permission prompt is never shown unasked.

   What is sent, and when, is decided on the server (backend/supabase/push.sql
   and the push-dispatch Edge Function): a task given to you, a task of yours
   moved, due tomorrow, due today, overdue. Quiet from 21:00 to 07:00 Manila.
   Lock screens show that something happened, not what — unless this device
   chooses to show task names.

   Honest about every way it cannot work: an old browser, an iPhone that has not
   put the tracker on its Home Screen, permission refused, the offline build,
   or a server where it has not been switched on yet. */
(function (global) {
  'use strict';

  var LOCAL = 'fcusr.tracker.push.';          // + account id → { endpoint, prefs }
  var DEFAULTS = { assigned: true, moved: true, due: true, overdue: true, details: false };
  var serverKey = null;

  function nav() { return global.navigator || {}; }
  function account() { return global.Auth && Auth.signedIn() ? Auth.current() : null; }

  function load() {
    var me = account();
    if (!me) return null;
    try { return JSON.parse(global.localStorage.getItem(LOCAL + me.id) || 'null'); } catch (e) { return null; }
  }
  function store(v) {
    var me = account();
    if (!me) return;
    try {
      if (v) global.localStorage.setItem(LOCAL + me.id, JSON.stringify(v));
      else global.localStorage.removeItem(LOCAL + me.id);
    } catch (e) { /* private mode: the server still knows */ }
  }

  function supported() {
    return !!(nav().serviceWorker && global.PushManager && global.Notification &&
              global.isSecureContext !== false);
  }
  function isApple() {
    var n = nav();
    return /iPad|iPhone|iPod/.test(n.userAgent || '') ||
      (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
  }
  function installed() {
    try {
      return !!(nav().standalone || (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches));
    } catch (e) { return false; }
  }
  function permission() { return global.Notification ? global.Notification.permission : 'default'; }

  /* Where this device stands, as one word the sheet can explain. */
  function status() {
    if (!global.Auth || Auth.isOffline()) return 'offline';
    if (!account()) return 'signed-out';
    if (!supported()) return isApple() && !installed() ? 'install' : 'unsupported';
    if (permission() === 'denied') return 'denied';
    var mine = load();
    return mine && mine.endpoint && permission() === 'granted' ? 'on' : 'off';
  }

  function deviceLabel() {
    var ua = nav().userAgent || '';
    var kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isApple() && !/iPhone/.test(ua)) ? 'iPad'
      : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
      : /Windows/.test(ua) ? 'Windows computer' : /Mac OS X/.test(ua) ? 'Mac'
      : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux computer' : 'Device';
    var browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari' : '';
    return (kind + (browser ? ' · ' + browser : '')).slice(0, 80);
  }

  function keyBytes(b64) {
    var pad = '='.repeat((4 - (b64.length % 4)) % 4);
    var raw = global.atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function sameKey(sub, key) {
    try {
      var have = sub && sub.options && sub.options.applicationServerKey;
      if (!have) return true;                    // older browsers do not say; trust it
      var a = new Uint8Array(have), b = keyBytes(key);
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    } catch (e) { return true; }
  }

  function fetchKey() {
    if (serverKey) return Promise.resolve(serverKey);
    return Backend.push('push_public_key').then(function (k) {
      serverKey = typeof k === 'string' && k ? k : null;
      return serverKey;
    });
  }

  function registration() {
    return nav().serviceWorker.register('sw.js', { scope: './' }).then(function () {
      return nav().serviceWorker.ready;
    });
  }

  function subscribeHere(reg, key) {
    return reg.pushManager.getSubscription().then(function (sub) {
      if (sub && !sameKey(sub, key)) {
        return sub.unsubscribe().then(function () { return null; });
      }
      return sub;
    }).then(function (sub) {
      return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    });
  }

  function tellServer(sub, prefs) {
    var j = sub.toJSON ? sub.toJSON() : sub;
    return Backend.push('push_subscribe', {
      endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth,
      label: deviceLabel(), prefs: prefs
    }).then(function (res) {
      var saved = { endpoint: j.endpoint, prefs: (res && res.prefs) || prefs };
      store(saved);
      return saved;
    });
  }

  function fail(code, message) { var e = new Error(message); e.code = code; return e; }

  /* Only ever called from a button press: that is what lets the browser show
     its permission question, and it is the only time it is asked. */
  function enable(prefs) {
    prefs = Object.assign({}, DEFAULTS, (load() || {}).prefs || {}, prefs || {});
    var s = status();
    if (s !== 'off' && s !== 'on') return Promise.reject(fail(s, explain(s).text));
    return fetchKey().then(function (key) {
      if (!key) throw fail('not-ready', explain('not-ready').text);
      return global.Notification.requestPermission().then(function (p) {
        if (p !== 'granted') throw fail(p === 'denied' ? 'denied' : 'dismissed',
          p === 'denied' ? explain('denied').text : 'Nothing was changed — the browser’s question was closed without an answer.');
        return registration().then(function (reg) { return subscribeHere(reg, key); });
      });
    }).then(function (sub) { return tellServer(sub, prefs); });
  }

  function currentSubscription() {
    if (!supported()) return Promise.resolve(null);
    return nav().serviceWorker.getRegistration('./').then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).catch(function () { return null; });
  }

  function disable() {
    var mine = load();
    return currentSubscription().then(function (sub) {
      var endpoint = (sub && sub.endpoint) || (mine && mine.endpoint);
      var server = endpoint ? Backend.push('push_unsubscribe', { endpoint: endpoint }).catch(function () { return 0; })
        : Promise.resolve(0);
      return server.then(function () { return sub ? sub.unsubscribe().catch(function () {}) : null; });
    }).then(function () { store(null); });
  }

  function setPrefs(prefs) {
    var mine = load();
    if (!mine) return Promise.reject(fail('off', 'Turn notifications on first.'));
    var next = Object.assign({}, DEFAULTS, mine.prefs || {}, prefs);
    return Backend.push('push_set_prefs', { endpoint: mine.endpoint, prefs: next }).then(function (saved) {
      mine.prefs = saved || next;
      store(mine);
      return mine.prefs;
    });
  }

  function test() { return Backend.push('push_test'); }
  function devices() { return Backend.push('push_my_devices').then(function (r) { return r || []; }); }
  function removeDevice(id) { return Backend.push('push_unsubscribe', { device: id }); }

  function endpointHash(endpoint) {
    if (!endpoint || !global.crypto || !global.crypto.subtle || !global.TextEncoder) return Promise.resolve('');
    return global.crypto.subtle.digest('SHA-256', new global.TextEncoder().encode(endpoint)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }).catch(function () { return ''; });
  }

  /* Once a visit, after sign-in. A device that turned notifications on makes
     sure the server still has its current address (browsers renew them), and
     one whose permission was taken away in the browser's settings stops being
     sent to. Never asks the person anything. */
  function reconcile() {
    var mine = load();
    if (!mine || !mine.endpoint || !supported() || status() === 'offline') return Promise.resolve();
    if (permission() !== 'granted') {
      return Backend.push('push_unsubscribe', { endpoint: mine.endpoint }).catch(function () {})
        .then(function () { store(null); });
    }
    return fetchKey().then(function (key) {
      if (!key) return null;
      return registration().then(function (reg) {
        if (reg.update) reg.update().catch(function () {});
        return subscribeHere(reg, key);
      }).then(function (sub) { return tellServer(sub, mine.prefs || DEFAULTS); });
    }).catch(function () { /* tried again next visit */ });
  }

  /* Signing out of a shared computer must stop it ringing for the person who
     left. Given three seconds at most, so a bad signal never holds up leaving. */
  function forgetDevice() {
    if (!load()) return Promise.resolve();
    var done = disable().catch(function () {});
    return Promise.race([done, new Promise(function (r) { setTimeout(r, 3000); })]);
  }

  // A notification tapped while the tracker is open: go there, do not reload.
  if (supported()) {
    try {
      nav().serviceWorker.addEventListener('message', function (ev) {
        var d = ev && ev.data;
        if (!d || d.type !== 'fcusr-open' || typeof d.url !== 'string') return;
        try {
          var u = new URL(d.url, global.location.href);
          if (u.origin === global.location.origin && u.hash && global.App) App.go(u.hash);
        } catch (e) { /* ignore anything malformed */ }
      });
    } catch (e) { /* no service worker support after all */ }
  }

  /* ------------------------------------------------------------ the sheet */

  function explain(code) {
    switch (code) {
      case 'offline': return { tone: 'muted', text: 'Notifications need the online version of the tracker, with you signed in.' };
      case 'signed-out': return { tone: 'muted', text: 'Sign in first — notifications belong to your account.' };
      case 'install': return { tone: 'warn', text: 'On an iPhone or iPad, notifications only work once the tracker is on your Home Screen (iOS 16.4 or later). In Safari tap Share → Add to Home Screen, open the tracker from that icon, sign in, and come back here.' };
      case 'unsupported': return { tone: 'warn', text: 'This browser cannot receive notifications. Chrome, Edge, Firefox, Samsung Internet and Safari (16.4 or later) can.' };
      case 'denied': return { tone: 'warn', text: 'Notifications are blocked for this site in this browser, so the tracker cannot ask again. To allow them: open the site’s settings (the icon to the left of the address, or the browser’s Settings → Site settings → Notifications), set Notifications to Allow, then come back and turn them on here.' };
      case 'not-ready': return { tone: 'warn', text: 'The council’s server has not switched notifications on yet, so there is nothing to connect to. Nothing to do on your side — the President finishes the setup.' };
      case 'on': return { tone: 'ok', text: 'On for this device. You will be told when a task is given to you, when one of yours moves, the morning it is due, and if it slips past its deadline.' };
      default: return { tone: 'muted', text: 'Off for this device. Turn it on to be told when a task is given to you, when one of yours moves, and when a deadline is near or has passed — even when the tracker is closed.' };
    }
  }

  var TOGGLES = [
    ['assigned', 'A task is given to me'],
    ['moved', 'A task of mine moves — a new due date, or another activity'],
    ['due', 'The morning a task is due, and the day before'],
    ['overdue', 'A task of mine slips past its deadline']
  ];

  function sheetBody(code, prefs, list, here) {
    var x = explain(code);
    var html = '<div class="push-status is-' + x.tone + '">' + UI.icon(code === 'on' ? 'check' : 'bell') +
      '<span>' + U.esc(x.text) + '</span></div>';
    if (code === 'off') {
      html += '<p class="small muted push-note">Your browser will ask once. You can turn it off here, or in the browser, at any time.</p>';
    }
    if (code === 'on') {
      html += '<fieldset class="push-prefs"><legend>Tell me when</legend>' + TOGGLES.map(function (t) {
        return '<label class="checkbox"><input type="checkbox" data-pref="' + t[0] + '"' +
          (prefs[t[0]] !== false ? ' checked' : '') + '> ' + U.esc(t[1]) + '</label>';
      }).join('') + '</fieldset>' +
      '<fieldset class="push-prefs"><legend>On the lock screen</legend>' +
        '<label class="checkbox"><input type="checkbox" data-pref="details"' + (prefs.details ? ' checked' : '') +
        '> Show task names</label>' +
        '<div class="hint">Off: a notification only says that something happened — "You have a new task". ' +
        'Anybody holding this device can read what a lock screen shows.</div>' +
      '</fieldset>' +
      '<p class="small muted push-note">Quiet from 9:00 pm to 7:00 am: anything in between waits until morning. ' +
        'Deadline reminders come together, once each morning.</p>';
    }
    if (list && list.length) {
      html += '<div class="push-devices"><div class="field-label">Your devices with notifications</div><ul>' +
        list.map(function (d) {
          var mine = here && d.endpoint_hash === here;
          return '<li><span class="pd-name">' + U.esc(d.label || 'Device') + (mine ? ' <span class="chip chip-plain">this one</span>' : '') +
            '<span class="tiny muted"> · added ' + U.esc(U.fmtDateShort(String(d.created_at).slice(0, 10))) +
            (d.last_sent_at ? ' · last notified ' + U.esc(U.fmtDateShort(String(d.last_sent_at).slice(0, 10))) : '') +
            (d.failing ? ' · not answering' : '') + '</span></span>' +
            '<button type="button" class="btn btn-sm btn-ghost" data-remove-device="' + U.esc(d.id) + '"' +
            (mine ? ' data-this="1"' : '') + '>Remove</button></li>';
        }).join('') + '</ul></div>';
    }
    return html;
  }

  function sheetFooter(code) {
    if (code === 'on') {
      return '<button type="button" class="btn btn-ghost left" data-push-off>Turn off for this device</button>' +
        '<button type="button" class="btn" data-push-test>Send a test</button>' +
        '<button type="button" class="btn btn-primary" data-close>Done</button>';
    }
    if (code === 'off') {
      return '<button type="button" class="btn" data-close>Not now</button>' +
        '<button type="button" class="btn btn-primary" data-push-on data-autofocus>Turn on notifications</button>';
    }
    return '<button type="button" class="btn btn-primary" data-close>Close</button>';
  }

  function openSheet() {
    var code = status();
    var mine = load();
    var prefs = Object.assign({}, DEFAULTS, (mine && mine.prefs) || {});
    var online = code !== 'offline' && code !== 'signed-out';
    var check = online && code !== 'denied' && code !== 'unsupported' && code !== 'install'
      ? fetchKey().catch(function (err) { return err && err.setupMissing ? null : serverKey; })
      : Promise.resolve(serverKey);

    check.then(function (key) {
      if (online && (code === 'off') && !key) code = 'not-ready';
      var lists = online ? Promise.all([devices().catch(function () { return []; }),
        endpointHash(mine && mine.endpoint)]) : Promise.resolve([[], '']);
      return lists.then(function (r) { show(code, prefs, r[0], r[1]); });
    });
  }

  function show(code, prefs, list, here) {
    UI.modal({
      title: 'Notifications on this device',
      sheet: true,
      cls: 'push-sheet',
      body: sheetBody(code, prefs, list, here),
      footer: sheetFooter(code),
      onMount: function (root, close) {
        var busy = function (b, on) { b.disabled = on; };
        var on = root.querySelector('[data-push-on]');
        if (on) on.addEventListener('click', function () {
          busy(on, true);
          enable().then(function () {
            close();
            UI.toast('Notifications are on for this device.');
            openSheet();
          }).catch(function (err) {
            busy(on, false);
            UI.toast(err.message || 'Notifications could not be turned on.', 'error');
            if (err.code === 'denied' || err.code === 'not-ready') { close(); show(err.code, prefs, list, here); }
          });
        });
        var off = root.querySelector('[data-push-off]');
        if (off) off.addEventListener('click', function () {
          busy(off, true);
          disable().then(function () {
            close();
            UI.toast('Notifications are off for this device.');
          });
        });
        var t = root.querySelector('[data-push-test]');
        if (t) t.addEventListener('click', function () {
          busy(t, true);
          test().then(function (n) {
            UI.toast(n ? 'Sent. It should arrive within a minute.' : 'No device of yours has notifications on.');
          }).catch(function (err) { UI.toast(err.message, 'error'); })
            .then(function () { setTimeout(function () { busy(t, false); }, 60000); });
        });
        U.els('[data-pref]', root).forEach(function (box) {
          box.addEventListener('change', function () {
            var change = {};
            change[box.getAttribute('data-pref')] = box.checked;
            setPrefs(change).catch(function (err) {
              box.checked = !box.checked;
              UI.toast(err.message, 'error');
            });
          });
        });
        U.els('[data-remove-device]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var isHere = b.getAttribute('data-this') === '1';
            var step = isHere ? disable() : removeDevice(b.getAttribute('data-remove-device'));
            busy(b, true);
            step.then(function () {
              var li = b.closest('li');
              if (li) li.remove();
              UI.toast(isHere ? 'Notifications are off for this device.' : 'That device will not be notified any more.');
              if (isHere) close();
            }).catch(function (err) { busy(b, false); UI.toast(err.message, 'error'); });
          });
        });
      }
    });
  }

  global.Push = {
    status: status, explain: explain, enable: enable, disable: disable, setPrefs: setPrefs,
    test: test, devices: devices, reconcile: reconcile, forgetDevice: forgetDevice,
    openSheet: openSheet, deviceLabel: deviceLabel,
    _reset: function () { serverKey = null; }
  };
})(window);
