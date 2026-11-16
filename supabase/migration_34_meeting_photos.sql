-- Meeting photos: pictures from Board of County Commissioners meetings.
--
-- Run this once in the Supabase SQL editor, after migration_33. It only adds
-- things (one table, one bucket, policies, a trigger). Nothing existing is
-- altered.
--
-- Order does not matter as much as for migration_27: the build treats a
-- missing meeting_photos table as "no photos yet" and still deploys, because
-- an empty gallery cannot leak anything. Until this runs, the Photos tab in
-- the dashboard shows an error and /photos says no photos are up yet.
--
-- Shape
-- -----
--   meeting_photos   one row per photo. Each photo is two files in the
--                    meeting-photos bucket, both written by the dashboard:
--                      <meeting date>/<uuid>.jpg        full size, long edge
--                                                       at most 2000px
--                      <meeting date>/<uuid>-thumb.jpg  long edge 800px
--                    The dashboard re-encodes every upload in the browser,
--                    which drops the EXIF block, so no GPS location or camera
--                    serial reaches Storage.
--
-- Minors
-- ------
-- Most people in these photos are high school students. A photo cannot be
-- published unless consent_confirmed is true: the staff member ticks it to
-- say a signed photo release is on file for every minor in the frame and
-- nobody shown asked to be left out. The check constraint below enforces
-- that for every write path, including the SQL editor. Captions follow the
-- site rule: first name and last initial at most, never a school or grade.
-- The database cannot read a caption for that, so the dashboard says it next
-- to the field and EDITORIAL-REVIEW-CHECKLIST.md is the standard.
--
-- Who writes what
-- ---------------
-- Staff write directly with their own session, like meeting_schedule: RLS
-- limits writes to active staff (is_active_staff(): user_roles owner/admin,
-- status active). The public reads published rows only, and only the
-- columns a page needs. The build reads with the anon key, so it can never
-- render an unpublished photo.
--
-- Files
-- -----
-- meeting-photos is a public bucket, so <img> tags load files from
-- /storage/v1/object/public/ with no token. An unpublished photo's file is
-- therefore reachable by anyone who has its exact URL, but nobody outside
-- staff ever sees one: paths contain a random UUID, nothing public links to
-- an unpublished photo, and anon cannot list the bucket (no anon SELECT
-- policy on storage.objects, the lesson of migration_31). Deleting a photo in
-- the dashboard removes both files and the row.

-- =========================================================================
-- 1. Table
-- =========================================================================
create table if not exists public.meeting_photos (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  storage_path text not null unique
    check (storage_path ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  width integer not null check (width between 1 and 6000),
  height integer not null check (height between 1 and 6000),
  alt_text text not null check (char_length(alt_text) between 10 and 300),
  caption text check (caption is null or char_length(caption) <= 200),
  credit text check (credit is null or char_length(credit) <= 80),
  sort_order integer not null default 0,
  -- Featured photos lead on the homepage and on /attend.
  is_featured boolean not null default false,
  consent_confirmed boolean not null default false,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_photos_published_needs_consent check (not published or consent_confirmed)
);

comment on table public.meeting_photos is
  'Photos from BCC meetings. Public read of published rows, staff write. A photo cannot be published without consent_confirmed. See migration_34.';

create index if not exists meeting_photos_date_idx
  on public.meeting_photos (meeting_date desc, sort_order, created_at);

alter table public.meeting_photos enable row level security;

drop policy if exists "Public can read published meeting photos" on public.meeting_photos;
create policy "Public can read published meeting photos"
  on public.meeting_photos for select
  using (published);

drop policy if exists "Staff can manage meeting photos" on public.meeting_photos;
create policy "Staff can manage meeting photos"
  on public.meeting_photos for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- A signed-in account with no staff role sees nothing here, the same rule
-- migration_32 applied to every other table: the authenticated role holds
-- SELECT on every column, including created_by and consent_confirmed, and
-- the public policy above has no TO clause. Restrictive policies are ANDed
-- with the permissive ones, so staff are unaffected.
drop policy if exists "Signed-in accounts need a staff role" on public.meeting_photos;
create policy "Signed-in accounts need a staff role"
  on public.meeting_photos as restrictive for select
  to authenticated
  using (public.is_active_staff());

-- anon gets only what a page renders. Who uploaded a photo and the consent
-- flag stay with staff (every published row has consent true anyway).
revoke all on public.meeting_photos from anon;
grant select (id, meeting_date, storage_path, width, height, alt_text, caption, credit,
              sort_order, is_featured, published, created_at)
  on public.meeting_photos to anon;

create or replace function public.touch_meeting_photos()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists meeting_photos_touch on public.meeting_photos;
create trigger meeting_photos_touch
  before update on public.meeting_photos
  for each row execute function public.touch_meeting_photos();

-- =========================================================================
-- 2. Bucket
-- =========================================================================
-- 5 MB is generous: the dashboard sends JPEGs of about 0.3 to 1 MB. Storage
-- enforces the size and type itself, whichever path an upload takes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-photos', 'meeting-photos', true, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Staff only, for every operation. SELECT is staff-only too so anon cannot
-- list the bucket; public URLs still serve without a policy.
drop policy if exists "Staff can list meeting photos" on storage.objects;
create policy "Staff can list meeting photos"
  on storage.objects for select
  using (bucket_id = 'meeting-photos' and public.is_active_staff());

drop policy if exists "Staff can upload meeting photos" on storage.objects;
create policy "Staff can upload meeting photos"
  on storage.objects for insert
  with check (bucket_id = 'meeting-photos' and public.is_active_staff());

drop policy if exists "Staff can delete meeting photos" on storage.objects;
create policy "Staff can delete meeting photos"
  on storage.objects for delete
  using (bucket_id = 'meeting-photos' and public.is_active_staff());

-- No UPDATE policy: a stored file is never replaced. A new photo gets a new
-- UUID, so a cached copy of an old file can never show different content.

-- =========================================================================
-- After running this file
-- =========================================================================
-- 1. Staff dashboard, Photos tab: upload, add alt text and captions, tick
--    consent, publish, then Publish to site.
--
-- Verify:
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'meeting-photos';
select count(*) as photos from public.meeting_photos;
