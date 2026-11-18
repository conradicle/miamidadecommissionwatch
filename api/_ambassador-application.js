// Receives a School Ambassador application from /ambassadors.
//
// Runs server-side with the service role, behind the shared bot checks,
// rather than letting the browser insert: ambassador_applications holds
// minors' names, emails and phone numbers, and migration_36 gives anon no
// access to it at all, so this is the only way in. Reached through
// api/city-platform.js (op submit_ambassador_application) because of the
// 12-function ceiling noted there.
//
// Every check here is also a constraint in migration_36, and js/ambassadors.js
// repeats them so the student hears about a problem before the round trip.
// If a limit changes, change all three.
//
// Applying never appoints anyone. The row is saved as 'new' (a trigger in
// migration_36 pins that) and the co-founders review it in the dashboard.

var botCheck = require('./_bot-check.js');

var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
var GRADES = { '9': true, '10': true, '11': true, '12': true, college: true };
var ABSENCE_ANSWERS = { yes: true, no: true, not_sure: true };
var YES_NO = { yes: true, no: false };
var MIN_GRAD_YEAR = 2026;
var MAX_GRAD_YEAR = 2036;
var MOTIVATION_MIN = 50;
var MOTIVATION_MAX = 1000;
var LONG_TEXT_MAX = 2000;
var MAX_TURNOUT = 5000;

module.exports = async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Applications are not set up on the server yet. Please DM us on Instagram.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  var body = req.body || {};

  // Honeypot, time on page, then Turnstile, before any field is read.
  var bot = await botCheck.check(req, body, 'ambassador');
  if (!bot.ok) {
    res.status(403).json({ error: botCheck.MESSAGE, retryTurnstile: true });
    return;
  }

  var v = {
    full_name: oneLine(body.full_name),
    email: str(body.email).toLowerCase(),
    phone: normalizePhone(body.phone),
    school_name: oneLine(body.school_name),
    grade: str(body.grade).toLowerCase(),
    graduation_year: toInt(body.graduation_year),
    attended: str(body.attended_bcc_with_mdcw).toLowerCase(),
    involvement: longText(body.involvement),
    motivation: longText(body.motivation),
    leadership_experience: longText(body.leadership_experience),
    expected_turnout: toInt(body.expected_turnout),
    knows_absence_contact: str(body.knows_absence_contact).toLowerCase(),
    guardian_name: oneLine(body.guardian_name),
    guardian_phone_raw: str(body.guardian_phone),
    guardian_phone: normalizePhone(body.guardian_phone)
  };

  if (v.full_name.length < 2 || v.full_name.length > 120) {
    return fieldError(res, 'full_name', 'Please enter your full name.');
  }
  if (!EMAIL.test(v.email) || v.email.length > 254) {
    return fieldError(res, 'email', 'Please enter a valid email address.');
  }
  if (v.phone.length !== 10) {
    return fieldError(res, 'phone', 'Please enter a 10-digit phone number.');
  }
  if (v.school_name.length < 2 || v.school_name.length > 200) {
    return fieldError(res, 'school_name', 'Please enter the name of your school.');
  }
  if (!has(GRADES, v.grade)) {
    return fieldError(res, 'grade', 'Please choose your grade.');
  }
  if (v.graduation_year === null || v.graduation_year < MIN_GRAD_YEAR || v.graduation_year > MAX_GRAD_YEAR) {
    return fieldError(res, 'graduation_year', 'Please enter a graduation year between ' + MIN_GRAD_YEAR + ' and ' + MAX_GRAD_YEAR + '.');
  }
  if (!has(YES_NO, v.attended)) {
    return fieldError(res, 'attended_bcc_with_mdcw', 'Please choose yes or no.');
  }
  if (v.involvement.length > LONG_TEXT_MAX) {
    return fieldError(res, 'involvement', 'Please keep this under ' + LONG_TEXT_MAX + ' characters.');
  }
  if (v.motivation.length < MOTIVATION_MIN || v.motivation.length > MOTIVATION_MAX) {
    return fieldError(res, 'motivation', 'Please write between ' + MOTIVATION_MIN + ' and ' + MOTIVATION_MAX + ' characters.');
  }
  if (v.leadership_experience.length > LONG_TEXT_MAX) {
    return fieldError(res, 'leadership_experience', 'Please keep this under ' + LONG_TEXT_MAX + ' characters.');
  }
  if (v.expected_turnout === null || v.expected_turnout < 0 || v.expected_turnout > MAX_TURNOUT) {
    return fieldError(res, 'expected_turnout', 'Please enter a number between 0 and ' + MAX_TURNOUT + '.');
  }
  if (!has(ABSENCE_ANSWERS, v.knows_absence_contact)) {
    return fieldError(res, 'knows_absence_contact', 'Please choose yes, no, or not sure.');
  }
  if (v.guardian_name && (v.guardian_name.length < 2 || v.guardian_name.length > 120)) {
    return fieldError(res, 'guardian_name', 'Please enter the full name, or leave this blank.');
  }
  if (v.guardian_phone_raw && v.guardian_phone.length !== 10) {
    return fieldError(res, 'guardian_phone', 'Please enter a 10-digit phone number, or leave this blank.');
  }
  if (body.acknowledged_duties !== true) {
    return fieldError(res, 'acknowledged_duties', 'Please check the box to confirm you understand the role.');
  }

  var headers = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // Ten an hour per IP: room for a few friends applying from one school
    // network, while Turnstile stops scripts.
    var allowed = await checkRateLimit(SUPABASE_URL, headers, 'ambassador:' + botCheck.clientIp(req), 10, 3600);
    if (!allowed) {
      res.status(429).json({ error: 'Too many applications from this connection. Please try again in an hour, or DM us on Instagram.' });
      return;
    }

    // status and submitted_at are left to the database (migration_36 pins
    // them on insert).
    var insertRes = await fetch(SUPABASE_URL + '/rest/v1/ambassador_applications', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=minimal' }, headers),
      body: JSON.stringify({
        full_name: v.full_name,
        email: v.email,
        phone: v.phone,
        school_name: v.school_name,
        grade: v.grade,
        graduation_year: v.graduation_year,
        attended_bcc_with_mdcw: YES_NO[v.attended],
        involvement: v.involvement || null,
        motivation: v.motivation,
        leadership_experience: v.leadership_experience || null,
        expected_turnout: v.expected_turnout,
        knows_absence_contact: v.knows_absence_contact,
        guardian_name: v.guardian_name || null,
        guardian_phone: v.guardian_phone_raw ? v.guardian_phone : null,
        acknowledged_duties: true
      })
    });

    if (!insertRes.ok) {
      console.error('[ambassador] insert failed: ' + insertRes.status + ' ' + (await insertRes.text()).slice(0, 300));
      res.status(500).json({ error: 'Could not save your application. Please try again.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error saving your application. Please try again.' });
  }
};

function fieldError(res, field, message) {
  res.status(400).json({ error: message, field: field });
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Names and school: control characters out, runs of whitespace collapsed.
function oneLine(value) {
  return str(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
}

// Textareas keep their line breaks but lose other control characters.
function longText(value) {
  return str(value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
}

function toInt(value) {
  var s = typeof value === 'number' ? String(value) : str(value);
  return /^[0-9]{1,6}$/.test(s) ? Number(s) : null;
}

function normalizePhone(value) {
  var digits = str(value).replace(/\D/g, '');
  return digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
}

async function checkRateLimit(SUPABASE_URL, headers, key, limit, windowSeconds) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_rate_limit', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
  });
  if (!r.ok) return true; // fail open, like /attend: an outage shouldn't block a real student
  return (await r.json()) === true;
}
