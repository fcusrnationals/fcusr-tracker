-- FCUSR Task Tracker — sync, part two
--
-- Run this AFTER sync.sql, in Supabase → SQL Editor. Safe to run twice.
--
-- The first migration carried the council's work: activities, tasks, letters,
-- reports, people. It left out the things that are setup rather than work — the
-- unit list, the letter templates, the council's own details — on the grounds
-- that they change rarely. Rarely is not never, and "the letterhead the
-- President uploaded is on the President's laptop and nowhere else" is exactly
-- the kind of quiet disagreement this whole layer exists to prevent.

-- ------------------------------------------------------------------ units
-- Units already have their own table with a name, code and kind. What they
-- gained since is a tracker name and a letter template of their own, and
-- neither has anywhere to live here.

alter table units add column if not exists body jsonb not null default '{}'::jsonb;
alter table units add column if not exists updated_at timestamptz not null default now();
create index if not exists units_updated_idx on units(updated_at);

-- ---------------------------------------------------------------- council
-- One row: the council's name and address as printed on reports, the emblem,
-- the Republic's letter template, and the lists of positions and committees.
-- A single row rather than a column each, for the same reason every other
-- table carries `body` — the next thing the council wants to set should not be
-- a migration somebody has to remember to run.

create table if not exists council (
  id         int primary key default 1 check (id = 1),
  body       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into council (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------- a unit can be removed
-- The tombstone table names what kind of thing was deleted, and its check
-- constraint never learnt about units.

alter table deletions drop constraint if exists deletions_entity_check;
alter table deletions add constraint deletions_entity_check
  check (entity in ('event','task','report','letter','person','office','unit'));

-- ------------------------------------------------- row level security

alter table council enable row level security;

-- Everyone signed in reads the council's own details; every report is printed
-- from them. Only the National executives set them.
drop policy if exists council_read on council;
create policy council_read on council for select using (auth.uid() is not null);

drop policy if exists council_write on council;
create policy council_write on council for all
  using (is_national()) with check (is_national());

-- Units were readable and written only by nationals already; the write policy
-- is restated here because schema.sql never gave them one at all, so a unit
-- renamed on a phone could not reach the server.
drop policy if exists units_write on units;
create policy units_write on units for all
  using (is_national()) with check (is_national());

-- --------------------------------------------------- the clock, enforced
-- Same reason as the other tables: a pull filters on updated_at, so the server
-- stamps it and ignores whatever a phone's watch says.

do $$
declare t text;
begin
  foreach t in array array['units','council'] loop
    execute format('drop trigger if exists touch_%I on %I', t, t);
    execute format(
      'create trigger touch_%I before insert or update on %I
       for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;
