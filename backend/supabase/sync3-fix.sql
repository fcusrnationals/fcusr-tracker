-- FCUSR Task Tracker — sync3.sql, one correction
--
-- Run this in Supabase → SQL Editor after sync3.sql. Safe to run twice.
--
-- The freshness guard in sync3.sql judged every write, including the
-- database's own functions (switching somebody to a username, a volunteer
-- rejoining with a code). Those stamp a record with the server's clock; if a
-- phone with a fast watch had touched the record last, the server's change
-- lost to it and vanished without a word. It now judges only what the app
-- sends. The triggers call this function by name, so replacing it is enough.

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
     making every other phone re-download the whole database once an hour.

     Only for what a PHONE sends. A request from the app runs as `anon` or
     `authenticated`; the database's own functions — switching somebody to a
     username, a volunteer rejoining with a code — run as their owner, and
     they stamp the record with the server's clock. If a phone with a fast
     watch had touched that record last, its stamp is in the future, and the
     server's own change would lose to it and vanish without a word. The
     database is the authority on what it does itself; it is not asked to
     out-date a phone's watch to be allowed to do it. */
  if current_user in ('anon', 'authenticated')
     and old_stamp <> '' and new_stamp <> '' and new_stamp <= old_stamp then
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

select 'the guard judges only what phones send' as needed,
       pg_get_functiondef('public.sync_guard()'::regprocedure) like '%current_user in%' as done
union all select 'every synced table still uses it',
       (select count(*) from pg_trigger
         where tgname like 'sync\_guard\_%' and not tgisinternal) >= 7;
