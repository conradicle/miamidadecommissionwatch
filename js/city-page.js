// Shared renderer for city pages under /cities/. A city page is a thin static
// shell (its own <title>, meta description, canonical URL, and hero for search
// engines) that declares which city it is via <body data-city-slug="...">;
// everything below the hero renders here, from the registry in
// js/cities-data.js. That keeps the repeatable parts -- status banner,
// coverage sections, government summary, sources, team info -- in one
// implementation instead of copied into every city's HTML.
(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Coverage areas a city team can eventually publish into. Mirrors the main
  // site's sections, but a city page only links out once real content exists;
  // until then each renders an honest empty state. When a city team launches,
  // give the matching card a real destination via the registry rather than
  // hardcoding links here.
  var SECTIONS = [
    { id: 'meetings', title: 'Meetings', desc: 'Plain-language summaries of what the governing body discussed and decided.' },
    { id: 'officials', title: 'Officials', desc: 'Who serves in the city government and how to reach them.' },
    { id: 'elections', title: 'Elections', desc: 'When city elections happen and what is on the ballot.' },
    { id: 'editorials', title: 'Student Editorials', desc: 'Opinion pieces by local students about their city government.' }
  ];

  function statusBadge(status) {
    var meta = MDCW_CITY_STATUS[status] || MDCW_CITY_STATUS['team-needed'];
    return '<span class="city-status ' + meta.className + '">' + escapeHtml(meta.label) + '</span>';
  }

  function fill(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return el;
  }

  // Removes a whole <section> when the registry has nothing to put in it,
  // so a city without verified government details simply doesn't show the
  // section rather than showing placeholders that look like information.
  function dropSection(id) {
    var el = document.getElementById(id);
    if (el) {
      var section = el.closest('section');
      if (section) section.parentNode.removeChild(section);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var slug = document.body.getAttribute('data-city-slug');
    var city = typeof mdcwFindCity === 'function' ? mdcwFindCity(slug) : null;
    if (!city) return;

    // ---- status banner ----
    var noticeHtml;
    if (city.status === 'active') {
      noticeHtml = statusBadge(city.status) +
        '<p>' + escapeHtml(city.name) + ' has an active student Commission Watch team publishing coverage.</p>';
    } else if (city.status === 'forming') {
      noticeHtml = statusBadge(city.status) +
        '<p>A student team for ' + escapeHtml(city.name) + ' is getting organized. Coverage hasn’t launched yet.</p>' +
        '<p><a href="/contact.html">Want to help get it started? Get in touch.</a></p>';
    } else {
      noticeHtml = statusBadge(city.status) +
        '<p><strong>' + escapeHtml(city.name) + ' does not have a student Commission Watch team yet.</strong> ' +
        'Everything below shows what this page will hold once local students take it on.</p>' +
        '<p><a href="/contact.html">Interested in starting one? Get in touch.</a></p>';
    }
    fill('city-status-notice', noticeHtml);

    // ---- coverage sections ----
    var grid = document.getElementById('city-sections');
    if (grid) {
      SECTIONS.forEach(function (s) {
        var card = document.createElement('div');
        card.className = 'card city-section-card';
        card.id = s.id;
        var empty = city.status === 'active'
          ? '' // an active team replaces these cards with real links via the registry
          : '<p class="city-section-empty">Coverage of ' + escapeHtml(city.name) +
            ' hasn’t started yet. This section opens when the student team launches.</p>';
        card.innerHTML = '<h3>' + escapeHtml(s.title) + '</h3><p>' + escapeHtml(s.desc) + '</p>' + empty;
        grid.appendChild(card);
      });
    }

    // ---- government at a glance ----
    if (city.government) {
      var g = city.government;
      var rows = '';
      if (g.body) rows += '<li><strong>Governing body:</strong> ' + escapeHtml(g.body) + '</li>';
      if (g.form) rows += '<li><strong>Form of government:</strong> ' + escapeHtml(g.form) + '</li>';
      if (g.note) rows += '<li>' + escapeHtml(g.note) + '</li>';
      var siteLink = city.officialWebsite
        ? '<p>For authoritative details, see <a href="' + escapeHtml(city.officialWebsite) +
          '" target="_blank" rel="noopener">the city’s official website &#8599;</a>.</p>'
        : '';
      fill('city-government', '<ul class="sources-list">' + rows + '</ul>' + siteLink);
    } else {
      dropSection('city-government');
    }

    // ---- official sources ----
    if (city.sources && city.sources.length > 0) {
      var items = city.sources.map(function (src) {
        return '<li><a href="' + escapeHtml(src.url) + '" target="_blank" rel="noopener">' +
          escapeHtml(src.label) + ' &#8599;</a></li>';
      }).join('');
      fill('city-sources', '<ul class="sources-list">' + items + '</ul>');
    } else {
      dropSection('city-sources');
    }

    // ---- student team ----
    var team = city.team;
    if (team) {
      var teamHtml = '';
      if (team.name) teamHtml += '<p><strong>' + escapeHtml(team.name) + '</strong></p>';
      if (team.coverage) teamHtml += '<p>' + escapeHtml(team.coverage) + '</p>';
      var facts = '';
      if (team.editors && team.editors.length) facts += '<li><strong>Editors:</strong> ' + escapeHtml(team.editors.join(', ')) + '</li>';
      if (team.contributors && team.contributors.length) facts += '<li><strong>Contributors:</strong> ' + escapeHtml(team.contributors.join(', ')) + '</li>';
      if (team.advisor) facts += '<li><strong>Advisor:</strong> ' + escapeHtml(team.advisor) + '</li>';
      if (team.launched) facts += '<li><strong>Launched:</strong> ' + escapeHtml(team.launched) + '</li>';
      if (team.contact) facts += '<li><strong>Contact:</strong> <a href="mailto:' + escapeHtml(team.contact) + '">' + escapeHtml(team.contact) + '</a></li>';
      if (facts) teamHtml += '<ul class="sources-list">' + facts + '</ul>';
      fill('city-team', teamHtml);
    } else {
      fill('city-team',
        '<p>This city does not have a student Commission Watch team yet.</p>' +
        '<p><a class="btn btn-primary" href="/contact.html">Start the ' + escapeHtml(city.name) + ' team</a></p>');
    }
  });
})();
