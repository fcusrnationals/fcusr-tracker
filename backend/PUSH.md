# Push notifications — how they work, and how to switch them on

Real notifications on people's phones and computers, even when the tracker is closed:

- **A task is given to you** (or given to you instead of somebody else).
- **A task of yours moves**: a new due date, or another activity.
- **The day before it is due, and the morning it is due.**
- **It slips past its deadline**: once, the morning after.

Each person turns them on **on each device**, with a button. The app never asks the browser on its own.

## What people get, by default

- **Nothing between 21:00 and 07:00 (Manila).** Anything in between waits for the morning.
- **One buzz each morning** for deadlines. Several due-today, due-tomorrow or overdue tasks arrive together as one notification ("3 of your tasks need a look").
- **Nothing about your own changes.** You are never told that you gave yourself a task.
- **Nothing that is no longer true.** Every notification is checked again just before it is sent, and nothing is sent for a task that has been finished, deleted, given to somebody else, moved again, or whose activity was cancelled or archived. Rehearsal (sample) data never sends anything.
- **Each notification is sent once.** A repeated sync, the hourly full round, a retry or a second run of the morning job never sends it twice. A newer notification about the same task replaces the older one on the phone.
- **Private lock screens.** A notification says *"You have a new task"*, not which task, unless that device turns on **Show task names**. The message travels end to end encrypted either way. The push service in the middle cannot read it.
- **Tapping a notification opens that task.**

## What each person does

The account menu (the circle with your initials) → **Notifications on this device** → **Turn on notifications**. The browser asks once. The same sheet holds these:

- the four switches;
- **Show task names on the lock screen** (off unless you turn it on);
- **Send a test**;
- **Turn off for this device**;
- the list of your devices, each with **Remove**.

Signing out turns this device off, so a shared computer stops ringing for whoever left.

| Where | What works |
|---|---|
| Android (Chrome, Edge, Firefox, Samsung Internet) | Yes, in the browser or installed |
| Windows, Mac, Linux, ChromeOS (Chrome, Edge, Firefox, Safari 16+) | Yes |
| iPhone / iPad | **Only once the tracker is on the Home Screen** (iOS 16.4+). Safari → Share → *Add to Home Screen*, open it from the icon, sign in, then turn notifications on. The sheet says this to anybody it applies to. |
| Notifications blocked in the browser | The sheet says how to allow them in the site settings. The app cannot ask again until they are allowed. |

## How it fits together

```
 a task changes ──sync──▶ tasks table ──trigger──▶ push_outbox ◀── 07:30 job: due / overdue
                                                        │
                       every minute: pg_cron ──▶ push-dispatch (Edge Function)
                                                        │  claims due lines, re-checks each one,
                                                        │  encrypts (RFC 8291), signs (VAPID, RFC 8292)
                                                        ▼
                              the browser's push service (Google / Mozilla / Apple)
                                                        ▼
                                  sw.js on the phone shows it → tap → #/task/<id>
```

**`backend/supabase/push.sql`** adds new tables, functions and one trigger. It changes no existing table, policy or sync rule.
- `push_subscriptions` holds one row per device that turned notifications on. Only its own account can see or remove it.
- `push_outbox` lists what to say, to whom, and from when. It is unique per line, which is what makes "sent once" true.
- `push_deliveries` records which device already got which line.
- `push_settings` holds the *public* key only.
- The trigger runs *after* the sync guard, so the hourly re-offers never reach it. It is wrapped so that a fault in it can never stop a task from saving (tested: a missing outbox table still saves the task).

**`supabase/functions/push-dispatch/index.ts`** is the sender.
- It uses Web Crypto only (no third-party crypto) and connects with the `SUPABASE_DB_URL` that Supabase gives every function.
- It logs counts only, never task names.

**`backend/supabase/push-schedule.sql`** sets up the two jobs: sending every minute, and the 07:30 deadline pass.

**Keys.** Nothing secret is ever copied or pasted, and nothing secret is in this repository:
- The push **key pair** is made by the function the first time it runs. The private half goes straight into **Supabase Vault**, and only the public half is ever read by the app.
- The cron job's **token** is a random value made by `push-schedule.sql` and also kept in Vault. The function checks it against Vault itself.
- The publishable key already in `config.js` is the only key the app has, as before.

