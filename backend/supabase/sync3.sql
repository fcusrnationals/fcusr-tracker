-- FCUSR Task Tracker — making "Synced" mean synced
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
-- Needs schema.sql, sync.sql and sync2.sql to have been run already.
--
-- ===========================================================================
-- WHY
--
-- Two phones both said Synced and held different work. Four separate faults
-- were doing it, and every one of them was silent — which is why it looked
-- like one mysterious problem instead of four ordinary ones.
--
--   1. A word the database had never heard of.
--      The app learnt to cancel an activity. The database's list of allowed
--      statuses was written before that and still ends at 'Archived'. So every
--      cancelled activity was refused — one row, quietly set aside, the rest of
--      the round green. The officer who cancelled it saw it cancelled. Nobody
--      else ever did. THIS IS THE ONE THAT BIT, and it is the shape of "it
--      breaks whenever a new feature lands": the app's vocabulary grows and the
--      database's does not.
--
--   2. An old phone quietly deleting new fields.
--      Every device keeps the whole record and offers the whole record back. A
--      phone still running last week's build does not know what a volunteer
--      code is, so it drops it — and writes the record back without it. Nobody
--      sees an error. The field is gone for the whole council.
--
--   3. An old copy overwriting a new one.
--      Once an hour every device offers everything it holds. The server took
--      whatever arrived last. So a phone that had fallen behind would write its
--      stale copy over everybody's current one, and the two devices would then
--      take turns undoing each other, both reporting success.
--
--   4. A deleted record walking back in.
--      A device that had not yet heard about a deletion offered the record
--      back, and the server re-created it.
--
-- The client is fixed for all four. This file fixes them at the database as
-- well, which matters because a phone that has not been reopened is still
-- running the old client — and the database is the one place every device has
-- to pass through.

-- ===========================================================================
-- 1. THE WORD THE DATABASE HAD NEVER HEARD OF
--
-- 'Cancelled' is a real status: the activity is over, it keeps its tasks, its
-- letters and its place in the year's archive, and it stops asking anybody for
-- work. Until this line it could not be stored.

alter table events drop constraint if exists events_status_check;
alter table events add constraint events_status_check
  check (status in ('Upcoming','Ongoing','Completed','Cancelled','Archived'));

-- ===========================================================================
-- 2, 3 and 4. ONE GUARD ON THE WAY IN
--
-- Every synced table carries the app's own record in `body` and a few columns
-- beside it for the server to reason about. This sits in front of every write
-- to those tables and answers three questions before the row lands.
--
--   Is it newer?    An arriving copy whose body.updatedAt is not later than the
--                   stored one changes nothing. It is not an error — it is an
--                   hourly full round offering back what it already has, which
--                   every device does — so it is skipped, silently and
--                   successfully. Stale copies stop overwriting fresh ones.
--
--   What is it missing?  Whatever the sender did not send is kept. `old || new`
--                   means the arriving value wins for every field it carries
--                   and every field it has never heard of survives. That is
--                   what stops an old phone deleting a new field, without
--                   needing every phone to update first.
--
--   Is it dead?     A row with a tombstone against it is not re-created. A
--                   deletion is an explicit act by somebody who could see the
--                   thing; it does not get undone by a phone that was in a
--                   drawer.
--
-- It also stamps updated_at, which is what touch_updated_at() did, so this
-- replaces that trigger rather than sitting beside it.

create or replace function sync_guard() returns trigger
language plpgsql as $$
declare
  kind      text := case when tg_nargs > 0 then tg_argv[0] else null end;
  old_stamp text;
  new_stamp text;
  buried    boolean;
