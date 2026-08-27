// The public municipality registry and claim form (/municipalities.html).
//
// Reads the registry straight from Postgres with the anon key -- the RLS
// policies in migration_17 expose unclaimed and pending rows plus published
// active ones, which is exactly this list.
//
// Submitting a claim does NOT go through the anon key. It posts to
// /api/city-platform, which runs server-side with the service role so it can
// rate limit and send the notification email. migration_18 revokes anon's
// INSERT on claim_requests precisely so this is the only way in.
(function () {
  var cities = [];

  var STATUS = {
    unclaimed: { label: 'unclaimed', className: 'tag-unclaimed' },
    pending:   { label: 'requested', className: 'tag-pending' },
    active:    { label: 'covered',   className: 'tag-active' },
    suspended: { label: 'paused',    className: 'tag-suspended' }
  };

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(id, message, kind) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  // ---------- the list ----------
  function render() {
    var grid = el('muni-grid');
    if (!cities.length) {
      grid.innerHTML = '';
      setStatus('muni-status', 'No municipalities are listed yet.', 'error');
      return;
    }

    grid.innerHTML = cities.map(function (c) {
      var meta = STATUS[c.status] || STATUS.unclaimed;
      var tag = '<span class="muni-tag ' + meta.className + '">' + meta.label + '</span>';
      var name = '<span class="muni-name">' + escapeHtml(c.name) + '</span>';

      // A covered city links out to its own site; an unclaimed one opens the
      // request form; anything else is inert with its status showing.
      if (c.status === 'active') {
        return '<a class="muni" href="https://' + encodeURIComponent(c.slug) +
          '.miamidadecommissionwatch.com/" target="_blank" rel="noopener">' + name + tag + '</a>';
      }
      if (c.status === 'unclaimed') {
        return '<button type="button" class="muni" data-claim="' + escapeHtml(c.slug) + '">' +
          name + tag + '</button>';
      }
      return '<button type="button" class="muni" disabled>' + name + tag + '</button>';
    }).join('');
  }

  // ---------- the form ----------
  function openClaim(slug) {
    var city = cities.filter(function (c) { return c.slug === slug; })[0];
    if (!city) return;

    el('claim-slug').value = city.slug;
    el('claim-city-name').value = city.name;
    el('claim-heading').textContent = 'Request ' + city.name;
    el('claim-intro').textContent =
      'You’d be starting coverage of the ' + city.name + ' city commission from scratch. ' +
      'Tell us a bit about you and we’ll get back to you.';

    el('claim-placeholder').style.display = 'none';
    el('claim-form').style.display = '';
    setStatus('claim-status', '');
    el('request').scrollIntoView({ behavior: 'smooth', block: 'start' });
    el('claim-name').focus();
  }

  function closeClaim() {
    el('claim-form').style.display = 'none';
    el('claim-placeholder').style.display = '';
    el('claim-heading').textContent = 'Request a city';
  }

  function submitClaim(e) {
    e.preventDefault();
    var button = el('claim-submit');
    button.disabled = true;
    setStatus('claim-status', 'Sending…');

    var payload = {
      city_slug: el('claim-slug').value,
      city_name: el('claim-city-name').value,
      requester_name: el('claim-name').value.trim(),
      requester_email: el('claim-email').value.trim(),
      affiliation: el('claim-affiliation').value.trim(),
      reason: el('claim-reason').value.trim(),
      has_team: el('claim-has-team').checked
    };

    fetch('/api/city-platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ op: 'submit_claim' }, payload))
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (result) {
        button.disabled = false;
        if (!result.ok) {
          setStatus('claim-status', (result.body && result.body.error) || 'Something went wrong.', 'error');
          return;
        }
        el('claim-form').reset();
        setStatus('claim-status',
          'Request sent. We’ll email you at that address either way — usually within a few days.', 'success');
        load();
      })
      .catch(function () {
        button.disabled = false;
        setStatus('claim-status', 'Could not reach the server. Please try again.', 'error');
      });
  }

  // ---------- boot ----------
  function load() {
    return window.supabaseClient
      .from('cities')
      .select('slug, name, status, sort_order')
      .order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error) {
          setStatus('muni-status', 'Could not load the list of cities. Please refresh.', 'error');
          return;
        }
        cities = res.data || [];
        setStatus('muni-status', '');
        render();
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!el('muni-grid') || typeof window.supabaseClient === 'undefined') return;

    // Delegated: the grid is re-rendered after a successful claim.
    el('muni-grid').addEventListener('click', function (e) {
      var button = e.target.closest('[data-claim]');
      if (button) openClaim(button.getAttribute('data-claim'));
    });

    el('claim-form').addEventListener('submit', submitClaim);
    el('claim-cancel').addEventListener('click', closeClaim);

    load();
  });
})();
