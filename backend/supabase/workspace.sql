-- FCUSR Task Tracker — the workspace update: Bulletin Board, acknowledgements,
-- and event templates
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
-- Needs schema.sql, sync.sql, sync2.sql, security.sql and sync3.sql to have
-- been run already (they have, on the council's project).
--
-- ===========================================================================
-- WHAT THIS ADDS
--
-- Three tables, shaped like every other synced table: a few columns the
-- database reasons about, and the app's own record in `body`.
--
--   announcements      The Bulletin Board. Only the FCUSR Nationals write it.
--                      Everybody else reads what is addressed to them — the
--                      whole Republic, the National officers, chosen units, or
--                      chosen people — and nobody but the Nationals sees a
--                      draft.
--
--   acknowledgements   "I have read this." One row per account per
--                      announcement. An account may write only its own; the
--                      Nationals read all of them, which is how they see
--                      "87 of 103 acknowledged".
--
--   templates          An event's usual list of tasks, kept for next time. A
--                      unit's officers keep their own; only the Nationals may
--                      share one with every unit.
--
-- Until this runs, the site still works: these three simply stay on the phone
-- that made them, and the Bulletin Board says it is waiting for this step.
--
-- Academic years need nothing here. Which years are archived is council setup
-- and rides in the council row, which already syncs.
--
-- Photos for the Watermark Studio are never uploaded. They are processed on the
-- phone and stay there.

-- ------------------------------------------------------------------ helpers
-- Asked as the owner, so a policy that calls them never runs another table's
-- policy and cannot loop. Named for this file so they do not depend on which
-- of the earlier optional migrations a project happens to have run.

create or replace function ws_is_officer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and active and access = 'officer'
  );
$$;

create or replace function ws_my_unit() returns uuid
language sql stable security definer set search_path = public as $$
  select unit_id from profiles where id = auth.uid() and active;
$$;

-- Is this directory entry the person signed in? Joined by the address their
-- account was made with, which is the one thing the two records share.
create or replace function ws_is_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from people pe join profiles pr on pr.id = auth.uid()
    where pe.id = pid and pr.active
      and lower(coalesce(pe.body->>'email', '')) = lower(pr.email)
  );
$$;

grant execute on function ws_is_officer()     to authenticated;
grant execute on function ws_my_unit()        to authenticated;
grant execute on function ws_is_person(uuid)  to authenticated;

-- ============================================================ announcements

