(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  // Anchor slug so a student can link straight to their own piece
  // (news.html#ed-my-editorial-title). usedSlugs keeps two editorials with the
  // same title from claiming the same id.
  var usedSlugs = {};
  function slugify(title) {
    var base = String(title == null ? '' : title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '');
    if (!base) base = 'editorial';
    var slug = base;
    var n = 2;
    while (usedSlugs[slug]) {
      slug = base + '-' + n;
      n++;
    }
    usedSlugs[slug] = true;
    return 'ed-' + slug;
  }

  var CHEVRON =
    '<svg class="editorial-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
    '<path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderEditorial(row) {
    var id = slugify(row.title);
    var bodyId = id + '-body';

    var card = document.createElement('div');
    card.className = 'meeting-card editorial-card';
    card.id = id;
    card.innerHTML =
      '<div class="meeting-card-date">Editorial &middot; ' + escapeHtml(formatDate(row.submitted_at)) + '</div>' +
      '<h3>' + escapeHtml(row.title) + '</h3>' +
      '<p class="editorial-byline">By ' + escapeHtml(row.name) + ', ' + escapeHtml(row.grade) + ' at ' + escapeHtml(row.school) + '</p>' +
      '<p class="editorial-body" id="' + bodyId + '">' + escapeHtml(row.body) + '</p>' +
      '<button class="editorial-toggle" type="button" aria-expanded="false" aria-controls="' + bodyId + '">' +
      '<span class="editorial-toggle-label">Read more</span>' + CHEVRON + '</button>';

    var bodyEl = card.querySelector('.editorial-body');
    var btn = card.querySelector('.editorial-toggle');
    var label = card.querySelector('.editorial-toggle-label');

    function setOpen(open) {
      card.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      label.textContent = open ? 'Show less' : 'Read more';
    }
    card.setOpen = setOpen;

    card.addEventListener('click', function (e) {
      // Let links and text selection inside the card behave normally.
      if (e.target.closest('a')) return;
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      // Once open, clicking the body itself shouldn't slam it shut mid-read.
      // Collapsing goes through the toggle or the card's header area.
      if (card.classList.contains('open') && bodyEl.contains(e.target)) return;
      setOpen(!card.classList.contains('open'));
    });

    return card;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('editorials-list');
    var emptyEl = document.getElementById('editorials-empty');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    function openFromHash() {
      var hash = window.location.hash;
      if (!hash || hash.length < 2) return;
      var target;
      try {
        target = listEl.querySelector(hash);
      } catch (e) {
        return;
      }
      if (!target || !target.setOpen) return;
      target.setOpen(true);
      target.scrollIntoView({ block: 'start' });
    }

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
        // Cards only exist now, so the browser's own hash scroll already
        // missed them.
        openFromHash();
      });

    window.addEventListener('hashchange', openFromHash);
  });
})();
