// Commissioner profile page: /commissioner.html?c=<slug>
//
// Two data sources, deliberately kept apart:
//   * js/commissioner-data.js -- hand-maintained facts (photo, contact,
//     committees, term). Edited by a person, never by the dashboard.
//   * Supabase -- identity, and the voting record (item_votes joined to
//     meeting_items). Written by editors through the dashboard.
//
// The voting record is the point of this page. Everything else is context.
(function () {
  var fmt = window.MDCW && window.MDCW.fmt;
  if (!fmt) return;
  var esc = fmt.escapeHtml;

  var VOTE_LIMIT = 20;

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  function fail(message) {
    var main = document.getElementById('profile-root');
    if (!main) return;
    main.innerHTML =
      '<div class="wrap" style="padding:48px 0;">' +
        '<h1>Commissioner not found</h1>' +
        '<p class="lede">' + esc(message) + '</p>' +
        '<p><a class="btn btn-primary" href="officials.html">Back to the officials directory</a></p>' +
      '</div>';
  }

  function factRow(term, value) {
    return '<dt>' + esc(term) + '</dt><dd>' +
      (value ? value : '<span style="color:var(--ink-400);">Not yet recorded</span>') + '</dd>';
  }

  function renderHeader(row, profile) {
    var el = document.getElementById('profile-head');
    if (!el) return;

    var name = row.full_name;
    var title = row.title || 'Commissioner';

    document.title = title + ' ' + name + ' · Miami-Dade Commission Watch';
    var h1 = document.getElementById('profile-name');
    if (h1) h1.textContent = title + ' ' + name;
    var eyebrow = document.getElementById('profile-eyebrow');
    if (eyebrow) {
      eyebrow.textContent = 'District ' + row.district +
        (row.is_current === false ? ' · Incoming' : '');
    }

    var photoHtml = profile.photo
      ? '<img class="profile-photo" src="' + esc(profile.photo) + '" alt="' + esc(name) + '">'
      : '<div class="profile-photo" role="img" aria-label="No photograph on file for ' + esc(name) + '"></div>';

    var committees = profile.committees && profile.committees.length
      ? profile.committees.map(function (c) { return esc(c); }).join('<br>')
      : '';

    var contact = [];
    if (profile.phone) contact.push(esc(profile.phone));
    if (profile.email) contact.push('<a href="mailto:' + esc(profile.email) + '">' + esc(profile.email) + '</a>');
    if (profile.office) contact.push(esc(profile.office));

    el.innerHTML =
      photoHtml +
      '<div>' +
        (profile.bio ? '<p class="lede" style="margin-top:0;">' + esc(profile.bio) + '</p>' : '') +
        '<dl class="profile-facts">' +
          factRow('District', 'District ' + esc(String(row.district))) +
          factRow('Term expires', profile.termExpires ? esc(profile.termExpires) :
            (row.term_end ? esc(fmt.formatDate(row.term_end)) : '')) +
          factRow('Next election', profile.nextElection ? esc(profile.nextElection) : '') +
          factRow('Committees', committees) +
          factRow('Contact', contact.length ? contact.join('<br>') : '') +
          factRow('Official profile', '<a href="' + esc(profile.officialUrl) +
            '" target="_blank" rel="noopener">miamidade.gov &#8599;</a>') +
        '</dl>' +
      '</div>';

    var badges = document.getElementById('profile-badges');
    if (badges && profile.verified) {
      badges.innerHTML = '<span class="verified-badge">Last verified <span class="vb-date">' +
        esc(profile.verified) + '</span></span>';
    }
  }

  function renderVotes(votes) {
    var summaryEl = document.getElementById('vote-summary');
    var listEl = document.getElementById('vote-history');
    if (!listEl) return;

    if (votes === null) {
      listEl.innerHTML = '<p class="data-pending">Roll-call vote records are being rolled out. ' +
        'Once editors start recording how each commissioner voted, the last ' + VOTE_LIMIT +
        ' tracked items will appear here.</p>';
      if (summaryEl) summaryEl.hidden = true;
      return;
    }

    if (!votes.length) {
      listEl.innerHTML = '<p class="data-pending">No roll-call votes have been recorded for this ' +
        'commissioner yet. The <a href="meetings.html">Meeting Tracker Archive</a> has every item we covered through October 2026.</p>';
      if (summaryEl) summaryEl.hidden = true;
      return;
    }

    var counts = { yes: 0, no: 0, abstain: 0, absent: 0, recused: 0 };
    votes.forEach(function (v) {
      if (counts[v.vote] !== undefined) counts[v.vote]++;
    });

    if (summaryEl) {
      summaryEl.hidden = false;
      summaryEl.innerHTML = [
        ['Yes', counts.yes], ['No', counts.no],
        ['Abstained', counts.abstain], ['Absent', counts.absent], ['Recused', counts.recused]
      ].filter(function (p) { return p[1] > 0; }).map(function (p) {
        return '<div class="vs-stat"><span class="vs-num">' + p[1] + '</span>' +
          '<span class="vs-label">' + esc(p[0]) + '</span></div>';
      }).join('');
    }

    listEl.innerHTML = '<ul class="vote-history">' + votes.map(function (v) {
      var it = v.meeting_items || {};
      var meta = [];
      if (it.item_code) meta.push(esc(it.item_code));
      if (it.legislation_number) meta.push(esc(it.legislation_number));
      if (it.topic) meta.push(esc(it.topic));
      if (it.meetings && it.meetings.meeting_date) {
        meta.push(esc(fmt.formatDateShort(it.meetings.meeting_date)));
      }

      return '<li>' +
        '<span class="vh-item">' +
          '<span class="vh-title">' + esc(it.heading || 'Untitled item') + '</span>' +
          (meta.length ? '<span class="vh-meta">' + meta.join(' &middot; ') + '</span>' : '') +
        '</span>' +
        '<span class="rc-vote ' + esc(v.vote) + '">' + esc(v.vote) + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function renderSponsored(items) {
    var el = document.getElementById('sponsored-list');
    if (!el) return;

    if (items === null) {
      el.innerHTML = '<p class="data-pending">Sponsorship is recorded per item from migration_14 onward.</p>';
      return;
    }
    if (!items.length) {
      el.innerHTML = '<p class="data-pending">No tracked item has been recorded as sponsored by this commissioner yet.</p>';
      return;
    }

    el.innerHTML = '<ul class="vote-history">' + items.map(function (it) {
      var meta = [];
      if (it.legislation_number) meta.push(esc(it.legislation_number));
      if (it.topic) meta.push(esc(it.topic));
      if (it.meetings && it.meetings.meeting_date) {
        meta.push(esc(fmt.formatDateShort(it.meetings.meeting_date)));
      }
      return '<li><span class="vh-item"><span class="vh-title">' + esc(it.heading) + '</span>' +
        (meta.length ? '<span class="vh-meta">' + meta.join(' &middot; ') + '</span>' : '') +
        '</span></li>';
    }).join('') + '</ul>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var slug = qs('c');
    if (!slug) {
      fail('No commissioner was specified in the link.');
      return;
    }

    var profile = (window.MDCW.profiles && window.MDCW.profiles[slug]) || null;

    if (typeof supabaseClient === 'undefined') {
      fail('Profile data is unavailable right now.');
      return;
    }

    supabaseClient
      .from('commissioners')
      .select('id, slug, full_name, district, title, term_end, is_current')
      .eq('slug', slug)
      .limit(1)
      .then(function (res) {
        if (res.error) {
          // Pre-migration_14 the table doesn't exist at all.
          fail('Commissioner profiles are not available on this deployment yet.');
          return null;
        }
        var row = res.data && res.data[0];
        if (!row) {
          fail('No commissioner matches "' + slug + '".');
          return null;
        }

        renderHeader(row, profile || { officialUrl: '#', committees: [] });
        return row;
      })
      .then(function (row) {
        if (!row) return;

        supabaseClient
          .from('item_votes')
          .select('vote, meeting_items(heading, item_code, legislation_number, topic, meetings(meeting_date))')
          .eq('commissioner_id', row.id)
          .limit(VOTE_LIMIT)
          .then(function (res) {
            renderVotes(res.error ? null : (res.data || []));
          })
          .catch(function () { renderVotes(null); });

        supabaseClient
          .from('meeting_items')
          .select('heading, legislation_number, topic, meetings(meeting_date)')
          .eq('sponsor', row.full_name)
          .limit(10)
          .then(function (res) {
            renderSponsored(res.error ? null : (res.data || []));
          })
          .catch(function () { renderSponsored(null); });
      });
  });
})();
