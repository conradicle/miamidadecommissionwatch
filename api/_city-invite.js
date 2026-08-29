// A city owner invites a volunteer editor onto their own city.
//
// Needs the service role (creating a login is an Auth admin call), so the
// caller is verified here rather than trusted: the token must belong to
// somebody who holds the OWNER role on the city named in the body. An editor
// cannot invite, and an owner cannot invite onto a city that isn't theirs --
// the city_id is checked against city_memberships, not taken on faith.
//
// REQUIRE_STAFF_APPROVAL_FOR_INVITES decides what "invite" means:
//   false (default)  the account is created and the membership written now
//   true             a pending row goes to city_invites for staff to approve,
//                    and nothing else happens
// The flag is read per request, so flipping it in Vercel takes effect on the
// next deploy without a code change.
var createOrFindAccount = require('./_account-link.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for invites' });
    return;
  }

  var requireApproval = process.env.REQUIRE_STAFF_APPROVAL_FOR_INVITES === 'true';

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var body = req.body || {};
  var cityId = body.city_id;
  var email = typeof body.email === 'string' ? body.email.trim() : '';

  if (!cityId || !email) {
    res.status(400).json({ error: 'A city and an email address are required.' });
    return;
  }
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'That email address doesn’t look right.' });
    return;
  }

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // ---------- who is asking, and do they own this city ----------
    var callerRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SERVICE_ROLE_KEY }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    var caller = await callerRes.json();

    var memberRes = await fetch(
      SUPABASE_URL + '/rest/v1/city_memberships?user_id=eq.' + caller.id +
        '&city_id=eq.' + encodeURIComponent(cityId) + '&select=role',
      { headers: serviceHeaders }
    );
    var memberRows = await memberRes.json();
    var membership = memberRows && memberRows[0];

    // Staff can invite onto any city; otherwise it must be the owner of this
    // one. Checked server-side against the membership table, so a forged
    // city_id gets nowhere.
    var isStaff = await callerIsStaff(SUPABASE_URL, serviceHeaders, caller.id);
    if (!isStaff && (!membership || membership.role !== 'owner')) {
      res.status(403).json({ error: 'Only the owner of this city can invite people to it.' });
      return;
    }

    // Each invite creates a real auth account, so an owner gets 10 a day.
    // Generous for a student newsroom, and a ceiling on the damage if an
    // owner account is ever taken over.
    var withinLimit = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY,
      'cityinvite:' + caller.id, 10, 86400);
    if (!withinLimit) {
      res.status(429).json({
        error: 'That is a lot of invites for one day. Try again tomorrow, or ask staff.'
      });
      return;
    }

    var cityRes = await fetch(
      SUPABASE_URL + '/rest/v1/cities?id=eq.' + encodeURIComponent(cityId) + '&select=id,name,slug,status',
      { headers: serviceHeaders }
    );
    var cityRows = await cityRes.json();
    var city = cityRows && cityRows[0];
    if (!city) {
      res.status(404).json({ error: 'That city no longer exists.' });
      return;
    }
    if (city.status === 'suspended') {
      res.status(409).json({ error: 'This city is suspended, so its team can’t be changed right now.' });
      return;
    }

    // ---------- the flag ----------
    if (requireApproval) {
      var pendingRes = await fetch(SUPABASE_URL + '/rest/v1/city_invites', {
        method: 'POST',
        headers: Object.assign({}, serviceHeaders, { Prefer: 'return=minimal' }),
        body: JSON.stringify({
          city_id: city.id,
          email: email,
          role: 'editor',
          status: 'pending',
          requested_by: caller.id
        })
      });
      if (!pendingRes.ok) {
        var pendingErr = await pendingRes.json().catch(function () { return {}; });
        res.status(500).json({ error: pendingErr.message || 'Could not file that invite.' });
        return;
      }
      res.status(200).json({ ok: true, pending: true });
      return;
    }

    // ---------- invite now ----------
    var account = await createOrFindAccount(SUPABASE_URL, serviceHeaders, email);
    var userId = account.userId;
    if (!userId) {
      res.status(500).json({ error: 'Could not create a login for that address.' });
      return;
    }

    // merge-duplicates so re-inviting somebody already on the team is a no-op
    // rather than an error, and so an existing OWNER is never demoted to
    // editor by a careless re-invite.
    var existing = await fetch(
      SUPABASE_URL + '/rest/v1/city_memberships?user_id=eq.' + userId +
        '&city_id=eq.' + encodeURIComponent(cityId) + '&select=role',
      { headers: serviceHeaders }
    );
    var existingRows = await existing.json();
    if (existingRows && existingRows[0]) {
      res.status(200).json({ ok: true, already: true });
      return;
    }

    var insertRes = await fetch(SUPABASE_URL + '/rest/v1/city_memberships', {
      method: 'POST',
      headers: Object.assign({}, serviceHeaders, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        user_id: userId,
        city_id: city.id,
        role: 'editor',
        invited_by: caller.id
      })
    });
    if (!insertRes.ok) {
      var insertErr = await insertRes.json().catch(function () { return {}; });
      res.status(500).json({ error: insertErr.message || 'Could not add them to the team.' });
      return;
    }

    await emailInvite(email, city, account.link);

    res.status(200).json({ ok: true, pending: false });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error sending that invite.' });
  }
};

async function callerIsStaff(SUPABASE_URL, headers, userId) {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + userId + '&select=role,status',
      { headers: headers }
    );
    var rows = await r.json();
    var row = rows && rows[0];
    return !!(row && row.status === 'active' && (row.role === 'owner' || row.role === 'admin'));
  } catch (err) {
    return false;
  }
}


async function emailInvite(email, city, loginLink) {
  var RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;

  var html = [
    '<p>You’ve been added to the student team covering <strong>' + escapeHtml(city.name) +
      '</strong> for Miami-Dade Commission Watch.</p>',
    loginLink
      ? '<p><a href="' + loginLink + '">Set your password and sign in</a>. That link is ' +
        'single-use and expires — if it has, use “Forgot your password?” on the login page.</p>'
      : '<p>Set a password using “Forgot your password?” at ' +
        '<a href="https://www.miamidadecommissionwatch.com/login.html">the login page</a>.</p>',
    '<p>As an editor you can write up meetings and add commissioners. What you save stays a ' +
      'draft until the team’s owner publishes it.</p>',
    '<p>— Miami-Dade Commission Watch</p>'
  ].join('\n');

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Miami-Dade Commission Watch <news@miamidadecommissionwatch.com>',
        to: [email],
        subject: 'You’re on the ' + city.name + ' team',
        html: html
      })
    });
  } catch (err) {
    // The membership is already written; a mail failure must not undo it.
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Shared with the claim intake: a Postgres-side counter, so it holds across
// the many short-lived instances a serverless function runs in.
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
    if (!r.ok) return true; // fail open -- a rate-limit outage shouldn't block real invites
    return await r.json();
  } catch (err) {
    return true;
  }
}
