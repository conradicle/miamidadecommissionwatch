-- Remove one document and all its versions, published or not.
--
-- NOT a migration. Published documents are permanent by design (the guard
-- triggers in migration_27 refuse to edit or delete them), because a
-- correction must leave the earlier text on record. This script is the one
-- deliberate exception, for a document that should never have existed: a
-- test upload made while trying out the dashboard, or a file published under
-- the wrong meeting. It switches the guards off for this transaction only.
--
-- A wrong fact in a real document is NOT a reason to run this. Publish a
-- corrected version instead.
--
-- How to use, in the Supabase SQL editor:
--   1. Put the document number in the line marked CHANGE ME.
--   2. Run it. It prints what it removed.
--   3. Delete the PDFs from Storage by hand: bucket "documents", folder
--      <type>/<meeting date>/<language>/, and bucket "document-uploads",
--      folders uploads/<staff user id>/ and sanitized/<document id>/.
--   4. Rebuild the site (Publish to site on the dashboard's Tracker archive
--      tab) so the page comes down.

begin;

alter table public.document_versions disable trigger document_versions_guard;
alter table public.documents disable trigger documents_guard;

do $do$
declare
  v_number constant text := 'MDCW-AS-2026-1020';  -- CHANGE ME
  v_doc record;
  v_versions integer;
begin
  for v_doc in select id, doc_type, meeting_date, language from public.documents where document_number = v_number loop
    update public.documents set current_version_id = null where id = v_doc.id;
    delete from public.document_versions where document_id = v_doc.id;
    get diagnostics v_versions = row_count;
    delete from public.documents where id = v_doc.id;
    raise notice 'Removed % (% %, %) with % version(s). Storage folder: documents/%/%/%/',
      v_number, v_doc.doc_type, v_doc.meeting_date, v_doc.language, v_versions,
      v_doc.doc_type, v_doc.meeting_date, v_doc.language;
  end loop;
  if not found then
    raise notice 'No document numbered % was found. Nothing removed.', v_number;
  end if;
end
$do$;

-- documents.current_version_id is a deferred foreign key; check it now, or
-- re-enabling the triggers fails on the pending check.
set constraints all immediate;

alter table public.documents enable trigger documents_guard;
alter table public.document_versions enable trigger document_versions_guard;

commit;
