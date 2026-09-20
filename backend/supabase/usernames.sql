-- FCUSR Task Tracker — sign in with a username the system makes
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
-- Needs accounts.sql and remove.sql to have been run first (they have).
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- A login was an email address somebody typed. Most of what went wrong with
-- accounts this term came from that one fact: an address mistyped, a different
-- address in the directory than on the account, an address changed and the old
-- login left behind, "already in the directory" for a person who was not.
--
-- A username made by the system from the person's name cannot be mistyped by
-- whoever adds them and never changes. Promoting, demoting or moving somebody
-- is editing their entry; their username and password stay exactly as they are.
--
-- ---------------------------------------------------------------------------
-- HOW, PLAINLY
--
-- Supabase will only sign somebody in with an email address. So a username is
-- stored as one nobody ever sees:
--
--     juan.delacruz   is kept as   juan.delacruz@fcusr.invalid
--
-- ".invalid" is reserved worldwide for exactly this: it can never be a real
-- address, so no mail can ever be sent to it or reach a stranger. People type
-- only "juan.delacruz"; the app adds the rest.
--
-- Everything already built on addresses — who may read what, whose tasks are
-- whose, removing somebody — keeps working unchanged, because to all of it a
-- username is simply an address.
--
-- ---------------------------------------------------------------------------
-- WHAT IT ADDS
--
--   create_login         Makes a new person's login. Picks a free username from
--                        their name (juan.delacruz, then juan.delacruz2, ...)
--                        and never touches anybody else's account.
--
--   switch_to_username   Moves somebody who signs in with an email address onto
--                        a username, with a new password. Same account: their
--                        tasks, activities and history stay theirs.
--
-- AND FIXES
--
--   enroll_member        Saving a change to somebody who already had an account
--                        marked them "enrolled again" on the account list, as if
--                        they were waiting for a login they already had.
--
--   set_member_password  Told an executive to use "Change my password" for their
--                        own, which no longer exists.
--
-- Current leaders who sign in with an email address are not touched by running
-- this. They keep signing in exactly as they do now until somebody presses
-- "Switch to a username" for them.

-- ================================================================ 1. helpers

create or replace function login_domain() returns text
language sql immutable as $$ select 'fcusr.invalid'::text $$;

-- The username to use for a suggestion: cleaned, and made unique by a number.
create or replace function free_username(p_base text) returns text
language plpgsql stable security definer set search_path = public, auth as $$
declare
  base      text;
  candidate text;
  n         int := 1;
begin
  base := lower(coalesce(p_base, ''));
  base := regexp_replace(base, '[^a-z0-9.]', '', 'g');
  base := regexp_replace(base, '\.{2,}', '.', 'g');
  base := trim(both '.' from base);
  base := trim(both '.' from left(base, 24));
  if base !~ '^[a-z]' then base := 'member' || base; end if;

  candidate := base;
  loop
    exit when not exists (select 1 from auth.users u
                          where lower(u.email) = candidate || '@' || login_domain())
          and not exists (select 1 from profiles p
                          where lower(p.email) = candidate || '@' || login_domain())
          and not exists (select 1 from enrolments e
                          where lower(e.email) = candidate || '@' || login_domain());
    n := n + 1;
    candidate := base || n;
  end loop;
  return candidate;
end;
$$;

-- Internal only: nobody needs to ask which usernames exist.
revoke execute on function free_username(text) from public;
do $$ begin
  execute 'revoke execute on function free_username(text) from anon, authenticated';
exception when others then null;
end $$;

-- The app's own timestamp shape, so every phone treats a server-side change to
-- a directory entry as newer than the copy it holds.
create or replace function app_stamp() returns text
language sql stable as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ============================================================ 2. a new login

create or replace function create_login(
  p_base      text,
  p_password  text,
  p_full_name text,
  p_position  text,
  p_unit_id   uuid,
  p_access    text,
  p_event_ids uuid[]  default '{}',
  p_is_head   boolean default false,
  p_replaces  text    default null
) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  username text;
  login    text;
  old      text;
begin
  /* One at a time. Two people with the same name added in the same moment must
     not both be handed the same username — the second would overwrite the
     first's password. */
  perform pg_advisory_xact_lock(hashtext('fcusr.logins'));

  /* Somebody enrolled under the old way, by an address, who never got a login.
     Their enrolment is replaced by this one and their directory entry is
     pointed at the new username. Anybody whose address already has a login is
     not a replacement — that is switch_to_username. */
  old := lower(trim(coalesce(p_replaces, '')));
  if old <> '' then
    if exists (select 1 from auth.users u where lower(u.email) = old) then
      raise exception '% already has a login. Use "Switch to a username" for them instead.', old;
    end if;
    if not is_national() and exists (
      select 1 from enrolments e where lower(e.email) = old and e.unit_id <> p_unit_id
    ) then
      raise exception 'That enrolment belongs to another unit.';
    end if;
  end if;

  username := free_username(coalesce(nullif(trim(p_base), ''), p_full_name));
  login := username || '@' || login_domain();

  -- Every rule about who may add whom lives in create_member, and applies here.
  perform create_member(login, p_password, p_full_name, p_position, p_unit_id,
                        p_access, coalesce(p_event_ids, '{}'), coalesce(p_is_head, false));

  if old <> '' then
    delete from enrolments where lower(email) = old;
    update people
       set body = jsonb_set(jsonb_set(body, '{email}', to_jsonb(login)),
                            '{updatedAt}', to_jsonb(app_stamp()))
     where lower(coalesce(body->>'email', '')) = old
       and (is_national() or unit_id = p_unit_id);
  end if;

  return username;
