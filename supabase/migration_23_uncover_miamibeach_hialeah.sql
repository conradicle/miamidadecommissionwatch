-- Miami-Dade Commission Watch: take Miami Beach and Hialeah offline.
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Both cities were seeded 'active' by migration_17 because their subdomains
-- already resolved, not because a team had claimed them. Nobody is covering
-- either one, so the registry saying "covered" and the subdomains serving a
-- city shell are both claims the project cannot back up.
--
-- They go back to 'unclaimed' rather than 'suspended'. The two look the same
-- from the outside -- js/city-site.js renders anything that is not 'active'
-- as "No coverage here yet" -- but they differ on the registry:
--
--   unclaimed  anon can read the row (policy "Public can read the claim
--              registry"), so the city stays on /municipalities.html as a
--              claim button somebody can pick up.
--   suspended  anon can read neither policy's rows, so the city vanishes from
--              the registry entirely and no one can claim it. That is the
--              staff backstop for a team that stopped meeting the standard --
--              a different thing from a city nobody has started on.
--
-- Nothing is deleted. Any city_officials and city_meetings rows stay exactly
-- where they are, hidden by public.city_is_public(), and come back the moment
-- staff set the city 'active' again.
--
-- governance is left as-is. It is only constrained on 'active' rows, and
-- Miami Beach's 'at-large' is verified; keeping it saves rechecking a charter
-- if the city is ever claimed.

begin;

update public.cities
   set status = 'unclaimed',
       is_published = false,
       updated_at = now()
 where slug in ('miamibeach', 'hialeah');

commit;

-- ---------- Optional: revoke team access ----------
-- 'unclaimed' means nobody is assigned, so a leftover owner or editor row
-- contradicts it: that person keeps UPDATE on the cities row and can still
-- edit content the public cannot see. These cities were seeded rather than
-- claimed, so there is probably nothing here -- check first, and only then
-- run the delete. It is not part of the transaction above because losing a
-- membership is not something to do by accident.
--
--   select c.slug, m.role, m.user_id
--     from public.city_memberships m
--     join public.cities c on c.id = m.city_id
--    where c.slug in ('miamibeach', 'hialeah');
--
--   delete from public.city_memberships
--    where city_id in (select id from public.cities
--                       where slug in ('miamibeach', 'hialeah'));

-- ---------- After running this file ----------
-- 1. Redeploy. /municipalities.html is prerendered by scripts/build.mjs from
--    Supabase, so the "covered" tags and the subdomain links in its JSON-LD
--    only change on the next build.
-- 2. miamibeach. and hialeah.miamidadecommissionwatch.com keep resolving and
--    show "No coverage here yet". The city template ships noindex and only
--    removes it for a city that actually loaded, so neither can be indexed in
--    this state. Leave the Cloudflare CNAME and the Vercel domain in place:
--    deleting them buys nothing and has to be redone if a team claims the city.
-- 3. To bring one back, set status 'active' and is_published true in the
--    Cities tab of admin.html.
