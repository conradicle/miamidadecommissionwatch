// Receives a sign-up for the next BCC meeting from /attend.
//
// Runs server-side with the service role, behind Cloudflare Turnstile, rather
// than letting the browser insert: bcc_signups holds minors' phone numbers and
// student IDs, and migration_29 gives anon no INSERT on it at all, so this is
// the only way in. Reached through api/city-platform.js (op
// submit_bcc_signup) because of the 12-function ceiling noted there.
//
// The meeting comes from the database, not the request. The browser sends the
// date it was showing only so we can tell the student if staff closed that
// meeting or opened a different one while the form sat open. The open-and-
// not-closed rule is also a trigger in migration_29, so a sign-up for a
// closed meeting cannot land even if this check were skipped.

// MDCPS student ID length. The single place it is set: the database only
// checks for 5 to 12 digits, and js/attend.js only checks for digits, so
// changing this one number is all a correction takes.
// TODO(Conrad): confirm the exact length. 7 is a placeholder.
var STUDENT_ID_LENGTH = 7;

var LIMITS = { full_name: 120 };

var COMMENT_CHOICES = { yes: true, no: false, maybe: null };

module.exports = async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TURNSTILE_SECRET_KEY) {
    res.status(500).json({ error: 'Sign-ups aren’t set up on the server yet. Please DM us on Instagram.' });
    return;
  }

  var body = req.body || {};
  var fullName = str(body.full_name).replace(/\s+/g, ' ');
  var phone = str(body.phone).replace(/\D/g, '');
  if (phone.length === 11 && phone.charAt(0) === '1') phone = phone.slice(1);
  var studentId = str(body.mdcps_student_id).replace(/\s/g, '');
  var comment = str(body.wants_public_comment).toLowerCase();
  var meetingDate = str(body.meeting_date);
  var token = str(body.turnstile_token);

  if (fullName.length < 2 || fullName.length > LIMITS.full_name) {
    return fieldError(res, 'full_name', 'Please enter your full name.');
  }
  if (phone.length !== 10) {
    return fieldError(res, 'phone', 'Please enter a 10-digit phone number.');
  }
  if (!new RegExp('^[0-9]{' + STUDENT_ID_LENGTH + '}$').test(studentId)) {
    return fieldError(res, 'mdcps_student_id', 'Your MDCPS student ID is ' + STUDENT_ID_LENGTH + ' digits, numbers only.');
  }
  if (!Object.prototype.hasOwnProperty.call(COMMENT_CHOICES, comment)) {
    return fieldError(res, 'wants_public_comment', 'Please choose yes, no, or maybe.');
  }
  if (!token) {
    res.status(400).json({ error: 'Please complete the security check above the button.' });
    return;
  }

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    var ip = clientIp(req);

    // Turnstile first: it is the real gate, and a failed check shouldn't
    // spend the rate limit budget of a whole school's shared wifi.
    var human = await verifyTurnstile(TURNSTILE_SECRET_KEY, token, ip);
    if (!human) {
      res.status(403).json({ error: 'The security check didn’t go through. Please try it again.', retryTurnstile: true });
      return;
    }

    // Twenty an hour per IP. A class signing up together from one school
    // network is the case to leave room for; Turnstile stops scripts.
    var allowed = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, 'bcc-signup:' + ip, 20, 3600);
    if (!allowed) {
      res.status(429).json({ error: 'Too many sign-ups from this connection. Please try again in an hour, or DM us on Instagram.' });
      return;
    }

    var meetingRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/next_bcc_meeting_for_signup', {
      method: 'POST', headers: serviceHeaders, body: '{}'
    });
    var meetingRows = meetingRes.ok ? await meetingRes.json() : null;
    if (!meetingRows) {
      res.status(500).json({ error: 'Could not save your sign-up. Please try again.' });
      return;
    }
    var meeting = meetingRows[0];
    if (!meeting) {
      res.status(409).json({ error: 'Sign-ups for this meeting just closed. Follow us on Instagram to hear about the next one.', closed: true });
      return;
    }
    if (meetingDate && meetingDate !== meeting.meeting_date) {
      res.status(409).json({ error: 'The meeting on this page changed since you opened it. Reload to see the current one.', stale: true });
      return;
    }

    var insertRes = await fetch(
      SUPABASE_URL + '/rest/v1/bcc_signups?on_conflict=meeting_id,mdcps_student_id',
      {
        method: 'POST',
        headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, serviceHeaders),
        body: JSON.stringify({
          meeting_id: meeting.id,
          full_name: fullName,
          phone: phone,
          mdcps_student_id: studentId,
          wants_public_comment: COMMENT_CHOICES[comment]
        })
      }
    );

    if (!insertRes.ok) {
      var detail = await insertRes.text();
      if (/closed/i.test(detail)) {
        res.status(409).json({ error: 'Sign-ups for this meeting just closed. Follow us on Instagram to hear about the next one.', closed: true });
        return;
      }
      res.status(500).json({ error: 'Could not save your sign-up. Please try again.' });
      return;
    }

    // Best-effort upkeep: delete sign-ups 30 days past their meeting. pg_cron
    // does this daily when it's enabled (migration_29); this keeps the promise
    // on /attend true even when it isn't.
    try {
      await fetch(SUPABASE_URL + '/rest/v1/rpc/purge_expired_bcc_signups', {
        method: 'POST', headers: serviceHeaders, body: '{}'
      });
    } catch (purgeErr) {
      // swallow -- the sign-up already succeeded
    }

    res.status(200).json({ ok: true, meeting_date: meeting.meeting_date });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error saving your sign-up. Please try again.' });
  }
};

function fieldError(res, field, message) {
  res.status(400).json({ error: message, field: field });
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Vercel sets x-forwarded-for to "client, proxy1, proxy2, ...";
// the first entry is the original client.
function clientIp(req) {
  var forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Fails closed: if Cloudflare can't be reached, the sign-up is refused and
// the student is asked to retry, rather than letting unverified traffic in.
async function verifyTurnstile(secret, token, ip) {
  var form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    var r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form
    });
    if (!r.ok) return false;
    var data = await r.json();
    return data.success === true;
  } catch (err) {
    return false;
  }
}

async function checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, key, limit, windowSeconds) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_rate_limit', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
  });
  if (!r.ok) return true; // fail open -- a rate-limit outage shouldn't block a real student
  return await r.json();
}
