// Approves or denies a request to run a city's coverage. Staff only.
//
// Approving is the step that creates a city owner, so it does several things
// that must not half-happen:
//
//   1. records the decision on the claim
//   2. sets the city active, with the governance type staff chose
//   3. creates (or finds) the requester's login
//   4. makes them the city's owner in city_memberships
//   5. emails them a link to set a password
//
// Postgres has no transaction across these -- steps 3 and 5 are Auth and
// Resend, not SQL -- so the order is chosen so that a failure leaves the least
// confusing state: the membership is written before the email, and the city is
// only flipped to active once the membership exists. A failed email leaves a
// working account whose owner can use "forgot password"; a failed membership
// leaves the city pending and the claim still open.
//
// Denying returns the city to 'unclaimed' so somebody else can ask for it.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured to decide claims' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var body = req.body || {};
  var claimId = body.claim_id;
  var action = body.action;
  var governance = body.governance;
  var denialReason = typeof body.denial_reason === 'string' ? body.denial_reason.trim() : '';

  if (!claimId || (action !== 'approve' && action !== 'deny')) {
    res.status(400).json({ error: 'A claim and an action are required.' });
    return;
  }
  if (action === 'approve' && governance !== 'district' && governance !== 'at-large') {
    res.status(400).json({
      error: 'Choose how this city elects its seats before approving — the map cannot render honestly without it.'
    });
    return;
  }

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // ---------- who is asking ----------
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
    if (!callerRole || callerRole.status !== 'active' ||
        (callerRole.role !== 'owner' && callerRole.role !== 'admin')) {
      res.status(403).json({ error: 'Only staff can decide claims' });
      return;
    }

    // ---------- the claim ----------
    var claimRes = await fetch(
      SUPABASE_URL + '/rest/v1/claim_requests?id=eq.' + encodeURIComponent(claimId) + '&select=*',
      { headers: serviceHeaders }
    );
    var claimRows = await claimRes.json();
    var claim = claimRows && claimRows[0];
    if (!claim) {
      res.status(404).json({ error: 'That claim no longer exists.' });
      return;
    }
    if (claim.status !== 'pending') {
      res.status(409).json({ error: 'That claim has already been decided.' });
      return;
    }

    var cityRes = await fetch(
      SUPABASE_URL + '/rest/v1/cities?slug=eq.' + encodeURIComponent(claim.city_slug) + '&select=id,slug,name,status',
      { headers: serviceHeaders }
    );
    var cityRows = await cityRes.json();
    var city = cityRows && cityRows[0];
    if (!city) {
      res.status(404).json({ error: 'The city on that claim no longer exists.' });
      return;
    }

    // ---------- deny ----------
    if (action === 'deny') {
      await patch(SUPABASE_URL, serviceHeaders,
        '/rest/v1/claim_requests?id=eq.' + encodeURIComponent(claimId), {
          status: 'denied',
          denial_reason: denialReason || null,
          reviewed_by: caller.id,
          reviewed_at: new Date().toISOString()
        });

      // Back on the board for somebody else.
      await patch(SUPABASE_URL, serviceHeaders,
        '/rest/v1/cities?id=eq.' + city.id, {
          status: 'unclaimed',
          updated_at: new Date().toISOString()
        });

      await emailDenial(claim, denialReason);
      res.status(200).json({ ok: true, action: 'deny' });
      return;
    }

    // ---------- approve ----------
    // An account first, because the membership needs a user id.
    var userId = await inviteOrFindUser(SUPABASE_URL, serviceHeaders, claim.requester_email);
    if (!userId) {
      res.status(500).json({ error: 'Could not create a login for that address.' });
      return;
    }

    var memberRes = await fetch(SUPABASE_URL + '/rest/v1/city_memberships', {
      method: 'POST',
      headers: Object.assign({}, serviceHeaders, {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify({
        user_id: userId,
        city_id: city.id,
        role: 'owner',
        invited_by: caller.id
      })
    });
    if (!memberRes.ok) {
      var memberErr = await memberRes.json().catch(function () { return {}; });
      // The commonest cause is the one-owner-per-city index: somebody else
      // already owns it. Say that rather than a constraint name.
      res.status(409).json({
        error: memberErr.message && /city_memberships_one_owner/.test(memberErr.message)
          ? 'That city already has an owner. Transfer ownership instead.'
          : (memberErr.message || 'Could not make them the owner.')
      });
      return;
    }

    // Only now is it safe to make the city live: it has an owner.
    var cityPatch = await patch(SUPABASE_URL, serviceHeaders,
      '/rest/v1/cities?id=eq.' + city.id, {
        status: 'active',
        governance: governance,
        updated_at: new Date().toISOString()
      });
    if (!cityPatch.ok) {
      var cityErr = await cityPatch.json().catch(function () { return {}; });
      res.status(500).json({ error: cityErr.message || 'Could not activate that city.' });
      return;
    }

    await patch(SUPABASE_URL, serviceHeaders,
      '/rest/v1/claim_requests?id=eq.' + encodeURIComponent(claimId), {
        status: 'approved',
        reviewed_by: caller.id,
        reviewed_at: new Date().toISOString()
      });

    var loginLink = await generateLoginLink(SUPABASE_URL, serviceHeaders, claim.requester_email);
    await emailApproval(claim, city, loginLink);

    res.status(200).json({ ok: true, action: 'approve', city_id: city.id });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error deciding that claim.' });
  }
};

