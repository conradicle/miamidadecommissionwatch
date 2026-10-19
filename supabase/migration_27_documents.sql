-- Official documents: Meeting Summaries and Agenda Summaries.
--
-- Run this once in the Supabase SQL editor, after migration_26. It only adds
-- things (three tables, two buckets, policies, guards). Nothing existing is
-- altered: the Meeting Tracker is frozen in the build and the dashboard, not
-- in the database, so the meetings table accepts any date as before.
--
-- IMPORTANT: run this BEFORE deploying the code that reads it. The build
-- fetches published documents and fails loudly if the table is missing, the
-- same deliberate stop as migration_22: a failed build leaves the last good
-- deployment serving.
--
-- Shape
-- -----
--   documents          one row per (type, meeting date, language). Holds the
--                      public metadata of the current version and a pointer
--                      to it. Language is there so a Spanish or Haitian
--                      Creole edition can be attached later; translation_of
--                      links an edition to the English original.
--   meeting_schedule   upcoming BCC meeting dates, kept apart from tracker
--                      entries so the homepage, the district panel and the
--                      upcoming list keep working after the tracker froze.
--   document_versions  one row per version: 1.0, then 1.1 for a correction.
--                      Each keeps its own PDF, sanitized HTML and metadata
--                      snapshot. A published version is never changed or
--                      deleted, so every correction leaves the earlier text
--                      downloadable. That is MDCW's corrections standard,
--                      enforced here rather than left to care.
--
-- Who writes what
-- ---------------
-- Same pattern as claim approvals (migration_17 and migration_20): staff act
-- in the dashboard, the browser posts to /api/city-platform, and the server
-- checks the caller is active staff and then writes with the service role.
-- That route is the only one that can store HTML (it sanitizes first), copy a
-- PDF into the public bucket, or publish. RLS still lets staff insert and
-- update rows directly, as asked, but the guard triggers below refuse any
-- direct write that would bypass the checks, including edits typed into the
-- SQL editor. The public reads published rows only.
--
-- Files
-- -----
--   document-uploads  private. Staff upload the PDF here from the dashboard
--                     (under uploads/<their user id>/); the server stores the
--                     sanitized HTML here. Drafts are previewed through
--                     signed URLs.
--   documents         public. Only the server writes, and only at publish,
--                     at a path that includes the version number, so a file
--                     that has been public is never replaced.

-- =========================================================================
-- 1. Tables
-- =========================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('meeting-summary', 'agenda-summary')),
  meeting_date date not null,
  language text not null default 'en' check (language in ('en', 'es', 'ht')),
  translation_of uuid references public.documents(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published')),
  current_version_id uuid,
  title text not null check (char_length(title) between 3 and 300),
  summary text not null check (char_length(summary) between 10 and 1200),
  document_number text not null check (document_number ~ '^MDCW-(MS|AS)-[0-9]{4}-[0-9]{4}(-(ES|HT))?$'),
  item_numbers text[] not null default '{}',
  keywords text[] not null default '{}',
  page_count integer check (page_count is null or page_count between 1 and 5000),
  first_published_at timestamptz,
  -- When subscribers were emailed about this document. Set by
  -- api/notify-subscribers once the page is live; null means not yet.
  subscribers_notified_at timestamptz,
  -- The last version subscribers were emailed about: the first publication,
  -- or a correction marked for email. Stops the same version going twice.
  last_notified_version text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_one_per_meeting unique (doc_type, meeting_date, language),
  constraint documents_translation_not_english check (translation_of is null or language <> 'en')
);

