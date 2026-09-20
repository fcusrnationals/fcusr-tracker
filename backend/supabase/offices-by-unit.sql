-- FCUSR Task Tracker — a unit's own desks
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Offices were the Republic's, all of them, maintained by the National
-- government. That is right for the desks every letter passes: the OSA, the
-- Dean of Student Affairs, the President. It is wrong for a college's own Dean,
-- its own adviser, its own department head — desks that mean nothing to any
-- other college and clutter every other council's routing list.
--
-- So an office now belongs either to the Republic (unit_id empty), which every
-- unit routes letters through, or to one unit, which is the only unit that sees
-- it or may change it. An office the National government adds is the Republic's
-- and therefore appears for every unit at once, which is what was asked for.
--
-- Codes were unique across the whole table, so two colleges could not both have
-- a "DEAN". They are unique per owner now, and the app puts the unit's code in
-- front of its own (CN-DEAN) so a trail printed anywhere still reads plainly.

alter table offices add column if not exists unit_id uuid references units(id) on delete cascade;
create index if not exists offices_unit_idx on offices(unit_id);

-- One code per owner rather than one code in the world.
alter table offices drop constraint if exists offices_code_key;
drop index if exists offices_code_key;
create unique index if not exists offices_code_per_owner
  on offices (coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

/* Who may change a desk: the National government, for any of them; an officer
   of a unit, for that unit's own. The `using` half is what stops a Governor
   editing or deleting the Republic's desks — those rows have no unit_id and so
   never match — and the `with check` half is what stops them filing a new desk
   under somebody else's unit. */
drop policy if exists offices_write on offices;
create policy offices_write on offices for all
  using (
    is_national()
    or (my_access() = 'officer' and unit_id is not null and unit_id = my_unit())
  )
  with check (
    is_national()
    or (my_access() = 'officer' and unit_id is not null and unit_id = my_unit())
  );

/* Reading stays open to anybody signed in, as it was. A desk is a name and a
   turnaround; the app shows each unit only its own and the Republic's, and
   narrowing it here would mean a letter's old trail printing "Unknown office"
   for anybody outside the unit that sent it. */

-- ================================================================ did it take?

select 'offices carry a unit' as needed,
       exists (select 1 from information_schema.columns
               where table_name = 'offices' and column_name = 'unit_id') as done
union all select 'a code is unique per owner, not per Republic',
       exists (select 1 from pg_indexes where tablename = 'offices' and indexname = 'offices_code_per_owner')
union all select 'a unit may keep its own desks',
       exists (select 1 from pg_policies where tablename = 'offices' and policyname = 'offices_write'
               and qual like '%my_unit()%')
order by 1;
