-- Miami-Dade Commission Watch: close public access to check_rate_limit()
-- Run this once in the Supabase SQL editor, after migration_9.
--
-- Same root cause as migration_9, on a function that predates it. Postgres
-- grants EXECUTE on a new function to PUBLIC by default, and migration_7
-- never revoked it, so check_rate_limit has been callable by anyone holding
-- the anon key -- which ships in js/supabase-client.js and is public by
-- design. Confirmed 2026-08-22 with:
--   select has_function_privilege('anon','public.check_rate_limit(text,int,int)','execute');
--
-- The function is security definer and writes, so an open grant let a caller:
--   * burn someone else's rate limit budget, since keys are predictable
--     ("newsletter-subscribe:" + IP), locking that person out of the signup
--     form with a "too many attempts" error they can't clear; and
--   * insert unbounded rows into rate_limits, one per novel key, against a
--     free-tier storage budget.
--
-- Nothing reads rate_limits except this function, and only the API layer
-- calls it, so service_role is the only role that needs EXECUTE. Revoking
-- from PUBLIC takes it from service_role too, hence the grant back.

revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
