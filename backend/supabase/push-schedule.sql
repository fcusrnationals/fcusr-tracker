-- FCUSR Task Tracker — push notifications, part 2: the two scheduled jobs
--
-- Run this in Supabase → SQL Editor AFTER push.sql has been run and the
-- push-dispatch Edge Function has been deployed (backend/PUSH.md, steps 1–2).
-- Safe to run twice: each job is replaced by name, and the secrets are only
-- made once.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--
--   pg_cron and pg_net    switched on if they are not already (both are free
--                         Supabase extensions; Database → Extensions lists them)
--   two Vault secrets     project_url — this project's public address
--                         push_dispatch_token — a random 64-character token
--                         the cron job knocks with. The Edge Function checks it
--                         against Vault itself, so it never has to be copied
--                         anywhere by anybody.
--   fcusr-push-dispatch   every minute: ask push-dispatch to send what is due
--   fcusr-push-deadlines  every day at 07:30 Manila (23:30 UTC): write the
--                         due-tomorrow, due-today and overdue reminders
--
-- To stop everything again: push-off.sql.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    perform vault.create_secret('https://wjpsztvvuplppzswnrdx.supabase.co', 'project_url',
      'This project''s public address, for scheduled Edge Function calls.');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_dispatch_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_dispatch_token',
      'What the fcusr-push-dispatch cron job knocks with. Made here; never share.');
  end if;
end $$;

select cron.schedule(
  'fcusr-push-dispatch',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-token', (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) as request_id;
  $job$
);

select cron.schedule(
  'fcusr-push-deadlines',
  '30 23 * * *',
  $job$ select push_enqueue_deadlines(); $job$
);

-- ================================================================ did it take?

select 'pg_cron and pg_net are on' as needed,
       exists (select 1 from pg_extension where extname = 'pg_cron')
       and exists (select 1 from pg_extension where extname = 'pg_net') as done
union all select 'the token and the address are in Vault',
       (select count(*) from vault.decrypted_secrets
         where name in ('project_url', 'push_dispatch_token')) = 2
union all select 'sending runs every minute',
       exists (select 1 from cron.job where jobname = 'fcusr-push-dispatch' and schedule = '* * * * *')
union all select 'deadline reminders are written every morning',
       exists (select 1 from cron.job where jobname = 'fcusr-push-deadlines')
union all select 'push.sql has been run',
       to_regprocedure('public.push_enqueue_deadlines(timestamptz)') is not null
order by 1;
