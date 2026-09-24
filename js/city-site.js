// Drives every city subdomain from one template (city/index.html).
//
// Each city commission is served from its own subdomain -- for example
// miamibeach.miamidadecommissionwatch.com -- but there is only one deployment
// and one copy of this file. The subdomain is the routing key: this script
// reads it off location.hostname, loads that city from the database, and
// renders the page.
//
// Everything on the page comes from Postgres (see
// supabase/migration_17_city_platform.sql). Row Level Security is what decides
// what a visitor may see -- the anon key ships in this page, so it is not a
// secret and is not doing any of the protecting. A city that is unpublished or
// suspended simply returns no row here.
//
// Plain global IIFE, matching the rest of js/ -- no build step, no modules.
(function () {
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
    if (!url) return null;
    try {
      var parsed = new URL(url, window.location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (e) {
      return null;
    }
  }

  function link(url, label) {
    var href = safeHref(url);
    if (!href) return '';
    return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
      escapeHtml(label) + ' &#8599;</a>';
  }

  function notice(text) {
    var box = el('city-notice');
    setText('city-notice-text', text);
    if (box) box.style.display = text ? '' : 'none';
  }

  function emptyState(message) {
    return '<p style="color:var(--ink-400); font-style:italic;">' + escapeHtml(message) + '</p>';
  }

  function formatDate(value) {
    if (!value) return null;
    try {
      // A date column arrives as YYYY-MM-DD; anchoring at midday avoids the
      // off-by-one that UTC parsing causes in a US timezone.
      var d = value.length === 10 ? new Date(value + 'T12:00:00') : new Date(value);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return String(value);
    }
  }

  function formatDateTime(value) {
    if (!value) return null;
    try {
      return new Date(value).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) {
      return String(value);
    }
  }

  // ---------- render: not found ----------
  function renderUnknown(slug) {
    document.title = 'City not found - Miami-Dade Commission Watch';
    setText('city-wordmark', 'City');
    setText('city-eyebrow', 'Not found');
    setText('city-heading', 'No coverage here yet');
    setText('city-lede', slug
      ? 'There is no city commission coverage at this address yet.'
      : 'This page is served from a city subdomain. Open it at a city address to see that city’s coverage.');
    notice('If you think this city should be covered, you can request it on the county site.');

    setHtml('city-what', '');
    setHtml('city-officials', '');
    setHtml('city-map-intro', emptyState('No city selected.'));
    setHtml('city-map-mount', '');
    setHtml('city-meetings', '');
    setHtml('city-comment', '');
  }

  function renderError() {
    setText('city-lede', 'Something went wrong loading this city’s coverage.');
    notice('If this keeps happening, please let us know on the county site.');
  }

  // ---------- render: the city ----------
  function renderHeader(city) {
    document.title = city.name + ' Commission Watch';

    // The template ships noindex so a subdomain that resolves before its city
    // exists cannot be indexed as an empty page. A city that actually loaded
    // is real, so the tag comes off here rather than being edited per city.
    var robots = document.querySelector('meta[name="robots"]');
    if (robots && robots.parentNode) robots.parentNode.removeChild(robots);
    setText('city-wordmark', city.name);
    setText('city-eyebrow', city.name);
    setText('city-heading', city.name + ' Commission Watch');
    setText('city-lede', 'Student-led coverage of the ' + (city.body_name || (city.name + ' city commission')) +
      ' — who serves on it, what it decides, and how to be heard at a meeting.');
    notice('');
  }

  function renderWhat(city) {
    var body = city.body_name || (city.name + ' city commission');
    var html = '<p style="max-width:66ch;">The ' + escapeHtml(body) +
      ' is the elected body that sets the city’s budget, passes local ordinances, and ' +
      'decides land use and zoning inside city limits. It is separate from the Miami-Dade ' +
      'Board of County Commissioners, which handles countywide services.</p>';

    if (city.governance === 'at-large') {
      html += '<p style="max-width:66ch;">Every member is elected citywide rather than by district.</p>';
    } else {
      html += '<p style="max-width:66ch;">Members are elected from single-member districts.</p>';
    }

    var when = formatDateTime(city.next_meeting_at);
    html += '<p style="color:var(--ink-600);"><strong>Next meeting:</strong> ' +
      (when ? escapeHtml(when) : 'not recorded yet');
    if (city.next_meeting_note) html += ' — ' + escapeHtml(city.next_meeting_note);
    html += '</p>';

    var site = link(city.website, 'Official city website');
    if (site) html += '<p>' + site + '</p>';

    setHtml('city-what', html);
  }

  // "Alex J. Fernandez" -> "AF": first and last word, the same rule as the
  // team monograms in scripts/lib/render.mjs.
  function initials(name) {
    var tokens = String(name || '').split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    var first = tokens[0].charAt(0);
    var last = tokens.length > 1 ? tokens[tokens.length - 1].charAt(0) : '';
    return (first + last).toUpperCase().replace(/[^A-ZÀ-ɏ]/g, '');
  }

  function initialsHtml(name) {
    return '<span class="official-initials" aria-hidden="true">' + escapeHtml(initials(name)) + '</span>';
  }

  // Every card gets the same square face block, photo or not, so names and
  // seats line up across the row. A photo that fails to load (moved, blocked,
  // deleted) turns into the initials instead of a broken-image icon.
  function officialFace(o) {
    var photo = safeHref(o.photo_url);
    var inner = photo
      ? '<img class="official-photo" src="' + escapeHtml(photo) + '" alt="' + escapeHtml(o.name) + '" loading="lazy">'
      : initialsHtml(o.name);
    return '<div class="official-face" data-name="' + escapeHtml(o.name) + '">' + inner + '</div>';
  }

  function bindPhotoFallbacks(host) {
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('img.official-photo'), function (img) {
      function fallBack() {
        var face = img.parentNode;
        if (face) face.innerHTML = initialsHtml(face.getAttribute('data-name'));
      }
      // Already failed before this ran (a cached 404, say).
      if (img.complete && img.naturalWidth === 0) { fallBack(); return; }
      img.addEventListener('error', fallBack, { once: true });
    });
  }

  function renderOfficials(city, officials) {
    if (!officials.length) {
      setHtml('city-officials', emptyState('No officials recorded yet for ' + city.name + '.'));
      return;
    }

    var html = officials.map(function (o) {
      var card = '<div class="card official-card">';
      card += officialFace(o);
      card += '<h3 style="margin-bottom:4px;">' + escapeHtml(o.name) + '</h3>';

      var seat = o.seat;
      if (o.seat_type === 'district' && o.district != null) {
        seat = seat + ' · District ' + escapeHtml(String(o.district));
      }
      card += '<p style="font-family:var(--font-mono); font-size:13px; color:var(--ink-600); margin-bottom:8px;">' +
        escapeHtml(seat) + '</p>';

      if (o.term_ends) {
        card += '<p style="font-size:14px; color:var(--ink-600); margin-bottom:6px;">Term ends ' +
          escapeHtml(o.term_ends) + '</p>';
      }

      var contacts = [];
      if (o.contact_email) {
        contacts.push('<a href="mailto:' + escapeHtml(o.contact_email) + '">' +
          escapeHtml(o.contact_email) + '</a>');
      }
      var profile = link(o.contact_url, 'Official profile');
      if (profile) contacts.push(profile);
      if (contacts.length) {
        card += '<p style="font-size:14px; margin-bottom:0;">' + contacts.join('<br>') + '</p>';
      }

      card += '</div>';
      return card;
    }).join('');

    setHtml('city-officials', html);
    bindPhotoFallbacks(el('city-officials'));
  }

  // The one place the two governance modes diverge, and the reason the field
  // exists: a district city can answer "you are in District 3", an at-large
  // city cannot and must say so instead of inventing districts.
  function renderMap(city) {
    if (city.governance === 'at-large') {
      setText('map-heading', 'Every seat is citywide');
      setHtml('city-map-intro',
        '<p style="max-width:66ch;">' + escapeHtml(city.name) + ' has no commission districts. ' +
        'Every member of the ' + escapeHtml(city.body_name || 'city commission') + ' is elected citywide, ' +
        'which means <strong>every resident is represented by all of them</strong> — there is no single ' +
        'commissioner assigned to your address, and you may contact any of them.</p>');
    } else {
      setText('map-heading', 'Find your district');
      setHtml('city-map-intro',
        '<p style="max-width:66ch;">' + escapeHtml(city.name) + ' elects commissioners from single-member ' +
        'districts. Enter your address to find which district you live in and who represents it.</p>');
    }
  }

  function renderMeetings(meetings) {
    if (!meetings.length) {
      setHtml('city-meetings', emptyState('No meeting summaries yet.'));
      return;
    }

    var html = meetings.map(function (m) {
      var row = '<div class="card" style="margin-bottom:16px;">';
      row += '<p style="font-family:var(--font-mono); font-size:13px; color:var(--ink-600); margin-bottom:6px;">' +
        escapeHtml(formatDate(m.meeting_date) || '') + '</p>';
      row += '<h3 style="margin-bottom:8px;">' + escapeHtml(m.title) + '</h3>';
      if (m.summary) {
        row += '<p style="margin-bottom:10px; white-space:pre-wrap;">' + escapeHtml(m.summary) + '</p>';
      }
      var links = [link(m.agenda_url, 'Agenda'), link(m.video_url, 'Video')].filter(Boolean);
      if (links.length) {
        row += '<p style="font-size:14px; margin-bottom:0;">' + links.join(' &nbsp;·&nbsp; ') + '</p>';
      }
      row += '</div>';
      return row;
    }).join('');

    setHtml('city-meetings', html);
  }

  function renderComment(city) {
    if (!city.comment_guide) {
      setHtml('city-comment', emptyState('Public comment guide not written yet.'));
      return;
    }
    setHtml('city-comment',
      '<div style="max-width:66ch; white-space:pre-wrap;">' + escapeHtml(city.comment_guide) + '</div>');
  }

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', function () {
    var slug = resolveSlug();
    if (!slug || typeof window.supabaseClient === 'undefined') {
      renderUnknown(slug);
      return;
    }

    window.supabaseClient
      .from('cities')
      .select('id, slug, name, body_name, governance, status, website, next_meeting_at, next_meeting_note, comment_guide, boundary_geojson')
      .eq('slug', slug)
      .maybeSingle()
      .then(function (res) {
        var city = res && res.data;
        if (res && res.error) { renderError(); return; }
        if (!city || city.status !== 'active') { renderUnknown(slug); return; }

        renderHeader(city);
        renderWhat(city);
        renderMap(city);
        renderComment(city);

        // Child content is fetched after the city resolves, because both
        // queries key off its id.
        return Promise.all([
          window.supabaseClient
            .from('city_officials')
            .select('id, name, seat, seat_type, district, photo_url, contact_email, contact_url, term_ends, sort_order')
            .eq('city_id', city.id)
            .eq('status', 'published')
            .order('sort_order', { ascending: true }),
          window.supabaseClient
            .from('city_meetings')
            .select('id, meeting_date, title, agenda_url, video_url, summary')
            .eq('city_id', city.id)
            .eq('status', 'published')
            .order('meeting_date', { ascending: false })
            .limit(20)
        ]).then(function (results) {
          var roster = (results[0] && results[0].data) || [];
          renderOfficials(city, roster);
          renderMeetings((results[1] && results[1].data) || []);

          // The map is drawn last because district mode names the
          // commissioner for whichever district an address falls in, which
          // needs the roster that just arrived.
          if (typeof window.initCityMap === 'function') {
            window.initCityMap(city, roster);
          }
        });
      })
      .catch(function () { renderError(); });
  });
})();
