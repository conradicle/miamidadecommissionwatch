// The checks every public form runs before it looks at a single field:
// honeypot, then time on page, then Cloudflare Turnstile. Cheapest first, so
// a dumb bot never costs us a call to Cloudflare.
//
// A failure never says which check tripped. The visitor gets one plain
// message (MESSAGE below) and the reason goes to the function log, where
// `vercel logs` shows it. Telling a bot "too fast" teaches it to wait.
//
// The browser half is js/bot-guard.js, which renders the widget and sends
// the three fields read here: `website` (the honeypot), `form_elapsed_ms`
// and `turnstile_token`.

// Under three seconds from page load to submit is faster than anyone types
// a name and an email.
var MIN_ELAPSED_MS = 3000;

var MESSAGE = "We couldn't send that. Please reload the page and try again.";

// -> { ok: true } or { ok: false }. Logs the reason itself.
async function check(req, body, form) {
  body = body || {};
  var ip = clientIp(req);

  // 1. Honeypot. Real visitors never see the field (js/bot-guard.js keeps it
  //    off screen and out of the tab order); form-filling bots fill it.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return fail(form, 'honeypot', ip);
  }

  // 2. Time on page. The browser sends elapsed time from its own monotonic
  //    clock rather than a wall-clock timestamp, so a visitor whose computer
  //    clock is wrong is not mistaken for a bot. A missing value means the
  //    request didn't come from our page at all.
  var elapsed = Number(body.form_elapsed_ms);
  if (!isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) {
    return fail(form, 'too-fast:' + (isFinite(elapsed) ? Math.round(elapsed) : 'missing'), ip);
  }

  // 3. Turnstile. Fails closed: no secret, no token, or Cloudflare
  //    unreachable all mean no.
  var secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return fail(form, 'turnstile-not-configured', ip);
  var token = typeof body.turnstile_token === 'string' ? body.turnstile_token : '';
  if (!token) return fail(form, 'turnstile-missing', ip);

  var verdict = await verifyTurnstile(secret, token, ip);
  if (!verdict.success) {
    return fail(form, 'turnstile:' + (verdict.codes.join(',') || 'rejected'), ip);
  }

  return { ok: true };
}

function fail(form, reason, ip) {
  console.warn('[bot-check] form=' + form + ' reason=' + reason + ' ip=' + ip);
  return { ok: false };
}

async function verifyTurnstile(secret, token, ip) {
  var params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (ip && ip !== 'unknown') params.append('remoteip', ip);
  try {
    var r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params
    });
    if (!r.ok) return { success: false, codes: ['http-' + r.status] };
    var data = await r.json();
    return { success: data.success === true, codes: data['error-codes'] || [] };
  } catch (err) {
    return { success: false, codes: ['unreachable'] };
  }
}

// Vercel sets x-forwarded-for to "client, proxy1, proxy2, ...";
// the first entry is the original client.
function clientIp(req) {
  var forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { check: check, clientIp: clientIp, MESSAGE: MESSAGE };
