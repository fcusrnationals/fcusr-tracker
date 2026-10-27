/* FCUSR Task Tracker — push-dispatch
 *
 * Sends the push notifications push.sql has queued. Called once a minute by
 * the fcusr-push-dispatch pg_cron job (push-schedule.sql); there is nothing a
 * person ever calls by hand.
 *
 * Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via
 * Editor, name it  push-dispatch , paste this whole file, Deploy, then turn
 * OFF "Verify JWT" in the function's settings (the cron job knocks with its own
 * token instead — see backend/PUSH.md).
 *
 * What it needs, all of it already provided by Supabase to every function:
 *   SUPABASE_DB_URL   to talk to the database directly (the documented way)
 * Nothing else. No key is pasted anywhere:
 *   - the cron job's token is made by push-schedule.sql and kept in Vault;
 *   - the push key pair is made here the first time this runs, with Web Crypto,
 *     and kept in Vault. Only its public half ever leaves the database.
 *
 * The push messages themselves are built here, on Web Crypto alone, to the
 * current standards every browser's push service accepts: RFC 8291 message
 * encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID. There is no third-party
 * crypto library. tests/run-push-dispatch.js decrypts and verifies what this
 * sends with an independent implementation.
 *
 * What it never does: log a task's name, send a notification to anybody whose
 * phone did not turn them on, or send the same line to the same phone twice.
 */
import postgres from 'npm:postgres@3.4.9';

const SITE = 'https://fcusrnationals.github.io/fcusr-tracker/';
const TTL_SECONDS = 24 * 60 * 60;
const SEND_TIMEOUT_MS = 10000;
const CONCURRENCY = 8;
const MAX_ROWS = 200;

export type Claimed = {
  outbox_id: number | string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  details: boolean;
  kind: 'assigned' | 'moved' | 'due_soon' | 'due_today' | 'overdue' | 'test';
  task_id: string | null;
  task_title: string;
  event_title: string;
  due: string;
  detail: Record<string, string>;
  dedupe_key: string;
};

export type Payload = { v: 1; title: string; body: string; url: string; tag: string };

/* ---------------------------------------------------------------- wording */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return '';
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]);
}

function clip(s: string, n: number): string {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function where(item: Claimed): string {
  return item.event_title ? clip(item.event_title, 60) : 'Directive';
}

/* One line, as the lock screen will show it. Without "details" a phone is told
   only that something happened — never what the task is — because a lock
   screen is read by whoever is holding the phone. */
export function single(item: Claimed): Payload {
  const url = item.kind === 'test' || !item.task_id ? './#/my-tasks' : './#/task/' + item.task_id;
  const tag = item.kind === 'test' ? 'fcusr-test' : 'fcusr-task-' + item.task_id;
  const name = clip(item.task_title, 80) || 'a task';
  const d = item.details;
  const due = shortDate(item.due);
  let title = '', body = '';
  switch (item.kind) {
    case 'assigned': {
      title = d ? 'New task: ' + name : 'You have a new task';
      const bits = d ? [where(item), due ? 'due ' + due : '', item.detail?.actor ? 'from ' + clip(item.detail.actor, 40) : '']
        : ['Open the tracker to see it.'];
      body = bits.filter(Boolean).join(' · ');
      break;
    }
    case 'moved': {
      title = d ? 'Moved: ' + name : 'One of your tasks was moved';
      const change = item.detail?.change;
      body = !d ? 'Open the tracker to see what changed.'
        : change === 'event' ? 'Now in ' + where(item)
        : change === 'both' ? 'Now in ' + where(item) + (due ? ', due ' + due : '')
        : due ? 'Now due ' + due : 'The due date was cleared';
      break;
    }
    case 'due_soon':
      title = d ? name : 'A task of yours is due tomorrow';
      body = d ? 'Due tomorrow · ' + where(item) : 'Open the tracker to see it.';
      break;
    case 'due_today':
      title = d ? name : 'A task of yours is due today';
      body = d ? 'Due today · ' + where(item) : 'Open the tracker to see it.';
      break;
    case 'overdue':
      title = d ? name : 'A task of yours is past its deadline';
      body = d ? 'Was due ' + (due || 'earlier') + ' · ' + where(item) : 'Open the tracker to see it.';
      break;
    default:
      title = 'Notifications are working';
      body = 'This device will be told about your tasks.';
  }
  return { v: 1, title, body, url, tag };
}

/* Several lines for one phone in one round become one notification, so a
   morning with five deadlines is one buzz, not five. */
export function summary(items: Claimed[]): Payload {
  if (items.length === 1) return single(items[0]);
  const count = (k: string[]) => items.filter((i) => k.indexOf(i.kind) >= 0).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => { if (n) parts.push(n + ' ' + (n === 1 ? one : many)); };
  add(count(['assigned']), 'new task', 'new tasks');
  add(count(['moved']), 'moved', 'moved');
  add(count(['due_today']), 'due today', 'due today');
  add(count(['due_soon']), 'due tomorrow', 'due tomorrow');
  add(count(['overdue']), 'overdue', 'overdue');
  const tasks = items.filter((i) => i.kind !== 'test');
  const onlyNew = count(['assigned']) === tasks.length;
  const title = onlyNew ? 'You have ' + tasks.length + ' new tasks' : tasks.length + ' of your tasks need a look';
  let body = parts.join(' · ');
  if (items[0].details) {
    const names = tasks.slice(0, 3).map((i) => clip(i.task_title, 40)).filter(Boolean);
    if (names.length) body += ' — ' + names.join(', ') + (tasks.length > 3 ? '…' : '');
  }
  return { v: 1, title, body, url: './#/my-tasks', tag: 'fcusr-summary' };
}

/* --------------------------------------------------------------- helpers */

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Push services keep at most one undelivered message per topic: the newest.
async function topicFor(tag: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tag)));
  return b64url(h).slice(0, 32);
}

