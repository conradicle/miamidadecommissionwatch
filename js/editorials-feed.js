// Uses the existing public feed and build-time HTML. No private contributor data.
(function () {
  function esc(value) {
    var el = document.createElement('div');
    el.textContent = value == null ? '' : String(value);
    return el.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function editorialDate(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return m ? months[Number(m[2])-1] + ' ' + m[1] : '';
  }
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


  function renderEditorial(row, id) {
    var bodyId = id + '-body';
    var wrapper = document.createElement('div');
    wrapper.innerHTML = '<article class="editorial-card" id="' + esc(id) + '" data-date="' + esc(row.submitted_at) + '">' +
      '<div class="editorial-meta">Editorial <span aria-hidden="true">·</span> <time datetime="' + esc(row.submitted_at) + '">' + esc(editorialDate(row.submitted_at)) + '</time></div>' +
      '<h2><a href="#' + esc(id) + '">' + esc(row.title) + '</a></h2>' +
      '<p class="editorial-byline">By ' + esc(row.byline) + '</p>' +
      '<p class="editorial-excerpt">' + esc(String(row.body || '').trim().slice(0, 420)) + '</p>' +
      '<details class="editorial-reading"><summary>Read editorial <span aria-hidden="true">→</span></summary>' +
      '<p class="editorial-body" id="' + esc(bodyId) + '">' + esc(row.body) + '</p></details></article>';
    return wrapper.firstElementChild;
  }
  document.addEventListener('DOMContentLoaded', function () {
    var list = document.getElementById('editorials-list');
    if (!list) return;
    var empty = document.getElementById('editorials-empty');
    var search = document.getElementById('editorial-search');
    var sort = document.getElementById('editorial-sort');
    var count = document.getElementById('editorial-count');
    var status = document.getElementById('editorial-feed-status');
    var dialog = document.getElementById('editorial-reader');
    var cards = [];
    var active = null;
    var placeholder = null;
    var returnFocus = null;
    var archiveHash = '#editorials';
    var canDialog = dialog && typeof dialog.showModal === 'function';

    function indexCards() {
      cards = Array.prototype.slice.call(list.querySelectorAll('.editorial-card'));
      cards.forEach(function (card, index) {
        card.archiveOrder = index;
        card.searchText = (card.querySelector('h2').textContent + ' ' +
          card.querySelector('.editorial-byline').textContent + ' ' +
          card.querySelector('.editorial-body').textContent).toLocaleLowerCase();
      });
    }
    function filter() {
      var query = search.value.trim().toLocaleLowerCase();
      var visible = 0;
      cards.slice().sort(function (a, b) {
        var difference = (Date.parse(b.dataset.date) || 0) - (Date.parse(a.dataset.date) || 0);
        difference = difference || a.archiveOrder - b.archiveOrder;
        return sort.value === 'oldest' ? -difference : difference;
      }).forEach(function (card) {
        // Include translated text currently in the DOM as well as the English
        // source indexed before Google Translate touched the page.
        var visibleText = (card.querySelector('h2').textContent + ' ' +
          card.querySelector('.editorial-byline').textContent + ' ' +
          card.querySelector('.editorial-body').textContent).toLocaleLowerCase();
        card.hidden = card.searchText.indexOf(query) < 0 && visibleText.indexOf(query) < 0;
        if (!card.hidden) visible++;
        // Keep the open reader in the dialog while rearranging its archive slot.
        list.appendChild(card === active ? placeholder : card);
      });
      count.textContent = query ? visible + ' of ' + cards.length + ' editorials' : cards.length + ' editorials';
      document.getElementById('editorial-no-results').hidden = !cards.length || visible > 0;
      if (empty) empty.style.display = cards.length ? 'none' : 'block';
    }
    function restoreCard() {
      if (!active) return;
      active.querySelector('details').open = false;
      active.querySelector('h2 a').removeAttribute('tabindex');
      if (placeholder) placeholder.replaceWith(active);
      active = placeholder = null;
    }
    function openCard(card, trigger) {
      if (active === card) return;
      restoreCard();
      card.hidden = false;
      card.querySelector('details').open = true;
      if (!canDialog) {
        card.scrollIntoView({block:'start'});
        return;
      }
      returnFocus = trigger || card.querySelector('h2 a');
      placeholder = document.createElement('div');
      placeholder.hidden = true;
      card.replaceWith(placeholder);
      active = card;
      card.querySelector('h2 a').setAttribute('tabindex', '-1');
      document.getElementById('editorial-reader-content').appendChild(card);
      dialog.setAttribute('aria-labelledby', card.id + '-title');
      card.querySelector('h2').id = card.id + '-title';
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      document.getElementById('editorial-reader-close').focus();
    }
    function fromHash() {
      var card = cards.find(function (item) { return '#' + item.id === location.hash; });
      if (card) openCard(card);
      else if (canDialog && dialog.open) dialog.close();
    }
    list.addEventListener('click', function (event) {
      var trigger = event.target.closest('h2 a, .editorial-reading summary');
      if (!trigger || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var card = trigger.closest('.editorial-card');
      event.preventDefault();
      archiveHash = location.hash || '#editorials';
      history.pushState(null, '', '#' + card.id);
      openCard(card, trigger);
    });
    if (canDialog) {
      document.getElementById('editorial-reader-close').addEventListener('click', function () { dialog.close(); });
      dialog.addEventListener('close', function () {
        var closingHash = active ? '#' + active.id : '';
        restoreCard();
        if (location.hash === closingHash) history.replaceState(null, '', archiveHash);
        filter();
        if (returnFocus && returnFocus.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({preventScroll:true});
      });
    }
    window.addEventListener('hashchange', fromHash);
    search.addEventListener('input', filter);
    sort.addEventListener('change', filter);
    document.getElementById('editorial-reset').addEventListener('click', function () { search.value = ''; filter(); search.focus(); });
    indexCards();
    filter();
    document.getElementById('editorial-tools').hidden = false;
    fromHash();

    function feedFailed() {
      status.textContent = cards.length ? 'Showing the saved archive. Recent editorials could not be checked. Reload to try again.' : 'Editorials could not be loaded. Please reload to try again.';
      if (!cards.length && empty) empty.style.display = 'none';
    }
    if (typeof supabaseClient === 'undefined') { feedFailed(); return; }
    // The public view returns approved pieces and already shortened bylines only.
    supabaseClient.from('published_editorials')
      .select('byline, title, body, submitted_at')
      .order('submitted_at', { ascending: false })
      .then(function (res) {
        if (res.error || !res.data) { feedFailed(); return; }
        var slugify = makeSlugger();
        var ids = res.data.map(function (row) { return slugify(row.title); });
        for (var i = res.data.length - 1; i >= 0; i--) {
          if (cards.some(function (card) { return card.id === ids[i]; })) continue;
          var card = renderEditorial(res.data[i], ids[i]);
          cards.push(card);
          list.insertBefore(card, list.firstChild);
        }
        // Index the complete archive, including an article currently being read.
        if (active) placeholder.replaceWith(active);
        var reading = active;
        indexCards();
        if (reading) {
          reading.replaceWith(placeholder);
          document.getElementById('editorial-reader-content').appendChild(reading);
        }
        filter();
        fromHash();
      }).catch(feedFailed);
  });
})();
