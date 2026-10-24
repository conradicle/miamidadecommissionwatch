(function () {
  // Supabase Auth checks a Turnstile token on sign-in and on password reset
  // once CAPTCHA protection is on (Authentication > Attack Protection). Until
  // then it ignores the token, so this file is safe to ship first.
  var SECURITY_MESSAGE = "The security check didn't go through. Please try again.";

  function isCaptchaError(error) {
    return !!error && /captcha/i.test(error.message || '');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('login-form');
    var statusEl = document.getElementById('login-status');
    if (!form) return;

    // If already logged in, skip straight to whichever dashboard is theirs.
    if (typeof window.routeAfterLogin === 'function') {
      window.routeAfterLogin(statusEl);
    }

    var loginGuard = window.MDCW.botGuard.attach(form, {
      action: 'login',
      honeypot: false,
      container: document.getElementById('login-turnstile')
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;

      statusEl.textContent = 'Logging in...';
      statusEl.className = 'district-status';

      loginGuard.getToken()
        .then(function (token) {
          return supabaseClient.auth.signInWithPassword({
            email: email,
            password: password,
            options: { captchaToken: token }
          });
        })
        .then(function (res) {
          loginGuard.reset();
          if (res.error) {
            statusEl.textContent = isCaptchaError(res.error)
              ? SECURITY_MESSAGE
              : "That email and password don't match. Please try again.";
            statusEl.className = 'district-status error';
            return;
          }
          window.routeAfterLogin(statusEl);
        })
        .catch(function () {
          loginGuard.reset();
          statusEl.textContent = 'Something went wrong. Please try again.';
          statusEl.className = 'district-status error';
        });
    });

    var forgotLink = document.getElementById('forgot-password-link');
    var forgotForm = document.getElementById('forgot-password-form');
    var forgotStatus = document.getElementById('forgot-password-status');

    // Lazy: the form starts hidden; focusing its field starts the widget.
    var forgotGuard = window.MDCW.botGuard.attach(forgotForm, {
      action: 'reset',
      honeypot: false,
      lazy: true,
      container: document.getElementById('forgot-turnstile')
    });

    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      forgotLink.style.display = 'none';
      forgotForm.style.display = 'block';
      document.getElementById('forgot-email').focus();
    });

    // One message whether or not the address has an account, so this form
    // can't be used to find out who does.
    var SENT_MESSAGE = 'If that email has an account, we sent a reset link. Check your inbox and spam folder.';

    forgotForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('forgot-email').value.trim();
      var submitBtn = forgotForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      forgotStatus.textContent = 'Sending...';
      forgotStatus.className = 'district-status';

      forgotGuard.getToken()
        .then(function (token) {
          return supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://www.miamidadecommissionwatch.com/set-password.html',
            captchaToken: token
          });
        })
        .then(function (res) {
          submitBtn.disabled = false;
          forgotGuard.reset();
          // A failed security check says nothing about the address, so it is
          // the one error worth showing. Everything else gets SENT_MESSAGE.
          if (isCaptchaError(res.error)) {
            forgotStatus.textContent = SECURITY_MESSAGE;
            forgotStatus.className = 'district-status error';
            return;
          }
          forgotStatus.textContent = SENT_MESSAGE;
          forgotStatus.className = 'district-status success';
          forgotForm.reset();
        })
        .catch(function () {
          submitBtn.disabled = false;
          forgotGuard.reset();
          forgotStatus.textContent = 'Something went wrong. Please try again.';
          forgotStatus.className = 'district-status error';
        });
    });
  });
})();
