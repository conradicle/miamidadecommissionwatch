-- Miami-Dade Commission Watch: structured agenda items, roll-call votes,
-- commissioner identities, and topic/district subscription preferences.
--
-- Run this once in the Supabase SQL editor, after migration_13.
--
-- What this enables:
--   * Meeting Tracker search + filters (topic, commissioner, date, district, outcome)
--   * A consistent mini-record per item: code, type, amount, sponsor, vote tally
--   * "Official record" separated from "Additional reporting"
--   * "How Commissioner X voted on the last N tracked items"
--   * Subscriptions scoped to a district and/or a topic
--
-- Nothing here drops a column or a row. Every new column is nullable or
-- defaulted, and the public feed degrades to the existing prose card when the
-- structured fields are empty -- so the site keeps working between running
-- this file and backfilling the content.

-- =========================================================================
-- 1. Topic vocabulary
-- =========================================================================
-- A function returning a fixed array rather than a lookup table: the list
-- changes about never, and a check constraint against it keeps typos out of
-- the filter UI. Adding a topic later means editing this function AND the
-- filter chips in meetings.html.

create or replace function public.mdcw_topics()
returns text[]
language sql
immutable
as $fn$
  select array[
    'Housing',
    'Transit',
    'Zoning',
    'Public Safety',
    'Taxes & Budget',
    'Environment',
    'Parks',
    'Other'
  ];
$fn$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default; revoke from
-- public, not just anon (see migration_9, migration_10).
revoke execute on function public.mdcw_topics() from public;
grant execute on function public.mdcw_topics() to anon, authenticated;

-- =========================================================================
-- 2. meeting_items: the structured mini-record
-- =========================================================================
alter table public.meeting_items
  add column if not exists item_code text,
  add column if not exists legislation_number text,
  add column if not exists legislation_type text,
  add column if not exists amount_usd numeric(14,2),
  add column if not exists sponsor text,
  add column if not exists topic text,
  add column if not exists districts int[] not null default '{}',
  add column if not exists vote_yes int,
  add column if not exists vote_no int,
  add column if not exists vote_absent int,
  add column if not exists official_url text,
  add column if not exists official_label text,
  add column if not exists agenda_document_url text,
  add column if not exists vote_record_url text;

-- Constraints added conditionally so re-running the whole file is safe.
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'meeting_items_topic_check') then
    alter table public.meeting_items
      add constraint meeting_items_topic_check
      check (topic is null or topic = any (public.mdcw_topics()));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meeting_items_legislation_type_check') then
    alter table public.meeting_items
      add constraint meeting_items_legislation_type_check
      check (legislation_type is null or legislation_type in (
        'Ordinance', 'Resolution', 'Report', 'Appointment',
        'Public Hearing', 'Discussion Item', 'Other'
      ));
  end if;

  -- Districts must be real districts. An empty array means countywide.
  if not exists (select 1 from pg_constraint where conname = 'meeting_items_districts_check') then
    alter table public.meeting_items
      add constraint meeting_items_districts_check
      check (districts <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13]);
  end if;
end
$mig$;

comment on column public.meeting_items.districts is
  'Commission districts this item specifically affects. Empty array means countywide.';
comment on column public.meeting_items.official_url is
  'The county''s own record for this item (Legistar / govaction). Secondary journalism goes in item_sources.';

-- The item volume is small today, but the Meeting Tracker filters run on
-- every keystroke and these indexes cost nothing to carry.
create index if not exists meeting_items_topic_idx on public.meeting_items (topic);
create index if not exists meeting_items_tag_status_idx on public.meeting_items (tag_status);
create index if not exists meeting_items_districts_idx on public.meeting_items using gin (districts);

