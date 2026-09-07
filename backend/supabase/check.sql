-- FCUSR Task Tracker — "which setup steps have been run?"
--
-- Paste this whole thing into Supabase → SQL Editor → Run.
-- It only LOOKS. It changes nothing, and it is safe to run any number of times.
--
-- You will get a small table with one row per setup file and a plain answer in
-- the last column. Anything that says "NOT RUN — open that file and run it"
-- is the thing to do next.

select 'schema.sql'   as setup_file,
       case when to_regclass('public.events') is not null
            then 'done' else 'NOT RUN — open that file and run it' end as status
union all
select 'sync.sql',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'events' and column_name = 'body')
             and to_regclass('public.deletions') is not null
            then 'done' else 'NOT RUN — open that file and run it' end
union all
select 'sync2.sql',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'units' and column_name = 'body')
             and to_regclass('public.council') is not null
            then 'done' else 'NOT RUN — open that file and run it' end
union all
select 'security.sql',
       case when exists (select 1 from pg_proc where proname = 'my_access')
            then 'done' else 'NOT RUN — open that file and run it' end
union all
select 'heads.sql',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'enrolments' and column_name = 'is_head')
             and exists (select 1 from pg_proc where proname = 'set_unit_head')
            then 'done' else 'NOT RUN — open that file and run it' end
order by 1;
