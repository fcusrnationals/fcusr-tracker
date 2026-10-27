/* Runs the real push-dispatch handler once, the way the cron job calls it, and
   prints what it answered. Used by tests/run-push-dispatch.js. */
import fn from '../../supabase/functions/push-dispatch/index.ts';

const [method, token] = Deno.args;
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (token) headers['x-dispatch-token'] = token;
const res = await fn.fetch(new Request('http://localhost/functions/v1/push-dispatch', {
  method: method || 'POST', headers, body: method === 'GET' ? undefined : '{}',
}));
console.log('RESULT ' + JSON.stringify({ status: res.status, body: await res.json() }));
Deno.exit(0);
