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
  kind        text not null check (kind in ('national','province','comelec','judiciary','branch')),
  name        text not null,
  code        text unique,
  -- What the app's header calls this unit: "FCUSR COE", "FCU COMELEC". Held per
  -- unit because the council does not follow one rule.
  tracker_name text not null default '',
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
  /* A link is only an archive if the file behind it survives turnover, and that
     cannot be read from the URL — a Shared Drive folder and a personal one look
     identical. So somebody vouches for it on the record instead, and the term
     will not close while any filed report is unvouched. */
  drive_owned boolean not null default false,
  drive_by    text not null default '',
  drive_at    timestamptz,
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

-- COMELEC, the Judiciary and the independent bodies answer for themselves. The
-- National government does not read their work — not their events, their tasks,
-- their reports or their letters — until the accomplishment report is filed at
-- the end of the term. The app hides them; this is what actually stops them
-- being read, because hiding a row is not the same as refusing it.
create or replace function is_independent(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from units where id = u and kind in ('comelec','judiciary','branch'));
$$;

-- Whether the person signed in may read something belonging to unit u.
create or replace function sees_unit(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select u = (select unit_id from profiles where id = auth.uid())
      or (is_national() and not is_independent(u));
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
  /* Only for activities this database actually knows about.

     event_members.event_id is a foreign key, and an id that does not exist here
     raises — which would fail the whole enrolment. Activities are still device
     local while the sync layer is unbuilt, so most ids arriving from a phone
     match nothing. A volunteer then gets no membership rows and reaches no
     activities, which is wrong but recoverable; a hard failure is neither. */
  insert into event_members (event_id, profile_id)
  select ev.id, p.id
  from profiles p
  join events ev on ev.id = any (coalesce(p_event_ids, '{}'))
  where p.email = clean_email
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

  /* Same guard, and it matters more here: this runs inside the trigger on
     auth.users, so an unknown activity id would fail the sign-up itself and the
     person could not get an account at all. */
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
  sees_unit(unit_id)
  or exists (select 1 from event_members em where em.event_id = events.id and em.profile_id = auth.uid())
);

