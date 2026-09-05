/* Full UI walk-through in jsdom — no browser window needed.
       npm install jsdom        (once)
       node tests/run-ui.js
*/
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const errors = [];
const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   — ' + extra : ''));
};

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail || e).toString().split('\n')[0]));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/index.html', runScripts: 'dangerously',
  virtualConsole: vc, pretendToBeVisual: true
});
const { window } = dom;

const FILES = [
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
  'assets/js/util.js', 'assets/js/store.js', 'assets/js/ui.js', 'assets/js/report.js',
  'assets/js/asset-db.js', 'assets/js/camera.js', 'assets/js/accomplishment.js', 'assets/js/accomplishment-pdf.js',
  'assets/js/accomplishment-word.js', 'assets/js/accomplishment-ui.js', 'assets/js/backend/config.js', 'assets/js/backend/backend.js', 'assets/js/auth.js', 'assets/js/term-ui.js', 'assets/js/term-pdf.js',
  'assets/js/letter-slip.js', 'assets/js/views/signin.js', 'assets/js/views/dashboard.js', 'assets/js/views/mytasks.js', 'assets/js/views/directives.js', 'assets/js/views/events.js',
  'assets/js/views/event-detail.js',
  'assets/js/views/letters.js', 'assets/js/views/letter-detail.js', 'assets/js/views/settings.js',
  'assets/js/forms.js', 'assets/js/app.js'
];

window.HTMLCanvasElement.prototype.getContext = () => null;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
console.log('--- boot ---');
try {
  FILES.forEach((f) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    window.document.head.appendChild(s);
  });
  if (window.document.readyState === 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  }
  check('all scripts evaluated', true);
  /* The dry-run notice is deliberately not dismissible by clicking away, so it
     is still on screen here and would answer every later $('.modal-…') query
     ahead of the dialog actually under test. Read it and close it, as a person
     would. */
  check('the dry run announces itself at the door',
    !!window.document.querySelector('.modal-backdrop'));
  check('and it is the only notice shown',
    window.document.querySelectorAll('.modal-backdrop').length === 1);
  window.document.querySelectorAll('.modal-backdrop [data-close]').forEach((b) =>
    b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  check('and closes when acknowledged', !window.document.querySelector('.modal-backdrop'));
  /* This sandbox has no fetch() and no IndexedDB, which is the point: start-up
     must not depend on either. Loading the council seal for the report header
     once threw here and took the whole boot with it — no screen was wired at
     all — so a browser that blocks or lacks an API has to cost a picture, never
     the app. */
  check('boots where fetch() does not exist', typeof window.fetch !== 'function');
  check('and the app still came up', !!window.App && !!window.Store);
} catch (e) {
  check('all scripts evaluated', false, e.message);
  console.log(e.stack);
  process.exit(1);
}

const D = window.document;
const $ = (s) => D.querySelector(s);
const $$ = (s) => Array.from(D.querySelectorAll(s));
const view = () => $('#view');
const text = () => view().textContent.replace(/\s+/g, ' ');
const S = window.Store;

const goto = (h) => { window.location.hash = h; window.dispatchEvent(new window.Event('hashchange')); };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const setValue = (el, v) => {
  el.value = v;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};

check('booted with a rendered view', view().children.length > 0);
check('no errors on boot', errors.length === 0, errors.join(' | '));

/* ---------------- scroll regressions ---------------- */
console.log('\n--- scroll behaviour ---');
const css = fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'assets/js/ui.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');

check('no overflow-x wrapper around sticky headers', !/\.table-wrap/.test(css));
check('tasks are rows, not wide tables', $$('.task').length > 0 && $$('table').length === 0);
check('menu closes on page scroll only, not nested scroll',
  !/addEventListener\('scroll',\s*closeMenu,\s*true\)/.test(uiSrc) &&
  /addEventListener\('scroll',\s*closeMenu\)/.test(uiSrc));
