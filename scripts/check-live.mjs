// Is the live site showing everything the database says is public?
//
// The site is a prerender: nothing in Supabase reaches a reader until a
// deploy runs scripts/build.mjs. Two things start that deploy on purpose (a
// push to main, and api/publish-site from the staff dashboard) and both can
// be missed. On 2026-09-17 an editorial was approved in the dashboard and
// sat in the database for a day because the rebuild never ran; the button
// only set the status. A database trigger now rebuilds after any move into
// or out of 'approved' (supabase/migration_24 and the rebuild-site Edge
// Function), but a secret can be missing or Vercel can refuse the hook, so
// that is one safeguard, not proof.
//
// This is the proof. It asks the database what is approved and published,
// asks the live site what it is actually serving, and if the two disagree
// it posts to the Vercel deploy hook so the next build closes the gap. It
// runs on a schedule from .github/workflows/check-live.yml and can be run
// by hand:
//
//   VERCEL_DEPLOY_HOOK_URL=... node scripts/check-live.mjs
//
// Without the hook URL it still reports drift, it just cannot repair it,
// and exits non-zero so the run shows as failed.
//
// It also checks the document library: every published document has its
// page, and every PDF link on that page is on our own domain
// (/documents/files/..., the rewrite in vercel.json) and really serves a
// PDF. To run that against a preview deployment instead of the live site:
//
//   CHECK_SITE=https://<preview>.vercel.app node scripts/check-live.mjs
//
// If the preview is behind Vercel Deployment Protection, also set
// VERCEL_PROTECTION_BYPASS to the project's "Protection Bypass for
// Automation" secret. A preview run never triggers a rebuild.
//
// It reads with the same anon key the build uses, so it can only see what a
// visitor can see, and it matches the page the way the build wrote it: the
// editorial card ids come from makeEditorialSlugger() and the meeting paths
// from assignMeetingPaths(), the very functions that produced the HTML.

import { fetchEditorials, fetchMeetings, fetchDocuments } from './lib/data.mjs';
import { makeEditorialSlugger, assignMeetingPaths } from './lib/render.mjs';
import { TRACKER_ARCHIVE_THROUGH, pageDocuments, documentPath } from './lib/documents.mjs';

const PRODUCTION = 'https://www.miamidadecommissionwatch.com';
const SITE = (process.env.CHECK_SITE || PRODUCTION).replace(/\/$/, '');
const IS_PREVIEW = SITE !== PRODUCTION;
const HOOK_URL = IS_PREVIEW ? '' : (process.env.VERCEL_DEPLOY_HOOK_URL || '');
const BYPASS = process.env.VERCEL_PROTECTION_BYPASS || '';

function requestHeaders() {
  const h = { 'Cache-Control': 'no-cache' };
  if (BYPASS) h['x-vercel-protection-bypass'] = BYPASS;
  return h;
}

async function livePage(path) {
  const res = await fetch(SITE + path, { headers: requestHeaders() });
  if (!res.ok) throw new Error(`${SITE}${path} answered HTTP ${res.status}`);
  return res.text();
}

function setDiff(expected, actual) {
  return {
    missing: [...expected].filter((x) => !actual.has(x)),
    stale: [...actual].filter((x) => !expected.has(x))
  };
}

// Approved editorials, as the cards on /news.html. The build renders them in
// submitted_at desc order and the slugger's collision counter depends on that
// order, so fetchEditorials() (which orders the same way) is used as-is.
async function checkEditorials() {
  const rows = await fetchEditorials();
  const slugify = makeEditorialSlugger();
  const expected = new Set(rows.map((r) => slugify(r.title)));

  const html = await livePage('/news.html');
  const actual = new Set();
  const re = /<div class="meeting-card editorial-card" id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) actual.add(m[1]);

  return { what: 'editorials on /news.html', ...setDiff(expected, actual) };
}

