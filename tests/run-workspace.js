/* Workspace checks: the Bulletin Board, event templates, duplicating an
   activity, academic years and their archives, activity history, the term
   report, and the Watermark Studio's arithmetic and ZIP bytes.

   Loads the app's real modules in a browser-like sandbox — no browser needed.
       node tests/run-workspace.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   — ' + extra : ''));
};
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message || 'threw'; } };

function sandbox() {
  const mem = new Map();
  const sb = {
    console, setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, URL,
    Blob, TextEncoder, DataView, ArrayBuffer, Uint8Array, Uint32Array,
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k)
    },
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => null }),
      head: { appendChild() {} },
      body: { appendChild() {}, classList: { add() {}, remove() {} }, style: {} },
      documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}
    },
    navigator: { userAgent: 'node' },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary')
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  ['assets/js/util.js', 'assets/js/store.js', 'assets/js/ui.js',
   'assets/js/term-report.js', 'assets/js/watermark.js']
    .forEach((f) => vm.runInContext(read(f), sb, { filename: f }));
  vm.runInContext('Store.load(); Store._seedRehearsal();', sb);
  return sb;
}

const sb = sandbox();
const S = sb.Store, U = sb.U;
const run = (code) => vm.runInContext(code, sb);
const saved = () => JSON.parse(sb.localStorage.getItem('fcusr.tracker.v1') || '{}');

// A signed-in account, for the parts that ask who is at the screen.
function signIn(opts) {
  sb.window.Auth = Object.assign({
    signedIn: () => true,
    current: () => ({ id: 'prof-1', email: 'officer@example.org', name: 'Test Officer' }),
    myUnitId: () => S.nationalUnitId(),
    isNational: () => true,
    canPublishBulletin: () => true,
    canManageYears: () => true,
    canEditTemplate: () => true,
    canEditEvent: () => true
  }, opts || {});
}
function signOut() { delete sb.window.Auth; }

/* ---------------- stable ids ---------------- */
console.log('--- deterministic ids ---');
{
  const a = U.hashUuid('ann-1|prof-1'), b = U.hashUuid('ann-1|prof-1'), c = U.hashUuid('ann-1|prof-2');
  check('the same pair always gives the same id', a === b, a);
  check('a different pair gives a different id', a !== c);
  check('and it is shaped like a uuid', U.isUuid(a));
}