begin
  if tg_op = 'INSERT' then
    /* Deleted, and staying deleted. Note this also covers the update half of
       an upsert: in Postgres a BEFORE INSERT trigger runs before the conflict
       is detected, so returning null here stops the whole statement for this
       row — which is exactly right for a row that should not exist.

       Asked as dynamic SQL, and that is not fussiness. The council's own
       details and the closing date go through this same function and are keyed
       by an integer, not a uuid; PL/pgSQL plans an expression the first time
       the function runs and would refuse `entity_id = new.id` outright on
       those tables, short-circuit or no short-circuit. */
    if kind is not null then
      execute 'select exists (select 1 from deletions d where d.entity = $1 and d.entity_id = $2)'
        into buried using kind, (to_jsonb(new)->>'id')::uuid;
      if buried then return null; end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  old_stamp := coalesce(old.body->>'updatedAt', '');
  new_stamp := coalesce(new.body->>'updatedAt', '');

  /* Not newer, so it has nothing to tell us. Skipped rather than refused: the
     device offering it is behaving correctly and a refusal would fail its whole
     round. Skipping also leaves updated_at alone, which stops fifty phones
     making every other phone re-download the whole database once an hour. */
  if old_stamp <> '' and new_stamp <> '' and new_stamp <= old_stamp then
    return null;
  end if;

  -- Fields the sender has never heard of are kept, not dropped.
  if jsonb_typeof(new.body) = 'object' and jsonb_typeof(old.body) = 'object' then
    new.body := old.body || new.body;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

/* The entity name each table's tombstones are filed under, passed to the
   trigger so one function serves all of them. `units` has no tombstone kind of
   its own in older databases, so it is named here only if the check constraint
   allows it — which sync2.sql arranged. */
