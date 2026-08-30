// HTML surgery for the build.
//
// Every write goes through an idempotent marker region:
//
//   <!-- build:meetings -->  ...generated...  <!-- /build:meetings -->
//
// Running the build twice produces the same file, and a human editing the
// source between markers is safe from surprise because the markers say plainly
// that the region is generated. Nothing here parses HTML properly -- it does
// not need to. The targets are a handful of tags this repo controls and whose
// exact shape is checked by scripts/build.mjs before it writes anything.

import { escapeHtml as esc } from './fmt.mjs';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function regionMarkers(name) {
  return { open: `<!-- build:${name} -->`, close: `<!-- /build:${name} -->` };
}

// Replaces the region if it exists. Returns null when the markers are absent,
// so callers can decide where a first insertion belongs.
export function replaceRegion(html, name, content) {
  const { open, close } = regionMarkers(name);
  const re = new RegExp(escapeRe(open) + '[\\s\\S]*?' + escapeRe(close));
  if (!re.test(html)) return null;
  return html.replace(re, `${open}\n${content}\n${close}`);
}

export function makeRegion(name, content) {
  const { open, close } = regionMarkers(name);
  return `${open}\n${content}\n${close}`;
}

// Replace the region, or insert it just before `needle` the first time.
export function upsertRegion(html, name, content, needle) {
  const replaced = replaceRegion(html, name, content);
  if (replaced !== null) return replaced;
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`upsertRegion(${name}): anchor not found: ${needle}`);
  return html.slice(0, idx) + makeRegion(name, content) + '\n' + html.slice(idx);
}

// ---------------------------------------------------------------------
// Head tags
// ---------------------------------------------------------------------

function replaceTag(html, re, replacement, label) {
  if (!re.test(html)) throw new Error(`Could not find ${label} to replace`);
  return html.replace(re, replacement);
}

// Rewrites title/description/canonical and the matching OG and Twitter tags
// together, so the three can never drift apart.
export function setHead(html, { title, description, canonical, ogType = 'website' }) {
  let out = html;
  out = replaceTag(out, /<title>[\s\S]*?<\/title>/,
    `<title>${esc(title)}</title>`, '<title>');
  out = replaceTag(out, /<meta name="description" content="[\s\S]*?">/,
    `<meta name="description" content="${esc(description)}">`, 'meta description');
  out = replaceTag(out, /<meta property="og:type" content="[^"]*">/,
    `<meta property="og:type" content="${esc(ogType)}">`, 'og:type');
  out = replaceTag(out, /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${esc(canonical)}">`, 'og:url');
  out = replaceTag(out, /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${esc(canonical)}">`, 'canonical');
  out = replaceTag(out, /<meta property="og:title" content="[\s\S]*?">/,
    `<meta property="og:title" content="${esc(title)}">`, 'og:title');
  out = replaceTag(out, /<meta property="og:description" content="[\s\S]*?">/,
    `<meta property="og:description" content="${esc(description)}">`, 'og:description');
  out = replaceTag(out, /<meta name="twitter:title" content="[\s\S]*?">/,
    `<meta name="twitter:title" content="${esc(title)}">`, 'twitter:title');
  out = replaceTag(out, /<meta name="twitter:description" content="[\s\S]*?">/,
    `<meta name="twitter:description" content="${esc(description)}">`, 'twitter:description');
  return out;
}

// ---------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------

// JSON-LD goes in as a marker region before </head>. The </ sequence is
// escaped so a value containing "</script>" cannot close the block early.
export function setJsonLd(html, name, objects) {
  const payload = objects
    .map((o) => '<script type="application/ld+json">' +
      JSON.stringify(o, null, 0).replace(/</g, '\\u003c') +
      '</script>')
    .join('\n');
  return upsertRegion(html, name, payload, '</head>');
}

// ---------------------------------------------------------------------
// Relative URL rewriting, for pages generated into a subdirectory
// ---------------------------------------------------------------------

const ABSOLUTE = /^(https?:)?\/\/|^\/|^#|^data:|^mailto:|^tel:|^javascript:/i;

// Pages under /meetings/ inherit their shell from meetings.html, which lives
// at the root and links to "css/style.css" and friends relatively. Left alone
// those would resolve to /meetings/css/style.css. Making them root-relative
// keeps one shell working at any depth.
export function rewriteToRootRelative(html) {
  return html.replace(/\b(src|href)="([^"]*)"/g, (match, attr, value) => {
    if (!value || ABSOLUTE.test(value)) return match;
    return `${attr}="/${value}"`;
  });
}

// ---------------------------------------------------------------------
// Shell extraction
// ---------------------------------------------------------------------

// Splits a page into everything before <main>, the main content, and
// everything after </main>. Generated pages keep the head/header/footer of
// their source page, so a future nav or footer edit flows into them without
// anyone remembering a template exists.
export function splitShell(html) {
  const openRe = /<main\b[^>]*>/;
  const openMatch = openRe.exec(html);
  const closeIdx = html.lastIndexOf('</main>');
  if (!openMatch || closeIdx === -1) {
    throw new Error('splitShell: could not locate <main> ... </main>');
  }
  const mainStart = openMatch.index + openMatch[0].length;
  return {
    head: html.slice(0, openMatch.index),
    mainOpenTag: openMatch[0],
    main: html.slice(mainStart, closeIdx),
    tail: html.slice(closeIdx + '</main>'.length)
  };
}
