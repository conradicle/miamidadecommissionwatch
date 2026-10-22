// /attend: sign-up form for the next BCC meeting.
//
// The meeting comes from js/next-bcc-meeting.js (next_bcc_meeting(),
// migration_29), the same lookup the homepage's "Attend with us" section
// uses: the earliest meeting that is open and still taking sign-ups, and
// nothing at all otherwise. The sign-up itself
// goes to api/city-platform.js (op submit_bcc_signup), which checks Turnstile
// and writes with the service role; the browser can't insert directly.
(function () {
  // Cloudflare's documented always-pass test key. Used only on localhost, so
  // the form can be tried before the real key exists; production gets the
  // real one from the meta tag that scripts/build.mjs fills.
  var TEST_SITE_KEY = '1x00000000000000000000AA';

  var meeting = null;
  var widgetId = null;
  var turnstileReady = false;

  function el(id) { return document.getElementById(id); }

  function show(id) {
    ['attend-loading', 'attend-closed', 'attend-error', 'attend-open', 'attend-success'].forEach(function (x) {
      el(x).hidden = x !== id;
    });
  }

  function siteKey() {
    var meta = document.querySelector('meta[name="turnstile-site-key"]');
    var key = meta && meta.content;
    if (key) return key;
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? TEST_SITE_KEY : '';
  }

  var formatDate = window.MDCW.nextBcc.formatDate;
  var formatTime = window.MDCW.nextBcc.formatTime;

  function renderTurnstile() {
    if (!turnstileReady || !meeting || widgetId !== null || !window.turnstile) return;
    var key = siteKey();
    if (!key) {
      setStatus('The security check isn’t configured yet. DM us on Instagram to sign up.', 'error');
      el('attend-submit').disabled = true;
      return;
    }
    widgetId = window.turnstile.render('#attend-turnstile', {
      sitekey: key,
      action: 'attend',
      // Instagram's in-app browser is narrow; flexible fills the form width.
      size: 'flexible',
      theme: 'light'
    });
  }

  // Called by the Turnstile script's ?onload= once it has loaded.
  window.onTurnstileReady = function () {
    turnstileReady = true;
    renderTurnstile();
  };

  function setStatus(message, kind) {
    var node = el('attend-status');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  var FIELDS = {
    full_name: { input: 'attend-name', error: 'attend-name-error' },
    phone: { input: 'attend-phone', error: 'attend-phone-error' },
    mdcps_student_id: { input: 'attend-student-id', error: 'attend-student-id-error' },
    wants_public_comment: { input: null, error: 'attend-comment-error' }
  };

  function fieldError(name, message) {
    var f = FIELDS[name];
    if (!f) return;
    var err = el(f.error);
    err.textContent = message || '';
    err.hidden = !message;
    if (f.input) el(f.input).setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearErrors() {
    Object.keys(FIELDS).forEach(function (k) { fieldError(k, ''); });
    setStatus('');
  }

  function values() {
    var choice = document.querySelector('input[name="wants_public_comment"]:checked');
    return {
      full_name: el('attend-name').value.trim(),
      phone: el('attend-phone').value.trim(),
      mdcps_student_id: el('attend-student-id').value.replace(/\s/g, ''),
      wants_public_comment: choice ? choice.value : ''
    };
  }

  // Format checks only. The exact student ID length is checked on the server
  // (STUDENT_ID_LENGTH in api/_bcc-signup.js), which sends back the message.
  function validate(v) {
    var firstBad = null;
    function bad(name, msg) { fieldError(name, msg); if (!firstBad) firstBad = name; }
    if (v.full_name.length < 2) bad('full_name', 'Please enter your full name.');
    var digits = v.phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    if (digits.length !== 10) bad('phone', 'Please enter a 10-digit phone number.');
    if (!/^[0-9]+$/.test(v.mdcps_student_id)) bad('mdcps_student_id', 'Enter your MDCPS student ID, numbers only.');
    if (!v.wants_public_comment) bad('wants_public_comment', 'Please choose yes, maybe, or no.');
    return firstBad;
  }

  function focusField(name) {
    var f = FIELDS[name];
    var node = f && f.input ? el(f.input) : document.querySelector('input[name="wants_public_comment"]');
    if (node) node.focus();
  }

  function resetTurnstile() {
    if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
  }

  function onSubmit(e) {
    e.preventDefault();
    clearErrors();
    var v = values();
    var firstBad = validate(v);
    if (firstBad) { focusField(firstBad); return; }

    var token = widgetId !== null && window.turnstile ? window.turnstile.getResponse(widgetId) : '';
    if (!token) {
      setStatus('Please complete the security check above the button.', 'error');
      return;
    }

    var btn = el('attend-submit');
    btn.disabled = true;
    btn.textContent = 'Signing you up…';

    fetch('/api/city-platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        op: 'submit_bcc_signup',
        meeting_date: meeting.meeting_date,
        turnstile_token: token
      }, v))
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = 'Sign me up';
        if (res.ok && res.data.ok) {
          showSuccess(v);
          return;
        }
        var data = res.data || {};
        // A Turnstile token is single-use, so any failure needs a fresh one.
        resetTurnstile();
        if (data.closed) {
          show('attend-closed');
          return;
        }
        if (data.field && FIELDS[data.field]) {
          fieldError(data.field, data.error);
          focusField(data.field);
          return;
        }
        setStatus(data.error || 'Could not save your sign-up. Please try again.', 'error');
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Sign me up';
        resetTurnstile();
        setStatus('Couldn’t reach the server. Check your connection and try again.', 'error');
      });
  }

  function showSuccess(v) {
    el('attend-success-date').textContent = formatDate(meeting.meeting_date);
    el('attend-success-detail').textContent =
      'We have you down for ' + (meeting.title || 'the meeting') + ' at ' + formatTime(meeting.start_time) +
      (meeting.location ? ', ' + meeting.location : '') + '.' +
      (v.wants_public_comment === 'yes' ? ' You said you want to give public comment.' :
        v.wants_public_comment === 'maybe' ? ' You said you might give public comment.' : '');
    show('attend-success');
    el('attend-success').focus({ preventScroll: true });
    // scroll-margin-top in attend.html keeps the card clear of the sticky
    // header, which grows back to full height on any scroll up.
    el('attend-success').scrollIntoView({ block: 'start' });
  }

  function load() {
    window.MDCW.nextBcc.load().then(function (result) {
      if (result.status === 'error') { show('attend-error'); return; }
      if (result.status === 'closed') { show('attend-closed'); return; }
      meeting = result.meeting;
      el('attend-title').textContent = meeting.title;
      el('attend-date').textContent = formatDate(meeting.meeting_date);
      el('attend-time').textContent = formatTime(meeting.start_time);
      el('attend-time-inline').textContent = formatTime(meeting.start_time);
      el('attend-location').textContent = meeting.location;
      show('attend-open');
      renderTurnstile();
    }, function () { show('attend-error'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    el('attend-form').addEventListener('submit', onSubmit);
    load();
  });
})();
