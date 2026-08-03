(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function renderEditorial(row) {
    var card = document.createElement('div');
    card.className = 'meeting-card';
    card.innerHTML =
      '<div class="meeting-card-date">Editorial &middot; ' + escapeHtml(formatDate(row.submitted_at)) + '</div>' +
      '<h3>' + escapeHtml(row.title) + '</h3>' +
      '<p style="color:var(--ink-600); font-size:14px; margin-bottom:12px;">By ' + escapeHtml(row.name) + ', ' + escapeHtml(row.grade) + ' at ' + escapeHtml(row.school) + '</p>' +
      '<p class="meeting-card-summary" style="white-space:pre-wrap;">' + escapeHtml(row.body) + '</p>';
    return card;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('editorials-list');
    var emptyEl = document.getElementById('editorials-empty');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    supabaseClient
      .from('editorial_submissions')
      .select('name, grade, school, title, body, submitted_at')
      .eq('status', 'approved')
      .order('submitted_at', { ascending: false })
      .then(function (res) {
        if (res.error || !res.data || res.data.length === 0) {
          emptyEl.style.display = 'block';
          return;
        }
        res.data.forEach(function (row) {
          listEl.appendChild(renderEditorial(row));
        });
      });
  });
})();
