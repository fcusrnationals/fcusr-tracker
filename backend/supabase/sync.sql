-- FCUSR Task Tracker — sync migration
--
-- Run this AFTER schema.sql, in Supabase → SQL Editor. Safe to run twice.
--
-- schema.sql built the server as a relational mirror of the app: a column for
-- every field. That is the wrong shape for syncing. The app's records are
-- nested (a report holds a programme, a photo list, a signatory block) and they
-- gain fields as the council asks for things, and every one of those would be a
-- migration somebody has to remember to run before the phones stop agreeing.
--
-- So the server keeps only what it must reason about — who owns a row, and when
-- it last changed — and carries the app's own record beside it in `body`. RLS
-- still decides who may read and write, because that is decided from unit_id,
-- which stays a real column. Everything else rides along.

-- ------------------------------------------------------------ the directory
-- The people a task can be assigned to. NOT the same thing as profiles: most of
-- a council never holds a login, and a task assigned to a first-year helper has
-- to survive whether or not that helper ever signs in. profiles is who can get
-- in; people is who does the work.

create table if not exists people (
  id         uuid primary key,
  unit_id    uuid references units(id) on delete cascade,
  name       text not null default '',
  active     boolean not null default true,
  body       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists people_unit_idx on people(unit_id);
create index if not exists people_updated_idx on people(updated_at);

-- --------------------------------------------------------- the app's records
-- `body` on everything that syncs.

alter table events  add column if not exists body jsonb not null default '{}'::jsonb;
alter table tasks   add column if not exists body jsonb not null default '{}'::jsonb;
alter table reports add column if not exists body jsonb not null default '{}'::jsonb;
alter table letters add column if not exists body jsonb not null default '{}'::jsonb;
alter table offices add column if not exists body jsonb not null default '{}'::jsonb;
alter table term    add column if not exists body jsonb not null default '{}'::jsonb;

-- A task is reached through its event, but a pull asks "what changed since",
-- so the column it is filtered on has to be indexed on every table.
create index if not exists events_updated_idx  on events(updated_at);
create index if not exists tasks_updated_idx   on tasks(updated_at);
create index if not exists reports_updated_idx on reports(updated_at);
create index if not exists letters_updated_idx on letters(updated_at);
create index if not exists offices_updated_idx on offices(updated_at);

-- --------------------------------------------------------- assignees are people
-- tasks.assignee_id pointed at profiles, which would refuse every task assigned
-- to somebody without a login — most of them. events.head_id had the same fault.

alter table tasks  drop constraint if exists tasks_assignee_id_fkey;
alter table events drop constraint if exists events_head_id_fkey;

do $$ begin
  alter table tasks add constraint tasks_assignee_id_fkey
    foreign key (assignee_id) references people(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table events add constraint events_head_id_fkey
    foreign key (head_id) references people(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- deletions
-- A row removed on one phone has to stay removed everywhere. Without a record
-- of the deletion, the next device to sync simply puts it back: it still holds
-- the row, sees it missing from the server, and helpfully uploads it again.

create table if not exists deletions (
  entity     text not null check (entity in ('event','task','report','letter','person','office')),
  entity_id  uuid not null,
  unit_id    uuid references units(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  deleted_by text not null default '',
  primary key (entity, entity_id)
);

create index if not exists deletions_at_idx on deletions(deleted_at);

-- ------------------------------------------------- row level security

alter table people    enable row level security;
alter table deletions enable row level security;

-- The directory is the Republic's, read the way units are: everyone signed in
-- sees the people they might have to assign work to.
drop policy if exists people_read on people;
create policy people_read on people for select using (auth.uid() is not null);

drop policy if exists people_write on people;
create policy people_write on people for all
  using (is_national() or (unit_id = my_unit()
         and (select access from profiles where id = auth.uid()) = 'officer'))
  with check (is_national() or (unit_id = my_unit()
         and (select access from profiles where id = auth.uid()) = 'officer'));

-- A deletion is a fact everyone needs, including units that cannot see the row
-- it refers to — they simply never held it, and skipping a tombstone for a row
-- you do not have costs nothing.
drop policy if exists deletions_read on deletions;
create policy deletions_read on deletions for select using (auth.uid() is not null);

drop policy if exists deletions_write on deletions;
create policy deletions_write on deletions for all
  using (is_national() or unit_id = my_unit())
  with check (is_national() or unit_id = my_unit());

-- ------------------------------------------------- deleting is a write too
-- schema.sql gave tasks read, insert and update policies and no delete policy
-- at all, so a task removed on a phone could never be removed from the server —
-- silently, because a refused delete under RLS looks exactly like a delete that
-- matched no rows.

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete using (
  exists (select 1 from events e join profiles p on p.id = auth.uid()
          where e.id = tasks.event_id and p.access = 'officer'
            and (is_national() or e.unit_id = p.unit_id))
);

-- ------------------------------------------------------------- the clock
-- Every pull asks for what changed since a moment, and that moment has to be
-- read from the same clock that stamps the rows. A phone four minutes fast
-- would save a high-water mark from the future and quietly stop receiving
-- anything — no error, just a device that stops learning.

create or replace function server_now() returns timestamptz
language sql stable as $$ select now(); $$;

grant execute on function server_now() to anon, authenticated;
