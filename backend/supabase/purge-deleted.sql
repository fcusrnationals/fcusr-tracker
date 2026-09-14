-- FCUSR Task Tracker — remove the records that were deleted but never left
--
-- Run this once, in Supabase → SQL Editor. Safe to run again: the second time
-- there is nothing left to remove.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NEEDED
--
-- For a stretch of this term, deleting an activity, a task, a letter or a
-- person on a phone did not delete it from the database.
--
-- The app has two different things called "remove": deleting rows, which is
-- what syncing a deletion does, and removing a member. They were written into
-- the same object under the same name, and in JavaScript the second silently
-- replaces the first. So every deletion that synced called the member-removal
-- function with a table name where an email address belongs — which matched
-- nobody and did nothing.
--
-- Every device still recorded the deletion and hid the record, so nobody saw
-- them. They are in the database regardless, pulled by every new device and
-- then hidden again. That is fixed in the app now; this removes what piled up.
--
-- ---------------------------------------------------------------------------
-- WHAT IT REMOVES, AND WHAT IT LEAVES
--
-- Only rows the council already deleted: a row goes when there is a recorded
-- deletion for it made AT OR AFTER its last change. A row somebody changed
-- after it was deleted is left alone, which is the same rule the app follows.
--
-- Units and offices are left alone entirely. They are reference data, a stray
-- one harms nothing, and removing a unit would take its activities with it.
--
-- Nothing here touches accounts, the audit log, the closing date or the
-- letterhead.

-- ------------------------------------------------------------------ first, look

select 'people'  as table_name, count(*) as will_be_removed from people t
  where exists (select 1 from deletions d where d.entity = 'person' and d.entity_id = t.id and d.deleted_at >= t.updated_at)
union all
select 'letters', count(*) from letters t
  where exists (select 1 from deletions d where d.entity = 'letter' and d.entity_id = t.id and d.deleted_at >= t.updated_at)
union all
select 'reports', count(*) from reports t
  where exists (select 1 from deletions d where d.entity = 'report' and d.entity_id = t.id and d.deleted_at >= t.updated_at)
union all
select 'tasks',   count(*) from tasks t
  where exists (select 1 from deletions d where d.entity = 'task'   and d.entity_id = t.id and d.deleted_at >= t.updated_at)
union all
select 'events',  count(*) from events t
  where exists (select 1 from deletions d where d.entity = 'event'  and d.entity_id = t.id and d.deleted_at >= t.updated_at);

-- ------------------------------------------------------------------ then, remove
-- Activities last: removing one takes its remaining tasks and report with it,
-- exactly as deleting it in the app does, and letters stay with no activity.

delete from people t using deletions d
  where d.entity = 'person' and d.entity_id = t.id and d.deleted_at >= t.updated_at;

delete from letters t using deletions d
  where d.entity = 'letter' and d.entity_id = t.id and d.deleted_at >= t.updated_at;

delete from reports t using deletions d
  where d.entity = 'report' and d.entity_id = t.id and d.deleted_at >= t.updated_at;

delete from tasks t using deletions d
  where d.entity = 'task' and d.entity_id = t.id and d.deleted_at >= t.updated_at;

delete from events t using deletions d
  where d.entity = 'event' and d.entity_id = t.id and d.deleted_at >= t.updated_at;

-- ------------------------------------------------------------------ and confirm

select 'records still waiting to be removed' as checked,
  (select count(*) from people t  where exists (select 1 from deletions d where d.entity = 'person' and d.entity_id = t.id and d.deleted_at >= t.updated_at))
+ (select count(*) from letters t where exists (select 1 from deletions d where d.entity = 'letter' and d.entity_id = t.id and d.deleted_at >= t.updated_at))
+ (select count(*) from reports t where exists (select 1 from deletions d where d.entity = 'report' and d.entity_id = t.id and d.deleted_at >= t.updated_at))
+ (select count(*) from tasks t   where exists (select 1 from deletions d where d.entity = 'task'   and d.entity_id = t.id and d.deleted_at >= t.updated_at))
+ (select count(*) from events t  where exists (select 1 from deletions d where d.entity = 'event'  and d.entity_id = t.id and d.deleted_at >= t.updated_at))
  as remaining;
