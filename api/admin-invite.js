// Invites a new staff member and gives them the 'admin' role. This needs the
// Supabase service role key, which must never be exposed to the browser, so
// it lives here as a server-only Vercel environment variable and this
// function verifies the caller is an active owner before doing anything.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for staff invites' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var email = req.body && req.body.email;
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required' });
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
    if (!callerRole || callerRole.role !== 'owner' || callerRole.status !== 'active') {
      res.status(403).json({ error: 'Only the owner can invite staff' });
      return;
    }

    var inviteRes = await fetch(SUPABASE_URL + '/auth/v1/invite', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email })
    });
    var inviteData = await inviteRes.json();
    if (!inviteRes.ok) {
      res.status(inviteRes.status).json({ error: inviteData.msg || inviteData.error_description || 'Invite failed' });
      return;
    }

    await fetch(SUPABASE_URL + '/rest/v1/user_roles', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ user_id: inviteData.id, role: 'admin', status: 'active', email: email })
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error sending invite' });
  }
};
