// Homepage: the next-meeting line in the hero, and the address-first
// district panel. The "latest documents" block is prerendered by the build.
//
// IMPORTANT: migration_14 is applied by hand in the Supabase SQL editor, so
// this file must render something sensible against BOTH the old schema and the
// new one. Every query that touches a migration_14 column or table is wrapped
// so a "column does not exist" error hides that one block instead of blanking
// the homepage. Check window.MDCW.home.schema in the console to see which
// path a given deploy took.
(function () {
  var fmt = window.MDCW && window.MDCW.fmt;
  if (!fmt) return;

  var esc = fmt.escapeHtml;
  var schema = { structuredItems: null, commissioners: null };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function haveSupabase() {
    return typeof supabaseClient !== 'undefined' && supabaseClient;
  }

  // ---------------------------------------------------------------------
  // Next meeting
  // ---------------------------------------------------------------------
  // The "What the Board just did" briefing that used to sit here counted the
  // Meeting Tracker's item rows. The tracker is an archive now, so the
  // homepage shows the latest Meeting and Agenda Summaries instead, written
  // into the page at build time (scripts/build.mjs, region home-documents).
  //
  // The next meeting comes from meeting_schedule (migration_27), which staff
  // keep from the county calendar in the Schedule tab. It used to come from
  // the tracker's meetings table, which never learns about a future meeting
  // now that the tracker is frozen.
  function nextScheduled() {
    if (!haveSupabase()) return Promise.resolve(undefined);
    return supabaseClient
      .from('meeting_schedule')
      .select('meeting_date, start_time, meeting_type')
      .gte('meeting_date', fmt.todayISO())
      .eq('cancelled', false)
      .order('meeting_date', { ascending: true })
      .limit(1)
      .then(function (res) { return res.error ? undefined : ((res.data && res.data[0]) || null); })
      .catch(function () { return undefined; });
  }

  // "09:30:00" -> "9:30 AM". Same as formatTime in scripts/lib/documents.mjs.
  function formatTime(value) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
    if (!m) return '';
    var h = Number(m[1]);
    return (((h + 11) % 12) + 1) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function meetingWhen(row) {
    var time = formatTime(row.start_time);
    return esc(fmt.formatDate(row.meeting_date, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    })) + (time ? ' &middot; ' + esc(time) : '');
  }

  // The build already wrote this line from the same table. Redrawing it
  // here only matters once a meeting date has passed and no rebuild has run
  // since, so a failed query (undefined) leaves the prerendered line alone.
  function renderNextMeeting(next) {
    var el = document.getElementById('next-meeting-live');
    if (!el || next === undefined) return;
    if (!next) {
      el.innerHTML = '<div class="label">Next BCC meeting</div><div class="date">Date not posted yet</div>';
      return;
    }
    var type = next.meeting_type && next.meeting_type !== 'Regular Meeting' ? ' (' + esc(next.meeting_type) + ')' : '';
    el.innerHTML = '<div class="label">Next BCC meeting' + type + '</div>' +
      '<div class="date">' + meetingWhen(next) + '</div>';
  }

  function loadNextMeeting() {
    nextScheduled().then(renderNextMeeting);
  }

  // ---------------------------------------------------------------------
  // District panel
  // ---------------------------------------------------------------------
  function commissionerForDistrict(district) {
    if (!haveSupabase()) return Promise.resolve(null);

    return supabaseClient
      .from('commissioners')
      .select('slug, full_name, district, title, term_end')
      .eq('district', district)
      .eq('is_current', true)
      .limit(1)
      .then(function (res) {
        if (res.error) { schema.commissioners = false; return null; }
        schema.commissioners = true;
        return res.data && res.data[0];
      })
      .catch(function () { schema.commissioners = false; return null; });
  }

  function recentItemsForDistrict(district) {
    if (!haveSupabase()) return Promise.resolve(null);

    return supabaseClient
      .from('meeting_items')
      .select('heading, tag_status, tag_label, topic, meetings(meeting_date)')
      .contains('districts', [district])
      .limit(5)
      .then(function (res) {
        // Pre-migration the districts column doesn't exist and this errors.
        // null means "can't answer yet", which the renderer distinguishes
        // from [] meaning "nothing has affected this district".
        if (res.error) { schema.structuredItems = false; return null; }
        schema.structuredItems = true;
        return res.data || [];
      })
      .catch(function () { schema.structuredItems = false; return null; });
  }

  function nextMeetingRow() {
    return nextScheduled().then(function (row) { return row || null; });
  }

  function renderVotesBlock(items) {
    if (items === null) {
      return '<p class="data-pending">Per-district vote tracking is being rolled out. ' +
        'In the meantime the <a href="/documents/meeting-summaries">Meeting Summaries</a> cover every meeting.</p>';
    }
    if (!items.length) {
      return '<p>No tracked item so far has been tagged as specifically affecting this district. ' +
        'Countywide decisions still apply. See the <a href="/documents/meeting-summaries">Meeting Summaries</a>.</p>';
    }

    var rows = items.map(function (it) {
      var when = it.meetings && it.meetings.meeting_date
        ? fmt.formatDateShort(it.meetings.meeting_date) : '';
      var meta = [];
      if (it.tag_label) meta.push(esc(it.tag_label));
      if (it.topic) meta.push(esc(it.topic));
      if (when) meta.push(esc(when));

      return '<li>' + esc(it.heading) +
        (meta.length ? '<span class="dp-vote-meta">' + meta.join(' &middot; ') + '</span>' : '') +
        '</li>';
    });

    return '<ul class="dp-votes">' + rows.join('') + '</ul>';
  }

  function renderPanel(result, commissioner, items, next) {
    var panel = document.getElementById('home-district-panel');
    if (!panel) return;

    var district = result.district;
    // Prefer the commissioners table (an editor can correct it same-day) over
    // the name baked into the boundary GeoJSON, which only changes when the
    // file is regenerated.
    var name = (commissioner && commissioner.full_name) || result.name || 'your commissioner';
    var title = (commissioner && commissioner.title) || 'Commissioner';

    var html =
      '<div class="district-panel-head">' +
        '<span class="dp-district">District ' + esc(String(district)) + '</span>' +
        '<span class="dp-name">' + esc(title + ' ' + name) + '</span>' +
      '</div>' +
      '<div class="district-panel-grid">' +
        '<div class="dp-block">' +
          '<span class="label">Your commissioner</span>' +
          '<p>' + esc(name) + ' represents District ' + esc(String(district)) + '. ' +
          '<a href="' + esc(window.MDCW.districts.officialProfileUrl(district)) +
          '" target="_blank" rel="noopener">Official profile &#8599;</a>' +
          (commissioner && commissioner.slug
            ? ' &middot; <a href="commissioner.html?c=' + encodeURIComponent(commissioner.slug) + '">Voting record</a>'
            : '') +
          '</p>' +
        '</div>' +
        '<div class="dp-block">' +
          '<span class="label">Next relevant meeting</span>' +
          '<p>' + (next
            ? esc(next.meeting_type) + ' on ' + meetingWhen(next) +
              '. <a href="/documents/agenda-summaries">Agenda Summaries</a>'
            : 'See the <a href="/documents/agenda-summaries">Agenda Summaries</a> for what is coming up.') +
          '</p>' +
        '</div>' +
        '<div class="dp-block" style="grid-column:1/-1;">' +
          '<span class="label">Recent votes affecting District ' + esc(String(district)) + '</span>' +
          renderVotesBlock(items) +
        '</div>' +
      '</div>' +
      '<div class="dp-actions">' +
        '<a class="btn btn-primary" href="get-involved.html?district=' + encodeURIComponent(district) +
          '#alerts">Get District ' + esc(String(district)) + ' alerts</a>' +
        '<a class="btn btn-secondary" href="get-involved.html#find-district">See the district map</a>' +
      '</div>';

    panel.innerHTML = html;
    panel.hidden = false;
  }

  function initFinder() {
    var form = document.getElementById('home-district-form');
    var input = document.getElementById('home-district-input');
    var statusEl = document.getElementById('home-district-status');
    var panel = document.getElementById('home-district-panel');
    if (!form || !input || !statusEl) return;

    if (!window.MDCW || !window.MDCW.districts) {
      statusEl.textContent = 'Address lookup is unavailable right now.';
      statusEl.className = 'district-status error';
      return;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var address = input.value.trim();
      if (!address) return;

      if (panel) panel.hidden = true;
      statusEl.textContent = 'Looking up that address...';
      statusEl.className = 'district-status';

      window.MDCW.districts.lookup(address).then(function (result) {
        if (result.error === 'no-address') {
          statusEl.textContent = "Couldn't find that address. Try including the city and zip code, e.g. \"111 NW 1st St, Miami, FL 33128\".";
          statusEl.className = 'district-status error';
          return;
        }
        if (result.error === 'outside-county') {
          statusEl.textContent = "That address doesn't appear to fall within a Miami-Dade commission district. It may be outside county boundaries.";
          statusEl.className = 'district-status error';
          return;
        }
        if (result.error) {
          statusEl.textContent = 'Something went wrong looking up that address. Please try again.';
          statusEl.className = 'district-status error';
          return;
        }

        statusEl.textContent = '';
        statusEl.className = 'district-status';

        Promise.all([
          commissionerForDistrict(result.district),
          recentItemsForDistrict(result.district),
          nextMeetingRow()
        ]).then(function (parts) {
          renderPanel(result, parts[0], parts[1], parts[2]);
        });
      });
    });
  }

  window.MDCW = window.MDCW || {};
  window.MDCW.home = { schema: schema };

  ready(function () {
    loadNextMeeting();
    initFinder();
  });
})();
