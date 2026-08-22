-- Miami-Dade Commission Watch: traffic counting for the /links page
-- Run this once in the Supabase SQL editor, after migration_7.
--
-- Backs the Instagram bio link (links.html). Two event kinds land here:
-- a 'view' when someone opens /links, and a 'click' when they tap one of
-- the cards on it. Together those answer the only questions the page
-- raises: how many people arrive, and which link they actually want.
--
-- Deliberately stores no IP, no user agent, no cookie, and no session id.
-- Rows are anonymous counters, not visits, so this can't be turned back
-- into "what did this person do" and privacy.html can keep saying we don't
-- run trackers that follow people around. The tradeoff is that unique
-- visitors are unknowable here -- these are raw event counts.
--
-- The rows are small but unbounded. If the page ever gets busy enough for
-- that to matter, delete old detail rather than keeping it forever:
--   delete from public.link_events where occurred_at < now() - interval '1 year';

create table public.link_events (
  id bigint generated always as identity primary key,
  -- 'view' = the /links page was opened; 'click' = a card on it was tapped.
  event text not null check (event in ('view', 'click')),
  -- Which card was tapped. Null for views. The API only accepts ids from a
  -- fixed allowlist, so this column can't be filled with arbitrary strings
  -- by anyone who finds the endpoint.
  link_id text,
  -- The ?src= value the visitor arrived with ('ig' for the Instagram bio).
  -- Null when they came in without one.
  source text,
  occurred_at timestamptz not null default now()
);

-- Every read is "events since <date>", so time leads the index.
create index link_events_occurred_at_idx on public.link_events (occurred_at desc);
create index link_events_link_id_idx on public.link_events (link_id) where link_id is not null;

alter table public.link_events enable row level security;
-- Intentionally no policies: written by the service role via
-- /api/link-click, read via the aggregate function below. Neither the anon
-- key nor a logged-in staff session can touch the raw rows.

-- Returns counts only -- never the rows themselves -- so the admin dashboard
-- can't accidentally become a visit log. Three kinds come back in one call:
--   ('total',  'views',   n)  total /links opens in the window
--   ('click',  <link_id>, n)  taps per card, most-tapped first
--   ('source', <src>,     n)  where the views came from ('ig', 'direct', ...)
create or replace function public.link_stats(p_since timestamptz)
returns table (kind text, label text, total bigint)
language sql
security definer
set search_path = public
as $$
  select 'total'::text, 'views'::text, count(*)::bigint
  from public.link_events
  where event = 'view' and occurred_at >= p_since

  union all

  select 'click'::text, link_id, count(*)::bigint
  from public.link_events
  where event = 'click' and link_id is not null and occurred_at >= p_since
  group by link_id

  union all

  select 'source'::text, coalesce(source, 'direct'), count(*)::bigint
  from public.link_events
  where event = 'view' and occurred_at >= p_since
  group by coalesce(source, 'direct')

  order by 1, 3 desc;
$$;

-- The function is security definer, so only the service role needs to be able
-- to call it; the API layer is what gates this on staff role.
--
-- Postgres grants EXECUTE on a new function to PUBLIC automatically, and anon
-- inherits it through that, so naming anon and authenticated in the revoke is
-- not enough -- the grant has to be taken from PUBLIC. Doing that also takes
-- it from service_role, which reaches the function the same way, hence the
-- explicit grant back: without it, /api/link-stats loses access too.
revoke execute on function public.link_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.link_stats(timestamptz) to service_role;
