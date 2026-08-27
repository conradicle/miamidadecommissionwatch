// Invites a new staff member and gives them a role.
// This needs the Supabase service role key, which must never be exposed to the
// browser, so it lives here as a server-only Vercel environment variable and
// this function verifies the caller before doing anything.
//
// Owner-only, and 'admin' is the only role it grants. The 'city_editor' path
// that used to live here went away with the old /cities section; the per-city
// roles that replace it are scoped to a single city and are issued through the
// claim-approval flow rather than this endpoint.
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

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

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
      { headers: serviceHeaders }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    var callerIsOwner = callerRole && callerRole.status === 'active' && callerRole.role === 'owner';

    if (!callerIsOwner) {
      res.status(403).json({ error: 'Only the owner can invite staff' });
      return;
    }

    var inviteRes = await fetch(SUPABASE_URL + '/auth/v1/invite', {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ email: email })
    });
    var inviteData = await inviteRes.json();

    if (!inviteRes.ok) {
      var message = inviteData.msg || inviteData.error_description || inviteData.message || '';
      if (inviteRes.status === 422 || /already/i.test(message)) {
        res.status(409).json({ error: 'That address already has an account.' });
        return;
      }
      res.status(inviteRes.status).json({ error: message || 'Invite failed' });
      return;
    }

    // Never demote: upsert with ignoreDuplicates leaves any existing row alone.
    await fetch(SUPABASE_URL + '/rest/v1/user_roles', {
      method: 'POST',
      headers: Object.assign({}, serviceHeaders, {
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      }),
      body: JSON.stringify({ user_id: inviteData.id, role: 'admin', status: 'active', email: email })
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error sending invite' });
  }
};
