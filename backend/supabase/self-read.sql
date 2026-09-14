-- FCUSR Task Tracker — everybody may read their own directory entry
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
--
-- The separation rules let the National government read every directory entry,
-- and an officer read their own unit's. Nobody else — including the person the
-- entry is about.
--
-- A volunteer is given tasks, and a task names who holds it by pointing at a
-- directory entry. Their phone could read the tasks and could not read the one
-- entry saying which of them were theirs, so My tasks stayed empty for every
-- volunteer and a task showed nobody's name. Reading your own row gives away
-- nothing; profiles has always allowed exactly this.

drop policy if exists people_read on people;
create policy people_read on people for select using (
  is_national()
  or (my_access() = 'officer' and unit_id = my_unit())
  or (my_email() is not null and lower(coalesce(body->>'email', '')) = my_email())
);

select 'people_read lets a person read their own entry' as checked,
       exists (select 1 from pg_policies
               where tablename = 'people' and policyname = 'people_read'
                 and qual like '%my_email%') as done;
