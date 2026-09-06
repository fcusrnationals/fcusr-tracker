# FCUSR Task Tracker — handover

Paste this whole file into a new conversation. It carries everything needed to
continue without re-deriving decisions.

---

## 1. What this is

A task tracker for the **Filamer Christian University Student Republic** (FCUSR),
Roxas Avenue, Roxas City, Capiz. Built for student officers, mostly on phones.

It answers two questions instantly — *what am I responsible for and when is it
due*, and *how far along is this event* — then prints the whole picture as an
official colour report on the council's letterhead.

**Owner/user:** Arron D. Aperocho, FCUSR National President.

## 2. How to run it

No build step. `index.html` opens and runs on its own.

```bash
node tools/serve.js          # http://localhost:4321  (reads $PORT)
```

`.claude/launch.json` uses `autoPort: true` with `tools/serve.js`. Do **not**
hardcode a port — that caused a clash with a stray Python server earlier.

Assets carry `?v=21` cache-busting. **Bump that number when you change CSS or JS**,
or the browser serves stale files (this bit us twice).

## 3. Current state — what is built and working

| Area | State |
|---|---|
| Overview / My tasks / Directives / Events / Event detail | Done |
| Settings (executive-gated, enrolment console) | Done |
| Event Task Report → PDF | Done |
| Accomplishment Report wizard → PDF **and** Word | Done |
| Auth model, volunteer scoping, expiry | Done, driven end to end against a stand-in Supabase |
| Units (National + 12 provinces + COMELEC + Judiciary + DUAG) | Done, editable in Settings |
| National roll-up — "Across the Republic" on Overview | Done |
| Per-unit tracker name in the header | Done |
| Volunteers added and CSV-imported from the event | Done |
| Closing the term: date, reminders, compliance, export, handover | Done |
| Supabase schema, RLS, enrolment, sign-up trigger | Written, **not yet deployed** |
| Letters tracker — offices, routes, the trail | Done |
| Apps Script alternative | Written, kept as fallback |

**423 automated checks pass** across four suites.

## 4. Architecture

Plain ES5-style scripts on `window` globals, no bundler, no framework. Every
vendor file is local so the app works offline.

```
index.html                    shell, CSP, script order, ?v= cache-busting
tools/serve.js                PORT-aware static server
assets/css/app.css            design system (gold on white, Montserrat)
assets/css/print.css          @page geometry + print fallback
assets/js/util.js             dates (Asia/Manila), formatting, DOM helpers
assets/js/store.js            data, sanitising, localStorage, backup
assets/js/ui.js               taskRow (the one row component), chips, modals, menus
assets/js/forms.js            event / task / person / ENROLMENT dialogs
assets/js/auth.js             who is signed in and what that permits
assets/js/backend/config.js   *** PASTE SUPABASE URL + ANON KEY HERE ***
assets/js/backend/backend.js  one interface, three drivers (supabase/appsscript/local)
assets/js/report.js           Event Task Report PDF (long bond landscape)
assets/js/term-ui.js          closing the term: banner, reminder, archive, handover
assets/js/term-pdf.js         end-of-term record — every unit's reports, as links
assets/js/asset-db.js         IndexedDB image store + compression
assets/js/camera.js           getUserMedia capture (built, currently unused)
assets/js/accomplishment*.js  model / pdf / word / wizard UI
assets/js/views/              dashboard(=Overview) mytasks directives events event-detail
                              letters letter-detail settings
assets/img/letterhead-*.jpg   FCUSR letterhead, extracted from the .docx
vendor/                       jsPDF + autoTable + Montserrat TTF
backend/supabase/schema.sql   tables, RLS, enroll_member()
backend/appsscript/Code.gs    Apps Script equivalent
backend/SETUP.md              click-by-click setup for both
tests/                        run-data.js, run-ui.js, run-auth.js,
                              report-proof.js, screens.js
```

## 5. Decisions already made — do not silently reverse these

- **Backend: Supabase** (chosen after comparing with Google Apps Script).
  Free tier: 50,000 monthly active users, 500 MB database, 1 GB storage, 5 GB
  egress, 2 projects, **projects pause after 1 week idle**. ~400–650 accounts
  expected, so accounts are not the constraint.
