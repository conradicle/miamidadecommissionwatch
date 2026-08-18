// Returns aggregate newsletter subscriber counts only (never the emails
// themselves) for the admin dashboard. Staff-gated like the other admin
// endpoints; uses HEAD requests with Prefer: count=exact so Postgres counts
// rows without the API ever pulling the subscriber list into memory.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for newsletter stats' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

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
      res.status(403).json({ error: 'Only staff can view newsletter stats' });
      return;
    }

    var now = Date.now();
    var sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    var thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    var counts = await Promise.all([
      countRows(SUPABASE_URL, SERVICE_ROLE_KEY, 'status=eq.subscribed'),
      countRows(SUPABASE_URL, SERVICE_ROLE_KEY, 'status=eq.unsubscribed'),
      countRows(SUPABASE_URL, SERVICE_ROLE_KEY, 'status=eq.subscribed&subscribed_at=gte.' + encodeURIComponent(sevenDaysAgo)),
      countRows(SUPABASE_URL, SERVICE_ROLE_KEY, 'status=eq.subscribed&subscribed_at=gte.' + encodeURIComponent(thirtyDaysAgo))
    ]);

    res.status(200).json({
      subscribed: counts[0],
      unsubscribed: counts[1],
      newLast7Days: counts[2],
      newLast30Days: counts[3]
    });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error loading newsletter stats' });
  }
};

async function countRows(SUPABASE_URL, SERVICE_ROLE_KEY, filter) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/subscribers?' + filter + '&select=id', {
    method: 'HEAD',
    headers: {
      Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
      apikey: SERVICE_ROLE_KEY,
      Prefer: 'count=exact'
    }
  });
  var range = r.headers.get('content-range') || '';
  var total = range.split('/')[1];
  return total ? parseInt(total, 10) : 0;
}
