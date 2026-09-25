#!/usr/bin/env node
// Build step for miamidadecommissionwatch.com.
//
// The site is hand-written static HTML with no framework. This script does the
// one thing the static files cannot do for themselves: it reads the published
// content out of Supabase and writes it into the HTML, so a crawler that never
// runs JavaScript still sees the meeting summaries, the editorials and the
// municipality registry.
//
// What it produces:
//   meetings/<date>.html   one indexable page per meeting
//   meetings.html          tracker list, prerendered
//   news.html              approved editorials, prerendered
//   municipalities.html    city registry, prerendered
//   about.html             the team roster, prerendered
//   sitemap.xml            every indexable URL, with real lastmod values
//   <every public page>    Organization / WebSite / page-level JSON-LD
//
// It is idempotent: everything it writes lives between <!-- build:name -->
// markers, so running it twice produces the same bytes. It fails hard rather
// than writing a page with content missing -- a failed build leaves the last
// good deployment serving, which is the outcome you want.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT, fetchMeetings, fetchEditorials, fetchCities, loadPublicByline, loadContributors } from './lib/data.mjs';
import { SITE_ORIGIN, formatDate, formatDateShort, isoDay, clip, escapeHtml } from './lib/fmt.mjs';
import {
  assignMeetingPaths, meetingTouchedAt, renderMeetingList, renderItems,
  renderEditorials, renderMunicipalities, renderTeam, makeCounter
} from './lib/render.mjs';
import { setHead, setJsonLd, upsertRegion, rewriteToRootRelative, splitShell } from './lib/page.mjs';
import { fetchXPosts, renderXFeed, HANDLE as xHandle } from './lib/x-feed.mjs';
import * as schema from './lib/schema.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

// Sitemaps are capped at 50,000 URLs by the protocol. Split below that with
// room to spare rather than at the limit.
const MAX_URLS_PER_SITEMAP = 45000;

const written = [];
function write(relPath, contents) {
  written.push(relPath);
  if (DRY_RUN) return;
  writeFileSync(join(ROOT, relPath), contents);
}
function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------
// Which pages are public
// ---------------------------------------------------------------------

// Derived from the files rather than a hand-kept list: a page counts as
// indexable unless it says otherwise in its own robots meta. Adding a new page
// therefore puts it in the sitemap automatically, and adding noindex to one
// takes it out, with no second place to remember.
function publicPages() {
  const out = [];
  for (const file of readdirSync(ROOT).sort()) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(join(ROOT, file), 'utf8');
    const robots = /<meta name="robots" content="([^"]*)"/i.exec(html);
    if (robots && /noindex/i.test(robots[1])) continue;
    // home.html is served at / by the rewrite in vercel.json; / is its canonical.
    const urlPath = file === 'home.html' ? '/' : `/${file}`;
    out.push({ file, urlPath, url: SITE_ORIGIN + urlPath });
  }
  return out;
}

// The page's own <title> and description, so the JSON-LD name/description
// cannot drift from the tags a searcher actually sees. One source of truth,
// and it is the markup.
function headMeta(html) {
  const t = /<title>([\s\S]*?)<\/title>/.exec(html);
  const d = /<meta name="description" content="([\s\S]*?)">/.exec(html);
  const decode = (s) => String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return { title: decode(t && t[1]), description: decode(d && d[1]) };
}

// ---------------------------------------------------------------------
// lastmod
// ---------------------------------------------------------------------

// Git commit date is the honest answer for a hand-edited file. Vercel builds
// from a clone that may be shallow, so a miss falls back to mtime rather than
// failing or inventing today's date for everything.
function lastModifiedFromGit(relPath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return isoDay(out);
  } catch {
    return null;
  }
}

function lastModified(relPath) {
  return lastModifiedFromGit(relPath)
    || isoDay(new Date(statSync(join(ROOT, relPath)).mtime).toISOString());
}

// ---------------------------------------------------------------------
// Per-meeting pages
// ---------------------------------------------------------------------

function meetingTitle(meeting) {
  return `${clip(meeting.title, 70)} - Miami-Dade Commission, ${formatDate(meeting.meeting_date)}`;
}

function meetingDescription(meeting) {
  return clip(meeting.summary || meeting.title, 155);
}

