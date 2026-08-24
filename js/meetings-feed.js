// Meeting Tracker: renders the Supabase-backed meetings, then filters every
// item on the page -- the ones rendered here AND the hand-written static cards
// below them, which carry the same data-* attributes.
//
// The filter deliberately indexes the DOM rather than the query result. The
// tracker has always been a hybrid of static editorial cards and database
// rows, and a filter that only knew about the database half would silently
// hide half the archive whenever anyone touched a control.
//
// Like js/home.js, this must render against both the pre- and post-
// migration_14 schema: the rich select is tried first and falls back to the
// original columns if the new tables aren't there yet.
(function () {
  var fmt = window.MDCW && window.MDCW.fmt;
  if (!fmt) return;

  var esc = fmt.escapeHtml;
  var safeHref = fmt.safeHref;

  var TOPICS = ['Housing', 'Transit', 'Zoning', 'Public Safety', 'Taxes & Budget', 'Environment', 'Parks', 'Other'];
  var STATUSES = [
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'deferred', label: 'Pending / deferred' }
  ];

  var state = {
    q: '',
    topics: [],
    statuses: [],
    district: '',
    commissioner: '',
    from: '',
    to: ''
  };

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function recordLine(item) {
    var bits = [];

    if (item.item_code) {
      bits.push('<span class="item-code">' + esc(item.item_code) + '</span>');
    }
    if (item.legislation_number) {
      bits.push('<span class="rec-leg">' + esc(item.legislation_number) + '</span>');
    }
    if (item.legislation_type) {
      bits.push('<span>' + esc(item.legislation_type) + '</span>');
    }
    var money = item.amount_usd ? fmt.formatMoney(item.amount_usd) : '';
    if (money) {
      bits.push('<span class="rec-amount">' + esc(money) + '</span>');
    }
    if (item.sponsor) {
      bits.push('<span>Sponsored by ' + esc(item.sponsor) + '</span>');
    }

    var tally = voteTally(item);
    if (tally) bits.push('<span>' + esc(tally) + '</span>');

    if (!bits.length && !item.topic && !(item.districts && item.districts.length)) return '';

    var html = bits.join('<span class="sep">&middot;</span>');

    if (item.topic) {
      html += (html ? '<span class="sep">&middot;</span>' : '') +
        '<span class="rec-topic">' + esc(item.topic) + '</span>';
    }
    if (item.districts && item.districts.length) {
      html += '<span class="rec-district">D' + item.districts.map(function (d) {
        return esc(String(d));
      }).join(', D') + '</span>';
    } else if (item.topic || bits.length) {
      html += '<span class="rec-district">Countywide</span>';
    }

    return '<div class="item-record">' + html + '</div>';
  }

  // "Passed 12-1" / "Failed 4-9". Built from the aggregate columns, falling
  // back to counting the roll call when only that was entered.
  function voteTally(item) {
    var yes = item.vote_yes, no = item.vote_no;

    if (typeof yes !== 'number' && item.item_votes && item.item_votes.length) {
      yes = item.item_votes.filter(function (v) { return v.vote === 'yes'; }).length;
      no = item.item_votes.filter(function (v) { return v.vote === 'no'; }).length;
    }
    if (typeof yes !== 'number' || typeof no !== 'number') return '';

    var verb = item.tag_status === 'failed' ? 'Failed' :
               item.tag_status === 'deferred' ? 'Deferred' : 'Passed';
    return verb + ' ' + yes + '–' + no;
  }

  function sourcesBlock(item) {
    var out = [];

    // Official record first, always. If it's missing, say so rather than
    // letting a news link stand in for the county's own record.
    var officialLinks = [];
    [
      { url: item.official_url, label: item.official_label || 'County legislative record' },
      { url: item.agenda_document_url, label: 'Agenda document' },
      { url: item.vote_record_url, label: 'Vote record' }
    ].forEach(function (s) {
      if (!s.url) return;
      var href = safeHref(s.url);
      if (!href) return;
      officialLinks.push('<li><a href="' + esc(href) + '" target="_blank" rel="noopener">' +
        esc(s.label) + ' &#8599;</a></li>');
    });

    if (officialLinks.length) {
      out.push('<div class="source-group official"><span class="label">Official record</span>' +
        '<ul class="source-list">' + officialLinks.join('') + '</ul></div>');
    } else {
      out.push('<div class="source-group official"><span class="label">Official record</span>' +
        '<p class="source-missing" style="margin:0;">Primary county record not yet linked for this item.</p></div>');
    }

    var extra = (item.item_sources || []).slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    }).map(function (s) {
      var href = safeHref(s.url);
      if (!href) return '';
      return '<li><span class="outlet">' + esc(s.outlet) + '</span>' +
        '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(s.label) + ' &#8599;</a></li>';
    }).filter(Boolean);

    // Legacy single-source column, for items not yet migrated into item_sources.
    if (!extra.length && item.source_url) {
      var legacyHref = safeHref(item.source_url);
      if (legacyHref) {
        extra.push('<li><a href="' + esc(legacyHref) + '" target="_blank" rel="noopener">' +
          esc(item.source_label || 'Source') + ' &#8599;</a></li>');
      }
    }

    if (extra.length) {
      out.push('<div class="source-group"><span class="label">Additional reporting</span>' +
        '<ul class="source-list">' + extra.join('') + '</ul></div>');
    }

    return '<div class="sources">' + out.join('') + '</div>';
  }

  function rollCallBlock(item, idx) {
    var votes = item.item_votes || [];
    if (!votes.length) return '';

    var id = 'rollcall-' + idx;
    var rows = votes.slice().sort(function (a, b) {
      var da = a.commissioners ? a.commissioners.district : 99;
      var db = b.commissioners ? b.commissioners.district : 99;
      return da - db;
    }).map(function (v) {
      var c = v.commissioners || {};
      return '<div class="rollcall-row">' +
        '<span class="rc-name"><span class="rc-district">D' + esc(String(c.district || '?')) + '</span>' +
        esc(c.full_name || 'Unknown') + '</span>' +
        '<span class="rc-vote ' + esc(v.vote) + '">' + esc(v.vote) + '</span>' +
        '</div>';
    });

    return '<button type="button" class="rollcall-toggle" aria-expanded="false" aria-controls="' + id + '">' +
      'Show roll call (' + votes.length + ')</button>' +
      '<div class="rollcall" id="' + id + '" hidden>' + rows.join('') + '</div>';
  }

  function renderItem(item, meeting, idx) {
    var tagHtml = item.tag_type === 'outcome'
      ? '<span class="outcome ' + esc(item.tag_status || 'passed') + '">' + esc(item.tag_label) + '</span>'
      : '<span class="item-code">' + esc(item.tag_label) + '</span>';

    // Data attributes drive the filter. They are set here for database items
    // and by hand in meetings.html for the static ones -- same names, so the
    // filter can't tell the two apart.
    var attrs = [
      'class="item-block"',
      'data-item="1"',
      'data-date="' + esc(meeting.meeting_date || '') + '"',
      'data-status="' + esc(item.tag_status || '') + '"',
      'data-topic="' + esc(item.topic || '') + '"',
      'data-districts="' + esc((item.districts || []).join(',')) + '"',
      'data-commissioners="' + esc((item.item_votes || []).map(function (v) {
        return v.commissioners ? v.commissioners.slug : '';
      }).filter(Boolean).join(',')) + '"'
    ];

    return (
      '<div ' + attrs.join(' ') + '>' +
        recordLine(item) +
        '<div class="item-head">' + tagHtml + '</div>' +
        '<h4 style="margin-bottom:6px;">' + esc(item.heading) + '</h4>' +
        '<p style="color:var(--ink-600); margin-bottom:0;">' + esc(item.description) + '</p>' +
        '<div class="why-matters"><span class="label">Why it matters</span>' + esc(item.why_it_matters) + '</div>' +
        sourcesBlock(item) +
        rollCallBlock(item, idx) +
      '</div>'
    );
  }

  var itemCounter = 0;

  function renderMeeting(meeting) {
    var items = (meeting.meeting_items || []).slice().sort(function (a, b) {
      return a.sort_order - b.sort_order;
    });

    var card = document.createElement('div');
    card.className = 'meeting-card';
    card.setAttribute('data-meeting', '1');
    card.setAttribute('data-date', meeting.meeting_date || '');
    card.innerHTML =
      '<div class="meeting-card-date">' + esc(meeting.meeting_type) + ' &middot; ' +
        esc(fmt.formatDate(meeting.meeting_date)) + '</div>' +
      '<h3>' + esc(meeting.title) + '</h3>' +
      '<p class="meeting-card-summary">' + esc(meeting.summary) + '</p>' +
      items.map(function (it) { return renderItem(it, meeting, itemCounter++); }).join('');
    return card;
  }

  // ---------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------
  function itemMatches(el) {
    if (state.q) {
      if (el.textContent.toLowerCase().indexOf(state.q) === -1) return false;
    }

    if (state.statuses.length) {
      if (state.statuses.indexOf(el.getAttribute('data-status') || '') === -1) return false;
    }

    if (state.topics.length) {
      if (state.topics.indexOf(el.getAttribute('data-topic') || '') === -1) return false;
    }

    if (state.district) {
      var ds = (el.getAttribute('data-districts') || '').split(',').filter(Boolean);
      // An item with no districts is countywide, so it applies to every
      // district -- the dropdown label says so explicitly.
      if (ds.length && ds.indexOf(state.district) === -1) return false;
    }

    if (state.commissioner) {
      var cs = (el.getAttribute('data-commissioners') || '').split(',').filter(Boolean);
      if (cs.indexOf(state.commissioner) === -1) return false;
    }

    var date = el.getAttribute('data-date') || '';
    if (state.from && (!date || date < state.from)) return false;
    if (state.to && (!date || date > state.to)) return false;

    return true;
  }

  function anyFilterActive() {
    return !!(state.q || state.topics.length || state.statuses.length ||
      state.district || state.commissioner || state.from || state.to);
  }

  function applyFilters() {
    var root = document.getElementById('tracker-body');
    if (!root) return;

    var items = root.querySelectorAll('[data-item]');
    var shown = 0;

    Array.prototype.forEach.call(items, function (el) {
      var ok = itemMatches(el);
      el.hidden = !ok;
      if (ok) shown++;
    });

    // A meeting card whose every item is filtered out should disappear too,
    // rather than leaving a headline with nothing under it.
    var cards = root.querySelectorAll('[data-meeting]');
    Array.prototype.forEach.call(cards, function (card) {
      var own = card.querySelectorAll('[data-item]');
      if (!own.length) {
        card.hidden = anyFilterActive();
        return;
      }
      var visible = Array.prototype.filter.call(own, function (el) { return !el.hidden; });
      card.hidden = visible.length === 0;
    });

    var countEl = document.getElementById('filter-count');
    if (countEl) {
      countEl.innerHTML = anyFilterActive()
        ? 'Showing <strong>' + shown + '</strong> of ' + items.length + ' tracked items'
        : '<strong>' + items.length + '</strong> tracked items';
    }

    var emptyEl = document.getElementById('filter-empty');
    if (emptyEl) emptyEl.hidden = shown !== 0;

    var clearEl = document.getElementById('filter-clear');
    if (clearEl) clearEl.hidden = !anyFilterActive();
  }

  function buildChips(containerId, values, stateKey) {
    var wrap = document.getElementById(containerId);
    if (!wrap) return;

    wrap.innerHTML = values.map(function (v) {
      var value = typeof v === 'string' ? v : v.value;
      var label = typeof v === 'string' ? v : v.label;
      return '<button type="button" class="chip" aria-pressed="false" data-value="' +
        esc(value) + '">' + esc(label) + '</button>';
    }).join('');

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      var value = btn.getAttribute('data-value');
      var on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', on ? 'false' : 'true');

      var list = state[stateKey];
      var i = list.indexOf(value);
      if (on && i !== -1) list.splice(i, 1);
      else if (!on && i === -1) list.push(value);

      applyFilters();
    });
  }

  function populateDistricts() {
    var sel = document.getElementById('filter-district');
    if (!sel) return;
    var opts = ['<option value="">Any district</option>'];
    for (var d = 1; d <= 13; d++) {
      opts.push('<option value="' + d + '">District ' + d + ' (plus countywide)</option>');
    }
    sel.innerHTML = opts.join('');
    sel.addEventListener('change', function () {
      state.district = sel.value;
      applyFilters();
    });
  }

  function populateCommissioners() {
    var sel = document.getElementById('filter-commissioner');
    var wrap = document.getElementById('filter-commissioner-wrap');
    if (!sel) return;

    sel.addEventListener('change', function () {
      state.commissioner = sel.value;
      applyFilters();
    });

    if (typeof supabaseClient === 'undefined') return;

    supabaseClient
      .from('commissioners')
      .select('slug, full_name, district')
      .eq('is_current', true)
      .order('district', { ascending: true })
      .then(function (res) {
        // Pre-migration_14 there is no commissioners table. Hide the control
        // rather than offering a dropdown that can only ever be empty.
        if (res.error || !res.data || !res.data.length) {
          if (wrap) wrap.hidden = true;
          return;
        }
        sel.innerHTML = '<option value="">Any commissioner</option>' +
          res.data.map(function (c) {
            return '<option value="' + esc(c.slug) + '">D' + esc(String(c.district)) +
              ' · ' + esc(c.full_name) + '</option>';
          }).join('');
      })
      .catch(function () { if (wrap) wrap.hidden = true; });
  }

  function initControls() {
    buildChips('filter-topics', TOPICS, 'topics');
    buildChips('filter-statuses', STATUSES, 'statuses');
    populateDistricts();
    populateCommissioners();

    var search = document.getElementById('filter-q');
    if (search) {
      search.addEventListener('input', function () {
        state.q = search.value.trim().toLowerCase();
        applyFilters();
      });
    }

    var from = document.getElementById('filter-from');
    if (from) {
      from.addEventListener('change', function () { state.from = from.value; applyFilters(); });
    }
    var to = document.getElementById('filter-to');
    if (to) {
      to.addEventListener('change', function () { state.to = to.value; applyFilters(); });
    }

    function clearAll() {
      state.q = ''; state.topics = []; state.statuses = [];
      state.district = ''; state.commissioner = ''; state.from = ''; state.to = '';
      if (search) search.value = '';
      if (from) from.value = '';
      if (to) to.value = '';
      var dsel = document.getElementById('filter-district');
      if (dsel) dsel.value = '';
      var csel = document.getElementById('filter-commissioner');
      if (csel) csel.value = '';
      Array.prototype.forEach.call(document.querySelectorAll('.chip[aria-pressed="true"]'), function (b) {
        b.setAttribute('aria-pressed', 'false');
      });
      applyFilters();
    }

    // Both the bar's own button and the one in the empty state.
    Array.prototype.forEach.call(document.querySelectorAll('.filter-clear'), function (btn) {
      btn.addEventListener('click', clearAll);
    });
  }

  // Roll-call toggles are bound once on the container, so items rendered
  // later still work without rebinding.
  function initRollCallToggles() {
    var root = document.getElementById('tracker-body');
    if (!root) return;
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('.rollcall-toggle');
      if (!btn) return;
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.hidden = open;
      btn.textContent = (open ? 'Show' : 'Hide') + ' roll call (' +
        panel.querySelectorAll('.rollcall-row').length + ')';
    });
  }

  // ---------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------
  var RICH_SELECT = '*, meeting_items(*, item_sources(*), item_votes(vote, commissioners(slug, full_name, district)))';
  var BASIC_SELECT = '*, meeting_items(*)';

  function fetchMeetings() {
    return supabaseClient
      .from('meetings')
      .select(RICH_SELECT)
      .order('meeting_date', { ascending: false })
      .order('sort_order', { foreignTable: 'meeting_items', ascending: true })
      .then(function (res) {
        if (!res.error) return res;
        // migration_14 not applied yet -- fall back to what definitely exists.
        return supabaseClient
          .from('meetings')
          .select(BASIC_SELECT)
          .order('meeting_date', { ascending: false })
          .order('sort_order', { foreignTable: 'meeting_items', ascending: true });
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initControls();
    initRollCallToggles();

    var listEl = document.getElementById('meetings-dynamic');

    if (!listEl || typeof supabaseClient === 'undefined') {
      applyFilters();
      return;
    }

    fetchMeetings()
      .then(function (res) {
        if (res.error || !res.data) return;
        res.data.forEach(function (meeting) {
          listEl.appendChild(renderMeeting(meeting));
        });
      })
      .catch(function () { /* static cards below still render */ })
      .then(function () { applyFilters(); });
  });
})();
