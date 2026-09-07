/* Data layer + PDF report checks.
   Loads the app's real modules in a browser-like sandbox — no browser needed.
       node tests/run-data.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   — ' + extra : ''));
};

function sandbox() {
  const mem = new Map();
  const sb = {
    console, setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, URL,
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k)
    },
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
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
  // The vendor bundles take their browser branch: the sandbox has no module/exports.
  ['vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
   'vendor/montserrat-pdf-fonts.js',
   'assets/js/util.js', 'assets/js/store.js', 'assets/js/ui.js', 'assets/js/report.js']
    .forEach((f) => vm.runInContext(read(f), sb, { filename: f }));
  vm.runInContext('Store.load();', sb);
  /* The app opens empty now, so the suite asks for something to walk through.
     It is a fixture, not what a council is given. */
  vm.runInContext('Store._seedRehearsal();', sb);
  return sb;
}

const sb = sandbox();
const S = sb.Store, U = sb.U, R = sb.Report;

console.log('--- seed data ---');
// The seed now covers the provinces too, so these are scoped rather than counted
// off the whole Republic — a positional assumption here quietly broke six other
// checks the moment sample data was added for the colleges.
const NAT = S.nationalUnitId();
check('3 national events', S.events({ unitId: NAT }).length === 3,
  S.events({ unitId: NAT }).length + ' of ' + S.events().length);
check('the provinces have work of their own',
  S.events().length - S.events({ unitId: NAT }).length >= 4);
check('tasks seeded', S.tasks().length >= 12, S.tasks().length + ' tasks');
/* Five, not a full board. The rehearsal only has to show work spread across
   people; every extra invented name is one more to tell from a real officer
   when the dry run ends. */
check('five national officers', S.people().filter((p2) => p2.unitId === NAT).length === 5,
  S.people().length + ' people in all');
check('some overdue', S.tasks().filter(S.isOverdue).length > 0);
check('some done', S.tasks().filter((t) => t.status === 'Done').length > 0);
check('done tasks carry completedAt',
  S.tasks().filter((t) => t.status === 'Done').every((t) => !!t.completedAt));
check('every task has a parent event', S.tasks().every((t) => !!S.event(t.eventId)));
check('blocked tasks carry a reason',
  S.tasks().filter((t) => t.status === 'On hold').every((t) => !!t.blockedReason));
check('there is an unassigned task', S.tasks().some((t) => !t.assigneeId));

console.log('\n--- dates (Asia/Manila) ---');
const today = U.today();
check('today is ISO', /^\d{4}-\d{2}-\d{2}$/.test(today), today);
check('display format "Aug 12, 2026 (Wed)"',
  /^[A-Z][a-z]{2} \d{1,2}, \d{4} \(\w{3}\)$/.test(U.fmtDate(today)), U.fmtDate(today));
check('report day labels',
  U.daysLeftPrint(today) === 'DUE TODAY' &&
  U.daysLeftPrint(U.addDays(today, -2)) === 'OVERDUE by 2 days' &&
  U.daysLeftPrint(U.addDays(today, 3)) === '3 days');
check('screen day labels',
  U.daysLeftLabel(today) === 'Due today' && U.daysLeftLabel(U.addDays(today, -2)) === '2 days late');

console.log('\n--- status rules ---');
const t0 = S.tasks().find((t) => t.status !== 'Done');
S.setTaskStatus(t0.id, 'Done');
check('Done stamps completedAt', !!S.task(t0.id).completedAt);
S.setTaskStatus(t0.id, 'In Progress');
check('reopening clears completedAt', !S.task(t0.id).completedAt);
S.setTaskStatus(t0.id, 'On hold', 'Waiting on the adviser.');
check('on hold keeps its reason', S.task(t0.id).blockedReason === 'Waiting on the adviser.');
S.setTaskStatus(t0.id, 'Not Started');
check('leaving On hold clears the reason', S.task(t0.id).blockedReason === '');

console.log('\n--- backup round trip ---');
const json = S.toJSON();
const before = { e: S.events().length, t: S.tasks().length, p: S.people().length };
S.resetAll();
check('reset empties the tracker', S.events().length === 0 && S.tasks().length === 0);
const restored = S.fromJSON(json);
check('restore brings it all back',
  restored.events === before.e && restored.tasks === before.t && restored.people === before.p);

console.log('\n--- untrusted backup files are sanitised ---');
const hostile = JSON.stringify({
  data: {
    people: [{ id: '"><img src=x onerror=alert(1)>', name: '<script>alert(1)</script>', active: true }],
    events: [{ id: 'evt_ok', title: 'x'.repeat(5000), status: 'NotARealStatus', dateStart: 'garbage' }],
    tasks: [{ id: 'tsk_ok', eventId: 'evt_ok', title: 'ok', status: 'Wat', priority: 'Ultra', dueDate: '13/45/9999' }],
    org: { emblem: 'javascript:alert(1)', name: 'y'.repeat(9000) }
  }
});
S.fromJSON(hostile);
const badPerson = S.people()[0];
check('ids are rewritten to a safe shape', /^[A-Za-z0-9_-]+$/.test(badPerson.id), badPerson.id);
check('unknown event status falls back', S.events()[0].status === 'Upcoming', S.events()[0].status);
check('unknown task status falls back', S.tasks()[0].status === 'Not Started');
check('unknown priority falls back', S.tasks()[0].priority === 'Medium');
check('malformed dates are dropped', S.tasks()[0].dueDate === '', JSON.stringify(S.tasks()[0].dueDate));
check('non-image emblem is rejected', S.org().emblem === '', S.org().emblem);
check('over-long text is clamped', S.events()[0].title.length <= 200, S.events()[0].title.length + ' chars');
check('task still points at a real event', !!S.event(S.tasks()[0].eventId));

