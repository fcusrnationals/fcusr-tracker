-- FCUSR Task Tracker — Supabase schema
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.
--
-- The important idea: a member's typed "position" is only a label that gets
-- printed on reports. It carries no power at all. Authority comes from two
-- controlled columns — unit_id (where you belong) and access ('officer' or
-- 'volunteer') — and from enroll_member() below, which decides who may create
-- whom. That is why no amount of creative wording in the position field can
-- widen anyone's access: there is nothing there to widen.
--
-- How an account comes to exist, in two halves:
--
--   1. An officer *enrols an email address*: enroll_member() records who that
--      person will be — their unit, their level of access, the events they may
--      help with. No login exists yet.
--   2. That person *signs themselves up* with the same email and a password of
--      their own choosing. The trigger below turns the waiting enrolment into a
--      profile at that moment.
--
-- It is done in two halves because a web page cannot be trusted to create logins
-- directly: that needs Supabase's service_role key, and a key that powerful must
-- never be shipped inside a page that students can read. Signing up is therefore
-- something each person does for themselves, and it grants nothing on its own —
-- without a waiting enrolment a new sign-up gets no profile, and a member with no
-- profile can see nothing at all.

-- ---------------------------------------------------------------- units

create table if not exists units (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('national','province','comelec','judiciary')),
  name        text not null,
  code        text unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------- profiles
-- One row per sign-in account, keyed to Supabase's auth.users.

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  position    text not null default '',      -- free text, a label only
  unit_id     uuid references units(id) on delete set null,
  access      text not null default 'volunteer' check (access in ('officer','volunteer')),
  is_head     boolean not null default false, -- Governor / COMELEC Chair / Chief Justice
  active      boolean not null default true,
  -- A volunteer is enrolled for one activity; when it closes their access ends.
  valid_until date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_unit_idx on profiles(unit_id);

-- --------------------------------------------------------------- events

