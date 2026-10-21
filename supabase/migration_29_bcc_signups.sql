-- Miami-Dade Commission Watch: BCC meeting sign-ups (/attend)
-- Run this once in the Supabase SQL editor, after migration_28.
--
-- Replaces the Google Form made before each meeting. Staff open a meeting in
-- the "BCC Sign-ups" tab of the dashboard, students sign up at /attend, and
-- staff read the roster in the same tab.
--
-- Who can do what:
--   * The public reads the next open meeting through next_bcc_meeting()
--     below, which returns its date, title, location and start time and
--     nothing else. bcc_meetings itself is closed to anon.
--   * The public signs up through api/city-platform.js (op
--     submit_bcc_signup), which checks Cloudflare Turnstile and then writes
--     with the service role. There is deliberately no anon INSERT policy: the
--     publishable key ships in js/supabase-client.js, so an insert policy
--     would let anyone post straight to the table and skip Turnstile. Same
--     reasoning as editorial_submissions in migration_15.
--   * The "open and not yet closed" rule is a trigger, not a policy, so it
--     holds for the service role too. A sign-up can never reach the table for
--     a meeting that is closed, whoever sends it.
--   * Nobody but active staff can read, change or delete a sign-up.
--
-- Privacy: these rows hold minors' names, phone numbers and student IDs.
-- The student ID is there only to confirm the person is a Miami-Dade County
-- Public Schools student. purge_expired_bcc_signups() deletes every sign-up
-- 30 days after its meeting; section 4 schedules it with pg_cron when the
-- extension is enabled, and api/_bcc-signup.js also runs it on every sign-up.


-- =========================================================================
-- 1. Tables
-- =========================================================================

create table if not exists public.bcc_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  title text not null default 'Board of County Commissioners Meeting'
    check (char_length(title) between 3 and 200),
  location text not null default 'Commission Chambers, Stephen P. Clark Government Center, 111 NW 1st Street, Miami'
    check (char_length(location) <= 300),
  start_time time not null default '09:30',
  -- Left null on insert, the trigger below fills it with the Saturday before
  -- meeting_date at 11:59 PM Miami time.
  signup_closes_at timestamptz not null,
  is_open boolean not null default false,
  -- Staff-only. Never returned to the public.
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists bcc_meetings_open_date_idx
  on public.bcc_meetings (meeting_date) where is_open;

