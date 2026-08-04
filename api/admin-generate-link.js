// Generates a password-recovery link on demand, bypassing email delivery
// entirely (useful when a provider like iCloud silently filters mail from a
// new sending domain). Needs the Supabase service role key, so this is
// server-only, same pattern as admin-invite.js: verify the caller is an
// active owner before doing anything, and never expose the key itself.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for link generation' });
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
      res.status(403).json({ error: 'Only the owner can generate staff links' });
      return;
    }

    var linkRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'recovery',
        email: email,
        redirect_to: 'https://www.miamidadecommissionwatch.com/set-password.html'
      })
    });
    var linkData = await linkRes.json();
    if (!linkRes.ok) {
      res.status(linkRes.status).json({ error: linkData.msg || linkData.error_description || 'Link generation failed' });
      return;
    }

    res.status(200).json({ ok: true, link: linkData.action_link });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error generating link' });
  }
};