/* ---------------- the Bulletin Board ---------------- */
console.log('\n--- bulletin board ---');
{
  const now = Date.now();
  const iso = (days) => new Date(now + days * 86400000).toISOString();
  const urgent = S.addAnnouncement({ title: 'Liquidation reports', message: 'Due Friday.', priority: 'Urgent',
    requireAck: true, pinned: true, audience: { kind: 'everyone' } });
  check('an announcement is published straight away', S.announcementState(urgent) === 'active');
  check('it keeps its priority and pin', urgent.priority === 'Urgent' && urgent.pinned === true);
  check('and its history says it was published', (urgent.history || []).some((h) => /published/.test(h.text)));

  const later = S.addAnnouncement({ title: 'Next week', publishAt: iso(3), audience: { kind: 'everyone' } });
  check('one dated ahead is scheduled', S.announcementState(later) === 'scheduled');
  const draft = S.addAnnouncement({ title: 'Half written', published: false, audience: { kind: 'everyone' } });
  check('a draft stays a draft', S.announcementState(draft) === 'draft');
  const old = S.addAnnouncement({ title: 'Last month', publishAt: iso(-30), expiresAt: iso(-1),
    audience: { kind: 'everyone' } });
  check('one past its expiry moves to Previous by itself', S.announcementState(old) === 'expired');

  check('it cannot expire before it is published',
    /expire before/.test(throws(() => S.addAnnouncement({ title: 'x', publishAt: iso(5), expiresAt: iso(2) }))));
  check('a units audience needs a unit',
    /at least one unit/.test(throws(() => S.addAnnouncement({ title: 'x', audience: { kind: 'units', unitIds: [] } }))));
  check('a link that is not https is dropped',
    S.addAnnouncement({ title: 'Linky', link: { url: 'javascript:alert(1)', label: 'x' } }).link.url === '');
  check('an https link is kept',
    S.addAnnouncement({ title: 'Linky 2', link: { url: 'https://example.org/form', label: 'Form' } }).link.url ===
      'https://example.org/form');

  const unitA = S.units({ governed: true }).find((u) => u.kind !== 'national');
  const toUnit = S.addAnnouncement({ title: 'For one college', audience: { kind: 'units', unitIds: [unitA.id] } });
  check('a unit officer sees what is sent to their unit',
    S.announcementFor(toUnit, { unitId: unitA.id, officer: true }));
  check('another unit does not', !S.announcementFor(toUnit, { unitId: 'someone-else', officer: true }));
  check('a volunteer is not sent the everyone notices',
    !S.announcementFor(urgent, { unitId: unitA.id, officer: false }));
  const nationalsOnly = S.addAnnouncement({ title: 'Internal', audience: { kind: 'nationals' } });
  check('a Nationals-only notice is hidden from the units',
    !S.announcementFor(nationalsOnly, { unitId: unitA.id, officer: true }));
  check('and shown to the Nationals', S.announcementFor(nationalsOnly, { national: true }));

  // Only the Nationals publish, asked in the data layer, not only on the screen.
  signIn({ canPublishBulletin: () => false, isNational: () => false });
  check('a unit officer cannot post', /Only FCUSR Nationals/.test(throws(() => S.addAnnouncement({ title: 'Nope' }))));
  check('or edit', /Only FCUSR Nationals/.test(throws(() => S.updateAnnouncement(urgent.id, { title: 'Changed' }))));
  check('or delete', /Only FCUSR Nationals/.test(throws(() => S.deleteAnnouncement(urgent.id))));

  // Acknowledging: once per account, counted against the audience with a sign-in.
  signOut();
  S.addPerson({ name: 'Signed In Officer', unitId: S.nationalUnitId(), email: 'officer@example.org', access: 'officer' });
  S.addPerson({ name: 'Other Officer', unitId: S.nationalUnitId(), email: 'other@example.org', access: 'officer' });
  signIn();
  const k1 = S.acknowledge(urgent.id);
  const k2 = S.acknowledge(urgent.id);
  check('acknowledging records it', !!k1 && S.hasAcked(urgent.id, 'prof-1'));
  check('pressing it twice is still one', k2 === null && S.acks(urgent.id).length === 1);
  check('its id comes from the pair, so two phones agree', k1.id === U.hashUuid(urgent.id + '|prof-1'));
  const st = S.ackStatus(urgent.id);
  check('the roll counts people with a sign-in', st.total === 2, st.total + ' on the roll');
  check('and knows who has read it', st.done.length === 1 && st.done[0].person.name === 'Signed In Officer');
  check('and who has not', st.waiting.length === 1 && st.waiting[0].person.name === 'Other Officer');

  S.deleteAnnouncement(urgent.id);
  check('deleting an announcement drops its acknowledgements', S.acks(urgent.id).length === 0);
  check('and leaves a tombstone for the other devices',
    !!(saved().deleted && saved().deleted.announcement && saved().deleted.announcement[urgent.id]));
  signOut();
}

