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
  var interestWidgetId = null;
  var interestSubmitting = false;
  var turnstileReady = false;

  function el(id) { return document.getElementById(id); }

  function show(id) {
    ['attend-loading', 'attend-closed', 'attend-error', 'attend-open', 'attend-success'].forEach(function (x) {
      el(x).hidden = x !== id;
    });
    var open = id === 'attend-open' || id === 'attend-success';
    el('attend-interest-cta').hidden = open;
    if (open) {
      el('attend-eyebrow').textContent = 'Attend a meeting';
      el('attend-heading').textContent = 'Attend a meeting with us';
      el('attend-intro').textContent = 'Miami-Dade students: join MDCW at a County Commission meeting. Public comment is optional. Sign up below to come with the team.';
      el('interest-invitation').textContent = 'Can’t attend this meeting? Get notified about future opportunities.';
    } else if (id === 'attend-closed') {
      // Restore the year-specific introduction if a meeting closes mid-form.
      el('attend-eyebrow').textContent = el('meeting-interest').dataset.year + ' Meeting Opportunities';
      el('attend-heading').textContent = 'Your Voice Belongs in Local Government.';
      el('attend-intro').textContent = 'Our ' + el('meeting-interest').dataset.year + ' participation dates have not yet been finalized. Register your interest and we’ll text you when opportunities become available. Public comment is entirely optional.';
      el('interest-invitation').textContent = 'Register your interest in joining us. This takes about a minute.';
    }
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
    renderInterestTurnstile();
  };

  function setStatus(message, kind) {
    var node = el('attend-status');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  var FIELDS = {
    full_name: { input: 'attend-name', error: 'attend-name-error' },
    phone: { input: 'attend-phone', error: 'attend-phone-error' },
    school_type: { input: 'attend-school-type', error: 'attend-school-type-error' },
    mdcps_student_id: { input: 'attend-student-id', error: 'attend-student-id-error' },
    mdc_email: { input: 'attend-mdc-email', error: 'attend-mdc-email-error' },
    school_name: { input: 'attend-school-name', error: 'attend-school-name-error' },
    other_email: { input: 'attend-other-email', error: 'attend-other-email-error' },
    wants_public_comment: { input: null, error: 'attend-comment-error' }
  };

  // Which conditional block each answer to "Where do you go to school?" shows.
  var SCHOOL_BLOCKS = { mdcps: 'attend-school-mdcps', mdc: 'attend-school-mdc', other: 'attend-school-other' };

  function schoolType() { return el('attend-school-type').value; }

  function onSchoolTypeChange() {
    var type = schoolType();
    Object.keys(SCHOOL_BLOCKS).forEach(function (k) { el(SCHOOL_BLOCKS[k]).hidden = k !== type; });
    fieldError('school_type', '');
  }

  // The server names the email field school_email whichever block it's in.
  function fieldKey(name) {
    if (name === 'school_email') return schoolType() === 'mdc' ? 'mdc_email' : 'other_email';
    return name;
  }

  function fieldError(name, message) {
    var f = FIELDS[fieldKey(name)];
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
    var v = {
      full_name: el('attend-name').value.trim(),
      phone: el('attend-phone').value.trim(),
      school_type: schoolType(),
      wants_public_comment: choice ? choice.value : ''
    };
    // Only the visible block's fields are sent.
    if (v.school_type === 'mdcps') v.mdcps_student_id = el('attend-student-id').value.replace(/\s/g, '');
    if (v.school_type === 'mdc') v.school_email = el('attend-mdc-email').value.trim();
    if (v.school_type === 'other') {
      v.school_name = el('attend-school-name').value.trim().replace(/\s+/g, ' ');
      v.school_email = el('attend-other-email').value.trim();
    }
    return v;
  }

  // Format checks only. The exact student ID length is checked on the server
  // (STUDENT_ID_LENGTH in api/_bcc-signup.js), which sends back the message.
  function normalizePhone(value) {
    var digits = value.replace(/\D/g, '');
    return digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
  }

  function validate(v) {
    var firstBad = null;
    function bad(name, msg) { fieldError(name, msg); if (!firstBad) firstBad = name; }
    if (v.full_name.length < 2) bad('full_name', 'Please enter your full name.');
    if (normalizePhone(v.phone).length !== 10) bad('phone', 'Please enter a 10-digit phone number.');
    if (!v.school_type) bad('school_type', 'Please choose where you go to school.');
    if (v.school_type === 'mdcps' && !/^[0-9]+$/.test(v.mdcps_student_id)) bad('mdcps_student_id', 'Enter your MDCPS student ID, numbers only.');
    if (v.school_type === 'mdc' && !/^[^@\s]+@mymdc\.net$/i.test(v.school_email)) bad('mdc_email', 'Enter your Miami Dade College email, ending in @mymdc.net.');
    if (v.school_type === 'other') {
      if (v.school_name.length < 2) bad('school_name', 'Please enter the name of your school.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.school_email)) bad('other_email', 'Please enter your school email.');
    }
    if (!v.wants_public_comment) bad('wants_public_comment', 'Please choose yes, maybe, or no.');
    return firstBad;
  }

  function focusField(name) {
    var f = FIELDS[fieldKey(name)];
    var node = f && f.input ? el(f.input) : document.querySelector('input[name="wants_public_comment"]');
    if (node) node.focus();
  }

  function resetTurnstile() {
    if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
  }

  function onSubmit(e) {
    e.preventDefault();
    if (el('attend-submit').disabled || !meeting) return;
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
        turnstile_token: token,
        // Checked by api/_bot-check.js: the honeypot, and time on page from
        // the browser's own clock (immune to a wrong system clock).
        website: el('attend-website').value,
        form_elapsed_ms: Math.round(performance.now())
      }, v))
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = 'Sign up to attend';
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
        if (data.field && FIELDS[fieldKey(data.field)]) {
          fieldError(data.field, data.error);
          focusField(data.field);
          return;
        }
        setStatus(data.error || 'Could not save your sign-up. Please try again.', 'error');
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Sign up to attend';
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

  function renderInterestTurnstile() {
    if (!turnstileReady || interestWidgetId !== null || !window.turnstile) return;
    var key = siteKey();
    if (!key) {
      interestStatus('The security check isn’t configured yet. Please try again later.', 'error');
      el('interest-submit').disabled = true;
      return;
    }
    interestWidgetId = window.turnstile.render('#interest-turnstile', {
      sitekey: key, action: 'attend', size: 'flexible', theme: 'light'
    });
  }

  var INTEREST_FIELDS = { full_name: 'name', phone: 'phone', school_name: 'school', public_comment_interest: 'comment', notification_consent: 'consent' };
  function interestStatus(message, kind) {
    el('interest-status').textContent = message || '';
    el('interest-status').className = 'district-status' + (kind ? ' ' + kind : '');
  }
  function interestError(field, message) {
    var id = INTEREST_FIELDS[field];
    if (!id) return;
    el('interest-' + id + '-error').textContent = message || '';
    el('interest-' + id + '-error').hidden = !message;
    el('interest-' + id).setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  async function submitInterest(e) {
    e.preventDefault();
    if (interestSubmitting) return;
    Object.keys(INTEREST_FIELDS).forEach(function (f) { interestError(f, ''); });
    interestStatus('');
    var v = { full_name: el('interest-name').value.trim().replace(/\s+/g, ' '),
      phone: el('interest-phone').value.trim(), school_name: el('interest-school').value.trim(),
      public_comment_interest: el('interest-comment').value, notification_consent: el('interest-consent').checked };
    var errors = {};
    if (v.full_name.length < 2 || v.full_name.length > 120) errors.full_name = 'Please enter your full name.';
    if (!/^[+0-9(). -]+$/.test(v.phone) || normalizePhone(v.phone).length !== 10) errors.phone = 'Please enter a 10-digit mobile phone number.';
    if (v.school_name.length > 200) errors.school_name = 'Please use a school name of 200 characters or fewer.';
    if (!v.notification_consent) errors.notification_consent = 'Please agree to meeting participation texts to join the list.';
    var fields = Object.keys(errors);
    fields.forEach(function (f) { interestError(f, errors[f]); });
    if (fields.length) { el('interest-' + INTEREST_FIELDS[fields[0]]).focus(); return; }
    var token = interestWidgetId !== null && window.turnstile ? window.turnstile.getResponse(interestWidgetId) : '';
    if (!token) { interestStatus('Please complete the security check above the button.', 'error'); return; }
    interestSubmitting = true;
    el('interest-submit').disabled = true;
    el('interest-submit').textContent = 'Saving your interest…';
    try {
      var response = await fetch('/api/city-platform', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ op: 'submit_bcc_signup', registration_type: 'meeting_interest',
          website: el('interest-website').value, form_elapsed_ms: Math.round(performance.now()), turnstile_token: token }, v)) });
      var data = await response.json().catch(function () { return {}; });
      if (response.ok && data.ok === true) {
        el('interest-form').hidden = true;
        el('interest-success').hidden = false;
        el('interest-success').focus({ preventScroll: true });
        el('interest-success').scrollIntoView({ block: 'start' });
      } else {
        if (data.field && INTEREST_FIELDS[data.field]) {
          interestError(data.field, data.error);
          el('interest-' + INTEREST_FIELDS[data.field]).focus();
        } else interestStatus(data.error || 'Could not save your interest. Please try again.', 'error');
      }
    } catch (err) {
      interestStatus('Couldn’t reach the server. Check your connection and try again.', 'error');
    } finally {
      interestSubmitting = false;
      el('interest-submit').disabled = false;
      el('interest-submit').textContent = 'Get Notified About Upcoming Meetings';
      if (!el('interest-form').hidden && window.turnstile && interestWidgetId !== null) window.turnstile.reset(interestWidgetId);
    }
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
    document.querySelectorAll('[data-interest-year]').forEach(function (node) { node.textContent = el('meeting-interest').dataset.year; });
    el('interest-form').addEventListener('submit', submitInterest);
    renderInterestTurnstile();
    el('attend-form').addEventListener('submit', onSubmit);
    el('attend-school-type').addEventListener('change', onSchoolTypeChange);
    // A browser restoring the form on back/forward keeps the select's value.
    onSchoolTypeChange();
    load();
  });
})();