// ---------- helpers ----------
async function patch(SUPABASE_URL, headers, path, payload) {
  return fetch(SUPABASE_URL + path, {
    method: 'PATCH',
    headers: Object.assign({}, headers, { Prefer: 'return=minimal' }),
    body: JSON.stringify(payload)
  });
}

// Returns the user id for this address, creating an account if there isn't
// one. An address that already has a login (a student who volunteered on
// another city first) is reused rather than rejected.
async function inviteOrFindUser(SUPABASE_URL, headers, email) {
  var inviteRes = await fetch(SUPABASE_URL + '/auth/v1/invite', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ email: email })
  });
  var inviteData = await inviteRes.json().catch(function () { return {}; });
  if (inviteRes.ok && inviteData.id) return inviteData.id;

  var byRole = await fetch(
    SUPABASE_URL + '/rest/v1/user_roles?email=eq.' + encodeURIComponent(email) + '&select=user_id',
    { headers: headers }
  );
  var rows = await byRole.json().catch(function () { return []; });
  if (rows && rows[0] && rows[0].user_id) return rows[0].user_id;

  var byAuth = await fetch(
    SUPABASE_URL + '/auth/v1/admin/users?filter=' + encodeURIComponent(email),
    { headers: headers }
  );
  if (!byAuth.ok) return null;
  var authData = await byAuth.json().catch(function () { return {}; });
  var users = (authData && authData.users) || [];
  for (var i = 0; i < users.length; i++) {
    if (users[i].email && users[i].email.toLowerCase() === email.toLowerCase()) {
      return users[i].id;
    }
  }
  return null;
}

// A recovery link doubles as a set-password link for a brand new account, and
// unlike the invite email it can be embedded in our own message.
async function generateLoginLink(SUPABASE_URL, headers, email) {
  try {
    var r = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        type: 'recovery',
        email: email,
        options: { redirect_to: 'https://www.miamidadecommissionwatch.com/set-password.html' }
      })
    });
    if (!r.ok) return null;
    var data = await r.json();
    return data.action_link || (data.properties && data.properties.action_link) || null;
  } catch (err) {
    return null;
  }
}

async function emailApproval(claim, city, loginLink) {
  var subdomain = 'https://' + city.slug + '.miamidadecommissionwatch.com/';
  var html = [
    '<p>Hi ' + escapeHtml(claim.requester_name) + ',</p>',
    '<p>Your request to cover <strong>' + escapeHtml(city.name) +
      '</strong> has been approved. The site is live at ' +
      '<a href="' + subdomain + '">' + escapeHtml(subdomain) + '</a>, and it is yours to run.</p>',
    loginLink
      ? '<p><a href="' + loginLink + '">Set your password and sign in</a>. That link is single-use ' +
        'and expires — if it has, use “Forgot your password?” on the login page.</p>'
      : '<p>Set a password using “Forgot your password?” at ' +
        '<a href="https://www.miamidadecommissionwatch.com/login.html">the login page</a>.</p>',
    '<p>Once you are in, you can add your commissioners, post meeting summaries, ' +
      'write the public comment guide, and invite other students to help. ' +
      'What you publish goes live immediately — nobody reviews it first, so the ' +
      'standards are on you: nonpartisan, sourced, no endorsements.</p>',
    '<p>— Miami-Dade Commission Watch</p>'
  ].join('\n');

  await send(claim.requester_email, 'You’re running ' + city.name + ' Commission Watch', html);
}

async function emailDenial(claim, reason) {
  var html = [
    '<p>Hi ' + escapeHtml(claim.requester_name) + ',</p>',
    '<p>Thanks for asking to cover <strong>' + escapeHtml(claim.city_name) +
      '</strong>. We aren’t able to approve it right now.</p>',
    reason ? '<p>' + escapeHtml(reason).replace(/\n/g, '<br>') + '</p>' : '',
    '<p>That city is open again, so this isn’t final — you’re welcome to ask again later, ' +
      'or <a href="https://www.miamidadecommissionwatch.com/contact.html">get in touch</a> ' +
      'if you want to talk it through.</p>',
    '<p>— Miami-Dade Commission Watch</p>'
  ].join('\n');

  await send(claim.requester_email, 'About your request to cover ' + claim.city_name, html);
}

async function send(to, subject, html) {
  var RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Commission Watch <noreply@miamidadecommissionwatch.com>',
        to: [to],
        subject: subject,
        html: html
      })
    });
  } catch (err) {
    // The decision is already recorded; a mail failure must not undo it.
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