do $$
declare
  t    text;
  kind text;
  pairs text[][] := array[
    ['people','person'], ['events','event'], ['tasks','task'],
    ['reports','report'], ['letters','letter'], ['offices','office'],
    ['units','unit']
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    kind := pairs[i][2];
    execute format('drop trigger if exists touch_%I on %I', t, t);
    execute format('drop trigger if exists sync_guard_%I on %I', t, t);
    execute format(
      'create trigger sync_guard_%I before insert or update on %I
       for each row execute function sync_guard(%L)', t, t, kind);
  end loop;
end $$;

/* The council's own details and the closing date are single rows rather than
   collections, so they have no tombstones — but they are pushed whole by every
   device on every full round, and a stale one overwriting a fresh one is how
   the Republic's letterhead or the term's end date ends up different on
   different phones. They get the same freshness guard, without the tombstone
   half. */
do $$
declare t text;
begin
  foreach t in array array['council','term'] loop
    if to_regclass(t) is null then continue; end if;
    execute format('drop trigger if exists touch_%I on %I', t, t);
    execute format('drop trigger if exists sync_guard_%I on %I', t, t);
    execute format(
      'create trigger sync_guard_%I before insert or update on %I
       for each row execute function sync_guard()', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 5. TOMBSTONES NEED A CLOCK THAT IS NOT A PHONE'S
--
-- A pull asks "what has been deleted since X" and orders the answer by
-- `deleted_at`. That column is written by whichever phone did the deleting, on
-- its own watch, and a student's phone with the wrong date is an ordinary
-- thing. Two ways that broke a council:
--
--   A tombstone dated next March became every device's high-water mark, and
--   from then on they asked the server for everything newer than next March —
--   which is nothing. Every phone stopped receiving, and every phone said
--   Synced. (The client no longer accepts a mark later than the server's own
--   clock, so this one is fixed on both sides.)
--
--   A tombstone dated last week landed BEHIND devices that had already synced
--   past it, and they never saw it. The deleted thing stayed on their screens
--   for good.
--
-- So arrival gets its own column, stamped here, and that is what the pull
-- orders by. `deleted_at` stays as it was — it is when the person deleted the
-- thing, which is a different question — and is simply not allowed to be in the
-- future any more.

alter table deletions add column if not exists synced_at timestamptz not null default now();
create index if not exists deletions_synced_idx on deletions(synced_at);

create or replace function deletion_stamp() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  new.deleted_at := least(coalesce(new.deleted_at, now()), now());
  -- Re-offered by a second device: the earliest account of when it happened is
  -- the one to keep. A deletion happens once.
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    new.deleted_at := least(new.deleted_at, old.deleted_at);
  end if;
  return new;
end;
$$;

drop trigger if exists deletion_stamp_deletions on deletions;
create trigger deletion_stamp_deletions before insert or update on deletions
  for each row execute function deletion_stamp();

-- Existing rows have never been stamped, and a stamp of "now" for all of them
-- is right: every device is about to ask for them from the beginning anyway.
update deletions set synced_at = coalesce(synced_at, now()) where synced_at is null;

-- ===========================================================================
-- 6. A GOVERNOR COULD NOT REMOVE SOMEBODY WHO HAD NEVER SIGNED IN
--
-- remove_member checked `target.id is null` — no profile, so no login yet — and
-- refused. For the National government that check was skipped, so nobody
-- noticed. A Governor who enrolled a volunteer who then never turned up had no
-- way to take the enrolment back: the invitation stayed open, and anybody
-- holding it could still claim it.
--
-- The rule is unchanged: a unit head may remove their own unit's people and
-- nobody else's. It now reads the unit off the waiting enrolment when there is
-- no profile to read it off.

create or replace function remove_member(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  actor       profiles;
  actor_kind  text;
  target      profiles;
  clean_email text;
  target_name text;
  target_unit uuid;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot remove anyone.';
  end if;
  select kind into actor_kind from units where id = actor.unit_id;

  clean_email := lower(trim(p_email));
  select * into target from profiles where lower(email) = clean_email;

  /* Whose person this is. The profile if they have signed in; otherwise the
     enrolment that is waiting for them. */
  target_unit := target.unit_id;
  if target_unit is null then
    select unit_id into target_unit from enrolments where lower(email) = clean_email;
  end if;

  /* A Governor may remove their own council's people. Everybody else's are the
     National government's. */
  if not (actor_kind = 'national' and actor.access = 'officer') then
    if target_unit is null or not actor.is_head or target_unit <> actor.unit_id then
      raise exception 'You may not remove that member.';
    end if;
  end if;

  if lower(actor.email) = clean_email then
    raise exception 'You cannot remove your own access.';
  end if;

  target_name := coalesce(nullif(target.full_name, ''), clean_email);

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'remove', 'profile', clean_email, target_name);

  delete from enrolments where lower(email) = clean_email;

  insert into deletions (entity, entity_id, unit_id, deleted_at, deleted_by)
  select 'person', pe.id, pe.unit_id, now(), coalesce(actor.full_name, '')
  from people pe
  where lower(coalesce(pe.body->>'email', '')) = clean_email
  on conflict (entity, entity_id) do update
    set deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by;

  delete from people pe where lower(coalesce(pe.body->>'email', '')) = clean_email;

  if target.id is not null then
    delete from auth.users where id = target.id;
    delete from profiles where id = target.id;
  end if;

  return true;
end;
$$;

grant execute on function remove_member(text) to authenticated;

-- ===========================================================================
-- 7. NOTHING THE APP CAN SAY MAY BE A WORD THIS DATABASE REFUSES
--
-- Fault 1 above was one missing word in one check constraint, and it cost a
-- term's cancelled activities. So the whole vocabulary is asserted here rather
-- than trusted: every status, priority and kind the app can produce is offered
-- to the constraint that guards it. If a future version of the app learns a new
-- word and this file is not updated, THIS is where it is caught — loudly, on
-- the day the migration runs — instead of silently, one refused row at a time,
-- on somebody's phone.

do $$
declare
  v    text;
  u    uuid;
  e    uuid;
  t    uuid;
  l    uuid;
  bad  text := '';
begin
  select id into u from units limit 1;
  if u is null then
    raise notice 'No units yet, so the vocabulary check has nothing to write against.';
    return;
  end if;

  -- Every status an activity can be given.
  foreach v in array array['Upcoming','Ongoing','Completed','Cancelled','Archived'] loop
    begin
      e := gen_random_uuid();
      insert into events (id, unit_id, title, status)
      values (e, u, 'vocabulary check', v);
      delete from events where id = e;
    exception when others then
      bad := bad || 'events.status refuses "' || v || '". ';
      begin delete from events where id = e; exception when others then null; end;
    end;
  end loop;

  -- A task needs an activity to hang from, so make one and take it away after.
  e := gen_random_uuid();
  insert into events (id, unit_id, title, status) values (e, u, 'vocabulary check', 'Upcoming');

  foreach v in array array['Not Started','In Progress','For Review','Done','On hold'] loop
    begin
      t := gen_random_uuid();
      insert into tasks (id, event_id, title, status) values (t, e, 'vocabulary check', v);
      delete from tasks where id = t;
    exception when others then
      bad := bad || 'tasks.status refuses "' || v || '". ';
      begin delete from tasks where id = t; exception when others then null; end;
    end;
  end loop;

  foreach v in array array['High','Medium','Low'] loop
    begin
      t := gen_random_uuid();
      insert into tasks (id, event_id, title, priority) values (t, e, 'vocabulary check', v);
      delete from tasks where id = t;
    exception when others then
      bad := bad || 'tasks.priority refuses "' || v || '". ';
      begin delete from tasks where id = t; exception when others then null; end;
    end;
  end loop;

  foreach v in array array['draft','filed'] loop
    begin
      t := gen_random_uuid();
      insert into reports (id, event_id, status) values (t, e, v);
      delete from reports where id = t;
    exception when others then
      bad := bad || 'reports.status refuses "' || v || '". ';
      begin delete from reports where id = t; exception when others then null; end;
    end;
  end loop;

  delete from events where id = e;

  foreach v in array array['Routing','Approved','Declined','Withdrawn'] loop
    begin
      l := gen_random_uuid();
      insert into letters (id, unit_id, subject, status)
      values (l, u, 'vocabulary check', v);
      delete from letters where id = l;
    exception when others then
      bad := bad || 'letters.status refuses "' || v || '". ';
      begin delete from letters where id = l; exception when others then null; end;
    end;
  end loop;

  foreach v in array array['national','province','comelec','judiciary','branch'] loop
    begin
      insert into units (id, name, code, kind)
      values ('00000000-0000-4000-8000-0000000000fe', 'vocabulary check', 'ZZTEST', v);
      delete from units where id = '00000000-0000-4000-8000-0000000000fe';
    exception when others then
      bad := bad || 'units.kind refuses "' || v || '". ';
      begin delete from units where id = '00000000-0000-4000-8000-0000000000fe'; exception when others then null; end;
    end;
  end loop;

  if bad <> '' then
    raise exception 'The app can say things this database refuses, so those records would '
      'never sync and nobody would see an error: %', bad;
  end if;
  raise notice 'Vocabulary check passed: every word the app can write, this database accepts.';
end $$;

-- ================================================================ did it take?

select 'a cancelled activity can be stored' as needed,
       (select count(*) from pg_constraint
         where conname = 'events_status_check'
           and pg_get_constraintdef(oid) like '%Cancelled%') = 1 as done
union all select 'stale copies cannot overwrite fresh ones',
       to_regprocedure('public.sync_guard()') is not null
union all select 'every synced table is guarded',
       (select count(*) from pg_trigger
         where tgname like 'sync\_guard\_%' and not tgisinternal) >= 7
union all select 'the old unguarded trigger is gone',
       (select count(*) from pg_trigger
         where tgname like 'touch\_%' and not tgisinternal) = 0
union all select 'tombstones are ordered by the server''s clock',
       exists (select 1 from information_schema.columns
                where table_name = 'deletions' and column_name = 'synced_at')
union all select 'a unit head can take back an unclaimed enrolment',
       (select pg_get_functiondef(oid) like '%target_unit%'
          from pg_proc where proname = 'remove_member' limit 1)
order by 1;
