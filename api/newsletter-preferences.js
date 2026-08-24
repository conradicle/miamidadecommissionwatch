// Read and update one subscriber's district/topic preferences.
//
// Authenticated by the same unsubscribe_token that already appears in every
// email footer: an unguessable uuid the subscriber holds, and nothing else.
// That is the same trust model as newsletter-unsubscribe.js. It is deliberately
// NOT enough to see the full email address -- the response masks it, so a
// leaked link (a forwarded email, a shared screenshot) discloses preferences
// but not an address that could be harvested.
var prefsLib = require('./_prefs');

module.exports = async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for subscription preferences' });
    return;
  }

  var token = req.method === 'GET'
    ? (req.query && req.query.token)
    : (req.body && req.body.token);

  if (!token || typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) {
    res.status(400).json({ error: 'This preferences link is missing or malformed. Use the link from one of our emails.' });
    return;
  }

  var baseUrl = SUPABASE_URL + '/rest/v1/subscribers?unsubscribe_token=eq.' + encodeURIComponent(token);
  var authHeaders = { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY };

  try {
    if (req.method === 'GET') {
      var getRes = await fetch(
        baseUrl + '&select=email,status,all_meetings,districts,topics',
        { headers: authHeaders }
      );
      var rows = await getRes.json();

      if (!getRes.ok) {
        // Most likely cause: migration_14 hasn't been applied, so the
        // preference columns don't exist yet. Say so plainly rather than
        // showing the subscriber a blank form that silently can't save.
        res.status(503).json({ error: 'Subscription preferences are not available on this deployment yet.' });
        return;
      }
      if (!rows || !rows.length) {
        res.status(404).json({ error: 'This preferences link isn\'t valid. It may have been replaced by a newer email.' });
        return;
      }

      var row = rows[0];
      res.status(200).json({
        ok: true,
        email: maskEmail(row.email),
        status: row.status,
        all_meetings: row.all_meetings !== false,
        districts: row.districts || [],
        topics: row.topics || []
      });
      return;
    }

    if (req.method === 'POST') {
      var ip = clientIp(req);
      var allowed = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, 'newsletter-prefs:' + ip, 20, 600);
      if (!allowed) {
        res.status(429).json({ error: 'Too many updates. Please try again in a few minutes.' });
        return;
      }

      var parsed = prefsLib.parsePreferences(req.body);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      if (!parsed.provided) {
        res.status(400).json({ error: 'No preferences were submitted.' });
        return;
      }

      var patchBody = parsed.values;
      // Saving preferences on an unsubscribed address resubscribes it: they
      // came back through their own link and picked what they want.
      if (req.body.resubscribe === true) {
        patchBody = Object.assign({}, patchBody, { status: 'subscribed', unsubscribed_at: null });
      }

      var patchRes = await fetch(baseUrl, {
        method: 'PATCH',
        headers: Object.assign({}, authHeaders, {
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        }),
        body: JSON.stringify(patchBody)
      });
      var patched = await patchRes.json();

      if (!patchRes.ok) {
        res.status(503).json({ error: 'Could not save your preferences. Please try again.' });
        return;
      }
      if (!patched || !patched.length) {
        res.status(404).json({ error: 'This preferences link isn\'t valid.' });
        return;
      }

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error handling your preferences' });
  }
};

// "conrad@example.com" -> "c*****d@example.com". Enough for someone to
// recognise their own address, not enough to be worth scraping.
function maskEmail(email) {
  if (typeof email !== 'string') return '';
  var at = email.indexOf('@');
  if (at < 1) return '';
  var local = email.slice(0, at);
  var domain = email.slice(at);
  if (local.length <= 2) return local[0] + '*' + domain;
  return local[0] + new Array(local.length - 1).join('*') + local[local.length - 1] + domain;
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
  if (!r.ok) return true; // fail open -- a rate-limit outage shouldn't block real updates
  return await r.json();
}
