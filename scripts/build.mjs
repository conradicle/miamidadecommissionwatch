#!/usr/bin/env node
// Build step for miamidadecommissionwatch.com.
//
// The site is hand-written static HTML with no framework. This script does the
// one thing the static files cannot do for themselves: it reads the published
// content out of Supabase and writes it into the HTML, so a crawler that never
// runs JavaScript still sees the meeting summaries, the editorials and the
// municipality registry.
//
// Everything Vercel serves comes out of dist/. The repo root holds the source
// pages (read here, never written) next to things that must not be public:
// supabase/, scripts/, vercel.json, package.json. So dist/ starts empty, gets
// only the files PUBLIC_FILES names, and the build's own pages are written on
// top. checkDist() fails the build if anything else got in.
//
// What it produces (all under dist/):
//   meetings/<date>.html   one indexable page per meeting
//   meetings.html          tracker list (the archive), prerendered
//   news.html              approved editorials, prerendered
//   municipalities.html    city registry, prerendered
//   about.html             the team roster, prerendered
//   documents/<type>/<date>.html   one page per published Meeting Summary
//                          or Agenda Summary, with its full text
//   documents/index.html, documents/meeting-summaries.html,
//   documents/agenda-summaries.html   the document library, prerendered
//   sitemap.xml            every indexable URL, with real lastmod values
//   <every public page>    Organization / WebSite / page-level JSON-LD
//
// It is idempotent: everything it writes lives between <!-- build:name -->
// markers in a copy of the source page, so running it twice produces the same
// bytes. It fails hard rather
// than writing a page with content missing -- a failed build leaves the last
// good deployment serving, which is the outcome you want.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  ROOT, fetchMeetings, fetchEditorials, fetchCities, fetchDocuments, fetchSchedule, fetchPhotos,
  loadPublicByline, loadContributors, loadDocumentView
} from './lib/data.mjs';
import { renderGallery, renderStrip, renderHomePhoto, renderAttendPhotos } from './lib/photos.mjs';
import { SITE_ORIGIN, formatDate, formatDateShort, isoDay, clip, escapeHtml } from './lib/fmt.mjs';
import {
  assignMeetingPaths, meetingTouchedAt, renderMeetingList, renderItems,
  renderEditorials, renderMunicipalities, renderTeam, makeCounter
} from './lib/render.mjs';
import { setHead, setJsonLd, upsertRegion, rewriteToRootRelative, splitShell } from './lib/page.mjs';
import * as schema from './lib/schema.mjs';
import {
  DOC_TYPES, TRACKER_ARCHIVE_THROUGH, TRACKER_ARCHIVE_LABEL, pageDocuments, cleanBodies,
  documentPath, documentUrl, publicPdfUrl, renderDocumentList, renderFilterOptions,
  renderLatestCard, pageOptions, todayInMiami, renderNextMeeting, renderUpcomingList
} from './lib/documents.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

// api/_sanitize-html.js is a bundled copy of sanitize-html, because Vercel's
// function runtime cannot load the package itself (scripts/vendor-sanitizer.mjs
// says why). Refuse to deploy a bundle older or newer than package.json asks for.
{
  const wanted = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies['sanitize-html'];
  const bundled = (/^\/\/ sanitize-html (\S+) /.exec(readFileSync(join(ROOT, 'api/_sanitize-html.js'), 'utf8')) || [])[1];
  if (bundled !== wanted) {
    throw new Error('api/_sanitize-html.js bundles sanitize-html ' + bundled + ' but package.json asks for ' +
      wanted + '. Run npm run vendor-sanitizer and commit the result.');
  }
}

// Sitemaps are capped at 50,000 URLs by the protocol. Split below that with
// room to spare rather than at the limit.
const MAX_URLS_PER_SITEMAP = 45000;

const OUT = join(ROOT, 'dist');