- **Accomplishment reports are archived as Google Drive *links*, never files.**
  A real report ran to 320 MB; three would exceed the whole free storage tier.
  A link costs ~200 bytes.
- **Authority comes from two server-controlled fields only**: `unit`
  (National / province / COMELEC / Judiciary) and `access` (`officer` |
  `volunteer`). The typed **position is a label with no power** — this is why no
  wording can bypass enrolment rules. Do not try to police position text.
- **Enrolment table**: National officer → anyone, anywhere. Governor →
  **volunteers only, own province**. COMELEC Chair / Chief Justice → own body.
- **Volunteer access ends when their event completes**, and returns if they are
  enrolled elsewhere. Derived at read time, not stored.
- **Status names**: Not Started, In Progress, For Review, Done, **On hold**.
  "Blocked" was renamed; `STATUS_ALIASES` in store.js migrates old data.
  **Do not name a status "Pending"** — "pending" already means *anything not
  Done* throughout the app and both reports.
- **"This week" = rolling 7 days**, not the calendar week (it collapsed to one
  day when opened on a Sunday).
- **Every task belongs to an event**, except **Directives** (`kind:'directive'`),
  which deliberately have no event and need no report.
- **Event Task Report**: long bond landscape default, compact layout only, paper
  picker, live sheet-count estimate.
- **Accomplishment Report**: A4 portrait on the letterhead, cover page 1, letter
  of intent page 2, **each section starts a new page in BOTH the PDF and the Word
  file**, centred titles, no decorative rules, 12pt justified body, 8 photos at
  4 per page, page number bottom-right.
- **Attachments are uploaded photos only.** No scan button, no camera.
- **Photos print with no captions.** Removed from the PDF, the Word file and the
  wizard — the council does not caption its documentation.
- **Accounts are made in two halves, and the order matters.** An executive
  *enrols an email address* (unit + officer/volunteer + which events); that person
  then *sets their own password* on that address. A sign-up on an address nobody
  enrolled creates no profile, so they can hold a login and see nothing. This is
  why no service_role key is needed in the page — and a web page must never carry
  one.
- **Email confirmation must be OFF in Supabase.** Its built-in mailer is rate
  limited to a couple of messages an hour on the free tier; with ~400 accounts
  almost nobody would receive a link. Safe because sign-up grants nothing on its
  own. See `backend/SETUP.md` §A step 6.
- **Every event belongs to a unit** (`unitId`). Older data and backups without one
  become National work at load time.
- **There is no "whose event" question.** You are signed in to one unit's tracker,
  so an event created there is that unit's. The header names the unit — FCUSR COE,
  FCU COMELEC, FCUSR Judiciary — from a per-unit `trackerName`, editable in
  Settings, because the council's wording follows no single rule.
- **COMELEC, the Judiciary and DUAG are independent bodies** (`INDEPENDENT_KINDS`).
  The National government cannot see their events, tasks or progress at all —
  only the report they file at the end of term. Do not "helpfully" surface them
  in a national view.
- **Volunteers are taken on from the activity**, not from Settings: event detail →
  Volunteers → Add volunteer, or Import a list (CSV). Settings' enrolment is for
  officers. Any officer may enrol volunteers; only nationals open Settings.
- **Closing the term does not lock anything.** Work carries on before the date and
  after it. The date only makes the handover *possible*.
- **Nothing is ever deleted automatically.** The wipe is blocked outright while any
  unit is outstanding, needs a downloaded backup in the same sitting, and then an
  explicit confirmation. A national executive can pass over an outstanding unit
  only by recording a reason, which is printed in the final record.
- **PDF fonts are fetched on demand** (`Accomplishment.loadPdfFonts`). Montserrat
  is half a megabyte; it is not on the critical path for a phone on mobile data.

## 6. Hard constraints discovered — do not re-litigate

- **A browser cannot drive a scanner.** No TWAIN/SANE/WIA web API exists. WebUSB
  blocks protected classes; eSCL over HTTP is blocked by mixed content, CORS and
  Private Network Access. Route is: scan → file → upload.
- **`capture="environment"` is mobile-only.** On desktop it silently opens the
  file picker. Real camera needs `getUserMedia` (built in `camera.js`).
