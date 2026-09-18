// Is the live site showing everything the database says is public?
//
// The site is a prerender: nothing in Supabase reaches a reader until a
// deploy runs scripts/build.mjs. Two things start that deploy on purpose (a
// push to main, and api/publish-site from the staff dashboard) and both can
// be missed. On 2026-09-17 an editorial was approved in the dashboard and
// sat in the database for a day because the rebuild never ran; the button
// only set the status. js/admin.js now rebuilds on its own after an
// approval, but a session can expire, a request can fail, and a row can be
// edited straight in Supabase, so that is one safeguard, not proof.
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
// It reads with the same anon key the build uses, so it can only see what a
// visitor can see, and it matches the page the way the build wrote it: the
// editorial card ids come from makeEditorialSlugger() and the meeting paths
// from assignMeetingPaths(), the very functions that produced the HTML.

import { fetchEditorials, fetchMeetings } from './lib/data.mjs';
import { makeEditorialSlugger, assignMeetingPaths } from './lib/render.mjs';

const SITE = 'https://www.miamidadecommissionwatch.com';
const HOOK_URL = process.env.VERCEL_DEPLOY_HOOK_URL || '';

async function livePage(path) {
  const res = await fetch(SITE + path, { headers: { 'Cache-Control': 'no-cache' } });
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
  const meetings = assignMeetingPaths(await fetchMeetings());
  const expected = new Set(meetings.map((mtg) => mtg.__path));

  const html = await livePage('/meetings.html');
  const actual = new Set();
  const re = /href="(\/meetings\/[^"]+\.html)"/g;
  let m;
  while ((m = re.exec(html))) actual.add(m[1]);

  return { what: 'meetings on /meetings.html', ...setDiff(expected, actual) };
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
for (const check of [checkEditorials, checkMeetings]) {
  try {
    results.push(await check());
  } catch (err) {
    console.error(`${check.name} could not run: ${err.message}`);
    process.exit(1);
  }
}

let drift = false;
for (const r of results) {
  const problems = r.missing.length + r.stale.length;
  if (!problems) {
    console.log(`${r.what}: in sync`);
    continue;
  }
  drift = true;
  for (const id of r.missing) console.log(`${r.what}: public in the database but not on the site: ${id}`);
  for (const id of r.stale) console.log(`${r.what}: on the site but no longer public in the database: ${id}`);
}

if (!drift) process.exit(0);
process.exit((await triggerBuild()) ? 0 : 1);
