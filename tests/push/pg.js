/* A throwaway Postgres for the push tests.

   Starts a brand-new cluster in a temporary folder, on its own port, with the
   Supabase stand-ins and every one of the council's SQL files applied in the
   order the live project ran them — then push.sql on top. president-login.sql
   is left out: it moves one real person's login and has nothing to move here. Nothing here can
   reach the real project: there are no credentials in this repository, and the
   cluster listens on 127.0.0.1 and a socket in the temp folder only.

   Needs the PostgreSQL server binaries (initdb, pg_ctl) and the `pg` module:
       npm install pg            (or NODE_PATH to a folder that has it) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SQL = path.join(__dirname, '..', '..', 'backend', 'supabase');

/* The order the council's project ran its setup files in, read off their
   headers and the git history. push.sql is applied separately so a test can
   watch it go on. */
const MIGRATIONS = [
  'schema', 'sync', 'sync2', 'security', 'heads', 'remove', 'enrol',
  'separation-and-directives', 'accounts', 'self-read', 'purge-deleted', 'my-tasks',
  'usernames', 'offices-by-unit', 'volunteer-code',
  'sync3', 'sync3-fix', 'workspace', 'letter-stops'
];

function findBin(name) {
  const roots = ['/usr/lib/postgresql', '/usr/local/opt', '/opt/homebrew/opt'];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const v of fs.readdirSync(r).sort().reverse()) {
      const p = path.join(r, v, 'bin', name);
      if (fs.existsSync(p)) return p;
    }
  }
  try { return execFileSync('which', [name]).toString().trim(); } catch (e) { return null; }
}

/* initdb refuses to run as root, so on a container run as root the cluster is
   made by the postgres account instead. */
function asPg(bin, args) {
  if (process.getuid && process.getuid() === 0) {
    const quoted = [bin].concat(args).map((a) => "'" + String(a).replace(/'/g, "'\\''") + "'").join(' ');
    return execFileSync('su', ['postgres', '-s', '/bin/sh', '-c', quoted], { stdio: 'pipe' });
  }
  return execFileSync(bin, args, { stdio: 'pipe' });
}

async function start() {
  const initdb = findBin('initdb');
  const pgctl = findBin('pg_ctl');
  if (!initdb || !pgctl) throw new Error('PostgreSQL server binaries (initdb, pg_ctl) were not found.');
  let Client;
  try { Client = require('pg').Client; } catch (e) {
    throw new Error('The `pg` module is needed: npm install pg (or set NODE_PATH).');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcusr-push-pg-'));
  fs.chmodSync(dir, 0o777);
  if (process.getuid && process.getuid() === 0) execFileSync('chown', ['postgres', dir]);
  const port = 20000 + Math.floor(Math.random() * 20000);
  asPg(initdb, ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust']);
  asPg(pgctl, ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
    `-k ${dir} -p ${port} -c listen_addresses=127.0.0.1 -c timezone=UTC`, 'start']);

  const connect = async (database) => {
    const c = new Client({ host: dir, port, user: 'postgres', database: database || 'postgres' });
    c.on('notice', () => {});
    await c.connect();
    return c;
  };
  const admin = await connect();
  await admin.query('create database fcusr');
  await admin.end();

  const db = await connect('fcusr');
  const run = async (file, transform) => {
    let text = fs.readFileSync(file, 'utf8');
    if (transform) text = transform(text);
    return db.query(text);
  };
  await run(path.join(__dirname, 'supabase-stubs.sql'));
  for (const m of MIGRATIONS) {
    try { await run(path.join(SQL, m + '.sql')); } catch (e) {
      throw new Error(m + '.sql failed on the test database: ' + e.message);
    }
  }

  const stop = async () => {
    try { await db.end(); } catch (e) { /* already closed */ }
    try { asPg(pgctl, ['-D', path.join(dir, 'data'), '-m', 'fast', 'stop']); } catch (e) { /* gone */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  };
  return { db, connect, run, sql: (f) => path.join(SQL, f), stop, url: `postgres://postgres@127.0.0.1:${port}/fcusr`, dir, port };
}

module.exports = { start, MIGRATIONS };