-- =========================================================================
-- 3. item_sources: "Additional reporting" underneath the official record
-- =========================================================================
-- The editorial policy is that every item links to the county's own record.
-- Journalism is useful *underneath* that, not instead of it -- so the official
-- links are columns on the item, and secondary coverage is rows here (zero or
-- more), each carrying the outlet name so the distinction is visible.
create table if not exists public.item_sources (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.meeting_items(id) on delete cascade,
  sort_order int not null default 0,
  outlet text not null,
  label text not null,
  url text not null,
  published_on date
);

create index if not exists item_sources_item_idx on public.item_sources (item_id, sort_order);

alter table public.item_sources enable row level security;

drop policy if exists "Public can read item sources" on public.item_sources;
create policy "Public can read item sources"
  on public.item_sources for select
  using (true);

drop policy if exists "Staff can manage item sources" on public.item_sources;
create policy "Staff can manage item sources"
  on public.item_sources for all
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- Carry existing single-source links across as additional reporting. They
-- currently point at a mix of county records and news outlets, so they land
-- with outlet 'Unsorted' for an editor to triage -- promote the county ones
-- into official_url, name the outlet on the journalism ones. Guarded so
-- re-running this file does not duplicate rows.
insert into public.item_sources (item_id, outlet, label, url, sort_order)
select mi.id, 'Unsorted', coalesce(nullif(mi.source_label, ''), 'Source'), mi.source_url, 0
from public.meeting_items mi
where mi.source_url is not null
  and mi.source_url <> ''
  and not exists (
    select 1 from public.item_sources s
    where s.item_id = mi.id and s.url = mi.source_url
  );

-- =========================================================================
-- 4. commissioners: identity only
-- =========================================================================
-- Deliberately thin. Photos, committee lists, biography and contact details
-- stay hand-maintained in the static commissioner pages; this table exists so
-- a roll-call vote can point at a *person* rather than a district number.
-- District 1 is Gilbert through January 2 2027 and Gallon after -- a vote row
-- keyed on district alone would silently misattribute across that boundary.
create table if not exists public.commissioners (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  full_name text not null,
  district int not null check (district between 1 and 13),
  title text not null default 'Commissioner',
  term_start date,
  term_end date,
  is_current boolean not null default true,
  sort_order int not null default 0
);

create index if not exists commissioners_district_idx on public.commissioners (district);
create index if not exists commissioners_current_idx on public.commissioners (is_current);

alter table public.commissioners enable row level security;

drop policy if exists "Public can read commissioners" on public.commissioners;
create policy "Public can read commissioners"
  on public.commissioners for select
  using (true);

drop policy if exists "Staff can manage commissioners" on public.commissioners;
create policy "Staff can manage commissioners"
  on public.commissioners for all
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- Seed the current 13. Every name, spelling and role below is transcribed
-- from the roster on officials.html, which carries its own "last verified
-- August 18, 2026" note -- NOT from memory. If you change a name here, change
-- it there too, and vice versa: these two lists disagreeing is how a wrong
-- commissioner ends up attributed to a vote.
--
-- on conflict do nothing keeps a re-run from clobbering later dashboard edits.
insert into public.commissioners (slug, full_name, district, title, term_end, sort_order) values
  ('oliver-g-gilbert-iii',   'Oliver G. Gilbert, III',      1,  'Commissioner',   '2027-01-03', 1),
  ('marleine-bastien',       'Marleine Bastien',            2,  'Commissioner',   null, 2),
  ('keon-hardemon',          'Keon Hardemon',               3,  'Commissioner',   null, 3),
  ('micky-steinberg',        'Micky Steinberg',             4,  'Commissioner',   null, 4),
  ('vicki-l-lopez',          'Vicki L. Lopez',              5,  'Commissioner',   null, 5),
  ('natalie-milian-orbis',   'Natalie Milian Orbis',        6,  'Commissioner',   null, 6),
  ('raquel-a-regalado',      'Raquel A. Regalado',          7,  'Commissioner',   null, 7),
  ('danielle-cohen-higgins', 'Danielle Cohen Higgins',      8,  'Commissioner',   null, 8),
  ('kionne-l-mcghee',        'Kionne L. McGhee',            9,  'Vice Chairman',  null, 9),
  ('anthony-rodriguez',      'Anthony Rodriguez',           10, 'Chairman',       null, 10),
  ('roberto-j-gonzalez',     'Roberto J. Gonzalez',         11, 'Commissioner',   null, 11),
  ('juan-carlos-bermudez',   'Juan Carlos "JC" Bermudez',   12, 'Commissioner',   null, 12),
  ('rene-garcia',            'René Garcia',                 13, 'Commissioner',   null, 13)
