-- Miami-Dade Commission Watch: generic per-key rate limiting
-- Run this once in the Supabase SQL editor, after migration_6.
--
-- Backs IP-based throttling for public write endpoints (starting with
-- newsletter-subscribe) that previously had no abuse protection -- anyone
-- could script repeated signups to burn Resend send quota/reputation or
-- spam arbitrary third-party addresses with the welcome email.
--
-- One row per rate-limited key (e.g. "newsletter-subscribe:1.2.3.4"), fixed
-- window. check_rate_limit atomically increments (or resets, if the window
-- has expired) in a single INSERT ... ON CONFLICT statement and returns
-- whether the request is still within the limit, so concurrent requests
-- can't race past the check like a read-then-write from the API layer would.

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.rate_limits enable row level security;
-- Intentionally no policies: only called via the security-definer function
-- below (or the service role directly), same pattern as subscribers.

create or replace function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else rate_limits.window_start
        end
  returning count <= p_limit;
$$;
