-- FCUSR Task Tracker — push notifications: who to remind, about what, and when
--
-- Run this in Supabase → SQL Editor after letter-stops.sql. Safe to run twice.
-- Then deploy the push-dispatch Edge Function and run push-schedule.sql (see
-- backend/PUSH.md). Until all three are done nothing is ever sent, and the app
-- says so on the Notifications sheet instead of pretending.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- The bell inside the app only helps somebody who has the app open. A task
-- given to a volunteer at nine at night, or a deadline tomorrow, has to reach
-- the phone in their pocket. Browsers can do that — web push — but only with a
-- server that remembers each phone's address and knocks on it at the right
-- moment. That server is this file, an Edge Function and two pg_cron jobs.
--
-- ---------------------------------------------------------------------------
-- HOW, PLAINLY
--
--   1. A phone that says yes to notifications leaves its push address here
--      (push_subscriptions). Only that account can see or remove it.
--   2. When a task syncs, a trigger notices the changes worth telling somebody
--      about — given to you, or moved (a new due date, another activity) —
--      and writes one line in an outbox. Once a day at 07:30 (Manila) another
--      job writes the deadline lines: due tomorrow, due today, overdue.
--   3. Every minute the Edge Function claims what is due, checks each line is
--      still true (still yours, not done, not deleted, same deadline), sends
--      it, and reports back. A line is sent once; a phone that has gone away
--      is forgotten.
--
-- Nobody is told about their own change. Nothing is sent between 21:00 and
-- 07:00 Manila — it waits for the morning. Lock screens show "You have a new
-- task", not the task, unless that phone chose to show task names.
--
-- ---------------------------------------------------------------------------
-- WHAT IT ADDS (and changes nothing that already exists)
--
--   push_subscriptions   one row per phone or browser that turned it on
--   push_outbox          what should be said, to whom, from when; unique per
--                        dedupe key, so a repeated change is never said twice
--   push_deliveries      which phone already got which line, so a retry never
--                        sends it to the same phone again
--   push_settings        the public half of the push key (safe to publish)
--   trigger push_task_changed on tasks — AFTER the sync guard, and wrapped so
--                        that a fault in it can never stop a task from saving
--
-- The private half of the push key is made by the Edge Function the first time
-- it runs and kept in Supabase Vault. It is never in this repository, never in
-- the app, and nobody ever has to copy it anywhere.

-- ======================================================== 1. the tables

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  p256dh       text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,200}={0,2}$'),
  auth         text not null check (auth ~ '^[A-Za-z0-9_-]{8,64}={0,2}$'),
  label        text not null default '' check (length(label) <= 80),
  prefs        jsonb not null default
                 '{"assigned":true,"moved":true,"due":true,"overdue":true,"details":false}'::jsonb,
  failures     int not null default 0,
  last_error   text not null default '',
  last_sent_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx on push_subscriptions(profile_id);

create table if not exists push_outbox (
  id            bigserial primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  kind          text not null,
  task_id       uuid,
  dedupe_key    text not null unique,
  detail        jsonb not null default '{}'::jsonb,
  not_before    timestamptz not null default now(),
  claimed_at    timestamptz,
  attempts      int not null default 0,
  sent_at       timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text not null default '',
  created_at    timestamptz not null default now()
);
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('assigned','moved','due_soon','due_today','overdue','test'));
create index if not exists push_outbox_pending_idx on push_outbox(not_before)
  where sent_at is null and cancelled_at is null;
create index if not exists push_outbox_task_idx on push_outbox(task_id)
  where sent_at is null and cancelled_at is null;

create table if not exists push_deliveries (
  outbox_id       bigint not null references push_outbox(id) on delete cascade,
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  status          int not null,
  at              timestamptz not null default now(),
  primary key (outbox_id, subscription_id)
);

create table if not exists push_settings (
  key   text primary key,
  value text not null
);

alter table push_subscriptions enable row level security;
alter table push_outbox        enable row level security;
alter table push_deliveries    enable row level security;
alter table push_settings      enable row level security;

-- Your own phones, and nobody else's. Writing goes through push_subscribe so a
-- shared computer can change hands cleanly; reading and removing are direct.
drop policy if exists push_subscriptions_read on push_subscriptions;
create policy push_subscriptions_read on push_subscriptions for select
  using (profile_id = auth.uid());
