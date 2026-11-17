-- Base: 9f5e0c3. Draft only: apply manually before the website release.
-- Generated with 'supabase migration new meeting_interest', then placed in
-- this repository's existing numbered SQL-editor migration layout.
-- Verified live bcc schema and is_active_staff() on 2026-11-17 (read only).
-- A separate table in the SAME database is necessary: meeting rosters require
-- a meeting and are purged 30 days later; this list lasts until removal.
begin;
create table public.bcc_meeting_interest (
  id uuid primary key default gen_random_uuid(),
  registration_type text not null default 'meeting_interest' check (registration_type = 'meeting_interest'),
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text not null unique check (phone ~ '^[0-9]{10}$'),
  school_name text check (school_name is null or char_length(school_name) between 1 and 200),
  public_comment_interest text check (public_comment_interest in ('yes','maybe','no')),
  notification_consent boolean not null check (notification_consent = (withdrawn_at is null)),
  consented_at timestamptz not null default now(),
  consent_version text not null default 'meeting-participation-sms-v1' check (consent_version = 'meeting-participation-sms-v1'),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
alter table public.bcc_meeting_interest enable row level security;
revoke all on public.bcc_meeting_interest from public, anon, authenticated;
grant select on public.bcc_meeting_interest to authenticated;
grant update (notification_consent,withdrawn_at,full_name,school_name,public_comment_interest)
  on public.bcc_meeting_interest to authenticated;
grant all on public.bcc_meeting_interest to service_role;
create policy "Staff can read meeting interest" on public.bcc_meeting_interest
  for select to authenticated using (public.is_active_staff());
create policy "Staff can withdraw meeting interest" on public.bcc_meeting_interest
  for update to authenticated using (public.is_active_staff())
  with check (public.is_active_staff() and not notification_consent and withdrawn_at is not null);
commit;
-- No anon access, no public INSERT, no new SECURITY DEFINER function.
-- Staff cannot insert, change phone numbers, or restore consent using the browser.
-- Public duplicate inserts use ON CONFLICT DO NOTHING, retaining suppressions.
-- Rollback before accepting real submissions: drop table public.bcc_meeting_interest;
-- After accepting real submissions, preserve/export the list securely first.
