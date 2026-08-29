// Staff account management: invite, generate a login link, delete.
//
// These were three endpoints -- admin-invite, admin-generate-link and
// admin-delete-user -- and they are one file now because Vercel's Hobby plan
// allows 12 Serverless Functions per deployment and this project reached it.
// They were always the same shape anyway: owner-only, service-role, one action
// on one account. The `action` field in the body picks which.
//
// Everything here needs the Supabase service role key, which bypasses Row
// Level Security completely, so it must never reach a browser. It is a
// server-only environment variable and this function verifies the caller is an
// active OWNER before doing anything at all.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for staff management' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var body = req.body || {};
  var action = body.action;
  if (['invite', 'generate_link', 'delete'].indexOf(action) === -1) {
    res.status(400).json({ error: 'Unknown action' });
    return;
  }

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // ---------- caller must be an active owner ----------
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
    if (!callerRole || callerRole.role !== 'owner' || callerRole.status !== 'active') {
      res.status(403).json({ error: 'Only the owner can manage staff' });
      return;
    }

    // ---------- invite ----------
    if (action === 'invite') {
      var email = body.email;
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      // /invite takes the landing page as a QUERY parameter, not a body
      // field. Without it the invite mail's link goes to the project's Site
      // URL -- the homepage, which has no password form and cannot spend the
      // token, so the invitee lands on an error in the address bar.
      var inviteRes = await fetch(SUPABASE_URL + '/auth/v1/invite?redirect_to=' +
        encodeURIComponent('https://www.miamidadecommissionwatch.com/set-password.html'), {
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

      // Never demote: ignore-duplicates leaves any existing row alone.
      await fetch(SUPABASE_URL + '/rest/v1/user_roles', {
        method: 'POST',
        headers: Object.assign({}, serviceHeaders, {
          Prefer: 'resolution=ignore-duplicates,return=minimal'
        }),
        body: JSON.stringify({
          user_id: inviteData.id, role: 'admin', status: 'active', email: email
        })
      });

      res.status(200).json({ ok: true });
      return;
    }

    // ---------- generate_link ----------
    // Bypasses email delivery entirely, which matters when a provider like
    // iCloud silently filters mail from a young sending domain.
    if (action === 'generate_link') {
      var linkEmail = body.email;
      if (!linkEmail || typeof linkEmail !== 'string') {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      var linkRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          type: 'recovery',
          email: linkEmail,
          redirect_to: 'https://www.miamidadecommissionwatch.com/set-password.html'
        })
      });
      var linkData = await linkRes.json();
      if (!linkRes.ok) {
        res.status(linkRes.status).json({
          error: linkData.msg || linkData.error_description || 'Link generation failed'
        });
        return;
      }

      res.status(200).json({ ok: true, link: linkData.action_link });
      return;
    }

    // ---------- delete ----------
    // Irreversible, unlike revoking access: they would need a brand new invite
    // and a brand new account to come back.
    var targetUserId = body.user_id;
    if (!targetUserId || typeof targetUserId !== 'string') {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }
    if (caller.id === targetUserId) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    // Drop the role row first, so staff access is gone even if the auth
    // delete below fails.
    await fetch(SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + targetUserId, {
      method: 'DELETE',
      headers: serviceHeaders
    });

    var deleteAuthRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + targetUserId, {
      method: 'DELETE',
      headers: serviceHeaders
    });
    if (!deleteAuthRes.ok && deleteAuthRes.status !== 404) {
      var deleteErr = await deleteAuthRes.json().catch(function () { return {}; });
      res.status(deleteAuthRes.status).json({ error: deleteErr.msg || 'Could not delete the account' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error managing that account' });
  }
};