comment on table public.documents is
  'Official MDCW documents, one row per type, meeting date and language. Metadata here is the current published version''s; drafts live in document_versions. See migration_27.';

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  version text not null check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}$'),
  version_major integer generated always as (split_part(version, '.', 1)::integer) stored,
  version_minor integer generated always as (split_part(version, '.', 2)::integer) stored,
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null,
  summary text not null,
  document_number text not null,
  item_numbers text[] not null default '{}',
  keywords text[] not null default '{}',
  issued_on date not null,
  -- What a correction changed. Shown in the public version history.
  change_note text check (change_note is null or char_length(change_note) <= 1000),
  -- A correction is emailed to subscribers only when staff tick "Email
  -- subscribers about this correction" on upload (for a correction that
  -- changes a fact). Ignored for a first publication, which is always mailed.
  notify_subscribers boolean not null default false,
  page_count integer check (page_count is null or page_count between 1 and 5000),
  pdf_bytes bigint,
  upload_pdf_path text,
  upload_html_path text,
  public_pdf_path text,
  body_html text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  -- Named explicitly: documents.current_version_id points the other way, and
  -- PostgREST needs the name to tell the two relationships apart in embeds.
  constraint document_versions_document_id_fkey
    foreign key (document_id) references public.documents(id) on delete cascade,
  constraint document_versions_unique_version unique (document_id, version)
);

comment on table public.document_versions is
  'Every version of every document. Published rows are immutable (guard_document_versions). See migration_27.';

-- At most one draft per document at a time: uploading again replaces the
-- draft rather than stacking a second one.
create unique index if not exists document_versions_one_draft
  on public.document_versions (document_id) where status = 'draft';

create index if not exists documents_status_date_idx on public.documents (status, meeting_date desc);
create index if not exists document_versions_document_idx on public.document_versions (document_id);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_current_version_fkey') then
    alter table public.documents
      add constraint documents_current_version_fkey
      foreign key (current_version_id) references public.document_versions(id)
      deferrable initially deferred;
  end if;
end
$do$;

-- =========================================================================
-- 2. Row level security
-- =========================================================================
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

drop policy if exists "Public can read published documents" on public.documents;
create policy "Public can read published documents"
  on public.documents for select
  using (status = 'published');

drop policy if exists "Staff can read all documents" on public.documents;
create policy "Staff can read all documents"
  on public.documents for select
  using (public.is_active_staff());

drop policy if exists "Staff can insert documents" on public.documents;
create policy "Staff can insert documents"
  on public.documents for insert
  with check (public.is_active_staff());

drop policy if exists "Staff can update documents" on public.documents;
create policy "Staff can update documents"
  on public.documents for update
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- A published version is readable only while its document is published too.
-- The subquery runs under the caller's own RLS on documents, so for the
-- public it only ever sees published documents.
drop policy if exists "Public can read published versions" on public.document_versions;
create policy "Public can read published versions"
  on public.document_versions for select
  using (
    status = 'published'
    and exists (select 1 from public.documents d
                 where d.id = document_versions.document_id and d.status = 'published')
  );

drop policy if exists "Staff can read all versions" on public.document_versions;
create policy "Staff can read all versions"
  on public.document_versions for select
  using (public.is_active_staff());

drop policy if exists "Staff can insert versions" on public.document_versions;
create policy "Staff can insert versions"
  on public.document_versions for insert
  with check (public.is_active_staff());

drop policy if exists "Staff can update versions" on public.document_versions;
create policy "Staff can update versions"
  on public.document_versions for update
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- No delete policies: discarding a draft goes through the server, and the
-- guards refuse to delete anything that has been published.

-- The public sees the columns the site shows, not who uploaded what or where
-- the private copies sit. Same approach as migration_12 and migration_13.
revoke select on public.documents from anon;
grant select (id, doc_type, meeting_date, language, translation_of, status, current_version_id,
  title, summary, document_number, item_numbers, keywords, page_count, first_published_at, updated_at)
  on public.documents to anon;

revoke select on public.document_versions from anon;
grant select (id, document_id, version, version_major, version_minor, status, title, summary,
  document_number, item_numbers, keywords, issued_on, change_note, page_count, pdf_bytes,
  public_pdf_path, body_html, published_at)
  on public.document_versions to anon;

revoke insert, update, delete on public.documents from anon;
revoke insert, update, delete on public.document_versions from anon;