on conflict (slug) do nothing;

-- Incoming: elected unopposed to succeed Gilbert, takes office January 3 2027.
-- is_current = false, so the roster and the roll-call form skip them until the
-- term starts; recorded now so the succession is not a surprise in January.
insert into public.commissioners (slug, full_name, district, term_start, is_current, sort_order) values
  ('steve-gallon-iii', 'Steve Gallon III', 1, '2027-01-03', false, 1)
on conflict (slug) do nothing;

-- =========================================================================
-- 5. item_votes: the roll call
-- =========================================================================
-- One row per commissioner per tracked item -- thirteen rows for a contested
-- item. This is the data behind "How Commissioner X voted on the last 20
-- tracked items", and it is the most labour-intensive thing on the site. The
-- admin form pre-fills all 13 with a default so an editor only clicks the
-- exceptions.
create table if not exists public.item_votes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.meeting_items(id) on delete cascade,
  commissioner_id uuid not null references public.commissioners(id) on delete restrict,
  vote text not null check (vote in ('yes', 'no', 'abstain', 'absent', 'recused')),
  unique (item_id, commissioner_id)
);

create index if not exists item_votes_item_idx on public.item_votes (item_id);
create index if not exists item_votes_commissioner_idx on public.item_votes (commissioner_id);

alter table public.item_votes enable row level security;

drop policy if exists "Public can read item votes" on public.item_votes;
create policy "Public can read item votes"
  on public.item_votes for select
  using (true);

drop policy if exists "Staff can manage item votes" on public.item_votes;
create policy "Staff can manage item votes"
  on public.item_votes for all
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- =========================================================================
-- 6. Subscription preferences
-- =========================================================================
-- all_meetings defaults to true so every existing subscriber keeps getting
-- exactly what they signed up for. Only someone who actively narrows their
-- preferences stops receiving the full digest -- a migration must never
-- silently unsubscribe anyone from mail they asked for.
alter table public.subscribers
  add column if not exists all_meetings boolean not null default true,
  add column if not exists districts int[] not null default '{}',
  add column if not exists topics text[] not null default '{}';

do $subs$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscribers_districts_check') then
    alter table public.subscribers
      add constraint subscribers_districts_check
      check (districts <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13]);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscribers_topics_check') then
    alter table public.subscribers
      add constraint subscribers_topics_check
      check (topics <@ public.mdcw_topics());
  end if;
end
$subs$;

comment on column public.subscribers.all_meetings is
  'true = send every agenda/recap digest. false = send only when an item matches districts/topics.';

-- subscribers deliberately has no RLS policies (see migration_4): every read
-- and write goes through the service role in api/, so the list is never
-- readable through the public anon key. The new columns inherit that.

-- =========================================================================
-- After running this file
-- =========================================================================
-- 1. In the dashboard, give each existing meeting item a topic, a legislation
--    number and an official_url. Until an item has a topic it will not appear
--    under any topic filter and will not match a topic subscription.
-- 2. Triage every item_sources row whose outlet is 'Unsorted': promote the
--    county links into the item's official_url, and give the journalism links
--    a real outlet name.
-- 3. Roll-call votes are optional per item. An item with no item_votes rows
--    still shows its aggregate tally from vote_yes / vote_no / vote_absent.
-- 4. This file is applied by hand. Nothing verifies that the deployed schema
--    matches it -- confirm in the Supabase SQL editor before relying on the
--    new columns.
