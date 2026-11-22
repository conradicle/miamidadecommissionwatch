// Slides up the "Follow the Dollar" card on the homepage a moment after load.
// Closing it (or clicking Play) hides it for 30 days in this browser.
(function () {
  'use strict';
  var KEY = 'mdcw-game-promo-closed';
  var DAYS = 30;
  var card = document.getElementById('game-promo');
  if (!card) return;

  function closedRecently() {
    try {
      var t = Number(localStorage.getItem(KEY));
      return t && Date.now() - t < DAYS * 864e5;
    } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
  }
  if (closedRecently()) return;

  function close() {
    remember();
    card.classList.remove('is-open');
    setTimeout(function () { card.hidden = true; }, 400);
  }

  card.querySelector('.game-promo-close').addEventListener('click', close);
  card.querySelector('.game-promo-play').addEventListener('click', remember);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && card.classList.contains('is-open')) close();
  });

  setTimeout(function () {
    card.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { card.classList.add('is-open'); });
    });
  }, 2000);
})();