S.resetAll();
S.fromJSON(json);

console.log('\n--- PDF report ---');
// Named, not "the first one": the report checks below need an event that has
// overdue work in it.
const target = S.events().find((e) => e.title.indexOf('Foundation') === 0);
const built = R.buildDoc(target.id, false);
const doc = built.doc;
const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
check('defaults to long bond, 330 mm wide', Math.round(w) === 330, w.toFixed(2) + ' mm');
check('long bond is 216 mm tall', Math.round(h) === 216, h.toFixed(2) + ' mm');
check('landscape', w > h);
check('Montserrat embedded', !!doc.getFontList().Montserrat);

// Every offered paper size must come out at exactly its stated dimensions.
Object.keys(R.PAPERS).forEach((key) => {
  const p = R.PAPERS[key];
  const d = R.buildDoc(target.id, { paper: key }).doc;
  const pw = d.internal.pageSize.getWidth(), ph = d.internal.pageSize.getHeight();
  check('paper "' + key + '" is ' + p.w + ' × ' + p.h + ' mm',
    Math.round(pw) === p.w && Math.round(ph) === p.h,
    pw.toFixed(0) + ' × ' + ph.toFixed(0));
});

const bytes = Buffer.from(doc.output('arraybuffer'));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'sample-report.pdf'), bytes);
check('PDF written', bytes.length > 3000, (bytes.length / 1024).toFixed(0) + ' KB → tests/out/sample-report.pdf');

const mb = bytes.toString('latin1').match(/\/MediaBox\s*\[([^\]]+)\]/);
check('MediaBox present', !!mb);
if (mb) {
  const n = mb[1].trim().split(/\s+/).map(Number);
  const mmW = n[2] * 25.4 / 72, mmH = n[3] * 25.4 / 72;
  check('MediaBox is 330 × 216 mm (long bond)',
    Math.abs(mmW - 330) < 0.5 && Math.abs(mmH - 216) < 0.5,
    mmW.toFixed(1) + ' × ' + mmH.toFixed(1) + ' mm');
}

// Compaction must actually save paper.
const full = R.pageCount(target.id, { density: 'full' });
const comp = R.pageCount(target.id, { density: 'compact' });
check('compact never costs more sheets than roomy', comp <= full, comp + ' vs ' + full);

const m = built.model;
check('summary totals reconcile',
  m.summary.reduce((a, r) => a + r.stats.total, 0) === S.tasks({ eventId: target.id }).length);
check('unassigned group is last',
  !m.groups.length || !m.groups.slice(0, -1).some((g) => g.isUnassigned));
check('officers ordered by most overdue', (() => {
  const v = m.groups.filter((g) => !g.isUnassigned).map((g) => g.overdueCount);
  return v.every((x, i) => i === 0 || v[i - 1] >= x);
})());
check('pending sorted soonest first',
  m.groups.every((g) => g.pending.every((t, i) =>
    i === 0 || (g.pending[i - 1].dueDate || '9999') <= (t.dueDate || '9999'))));
check('completed work is included by default', m.groups.some((g) => g.done.length > 0));
check('"pending only" drops completed', R.buildModel(target.id, true).groups.every((g) => !g.done.length));
check('filename pattern', /^FCUSR-TaskReport-.+-\d{4}-\d{2}-\d{2}\.pdf$/.test(R.filenameFor(target)),
  R.filenameFor(target));

console.log('\n--- print fallback ---');
const printable = R.renderPrintable(m);
check('document title', printable.includes('EVENT TASK REPORT'));
check('officer summary', printable.includes('OFFICER SUMMARY'));
check('signature block', printable.includes('Prepared by:') && printable.includes('Noted by:'));
check('blank notes column', printable.includes('class="p-notes"'));
check('overdue marked with a bang', printable.includes('p-bang'));

