-- Give meetings a draft state, so a half-written write-up cannot go public.
--
-- Run this once in the Supabase SQL editor, after migration_21.
--
-- The problem: fetchMeetings() in scripts/lib/data.mjs selected every row with
-- no status filter, and vercel.json rebuilds the whole site from Supabase on
-- each deploy. So the moment anyone deployed, every meeting in the table went
-- live -- finished or not. There was no way to start a write-up on Tuesday and
-- publish it on Thursday. Editorials already had status = approved; meetings
-- had nothing.
--
-- IMPORTANT -- run this BEFORE deploying the code that filters on it. The
-- build asks for published=is.true and fails loudly if the column is missing,
-- which is deliberate: the alternative is a build that silently ignores the
-- filter and publishes every draft. A failed build leaves the last good
-- deployment serving, so nothing breaks for readers -- the site just stops
-- updating until this file is applied.

-- =========================================================================
-- 1. The column
-- =========================================================================
-- default true, not false. Every meeting that exists today is already public,
-- and a migration must never silently unpublish live content -- same reasoning
-- as subscribers.all_meetings in migration_14. Only a meeting someone actively
-- marks as a draft becomes one.
alter table public.meetings
  add column if not exists published boolean not null default true,
  add column if not exists published_at timestamptz;

comment on column public.meetings.published is
  'false = draft, invisible to the public build and to the anon key. Defaults true so existing meetings stay live.';
comment on column public.meetings.published_at is
  'When the meeting was last flipped from draft to published. Informational.';

-- Backfill published_at for rows that were already public, so the column is
-- not misleadingly empty on everything that predates it.
update public.meetings
   set published_at = coalesce(published_at, created_at)
 where published is true
   and published_at is null;

create index if not exists meetings_published_idx on public.meetings (published);

-- =========================================================================
-- 2. Drafts must not be publicly readable
-- =========================================================================
-- Without this the column is decoration: the anon key is public by design and
-- ships in js/supabase-client.js, so anyone could read an unpublished meeting
-- straight out of PostgREST even though it is absent from the built pages.
--
-- Staff keep full access through the existing "Staff can manage meetings"
-- policy -- RLS policies are OR'd, so an active owner/admin still sees drafts
-- in the dashboard. The build uses the anon key, so this policy alone is what
-- keeps drafts out of the published site; the filter in data.mjs is the
-- second belt.
drop policy if exists "Public can read meetings" on public.meetings;
create policy "Public can read meetings"
  on public.meetings for select
  using (published);

-- meeting_items, item_sources and item_votes stay publicly readable on their
-- own terms. They are only ever reached through a meeting -- the build embeds
-- them, and PostgREST will not return children of a row the caller cannot see
-- -- so a draft's items are unreachable in practice. Restricting them here
-- would mean a correlated subquery on every item read for no gain.

-- =========================================================================
-- After running this file
-- =========================================================================
-- 1. Deploy the code that filters on it (data.mjs, admin dashboard toggle).
-- 2. New meetings created in the dashboard default to Draft; use the
--    Published toggle, then Publish to site, to put one in front of readers.

-- Verify: every existing meeting should still be published.
select published, count(*)
  from public.meetings
 group by published;