drop policy if exists push_subscriptions_delete on push_subscriptions;
create policy push_subscriptions_delete on push_subscriptions for delete
  using (profile_id = auth.uid());

-- The outbox, the delivery record and the settings are for the server alone:
-- RLS with no policy at all, and no table rights for the app's roles either.
revoke all on push_outbox, push_deliveries, push_settings from anon, authenticated;
revoke insert, update on push_subscriptions from anon, authenticated;
revoke all on push_subscriptions from anon;
do $$ begin
  revoke all on sequence push_outbox_id_seq from anon, authenticated;
exception when undefined_object then null; end $$;

-- ======================================================== 2. small helpers

-- The account behind a directory entry: joined by address, exactly as is_me()
-- and ws_is_person() do. Only an active account whose access has not lapsed.
create or replace function push_profile_for_person(person text) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when person is null
      or person !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then null
    else (
      select pr.id from people pe
      join profiles pr on lower(pr.email) = lower(coalesce(pe.body->>'email', ''))
      where pe.id = person::uuid
        and pe.active and coalesce(pe.body->>'active', 'true') <> 'false'
        and pr.active and (pr.valid_until is null or pr.valid_until >= current_date)
        and coalesce(pe.body->>'email', '') <> ''
      limit 1)
  end;
$$;

