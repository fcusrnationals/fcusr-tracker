-- FCUSR Task Tracker — security corrections
--
-- Run this AFTER sync2.sql, in Supabase → SQL Editor. Safe to run twice.
--
-- Five faults found reading the policies back against what the app actually
-- allows people to do. Three of them let somebody do something the app never
-- offers them, which is the only kind that matters: the screen is not the
-- boundary, the database is, and anybody can send their own requests.

-- ============================================================ 1. escalation
-- The worst of them.
--
-- profiles_update said "you may edit your own row", and a row carries `access`,
-- `unit_id` and `is_head`. So any account at all — a first-year volunteer
-- enrolled for one activity — could PATCH their own profile to access='officer',
-- unit_id=<the National unit>, is_head=true and become the President: the whole
-- Republic readable, Settings open, the letterhead theirs to replace.
--
-- Row-level security cannot restrict columns, so this is a trigger. A person
-- may still edit their own name and position; the three columns that decide
-- what anybody can reach are the National government's alone.

create or replace function guard_profile_grants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_national() then return new; end if;

  if new.access   is distinct from old.access
  or new.unit_id  is distinct from old.unit_id
  or new.is_head  is distinct from old.is_head
  or new.active   is distinct from old.active then
    raise exception
      'Access, unit and standing are set by the National government, not by the account itself.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_grants on profiles;
create trigger guard_profile_grants
  before update on profiles
  for each row execute function guard_profile_grants();

-- ====================================================== 2. deleting things
-- deletions_write asked only which unit somebody belonged to, not whether they
-- were an officer of it. A volunteer could therefore write tombstones for their
-- unit's activities, tasks and letters — and a tombstone is obeyed by every
-- device that syncs. One volunteer, and a college's term is gone from every
-- phone in it.

drop policy if exists deletions_write on deletions;
create policy deletions_write on deletions for all
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.access = 'officer'
            and (is_national() or p.unit_id = deletions.unit_id))
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.access = 'officer'
            and (is_national() or p.unit_id = deletions.unit_id))
  );

-- =============================================== 3. letting yourself in
-- An activity is readable by anybody attached to it. members_write asked only
-- "are you an officer", of anywhere — so an officer of one college could attach
-- themselves to another college's activity, or to a National one, and read it.
-- The officer has to belong where the activity belongs.

drop policy if exists members_write on event_members;
create policy members_write on event_members for all
  using (
    exists (select 1 from events e join profiles p on p.id = auth.uid()
            where e.id = event_members.event_id and p.access = 'officer'
              and (p.unit_id = e.unit_id or (is_national() and not is_independent(e.unit_id))))
  )
  with check (
    exists (select 1 from events e join profiles p on p.id = auth.uid()
            where e.id = event_members.event_id and p.access = 'officer'
              and (p.unit_id = e.unit_id or (is_national() and not is_independent(e.unit_id))))
  );

-- ======================================== 4. the seal was read-only
-- COMELEC, the Judiciary and the independent bodies are sealed from the
-- National government — but only from reading. Every write policy said
-- `is_national() or ...`, so a national officer could edit, and delete,
-- work they are not allowed to see. A seal that stops you reading a thing
-- and lets you destroy it is not a seal.
--
-- sees_unit() already means "your own unit, or anywhere the National
-- government may look". Writing follows it.

drop policy if exists events_write on events;
create policy events_write on events for all
  using (sees_unit(unit_id)
         and (is_national() or ((select access from profiles where id = auth.uid()) = 'officer'
                                and unit_id = my_unit())))
  with check (sees_unit(unit_id)
         and (is_national() or ((select access from profiles where id = auth.uid()) = 'officer'
                                and unit_id = my_unit())));

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  exists (select 1 from events e join profiles p on p.id = auth.uid()
          where e.id = tasks.event_id and p.access = 'officer' and sees_unit(e.unit_id))
);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update using (
  assignee_id = auth.uid()
  or exists (select 1 from events e join profiles p on p.id = auth.uid()
             where e.id = tasks.event_id and p.access = 'officer' and sees_unit(e.unit_id))
);

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks for delete using (
  exists (select 1 from events e join profiles p on p.id = auth.uid()
          where e.id = tasks.event_id and p.access = 'officer' and sees_unit(e.unit_id))
);

drop policy if exists reports_write on reports;
create policy reports_write on reports for all
  using (exists (select 1 from events e join profiles p on p.id = auth.uid()
                 where e.id = reports.event_id and p.access = 'officer' and sees_unit(e.unit_id)))
  with check (exists (select 1 from events e join profiles p on p.id = auth.uid()
                 where e.id = reports.event_id and p.access = 'officer' and sees_unit(e.unit_id)));

-- ================================ 5. what an officer may actually add
-- offices_write was national-only, which is wrong now: a letter form lets any
-- officer name an office the seeded list never had — the Office of the
-- Chaplain, a campus the list forgot — and that office could never reach the
-- server. Offices are shared reference data and adding one harms nobody.

drop policy if exists offices_write on offices;
create policy offices_write on offices for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.access = 'officer'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.access = 'officer'));

-- The Republic's own setup stays with the National government: the unit list,
-- the letter templates the whole council prints on, and the closing date.
drop policy if exists units_write on units;
create policy units_write on units for all
  using (is_national()) with check (is_national());
