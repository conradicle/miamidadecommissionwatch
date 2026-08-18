-- Miami-Dade Commission Watch: newsletter subscribers + meeting email tracking
-- Run this once in the Supabase SQL editor, after migration_3.

-- ---------- subscribers ----------
create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed')),
  unsubscribe_token uuid not null default gen_random_uuid(),
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

alter table public.subscribers enable row level security;
-- Intentionally no policies: the subscribe/unsubscribe/notify endpoints all
-- run server-side with the Supabase service role key, which bypasses RLS.
-- That keeps the subscriber list from ever being readable through the public
-- anon key, unlike meetings/news/editorials which are meant to be public.

-- ---------- meetings: track when agenda/recap emails went out ----------
-- Null means "not sent yet". Admin can re-send (e.g. after editing a
-- meeting), which overwrites the timestamp with the latest send.
alter table public.meetings add column if not exists agenda_sent_at timestamptz;
alter table public.meetings add column if not exists recap_sent_at timestamptz;

-- ---------- After running this file ----------
-- 1. Sign up at resend.com, verify miamidadecommissionwatch.com (Resend gives
--    you the exact DNS TXT/CNAME records to add at your registrar), then
--    create an API key.
-- 2. In the Vercel project, add environment variable RESEND_API_KEY with
--    that key. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY should already be
--    set from the staff-invite feature.