check('menu is position:fixed', /\.menu\s*{[^}]*position:\s*fixed/.test(css));
check('scroll lock is a class on <html>', /is-locked/.test(uiSrc) && !/body\.style\.overflow/.test(uiSrc));
check('lock rule covers html and body',
  /html\.is-locked,\s*html\.is-locked body\s*{\s*overflow:\s*hidden/.test(css));
check('anchors clear the sticky bar', /scroll-padding-top:/.test(css));
check('sticky chrome is one 48px strip', /--nav-h:\s*48px/.test(css));
check('header-measuring JS removed', !/measureHeader/.test(appSrc));

const htmlEl = D.documentElement;
check('not locked at rest', !htmlEl.classList.contains('is-locked'));
const c1 = window.UI.modal({ title: 'A', body: 'a' });
const c2 = window.UI.modal({ title: 'B', body: 'b' });
check('nested dialogs hold the lock', htmlEl.classList.contains('is-locked'));
c2();
check('inner close keeps the lock', htmlEl.classList.contains('is-locked'));
c1();
check('last close releases it', !htmlEl.classList.contains('is-locked'));
c1();
check('double close is safe', !htmlEl.classList.contains('is-locked'));

/* ---------------- security ---------------- */
console.log('\n--- security ---');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('a Content-Security-Policy is declared', /Content-Security-Policy/.test(indexHtml));
check('CSP blocks external and inline script',
  /default-src 'none'/.test(indexHtml) && /script-src 'self'/.test(indexHtml) &&
  !/script-src[^;]*unsafe-inline/.test(indexHtml));
check('no inline event handlers in the markup', !/\son[a-z]+=["']/.test(indexHtml));

// Markup in user text must render as text, never as elements.
const evilEvent = S.addEvent({ title: '<img src=x onerror=alert(1)>Pwn', dateStart: window.U.today() });
S.addTask({ eventId: evilEvent.id, title: '"><script>alert(1)</script>', dueDate: window.U.today() });
goto('#/events/' + evilEvent.id);
check('script tags in a title do not become elements', view().querySelectorAll('script, img').length === 0);
check('the text is shown literally, escaped', text().includes('<script>alert(1)</script>'));
check('no stray injected attributes',
  !view().innerHTML.includes('onerror=') || view().innerHTML.includes('onerror=alert(1)&gt;'));
S.deleteEvent(evilEvent.id);

// A hostile backup file must be neutralised, not trusted.
const good = S.toJSON();
S.fromJSON(JSON.stringify({ data: {
  people: [{ id: '" onmouseover="alert(1)', name: 'Bad Id' }],
  events: [{ id: 'evt_x', title: 'Ok', status: 'Nope', dateStart: '2026-02-31' }],
  tasks: [{ id: 'tsk_x', eventId: 'evt_x', title: 'T', status: 'Fake', priority: 'Nope' }],
  org: { emblem: 'javascript:alert(1)' }
} }));
check('hostile id is replaced with a safe one', /^[A-Za-z0-9_-]+$/.test(S.people()[0].id), S.people()[0].id);
check('impossible date is dropped', S.events()[0].dateStart === '');
check('bad enums fall back', S.events()[0].status === 'Upcoming' && S.tasks()[0].status === 'Not Started');
check('script-capable emblem rejected', S.org().emblem === '');
goto('#/settings');
check('restored hostile data renders without injecting', view().querySelectorAll('script').length === 0);
S.fromJSON(good);

/* ---------------- simplification ---------------- */
console.log('\n--- shape of the UI ---');
goto('#/dashboard');
check('3 summary pills, not 5 tiles', $$('.pill').length === 3);
/* The Overview is four blocks and stays four blocks: what needs attention, the
   letters worth chasing, how each unit is faring, and the events themselves.
   Counting raw lists broke the moment a block gained a fold, so name them. */
const heads = $$('.section-head h2').map((h) => h.textContent.replace(/\s+/g, ' ').trim());
check('Needs attention comes first', /^Needs attention/.test(heads[0]), heads.join(' | '));
check('Letters has its own block', heads.some((h) => /^Letters/.test(h)), heads.join(' | '));
check('Republic roll-up is there for a national', heads.some((h) => /Across the Republic/.test(h)));
check('and the events are last', /^Events/.test(heads[heads.length - 1]), heads.join(' | '));
check('five nav tabs', $$('.tab').length === 5);
check('Letters is one of them', $$('.tab').some((t) => t.getAttribute('data-route') === 'letters'));
goto('#/events');
check('no second search box', !$('#f-q'));
const foundation = S.events().find((e) => e.title.startsWith('Foundation'));
goto('#/events/' + foundation.id);
check('2 grouping options', $$('[data-group-by]').length === 2);
check('event admin behind one menu', !!$('[data-more]'));
S.setLastPerson(S.people()[0].id);
goto('#/my-tasks');
check('one segmented filter, no dropdown stack',
  $$('[data-filter]').length === 3 && !$('#f-status') && !$('#f-sort'));

/* ---------------- core flow ---------------- */
console.log('\n--- create event → add tasks ---');
const before = S.events().length;
goto('#/events');
click($('[data-create-event]'));
setValue($('#f-title'), 'General Assembly 2026');
setValue($('#f-dateStart'), window.U.addDays(window.U.today(), 20));
click($('[data-save]'));
check('event created', S.events().length === before + 1);
const created = S.events().find((e) => e.title === 'General Assembly 2026');
check('landed on the new event', window.location.hash === '#/events/' + created.id);
goto('#/events/' + created.id);
check('empty state invites the first task', text().includes('No tasks under this event yet'));
check('add form already open', !!$('#a-title'));

const people = S.people();
['Book the auditorium', 'Prepare the agenda', 'Invite the deans'].forEach((t, i) => {
  setValue($('#a-title'), t);
  setValue($('#a-assignee'), people[i].id);
  click($('[data-save-task]'));
});
check('three tasks added in a row', S.tasks({ eventId: created.id }).length === 3);
check('form stays open', !!$('#a-title'));
check('title clears each time', $('#a-title').value === '');
check('assignee carries over', $('#a-assignee').value === people[2].id);
check('task cannot exist outside an event',
  (() => { try { S.addTask({ title: 'x' }); return false; } catch (e) { return true; } })());

console.log('\n--- inline status editing ---');
const first = S.tasks({ eventId: created.id })[0];
click($$('[data-status-for]').find((c) => c.getAttribute('data-status-for') === first.id));
check('status menu opens', !!$('.menu'));
check('five statuses offered', $$('.menu button').length === 5);
click($$('.menu button').find((b) => b.getAttribute('data-set') === 'Done'));
check('saved with no modal', S.task(first.id).status === 'Done');
check('completedAt stamped', !!S.task(first.id).completedAt);
check('done tasks drop the countdown chip',
  !window.UI.taskRow(S.task(first.id), []).includes('days late'));

const second = S.tasks({ eventId: created.id })[1];
click($$('[data-status-for]').find((c) => c.getAttribute('data-status-for') === second.id));
click($$('.menu button').find((b) => b.getAttribute('data-set') === 'On hold'));
check('on hold asks why', !!$('#blk'));
setValue($('#blk'), 'Waiting for the adviser.');
click($('[data-ok]'));
await sleep(10);
check('reason stored', S.task(second.id).blockedReason === 'Waiting for the adviser.');

console.log('\n--- grouping and event menu ---');
goto('#/events/' + created.id);
click($('[data-group-by="assignee"]'));
check('group by person', $$('.group').length > 1);
check('group headers carry counts', /\d+ of \d+ done/.test(text()));
click($('[data-group-by="flat"]'));
click($('[data-more]'));
check('⋯ menu opens with 3 actions', $$('.menu button').length === 3);
click($$('.menu button').find((b) => b.getAttribute('data-set') === 'archive'));
check('archive works', S.event(created.id).status === 'Archived');
S.updateEvent(created.id, { status: 'Upcoming' });

console.log('\n--- my tasks ---');
S.setLastPerson('');
goto('#/my-tasks');
check('asks for a name', text().includes('Select your name'));
setValue($('#person-select'), people[0].id);
check('remembered on this device', S.lastPerson() === people[0].id);
goto('#/my-tasks');
check('shows the person', text().includes(people[0].name));
check('grouped by event', $$('.group').length >= 1);

console.log('\n--- access control ---');
const Auth = window.Auth;

// Nobody signed in: Settings refuses to open.
goto('#/settings');
check('Settings is closed to a stranger', !$('[data-enrol]') && !!$('#ask-exec'));

// Signing in offline treats you as a national executive.
await Auth.signIn('', '');
check('an executive is recognised', Auth.isExecutive() === true);
goto('#/settings');
check('Settings opens for an executive', !!$('[data-enrol]') && !!$('[data-backup]'));
check('enrolment lives there', !!$('[data-enrol]'));
check('the officer list can be generated', !!$('[data-roster]'));
check('a person can change their own password', !!$('[data-change-pw]'));

// Now become a volunteer enrolled into exactly one event.
// A national activity that is still running: a volunteer's access is derived
// from the event being live, so a completed one would fail for the wrong reason.
const volEvent = S.events({ unitId: S.nationalUnitId(), activeOnly: true })[0];
Auth.adopt({
  id: 'vol1', full_name: 'Helper', position: 'Logistics Volunteer',
  unit_name: 'FCUSR Nationals', unit_kind: 'national', access: 'volunteer',
  eventIds: [volEvent.id]
});
check('a volunteer is not an executive', Auth.isExecutive() === false);
check('they see only their own event', Auth.visibleEvents().length === 1);
check('and may open it', Auth.canSee(volEvent.id) === true);
const otherEvent = S.events({ unitId: S.nationalUnitId() }).find((e) => e.id !== volEvent.id);
check('but not somebody else\'s', Auth.canSee(otherEvent.id) === false);

goto('#/overview');
check('the Overview is closed to them', text().includes('Not available to volunteers'));
goto('#/directives');
check('so are Directives', text().includes('Not available to volunteers'));
goto('#/settings');
check('and Settings', !$('[data-enrol]'));
goto('#/events/' + otherEvent.id);
check('opening another event is refused', text().includes('Not your event'));
goto('#/events');
check('their own event still lists', $$('.event-row').length === 1);
check('they cannot create events', !$('[data-create-event]'));

// Completing the activity ends their access by itself.
const wasStatus = S.event(volEvent.id).status;
S.updateEvent(volEvent.id, { status: 'Completed' });
check('access ends when the event completes', Auth.visibleEvents().length === 0);
check('and the event can no longer be opened', Auth.canSee(volEvent.id) === false);
S.updateEvent(volEvent.id, { status: wasStatus });
check('re-opening the event restores it', Auth.canSee(volEvent.id) === true);

// Back to an executive for the rest of the walk-through.
await Auth.signIn('', '');

console.log('\n--- settings ---');
goto('#/settings');
check('directory lists officers', text().includes('Althea Ramirez'));
check('deactivate, never delete', text().includes('Deactivate'));
check('backup offered', !!$('[data-backup]') && !!$('#restore-file'));
check('emblem slot offered', !!$('#emblem-file'));
click($$('[data-toggle]').find((b) => b.getAttribute('data-toggle') === 'roles'));
check('collapsed sections open', $('[data-group="roles"]').getAttribute('data-collapsed') === 'false');

console.log('\n--- export and search ---');
goto('#/events/' + foundation.id);
click($('[data-export]'));
check('export dialog opens', !!$('#pending-only'));
// Scope to the dialog on top: an earlier modal left open would otherwise be
// the one this reads.
check('names the file', /FCUSR-TaskReport-Foundation-Week-2026-\d{4}-\d{2}-\d{2}\.pdf/
  .test($$('.modal-body').pop().textContent),
  ($$('.modal-body').pop().textContent || '').replace(/\s+/g, ' ').slice(0, 90));
click($('[data-close]'));
click($('#btn-search'));
setValue($('#q'), 'tarpaulin');
await sleep(220);
check('search finds tasks', $('#results').textContent.includes('Design tarpaulin'));
setValue($('#q'), 'althea');
await sleep(220);
check('search finds people', $('#results').textContent.includes('Althea Ramirez'));
click($('[data-close]'));

console.log('\n--- deletion is confirmed ---');
goto('#/events/' + created.id);
const n0 = S.tasks({ eventId: created.id }).length;
click($$('[data-edit]')[0]);
click($('[data-delete]'));
check('asks before deleting', !!$('[data-ok]'));
click($('[data-cancel]'));
await sleep(10);
check('cancel deletes nothing', S.tasks({ eventId: created.id }).length === n0);

console.log('\n--- accomplishment report ---');
const A = window.Accomplishment;
const evId = foundation.id;

// Nothing appears until the activity is actually finished.
goto('#/events/' + evId);
check('no report banner while tasks are pending', !$('[data-open-report]') && !$('[data-mark-complete]'));

S.tasks({ eventId: evId }).forEach((t) => S.setTaskStatus(t.id, 'Done'));
goto('#/events/' + evId);
check('all tasks done offers the completion toggle', !!$('[data-mark-complete]'));

/* Every activity is evaluated, and that is enforced rather than suggested: an
   activity with no feedback form cannot be marked finished, however complete
   its tasks are. */
check('the missing feedback form is called out', !!$('.fb-banner.is-missing'));
click($('[data-mark-complete]'));
check('and completion is refused without it', S.event(evId).status !== 'Completed');

S.setFeedbackLink(evId, 'https://forms.gle/abc123');
goto('#/events/' + evId);
check('with a form the banner turns green', !!$('.fb-banner.is-done'));
click($('[data-mark-complete]'));
check('marking complete sets the event status', S.event(evId).status === 'Completed');
goto('#/events/' + evId);
check('report becomes the last step', !!$('[data-open-report]'));
check('activity sits at 90% before the report', /90% of the whole activity/.test(text()));

const draft = A.draftFor(evId);
check('a fresh report is empty', A.progress(draft).done === 0);
check('description needs real content', !A.stepDone(draft, 'description'));
draft.description = 'x'.repeat(40);
check('description counts once written', A.stepDone(draft, 'description'));
check('photos require the minimum', !A.stepDone(draft, 'photos'));
draft.photos = Array.from({ length: A.MIN_PHOTOS - 1 }, (_, i) => ({ assetId: 'a' + i, caption: '' }));
check(A.MIN_PHOTOS - 1 + ' photos is still short', !A.stepDone(draft, 'photos'));
draft.photos.push({ assetId: 'a99', caption: '' });
check(A.MIN_PHOTOS + ' photos passes', A.stepDone(draft, 'photos'));
check('a letter needs both a name and pages',
  (() => { draft.letters = [{ name: '', assets: ['x'] }]; return !A.stepDone(draft, 'letters'); })());
draft.letters = [{ name: 'Letter of Intent', assets: ['x'] }];
check('a named letter with pages passes', A.stepDone(draft, 'letters'));
check('minutes is the only optional step', A.stepDone(draft, 'minutes'));

draft.program.assets = ['p1'];
draft.evaluation.assets = ['e1'];
check('signatories are required', !A.stepDone(draft, 'signatories'));
draft.signatories = { preparedBy: { name: 'Trisha Villanueva', position: 'PIO' },
                      president: { name: 'Arron Aperocho', show: true },
                      adviser: { name: 'Janrie Agam' } };
check('naming the preparer satisfies it', A.stepDone(draft, 'signatories'));
check('every required section now complete', A.progress(draft).done === A.progress(draft).total);

// The report is stored on the event, and survives the sanitiser.
S.saveReport(evId, draft);
const saved = S.report(evId);
check('report saved against the event', !!saved && saved.eventId === evId);
check('photos kept', saved.photos.length === A.MIN_PHOTOS);
S.saveReport(evId, { driveLink: 'javascript:alert(1)' });
check('a non-Drive link is refused', S.report(evId).driveLink === '');
S.saveReport(evId, { driveLink: 'https://drive.google.com/file/d/abc/view' });
check('a real Drive link is kept', S.report(evId).driveLink.indexOf('https://drive.google.com/') === 0);

const wizSrc = fs.readFileSync(path.join(ROOT, 'assets/js/accomplishment-ui.js'), 'utf8');
check('uploading a photo is the only way in',
  /data-pick=/.test(wizSrc) && !/data-scan=/.test(wizSrc) && !/data-camera=/.test(wizSrc));
check('eight photos are required', A.MIN_PHOTOS === 8);
check('the camera is a real stream, not the mobile-only capture attribute',
  !/capture="environment"/.test(wizSrc) &&
  /getUserMedia/.test(fs.readFileSync(path.join(ROOT, 'assets/js/camera.js'), 'utf8')));
check('camera refuses politely on an insecure page',
  /secure\(\)/.test(fs.readFileSync(path.join(ROOT, 'assets/js/camera.js'), 'utf8')));
check('each upload block carries instructions', /data-howto=/.test(wizSrc));
check('pages can be reordered and removed', /data-move=/.test(wizSrc) && /data-drop=/.test(wizSrc));
check('the preview renders the real PDF', /previewURL/.test(wizSrc));
check('the preview is live per step, not only at the end',
  /refreshPreview/.test(wizSrc) && /STEP_PAGE/.test(wizSrc) && /#page=/.test(wizSrc));
check('CSP allows the blob preview frame', /frame-src blob:/.test(indexHtml));

const pdfSrc = fs.readFileSync(path.join(ROOT, 'assets/js/accomplishment-pdf.js'), 'utf8');
check('every section starts on its own page', /function startSection/.test(pdfSrc) && /doc\.addPage\(\)/.test(pdfSrc));
check('page 1 is the generated cover', /startSection\('cover'\)/.test(pdfSrc));
check('the letter of intent comes next', (() => {
  const cover = pdfSrc.indexOf("startSection('cover')");
  const letters = pdfSrc.indexOf("documentSection('letters'");
  const desc = pdfSrc.indexOf("startSection('description'");
  return cover < letters && letters < desc;
})());
// jsPDF's own align:'justify' does nothing when it is handed one line at a
// time, which is how this used to be called — the option was there, the text
// came out flush left, and the old check passed on the presence of the option
// rather than the result. Spacing is now worked out here; tests/report-proof.js
// checks what actually lands on the page.
check('justification is computed, not delegated',
  /function justifyLine/.test(pdfSrc) && /getTextWidth/.test(pdfSrc));
check('the closing line of a paragraph is left alone', /!last/.test(pdfSrc));
check('no sheet leaves with only the letterhead on it', /pruneEmptyPages/.test(pdfSrc));
check('photos print without captions', !/p\.caption/.test(pdfSrc));
check('body text is 12pt', /size \|\| 12/.test(pdfSrc));
check('section titles are centred', /toUpperCase\(\), A4\.w \/ 2, y, \{ align: 'center' \}/.test(pdfSrc));
check('the gold rules under titles are gone', !/setLineWidth\(0\.7\)/.test(pdfSrc));
check('photos print four to a page', /rowsPerPage = 2/.test(pdfSrc) && /cols = 2/.test(pdfSrc));
check('liquidation has its own section', /documentSection\('liquidation'/.test(pdfSrc));
check('minutes fall back to the task assignment',
  /Task Assignment and Deliberation/.test(pdfSrc));
check('signatories are filled in by the user', /report\.signatories/.test(pdfSrc));
check('the president can be left off', /pres\.show !== false/.test(pdfSrc));
check('the cover no longer says submitted or generated',
  !/Submitted to the Office/.test(pdfSrc) && !/'Generated ' \+ U\.nowStamp/.test(pdfSrc));
check('footer is bottom-right with title and page', /align: 'right'/.test(pdfSrc) && /Page ' \+ i \+ ' of '/.test(pdfSrc));

console.log('\n--- directives ---');
goto('#/directives');
check('Directives has its own screen', text().includes('Directives'));
const dBefore = S.tasks({ kind: 'directive' }).length;
if (!$('#d-title')) click($('[data-open-add]'));
setValue($('#d-title'), 'Follow up the adviser on the budget memo');
click($('[data-save]'));
check('a directive saves without an event', S.tasks({ kind: 'directive' }).length === dBefore + 1);
const dir = S.tasks({ kind: 'directive' })[0];
check('it genuinely has no parent event', !dir.eventId && dir.kind === 'directive');
check('event work still requires an event',
  (() => { try { S.addTask({ title: 'x' }); return false; } catch (e) { return true; } })());
goto('#/overview');
check('directives stay out of the Overview', !text().includes('budget memo'));

/* Every step of the wizard must draw its own body. This is here because two of
   them did not: `stepBody()` had no branch for Signatories or Liquidation, so
   both fell through to the Review screen. Signatories counts towards progress,
   so with no way to type a name the export button could never enable — and the
   report's signature block printed blank. The PDF tests never saw it because
   they build a draft in code and never open the wizard. */
console.log('\n--- every wizard step draws itself ---');
{
  // jsdom has no IndexedDB. The wizard must survive that — see the catch in
  // open() — but stub it here so the steps themselves are what is under test.
  window.AssetDB.getMany = (ids) => Promise.resolve(ids.map((id) => ({ id, dataUrl: null })));

  window.AccomplishmentUI.open(evId);
  await sleep(30);                      // the wizard warms its picture cache first
  const stepBtns = () => Array.from(D.querySelectorAll('#wiz [data-step]'));
  check('the wizard opens', stepBtns().length === A.STEPS.length, stepBtns().length + ' steps');

  const seen = {};
  A.STEPS.forEach((step, i) => {
    click(stepBtns()[i]);
    const body = $('#wiz');
    const t = body.textContent.replace(/\s+/g, ' ');
    seen[step.key] = t;
    check('“' + step.label + '” shows its own heading', t.includes(step.title), t.slice(0, 70));
  });

  // The review-only controls must appear on review and nowhere else.
  A.STEPS.forEach((step, i) => {
    click(stepBtns()[i]);
    const hasExport = !!$('[data-export]');
    if (step.key === 'review') check('review offers the export', hasExport);
    else check('“' + step.label + '” is not the review screen', !hasExport);
  });

  // And the fields that were missing are really there and really bind.
  click(stepBtns()[A.STEPS.findIndex((x) => x.key === 'signatories')]);
  check('signatories has a name field', !!$('#sg-prep-name'));
  check('and a position field', !!$('#sg-prep-pos'));
  check('and the adviser', !!$('#sg-adv-name'));
  setValue($('#sg-prep-name'), 'Job Sarmiento');
  setValue($('#sg-prep-pos'), 'Secretary, FCUSR Nationals');
  const st = A._state();
  check('typing a name reaches the draft', st.draft.signatories.preparedBy.name === 'Job Sarmiento');
  check('and so does the position', st.draft.signatories.preparedBy.position === 'Secretary, FCUSR Nationals');
  check('which satisfies the step', A.stepDone(st.draft, 'signatories'));

  click(stepBtns()[A.STEPS.findIndex((x) => x.key === 'liquidation')]);
  check('liquidation offers an uploader', !!$('[data-grid="liquidation"]'));

  const close = $('[data-save-close]');
  if (close) click(close);
}

console.log('\n--- word export ---');
const wordSrc = fs.readFileSync(path.join(ROOT, 'assets/js/accomplishment-word.js'), 'utf8');
check('a Word file can be produced', typeof window.AccomplishmentWord.save === 'function');
check('sections break onto their own page, as in the PDF',
  /page-break-before:always/.test(wordSrc));
check('nothing else is force-broken',
  (wordSrc.match(/page-break-before/g) || []).length <= 2);
check('pictures sit in movable boxes', /v:textbox|v:shape/.test(wordSrc));
check('body text is justified at 12pt',
  /text-align:justify/.test(wordSrc) && /font-size:12pt/.test(wordSrc));

console.log('\n--- filing the report ---');
const uiSrc2 = fs.readFileSync(path.join(ROOT, 'assets/js/accomplishment-ui.js'), 'utf8');
check('an upload window follows the download', /function uploadWindow/.test(uiSrc2));
check('it warns against a personal account', /owned by the FCUSR/.test(uiSrc2));
check('it explains that only the link is kept', /never the file itself/.test(uiSrc2));
check('it insists the file is not deleted', /Never delete or move the file/.test(uiSrc2));

console.log('\n--- backend wiring ---');
const Backend = window.Backend;
check('Supabase is the selected driver', Backend.config.driver === 'supabase');
check('falls back to local until credentials are filled in', Backend.isFallback() === true);
check('app still works offline in the meantime', Backend.driverName() === 'This browser only');
check('CSP allows Supabase and nothing else',
  /connect-src 'self' https:\/\/\*\.supabase\.co/.test(indexHtml));

console.log('\n--- accessibility ---');
goto('#/dashboard');
check('progress bars expose values', $$('[role="progressbar"]').length > 0);
check('current tab marked', !!$('.tab[aria-current="page"]'));
check('status chips are labelled buttons',
  $$('[data-status-for]').every((c) => c.tagName === 'BUTTON' && c.getAttribute('aria-label')));
check('pills report pressed state', $$('.pill[aria-pressed]').length === 3);
check('skip link present', !!$('.skip-link'));

console.log('\n--- the letters tracker ---');
{
  const office = (code) => S.offices().find((o) => o.code === code);
  const dean = office('DEAN'), osa = office('OSA');
  const ev = S.events()[0];

  const L = S.addLetter({
    subject: 'Request to use the gymnasium', eventId: ev.id, unitId: S.nationalUnitId(),
    inChargeName: 'Job Sarmiento', officeIds: [dean.id, osa.id]
  });

  goto('#/letters');
  check('the letters screen opens', /Letters/.test(view().textContent));
  check('the letter is listed', text().includes('Request to use the gymnasium'));
  check('and says where it is', /not yet sent/i.test(text()), text().slice(0, 120));
  check('who is carrying it is on the row', text().includes('Job Sarmiento'));

  goto('#/letters/' + L.id);
  check('a letter opens on its own screen', text().includes('Request to use the gymnasium'));
  check('the trail lists every office', $$('.trail-stop').length === 2);
  check('only the office holding it offers a button', $$('[data-receive]').length === 1);
  check('and it is the first one', $('[data-receive]').getAttribute('data-receive') === L.stops[0].id);

  // Hand it over, through the real dialog. Queries are scoped to the dialog on
  // top: an earlier screen or a stale modal must not answer for it.
  const dlg = () => $$('.modal-backdrop').pop();
  const inDlg = (sel) => dlg().querySelector(sel);

  click($('[data-receive]'));
  check('the hand-over dialog opens', !!dlg() && !!inDlg('#f-rby'));
  setValue(inDlg('#f-rby'), 'Mrs. Ferrer');
  click(inDlg('[data-save]'));
  check('the hand-over is recorded', S.letter(L.id).stops[0].receivedBy === 'Mrs. Ferrer');
  check('the screen now names the office', /with dean of the college/i.test(text()), text().slice(0, 140));
  check('and offers the outcome next', $$('[data-release]').length === 1);

  // A blank receiver is refused.
  click($('[data-release]'));
  const outcomes = Array.from(dlg().querySelectorAll('[data-outcome]'));
  check('the three outcomes are offered', outcomes.length === 3);
  click(outcomes.find((b) => b.getAttribute('data-outcome') === 'Returned for revision'));
  click(inDlg('[data-save]'));
  check('sending it back demands a reason', !!inDlg('.field.has-error'));
  setValue(inDlg('#f-xnote'), 'Budget breakdown missing');
  click(inDlg('[data-save]'));

  goto('#/letters/' + L.id);
  check('a returned letter says so', /returned by dean of the college/i.test(text()), text().slice(0, 160));
  check('it does not advance to the next office', !/with office of student affairs/i.test(text()));
  /* A return opens a fresh attempt at the same office directly beneath it, so
     there is nothing to "reopen" — the next hand-over is already waiting, and
     the reason it came back stays readable above it. */
  check('a second run at that office is waiting', $$('.trail-stop').length === 3);
  check('the return is still shown', /returned for revision/i.test(text()));
  check('with the reason', text().includes('Budget breakdown missing'));
  check('and the next hand-over is ready', $$('[data-receive]').length === 1);

  goto('#/overview');
  check('a letter needing a chase reaches the Overview', text().includes('Request to use the gymnasium'));

  goto('#/events/' + ev.id);
  // The activity's sections are tabs now, so the letters live behind their own.
  check('the activity has a Letters tab', !!$('[data-tab="letters"]'));
  click($('[data-tab="letters"]'));
  check('and it shows under its activity', text().includes('Request to use the gymnasium'));
  click($('[data-tab="tasks"]'));
  check('tasks come back', $$('.task').length > 0);

  /* A letter belongs to a unit. The list filters by unit, but typing the address
     of one must not get round that — an independent body's correspondence is
     sealed from the National government, and the other way about. */
  const duag = S.units().find((u) => u.code === 'DUAG');
  const before = window.Auth.current();
  window.Auth.adopt({ id: 'local', full_name: 'Festival Officer', position: 'Chair',
    unit_id: duag.id, unit_name: duag.name, unit_kind: duag.kind, access: 'officer' });
  goto('#/letters/' + L.id);
  check('another unit cannot open your letter by address', /not your letter/i.test(text()), text().slice(0, 80));
  goto('#/letters');
  check('and it is not in their list', !text().includes('Request to use the gymnasium'));
  window.Auth.adopt({ id: 'local', full_name: before.name, position: before.position,
    unit_id: before.unitId, unit_name: before.unitName, unit_kind: before.unitKind,
    access: before.access });

  S.deleteLetter(L.id);
}

console.log('\n--- console cleanliness ---');
check('no console errors across the walk-through', errors.length === 0, errors.slice(0, 4).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log('\n========================================');
console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  failed.forEach((f) => console.log('  FAILED: ' + f.name + (f.extra ? '  — ' + f.extra : '')));
  process.exit(1);
}
})();
