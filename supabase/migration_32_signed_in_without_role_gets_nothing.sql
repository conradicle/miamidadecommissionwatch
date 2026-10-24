-- Miami-Dade Commission Watch: a signed-in account with no role gets nothing
-- DRAFT: not applied anywhere. Review, then run once in the Supabase SQL
-- editor.
--
-- Context: public sign-up was on until 2026-10-23, and an automated scanner
-- used it to create about 50 accounts (Aug 24-25, Oct 22-24). Seven of them
-- confirmed and signed in. None has a user_roles row or a city membership,
-- so every staff and city policy already refuses them. What they DO get is
-- the authenticated role's table grants, and those are wider than anon's:
--
--   migrations 13, 17, 27 and 28 hide private columns from anon with column
--   GRANTs (who uploaded a document, where the private PDF copy sits, a
--   photo's source URL, schedule authorship, ...). Those revokes name anon
--   only. authenticated still holds SELECT on every column, and the "Public
--   can read ..." policies have no TO clause, so they pass for authenticated
--   too. Result: any signed-in stranger reads the private columns of every
--   published row in cities, city_officials, city_meetings, documents,
--   document_versions and meeting_schedule.
--
-- Fix: one RESTRICTIVE policy per table, for authenticated only. Restrictive
-- policies are ANDed with the existing permissive ones, so staff and city
-- members see exactly what they see today, and an account with neither sees
-- no rows at all (less than anon, which is fine: such an account has no
-- business existing). Existing policies, triggers (including the one guarding
-- claim_requests) and the service role are untouched; service_role bypasses
-- RLS entirely.
--
-- user_roles and city_memberships are skipped: their only non-staff policies
-- are "read your own row", which route-after-login.js needs to tell a
-- no-role account "you're signed in but not on a team" instead of erroring.

begin;

-- Active staff, or a member of any city team. Security definer so it can read
-- user_roles and city_memberships without going through their RLS (which
-- would recurse into this function from those tables' own policies).
create or replace function public.has_site_role()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
           select 1 from public.user_roles
            where user_id = auth.uid() and status = 'active'
         )
      or exists (
           select 1 from public.city_memberships
            where user_id = auth.uid()
         );
$fn$;

revoke execute on function public.has_site_role() from public, anon;
grant execute on function public.has_site_role() to authenticated, service_role;

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
       and c.relname not in ('user_roles', 'city_memberships')
  loop
    execute format('drop policy if exists "Signed-in accounts need a role" on public.%I', t.relname);
    execute format(
      'create policy "Signed-in accounts need a role" on public.%I '
      'as restrictive for all to authenticated '
      'using (public.has_site_role()) with check (public.has_site_role())',
      t.relname);
  end loop;
end $$;

-- Any table with RLS OFF would be skipped above and stay wide open to
-- authenticated. migration_31's audit found none; fail loudly if one appeared.
do $$
declare
  open_tables text;
begin
  select string_agg(c.relname, ', ')
    into open_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if open_tables is not null then
    raise exception 'RLS is off on: %. Turn it on (or revoke authenticated) before applying this.', open_tables;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Verify (run after commit). Impersonates a signed-in user with a random id
-- and no role, counts what it can see, then rolls back. Every count should be
-- 0, except user_roles and city_memberships, which are 0 because the random
-- id has no rows of its own.
-- ---------------------------------------------------------------------
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
-- set local role authenticated;
-- select 'cities' t, count(*) from public.cities
-- union all select 'city_officials', count(*) from public.city_officials
-- union all select 'city_meetings', count(*) from public.city_meetings
-- union all select 'documents', count(*) from public.documents
-- union all select 'document_versions', count(*) from public.document_versions
-- union all select 'meeting_schedule', count(*) from public.meeting_schedule
-- union all select 'meetings', count(*) from public.meetings
-- union all select 'claim_requests', count(*) from public.claim_requests
-- union all select 'bcc_signups', count(*) from public.bcc_signups;
-- rollback;
--
-- Then sign in to admin.html as yourself and confirm meetings, claims,
-- documents and BCC sign-ups all still load.
--
-- Rollback, if anything staff-facing breaks:
-- do $$ declare t record; begin
--   for t in select tablename from pg_policies
--             where schemaname = 'public' and policyname = 'Signed-in accounts need a role'
--   loop execute format('drop policy "Signed-in accounts need a role" on public.%I', t.tablename); end loop;
-- end $$;
