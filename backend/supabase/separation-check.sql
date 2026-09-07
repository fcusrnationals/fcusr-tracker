-- FCUSR Task Tracker — "does the database actually keep people apart?"
--
-- Paste into Supabase → SQL Editor → Run. It only LOOKS: it reads counts and
-- changes nothing. Safe to run any number of times.
--
-- The SQL editor normally runs as the owner, who is above all the rules — so
-- asking it "what can a volunteer see?" would always answer "everything", which
-- proves nothing. This borrows a real person's identity for the length of one
-- transaction and asks the database the question as them. The borrowing ends
-- when the query ends; nobody is signed in as anybody.
--
-- WHAT GOOD LOOKS LIKE
--
--   every row says PASS.
--
-- A volunteer should see only the activities they were enrolled in, and none of
-- the directory, the letters, or anybody's email address. An officer should see
-- their own college and not another's.

create or replace function _separation_check()
returns table (checking text, expected text, saw bigint, verdict text)
language plpgsql as $$
declare
  vol       uuid;
  vol_unit  uuid;
  enrolled  bigint;
  other     uuid;
  n         bigint;
begin
  -- Somebody with the least access there is. If the council has not enrolled a
  -- volunteer yet there is nothing to test, and that is worth saying plainly.
  select p.id, p.unit_id into vol, vol_unit
  from profiles p where p.access = 'volunteer' and p.active limit 1;

  if vol is null then
    checking := 'a volunteer to test with';
    expected := 'at least one enrolled';
    saw := 0;
    verdict := 'SKIPPED — no volunteer enrolled yet, so nothing to check';
    return next;
    return;
  end if;

  select count(*) into enrolled from event_members where profile_id = vol;

  -- Become them, for this transaction only.
  perform set_config('request.jwt.claims',
    json_build_object('sub', vol::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n from events;
  checking := 'activities a volunteer can read';
  expected := 'only the ' || enrolled || ' they were enrolled in';
  saw := n;
  verdict := case when n = enrolled then 'PASS' else 'FAIL — they can read others' end;
  return next;

  select count(*) into n from people;
  checking := 'the people directory';
  expected := 'none of it';
  saw := n;
  verdict := case when n = 0 then 'PASS' else 'FAIL — the roster is readable' end;
  return next;

  select count(*) into n from letters;
  checking := 'letters';
  expected := 'none';
  saw := n;
  verdict := case when n = 0 then 'PASS' else 'FAIL — letters are readable' end;
  return next;

  select count(*) into n from enrolments;
  checking := 'the enrolment list (email addresses)';
  expected := 'none';
  saw := n;
  verdict := case when n = 0 then 'PASS' else 'FAIL — addresses are readable' end;
  return next;

  select count(*) into n from profiles;
  checking := 'other people''s accounts';
  expected := 'only their own (1)';
  saw := n;
  verdict := case when n <= 1 then 'PASS' else 'FAIL — other accounts are readable' end;
  return next;

  select count(*) into n from event_members;
  checking := 'who else is attached to what';
  expected := 'only their own ' || enrolled;
  saw := n;
  verdict := case when n = enrolled then 'PASS' else 'FAIL — everybody''s attachments are readable' end;
  return next;

  select count(*) into n from audit_log;
  checking := 'the audit log';
  expected := 'none';
  saw := n;
  verdict := case when n = 0 then 'PASS' else 'FAIL — the log is readable' end;
  return next;

  perform set_config('role', 'postgres', true);

  -- --------------------------------------------------------------- an officer
  -- of a college that is not the volunteer's, to check colleges are apart.
  select p.id into other
  from profiles p
  join units u on u.id = p.unit_id
  where p.access = 'officer' and u.kind <> 'national'
    and p.active and p.unit_id is distinct from vol_unit
  limit 1;

  if other is null then
    checking := 'an officer of another college';
    expected := 'at least one enrolled';
    saw := 0;
    verdict := 'SKIPPED — no college officer outside the volunteer''s unit yet';
    return next;
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', other::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n from events e where e.unit_id = vol_unit;
  checking := 'another college''s activities, seen by a college officer';
  expected := 'none';
  saw := n;
  verdict := case when n = 0 then 'PASS' else 'FAIL — colleges are not separated' end;
  return next;

  select count(*) into n from people p where p.unit_id = vol_unit;
  checking := 'another college''s people';
  expected := 'none';
  saw := n;
  verdict := case when n = 0 then 'PASS' else 'FAIL — the other roster is readable' end;
  return next;

  perform set_config('role', 'postgres', true);
  return;

/* Whatever happens, the borrowed identity is handed back. Without this, a
   failure halfway through would leave the rest of the query running as
   somebody else — which is the exact confusion this script exists to rule
   out. (It would end at the transaction anyway; this makes it immediate.) */
exception when others then
  perform set_config('role', 'postgres', true);
  raise;
end;
$$;

select * from _separation_check();

drop function _separation_check();