const written = [];
function write(relPath, contents) {
  written.push(relPath);
  if (DRY_RUN) return;
  mkdirSync(dirname(join(OUT, relPath)), { recursive: true });
  writeFileSync(join(OUT, relPath), contents);
}
function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// The Turnstile site key is public (it ships to every visitor), but it lives
// in the Vercel environment beside its secret so the pair is set in one place.
// Without it the meta stays empty and /attend says sign-ups aren't set up.
function setTurnstileSiteKey(html) {
  const key = (process.env.TURNSTILE_SITE_KEY || '').trim();
  if (!key) {
    console.warn('turnstile  TURNSTILE_SITE_KEY is not set; /attend will not accept sign-ups');
    return html;
  }
  return html.replace(/<meta name="turnstile-site-key" content="[^"]*">/,
    `<meta name="turnstile-site-key" content="${escapeHtml(key)}">`);
}

// The same key for every other form (claim, editorial, newsletter, login),
// which read it from js/bot-guard.js rather than a meta tag on each page.
// Without it the widget never renders and the API turns every submission away.
function stampBotGuardSiteKey() {
  const key = (process.env.TURNSTILE_SITE_KEY || '').trim();
  if (!key) {
    console.warn('turnstile  TURNSTILE_SITE_KEY is not set; public forms and login will not work');
    return;
  }
  if (!/^[\w-]+$/.test(key)) throw new Error('TURNSTILE_SITE_KEY has unexpected characters');
  const file = join(OUT, 'js/bot-guard.js');
  const src = readFileSync(file, 'utf8');
  if (!src.includes('__TURNSTILE_SITE_KEY__')) throw new Error('js/bot-guard.js lost its site key placeholder');
  writeFileSync(file, src.replace('__TURNSTILE_SITE_KEY__', key));
}

// ---------------------------------------------------------------------
// What goes into dist/
// ---------------------------------------------------------------------

// The allowlist. Nothing is copied unless it is named here, so a new folder
// or config file stays private until someone decides otherwise. The pages
// the build writes itself (meetings/*, documents/<type>/*, sitemap.xml) are
// not copied: they are generated fresh every time.
const PUBLIC_FILES = {
  // Top-level pages only. drafts/ and document-templates/ are subfolders and
  // never match.
  rootPages: (name) => name.endsWith('.html'),
  files: [
    'robots.txt',
    'city/index.html',
    'documents/index.html',
    'documents/meeting-summaries.html',
    'documents/agenda-summaries.html',
    'documents/preview.html'
  ],
  // Whole folders, limited to the file types the pages load.
  dirs: {
    css: ['.css'],
    js: ['.js'],
    assets: ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff2', '.geojson', '.txt']
  },
  // Inside those folders but only for the build or for us.
  skip: [
    'assets/img/_originals',
    'assets/data/contributors.json',
    'assets/data/cities/_placeholder.geojson'
  ]
};

