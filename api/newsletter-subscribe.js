// Adds an email to the newsletter list and sends a welcome email. Runs
// server-side (rather than a direct client insert) so the Resend API key
// never reaches the browser, and so the subscriber table can stay closed to
// the public anon key entirely -- see supabase/migration_4_newsletter.sql.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    res.status(500).json({ error: 'Server is not configured for newsletter signups' });
    return;
  }

  var email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    res.status(400).json({ error: 'Please enter a valid email address' });
    return;
  }

  try {
    var existingRes = await fetch(
      SUPABASE_URL + '/rest/v1/subscribers?email=eq.' + encodeURIComponent(email) + '&select=id,status,unsubscribe_token',
      { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
    );
    var existingRows = await existingRes.json();
    var existing = existingRows && existingRows[0];

    if (existing && existing.status === 'subscribed') {
      // Already on the list -- respond the same as a fresh signup would,
      // without sending a second welcome email.
      res.status(200).json({ ok: true });
      return;
    }

    var unsubscribeToken;

    if (existing) {
      unsubscribeToken = existing.unsubscribe_token;
      var updateRes = await fetch(SUPABASE_URL + '/rest/v1/subscribers?id=eq.' + existing.id, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
          apikey: SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ status: 'subscribed', unsubscribed_at: null })
      });
      if (!updateRes.ok) {
        res.status(500).json({ error: 'Could not save your subscription' });
        return;
      }
    } else {
      var insertRes = await fetch(SUPABASE_URL + '/rest/v1/subscribers', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
          apikey: SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ email: email })
      });
      var insertData = await insertRes.json();
      if (!insertRes.ok) {
        res.status(500).json({ error: 'Could not save your subscription' });
        return;
      }
      unsubscribeToken = insertData[0].unsubscribe_token;
    }

    // Best-effort: a subscriber who never gets the welcome email (e.g. a
    // transient Resend error) is still subscribed and will get the next
    // agenda/recap email, so don't fail the signup over this.
    try {
      await sendWelcomeEmail(RESEND_API_KEY, email, unsubscribeToken);
    } catch (emailErr) {
      // swallow -- subscription already succeeded above
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error saving your subscription' });
  }
};

function unsubscribeUrl(token) {
  return 'https://www.miamidadecommissionwatch.com/api/newsletter-unsubscribe?token=' + token;
}

async function sendWelcomeEmail(apiKey, email, unsubscribeToken) {
  var unsubUrl = unsubscribeUrl(unsubscribeToken);

  var html =
    '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
      '<div style="background:#0e4a3c;padding:20px 24px;border-bottom:4px solid #c08a2e;">' +
        '<span style="font-family:Arial,sans-serif;font-weight:700;font-size:18px;color:#fff;">Miami-Dade <span style="color:#c08a2e;">Commission</span> Watch</span>' +
      '</div>' +
      '<div style="padding:28px 24px;">' +
        '<h1 style="font-size:22px;margin:0 0 16px;">Welcome &mdash; here\'s what to expect</h1>' +
        '<p style="line-height:1.6;">Thanks for signing up. The Miami-Dade Board of County Commissioners meets regularly and decides things that show up in your rent, your commute, and your neighborhood\'s next ten years. Almost nobody outside government reads the agendas. We do, and we send back what\'s on them in plain language, with a link to the source for every claim.</p>' +
        '<p style="line-height:1.6;">Miami-Dade Commission Watch is an independent, student-run project founded by Conrad Gelber and Daniel Llobet. It is not affiliated with, operated by, or endorsed by Miami-Dade County government, any political party, or any candidate for office. We report what was on the agenda, what happened, and how commissioners voted &mdash; we don\'t endorse candidates or editorialize about anyone\'s motives.</p>' +
        '<p style="line-height:1.6;font-weight:700;margin-bottom:6px;">From here on, you\'ll get an email:</p>' +
        '<ul style="line-height:1.7;padding-left:20px;">' +
          '<li>When a new meeting\'s agenda is posted, before commissioners vote</li>' +
          '<li>After each meeting, summarizing what happened and how it was decided</li>' +
        '</ul>' +
        '<p style="line-height:1.6;">Every email links back to the full write-up on the site, along with your commissioner\'s contact info if you want to weigh in before a vote.</p>' +
        '<a href="https://www.miamidadecommissionwatch.com/" style="display:inline-block;margin-top:12px;padding:12px 22px;background:#146652;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:15px;">Visit the site</a>' +
      '</div>' +
      '<div style="padding:16px 24px;border-top:1px solid #ddd;font-family:Arial,sans-serif;font-size:12px;color:#666;">' +
        'Miami-Dade Commission Watch &middot; <a href="' + unsubUrl + '" style="color:#666;">Unsubscribe</a>' +
      '</div>' +
    '</div>';

  var text =
    'Welcome to Miami-Dade Commission Watch.\n\n' +
    'The Miami-Dade Board of County Commissioners meets regularly and decides things that show up in your rent, your commute, and your neighborhood\'s next ten years. We read the agendas and report back in plain language, with a source link for every claim. We\'re an independent, student-run project (Conrad Gelber and Daniel Llobet), not affiliated with county government, any party, or any candidate.\n\n' +
    'From here on, you\'ll get an email when a new meeting\'s agenda is posted, and again after the meeting summarizing what happened.\n\n' +
    'Visit the site: https://www.miamidadecommissionwatch.com/\n\n' +
    'Unsubscribe: ' + unsubUrl;

  var sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Miami-Dade Commission Watch <news@miamidadecommissionwatch.com>',
      to: email,
      reply_to: 'contact@miamidadecommissionwatch.com',
      subject: 'Welcome to Miami-Dade Commission Watch',
      html: html,
      text: text
    })
  });
  if (!sendRes.ok) {
    throw new Error('Resend request failed with status ' + sendRes.status);
  }
}
