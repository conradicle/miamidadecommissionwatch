// One-click unsubscribe link target, clicked directly from an email client
// rather than fetched by our own JS, so this returns an HTML page (not
// JSON) either way.
module.exports = async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  var token = req.query && req.query.token;
  if (!token || typeof token !== 'string') {
    res.status(400).send(renderPage(
      'Missing unsubscribe link',
      'This unsubscribe link is missing its token. Please use the link from one of our emails, or email contact@miamidadecommissionwatch.com and we’ll remove you by hand.'
    ));
    return;
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).send(renderPage(
      'Something went wrong',
      'We could not process this request right now. Please email contact@miamidadecommissionwatch.com and we’ll remove you by hand.'
    ));
    return;
  }

  try {
    var updateRes = await fetch(
      SUPABASE_URL + '/rest/v1/subscribers?unsubscribe_token=eq.' + encodeURIComponent(token),
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
          apikey: SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      }
    );
    var rows = await updateRes.json();
    if (!updateRes.ok || !rows || rows.length === 0) {
      res.status(404).send(renderPage(
        'Link not found',
        'This unsubscribe link isn’t valid, possibly because it was already used. If you’re still receiving emails, contact contact@miamidadecommissionwatch.com and we’ll remove you by hand.'
      ));
      return;
    }
    res.status(200).send(renderPage(
      'You’re unsubscribed',
      'You will not receive any more emails from Miami-Dade Commission Watch. You can resubscribe any time from the homepage.'
    ));
  } catch (err) {
    res.status(500).send(renderPage(
      'Something went wrong',
      'We could not process this request right now. Please email contact@miamidadecommissionwatch.com and we’ll remove you by hand.'
    ));
  }
};

function renderPage(title, message) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<title>' + escapeHtml(title) + ' - Miami-Dade Commission Watch</title>' +
    '<style>' +
      'body{font-family:Georgia,\'Times New Roman\',serif;background:#f7f4ee;color:#1a1a1a;max-width:520px;margin:80px auto;padding:0 24px;text-align:center;}' +
      'h1{font-size:24px;font-family:Arial,sans-serif;}' +
      'p{line-height:1.6;}' +
      'a.btn{display:inline-block;margin-top:24px;padding:12px 24px;background:#146652;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;}' +
    '</style>' +
    '</head><body><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p>' +
    '<a class="btn" href="https://www.miamidadecommissionwatch.com/">Return to the site</a></body></html>';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