end;
$$;

grant execute on function create_login(text, text, text, text, uuid, text, uuid[], boolean, text)
  to authenticated;

-- ================================================ 3. from an address to a username

create or replace function switch_to_username(p_email text, p_base text, p_password text)
returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  actor      profiles;
  actor_kind text;
  target     profiles;
  old        text;
  username   text;
  login      text;
begin
  perform pg_advisory_xact_lock(hashtext('fcusr.logins'));

  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot change anybody''s sign-in.';
  end if;
  select kind into actor_kind from units where id = actor.unit_id;

  old := lower(trim(coalesce(p_email, '')));
  select * into target from profiles where lower(email) = old;
  if target.id is null then
    raise exception 'There is no login for % yet.', old;
  end if;
  if old like '%@' || login_domain() then
    raise exception '% already signs in with a username.', split_part(old, '@', 1);
  end if;
  if target.id = actor.id then
    raise exception 'You cannot switch your own sign-in. Ask another national executive to do it.';
  end if;
  if not (actor_kind = 'national' and actor.access = 'officer') then
    if not actor.is_head or target.unit_id <> actor.unit_id then
      raise exception 'You may not change that member''s sign-in.';
    end if;
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'A password must be at least eight characters.';
  end if;

  username := free_username(coalesce(nullif(trim(p_base), ''), target.full_name));
  login := username || '@' || login_domain();

  update auth.users
     set email = login,
         encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = case when raw_user_meta_data ? 'email'
                                   then raw_user_meta_data || jsonb_build_object('email', login)
                                   else raw_user_meta_data end,
         updated_at = now()
   where id = target.id;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', login),
         updated_at = now()
   where user_id = target.id and provider = 'email';

  update profiles set email = login, active = true, updated_at = now() where id = target.id;
  update enrolments set email = login, claimed_at = coalesce(claimed_at, now())
   where lower(email) = old;

  /* Their directory entry, here as well as on the executive's phone, so the
     person can see their own tasks the moment they sign in with the new name —
     not only once that phone next syncs. */
  update people
     set body = jsonb_set(jsonb_set(body, '{email}', to_jsonb(login)),
                          '{updatedAt}', to_jsonb(app_stamp()))
   where lower(coalesce(body->>'email', '')) = old;

  -- Signed out everywhere, so the new username and password are what works.
  begin delete from auth.refresh_tokens where user_id = target.id::text; exception when others then null; end;
  begin delete from auth.sessions where user_id = target.id; exception when others then null; end;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'switch-to-username', 'profile', login, old);

  return username;
end;
$$;

grant execute on function switch_to_username(text, text, text) to authenticated;

-- ============================================ 4. saving a change keeps a login

drop function if exists enroll_member(text, text, text, uuid, text, uuid[]);

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
    /* Only somebody with no login is waiting for one. This used to clear it for
       everybody, so every saved edit put a person with a working login back on
       the list as "enrolled again". */
    claimed_at = case
      when exists (select 1 from profiles p where lower(p.email) = excluded.email)
        then coalesce(enrolments.claimed_at, now())
      else null
    end;

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

grant execute on function enroll_member(text, text, text, uuid, text, uuid[], boolean) to authenticated;

-- Everybody already marked "enrolled again" while having a login.
update enrolments e
   set claimed_at = now()
 where e.claimed_at is null
   and exists (select 1 from profiles p where lower(p.email) = lower(e.email));

-- ========================================== 5. a forgotten password, reworded

create or replace function set_member_password(p_email text, p_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  actor       profiles;
  actor_kind  text;
  target      profiles;
  clean_email text;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot set anybody''s password.';
  end if;
  select kind into actor_kind from units where id = actor.unit_id;

  clean_email := lower(trim(p_email));
  select * into target from profiles where lower(email) = clean_email;
  if target.id is null then
    raise exception 'That person has no login yet, so there is no password to set.';
  end if;
  if lower(actor.email) = clean_email then
    raise exception 'You cannot set your own password here. Ask another national executive.';
  end if;
  if not (actor_kind = 'national' and actor.access = 'officer') then
    if not actor.is_head or target.unit_id <> actor.unit_id then
      raise exception 'You may not set that member''s password.';
    end if;
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'A password must be at least eight characters.';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   where id = target.id;

  update profiles set active = true, updated_at = now()
   where id = target.id and active = false;

  begin delete from auth.refresh_tokens where user_id = target.id::text; exception when others then null; end;
  begin delete from auth.sessions where user_id = target.id; exception when others then null; end;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'set-password', 'profile', clean_email, '');

  return true;
end;
$$;

grant execute on function set_member_password(text, text) to authenticated;

-- ================================================================ did it take?

select 'create_login' as needed,
       to_regprocedure('public.create_login(text,text,text,text,uuid,text,uuid[],boolean,text)') is not null as done
union all select 'switch_to_username',
       to_regprocedure('public.switch_to_username(text,text,text)') is not null
union all select 'enroll_member keeps a login',
       exists (select 1 from pg_proc where proname = 'enroll_member'
               and prosrc like '%coalesce(enrolments.claimed_at, now())%')
union all select 'set_member_password reworded',
       exists (select 1 from pg_proc where proname = 'set_member_password'
               and prosrc like '%Ask another national executive%')
order by 1;
