// Feeds the "Latest from @MiamiDadeCW" panel on the homepage.
//
// The browser cannot read this feed for itself. X has retired the embedded
// profile timeline -- its own widget still loads, but it renders a zero-height
// iframe and logs a sunset notice -- so the only supported way to read an
// account's posts is the v2 API, and that needs a bearer token. A token in a
// page is a token anyone can copy, so the call happens here instead and the
// browser only ever sees post text.
//
// Having no token is a normal state, not a failure: this answers 200 with
// configured:false, and the homepage keeps its plain "follow the account"
// card. The panel is never a broken box.
var API = 'https://api.x.com/2';
var HANDLE = String(process.env.X_HANDLE || 'MiamiDadeCW').replace(/^@/, '');
var MAX_POSTS = 5;

// Both caches survive between warm invocations. The account id never changes,
// and X's read tiers are metered per month, so every homepage load answered
// from memory is one that isn't billed. The CDN cache in front of this does
// the heavy lifting; this only catches the cold-start stampede behind it.
var idCache = null;
var feedCache = { at: 0, payload: null };
var FEED_TTL_MS = 15 * 60 * 1000;

function xFetch(url, token) {
  return fetch(url, { headers: { Authorization: 'Bearer ' + token } });
}

// X hands back t.co shorteners plus an entities table that says what each one
// really points at. Readers should see the real destination, so swap them in.
// A link X appended for the post's own photo or quoted post has no
// display_url worth showing, so it comes out entirely.
function readableText(post) {
  var text = post.text || '';
  var urls = (post.entities && post.entities.urls) || [];

  urls.forEach(function (u) {
    if (!u.url) return;
    var replacement = u.display_url ? u.display_url : '';
    text = text.split(u.url).join(replacement);
  });

  return text.replace(/\s+$/, '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var token = process.env.X_BEARER_TOKEN;
  if (!token) {
    // Short cache: the day someone adds the token, the panel should start
    // showing posts within minutes rather than at the next deploy.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ configured: false, handle: HANDLE, posts: [] });
    return;
  }

  if (feedCache.payload && Date.now() - feedCache.at < FEED_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    res.status(200).json(feedCache.payload);
    return;
  }

  try {
    if (!idCache) {
      var userRes = await xFetch(API + '/users/by/username/' + encodeURIComponent(HANDLE), token);
      if (!userRes.ok) throw new Error('lookup failed with ' + userRes.status);
      var user = await userRes.json();
      if (!user || !user.data || !user.data.id) throw new Error('no such account: @' + HANDLE);
      idCache = user.data.id;
    }

    // Replies and retweets are conversation, not headlines, and the panel has
    // room for three posts. Asking for ten leaves margin for the ones X drops
    // from the response when they are deleted between calls.
    var timelineUrl = API + '/users/' + idCache + '/tweets' +
      '?max_results=10&exclude=replies,retweets&tweet.fields=created_at,entities';

    var timelineRes = await xFetch(timelineUrl, token);
    if (!timelineRes.ok) throw new Error('timeline failed with ' + timelineRes.status);
    var timeline = await timelineRes.json();

    var posts = ((timeline && timeline.data) || []).slice(0, MAX_POSTS).map(function (post) {
      return {
        id: post.id,
        text: readableText(post),
        created_at: post.created_at,
        url: 'https://x.com/' + HANDLE + '/status/' + post.id
      };
    });

    var payload = { configured: true, handle: HANDLE, posts: posts };
    feedCache = { at: Date.now(), payload: payload };

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    res.status(200).json(payload);
  } catch (err) {
    // A rate limit or an X outage should not blank a panel that was working a
    // minute ago, so a stale payload beats an error. With nothing cached the
    // homepage falls back to the follow card on its own, and the failure must
    // not be cached or the CDN would serve it for the next quarter hour.
    if (feedCache.payload) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      res.status(200).json(feedCache.payload);
      return;
    }
    console.error('x-feed:', err && err.message ? err.message : err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'Could not reach X' });
  }
};
