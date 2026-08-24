-- Miami-Dade Commission Watch: require a dadeschools.net student address,
-- and move editorial submissions behind the rate-limited API endpoint.
-- Run this once in the Supabase SQL editor, after migration_14.
--
-- On 2026-08-24 an automated scanner put six junk rows into
-- editorial_submissions in about three hours: XSS probes ("<script>alert(
-- mdcwxsscan123)</script>") in every field, then plain control rows, using
-- throwaway domains (@x.edu, @student.example.edu, @mdpsk12.k12.fl.us --
-- note that last one is NOT the real district domain). None of it could
-- execute (js/admin.js and js/editorials-feed.js escape every field) and
-- none of it could publish (migration_6 pins new rows to 'pending'), but it
-- surfaced two real gaps:
--
--   1. The only check on the submitter's email lived in
--      js/submit-editorial.js -- browser-side JavaScript. The anon key ships
--      in js/supabase-client.js by design, so anyone could POST straight to
--      /rest/v1/editorial_submissions and never load the form at all.
--   2. Nothing rate-limited the insert. check_rate_limit() has existed since
--      migration_7 but was only wired into geocode, link-click, and the two
--      newsletter endpoints. An attacker could have inserted rows without
--      limit and buried real student submissions in the review queue.
--
-- Fix, in two parts:
--
-- Part 1 constrains school_email to a Miami-Dade County Public Schools
-- student address at the database level, where it holds no matter which path
-- the row arrives on. This is a format check, not identity verification --
-- nothing stops someone typing fake@students.dadeschools.net -- but it ends
-- junk from arbitrary domains, which is what the scanner used.
--
-- Note this narrows who may submit through the form to MDCPS public and
-- charter students. submit-editorial.html, privacy.html, and faq.html have
-- been updated in the same change to route private- and home-school students
-- to contact@miamidadecommissionwatch.com instead, so the site no longer
-- invites people the form will reject.
--
-- Added NOT VALID on purpose: the six scanner rows violate this constraint
-- and are deliberately left in place as a record of what was attempted. The
-- constraint is enforced on every new and updated row regardless. Once
-- you're done with them:
--
--   delete from public.editorial_submissions
--    where status = 'rejected'
--      and school_email !~* '^[^@[:space:]]+@students\.dadeschools\.net$';
--   alter table public.editorial_submissions
--     validate constraint editorial_submissions_school_email_domain;

alter table public.editorial_submissions
  add constraint editorial_submissions_school_email_domain
  check (school_email ~* '^[^@[:space:]]+@students\.dadeschools\.net$')
  not valid;

-- Part 2 closes the direct insert path. Submissions now go through
-- api/submit-editorial.js, which throttles per IP with check_rate_limit()
-- and writes with the service role (service_role bypasses RLS, so it is
-- unaffected by the revoke below). Same shape as newsletter-subscribe:
-- the public key can no longer write to the table at all, so the throttle
-- cannot be sidestepped by talking to PostgREST directly.
--
-- The insert policy from migration_6 is dropped rather than left in place:
-- with no INSERT grant behind it, a policy named "Anyone can submit an
-- editorial" only reads as permission that isn't there.

revoke insert on public.editorial_submissions from anon, authenticated;
drop policy if exists "Anyone can submit an editorial" on public.editorial_submissions;
