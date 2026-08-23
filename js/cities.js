// Renders the /cities/ hub and every city page from the database.
//
// This replaces js/cities-data.js, js/cities-hub.js, and js/city-page.js. The
// registry used to be a hardcoded array here in the repo, so adding a city or
// fixing one fact about it meant a commit and a deploy, and a student team had
// no way to enter anything themselves. Cities now live in Postgres (see
// supabase/migration_13_cities.sql) and are maintained from the Cities tab of
// the staff dashboard.
//
// One file and one query per page. The hub and the city pages shared their
// escaping, status badges, and card markup across three files before; they
// share one copy of each here, and a city page fetches its city plus every
// child list in a single embedded request instead of reading four globals.
//
// Plain global IIFE, matching the rest of js/ (no build step, no modules).
(function () {
  // ---------- helpers ----------
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only http/https, so a source URL typed by a student team can't carry a
  // javascript: URI that runs when a visitor clicks it. Same guard as
  // js/meetings-feed.js uses for staff-entered county sources.
  function safeHref(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (e) {
      return null;
    }
  }

  function formatMeetingDate(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  }

  // "Miami Beach" -> "Miami Beach’s", but "Coral Gables" -> "Coral Gables’".
  // Two of the six seeded cities end in s, so this isn't an edge case.
  function possessive(name) {
    var clean = String(name == null ? '' : name);
    return /s$/i.test(clean) ? clean + '\u2019' : clean + '\u2019s';
  }

  function bySortOrder(a, b) {
    return (a.sort_order || 0) - (b.sort_order || 0);
  }

  // Label + CSS modifier per team status. Rendering goes through this rather
  // than hardcoding strings, so a new status only has to be added here.
  var STATUS = {
    'active': { label: 'Active coverage', className: 'city-status-active' },
    'forming': { label: 'Team forming', className: 'city-status-forming' },
    'team-needed': { label: 'Student team needed', className: 'city-status-needed' }
  };

  function statusBadge(status) {
    var meta = STATUS[status] || STATUS['team-needed'];
    return '<span class="city-status ' + meta.className + '">' + escapeHtml(meta.label) + '</span>';
  }

  // Every query names its columns. anon holds column-level grants rather than
  // whole-table ones (migration_13, following the lesson of migration_12), so
  // select('*') would expand to columns anon may not read and fail outright.
  var CITY_COLUMNS = 'id,slug,name,blurb,status,official_website,sort_order';

  function fill(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return el;
  }

  // Removes a whole <section> when there's nothing verified to put in it, so a
  // city without confirmed government details shows no section at all rather
  // than placeholder text that reads like information.
  function dropSection(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var section = el.closest('section');
    if (section && section.parentNode) section.parentNode.removeChild(section);
  }

  // ---------- hub (/cities/) ----------
  function renderHubCard(city) {
    var inner =
      '<h3>' + escapeHtml(city.name) + '</h3>' +
      statusBadge(city.status) +
      '<p>' + escapeHtml(city.blurb) + '</p>';

    // Every published city has a page now: /cities/<slug> is served by the
    // shared template when the city has no bespoke stub of its own.
    var card = document.createElement('a');
    card.href = '/cities/' + encodeURIComponent(city.slug);
    card.className = 'card city-card';
    inner += '<p class="city-card-cta">Visit the ' + escapeHtml(city.name) + ' page &#8594;</p>';
    card.innerHTML = inner;
    return card;
  }

  function renderHub(grid) {
    supabaseClient
      .from('cities')
      .select(CITY_COLUMNS)
      .order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error || !res.data || res.data.length === 0) {
          grid.innerHTML = '<div class="notice">The city list couldn’t be loaded right now. ' +
            '<a href="/contact.html">Let us know</a> if this keeps happening.</div>';
          return;
        }

        res.data.forEach(function (city) {
          grid.appendChild(renderHubCard(city));
        });

        // The intro line above the grid depends on whether anything is live
        // yet, so it's written from the data instead of hardcoded in the HTML
        // where it would quietly go stale the day a team launches.
        var intro = document.getElementById('cities-intro');
        if (intro) {
          var live = res.data.filter(function (c) { return c.status === 'active'; }).length;
          intro.textContent = live === 0
            ? 'County government stays on the main site; the cards here are for municipal governments. Every city is still waiting on a student team — that could be you.'
            : (live === 1 ? 'One city has an active student team.' : live + ' cities have active student teams.') +
              ' The rest are still waiting on students to take them on.';
        }
      });
  }

  // ---------- city page (/cities/<slug>) ----------
  function renderStatusNotice(city) {
    if (city.status === 'active') {
      return statusBadge(city.status) +
        '<p style="margin-bottom:0;">' + escapeHtml(city.name) +
        ' has an active student Commission Watch team publishing coverage.</p>';
    }
    if (city.status === 'forming') {
      return statusBadge(city.status) +
        '<p>A student team for ' + escapeHtml(city.name) + ' is getting organized. Coverage hasn’t launched yet.</p>' +
        '<p style="margin-bottom:0;"><a href="/contact.html">Want to help get it started? Get in touch.</a></p>';
    }
    return statusBadge(city.status) +
      '<p><strong>' + escapeHtml(city.name) + ' does not have a student Commission Watch team yet.</strong> ' +
      'Everything below shows what this page will hold once local students take it on.</p>' +
      '<p style="margin-bottom:0;"><a href="/contact.html">Interested in starting one? Get in touch.</a></p>';
  }

  function renderMeetingItem(item) {
    var tagHtml = item.tag_type === 'outcome'
      ? '<span class="outcome ' + escapeHtml(item.tag_status || 'passed') + '">' + escapeHtml(item.tag_label) + '</span>'
      : '<span class="item-code">' + escapeHtml(item.tag_label) + '</span>';

    var href = item.source_url ? safeHref(item.source_url) : null;
    var sourceHtml = href
      ? ' Source: <a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
        escapeHtml(item.source_label || 'link') + '</a>.'
      : '';

    return '<div class="item-block">' +
      '<div class="item-head">' + tagHtml + '</div>' +
      '<h4 style="margin-bottom:6px;">' + escapeHtml(item.heading) + '</h4>' +
      '<p style="color:var(--ink-600); margin-bottom:0;">' + escapeHtml(item.description) + sourceHtml + '</p>' +
      '<div class="why-matters"><span class="label">Why it matters</span>' + escapeHtml(item.why_it_matters) + '</div>' +
      '</div>';
  }

  function renderMeetings(city) {
    var listEl = document.getElementById('city-meetings');
    if (!listEl) return;

    var meetings = (city.city_meetings || []).slice().sort(function (a, b) {
      return String(b.meeting_date).localeCompare(String(a.meeting_date));
    });

    if (meetings.length === 0) {
      listEl.innerHTML = '<p class="city-section-empty">No meeting summaries yet. ' +
        'When ' + escapeHtml(possessive(city.name)) + ' student team starts publishing, their recaps appear here.</p>';
      return;
    }

    listEl.innerHTML = '';
    meetings.forEach(function (meeting) {
      var items = (meeting.city_meeting_items || []).slice().sort(bySortOrder);
      var card = document.createElement('div');
      card.className = 'meeting-card';
      card.innerHTML =
        '<div class="meeting-card-date">' + escapeHtml(meeting.meeting_type) + ' &middot; ' +
        escapeHtml(formatMeetingDate(meeting.meeting_date)) + '</div>' +
        '<h3>' + escapeHtml(meeting.title) + '</h3>' +
        '<p class="meeting-card-summary">' + escapeHtml(meeting.summary) + '</p>' +
        items.map(renderMeetingItem).join('');
      listEl.appendChild(card);
    });
  }

  function renderOfficials(city) {
    var gridEl = document.getElementById('city-officials');
    if (!gridEl) return;

    var officials = (city.city_officials || []).slice().sort(bySortOrder);
    if (officials.length === 0) {
      gridEl.innerHTML = '<p class="city-section-empty">This directory is empty until ' +
        escapeHtml(possessive(city.name)) + ' student team verifies who holds each seat.</p>';
      return;
    }

    gridEl.innerHTML = '';
    officials.forEach(function (o) {
      // Municipal officeholders are public figures, so unlike student
      // editorial bylines these are full names and office contact details.
      var seatLine = o.seat_type === 'district' && o.district
        ? o.seat + ' · District ' + o.district
        : (o.seat_type === 'at-large' ? o.seat + ' · At large' : o.seat);

      var links = '';
      var url = o.contact_url ? safeHref(o.contact_url) : null;
      if (url) {
        links += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Official profile &#8599;</a>';
      }
      if (o.contact_email) {
        links += (links ? ' <span style="color:var(--ink-400);">&middot;</span> ' : '') +
          '<a href="mailto:' + escapeHtml(o.contact_email) + '">' + escapeHtml(o.contact_email) + '</a>';
      }

      var card = document.createElement('div');
      card.className = 'roster-card';
      card.innerHTML =
        '<div class="district">' + escapeHtml(seatLine) + '</div>' +
        '<div class="name">' + escapeHtml(o.name) + '</div>' +
        (o.term_ends ? '<div class="role">Term ends ' + escapeHtml(o.term_ends) + '</div>' : '') +
        links;
      gridEl.appendChild(card);
    });
  }

  function renderGovernment(city) {
    // city_government holds at most one published row per city (enforced by a
    // partial unique index), so the embed comes back as a one-item array.
    var gov = (city.city_government || [])[0];
    if (!gov) {
      dropSection('city-government');
      return;
    }

    var rows = '';
    if (gov.body) rows += '<li><strong>Governing body:</strong> ' + escapeHtml(gov.body) + '</li>';
    if (gov.form) rows += '<li><strong>Form of government:</strong> ' + escapeHtml(gov.form) + '</li>';
    if (gov.note) rows += '<li>' + escapeHtml(gov.note) + '</li>';

    var site = city.official_website ? safeHref(city.official_website) : null;
    var siteLink = site
      ? '<p>For authoritative details, see <a href="' + escapeHtml(site) +
        '" target="_blank" rel="noopener">the city’s official website &#8599;</a>.</p>'
      : '';

    fill('city-government', '<ul class="sources-list">' + rows + '</ul>' + siteLink);
  }

  function renderSources(city) {
    var sources = (city.city_sources || []).slice().sort(bySortOrder);
    if (sources.length === 0) {
      dropSection('city-sources');
      return;
    }

    var items = sources.map(function (src) {
      var href = safeHref(src.url);
      if (!href) return '';
      return '<li><a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
        escapeHtml(src.label) + ' &#8599;</a></li>';
    }).join('');

    fill('city-sources', '<ul class="sources-list">' + items + '</ul>');
  }

  function renderTeam(city) {
    // Deliberately no names. Team members are Miami-Dade students, i.e.
    // minors, and city_team_members maps their accounts to cities -- anon has
    // no grant on that table at all, so this section describes the team's
    // status rather than listing who is on it.
    if (city.status === 'active') {
      fill('city-team',
        '<p>This page is written and maintained by a student Commission Watch team in ' +
        escapeHtml(city.name) + '. Spotted an error? <a href="/contact.html">Tell us</a> and we’ll correct it.</p>');
      return;
    }
    if (city.status === 'forming') {
      fill('city-team',
        '<p>A student team for ' + escapeHtml(city.name) + ' is getting organized right now.</p>' +
        '<p><a class="btn btn-primary" href="/contact.html">Join the ' + escapeHtml(city.name) + ' team</a></p>');
      return;
    }
    fill('city-team',
      '<p>This city does not have a student Commission Watch team yet.</p>' +
      '<p><a class="btn btn-primary" href="/contact.html">Start the ' + escapeHtml(city.name) + ' team</a></p>');
  }

  // The shared template (cities/city.html) has no city-specific text of its
  // own, so it fills in its title, description, canonical, and hero here.
  // Bespoke stubs like cities/miami-beach.html already carry all of that in
  // the served HTML and opt out with data-city-shell="static".
  function applyShellMetadata(city) {
    if (document.body.getAttribute('data-city-shell') === 'static') return;

    var title = city.name + ' - Miami-Dade Commission Watch';
    document.title = title;

    var canonicalUrl = 'https://www.miamidadecommissionwatch.com/cities/' + city.slug;
    var description = 'Student-led coverage of the ' + city.name +
      ' city government, part of Miami-Dade Commission Watch.';

    [
      ['meta[name="description"]', 'content', description],
      ['link[rel="canonical"]', 'href', canonicalUrl],
      ['meta[property="og:title"]', 'content', title],
      ['meta[property="og:description"]', 'content', description],
      ['meta[property="og:url"]', 'content', canonicalUrl],
      ['meta[name="twitter:title"]', 'content', title],
      ['meta[name="twitter:description"]', 'content', description]
    ].forEach(function (pair) {
      var el = document.head.querySelector(pair[0]);
      if (el) el.setAttribute(pair[1], pair[2]);
    });

    var eyebrow = document.getElementById('city-eyebrow-name');
    if (eyebrow) eyebrow.textContent = city.name;
    var heading = document.getElementById('city-heading');
    if (heading) heading.textContent = city.name;
    var lede = document.getElementById('city-lede');
    if (lede) {
      lede.textContent = 'Student-led coverage of ' + possessive(city.name) + ' city government — what the ' +
        'governing body is deciding, and why it matters to the people who live there. ' +
        'Part of Miami-Dade Commission Watch.';
    }
  }

  function renderNotFound(city) {
    var main = document.getElementById('main');
    if (!main) return;
    document.title = 'City not found - Miami-Dade Commission Watch';
    main.innerHTML =
      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><span class="eyebrow">Cities</span><h2>We don’t cover that city yet</h2></div>' +
      '<p style="max-width:60ch; color:var(--ink-600);">There’s no Commission Watch page for “' +
      escapeHtml(city) + '”. See the <a href="/cities/">cities we do cover</a>, or ' +
      '<a href="/contact.html">get in touch</a> about starting a team for yours.</p>' +
      '</div></section>';
  }

  function renderCity(slug) {
    supabaseClient
      .from('cities')
      .select(
        CITY_COLUMNS +
        ',city_government(body,form,note)' +
        ',city_sources(label,url,sort_order)' +
        ',city_officials(name,seat,seat_type,district,term_ends,contact_email,contact_url,sort_order)' +
        ',city_meetings(id,meeting_date,meeting_type,title,summary,city_meeting_items(*))'
      )
      // RLS already hides everything unpublished from the public, but a signed-in
      // editor or staff member reading their own drafts would otherwise see them
      // on the live page. Filtering the embeds keeps this page showing exactly
      // what a visitor sees, whoever is looking at it.
      .eq('city_government.review_status', 'published')
      .eq('city_sources.review_status', 'published')
      .eq('city_officials.review_status', 'published')
      .eq('city_meetings.review_status', 'published')
      .eq('slug', slug)
      .maybeSingle()
      .then(function (res) {
        // Only say we don't cover a city when the query actually came back
        // empty. On an error -- an outage, a network blip, a bad grant -- the
        // page keeps its static hero and says nothing loaded, because telling
        // a Miami Beach reader that Miami Beach isn't covered is worse than
        // showing them a page that's briefly short of content.
        if (res.error) {
          fill('city-status-notice',
            '<p style="margin:0;">This city’s coverage couldn’t be loaded right now. ' +
            '<a href="/cities/">See all cities</a>, or <a href="/contact.html">let us know</a> ' +
            'if it keeps happening.</p>');
          return;
        }
        if (!res.data) {
          renderNotFound(slug);
          return;
        }

        var city = res.data;
        applyShellMetadata(city);
        fill('city-status-notice', renderStatusNotice(city));
        renderMeetings(city);
        renderOfficials(city);
        renderGovernment(city);
        renderSources(city);
        renderTeam(city);
      });
  }

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof supabaseClient === 'undefined') return;

    var grid = document.getElementById('cities-grid');
    if (grid) {
      renderHub(grid);
      return;
    }

    // A bespoke stub names its city outright; the shared template reads the
    // slug off the URL, since /cities/<slug> is rewritten to it unchanged.
    var slug = document.body.getAttribute('data-city-slug');
    if (!slug) {
      var parts = window.location.pathname.replace(/\/+$/, '').split('/');
      slug = decodeURIComponent(parts[parts.length - 1] || '');
    }
    if (slug && slug !== 'cities') renderCity(slug);
  });
})();