create table if not exists public.bcc_signups (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.bcc_meetings(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  -- Ten digits, US. The API strips formatting and a leading 1 before saving.
  phone text not null check (phone ~ '^[0-9]{10}$'),
  -- Digits only here. The exact length lives in one place,
  -- STUDENT_ID_LENGTH in api/_bcc-signup.js, so this only rules out junk.
  mdcps_student_id text not null check (mdcps_student_id ~ '^[0-9]{5,12}$'),
  -- true = yes, false = no, null = maybe.
  wants_public_comment boolean,
  created_at timestamptz not null default now(),
  -- One sign-up per student per meeting. A resubmission updates the row
  -- (api/_bcc-signup.js upserts on this), so a student who mistyped their
  -- phone can just send the form again.
  unique (meeting_id, mdcps_student_id)
);

create index if not exists bcc_signups_meeting_idx on public.bcc_signups (meeting_id, created_at);


-- =========================================================================
-- 2. Triggers
-- =========================================================================

-- The Saturday strictly before p_date, at 23:59:59 America/New_York.
-- isodow runs Mon=1 .. Sun=7, so (isodow % 7) + 1 is how many days back that
-- Saturday is: 3 for a Tuesday, 7 for a Saturday meeting (the week before).
create or replace function public.bcc_default_signup_close(p_date date)
returns timestamptz
language sql
immutable
as $fn$
  select ((p_date - ((extract(isodow from p_date)::int % 7) + 1)) + time '23:59:59')
         at time zone 'America/New_York';
$fn$;

create or replace function public.bcc_meetings_fill_close()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.signup_closes_at is null then
      new.signup_closes_at := public.bcc_default_signup_close(new.meeting_date);
    end if;
  elsif new.meeting_date is distinct from old.meeting_date
        and new.signup_closes_at is not distinct from old.signup_closes_at then
    -- The date moved and nobody chose a new close time: follow the date.
    new.signup_closes_at := public.bcc_default_signup_close(new.meeting_date);
  elsif new.signup_closes_at is null then
    new.signup_closes_at := public.bcc_default_signup_close(new.meeting_date);
  end if;
  return new;
end;
$fn$;

drop trigger if exists bcc_meetings_fill_close on public.bcc_meetings;
create trigger bcc_meetings_fill_close
  before insert or update on public.bcc_meetings
  for each row execute function public.bcc_meetings_fill_close();

-- Insert only: staff can still correct a sign-up after the window closes.
-- Upserts fire this too, since BEFORE INSERT runs ahead of the conflict check.
create or replace function public.bcc_signups_require_open_meeting()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (
    select 1 from public.bcc_meetings
    where id = new.meeting_id
      and is_open
      and now() < signup_closes_at
  ) then
    raise exception 'Sign-ups for this meeting are closed.' using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists bcc_signups_require_open_meeting on public.bcc_signups;
create trigger bcc_signups_require_open_meeting
  before insert on public.bcc_signups
  for each row execute function public.bcc_signups_require_open_meeting();


-- =========================================================================
-- 3. Access
-- =========================================================================

alter table public.bcc_meetings enable row level security;
alter table public.bcc_signups enable row level security;

drop policy if exists "Staff can manage BCC meetings" on public.bcc_meetings;
create policy "Staff can manage BCC meetings"
  on public.bcc_meetings for all
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "Staff can read BCC sign-ups" on public.bcc_signups;
create policy "Staff can read BCC sign-ups"
  on public.bcc_signups for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "Staff can update BCC sign-ups" on public.bcc_signups;
create policy "Staff can update BCC sign-ups"
  on public.bcc_signups for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "Staff can delete BCC sign-ups" on public.bcc_signups;
create policy "Staff can delete BCC sign-ups"
  on public.bcc_signups for delete
  to authenticated
  using (public.is_active_staff());

-- RLS already leaves anon with nothing, but Supabase grants anon every
-- privilege on new public tables by default. Take them away so a future
-- careless policy can't open these up by itself.
revoke all on public.bcc_meetings from anon;
revoke all on public.bcc_signups from anon;
-- Staff never insert sign-ups by hand; the API does it as service_role.
revoke insert on public.bcc_signups from authenticated;

-- The one public read. Security definer so it can see bcc_meetings past RLS,
-- and it hands back four columns of one row: the earliest meeting that is open
-- and still taking sign-ups. "Today" is Miami's today, not UTC's, so a
-- meeting doesn't vanish at 8 PM the night before.
create or replace function public.next_bcc_meeting()
returns table (meeting_date date, title text, location text, start_time time)
language sql
stable
security definer
set search_path = public
as $fn$
  select m.meeting_date, m.title, m.location, m.start_time
  from public.bcc_meetings m
  where m.is_open
    and now() < m.signup_closes_at
    and m.meeting_date >= (now() at time zone 'America/New_York')::date
  order by m.meeting_date, m.start_time
  limit 1;
$fn$;

revoke execute on function public.next_bcc_meeting() from public;
grant execute on function public.next_bcc_meeting() to anon, authenticated, service_role;

-- The service role's version, with the id the API needs to file the sign-up.
-- Not granted to anon: the id is all it adds, and anon has no use for it.
create or replace function public.next_bcc_meeting_for_signup()
returns table (id uuid, meeting_date date)
language sql
stable
security definer
set search_path = public
as $fn$
  select m.id, m.meeting_date
  from public.bcc_meetings m
  where m.is_open
    and now() < m.signup_closes_at
    and m.meeting_date >= (now() at time zone 'America/New_York')::date
  order by m.meeting_date, m.start_time
  limit 1;
$fn$;

revoke execute on function public.next_bcc_meeting_for_signup() from public, anon, authenticated;
grant execute on function public.next_bcc_meeting_for_signup() to service_role;


-- =========================================================================
-- 4. Deleting sign-ups 30 days after the meeting
-- =========================================================================

create or replace function public.purge_expired_bcc_signups()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer;
begin
  delete from public.bcc_signups s
  using public.bcc_meetings m
  where s.meeting_id = m.id
    and m.meeting_date < (now() at time zone 'America/New_York')::date - 30;
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

-- service_role for the API; pg_cron runs as postgres, which owns it.
revoke execute on function public.purge_expired_bcc_signups() from public, anon, authenticated;
grant execute on function public.purge_expired_bcc_signups() to service_role;

-- Daily at 09:15 UTC (5:15 AM in Miami). pg_cron is off by default on
-- Supabase; if this prints the notice, turn it on under Database >
-- Extensions > pg_cron and run this block again. Until then the API's
-- purge-on-sign-up is the only thing deleting old rows.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-expired-bcc-signups',
      '15 9 * * *',
      'select public.purge_expired_bcc_signups()'
    );
    raise notice 'pg_cron: scheduled purge-expired-bcc-signups daily at 09:15 UTC.';
  else
    raise notice 'pg_cron is NOT enabled. Sign-ups are purged only when someone signs up. Enable pg_cron and rerun this block.';
  end if;
end;
$do$;


-- =========================================================================
-- 5. After running (read-only checks)
-- =========================================================================
-- select has_table_privilege('anon', 'public.bcc_signups', 'select');   -- expect false
-- select has_table_privilege('anon', 'public.bcc_meetings', 'select');  -- expect false
-- select * from public.next_bcc_meeting();                              -- expect 0 rows until a meeting is opened
-- select public.bcc_default_signup_close('2026-11-03');                 -- expect 2026-11-01 03:59:59+00 (Sat Oct 31, 11:59 PM EDT)
-- select jobname, schedule from cron.job where jobname = 'purge-expired-bcc-signups';
