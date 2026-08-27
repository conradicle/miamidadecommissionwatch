-- Miami-Dade Commission Watch: boundaries a city team can upload themselves.
-- Run in the Supabase SQL editor AFTER migration_18. Safe to re-run.
--
-- The brief has a city owner uploading their own district GeoJSON. The obvious
-- home for an uploaded file is Supabase Storage, but that means a bucket, its
-- own policy language, and a second permission model to keep in step with this
-- one. A simplified municipal boundary is small -- tens of kilobytes, and the
-- README in assets/data/cities tells people to simplify before shipping -- so
-- it goes in a jsonb column instead, protected by the policies that already
-- exist on this table.
--
-- The static files under assets/data/cities/ stay supported: js/city-map.js
-- prefers the uploaded boundary and falls back to the file, so a boundary that
-- staff commit to the repo still works.

begin;

alter table public.cities
  add column if not exists boundary_geojson jsonb,
  add column if not exists boundary_updated_at timestamptz;

comment on column public.cities.boundary_geojson is
  'A GeoJSON FeatureCollection for this city. For a district city, one Feature '
  'per district with a numeric "district" property. For an at-large city, a '
  'single Feature holding the city limits and no district property. NULL means '
  'nobody has sourced it yet, which is the expected state for most cities and '
  'renders as an honest empty state rather than an error.';

-- A guard rail, not validation: this catches an upload that is not a
-- FeatureCollection at all, which is the mistake people actually make (they
-- upload a bare Feature, or a shapefile converted to something else). It
-- deliberately does not check coordinates -- Postgres is the wrong place to
-- decide whether a polygon is in the right hemisphere.
alter table public.cities drop constraint if exists cities_boundary_is_featurecollection;
alter table public.cities add constraint cities_boundary_is_featurecollection
  check (
    boundary_geojson is null
    or boundary_geojson->>'type' = 'FeatureCollection'
  );

-- The public map needs to read it, so anon gets the two new columns. It is
-- public information -- these are government boundaries.
grant select (boundary_geojson, boundary_updated_at) on public.cities to anon;

-- Members of a city need to read their own city's boundary while it is still
-- unpublished, which the existing "Members can read their city" policy already
-- allows; and owners need to write it, which "Owners can update their city"
-- already allows. The staff-column trigger from migration_17 does not name
-- boundary_geojson, so an owner may set it. That is intended: the boundary is
-- their city's content, not a site-wide setting.

commit;

-- ---------- After running this file ----------
-- 1. /city-admin.html gains a Boundaries tab where an owner can paste or
--    upload a .geojson file.
-- 2. js/city-map.js reads cities.boundary_geojson first and falls back to
--    assets/data/cities/<slug>.geojson.