function listFiles(relDir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const rel = relDir + '/' + entry.name;
    if (PUBLIC_FILES.skip.includes(rel)) continue;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

function copyPublicFiles() {
  rmSync(OUT, { recursive: true, force: true });
  const files = readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && PUBLIC_FILES.rootPages(e.name))
    .map((e) => e.name)
    .concat(PUBLIC_FILES.files);
  for (const [dir, exts] of Object.entries(PUBLIC_FILES.dirs)) {
    files.push(...listFiles(dir).filter((f) => exts.includes(extname(f).toLowerCase())));
  }
  for (const rel of files) {
    mkdirSync(dirname(join(OUT, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(OUT, rel));
  }
  return files.length;
}

// The second lock: whatever the allowlist says, these never ship.
const FORBIDDEN = [
  /^(supabase|scripts|api|node_modules|document-templates|drafts|\.github|\.claude|\.vercel)\//,
  /(^|\/)\.(env|git)/,
  /^(vercel|package|package-lock)\.json$/,
  /\.(md|sql|mjs|cjs|ts|yml|yaml|py|map|pdf|otf|ttf)$/i
];
const SERVABLE = new Set(['.html', '.xml', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff2', '.geojson', '.txt']);

// Every rewrite destination in vercel.json resolves inside dist/, so each one
// has to exist there or its clean URL 404s.
const REWRITE_TARGETS = [
  'home.html', 'links.html', 'attend.html', 'city/index.html',
  'documents/index.html', 'documents/meeting-summaries.html', 'documents/agenda-summaries.html'
];

function listDist(abs = OUT, prefix = '') {
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...listDist(join(abs, entry.name), rel + '/'));
    else out.push(rel);
  }
  return out;
}

function checkDist(docPages) {
  const shipped = listDist();
  const bad = shipped.filter((f) => FORBIDDEN.some((re) => re.test(f)) || !SERVABLE.has(extname(f).toLowerCase()));
  if (bad.length) throw new Error('dist/ contains files that must not be public:\n  ' + bad.join('\n  '));
  const required = REWRITE_TARGETS.concat(docPages.map((d) => `${documentPath(d).slice(1)}.html`));
  const missing = required.filter((f) => !existsSync(join(OUT, f)));
  if (missing.length) throw new Error('dist/ is missing rewrite destinations:\n  ' + missing.join('\n  '));
  return shipped.length;
}

// ---------------------------------------------------------------------
// Which pages are public
// ---------------------------------------------------------------------

// Derived from the files rather than a hand-kept list: a page counts as
// indexable unless it says otherwise in its own robots meta. Adding a new page
// therefore puts it in the sitemap automatically, and adding noindex to one
// takes it out, with no second place to remember.
const CLEAN_PATHS = { 'home.html': '/', 'attend.html': '/attend' };

function publicPages() {
  const out = [];
  for (const file of readdirSync(ROOT).sort()) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(join(ROOT, file), 'utf8');
    const robots = /<meta name="robots" content="([^"]*)"/i.exec(html);
    if (robots && /noindex/i.test(robots[1])) continue;
    // home.html and attend.html are served at clean paths by the rewrites in
    // vercel.json; those paths are their canonicals.
    const urlPath = CLEAN_PATHS[file] || `/${file}`;
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
        <a href="/meetings.html">Meeting Tracker Archive</a>
        <span class="breadcrumb-sep" aria-hidden="true">&rsaquo;</span>
        <span aria-current="page">${esc(formatDateShort(meeting.meeting_date))}</span>
      </nav>

      <p class="archive-note"><strong>${esc(TRACKER_ARCHIVE_LABEL)}.</strong> The Meeting Tracker no longer adds new meetings. New meetings are covered in official <a href="/documents/meeting-summaries">Meeting Summaries</a> and <a href="/documents/agenda-summaries">Agenda Summaries</a>.</p>

      <span class="eyebrow">${esc(meeting.meeting_type)} &middot; ${esc(formatDate(meeting.meeting_date))}</span>
      <h1 style="max-width:24ch;">${esc(meeting.title)}</h1>
      <p class="lede">${esc(meeting.summary)}</p>

      <div id="tracker-body">
${renderItems(meeting, counter)}
      </div>

      ${navLinks.length ? `<nav class="meeting-nav" aria-label="Nearby meetings">${navLinks.join('')}</nav>` : ''}

      <p class="meeting-back"><a href="/meetings.html">Meeting Tracker Archive &#8594;</a></p>
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
      { name: 'Meeting Tracker Archive', url: `${SITE_ORIGIN}/meetings.html` },
      { name: formatDateShort(meeting.meeting_date), url: meeting.__url }
    ])
  ]);

  return html;
}

// ---------------------------------------------------------------------
// Document pages
// ---------------------------------------------------------------------

function documentTitle(doc) {
  return `${clip(doc.title, 70)} - ${DOC_TYPES[doc.doc_type].label}, ${formatDate(doc.meeting_date)}`;
}