create table if not exists announcements (
  id              uuid primary key,
  unit_id         uuid references units(id) on delete set null,
  title           text not null default '',
  published       boolean not null default true,
  audience        text not null default 'everyone',
  audience_units  uuid[] not null default '{}',
  audience_people uuid[] not null default '{}',
  body            jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

alter table announcements drop constraint if exists announcements_audience_check;
alter table announcements add constraint announcements_audience_check
  check (audience in ('everyone', 'nationals', 'units', 'people'));

create index if not exists announcements_updated_idx on announcements(updated_at);

alter table announcements enable row level security;

/* Who reads an announcement.

   The National officers read all of them, drafts included — they write them.
   Anybody else reads a published one addressed to them: every officer for
   "everyone", their own unit for "units", themselves by name for "people".
   A volunteer is reached only by name; they were taken on for one activity,
   not for the Republic's business.

   A scheduled announcement is delivered to phones early and shown on its
   date. That is a choice about the screen, not a secret: nothing sensitive
   waits in a schedule, and holding rows back here would leave phones that
   synced before the date without it for up to an hour. */
drop policy if exists announcements_read on announcements;
create policy announcements_read on announcements for select using (
  is_national()
  or (published and (
        (audience = 'everyone' and ws_is_officer())
     or (audience = 'units' and ws_is_officer() and ws_my_unit() = any(audience_units))
     or (audience = 'people' and exists (
           select 1 from unnest(audience_people) p where ws_is_person(p)))
  ))
);

-- Only the FCUSR Nationals publish, edit, pin and remove.
drop policy if exists announcements_write on announcements;
create policy announcements_write on announcements for all
  using (is_national()) with check (is_national());

-- ========================================================= acknowledgements

create table if not exists acknowledgements (
  id               uuid primary key,
  announcement_id  uuid references announcements(id) on delete cascade,
  profile_id       uuid references profiles(id) on delete cascade,
  body             jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

create index if not exists acknowledgements_updated_idx on acknowledgements(updated_at);
create index if not exists acknowledgements_ann_idx on acknowledgements(announcement_id);

alter table acknowledgements enable row level security;

-- Your own, and the Nationals read everybody's — that is the whole count.
drop policy if exists acknowledgements_read on acknowledgements;
create policy acknowledgements_read on acknowledgements for select using (
  profile_id = auth.uid() or is_national()
);

/* Nobody acknowledges on somebody else's behalf. The row must be the account
   writing it, and the announcement must be one that account can read — you
   cannot say you have read a notice that was never sent to you. */
drop policy if exists acknowledgements_write on acknowledgements;
create policy acknowledgements_write on acknowledgements for insert with check (
  profile_id = auth.uid()
  and exists (select 1 from announcements a where a.id = announcement_id)
);

drop policy if exists acknowledgements_update on acknowledgements;
create policy acknowledgements_update on acknowledgements for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists acknowledgements_delete on acknowledgements;
create policy acknowledgements_delete on acknowledgements for delete
  using (profile_id = auth.uid() or is_national());

-- ================================================================ templates

create table if not exists templates (
  id          uuid primary key,
  unit_id     uuid references units(id) on delete cascade,
  shared      boolean not null default false,
  name        text not null default '',
  body        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists templates_updated_idx on templates(updated_at);

alter table templates enable row level security;

-- A unit's own, and every one the Nationals have shared.
drop policy if exists templates_read on templates;
create policy templates_read on templates for select using (
  auth.uid() is not null and (shared or sees_unit(unit_id))
);

/* A unit's officers keep their unit's templates. Sharing one with the whole
   Republic is the National government's call, so only a national officer may
   write a row marked shared. */
drop policy if exists templates_write on templates;
create policy templates_write on templates for all
  using (ws_is_officer() and unit_id = ws_my_unit())
  with check (ws_is_officer() and unit_id = ws_my_unit() and (not shared or is_national()));

-- ================================================ deletions of the new kinds
-- A removed announcement, acknowledgement or template has to stay removed on
-- every phone, which means the tombstone table has to accept its name.

alter table deletions drop constraint if exists deletions_entity_check;
alter table deletions add constraint deletions_entity_check
  check (entity in ('event','task','report','letter','person','office','unit',
                    'announcement','ack','template'));

-- ======================================================== the same guard
-- sync3.sql's freshness guard, on the three new tables: a stale copy does not
-- overwrite a fresh one, a field an older phone has never heard of is kept,
-- and a deleted row is not brought back by a phone that was in a drawer.

do $$
declare
  t    text;
  kind text;
  pairs text[][] := array[
    ['announcements', 'announcement'], ['acknowledgements', 'ack'], ['templates', 'template']
  ];
  i int;
begin
  if to_regprocedure('public.sync_guard()') is null then
    raise exception 'sync_guard() is missing. Run sync3.sql first, then this file again.';
  end if;
  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    kind := pairs[i][2];
    execute format('drop trigger if exists sync_guard_%I on %I', t, t);
    execute format(
      'create trigger sync_guard_%I before insert or update on %I
       for each row execute function sync_guard(%L)', t, t, kind);
  end loop;
end $$;

-- ====================================================== the vocabulary check
-- Every audience the app can write, offered to the constraint that guards it —
-- so a word the app learns and this file does not is caught here, the day it is
-- run, rather than one refused announcement at a time on somebody's phone.

do $$
declare
  v   text;
  a   uuid;
  bad text := '';
begin
  foreach v in array array['everyone','nationals','units','people'] loop
    begin
      a := gen_random_uuid();
      insert into announcements (id, title, audience) values (a, 'vocabulary check', v);
      delete from announcements where id = a;
    exception when others then
      bad := bad || 'announcements.audience refuses "' || v || '". ';
      begin delete from announcements where id = a; exception when others then null; end;
    end;
  end loop;
  foreach v in array array['announcement','ack','template'] loop
    begin
      a := gen_random_uuid();
      insert into deletions (entity, entity_id, deleted_by) values (v, a, 'vocabulary check');
      delete from deletions where entity = v and entity_id = a;
    exception when others then
      bad := bad || 'deletions.entity refuses "' || v || '". ';
    end;
  end loop;
  if bad <> '' then
    raise exception 'The app can say things this database refuses: %', bad;
  end if;
  raise notice 'Vocabulary check passed.';
end $$;

-- ================================================================ did it take?

select 'the Bulletin Board has a table' as needed,
       to_regclass('public.announcements') is not null as done
union all select 'acknowledgements have a table',
       to_regclass('public.acknowledgements') is not null
union all select 'templates have a table',
       to_regclass('public.templates') is not null
union all select 'only the Nationals may write the board',
       exists (select 1 from pg_policies where tablename = 'announcements'
                 and policyname = 'announcements_write')
union all select 'an account may only acknowledge for itself',
       exists (select 1 from pg_policies where tablename = 'acknowledgements'
                 and policyname = 'acknowledgements_write')
union all select 'the three new tables are guarded',
       (select count(*) from pg_trigger
         where tgname in ('sync_guard_announcements', 'sync_guard_acknowledgements',
                          'sync_guard_templates') and not tgisinternal) = 3
union all select 'deletions accept the new kinds',
       (select pg_get_constraintdef(oid) like '%template%'
          from pg_constraint where conname = 'deletions_entity_check' limit 1)
order by 1;
