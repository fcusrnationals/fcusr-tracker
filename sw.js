/* FCUSR Task Tracker — the service worker, for push notifications only.

   It does two things: shows a notification when the council's server sends
   one, and opens the right task when somebody taps it. It deliberately has no
   fetch handler — it caches nothing and serves nothing — so the app loads
   exactly as it always has, and the "a newer version is out" bar, which
   depends on the browser fetching version.json fresh, keeps working.

   Registered only when somebody turns notifications on (assets/js/push.js).
   It must live at the top of the site so its scope covers every page. */
'use strict';

var ICON = 'assets/img/app-icon-192.png';
var GENERIC = { title: 'FCUSR Tracker', body: 'Something on your tasks needs a look.', url: './#/my-tasks', tag: 'fcusr' };

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

/* Only an address inside this site can be opened from a notification; anything
   else — a malformed message, or one that is not ours — opens My tasks. */
function safeUrl(raw) {
  var scope = self.registration.scope;
  try {
    var u = new URL(raw || GENERIC.url, scope);
    if (u.origin === new URL(scope).origin && u.href.indexOf(scope) === 0) return u.href;
  } catch (e) { /* fall through */ }
  return new URL(GENERIC.url, scope).href;
}

function readPayload(event) {
  var data = null;
  try { data = event.data ? event.data.json() : null; } catch (e) { data = null; }
  if (!data || typeof data !== 'object') data = {};
  var str = function (v, fallback, max) {
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
  };
  return {
    title: str(data.title, GENERIC.title, 120),
    body: str(data.body, GENERIC.body, 240),
    url: safeUrl(str(data.url, GENERIC.url, 300)),
    tag: str(data.tag, GENERIC.tag, 80)
  };
}

/* A browser only lets a site keep its push permission if every push is shown,
   so even a message that cannot be read becomes a plain notification. */
self.addEventListener('push', function (event) {
  var p = readPayload(event);
  event.waitUntil(self.registration.showNotification(p.title, {
    body: p.body,
    icon: ICON,
    badge: ICON,
    tag: p.tag,             // a newer message about the same task replaces the older one
    renotify: false,
    data: { url: p.url }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var scope = self.registration.scope;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(scope) === 0 && 'focus' in c) {
        // An open tracker is told where to go rather than reloaded mid-work.
        c.postMessage({ type: 'fcusr-open', url: url });
        return c.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});
