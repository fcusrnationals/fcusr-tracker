-- FCUSR Task Tracker — enrolling somebody who already set a password
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
--
-- ---------------------------------------------------------------------------
-- THE TRAP
--
-- A profile is made in one place only: the trigger that fires when a login is
-- created. And it makes one only if an enrolment is already sitting there
-- waiting:
--
--     select * into e from enrolments where email = ...;
--     if e.email is null then return new; end if;
--
-- So this happens, and it happens most to volunteers, because a volunteer is
-- the person handed the link casually and told to sign up:
--
--   1. They open the site and set a password before anybody has enrolled them.
--   2. The login is created. There is no enrolment, so there is no profile.
--   3. The door tells them the address has not been enrolled and to ask a
--      national executive.
--   4. The executive enrols them. enroll_member updates profiles by email —
--      and there is no profile row, so it updates nothing at all. It writes an
--      enrolment, and the enrolment is never claimed, because claiming only
--      ever happens at the moment a login is created and theirs already exists.
--   5. They sign in with the password they set in step 1 and are told, again,
--      to ask a national executive.
--
-- Forever. Nothing in the app can undo it, the executive can see they did the
-- right thing, and the person is looking at a door that will not open. It is
-- the same shape as the withdrawal trap: a record half-made, and every screen
-- reporting success.
--
-- Enrolling somebody is the act of saying they may sign in. If they already
-- have a login, that is not a reason it cannot work — it is the ordinary case
-- of somebody keen enough to have turned up early.

-- --------------------------------------------------------- enroll_member
-- Identical to the version in remove.sql but for one block: a profile is made
-- when the login exists and the profile does not.

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
  existing    uuid;
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

  /* ---------------------------------------------------------------- the fix
     They already have a login and no profile: they opened the site and set a
     password before anybody enrolled them. The update below would touch nothing
     and they would be stuck for ever, so the profile is made here instead. */
  select u.id into existing
  from auth.users u
  where lower(u.email) = clean_email
    and not exists (select 1 from profiles pr where pr.id = u.id)
  limit 1;

  if existing is not null then
    insert into profiles (id, email, full_name, position, unit_id, access, is_head, active)
    values (existing, clean_email,
            coalesce(nullif(trim(p_full_name), ''), split_part(clean_email, '@', 1)),
            trim(coalesce(p_position, '')), p_unit_id, p_access, head, true)
    on conflict (id) do nothing;
  end if;

  update profiles set
    full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
    position   = trim(coalesce(p_position, '')),
    unit_id    = p_unit_id,
    access     = p_access,
    is_head    = head,
    active     = true,
    updated_at = now()
  where lower(email) = clean_email;

  /* claimed_at says whether a login exists for this address. It is set here
     when one does, so somebody who turned up early is not filed for ever under
     "waiting to sign in" — where the app offers an invitation to send and not
     the things you would actually want to do to an account that exists. */
  insert into enrolments (email, full_name, position, unit_id, access, event_ids, invited_by, is_head, claimed_at)
  values (clean_email, trim(coalesce(p_full_name,'')), trim(coalesce(p_position,'')),
          p_unit_id, p_access, coalesce(p_event_ids, '{}'), actor.id, head,
          (select now() from auth.users u where lower(u.email) = clean_email limit 1))
  on conflict (email) do update set
    full_name  = excluded.full_name,
    position   = excluded.position,
    unit_id    = excluded.unit_id,
    access     = excluded.access,
    event_ids  = excluded.event_ids,
    invited_by = excluded.invited_by,
    is_head    = excluded.is_head,
    claimed_at = excluded.claimed_at;

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

-- ------------------------------------------------- and the same at the door
-- The trigger keeps its own guard for the opposite order — enrolled first, then
-- signs up — but it should not silently do nothing when there is no enrolment.
-- There is nothing useful it can do in that case, and that is fine: the app now
-- tells the person plainly to ask to be enrolled and then to come back and sign
-- in with the password they just set, which does work once enroll_member runs.

-- ----------------------------------------------------- letting the stuck in
-- Anybody already caught: a login, an enrolment, and no profile between them.
-- Exactly those people, and nobody else.

insert into profiles (id, email, full_name, position, unit_id, access, is_head, active)
select u.id, lower(u.email),
       coalesce(nullif(e.full_name, ''), split_part(lower(u.email), '@', 1)),
       coalesce(e.position, ''), e.unit_id, e.access, coalesce(e.is_head, false), true
from auth.users u
join enrolments e on lower(e.email) = lower(u.email)
where not exists (select 1 from profiles pr where pr.id = u.id)
on conflict (id) do nothing;

-- Their activities, for the volunteers among them.
insert into event_members (event_id, profile_id)
select ev.id, p.id
from profiles p
join enrolments e on lower(e.email) = lower(p.email)
join events ev on ev.id = any (coalesce(e.event_ids, '{}'))
on conflict do nothing;

-- And their enrolments read as claimed, because a login exists.
update enrolments e
   set claimed_at = coalesce(e.claimed_at, now())
  from auth.users u
 where lower(u.email) = lower(e.email);

-- What it repaired, so the result is not a silent success.
select count(*) as people_who_were_stuck_and_are_now_let_in
from profiles p
join auth.users u on u.id = p.id
where p.created_at > now() - interval '1 minute';
