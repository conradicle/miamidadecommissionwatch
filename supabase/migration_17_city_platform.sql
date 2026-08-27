-- Miami-Dade Commission Watch: the city platform.
-- Run this in the Supabase SQL editor AFTER migration_16 has been applied.
-- Safe to re-run.
--
-- This replaces the schema migration_13 introduced and migration_16 dropped.
-- The difference that drives everything else is who may publish:
--
--   migration_13   one 'city_editor' role, site-wide, which could never
--                  publish. Every change queued for a staff review.
--   this file      roles are per city. An 'owner' -- the person whose claim
--                  was approved -- publishes their own city without asking.
--                  An 'editor' they invite may only write drafts.
--
-- Staff (owner/admin in user_roles) keep everything, plus the powers a city
-- owner must never have: creating a city, renaming it, suspending it,
-- transferring it, and reverting it to unclaimed.
--
-- ---------- naming ----------
-- The brief calls these tables 'officials' and 'meetings'. Both names are
-- taken: public.meetings is county coverage and predates all of this. So the
-- city tables carry a city_ prefix, matching city_memberships, and nothing
-- here touches the county tables.

begin;

-- ---------- cities ----------
-- slug IS the subdomain label: slug 'miamibeach' is served at
-- miamibeach.miamidadecommissionwatch.com. It is constrained to the characters
-- that are legal in a DNS label, because a slug that cannot be a hostname is a
-- city that can never be served.
--
-- status is the lifecycle the claim flow drives:
--   unclaimed  listed publicly as available, nobody assigned
--   pending    somebody has requested it, awaiting staff review
--   active     approved, has an owner, publicly visible
--   suspended  staff have pulled it offline; content is retained
--
-- is_published is a separate switch from status on purpose: an active city
-- can be set up and filled in before anyone outside its team can see it.
create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  name text not null,
  body_name text not null default '',
  -- The field the map keys off. Getting this wrong invents facts about how a
  -- city elects its government, so there is no default: whoever creates the
  -- city has to say which it is.
  governance text not null
    check (governance in ('district', 'at-large')),
  status text not null default 'unclaimed'
    check (status in ('unclaimed', 'pending', 'active', 'suspended')),
  website text,
  next_meeting_at timestamptz,
  next_meeting_note text,
  comment_guide text not null default '',
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- city_memberships ----------
-- Who may act on which city, and how. A person can hold a role on more than
-- one city, so the key is the pair.
create table if not exists public.city_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, city_id)
);

-- At most one owner per city. Ownership transfer is therefore a deliberate
-- two-step (demote, then promote) rather than something that can happen by
-- accident through a second insert.
create unique index if not exists city_memberships_one_owner
  on public.city_memberships (city_id)
  where role = 'owner';

-- ---------- claim_requests ----------
-- A request from the public to run a city. Deliberately NOT a foreign key to
-- cities: most requests arrive for a city that has no row yet, and the row is
-- created on approval.
create table if not exists public.claim_requests (
  id uuid primary key default gen_random_uuid(),
  city_slug text not null,
  city_name text not null,
  requester_name text not null,
  requester_email text not null,
  affiliation text,
  reason text,
  has_team boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  denial_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists claim_requests_pending
  on public.claim_requests (created_at desc)
  where status = 'pending';

-- ---------- city_invites ----------
-- Only used when REQUIRE_STAFF_APPROVAL_FOR_INVITES is true. With the flag
-- off (the default) a city owner's invite goes straight out and no row is
-- written here. The table exists now so turning the flag on later is a config
-- change rather than a migration.
create table if not exists public.city_invites (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'sent')),
  requested_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- city_officials ----------