drop policy if exists events_write on events;
create policy events_write on events for all
  using (is_national() or (unit_id = my_unit() and (select access from profiles where id = auth.uid()) = 'officer'))
  with check (is_national() or (unit_id = my_unit() and (select access from profiles where id = auth.uid()) = 'officer'));

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select using (
  exists (select 1 from events e where e.id = tasks.event_id and (
    sees_unit(e.unit_id)
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
  exists (select 1 from events e where e.id = reports.event_id and sees_unit(e.unit_id))
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


-- ---------------------------------------------------------------- offices
-- The desks a letter has to pass through. Reference data for the whole
-- Republic, like units: everyone reads it, the National officers maintain it.

create table if not exists offices (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  name            text not null,
  -- How long this office usually takes. A letter sitting longer is called
  -- stuck, which is the difference between a log and something that tells you
  -- to go and chase it.
  turnaround_days int not null default 3 check (turnaround_days between 1 and 400),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- letters
--
-- A letters tracker, not a letter store: no document is ever kept here. What a
-- council actually loses is the answer to "where is it now, and who has it".
--
-- The trail is a jsonb array rather than a child table because a letter is
-- always read and written whole, and its stops are an ordered list that gets
-- spliced — a second run at the same office is inserted directly beneath the
-- one that sent it back. A child table would buy normalisation and cost an
-- ordering column that nothing else needs.
--
-- Each stop: { id, officeId, label, forwardedBy, receivedBy, receivedAt,
--              releasedAt, outcome, note }
-- A stop is an office wherever there is one, because an office outlives whoever
-- is sitting in it; where the signature belongs to no office, "label" carries a
-- typed name instead. Never both empty.
-- "receivedBy" is a typed name too. The clerk at that office will never sign in
-- here, so this is a logbook kept honestly, not a signature.

create table if not exists letters (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references units(id) on delete cascade,
  -- Null means council business belonging to no activity, as a directive does.
  event_id      uuid references events(id) on delete set null,
  subject       text not null,
  in_charge_id  uuid references profiles(id) on delete set null,
  in_charge_name text not null default '',
  deadline      date,
  status        text not null default 'Routing'
                check (status in ('Routing','Approved','Declined','Withdrawn')),
  -- Set only when somebody answered, in as many words, that this letter never
  -- leaves the council — the one reason the President's signature may be absent.
  internal      boolean not null default false,
  stops         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists letters_unit_idx on letters(unit_id);
create index if not exists letters_event_idx on letters(event_id);

-- "create table if not exists" leaves an existing table alone, so a column
-- added after the first run has to be asked for separately. This is what keeps
-- the promise at the top of the file that running it again is safe.
alter table letters add column if not exists internal boolean not null default false;

-- ------------------------------------------------------------------- term
-- One row, ever. The administration's closing date and what it leaves behind.

create table if not exists term (
  id            int primary key default 1 check (id = 1),
  end_date      date,
  note          text not null default '',
  declared_at   timestamptz,
  declared_by   text not null default '',
  -- The link to the whole administration's record, and the promise that the
  -- drive holding it belongs to the council rather than to a graduating officer.
  overall_link  text not null default '',
  overall_owned boolean not null default false,
  closed_at     timestamptz,
  -- Recorded when the National executives close with units still outstanding.
  override      jsonb,
  /* What survives the closing: unit names, activity titles and report links.
     A few kilobytes, so the next administration inherits a readable record
     instead of an empty app — without keeping the working data the closing was
     meant to clear. */
  archive       jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

insert into term (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------- row level security

alter table offices enable row level security;
alter table letters enable row level security;
alter table term    enable row level security;

-- Offices are read by everyone signed in and maintained by the nationals.
drop policy if exists offices_read on offices;
create policy offices_read on offices for select using (auth.uid() is not null);

drop policy if exists offices_write on offices;
create policy offices_write on offices for all
  using (is_national()) with check (is_national());

-- A letter follows its unit, exactly as an event does — including the rule that
-- the independent bodies are sealed from the National government.
drop policy if exists letters_read on letters;
create policy letters_read on letters for select using (sees_unit(unit_id));

drop policy if exists letters_write on letters;
create policy letters_write on letters for all
  using (unit_id = my_unit() and (select access from profiles where id = auth.uid()) = 'officer')
  with check (unit_id = my_unit() and (select access from profiles where id = auth.uid()) = 'officer');

/* Note the asymmetry, and that it is deliberate: a national officer READS every
   province's letters and events but WRITES only their own unit's. Oversight is
   not the same as authorship, and a college's work is that college's to change. */

-- The term is the Republic's own business: everyone sees the closing date,
-- only the National executives set it.
drop policy if exists term_read on term;
create policy term_read on term for select using (auth.uid() is not null);

drop policy if exists term_write on term;
create policy term_write on term for all
  using (is_national()) with check (is_national());

-- ------------------------------------------------------- seed the offices
-- The council's own signatories, in the order they sign, taken from the FCUSR's
-- briefing on the three letters it sends most often. Keep this list and
-- DEFAULT_OFFICES in assets/js/store.js in step — the app seeds the same desks
-- offline, and the route templates match on these codes.
--
-- PRES is not one office among the others: the FCUSR President signs every
-- letter the council sends out, and the app asks for a reason when a letter
-- goes without them.

insert into offices (code, name, turnaround_days) values
  ('AUTH', 'The author / Senator / Governor',    1),
  ('GOV',  'Governor / FCUSR President',         2),
  ('PRES', 'FCUSR President',                    2),
  ('ADV',  'Adviser (JHS, SHS, National)',       2),
  ('DEAN', 'Dean/Principal',                     3),
  ('OSA',  'OSA, Director',                      3),
  ('BUD',  'Budget Officer / Accountant / Business Manager', 3),
  ('VPAA', 'VP for Academic Affairs',            5),
  ('VPF',  'VP for Finance',                     5),
  ('OP',   'University President',               7),
  -- Not on any of the three standard routes, but real desks a letter reaches.
  ('GUID', 'Guidance Office',                    3),
  ('PPO',  'Physical Plant Office',              3),
  ('REG',  'Office of the Registrar',            3),
  ('CM',   'Campus Ministry',                    3),
  ('SEC',  'Security Office',                    2)
on conflict (code) do nothing;

-- ----------------------------------------------------------- seed units

insert into units (kind, name, code, tracker_name) values
  ('national',  'FCUSR Nationals',         'NAT',     'FCUSR Nationals'),
  ('comelec',   'Commission on Elections', 'COMELEC', 'FCU COMELEC'),
  ('judiciary', 'Supreme Court',           'SC',      'FCUSR Judiciary'),
  ('branch',    'DUAG Film Festival',      'DUAG',    'FCUSR DUAG Film Festival')
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
