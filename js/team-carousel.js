// Arrows, arrow keys and the count line for the team carousel on about.html.
// Swiping is native scrolling, so the cards stay reachable if this never runs.
(function () {
  var root = document.querySelector('[data-exec-carousel]');
  if (!root) return;
  var track = root.querySelector('.exec-scroll');
  var cards = Array.prototype.slice.call(root.querySelectorAll('.exec-card'));
  var status = root.querySelector('.exec-status');
  var arrows = root.querySelectorAll('.exec-arrow');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var timer;

  function step() {
    return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : track.clientWidth;
  }
  function perView() { return Math.max(1, Math.round(track.clientWidth / step())); }
  function atStart() { return track.scrollLeft <= 2; }
  function atEnd() { return track.scrollLeft + track.clientWidth >= track.scrollWidth - 2; }

  function move(left) {
    track.scrollTo({ left: left, behavior: reduce.matches ? 'auto' : 'smooth' });
  }
  function go(dir) {
    // From the far end the position may sit between two steps, so snap first.
    var index = dir > 0 ? Math.floor((track.scrollLeft + 2) / step()) : Math.ceil((track.scrollLeft - 2) / step());
    move((index + dir * perView()) * step());
  }
  function update() {
    var n = perView();
    var first = atEnd() ? Math.max(0, cards.length - n) : Math.round(track.scrollLeft / step());
    var last = Math.min(cards.length, first + n);
    var text = 'Showing ' + (last - first > 1 ? (first + 1) + ' to ' + last : first + 1) + ' of ' + cards.length;
    if (status.textContent !== text) status.textContent = text;
    arrows[0].setAttribute('aria-disabled', String(atStart()));
    arrows[1].setAttribute('aria-disabled', String(atEnd()));
  }

  arrows.forEach(function (button) {
    button.addEventListener('click', function () {
      if (button.getAttribute('aria-disabled') !== 'true') go(Number(button.dataset.dir));
    });
  });
  track.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(track.scrollWidth);
    else return;
    e.preventDefault();
  });
  track.addEventListener('scroll', function () {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  }, { passive: true });
  window.addEventListener('resize', update);
  root.querySelector('.exec-bar').hidden = false;
  update();
})();
