// Returns aggregate /links traffic for the admin dashboard: total opens,
// taps per card, and which ?src= tag people arrived with. Staff-gated like
// the other admin endpoints. Calls the link_stats aggregate function so
// Postgres does the counting and the raw event rows never leave the database.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for link stats' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  // Windows the dashboard offers. Anything else falls back to 30 days
  // rather than letting a caller pick an arbitrary range.
  var DAYS = { '7': 7, '30': 30, '365': 365 };
  var days = DAYS[String(req.query && req.query.days)] || 30;

  try {
    var callerRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SERVICE_ROLE_KEY }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    var caller = await callerRes.json();

    var roleRes = await fetch(
      SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + caller.id + '&select=role,status',
      { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    if (!callerRole || (callerRole.role !== 'owner' && callerRole.role !== 'admin') || callerRole.status !== 'active') {
      res.status(403).json({ error: 'Only staff can view link stats' });
      return;
    }

    var since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    var statsRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/link_stats', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_since: since })
    });
    if (!statsRes.ok) {
      res.status(500).json({ error: 'Could not load link stats' });
      return;
    }
    var rows = await statsRes.json();

    var views = 0;
    var clicks = [];
    var sources = [];
    (rows || []).forEach(function (row) {
      if (row.kind === 'total') views = Number(row.total) || 0;
      else if (row.kind === 'click') clicks.push({ link: row.label, count: Number(row.total) || 0 });
      else if (row.kind === 'source') sources.push({ source: row.label, count: Number(row.total) || 0 });
    });

    var totalClicks = clicks.reduce(function (sum, row) { return sum + row.count; }, 0);

    res.status(200).json({
      days: days,
      views: views,
      totalClicks: totalClicks,
      clicks: clicks,
      sources: sources
    });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error loading link stats' });
  }
};
