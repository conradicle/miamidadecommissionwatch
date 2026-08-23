-- Miami-Dade Commission Watch: municipal coverage in the database
-- Run this once in the Supabase SQL editor, after migration_12.
--
-- Before this migration the /cities/ section was a hardcoded array in
-- js/cities-data.js: adding a city, or correcting a single fact about one,
-- meant a commit and a deploy, and there was no way for a student team to
-- enter anything themselves. This moves the registry into Postgres and adds a
-- third role, 'city_editor', scoped to specific cities.
--
-- ---------- who can do what ----------
-- owner        everything, including inviting admins and owners
-- admin        everything about content, plus inviting city editors
-- city_editor  drafts content for the cities they are assigned to, and
--              nothing at all for any other city. Cannot publish.
--
-- ---------- the review workflow ----------
-- Every content row carries review_status: draft -> pending -> published.
-- City editors may write rows only in 'draft' or 'pending' (enforced in the
-- policy's WITH CHECK, not in the UI), so a team can submit for review but can
-- never put anything on the public site by itself. Owners and admins move a
-- row to 'published' or 'archived'. The public can only ever read 'published'
-- rows belonging to a published city.
--
-- Order matters in this file: `language sql` function bodies are parsed when
-- the function is created, so every helper that reads one of these tables is
-- defined after the tables exist, and the policies that call the helpers come
-- after both. Everything is written to be safe to re-run.
--
-- Nothing here touches county coverage: the existing meetings, meeting_items,
-- and editorial_submissions tables are untouched, as are their policies.

-- ---------- roles ----------
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('owner', 'admin', 'city_editor'));

-- ---------- tables ----------
-- Replaces MDCW_CITIES in js/cities-data.js. `status` is the student-team
-- status shown as a badge; `is_published` is whether the city appears on the
-- public site at all, so a city can be set up and filled in before anyone
-- outside staff can see it.
create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  blurb text not null default '',
  status text not null default 'team-needed'
    check (status in ('active', 'forming', 'team-needed')),
  official_website text,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which staff/editor accounts belong to which city. A person can be on more
-- than one team, so the key is the pair.
create table if not exists public.city_team_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (user_id, city_id)
);

-- Second foreign key on the same column, to user_roles rather than auth.users.
-- It isn't for integrity -- auth.users already covers that -- it's so PostgREST
-- can resolve city_team_members -> user_roles and the Cities tab can show a
-- team member's email and role in one request. Every account that reaches a
-- city team is created through /api/admin-invite, which writes the user_roles
-- row first, so the reference is always satisfiable.
alter table public.city_team_members
  drop constraint if exists city_team_members_user_role_fkey;
alter table public.city_team_members
  add constraint city_team_members_user_role_fkey
  foreign key (user_id) references public.user_roles(user_id) on delete cascade;

-- One published row per city, enforced by the partial index below. An editor
-- drafts a replacement as a new row; publishing it archives the old one, which
-- keeps the previously published text intact while a revision is in review.
create table if not exists public.city_government (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  body text not null,
  form text,
  note text,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'pending', 'published', 'archived')),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

create unique index if not exists city_government_one_published
  on public.city_government (city_id)
  where review_status = 'published';

create table if not exists public.city_sources (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  label text not null,
  url text not null,
  sort_order int not null default 0,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'pending', 'published', 'archived')),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

-- Elected municipal officials are public figures, so unlike student editorial
-- submitters their full names and official contact details belong here.
-- contact_email must be an office address, never a personal one.
create table if not exists public.city_officials (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  name text not null,
  seat text not null,
  seat_type text not null default 'district'
    check (seat_type in ('at-large', 'district', 'appointed')),
  district text,
  term_ends text,
  contact_email text,
  contact_url text,
  sort_order int not null default 0,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'pending', 'published', 'archived')),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

-- Deliberately the same shape as the county meetings/meeting_items tables, so
-- the city meeting editor is the county one with a city_id and a review step
-- attached rather than a second implementation.
create table if not exists public.city_meetings (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  meeting_date date not null,
  meeting_type text not null default 'Regular Meeting',
  title text not null,
  summary text not null,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'pending', 'published', 'archived')),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

create table if not exists public.city_meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.city_meetings(id) on delete cascade,
  sort_order int not null default 0,
  tag_type text not null default 'outcome' check (tag_type in ('outcome', 'item_code')),
  tag_label text not null,
  tag_status text check (tag_status in ('passed', 'failed', 'deferred')),
  heading text not null,
  description text not null,
  source_label text,
  source_url text,
  why_it_matters text not null
);