// The shell is documents/index.html: its header, footer and stylesheets,
// with the nav pointing at this document's section instead of the landing
// page.
function buildDocumentPage(shellSource, docView, doc, allDocs, photoStrip = '') {
  const shell = splitShell(shellSource);
  const type = DOC_TYPES[doc.doc_type];
  let head = shell.head
    .replace('<a href="/documents" aria-current="page">All documents</a>', '<a href="/documents">All documents</a>')
    .replace(`<a href="${type.index}">`, `<a href="${type.index}" aria-current="page">`);
  const tail = shell.tail.replace('<script src="/js/translate.js',
    '<script src="/js/document-page.js?v=20261019a"></script>\n' +
    (photoStrip ? '<script src="/js/photo-viewer.js?v=20261116"></script>\n' : '') +
    '<script src="/js/translate.js');

  // A Meeting Summary carries the photos from its meeting under the text.
  let html = head + shell.mainOpenTag + '\n' + docView.renderDocumentMain(pageOptions(doc, allDocs)) +
    photoStrip + '</main>' + tail;

  const url = documentUrl(doc);
  html = setHead(html, {
    title: documentTitle(doc),
    description: clip(doc.summary, 155),
    canonical: url,
    ogType: 'article'
  });
  html = setJsonLd(html, 'jsonld', [
    schema.organization(),
    schema.website(),
    schema.documentReport(doc, { url, pdfUrl: SITE_ORIGIN + publicPdfUrl(doc.current.public_pdf_path), label: type.label }),
    schema.breadcrumbs([
      { name: 'Home', url: `${SITE_ORIGIN}/` },
      { name: 'Documents', url: `${SITE_ORIGIN}/documents` },
      { name: type.plural, url: SITE_ORIGIN + type.index },
      { name: formatDateShort(doc.meeting_date), url }
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

  const [allMeetings, editorials, cities, documents, schedule, photos] = await Promise.all([
    fetchMeetings(), fetchEditorials(), fetchCities(), fetchDocuments(), fetchSchedule(), fetchPhotos()
  ]);
  const today = todayInMiami();
  const publicByline = loadPublicByline();
  const teams = loadContributors();
  const docView = loadDocumentView();

  // The tracker is an archive now. The freeze lives here and in the
  // dashboard form, not in the database: the meetings table still accepts
  // any date, and a later row simply never reaches the archive pages.
  const rawMeetings = allMeetings.filter((m) => String(m.meeting_date) <= TRACKER_ARCHIVE_THROUGH);
  const meetings = assignMeetingPaths(rawMeetings);

  cleanBodies(documents);
  const docPages = pageDocuments(documents);

  if (!DRY_RUN) {
    console.log(`copied   ${copyPublicFiles()} public files into dist/`);
    stampBotGuardSiteKey();
  }
  console.log(`fetched  ${meetings.length} meetings, ${editorials.length} editorials, ${cities.length} cities, ${documents.length} documents, ${schedule.length} scheduled meetings, ${photos.length} photos`);

  if (!meetings.length) throw new Error('Supabase returned zero meetings; refusing to publish an empty tracker.');
  if (!cities.length) throw new Error('Supabase returned zero cities; refusing to publish an empty registry.');

  // --- per-meeting pages, from meetings.html as the shell -----------------
  const shellSource = read('meetings.html');

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
        { name: 'Meeting Tracker Archive', url: `${SITE_ORIGIN}/meetings.html` }
      ])
    ]);
    write('meetings.html', html);
  }

  // --- document pages, from documents/index.html as the shell -------------
  const docShellSource = read('documents/index.html');
  for (const doc of docPages) {
    const strip = doc.doc_type === 'meeting-summary' ? renderStrip(photos, doc.meeting_date, publicByline) : '';
    write(`${documentPath(doc).slice(1)}.html`, buildDocumentPage(docShellSource, docView, doc, documents, strip));
  }
  console.log(`wrote    ${docPages.length} document pages`);

  // --- documents/index.html ------------------------------------------------
  {
    let html = docShellSource;
    html = upsertRegion(html, 'latest-agenda-summary', renderLatestCard(documents, 'agenda-summary'), '</main>');
    html = upsertRegion(html, 'latest-meeting-summary', renderLatestCard(documents, 'meeting-summary'), '</main>');
    html = upsertRegion(html, 'upcoming-meetings', renderUpcomingList(schedule, documents, today), '</main>');
    html = setJsonLd(html, 'jsonld', [
      schema.organization(),
      schema.website(),
      schema.collectionPage({
        url: `${SITE_ORIGIN}/documents`,
        name: headMeta(html).title,
        description: headMeta(html).description,
        items: [
          { name: 'Meeting Summaries', url: `${SITE_ORIGIN}/documents/meeting-summaries` },
          { name: 'Agenda Summaries', url: `${SITE_ORIGIN}/documents/agenda-summaries` }
        ]
      }),
      schema.breadcrumbs([
        { name: 'Home', url: `${SITE_ORIGIN}/` },
        { name: 'Documents', url: `${SITE_ORIGIN}/documents` }
      ])
    ]);
    write('documents/index.html', html);
  }

  // --- documents/meeting-summaries.html, documents/agenda-summaries.html ---
  for (const [docType, type] of Object.entries(DOC_TYPES)) {
    let html = read(type.file);
    const options = renderFilterOptions(documents, docType);
    html = upsertRegion(html, 'doc-list', renderDocumentList(documents, docType), '</main>');
    html = upsertRegion(html, 'doc-years', options.yearOptions, '</main>');
    html = upsertRegion(html, 'doc-months', options.monthOptions, '</main>');
    html = setJsonLd(html, 'jsonld', [
      schema.organization(),
      schema.website(),
      schema.collectionPage({
        url: SITE_ORIGIN + type.index,
        name: headMeta(html).title,
        description: headMeta(html).description,
        items: docPages.filter((d) => d.doc_type === docType).map((d) => ({ name: d.title, url: documentUrl(d) }))
      }),
      schema.breadcrumbs([
        { name: 'Home', url: `${SITE_ORIGIN}/` },
        { name: 'Documents', url: `${SITE_ORIGIN}/documents` },
        { name: type.plural, url: SITE_ORIGIN + type.index }
      ])
    ]);
    write(type.file, html);
  }

  // --- news.html -----------------------------------------------------------
  {
    let html = read('news.html');
    html = upsertRegion(html, 'editorials', renderEditorials(editorials), '</main>');
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
    html = upsertRegion(html, 'next-meeting', renderNextMeeting(schedule, today), '</main>');
    html = upsertRegion(html, 'home-photo', renderHomePhoto(photos, publicByline), '</main>');
    html = upsertRegion(html, 'home-documents',
      '<div class="doc-sections">' +
      renderLatestCard(documents, 'meeting-summary') +
      renderLatestCard(documents, 'agenda-summary') +
      '</div>', '</main>');
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
    if (page.file === 'attend.html') {
      html = setTurnstileSiteKey(html);
      html = upsertRegion(html, 'attend-photos', renderAttendPhotos(photos, publicByline), '</main>');
    }
    if (page.file === 'photos.html') {
      html = upsertRegion(html, 'photos', renderGallery(photos, documents, publicByline), '</main>');
    }
    write(page.file, html);
    plainCount++;
  }
  console.log(`stamped  Organization + WebSite JSON-LD on ${plainCount + handled.size} public pages`);

  // --- sitemap -------------------------------------------------------------
  const entries = [
    ...pages.map((p) => ({ url: p.url, lastmod: lastModified(p.file) })),
    ...meetings.map((m) => ({ url: m.__url, lastmod: isoDay(meetingTouchedAt(m)) })),
    ...['documents/index.html', 'documents/meeting-summaries.html', 'documents/agenda-summaries.html'].map((f) => {
      const docType = f.includes('meeting-') ? 'meeting-summary' : f.includes('agenda-') ? 'agenda-summary' : null;
      const newest = docPages.filter((d) => !docType || d.doc_type === docType)
        .map((d) => isoDay(d.current.published_at)).filter(Boolean).sort().pop();
      const fileDate = lastModified(f);
      return {
        url: SITE_ORIGIN + '/' + f.replace(/(index)?\.html$/, '').replace(/\/$/, ''),
        lastmod: [newest, fileDate].filter(Boolean).sort().pop()
      };
    }),
    ...docPages.map((d) => ({ url: documentUrl(d), lastmod: isoDay(d.current.published_at || d.updated_at) }))
  ];
  const result = writeSitemap(entries);
  console.log(`sitemap  ${result.urls} URLs across ${result.files} file(s)`);

  if (!DRY_RUN) console.log(`checked  dist/ holds ${checkDist(docPages)} files, all public`);

  console.log(`\ndone in ${Date.now() - t0}ms, ${written.length} files ${DRY_RUN ? 'would be ' : ''}written`);
}

main().catch((err) => {
  console.error('\nBUILD FAILED\n');
  console.error(err.stack || err.message);
  process.exit(1);
});
