// Invites a new staff member or municipal team member and gives them a role.
// This needs the Supabase service role key, which must never be exposed to the
// browser, so it lives here as a server-only Vercel environment variable and
// this function verifies the caller before doing anything.
//
// Two kinds of invite, with deliberately different permissions:
//
//   role 'admin'        full content access across the whole site.
//                       Owner only, unchanged from before.
//   role 'city_editor'  drafts content for one city and nothing else, and
//                       cannot publish anything (enforced by RLS in
//                       supabase/migration_13_cities.sql, not here).
//                       Owners and admins can both send these, so onboarding
//                       a city team isn't bottlenecked on one person.
//
// If the address already has an account, a city_editor invite adds that
// account to the city team instead of failing: staff shouldn't have to know
// whether a student has signed up before.
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

  // Defaults to 'admin' so the existing Staff tab, which posts only an email,
  // keeps behaving exactly as it did.
  var role = (req.body && req.body.role) || 'admin';
  var cityId = (req.body && req.body.city_id) || null;

  if (role !== 'admin' && role !== 'city_editor') {
    res.status(400).json({ error: 'Unknown role' });
    return;
  }
  if (role === 'city_editor' && !cityId) {
    res.status(400).json({ error: 'A city is required for a city editor invite' });
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
    var callerIsActive = callerRole && callerRole.status === 'active';
    var callerIsOwner = callerIsActive && callerRole.role === 'owner';
    var callerIsStaff = callerIsActive && (callerRole.role === 'owner' || callerRole.role === 'admin');

    if (role === 'admin' && !callerIsOwner) {
      res.status(403).json({ error: 'Only the owner can invite staff' });
      return;
    }
    if (role === 'city_editor' && !callerIsStaff) {
      res.status(403).json({ error: 'Only staff can invite city team members' });
      return;
    }

    // Resolves an address that already has an account to its user id, so an
    // invite to an existing user can still be added to a city team. user_roles
    // records the email at invite time, so it answers this without touching
    // the auth admin API in the common case.
    async function findExistingUserId() {
      var byRole = await fetch(
        SUPABASE_URL + '/rest/v1/user_roles?email=eq.' + encodeURIComponent(email) + '&select=user_id',
        { headers: serviceHeaders }
      );
      var rows = await byRole.json();
      if (rows && rows[0] && rows[0].user_id) return rows[0].user_id;

      // Someone with an auth account but no role row (or invited before
      // user_roles started recording emails).
      var byAuth = await fetch(
        SUPABASE_URL + '/auth/v1/admin/users?filter=' + encodeURIComponent(email),
        { headers: serviceHeaders }
      );
      if (!byAuth.ok) return null;
      var authData = await byAuth.json();
      var users = (authData && authData.users) || [];
      for (var i = 0; i < users.length; i++) {
        if (users[i].email && users[i].email.toLowerCase() === email.toLowerCase()) {
          return users[i].id;
        }
      }
      return null;
    }

    var inviteRes = await fetch(SUPABASE_URL + '/auth/v1/invite', {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ email: email })
    });
    var inviteData = await inviteRes.json();

    var userId = null;
    var alreadyExisted = false;

    if (inviteRes.ok) {
      userId = inviteData.id;
    } else {
      var message = inviteData.msg || inviteData.error_description || inviteData.message || '';
      var looksRegistered = inviteRes.status === 422 || /already/i.test(message);
      if (!looksRegistered) {
        res.status(inviteRes.status).json({ error: message || 'Invite failed' });
        return;
      }
      // Adding an existing account to a city team is the useful outcome here.
      // Re-inviting an existing account as an admin is not, so that still fails.
      if (role !== 'city_editor') {
        res.status(409).json({ error: 'That address already has an account.' });
        return;
      }
      userId = await findExistingUserId();
      alreadyExisted = true;
      if (!userId) {
        res.status(409).json({ error: 'That address already has an account, but it could not be located.' });
        return;
      }
    }

    // Never demote: an owner or admin added to a city team keeps their role and
    // just gains the membership. upsert with ignoreDuplicates leaves any
    // existing row untouched.
    await fetch(SUPABASE_URL + '/rest/v1/user_roles', {
      method: 'POST',
      headers: Object.assign({}, serviceHeaders, {
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      }),
      body: JSON.stringify({ user_id: userId, role: role, status: 'active', email: email })
    });

    if (role === 'city_editor') {
      var memberRes = await fetch(SUPABASE_URL + '/rest/v1/city_team_members', {
        method: 'POST',
        headers: Object.assign({}, serviceHeaders, {
          Prefer: 'resolution=ignore-duplicates,return=minimal'
        }),
        body: JSON.stringify({ user_id: userId, city_id: cityId, added_by: caller.id })
      });
      if (!memberRes.ok) {
        var memberErr = await memberRes.json().catch(function () { return {}; });
        res.status(memberRes.status).json({
          error: memberErr.message || 'Could not add that person to the city team'
        });
        return;
      }
    }

    res.status(200).json({ ok: true, existing: alreadyExisted });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error sending invite' });
  }
};