-- ---------- helper functions ----------
-- All security definer, for the reason spelled out in migration_3: a policy on
-- user_roles that queries user_roles recurses, and Postgres evaluates every
-- policy on a table rather than stopping at the first that passes. Functions
-- created in the SQL editor run as 'postgres' (BYPASSRLS), so their internal
-- queries skip RLS instead of re-entering it.

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('owner', 'admin')
      and status = 'active'
  );
$fn$;

create or replace function public.is_city_editor_for(p_city uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1
    from public.city_team_members m
    join public.user_roles r on r.user_id = m.user_id
    where m.user_id = auth.uid()
      and m.city_id = p_city
      and r.status = 'active'
      and r.role in ('owner', 'admin', 'city_editor')
  );
$fn$;

-- Is this city visible to the public at all? Child content of an unpublished
-- city stays private even if an individual row was published by mistake.
create or replace function public.city_is_published(p_city uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.cities where id = p_city and is_published
  );
$fn$;

-- Agenda items have no review_status of their own; they inherit the parent
-- meeting's, the same way meeting_items relate to meetings on the county side.
create or replace function public.city_meeting_is_public(p_meeting uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1
    from public.city_meetings m
    join public.cities c on c.id = m.city_id
    where m.id = p_meeting
      and m.review_status = 'published'
      and c.is_published
  );
$fn$;

create or replace function public.can_edit_city_meeting(p_meeting uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.city_meetings m
    where m.id = p_meeting
      and (public.is_active_staff() or public.is_city_editor_for(m.city_id))
  );
$fn$;

-- ---------- policies: cities ----------
alter table public.cities enable row level security;

drop policy if exists "Public can read published cities" on public.cities;
create policy "Public can read published cities"
  on public.cities for select
  using (is_published);

drop policy if exists "Staff can manage cities" on public.cities;
create policy "Staff can manage cities"
  on public.cities for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- A city editor can see their own city before it is published, so they can
-- work on it. Creating, renaming, or publishing a city stays with staff.
drop policy if exists "City editors can read their city" on public.cities;
create policy "City editors can read their city"
  on public.cities for select
  using (public.is_city_editor_for(id));

-- ---------- policies: city_team_members ----------
alter table public.city_team_members enable row level security;

drop policy if exists "Staff can manage city team members" on public.city_team_members;
create policy "Staff can manage city team members"
  on public.city_team_members for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "Members can read their own memberships" on public.city_team_members;
create policy "Members can read their own memberships"
  on public.city_team_members for select
  using (user_id = auth.uid());

-- ---------- policies: the four content tables ----------
-- Identical shape for each: the public reads published rows of published
-- cities; staff do anything; city editors read their own city's rows and write
-- only rows that stay in draft/pending. The WITH CHECK on both INSERT and
-- UPDATE is what actually stops a team publishing itself -- the admin UI not
-- offering a Publish button is convenience, not the control.
do $migration$
declare
  t text;
begin
  foreach t in array array['city_government', 'city_sources', 'city_officials', 'city_meetings']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Public can read published %1$s" on public.%1$I', t);
    execute format(
      'create policy "Public can read published %1$s" on public.%1$I for select '
      'using (review_status = ''published'' and public.city_is_published(city_id))', t);

    execute format('drop policy if exists "Staff can manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "Staff can manage %1$s" on public.%1$I for all '
      'using (public.is_active_staff()) with check (public.is_active_staff())', t);

    execute format('drop policy if exists "City editors can read their %1$s" on public.%1$I', t);
    execute format(
      'create policy "City editors can read their %1$s" on public.%1$I for select '
      'using (public.is_city_editor_for(city_id))', t);

    execute format('drop policy if exists "City editors can draft %1$s" on public.%1$I', t);
    execute format(
      'create policy "City editors can draft %1$s" on public.%1$I for insert '
      'with check (public.is_city_editor_for(city_id) '
      'and review_status in (''draft'', ''pending''))', t);

    execute format('drop policy if exists "City editors can edit their draft %1$s" on public.%1$I', t);
    execute format(
      'create policy "City editors can edit their draft %1$s" on public.%1$I for update '
      'using (public.is_city_editor_for(city_id) and review_status in (''draft'', ''pending'')) '
      'with check (public.is_city_editor_for(city_id) and review_status in (''draft'', ''pending''))', t);

    execute format('drop policy if exists "City editors can delete their draft %1$s" on public.%1$I', t);
    execute format(
      'create policy "City editors can delete their draft %1$s" on public.%1$I for delete '
      'using (public.is_city_editor_for(city_id) and review_status in (''draft'', ''pending''))', t);
  end loop;
end;
$migration$;

-- ---------- policies: city_meeting_items ----------
-- Agenda items follow their parent meeting rather than carrying their own
-- status, so their policies key off the meeting.
alter table public.city_meeting_items enable row level security;

