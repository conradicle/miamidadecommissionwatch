(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('login-form');
    var statusEl = document.getElementById('login-status');
    if (!form) return;

    // If already logged in, skip straight to whichever dashboard is theirs.
    if (typeof window.routeAfterLogin === 'function') {
      window.routeAfterLogin(statusEl);
    }

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
          window.routeAfterLogin(statusEl);
        })
        .catch(function () {
          statusEl.textContent = 'Something went wrong. Please try again.';
          statusEl.className = 'district-status error';
        });
    });

    var forgotLink = document.getElementById('forgot-password-link');
    var forgotForm = document.getElementById('forgot-password-form');
    var forgotStatus = document.getElementById('forgot-password-status');

    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      forgotLink.style.display = 'none';
      forgotForm.style.display = 'block';
    });

    forgotForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('forgot-email').value.trim();
      var submitBtn = forgotForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      forgotStatus.textContent = 'Sending...';
      forgotStatus.className = 'district-status';

      supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://www.miamidadecommissionwatch.com/set-password.html'
      }).then(function (res) {
        submitBtn.disabled = false;
        if (res.error) {
          forgotStatus.textContent = 'Could not send reset email: ' + res.error.message;
          forgotStatus.className = 'district-status error';
          return;
        }
        forgotStatus.textContent = 'If that email is registered, a reset link has been sent. Check your inbox (and spam folder).';
        forgotStatus.className = 'district-status success';
        forgotForm.reset();
      }).catch(function () {
        submitBtn.disabled = false;
        forgotStatus.textContent = 'Something went wrong. Please try again.';
        forgotStatus.className = 'district-status error';
      });
    });
  });
})();