- **localStorage is ~5 MB.** Photos must go to IndexedDB (`asset-db.js`), which
  they do, compressed to ~250 KB each.
- **PDF scans are not supported** — images only. Rasterising PDFs needs pdf.js.
- **Word file is ~2 MB vs the PDF's 845 KB** — Word cannot share one copy of an
  image across uses.

## 7. Bugs already found and fixed — do not reintroduce

1. `overflow-x:auto` wrapper broke `position:sticky` table headers → tables
   replaced with row components entirely.
2. Status menu closed on any nested scroll (capture-phase listener) → non-capture.
3. `body{overflow:hidden}` does not lock scroll on iOS → `html.is-locked` class.
4. Missing `scroll-padding-top` → anchors landed under the sticky bar.
5. **`[hidden]` loses to any class that sets `display`** → global
   `[hidden]{display:none!important}`. This silently broke several UIs.
6. Modal exceeded the viewport: `width` is not a ceiling → `max-width` added.
7. Browser scroll restoration made the app look blank → `scrollRestoration='manual'`.
8. **CSP `default-src 'none'` with no `frame-src` blocked the blob PDF preview** →
   `frame-src blob:`.
9. Optional "minutes" step counted toward progress → a new report showed 92%.
10. Done tasks displayed "5 days late" → finished work drops the countdown.
11. Four nav tabs overflowed a 390px phone → icons hidden below 430px.
12. **The letterhead was drawn *after* the minutes table** (`didDrawPage`), and it
    is a full-page opaque image, so it painted over every row — the sheet looked
    blank while the text was still in the file. Now `willDrawPage`.
13. **Body text was never justified.** jsPDF's `align:'justify'` does nothing when
    it is handed one line at a time, which is how it was called. Spacing is now
    computed in `justifyLine()`. The old test checked that the *option was passed*,
    which is why this shipped.
14. `enroll_member()` inserted `gen_random_uuid()` into `profiles`, whose id is a
    foreign key to `auth.users` — **every enrolment would have failed** on the day
    of deployment. Replaced by enrol-then-claim (see below).
15. `whoami` fetched `profiles?...&limit=1` with no filter. A national may read
    every profile, so this returned an arbitrary person. Now `id=eq.<uid>`.
16. The Supabase session lived in memory only, so a page refresh left the app
    believing someone was signed in with no token to prove it. Now persisted, with
    refresh-token renewal before the hour runs out.
17. **Montserrat was vendored and used by the tests, but never loaded by the app** —
    so every report the council actually exported came out in Helvetica while the
    tests "proved" otherwise. Now loaded on demand, and checked.
18. `tests/report-proof.js` counted only `(literal) Tj`. An embedded font writes
    glyph ids as hex, so the moment Montserrat started working every page read as
    blank. Both forms are counted now — a reminder that a test reading a file
    format has to know the whole format.

## 8. Testing

Dependencies live outside the project so it stays clean:

```bash
mkdir -p ~/.fcusr-tools && cd ~/.fcusr-tools && npm install jsdom puppeteer-core
```

```bash
cd "<project>"
export NODE_PATH=$HOME/.fcusr-tools/node_modules
node tests/run-data.js                       # 83 checks, no install needed
node tests/run-ui.js                         # 161 checks, full walk-through
node tests/run-auth.js                       # 40 checks, the credential path
BASE_URL=http://localhost:4321/ node tests/report-proof.js        # 15 checks, the PDF
BASE_URL=http://localhost:4321/ node tests/screens.js 390 844 m   # layout audit
```

`run-auth.js` drives the real Supabase driver against a stand-in server that
answers the same URLs: enrol → set a password → sign in → refresh the page →
expire the token → sign out. No live project needed.

`report-proof.js` builds the Accomplishment Report and then **reads the finished
PDF back**, counting what physically landed on each sheet. Write tests this way
here: the two bugs below both passed source-level checks for years.

`screens.js` fails on horizontal overflow or any tap target under 44px
(measured by effective hit area).

## 9. Outstanding work

**Immediate blocker — needs the user, not the model:**
Create the Supabase project and paste the URL + anon key into
`assets/js/backend/config.js`. Steps are in `backend/SETUP.md` §A. Until then
the app falls back to local and treats the user as a national executive, so
everything still runs offline. **The login, dashboards and enrolment cannot be
verified live until this exists.**

