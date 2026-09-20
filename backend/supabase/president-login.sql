-- FCUSR Task Tracker — move the President's own login off a personal address
--
-- Run this in Supabase → SQL Editor. Edit the three lines marked EDIT first.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SQL AND NOT A BUTTON
--
-- Switching somebody to a username is a button in the app. It refuses to do it
-- to the person pressing it, on purpose: the change signs that account out
-- everywhere, and an executive who did it to themselves halfway through would
-- be locked out of the screen they were standing on. The President's own login
-- is therefore changed here, once, by somebody who can already open the
-- database.
--
-- WHAT IT IS FOR
--
-- The first account was made with whichever address set the project up, which
-- is somebody's personal email. A term ends; the person leaves; the account
-- that holds the Republic should not leave with them. Give it a name the office
-- keeps — 'president' — or the council's own address, and hand it over at
-- turnover with a fresh password.
--
-- WHAT IT DOES
--
-- The same account, renamed: their tasks, their standing as head and their
-- directory entry all follow. Every session is closed, so the new login and
-- password are what works from that moment.

do $$
declare
  old_login text := 'arronaperocho1@gmail.com';   -- EDIT: the login you use now
  new_login text := 'president';                  -- EDIT: a username, or an email address
  new_pass  text := 'change-this-password';       -- EDIT: at least eight characters

  uid   uuid;
  login text;
begin
  login := lower(trim(new_login));
  if position('@' in login) = 0 then
    login := regexp_replace(login, '[^a-z0-9.]', '', 'g') || '@' || login_domain();
  end if;

  select id into uid from auth.users where lower(email) = lower(trim(old_login));
  if uid is null then
    raise exception 'No account signs in with %. Check the spelling.', old_login;
  end if;
  if exists (select 1 from auth.users where lower(email) = login and id <> uid) then
    raise exception '% is already taken by somebody else.', login;
  end if;
  if length(new_pass) < 8 then
    raise exception 'The password must be at least eight characters.';
  end if;

  update auth.users
     set email = login,
         encrypted_password = extensions.crypt(new_pass, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = case when raw_user_meta_data ? 'email'
                                   then raw_user_meta_data || jsonb_build_object('email', login)
                                   else raw_user_meta_data end,
         updated_at = now()
   where id = uid;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', login),
         updated_at = now()
   where user_id = uid and provider = 'email';

  update profiles set email = login, active = true, updated_at = now() where id = uid;

  update enrolments set email = login, claimed_at = coalesce(claimed_at, now())
   where lower(email) = lower(trim(old_login));

  update people
     set body = jsonb_set(jsonb_set(body, '{email}', to_jsonb(login)),
                          '{updatedAt}', to_jsonb(app_stamp()))
   where lower(coalesce(body->>'email', '')) = lower(trim(old_login));

  begin delete from auth.refresh_tokens where user_id = uid::text; exception when others then null; end;
  begin delete from auth.sessions where user_id = uid; exception when others then null; end;

  raise notice 'Signs in as % from now on.', split_part(login, '@', 1);
end $$;

select email as signs_in_as, full_name, position, is_head
from profiles
where unit_id = (select id from units where kind = 'national') and is_head
order by full_name;