// Published meetings, as the per-meeting links on /meetings.html.
async function checkMeetings() {
  const meetings = assignMeetingPaths((await fetchMeetings())
    .filter((mtg) => String(mtg.meeting_date) <= TRACKER_ARCHIVE_THROUGH));
  const expected = new Set(meetings.map((mtg) => mtg.__path));

  const html = await livePage('/meetings.html');
  const actual = new Set();
  const re = /href="(\/meetings\/[^"]+\.html)"/g;
  let m;
  while ((m = re.exec(html))) actual.add(m[1]);

  return { what: 'meetings on /meetings.html', ...setDiff(expected, actual) };
}

// Published documents: the page exists, and its PDF links point at our own
// domain and answer with a PDF. A missing page is drift (a rebuild fixes
// it); a broken or off-domain PDF link is a fault a rebuild will not fix,
// so it is reported in `faults` and fails the run.
async function checkDocuments() {
  const docs = pageDocuments(await fetchDocuments());
  const expected = new Set(docs.map(documentPath));
  const actual = new Set();
  const faults = [];
  for (const doc of docs) {
    const path = documentPath(doc);
    let html;
    try {
      html = await livePage(path);
    } catch {
      continue; // missing: reported as drift below
    }
    if (html.includes(doc.document_number)) actual.add(path);
    if (/supabase\.co\/storage/.test(html)) faults.push(`${path}: page links to a Supabase storage address`);
    const pdfs = [...html.matchAll(/href="([^"]+\.pdf)"/g)].map((m) => m[1]);
    if (!pdfs.length) faults.push(`${path}: no PDF link on the page`);
    for (const href of new Set(pdfs)) {
      if (!href.startsWith('/documents/files/')) {
        faults.push(`${path}: PDF link is not on our domain: ${href}`);
        continue;
      }
      const res = await fetch(SITE + href, { headers: requestHeaders() });
      const type = res.headers.get('content-type') || '';
      const head = Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString();
      if (!res.ok || head !== '%PDF-') faults.push(`${href}: HTTP ${res.status}, ${type || 'no content type'}, not a PDF`);
      else console.log(`pdf ok   ${href} (${type})`);
    }
  }
  return { what: 'documents', ...setDiff(expected, actual), faults };
}

async function triggerBuild() {
  if (!HOOK_URL) {
    console.error('VERCEL_DEPLOY_HOOK_URL is not set, so the site cannot be rebuilt from here.');
    return false;
  }
  if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\//.test(HOOK_URL)) {
    console.error('VERCEL_DEPLOY_HOOK_URL is not a Vercel deploy hook URL.');
    return false;
  }
  const res = await fetch(HOOK_URL, { method: 'POST' });
  if (!res.ok) {
    console.error(`Vercel refused the build request (HTTP ${res.status}).`);
    return false;
  }
  console.log('Rebuild requested. The site updates in about a minute.');
  return true;
}

const results = [];
for (const check of [checkEditorials, checkMeetings, checkDocuments]) {
  try {
    results.push(await check());
  } catch (err) {
    console.error(`${check.name} could not run: ${err.message}`);
    process.exit(1);
  }
}

let drift = false;
let faulty = false;
for (const r of results) {
  for (const f of r.faults || []) {
    faulty = true;
    console.log(`${r.what}: ${f}`);
  }
  const problems = r.missing.length + r.stale.length;
  if (!problems) {
    console.log(`${r.what}: in sync`);
    continue;
  }
  drift = true;
  for (const id of r.missing) console.log(`${r.what}: public in the database but not on the site: ${id}`);
  for (const id of r.stale) console.log(`${r.what}: on the site but no longer public in the database: ${id}`);
}

if (!drift) process.exit(faulty ? 1 : 0);
if (IS_PREVIEW) {
  console.log(`Drift on a preview (${SITE}): not rebuilding from here.`);
  process.exit(1);
}
process.exit((await triggerBuild()) && !faulty ? 0 : 1);
