// Counts opens of, and taps on, the /links page. Only loaded by links.html.
//
// Nothing here identifies anyone: no cookie, no localStorage, no id of any
// kind is set or read. Each beacon is a standalone "this happened" with an
// event kind, the card's id, and the ?src= tag from the URL, and the server
// stores exactly that. See api/link-click.js.
(function () {
  var ENDPOINT = '/api/link-click';

  function source() {
    try {
      var value = new URLSearchParams(window.location.search).get('src');
      return value ? value.slice(0, 32) : null;
    } catch (e) {
      return null;
    }
  }

  function send(payload) {
    var body = JSON.stringify(payload);
    // sendBeacon survives the page being torn down by the navigation the
    // click itself started, which a plain fetch would not. The Blob type is
    // what makes it arrive as JSON rather than text/plain.
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
        return;
      } catch (e) {
        // fall through to fetch
      }
    }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      });
    } catch (e) {
      // A dropped count is not worth an error in a visitor's console.
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var src = source();

    send({ event: 'view', source: src });

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-link]') : null;
      if (!el) return;
      send({ event: 'click', link: el.getAttribute('data-link'), source: src });
    });
  });
})();
