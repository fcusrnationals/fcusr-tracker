-- FCUSR Task Tracker — the executive creates the account
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Until now a person had two records that could disagree: an enrolment, which
-- is the executive's decision, and an account, which the person created later
-- by choosing a password. Nearly every enrolment fault this council has hit
-- lived in the gap between the two —
--
--   withdrawn and then impossible to add back
--   enrolled again and still refused at the door
--   sitting in "Waiting to sign in" with an account months old
--   a first-time volunteer told to ask an executive for a password that did
--     not exist
--
-- Create the account when the person is added and there is no "later", so
-- there is no gap for the two to drift apart in. This does not patch those
-- faults; it removes the thing that produces them.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS COSTS, PLAINLY
--
-- The executive chooses the password and therefore knows it. Nobody pretends
-- otherwise. That is the same power set_member_password already gives them, and
-- the council asked for it deliberately: their officers stand in the office and
-- ask, and an email link that never sends is not an answer.
--
-- Every issue is written to the audit log — that one was issued, by whom, for
-- whom. Never the password itself.
--
-- ---------------------------------------------------------------------------
-- THE RISK, EQUALLY PLAINLY
--
-- Creating a login means writing into auth.users and auth.identities, which
-- belong to Supabase and are not a supported place for anybody else to write.
-- A Supabase upgrade could change them and break account creation until it is
-- fixed. Two things make that bearable: set_member_password already writes to
-- auth.users and has worked; and all of it is in this one function, so a break
-- is one place to repair and loses nobody's data.

create or replace function create_member(
  p_email     text,
  p_password  text,
  p_full_name text,
  p_position  text,
  p_unit_id   uuid,
  p_access    text,
  p_event_ids uuid[] default '{}',
  p_is_head   boolean default false
) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  actor       profiles;
  actor_kind  text;
  target_kind text;
  clean_email text;
  head        boolean;
  uid         uuid;
  existing    uuid;
  has_prov_id boolean;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot add anyone.';
  end if;

  clean_email := lower(trim(p_email));
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'A password must be at least eight characters.';
  end if;
  if p_access not in ('officer','volunteer') then
    raise exception 'Access must be officer or volunteer.';
  end if;

  select kind into actor_kind  from units where id = actor.unit_id;
  select kind into target_kind from units where id = p_unit_id;
  if target_kind is null then
    raise exception 'That unit does not exist.';
  end if;

  head := coalesce(p_is_head, false);

  -- Who may add whom. Unchanged from enroll_member, deliberately: this is the
  -- same decision, made at the same moment, by the same people.
  if actor_kind = 'national' and actor.access = 'officer' then
    null;
  elsif actor.is_head and actor.unit_id = p_unit_id then
    if actor_kind = 'province' and p_access <> 'volunteer' then
      raise exception
        'A province may add volunteers only. Elected and appointed posts are added by the National government.';
    end if;
    if head then
      raise exception 'Only the National government names the head of a unit.';
    end if;
  else
    raise exception 'You may not add members for that unit.';
  end if;

  if p_access <> 'officer' then head := false; end if;

  select u.id into existing from auth.users u where lower(u.email) = clean_email;

  if existing is not null then
    /* They already have a login. This is then the same act as setting somebody's
       password, which is exactly what is wanted for the people who were left
       waiting: the account is theirs, it simply never had a password they were
       told. */
    uid := existing;
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = uid;

    -- Signed out everywhere, so the password they were just given is the one
    -- that works.
    begin delete from auth.refresh_tokens where user_id = uid::text; exception when others then null; end;
    begin delete from auth.sessions where user_id = uid; exception when others then null; end;
  else
    uid := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      clean_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', trim(coalesce(p_full_name, ''))),
      '', '', '', ''
    );

    /* Newer GoTrue will not accept a password sign-in without a matching
       identity row, and older versions have no provider_id column to put in it.
       Asked rather than assumed, because getting this wrong is the difference
       between an account that works and one that exists and cannot sign in. */
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'identities'
        and column_name = 'provider_id'
    ) into has_prov_id;

    if has_prov_id then
      insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid,
              jsonb_build_object('sub', uid::text, 'email', clean_email),
              'email', uid::text, now(), now(), now());
    else
      insert into auth.identities (id, user_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid,
              jsonb_build_object('sub', uid::text, 'email', clean_email),
              'email', now(), now(), now());
    end if;
  end if;

  -- The profile, which is what the app reads to decide what they can reach.
  insert into profiles (id, email, full_name, position, unit_id, access, is_head, active)
  values (uid, clean_email,
          coalesce(nullif(trim(p_full_name), ''), split_part(clean_email, '@', 1)),
          trim(coalesce(p_position, '')), p_unit_id, p_access, head, true)
  on conflict (id) do update set
    full_name  = coalesce(nullif(trim(p_full_name), ''), profiles.full_name),
    position   = trim(coalesce(p_position, '')),
    unit_id    = p_unit_id,
    access     = p_access,
    is_head    = head,
    active     = true,
    updated_at = now();

  /* The enrolment row stays, because the app still reads it, and it is marked
     claimed the moment the account exists — which is now, always. Nobody is
     ever "waiting" again. */
  insert into enrolments (email, full_name, position, unit_id, access, event_ids,
                          invited_by, is_head, claimed_at)
  values (clean_email, trim(coalesce(p_full_name,'')), trim(coalesce(p_position,'')),
          p_unit_id, p_access, coalesce(p_event_ids, '{}'), actor.id, head, now())
  on conflict (email) do update set
    full_name  = excluded.full_name,
    position   = excluded.position,
    unit_id    = excluded.unit_id,
    access     = excluded.access,
    event_ids  = excluded.event_ids,
    invited_by = excluded.invited_by,
    is_head    = excluded.is_head,
    claimed_at = now();

  insert into event_members (event_id, profile_id)
  select ev.id, uid from events ev
  where ev.id = any (coalesce(p_event_ids, '{}'))
  on conflict do nothing;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name,
          case when existing is null then 'create-account' else 'reissue-password' end,
          'profile', clean_email,
          p_access || (case when head then ' · head' else '' end) ||
          ' · ' || coalesce(p_position,'') || ' · ' || target_kind);

  return clean_email;
end;
$$;

grant execute on function create_member(text, text, text, text, uuid, text, uuid[], boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- WHO IS STILL WAITING
--
-- Everybody enrolled who has no login — including volunteers, who are enrolled
-- through a different door and do not always show on the roster. The app reads
-- this to offer them all a password in one go.

create or replace function waiting_members()
/* "position" in quotes: it is a reserved word in Postgres — position(x in y) is
   a built-in — and a bare one in a returns-table declaration is a syntax error.
   It is fine as an ordinary column name everywhere else, which is why this was
   the only place it bit. */
returns table (email text, full_name text, "position" text, unit_id uuid, access text,
               event_ids uuid[], is_head boolean)
language sql security definer set search_path = public, auth as $$
  select e.email, e.full_name, e.position, e.unit_id, e.access,
         coalesce(e.event_ids, '{}'), coalesce(e.is_head, false)
  from enrolments e
  where is_national()
    and not exists (select 1 from auth.users u where lower(u.email) = lower(e.email))
  order by e.full_name, e.email;
$$;

grant execute on function waiting_members() to authenticated;

-- ---------------------------------------------------------------------------
-- DID IT TAKE?

select 'create_member'    as needed, to_regprocedure(
  'public.create_member(text,text,text,text,uuid,text,uuid[],boolean)') is not null as installed
union all select 'waiting_members', to_regprocedure('public.waiting_members()') is not null
order by 1;