## Switching it on (the Supabase dashboard — about ten minutes, once)

Do these in order. Each SQL file ends with a small table; every row should say `true`.

1. **SQL Editor → New query** → paste all of `backend/supabase/push.sql` → **Run**.
   It needs `letter-stops.sql` to have been run first (`check.sql` shows that). After this step the app's Notifications sheet says *"the server has not switched notifications on yet"*. That is expected until step 2.

2. **Edge Functions → Deploy a new function → Via Editor**.
   - Name it exactly **`push-dispatch`**.
   - Replace the template with the whole of `supabase/functions/push-dispatch/index.ts` → **Deploy function**.
   - Open the function's **Details / Settings** and turn **off** *Verify JWT* (sometimes labelled *Enforce JWT verification*). The cron job knocks with its own token, not a sign-in. (With the CLI the same is `supabase functions deploy push-dispatch`, and `supabase/config.toml` already sets `verify_jwt = false`.)

3. **SQL Editor → New query** → paste all of `backend/supabase/push-schedule.sql` → **Run**.
   This switches on `pg_cron` and `pg_net` if they are not already on (both free), makes the token, and schedules the two jobs.

4. **Check it.**
   - **Edge Functions → push-dispatch → Logs.** Within a minute you should see the first call and the line *"made the push key pair (kept in Vault)"*.
   - **Integrations → Cron** (or `select * from cron.job_run_details order by start_time desc limit 5;`) shows the job succeeding every minute.

5. **Merge the pull request.** GitHub Pages publishes it in a minute or two.

6. **Each person** opens Notifications on this device → **Turn on notifications** → **Send a test**. It should arrive within a minute.

## Switching it off, or taking it out

- **Off, at once:** run `backend/supabase/push-off.sql`. It unschedules both jobs, drops the trigger and lets anything still waiting go. Tasks, sync and sign-in are untouched. Run `push.sql` and then `push-schedule.sql` to switch it back on.
- **Out completely:** run `push-off.sql`, then the three statements in its header comment, and delete the `push-dispatch` function in the dashboard. Reverting the pull request removes the app side.

## Limits worth knowing

- **Delivery depends on the browser's push service** (Google, Mozilla or Apple). They are free and reliable, but a phone that is off or in battery saver may get the message late. Messages wait up to 24 hours.
- **Up to a minute's delay** for a new assignment (the cron interval), and in quiet hours until 07:00.
- **Free tier.** One function call a minute is about 43,000 a month, well inside the free Edge Function allowance (500,000). The database work is a handful of small queries a minute.
- The docs note that while a `pg_net` request is queued, its headers (here, the cron token) can be read by anyone who can log in to the database directly. That token only lets somebody ask the function to send what is already due, which is harmless.

## Tests (all run on throwaway copies; nothing touches the live project)

| Suite | What it proves |
|---|---|
| `node tests/run-push-db.js` | `push.sql` on a real Postgres 16 with every council migration applied first. What a task change says, and when it says nothing. Reassignment, moves, done, deleted, quiet hours, the morning job, claim-time re-checks, retries, gone devices, RLS, the private key in Vault, scheduling, and switching it all off. |
| `node tests/run-push-dispatch.js` | The real Edge Function, run in Deno against that database and a local stand-in push service. The VAPID signature verifies against the key the app is given. Every message is **decrypted with an independent library (`http_ece`)**. Lock screens stay generic unless details are on. One summary for several. A second run sends nothing. Gone and down devices are handled. |
| `node tests/run-push-sw.js` | `sw.js`: shows every push (even an unreadable one), stays inside the site, has no fetch handler and no cache, and opens the task when tapped. |
| `node tests/run-auth.js` | The Notifications sheet through the real `backend.js`: every state, the browser only asked on a button press, refusals said plainly, sign-out turning the device off. |
| `node tests/run-ui.js` | `#/task/<id>` lands on the task, or says plainly that it is not there. |
| `node tests/push-browser.js` | Real Chromium: the real `sw.js` registered, a push delivered through the browser's own DevTools protocol, the notification read back, a tap opening the task. It also takes the screenshots in `docs/push/`. |
