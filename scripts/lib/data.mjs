// Everything the build reads out of Supabase.
//
// This uses the same publishable anon key the browser uses (it is already in
// js/supabase-client.js and is safe to expose -- RLS is what protects the
// data). That is deliberate: the build must only ever be able to see what an
// anonymous visitor can see, so prerendered HTML can never contain a row the
// public API would have withheld. Serving crawlers content that visitors
// cannot get is cloaking, and borrowing the service role here would make that
// easy to do by accident.

import { readFileSync } from 'node:fs';
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
const SUPABASE_URL = process.env.SUPABASE_PUBLIC_URL || creds.url;
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

export async function fetchMeetings() {
  const rows = await rest(
    `meetings?select=${encodeURIComponent(MEETINGS_SELECT)}` +
    '&order=meeting_date.desc' +
    '&order=meeting_items(sort_order).asc'
  );
  for (const m of rows) {
    m.meeting_items = (m.meeting_items || []).slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }
  return rows;
}

// Columns match js/editorials-feed.js exactly. Grade, school and school email
// are never requested: submitters are minors and none of it is public.
export async function fetchEditorials() {
  return rest(
    'editorial_submissions?select=name,title,body,submitted_at' +
    '&status=eq.approved&order=submitted_at.desc'
  );
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