function meetingBody(meeting, { older, newer }) {
  const counter = makeCounter();
  const esc = escapeHtml;

  const navLinks = [];
  if (newer) {
    navLinks.push(`<a class="meeting-nav-link" href="${esc(newer.__path)}">` +
      `<span class="meeting-nav-dir">&#8592; Newer meeting</span>` +
      `<span class="meeting-nav-title">${esc(formatDateShort(newer.meeting_date))}: ${esc(clip(newer.title, 60))}</span></a>`);
  }
  if (older) {
    navLinks.push(`<a class="meeting-nav-link" href="${esc(older.__path)}">` +
      `<span class="meeting-nav-dir">Older meeting &#8594;</span>` +
      `<span class="meeting-nav-title">${esc(formatDateShort(older.meeting_date))}: ${esc(clip(older.title, 60))}</span></a>`);
  }

  return `
  <section class="section">
    <div class="wrap">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span class="breadcrumb-sep" aria-hidden="true">&rsaquo;</span>
        <a href="/meetings.html">Meeting Tracker</a>
        <span class="breadcrumb-sep" aria-hidden="true">&rsaquo;</span>
        <span aria-current="page">${esc(formatDateShort(meeting.meeting_date))}</span>
      </nav>

      <span class="eyebrow">${esc(meeting.meeting_type)} &middot; ${esc(formatDate(meeting.meeting_date))}</span>
      <h1 style="max-width:24ch;">${esc(meeting.title)}</h1>
      <p class="lede">${esc(meeting.summary)}</p>

      <div id="tracker-body">
${renderItems(meeting, counter)}
      </div>

      ${navLinks.length ? `<nav class="meeting-nav" aria-label="Nearby meetings">${navLinks.join('')}</nav>` : ''}

      <p class="meeting-back"><a href="/meetings.html">All meeting summaries &#8594;</a></p>
    </div>
  </section>
`;
}

function buildMeetingPage(shellSource, meeting, neighbours) {
  const shell = splitShell(shellSource);
  let html = shell.head + shell.mainOpenTag + meetingBody(meeting, neighbours) + '</main>' + shell.tail;

  // The shell comes from meetings.html at the repo root, whose asset links are
  // relative. This page lives one directory down.
  html = rewriteToRootRelative(html);

  html = setHead(html, {
    title: meetingTitle(meeting),
    description: meetingDescription(meeting),
    canonical: meeting.__url,
    ogType: 'article'
  });

  const touched = meetingTouchedAt(meeting);
  html = setJsonLd(html, 'jsonld', [
    schema.organization(),
    schema.website(),
    schema.meetingArticle(meeting, {
      published: meeting.created_at || null,
      modified: touched
    }),
    schema.breadcrumbs([
      { name: 'Home', url: `${SITE_ORIGIN}/` },
      { name: 'Meeting Tracker', url: `${SITE_ORIGIN}/meetings.html` },
      { name: formatDateShort(meeting.meeting_date), url: meeting.__url }
    ])
  ]);

  return html;
}

// ---------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------

function urlNode({ url, lastmod }) {
  return '  <url>\n' +
    `    <loc>${escapeHtml(url)}</loc>\n` +
    (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
    '  </url>';
}

function sitemapDoc(entries) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(urlNode).join('\n') + '\n' +
    '</urlset>\n';
}

function sitemapIndexDoc(files) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    files.map((f) => '  <sitemap>\n' +
      `    <loc>${SITE_ORIGIN}/${f.name}</loc>\n` +
      (f.lastmod ? `    <lastmod>${f.lastmod}</lastmod>\n` : '') +
      '  </sitemap>').join('\n') + '\n' +
    '</sitemapindex>\n';
}