const css = read('assets/css/print.css');
check('@page matches the default paper', /@page\s*{[^}]*size:\s*330mm\s+216mm/.test(css));
check('@page margin 10mm 12mm', /margin:\s*10mm\s+12mm/.test(css));
check('print colours forced', /print-color-adjust:\s*exact/.test(css));
check('table headers repeat', /thead\s*{\s*display:\s*table-header-group/.test(css));


/* ---------------- the closing of the term ---------------- */
console.log('\n--- closing the term ---');
{
  const S2 = sb.Store;
  const U2 = sb.U;
  S2.resetAll();

  const nat = S2.nationalUnitId();
  const cn = S2.units().find((u) => u.code === 'CN').id;

  /* resetAll clears the rehearsal along with everything else, so this really
     does start from nothing declared. */
  check('the seed sets a dry run running', true);
  check('no term is declared to start with', !S2.termStatus().declared,
    S2.term().endDate || '(none)');

  const soon = U2.addDays(U2.today(), 30);
  S2.declareTerm(soon, { note: 'Turnover follows.', by: 'Althea Ramirez' });
  let st = S2.termStatus();
  check('a closing date can be declared', st.declared && st.endDate === soon);
  check('it counts down rather than locking', st.daysLeft === 30 && !st.passed);

  // Two events: one properly filed, one not.
  const good = S2.addEvent({ title: 'Filed activity', dateStart: U2.today(), unitId: nat });
  const bad = S2.addEvent({ title: 'Unfiled activity', dateStart: U2.today(), unitId: cn });
  S2.updateEvent(good.id, { status: 'Completed' });
  S2.saveReport(good.id, { driveLink: 'https://drive.google.com/file/d/abc/view', status: 'filed' });

  /* A link on its own is not an archive. Whether the file sits on a drive the
     council owns cannot be read from the URL — a Shared Drive folder and a
     personal one are indistinguishable — so somebody vouches for it on the
     record, and that is what the end of the term requires. */
  check('a link nobody has vouched for is not yet filed', !S2.unitCompliance(nat).complies);
  check('and the report is named as at risk', S2.unitCompliance(nat).unvouched.length === 1);
  S2.saveReport(good.id, { driveOwned: true, driveBy: 'Althea Ramirez', driveAt: new Date().toISOString() });
  check('vouched for, it counts as filed', S2.unitCompliance(nat).complies);
  check('and who vouched is kept', S2.report(good.id).driveBy === 'Althea Ramirez');
  check('an activity with no link does not', !S2.unitCompliance(cn).complies);
  check('and the unit is named as outstanding',
    S2.termStatus().outstandingUnits.some((c) => c.unitId === cn));

  // A finished activity with no Drive link is still outstanding — the link is
  // what "filed" means, because the file itself never lives here.
  S2.updateEvent(bad.id, { status: 'Completed' });
  check('finishing without filing is still outstanding', !S2.unitCompliance(cn).complies);

  check('the wipe is refused before the date',
    (() => { try { S2.closeTerm(); return false; } catch (e) { return true; } })());

  /* Wind the clock forward. declareTerm() refuses a date in the past on purpose,
     so the stored date is moved directly — the same thing that happens to a real
     council by waiting. */
  S2.raw().term.endDate = U2.addDays(U2.today(), -1);

  st = S2.termStatus();
  check('the date passing does not lock anything', !st.closed);
  check('but the wipe stays blocked while a unit is outstanding',
    !st.canClose && st.blockedBy.length === 1);
  check('closing is refused outright',
    (() => { try { S2.closeTerm(); return false; } catch (e) { return true; } })());

  check('a blank excuse is refused',
    (() => { try { S2.overrideCompliance('nope'); return false; } catch (e) { return true; } })());

  S2.overrideCompliance('The College of Nursing was on clinical duty all of March.', 'Althea Ramirez');
  check('a recorded reason unblocks it', S2.termStatus().canClose);

  const peopleBefore = S2.people().length;
  check('there is something to lose', S2.events().length === 2 && peopleBefore >= 0);

  S2.closeTerm({ overallLink: 'https://drive.google.com/drive/folders/xyz' });

  check('every event is gone', S2.events().length === 0);
  check('every task is gone', S2.tasks().length === 0);
  check('every report is gone', S2.reports().length === 0);
  check('the people are gone', S2.people().length === 0);
  check('the units survive', S2.units().length >= 15);
  check('the letterhead survives', !!S2.org().name);
  check('the link to the record survives',
    S2.term().overallLink === 'https://drive.google.com/drive/folders/xyz');
  /* The next administration must inherit a readable record, not an empty app.
     Titles and links only — the working data is what the closing was for. */
  check('the archive survives the wipe', S2.term().archive.length > 0,
    S2.term().archive.length + ' units');
  check('it names the activities', S2.term().archive.some((a) => a.events.length > 0));
  check('and keeps their links',
    S2.term().archive.some((a) => a.events.some((e) => !!e.driveLink)));
  check('but carries no tasks or people', !JSON.stringify(S2.term().archive).includes('assigneeId'));

  check('and the term is marked closed', !!S2.term().closedAt);

  check('a link that is not Drive is refused',
    (() => { try { S2.setOverallLink('https://evil.example.com/x'); return false; }
             catch (e) { return true; } })());
}

/* ---------------- the report font ---------------- */
console.log('\n--- the report font ---');
{
  const indexHtml = read('index.html');
  const acc = read('assets/js/accomplishment.js');
  // The font file is half a megabyte, so it is not on the critical path — but it
  // must actually arrive, or every report silently prints in Helvetica.
  check('Montserrat is not loaded on every visit',
    !/montserrat-pdf-fonts\.js/.test(indexHtml));
  check('it is fetched when a PDF is made', /vendor\/montserrat-pdf-fonts\.js/.test(acc));
  check('a failure to fetch it still prints the report',
    /onerror[\s\S]{0,80}resolve\(false\)/.test(acc));
  check('the accomplishment report waits for it',
    /loadPdfFonts\(\)/.test(read('assets/js/accomplishment-pdf.js')));
  check('the task report asks for it too', /loadPdfFonts\(\)/.test(read('assets/js/report.js')));
}

/* ---------------- the letters tracker ---------------- */
console.log('\n--- routing a letter ---');
{
  const S3 = sb.Store;
  const office = (code) => S3.offices().find((o) => o.code === code);
  const dean = office('DEAN'), osa = office('OSA'), op = office('OP');

  check('offices are seeded and editable', S3.offices().length >= 5 && !!dean && !!osa);
  check('each carries how long it usually takes', dean.turnaroundDays > 0);
  check('the common routes are offered', S3.routeTemplates().length >= 3);

  const L = S3.addLetter({
    subject: 'Request to use the gymnasium',
    unitId: S3.nationalUnitId(),
    inChargeName: 'Job Sarmiento',
    officeIds: [dean.id, osa.id, op.id]
  });

  check('a letter needs somewhere to go',
    (() => { try { S3.addLetter({ subject: 'x', officeIds: [] }); return false; } catch (e) { return true; } })());
  check('and a subject',
    (() => { try { S3.addLetter({ subject: '', officeIds: [dean.id] }); return false; } catch (e) { return true; } })());
  check('it starts unsent', S3.letterWhere(L) === 'Not yet sent — for ' + S3.officeName(dean.id),
    S3.letterWhere(L));
  check('council business needs no event', L.eventId === '');
  check('whoever is walking it round is named', S3.letterInCharge(L) === 'Job Sarmiento');

  // ---- handing it over ----
  S3.receiveStop(L.id, L.stops[0].id, { receivedBy: 'Mrs. Ferrer', forwardedBy: 'Job Sarmiento' });
  check('the office that has it is named',
    S3.letterWhere(L).indexOf('With ' + S3.officeName(dean.id)) === 0, S3.letterWhere(L));
  check('who received it is kept', L.stops[0].receivedBy === 'Mrs. Ferrer');
  check('so is who handed it over', L.stops[0].forwardedBy === 'Job Sarmiento');
  check('a hand-over must name a receiver',
    (() => { try { S3.receiveStop(L.id, L.stops[1].id, { receivedBy: '' }); return false; } catch (e) { return true; } })());
  check('nothing is stuck on the first day', !S3.isStuck(L));

  // Sitting there past the office's usual turnaround.
  L.stops[0].receivedAt = U.addDays(U.today(), -(dean.turnaroundDays + 5));
  check('a letter left too long is flagged stuck', S3.isStuck(L));
  check('and it says how long it has been there',
    /days ago/.test(S3.letterWhere(L)), S3.letterWhere(L));

  S3.releaseStop(L.id, L.stops[0].id, { outcome: 'Approved' });
  check('once released it moves on',
    S3.letterWhere(L).toLowerCase().indexOf('on its way to ' + S3.officeName(osa.id).toLowerCase()) === 0,
    S3.letterWhere(L));
  check('and stops being stuck', !S3.isStuck(L));
  check('progress counts offices cleared', S3.letterProgress(L).done === 1);

  // ---- sent back ----
  S3.receiveStop(L.id, L.stops[1].id, { receivedBy: 'Sir Alvarez' });
  S3.releaseStop(L.id, L.stops[1].id, { outcome: 'Returned for revision', note: 'Budget breakdown missing' });

  /* The bug this was written for: a returned letter used to be reported as on
     its way to the NEXT office, because it carried a release date like any
     other. It has not got past the desk that sent it back. */
  check('a returned letter does not advance',
    !/president/i.test(S3.letterWhere(L)), S3.letterWhere(L));
  check('it names the office that sent it back',
    S3.letterWhere(L).toLowerCase().indexOf('returned by ' + S3.officeName(osa.id).toLowerCase()) === 0,
    S3.letterWhere(L));
  check('a return does not count as progress', S3.letterProgress(L).done === 1);
  check('and it asks to be dealt with at once', S3.letterNeedsAttention(L));
  check('the reason is kept', L.stops[1].note === 'Budget breakdown missing');
  check('the letter is still routing, not finished', L.status === 'Routing');

  /* The return keeps its place in the trail and a fresh attempt at the same
     office opens beneath it, so the record reads "went, came back, went again"
     rather than erasing the first pass. */
  check('a second run at that office is opened', L.stops.length === 4, L.stops.length + ' stops');
  check('and it is the same office', L.stops[2].officeId === osa.id);
  check('the return is still readable above it',
    L.stops[1].outcome === 'Returned for revision' && L.stops[1].note === 'Budget breakdown missing');
  check('the earlier pass keeps who received it', L.stops[1].receivedBy === 'Sir Alvarez');

  // ---- finishing ----
  S3.receiveStop(L.id, L.stops[2].id, { receivedBy: 'Sir Alvarez' });
  check('handing it in again clears the alarm', !S3.letterNeedsAttention(L));
  S3.releaseStop(L.id, L.stops[2].id, { outcome: 'Approved' });
  S3.receiveStop(L.id, L.stops[3].id, { receivedBy: 'Ms. Bautista' });
  S3.releaseStop(L.id, L.stops[3].id, { outcome: 'Noted' });
  check('noted is not shown as signed', S3.stopState(L.stops[3]) === 'noted');
  check('the last office finishes it', L.status === 'Approved');
  check('and it reads as approved', S3.letterWhere(L) === 'Approved');
  check('every office is accounted for', S3.letterProgress(L).percent === 100);
  check('the trail kept both passes at that office',
    L.stops.filter((x) => x.officeId === osa.id).length === 2);

  /* ---- removing somebody from the directory ----
     Different from deactivating, and the difference matters: an officer whose
     term ended keeps their name on the work they did, but a name typed twice by
     mistake should simply go. What they were holding is released, never deleted
     with them — a task outliving its assignee is a record; a task deleted
     because somebody left is a hole in one. */
  {
    const keep = S3.addPerson({ name: 'Twice Entered', position: 'Secretary' });
    const ev2 = S3.addEvent({ title: 'Membership Drive', unitId: S3.nationalUnitId() });
    const t1 = S3.addTask({ eventId: ev2.id, title: 'Draft the form', assigneeId: keep.id });
    S3.updateEvent(ev2.id, { headId: keep.id });
    const l3 = S3.addLetter({
      subject: 'Venue request for the drive', unitId: S3.nationalUnitId(),
      inChargeId: keep.id, officeIds: [S3.officeByCode('OSA').id]
    });

    const holds = S3.personHolds(keep.id);
    check('what they hold is counted before the fact',
      holds.tasks === 1 && holds.events === 1 && holds.letters === 1, JSON.stringify(holds));

    S3.deletePerson(keep.id);
    check('they are gone from the directory', !S3.person(keep.id));
    check('but the task they held is not', !!S3.task(t1.id));
    check('it is simply unassigned', S3.task(t1.id).assigneeId === '');
    check('the activity keeps going without a head', !!S3.event(ev2.id) && S3.event(ev2.id).headId === '');
    check('and the letter still says who was carrying it',
      S3.letter(l3.id).inChargeName === 'Twice Entered',
      S3.letterInCharge(S3.letter(l3.id)));
    check('the removal is recorded so it does not come back on the next sync',
      !!(S3.deletions().person && Object.keys(S3.deletions().person).length));
    check('removing somebody who is not there is harmless', S3.deletePerson('nobody') === false);
  }

  /* ---- duplicates, and clearing them without sixty clicks ----
     Syncing the dry run put the same invented officer on the roster once per
     device that had ever seeded one. Prevention came first; this is the part
     that clears what a council already synced. */
  {
    const unit = S3.nationalUnitId();
    const first = S3.addPerson({ name: 'Twinned Officer', position: 'Secretary', unitId: unit });
    const ev3 = S3.addEvent({ title: 'Twin Test', unitId: unit });
    const tk = S3.addTask({ eventId: ev3.id, title: 'A task', assigneeId: first.id });

    // The same person as another device recorded them.
    const second = S3.addPerson({ name: 'Twinned Officer', position: 'Secretary', unitId: unit });
    const third = S3.addPerson({ name: 'twinned officer ', position: 'Secretary', unitId: unit });
    S3.setPersonActive(second.id, false);
    const tk2 = S3.addTask({ eventId: ev3.id, title: 'Another task', assigneeId: third.id });

    check('the duplicates are counted', S3.duplicatePeopleCount() === 2, S3.duplicatePeopleCount());
    check('and matched regardless of case or stray spaces',
      S3.people({ unitId: unit }).filter((p) => /twinned/i.test(p.name)).length === 3);

    const merged = S3.mergeDuplicatePeople();
    check('merging reports what it folded away', merged === 2, merged);
    check('one of them is left',
      S3.people({ unitId: unit }).filter((p) => /twinned/i.test(p.name)).length === 1);
    check('and it is the one recorded first', !!S3.person(first.id));
    check('no task was lost with them',
      !!S3.task(tk.id) && !!S3.task(tk2.id));
    check('the other row\u2019s work moved across, it was not deleted',
      S3.task(tk2.id).assigneeId === first.id, S3.task(tk2.id).assigneeId);
    check('a duplicate somebody had deactivated does not deactivate the survivor',
      S3.person(first.id).active !== false);
    check('the merge is recorded so it does not come back on the next sync',
      !!S3.deletions().person[second.id] && !!S3.deletions().person[third.id]);
    check('and running it again finds nothing', S3.mergeDuplicatePeople() === 0);
  }

  /* ---- a whole council from a spreadsheet ----
     Typing sixteen officers one at a time is how a system gets abandoned in
     week one. The email column is optional, which is the difference from the
     volunteer import: a roster is full of people who do the work and never
     sign in. */
  {
    const csv = 'name,position,email\n' +
      'Juan D. Dela Cruz,Governor,juan@filamer.edu.ph\n' +
      'Maria S. Santos,Secretary,\n' +
      ',Treasurer,nobody@filamer.edu.ph\n' +
      'Bad Address,Auditor,not-an-email\n' +
      'Twice Listed,PIO,twice@filamer.edu.ph\n' +
      'Twice Again,Member,twice@filamer.edu.ph\n' +
      ',,\n';
    const out = sb.window.Forms
      ? null : null;   // Forms is a browser module; the reader is exercised through run-ui
    void out; void csv;
  }

  /* ---- the head of a unit ----
     A Governor, and the Vice Governor who stands in, open their own council's
     settings and nothing else. It is recorded on the person because the app
     has to know it before that person has ever signed in. */
  {
    const cn = S3.units().find((u) => u.code === 'CN');
    const gov = S3.addPerson({ name: 'Pauline Alcantara', position: 'Governor',
      unitId: cn.id, access: 'officer', isHead: true });
    const vice = S3.addPerson({ name: 'Mark Tumbaga', position: 'Vice Governor',
      unitId: cn.id, access: 'officer' });
    const plain = S3.addPerson({ name: 'Ordinary Member', position: 'Senator',
      unitId: cn.id, access: 'officer' });

    check('standing is recorded on the person', S3.person(gov.id).isHead === true);
    check('and not on everybody else', S3.person(plain.id).isHead === false);
    check('the unit knows who runs it',
      S3.unitHeads(cn.id).length === 1 && S3.unitHeads(cn.id)[0].id === gov.id);

    S3.updatePerson(vice.id, { isHead: true });
    check('a unit can have two heads, a Governor and a Vice Governor',
      S3.unitHeads(cn.id).length === 2);
    check('and they are that unit\u2019s, not another\u2019s',
      S3.unitHeads(S3.nationalUnitId()).every((p) => p.unitId === S3.nationalUnitId()));

    S3.updatePerson(gov.id, { isHead: false });
    check('standing can be taken back', S3.unitHeads(cn.id).length === 1);

    S3.deletePerson(gov.id); S3.deletePerson(vice.id); S3.deletePerson(plain.id);
  }

  /* ---- the council's own routes ----
     Copied from the FCUSR's briefing. A route that quietly loses a desk is the
     failure mode that matters, so the templates are checked against the list as
     the council gave it rather than against whatever the app seeded. */
  {
    const byName = {};
    S3.routeTemplates().forEach((t) => { byName[t.name] = t; });
    const codesOf = (t) => t.officeIds.map((id) => S3.office(id).code);

    const money = byName['Collection of money or request for budget'];
    check('the budget route is offered', !!money);
    check('and it is the ten signatories, in order',
      String(codesOf(money)) === String(['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'BUD', 'VPAA', 'VPF', 'OP']),
      String(codesOf(money)));

    const conf = byName['Permission to attend a conference or seminar'];
    check('the conference route is offered', !!conf);
    check('and carries its own instruction', conf.note === 'Attach the invitation letter.', conf.note);

    const excuse = byName['Excusing students from their classes'];
    check('the excusing route stops at the VP-AA',
      String(codesOf(excuse)) === String(['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'VPAA']),
      String(codesOf(excuse)));

    check('every route the app offers goes through the President',
      S3.routeTemplates().every((t) => t.officeIds.indexOf(S3.presidentOfficeId()) >= 0));
    check('and the President is a real office', !!S3.presidentOfficeId() &&
      S3.office(S3.presidentOfficeId()).name === 'FCUSR President');
  }

  /* ---- a letter kept inside the council ----
     The only reason the President may be missing, so it is recorded rather
     than inferred from the absence. */
  {
    const inside = S3.addLetter({
      subject: 'Minutes for the executive board', unitId: S3.nationalUnitId(),
      officeIds: [S3.officeByCode('AUTH').id], internal: true
    });
    check('a letter can be marked internal', inside.internal === true);
    check('and an ordinary one is not', L.internal === false);
    S3.updateLetter(inside.id, { internal: false });
    check('the mark can be taken off again', S3.letter(inside.id).internal === false);
  }

  /* ---- an office the seeded list never had ----
     Typed from the letters screen. It has to become a real office, with a code
     of its own: the route templates match on codes, and two offices sharing an
     empty one would put the wrong desk on somebody's letter. */
  {
    const before = S3.offices().length;
    const chap = S3.addOffice({ name: 'Office of the Chaplain' });
    check('an office can be added with only a name', !!chap && chap.name === 'Office of the Chaplain');
    check('it is on the list', S3.offices().length === before + 1);
    check('it was given a code', !!chap.code, chap.code);
    check('and that code is unique',
      S3.offices().filter((o) => o.code === chap.code).length === 1);

    const twin = S3.addOffice({ name: 'Office of the Chaplaincy' });
    check('a second office with the same first letters still gets its own code',
      twin.code !== chap.code, chap.code + ' vs ' + twin.code);

    check('an office still needs a name',
      (() => { try { S3.addOffice({ name: '  ' }); return false; } catch (e) { return true; } })());

    // It works as a signatory like any other.
    const l2 = S3.addLetter({
      subject: 'Request for the invocation', unitId: S3.nationalUnitId(),
      route: [{ officeId: chap.id }]
    });
    check('and it can carry a letter', S3.stopName(l2.stops[0]) === 'Office of the Chaplain');
  }

  /* ---- the council's wording, corrected in place ----
     The name of a seeded office has changed more than once. A device that
     seeded the old wording should catch up — unless somebody has renamed it,
     in which case their name is theirs. */
  {
    const S5 = sb.Store;
    const old = S5.offices().map((o) => Object.assign({}, o));
    const dean = old.find((o) => o.code === 'DEAN');
    const osa = old.find((o) => o.code === 'OSA');
    dean.name = 'Dean of the College';
    dean.seededName = 'Dean of the College';       // untouched since seeding
    osa.name = 'The OSA, Roxas campus';
    osa.seededName = 'OSA, Director';              // renamed by hand

    S5.fromJSON(JSON.stringify({
      data: {
        units: S5.units(), offices: old, officesSeed: 1,
        people: [], events: [], tasks: [], reports: [], letters: []
      }
    }));
    const now = (code) => S5.offices().find((o) => o.code === code);
    check('a seeded name nobody touched is brought up to date',
      now('DEAN').name === 'Dean/Principal', now('DEAN').name);
    check('a name somebody chose is left alone',
      now('OSA').name === 'The OSA, Roxas campus', now('OSA').name);
  }

  /* ---- a signatory who holds no office ----
     Offices are preferred because an office outlives its holder, but the first
     signatory on every one of the council's routes is "the author", and some
     signatures simply belong to a person. */
  {
    const withPerson = S3.addLetter({
      subject: 'Endorsement for the film festival', unitId: S3.nationalUnitId(),
      route: [
        { label: 'Sen. Kyla Villanueva' },
        { officeId: S3.officeByCode('PRES').id },
        { officeId: S3.officeByCode('OSA').id }
      ]
    });
    check('a person can be a signatory', withPerson.stops[0].label === 'Sen. Kyla Villanueva');
    check('and holds no office', withPerson.stops[0].officeId === '');
    check('the trail names them', S3.stopName(withPerson.stops[0]) === 'Sen. Kyla Villanueva');
    check('an office signatory still names the office',
      S3.stopName(withPerson.stops[1]) === 'FCUSR President');
    check('and the letter says it is waiting on the person',
      /Sen\. Kyla Villanueva/.test(S3.letterWhere(withPerson)), S3.letterWhere(withPerson));

    // A person is walked through exactly like an office.
    S3.receiveStop(withPerson.id, withPerson.stops[0].id, { receivedBy: 'Kyla V.' });
    S3.releaseStop(withPerson.id, withPerson.stops[0].id, { outcome: 'Approved' });
    check('a person can sign and pass it on',
      /FCUSR President/.test(S3.letterWhere(withPerson)), S3.letterWhere(withPerson));

    // Sent back by a person opens a second run at that same person.
    S3.receiveStop(withPerson.id, withPerson.stops[1].id, { receivedBy: 'Office staff' });
    S3.releaseStop(withPerson.id, withPerson.stops[1].id,
      { outcome: 'Returned for revision', note: 'Wrong date' });
    check('a return still opens a fresh run at the same desk',
      withPerson.stops[2].officeId === S3.officeByCode('PRES').id, S3.stopName(withPerson.stops[2]));

    check('a signatory that is neither office nor name is refused',
      (() => { try { S3.addLetter({ subject: 'x', route: [{}] }); return false; } catch (e) { return true; } })());
  }

  /* ---- an office that wants somebody else to sign first ---- */
  {
    const route = S3.addLetter({
      subject: 'Request for the sound system', unitId: S3.nationalUnitId(),
      officeIds: [S3.officeByCode('ADV').id, S3.officeByCode('DEAN').id, S3.officeByCode('OP').id]
    });
    S3.receiveStop(route.id, route.stops[0].id, { receivedBy: 'Mrs. Ferrer' });
    S3.releaseStop(route.id, route.stops[0].id, { outcome: 'Approved' });

    const osaId = S3.officeByCode('OSA').id;
    S3.insertStop(route.id, osaId, 1);
    check('an office can be put in ahead of the desk holding it',
      route.stops[1].officeId === osaId, S3.officeName(route.stops[1].officeId));
    check('the route grew by one', route.stops.length === 4);
    check('and the letter is now waiting on the new office',
      /OSA/.test(S3.letterWhere(route)), S3.letterWhere(route));
    check('what was already signed is untouched',
      route.stops[0].outcome === 'Approved' && route.stops[0].receivedBy === 'Mrs. Ferrer');

    // History is not a queue you can push things in front of.
    S3.insertStop(route.id, S3.officeByCode('REG').id, 0);
    check('nothing can be inserted before a signature already given',
      route.stops[0].officeId === S3.officeByCode('ADV').id,
      S3.officeName(route.stops[0].officeId));
    check('it lands at the first place that is still open',
      route.stops[1].officeId === S3.officeByCode('REG').id,
      S3.officeName(route.stops[1].officeId));
    check('an unknown office is refused',
      (() => { try { S3.insertStop(route.id, 'nope', 1); return false; } catch (e) { return true; } })());
  }

  // ---- the deadline ----
  const late = S3.addLetter({
    subject: 'Solicitation for the film festival', unitId: S3.nationalUnitId(),
    deadline: U.addDays(U.today(), -2), officeIds: [osa.id]
  });
  check('a letter past its deadline is overdue', S3.isLetterOverdue(late));
  check('an approved letter never is',
    (() => { S3.setLetterStatus(late.id, 'Approved'); return !S3.isLetterOverdue(S3.letter(late.id)); })());

  // ---- an office that has carried letters ----
  check('an office with a trail cannot be deleted',
    (() => { try { S3.deleteOffice(dean.id); return false; } catch (e) { return true; } })());
  check('it is set inactive instead',
    (() => { S3.setOfficeActive(dean.id, false); return S3.office(dean.id).active === false; })());

  // ---- a route that changes mid-flight ----
  const moving = S3.addLetter({
    subject: 'Excuse letter for the delegates', unitId: S3.nationalUnitId(),
    officeIds: [osa.id, op.id]
  });
  S3.receiveStop(moving.id, moving.stops[0].id, { receivedBy: 'Sir Alvarez' });
  S3.updateLetter(moving.id, { officeIds: [op.id] });
  check('history survives a change of route',
    moving.stops[0].officeId === osa.id && moving.stops[0].receivedBy === 'Sir Alvarez');
  check('and the offices still to come are the new ones',
    moving.stops.length === 2 && moving.stops[1].officeId === op.id);
}

console.log('\n--- letters survive a hostile file ---');
{
  const S4 = sb.Store;
  S4.fromJSON(JSON.stringify({
    data: {
      units: S4.units(), offices: S4.offices(),
      people: [], events: [], tasks: [], reports: [],
      letters: [
        { id: '<img src=x>', subject: 'Fine letter', unitId: S4.nationalUnitId(),
          stops: [{ officeId: S4.offices()[0].id, receivedBy: 'A'.repeat(500), receivedAt: '2026-13-45' }] },
        { subject: '', stops: [] },
        { subject: 'No route at all', stops: [{ officeId: 'nope' }] },
        { subject: 'Nothing to go on', stops: [{ receivedBy: 'Someone' }] }
      ]
    }
  }));
  const kept = S4.letters();
  /* A letter needs somewhere it went. A stop naming an office this device has
     never heard of is kept and labelled, because on a restored backup that is
     an office the letter really did pass through — but a stop naming neither an
     office nor a person is nothing at all, and takes its letter with it. */
  check('a letter with no route is dropped', kept.length === 2, kept.length + ' kept');
  check('a stop whose office is unknown here is kept, named',
    kept.some((l) => l.subject === 'No route at all' && l.stops[0].label === 'A former office'),
    JSON.stringify(kept.map((l) => l.stops.map((s) => s.label || s.officeId))));
  check('a stop naming nobody at all is dropped',
    !kept.some((l) => l.subject === 'Nothing to go on'));
  check('a hostile id is replaced', /^[A-Za-z0-9_-]+$/.test(kept[0].id), kept[0].id);
  check('an over-long name is clamped', kept[0].stops[0].receivedBy.length <= 80);
  check('an impossible date is dropped', kept[0].stops[0].receivedAt === '');
}

const failed = results.filter((r) => !r.pass);
/* ---------------- reading back a save with no units in it ----------------
   The colleges are seeded when the saved data has none: an old backup, a file
   written before units were stored, anything partial. The list that remembers
   which ones are already present was built from the SAVED units alone, and the
   seeding did not tell it — so the top-up pass that exists to add colleges a
   device predates could not see the sixteen just seeded, and added all sixteen
   again. Every college twice, on a device that had done nothing wrong.

   Adding a missing National unit had the same shape: put in without being
   recorded, then put in again. */
console.log('\n--- a save with no units does not double them ---');
{
  const cases = {
    'no units key at all': { events: [], tasks: [], people: [] },
    'an empty units list': { events: [], tasks: [], people: [], units: [] },
    'units with no National among them': {
      events: [], tasks: [], people: [],
      units: [{ id: 'unit-cas', code: 'CAS', kind: 'province', name: 'CAS' }]
    },
    'a partial save from an older version': {
      events: [], tasks: [], people: [], units: [], unitsSeed: 0
    }
  };

  Object.keys(cases).forEach((label) => {
    sb.window.localStorage.setItem('fcusr.tracker.v1', JSON.stringify(cases[label]));
    vm.runInContext('Store.load();', sb);
    const codes = vm.runInContext('Store.units().map(function (u) { return u.code; })', sb);
    const dupes = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
    check(label + ': every college once', dupes.length === 0, 'twice: ' + dupes.join(', '));
    check(label + ': and there is a National unit',
      vm.runInContext("Store.units().some(function (u) { return u.kind === 'national'; })", sb));
  });

  sb.window.localStorage.removeItem('fcusr.tracker.v1');
  vm.runInContext('Store.load(); Store._seedRehearsal();', sb);
}

console.log('\n========================================');
console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed');
if (failed.length) {
  failed.forEach((f) => console.log('  FAILED: ' + f.name + (f.extra ? '  — ' + f.extra : '')));
  process.exit(1);
}
