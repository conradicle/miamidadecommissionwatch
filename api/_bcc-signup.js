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

// MDCPS student IDs are 7 digits. The single place that is set: the database
// only checks for 5 to 12 digits, and js/attend.js only checks for digits, so
// changing this one number is all a correction takes.
var STUDENT_ID_LENGTH = 7;

var botCheck = require('./_bot-check.js');

var LIMITS = { full_name: 120, school_name: 200, school_email: 254 };

// "Where do you go to school?" on /attend. Each answer requires different
// fields; migration_33 enforces the same rules in the database.
var SCHOOL_TYPES = { mdcps: true, mdc: true, other: true };
var MDC_EMAIL = /^[^@\s]+@mymdc\.net$/;
var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  // Missing type remains the existing meeting registration contract.
  var type = body.registration_type || 'meeting_registration';
  if (type !== 'meeting_registration' && type !== 'meeting_interest') {
    return fieldError(res, 'registration_type', 'Unknown registration type.');
  }
  res.setHeader('Cache-Control', 'no-store');

  // Honeypot, time on page, then Turnstile, before any field is read. A
  // failure here never says which; the reason is in the function log.
  var bot = await botCheck.check(req, body, 'bcc-signup');
  if (!bot.ok) {
    res.status(403).json({ error: botCheck.MESSAGE, retryTurnstile: true });
    return;
  }

  if (type === 'meeting_interest') return saveInterest(req, res, body);

  var fullName = str(body.full_name).replace(/\s+/g, ' ');
  var phone = normalizePhone(body.phone);
  var schoolType = str(body.school_type);
  var studentId = str(body.mdcps_student_id).replace(/\s/g, '');
  var schoolName = str(body.school_name).replace(/\s+/g, ' ');
  var schoolEmail = str(body.school_email).toLowerCase();
  var comment = str(body.wants_public_comment).toLowerCase();
  var meetingDate = str(body.meeting_date);

  if (fullName.length < 2 || fullName.length > LIMITS.full_name) {
    return fieldError(res, 'full_name', 'Please enter your full name.');
  }
  if (phone.length !== 10) {
    return fieldError(res, 'phone', 'Please enter a 10-digit phone number.');
  }
  if (!Object.prototype.hasOwnProperty.call(SCHOOL_TYPES, schoolType)) {
    return fieldError(res, 'school_type', 'Please choose where you go to school.');
  }
  if (schoolType === 'mdcps' && !new RegExp('^[0-9]{' + STUDENT_ID_LENGTH + '}$').test(studentId)) {
    return fieldError(res, 'mdcps_student_id', 'Your MDCPS student ID is ' + STUDENT_ID_LENGTH + ' digits, numbers only.');
  }
  if (schoolType === 'mdc' && (!MDC_EMAIL.test(schoolEmail) || schoolEmail.length > LIMITS.school_email)) {
    return fieldError(res, 'school_email', 'Enter your Miami Dade College email, ending in @mymdc.net.');
  }
  if (schoolType === 'other') {
    if (schoolName.length < 2 || schoolName.length > LIMITS.school_name) {
      return fieldError(res, 'school_name', 'Please enter the name of your school.');
    }
    if (!EMAIL.test(schoolEmail) || schoolEmail.length > LIMITS.school_email) {
      return fieldError(res, 'school_email', 'Please enter your school email.');
    }
  }
  if (!Object.prototype.hasOwnProperty.call(COMMENT_CHOICES, comment)) {
    return fieldError(res, 'wants_public_comment', 'Please choose yes, no, or maybe.');
  }
  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    var ip = clientIp(req);

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

    // One sign-up per person per meeting: MDCPS students by student ID,
    // college students by school email (both unique per meeting, migration_33).
    // Fields that don't belong to the chosen school type are saved as null.
    var conflictKey = schoolType === 'mdcps' ? 'meeting_id,mdcps_student_id' : 'meeting_id,school_email';
    var insertRes = await fetch(
      SUPABASE_URL + '/rest/v1/bcc_signups?on_conflict=' + conflictKey,
      {
        method: 'POST',
        headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, serviceHeaders),
        body: JSON.stringify({
          meeting_id: meeting.id,
          full_name: fullName,
          phone: phone,
          school_type: schoolType,
          mdcps_student_id: schoolType === 'mdcps' ? studentId : null,
          school_name: schoolType === 'other' ? schoolName : null,
          school_email: schoolType === 'mdcps' ? null : schoolEmail,
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

function normalizePhone(value) {
  var digits = str(value).replace(/\D/g, '');
  return digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
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

// Same endpoint, bot checks, rate-limit RPC and service-role storage as the
// meeting form. No newsletter writes or email calls. Ignore duplicates so an
// unverified resubmission cannot change somebody else's details or undo removal.
async function saveInterest(req, res, body) {
  var name = str(body.full_name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  var phone = normalizePhone(body.phone);
  var school = str(body.school_name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  var comment = str(body.public_comment_interest);
  if (name.length < 2 || name.length > 120) return fieldError(res, 'full_name', 'Please enter your full name.');
  if (phone.length !== 10 || !/^[+0-9(). -]+$/.test(str(body.phone))) return fieldError(res, 'phone', 'Please enter a 10-digit mobile phone number.');
  if (school.length > 200) return fieldError(res, 'school_name', 'Please use a school name of 200 characters or fewer.');
  if (comment && ['yes', 'maybe', 'no'].indexOf(comment) === -1) return fieldError(res, 'public_comment_interest', 'Please choose one of the listed options.');
  if (body.notification_consent !== true) return fieldError(res, 'notification_consent', 'Please agree to meeting participation texts to join the list.');
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var headers = { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' };
  try {
    // Fail closed for this list: no new registrations if the limiter is down.
    var rate = await fetch(url + '/rest/v1/rpc/check_rate_limit', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ p_key: 'bcc-interest:' + clientIp(req), p_limit: 20, p_window_seconds: 3600 })
    });
    if (!rate.ok) throw new Error('rate-limit unavailable');
    if (await rate.json() !== true) {
      res.status(429).json({ error: 'Too many attempts from this connection. Please try again in an hour.' });
      return;
    }
    var saved = await fetch(url + '/rest/v1/bcc_meeting_interest?on_conflict=phone', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'resolution=ignore-duplicates,return=minimal' }, headers),
      body: JSON.stringify({ full_name: name, phone: phone, school_name: school || null,
        public_comment_interest: comment || null, notification_consent: true,
        consent_version: 'meeting-participation-sms-v1', registration_type: 'meeting_interest' })
    });
    if (!saved.ok) throw new Error('storage unavailable');
    // Same answer for a new, existing, or suppressed number.
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: 'Could not save your interest. Please try again.' });
  }
}
