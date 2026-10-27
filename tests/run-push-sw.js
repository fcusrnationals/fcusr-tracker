/* sw.js — the service worker — in a sandbox.

       node tests/run-push-sw.js

   No install needed. Runs the real sw.js with a stand-in for the parts of the
   browser it touches (its registration, clients, notifications) and checks
   what a push and a tap actually do. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '   — ' + detail : '')); }
}

const SCOPE = 'https://fcusrnationals.github.io/fcusr-tracker/';
const src = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function worker(windows) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting: () => Promise.resolve(),
    registration: {
      scope: SCOPE,
      showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); }
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows || []),
      openWindow: (url) => { opened.push(url); return Promise.resolve(null); }
    }
  };
  vm.runInNewContext(src, { self, URL, console });
  const fire = async (type, event) => {
    const waits = [];
    event.waitUntil = (p) => waits.push(p);
    (listeners[type] || []).forEach((fn) => fn(event));
    await Promise.all(waits);
  };
  return { listeners, shown, opened, fire };
}

const pushEvent = (data) => ({
  data: data === undefined ? null : {
    json: () => { if (typeof data === 'string') return JSON.parse(data); return data; }
  }
});

(async () => {
  console.log('\n--- what it is, and is not ---');
  {
    const w = worker();
    check('it listens for push and for taps', !!w.listeners.push && !!w.listeners.notificationclick);
    check('it has no fetch handler, so it never caches or serves the app', !w.listeners.fetch);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    check('nor any code that caches, or could touch version.json', !/version\.json|caches\.|cache\.put|respondWith/.test(code));
  }

  console.log('\n--- a push ---');
  {
    const w = worker();
    await w.fire('push', pushEvent({ v: 1, title: 'You have a new task', body: 'Open the tracker to see it.',
      url: './#/task/b0000001-0000-4000-8000-000000000000', tag: 'fcusr-task-b0000001' }));
    const n = w.shown[0];
    check('is shown as a notification', !!n && n.title === 'You have a new task' && n.opts.body === 'Open the tracker to see it.');
    check('tagged, so a newer one about the same task replaces it', n && n.opts.tag === 'fcusr-task-b0000001');
    check('carrying the full address of the task', n && n.opts.data.url === SCOPE + '#/task/b0000001-0000-4000-8000-000000000000',
      n && n.opts.data.url);
    check('with the council icon', n && /app-icon-192\.png$/.test(n.opts.icon));

    await w.fire('push', pushEvent('{ not json'));
    check('a message that cannot be read is still shown, plainly',
      w.shown[1] && w.shown[1].title === 'FCUSR Tracker' && w.shown[1].opts.data.url === SCOPE + '#/my-tasks');
    await w.fire('push', pushEvent());
    check('so is an empty one', w.shown[2] && w.shown[2].title === 'FCUSR Tracker');
    await w.fire('push', pushEvent({ title: 'x', url: 'https://evil.example/phish' }));
    check('an address outside the tracker is never used', w.shown[3] && w.shown[3].opts.data.url === SCOPE + '#/my-tasks',
      w.shown[3] && w.shown[3].opts.data.url);
    await w.fire('push', pushEvent({ title: 'T'.repeat(500), body: 'B'.repeat(900) }));
    check('and very long text is cut to size', w.shown[4].title.length <= 120 && w.shown[4].opts.body.length <= 240);
  }

  console.log('\n--- a tap ---');
  {
    const messages = [];
    let focused = 0;
    const open = { url: SCOPE + '#/overview', focus: () => { focused++; return Promise.resolve(); },
      postMessage: (m) => messages.push(m) };
    const elsewhere = { url: 'https://other.example/', focus: () => Promise.resolve(), postMessage: () => { throw new Error('wrong window'); } };
    const w = worker([elsewhere, open]);
    let closed = 0;
    await w.fire('notificationclick', { notification: { close: () => { closed++; },
      data: { url: SCOPE + '#/task/b0000002-0000-4000-8000-000000000000' } } });
    check('closes the notification', closed === 1);
    check('takes an open tracker to the task without reloading it',
      messages.length === 1 && messages[0].type === 'fcusr-open' && messages[0].url === SCOPE + '#/task/b0000002-0000-4000-8000-000000000000' &&
      focused === 1, JSON.stringify(messages));
    check('and opens no second window', w.opened.length === 0);

    const w2 = worker([]);
    await w2.fire('notificationclick', { notification: { close: () => {}, data: { url: SCOPE + '#/task/x' } } });
    check('with the tracker closed, opens it at the task', w2.opened[0] === SCOPE + '#/task/x', w2.opened[0]);
    const w3 = worker([]);
    await w3.fire('notificationclick', { notification: { close: () => {}, data: { url: 'javascript:alert(1)' } } });
    check('a tampered address opens My tasks instead', w3.opened[0] === SCOPE + '#/my-tasks', w3.opened[0]);
  }

  console.log('\n========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('  FAILED: ' + failures.join('\n  FAILED: ')); process.exit(1); }
})();