function writeSitemap(entries) {
  if (entries.length <= MAX_URLS_PER_SITEMAP) {
    write('sitemap.xml', sitemapDoc(entries));
    return { files: 1, urls: entries.length };
  }

  // Over the protocol's 50,000-URL cap: shard, and turn sitemap.xml itself
  // into the index. The URL in robots.txt does not change either way.
  const chunks = [];
  for (let i = 0; i < entries.length; i += MAX_URLS_PER_SITEMAP) {
    chunks.push(entries.slice(i, i + MAX_URLS_PER_SITEMAP));
  }
  const files = chunks.map((chunk, i) => {
    const name = `sitemap-${i + 1}.xml`;
    write(name, sitemapDoc(chunk));
    const stamps = chunk.map((e) => e.lastmod).filter(Boolean).sort();
    return { name, lastmod: stamps.length ? stamps[stamps.length - 1] : null };
  });
  write('sitemap.xml', sitemapIndexDoc(files));
  return { files: files.length + 1, urls: entries.length };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  console.log(DRY_RUN ? '· dry run: nothing will be written\n' : '');

  const [rawMeetings, editorials, cities] = await Promise.all([
    fetchMeetings(), fetchEditorials(), fetchCities()
  ]);
  const publicByline = loadPublicByline();
  const teams = loadContributors();
  const meetings = assignMeetingPaths(rawMeetings);

  console.log(`fetched  ${meetings.length} meetings, ${editorials.length} editorials, ${cities.length} cities`);

  if (!meetings.length) throw new Error('Supabase returned zero meetings; refusing to publish an empty tracker.');
  if (!cities.length) throw new Error('Supabase returned zero cities; refusing to publish an empty registry.');

  // --- per-meeting pages, from meetings.html as the shell -----------------
  const shellSource = read('meetings.html');
  if (!DRY_RUN) mkdirSync(join(ROOT, 'meetings'), { recursive: true });

  meetings.forEach((meeting, i) => {
    const page = buildMeetingPage(shellSource, meeting, {
      newer: meetings[i - 1] || null,
      older: meetings[i + 1] || null
    });
    write(`meetings/${meeting.__slug}.html`, page);
  });
  console.log(`wrote    ${meetings.length} meeting pages`);

  // --- meetings.html -------------------------------------------------------
  {
    let html = shellSource;
    html = upsertRegion(html, 'meetings', renderMeetingList(meetings), '</main>');
    html = setJsonLd(html, 'jsonld', [
      schema.organization(),
      schema.website(),
      schema.collectionPage({
        url: `${SITE_ORIGIN}/meetings.html`,
        name: headMeta(html).title,
        description: headMeta(html).description,
        items: meetings.map((m) => ({ name: m.title, url: m.__url }))
      }),
      schema.breadcrumbs([
        { name: 'Home', url: `${SITE_ORIGIN}/` },
        { name: 'Meeting Tracker', url: `${SITE_ORIGIN}/meetings.html` }
      ])
    ]);
    write('meetings.html', html);
  }

  // --- news.html -----------------------------------------------------------
  {
    let html = read('news.html');
    html = upsertRegion(html, 'editorials', renderEditorials(editorials, publicByline), '</main>');
    html = setJsonLd(html, 'jsonld', [
      schema.organization(),
      schema.website(),
      schema.collectionPage({
        url: `${SITE_ORIGIN}/news.html`,
        name: headMeta(html).title,
        description: headMeta(html).description,
        // Titles only. The byline is already reduced to "First L." and the
        // editorials themselves stay on the page rather than in the markup.
        items: editorials.map((e) => ({ name: e.title, url: `${SITE_ORIGIN}/news.html` }))
      })
    ]);
    write('news.html', html);
  }

  // --- municipalities.html -------------------------------------------------
  {
    let html = read('municipalities.html');
    const registry = renderMunicipalities(cities);
    html = upsertRegion(html, 'municipalities-covered', registry.covered, '</main>');
    html = upsertRegion(html, 'municipalities-count', registry.count, '</main>');
    html = upsertRegion(html, 'municipalities-open', registry.open, '</main>');
    html = setJsonLd(html, 'jsonld', [
      schema.organization(),
      schema.website(),
      schema.collectionPage({
        url: `${SITE_ORIGIN}/municipalities.html`,
        name: headMeta(html).title,
        description: headMeta(html).description,
        items: cities.map((c) => ({
          name: c.name,
          url: c.status === 'active'
            ? `https://${c.slug}.miamidadecommissionwatch.com/`
            : `${SITE_ORIGIN}/municipalities.html`
        }))
      })
    ]);
    write('municipalities.html', html);
  }

  // --- about.html ----------------------------------------------------------
  {
    let html = read('about.html');
    html = upsertRegion(html, 'team', renderTeam(teams, publicByline), '</main>');
    html = setJsonLd(html, 'jsonld', [schema.organization(), schema.website()]);
    write('about.html', html);
  }

  // --- home.html -----------------------------------------------------------
  {
    let html = read('home.html');
    const feed = await fetchXPosts();
    if (feed.posts.length) {
      console.log(`x feed   ${feed.posts.length} post(s) from @${xHandle}`);
    } else {
      console.log(`x feed   follow card (${feed.reason})`);
    }
    html = upsertRegion(html, 'xfeed', renderXFeed(feed.posts), '</aside>');
    html = setJsonLd(html, 'jsonld', [schema.organization(), schema.website()]);
    write('home.html', html);
  }

  // --- Organization JSON-LD on every remaining public page -----------------
  const handled = new Set(['meetings.html', 'news.html', 'municipalities.html', 'about.html', 'home.html']);
  const pages = publicPages();
  let plainCount = 0;

  for (const page of pages) {
    if (handled.has(page.file)) continue;
    let html = read(page.file);
    html = setJsonLd(html, 'jsonld', [schema.organization(), schema.website()]);
    write(page.file, html);
    plainCount++;
  }
  console.log(`stamped  Organization + WebSite JSON-LD on ${plainCount + handled.size} public pages`);

  // --- sitemap -------------------------------------------------------------
  const entries = [
    ...pages.map((p) => ({ url: p.url, lastmod: lastModified(p.file) })),
    ...meetings.map((m) => ({ url: m.__url, lastmod: isoDay(meetingTouchedAt(m)) }))
  ];
  const result = writeSitemap(entries);
  console.log(`sitemap  ${result.urls} URLs across ${result.files} file(s)`);

  console.log(`\ndone in ${Date.now() - t0}ms, ${written.length} files ${DRY_RUN ? 'would be ' : ''}written`);
}

main().catch((err) => {
  console.error('\nBUILD FAILED\n');
  console.error(err.stack || err.message);
  process.exit(1);
});
