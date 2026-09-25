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

  // Only for cities that are neither covered nor open to claim.
  var STATUS = {
    pending:   { label: 'requested', className: 'tag-pending' },
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

  // ---------- the lists ----------
  // Mirrors renderMunicipalities in scripts/lib/render.mjs, which prerenders
  // the same markup at build time. Change both together.
  function render() {
    if (!cities.length) {
      el('muni-covered').innerHTML = '';
      el('muni-open').innerHTML = '';
      el('muni-count').textContent = '';
      setStatus('muni-status', 'No municipalities are listed yet.', 'error');
      return;
    }

    var covered = cities.filter(function (c) { return c.status === 'active'; });
    var open = cities.filter(function (c) { return c.status !== 'active'; });

    // A covered city links out to its own site.
    el('muni-covered').innerHTML = covered.length
      ? covered.map(function (c) {
          return '<li><a class="card muni-card" href="https://' + encodeURIComponent(c.slug) +
            '.miamidadecommissionwatch.com/" target="_blank" rel="noopener">' +
            '<h3>' + escapeHtml(c.name) + '</h3>' +
            '<p>Read our ' + escapeHtml(c.name) + ' coverage</p>' +
            '<span class="muni-card-url mono">' + escapeHtml(c.slug) + '.miamidadecommissionwatch.com</span>' +
            '</a></li>';
        }).join('')
      : '<li class="muni-empty">No city has a team yet.</li>';

    el('muni-count').textContent = covered.length + ' of ' + cities.length + ' cities covered';

    // An unclaimed city links to the request form; anything else shows its
    // status and has no link.
    el('muni-open').innerHTML = open.map(function (c) {
      var name = '<span class="muni-name">' + escapeHtml(c.name) + '</span>';
      if (c.status === 'unclaimed') {
        return '<li class="muni">' + name +
          '<a class="muni-claim" href="#request" data-claim="' + escapeHtml(c.slug) + '">' +
          'Claim this city<span class="sr-only">: ' + escapeHtml(c.name) + '</span></a></li>';
      }
      var meta = STATUS[c.status] || STATUS.pending;
      return '<li class="muni">' + name +
        '<span class="muni-tag ' + meta.className + '">' + meta.label + '</span></li>';
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
    if (!el('muni-open') || typeof window.supabaseClient === 'undefined') return;

    // Delegated: the list is re-rendered after a successful claim. A claim
    // link is a real link to #request, so Enter works on it natively; here it
    // also fills in the city and moves focus into the form.
    el('muni-open').addEventListener('click', function (e) {
      var link = e.target.closest('[data-claim]');
      if (!link) return;
      e.preventDefault();
      openClaim(link.getAttribute('data-claim'));
    });

    el('claim-form').addEventListener('submit', submitClaim);
    el('claim-cancel').addEventListener('click', closeClaim);

    load();
  });
})();
