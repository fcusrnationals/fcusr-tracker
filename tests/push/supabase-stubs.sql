-- Just enough of Supabase for the council's SQL files to run on a plain
-- Postgres, so push.sql can be tested on a throwaway database before it ever
-- reaches the real one. Used only by tests/run-push-db.js.

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase hands every new table, function and sequence in public to the API
-- roles by default; RLS and explicit revokes are what keep them out.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb, aud text, role text, instance_id uuid,
  created_at timestamptz default now(), updated_at timestamptz, last_sign_in_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
  is_sso_user boolean default false, deleted_at timestamptz, banned_until timestamptz);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(), user_id uuid, provider_id text,
  identity_data jsonb, provider text, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select current_setting('request.jwt.claim.role', true) $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;

-- Vault, the shape Supabase exposes: create_secret() and a decrypted view.
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(), name text unique, description text,
  secret text not null, created_at timestamptz default now());
create or replace function vault.create_secret(new_secret text, new_name text default null,
                                               new_description text default '') returns uuid
language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description)
  returning id;
$$;
create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets;
revoke all on schema vault from public;

-- pg_cron and pg_net, as far as push-schedule.sql uses them.
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
create or replace function cron.unschedule(job_name text) returns boolean
language sql as $$ delete from cron.job where jobname = job_name returning true $$;

create schema if not exists net;
create table if not exists net.requests (id bigserial primary key, url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                         headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.requests (url, headers, body) values (url, headers, body) returning id;
$$;
