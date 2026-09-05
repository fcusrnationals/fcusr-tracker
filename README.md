# FCUSR Task Tracker

A task tracker for the **Filamer Christian University Student Republic** — Roxas Avenue, Roxas City, Capiz.

It answers two questions instantly:

- *What am I responsible for, and when is it due?*
- *How far along is this event?*

…then prints the whole picture as an official colour report the council can hand out on paper.

---

## Running it

No build step, no server, no install. Either:

- **Double-click `index.html`** — it opens in the browser and works.
- Or serve the folder statically (only needed if your browser blocks local fonts):

```bash
python3 -m http.server 4399
```

To put it online, upload the folder to GitHub Pages, Netlify, or any static host.

## How the data works

- Everything is stored in **this browser only** (`localStorage`). No backend, no accounts, no logins.
- **No roles or permissions.** Anyone using the app can add, edit and delete anything. The name on *My tasks* is a view filter and a way to group the PDF — it is not an identity.
- Dates are handled in **Asia/Manila** and shown as `Aug 12, 2026 (Wed)`.
- "This week" means the **next seven days**, rolling — not the calendar week, which would collapse to a single day if you opened the app on a Sunday.

### Back up regularly — this matters

With no database, **Settings → Backup** is the only way to move the tracker to another device or recover from a cleared browser.

- **Download backup (JSON)** after every meeting.
- **Restore from backup (JSON)** on the new phone or laptop.

## The three screens

| Screen | What it is for |
|---|---|
| **Dashboard** | A one-line read of the day, three numbers that double as filters, then one list. Tap a number to filter it. |
| **My tasks** | Pick your name once — the device remembers it. Tap any status chip to change it inline. |
| **Events** | Every event, and the detail page where tasks are created and the report is printed. |

Settings (gear icon, top right) holds the officer directory, positions and committees, the report letterhead, and backup.

**Events are the entry point.** A task cannot exist outside an event, so the flow is always *New event → Add task*. Adding eight tasks in a row is one motion: the form stays open and refocuses after each save, keeping the assignee, date and priority.

**One search, not several.** The magnifier in the header (or the `/` key, or `⌘K`) searches tasks, events and people at once.

### Reading a task row

Every screen draws a task the same way:

```
● Confirm the guest speaker                    ← priority dot + title
  Althea Ramirez · Foundation Week · Aug 13    ← who, where, when
  [3 days late] [Blocked ▾]                    ← deadline chip + status (tap to change)
```

A red rail down the left edge means overdue. Colour is never the only signal — the words are always there too.

## The Event Task Report (PDF)

**Export PDF** lives on an event detail page and covers that event only — there is deliberately no all-events export.

- Paper: **215 mm × 345 mm ("Indian Legal"), landscape** → a printable page 345 mm wide × 215 mm tall.
- Printed **in colour**, using the same status colours as the screen.
- Covers **all tasks, pending and completed**. A "Pending tasks only" checkbox gives a shorter working copy.
- Contents: letterhead → event band with progress → officer summary table → per-officer detail tables → signature block.
- The **Notes column is intentionally blank** — room to write during meetings.
- Overdue rows are tinted red *and* marked with a bold `!`, so they survive a black-and-white photocopy.
- Saves as `FCUSR-TaskReport-[Event-Title]-[YYYY-MM-DD].pdf`.

### Changing the paper size

Page geometry lives in exactly two places, which must agree:

1. `assets/js/report.js` → the `PAGE` object at the top.
2. `assets/css/print.css` → the `@page` rule at the top.

### Adding the FCU seal / FCUSR emblem

**Settings → Report letterhead → Upload.** It appears in the app header and on every report. PNG or JPG.

## Security

There are no accounts and no server, so the risk is not "who can log in" — it is **what a file or a pasted string can make the page do**. Three things guard that:

- **Everything rendered is escaped.** Task titles, names and notes are treated as text, never markup.
- **Untrusted data is sanitised on the way in.** Anything read from browser storage or a restored backup is rebuilt field by field: ids must match a strict pattern, statuses and priorities must be values the app defines, dates must be real dates, over-long text is clamped, and references to events or people that do not exist are dropped. A hand-edited or hostile backup file cannot smuggle markup into an attribute or a bogus value into an enum.
- **A Content-Security-Policy** in `index.html` forbids loading or executing anything external, and forbids inline script entirely. Even if something slipped past the escaping, it has no way to run.

Uploaded emblems must be real PNG or JPEG data (SVG is refused, since SVG can carry script). Everything the app needs is vendored locally, so it never talks to the network.

## Sample data

Ships with 3 events, 19 tasks and 8 officers — some done, some overdue, one blocked, one unassigned — so the screens and the PDF can be judged immediately.

Remove it any time with **Settings → Data → Clear sample data**. Anything you created yourself stays.

## Project layout

```
index.html                   app shell, nav, CSP, script order
assets/css/app.css           design system: gold on white, status colours, mobile-first
assets/css/print.css         @page geometry + print fallback styling
assets/js/util.js            dates (Asia/Manila), formatting, small DOM helpers
assets/js/store.js           data model, sanitising, localStorage, derived fields, backup
assets/js/ui.js              the task row, chips, rings, badges, toasts, dialogs, menus
assets/js/forms.js           event / task / person dialogs
assets/js/report.js          the PDF report and the print fallback
assets/js/app.js             hash router and app wiring
assets/js/views/             dashboard · mytasks · events · event-detail · settings
assets/fonts/                Montserrat (woff2) for the screen
vendor/                      jsPDF + autoTable + Montserrat (TTF) for the PDF
tests/                       optional checks — see tests/README.md
```

Everything is vendored locally, so the app works with no network connection.

## Notes

- Status is always **colour plus its written label**, never colour alone.
- "Pending" means any status except Done, everywhere in the app and the report.
- "Overdue" is derived, never stored: due date is past and status is not Done.
- Finished tasks drop their countdown chip — a Done task should not advertise a deadline it already met.
- People are **deactivated, never deleted**, so past tasks keep their assignee.
