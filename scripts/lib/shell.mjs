// ---------------------------------------------------------------------
// One header and one footer for the whole public site
// ---------------------------------------------------------------------

// home.html holds the only copy of the site header and footer that matters.
// After every page is written to dist/, the build swaps each public page's
// <header class="site-header"> and <footer class="site-footer"> for the ones
// in home.html. A nav or footer link added there reaches every page on the
// next deploy, including the generated meeting and document pages.
//
// The header and footer still sit in each source page so a page opened on its
// own looks right, but those copies are overwritten in dist/. Edit home.html.

const HEADER = /<header\b[^>]*class="[^"]*\bsite-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/;
const FOOTER = /<footer\b[^>]*class="[^"]*\bsite-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i;

// Pages with their own chrome. The staff dashboards, login screens and the
// link-in-bio page have stripped-down headers on purpose, and city/index.html
// is the city subdomain site, which has its own nav.
const OWN_CHROME = new Set([
  'admin.html',
  'city-admin.html',
  'links.html',
  'login.html',
  'set-password.html',
  'city/index.html'
]);

// Relative links in home.html would break on /meetings/... and
// /documents/... pages, so the shared copy is made root-relative.
function rootRelative(html) {
  return html.replace(/\b(href|src)="([^"]*)"/g, (match, attr, value) => {
    if (!value || ABSOLUTE.test(value)) return match;
    return `${attr}="/${value}"`;
  });
}

// The nav link a page belongs under, as it appears after rootRelative().
function navTarget(file) {
  if (file === 'home.html') return '/';
  if (/^documents\/(meeting-summary\/|meeting-summaries\.html)/.test(file)) return '/documents/meeting-summaries';
  if (/^documents\/(agenda-summary\/|agenda-summaries\.html)/.test(file)) return '/documents/agenda-summaries';
  if (file.startsWith('documents/')) return '/documents';
  if (/^(commissioner|office-)/.test(file)) return '/officials.html';
  if (file === 'attend.html') return '/get-involved.html';
  return '/' + file;
}

function markCurrent(header, file) {
  const target = navTarget(file);
  const [before, nav, after] = splitNav(header);
  if (!nav) return header;
  let marked = nav
    .replace(/\saria-current="page"/g, '')
    .replace(/(<details\b[^>]*class="[^"]*)\bis-current\b\s?/g, '$1');
  marked = marked.replace(
    new RegExp(`<a href="${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
    `<a href="${target}" aria-current="page"`
  );
  // A current link inside a dropdown lights up the dropdown's label too.
  marked = marked.replace(/<details\b([^>]*)>([\s\S]*?)<\/details>/g, (block, attrs, inner) => {
    if (!inner.includes('aria-current="page"')) return block;
    const withClass = /class="/.test(attrs)
      ? attrs.replace(/class="([^"]*)"/, (m, c) => `class="${c.trim()} is-current"`)
      : `${attrs} class="is-current"`;
    return `<details${withClass}>${inner}</details>`;
  });
  return before + marked + after;
}

function splitNav(header) {
  const start = header.search(/<nav\b[^>]*class="[^"]*\bsite-nav\b/);
  const end = header.indexOf('</nav>', start);
  if (start === -1 || end === -1) return [header, '', ''];
  return [header.slice(0, start), header.slice(start, end), header.slice(end)];
}

export function sharedChrome(homepage) {
  const header = homepage.match(HEADER);
  const footer = homepage.match(FOOTER);
  if (!header || !footer) throw new Error('shell: home.html has no site-header or site-footer to share');
  return { header: rootRelative(header[0]), footer: rootRelative(footer[0]) };
}

// Returns the page with the shared header and footer, or unchanged if the
// page has its own chrome or no site header/footer to replace.
export function applySharedChrome(html, file, chrome) {
  if (OWN_CHROME.has(file)) return html;
  if (HEADER.test(html)) html = html.replace(HEADER, () => markCurrent(chrome.header, file));
  if (FOOTER.test(html)) html = html.replace(FOOTER, () => chrome.footer);
  return html;
}
