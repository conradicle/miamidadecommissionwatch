// Emails every active subscriber about one published official document (a
// Meeting Summary or Agenda Summary). Needs the Supabase service role key
// and the Resend API key, so this is server-only; verifies the caller is
// active staff before doing anything, same pattern as admin-invite.js.
//
// The Documents tab calls this right after publishing, with { document_id }.
// The document's page only exists once the site rebuild finishes, so this
// checks the live page first and answers 409 with pending: true until the
// page shows the version just published; the dashboard keeps asking.
//
// What gets mailed:
//   - the first publication of a document, always, once
//     (documents.subscribers_notified_at)
//   - a correction (version 1.1 and later) only when staff ticked "Email
//     subscribers about this correction" on upload
//     (document_versions.notify_subscribers), with "Correction:" in the
//     subject. documents.last_notified_version stops a second send.
//
// The per-meeting agenda and recap emails that used to live here went with
// the Meeting Tracker freeze; nothing calls them any more.
var docLib = require('./_document-lib');

var SITE_ORIGIN = 'https://www.miamidadecommissionwatch.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    res.status(500).json({ error: 'Server is not configured for subscriber emails' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var documentId = req.body && req.body.document_id;
  if (!documentId || typeof documentId !== 'string') {
    res.status(400).json({ error: 'document_id is required' });
    return;
  }

  var headers = { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY };

  try {
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
      { headers: headers }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    if (!callerRole || (callerRole.role !== 'owner' && callerRole.role !== 'admin') || callerRole.status !== 'active') {
      res.status(403).json({ error: 'Only staff can send subscriber emails' });
      return;
    }

    var docRes = await fetch(
      SUPABASE_URL + '/rest/v1/documents?id=eq.' + encodeURIComponent(documentId) +
        '&select=*,document_versions!document_versions_document_id_fkey(id,version,status,title,summary,change_note,public_pdf_path,notify_subscribers)',
      { headers: headers }
    );
    var docRows = await docRes.json();
    var doc = Array.isArray(docRows) && docRows[0];
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (doc.status !== 'published') {
      res.status(409).json({ error: 'That document is still a draft. Publish it before emailing subscribers.' });
      return;
    }

    var versions = doc.document_versions || [];
    var current = versions.filter(function (v) { return v.id === doc.current_version_id; })[0];
    if (!current) {
      res.status(409).json({ error: 'That document has no current version.' });
      return;
    }
    var isCorrection = versions.some(function (v) {
      return v.status === 'published' && v.id !== current.id && docLib.compareVersions(v.version, current.version) < 0;
    });

    if (isCorrection) {
      if (!current.notify_subscribers) {
        res.status(409).json({ error: 'Version ' + current.version + ' is a correction that was not marked for email. ' +
          'Corrections are emailed only when "Email subscribers about this correction" is ticked on upload.' });
        return;
      }
      if (doc.last_notified_version === current.version) {
        res.status(200).json({ ok: true, sent: 0, already: true,
          note: 'Subscribers were already emailed about version ' + current.version + '.' });
        return;
      }
    } else if (doc.subscribers_notified_at) {
      res.status(200).json({ ok: true, sent: 0, already: true,
        note: 'Subscribers were already emailed about this document on ' + doc.subscribers_notified_at.slice(0, 10) + '.' });
      return;
    }

    var pageUrl = SITE_ORIGIN + '/documents/' + doc.doc_type + '/' + doc.meeting_date;
    var pdfUrl = current.public_pdf_path ? SITE_ORIGIN + docLib.publicPdfPath(current.public_pdf_path) : null;

    // Never mail a link that 404s or still shows the old text. The rebuild
    // that publishing started takes about a minute; until the page answers
    // with this document at this version, say so and let the dashboard try
    // again. The version is matched in the page's document control strip
    // (js/document-view.js writes it as <dt>Version</dt><dd>1.1</dd>).
    var live = false;
    try {
      var pageRes = await fetch(pageUrl, { headers: { 'Cache-Control': 'no-cache' } });
      var pageHtml = pageRes.ok ? await pageRes.text() : '';
      live = pageHtml.indexOf(doc.document_number) !== -1 &&
        pageHtml.indexOf('<dt>Version</dt><dd>' + current.version + '</dd>') !== -1;
    } catch (e) {
      live = false;
    }
    if (!live) {
      res.status(409).json({ pending: true,
        error: 'The page for ' + doc.document_number + ', version ' + current.version +
          ', is not live yet. Subscribers are emailed once it is.' });
      return;
    }

    // Every active subscriber, including those who narrowed their mail to
    // particular districts or topics: a document covers the whole meeting,
    // like a countywide item.
    var loaded = await loadSubscribers(SUPABASE_URL, SERVICE_ROLE_KEY);
    if (!loaded.subscribers.length) {
      res.status(200).json({ ok: true, sent: 0, unsendable: loaded.unsendable.length,
        note: 'There are no active subscribers with a sendable address.' });
      return;
    }

    var content = isCorrection
      ? buildCorrectionEmail(doc, current, pageUrl, pdfUrl)
      : buildDocumentEmail(doc, pageUrl, pdfUrl);
    var sendError = await sendInBatches(RESEND_API_KEY, loaded.subscribers, content);
    if (sendError) {
      res.status(502).json({ error: sendError });
      return;
    }

    var stamp = { last_notified_version: current.version };
    if (!isCorrection) stamp.subscribers_notified_at = new Date().toISOString();
    await fetch(SUPABASE_URL + '/rest/v1/documents?id=eq.' + encodeURIComponent(doc.id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, headers),
      body: JSON.stringify(stamp)
    });

    res.status(200).json({
      ok: true,
      correction: isCorrection,
      sent: loaded.subscribers.length,
      unsendable: loaded.unsendable.length,
      note: loaded.unsendable.length
        ? 'Skipped ' + loaded.unsendable.length + ' unsendable address' + (loaded.unsendable.length === 1 ? '' : 'es') +
          ': ' + loaded.unsendable.join(', ') + '. Remove them from the subscribers table.'
        : undefined
    });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error sending subscriber emails' });
  }
};