/* ---------------- templates ---------------- */
console.log('\n--- event templates ---');
{
  const NAT = S.nationalUnitId();
  const src = S.events({ unitId: NAT }).find((e) => S.tasks({ eventId: e.id }).length >= 3 && e.dateStart);
  const t = S.templateFromEvent(src.id, { name: 'Our seminar' });
  const srcTasks = S.tasks({ eventId: src.id });
  check('a template can be made from an activity', !!t && t.name === 'Our seminar');
  check('with every one of its tasks', t.tasks.length === srcTasks.length, t.tasks.length + ' tasks');
  const withDue = srcTasks.find((x) => x.dueDate);
  const tt = t.tasks.find((x) => x.title === withDue.title);
  check('each at the same distance from the day',
    tt && tt.offsetDays === U.daysBetween(src.dateStart, withDue.dueDate), tt && String(tt.offsetDays));
  check('no names come with it', t.tasks.every((x) => !('assigneeId' in x) || !x.assigneeId));
  check('it is offered to its own unit', S.templates({ usableBy: NAT }).some((x) => x.id === t.id));
  const other = S.units({ governed: true }).find((u) => u.id !== NAT);
  check('and not to another unit while it is not shared',
    !S.templates({ usableBy: other.id }).some((x) => x.id === t.id));
  S.updateTemplate(t.id, { shared: true });
  check('sharing it offers it to every unit', S.templates({ usableBy: other.id }).some((x) => x.id === t.id));
  const renamed = S.updateTemplate(t.id, { name: 'Leadership seminar' });
  check('renaming is written in its history', renamed.history.some((h) => /renamed/.test(h.text)));
  S.updateTemplate(t.id, { archived: true });
  check('an archived template leaves the picker', !S.templates().some((x) => x.id === t.id));
  check('but is still there to bring back', S.templates({ includeArchived: true }).some((x) => x.id === t.id));

  signIn({ canEditTemplate: () => false });
  check('a unit cannot change a template it does not own',
    /another unit/.test(throws(() => S.updateTemplate(t.id, { name: 'Mine now' }))));
  signOut();

  S.deleteTemplate(t.id);
  check('deleting a template removes it', !S.template(t.id));
  check('and tombstones it', !!(saved().deleted.template && saved().deleted.template[t.id]));

  const made = S.createEventWithTasks({ title: 'From a template', dateStart: U.addDays(U.today(), 30), unitId: NAT },
    [{ title: 'Reserve the venue', dueDate: U.addDays(U.today(), 16), priority: 'High' },
     { title: 'Documentation', dueDate: U.addDays(U.today(), 30), priority: 'Medium' }]);
  check('an event and its chosen tasks are made together',
    made.event && made.tasks.length === 2 && S.tasks({ eventId: made.event.id }).length === 2);
  check('the tasks start unassigned and not started',
    made.tasks.every((x) => !x.assigneeId && x.status === 'Not Started'));
}

/* ---------------- duplicating an activity ---------------- */
console.log('\n--- duplicate event ---');
{
  const NAT = S.nationalUnitId();
  const src = S.events({ unitId: NAT }).find((e) =>
    e.dateStart && S.tasks({ eventId: e.id }).some((t) => t.status === 'Done'));
  const srcTasks = S.tasks({ eventId: src.id });
  const newStart = U.addDays(src.dateStart, 364);
  const out = S.duplicateEvent(src.id, { title: src.title + ' (next year)', dateStart: newStart, includeTasks: true });
  const ne = out.event || out;
  const nt = S.tasks({ eventId: ne.id });
  check('the copy is a new record', ne.id !== src.id && ne.title === src.title + ' (next year)');
  check('on the new date', ne.dateStart === newStart);
  check('with the same tasks', nt.length === srcTasks.length, nt.length + ' of ' + srcTasks.length);
  check('every one of them Not Started', nt.every((t) => t.status === 'Not Started'));
  check('with no completion dates', nt.every((t) => !t.completedAt));
  const withDue = srcTasks.find((t) => t.dueDate);
  const moved = nt.find((t) => t.title === withDue.title);
  check('due dates move with the event', moved && moved.dueDate === U.addDays(withDue.dueDate, 364),
    moved && moved.dueDate);
  check('no report comes with it', !S.report(ne.id));
  check('no feedback link comes with it', !ne.feedbackLink);
  check('its history says where it came from', (ne.history || []).some((h) => /copy of/.test(h.text)));
  check('the original is untouched', S.tasks({ eventId: src.id }).length === srcTasks.length &&
    S.tasks({ eventId: src.id }).some((t) => t.status === 'Done'));

  const bare = S.duplicateEvent(src.id, { title: 'Info only', dateStart: newStart, includeTasks: false });
  check('information only brings no tasks', S.tasks({ eventId: (bare.event || bare).id }).length === 0);
  check('a title is required', /title/.test(throws(() => S.duplicateEvent(src.id, { title: '', dateStart: newStart }))));
}

