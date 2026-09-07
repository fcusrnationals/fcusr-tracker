-- FCUSR Task Tracker — Remove means remove
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
--
-- "Withdrawing" somebody set profiles.active = false and left everything else
-- standing: the profile, the enrolment, and the login itself. Enrolling them
-- again updated their name, unit and access and never touched `active`, so the
-- enrolment appeared to work every time — success message, name back on the
-- list — and they still could not sign in. There was no way out of that state
-- from inside the app.
--
-- Half-removing somebody is what made this hard to explain and impossible to
-- undo. So it does not half-remove them any more.
--
-- ---------------------------------------------------------------------------
-- WHAT REMOVE DOES NOW
--
-- Deletes the login, the profile, the waiting enrolment, and their attachment
-- to any activity. The address is left completely free, so adding them again is
-- an ordinary first-time enrolment: they set a password and they are in.
--
-- THE COUNCIL'S WORK IS NOT TOUCHED. That is deliberate and it is worth being
-- exact about, because "delete everything about them" and "delete everything
-- they did" are very different acts and only the first is safe:
--
--   tasks      untouched. A task points at the directory entry, not the login,
--              so who did what survives a person losing their account.
--   letters    kept; whoever was carrying it becomes nobody, and the letter
--              shows as unassigned so somebody picks it up.
--   events     kept; if they were the head, the event shows no head.
--   reports    untouched.
--   audit log  kept, with their name still written on what they did. The log
--              is the one thing that must survive the person.
--   directory  untouched. Their name still reads correctly on every task and
--              every report already filed.
--
-- This cannot be undone. Adding them back gives them a new account on the same
-- address, not the old one returned.

-- ------------------------------------------------------------- remove_member
-- Deleting from auth.users needs rights the app does not have and must never
-- have — that is the service_role key, and a web page carrying one can be read
-- by anybody who opens it. So the delete happens here instead, inside a
-- function that runs as its owner and checks for itself who is asking.
--
-- profiles.id references auth.users(id) on delete cascade, and event_members
-- cascades from profiles, so removing the login removes both. Everything else
-- pointing at a profile is `on delete set null`, which is why the council's
-- work stays and simply stops naming them.

create or replace function remove_member(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  actor       profiles;
  actor_kind  text;
  target      profiles;
  clean_email text;
  target_name text;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot remove anyone.';
  end if;
  select kind into actor_kind from units where id = actor.unit_id;

  clean_email := lower(trim(p_email));
  select * into target from profiles where lower(email) = clean_email;

  /* A Governor may remove their own council's people. Everybody else's are the
     National government's. */
  if not (actor_kind = 'national' and actor.access = 'officer') then
    if target.id is null or not actor.is_head or target.unit_id <> actor.unit_id then
      raise exception 'You may not remove that member.';
    end if;
  end if;

  if lower(actor.email) = clean_email then
    raise exception 'You cannot remove your own access.';
  end if;

  target_name := coalesce(nullif(target.full_name, ''), clean_email);

  /* Written before the deletion, because the actor is not being deleted but the
     subject is, and a log entry naming a row that is already gone is no use to
     anybody reading it later. */
  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'remove', 'profile', clean_email, target_name);

  -- The waiting enrolment, whether or not they ever claimed it.
  delete from enrolments where lower(email) = clean_email;

  /* The login. profiles and event_members cascade from it. If they were
     enrolled but never signed in there is no login and nothing to do here —
     deleting the enrolment above was the whole of it. */
  if target.id is not null then
    delete from auth.users where id = target.id;
    -- Belt and braces: if the cascade is not in place on some older project,
    -- the profile still goes.
    delete from profiles where id = target.id;
  end if;

  return true;
end;
$$;

grant execute on function remove_member(text) to authenticated;

-- Older tabs still call the old name. Same act, so let them.
create or replace function withdraw_member(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  return remove_member(p_email);
end;
$$;

grant execute on function withdraw_member(text) to authenticated;

-- ------------------------------------------------------ enrolling, and meaning it
-- Enrolling somebody is the act of saying they may sign in. It used to leave
-- `active` alone, which is what made a re-enrolment a lie the app reported as a
-- success. It says so now — and clears claimed_at, so an address being enrolled
-- afresh reads as waiting rather than as already claimed.
--
-- Dropped and recreated rather than overloaded, so PostgREST is never left
-- guessing which of two same-named functions a request meant.

drop function if exists enroll_member(text, text, text, uuid, text, uuid[]);
drop function if exists enroll_member(text, text, text, uuid, text, uuid[], boolean);

create or replace function enroll_member(
  p_email     text,
  p_full_name text,
  p_position  text,
  p_unit_id   uuid,
  p_access    text,
  p_event_ids uuid[] default '{}',
  p_is_head   boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare
  actor       profiles;
  actor_kind  text;
  target_kind text;
  clean_email text;
  head        boolean;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot enrol anyone.';
  end if;

  clean_email := lower(trim(p_email));
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address.';
  end if;

  select kind into actor_kind  from units where id = actor.unit_id;
  select kind into target_kind from units where id = p_unit_id;
  if target_kind is null then
    raise exception 'That unit does not exist.';
  end if;

  if p_access not in ('officer','volunteer') then
    raise exception 'Access must be officer or volunteer.';
  end if;

  head := coalesce(p_is_head, false);

  if actor_kind = 'national' and actor.access = 'officer' then
    null;
  elsif actor.is_head and actor.unit_id = p_unit_id then
    if actor_kind = 'province' and p_access <> 'volunteer' then
      raise exception
        'A province may enrol volunteers only. Elected and appointed posts are enrolled by the National government.';
    end if;
    if head then
      raise exception 'Only the National government names the head of a unit.';
    end if;
  else
    raise exception 'You may not enrol members for that unit.';
  end if;

  if p_access <> 'officer' then head := false; end if;

  update profiles set
    full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
    position   = trim(coalesce(p_position, '')),
    unit_id    = p_unit_id,
    access     = p_access,
    is_head    = head,
    active     = true,
    updated_at = now()
  where lower(email) = clean_email;

  insert into enrolments (email, full_name, position, unit_id, access, event_ids, invited_by, is_head)
  values (clean_email, trim(coalesce(p_full_name,'')), trim(coalesce(p_position,'')),
          p_unit_id, p_access, coalesce(p_event_ids, '{}'), actor.id, head)
  on conflict (email) do update set
    full_name  = excluded.full_name,
    position   = excluded.position,
    unit_id    = excluded.unit_id,
    access     = excluded.access,
    event_ids  = excluded.event_ids,
    invited_by = excluded.invited_by,
    is_head    = excluded.is_head,
    claimed_at = null;

  insert into event_members (event_id, profile_id)
  select ev.id, p.id
  from profiles p
  join events ev on ev.id = any (coalesce(p_event_ids, '{}'))
  where lower(p.email) = clean_email
  on conflict do nothing;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'enrol', 'enrolment', clean_email,
          p_access || (case when head then ' · head' else '' end) ||
          ' · ' || coalesce(p_position,'') || ' · ' || target_kind);

  return clean_email;
end;
$$;

-- --------------------------------------------------- letting the stuck back in
-- Anybody switched off by the old withdraw and then enrolled again is sitting
-- inactive with a live enrolment: their executive did the right thing and it
-- did not take. This puts exactly those people back, and nobody else.

update profiles p
   set active = true, updated_at = now()
  from enrolments e
 where lower(p.email) = lower(e.email)
   and p.active = false;
