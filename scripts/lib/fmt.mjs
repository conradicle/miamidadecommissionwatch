// Server-side twins of the helpers in js/mdcw-format.js.
//
// These must produce byte-identical output to the browser versions. The
// prerendered markup this build writes into the page is the same markup
// js/meetings-feed.js would have produced client-side, so any drift between
// the two shows up as content that visibly changes shape after hydration.
//
// The date formatter is deliberately hand-rolled rather than delegating to
// toLocaleDateString. Vercel builds in UTC and visitors are in Eastern time;
// going through the platform formatter would make the output depend on the
// build machine's timezone and ICU build. Formatting from the date parts
// keeps it identical everywhere.

export const SITE_ORIGIN = 'https://www.miamidadecommissionwatch.com';

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only http/https survive, matching the browser helper. Anything else returns
// null and the caller renders no link at all.
export function safeHref(url) {
  try {
    const parsed = new URL(url, SITE_ORIGIN + '/');
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
  } catch {
    return null;
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// "July 21, 2026" -- the same string new Date('2026-07-21T12:00:00')
// .toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})
// produces in any timezone, because midday local can't cross a date boundary.
export function formatDate(dateStr) {
  const p = dateParts(dateStr);
  if (!p) return String(dateStr || '');
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

export function formatDateShort(dateStr) {
  const p = dateParts(dateStr);
  if (!p) return String(dateStr || '');
  return `${MONTHS_SHORT[p.m - 1]} ${p.d}, ${p.y}`;
}

function trimZero(n) {
  return parseFloat(n.toFixed(1)).toString();
}

export function formatMoney(amount) {
  const n = Number(amount);
  if (!isFinite(n) || n === 0) return '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + trimZero(n / 1e9) + 'B';
  if (abs >= 1e6) return '$' + trimZero(n / 1e6) + 'M';
  if (abs >= 1e3) return '$' + trimZero(n / 1e3) + 'K';
  return '$' + n.toFixed(0);
}

// W3C date for <lastmod>. Accepts a timestamptz or a plain date.
export function isoDay(value) {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return m ? m[1] : null;
}

// Collapses whitespace and clips on a word boundary, for meta descriptions
// built out of body prose.
export function clip(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[),;:.\-\s]+$/, '') + '…';
}
