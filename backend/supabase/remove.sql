-- FCUSR Task Tracker — removing somebody, and adding them back
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
--
-- ---------------------------------------------------------------------------
-- THE BUG
--
-- Withdrawing somebody set profiles.active = false. Enrolling somebody updated
-- their name, position, unit, access and standing — and never touched `active`.
--
-- So an address that had once been withdrawn could be enrolled again, and
-- again, and the enrolment appeared to work every time: the executive saw a
-- success message, the person appeared on the list. They still could not sign
-- in, because they were still inactive, and the door told them their account
-- had been withdrawn. There was no way out of that state from inside the app.
--
-- The app made it worse: a withdrawn person sat under a heading of their own
-- with every button removed, so there was nothing to press even to try.
--
-- Enrolling somebody IS saying they may sign in. It now says so.

-- ------------------------------------------------ enrol, and mean it
-- Identical to heads.sql's version but for one line: active = true. Dropped
-- and recreated rather than overloaded, so PostgREST is never left guessing
-- which of two same-named functions a request meant.

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

  /* active = true is the whole fix. Enrolling somebody is the act of saying
     they may sign in; leaving them switched off afterwards made the enrolment
     a lie the app then reported as a success. */
  update profiles set
    full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
    position   = trim(coalesce(p_position, '')),
    unit_id    = p_unit_id,
    access     = p_access,
    is_head    = head,
    active     = true,
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
    is_head    = excluded.is_head,
    claimed_at = null;

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

-- ------------------------------------------------------- removing somebody
-- The same act withdraw_member performed, under the word the app now uses.
-- A person is taken off the list; their tasks, letters and filed reports are
-- untouched, because those belong to the council and not to the account.
--
-- Their login itself is not deleted — that lives in Supabase Auth, and
-- deleting it needs a key this app deliberately does not carry. Inactive is
-- what stops them: the door refuses an inactive profile.

create or replace function remove_member(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  actor       profiles;
  actor_kind  text;
  target      profiles;
  clean_email text;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot remove anyone.';
  end if;
  select kind into actor_kind from units where id = actor.unit_id;

  clean_email := lower(trim(p_email));
  select * into target from profiles where email = clean_email;

  if not (actor_kind = 'national' and actor.access = 'officer') then
    if target.id is null or not actor.is_head or target.unit_id <> actor.unit_id then
      raise exception 'You may not remove that member.';
    end if;
  end if;

  if lower(actor.email) = clean_email then
    raise exception 'You cannot remove your own access.';
  end if;

  delete from enrolments where email = clean_email;
  update profiles set active = false, updated_at = now() where email = clean_email;
  if target.id is not null then
    delete from event_members where profile_id = target.id;
  end if;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'remove', 'profile', clean_email, '');

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

-- --------------------------------------------------- letting the stuck back in
-- Anybody switched off by the old withdraw and then enrolled again is sitting
-- inactive with a live enrolment: the executive did the right thing and it did
-- not take. This puts exactly those people back, and touches nobody else.

update profiles p
   set active = true, updated_at = now()
  from enrolments e
 where lower(p.email) = lower(e.email)
   and p.active = false;