-- An activity that is over in the sense that matters here: cancelled,
-- archived, or deleted.
create or replace function push_event_shelved(ev text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when ev is null or ev = '' then false
    when ev !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else exists (select 1 from deletions d where d.entity = 'event' and d.entity_id = ev::uuid)
      or exists (select 1 from events e where e.id = ev::uuid
                   and (e.status in ('Cancelled', 'Archived')
                        or coalesce(e.body->>'status', '') in ('Cancelled', 'Archived')))
  end;
$$;

-- Quiet hours. Anything said between 21:00 and 07:00 in Manila waits for 07:00.
create or replace function push_not_before(at_time timestamptz) returns timestamptz
language sql immutable as $$
  select case
    when (at_time at time zone 'Asia/Manila')::time >= time '21:00'
      then (((at_time at time zone 'Asia/Manila')::date + 1) + time '07:00') at time zone 'Asia/Manila'
    when (at_time at time zone 'Asia/Manila')::time < time '07:00'
      then ((at_time at time zone 'Asia/Manila')::date + time '07:00') at time zone 'Asia/Manila'
    else at_time
  end;
$$;

create or replace function push_valid_date(d text) returns date
language plpgsql immutable as $$
begin
  if d is null or d !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return d::date;
exception when others then return null;
end;
$$;

-- Whether a phone wants this kind of line, by its own preferences. A test
-- always goes; due tomorrow and due today share one switch.
create or replace function push_wants(prefs jsonb, kind text) returns boolean
language sql immutable as $$
  select kind = 'test' or coalesce((prefs->>(case
    when kind in ('due_soon', 'due_today') then 'due' else kind end))::boolean, true);
$$;

-- Lines still waiting about one task, taken back.
create or replace function push_cancel_pending(task uuid, reason text, only_profile uuid default null)
returns void language sql security definer set search_path = public as $$
  update push_outbox set cancelled_at = now(), cancel_reason = reason
  where task_id = task and sent_at is null and cancelled_at is null
    and kind <> 'test'
    and (only_profile is null or profile_id = only_profile);
$$;

-- ==================================================== 3. what a task change says

create or replace function push_task_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nb        jsonb;
  ob        jsonb := '{}'::jsonb;
  holder    text;
  was       text;
  target    uuid;
  previous  uuid;
  actor     uuid := auth.uid();
  actor_name text := '';
  new_due   text;
  old_due   text;
  new_ev    text;
  old_ev    text;
  change    text;
begin
  /* Everything below is advice, never a condition of saving. Any fault is
     reported as a warning and the task saves exactly as it would have. */
  begin
    if tg_op = 'DELETE' then
      perform push_cancel_pending(old.id, 'task deleted');
      return null;
    end if;

    nb := coalesce(new.body, '{}'::jsonb);
    if tg_op = 'UPDATE' then ob := coalesce(old.body, '{}'::jsonb); end if;

    if coalesce(nb->>'status', new.status) = 'Done' then
      perform push_cancel_pending(new.id, 'task done');
      return null;
    end if;
    -- Rehearsal data never syncs, but say so here too.
    if coalesce(nb->>'sample', 'false') = 'true' then return null; end if;

    holder  := nullif(nb->>'assigneeId', '');
    was     := nullif(ob->>'assigneeId', '');
    new_due := coalesce(nb->>'dueDate', '');
    old_due := coalesce(ob->>'dueDate', '');
    new_ev  := coalesce(nb->>'eventId', new.event_id::text, '');
    old_ev  := case when tg_op = 'UPDATE' then coalesce(ob->>'eventId', old.event_id::text, '') else '' end;

    -- Somebody else holds it now: whatever was waiting for the last holder goes.
    if tg_op = 'UPDATE' and was is not null and was is distinct from holder then
      previous := push_profile_for_person(was);
      if previous is not null then
        perform push_cancel_pending(new.id, 'reassigned', previous);
      end if;
    end if;

    if holder is null then return null; end if;
    if push_event_shelved(new_ev) then return null; end if;

    target := push_profile_for_person(holder);
    if target is null then return null; end if;
    -- Nobody is told about their own change.
    if actor is not null and target = actor then return null; end if;

    if actor is not null then
      select coalesce(full_name, '') into actor_name from profiles where id = actor;
    end if;

    if tg_op = 'INSERT' or holder is distinct from was then
      insert into push_outbox (profile_id, kind, task_id, dedupe_key, detail, not_before)
      values (target, 'assigned', new.id,
              'assigned:' || new.id || ':' || holder || ':' || coalesce(nb->>'updatedAt', now()::text),
              jsonb_build_object('actor', actor_name, 'due', new_due),
              push_not_before(now()))
      on conflict (dedupe_key) do nothing;
      return null;
    end if;

    -- Same holder: a new due date or another activity is what "moved" means.
    if new_due is distinct from old_due or new_ev is distinct from old_ev then
      change := case
        when new_due is distinct from old_due and new_ev is distinct from old_ev then 'both'
        when new_ev is distinct from old_ev then 'event'
        else 'due' end;
      -- An earlier "moved" that has not gone out yet is superseded.
      update push_outbox set cancelled_at = now(), cancel_reason = 'superseded'
      where task_id = new.id and profile_id = target and kind = 'moved'
        and sent_at is null and cancelled_at is null;
      insert into push_outbox (profile_id, kind, task_id, dedupe_key, detail, not_before)
      values (target, 'moved', new.id,
              'moved:' || new.id || ':' || new_due || ':' || new_ev,
              jsonb_build_object('actor', actor_name, 'change', change, 'due', new_due, 'event', new_ev),
              push_not_before(now()))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'push_task_changed skipped for task %: %', coalesce(new.id, old.id), sqlerrm;
  end;
  return null;
end;
$$;

/* AFTER, so it only ever sees what the sync guard let through — a stale copy
   offered again on the hourly round never gets this far. */
drop trigger if exists push_task_changed on tasks;
create trigger push_task_changed after insert or update or delete on tasks
  for each row execute function push_task_changed();

-- ============================================= 4. the daily deadline reminders

/* Due tomorrow, due today, and overdue — once per deadline, for two weeks
   after it passed and never again. Run every morning by pg_cron; running it
   twice in a day says nothing new. */
create or replace function push_enqueue_deadlines(at_time timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  today date := (at_time at time zone 'Asia/Manila')::date;
  added int := 0;
  n     int;
begin
  insert into push_outbox (profile_id, kind, task_id, dedupe_key, detail, not_before)
  select x.profile_id, x.kind, x.id,
         x.kind || ':' || x.id || ':' || x.due,
         jsonb_build_object('due', x.due::text),
         at_time
  from (
    select t.id, d.due, push_profile_for_person(t.body->>'assigneeId') as profile_id,
           case when d.due = today + 1 then 'due_soon'
                when d.due = today then 'due_today'
                else 'overdue' end as kind
    from tasks t
    cross join lateral (select push_valid_date(t.body->>'dueDate') as due) d
    where d.due is not null
      and d.due between today - 14 and today + 1
      and coalesce(t.body->>'status', t.status) <> 'Done'
      and coalesce(t.body->>'sample', 'false') <> 'true'
      and not exists (select 1 from deletions dl where dl.entity = 'task' and dl.entity_id = t.id)
      and not push_event_shelved(coalesce(t.body->>'eventId', t.event_id::text))
  ) x
  where x.profile_id is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- Housekeeping: a month of history is plenty.
  delete from push_outbox where created_at < at_time - interval '30 days'
    and (sent_at is not null or cancelled_at is not null);
  return added;
end;
$$;

-- ======================================================== 5. for the app

-- Default preferences: everything on, but task names stay off the lock screen.
create or replace function push_clean_prefs(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'assigned', coalesce((case when jsonb_typeof(p->'assigned') = 'boolean' then (p->>'assigned')::boolean end), true),
    'moved',    coalesce((case when jsonb_typeof(p->'moved')    = 'boolean' then (p->>'moved')::boolean end), true),
    'due',      coalesce((case when jsonb_typeof(p->'due')      = 'boolean' then (p->>'due')::boolean end), true),
    'overdue',  coalesce((case when jsonb_typeof(p->'overdue')  = 'boolean' then (p->>'overdue')::boolean end), true),
    'details',  coalesce((case when jsonb_typeof(p->'details')  = 'boolean' then (p->>'details')::boolean end), false));
$$;

create or replace function push_me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles
  where id = auth.uid() and active and (valid_until is null or valid_until >= current_date);
$$;

/* This phone, for the account signed in. A browser's push address belongs to
   the browser, not the person: if somebody else signs in on the same computer
   it moves to them, so the last person to sign in is the only one it rings for. */
create or replace function push_subscribe(endpoint text, p256dh text, auth text,
                                          label text default '', prefs jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := push_me();
  row push_subscriptions;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into push_subscriptions as s (profile_id, endpoint, p256dh, auth, label, prefs)
  values (me, push_subscribe.endpoint, push_subscribe.p256dh, push_subscribe.auth,
          left(coalesce(push_subscribe.label, ''), 80), push_clean_prefs(push_subscribe.prefs))
  on conflict on constraint push_subscriptions_endpoint_key do update
    set profile_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
        label = excluded.label, prefs = excluded.prefs,
        failures = 0, last_error = '', updated_at = now()
  returning * into row;
  return jsonb_build_object('id', row.id, 'prefs', row.prefs);
end;
$$;

create or replace function push_set_prefs(endpoint text, prefs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := push_me();
  out jsonb;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  update push_subscriptions s set prefs = push_clean_prefs(push_set_prefs.prefs), updated_at = now()
  where s.endpoint = push_set_prefs.endpoint and s.profile_id = me
  returning s.prefs into out;
  if out is null then raise exception 'This device is not turned on.' using errcode = 'P0002'; end if;
  return out;
end;
$$;

create or replace function push_unsubscribe(endpoint text default null, device uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  me uuid := push_me();
  n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  delete from push_subscriptions s
  where s.profile_id = coalesce(me, auth.uid())
    and ((push_unsubscribe.endpoint is not null and s.endpoint = push_unsubscribe.endpoint)
      or (push_unsubscribe.device is not null and s.id = push_unsubscribe.device));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Which of my phones get notifications. Never the keys or the address itself.
create or replace function push_my_devices()
returns table (id uuid, label text, prefs jsonb, created_at timestamptz,
               last_sent_at timestamptz, failing boolean, endpoint_hash text)
language sql stable security definer set search_path = public, extensions as $$
  select s.id, s.label, s.prefs, s.created_at, s.last_sent_at, s.failures > 0,
         encode(digest(s.endpoint, 'sha256'), 'hex')
  from push_subscriptions s
  where s.profile_id = push_me()
  order by s.created_at;
$$;

-- "Send me a test": to every phone of mine, at most once a minute.
create or replace function push_test() returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := push_me();
  n int;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select count(*) into n from push_subscriptions where profile_id = me;
  if n = 0 then return 0; end if;
  insert into push_outbox (profile_id, kind, dedupe_key, not_before)
  values (me, 'test', 'test:' || me || ':' || to_char(now(), 'YYYYMMDDHH24MI'), now())
  on conflict (dedupe_key) do nothing;
  return n;
end;
$$;

-- The public half of the push key. Empty until the Edge Function has run once.
create or replace function push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value from push_settings where key = 'vapid_public';
$$;

-- ===================================================== 6. for the Edge Function

/* The cron job knocks with a random token kept in Vault. Compared as hashes so
   the comparison takes the same time whatever was sent. */
create or replace function push_check_token(token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select digest(decrypted_secret, 'sha256') = digest(coalesce(token, ''), 'sha256')
    from vault.decrypted_secrets where name = 'push_dispatch_token' limit 1), false)
    and length(coalesce(token, '')) >= 32;
$$;

create or replace function push_vapid() returns table (public_key text, private_jwk text)
language sql stable security definer set search_path = public as $$
  select s.value, v.decrypted_secret
  from push_settings s
  join vault.decrypted_secrets v on v.name = 'push_vapid_private'
  where s.key = 'vapid_public';
$$;

-- Kept the first time only: once a phone has subscribed against a key, changing
-- it would silence every phone, so a second call keeps what is there.
create or replace function push_store_vapid(public_key text, private_jwk text) returns text
language plpgsql security definer set search_path = public as $$
declare
  have text;
begin
  perform pg_advisory_xact_lock(hashtext('fcusr push vapid'));
  select value into have from push_settings where key = 'vapid_public';
  if have is not null then return have; end if;
  if public_key !~ '^[A-Za-z0-9_-]{80,100}$' then raise exception 'Not a P-256 public key.'; end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_vapid_private') then
    perform vault.create_secret(private_jwk, 'push_vapid_private',
      'Private half of the FCUSR Tracker web push key. Made by push-dispatch. Never share.');
  end if;
  insert into push_settings (key, value) values ('vapid_public', public_key);
  return public_key;
end;
$$;

/* What to send now. Claims due lines (nobody else can claim them for ten
   minutes), checks each one is still true, and returns one row per phone that
   wants it. A line that is no longer true is cancelled with the reason; a line
   nobody has a phone for is closed. */
create or replace function push_claim(max_rows int default 200)
returns table (outbox_id bigint, subscription_id uuid, endpoint text, p256dh text, auth text,
               details boolean, kind text, task_id uuid, task_title text, event_title text,
               due text, detail jsonb, dedupe_key text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  r       record;
  t       record;
  today   date := (now() at time zone 'Asia/Manila')::date;
  why     text;
  due_d   date;
  wanted  text;
  sent    int;
begin
  -- Five tries is enough; a line that cannot be delivered by then is let go.
  update push_outbox o set cancelled_at = now(), cancel_reason = 'gave up'
  where o.sent_at is null and o.cancelled_at is null and o.attempts >= 5
    and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes');

  for r in
    with c as (
      select o.id from push_outbox o
      where o.sent_at is null and o.cancelled_at is null and o.not_before <= now()
        and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
      order by o.id
      limit greatest(1, least(coalesce(max_rows, 200), 1000))
      for update skip locked)
    update push_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from c where o.id = c.id
    returning o.*
  loop
    why := null;
    -- Fresh for every line, so nothing of the last task can leak into this one.
    select null::uuid as id, ''::text as title, '{}'::jsonb as body, null::uuid as event_id into t;
    if r.kind <> 'test' then
      select tk.id, tk.title, tk.body, tk.event_id into t from tasks tk where tk.id = r.task_id;
      if t.id is null
         or exists (select 1 from deletions d where d.entity = 'task' and d.entity_id = r.task_id) then
        why := 'task gone';
      elsif coalesce(t.body->>'status', '') = 'Done' then
        why := 'task done';
      elsif push_profile_for_person(t.body->>'assigneeId') is distinct from r.profile_id then
        why := 'no longer theirs';
      elsif push_event_shelved(coalesce(t.body->>'eventId', t.event_id::text)) then
        why := 'activity shelved';
      else
        due_d := push_valid_date(t.body->>'dueDate');
        if r.kind in ('due_soon', 'due_today', 'overdue') then
          wanted := case when due_d = today + 1 then 'due_soon'
                         when due_d = today then 'due_today'
                         when due_d < today then 'overdue' end;
          if due_d is null or (t.body->>'dueDate') <> (r.detail->>'due') or wanted is distinct from r.kind then
            why := 'deadline changed';
          end if;
        elsif r.kind = 'moved' then
          if coalesce(t.body->>'dueDate', '') <> coalesce(r.detail->>'due', '')
             or coalesce(t.body->>'eventId', t.event_id::text, '') <> coalesce(r.detail->>'event', '') then
            why := 'moved again';
          end if;
        end if;
      end if;
    end if;

    if why is not null then
      update push_outbox set cancelled_at = now(), cancel_reason = why where id = r.id;
      continue;
    end if;

    sent := 0;
    for outbox_id, subscription_id, endpoint, p256dh, auth, details in
      select r.id, s.id, s.endpoint, s.p256dh, s.auth, coalesce((s.prefs->>'details')::boolean, false)
      from push_subscriptions s
      where s.profile_id = r.profile_id
        and push_wants(s.prefs, r.kind)
        and not exists (select 1 from push_deliveries d
                        where d.outbox_id = r.id and d.subscription_id = s.id
                          and (d.status between 200 and 299 or d.status in (400, 403, 404, 410, 413)))
    loop
      kind := r.kind;
      task_id := r.task_id;
      task_title := case when r.kind = 'test' then '' else coalesce(nullif(t.body->>'title', ''), t.title, '') end;
      event_title := case when r.kind = 'test' then '' else coalesce((
        select coalesce(nullif(e.body->>'title', ''), e.title) from events e
        where e.id::text = coalesce(t.body->>'eventId', t.event_id::text)), '') end;
      due := case when r.kind = 'test' then '' else coalesce(t.body->>'dueDate', '') end;
      detail := r.detail;
      dedupe_key := r.dedupe_key;
      created_at := r.created_at;
      sent := sent + 1;
      return next;
    end loop;

    if sent = 0 then
      update push_outbox set sent_at = now(),
        cancel_reason = case when exists (select 1 from push_subscriptions s where s.profile_id = r.profile_id)
                             then 'already delivered or turned off' else 'no device' end
      where id = r.id;
    end if;
  end loop;
end;
$$;

/* What happened. results is a list of {outbox_id, subscription_id, status}:
   2xx delivered; 404/410 the phone has gone (forget it); 400/403/413 will
   never work (record, do not retry); anything else, including 0 for a network
   failure, is tried again with a growing wait. */
create or replace function push_report(results jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x       jsonb;
  o_id    bigint;
  s_id    uuid;
  code    int;
  gone    int := 0;
  ok      int := 0;
  retry   int := 0;
  o       record;
begin
  for x in select * from jsonb_array_elements(coalesce(results, '[]'::jsonb)) loop
    o_id := (x->>'outbox_id')::bigint;
    s_id := (x->>'subscription_id')::uuid;
    code := coalesce((x->>'status')::int, 0);
    if code in (404, 410) then
      delete from push_subscriptions where id = s_id;
      gone := gone + 1;
      continue;
    end if;
    if not exists (select 1 from push_subscriptions where id = s_id) then continue; end if;
    insert into push_deliveries (outbox_id, subscription_id, status) values (o_id, s_id, code)
    on conflict (outbox_id, subscription_id) do update set status = excluded.status, at = now();
    if code between 200 and 299 then
      update push_subscriptions set last_sent_at = now(), failures = 0, last_error = '' where id = s_id;
      ok := ok + 1;
    else
      update push_subscriptions set failures = failures + 1,
             last_error = left(coalesce(x->>'error', 'HTTP ' || code), 200)
      where id = s_id;
      -- A phone that has failed ten times in a row is not coming back.
      delete from push_subscriptions where id = s_id and failures >= 10;
      if code not in (400, 403, 413) then retry := retry + 1; end if;
    end if;
  end loop;

  -- Close every line that has nothing left to do; set the rest up for a retry.
  for o in
    select distinct (x2->>'outbox_id')::bigint as id
    from jsonb_array_elements(coalesce(results, '[]'::jsonb)) x2
  loop
    if not exists (
      select 1 from push_outbox ob
      join push_subscriptions s on s.profile_id = ob.profile_id and push_wants(s.prefs, ob.kind)
      where ob.id = o.id
        and not exists (select 1 from push_deliveries d where d.outbox_id = ob.id and d.subscription_id = s.id
                          and (d.status between 200 and 299 or d.status in (400, 403, 413)))) then
      update push_outbox set sent_at = coalesce(sent_at, now()) where id = o.id and cancelled_at is null;
    else
      update push_outbox ob set claimed_at = null,
             not_before = now() + make_interval(mins => least(60, (1 << least(ob.attempts, 6))))
      where ob.id = o.id and ob.sent_at is null and ob.cancelled_at is null;
    end if;
  end loop;
  return jsonb_build_object('delivered', ok, 'forgotten', gone, 'retrying', retry);
end;
$$;

-- ============================================================ 7. who may call

do $$
declare f text;
begin
  -- Everything is closed first, then opened to exactly who needs it.
  foreach f in array array[
    'push_profile_for_person(text)', 'push_event_shelved(text)', 'push_not_before(timestamptz)',
    'push_valid_date(text)', 'push_wants(jsonb, text)', 'push_cancel_pending(uuid, text, uuid)', 'push_task_changed()',
    'push_enqueue_deadlines(timestamptz)', 'push_clean_prefs(jsonb)', 'push_me()',
    'push_subscribe(text, text, text, text, jsonb)', 'push_set_prefs(text, jsonb)',
    'push_unsubscribe(text, uuid)', 'push_my_devices()', 'push_test()', 'push_public_key()',
    'push_check_token(text)', 'push_vapid()', 'push_store_vapid(text, text)',
    'push_claim(int)', 'push_report(jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    begin
      execute format('revoke all on function %s from anon, authenticated', f);
    exception when undefined_object then null; end;
  end loop;
end $$;

grant execute on function push_subscribe(text, text, text, text, jsonb) to authenticated;
grant execute on function push_set_prefs(text, jsonb)                   to authenticated;
grant execute on function push_unsubscribe(text, uuid)                  to authenticated;
grant execute on function push_my_devices()                             to authenticated;
grant execute on function push_test()                                   to authenticated;
grant execute on function push_public_key()                             to anon, authenticated;

-- ===================================================== the vocabulary check

do $$
declare
  v   text;
  bad text := '';
  p   uuid;
begin
  select id into p from profiles limit 1;
  if p is null then raise notice 'No accounts yet — vocabulary check skipped.'; return; end if;
  foreach v in array array['assigned','moved','due_soon','due_today','overdue','test'] loop
    begin
      insert into push_outbox (profile_id, kind, dedupe_key) values (p, v, 'vocabulary check ' || v);
      delete from push_outbox where dedupe_key = 'vocabulary check ' || v;
    exception when others then
      bad := bad || 'push_outbox.kind refuses "' || v || '". ';
    end;
  end loop;
  if bad <> '' then raise exception 'The server can say things this database refuses: %', bad; end if;
end $$;

-- ================================================================ did it take?

select 'phones can be remembered, by their own account only' as needed,
       to_regclass('public.push_subscriptions') is not null
       and exists (select 1 from pg_policies where tablename = 'push_subscriptions'
                     and policyname = 'push_subscriptions_read') as done
union all select 'a task change can say something',
       exists (select 1 from pg_trigger where tgname = 'push_task_changed' and not tgisinternal)
union all select 'every line is said once',
       exists (select 1 from pg_indexes where tablename = 'push_outbox' and indexdef like '%(dedupe_key)%')
union all select 'the app cannot read the outbox',
       not has_table_privilege('authenticated', 'push_outbox', 'select')
union all select 'the app cannot send on its own',
       not has_function_privilege('authenticated', 'push_claim(int)', 'execute')
       and not has_function_privilege('anon', 'push_vapid()', 'execute')
union all select 'Vault is there for the private key',
       to_regclass('vault.decrypted_secrets') is not null
union all select 'quiet hours hold a 23:00 message until 07:00',
       push_not_before('2026-10-27 15:00+00'::timestamptz) = '2026-10-27 23:00+00'::timestamptz
order by 1;