// Active subscribers with a sendable address, plus the ones skipped.
async function loadSubscribers(SUPABASE_URL, SERVICE_ROLE_KEY) {
  var headers = { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY };
  var r = await fetch(SUPABASE_URL + '/rest/v1/subscribers?status=eq.subscribed&select=email,unsubscribe_token', { headers: headers });
  var rows = await r.json();
  if (!Array.isArray(rows)) rows = [];
  var unsendable = [];
  var subscribers = rows.filter(function (sub) {
    var email = typeof sub.email === 'string' ? sub.email.trim() : '';
    if (!isSendableAddress(email)) {
      unsendable.push(email || '(blank)');
      return false;
    }
    return true;
  });
  return { subscribers: subscribers, unsendable: unsendable };
}

// Resend rejects a whole batch if any one address in it is unsendable, which
// is why loadSubscribers filters first. Batches of 100, a short pause
// between them. Returns an error message, or null when every batch went.
async function sendInBatches(RESEND_API_KEY, subscribers, content) {
  for (var i = 0; i < subscribers.length; i += 100) {
    var batch = subscribers.slice(i, i + 100).map(function (sub) {
      return {
        from: 'Miami-Dade Commission Watch <news@miamidadecommissionwatch.com>',
        to: sub.email,
        reply_to: 'contact@miamidadecommissionwatch.com',
        subject: content.subject,
        html: content.html + unsubscribeFooterHtml(sub.unsubscribe_token),
        text: content.text + unsubscribeFooterText(sub.unsubscribe_token)
      };
    });
    var batchRes = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch)
    });
    if (!batchRes.ok) {
      var errData = await batchRes.json().catch(function () { return {}; });
      return errData.message || 'Email provider rejected the send';
    }
    if (i + 100 < subscribers.length) await sleep(600);
  }
  return null;
}

// The shared shell of both emails: masthead, eyebrow, heading, paragraphs,
// the button to the page and the PDF line.
function emailHtml(eyebrow, heading, paragraphs, buttonLabel, pageUrl, pdfUrl, documentNumber) {
  return '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
      '<div style="background:#0e4a3c;padding:20px 24px;border-bottom:4px solid #c08a2e;">' +
        '<span style="font-family:Arial,sans-serif;font-weight:700;font-size:18px;color:#fff;">Miami-Dade <span style="color:#c08a2e;">Commission</span> Watch</span>' +
      '</div>' +
      '<div style="padding:28px 24px;">' +
        '<div style="font-family:Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#c08a2e;margin-bottom:6px;">' +
          escapeHtml(eyebrow) + '</div>' +
        '<h1 style="font-size:22px;margin:0 0 12px;">' + escapeHtml(heading) + '</h1>' +
        paragraphs.map(function (p) { return '<p style="line-height:1.6;margin:0 0 12px;">' + escapeHtml(p) + '</p>'; }).join('') +
        '<a href="' + escapeHtml(pageUrl) + '" style="display:inline-block;margin-top:6px;padding:12px 22px;background:#1B365D;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:15px;">' +
          escapeHtml(buttonLabel) + '</a>' +
        (pdfUrl ? '<p style="font-family:Arial,sans-serif;font-size:14px;margin-top:14px;"><a href="' + escapeHtml(pdfUrl) +
          '" style="color:#1B365D;">Download the official PDF</a> &middot; ' + escapeHtml(documentNumber) + '</p>' : '') +
      '</div>' +
    '</div>';
}