-- =========================================================================
-- 3. Guards
-- =========================================================================
-- RLS decides who may write a row; these decide what may change. Modeled on
-- guard_city_staff_columns (migration_17, migration_20): the server's service
-- role passes the "use the dashboard" checks, because it has already checked
-- the caller and sanitized the HTML. Nobody, the service role included,
-- passes the "published is permanent" checks.

create or replace function public.guard_document_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'Version % of % is published and cannot be deleted. Corrections are made by publishing a new version.',
        old.version, old.document_number;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
    raise exception 'Version % of % is published and cannot be changed. Upload a new version as a correction.',
      old.version, old.document_number;
  end if;

  if not public.is_service_role() then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' or new.body_html is not null or new.public_pdf_path is not null
         or new.upload_pdf_path is not null or new.upload_html_path is not null then
        raise exception 'Upload documents through the Documents tab of the staff dashboard, so the PDF is checked and the HTML is sanitized.';
      end if;
    else
      if new.status is distinct from old.status
         or new.body_html is distinct from old.body_html
         or new.public_pdf_path is distinct from old.public_pdf_path
         or new.upload_pdf_path is distinct from old.upload_pdf_path
         or new.upload_html_path is distinct from old.upload_html_path
         or new.version is distinct from old.version
         or new.document_id is distinct from old.document_id then
        raise exception 'Files, versions and publishing go through the Documents tab of the staff dashboard.';
      end if;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists document_versions_guard on public.document_versions;
create trigger document_versions_guard
  before insert or update or delete on public.document_versions
  for each row execute function public.guard_document_versions();

create or replace function public.guard_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ok boolean;
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception '% has been published and cannot be deleted.', old.document_number;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'published' and new.status <> 'published' then
      raise exception '% has been published and cannot be unpublished.', old.document_number;
    end if;
    if new.doc_type is distinct from old.doc_type
       or new.meeting_date is distinct from old.meeting_date
       or new.language is distinct from old.language then
      raise exception 'A document''s type, meeting date and language are fixed once it exists. Discard the draft and start again.';
    end if;
  end if;

  if not public.is_service_role() then
    if tg_op = 'INSERT' and (new.status <> 'draft' or new.current_version_id is not null) then
      raise exception 'Publishing goes through the Documents tab of the staff dashboard.';
    end if;
    if tg_op = 'UPDATE' then
      if new.status is distinct from old.status
         or new.current_version_id is distinct from old.current_version_id then
        raise exception 'Publishing goes through the Documents tab of the staff dashboard.';
      end if;
      -- The public metadata of a published document only changes by
      -- publishing a new version, so there is always a version on record
      -- for what readers saw.
      if old.status = 'published' and (
           new.title is distinct from old.title
           or new.summary is distinct from old.summary
           or new.document_number is distinct from old.document_number
           or new.item_numbers is distinct from old.item_numbers
           or new.keywords is distinct from old.keywords
           or new.page_count is distinct from old.page_count) then
        raise exception '% is published. Change it by uploading a new version.', old.document_number;
      end if;
    end if;
  end if;

  -- Whoever is writing, the current version must be a published version of
  -- this same document.
  if new.current_version_id is not null then
    select exists (
      select 1 from public.document_versions v
       where v.id = new.current_version_id and v.document_id = new.id and v.status = 'published'
    ) into v_ok;
    if not v_ok then
      raise exception 'current_version_id must point to a published version of this document.';
    end if;
  end if;
  if new.status = 'published' and new.current_version_id is null then
    raise exception 'A published document needs a current version.';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists documents_guard on public.documents;
create trigger documents_guard
  before insert or update or delete on public.documents
  for each row execute function public.guard_documents();