/* ---------------- history ---------------- */
console.log('\n--- activity history ---');
{
  const NAT = S.nationalUnitId();
  const e = S.events({ unitId: NAT }).find((x) => S.tasks({ eventId: x.id }).length && !S.isLocked('event', x));
  const t = S.tasks({ eventId: e.id })[0];
  S.updateTask(t.id, { status: t.status === 'Done' ? 'In Progress' : 'Done' });
  S.updateEvent(e.id, { venue: 'A new venue for the history check' });
  const rows = S.historyFor('event', e.id);
  check('an activity’s history includes its own changes', rows.some((r) => !r.where && /venue|edited|changed/i.test(r.text)),
    rows.slice(0, 3).map((r) => r.text).join(' | '));
  check('and the changes to its tasks', rows.length >= 2);
  check('newest first', rows.every((r, i) => !i || rows[i - 1].at >= r.at));
}

/* ---------------- academic years ---------------- */
console.log('\n--- academic years and the archive ---');
{
  const before = S.currentYear();
  check('there is always a current year', before.id === 'current' && !!before.start && !!before.end, before.label);
  check('it is listed first', S.years()[0].id === 'current');

  const end = U.addDays(U.today(), -2);
  const oldEvent = S.events({ kind: 'any' }).find((e) => e.dateStart && e.dateStart <= end);
  const newEvent = S.events({ kind: 'any' }).find((e) => e.dateStart && e.dateStart > end);

  signIn({ canManageYears: () => false });
  check('only the President closes a year', /Only the President/.test(throws(() => S.archiveYear({ end }))));
  signOut();

  check('a year cannot be closed before its last day',
    /on or after/.test(throws(() => S.archiveYear({ end: U.addDays(U.today(), 5) }))));
  const counted = S.yearCounts('current').events;
  const y = S.archiveYear({ end });
  check('closing a year records it', S.years().length === 2 && S.years()[1].id === y.id);
  check('nothing is deleted', S.yearCounts('current').events + S.yearCounts(y.id).events === counted,
    S.yearCounts(y.id).events + ' archived + ' + S.yearCounts('current').events + ' current');
  check('the new year starts the day after', S.currentYear().start === U.addDays(end, 1));
  check('a record from that year is now read-only', S.isLocked('event', oldEvent), oldEvent.title);
  check('a record from this year is not', !S.isLocked('event', newEvent), newEvent && newEvent.title);
  check('changing an archived record is refused',
    /archived and read-only/.test(throws(() => S.updateEvent(oldEvent.id, { venue: 'Changed' }))));
  const oldTask = S.tasks({ eventId: oldEvent.id })[0];
  if (oldTask) {
    check('its tasks too', /archived and read-only/.test(throws(() => S.updateTask(oldTask.id, { title: 'Changed' }))));
  }

  S.unlockYear(y.id, 10);
  check('reopened for corrections, it can be changed', !throws(() => S.updateEvent(oldEvent.id, { venue: 'Corrected' })));
  S.lockYear(y.id);
  check('and closed again, it cannot', !!throws(() => S.updateEvent(oldEvent.id, { venue: 'Again' })));

  const y2 = S.archiveYear({ end: U.addDays(U.today(), -1) });
  check('only the latest archived year can be returned to current',
    /most recently/.test(throws(() => S.restoreYear(y.id))));
  S.restoreYear(y2.id);
  S.restoreYear(y.id);
  check('returning the years makes everything current again',
    S.years().length === 1 && !S.isLocked('event', oldEvent));

  // The years travel with the council record, so every device agrees.
  S.setYearStartMonth(8);
  check('the start month can be changed', S.yearStartMonth() === 8);
  S.setYearStartMonth(6);
}

