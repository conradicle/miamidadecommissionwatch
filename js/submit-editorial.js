(function () {
  // Miami-Dade County Public Schools issues students <id>@students.dadeschools.net.
  // Checked here only so the student gets an answer before they lose a draft to a
  // round trip -- api/submit-editorial.js and the constraint in migration_15 are
  // what actually enforce it, since this file runs in the browser where anyone
  // can skip it. If one changes, change all three.
  var STUDENT_EMAIL = /^[^@\s]+@students\.dadeschools\.net$/i;

  var WRONG_DOMAIN_MESSAGE =
    'Please use your Miami-Dade County Public Schools student email (it ends in ' +
    '@students.dadeschools.net) so we can verify enrollment. If you attend a private ' +
    'or home school, email contact@miamidadecommissionwatch.com and we\'ll take your draft that way.';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('editorial-form');
    if (!form) return;

    var statusEl = document.getElementById('editorial-status');
    var emailInput = document.getElementById('editorial-email');
    var guard = window.MDCW.botGuard.attach(form, {
      action: 'editorial',
      container: document.getElementById('editorial-turnstile')
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var name = document.getElementById('editorial-name').value.trim();
      var grade = document.getElementById('editorial-grade').value.trim();
      var school = document.getElementById('editorial-school').value.trim();
      var email = emailInput.value.trim();
      var title = document.getElementById('editorial-title').value.trim();
      var topic = document.getElementById('editorial-topic').value.trim();
      var body = document.getElementById('editorial-body').value.trim();
      var confirmed = document.getElementById('editorial-confirm').checked;
      var submitBtn = form.querySelector('button[type="submit"]');

      if (!name || !grade || !school || !email || !title || !body) {
        statusEl.textContent = 'Please fill in every required field.';
        statusEl.className = 'district-status error';
        return;
      }

      if (!STUDENT_EMAIL.test(email)) {
        statusEl.textContent = WRONG_DOMAIN_MESSAGE;
        statusEl.className = 'district-status error';
        emailInput.focus();
        return;
      }

      if (!confirmed) {
        statusEl.textContent = 'Please confirm this is your own original work before submitting.';
        statusEl.className = 'district-status error';
        return;
      }

      statusEl.textContent = 'Submitting...';
      statusEl.className = 'district-status';
      submitBtn.disabled = true;

      // Goes through the API rather than inserting straight into Supabase, so
      // the submission is rate limited per IP and the table can stay closed to
      // the public anon key. See supabase/migration_15_editorial_school_email_
      // and_submit_lockdown.sql.
      guard.getToken().then(function (token) {
        return fetch('/api/submit-editorial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({
            name: name,
            grade: grade,
            school: school,
            school_email: email,
            title: title,
            topic: topic || null,
            body: body
          }, guard.fields(token)))
        });
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          submitBtn.disabled = false;
          guard.reset();
          if (!result.ok) {
            // The API's own message is the useful one for a rejected email
            // address, a bad grade, or a throttled connection.
            statusEl.textContent = (result.data && result.data.error) ||
              'Something went wrong submitting your editorial. Please try again, or email contact@miamidadecommissionwatch.com directly.';
            statusEl.className = 'district-status error';
            return;
          }
          form.reset();
          statusEl.textContent = 'Thanks! Your editorial has been submitted for review. We\'ll be in touch if it\'s selected for publishing.';
          statusEl.className = 'district-status success';
        })
        .catch(function () {
          submitBtn.disabled = false;
          guard.reset();
          statusEl.textContent = 'Something went wrong submitting your editorial. Please try again, or email contact@miamidadecommissionwatch.com directly.';
          statusEl.className = 'district-status error';
        });
    });
  });
})();
