// The "Latest from @MiamiDadeCW" panel under the seal on the homepage.
//
// Two constraints shape this, and neither is obvious from the markup:
//
// 1. X retired the embedded profile timeline. Its own widget still loads and
//    still renders a zero-height iframe, for every account, so dropping in the
//    <a class="twitter-timeline"> snippet publish.x.com hands out shows a
//    reader nothing. Posts now come from the v2 API, which needs a bearer
//    token, and a token cannot ship inside a page.
//
// 2. The obvious answer -- a serverless function holding the token -- does not
//    fit. Vercel's Hobby plan caps a deployment at 12 functions and api/ is at
//    12 already; a thirteenth fails the whole deploy rather than the feature.
//
// So the posts are fetched here, at build time, and written into home.html the
// same way the meeting tracker and the editorials are. That costs no function,
// no third-party script and no CSP exception, and the panel refreshes on every
// deploy -- which is what publishing a meeting already triggers.
//
// Having no token is a supported state, not a broken one: the panel keeps the
// hand-written follow card, which is also what a reader sees if X is down at
// build time.
import { escapeHtml } from './fmt.mjs';

const API = 'https://api.x.com/2';
const MAX_POSTS = 3;

export const HANDLE = String(process.env.X_HANDLE || 'MiamiDadeCW').replace(/^@/, '');

// X timestamps are UTC. A post at 9pm in Miami is tomorrow in UTC, so the date
// has to be read in the county's timezone or a third of the posts get dated a
// day late.
const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric'
});

function shortDay(iso) {
  const t = new Date(iso);
  return isNaN(t) ? '' : dayFormat.format(t);
}

// X returns t.co shorteners plus an entities table saying where each one
// really goes. Readers should see the real destination, so swap them in. A
// link X appended for the post's own photo or quoted post has no display_url
// worth showing, so it comes out entirely.
function readableText(post) {
  let text = post.text || '';
  for (const u of (post.entities && post.entities.urls) || []) {
    if (!u.url) continue;
    text = text.split(u.url).join(u.display_url || '');
  }
  return text.replace(/\s+/g, ' ').trim();
}

export async function fetchXPosts() {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return { posts: [], reason: 'no X_BEARER_TOKEN set' };

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const userRes = await fetch(`${API}/users/by/username/${encodeURIComponent(HANDLE)}`, { headers });
    if (!userRes.ok) throw new Error(`account lookup returned ${userRes.status}`);
    const user = await userRes.json();
    if (!user?.data?.id) throw new Error(`no account @${HANDLE}`);

    // Replies and retweets are conversation, not headlines. Asking for ten
    // leaves margin for the ones X drops from a response.
    const url = `${API}/users/${user.data.id}/tweets` +
      '?max_results=10&exclude=replies,retweets&tweet.fields=created_at,entities';
    const timelineRes = await fetch(url, { headers });
    if (!timelineRes.ok) throw new Error(`timeline returned ${timelineRes.status}`);
    const timeline = await timelineRes.json();

    const posts = (timeline?.data || []).slice(0, MAX_POSTS).map((post) => ({
      text: readableText(post),
      day: shortDay(post.created_at),
      url: `https://x.com/${HANDLE}/status/${post.id}`
    }));

    return { posts, reason: posts.length ? null : 'account has no posts to show' };
  } catch (err) {
    // A rate limit or an X outage must not take the site down with it. The
    // panel has a designed fallback, so this degrades where the Supabase
    // fetches deliberately fail hard: a homepage with a follow card on it is
    // correct, a homepage that never deployed is not.
    return { posts: [], reason: err.message || String(err) };
  }
}

function followCard() {
  const href = `https://x.com/${escapeHtml(HANDLE)}`;
  return `            <p class="x-feed-empty">Agenda alerts and quick takes, posted as meetings happen. ` +
    `<a href="${href}" target="_blank" rel="noopener">Follow on X &#8599;</a></p>`;
}

export function renderXFeed(posts) {
  if (!posts.length) return followCard();

  return posts.map((post) =>
    `            <a class="x-post" href="${escapeHtml(post.url)}" target="_blank" rel="noopener">\n` +
    `              <p class="x-post-text">${escapeHtml(post.text)}</p>\n` +
    `              <span class="x-post-age">${escapeHtml(post.day)}</span>\n` +
    '            </a>'
  ).join('\n');
}