drop policy if exists "Public can read published city meeting items" on public.city_meeting_items;
create policy "Public can read published city meeting items"
  on public.city_meeting_items for select
  using (public.city_meeting_is_public(meeting_id));

drop policy if exists "Staff can manage city meeting items" on public.city_meeting_items;
create policy "Staff can manage city meeting items"
  on public.city_meeting_items for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "City editors can manage items on their meetings" on public.city_meeting_items;
create policy "City editors can manage items on their meetings"
  on public.city_meeting_items for all
  using (public.can_edit_city_meeting(meeting_id))
  with check (public.can_edit_city_meeting(meeting_id));

-- ---------- grants ----------
-- Column visibility in Postgres is a GRANT, not a policy: the lesson from
-- migration_12. The anon key is public by design, so anon gets exactly the
-- columns the public pages render and nothing more. In particular anon never
-- reads submitted_by/reviewed_by (which are user ids) or city_team_members
-- (which maps student accounts to cities). js/cities.js therefore names its
-- columns explicitly -- select('*') as anon would expand to columns it may not
-- read and fail outright.
revoke select on public.cities from anon;
grant select (id, slug, name, blurb, status, official_website, sort_order) on public.cities to anon;

revoke select on public.city_government from anon;
grant select (id, city_id, body, form, note, review_status) on public.city_government to anon;

revoke select on public.city_sources from anon;
grant select (id, city_id, label, url, sort_order, review_status) on public.city_sources to anon;

revoke select on public.city_officials from anon;
grant select (id, city_id, name, seat, seat_type, district, term_ends, contact_email, contact_url, sort_order, review_status) on public.city_officials to anon;

revoke select on public.city_meetings from anon;
grant select (id, city_id, meeting_date, meeting_type, title, summary, review_status) on public.city_meetings to anon;

revoke all on public.city_team_members from anon;

-- ---------- seed ----------
-- The six cities that were hardcoded in js/cities-data.js, with Miami Beach's
-- verified government details and sources carried over. Everything else was
-- null there and stays null here: nothing about a city is invented.
insert into public.cities (slug, name, blurb, status, official_website, is_published, sort_order)
values
  ('miami-beach', 'Miami Beach', 'Coverage of the City of Miami Beach government, run by students in Miami Beach.', 'team-needed', 'https://www.miamibeachfl.gov/', true, 10),
  ('miami', 'City of Miami', 'Coverage of the City of Miami government, run by students in Miami.', 'team-needed', null, true, 20),
  ('coral-gables', 'Coral Gables', 'Coverage of the City of Coral Gables government, run by students in Coral Gables.', 'team-needed', null, true, 30),
  ('miami-gardens', 'Miami Gardens', 'Coverage of the City of Miami Gardens government, run by students in Miami Gardens.', 'team-needed', null, true, 40),
  ('hialeah', 'Hialeah', 'Coverage of the City of Hialeah government, run by students in Hialeah.', 'team-needed', null, true, 50),
  ('homestead', 'Homestead', 'Coverage of the City of Homestead government, run by students in Homestead.', 'team-needed', null, true, 60)
on conflict (slug) do nothing;

-- The partial unique index makes this a no-op on a re-run.
insert into public.city_government (city_id, body, form, note, review_status)
select id,
  'Miami Beach City Commission',
  'Commission–City Manager',
  'The Mayor and six Commissioners are elected citywide (at large), unlike the county commission’s 13 single-member districts.',
  'published'
from public.cities where slug = 'miami-beach'
on conflict do nothing;

-- city_sources has no natural unique key, so the guard is an explicit
-- "nothing here yet" rather than ON CONFLICT.
insert into public.city_sources (city_id, label, url, sort_order, review_status)
select c.id, s.label, s.url, s.sort_order, 'published'
from public.cities c
cross join (values
  ('City of Miami Beach — official website', 'https://www.miamibeachfl.gov/', 10),
  ('Miami-Dade Supervisor of Elections', 'https://www.votemiamidade.gov/', 20)
) as s(label, url, sort_order)
where c.slug = 'miami-beach'
  and not exists (select 1 from public.city_sources existing where existing.city_id = c.id);

-- ---------- After running this file ----------
-- 1. The Cities tab in admin.html can now add cities and assign team emails;
--    js/cities-data.js is gone and nothing needs a deploy to add a city.
-- 2. Inviting a city editor goes through /api/admin-invite with role
--    'city_editor' and a city_id, which owners and admins can both do. If the
--    address already has an account, it is added to the team instead.
-- 3. A city editor signing in at /login.html lands on the same dashboard with
--    only the Cities tab, showing only the cities they were added to.
