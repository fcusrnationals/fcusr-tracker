-- FCUSR Task Tracker — a volunteer joins an activity with its code
--
-- Run this in Supabase → SQL Editor. Safe to run twice.
-- Needs usernames.sql to have been run first.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Taking on forty helpers for one activity meant an officer typing forty names
-- and handing out forty passwords, and every one of them was a chance for
-- somebody to be stranded at the door. A volunteer is also the person least
-- likely to come back and ask for help when it goes wrong.
--
-- So the activity carries a code — NURSEWEEK-4827 — and a volunteer types the
-- code and their own name at the door. That is the whole of it. There is no
-- password to lose: the code IS the password, held for them by the app.
--
-- ---------------------------------------------------------------------------
-- WHAT A CODE CAN AND CANNOT DO
--
-- Anybody holding it can join that one activity, as a volunteer, under whatever
-- name they type. That is deliberate and it is what the council asked for: the
-- code is an internal memo, the access it grants is one activity's task list,
-- and the officer can end it in one tap.
--
-- A code can never:
--   * make an officer, or a head of anything
--   * reach any other activity, or any other unit
--   * work on an activity that is completed, cancelled or archived
--   * be used after the officer has replaced or stopped it — replacing the code
--     changes the password of everybody who joined with the old one
--
-- The cap of 400 is there so a leaked code cannot be used to fill the database.

create or replace function join_with_code(p_code text, p_name text)
returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  code        text;
  clean_name  text;
  ev          events;
  uid         uuid;
  username    text;
  login       text;
  base        text;
  has_prov_id boolean;
  joined      int;
  person_id   uuid;
begin
  code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  clean_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  clean_name := left(clean_name, 80);

  if length(code) < 4 then
    raise exception 'That code does not look right. Ask the officer to read it out again.';
  end if;
  if length(clean_name) < 2 then
    raise exception 'Type your full name, the way it should appear on the activity.';
  end if;

  select * into ev from events e
   where upper(coalesce(e.body->>'volunteerCode', '')) = code
     and coalesce(e.status, '') not in ('Completed', 'Cancelled', 'Archived')
   limit 1;

  if ev.id is null then
    raise exception 'That code is not open. Ask the officer for the one they are using now.';
  end if;

  select count(*) into joined from event_members m where m.event_id = ev.id;
  if joined >= 400 then
    raise exception 'This activity already has as many volunteers as it can take.';
  end if;

  /* Somebody who has joined this activity before, under this name. They get
     their own account back rather than a second one — and its password becomes
     the code that is open now, which is how replacing a code shuts out
     everybody who joined with the old one. */
  select p.id into uid
    from profiles p
    join event_members m on m.profile_id = p.id and m.event_id = ev.id
   where p.access = 'volunteer' and lower(p.full_name) = lower(clean_name)
   limit 1;

  if uid is null then
    base := lower(regexp_replace(clean_name, '[^A-Za-z0-9]+', '.', 'g'));
    base := trim(both '.' from base);
    username := free_username(base);
    login := username || '@' || login_domain();
    uid := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      login, extensions.crypt(code, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', clean_name),
      '', '', '', ''
    );

    -- Newer GoTrue refuses a password sign-in without a matching identity row;
    -- older versions have no provider_id column to put in it.
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
    ) into has_prov_id;

    if has_prov_id then
      insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid,
              jsonb_build_object('sub', uid::text, 'email', login),
              'email', uid::text, now(), now(), now());
    else
      insert into auth.identities (id, user_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid,
              jsonb_build_object('sub', uid::text, 'email', login),
              'email', now(), now(), now());
    end if;
  else
    select lower(email) into login from auth.users where id = uid;
    username := split_part(login, '@', 1);
    update auth.users
       set encrypted_password = extensions.crypt(code, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = uid;
  end if;

  /* A volunteer of that activity's unit, and nothing else. Never an officer,
     never a head — a code cannot grant either, whatever is typed into it. */
  insert into profiles (id, email, full_name, position, unit_id, access, is_head, active)
  values (uid, login, clean_name, 'Volunteer', ev.unit_id, 'volunteer', false, true)
  on conflict (id) do update set
    full_name = excluded.full_name,
    unit_id   = excluded.unit_id,
    access    = 'volunteer',
    is_head   = false,
    active    = true,
    updated_at = now();

  insert into enrolments (email, full_name, position, unit_id, access, event_ids, claimed_at)
  values (login, clean_name, 'Volunteer', ev.unit_id, 'volunteer', array[ev.id], now())
  on conflict (email) do update set
    full_name  = excluded.full_name,
    unit_id    = excluded.unit_id,
    access     = 'volunteer',
    event_ids  = excluded.event_ids,
    claimed_at = now();

  insert into event_members (event_id, profile_id) values (ev.id, uid)
  on conflict do nothing;

  /* And a directory entry, so the officers can give them work. Matched on the
     login, so somebody rejoining is the same person rather than a second one. */
  select pe.id into person_id from people pe
   where lower(coalesce(pe.body->>'email', '')) = login limit 1;

  if person_id is null then
    person_id := gen_random_uuid();
    insert into people (id, unit_id, name, active, body)
    values (person_id, ev.unit_id, clean_name, true,
      jsonb_build_object(
        'id', person_id::text, 'name', clean_name, 'position', 'Volunteer', 'committee', '',
        'email', login, 'unitId', ev.unit_id::text, 'access', 'volunteer',
        'eventIds', jsonb_build_array(ev.id::text), 'claimed', true, 'isHead', false,
        'active', true, 'createdAt', app_stamp(), 'updatedAt', app_stamp()));
  else
    update people
       set body = jsonb_set(
             jsonb_set(body, '{eventIds}',
               case when body->'eventIds' @> to_jsonb(array[ev.id::text])
                    then body->'eventIds'
                    else coalesce(body->'eventIds', '[]'::jsonb) || to_jsonb(array[ev.id::text]) end),
             '{updatedAt}', to_jsonb(app_stamp())),
           active = true,
           updated_at = now()
     where id = person_id;
  end if;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (uid, clean_name, 'join-with-code', 'event', ev.id::text, ev.title);

  return username;
end;
$$;

-- The one function in this database a signed-out visitor may call. It is the
-- door a volunteer knocks on, and it opens only for a code that is open.
grant execute on function join_with_code(text, text) to anon, authenticated;

-- ================================================================ did it take?

select 'join_with_code' as needed,
       to_regprocedure('public.join_with_code(text,text)') is not null as done
union all select 'a signed-out visitor may call it',
       has_function_privilege('anon', 'public.join_with_code(text,text)', 'execute')
order by 1;
