-- Let the server's service role through the city guards.
--
-- The bug this fixes: approving a claim failed with "Only staff can change a
-- city's status." even when an owner or admin clicked Approve.
--
-- Why. is_active_staff() answers "is the *signed-in user* staff?" by looking
-- up auth.uid(). api/_decide-claim.js verifies the caller is active staff in
-- Node, then does its writes with the service role key -- which carries no
-- user, so auth.uid() is null inside the trigger and is_active_staff() is
-- false. The guard in migration_17 then rejected the one write the whole
-- endpoint exists to make.
--
-- That failure landed mid-approval and left a mess: the requester's login and
-- their owner row in city_memberships were already written (and Supabase had
-- already mailed them the invite, which is why the person being approved sees
-- something arrive), but the city stayed 'pending', the claim stayed open, and
-- no subdomain was provisioned. Re-running Approve after this migration
-- finishes the job -- the account lookup and the membership upsert are both
-- idempotent.
--
-- The same null-auth.uid() hole is why api/_submit-claim.js could not flip a
-- city to 'pending' when somebody claimed it; that PATCH is unchecked, so it
-- failed silently.
--
-- Trusting the service role here does not widen anything. It never reaches a
-- browser: it lives only in the Vercel environment, and every endpoint holding
-- it (_decide-claim, _staff-ops, _city-invite) checks the caller's user_roles
-- row before touching the database. The guard's real job is stopping a signed-
-- in *city owner* from renaming or publishing their own city, and that path is
-- untouched -- an owner's token is not the service role.

-- Reads the role claim PostgREST puts on the session. Not security definer:
-- it only reads a setting, and it must see the caller's own claims.
create or replace function public.is_service_role()
returns boolean
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$fn$;

-- Staff-only columns on cities: same rules, plus the service role.
create or replace function public.guard_city_staff_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.is_active_staff() or public.is_service_role() then
    return new;
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'Only staff can change a city''s address (slug).';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Only staff can change a city''s status.';
  end if;
  if new.is_published is distinct from old.is_published then
    raise exception 'Only staff can publish or unpublish a city.';
  end if;
  if new.governance is distinct from old.governance then
    raise exception 'Only staff can change a city''s governance type.';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

-- The publish guard has the identical blind spot. Nothing on the server
-- publishes officials or meetings today, but the next endpoint that does would
-- hit exactly the failure above, so close it in the same pass.
create or replace function public.guard_publish_rights()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'published'
     and not public.is_active_staff()
     and not public.is_service_role()
     and not public.is_city_owner(new.city_id) then
    raise exception 'Only the city owner or staff can publish. Save it as a draft instead.';
  end if;
  return new;
end;
$fn$;