-- =========================================================================
-- 4. Storage
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('document-uploads', 'document-uploads', false, 31457280,
        array['application/pdf', 'text/html'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', true, 31457280, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Staff upload into their own folder under uploads/ and can read the bucket
-- for previews. No update or delete policy: a staged file is never
-- overwritten in place, and clean-up of discarded drafts is the server's.
drop policy if exists "Staff can upload document files" on storage.objects;
create policy "Staff can upload document files"
  on storage.objects for insert
  with check (
    bucket_id = 'document-uploads'
    and public.is_active_staff()
    and (storage.foldername(name))[1] = 'uploads'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Staff can read document files" on storage.objects;
create policy "Staff can read document files"
  on storage.objects for select
  using (bucket_id = 'document-uploads' and public.is_active_staff());

-- The public bucket needs no policies: public buckets serve their files at
-- /object/public/ without one, and with no insert/update/delete policy only
-- the service role can write to it.

-- =========================================================================
-- 5. Meeting schedule
-- =========================================================================
-- The dates of upcoming Board meetings, from the county's published
-- calendar. Before this, "the next meeting" was read from the tracker's
-- meetings table, which only knew about a meeting once someone wrote it up,
-- and the tracker no longer gets new entries. The homepage next-meeting line,
-- the district panel and the upcoming list on /documents read this instead.
-- Staff keep it up to date from the Schedule tab of the dashboard.
create table if not exists public.meeting_schedule (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  start_time time,
  meeting_type text not null default 'Regular Meeting' check (char_length(meeting_type) between 3 and 80),
  location text check (location is null or char_length(location) <= 200),
  note text check (note is null or char_length(note) <= 300),
  cancelled boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_schedule_one_per_date_and_type unique (meeting_date, meeting_type)
);

comment on table public.meeting_schedule is
  'Upcoming BCC meeting dates from the county calendar. Public read, staff write. Independent of the meetings (tracker) table. See migration_27.';

create index if not exists meeting_schedule_date_idx on public.meeting_schedule (meeting_date);

alter table public.meeting_schedule enable row level security;

drop policy if exists "Public can read the meeting schedule" on public.meeting_schedule;
create policy "Public can read the meeting schedule"
  on public.meeting_schedule for select
  using (true);

drop policy if exists "Staff can manage the meeting schedule" on public.meeting_schedule;
create policy "Staff can manage the meeting schedule"
  on public.meeting_schedule for all
  using (public.is_active_staff())
  with check (public.is_active_staff());

revoke select on public.meeting_schedule from anon;
grant select (id, meeting_date, start_time, meeting_type, location, note, cancelled, updated_at)
  on public.meeting_schedule to anon;
revoke insert, update, delete on public.meeting_schedule from anon;

create or replace function public.touch_meeting_schedule()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists meeting_schedule_touch on public.meeting_schedule;
create trigger meeting_schedule_touch
  before update on public.meeting_schedule
  for each row execute function public.touch_meeting_schedule();

-- The regular meetings the site already lists, from the county's 2026
-- Meeting Calendar (PDF). Add the rest of the calendar in the Schedule tab.
insert into public.meeting_schedule (meeting_date, start_time, meeting_type, location)
values
  ('2026-10-06', '09:30', 'Regular Meeting', 'Commission Chambers, Stephen P. Clark Government Center, 111 NW 1st Street, Miami'),
  ('2026-10-20', '09:30', 'Regular Meeting', 'Commission Chambers, Stephen P. Clark Government Center, 111 NW 1st Street, Miami'),
  ('2026-11-17', '09:30', 'Regular Meeting', 'Commission Chambers, Stephen P. Clark Government Center, 111 NW 1st Street, Miami')
on conflict (meeting_date, meeting_type) do nothing;

-- =========================================================================
-- After running this file
-- =========================================================================
-- 1. Deploy the code (the build now reads documents and the schedule).
-- 2. In the staff dashboard, Schedule tab: add the rest of the county's
--    meeting calendar.
-- 3. Documents tab: upload the PDF and HTML, preview the draft, then
--    Publish. Publishing starts a site rebuild, and subscribers are emailed
--    once the document's page is live.
--
-- Verify:
select id, public, file_size_limit from storage.buckets where id in ('document-uploads', 'documents');
select count(*) as documents from public.documents;
select meeting_date, start_time, meeting_type from public.meeting_schedule order by meeting_date;
