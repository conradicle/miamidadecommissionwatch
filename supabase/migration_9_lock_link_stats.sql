-- Miami-Dade Commission Watch: close public access to link_stats()
-- Run this once in the Supabase SQL editor, after migration_8.
--
-- migration_8 shipped with:
--   revoke execute on function public.link_stats(timestamptz) from anon, authenticated;
-- which silently did nothing. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and anon reaches the function through that grant rather
-- than through one of its own, so revoking from the named roles left the real
-- grant in place. Anyone holding the anon key (it ships in js/supabase-client.js
-- and is meant to be public) could call the function and read the traffic
-- totals. No personal data was reachable -- link_events stores no IP, cookie,
-- or identifier of any kind -- but the counts were never meant to be public.
--
-- service_role reaches the function through PUBLIC as well, so revoking from
-- PUBLIC alone would also cut off /api/link-stats. The explicit grant below is
-- what keeps the admin dashboard working.
--
-- migration_8 has been corrected too, so a database built from scratch never
-- passes through the open state; this file is only needed for the database
-- that already ran the original.

revoke execute on function public.link_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.link_stats(timestamptz) to service_role;

-- Verify: this should return 0 rows for anon and the counts for service_role.
--   select has_function_privilege('anon', 'public.link_stats(timestamptz)', 'execute');
