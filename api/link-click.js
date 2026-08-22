// Counts opens of, and taps on, the /links page (the Instagram bio link).
// Public and unauthenticated by necessity -- the visitors being counted are
// anonymous -- so it is deliberately boring: it accepts nothing but an event
// kind, a link id from a fixed allowlist, and a short source tag, and it
// stores no IP, user agent, or cookie. See supabase/migration_8_link_clicks.sql.
//
// Runs server-side rather than as a direct client insert so link_events can
// stay closed to the public anon key entirely.

// Must stay in sync with the data-link attributes in links.html. Anything
// not on this list is dropped, so a stranger who finds this endpoint can't
// fill the table with arbitrary strings.
var LINK_IDS = [
  'meetings',
  'find-district',
  'public-comment',
  'elections',
  'submit-editorial',
  'editorials',
  'join',
  'officials',
  'about',
  'contact',
  'county-agendas',
  'instagram',
  'full-site'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Nothing the visitor can do about this, and nothing they should see:
    // a missing count is not worth an error in their console.
    res.status(204).end();
    return;
  }

  var body = parseBody(req);
  var event = body.event === 'view' || body.event === 'click' ? body.event : null;
  if (!event) {
    res.status(400).json({ error: 'Unknown event' });
    return;
  }

  var linkId = typeof body.link === 'string' && LINK_IDS.indexOf(body.link) !== -1 ? body.link : null;
  if (event === 'click' && !linkId) {
    res.status(400).json({ error: 'Unknown link' });
    return;
  }

  // A campaign tag like "ig". Anything longer or stranger than that is a
  // URL someone is playing with, not a real source, so it becomes null.
  var source = typeof body.source === 'string' ? body.source.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{1,32}$/.test(source)) source = null;

  try {
    // The IP is used for throttling and then forgotten -- check_rate_limit
    // keys on a hash-like string that expires with its window, and nothing
    // derived from it is written to link_events.
    var ip = clientIp(req);
    var allowed = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, 'link-click:' + ip, 60, 600);
    if (!allowed) {
      // Silently drop rather than 429: the visitor isn't asking for anything,
      // and a real person clicking fast shouldn't see an error.
      res.status(204).end();
      return;
    }

    await fetch(SUPABASE_URL + '/rest/v1/link_events', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ event: event, link_id: linkId, source: source })
    });

    res.status(204).end();
  } catch (err) {
    // A dropped count is never worth breaking the page over.
    res.status(204).end();
  }
};

// sendBeacon posts a Blob, which Vercel parses as JSON when the Blob's type
// says so, but falls back to a raw string on older browsers that ignore it.
function parseBody(req) {
  var raw = req.body;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  return typeof raw === 'object' ? raw : {};
}

// Vercel sets x-forwarded-for to "client, proxy1, proxy2, ...";
// the first entry is the original client.
function clientIp(req) {
  var forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, key, limit, windowSeconds) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_rate_limit', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
  });
  if (!r.ok) return true; // fail open -- a rate-limit outage shouldn't lose counts
  return await r.json();
}
