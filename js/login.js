(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('login-form');
    var statusEl = document.getElementById('login-status');
    if (!form) return;

    // If already logged in, skip straight to the admin page.
    supabaseClient.auth.getSession().then(function (res) {
      if (res.data && res.data.session) {
        window.location.href = 'admin.html';
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;

      statusEl.textContent = 'Logging in...';
      statusEl.className = 'district-status';

      supabaseClient.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) {
            statusEl.textContent = 'Login failed: ' + res.error.message;
            statusEl.className = 'district-status error';
            return;
          }
          window.location.href = 'admin.html';
        })
        .catch(function () {
          statusEl.textContent = 'Something went wrong. Please try again.';
          statusEl.className = 'district-status error';
        });
    });
  });
})();
