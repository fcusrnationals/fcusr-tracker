/* Bump the version, in both places that have to agree.

       node tools/bump.js

   `?v=NN` on every asset is what makes a browser fetch the new file rather
   than the one it already has. version.json is what a page already open uses
   to notice a new one exists at all — GitHub Pages lets a browser keep
   index.html for ten minutes, and a tab left open overnight would otherwise
   run yesterday's app against today's database for as long as it stayed open.

   They are bumped together here because two numbers maintained by hand are two
   numbers that drift, and the failure is invisible: everything looks fine and
   half the council is on an old version. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const VERSION = path.join(ROOT, 'version.json');

const html = fs.readFileSync(INDEX, 'utf8');
const found = html.match(/\?v=(\d+)/g) || [];
const numbers = Array.from(new Set(found.map((s) => Number(s.slice(3)))));

if (!numbers.length) {
  console.error('No ?v= markers in index.html — nothing to bump.');
  process.exit(1);
}
if (numbers.length > 1) {
  console.error('index.html carries more than one version: ' + numbers.join(', ') +
    '. Some assets would stay cached. Put them all on the same number first.');
  process.exit(1);
}

const next = numbers[0] + 1;
fs.writeFileSync(INDEX, html.replace(/\?v=\d+/g, '?v=' + next));
fs.writeFileSync(VERSION, JSON.stringify({ version: next }, null, 2) + '\n');

console.log('v' + numbers[0] + ' → v' + next + '  (index.html and version.json)');
