// Everything the build reads out of Supabase.
//
// This uses the same publishable anon key the browser uses (it is already in
// js/supabase-client.js and is safe to expose -- RLS is what protects the
// data). That is deliberate: the build must only ever be able to see what an
// anonymous visitor can see, so prerendered HTML can never contain a row the
// public API would have withheld. Serving crawlers content that visitors
// cannot get is cloaking, and borrowing the service role here would make that
// easy to do by accident.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

// Read the URL and key out of the browser client so there is one source of
// truth. Env vars win, for pointing a build at a different project.
function readBrowserCredentials() {
  const src = readFileSync(join(ROOT, 'js', 'supabase-client.js'), 'utf8');
  const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(src);
  const key = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(src);
  if (!url || !key) {
    throw new Error('Could not parse SUPABASE_URL / SUPABASE_ANON_KEY out of js/supabase-client.js');
  }
  return { url: url[1], key: key[1] };
}

const creds = readBrowserCredentials();
export const SUPABASE_URL = process.env.SUPABASE_PUBLIC_URL || creds.url;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || creds.key;

async function rest(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json'
    }
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} on ${path}\n${body.slice(0, 500)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Supabase returned non-JSON on ${path}: ${body.slice(0, 200)}`);
  }
}

// Mirrors RICH_SELECT in js/meetings-feed.js. No BASIC_SELECT fallback here:
// if the rich schema is missing the build should fail loudly rather than
// quietly ship pages with the sources and roll call silently dropped.
const MEETINGS_SELECT =
  '*,meeting_items(*,item_sources(*),item_votes(vote,commissioners(slug,full_name,district)))';

// published=is.true is not optional and has no fallback. If the column is
// missing the build must fail: a fallback that dropped the filter would
// publish every draft in the table, which is the exact failure the column
// exists to prevent. A failed build leaves the last good deployment serving,
// so the cost of stopping is that the site does not update -- not that it
// updates wrongly.
export async function fetchMeetings() {
  let rows;
  try {
    rows = await rest(
      `meetings?select=${encodeURIComponent(MEETINGS_SELECT)}` +
      '&published=is.true' +
      '&order=meeting_date.desc' +
      '&order=meeting_items(sort_order).asc'
    );
  } catch (err) {
    if (/published/.test(err.message) && /(does not exist|42703)/.test(err.message)) {
      throw new Error(
        'meetings.published is missing from the database.\n' +
        'Apply supabase/migration_22_meeting_draft_state.sql in the Supabase SQL editor, then deploy again.\n' +
        'Original error: ' + err.message
      );
    }
    throw err;
  }
  for (const m of rows) {
    m.meeting_items = (m.meeting_items || []).slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }
  return rows;
}

// Columns match js/editorials-feed.js exactly. Submitters are minors: the view
// (supabase/migration_28) returns approved rows only, with the byline already
// reduced to "First L." by the database. The full name is not readable here.
export async function fetchEditorials() {
  return rest(
    'published_editorials?select=byline,title,body,submitted_at' +
    '&order=submitted_at.desc'
  );
}

// Published documents (Meeting Summaries, Agenda Summaries) with every
// published version, newest first. No fallback when the table is missing,
// for the reason fetchMeetings gives: a build that quietly skipped them would
// publish a site with the document library empty. Zero rows is fine -- that
// is simply a library nobody has published to yet.
//
// The version list leaves out body_html: a 60-page document is a few hundred
// KB of HTML, and only the current version's is rendered. Those come in a
// second request.
const DOCUMENT_COLUMNS =
  'id,doc_type,meeting_date,language,translation_of,status,current_version_id,title,summary,' +
  'document_number,item_numbers,keywords,page_count,first_published_at,updated_at';
const VERSION_COLUMNS =
  'id,document_id,version,version_major,version_minor,status,title,summary,document_number,' +
  'item_numbers,keywords,issued_on,change_note,page_count,pdf_bytes,public_pdf_path,published_at';

export async function fetchDocuments() {
  let docs;
  try {
    docs = await rest(
      `documents?select=${encodeURIComponent(
        DOCUMENT_COLUMNS + ',document_versions!document_versions_document_id_fkey(' + VERSION_COLUMNS + ')'
      )}` +
      '&status=eq.published' +
      '&document_versions.status=eq.published' +
      '&order=meeting_date.desc'
    );
  } catch (err) {
    if (/documents/.test(err.message) && /(does not exist|42P01|PGRST20[05]|schema cache)/.test(err.message)) {
      throw new Error(
        'The documents table is missing from the database.\n' +
        'Apply supabase/migration_27_documents.sql in the Supabase SQL editor, then deploy again.\n' +
        'Original error: ' + err.message
      );
    }
    throw err;
  }

  const currentIds = docs.map((d) => d.current_version_id).filter(Boolean);
  const bodies = new Map();
  // In batches, to keep each URL well under PostgREST's length limit.
  for (let i = 0; i < currentIds.length; i += 40) {
    const ids = currentIds.slice(i, i + 40);
    const rows = await rest(`document_versions?select=id,body_html&id=in.(${ids.join(',')})`);
    for (const r of rows) bodies.set(r.id, r.body_html || '');
  }

  for (const d of docs) {
    d.versions = (d.document_versions || []).slice()
      .sort((a, b) => (b.version_major - a.version_major) || (b.version_minor - a.version_minor));
    delete d.document_versions;
    d.current = d.versions.find((v) => v.id === d.current_version_id) || d.versions[0] || null;
    if (d.current) d.current.body_html = bodies.get(d.current.id) || '';
  }
  return docs.filter((d) => d.current && d.current.body_html);
}

// Upcoming BCC meeting dates (migration_27). Same no-fallback rule as the
// documents: the homepage and /documents read this, so a missing table stops
// the build rather than shipping a site with no next meeting.
export async function fetchSchedule() {
  try {
    return await rest(
      'meeting_schedule?select=meeting_date,start_time,meeting_type,location,note,cancelled' +
      '&order=meeting_date.asc'
    );
  } catch (err) {
    if (/meeting_schedule/.test(err.message) && /(does not exist|42P01|PGRST20[05]|schema cache)/.test(err.message)) {
      throw new Error(
        'The meeting_schedule table is missing from the database.\n' +
        'Apply supabase/migration_27_documents.sql in the Supabase SQL editor, then deploy again.\n' +
        'Original error: ' + err.message
      );
    }
    throw err;
  }
}

// Published meeting photos (migration_34). published=is.true is required for
// the same reason as on meetings: drop it and every draft goes public. RLS
// already limits anon to published rows; the filter is the second lock.
//
// Unlike documents and the schedule, a MISSING table is not fatal: it means
// migration_34 has not been run yet, and an empty gallery cannot show
// anything it should not. Any other error (a bad column, an outage) still
// stops the build.
//
// PHOTOS_FIXTURE points a local build at a JSON file of rows shaped like the
// select below, so the gallery can be checked without touching the database.
// Vercel never sets it.
const PHOTO_COLUMNS = 'id,meeting_date,storage_path,width,height,alt_text,caption,credit,sort_order,is_featured,created_at';

export async function fetchPhotos() {
  if (process.env.PHOTOS_FIXTURE) {
    return JSON.parse(readFileSync(process.env.PHOTOS_FIXTURE, 'utf8'));
  }
  try {
    return await rest(
      `meeting_photos?select=${PHOTO_COLUMNS}` +
      '&published=is.true' +
      '&order=meeting_date.desc&order=sort_order.asc&order=created_at.asc'
    );
  } catch (err) {
    if (/meeting_photos/.test(err.message) && /(does not exist|42P01|PGRST20[05]|schema cache)/.test(err.message)) {
      console.warn('photos   meeting_photos table not found; building with no photos (run supabase/migration_34_meeting_photos.sql)');
      return [];
    }
    throw err;
  }
}

export async function fetchCities() {
  return rest('cities?select=slug,name,status,sort_order&order=sort_order.asc');
}

// Loads js/public-byline.js and hands back the real function rather than a
// second implementation. That file is the only copy of how a minor's name may
// appear in public, and it says so at the top; a paraphrase here is exactly
// the drift it warns about. It touches no DOM, so a bare window stands in.
export function loadPublicByline() {
  const src = readFileSync(join(ROOT, 'js', 'public-byline.js'), 'utf8');
  const scope = { window: {} };
  new Function('window', src)(scope.window);
  if (typeof scope.window.publicByline !== 'function') {
    throw new Error('js/public-byline.js did not define window.publicByline');
  }
  return scope.window.publicByline;
}

// Loads js/document-view.js, the renderer the staff preview page also runs,
// so a published page and its draft preview come from the same code.
export function loadDocumentView() {
  const src = readFileSync(join(ROOT, 'js', 'document-view.js'), 'utf8');
  const scope = {};
  new Function('window', src)(scope);
  if (!scope.MDCWDocument || typeof scope.MDCWDocument.renderDocumentMain !== 'function') {
    throw new Error('js/document-view.js did not define window.MDCWDocument');
  }
  return scope.MDCWDocument;
}

// The team roster. Unlike meetings and editorials this is a checked-in file,
// not a Supabase table: it is a dozen-odd people that change a few times a
// year, and every change wants a human look before it is public. Git already
// gives that review, the history and the rollback, so a table plus an admin
// screen plus an upload path would be machinery bought for nothing.
// Full carousel profiles. These are the one place a student's full name, school
// and grade are published, so each needs the date that student agreed to it.
export function loadTeamProfiles() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'assets', 'data', 'contributors.json'), 'utf8'));
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  for (const person of profiles) {
    for (const field of ['name', 'role', 'school', 'grade', 'photo', 'bio', 'quote']) {
      if (!person[field]) throw new Error(`contributors.json: profile ${person.name || '(unnamed)'} is missing ${field}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(person.consent || '')) {
      throw new Error(`contributors.json: profile ${person.name} has no consent date (YYYY-MM-DD)`);
    }
    if (!existsSync(join(ROOT, person.photo.split('?')[0]))) {
      throw new Error(`contributors.json: profile ${person.name} points at a missing photo, ${person.photo}`);
    }
  }
  return profiles;
}

export function loadContributors() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'assets', 'data', 'contributors.json'), 'utf8'));
  const teams = Array.isArray(raw.teams) ? raw.teams : [];
  for (const team of teams) {
    if (!team.id || !team.name) throw new Error('contributors.json: every team needs an id and a name');
    if (!Array.isArray(team.members)) throw new Error(`contributors.json: team ${team.id} has no members array`);
    if (team.size != null && team.size < team.members.length) {
      throw new Error(`contributors.json: team ${team.id} declares size ${team.size} but names ${team.members.length}`);
    }
    for (const member of team.members) {
      if (!member.name || !member.role) {
        throw new Error(`contributors.json: every member of ${team.id} needs a name and a role`);
      }
    }
  }
  return teams;
}
