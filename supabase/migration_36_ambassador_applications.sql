-- Miami-Dade Commission Watch: School Ambassador applications (/ambassadors)
-- Base: 66c31b2. Run this once in the Supabase SQL editor, after migration_35.
-- Depends on public.is_active_staff() (migration_13) and
-- public.check_rate_limit() (migration_7 / migration_10), both already live.
--
-- Who can do what:
--   * The public applies through api/city-platform.js (op
--     submit_ambassador_application), which runs the shared bot checks
--     (honeypot, time on page, Turnstile) and then inserts with the service
--     role. There is deliberately no anon INSERT policy and no anon grant:
--     the publishable key ships in js/supabase-client.js, so an insert policy
--     would let anyone skip Turnstile. Same reasoning as bcc_signups
--     (migration_29) and editorial_submissions (migration_15).
--   * Active staff read every application and change its status. They can
--     change nothing else: the answers stay exactly as the student sent them.
--   * Signed-in users who are not staff (city owners and editors) get nothing.
--
-- Every rule api/_ambassador-application.js checks is repeated below as a
-- constraint, so a row can never land in a state the endpoint would refuse.
-- If a limit changes, change it in both places (and in js/ambassadors.js,
-- which only checks so the student gets a message before a round trip).
--
-- Privacy: these rows hold minors' names, emails and phone numbers. None of
-- it is ever shown publicly.

begin;

create table if not exists public.ambassador_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Ten digits, US. The API strips formatting and a leading 1 before saving.
  phone text not null check (phone ~ '^[0-9]{10}$'),
  school_name text not null check (char_length(school_name) between 2 and 200),
  grade text not null check (grade in ('9', '10', '11', '12', 'college')),
  graduation_year integer not null check (graduation_year between 2026 and 2036),
  attended_bcc_with_mdcw boolean not null,
  involvement text check (involvement is null or char_length(involvement) <= 2000),
  motivation text not null check (char_length(motivation) between 50 and 1000),
  leadership_experience text check (leadership_experience is null or char_length(leadership_experience) <= 2000),
  expected_turnout integer not null check (expected_turnout between 0 and 5000),
  knows_absence_contact text not null check (knows_absence_contact in ('yes', 'no', 'not_sure')),
  guardian_name text check (guardian_name is null or char_length(guardian_name) between 2 and 120),
  guardian_phone text check (guardian_phone is null or guardian_phone ~ '^[0-9]{10}$'),
  -- The "I understand what ambassadors do" checkbox. Cannot be saved unticked.
  acknowledged_duties boolean not null check (acknowledged_duties),
  status text not null default 'new' check (status in ('new', 'reviewing', 'appointed', 'declined')),
  submitted_at timestamptz not null default now(),
  status_updated_at timestamptz
);

create index if not exists ambassador_applications_submitted_idx
  on public.ambassador_applications (submitted_at desc);

-- A new application always starts as 'new' with the server's own timestamp,
-- whoever inserts it, so no request can file itself as already appointed.
create or replace function public.ambassador_applications_pin_new()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    new.status := 'new';
    new.submitted_at := now();
    new.status_updated_at := null;
  elsif new.status is distinct from old.status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$fn$;

revoke all on function public.ambassador_applications_pin_new() from public;

drop trigger if exists ambassador_applications_pin_new on public.ambassador_applications;
create trigger ambassador_applications_pin_new
  before insert or update on public.ambassador_applications
  for each row execute function public.ambassador_applications_pin_new();

alter table public.ambassador_applications enable row level security;

revoke all on public.ambassador_applications from public, anon, authenticated;
grant select on public.ambassador_applications to authenticated;
grant update (status) on public.ambassador_applications to authenticated;
grant all on public.ambassador_applications to service_role;

drop policy if exists "Staff can read ambassador applications" on public.ambassador_applications;
create policy "Staff can read ambassador applications" on public.ambassador_applications
  for select to authenticated using (public.is_active_staff());

drop policy if exists "Staff can set ambassador application status" on public.ambassador_applications;
create policy "Staff can set ambassador application status" on public.ambassador_applications
  for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

commit;

-- Check after running (should return one row, rls = true, and two policies):
--   select relrowsecurity as rls from pg_class where relname = 'ambassador_applications';
--   select policyname from pg_policies where tablename = 'ambassador_applications';
--
-- Rollback before any real applications arrive:
--   drop table public.ambassador_applications;
--   drop function public.ambassador_applications_pin_new();
-- After real applications arrive, export them first.
