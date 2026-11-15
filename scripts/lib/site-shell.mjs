// The shared header and footer.
//
// home.html is the one source for the site header (wordmark, language
// buttons, Instagram link, newsletter form, primary nav) and the footer.
// After every page is written to dist/, build.mjs runs applySiteShell() on
// each public HTML page: it swaps that page's <header class="site-header">
// and <footer class="site-footer"> for the homepage's, marks the current nav
// item, and makes sure the page loads css/site-shell.css and
// js/site-menu.js. A nav or footer change is then one edit to home.html
// instead of ~20.
//
// It is regex-based and runs on finished pages, so it fails the build rather
// than guess: if home.html has no header or footer to copy, or a page it is
// meant to restyle has none to replace, the build stops (and the last good
// deployment keeps serving).

const HEADER = /<header\b[^>]*class="[^"]*\bsite-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/;
const FOOTER = /<footer\b[^>]*class="[^"]*\bsite-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/;

// Pages that keep their own header and footer. Each is listed on purpose;
// a new page gets the shared shell unless it is added here.
export const SHELL_SKIP = new Set([
  // Staff pages. Their header holds #logout-btn (and on city-admin the
  // signed-in city), which the public header does not have; replacing it
  // leaves staff with no way to log out.
  'admin.html',
  'city-admin.html',
  // Sign-in and account flows. They are reached from emails and the staff
  // link, carry no public nav on purpose, and should not show a newsletter
  // form in the middle of a password reset.
  'login.html',
  'set-password.html',
  'manage-subscription.html',
  // City sites. city/index.html is served on <slug>.miamidadecommissionwatch.com
  // and has its own nav plus #city-wordmark, which js/city-site.js fills with
  // the city's name. The county header's root-relative links would resolve
  // against the city subdomain, where the host rewrite in vercel.json sends
  // every path back to the city page, so each county link would just reload it.
  'city/index.html',
  // The Instagram link-in-bio page. It has no site header or footer by
  // design (one column of large buttons), so there is nothing to replace.
  'links.html',
]);

// Asset paths in the homepage's header and footer are relative to the root.
// Pages under /documents/ and /meetings/ need them absolute.
function rootLinks(html) {
  return html.replace(/\b(href|src)="([^"]+)"/g, (match, attribute, value) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(value)) return match;
    return `${attribute}="/${value}"`;
  });
}

// The nav link that should carry aria-current="page" for a dist/ path.
function activeDestination(file) {
  if (file === 'home.html') return '/';
  if (/^documents\/(meeting-summary\/|meeting-summaries\.html)/.test(file)) return '/documents/meeting-summaries';
  if (/^documents\/(agenda-summary\/|agenda-summaries\.html)/.test(file)) return '/documents/agenda-summaries';
  if (file.startsWith('documents/')) return '/documents';
  if (/^(commissioner|office-)/.test(file)) return '/officials.html';
  if (file === 'attend.html') return '/get-involved.html';
  return '/' + file;
}

// The ?v= the homepage itself uses for an asset, so every page gets the same
// value and there is one place to bump it.
function assetVersion(homepage, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:href|src)="/?${escaped}\\?v=([^"]+)"`).exec(homepage);
  if (!m) throw new Error(`site-shell: home.html does not reference ${path}?v=..., so its version is unknown`);
  return m[1];
}

// Everything that depends only on home.html, computed once per build.
export function prepareSiteShell(homepage) {
  const header = homepage.match(HEADER);
  if (!header) throw new Error('site-shell: no <header class="site-header"> found in home.html');
  const footer = homepage.match(FOOTER);
  if (!footer) throw new Error('site-shell: no <footer class="site-footer"> found in home.html');
  return {
    header: rootLinks(header[0]).replace(/\saria-current="page"/g, ''),
    footer: rootLinks(footer[0]),
    cssVersion: assetVersion(homepage, 'css/site-shell.css'),
    menuVersion: assetVersion(homepage, 'js/site-menu.js'),
    mainVersion: assetVersion(homepage, 'js/main.js'),
  };
}

export function applySiteShell(html, file, shell) {
  if (!HEADER.test(html)) throw new Error(`site-shell: ${file} has no <header class="site-header"> to replace (add it to SHELL_SKIP if that is intended)`);
  if (!FOOTER.test(html)) throw new Error(`site-shell: ${file} has no <footer class="site-footer"> to replace (add it to SHELL_SKIP if that is intended)`);

  // The shared header carries the newsletter form and the EN/ES/HT buttons.
  // Without these scripts they render but do nothing.
  for (const script of ['js/newsletter.js', 'js/translate.js']) {
    if (!new RegExp(`src="/?${script.replace('.', '\\.')}`).test(html)) {
      throw new Error(`site-shell: ${file} does not load ${script}, which the shared header needs`);
    }
  }

  const destination = activeDestination(file);
  let header = shell.header.replace(/<a\b[^>]*>/g, (anchor) =>
    !anchor.includes('wordmark') && anchor.includes(`href="${destination}"`)
      ? anchor.replace('>', ' aria-current="page">')
      : anchor);
  // The Documents dropdown underlines itself on any page inside it.
  if (destination.startsWith('/documents')) {
    header = header.replace('<details class="nav-menu">', '<details class="nav-menu is-current">');
  }

  // Function replacements, so a "$" in the markup is never read as a
  // replacement pattern.
  html = html.replace(HEADER, () => header);
  html = html.replace(FOOTER, () => shell.footer);

  html = html.replace(/<body\b([^>]*)>/, (match, attributes) => {
    if (/class="/.test(attributes)) {
      return '<body' + attributes.replace(/class="([^"]*)"/, (value, classes) => {
        const names = new Set(classes.split(/\s+/).filter(Boolean));
        names.add('site-shell');
        return `class="${[...names].join(' ')}"`;
      }) + '>';
    }
    return `<body${attributes} class="site-shell">`;
  });

  html = html.replace(/<link\b[^>]*href="\/?css\/site-shell\.css[^"]*"[^>]*>\s*/g, '');
  html = html.replace('</head>', () => `<link rel="stylesheet" href="/css/site-shell.css?v=${shell.cssVersion}">\n</head>`);
  html = html.replace(/<script\b[^>]*src="\/?js\/site-menu\.js[^"]*"[^>]*><\/script>\s*/g, '');
  let scripts = '';
  if (!/src="\/?js\/main\.js/.test(html)) scripts += `<script src="/js/main.js?v=${shell.mainVersion}"></script>\n`;
  scripts += `<script src="/js/site-menu.js?v=${shell.menuVersion}"></script>\n`;
  html = html.replace('</body>', () => scripts + '</body>');
  return html;
}
