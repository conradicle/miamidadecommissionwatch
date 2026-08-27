// Drives every city subdomain from one template (city/index.html).
//
// Each city commission is served from its own subdomain -- for example
// miamibeach.miamidadecommissionwatch.com -- but there is only one deployment
// and one copy of this file. The subdomain is the routing key: this script
// reads it off location.hostname, looks the city up, and renders the page.
//
// STAGE 2 SCOPE. The two cities below are hardcoded fixtures whose only job is
// to prove that subdomain routing works end to end. They deliberately contain
// no officials, no meetings and no boundary data: inventing a commissioner or a
// district would be worse than an empty state, so every list renders an honest
// "not recorded yet" instead. Real content arrives with the database in
// Stage 3, and the map in Stage 6.
//
// Plain global IIFE, matching the rest of js/ -- no build step, no modules.
(function () {
  // ---------- the fixtures ----------
  // governance is the field the map keys off, and the only one that changes
  // how the page renders:
  //   'district'  the city elects commissioners from single-member districts,
  //               so an address lookup can answer "you are in District 3"
  //   'at-large'  every commissioner is elected citywide, so there are no
  //               districts to look up and the map shows the city outline only
  var CITIES = {
    'miamibeach': {
      name: 'Miami Beach',
      body: 'Miami Beach City Commission',
      governance: 'at-large',
      // Verified: the Mayor and six Commissioners are all elected citywide,
      // unlike the county commission's 13 single-member districts.
      seatSummary: 'A Mayor and six Commissioners, all elected citywide.',
      website: 'https://www.miamibeachfl.gov/'
    },
    'hialeah': {
      name: 'Hialeah',
      body: 'Hialeah City Council',
      // FLAGGED FOR VERIFICATION before this city goes live: this is set to
      // 'district' because the rebuild brief lists Hialeah as a district city,
      // but Hialeah's council seats may in fact be elected citywide. Confirm
      // against the city charter and correct this field if so -- the whole
      // point of the two modes is not to show districts a city doesn't have.
      governance: 'district',
      seatSummary: 'Seat structure not yet verified against the city charter.',
      website: null
    }
  };

  var ROOT_DOMAIN = 'miamidadecommissionwatch.com';
  // Hosts that are the county site, never a city, even though they parse as a
  // subdomain of the root domain.
  var RESERVED = ['www', 'admin', 'api', 'mail', 'staff'];

  // ---------- slug resolution ----------
  // Production: read the subdomain. Local dev and preview deployments have no
  // city subdomain to read, so ?city=<slug> stands in -- vercel dev ignores
  // host-based routing rules entirely, so without this there is no way to see
  // a city page before deploying.
  function resolveSlug() {
    var host = String(window.location.hostname || '').toLowerCase();

    if (host.length > ROOT_DOMAIN.length && host.slice(-(ROOT_DOMAIN.length + 1)) === '.' + ROOT_DOMAIN) {
      var sub = host.slice(0, host.length - ROOT_DOMAIN.length - 1);
      // Only a single label counts: a.b.example.com is not a city.
      if (sub.indexOf('.') === -1 && RESERVED.indexOf(sub) === -1) return sub;
    }

    var match = /[?&]city=([a-z0-9-]+)/.exec(String(window.location.search || '').toLowerCase());
    if (match) return match[1];

    return null;
  }

  // ---------- helpers ----------
  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = text;
  }

  function setHtml(id, html) {
    var node = el(id);
    if (node) node.innerHTML = html;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only http/https, so a URL entered by a city team can't carry a javascript:
  // URI that runs when a visitor clicks it. Same guard the county pages use.
  function safeHref(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (e) {
      return null;
    }
  }

  function notice(text) {
    var box = el('city-notice');
    setText('city-notice-text', text);
    if (box) box.style.display = '';
  }

  function emptyState(message) {
    return '<p style="color:var(--ink-400); font-style:italic;">' + escapeHtml(message) + '</p>';
  }

  // ---------- render ----------
  function renderUnknown(slug) {
    document.title = 'City not found - Miami-Dade Commission Watch';
    setText('city-wordmark', 'City');
    setText('city-eyebrow', 'Not found');
    setText('city-heading', 'No coverage here yet');
    setText('city-lede', slug
      ? 'There is no city commission coverage at this address yet.'
      : 'This page is served from a city subdomain. Open it at a city address to see that city’s coverage.');
    notice('If you think this city should be covered, you can request it on the county site.');

    ['city-what', 'city-officials', 'city-map-intro', 'city-meetings', 'city-comment'].forEach(function (id) {
      setHtml(id, '');
    });
    setHtml('city-map-intro', emptyState('No city selected.'));
  }

  function renderCity(slug, city) {
    var name = city.name;

    document.title = name + ' Commission Watch';
    setText('city-wordmark', name);
    setText('city-eyebrow', name);
    setText('city-heading', name + ' Commission Watch');
    setText('city-lede', 'Student-led coverage of the ' + city.body +
      ' — who serves on it, what it decides, and how to be heard at a meeting.');

    notice('Placeholder site. This city’s officials, meetings and boundary data have not been entered yet.');

    // What it does
    var whatHtml = '<p style="max-width:66ch;">The ' + escapeHtml(city.body) +
      ' is the elected body that sets the city’s budget, passes local ordinances, and decides land use and zoning inside city limits. ' +
      'It is separate from the Miami-Dade Board of County Commissioners, which handles countywide services.</p>' +
      '<p style="max-width:66ch;">' + escapeHtml(city.seatSummary) + '</p>';
    if (city.website) {
      var href = safeHref(city.website);
      if (href) {
        whatHtml += '<p><a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">Official city website &#8599;</a></p>';
      }
    }
    whatHtml += '<p style="color:var(--ink-600);"><strong>Next meeting:</strong> not recorded yet.</p>';
    setHtml('city-what', whatHtml);

    // Officials -- deliberately empty rather than invented.
    setHtml('city-officials', emptyState('No officials recorded yet for ' + name + '.'));

    // Map: the one place the two governance modes diverge.
    if (city.governance === 'at-large') {
      setText('map-heading', 'Every seat is citywide');
      setHtml('city-map-intro',
        '<p style="max-width:66ch;">' + escapeHtml(name) + ' has no commission districts. ' +
        'Every member of the ' + escapeHtml(city.body) + ' is elected citywide, which means ' +
        '<strong>every resident is represented by all of them</strong> — there is no single ' +
        'commissioner assigned to your address, and you may contact any of them.</p>');
      setHtml('city-map-mount', emptyState('City boundary outline not loaded yet (Stage 6).'));
    } else {
      setText('map-heading', 'Find your district');
      setHtml('city-map-intro',
        '<p style="max-width:66ch;">' + escapeHtml(name) + ' elects commissioners from single-member ' +
        'districts. Enter your address to find which district you live in and who represents it.</p>');
      setHtml('city-map-mount', emptyState('District boundaries not loaded yet (Stage 6).'));
    }

    setHtml('city-meetings', emptyState('No meeting summaries yet.'));
    setHtml('city-comment', emptyState('Public comment guide not written yet.'));
  }

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', function () {
    var slug = resolveSlug();
    var city = slug ? CITIES[slug] : null;
    if (city) {
      renderCity(slug, city);
    } else {
      renderUnknown(slug);
    }
  });
})();
