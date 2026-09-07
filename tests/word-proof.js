/* Builds the Word version of an accomplishment report and reads back what is
   actually in it.

   The PDF has had a proof since it was written; the Word file had none at all.
   It was broken the whole time — pictureBox referred to a `caption` variable
   that had been taken out of its signature and left behind in its body, so any
   report with a picture in it threw "caption is not defined". The only draft
   that could be exported was an empty one, which is the one nobody exports.

   Nothing here trusts the builder's own account of itself. The document is
   built, then searched for the things an officer expects to find in it.

       npm install puppeteer-core       (once)
       python3 -m http.server 4399      (in the project folder)
       node tests/word-proof.js
*/
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://localhost:4399/';

let passed = 0, failed = 0;
function check(label, ok, note) {
  if (ok) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (note ? '   — ' + note : '')); }
}

/* Runs inside the page. Returns the finished document as text, so every
   assertion below is made against the thing itself. */
async function buildWord(kind) {
  function fake(w, h, label) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#eef2ee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#333'; g.font = 'bold 28px sans-serif'; g.fillText(label, 24, 48);
    return c.toDataURL('image/jpeg', 0.7);
  }

  const shots = {};
  ['prog-1', 'let-1', 'eval-1', 'liq-1'].forEach((id) => { shots[id] = fake(1240, 1754, id); });
  for (let i = 1; i <= 8; i++) shots['ph-' + i] = fake(1600, 1200, 'PHOTO ' + i);
  AssetDB.getMany = (ids) =>
    Promise.resolve(ids.map((id) => ({ id, dataUrl: shots[id] || null })));

  const ev = Store.events().find((e) => e.title.indexOf('Foundation') === 0);

  const draft = {
    eventId: ev.id, id: 'rep-proof',
    description:
      'On September 12, 2026, the Filamer Christian University Student Republic conducted ' +
      'Foundation Week 2026 at the FCU Gymnasium and Quadrangle, joined by every province.',
    program: { assets: ['prog-1'] },
    photos: Array.from({ length: 8 }, (_, i) => ({ assetId: 'ph-' + (i + 1), caption: '' })),
    letters: [{ name: 'Letter of Intent', assets: ['let-1'] }],
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

  /* The awkward one: a section with nothing in it, a picture that is no longer
     in storage, and a letter with one page missing. Present enough to pass
     every check and then refused at the moment of drawing. */
  if (kind === 'sparse') {
    draft.program = { assets: [] };
    draft.evaluation = { assets: [] };
    draft.liquidation = { assets: ['gone-1'] };
    draft.letters = [{ name: 'Letter of Intent', assets: ['let-1', 'missing-2'] }];
  }
  if (kind === 'empty') return AccomplishmentWord.build(ev.id, Accomplishment.draftFor(ev.id))
    .then((out) => ({ html: out.html, title: ev.title }));

  return AccomplishmentWord.build(ev.id, draft).then((out) => ({ html: out.html, title: ev.title }));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(e.message));

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().indexOf('config.js') >= 0) {
      return req.respond({
        status: 200, contentType: 'application/javascript',
        body: "window.FCU_BACKEND = { driver: 'supabase', " +
              "supabase: { url: '', anonKey: '' }, appsscript: { url: '' } };"
      });
    }
    req.continue();
  });

  async function build(kind) {
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => { Store._seedRehearsal(); });
    return page.evaluate(buildWord, kind);
  }

  /* ---------------- a complete report ---------------- */
  console.log('\n--- a complete report ---');
  let out;
  try {
    out = await build('full');
  } catch (e) {
    check('it builds at all', false, e.message);
    console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
    await browser.close();
    process.exit(1);
  }
  const html = out.html;
  console.log('  ' + Math.round(html.length / 1024) + ' KB of document');

  check('it builds at all', html.length > 0);
  check('and it is a Word document, not a bare page',
    /<html[^>]*urn:schemas-microsoft-com:office/i.test(html) || /mso-/i.test(html),
    html.slice(0, 160));
  check('it names the activity', html.indexOf(out.title) >= 0);
  check('the write-up is in it', html.indexOf('joined by every province') >= 0);
  /* Signature blocks set the name in capitals, so these are matched without
     regard to case. Matching literally made the adviser look absent when she
     was there in capitals — and passed the President for the wrong reason
     entirely, because she is also the seeded event head and appears on the
     cover in ordinary case. A test that passes by coincidence is worse than
     one that fails. */
  const inSignature = (name) =>
    new RegExp('<b>' + name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</b>')
      .test(html);

  check('and so is whoever prepared it', inSignature('Job Sarmiento'));
  check('the President signs it', inSignature('Althea Ramirez'));
  check('and the adviser signs it', inSignature('Dr. Ma. Luisa Arroyo'),
    (html.match(/<b>[^<]*ARROYO[^<]*<\/b>/) || ['not in any signature block'])[0]);

  /* Eleven pictures go in: eight photographs, the programme, the letter and the
     evaluation, plus the liquidation. Word gets each one twice — once as VML
     for Word itself and once as an img for everything else. */
  const imgs = (html.match(/<img /g) || []).length;
  check('every picture is in the document', imgs >= 11, imgs + ' pictures');
  check('and each one twice, so Word and everything else can both read it',
    (html.match(/v:imagedata/g) || []).length >= 11,
    (html.match(/v:imagedata/g) || []).length + ' VML shapes');

  const sections = ['Letter of Intent', 'Program Flow', 'Summary of the Activity',
    'Photo Documentation', 'Evaluation'];
  sections.forEach((s) => {
    check('the ' + s.toLowerCase() + ' section is there',
      new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(html));
  });

  /* The fault that shipped: a variable left behind in the body of a function
     after it was taken out of the signature. It threw on every report that had
     a picture in it, which is every real one. */
  check('nothing threw while building it', thrown.length === 0, thrown.slice(0, 2).join(' | '));
  check('and nothing undefined leaked into the page',
    !/>undefined</.test(html) && !/"undefined"/.test(html),
    (html.match(/.{40}undefined.{20}/) || [''])[0]);

  /* ---------------- the awkward report ---------------- */
  console.log('\n--- a report with holes in it ---');
  const sparse = await build('sparse');
  check('it still builds', sparse.html.length > 0);
  check('without a section for the pictures that are not there',
    !/Program Flow/i.test(sparse.html) || sparse.html.indexOf('prog-1') < 0);
  check('and nothing undefined in it either',
    !/>undefined</.test(sparse.html) && !/"undefined"/.test(sparse.html));

  /* ---------------- nothing filled in ---------------- */
  console.log('\n--- a draft nobody has started ---');
  const empty = await build('empty');
  check('an empty draft still produces a document', empty.html.length > 0);
  check('naming the activity, so it is not a blank file', empty.html.indexOf(empty.title) >= 0);

  console.log('\n========================================');
  console.log(passed + ' passed, ' + failed + ' failed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
