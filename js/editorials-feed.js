// Approved student editorials on /news.html.
//
// The cards are prerendered into the HTML by scripts/build.mjs so the text is
// indexable without JavaScript. This file's job in that case is only to make
// them interactive: the expand/collapse behaviour is bound to whatever cards
// are already on the page. It still knows how to build the cards from scratch,
// which is what happens if the page is opened without a build having run.
//
// It also covers the gap between an approval and the next build. The
// prerendered cards stay (they are what crawlers read), and anything approved
// since the build is fetched and added beside them, so a piece appears when
// staff approve it rather than when the rebuild finishes.
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
  // (news.html#ed-my-editorial-title). The used-slug table keeps two
  // editorials with the same title from claiming the same id, which makes the
  // result depend on order: feed it rows newest first, as the build does. This
  // is makeEditorialSlugger() in scripts/lib/render.mjs rule for rule, so a
  // card built here gets the id the build would have given it -- which is
  // also how the fallback below tells a new piece from a prerendered one.
  function makeSlugger() {
    var usedSlugs = {};
    return function slugify(title) {
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
    };
  }

  var CHEVRON =
    '<svg class="editorial-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">' +
    '<path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Attaches the read-more behaviour to a card. Works the same whether the card
  // was built by renderEditorial() below or written into the HTML by the build,
  // which is the point: one definition of how a card behaves.
  function bindCard(card) {
    var bodyEl = card.querySelector('.editorial-body');
    var btn = card.querySelector('.editorial-toggle');
    var label = card.querySelector('.editorial-toggle-label');
    if (!bodyEl || !btn || !label) return card;

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

  function renderEditorial(row, id) {
    var bodyId = id + '-body';

    var card = document.createElement('div');
    card.className = 'meeting-card editorial-card';
    card.id = id;
    card.innerHTML =
      '<div class="meeting-card-date">Editorial &middot; ' + escapeHtml(formatDate(row.submitted_at)) + '</div>' +
      '<h3>' + escapeHtml(row.title) + '</h3>' +
      '<p class="editorial-byline">By ' + escapeHtml(row.byline) + '</p>' +
      '<p class="editorial-body" id="' + bodyId + '">' + escapeHtml(row.body) + '</p>' +
      '<button class="editorial-toggle" type="button" aria-expanded="false" aria-controls="' + bodyId + '">' +
      '<span class="editorial-toggle-label">Read more</span>' + CHEVRON + '</button>';

    return bindCard(card);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('editorials-list');
    var emptyEl = document.getElementById('editorials-empty');
    if (!listEl) return;

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

    window.addEventListener('hashchange', openFromHash);

    // Prerendered by scripts/build.mjs: bind the cards already here first, so
    // the page works even if the fetch below never comes back.
    var prerendered = listEl.getAttribute('data-prerendered') === '1';
    if (prerendered) {
      var existing = listEl.querySelectorAll('.editorial-card');
      Array.prototype.forEach.call(existing, bindCard);
      if (!existing.length && emptyEl) emptyEl.style.display = 'block';
      openFromHash();
    }

    if (typeof supabaseClient === 'undefined') return;

    supabaseClient
      // Submitters are minors. The view (supabase/migration_28) holds approved
      // rows only and hands back the byline already cut to "First L." in the
      // database, so the full name never reaches the browser at all.
      .from('published_editorials')
      .select('byline, title, body, submitted_at')
      .order('submitted_at', { ascending: false })
      .then(function (res) {
        if (res.error || !res.data) {
          // A prerendered page is already complete as of the last build.
          if (!prerendered && emptyEl) emptyEl.style.display = 'block';
          return;
        }

        // Slug the whole list newest first, exactly as the build did, and add
        // only the rows whose card is not on the page yet. Oldest first, each
        // new card goes in front of the nearest older card already present,
        // so the list stays in date order.
        //
        // Known limit: if a new piece has the exact title of an older one, the
        // new one takes the bare slug, the prerendered older card's id no
        // longer lines up, and the older piece shows twice until the rebuild
        // (a few minutes). Nothing is ever dropped.
        var slugify = makeSlugger();
        var ids = res.data.map(function (row) { return slugify(row.title); });
        var added = 0;
        for (var i = res.data.length - 1; i >= 0; i--) {
          if (document.getElementById(ids[i])) continue;
          var older = null;
          for (var j = i + 1; j < ids.length && !older; j++) {
            var el = document.getElementById(ids[j]);
            if (el && el.parentNode === listEl) older = el;
          }
          listEl.insertBefore(renderEditorial(res.data[i], ids[i]), older);
          added++;
        }

        if (emptyEl) {
          emptyEl.style.display = listEl.querySelector('.editorial-card') ? 'none' : 'block';
        }
        // New cards only exist now, so the browser's own hash scroll already
        // missed them.
        if (added) openFromHash();
      });
  });
})();
