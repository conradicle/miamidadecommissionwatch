// Shared renderer for city pages under /cities/. Two kinds of page use it:
//
//   * A dedicated static page (cities/miami-beach.html): carries its own SEO
//     head and hero, and names its city via <body data-city-slug="...">.
//   * The shared template (cities/city.html): serves every other approved
//     city -- vercel.json rewrites any unclaimed /cities/:slug to it. It
//     marks itself with <body data-city-template> and this file derives the
//     slug from the URL, fills the hero, and sets the title and canonical.
//
// City data comes from mdcwLoadCity() in js/cities-data.js: the Supabase
// `cities` table when reachable (so staff edits go live with no deploy),
// the static fallback registry otherwise.
(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Coverage areas a city team can eventually publish into. Mirrors the main
  // site's sections, but a city page only links out once real content exists;
  // until then each renders an honest empty state.
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

  // Team members are Miami-Dade students, i.e. minors, so the same rule as
  // editorial bylines applies: public pages show first name + last initial
  // only, via js/public-byline.js (which every city page must load before this
  // file). Database rows are curated to "First L." already (publicByline is
  // idempotent on that form); this is the belt to that suspender. If the
  // script is somehow missing, render no names at all -- a missing credit is
  // a cosmetic miss, a full surname is a leak.
  function teamNames(names) {
    if (typeof window.publicByline !== 'function') return '';
    return names.map(function (n) { return window.publicByline(n); })
      .filter(function (n) { return n.length > 0; })
      .join(', ');
  }

  function fill(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return el;
  }

  // Removes a whole <section> when there is nothing to put in it, so a city
  // without verified government details simply doesn't show the section
  // rather than showing placeholders that look like information.
  function dropSection(id) {
    var el = document.getElementById(id);
    if (el) {
      var section = el.closest('section');
      if (section) section.parentNode.removeChild(section);
    }
  }

  function slugFromPath() {
    var match = window.location.pathname.match(/^\/cities\/([a-z0-9-]{1,50})\/?$/);
    return match ? match[1] : null;
  }

  // ---------- template-mode helpers ----------

  function setCanonical(slug) {
    var url = 'https://www.miamidadecommissionwatch.com/cities/' + slug;
    var link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  function setNoindex() {
    var meta = document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex, follow');
    document.head.appendChild(meta);
  }

  function renderHero(city) {
    document.title = city.name + ' - Miami-Dade Commission Watch';
    fill('city-hero-eyebrow', '<a href="/cities/" style="color:inherit;">Cities</a> &middot; ' + escapeHtml(city.name));
    fill('city-hero-name', escapeHtml(city.name));
    fill('city-hero-lede',
      'Student-led coverage of ' + escapeHtml(city.name) + '’s local government — what it’s deciding, ' +
      'and why it matters to the people who live there. Part of Miami-Dade Commission Watch.');
    setCanonical(city.slug);
  }

  // The rewrite sends every unclaimed /cities/<slug> here, so a typo lands on
  // this page too: say so honestly, keep it out of search, and point at the
  // hub and the application form instead of rendering an empty city.
  function renderNotFound() {
    setNoindex();
    document.title = 'City not found - Miami-Dade Commission Watch';
    fill('city-hero-eyebrow', '<a href="/cities/" style="color:inherit;">Cities</a>');
    fill('city-hero-name', 'We don’t cover this city yet');
    fill('city-hero-lede', 'There’s no Commission Watch page at this address. It might be a typo — or an opportunity.');
    var notice = fill('city-status-notice',
      '<p><a href="/cities/">See every city we list</a>, or ' +
      '<a href="/start-a-city.html">apply to start coverage of your city</a>.</p>');
    if (notice) notice.hidden = false;
    ['city-sections', 'city-government', 'city-sources', 'city-team'].forEach(dropSection);
  }

  // ---------- main render ----------

  function renderCity(city, isTemplate) {
    if (isTemplate) renderHero(city);

    var noticeHtml;
    if (city.status === 'active') {
      noticeHtml = statusBadge(city.status) +
        '<p>' + escapeHtml(city.name) + ' has an active student Commission Watch team publishing coverage.</p>';
    } else if (city.status === 'forming') {
      noticeHtml = statusBadge(city.status) +
        '<p>A student team for ' + escapeHtml(city.name) + ' is getting organized. Coverage hasn’t launched yet.</p>' +
        '<p><a href="/start-a-city.html">Want to help get it started? Apply to join.</a></p>';
    } else {
      noticeHtml = statusBadge(city.status) +
        '<p><strong>' + escapeHtml(city.name) + ' does not have a student Commission Watch team yet.</strong> ' +
        'Everything below shows what this page will hold once local students take it on.</p>' +
        '<p><a href="/start-a-city.html">Interested in starting one? Apply here.</a></p>';
    }
    var notice = fill('city-status-notice', noticeHtml);
    if (notice) notice.hidden = false;

    var grid = document.getElementById('city-sections');
    if (grid) {
      SECTIONS.forEach(function (s) {
        var card = document.createElement('div');
        card.className = 'card city-section-card';
        card.id = s.id;
        var empty = city.status === 'active'
          ? '' // an active team replaces these cards with real links via the database
          : '<p class="city-section-empty">Coverage of ' + escapeHtml(city.name) +
            ' hasn’t started yet. This section opens when the student team launches.</p>';
        card.innerHTML = '<h3>' + escapeHtml(s.title) + '</h3><p>' + escapeHtml(s.desc) + '</p>' + empty;
        grid.appendChild(card);
      });
    }

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

    if (city.sources && city.sources.length > 0) {
      var items = city.sources.map(function (src) {
        return '<li><a href="' + escapeHtml(src.url) + '" target="_blank" rel="noopener">' +
          escapeHtml(src.label) + ' &#8599;</a></li>';
      }).join('');
      fill('city-sources', '<ul class="sources-list">' + items + '</ul>');
    } else {
      dropSection('city-sources');
    }

    var team = city.team;
    if (team) {
      var teamHtml = '';
      if (team.name) teamHtml += '<p><strong>' + escapeHtml(team.name) + '</strong></p>';
      if (team.coverage) teamHtml += '<p>' + escapeHtml(team.coverage) + '</p>';
      var facts = '';
      var editors = team.editors && team.editors.length ? teamNames(team.editors) : '';
      var contributors = team.contributors && team.contributors.length ? teamNames(team.contributors) : '';
      if (editors) facts += '<li><strong>Editors:</strong> ' + escapeHtml(editors) + '</li>';
      if (contributors) facts += '<li><strong>Contributors:</strong> ' + escapeHtml(contributors) + '</li>';
      if (team.advisor) facts += '<li><strong>Advisor:</strong> ' + escapeHtml(team.advisor) + '</li>';
      if (team.launched) facts += '<li><strong>Launched:</strong> ' + escapeHtml(team.launched) + '</li>';
      if (team.contact) facts += '<li><strong>Contact:</strong> <a href="mailto:' + escapeHtml(team.contact) + '">' + escapeHtml(team.contact) + '</a></li>';
      if (facts) teamHtml += '<ul class="sources-list">' + facts + '</ul>';
      fill('city-team', teamHtml);
    } else {
      fill('city-team',
        '<p>This city does not have a student Commission Watch team yet.</p>' +
        '<p><a class="btn btn-primary" href="/start-a-city.html">Apply to start the ' + escapeHtml(city.name) + ' team</a></p>');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var isTemplate = document.body.hasAttribute('data-city-template');
    var slug = document.body.getAttribute('data-city-slug') || (isTemplate ? slugFromPath() : null);

    if (!slug || typeof mdcwLoadCity !== 'function') {
      if (isTemplate) renderNotFound();
      return;
    }

    mdcwLoadCity(slug, function (city) {
      if (!city) {
        if (isTemplate) renderNotFound();
        return;
      }
      renderCity(city, isTemplate);
    });
  });
})();
