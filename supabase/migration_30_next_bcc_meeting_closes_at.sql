-- Miami-Dade Commission Watch: next_bcc_meeting() also returns signup_closes_at
-- Run this once in the Supabase SQL editor, after migration_29.
--
-- The homepage's "Attend with us" section says "Sign-ups close Saturday,
-- <date>." Without this column js/next-bcc-meeting.js works the date out as
-- the Saturday before the meeting, which is the trigger's default but is
-- wrong whenever staff move the close time in the BCC Sign-ups tab. Optional:
-- the site works before and after this runs.
--
-- Adding a column to a RETURNS TABLE changes the function's type, so it has to
-- be dropped and recreated; the grants go with it and are restated below.

begin;

drop function if exists public.next_bcc_meeting();

create function public.next_bcc_meeting()
returns table (meeting_date date, title text, location text, start_time time, signup_closes_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select m.meeting_date, m.title, m.location, m.start_time, m.signup_closes_at
  from public.bcc_meetings m
  where m.is_open
    and now() < m.signup_closes_at
    and m.meeting_date >= (now() at time zone 'America/New_York')::date
  order by m.meeting_date, m.start_time
  limit 1;
$fn$;

revoke execute on function public.next_bcc_meeting() from public;
grant execute on function public.next_bcc_meeting() to anon, authenticated, service_role;

commit;

-- Check:
-- select * from public.next_bcc_meeting();
