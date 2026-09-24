-- Host city officials' photos ourselves instead of hotlinking city websites.
--
-- Run this once in the Supabase SQL editor, after migration_24. Then run
-- scripts/import-official-photos.mjs to copy the existing photos over.
--
-- Why. city_officials.photo_url pointed straight at the cities' own sites
-- (www.miamibeachfl.gov/wp-content/uploads/..., northbayvillage-fl.gov/...),
-- and the CSP in vercel.json only lets images load from our own origins, so
-- every one of those photos was blocked on the city subdomains. Widening
-- img-src to each city's domain would mean a CSP edit per city and trusting
-- whatever those sites serve later; copying the file once into our own
-- Storage needs exactly one new origin, the Supabase project, for all cities.
--
-- Nothing here touches RLS on city_officials or the anon column grants from
-- migration_17. photo_source_url is deliberately NOT granted to anon: it is a
-- provenance note for staff, and the public page has no use for it.

-- =========================================================================
-- 1. Where each photo came from
-- =========================================================================
alter table public.city_officials
  add column if not exists photo_source_url text;

comment on column public.city_officials.photo_source_url is
  'The external URL a hosted photo was copied from (the city''s own site, usually). Null when the photo was never imported. photo_url is what the page shows.';

-- =========================================================================
-- 2. The bucket
-- =========================================================================
-- Public, because these are photos of elected officials already published on
-- government sites; a public bucket serves them from /object/public/ with no
-- token. The size and type limits are enforced by Storage itself, so an
-- upload that is not a reasonably sized image is refused whichever path it
-- takes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('official-photos', 'official-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =========================================================================
-- 3. Who can do what
-- =========================================================================
-- Anyone reads. Only active staff write, same definition as everywhere else
-- (is_active_staff(): user_roles owner/admin, status active). City owners and
-- editors do not get write access to the bucket: their photo changes go
-- through api/_official-photo.js, which checks their membership of that
-- city and then uploads with the service role.
drop policy if exists "Anyone can read official photos" on storage.objects;
create policy "Anyone can read official photos"
  on storage.objects for select
  using (bucket_id = 'official-photos');

drop policy if exists "Staff can upload official photos" on storage.objects;
create policy "Staff can upload official photos"
  on storage.objects for insert
  with check (bucket_id = 'official-photos' and public.is_active_staff());

drop policy if exists "Staff can replace official photos" on storage.objects;
create policy "Staff can replace official photos"
  on storage.objects for update
  using (bucket_id = 'official-photos' and public.is_active_staff())
  with check (bucket_id = 'official-photos' and public.is_active_staff());

drop policy if exists "Staff can delete official photos" on storage.objects;
create policy "Staff can delete official photos"
  on storage.objects for delete
  using (bucket_id = 'official-photos' and public.is_active_staff());
