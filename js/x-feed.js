// The homepage X panel, under the seal.
//
// The markup in home.html is the follow card: that is what a reader without
// JavaScript sees, and what stays on the page when there is nothing to show.
// This script only ever REPLACES it, so a failed fetch, a missing token or a
// blocked request all end at the same place instead of an empty box.
//
// Nothing here talks to X. api/x-feed.js does that server-side, because the
// embedded timeline X used to publish for this no longer renders and its
// replacement needs a bearer token that cannot ship to a browser.
(function () {
  var fmt = window.MDCW && window.MDCW.fmt;
  if (!fmt) return;

  var esc = fmt.escapeHtml;
  var MAX_SHOWN = 3;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Short and glanceable: minutes for the last hour, hours for the last day,
  // then the date. A post from this morning reads "4h", which is the whole
  // point of the panel -- it says the account is active right now.
  function shortAge(iso) {
    var then = new Date(iso).getTime();
    if (!then) return '';

    var mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';

    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h';

    var days = Math.round(hours / 24);
    if (days < 7) return days + 'd';

    return fmt.formatDateShort(iso);
  }

  function render(posts) {
    var body = document.getElementById('x-feed-body');
    if (!body || !posts.length) return;

    body.innerHTML = posts.slice(0, MAX_SHOWN).map(function (post) {
      return '<a class="x-post" href="' + esc(fmt.safeHref(post.url)) + '" target="_blank" rel="noopener">' +
        '<p class="x-post-text">' + esc(post.text) + '</p>' +
        '<span class="x-post-age">' + esc(shortAge(post.created_at)) + '</span>' +
        '</a>';
    }).join('');

    var feed = document.getElementById('x-feed');
    if (feed) feed.classList.add('x-feed-live');
  }

  ready(function () {
    if (!document.getElementById('x-feed-body')) return;

    fetch('/api/x-feed', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.posts && data.posts.length) render(data.posts);
      })
      .catch(function () { /* follow card stays */ });
  });
}());