/* ---------------- the term report ---------------- */
console.log('\n--- term report ---');
{
  const T = sb.TermReport;
  const m = T.model('current');
  check('the report counts the year’s activities', m.summary.some((r) => r[0] === 'Activities' && r[1] === 'Total' && r[2] > 0));
  check('it has one row per unit', m.units.length >= 2, m.units.length + ' units');
  const c = T.csv('current');
  check('the CSV opens with the year', c.text.indexOf('FCUSR Term Report') >= 0 && /AY \d{4}/.test(c.text));
  check('it has a byte-order mark for Excel', c.text.charCodeAt(0) === 0xFEFF);
  const names = S.people().map((p) => p.name).filter((n) => n.length > 6);
  const named = names.filter((n) => c.text.indexOf(n) >= 0);
  check('it names no officer', named.length === 0, named.join(', '));
  check('and ranks nobody', !/rank|leaderboard|top performer/i.test(c.text));
  check('a formula-looking cell is defused',
    !/(^|,)=/.test(c.text.split('\r\n').slice(1).join('\n')));
  const NAT = S.nationalUnitId();
  const one = T.model('current', NAT);
  check('it can cover a single unit', one.units.length === 1 && one.units[0].unit.id === NAT);
}

/* ---------------- data saved by the previous version ----------------
   A phone that last ran v107 holds none of the new collections. It has to open
   with everything it had, and simply nothing on the Bulletin Board. */
console.log('\n--- data from before this update ---');
{
  const before = JSON.parse(S.toJSON());
  const d = before.data;
  ['announcements', 'acks', 'templates', 'years', 'yearStartMonth'].forEach((k) => { delete d[k]; });
  if (d.council) { delete d.council.years; delete d.council.yearStartMonth; }
  (d.events || []).forEach((e) => { delete e.history; });
  (d.tasks || []).forEach((t) => { delete t.history; });
  const events = d.events.length, tasks = d.tasks.length;
  const err = throws(() => S.fromJSON(JSON.stringify(before)));
  check('it loads without complaint', !err, err);
  check('every activity and task is still there', S.events({ kind: 'any' }).length === events &&
    S.tasks().length === tasks, S.events({ kind: 'any' }).length + '/' + events);
  check('the new collections start empty', S.announcements().length === 0 && S.templates().length === 0);
  check('there is one year, the current one', S.years().length === 1 && S.years()[0].id === 'current');
  check('nothing is read-only', S.events({ kind: 'any' }).every((e) => !S.isLocked('event', e)));
  const e = S.events()[0];
  check('and a record with no history can still be edited', !throws(() => S.updateEvent(e.id, { venue: 'After the update' })));
  check('which starts its history', (S.event(e.id).history || []).length >= 1);
}

