// Proxies address lookups to the Census Bureau geocoder, which does not send
// CORS headers and so cannot be called directly from browser JS.
module.exports = async function handler(req, res) {
  // Keep GET temporarily for visitors with the previous cached client.
  // New clients send addresses in the body to keep them out of site URL logs.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  var address = req.method === 'POST'
    ? (req.body && req.body.address)
    : (req.query && req.query.address);
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'Missing address parameter' });
    return;
  }
  address = address.trim();
  if (!address) return res.status(400).json({ error: 'Missing address parameter' });
  // No real address is anywhere near this long; reject early rather than
  // relaying an oversized query to the Census API on this proxy's dime.
  if (address.length > 200) {
    res.status(400).json({ error: 'Address is too long' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SUPABASE_URL && SERVICE_ROLE_KEY) {
    var allowed = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, 'geocode:' + clientIp(req), 20, 600);
    if (!allowed) {
      res.status(429).json({ error: 'Too many lookups. Please try again in a few minutes.' });
      return;
    }
  }

  var url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    '?address=' + encodeURIComponent(address) +
    '&benchmark=Public_AR_Current&format=json';

  try {
    var censusRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!censusRes.ok) {
      return res.status(502).json({ error: 'Census geocoding service is unavailable' });
    }
    var data = await censusRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Census geocoding service' });
  }
};

// Vercel sets x-forwarded-for to "client, proxy1, proxy2, ...";
// the first entry is the original client.
function clientIp(req) {
  var forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, key, limit, windowSeconds) {
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_rate_limit', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
    });
    if (!r.ok) return true; // fail open -- a rate-limit outage shouldn't block real lookups
    return await r.json();
  } catch (err) {
    return true;
  }
};
