-- Miami-Dade Commission Watch: BCC sign-ups open to college students
-- Run this once in the Supabase SQL editor, after migration_32, and BEFORE
-- deploying the api/_bcc-signup.js that sends school_type.
--
-- /attend used to require an MDCPS student ID. It now asks "Where do you go
-- to school?" and requires, by answer:
--   mdcps  MDCPS high school             mdcps_student_id
--   mdc    Miami Dade College            school_email ending in @mymdc.net
--   other  Other college or university   school_name and school_email
--
-- mdcps_student_id stays, now nullable. school_type defaults to 'mdcps' so
-- every existing row is backfilled correctly and the API already deployed
-- (which sends no school_type) keeps working until the new one ships.
--
-- Same privacy terms as migration_29: staff-only under the existing RLS
-- policies, and purge_expired_bcc_signups() deletes these rows 30 days after
-- the meeting along with the rest of the sign-up. No grant changes needed;
-- new columns inherit the table's privileges.

alter table public.bcc_signups
  add column if not exists school_type text not null default 'mdcps',
  add column if not exists school_name text,
  add column if not exists school_email text;

alter table public.bcc_signups
  alter column mdcps_student_id drop not null;

alter table public.bcc_signups
  drop constraint if exists bcc_signups_school_type_check,
  drop constraint if exists bcc_signups_school_name_check,
  drop constraint if exists bcc_signups_school_email_check,
  drop constraint if exists bcc_signups_school_fields_check,
  drop constraint if exists bcc_signups_meeting_school_email_key;

alter table public.bcc_signups
  add constraint bcc_signups_school_type_check
    check (school_type in ('mdcps', 'mdc', 'other')),
  add constraint bcc_signups_school_name_check
    check (school_name is null or char_length(school_name) between 2 and 200),
  -- The API lowercases before saving, so the unique key below can't be
  -- dodged by changing case.
  add constraint bcc_signups_school_email_check
    check (school_email is null or (
      char_length(school_email) <= 254
      and school_email = lower(school_email)
      and school_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )),
  -- What each answer requires. Mirrors the checks in api/_bcc-signup.js.
  add constraint bcc_signups_school_fields_check
    check (
      (school_type = 'mdcps' and mdcps_student_id is not null)
      or (school_type = 'mdc' and school_email like '%@mymdc.net')
      or (school_type = 'other' and school_name is not null and school_email is not null)
    ),
  -- One sign-up per college student per meeting, the way
  -- unique (meeting_id, mdcps_student_id) does it for MDCPS students. Nulls
  -- are distinct, so MDCPS rows (no email) never collide here, and college
  -- rows (no student ID) never collide on the old key. The API upserts on
  -- whichever key fits the school type.
  add constraint bcc_signups_meeting_school_email_key
    unique (meeting_id, school_email);


-- =========================================================================
-- After running (read-only checks)
-- =========================================================================
-- select column_name, is_nullable, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'bcc_signups'
--     and column_name in ('mdcps_student_id', 'school_type', 'school_name', 'school_email');
--   -- expect mdcps_student_id YES; school_type NO, 'mdcps'::text; the other two YES
-- select school_type, count(*) from public.bcc_signups group by 1;  -- expect only mdcps
