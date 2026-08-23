-- Miami-Dade Commission Watch: self-serve city program
-- Run this once in the Supabase SQL editor, after migration_12.
--
-- Moves the /cities/ registry from js/cities-data.js into the database and
-- adds a public application flow, so a student can apply to start their
-- city's coverage from start-a-city.html and staff can approve it from the
-- admin dashboard -- flipping the city live with no code change or deploy.
-- js/cities-data.js remains as a fallback if these tables are unreachable.
--
-- Two tables, two very different privacy postures:
--
--   cities             Public by design. Everything in it renders on
--                      /cities/ pages, so it is kept PII-free on purpose:
--                      no applicant names, no emails. team_public is
--                      staff-curated display copy only ("First L." names,
--                      alias contact) -- never raw student data.
--
--   city_applications  Contains a minor's name, school, and school email.
--                      Never public. anon may INSERT (that's the form) and
--                      nothing else; per the migration_12 lesson, SELECT is
--                      revoked from anon at the grant level, not just left
--                      to row policies.

-- ---------- cities ----------
create table public.cities (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,50}$'),
  name text not null,
  blurb text not null default '',
  -- 'team-needed' -> 'forming' (approved, not yet publishing) -> 'active'
  status text not null default 'team-needed' check (status in ('team-needed', 'forming', 'active')),
  -- Unlisted cities are hidden everywhere without deleting their data.
  listed boolean not null default true,
  -- Free-form because municipal governments differ: { body, form, note }.
  government jsonb,
  official_website text,
  -- Array of { label, url }. Only sources staff have actually verified.
  sources jsonb not null default '[]'::jsonb,
  -- Staff-curated public team info: { name, coverage, editors: ["First L."],
  -- contributors: ["First L."], advisor, contact, launched }. Names must
  -- already be in "First L." form here and contact must be a project alias:
  -- this column is anon-readable, so raw student data must never enter it.
  team_public jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cities enable row level security;

create policy "Public can read listed cities"
  on public.cities for select
  using (listed = true);

create policy "Staff can read all cities"
  on public.cities for select
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

create policy "Staff can insert cities"
  on public.cities for insert
  with check (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

create policy "Staff can update cities"
  on public.cities for update
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

create policy "Staff can delete cities"
  on public.cities for delete
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- Explicit column grant for anon (migration_12 lesson: RLS is row-level,
-- column visibility is a GRANT). Today every column is public by design;
-- the point of doing it explicitly is that any column added later is
-- anon-invisible until someone consciously adds it here.
revoke select on public.cities from anon;
grant select (slug, name, blurb, status, listed, government, official_website, sources, team_public, created_at, updated_at)
  on public.cities to anon;

-- ---------- city_applications ----------
create table public.city_applications (
  id uuid primary key default gen_random_uuid(),
  city_name text not null,
  applicant_name text not null,
  grade text not null,
  school text not null,
  school_email text not null,
  why text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table public.city_applications enable row level security;

-- Anyone can apply, but only into the unreviewed state (migration_6 lesson:
-- `with check (true)` would let a direct REST call insert pre-approved rows).
create policy "Anyone can apply to start a city"
  on public.city_applications for insert
  with check (status = 'pending' and reviewed_at is null and reviewed_by is null);

create policy "Staff can read applications"
  on public.city_applications for select
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

create policy "Staff can update applications"
  on public.city_applications for update
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

create policy "Staff can delete applications"
  on public.city_applications for delete
  using (
    exists (
      select 1 from public.user_roles
      where user_roles.user_id = auth.uid()
      and user_roles.role in ('owner', 'admin')
      and user_roles.status = 'active'
    )
  );

-- Applications hold a minor's PII. anon gets INSERT and nothing else --
-- revoked at the grant level so no future row policy can accidentally
-- re-expose them (the RLS insert policy above still gates what an insert
-- may contain).
revoke all on public.city_applications from anon;
grant insert on public.city_applications to anon;

-- ---------- seed from js/cities-data.js ----------
-- Same six cities the static registry ships with, so the hub renders
-- identically the moment the site starts reading from this table.
insert into public.cities (slug, name, blurb, status, government, official_website, sources) values
  (
    'miami-beach',
    'Miami Beach',
    'Coverage of the City of Miami Beach government, run by students in Miami Beach.',
    'team-needed',
    '{"body": "Miami Beach City Commission", "form": "Commission–City Manager", "note": "The Mayor and six Commissioners are elected citywide (at large), unlike the county commission’s 13 single-member districts."}'::jsonb,
    'https://www.miamibeachfl.gov/',
    '[{"label": "City of Miami Beach — official website", "url": "https://www.miamibeachfl.gov/"}, {"label": "Miami-Dade Supervisor of Elections", "url": "https://www.votemiamidade.gov/"}]'::jsonb
  ),
  ('miami', 'City of Miami', 'Coverage of the City of Miami government, run by students in Miami.', 'team-needed', null, null, '[]'::jsonb),
  ('coral-gables', 'Coral Gables', 'Coverage of the City of Coral Gables government, run by students in Coral Gables.', 'team-needed', null, null, '[]'::jsonb),
  ('miami-gardens', 'Miami Gardens', 'Coverage of the City of Miami Gardens government, run by students in Miami Gardens.', 'team-needed', null, null, '[]'::jsonb),
  ('hialeah', 'Hialeah', 'Coverage of the City of Hialeah government, run by students in Hialeah.', 'team-needed', null, null, '[]'::jsonb),
  ('homestead', 'Homestead', 'Coverage of the City of Homestead government, run by students in Homestead.', 'team-needed', null, null, '[]'::jsonb)
on conflict (slug) do nothing;
