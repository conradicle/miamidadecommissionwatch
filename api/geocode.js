// Proxies address lookups to the Census Bureau geocoder, which does not send
// CORS headers and so cannot be called directly from browser JS.
module.exports = async function handler(req, res) {
  var address = req.query.address;
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'Missing address parameter' });
    return;
  }
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
    var censusRes = await fetch(url);
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