/* ---------------- the Watermark Studio ---------------- */
console.log('\n--- watermark arithmetic ---');
{
  const W = sb.WatermarkStudio;
  check('mm to px at 300 dpi', Math.round(W._toPx(25.4, 'mm', 4000, 300)) === 300);
  check('cm to px at 300 dpi', Math.round(W._toPx(2.54, 'cm', 4000, 300)) === 300);
  check('in to px at 300 dpi', W._toPx(1, 'in', 4000, 300) === 300);
  check('% of the photo', W._toPx(10, '%', 4000, 300) === 400);
  check('and back again', Math.round(W._fromPx(400, '%', 4000, 300)) === 10 &&
    Math.round(W._fromPx(300, 'mm', 4000, 300) * 10) / 10 === 25.4);

  const wm = { naturalWidth: 200, naturalHeight: 100, width: 200, height: 100 };
  const st = Object.assign(W._defaults(), { position: 'br', width: 10, unit: '%', margin: 20, marginUnit: 'px' });
  const L = W._layout(st, 4000, 3000, wm);
  check('10% of a 4000px photo is 400px wide', Math.round(L.w) === 400);
  check('the height keeps the logo’s shape', Math.round(L.h) === 200);
  check('bottom right sits inside the margin', Math.round(L.cx + L.w / 2) === 3980 && Math.round(L.cy + L.h / 2) === 2980);
  const tl = W._layout(Object.assign({}, st, { position: 'tl' }), 4000, 3000, wm);
  check('top left mirrors it', Math.round(tl.cx - tl.w / 2) === 20 && Math.round(tl.cy - tl.h / 2) === 20);
  const cu = W._layout(Object.assign({}, st, { position: 'custom', x: 0.25, y: 0.5 }), 4000, 3000, wm);
  check('a dragged position is kept as a share of the photo', cu.cx === 1000 && cu.cy === 1500);
  const free = W._layout(Object.assign({}, st, { keepAspect: false, height: 20 }), 4000, 3000, wm);
  check('a set height is honoured when the shape is unlocked', Math.round(free.h) === 600);

  check('a photo keeps its size by default', JSON.stringify(W._outSize({ w: 4000, h: 3000 }, W._defaults())) ===
    JSON.stringify({ w: 4000, h: 3000 }));
  check('a longest side shrinks it in proportion',
    JSON.stringify(W._outSize({ w: 4000, h: 3000 }, Object.assign(W._defaults(), { maxSide: 2000 }))) ===
    JSON.stringify({ w: 2000, h: 1500 }));
  check('a smaller photo is never enlarged',
    W._outSize({ w: 800, h: 600 }, Object.assign(W._defaults(), { maxSide: 2000 })).w === 800);

  check('prefix and suffix name the file',
    W._outName({ name: 'IMG_0001.jpg', type: 'image/jpeg' }, Object.assign(W._defaults(), { prefix: 'GA-', suffix: '_FCUSR' })) ===
    'GA-IMG_0001_FCUSR.jpg');
  check('characters a file name cannot hold are dropped',
    W._outName({ name: 'a.png', type: 'image/png' }, Object.assign(W._defaults(), { prefix: 'x/y:', suffix: '' })) === 'xya.png');
  const names = W._uniqueNames([{ name: 'a.jpg' }, { name: 'a.jpg' }, { name: 'A.jpg' }]).map((x) => x.name);
  check('two photos with one name do not overwrite each other in the ZIP',
    names.join('|') === 'a.jpg|a (2).jpg|A (3).jpg', names.join('|'));

  const st2 = Object.assign(W._defaults(), { width: 400, unit: 'px' });
  W._switchUnit(st2, '%');
  check('switching units keeps the same size on the photo', st2.unit === '%' && st2.width === 10, st2.width + '%');

  const bytes = new Uint8Array(Buffer.from('The quick brown fox jumps over the lazy dog'));
  check('CRC-32 matches the standard value', W._crc32(bytes) === 0x414FA339, W._crc32(bytes).toString(16));
  check('and zlib agrees', W._crc32(bytes) === zlib.crc32(Buffer.from(bytes)));

  const files = [
    { name: 'one.txt', data: Buffer.from('first file') },
    { name: 'två.txt', data: Buffer.from('second file, with a longer body') }
  ];
  const zipBlob = W._buildZip(files.map((f) => ({
    name: f.name, blob: new Blob([f.data]), crc: W._crc32(new Uint8Array(f.data)), size: f.data.length
  })));
  zipBlob.arrayBuffer().then((ab) => {
    const z = Buffer.from(ab);
    const tmp = path.join(require('os').tmpdir(), 'fcusr-wm-test-' + process.pid + '.zip');
    fs.writeFileSync(tmp, z);
    let ok = false, list = '';
    try {
      const out = require('child_process').execSync('unzip -t "' + tmp + '"').toString();
      ok = /No errors detected/.test(out);
      list = require('child_process').execSync('unzip -Z1 "' + tmp + '"').toString().trim().split('\n').join(', ');
    } catch (e) { list = String(e.message).slice(0, 200); }
    fs.unlinkSync(tmp);
    check('the ZIP is valid and passes its CRC checks', ok, list);
    check('with both files, accents intact', list === 'one.txt, två.txt', list);
    finish();
  }).catch((e) => { check('the ZIP could be read back', false, e.message); finish(); });
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log('\n========================================');
  console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed');
  if (failed.length) {
    failed.forEach((f) => console.log('  FAILED: ' + f.name + (f.extra ? '  — ' + f.extra : '')));
    process.exit(1);
  }
}
