// /ambassadors: School Ambassador application form.
//
// Sends to api/city-platform.js (op submit_ambassador_application), which
// runs the shared bot checks and writes with the service role; the browser
// can't insert directly (migration_36). The checks here only exist so the
// student hears about a problem before the round trip. The server repeats
// every one, and the database repeats them again as constraints. If a limit
// changes, change js/ambassadors.js, api/_ambassador-application.js and
// migration_36 together.
(function () {
  var MOTIVATION_MIN = 50;
  var MOTIVATION_MAX = 1000;
  var LONG_TEXT_MAX = 2000;
  var MIN_GRAD_YEAR = 2026;
  var MAX_GRAD_YEAR = 2036;
  var MAX_TURNOUT = 5000;
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var GENERIC_ERROR = 'Something went wrong sending your application. Please try again, or DM us on Instagram.';

  // Server field name -> the input to mark and the error line under it.
  var FIELDS = {
    full_name: { input: 'amb-name', error: 'amb-name-error' },
    email: { input: 'amb-email', error: 'amb-email-error' },
    phone: { input: 'amb-phone', error: 'amb-phone-error' },
    school_name: { input: 'amb-school', error: 'amb-school-error' },
    grade: { input: 'amb-grade', error: 'amb-grade-error' },
    graduation_year: { input: 'amb-grad-year', error: 'amb-grad-year-error' },
    attended_bcc_with_mdcw: { radio: 'attended_bcc_with_mdcw', error: 'amb-attended-error' },
    involvement: { input: 'amb-involvement', error: 'amb-involvement-error' },
    motivation: { input: 'amb-motivation', error: 'amb-motivation-error' },
    leadership_experience: { input: 'amb-leadership', error: 'amb-leadership-error' },
    expected_turnout: { input: 'amb-turnout', error: 'amb-turnout-error' },
    knows_absence_contact: { radio: 'knows_absence_contact', error: 'amb-absence-error' },
    guardian_name: { input: 'amb-guardian-name', error: 'amb-guardian-name-error' },
    guardian_phone: { input: 'amb-guardian-phone', error: 'amb-guardian-phone-error' },
    acknowledged_duties: { input: 'amb-ack', error: 'amb-ack-error' }
  };

  function el(id) { return document.getElementById(id); }

  function radioValue(name) {
    var checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : '';
  }

  function normalizePhone(value) {
    var digits = value.replace(/\D/g, '');
    return digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
  }

  function setStatus(message, kind) {
    var node = el('amb-status');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function fieldError(name, message) {
    var f = FIELDS[name];
    if (!f) return;
    var err = el(f.error);
    err.textContent = message || '';
    err.hidden = !message;
    var inputs = f.radio
      ? document.querySelectorAll('input[name="' + f.radio + '"]')
      : [el(f.input)];
    Array.prototype.forEach.call(inputs, function (input) {
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message) input.setAttribute('aria-describedby', f.error);
      else if (input.getAttribute('aria-describedby') === f.error) input.removeAttribute('aria-describedby');
    });
  }

  function clearErrors() {
    Object.keys(FIELDS).forEach(function (k) { fieldError(k, ''); });
    setStatus('');
  }

  function focusField(name) {
    var f = FIELDS[name];
    if (!f) return;
    var node = f.radio ? document.querySelector('input[name="' + f.radio + '"]') : el(f.input);
    if (node) node.focus();
  }

  function values() {
    return {
      full_name: el('amb-name').value.trim().replace(/\s+/g, ' '),
      email: el('amb-email').value.trim(),
      phone: el('amb-phone').value.trim(),
      school_name: el('amb-school').value.trim().replace(/\s+/g, ' '),
      grade: el('amb-grade').value,
      graduation_year: el('amb-grad-year').value.trim(),
      attended_bcc_with_mdcw: radioValue('attended_bcc_with_mdcw'),
      involvement: el('amb-involvement').value.trim(),
      motivation: el('amb-motivation').value.trim(),
      leadership_experience: el('amb-leadership').value.trim(),
      expected_turnout: el('amb-turnout').value.trim(),
      knows_absence_contact: radioValue('knows_absence_contact'),
      guardian_name: el('amb-guardian-name').value.trim().replace(/\s+/g, ' '),
      guardian_phone: el('amb-guardian-phone').value.trim(),
      acknowledged_duties: el('amb-ack').checked
    };
  }

  // Returns the first field with a problem, or null. Marks every bad field so
  // the student can fix them all in one pass.
  function validate(v) {
    var firstBad = null;
    function bad(name, msg) { fieldError(name, msg); if (!firstBad) firstBad = name; }

    if (v.full_name.length < 2) bad('full_name', 'Please enter your full name.');
    if (!EMAIL.test(v.email)) bad('email', 'Please enter a valid email address.');
    if (normalizePhone(v.phone).length !== 10) bad('phone', 'Please enter a 10-digit phone number.');
    if (v.school_name.length < 2) bad('school_name', 'Please enter the name of your school.');
    if (!v.grade) bad('grade', 'Please choose your grade.');
    var year = /^[0-9]{4}$/.test(v.graduation_year) ? Number(v.graduation_year) : NaN;
    if (!(year >= MIN_GRAD_YEAR && year <= MAX_GRAD_YEAR)) {
      bad('graduation_year', 'Please enter a graduation year between ' + MIN_GRAD_YEAR + ' and ' + MAX_GRAD_YEAR + '.');
    }
    if (!v.attended_bcc_with_mdcw) bad('attended_bcc_with_mdcw', 'Please choose yes or no.');
    if (v.involvement.length > LONG_TEXT_MAX) bad('involvement', 'Please keep this under ' + LONG_TEXT_MAX + ' characters.');
    if (v.motivation.length < MOTIVATION_MIN) {
      bad('motivation', 'Please write at least ' + MOTIVATION_MIN + ' characters. You have ' + v.motivation.length + ' so far.');
    } else if (v.motivation.length > MOTIVATION_MAX) {
      bad('motivation', 'Please keep this to ' + MOTIVATION_MAX + ' characters or fewer.');
    }
    if (v.leadership_experience.length > LONG_TEXT_MAX) bad('leadership_experience', 'Please keep this under ' + LONG_TEXT_MAX + ' characters.');
    var turnout = /^[0-9]{1,4}$/.test(v.expected_turnout) ? Number(v.expected_turnout) : NaN;
    if (!(turnout >= 0 && turnout <= MAX_TURNOUT)) bad('expected_turnout', 'Please enter a whole number, like 10.');
    if (!v.knows_absence_contact) bad('knows_absence_contact', 'Please choose yes, no, or not sure.');
    if (v.guardian_name && v.guardian_name.length < 2) bad('guardian_name', 'Please enter the full name, or leave this blank.');
    if (v.guardian_phone && normalizePhone(v.guardian_phone).length !== 10) {
      bad('guardian_phone', 'Please enter a 10-digit phone number, or leave this blank.');
    }
    if (!v.acknowledged_duties) bad('acknowledged_duties', 'Please check the box to confirm you understand the role.');
    return firstBad;
  }

  function updateCount() {
    var len = el('amb-motivation').value.trim().length;
    el('amb-motivation-count').querySelector('.amb-count').textContent = len;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = el('amb-form');
    if (!form || !window.MDCW || !window.MDCW.botGuard) return;

    var btn = el('amb-submit');
    var submitting = false;
    var guard = window.MDCW.botGuard.attach(form, {
      action: 'ambassador',
      container: el('amb-turnstile')
    });

    el('amb-motivation').addEventListener('input', updateCount);
    updateCount();

    // Clear a field's error as soon as the student changes it.
    Object.keys(FIELDS).forEach(function (name) {
      var f = FIELDS[name];
      var inputs = f.radio ? document.querySelectorAll('input[name="' + f.radio + '"]') : [el(f.input)];
      Array.prototype.forEach.call(inputs, function (input) {
        input.addEventListener('change', function () { fieldError(name, ''); });
      });
    });

    function finish() {
      submitting = false;
      btn.disabled = false;
      btn.textContent = 'Send application';
      guard.reset();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // One request at a time, however many times the button is pressed.
      if (submitting) return;
      clearErrors();

      var v = values();
      var firstBad = validate(v);
      if (firstBad) {
        setStatus('Please fix the highlighted fields.', 'error');
        focusField(firstBad);
        return;
      }

      submitting = true;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      guard.getToken().then(function (token) {
        return fetch('/api/city-platform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ op: 'submit_ambassador_application' }, v, guard.fields(token)))
        });
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            finish();
            var data = result.data || {};
            if (data.field && FIELDS[data.field]) {
              fieldError(data.field, data.error);
              focusField(data.field);
              setStatus('Please fix the highlighted field.', 'error');
            } else {
              setStatus(data.error || GENERIC_ERROR, 'error');
            }
            return;
          }
          // Leave the button disabled: the form is gone, and a second send
          // would file a duplicate application.
          guard.reset();
          form.reset();
          form.hidden = true;
          var success = el('amb-success');
          success.hidden = false;
          success.scrollIntoView({ block: 'start' });
          success.focus({ preventScroll: true });
        })
        .catch(function () {
          finish();
          setStatus(GENERIC_ERROR, 'error');
        });
    });
  });
})();
