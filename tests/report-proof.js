/* Builds the Accomplishment Report the way the wizard does, then reads the
   finished PDF back and checks what actually landed on every sheet.

       node tests/report-proof.js
       node tests/report-proof.js --pdf     (also writes tests/out/proof.pdf)

   Needs the app on a local server and Chrome:

       node tools/serve.js
       BASE_URL=http://localhost:4321/ node tests/report-proof.js

   Pictures are stubbed rather than read from IndexedDB, so a run repeats exactly.

   This suite exists because the earlier checks read the source rather than the
   result. They confirmed that align:'justify' was passed and that a letterhead
   was drawn — both true, and both wrong: the text came out flush left, and the
   letterhead went down after the table it was meant to sit behind, hiding a full
   page of rows. Nothing here trusts the code; everything is measured off the
   finished document.
*/
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://localhost:4399/';
const OUT = path.join(__dirname, 'out');

let passed = 0, failed = 0;
function check(label, ok, note) {
  if (ok) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (note ? '   — ' + note : '')); }
}

/* Runs inside the page: assembles a draft, builds the PDF, and reports what is
   physically on each sheet. */
async function buildReport(opts) {
  // A stand-in scan: a plain rectangle at a believable page ratio.
  function fakeImage(w, h, label) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#eef2ee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#333'; g.font = 'bold 28px sans-serif';
    g.fillText(label, 24, 48);
    return c.toDataURL('image/jpeg', 0.7);
  }

  const shots = {};
  ['prog-1', 'let-1', 'let-2', 'eval-1', 'liq-1'].forEach((id) => {
    shots[id] = fakeImage(1240, 1754, id.toUpperCase());
  });
  for (let i = 1; i <= 8; i++) shots['ph-' + i] = fakeImage(1600, 1200, 'PHOTO ' + i);

  // Feed the builder from memory instead of IndexedDB.
  AssetDB.getMany = (ids) =>
    Promise.resolve(ids.map((id) => ({ id, dataUrl: shots[id] || null })));

  const ev = Store.events().find((e) => e.title.indexOf('Foundation') === 0);

  // A long task list is what pushes the generated minutes onto a second sheet.
  for (let i = 0; i < (opts.tasks || 0); i++) {
    Store.addTask({
      eventId: ev.id, title: 'Committee deliverable number ' + (i + 1),
      dueDate: U.addDays(U.today(), i), priority: 'Medium', status: 'Not Started'
    });
  }

  const draft = {
    eventId: ev.id,
    description:
      'On September 12, 2026, the Filamer Christian University Student Republic conducted ' +
      'Foundation Week 2026 at the FCU Gymnasium and Quadrangle. The week opened with a parade ' +
      'of colours joined by every province, followed by the socio-cultural night and the ' +
      'inter-college sports tournament. Attendance exceeded expectations, with participation ' +
      'from all ten provinces of the Republic.',
    program: { assets: ['prog-1'] },
    photos: Array.from({ length: 8 }, (_, i) => ({ assetId: 'ph-' + (i + 1), caption: '' })),
    letters: [{ name: 'Letter of Intent', assets: ['let-1', 'let-2'] }],
    minutes: { mode: 'tasks', assets: [] },
    evaluation: { assets: ['eval-1'] },
    liquidation: { assets: ['liq-1'] },
    signatories: {
      preparedBy: { name: 'Job Sarmiento', position: 'Secretary, FCUSR Nationals' },
      president: { name: 'Althea Ramirez', show: true },
      adviser: { name: 'Dr. Ma. Luisa Arroyo' }
    },
    driveLink: '', status: 'draft'
  };

  /* The awkward report: a programme flow nobody uploaded, an evaluation still to
     come, a liquidation pointing at a picture no longer in storage, and a letter
     page that is corrupt — present, so it passes every check, and then refused at
     the moment of drawing. That last one is the only way a blank sheet can still
     be produced, which is why the finished document is read back. */
  if (opts.sparse) {
    shots['bad-1'] = 'data:image/jpeg;base64,QUJDREVG';
    draft.program = { assets: [] };
    draft.evaluation = { assets: [] };
    draft.liquidation = { assets: ['gone-1'] };
    draft.letters = [{ name: 'Letter of Intent', assets: ['let-1', 'missing-2', 'bad-1'] }];
  }

  const out = await AccomplishmentPDF.build(ev.id, draft);
  const doc = out.doc;

  const streams = [];
  for (let i = 1; i <= out.pages; i++) streams.push((doc.internal.pages[i] || []).join('\n'));

  /* The letterhead is a full-page opaque image; drawn twice, the second one
     paints over everything already on the sheet. Page 1 draws it and nothing
     else, so page 1 names it. */
  const headMatch = streams[0].match(/\/([A-Za-z0-9]+) Do/);
  const headName = headMatch ? headMatch[1] : null;

  const census = streams.map((stream, idx) => ({
    page: idx + 1,
    images: (stream.match(/\/[A-Za-z0-9]+ Do/g) || []).length,
    letterheads: headName
      ? (stream.match(new RegExp('/' + headName + ' Do', 'g')) || []).length : 0,
    /* Two forms, because the font decides which. A standard font writes
       `(words) Tj`; an embedded one — Montserrat, on the council's letterhead —
       writes the glyph ids as hex, `<00480065> Tj`. Counting only the first made
       every page of a perfectly good report look blank. */
    texts: (stream.match(/(?:\([^)]*\)|<[0-9A-Fa-f\s]*>)\s*T[jJ]/g) || []).length,
    shapes: (stream.match(/\bre\b/g) || []).length
  }));

  return {
    pages: out.pages,
    pageMap: out.pageMap,
    blanksRemoved: out.blanksRemoved,
    census,
    pdf: opts.keepPdf ? doc.output('datauristring') : null
  };
}

