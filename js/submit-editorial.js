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
    var form = document.getElementById('editorial-form');
    if (!form) return;

    var statusEl = document.getElementById('editorial-status');
    var emailInput = document.getElementById('editorial-email');

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

      if (!isSchoolEmail(email)) {
        statusEl.textContent = 'Please use your school-issued email address rather than a personal Gmail, Yahoo, or similar account, so we can verify you\'re a Miami-Dade County student.';
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

      supabaseClient
        .from('editorial_submissions')
        .insert({
          name: name,
          grade: grade,
          school: school,
          school_email: email,
          title: title,
          topic: topic || null,
          body: body
        })
        .then(function (res) {
          submitBtn.disabled = false;
          if (res.error) {
            statusEl.textContent = 'Something went wrong submitting your editorial. Please try again, or email contact@miamidadecommissionwatch.com directly.';
            statusEl.className = 'district-status error';
            return;
          }
          form.reset();
          statusEl.textContent = 'Thanks — your editorial has been submitted for review. We\'ll be in touch if it\'s selected for publishing.';
          statusEl.className = 'district-status success';
        })
        .catch(function () {
          submitBtn.disabled = false;
          statusEl.textContent = 'Something went wrong submitting your editorial. Please try again, or email contact@miamidadecommissionwatch.com directly.';
          statusEl.className = 'district-status error';
        });
    });
  });
})();