**Then, in priority order (user's stated order — nationals first):**
1. ~~Wire and verify auth against the live Supabase project.~~ Written and tested
   against a stand-in; **the live run still has to happen** once the project exists.
2. ~~National dashboard proper + LGU overview for nationals.~~ Done — "Across the
   Republic" on Overview, unit filter on Events, units editable in Settings.
3. ~~Accomplishment report archive.~~ Done — per unit on the Overview, from the
   Drive link filed in the report wizard.
4. ~~Admin "everything" export for turnover.~~ Done — Settings → The term →
   Export all reports (`term-pdf.js`), links only, outstanding units named.
5. COMELEC, Judiciary and DUAG dashboards — they are sealed units now, but their
   chair / chief justice / director still need enrolling as officers of their unit,
   and none of that is verified until Supabase is live.
6. LGU deployment and the LGU tracker (explicitly deferred by the user).

**Still to do on the term work:** the server side. `term`, compliance and the
handover are all local — `backend/supabase/schema.sql` has no term table yet, so a
closing date declared on one device is not seen on another. That is the next piece
after the Supabase project exists.

**Not yet wired, though the backend supports it:** `Backend.pending()` (waiting
enrolments) and `Backend.withdraw()` have no screen yet. Withdrawal is a SQL
one-liner in the meantime — see the end of `backend/SETUP.md` §A.

## 11. The letters tracker

Tracks *where the paper is*, never the paper. **No document is stored** — a
deliberate call by the user, so there are no scans, photos or attachments on a
letter, and nothing feeds into the accomplishment report.

- **Offices** — 11 seeded, editable in Settings. Each carries `turnaroundDays`;
  sitting longer than that makes a letter **stuck**, which is the whole point of
  the thing. An office letters have passed through is deactivated, never deleted,
  or old trails would stop reading correctly.
- **Letters** — subject, person in charge (directory *or* a typed name), optional
  deadline, attached to an event or standing alone as council business.
- **The trail** — one stop per office: who forwarded it, who received it, when,
  and the outcome. Received-by is **typed in** — the clerk at that office will
  never sign in here, so this is a logbook, not a signature. Say so plainly if
  anyone asks it to be treated as proof.
- **Everything positional is derived, never stored**, so it cannot drift out of
  step with the trail: `currentStop`, `letterWhere`, `isStuck`, `letterProgress`.

**Do not let a returned letter advance.** `Returned for revision` sets a release
date like any other outcome, so the naive "first stop with no release date" reads
as the *next* office — the letter appears to sail past the desk that rejected it.
`currentStop()` treats a returned stop as still current. This shipped as a bug
once; three checks in `run-data.js` guard it.

Letters get **no nav tab** — four already crowd a 390px phone. The way in is the
Letters block on the Overview, and the section inside each event. A letter is
unit-scoped like an event, and `#/letters/<id>` is guarded by `Auth.canSeeLetter`
so typing an address is not a way past it.

## 12. Two headers, and only one of them is yours to change

This catches people out, so it is worth stating flatly.

- **The Accomplishment Report** is drawn on `assets/img/letterhead-print.jpg`, a
  full-page A4 image with the seals and the FCUSR wording **painted into it**.
  Nothing in Settings alters it. Do not rebuild that header out of text.
- **The Event Task Report** and the end-of-term summary are long bond
  **landscape**, so they physically cannot carry that A4 portrait letterhead.
  They draw their own header from `Store.org()` — name, address, email — plus an
  emblem. That is why Settings has letterhead fields at all, and the copy there
  now says which report they touch.
- **The council seal** is `assets/img/fcusr-seal.png` (512px, for the PDF header)
  and `fcusr-seal-small.png` (128px, for the app header and favicon). It ships
  with the app: the header shows it from the first visit, and an emblem uploaded
  in Settings overrides it for a unit with its own.

`preloadSeal()` in app.js turns the full seal into a data URL at start-up because
the task report draws synchronously. **It must never throw** — it runs inside
`boot()`, and the first version brought the whole app down in any context without
`fetch()`; no screen was wired at all. `run-ui.js` now boots in a sandbox with
neither `fetch` nor IndexedDB and asserts the app still comes up.

## 13. The sign-in gate

`views/signin.js`, shown by `App.render()` in place of everything else when a
backend is configured **and** nobody is signed in. The tabs, search and settings
buttons are hidden with it (`body.is-gated`) — a row of dead tabs above a login
box only invites people to press them.

**It deliberately does not stand offline.** With no Supabase credentials there is
nothing to authenticate against, the data is on that one device, and a password
box would be theatre. So the app opens straight in today and will not once the
project is connected. `run-auth.js` asserts both halves of that.

Before this existed the app had a sign-in *dialog* and no gate at all: with a
backend connected and nobody signed in, a visitor landed on the full Overview.
The dialog is still there for switching accounts from Settings.

## 14. The look, and where it comes from

The palette and the photo hero are taken from the **FCUSR Hub** so the two sites
read as one institution:

- ground `#FDFAF4` (the Hub's cream) rather than a neutral grey, warm ink
  `#1A1A17`, lines `#EAE5DA`. Every token kept its name; only the values moved.
- `assets/img/campus.jpg` — the College of Arts and Sciences building, from the
  Hub's own asset store, resized to 1200px and re-encoded (236 KB).
- `.photo-hero` on the Overview and behind the sign-in card: the photograph under
  a heavy diagonal wash, weighted left where the copy sits.
- `assets/img/fcusr-seal.png` / `-small.png` — the council seal, likewise from
  the Hub.

**The photograph is decoration and nothing depends on it.** Every word over it is
real text, so it stays selectable and readable to a screen reader, and if the
image fails to load the hero is still a dark gold panel with legible type. The
two states that carry meaning (`.hl` overdue, `.ok` on schedule) are lightened
for the dark ground rather than left at their on-white values.

## 15. Making the handover survive

Five pieces, all aimed at the same failure: an archive that quietly rots.

**The link is not the archive — the file behind it is.** A Shared Drive folder
and somebody's personal one produce identical URLs, so the system *cannot* tell
them apart. It asks instead: `report.driveOwned` plus who vouched and when. A
link nobody has vouched for counts as **unvouched**, and the term will not close
while any remain. This is the same shape as "received by" on a letter — a record
of a person's word, honestly labelled as such.

**`TermUI.myHandoverForm()`** answers "what is left for *me*" — unfinished
activities, unfiled reports, unvouched links, letters still out — in one place
instead of four screens. Reached from the term banner and from Settings.

**The archive survives the wipe.** `closeTerm()` snapshots unit names, activity
titles and report links into `term.archive` before deleting anything. A few
kilobytes, so the next administration inherits a readable record rather than an
empty app. `TermUI.archive()` reads the snapshot once `closedAt` is set and the
live data is gone.

**`LetterSlip`** prints the routing slip — the paper half of the letters tracker.
Recorded stops print filled in; the rest are blank for each office to sign.

**The end-of-term record now carries the correspondence**: letters still in
circulation and standing directives not yet closed. Both vanish in the wipe
unless they are written down first.

### The bug that keeps coming back

A full-page letterhead drawn *after* content hides it. This has now bitten three
times in three files. The cause each time was asking
`doc.internal.getNumberOfPages()` — the whole document — instead of autoTable's
`data.pageNumber`, which counts pages of *that table*. On a table's first page
the document may already be five pages deep, so the check fires and repaints.

**Always `willDrawPage: function (data) { if (data.pageNumber > 1) bg(...); }`.**
`report-proof.js` now counts letterheads per sheet in both PDFs.

**Known nice-to-haves raised but not built:** pdf.js so scanned PDFs can be
attached; real `.docx` (OOXML) instead of Word-HTML if the text boxes prove
awkward.

## 10. Working style the user has asked for

- Simple and uncluttered, but **visually engaging** — they pushed back twice on
  clutter and once on the UI feeling flat.
- Mobile-first; multi-device (phones and tablets) is a hard requirement.
- Proper punctuation and spacing in all user-facing copy.
- They are **not a coder** — explain trade-offs in plain language, and say
  plainly when something is not possible rather than building a fake version.
- No cost. Free tier or nothing; a small yearly fee only as a last resort.
