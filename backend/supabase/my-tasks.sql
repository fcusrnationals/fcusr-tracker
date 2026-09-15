-- FCUSR Task Tracker — everybody can see, and tick off, the tasks given to them
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
-- It includes self-read.sql, so that one no longer needs running separately.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Who may read a task was decided only by where the task belongs: an officer
-- reads their own unit's, a volunteer the activities they were taken on for.
-- Nobody asked "was this task given to you?" — so:
--
--   * A Governor given a task in a National activity never received it.
--   * A volunteer given a directive never received it.
--   * A volunteer given a task in an activity they were not attached to never
--     received it.
--
-- There was a rule meant to let the person holding a task update it. It
-- compared the task's assignee_id column with the directory — and the app
-- keeps who holds a task inside the record (body), never in that column. The
-- column is empty on every task, so the rule has never matched anybody: a
-- volunteer who ticked a task off saw it done on their phone, and nobody else
-- ever did.
--
-- ---------------------------------------------------------------------------
-- WHAT IT CHANGES
--
--   1. A task given to you can be read by you, whatever unit it belongs to.
--   2. It can be updated by you — its status, most importantly. Only a task that
--      already exists: holding a task does not let anybody create new ones.
--   3. The activity such a task sits in can be read by you, so My tasks can say
--      which activity it is. Nothing else of that activity: not its other tasks,
--      not its report, not its letters.
--   4. You can read your own directory entry (what self-read.sql did).
--
-- Every policy asks through a `security definer` function, never a table
-- directly, so no policy can set off another and loop.

-- ================================================================ 1. helpers

-- Is this directory entry the person signed in? Matched by the address their
-- account was made with. A non-uuid is answered "no" before it is ever cast.
create or replace function is_me(person text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when person is null
      or person !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or my_email() is null
    then false
    else exists (
      select 1 from people pe
      where pe.id = person::uuid
        and lower(coalesce(pe.body->>'email', '')) = my_email()
    )
  end;
$$;

-- Does a task with this id already exist? Used so that holding a task lets you
-- update it, and never lets you create one.
create or replace function task_exists(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks where id = t);
$$;

-- Was any task in this activity given to the person signed in?
create or replace function has_my_task(ev uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select my_email() is not null and exists (
    select 1 from tasks t
    where t.event_id = ev
      and is_me(t.body->>'assigneeId')
  );
$$;

grant execute on function is_me(text)        to authenticated;
grant execute on function task_exists(uuid)  to authenticated;
grant execute on function has_my_task(uuid)  to authenticated;

-- ================================================================ 2. tasks

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select using (
  (my_access() = 'officer' and sees_unit(task_unit(event_id, unit_id)))
  or in_event(event_id)
  or is_me(body->>'assigneeId')
);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update using (
  (my_access() = 'officer' and sees_unit(task_unit(event_id, unit_id)))
  or is_me(body->>'assigneeId')
);

-- The app saves by upsert, and Postgres checks this rule even when the row
-- already exists and the write becomes an update. Without the second line the
-- person holding a task could never save a change to it.
drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  (my_access() = 'officer' and sees_unit(task_unit(event_id, unit_id)))
  or (is_me(body->>'assigneeId') and task_exists(id))
);

-- ============================================================ 3. activities

drop policy if exists events_read on events;
create policy events_read on events for select using (
  (my_access() = 'officer' and sees_unit(unit_id))
  or in_event(id)
  or has_my_task(id)
);

-- ============================================================= 4. directory

drop policy if exists people_read on people;
create policy people_read on people for select using (
  is_national()
  or (my_access() = 'officer' and unit_id = my_unit())
  or (my_email() is not null and lower(coalesce(body->>'email', '')) = my_email())
);

-- ================================================================ did it take?

select 'is_me'        as needed, to_regprocedure('public.is_me(text)')       is not null as done
union all select 'task_exists', to_regprocedure('public.task_exists(uuid)')  is not null
union all select 'has_my_task', to_regprocedure('public.has_my_task(uuid)')  is not null
union all select 'tasks_read lets you read your own tasks',
  exists (select 1 from pg_policies where tablename = 'tasks' and policyname = 'tasks_read'
          and qual like '%is_me%')
union all select 'tasks_update lets you update your own tasks',
  exists (select 1 from pg_policies where tablename = 'tasks' and policyname = 'tasks_update'
          and qual like '%is_me%')
union all select 'tasks_insert lets you save your own tasks',
  exists (select 1 from pg_policies where tablename = 'tasks' and policyname = 'tasks_insert'
          and with_check like '%task_exists%')
union all select 'events_read lets you see the activity your task is in',
  exists (select 1 from pg_policies where tablename = 'events' and policyname = 'events_read'
          and qual like '%has_my_task%')
union all select 'people_read lets you read your own entry',
  exists (select 1 from pg_policies where tablename = 'people' and policyname = 'people_read'
          and qual like '%my_email%')
order by 1;
