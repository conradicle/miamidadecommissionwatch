(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('newsletter-form');
    if (!form) return;

    var emailInput = document.getElementById('newsletter-email');
    var statusEl = document.getElementById('newsletter-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = emailInput.value.trim();
      if (!email) return;

      submitBtn.disabled = true;
      statusEl.textContent = 'Subscribing...';
      statusEl.className = 'newsletter-status';

      fetch('/api/newsletter-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          submitBtn.disabled = false;
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
          statusEl.textContent = 'Could not reach the server. Please try again.';
          statusEl.className = 'newsletter-status error';
        });
    });
  });
})();
