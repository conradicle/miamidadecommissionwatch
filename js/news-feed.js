(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function renderPost(row) {
    var card = document.createElement('div');
    card.className = 'meeting-card';
    card.innerHTML =
      '<div class="meeting-card-date">Update &middot; ' + escapeHtml(formatDate(row.created_at)) + '</div>' +
      '<h3>' + escapeHtml(row.title) + '</h3>' +
      '<p class="meeting-card-summary" style="white-space:pre-wrap;">' + escapeHtml(row.body) + '</p>';
    return card;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('news-posts-list');
    var sectionEl = document.getElementById('news-posts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    supabaseClient
      .from('news_posts')
      .select('title, body, created_at')
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error || !res.data || res.data.length === 0) return;
        res.data.forEach(function (row) {
          listEl.appendChild(renderPost(row));
        });
        if (sectionEl) sectionEl.style.display = 'block';
      });
  });
})();
