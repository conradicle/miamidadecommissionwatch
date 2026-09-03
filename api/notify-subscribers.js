// Emails every active subscriber about one meeting, either its agenda
// (before the vote) or its recap (after). Needs the Supabase service role
// key and the Resend API key, so this is server-only; verifies the caller
// is active staff before doing anything, same pattern as admin-invite.js.
var prefsLib = require("./_prefs");

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

  var meetingId = req.body && req.body.meeting_id;
  var kind = req.body && req.body.kind;
  if (!meetingId || typeof meetingId !== 'string') {
    res.status(400).json({ error: 'meeting_id is required' });
    return;
  }
  if (kind !== 'agenda' && kind !== 'recap') {
    res.status(400).json({ error: 'kind must be "agenda" or "recap"' });
    return;
  }

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
      { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    if (!callerRole || (callerRole.role !== 'owner' && callerRole.role !== 'admin') || callerRole.status !== 'active') {
      res.status(403).json({ error: 'Only staff can send subscriber emails' });
      return;
    }

    var meetingRes = await fetch(
      SUPABASE_URL + '/rest/v1/meetings?id=eq.' + meetingId + '&select=*,meeting_items(*)',
      { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
    );
    var meetingRows = await meetingRes.json();
    var meeting = meetingRows && meetingRows[0];
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    // A draft is absent from the built site, so its /meetings/<date>.html does
    // not exist -- mailing subscribers about it sends the whole list to a 404.
    // The dashboard disables the button, but this reads the row with the
    // service role and is the check that actually holds. Rows predating
    // migration_22 have no published column and are live, so only an explicit
    // false is a draft.
    if (meeting.published === false) {
      res.status(409).json({
        error: 'That meeting is still a draft. Publish it and rebuild the site before emailing subscribers.'
      });
      return;
    }

    var subsRes = await fetch(
      SUPABASE_URL + '/rest/v1/subscribers?status=eq.subscribed&select=email,unsubscribe_token,all_meetings,districts,topics',
      { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
    );
    var subscribers = await subsRes.json();

    // Pre-migration_14 the preference columns don't exist and the select
    // above 400s. Fall back to the original column list: everyone gets the
    // mail, which is exactly the old behaviour.
    if (!subsRes.ok || !Array.isArray(subscribers)) {
      var legacyRes = await fetch(
        SUPABASE_URL + '/rest/v1/subscribers?status=eq.subscribed&select=email,unsubscribe_token',
        { headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY } }
      );
      subscribers = await legacyRes.json();
    }
    if (!Array.isArray(subscribers)) subscribers = [];

    // Resend rejects a whole batch if any one address in it is unsendable, so
    // a single row of test data -- someone@example.com -- silently blocked
    // every subscriber email the site tried to send. Drop the unsendable ones
    // here and mail everybody else. The count comes back in the response so a
    // bad address is visible rather than merely survivable.
    var unsendable = [];
    subscribers = subscribers.filter(function (sub) {
      var email = typeof sub.email === 'string' ? sub.email.trim() : '';
      if (!isSendableAddress(email)) {
        unsendable.push(email || '(blank)');
        return false;
      }
      return true;
    });

    var totalSubscribers = subscribers.length;

    // Only mail people whose districts or topics this meeting actually
    // touches. Anyone on all_meetings (the default, and every pre-existing
    // subscriber) still gets everything.
    subscribers = subscribers.filter(function (sub) {
      return prefsLib.meetingMatchesSubscriber(meeting, sub);
    });

    if (subscribers.length === 0) {
      // Nobody matched. Do NOT mark the meeting as sent: an editor who later
      // tags items with topics and districts should be able to send it for
      // real, and a "sent" timestamp here would hide that it never went out.
      res.status(200).json({
        ok: true,
        sent: 0,
        skipped: totalSubscribers,
        unsendable: unsendable.length,
        note: totalSubscribers > 0
          ? 'No subscriber\'s district or topic preferences match any item on this meeting. Tag the items and try again.'
          : unsendable.length > 0
            ? 'There are no active subscribers with a sendable address. Skipped: ' + unsendable.join(', ')
            : 'There are no active subscribers.'
      });
      return;
    }

    var content = kind === 'agenda' ? buildAgendaEmail(meeting) : buildRecapEmail(meeting);

    var chunks = [];
    for (var i = 0; i < subscribers.length; i += 100) {
      chunks.push(subscribers.slice(i, i + 100));
    }

    for (var c = 0; c < chunks.length; c++) {
      var batch = chunks[c].map(function (sub) {
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
        res.status(502).json({ error: errData.message || 'Email provider rejected the send' });
        return;
      }
      if (c < chunks.length - 1) {
        await sleep(600);
      }
    }

    await markSent(SUPABASE_URL, SERVICE_ROLE_KEY, meetingId, kind);

    res.status(200).json({
      ok: true,
      sent: subscribers.length,
      skipped: totalSubscribers - subscribers.length,
      unsendable: unsendable.length,
      note: unsendable.length > 0
        ? 'Skipped ' + unsendable.length + ' unsendable address' +
          (unsendable.length === 1 ? '' : 'es') + ': ' + unsendable.join(', ') +
          '. Remove them from the subscribers table.'
        : undefined
    });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected error sending subscriber emails' });
  }
};

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

function markSent(SUPABASE_URL, SERVICE_ROLE_KEY, meetingId, kind) {
  var field = kind === 'agenda' ? 'agenda_sent_at' : 'recap_sent_at';
  var body = {};
  body[field] = new Date().toISOString();
  return fetch(SUPABASE_URL + '/rest/v1/meetings?id=eq.' + meetingId, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(body)
  });
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

function siteUrl() {
  return 'https://www.miamidadecommissionwatch.com/meetings.html';
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemsSorted(meeting) {
  return (meeting.meeting_items || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
}

function buildAgendaEmail(meeting) {
  var dateStr = formatMeetingDate(meeting.meeting_date);
  var items = itemsSorted(meeting);

  var itemsHtml = items.map(function (item) {
    return '<div style="border-top:1px solid #ddd;padding-top:12px;margin-top:12px;">' +
      '<div style="font-family:Arial,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#146652;">' + escapeHtml(item.tag_label) + '</div>' +
      '<div style="font-weight:700;margin:4px 0;">' + escapeHtml(item.heading) + '</div>' +
      '<div style="color:#444;line-height:1.5;">' + escapeHtml(item.description) + '</div>' +
    '</div>';
  }).join('');

  var itemsText = items.map(function (item) {
    return '- [' + item.tag_label + '] ' + item.heading + ': ' + item.description;
  }).join('\n');

  var html =
    '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
      '<div style="background:#0e4a3c;padding:20px 24px;border-bottom:4px solid #c08a2e;">' +
        '<span style="font-family:Arial,sans-serif;font-weight:700;font-size:18px;color:#fff;">Miami-Dade <span style="color:#c08a2e;">Commission</span> Watch</span>' +
      '</div>' +
      '<div style="padding:28px 24px;">' +
        '<div style="font-family:Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#c08a2e;margin-bottom:6px;">' + escapeHtml(meeting.meeting_type) + ' &middot; ' + escapeHtml(dateStr) + '</div>' +
        '<h1 style="font-size:22px;margin:0 0 12px;">' + escapeHtml(meeting.title) + '</h1>' +
        '<p style="line-height:1.6;">' + escapeHtml(meeting.summary) + '</p>' +
        (itemsHtml ? '<div style="margin-top:8px;">' + itemsHtml + '</div>' : '') +
        '<p style="line-height:1.6;margin-top:20px;">Nothing here has been voted on yet. If one of these affects you, now is the time to reach your commissioner.</p>' +
        '<a href="' + siteUrl() + '" style="display:inline-block;margin-top:6px;padding:12px 22px;background:#146652;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:15px;">Read the full agenda</a>' +
      '</div>' +
    '</div>';

  var text =
    (meeting.meeting_type) + ' · ' + dateStr + '\n' +
    meeting.title + '\n\n' +
    meeting.summary + '\n\n' +
    (itemsText ? itemsText + '\n\n' : '') +
    'Nothing here has been voted on yet. If one of these affects you, now is the time to reach your commissioner.\n\n' +
    'Read the full agenda: ' + siteUrl();

  return {
    subject: 'Agenda posted: ' + meeting.title + ' - ' + dateStr,
    html: html,
    text: text
  };
}

function buildRecapEmail(meeting) {
  var dateStr = formatMeetingDate(meeting.meeting_date);
  var items = itemsSorted(meeting);

  var outcomeColors = { passed: '#146652', failed: '#b3452c', deferred: '#8a5a1e' };

  var itemsHtml = items.map(function (item) {
    var color = item.tag_type === 'outcome' ? (outcomeColors[item.tag_status] || '#146652') : '#4b5563';
    return '<div style="border-top:1px solid #ddd;padding-top:12px;margin-top:12px;">' +
      '<div style="font-family:Arial,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:' + color + ';">' + escapeHtml(item.tag_label) + '</div>' +
      '<div style="font-weight:700;margin:4px 0;">' + escapeHtml(item.heading) + '</div>' +
      '<div style="color:#444;line-height:1.5;">' + escapeHtml(item.description) + '</div>' +
      '<div style="color:#146652;font-size:14px;margin-top:6px;"><strong>Why it matters:</strong> ' + escapeHtml(item.why_it_matters) + '</div>' +
    '</div>';
  }).join('');

  var itemsText = items.map(function (item) {
    return '- [' + item.tag_label + '] ' + item.heading + ': ' + item.description + '\n  Why it matters: ' + item.why_it_matters;
  }).join('\n');

  var html =
    '<div style="font-family:Georgia,\'Times New Roman\',serif;max-width:560px;margin:0 auto;color:#1a1a1a;">' +
      '<div style="background:#0e4a3c;padding:20px 24px;border-bottom:4px solid #c08a2e;">' +
        '<span style="font-family:Arial,sans-serif;font-weight:700;font-size:18px;color:#fff;">Miami-Dade <span style="color:#c08a2e;">Commission</span> Watch</span>' +
      '</div>' +
      '<div style="padding:28px 24px;">' +
        '<div style="font-family:Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#c08a2e;margin-bottom:6px;">' + escapeHtml(meeting.meeting_type) + ' &middot; ' + escapeHtml(dateStr) + '</div>' +
        '<h1 style="font-size:22px;margin:0 0 12px;">What happened: ' + escapeHtml(meeting.title) + '</h1>' +
        '<p style="line-height:1.6;">' + escapeHtml(meeting.summary) + '</p>' +
        (itemsHtml ? '<div style="margin-top:8px;">' + itemsHtml + '</div>' : '') +
        '<a href="' + siteUrl() + '" style="display:inline-block;margin-top:20px;padding:12px 22px;background:#146652;color:#fff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-size:15px;">Read the full write-up</a>' +
      '</div>' +
    '</div>';

  var text =
    'What happened: ' + meeting.title + '\n' +
    meeting.meeting_type + ' · ' + dateStr + '\n\n' +
    meeting.summary + '\n\n' +
    (itemsText ? itemsText + '\n\n' : '') +
    'Read the full write-up: ' + siteUrl();

  return {
    subject: 'What happened: ' + meeting.title + ' - ' + dateStr,
    html: html,
    text: text
  };
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
