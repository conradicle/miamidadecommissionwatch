(function () {
  // The footer form is on every page, so js/bot-guard.js is fetched here on
  // demand instead of adding a script tag to each of them.
  function withBotGuard(cb) {
    if (window.MDCW && window.MDCW.botGuard) { cb(); return; }
    var s = document.createElement('script');
    s.src = '/js/bot-guard.js?v=20261024';
    s.onload = cb;
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('newsletter-form');
    if (!form) return;

    var emailInput = document.getElementById('newsletter-email');
    var statusEl = document.getElementById('newsletter-status');
    var submitBtn = form.querySelector('button[type="submit"]');
    var guard = null;

    withBotGuard(function () {
      guard = window.MDCW.botGuard.attach(form, { action: 'newsletter', lazy: true });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = emailInput.value.trim();
      if (!email) return;
      if (!guard) {
        statusEl.textContent = 'Still loading. Please try again in a moment.';
        statusEl.className = 'newsletter-status error';
        return;
      }

      submitBtn.disabled = true;
      statusEl.textContent = 'Subscribing...';
      statusEl.className = 'newsletter-status';

      guard.getToken().then(function (token) {
        return fetch('/api/newsletter-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ email: email }, guard.fields(token)))
        });
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          submitBtn.disabled = false;
          guard.reset();
          if (!result.ok) {
            statusEl.textContent = result.data.error || 'Something went wrong. Please try again.';
            statusEl.className = 'newsletter-status error';
            return;
          }
          form.reset();
          statusEl.textContent = 'You’re subscribed. Check your inbox for a welcome email.';
          statusEl.className = 'newsletter-status success';
        })
        .catch(function () {
          submitBtn.disabled = false;
          guard.reset();
          statusEl.textContent = 'Could not reach the server. Please try again.';
          statusEl.className = 'newsletter-status error';
        });
    });
  });
})();
