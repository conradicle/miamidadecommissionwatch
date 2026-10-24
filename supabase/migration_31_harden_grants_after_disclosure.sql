-- Miami-Dade Commission Watch: tighten grants after the schema disclosure
-- DRAFT: not applied anywhere. Review, then run once in the Supabase SQL
-- editor. Does not depend on migration_30 (which is also not applied).
--
-- Context: until the dist/ build (PR #14) the site served supabase/*.sql, so
-- assume an attacker has read every migration. An audit of the live catalog
-- on 2026-10-23 found every table with RLS on and no policy that lets anon
-- write anything, read drafts, or read private columns. Nothing below closes
-- an open hole. Each section removes a privilege nobody uses, so a future
-- policy mistake has less to expose.
--
-- Sections are independent; drop any you disagree with.

begin;

-- ---------------------------------------------------------------------
-- A. anon never writes. Take away the table privileges it never uses.
-- ---------------------------------------------------------------------
-- Supabase grants anon and authenticated every table privilege by default
-- and leaves RLS to say no. That holds for INSERT/UPDATE/DELETE, because no
-- policy passes for anon. TRUNCATE is different: RLS does not apply to it at
-- all. PostgREST cannot issue a TRUNCATE, so this is not reachable today, but
-- a future SECURITY DEFINER function with dynamic SQL would make it so.
--
-- Every write the site makes either comes from a signed-in staff or city
-- member (admin.js, admin-*.js, city-admin.js) or goes through api/ with the
-- service role (sign-ups, editorials, newsletter, link clicks, claims). None
-- run as anon. SELECT is left alone: the public pages read with it.

do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t.relname);
    -- authenticated keeps INSERT/UPDATE/DELETE: staff and city members write
    -- through RLS. Nobody signed in needs TRUNCATE, REFERENCES or TRIGGER.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t.relname);
  end loop;
end $$;

-- The same for tables created later. Without this every new table starts
-- with anon holding full write privileges again.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- ---------------------------------------------------------------------
-- B. Drop news_posts, which migration_5 meant to drop.
-- ---------------------------------------------------------------------
-- It still exists on live: empty, readable by anyone ("using (true)"), and
-- writable by staff. Nothing in js/, api/ or scripts/ uses it. Refuse to drop
-- it if someone has put rows in it since the audit.

do $$
begin
  if to_regclass('public.news_posts') is not null
     and exists (select 1 from public.news_posts) then
    raise exception 'news_posts has rows; back them up and decide before dropping.';
  end if;
end $$;

drop table if exists public.news_posts;

-- ---------------------------------------------------------------------
-- C. A new meeting starts as a draft.
-- ---------------------------------------------------------------------
-- migration_22 added meetings.published with default true so existing rows
-- stayed live. The dashboard always sends published explicitly, but a row
-- inserted by hand in the SQL editor (how seed_*.sql files are run) goes
-- public on the next build. Existing rows are not touched.

alter table public.meetings alter column published set default false;

-- ---------------------------------------------------------------------
-- D. Stop anon listing the official-photos bucket.
-- ---------------------------------------------------------------------
-- "Anyone can read official photos" is a SELECT policy on storage.objects,
-- which is what the Storage list API checks. A public bucket serves
-- /storage/v1/object/public/... without any policy, so the site's <img> tags
-- do not need it. Uploads go through api/_official-photo.js with the service
-- role. Staff keep SELECT so a dashboard upsert still works.
--
-- The public documents bucket needs nothing here: it has no storage
-- policies at all, so only the service role can write to it, and it accepts
-- application/pdf only.

drop policy if exists "Anyone can read official photos" on storage.objects;
create policy "Staff can read official photos"
  on storage.objects for select
  using (bucket_id = 'official-photos' and public.is_active_staff());

-- ---------------------------------------------------------------------
-- E. Pin search_path on the functions that lack one.
-- ---------------------------------------------------------------------
-- These are SECURITY INVOKER, so a hostile search_path only affects the
-- caller, but is_service_role() is called from inside SECURITY DEFINER
-- guards. Supabase's linter flags all of them (function_search_path_mutable).

alter function public.is_service_role() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.touch_meeting_schedule() set search_path = public;
alter function public.bcc_meetings_fill_close() set search_path = public;
alter function public.bcc_default_signup_close(date) set search_path = public;
alter function public.mdcw_lifecycle_stages() set search_path = public;
alter function public.mdcw_topics() set search_path = public;

commit;

-- Check (expect no rows from the first query, and 'false' from the rest):
--
-- select table_name, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT';
--
-- select to_regclass('public.news_posts') is not null as news_posts_exists;
--
-- select column_default from information_schema.columns
--  where table_schema = 'public' and table_name = 'meetings' and column_name = 'published';
--
-- Then load /, /meetings.html, /news.html, /documents, a city subdomain and
-- /attend, and save one draft city official from the city dashboard.
