// District and topic subscription controls.
//
// Two modes, chosen by which elements are on the page:
//   * #alerts-form (Get Involved) -- new signup with preferences.
//   * #prefs-form (manage-subscription.html) -- edit an existing subscriber's
//     preferences, authenticated by the token in their email footer.
//
// The checkbox vocabulary is duplicated in three places by necessity (SQL
// constraint, api/_prefs.js, here). If you add a topic, change all three.
(function () {
  var TOPICS = ['Housing', 'Transit', 'Zoning', 'Public Safety', 'Taxes & Budget', 'Environment', 'Parks', 'Other'];
  var DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;');
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  function buildChecks(container, values, nameAttr, labelFn) {
    if (!container) return;
    container.innerHTML = values.map(function (v) {
      return '<label class="pref-check">' +
        '<input type="checkbox" name="' + nameAttr + '" value="' + esc(String(v)) + '">' +
        '<span>' + esc(labelFn(v)) + '</span>' +
      '</label>';
    }).join('');
  }

  function selected(container, nameAttr) {
    if (!container) return [];
    return Array.prototype.slice
      .call(container.querySelectorAll('input[name="' + nameAttr + '"]:checked'))
      .map(function (i) { return i.value; });
  }

  function setChecked(container, nameAttr, values) {
    if (!container) return;
    var wanted = (values || []).map(String);
    Array.prototype.forEach.call(
      container.querySelectorAll('input[name="' + nameAttr + '"]'),
      function (input) { input.checked = wanted.indexOf(input.value) !== -1; }
    );
  }

  function renderControls(districtsEl, topicsEl) {
    buildChecks(districtsEl, DISTRICTS, 'districts', function (d) { return 'District ' + d; });
    buildChecks(topicsEl, TOPICS, 'topics', function (t) { return t; });
  }

  // districts arrive as strings from the DOM; the API validates them as
  // numbers, and int[] in Postgres will not take "5".
  function toNumbers(list) {
    return list.map(Number).filter(function (n) { return !isNaN(n); });
  }

  // -------------------------------------------------------------------
  // Mode 1: signup with preferences (Get Involved)
  // -------------------------------------------------------------------
  function initSignup() {
    var form = document.getElementById('alerts-form');
    if (!form) return;

    var districtsEl = document.getElementById('alerts-districts');
    var topicsEl = document.getElementById('alerts-topics');
    var emailEl = document.getElementById('alerts-email');
    var statusEl = document.getElementById('alerts-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    renderControls(districtsEl, topicsEl);

    // js/bot-guard.js is loaded by get-involved.html before this file.
    var guard = window.MDCW.botGuard.attach(form, { action: 'newsletter' });

    // Arriving from the homepage district panel: "Get District 5 alerts"
    // should land with District 5 already ticked.
    var preset = qs('district');
    if (preset) {
      setChecked(districtsEl, 'districts', [preset]);
      form.scrollIntoView({ block: 'center' });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = emailEl.value.trim();
      if (!email) return;

      var districts = toNumbers(selected(districtsEl, 'districts'));
      var topics = selected(topicsEl, 'topics');

      submitBtn.disabled = true;
      statusEl.textContent = 'Saving...';
      statusEl.className = 'newsletter-status';

      guard.getToken().then(function (token) {
        return fetch('/api/newsletter-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({
            email: email,
            districts: districts,
            topics: topics,
            all_meetings: districts.length === 0 && topics.length === 0
          }, guard.fields(token)))
        });
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          submitBtn.disabled = false;
          guard.reset();
          if (!result.ok) {
            statusEl.textContent = result.data.error || 'Something went wrong. Please try again.';
            statusEl.className = 'newsletter-status error';
            return;
          }
          statusEl.className = 'newsletter-status success';
          if (districts.length || topics.length) {
            statusEl.textContent = 'Done. We\'ll email you when a matching item is on an agenda or gets voted on. ' +
              'You can change this any time from the link in any email.';
          } else {
            statusEl.textContent = 'Done. You\'ll get every agenda and recap. ' +
              'Pick districts or topics above if you\'d rather only hear about some of them.';
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          guard.reset();
          statusEl.textContent = 'Could not reach the server. Please try again.';
          statusEl.className = 'newsletter-status error';
        });
    });
  }

  // -------------------------------------------------------------------
  // Mode 2: manage an existing subscription
  // -------------------------------------------------------------------
  function initManage() {
    var form = document.getElementById('prefs-form');
    if (!form) return;

    var districtsEl = document.getElementById('prefs-districts');
    var topicsEl = document.getElementById('prefs-topics');
    var statusEl = document.getElementById('prefs-status');
    var whoEl = document.getElementById('prefs-who');
    var allEl = document.getElementById('prefs-all');
    var resubEl = document.getElementById('prefs-resubscribe');
    var submitBtn = form.querySelector('button[type="submit"]');

    renderControls(districtsEl, topicsEl);

    var token = qs('token');
    if (!token) {
      statusEl.textContent = 'This link is missing its token. Use the "Choose what you get" link from any of our emails.';
      statusEl.className = 'newsletter-status error';
      form.hidden = true;
      return;
    }

    fetch('/api/newsletter-preferences?token=' + encodeURIComponent(token))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (result) {
        if (!result.ok) {
          statusEl.textContent = result.data.error || 'Could not load your preferences.';
          statusEl.className = 'newsletter-status error';
          form.hidden = true;
          return;
        }

        form.hidden = false;
        if (whoEl) whoEl.textContent = result.data.email || '';

        setChecked(districtsEl, 'districts', result.data.districts);
        setChecked(topicsEl, 'topics', result.data.topics);
        if (allEl) allEl.checked = result.data.all_meetings !== false;

        if (result.data.status === 'unsubscribed' && resubEl) {
          resubEl.hidden = false;
        }
      })
      .catch(function () {
        statusEl.textContent = 'Could not reach the server. Please try again.';
        statusEl.className = 'newsletter-status error';
      });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var districts = toNumbers(selected(districtsEl, 'districts'));
      var topics = selected(topicsEl, 'topics');
      var all = allEl ? allEl.checked : false;

      submitBtn.disabled = true;
      statusEl.textContent = 'Saving...';
      statusEl.className = 'newsletter-status';

      fetch('/api/newsletter-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          districts: districts,
          topics: topics,
          all_meetings: all,
          resubscribe: resubEl && !resubEl.hidden
        })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          submitBtn.disabled = false;
          if (!result.ok) {
            statusEl.textContent = result.data.error || 'Could not save your preferences.';
            statusEl.className = 'newsletter-status error';
            return;
          }
          statusEl.textContent = 'Saved.';
          statusEl.className = 'newsletter-status success';
          if (resubEl) resubEl.hidden = true;
        })
        .catch(function () {
          submitBtn.disabled = false;
          statusEl.textContent = 'Could not reach the server. Please try again.';
          statusEl.className = 'newsletter-status error';
        });
    });
  }

  // Ticking any district or topic means "only these", so it should visibly
  // clear the "send me everything" box rather than silently conflicting.
  function linkAllToggle() {
    document.addEventListener('change', function (e) {
      if (!e.target.matches('input[name="districts"], input[name="topics"]')) return;
      var allEl = document.getElementById('prefs-all');
      if (allEl && e.target.checked) allEl.checked = false;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initSignup();
    initManage();
    linkAllToggle();
  });
})();
