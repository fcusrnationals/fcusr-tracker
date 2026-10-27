-- FCUSR Task Tracker — push notifications: switch them off
--
-- Run this in Supabase → SQL Editor to stop every push notification at once.
-- Safe to run twice, and safe to run when the jobs were never scheduled.
-- Nothing about tasks, sync or sign-in changes. Phones simply stop ringing;
-- the Notifications sheet in the app goes on working and nothing is sent.
--
-- To switch them back on: run push.sql (it puts the trigger back) and then
-- push-schedule.sql.
--
-- To take push notifications out completely, after running this:
--   drop table if exists push_deliveries, push_outbox, push_subscriptions, push_settings;
--   delete from vault.secrets where name in ('push_vapid_private', 'push_dispatch_token');
--   and delete the push-dispatch Edge Function in the dashboard.
-- (Every phone would have to turn notifications on again afterwards.)

do $$
begin
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'fcusr-push-dispatch') then
      perform cron.unschedule('fcusr-push-dispatch');
    end if;
    if exists (select 1 from cron.job where jobname = 'fcusr-push-deadlines') then
      perform cron.unschedule('fcusr-push-deadlines');
    end if;
  end if;
end $$;

drop trigger if exists push_task_changed on tasks;

-- Anything still waiting is let go, so switching back on later does not
-- deliver a backlog of old news.
do $$
begin
  if to_regclass('public.push_outbox') is not null then
    update push_outbox set cancelled_at = now(), cancel_reason = 'switched off'
    where sent_at is null and cancelled_at is null;
  end if;
end $$;

do $$
declare left_over int := 0;
begin
  if to_regclass('cron.job') is not null then
    execute $q$select count(*) from cron.job
               where jobname in ('fcusr-push-dispatch', 'fcusr-push-deadlines')$q$ into left_over;
  end if;
  if left_over > 0 then raise exception 'A push job is still scheduled.'; end if;
end $$;

select 'no task change writes a notification, and no job sends' as needed,
       not exists (select 1 from pg_trigger where tgname = 'push_task_changed' and not tgisinternal) as done;
