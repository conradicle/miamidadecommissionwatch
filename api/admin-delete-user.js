// Permanently deletes a staff member: removes their user_roles row and
// their underlying Supabase Auth account. Unlike "revoke access," this is
// irreversible -- they'd need a brand new invite to come back, with a new
// account. Same owner-only verification pattern as the other admin endpoints.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for user deletion' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var targetUserId = req.body && req.body.user_id;
  if (!targetUserId || typeof targetUserId !== 'string') {
    res.status(400).json({ error: 'user_id is required' });
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

    if (caller.id === targetUserId) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    var roleRes = await fetch(
      SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + caller.id + '&select=role,status',
      { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    if (!callerRole || callerRole.role !== 'owner' || callerRole.status !== 'active') {
      res.status(403).json({ error: 'Only the owner can delete staff' });
      return;
    }

    // Drop the role row first so staff access is gone even if the auth delete below fails.
    await fetch(SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + targetUserId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY }
    });

    var deleteAuthRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + targetUserId, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY }
    });
    if (!deleteAuthRes.ok && deleteAuthRes.status !== 404) {
      var deleteErr = await deleteAuthRes.json().catch(function () { return {}; });
      res.status(deleteAuthRes.status).json({ error: deleteErr.msg || 'Could not delete the account' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error deleting user' });
  }
};
