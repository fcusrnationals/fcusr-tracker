# Tests

Optional. **The app itself needs none of this** — `index.html` runs on its own with no
install. These are here so you can confirm nothing broke after a change.

They live outside the app: nothing in `assets/` or `vendor/` imports them.

## The data and report suite — no install needed

```bash
node tests/run-data.js
```

Loads the real `store.js` and `report.js` in a sandbox and checks the seed data, the
Asia/Manila date handling, status rules (`completedAt` stamping, blocked reasons), the
backup round trip, the sanitiser against a hostile backup file, and the generated PDF —
including that the page really is 345 mm × 215 mm, read back out of the PDF's own
MediaBox. Writes a sample report to `tests/out/sample-report.pdf`.

## The UI walk-through — needs jsdom

```bash
npm install jsdom
node tests/run-ui.js
```

Boots the real `index.html` in a headless DOM and walks the whole app: create an event,
add three tasks in a row, change a status inline, give a blocked reason, group by person,
archive from the ⋯ menu, switch person, search, cancel a delete. It fails on any console
error. It also holds the line on the four scroll bugs that were fixed (no `overflow-x`
wrapper around sticky headers, the status menu not closing on nested scroll, the scroll
lock working on iOS, anchors clearing the sticky bar) and on the security behaviour
(escaping, sanitising, CSP).

## Screenshots and layout audit — needs Chrome

```bash
npm install puppeteer-core
python3 -m http.server 4399          # in the project folder, in another terminal
node tests/screens.js 390 844 m      # phone
node tests/screens.js 1280 900 d     # desktop
```

Shoots every screen to `tests/out/` and fails if anything overflows sideways or if a tap
target is under 44px — measured by effective hit area, so an invisible padding that
enlarges a small chip counts.

Set `CHROME_PATH` if Chrome is somewhere other than the macOS default.

## Running them from another folder

The dependencies are installed in `~/.fcusr-tools` so they stay out of the
project. Point Node at them:

```bash
NODE_PATH=$HOME/.fcusr-tools/node_modules node tests/run-ui.js
```

To install them there in the first place:

```bash
mkdir -p ~/.fcusr-tools && cd ~/.fcusr-tools && npm install jsdom puppeteer-core
```