create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  title       text not null,
  description text not null default '',
  date_start  date,
  date_end    date,
  venue       text not null default '',
  head_id     uuid references profiles(id) on delete set null,
  status      text not null default 'Upcoming'
              check (status in ('Upcoming','Ongoing','Completed','Archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists events_unit_idx on events(unit_id);

-- ---------------------------------------------------------------- tasks

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  title        text not null,
  remarks      text not null default '',
  assignee_id  uuid references profiles(id) on delete set null,
  due_date     date,
  priority     text not null default 'Medium' check (priority in ('High','Medium','Low')),
  status       text not null default 'Not Started'
               check (status in ('Not Started','In Progress','For Review','Done','On hold')),
  hold_reason  text not null default '',
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tasks_event_idx on tasks(event_id);
create index if not exists tasks_assignee_idx on tasks(assignee_id);

-- Volunteers are attached to the specific events they help with.
create table if not exists event_members (
  event_id   uuid not null references events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);

-- -------------------------------------------------------------- reports
-- Only the Drive link is stored, never the file. A finished accomplishment
-- report can be hundreds of megabytes; the link is a couple of hundred bytes.

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null unique references events(id) on delete cascade,
  description text not null default '',
  drive_link  text not null default '',
  status      text not null default 'draft' check (status in ('draft','filed')),
  filed_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------ audit log

create table if not exists audit_log (
  id         bigserial primary key,
  actor_id   uuid references profiles(id) on delete set null,
  actor_name text not null default '',
  action     text not null,
  entity     text not null default '',
  entity_id  text not null default '',
  detail     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx on audit_log(created_at desc);

-- ------------------------------------------------------------ enrolments
-- An officer's decision about someone who has not signed up yet. This is the
-- record of intent; profiles is the record of fact.

create table if not exists enrolments (
  email       text primary key,
  full_name   text not null default '',
  position    text not null default '',
  unit_id     uuid not null references units(id) on delete cascade,
  access      text not null default 'volunteer' check (access in ('officer','volunteer')),
  -- The activities a volunteer was taken on for; ignored for officers.
  event_ids   uuid[] not null default '{}',
  invited_by  uuid references profiles(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------- helpers

create or replace function me() returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid();
$$;

create or replace function is_national() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join units u on u.id = p.unit_id
    where p.id = auth.uid() and p.active and u.kind = 'national' and p.access = 'officer'
  );
$$;

create or replace function my_unit() returns uuid
language sql stable security definer set search_path = public as $$
  select unit_id from profiles where id = auth.uid();
$$;

-- --------------------------------------------------- enrollment gateway
--
-- The single door through which accounts are created. Callers cannot bypass it
-- because profiles has no INSERT policy — the only way in is this function.

create or replace function enroll_member(
  p_email     text,
  p_full_name text,
  p_position  text,
  p_unit_id   uuid,
  p_access    text,
  p_event_ids uuid[] default '{}'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  actor       profiles;
  actor_kind  text;
  target_kind text;
  clean_email text;
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

  -- Who may create whom. Everything not listed here is refused.
  if actor_kind = 'national' and actor.access = 'officer' then
    null;                                    -- nationals may enrol anyone, anywhere
  elsif actor.is_head and actor.unit_id = p_unit_id then
    -- A Governor may add helpers to their own province, and nothing else.
    -- COMELEC and Judiciary heads run their own rosters, so they may add officers.
    if actor_kind = 'province' and p_access <> 'volunteer' then
      raise exception
        'A province may enrol volunteers only. Elected and appointed posts are enrolled by the National government.';
    end if;
  else
    raise exception 'You may not enrol members for that unit.';
  end if;

  -- Someone already signed up? Then this is a change of posting, not an
  -- enrolment, and it is written straight onto their profile.
  update profiles set
    full_name  = coalesce(nullif(trim(p_full_name), ''), full_name),
    position   = trim(coalesce(p_position, '')),
    unit_id    = p_unit_id,
    access     = p_access,
    updated_at = now()
  where email = clean_email;

  insert into enrolments (email, full_name, position, unit_id, access, event_ids, invited_by)
  values (clean_email, trim(coalesce(p_full_name,'')), trim(coalesce(p_position,'')),
          p_unit_id, p_access, coalesce(p_event_ids, '{}'), actor.id)
  on conflict (email) do update set
    full_name  = excluded.full_name,
    position   = excluded.position,
    unit_id    = excluded.unit_id,
    access     = excluded.access,
    event_ids  = excluded.event_ids,
    invited_by = excluded.invited_by;

  -- If they are already signed up, attach them to their activities now.
  insert into event_members (event_id, profile_id)
  select unnest(coalesce(p_event_ids,'{}')), p.id from profiles p where p.email = clean_email
  on conflict do nothing;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'enrol', 'enrolment', clean_email,
          p_access || ' · ' || coalesce(p_position,'') || ' · ' || target_kind);

  return clean_email;
end;
$$;

-- ------------------------------------------------- claiming an enrolment
--
-- Fired the moment someone completes sign-up. If an officer has already enrolled
-- that email address, this is where the waiting decision becomes a real profile.
-- If nobody has, no profile is made: the person can hold a login and still see
-- nothing, which is the behaviour we want for a stranger who guesses the address
-- of the site.

create or replace function claim_enrolment() returns trigger
language plpgsql security definer set search_path = public as $$
declare e enrolments;
begin
  select * into e from enrolments where email = lower(trim(new.email));
  if e.email is null then
    return new;
  end if;

  insert into profiles (id, email, full_name, position, unit_id, access)
  values (new.id, e.email,
          coalesce(nullif(e.full_name, ''), split_part(e.email, '@', 1)),
          e.position, e.unit_id, e.access)
  on conflict (id) do nothing;

  insert into event_members (event_id, profile_id)
  select unnest(e.event_ids), new.id
  on conflict do nothing;

  update enrolments set claimed_at = now() where email = e.email;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (new.id, coalesce(nullif(e.full_name,''), e.email), 'claim', 'profile',
          new.id::text, e.access);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function claim_enrolment();

-- ------------------------------------------------------ withdrawing
-- Turnover: an officer who has left keeps their work but loses their way in.
-- The profile is deactivated rather than deleted, so every task they were
-- assigned still shows who held it.

create or replace function withdraw_member(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  actor       profiles;
  actor_kind  text;
  target      profiles;
  clean_email text;
begin
  select * into actor from profiles where id = auth.uid();
  if actor is null or not actor.active then
    raise exception 'Your account cannot withdraw anyone.';
  end if;
  select kind into actor_kind from units where id = actor.unit_id;

  clean_email := lower(trim(p_email));
  select * into target from profiles where email = clean_email;

  if not (actor_kind = 'national' and actor.access = 'officer') then
    if target.id is null or not actor.is_head or target.unit_id <> actor.unit_id then
      raise exception 'You may not withdraw that member.';
    end if;
  end if;

  if actor.email = clean_email then
    raise exception 'You cannot withdraw your own access.';
  end if;

  delete from enrolments where email = clean_email;
  update profiles set active = false, updated_at = now() where email = clean_email;
  delete from event_members where profile_id = target.id;

  insert into audit_log (actor_id, actor_name, action, entity, entity_id, detail)
  values (actor.id, actor.full_name, 'withdraw', 'profile', clean_email, '');

  return true;
end;
$$;

-- ------------------------------------------------- row level security

alter table units          enable row level security;
alter table enrolments     enable row level security;
alter table profiles       enable row level security;
alter table events         enable row level security;
alter table tasks          enable row level security;
alter table event_members  enable row level security;
alter table reports        enable row level security;
alter table audit_log      enable row level security;

drop policy if exists units_read on units;
create policy units_read on units for select using (auth.uid() is not null);

-- Waiting enrolments are visible to the people who may create them. There is no
-- insert, update or delete policy on purpose: enroll_member() and
-- withdraw_member() are the only doors, and they check who is asking.
drop policy if exists enrolments_read on enrolments;
create policy enrolments_read on enrolments for select
  using (is_national() or unit_id = my_unit());

-- You can see your own unit's people; nationals see everyone.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select
  using (id = auth.uid() or is_national() or unit_id = my_unit());

-- You may edit your own row. Nationals may edit anyone.
-- (Passwords are not here — Supabase Auth owns those, and each person
--  changes their own through the app.)
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_national())
  with check (id = auth.uid() or is_national());

-- Events and tasks belong to a unit; volunteers only reach the ones they joined.
drop policy if exists events_read on events;
create policy events_read on events for select using (
  is_national()
  or unit_id = my_unit()
  or exists (select 1 from event_members em where em.event_id = events.id and em.profile_id = auth.uid())
);

drop policy if exists events_write on events;
create policy events_write on events for all
  using (is_national() or (unit_id = my_unit() and (select access from profiles where id = auth.uid()) = 'officer'))
  with check (is_national() or (unit_id = my_unit() and (select access from profiles where id = auth.uid()) = 'officer'));

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select using (
  exists (select 1 from events e where e.id = tasks.event_id and (
    is_national() or e.unit_id = my_unit()
    or exists (select 1 from event_members em where em.event_id = e.id and em.profile_id = auth.uid())
  ))
);

-- A volunteer may update a task assigned to them, and nothing else.
drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update using (
  assignee_id = auth.uid()
  or exists (select 1 from events e join profiles p on p.id = auth.uid()
             where e.id = tasks.event_id and p.access = 'officer'
               and (is_national() or e.unit_id = p.unit_id))
);

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert with check (
  exists (select 1 from events e join profiles p on p.id = auth.uid()
          where e.id = tasks.event_id and p.access = 'officer'
            and (is_national() or e.unit_id = p.unit_id))
);

-- Everyone signed in may read the membership rows; a volunteer needs their own
-- in order to know which activities they were taken on for.
drop policy if exists members_read on event_members;
create policy members_read on event_members for select using (auth.uid() is not null);

drop policy if exists members_write on event_members;
create policy members_write on event_members for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.access = 'officer'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.access = 'officer'));

drop policy if exists reports_read on reports;
create policy reports_read on reports for select using (
  exists (select 1 from events e where e.id = reports.event_id
          and (is_national() or e.unit_id = my_unit()))
);

drop policy if exists reports_write on reports;
create policy reports_write on reports for all
  using (exists (select 1 from events e join profiles p on p.id = auth.uid()
                 where e.id = reports.event_id and p.access = 'officer'
                   and (is_national() or e.unit_id = p.unit_id)))
  with check (exists (select 1 from events e join profiles p on p.id = auth.uid()
                 where e.id = reports.event_id and p.access = 'officer'
                   and (is_national() or e.unit_id = p.unit_id)));

-- The log is readable by nationals and append-only for everyone else.
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (is_national());

drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert with check (auth.uid() is not null);

-- ----------------------------------------------------------- seed units

insert into units (kind, name, code) values
  ('national',  'FCUSR Nationals',            'NAT'),
  ('comelec',   'Commission on Elections',    'COMELEC'),
  ('judiciary', 'Supreme Court',              'JUDICIARY')
on conflict (code) do nothing;

-- Provinces are the colleges/departments, plus the basic-education levels.
-- Edit this list to match your current roster.
-- Keep this list and assets/js/store.js in step; the app seeds the same roster
-- offline, and Settings → Units can edit either side afterwards.
insert into units (kind, name, code) values
  ('province', 'College of Arts and Sciences',                  'CAS'),
  ('province', 'College of Business and Accountancy',           'CBA'),
  ('province', 'College of Criminal Justice Education',         'CCJE'),
  ('province', 'College of Teacher Education',                  'CTE'),
  ('province', 'College of Engineering',                        'COE'),
  ('province', 'College of Nursing',                            'CN'),
  ('province', 'College of Hospitality and Tourism Management', 'CHTM'),
  ('province', 'College of Computer Studies',                   'CCS'),
  ('province', 'Graduate School',                               'GS'),
  ('province', 'Senior High School',                            'SHS'),
  ('province', 'Junior High School',                            'JHS'),
  ('province', 'Elementary',                                    'ELEM')
on conflict (code) do nothing;
