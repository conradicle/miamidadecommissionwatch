// Handles the Start a City Watch application form (start-a-city.html).
// Mirrors js/submit-editorial.js: validate, then insert directly into
// city_applications with the anon key. RLS only allows rows in the pending
// state (see supabase/migration_13_city_program.sql), so nothing goes live
// without staff approving it from the admin dashboard.
(function () {
  var PERSONAL_EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
    'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'msn.com', 'comcast.net'
  ];

  function isSchoolEmail(email) {
    var at = email.lastIndexOf('@');
    if (at === -1) return false;
    var domain = email.slice(at + 1).toLowerCase().trim();
    return domain.length > 0 && PERSONAL_EMAIL_DOMAINS.indexOf(domain) === -1;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('city-apply-form');
    if (!form) return;

    var statusEl = document.getElementById('city-apply-status');
    var emailInput = document.getElementById('city-apply-email');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var city = document.getElementById('city-apply-city').value.trim();
      var name = document.getElementById('city-apply-name').value.trim();
      var grade = document.getElementById('city-apply-grade').value.trim();
      var school = document.getElementById('city-apply-school').value.trim();
      var email = emailInput.value.trim();
      var why = document.getElementById('city-apply-why').value.trim();
      var confirmed = document.getElementById('city-apply-confirm').checked;
      var submitBtn = form.querySelector('button[type="submit"]');

      if (!city || !name || !grade || !school || !email || !why) {
        statusEl.textContent = 'Please fill in every required field.';
        statusEl.className = 'district-status error';
        return;
      }

      if (!isSchoolEmail(email)) {
        statusEl.textContent = 'Please use your school-issued email address rather than a personal Gmail, Yahoo, or similar account, so we can verify you\'re a Miami-Dade County student.';
        statusEl.className = 'district-status error';
        emailInput.focus();
        return;
      }

      if (!confirmed) {
        statusEl.textContent = 'Please confirm you\'ve read and agree to the standards before submitting.';
        statusEl.className = 'district-status error';
        return;
      }

      statusEl.textContent = 'Submitting...';
      statusEl.className = 'district-status';
      submitBtn.disabled = true;

      supabaseClient
        .from('city_applications')
        .insert({
          city_name: city,
          applicant_name: name,
          grade: grade,
          school: school,
          school_email: email,
          why: why
        })
        .then(function (res) {
          submitBtn.disabled = false;
          if (res.error) {
            statusEl.textContent = 'Something went wrong submitting your application. Please try again, or email contact@miamidadecommissionwatch.com directly.';
            statusEl.className = 'district-status error';
            return;
          }
          form.reset();
          statusEl.textContent = 'Application received! We read every one and will follow up at your school email.';
          statusEl.className = 'district-status success';
        })
        .catch(function () {
          submitBtn.disabled = false;
          statusEl.textContent = 'Something went wrong submitting your application. Please try again, or email contact@miamidadecommissionwatch.com directly.';
          statusEl.className = 'district-status error';
        });
    });
  });
})();
