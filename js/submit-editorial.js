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

      var subject = 'Editorial submission: ' + title;
      var lines = [
        'Name: ' + name,
        'Grade: ' + grade,
        'School: ' + school,
        'School email: ' + email,
        'Related legislation/topic: ' + (topic || '(not specified)'),
        '',
        'Your editorial text has been copied to your clipboard.',
        'Paste it below this line before sending:',
        '----------------------------------------',
        ''
      ];
      var mailtoUrl = 'mailto:contact@miamidadecommissionwatch.com' +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(lines.join('\n'));

      var copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body).then(function () { copied = true; }).catch(function () {});
      }

      window.location.href = mailtoUrl;

      statusEl.innerHTML = 'Your email app should now be open with your submission details. <strong>Your editorial text was copied to your clipboard' +
        (copied ? '' : ' (if that didn\'t work, copy it manually from the box above)') +
        ' — paste it into the email before sending.</strong> If nothing opened, email <a href="mailto:contact@miamidadecommissionwatch.com">contact@miamidadecommissionwatch.com</a> directly with the same information.';
      statusEl.className = 'district-status success';
    });
  });
})();
