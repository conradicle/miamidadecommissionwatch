// Receives a request from the public to run a city's coverage.
//
// This runs server-side with the service role rather than letting the browser
// write claim_requests directly, for two reasons: it can rate limit, and it
// can send the notification email. migration_18 revokes anon's INSERT on that
// table so this is the only route in.
//
// Nothing here trusts the caller. The city must already exist in the registry
// and must actually be unclaimed -- otherwise a crafted request could claim a
// city that already has a team, or invent a slug that later collides with a
// real one.
var botCheck = require('./_bot-check.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured to receive claims' });
    return;
  }

  var body = req.body || {};

  // On 2026-10-24 a scanner filed a fake claim for Bay Harbor Islands through
  // this form. Bots stop here, before anything is read or written.
  var bot = await botCheck.check(req, body, 'claim');
  if (!bot.ok) {
    res.status(400).json({ error: botCheck.MESSAGE });
    return;
  }

  var slug =typeof body.city_slug === 'string' ? body.city_slug.trim().toLowerCase() : '';
  var name = typeof body.requester_name === 'string' ? body.requester_name.trim() : '';
  var email = typeof body.requester_email === 'string' ? body.requester_email.trim() : '';
  var affiliation = typeof body.affiliation === 'string' ? body.affiliation.trim() : '';
  var reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  var hasTeam = body.has_team === true;

  if (!slug || !name || !email) {
    res.status(400).json({ error: 'Your name, email and a city are all required.' });
    return;
  }
  if (name.length > 120 || email.length > 200 || affiliation.length > 200 || reason.length > 2000) {
    res.status(400).json({ error: 'One of those fields is too long.' });
    return;
  }
  // Deliberately loose: the point is to catch a typo, not to adjudicate what
  // is a valid address. Delivery is the real test and they get an email.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'That email address doesn’t look right.' });
    return;
  }

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // Two claims per address per hour, three per IP per hour, and ten per IP
    // per day. The first stops someone spamming the same form; the others stop
    // one machine claiming every city in the county.
    var byEmail = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY,
      'claim:email:' + email.toLowerCase(), 2, 3600);
    if (!byEmail) {
      res.status(429).json({ error: 'You’ve already sent a request recently. Give us a little time to reply.' });
      return;
    }
    var byIpHour = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY,
      'claim:ip-hour:' + clientIp(req), 3, 3600);
    if (!byIpHour) {
      res.status(429).json({ error: "Too many requests from this connection. Please try again in an hour." });
      return;
    }
    var byIp = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY,
      'claim:ip:' + clientIp(req), 10, 86400);
    if (!byIp) {
      res.status(429).json({ error: 'Too many requests from this connection today.' });
      return;
    }

    // The city has to be in the registry and unclaimed. Anything else and the
    // request is rejected rather than filed against a city that has a team.
    var cityRes = await fetch(
      SUPABASE_URL + '/rest/v1/cities?slug=eq.' + encodeURIComponent(slug) + '&select=slug,name,status',
      { headers: serviceHeaders }
    );
    var cityRows = await cityRes.json();
    var city = cityRows && cityRows[0];

    if (!city) {
      res.status(404).json({ error: 'That city isn’t in our list.' });
      return;
    }
    if (city.status !== 'unclaimed') {
      res.status(409).json({
        error: city.status === 'active'
          ? 'That city already has a team covering it.'
          : 'Somebody has already requested that city.'
      });
      return;
    }

    var insertRes = await fetch(SUPABASE_URL + '/rest/v1/claim_requests', {
      method: 'POST',
      headers: Object.assign({}, serviceHeaders, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        city_slug: city.slug,
        city_name: city.name,
        requester_name: name,
        requester_email: email,
        affiliation: affiliation || null,
        reason: reason || null,
        has_team: hasTeam,
        status: 'pending'
      })
    });

    if (!insertRes.ok) {
      var insertErr = await insertRes.json().catch(function () { return {}; });
      res.status(500).json({ error: insertErr.message || 'Could not file that request.' });
      return;
    }

    // Mark the city as spoken for so it stops appearing as available while
    // the request is being considered.
    await fetch(SUPABASE_URL + '/rest/v1/cities?slug=eq.' + encodeURIComponent(city.slug), {
      method: 'PATCH',
      headers: Object.assign({}, serviceHeaders, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() })
    });

    // The claim is safely filed by this point, so a mail failure must not
    // fail the request -- the dashboard is the source of truth, the email is
    // only a nudge.
    await notifyStaff(city, { name: name, email: email, affiliation: affiliation, reason: reason, hasTeam: hasTeam });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error filing that request.' });
  }
};

async function notifyStaff(city, requester) {
  var RESEND_API_KEY = process.env.RESEND_API_KEY;
  var to = process.env.CLAIM_NOTIFICATION_EMAIL;
  if (!RESEND_API_KEY || !to) return;

  var lines = [
    '<p><strong>' + escapeHtml(requester.name) + '</strong> wants to cover <strong>' +
      escapeHtml(city.name) + '</strong>.</p>',
    '<p>Email: ' + escapeHtml(requester.email) + '<br>',
    'Affiliation: ' + escapeHtml(requester.affiliation || 'not given') + '<br>',
    'Has a team already: ' + (requester.hasTeam ? 'yes' : 'no') + '</p>'
  ];
  if (requester.reason) {
    lines.push('<p><em>Why they want it</em><br>' + escapeHtml(requester.reason).replace(/\n/g, '<br>') + '</p>');
  }
  lines.push('<p><a href="https://www.miamidadecommissionwatch.com/admin.html">Review it in the dashboard</a></p>');

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
        reply_to: requester.email,
        subject: 'City claim: ' + city.name,
        html: lines.join('\n')
      })
    });
  } catch (err) {
    // Swallowed on purpose -- see the call site.
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Vercel sets x-forwarded-for to "client, proxy1, proxy2, ...";
// the first entry is the original client.
function clientIp(req) {
  var forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

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
    if (!r.ok) return true; // fail open -- a rate-limit outage shouldn't block real requests
    return await r.json();
  } catch (err) {
    return true;
  }
}
