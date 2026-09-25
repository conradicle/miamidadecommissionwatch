-- Miami-Dade Commission Watch: Miami Gardens is not covered.
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Nobody is covering Miami Gardens, but its row is not in the public claim
-- registry: on 2026-09-24 anon's read of public.cities returned 33 rows with
-- sort_order 260 (miamigardens, seeded by migration_18) missing. anon can only
-- see 'unclaimed' and 'pending' rows plus published 'active' ones, so the row
-- is either 'active' and unpublished (marked covered) or 'suspended'. Either
-- way /municipalities.html dropped it, and the "N of 34 cities covered" line
-- would count 33.
--
-- This puts it back to 'unclaimed' with is_published false, the same state as
-- the other uncovered cities (see migration_23 for why unclaimed and not
-- suspended). If the row was deleted outright, the insert brings it back with
-- migration_18's values. governance is left alone for the same reason
-- migration_23 gives.

begin;

insert into public.cities (slug, name, status, is_published, sort_order)
values ('miamigardens', 'Miami Gardens', 'unclaimed', false, 260)
on conflict (slug) do update
   set status = 'unclaimed',
       is_published = false,
       updated_at = now();

commit;

-- ---------- Optional: revoke team access ----------
-- Same reasoning as migration_23: an 'unclaimed' city should have no owner or
-- editor. Check first; only then delete.
--
--   select c.slug, m.role, m.user_id
--     from public.city_memberships m
--     join public.cities c on c.id = m.city_id
--    where c.slug = 'miamigardens';
--
--   delete from public.city_memberships
--    where city_id in (select id from public.cities where slug = 'miamigardens');

-- ---------- After running this file ----------
-- Redeploy (the Publish to site button in admin.html). /municipalities.html is
-- prerendered from Supabase, so Miami Gardens reappears under "Not yet
-- covered" and the count reads "2 of 34" only after the next build.