function buildDocumentEmail(doc, pageUrl, pdfUrl) {
  var type = docLib.DOC_TYPES[doc.doc_type];
  var dateStr = formatMeetingDate(doc.meeting_date);
  var lead = 'Our ' + type.label + ' for the Board of County Commissioners meeting of ' + dateStr + ' is out.';

  return {
    subject: type.label + ': BCC meeting of ' + dateStr,
    html: emailHtml(type.label + ' · Meeting of ' + dateStr, doc.title, [lead, doc.summary],
      'Read the ' + type.label, pageUrl, pdfUrl, doc.document_number),
    text:
      type.label + ' · Meeting of ' + dateStr + '\n' +
      doc.title + '\n\n' +
      lead + '\n\n' +
      doc.summary + '\n\n' +
      'Read it: ' + pageUrl + '\n' +
      (pdfUrl ? 'Official PDF (' + doc.document_number + '): ' + pdfUrl + '\n' : '')
  };
}

// A correction says what changed first: the reader already has the earlier
// version and needs the difference, not the whole summary again.
function buildCorrectionEmail(doc, version, pageUrl, pdfUrl) {
  var type = docLib.DOC_TYPES[doc.doc_type];
  var dateStr = formatMeetingDate(doc.meeting_date);
  var title = version.title || doc.title;
  var lead = 'We corrected our ' + type.label + ' for the Board of County Commissioners meeting of ' +
    dateStr + '. The corrected text is version ' + version.version + '.';
  var what = version.change_note ? 'What changed: ' + version.change_note : '';
  var paragraphs = [lead];
  if (what) paragraphs.push(what);
  paragraphs.push('Earlier versions stay available in the version history on the document page.');

  return {
    subject: 'Correction: ' + title,
    html: emailHtml('Correction · ' + type.label + ' · Meeting of ' + dateStr, title, paragraphs,
      'Read the corrected ' + type.label, pageUrl, pdfUrl, doc.document_number + ', version ' + version.version),
    text:
      'Correction · ' + type.label + ' · Meeting of ' + dateStr + '\n' +
      title + '\n\n' +
      paragraphs.join('\n\n') + '\n\n' +
      'Read it: ' + pageUrl + '\n' +
      (pdfUrl ? 'Official PDF (' + doc.document_number + ', version ' + version.version + '): ' + pdfUrl + '\n' : '')
  };
}

// Addresses Resend will refuse. Deliberately narrow: this is not an attempt to
// validate email in general, which is not something a regex does. It catches
// the two things that actually reach this table -- a malformed address, and
// the reserved domains from RFC 2606 and RFC 6761 that seed and test data use.
// Anything else is handed to Resend, which is the real authority on whether an
// address can be delivered to.
var RESERVED_EMAIL_DOMAINS = /@(example|test|invalid|localhost)(\.|$)/i;

function isSendableAddress(email) {
  if (!email) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
  if (RESERVED_EMAIL_DOMAINS.test(email)) return false;
  return true;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function formatMeetingDate(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Every email offers narrowing before it offers leaving: someone getting mail
// about districts they don't live in should find "choose what you get" at
// least as easily as "unsubscribe".
function unsubscribeFooterHtml(unsubscribeToken) {
  var url = 'https://www.miamidadecommissionwatch.com/api/newsletter-unsubscribe?token=' + unsubscribeToken;
  var manage = 'https://www.miamidadecommissionwatch.com/manage-subscription.html?token=' + unsubscribeToken;
  return '<div style="max-width:560px;margin:0 auto;padding:16px 24px;border-top:1px solid #ddd;font-family:Arial,sans-serif;font-size:12px;color:#666;">' +
    'Miami-Dade Commission Watch &middot; <a href="' + manage + '" style="color:#666;">Choose what you get</a>' +
    ' &middot; <a href="' + url + '" style="color:#666;">Unsubscribe</a>' +
  '</div>';
}

function unsubscribeFooterText(unsubscribeToken) {
  return '\n\nChoose which districts and topics you hear about: https://www.miamidadecommissionwatch.com/manage-subscription.html?token=' + unsubscribeToken +
    '\n\nUnsubscribe: https://www.miamidadecommissionwatch.com/api/newsletter-unsubscribe?token=' + unsubscribeToken;
}
