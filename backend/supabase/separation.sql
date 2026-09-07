-- FCUSR Task Tracker — separation: what the database itself refuses
--
-- Run this AFTER security.sql and heads.sql, in Supabase → SQL Editor.
-- Safe to run twice. Nothing is deleted; only policies are replaced.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- The app has always shown a volunteer only the activities they were enrolled
-- in, and shown a college only its own work. That is the app deciding. The
-- database was deciding something looser, and the database is the one that
-- answers when somebody asks it directly — which anybody can do, because the
-- key that opens it ships inside the page. That is not a flaw in the key; it
-- is what a publishable key is. It is only safe if the rules underneath it are
-- right.
--
-- They were not, in five places:
--
--   1. `people` was readable by anybody signed in — the whole Republic's
--      directory, every college, with the email addresses in it. A first-year
--      volunteer enrolled for one afternoon could take the lot.
--   2. A volunteer could read every activity, task and report of their college,
--      not only the ones they were enrolled in. The app hid them; the database
--      handed them over.
--   3. A volunteer could read their college's letters — all of them.
--   4. A volunteer could read the enrolment list and the profiles of their
--      college, both of which carry email addresses.
--   5. Anybody signed in could read the whole event_members table: who is
--      attached to what, across every college.
--
-- And one thing the other way, which is a fault of the opposite kind: a
-- Governor could not save their own council's letter template, because units
-- could only be written by the National government. Their settings worked on
-- their phone and never reached anybody.
--
-- ---------------------------------------------------------------------------
-- THE RULE THAT KEEPS THIS FROM LOCKING EVERYONE OUT
--
-- A policy that reads another table makes that table's policies run, and if
-- those read back, Postgres stops with "infinite recursion detected" and
-- nobody can sign in at all. That has happened here once already.
--
-- So: every policy below asks its questions ONLY through the small functions
-- above it, each of which is `security definer` and therefore answers without
-- triggering any policy. No policy names a table directly.

-- --------------------------------------------------------------- helpers

-- Is the caller attached to this activity? Reads event_members as the owner,
-- so event_members' own policy never runs and cannot loop back.
create or replace function in_event(ev uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from event_members
    where event_id = ev and profile_id = auth.uid()
  );
$$;

-- Is the caller the head — Governor or Vice Governor — of this unit?
create or replace function is_head_of(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active and is_head
      and access = 'officer' and unit_id = u
  );
$$;

-- ================================================= 1. the directory
-- Names, positions and email addresses of everybody the council tracks. An
-- officer needs their own unit's; the National government needs everyone's;
-- a volunteer needs neither.
--
-- A person with no unit at all is national housekeeping and stays national.

drop policy if exists people_read on people;
create policy people_read on people for select using (
  is_national()
  or (my_access() = 'officer' and unit_id = my_unit())
);

-- ================================================= 2. activities and their work
-- An officer sees their unit's, and the National government sees every unit's
-- except the sealed ones. A volunteer sees the activities they were enrolled
-- in, and nothing else — which is what the app has always claimed.

drop policy if exists events_read on events;
create policy events_read on events for select using (
  (my_access() = 'officer' and sees_unit(unit_id))
  or in_event(id)
);

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select using (
  (my_access() = 'officer' and sees_unit(event_unit(event_id)))
  or in_event(event_id)
);

drop policy if exists reports_read on reports;
create policy reports_read on reports for select using (
  (my_access() = 'officer' and sees_unit(event_unit(event_id)))
  or in_event(event_id)
);

-- ================================================= 3. letters
-- A letter's trail names people and offices and says what was refused and why.
-- It is officers' business. A volunteer helping at an activity is not part of
-- the correspondence.

drop policy if exists letters_read on letters;
create policy letters_read on letters for select using (
  my_access() = 'officer' and sees_unit(unit_id)
);

-- ================================================= 4. addresses
-- Both of these carry email addresses. Reading your own row stays, because
-- everybody must be able to see who they are signed in as.

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (
  id = auth.uid()
  or is_national()
  or (my_access() = 'officer' and unit_id = my_unit())
);

drop policy if exists enrolments_read on enrolments;
create policy enrolments_read on enrolments for select using (
  is_national()
  or (my_access() = 'officer' and unit_id = my_unit())
);

-- ================================================= 5. who is attached to what
-- A volunteer needs their own rows, in order to know which activities they
-- were taken on for. They do not need anybody else's.

drop policy if exists members_read on event_members;
create policy members_read on event_members for select using (
  profile_id = auth.uid()
  or (my_access() = 'officer' and sees_unit(event_unit(event_id)))
);

-- ================================================= 6. a Governor's own council
-- The fault in the other direction. A unit's letter template is stored on the
-- unit, and units could only be written by the National government — so a
-- Governor's settings saved on their phone and reached nobody.
--
-- Widening this needs a guard, because a unit row carries `kind`, and `kind`
-- is what is_national() reads. A Governor who could set their own college's
-- kind to 'national' would make every member of it a national officer. So the
-- policy lets a head write their unit, and the trigger below decides which
-- columns they may actually change.

/* UPDATE only, deliberately. `for all` would have covered DELETE as well, and
   a Governor who may edit their council's template must not be able to remove
   the council. Creating and deleting units stays with the National government
   below. */
drop policy if exists units_write on units;
drop policy if exists units_update on units;
create policy units_update on units for update
  using (is_national() or is_head_of(id))
  with check (is_national() or is_head_of(id));

create or replace function guard_unit_grants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_national() then return new; end if;

  -- What a unit IS belongs to the Republic. Its letterhead is its own.
  if new.id   is distinct from old.id
  or new.kind is distinct from old.kind
  or new.code is distinct from old.code then
    raise exception
      'A unit''s kind and code are set by the National government. You may change your own council''s template.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_unit_grants on units;
create trigger guard_unit_grants
  before update on units
  for each row execute function guard_unit_grants();

/* Creating a college, or removing one, is the Republic's own act.

   The insert policy names is_head_of(id) as well, which looks like a loophole
   and is not one. The app saves by upsert, and Postgres checks the INSERT rule
   even when the row already exists and the write becomes an update — so
   without this a Governor's save would be refused by the very policy meant to
   allow it. is_head_of(id) is only ever true for the unit that head already
   belongs to, which by definition exists; a genuinely new id matches nobody's
   unit, so no new college can be created this way. */
drop policy if exists units_insert on units;
create policy units_insert on units for insert
  with check (is_national() or is_head_of(id));

drop policy if exists units_delete on units;
create policy units_delete on units for delete using (is_national());

-- ---------------------------------------------------------------------------
-- DELIBERATELY LEFT OPEN
--
-- `deletions` stays readable by anybody signed in. It holds no content — an id,
-- a kind and a time — and every device must learn about every deletion or a
-- record removed on one phone comes back from another. Narrowing it risks the
-- data coming back from the dead, which is worse than telling a volunteer that
-- something they could never read has been deleted.
--
-- `units` and `council` stay readable by anybody signed in: the college list
-- and the letterhead are what the app is drawn from.
