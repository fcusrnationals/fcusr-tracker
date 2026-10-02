-- FCUSR Task Tracker — who handled a letter, kept safe through sync
--
-- Run this in Supabase → SQL Editor after sync3-fix.sql. Safe to run twice.
--
-- A letter's trail now records, at every office, who signed or processed it
-- and which officer logged each step (processedBy, receivedLoggedBy,
-- releasedLoggedBy). Those live inside each stop of the letter.
--
-- The freshness guard already keeps a field that an older phone has never
-- heard of — but only one level deep (`old.body || new.body`). A letter's
-- stops are a list, so the whole list was replaced: a phone that had not been
-- reloaded since the update could record one step and, without meaning to,
-- write every "processed by" on that letter out of the council's database.
--
-- This teaches the guard to merge a letter's stops one stop at a time, matched
-- by the stop's id: a key the arriving stop does not carry is kept from the
-- stored one. Everything else about the guard is exactly as sync3-fix.sql left
-- it. The triggers call this function by name, so replacing it is enough.
--
-- What it does NOT do: bring back a stop the phone removed (the arriving list
-- decides which stops exist and in what order), or keep a value the phone
-- deliberately cleared (an undo writes the key as empty, and that wins).

-- ---------------------------------------------------------- merge_stops
-- Each arriving stop laid over the stored stop with the same id. A stop that
-- is new, or has no id, arrives as it is.
create or replace function merge_stops(old_stops jsonb, new_stops jsonb) returns jsonb
language sql immutable as $$
  select case
    when new_stops is null or jsonb_typeof(new_stops) <> 'array' then new_stops
    when old_stops is null or jsonb_typeof(old_stops) <> 'array' then new_stops
    else coalesce((
      select jsonb_agg(
               case when jsonb_typeof(n.s) = 'object' and jsonb_typeof(o.s) = 'object'
                    then o.s || n.s else n.s end
               order by n.ord)
      from jsonb_array_elements(new_stops) with ordinality as n(s, ord)
      left join lateral (
        select x.s from jsonb_array_elements(old_stops) as x(s)
        where jsonb_typeof(n.s) = 'object' and n.s ? 'id'
          and jsonb_typeof(x.s) = 'object' and x.s->>'id' = n.s->>'id'
        limit 1
      ) o on true
    ), '[]'::jsonb)
  end;
$$;

-- ----------------------------------------------------------- sync_guard
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
     round. Only for what a PHONE sends — see sync3-fix.sql. */
  if current_user in ('anon', 'authenticated')
     and old_stamp <> '' and new_stamp <> '' and new_stamp <= old_stamp then
    return null;
  end if;

  -- Fields the sender has never heard of are kept, not dropped.
  if jsonb_typeof(new.body) = 'object' and jsonb_typeof(old.body) = 'object' then
    new.body := old.body || new.body;
  end if;

  /* And on a letter, the same one level further down: each stop keeps the
     keys an older phone did not send. Read and written through jsonb, so this
     names no column that another table lacks. */
  if kind = 'letter' then
    if jsonb_typeof(new.body) = 'object' and new.body ? 'stops' then
      new.body := jsonb_set(new.body, '{stops}',
        merge_stops(old.body->'stops', new.body->'stops'));
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('stops',
      merge_stops(to_jsonb(old)->'stops', to_jsonb(new)->'stops')));
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ================================================================ did it take?

select 'the guard still judges only what phones send' as needed,
       pg_get_functiondef('public.sync_guard()'::regprocedure) like '%current_user in%' as done
union all select 'a letter''s stops are merged one stop at a time',
       pg_get_functiondef('public.sync_guard()'::regprocedure) like '%merge_stops%'
union all select 'a stop keeps what an older phone did not send',
       merge_stops('[{"id":"a","processedBy":"Dean"}]'::jsonb, '[{"id":"a","outcome":"Approved"}]'::jsonb)
         = '[{"id":"a","processedBy":"Dean","outcome":"Approved"}]'::jsonb
union all select 'a cleared value stays cleared',
       merge_stops('[{"id":"a","processedBy":"Dean"}]'::jsonb, '[{"id":"a","processedBy":""}]'::jsonb)
         = '[{"id":"a","processedBy":""}]'::jsonb
union all select 'a removed stop stays removed',
       jsonb_array_length(merge_stops('[{"id":"a"},{"id":"b"}]'::jsonb, '[{"id":"a"}]'::jsonb)) = 1
union all select 'every synced table still uses the guard',
       (select count(*) from pg_trigger
         where tgname like 'sync\_guard\_%' and not tgisinternal) >= 7;
