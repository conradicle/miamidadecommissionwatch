// Staff-only operations that need the service role: provisioning a city's
// subdomain, transferring ownership, and deciding a pending volunteer invite.
//
// All three are here rather than done from the browser because each needs
// something the anon or user key cannot do -- calling Cloudflare and Vercel,
// looking a person up by email in Auth, or creating a login. Every one of them
// verifies the caller is active staff first; none of them trusts an id from
// the request body without checking what it points at.
var provisionSubdomain = require('./_provision-domain.js');
var createOrFindAccount = require('./_account-link.js');

module.exports = async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var body = req.body || {};
  var op = body.op;

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // ---------- caller must be active staff ----------
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
      res.status(403).json({ error: 'Only staff can do that.' });
      return;
    }

    // ---------- provision a subdomain ----------
    if (op === 'provision_domain') {
      var city = await getCity(SUPABASE_URL, serviceHeaders, body.city_id);
      if (!city) { res.status(404).json({ error: 'That city no longer exists.' }); return; }

      var provisioned = await provisionSubdomain(city.slug);
      res.status(provisioned.ok ? 200 : 502).json(provisioned);
      return;
    }

    // ---------- transfer ownership ----------
    // Two writes that must not half-happen: the old owner is demoted and the
    // new one promoted. There is a partial unique index allowing one owner per
    // city, so the demote has to land first -- promoting first would be
    // rejected by the index and leave the city with its original owner and a
    // confusing error.
    if (op === 'transfer_ownership') {
      var targetCity = await getCity(SUPABASE_URL, serviceHeaders, body.city_id);
      if (!targetCity) { res.status(404).json({ error: 'That city no longer exists.' }); return; }

      var email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        res.status(400).json({ error: 'A valid email address is required.' });
        return;
      }

      var newOwner = await createOrFindAccount(SUPABASE_URL, serviceHeaders, email);
      var newOwnerId = newOwner.userId;
      if (!newOwnerId) {
        res.status(500).json({ error: 'Could not find or create a login for that address.' });
        return;
      }

      // Demote whoever owns it now. Also covers "nobody owns it", which is a
      // no-op rather than an error.
      await fetch(SUPABASE_URL + '/rest/v1/city_memberships?city_id=eq.' +
        encodeURIComponent(targetCity.id) + '&role=eq.owner', {
        method: 'PATCH',
        headers: Object.assign({}, serviceHeaders, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ role: 'editor' })
      });

      // If the new owner was already an editor here, promote that row rather
      // than inserting a second one for the same person.
      var upsert = await fetch(SUPABASE_URL + '/rest/v1/city_memberships', {
        method: 'POST',
        headers: Object.assign({}, serviceHeaders, {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify({
          user_id: newOwnerId,
          city_id: targetCity.id,
          role: 'owner',
          invited_by: caller.id
        })
      });
      if (!upsert.ok) {
        var upsertErr = await upsert.json().catch(function () { return {}; });
        res.status(500).json({ error: upsertErr.message || 'Could not transfer ownership.' });
        return;
      }

      var link = newOwner.link;
      await send(email, 'You now run ' + targetCity.name + ' Commission Watch', [
        '<p>You’ve been made the owner of <strong>' + escapeHtml(targetCity.name) +
          '</strong> on Miami-Dade Commission Watch.</p>',
        link ? '<p><a href="' + link + '">Set your password and sign in</a>.</p>'
             : '<p>Sign in at <a href="https://www.miamidadecommissionwatch.com/login.html">the login page</a>.</p>',
        '<p>You can publish this city’s officials and meetings directly, and invite other ' +
          'students as editors.</p>'
      ].join('\n'));

      res.status(200).json({ ok: true });
      return;
    }

    // ---------- approve or deny a pending volunteer invite ----------
    // Only reachable when REQUIRE_STAFF_APPROVAL_FOR_INVITES is on; without
    // this the flag would write pending rows nobody could act on.
    if (op === 'decide_invite') {
      var decision = body.decision;
      if (decision !== 'approve' && decision !== 'deny') {
        res.status(400).json({ error: 'A decision is required.' });
        return;
      }

      var inviteRes = await fetch(
        SUPABASE_URL + '/rest/v1/city_invites?id=eq.' + encodeURIComponent(body.invite_id) + '&select=*',
        { headers: serviceHeaders }
      );
      var inviteRows = await inviteRes.json();
      var invite = inviteRows && inviteRows[0];
      if (!invite) { res.status(404).json({ error: 'That invite no longer exists.' }); return; }
      if (invite.status !== 'pending') {
        res.status(409).json({ error: 'That invite has already been decided.' });
        return;
      }

      if (decision === 'deny') {
        await patch(SUPABASE_URL, serviceHeaders,
          '/rest/v1/city_invites?id=eq.' + encodeURIComponent(invite.id),
          { status: 'denied', reviewed_by: caller.id, reviewed_at: new Date().toISOString() });
        res.status(200).json({ ok: true, decision: 'deny' });
        return;
      }

      var inviteCity = await getCity(SUPABASE_URL, serviceHeaders, invite.city_id);
      if (!inviteCity) { res.status(404).json({ error: 'That city no longer exists.' }); return; }

      var editor = await createOrFindAccount(SUPABASE_URL, serviceHeaders, invite.email);
      var editorId = editor.userId;
      if (!editorId) {
        res.status(500).json({ error: 'Could not create a login for that address.' });
        return;
      }

      await fetch(SUPABASE_URL + '/rest/v1/city_memberships', {
        method: 'POST',
        headers: Object.assign({}, serviceHeaders, {
          Prefer: 'resolution=ignore-duplicates,return=minimal'
        }),
        body: JSON.stringify({
          user_id: editorId,
          city_id: invite.city_id,
          role: 'editor',
          invited_by: invite.requested_by || caller.id
        })
      });

      await patch(SUPABASE_URL, serviceHeaders,
        '/rest/v1/city_invites?id=eq.' + encodeURIComponent(invite.id),
        { status: 'sent', reviewed_by: caller.id, reviewed_at: new Date().toISOString() });

      var editorLink = editor.link;
      await send(invite.email, 'You’re on the ' + inviteCity.name + ' team', [
        '<p>You’ve been added to the student team covering <strong>' +
          escapeHtml(inviteCity.name) + '</strong>.</p>',
        editorLink ? '<p><a href="' + editorLink + '">Set your password and sign in</a>.</p>'
                   : '<p>Sign in at <a href="https://www.miamidadecommissionwatch.com/login.html">the login page</a>.</p>',
        '<p>What you save stays a draft until the team’s owner publishes it.</p>'
      ].join('\n'));

      res.status(200).json({ ok: true, decision: 'approve' });
      return;
    }

    res.status(400).json({ error: 'Unknown operation' });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error.' });
  }
};

// ---------- helpers ----------
async function getCity(SUPABASE_URL, headers, cityId) {
  if (!cityId) return null;
  var r = await fetch(
    SUPABASE_URL + '/rest/v1/cities?id=eq.' + encodeURIComponent(cityId) + '&select=id,slug,name,status',
    { headers: headers }
  );
  var rows = await r.json().catch(function () { return []; });
  return (rows && rows[0]) || null;
}

async function patch(SUPABASE_URL, headers, path, payload) {
  return fetch(SUPABASE_URL + path, {
    method: 'PATCH',
    headers: Object.assign({}, headers, { Prefer: 'return=minimal' }),
    body: JSON.stringify(payload)
  });
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
        from: process.env.MAIL_FROM || 'Miami-Dade Commission Watch <news@miamidadecommissionwatch.com>',
        to: [to],
        subject: subject,
        html: html + '\n<p>— Miami-Dade Commission Watch</p>'
      })
    });
  } catch (err) {
    // The change is already recorded; a mail failure must not undo it.
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
