(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('set-password-form');
    var statusEl = document.getElementById('set-password-status');
    var introEl = document.getElementById('set-password-intro');
    if (!form) return;

    supabaseClient.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) {
        introEl.textContent = 'This invite link is invalid or has expired.';
        statusEl.innerHTML = 'Please ask an existing admin to send you a new invite, or <a href="login.html">log in</a> if you already have a password.';
        statusEl.className = 'district-status error';
        form.style.display = 'none';
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var password = document.getElementById('new-password').value;
      var confirm = document.getElementById('confirm-password').value;
      var submitBtn = form.querySelector('button[type="submit"]');

      if (password.length < 8) {
        statusEl.textContent = 'Password must be at least 8 characters.';
        statusEl.className = 'district-status error';
        return;
      }

      if (password !== confirm) {
        statusEl.textContent = 'Passwords don\'t match.';
        statusEl.className = 'district-status error';
        return;
      }

      statusEl.textContent = 'Setting password...';
      statusEl.className = 'district-status';
      submitBtn.disabled = true;

      supabaseClient.auth.updateUser({ password: password }).then(function (res) {
        if (res.error) {
          statusEl.textContent = 'Could not set password: ' + res.error.message;
          statusEl.className = 'district-status error';
          submitBtn.disabled = false;
          return;
        }
        statusEl.textContent = 'Password set. Redirecting...';
        statusEl.className = 'district-status success';
        setTimeout(function () {
          window.location.href = 'admin.html';
        }, 1000);
      });
    });
  });
})();