async function ensureKeys(sql: postgres.Sql): Promise<{ publicKey: string; jwk: JsonWebKey }> {
  let rows = await sql`select public_key, private_jwk from push_vapid()`;
  if (!rows.length) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    // Kept the first time only; if two runs raced, both use the one that won.
    await sql`select push_store_vapid(${b64url(raw)}, ${JSON.stringify(jwk)})`;
    rows = await sql`select public_key, private_jwk from push_vapid()`;
    console.log('push-dispatch: made the push key pair (kept in Vault)');
  }
  return { publicKey: rows[0].public_key, jwk: JSON.parse(rows[0].private_jwk) };
}

/* ------------------------------------------- RFC 8291 + RFC 8292, by hand */

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

function unb64url(s: string): Bytes {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* The message body a push service delivers to the browser unopened: only the
   phone that subscribed holds the key to read it (RFC 8291, aes128gcm). */
export async function encryptPayload(text: string, p256dh: string, authSecret: string): Promise<Bytes> {
  const uaPublic = unb64url(p256dh);
  const auth = unb64url(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad subscription key');
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const peer = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256));

  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const plain = concat(enc.encode(text), new Uint8Array([2]));        // one record, last-record delimiter
  if (plain.length > 3900) throw new Error('message too long');
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const rs = new Uint8Array([0, 0, 16, 0]);                            // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/* Who is sending (RFC 8292): a short-lived token signed with our private key,
   checked by the push service against the public key the phone subscribed with. */
export async function vapidAuthorization(endpoint: string, jwk: JsonWebKey, publicKey: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: SITE,
  })));
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims)));
  return 'vapid t=' + header + '.' + claims + '.' + b64url(sig) + ', k=' + publicKey;
}

async function send(keys: { publicKey: string; jwk: JsonWebKey }, sub: Claimed, payload: Payload): Promise<{ status: number; error?: string }> {
  try {
    const url = new URL(sub.endpoint);
    if (url.protocol !== 'https:') return { status: 400, error: 'not https' };
    let body: Bytes;
    try {
      body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
    } catch (err) {
      // Keys that cannot be used will never work: recorded once, not retried.
      return { status: 400, error: 'unusable subscription keys: ' + String((err as Error)?.message || err).slice(0, 80) };
    }
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(TTL_SECONDS),
        'Urgency': 'normal',
        'Topic': await topicFor(payload.tag),
        'Authorization': await vapidAuthorization(sub.endpoint, keys.jwk, keys.publicKey),
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return { status: res.status };
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return { status: 0, error: String(e?.message || err).slice(0, 120) + (e?.cause ? ': ' + String(e.cause.message || e.cause).slice(0, 80) : '') };
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/* ---------------------------------------------------------------- handler */

let client: postgres.Sql | null = null;
function db(): postgres.Sql {
  if (!client) {
    const url = Deno.env.get('SUPABASE_DB_URL');
    if (!url) throw new Error('SUPABASE_DB_URL is not set.');
    // prepare:false, as the Supabase docs say for the transaction pooler.
    client = postgres(url, { prepare: false, max: 2, idle_timeout: 20 });
  }
  return client;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  const sql = db();
  const token = req.headers.get('x-dispatch-token') || '';
  const [{ ok }] = await sql`select push_check_token(${token}) as ok`;
  if (!ok) return Response.json({ error: 'not allowed' }, { status: 401 });

  const keys = await ensureKeys(sql);
  const claimed = (await sql`select * from push_claim(${MAX_ROWS})`) as unknown as Claimed[];

  const bySub = new Map<string, Claimed[]>();
  for (const row of claimed) {
    const list = bySub.get(row.subscription_id) || [];
    list.push(row);
    bySub.set(row.subscription_id, list);
  }

  const results: { outbox_id: number | string; subscription_id: string; status: number; error?: string }[] = [];
  await pool([...bySub.values()], CONCURRENCY, async (items) => {
    const out = await send(keys, items[0], summary(items));
    for (const it of items) {
      results.push({ outbox_id: it.outbox_id, subscription_id: it.subscription_id, status: out.status, error: out.error });
    }
  });

  let report = { delivered: 0, forgotten: 0, retrying: 0 };
  if (results.length) {
    const [{ r }] = await sql`select push_report(${sql.json(results)}) as r`;
    report = r;
  }
  const summaryLine = { lines: claimed.length, devices: bySub.size, ...report };
  // Counts only — never a task's name, a person, or a push address.
  if (claimed.length) console.log('push-dispatch:', JSON.stringify(summaryLine));
  return Response.json(summaryLine);
}

export default {
  fetch: async (req: Request) => {
    try {
      return await handle(req);
    } catch (err) {
      console.error('push-dispatch failed:', String((err as Error)?.message || err));
      return Response.json({ error: 'failed' }, { status: 500 });
    }
  },
};
