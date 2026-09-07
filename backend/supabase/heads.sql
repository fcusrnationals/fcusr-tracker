-- FCUSR Task Tracker — Governors and Vice Governors
--
-- Run this AFTER security.sql, in Supabase → SQL Editor. Safe to run twice.
--
-- A unit's head — the Governor, and the Vice Governor who stands in — gets the
-- settings of their own council and nothing else. The app has read `is_head`
-- for a while; what it could never do is set it. The only way anybody became a
-- head was a line of SQL typed by hand, which is not a way to run a Republic
-- with twelve colleges in it.
--
-- Standing has to survive the gap between being enrolled and signing in for the
-- first time, so it is recorded on the enrolment and carried onto the profile
-- when that person claims it.

alter table enrolments add column if not exists is_head boolean not null default false;

-- ------------------------------------------------------- enrolling a head
-- Same gateway as before, with standing added. Dropped and recreated rather
-- than overloaded: two functions of the same name with different arguments
-- leaves PostgREST guessing which one a request meant.

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

  /* Who may create whom, unchanged — with one addition: naming the head of a
     unit is the National government's to do. A Governor may take on helpers
     for their own college; they may not appoint their own successor, or
     promote a friend to stand beside them. */
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

  -- A volunteer is nobody's head, whatever was asked for.
  if p_access <> 'officer' then head := false; end if;

  update profiles set
    full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
    position   = trim(coalesce(p_position, '')),
    unit_id    = p_unit_id,
    access     = p_access,
    is_head    = head,
    updated_at = now()
  where email = clean_email;

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
    is_head    = excluded.is_head;

  insert into event_members (event_id, profile_id)
  select ev.id, p.id
  from profiles p
  join events ev on ev.id = any (coalesce(p_event_ids, '{}'))
  where p.email = clean_email
  on conflict do nothing;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'enrol', 'enrolment', clean_email,
          p_access || (case when head then ' · head' else '' end) ||
          ' · ' || coalesce(p_position,'') || ' · ' || target_kind);

  return clean_email;
end;
$$;

-- ------------------------------------------- standing survives the wait
-- Somebody enrolled as a Governor is a Governor the moment they set their
-- password, not whenever an executive remembers to go back and mark them.

create or replace function claim_enrolment() returns trigger
language plpgsql security definer set search_path = public as $$
declare e enrolments;
begin
  select * into e from enrolments where email = lower(trim(new.email));
  if e.email is null then
    return new;
  end if;

  insert into profiles (id, email, full_name, position, unit_id, access, is_head)
  values (new.id, e.email,
          coalesce(nullif(e.full_name, ''), split_part(e.email, '@', 1)),
          e.position, e.unit_id, e.access, coalesce(e.is_head, false))
  on conflict (id) do nothing;

  insert into event_members (event_id, profile_id)
  select ev.id, new.id
  from events ev
  where ev.id = any (coalesce(e.event_ids, '{}'))
  on conflict do nothing;

  update enrolments set claimed_at = now() where email = e.email;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (new.id, coalesce(nullif(e.full_name,''), e.email), 'claim', 'profile',
          new.id::text, e.access);

  return new;
end;
$$;

-- ------------------------------------------------- naming a head, later
-- For somebody already enrolled. Only the National government, and never
-- yourself: a President cannot quietly unmake the officer who could unmake
-- them, and nobody promotes themselves.

create or replace function set_unit_head(p_email text, p_is_head boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare clean_email text;
begin
  if not is_national() then
    raise exception 'Only the National government names the head of a unit.';
  end if;

  clean_email := lower(trim(p_email));
  if clean_email = (select lower(email) from profiles where id = auth.uid()) then
    raise exception 'You cannot change your own standing.';
  end if;

  update profiles  set is_head = coalesce(p_is_head, false), updated_at = now()
    where email = clean_email;
  update enrolments set is_head = coalesce(p_is_head, false)
    where email = clean_email;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  select auth.uid(), p.full_name, case when p_is_head then 'name-head' else 'unname-head' end,
         'profile', clean_email, ''
  from profiles p where p.id = auth.uid();

  return true;
end;
$$;

grant execute on function set_unit_head(text, boolean) to authenticated;
