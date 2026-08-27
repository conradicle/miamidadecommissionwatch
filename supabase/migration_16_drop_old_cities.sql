-- Miami-Dade Commission Watch: remove the old /cities section.
-- Run this in the Supabase SQL editor AFTER migration_15, and only once you
-- have read the warning below. It is destructive and it is not reversible from
-- inside Postgres.
--
-- WHY: the municipal section is being rebuilt around per-city subdomains
-- (miamibeach.miamidadecommissionwatch.com), with a claim flow, per-city
-- owners who can publish their own city, and volunteers who can only draft.
-- The schema in migration_13 models a different arrangement -- one shared
-- 'city_editor' role that can never publish -- so it is being replaced rather
-- than extended. The new schema arrives in migration_17.
--
-- WHAT THIS DESTROYS
--   * the six seeded cities (miami-beach, miami, coral-gables, miami-gardens,
--     hialeah, homestead)
--   * Miami Beach's government blurb and its two source links
--   * every city official, meeting, meeting item, source and government row
--   * every city team membership
-- All of it is re-enterable by hand in minutes. Nothing here is referenced by
-- county coverage: public.meetings, public.meeting_items and
-- public.editorial_submissions are untouched, as are their policies.
--
-- ACCOUNTS HOLDING THE OLD ROLE
-- Checked on 2026-08-26: exactly one account held 'city_editor',
-- conrad@miamidadecommissionwatch.com, a staff test account created to preview
-- the city-editor view. The role it holds is being deleted along with the
-- feature, so the step below removes the role row.
--
-- This does NOT delete the login itself -- the row in auth.users survives, it
-- just no longer carries a role, so it cannot reach the dashboard. To remove
-- the account entirely, delete it in Supabase under Authentication > Users
-- after running this file.
--
-- If you would rather KEEP that account with full access, replace the delete
-- below with:
--
--     update public.user_roles set role = 'admin' where role = 'city_editor';

begin;

-- ---------- policies and tables ----------
-- Dropping a table drops its policies, indexes and foreign keys with it.
-- CASCADE covers city_meeting_items' reference to city_meetings and every
-- child reference to cities.
drop table if exists public.city_meeting_items cascade;
drop table if exists public.city_meetings      cascade;
drop table if exists public.city_officials     cascade;
drop table if exists public.city_sources       cascade;
drop table if exists public.city_government    cascade;
drop table if exists public.city_team_members  cascade;
drop table if exists public.cities             cascade;

-- ---------- helper functions ----------
-- is_active_staff() is deliberately NOT dropped: migration_2 and the county
-- policies use it too. The rest exist only for the city tables above.
drop function if exists public.is_city_editor_for(uuid);
drop function if exists public.city_is_published(uuid);
drop function if exists public.city_meeting_is_public(uuid);
drop function if exists public.can_edit_city_meeting(uuid);

-- ---------- accounts on the old role ----------
-- Must run before the check constraint below, or the constraint rejects these
-- rows and the whole transaction rolls back.
delete from public.user_roles where role = 'city_editor';

-- ---------- roles ----------
-- Back to the two site-wide roles. Per-city roles in the new model live in
-- their own membership table rather than in user_roles.role, so this column
-- does not need a third value again.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('owner', 'admin'));

commit;

-- ---------- After running this file ----------
-- 1. The Cities tab is gone from admin.html and js/admin-cities.js is deleted,
--    so nothing in the dashboard queries these tables any more.
-- 2. /api/admin-invite no longer accepts role 'city_editor'; it invites admins
--    only, owner-only, as it did before migration_13.
-- 3. Public city pages are gone from the site and from sitemap.xml. There are
--    no redirects: the section had almost no inbound links.
