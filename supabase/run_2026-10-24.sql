-- Miami-Dade Commission Watch: one-shot run for 2026-10-24.
-- Paste the whole file into the Supabase SQL editor and run it once.
--
--   1. Revoke handuenas@gmail.com's staff role (approved by Conrad).
--   2. migration_32: signed-in accounts with no role and no city membership
--      get no rows at all.
--   3. Verify step 2 as a fake signed-in user with no role.
--   4. List the scanner-made auth accounts (read-only; nothing is deleted).
--
-- Steps 1-3 are one transaction. Every step checks its own result and raises
-- an exception if anything is off, which rolls ALL of it back. So you either
-- get the list from step 4 (everything applied and verified) or an error
-- naming the step (nothing changed).
--
-- The SQL editor only shows the last result, which is the step 4 list. The
-- svertexy@gmail.com revoke and the junk-account delete are NOT in this file.

begin;

-- ---------------------------------------------------------------------
-- 1. Revoke handuenas@gmail.com
-- ---------------------------------------------------------------------
-- 'revoked' rather than deleting the row: same as the dashboard's Revoke
-- button, and every staff policy already requires status = 'active'.
do $$
declare
  changed int;
begin
  update public.user_roles r
     set status = 'revoked'
    from auth.users u
   where u.id = r.user_id
     and lower(u.email) = 'handuenas@gmail.com';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'step 1: expected 1 user_roles row for handuenas@gmail.com, found %', changed;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. migration_32 (same body as supabase/migration_32_signed_in_without_role_gets_nothing.sql)
-- ---------------------------------------------------------------------
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
    raise exception 'step 2: RLS is off on: %. Nothing was applied.', open_tables;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Verify: a signed-in user with a random id and no role sees nothing
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  t text;
  n bigint;
  seen text := '';
begin
  foreach t in array array[
    'cities', 'city_officials', 'city_meetings', 'documents', 'document_versions',
    'meeting_schedule', 'meetings', 'meeting_items', 'claim_requests',
    'bcc_signups', 'bcc_meetings', 'editorial_submissions'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then
      n := 0; -- no grant at all is an even stronger "can't read"
    end;
    if n > 0 then seen := seen || t || '=' || n || ' '; end if;
  end loop;
  if seen <> '' then
    raise exception 'step 3: a no-role signed-in user can still read rows: %', seen;
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

commit;

-- ---------------------------------------------------------------------
-- 4. Scanner-made accounts (read-only). Paste this result back to Claude.
-- ---------------------------------------------------------------------
-- Self-signup (invited_at is null), no user_roles row of any status, no city
-- membership, and never one of the three founder addresses.
select u.id, u.email, u.created_at, u.last_sign_in_at,
       u.email_confirmed_at is not null as confirmed,
       u.raw_app_meta_data->>'provider' as provider
  from auth.users u
 where u.invited_at is null
   and not exists (select 1 from public.user_roles r where r.user_id = u.id)
   and not exists (select 1 from public.city_memberships m where m.user_id = u.id)
   and lower(coalesce(u.email, '')) not in (
         'cagelber1@gmail.com',
         'daniel.llobet.v@gmail.com',
         'conrad@miamidadecommissionwatch.com')
 order by u.created_at;