// A sheet carrying only the letterhead and the stamped footer is a blank page,
// however good the intention behind it was.
const isBlank = (c) => c.images <= 1 && c.texts <= 1 && c.shapes === 0;

function table(census) {
  console.log('\n  page   images   letterheads   text runs   boxes');
  census.forEach((c) => {
    console.log(
      '  ' + String(c.page).padStart(4) +
      String(c.images).padStart(9) +
      String(c.letterheads).padStart(14) +
      String(c.texts).padStart(12) +
      String(c.shapes).padStart(8) +
      (isBlank(c) ? '   BLANK' : ''));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars']
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console:', m.text()); });

  /* config.js carries the council's live Supabase project, and a configured
     backend changes what this page is: the front door stands, and Auth.signIn
     below would go out to the real server. This suite is about what comes out of
     the PDF writer, so it serves its own empty credentials in place of the
     deployed ones and the app runs the way it does before Supabase is wired. */
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/assets\/js\/backend\/config\.js/.test(req.url())) {
      return req.respond({
        status: 200,
        contentType: 'application/javascript',
        body: "window.FCU_BACKEND = { driver: 'supabase', " +
              "supabase: { url: '', anonKey: '' }, appsscript: { url: '' } };"
      });
    }
    req.continue();
  });

  const keepPdf = process.argv.indexOf('--pdf') >= 0;

  async function scenario(opts) {
    // A fresh load each time, so one run's added tasks cannot leak into the next.
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    return page.evaluate(buildReport, opts);
  }

  /* ---------------- a complete report ---------------- */
  console.log('\n--- a complete report ---');
  const full = await scenario({ keepPdf });
  console.log('  ' + full.pages + ' pages · sections ' + JSON.stringify(full.pageMap));
  table(full.census);

  check('no sheet is blank', !full.census.some(isBlank));
  check('the letterhead is drawn once per sheet, never over the content',
    full.census.every((c) => c.letterheads === 1),
    full.census.filter((c) => c.letterheads !== 1).map((c) => 'page ' + c.page).join(', '));
  check('every section is accounted for',
    ['cover', 'letters', 'description', 'program', 'photos', 'minutes', 'liquidation', 'evaluation']
      .every((k) => full.pageMap[k]));

  // Justified text is drawn word by word, so the summary carries far more text
  // runs than it has lines. Flush-left text would draw one run per line.
  const summary = full.census[full.pageMap.description - 1];
  check('the summary is justified, not flush left', summary.texts > 20,
    summary.texts + ' text runs');

  // Photo sheets carry the section title and the stamped footer, and nothing else.
  const photoPages = full.census.filter((c) => c.page >= full.pageMap.photos &&
    c.page < full.pageMap.minutes);
  check('photos print with nothing written under them',
    photoPages.length === 2 && photoPages.every((c) => c.texts <= 2),
    photoPages.map((c) => c.page + ':' + c.texts).join(' '));

  // The minutes are generated from the tracker, so the page must carry the rows.
  const minutes = full.census[full.pageMap.minutes - 1];
  check('the generated minutes are visible on the page', minutes.texts > 20,
    minutes.texts + ' text runs');

  /* ---------------- minutes long enough to break ---------------- */
  console.log('\n--- minutes spanning two sheets ---');
  const long = await scenario({ tasks: 40 });
  console.log('  ' + long.pages + ' pages · sections ' + JSON.stringify(long.pageMap));
  const spill = long.census.filter((c) => c.page >= long.pageMap.minutes &&
    c.page < long.pageMap.liquidation);
  // How many sheets it needs depends on the columns; that it keeps going, and
  // keeps its rows and its letterhead on every one of them, is the point.
  check('the table runs past one sheet', spill.length >= 2, spill.length + ' sheets');
  check('both sheets keep their rows', spill.every((c) => c.texts > 20));
  check('neither sheet is painted over', spill.every((c) => c.letterheads === 1));
  check('no sheet is blank', !long.census.some(isBlank));

  /* ---------------- the awkward report ---------------- */
  console.log('\n--- missing and broken attachments ---');
  const sparse = await scenario({ sparse: true });
  console.log('  ' + sparse.pages + ' pages · sections ' + JSON.stringify(sparse.pageMap) +
    ' · ' + sparse.blanksRemoved + ' blank sheet(s) removed');
  table(sparse.census);

  check('a section with nothing in it never opens a page',
    !sparse.pageMap.program && !sparse.pageMap.evaluation && !sparse.pageMap.liquidation);
  check('a picture that fails at the last moment leaves no sheet behind',
    sparse.blanksRemoved >= 1, sparse.blanksRemoved + ' removed');
  check('no sheet is blank', !sparse.census.some(isBlank));
  check('the letterhead is drawn once per sheet', sparse.census.every((c) => c.letterheads === 1));
  check('what survived is still there', !!sparse.pageMap.letters && !!sparse.pageMap.photos);

  /* ---------------- the turnover record ----------------
     The letterhead is a full-page opaque image. Drawn after a table it hides the
     rows; drawn after a heading it hides the heading. That has now happened three
     times in three different files, always because the code asked the document
     how many pages it had instead of asking the table which of ITS pages this
     was. Counted per sheet, once, every time. */
  console.log('\n--- the end-of-term record ---');
  const term = await page.evaluate(async () => {
    await window.Auth.signIn('', '');
    // The seed carries no standing directives, so the record would rightly omit
    // that sheet. One is added here because it is the sheet under test.
    Store.addTask({
      kind: 'directive', title: 'Follow up the adviser on the budget memo',
      dueDate: U.addDays(U.today(), 5), priority: 'High'
    });
    Store.declareTerm(U.addDays(U.today(), 20), { by: 'Test' });
    const r = await TermPDF.build();
    const doc = r.doc || r;
    const pages = doc.internal.getNumberOfPages();
    const streams = [];
    for (let i = 1; i <= pages; i++) streams.push((doc.internal.pages[i] || []).join('\n'));
    const head = streams[0].match(/\/([A-Za-z0-9]+) Do/);
    const name = head ? head[1] : null;
    return {
      pages,
      census: streams.map((st, i) => ({
        page: i + 1,
        letterheads: name ? (st.match(new RegExp('/' + name + ' Do', 'g')) || []).length : 0,
        texts: (st.match(/(\(.*?\)|<[0-9A-Fa-f]+>)\s*T[jJ]/g) || []).length
      })),
      sections: r.sections
    };
  });

  console.log('  ' + term.pages + ' pages');
  check('the letterhead is drawn once per sheet',
    term.census.every((c) => c.letterheads === 1),
    term.census.filter((c) => c.letterheads !== 1).map((c) => 'page ' + c.page + ':' + c.letterheads).join(' '));
  check('no sheet is blank', term.census.every((c) => c.texts > 1));
  check('the letters still out get their own sheet', !!term.sections.letters,
    JSON.stringify(term.sections));
  check('and so do the standing directives', !!term.sections.directives);
  // The heading is drawn before the table; if the letterhead went down after it,
  // that sheet would carry the table and nothing else.
  check('their headings survived the letterhead',
    term.census[term.sections.letters - 1].texts > 5 &&
    term.census[term.sections.directives - 1].texts > 5,
    'letters ' + JSON.stringify(term.census[term.sections.letters - 1]) +
    ' directives ' + JSON.stringify(term.census[term.sections.directives - 1]));

  if (keepPdf && full.pdf) {
    fs.writeFileSync(path.join(OUT, 'proof.pdf'),
      Buffer.from(full.pdf.split(',')[1], 'base64'));
    console.log('\nWrote tests/out/proof.pdf');
  }

  console.log('\n========================================');
  console.log(passed + ' passed, ' + failed + ' failed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
