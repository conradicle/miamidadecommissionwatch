// Link-preview tags (Open Graph + Twitter) for every public page.
//
// Pages keep their own og:title, og:description and og:url (setHead() in
// page.mjs writes those for generated pages). Everything about the preview
// image, plus og:site_name and twitter:card, is owned here: the build strips
// whatever a page says and writes this one block after og:description, so no
// page can drift back to an old image.
//
// The image is assets/img/share-card.png, rendered from
// scripts/og/share-card.html (see scripts/og/README.md). When the card
// changes, re-render it and bump SHARE_CARD_VERSION so WhatsApp, iMessage and
// Facebook treat it as a new URL instead of serving their cached copy.

import { SITE_ORIGIN, escapeHtml as esc } from './fmt.mjs';

export const SHARE_CARD_VERSION = 2;
export const SHARE_IMAGE = `${SITE_ORIGIN}/assets/img/share-card.png?v=${SHARE_CARD_VERSION}`;
export const SHARE_IMAGE_ALT =
  'Miami-Dade Commission Watch: what your county commission did, in plain language.';
const SITE_NAME = 'Miami-Dade Commission Watch';

const OWNED = /^[ \t]*<meta (?:property|name)="(?:og:image(?::[a-z_]+)?|og:site_name|twitter:card|twitter:image(?::alt)?)"[^>]*>[ \t]*\r?\n?/gm;
const OG_DESCRIPTION = /<meta property="og:description" content="[\s\S]*?">[ \t]*\r?\n?/;

function block() {
  return [
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:image" content="${esc(SHARE_IMAGE)}">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(SHARE_IMAGE_ALT)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${esc(SHARE_IMAGE)}">`,
    `<meta name="twitter:image:alt" content="${esc(SHARE_IMAGE_ALT)}">`
  ].join('\n') + '\n';
}

// Pages without an og:description (staff dashboards, login, previews) are not
// meant to be shared and are returned unchanged.
export function applySocialMeta(html) {
  if (!OG_DESCRIPTION.test(html)) return html;
  const stripped = html.replace(OWNED, '');
  return stripped.replace(OG_DESCRIPTION, (tag) =>
    (tag.endsWith('\n') ? tag : tag + '\n') + block());
}

// Used by checkDist-style verification: the tags every shareable page must end
// up with after the build.
export const REQUIRED_TAGS = [
  'og:title', 'og:description', 'og:image', 'og:image:width', 'og:image:height',
  'og:image:alt', 'og:url', 'og:site_name', 'og:type', 'twitter:card'
];
