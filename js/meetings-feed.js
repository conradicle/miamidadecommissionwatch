(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only allow http/https links so a staff-entered source_url can't carry a
  // javascript: URI (or similar) that executes when a visitor clicks it.
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

  function renderItem(item) {
    var tagHtml = item.tag_type === 'outcome'
      ? '<span class="outcome ' + escapeHtml(item.tag_status || 'passed') + '">' + escapeHtml(item.tag_label) + '</span>'
      : '<span class="item-code">' + escapeHtml(item.tag_label) + '</span>';

    var safeSourceUrl = item.source_url ? safeHref(item.source_url) : null;
    var sourceHtml = safeSourceUrl
      ? ' Source: <a href="' + escapeHtml(safeSourceUrl) + '" target="_blank" rel="noopener">' + escapeHtml(item.source_label || 'link') + '</a>.'
      : '';

    return (
      '<div class="item-block">' +
        '<div class="item-head">' + tagHtml + '</div>' +
        '<h4 style="margin-bottom:6px;">' + escapeHtml(item.heading) + '</h4>' +
        '<p style="color:var(--ink-600); margin-bottom:0;">' + escapeHtml(item.description) + sourceHtml + '</p>' +
        '<div class="why-matters"><span class="label">Why it matters</span>' + escapeHtml(item.why_it_matters) + '</div>' +
      '</div>'
    );
  }

  function renderMeeting(meeting) {
    var items = (meeting.meeting_items || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    var card = document.createElement('div');
    card.className = 'meeting-card';
    card.innerHTML =
      '<div class="meeting-card-date">' + escapeHtml(meeting.meeting_type) + ' &middot; ' + escapeHtml(formatMeetingDate(meeting.meeting_date)) + '</div>' +
      '<h3>' + escapeHtml(meeting.title) + '</h3>' +
      '<p class="meeting-card-summary">' + escapeHtml(meeting.summary) + '</p>' +
      items.map(renderItem).join('');
    return card;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('meetings-dynamic');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    supabaseClient
      .from('meetings')
      .select('*, meeting_items(*)')
      .order('meeting_date', { ascending: false })
      .order('sort_order', { foreignTable: 'meeting_items', ascending: true })
      .then(function (res) {
        if (res.error || !res.data) return;
        res.data.forEach(function (meeting) {
          listEl.appendChild(renderMeeting(meeting));
        });
      });
  });
})();