-- Elected municipal officials are public figures, so their names and official
-- contact details belong here. contact_email must be an office address, never
-- a personal one.
--
-- district is null for an at-large seat. It is NOT defaulted to anything:
-- a null here is the honest answer for a city with no districts.
create table if not exists public.city_officials (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  name text not null,
  seat text not null,
  seat_type text not null default 'at-large'
    check (seat_type in ('at-large', 'district', 'mayor', 'appointed')),
  district int,
  photo_url text,
  contact_email text,
  contact_url text,
  term_ends text,
  sort_order int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- city_meetings ----------
create table if not exists public.city_meetings (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  meeting_date date not null,
  title text not null default 'Regular Meeting',
  agenda_url text,
  video_url text,
  summary text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists city_meetings_by_city
  on public.city_meetings (city_id, meeting_date desc);

-- ---------- helper functions ----------
-- All security definer, for the reason spelled out in migration_3: a policy
-- that queries the table it protects recurses, and Postgres evaluates every
-- policy on a table rather than stopping at the first that passes. Functions
-- created here run as their owner and so skip RLS internally.

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

-- 'owner', 'editor', or null. One query, so policies that need to tell the
-- two apart don't cost two.
create or replace function public.city_role(p_city uuid)
returns text
language sql
security definer
set search_path = public
stable
as $fn$
  select role from public.city_memberships
  where city_id = p_city and user_id = auth.uid();
$fn$;

create or replace function public.is_city_owner(p_city uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select public.city_role(p_city) = 'owner';
$fn$;

create or replace function public.is_city_member(p_city uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select public.city_role(p_city) in ('owner', 'editor');
$fn$;

-- Is this city visible to the public at all? Child content stays private if
-- the city is unpublished or suspended, even if an individual row says
-- 'published'.
create or replace function public.city_is_public(p_city uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.cities
    where id = p_city and is_published and status = 'active'
  );
$fn$;

-- ---------- the guard that keeps owners inside their own city ----------
-- RLS decides which ROWS you may touch; it cannot stop you touching the wrong
-- COLUMN of a row you legitimately own. A city owner needs UPDATE on their own
-- cities row to edit the blurb and the meeting time -- which without this
-- would also let them rename their slug, publish themselves, or clear their
-- own suspension. So the staff-only columns are enforced in a trigger.
create or replace function public.guard_city_staff_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.is_active_staff() then
    return new;
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'Only staff can change a city''s address (slug).';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Only staff can change a city''s status.';
  end if;
  if new.is_published is distinct from old.is_published then
    raise exception 'Only staff can publish or unpublish a city.';
  end if;
  if new.governance is distinct from old.governance then
    raise exception 'Only staff can change a city''s governance type.';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists cities_guard_staff_columns on public.cities;
create trigger cities_guard_staff_columns
  before update on public.cities
  for each row execute function public.guard_city_staff_columns();

-- ---------- the guard that keeps editors from publishing ----------
-- The decision this schema exists to express: an owner publishes their own
-- city's content, an editor they invited may only write drafts. Enforced here
-- rather than by hiding a button, so it holds against anything that talks to
-- PostgREST directly.
create or replace function public.guard_publish_rights()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'published'
     and not public.is_active_staff()
     and not public.is_city_owner(new.city_id) then
    raise exception 'Only the city owner or staff can publish. Save it as a draft instead.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists city_officials_guard_publish on public.city_officials;
create trigger city_officials_guard_publish
  before insert or update on public.city_officials
  for each row execute function public.guard_publish_rights();

drop trigger if exists city_meetings_guard_publish on public.city_meetings;
create trigger city_meetings_guard_publish
  before insert or update on public.city_meetings
  for each row execute function public.guard_publish_rights();

-- ---------- policies: cities ----------
alter table public.cities enable row level security;

drop policy if exists "Public can read published cities" on public.cities;
create policy "Public can read published cities"
  on public.cities for select
  using (is_published and status = 'active');

-- The claim page lists every municipality with its status, including ones
-- nobody has claimed, so unclaimed and pending rows are readable too.
drop policy if exists "Public can read the claim registry" on public.cities;
create policy "Public can read the claim registry"
  on public.cities for select
  using (status in ('unclaimed', 'pending'));

drop policy if exists "Staff can manage cities" on public.cities;
create policy "Staff can manage cities"
  on public.cities for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- A team can see their own city before it is published, so they can work on it.
drop policy if exists "Members can read their city" on public.cities;
create policy "Members can read their city"
  on public.cities for select
  using (public.is_city_member(id));

-- Owners edit their own city. Creating and deleting stay with staff, and the
-- trigger above blocks the staff-only columns.
drop policy if exists "Owners can update their city" on public.cities;
create policy "Owners can update their city"
  on public.cities for update
  using (public.is_city_owner(id))
  with check (public.is_city_owner(id));

-- ---------- policies: city_memberships ----------
alter table public.city_memberships enable row level security;

drop policy if exists "Staff can manage memberships" on public.city_memberships;
create policy "Staff can manage memberships"
  on public.city_memberships for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "Members can read their own memberships" on public.city_memberships;
create policy "Members can read their own memberships"
  on public.city_memberships for select
  using (user_id = auth.uid());

drop policy if exists "Owners can see their city's team" on public.city_memberships;
create policy "Owners can see their city's team"
  on public.city_memberships for select
  using (public.is_city_owner(city_id));

-- An owner adds and removes editors on their own city, and cannot mint another
-- owner: the WITH CHECK pins the role, and the partial unique index above
-- would reject a second owner anyway.
drop policy if exists "Owners can add editors" on public.city_memberships;
create policy "Owners can add editors"
  on public.city_memberships for insert
  with check (public.is_city_owner(city_id) and role = 'editor');

drop policy if exists "Owners can remove editors" on public.city_memberships;
create policy "Owners can remove editors"
  on public.city_memberships for delete
  using (public.is_city_owner(city_id) and role = 'editor');

-- ---------- policies: claim_requests ----------
alter table public.claim_requests enable row level security;

-- Anyone may file a claim, and it must arrive as 'pending': without the
-- WITH CHECK, a request could be posted pre-approved.
drop policy if exists "Anyone can file a claim" on public.claim_requests;
create policy "Anyone can file a claim"
  on public.claim_requests for insert
  with check (status = 'pending' and reviewed_by is null and reviewed_at is null);

drop policy if exists "Staff can manage claims" on public.claim_requests;
create policy "Staff can manage claims"
  on public.claim_requests for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- Nobody but staff can READ claims: they carry a name, an email and a school.
-- The insert policy above deliberately grants no select.

-- ---------- policies: city_invites ----------
alter table public.city_invites enable row level security;

drop policy if exists "Staff can manage invites" on public.city_invites;
create policy "Staff can manage invites"
  on public.city_invites for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "Owners can request invites for their city" on public.city_invites;
create policy "Owners can request invites for their city"
  on public.city_invites for insert
  with check (public.is_city_owner(city_id) and status = 'pending');

drop policy if exists "Owners can read their city's invites" on public.city_invites;
create policy "Owners can read their city's invites"
  on public.city_invites for select
  using (public.is_city_owner(city_id));

-- ---------- policies: city_officials and city_meetings ----------
-- Identical shape for both: the public reads published rows of public cities;
-- staff do anything; members read everything in their own city and write to
-- it, with the publish triggers above deciding whether 'published' is allowed.
do $migration$
declare
  t text;
begin
  foreach t in array array['city_officials', 'city_meetings']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Public can read published %1$s" on public.%1$I', t);
    execute format(
      'create policy "Public can read published %1$s" on public.%1$I for select '
      'using (status = ''published'' and public.city_is_public(city_id))', t);

    execute format('drop policy if exists "Staff can manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "Staff can manage %1$s" on public.%1$I for all '
      'using (public.is_active_staff()) with check (public.is_active_staff())', t);

    execute format('drop policy if exists "Members can read their %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members can read their %1$s" on public.%1$I for select '
      'using (public.is_city_member(city_id))', t);

    execute format('drop policy if exists "Members can write their %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members can write their %1$s" on public.%1$I for insert '
      'with check (public.is_city_member(city_id))', t);

    execute format('drop policy if exists "Members can edit their %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members can edit their %1$s" on public.%1$I for update '
      'using (public.is_city_member(city_id)) '
      'with check (public.is_city_member(city_id))', t);

    execute format('drop policy if exists "Members can delete their %1$s" on public.%1$I', t);
    execute format(
      'create policy "Members can delete their %1$s" on public.%1$I for delete '
      'using (public.is_city_member(city_id))', t);
  end loop;
end;
$migration$;

-- ---------- grants ----------
-- Column visibility in Postgres is a GRANT, not a policy: the lesson from
-- migration_12. The anon key ships in the browser, so anon gets exactly the
-- columns the public pages render and nothing more. In particular anon never
-- reads city_memberships (which maps students to cities) or claim_requests
-- (which holds names, emails and schools).
revoke select on public.cities from anon;
grant select (id, slug, name, body_name, governance, status, website,
              next_meeting_at, next_meeting_note, comment_guide, sort_order)
  on public.cities to anon;

revoke select on public.city_officials from anon;
grant select (id, city_id, name, seat, seat_type, district, photo_url,
              contact_email, contact_url, term_ends, sort_order, status)
  on public.city_officials to anon;

revoke select on public.city_meetings from anon;
grant select (id, city_id, meeting_date, title, agenda_url, video_url,
              summary, status)
  on public.city_meetings to anon;

revoke all on public.city_memberships from anon;
revoke all on public.city_invites from anon;

-- anon must be able to file a claim from the public form, and nothing else.
revoke all on public.claim_requests from anon;
grant insert (city_slug, city_name, requester_name, requester_email,
              affiliation, reason, has_team) on public.claim_requests to anon;

-- ---------- seed: the two cities whose subdomains already resolve ----------
-- These replace the hardcoded fixtures in js/city-site.js. Nothing about
-- either city is invented: no officials, no meetings, no boundaries.
--
-- Hialeah's governance is the one value here that is NOT verified. The rebuild
-- brief lists it as a district city; Hialeah's council may in fact be elected
-- citywide. It is seeded as 'district' to match the brief, and staff can flip
-- it in one click once the charter has been checked.
insert into public.cities (slug, name, body_name, governance, status, website, is_published, sort_order)
values
  ('miamibeach', 'Miami Beach', 'Miami Beach City Commission', 'at-large', 'active',
   'https://www.miamibeachfl.gov/', true, 10),
  ('hialeah', 'Hialeah', 'Hialeah City Council', 'district', 'active',
   null, true, 20)
on conflict (slug) do nothing;

commit;

-- ---------- After running this file ----------
-- 1. The Cities tab is back in admin.html, staff-only for now, and it drives
--    every city subdomain from these tables.
-- 2. js/city-site.js reads from here instead of its hardcoded fixtures.
-- 3. Adding a city in the dashboard does NOT create its subdomain. Each new
--    city still needs a CNAME in Cloudflare and a domain added in Vercel:
--      CNAME  <slug>  01e74edb75f50fad.vercel-dns-017.com  (DNS only)
--    Automating that pair is a later stage.
