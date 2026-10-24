// Receives a student editorial and writes it to the review queue. Runs
// server-side (rather than a direct client insert) so the submission can be
// throttled per IP and so editorial_submissions can stay closed to the public
// anon key entirely -- see supabase/migration_15_editorial_school_email_and_
// submit_lockdown.sql. Same pattern as newsletter-subscribe.
//
// Every check here is also enforced in the database (the school_email domain
// constraint, and the status/reviewed_at pins from migration_6), so a row can
// never reach the table in a state this endpoint would have refused. The
// checks exist here as well to give the student a useful message instead of a
// constraint violation.

var botCheck = require('./_bot-check.js');

var GRADES = ['9th grade', '10th grade', '11th grade', '12th grade'];

// Miami-Dade County Public Schools issues students <id>@students.dadeschools.net.
// Kept identical to the constraint in migration_15 and to isSchoolEmail() in
// js/submit-editorial.js; if one changes, change all three.
var STUDENT_EMAIL = /^[^@\s]+@students\.dadeschools\.net$/i;

var LIMITS = { name: 100, grade: 20, school: 200, school_email: 254, title: 200, topic: 200, body: 40000 };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for editorial submissions' });
    return;
  }

  var body = req.body || {};

  var bot = await botCheck.check(req, body, 'editorial');
  if (!bot.ok) {
    res.status(400).json({ error: botCheck.MESSAGE });
    return;
  }

  var fields = {
    name: str(body.name),
    grade: str(body.grade),
    school: str(body.school),
    school_email: str(body.school_email || body.email).toLowerCase(),
    title: str(body.title),
    topic: str(body.topic),
    body: str(body.body)
  };

  var required = ['name', 'grade', 'school', 'school_email', 'title', 'body'];
  for (var i = 0; i < required.length; i++) {
    if (!fields[required[i]]) {
      res.status(400).json({ error: 'Please fill in every required field.' });
      return;
    }
  }

  for (var key in LIMITS) {
    if (fields[key].length > LIMITS[key]) {
      res.status(400).json({ error: 'One of your fields is longer than we can accept. Please shorten it and try again.' });
      return;
    }
  }

  if (GRADES.indexOf(fields.grade) === -1) {
    res.status(400).json({ error: 'Please choose a grade between 9th and 12th.' });
    return;
  }

  if (!STUDENT_EMAIL.test(fields.school_email)) {
    res.status(400).json({
      error: 'Please use your Miami-Dade County Public Schools student email (it ends in @students.dadeschools.net) so we can verify enrollment. If you attend a private or home school, email contact@miamidadecommissionwatch.com and we\'ll take your draft that way.'
    });
    return;
  }

  try {
    var ip = clientIp(req);
    // Three an hour per IP. Real submissions run a handful a month, and a
    // student fixing a typo and resending still has room; a script does not.
    var allowed = await checkRateLimit(SUPABASE_URL, SERVICE_ROLE_KEY, 'submit-editorial:' + ip, 3, 3600);
    if (!allowed) {
      res.status(429).json({ error: 'Too many submissions from this connection. Please try again in an hour, or email contact@miamidadecommissionwatch.com.' });
      return;
    }

    // status/reviewed_at/reviewed_by are deliberately not taken from the
    // request: this endpoint holds the service role, which bypasses RLS, so
    // the migration_6 insert policy is not there to catch a spoofed
    // "approved" the way it was when the browser inserted directly.
    var insertRes = await fetch(SUPABASE_URL + '/rest/v1/editorial_submissions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        name: fields.name,
        grade: fields.grade,
        school: fields.school,
        school_email: fields.school_email,
        title: fields.title,
        topic: fields.topic || null,
        body: fields.body,
        status: 'pending',
        reviewed_at: null,
        reviewed_by: null
      })
    });

    if (!insertRes.ok) {
      res.status(500).json({ error: 'Could not save your editorial' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error saving your editorial' });
  }
};

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
