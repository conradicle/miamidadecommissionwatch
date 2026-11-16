// Turns the homepage hero's featured photos (scripts/lib/photos.mjs,
// renderHeroMedia) into a slideshow: a crossfade every INTERVAL, dots to
// jump to a photo, and a pause button.
//
// It stops on its own whenever someone might be looking closely or the
// motion is unwanted:
//   - the pointer is over it, or keyboard focus is inside it
//   - the tab is in the background
//   - the visitor asked for reduced motion (then it never starts; the dots
//     still work)
//   - the visitor pressed pause (WCAG 2.2.2: anything that moves on its own
//     for more than five seconds needs a way to stop it)
// Without this script only the first photo shows and the controls stay
// hidden.
(function () {
  var INTERVAL = 6000;

  function init(root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('.hero-slide'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('.hero-dot'));
    var pauseBtn = root.querySelector('.hero-pause');
    var controls = root.querySelector('.hero-controls');
    if (slides.length < 2 || !controls) return;

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var index = 0;
    var timer = null;
    var pausedByUser = reduced;
    var hovering = false;
    var focused = false;

    function show(i) {
      index = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) {
        var on = n === index;
        s.classList.toggle('is-active', on);
        if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
      });
      dots.forEach(function (d, n) {
        if (n === index) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
    }

    function running() {
      return !pausedByUser && !hovering && !focused && !document.hidden;
    }

    // Restart the countdown from zero, so a photo someone just jumped to
    // gets a full INTERVAL on screen.
    function schedule() {
      clearTimeout(timer);
      timer = running() ? setTimeout(function () { show(index + 1); schedule(); }, INTERVAL) : null;
    }

    function setPaused(paused) {
      pausedByUser = paused;
      root.classList.toggle('is-paused', paused);
      pauseBtn.setAttribute('aria-label', pauseBtn.getAttribute(paused ? 'data-label-play' : 'data-label-pause'));
      schedule();
    }

    dots.forEach(function (d, n) {
      d.addEventListener('click', function () { show(n); schedule(); });
    });
    pauseBtn.addEventListener('click', function () { setPaused(!pausedByUser); });
    root.addEventListener('mouseenter', function () { hovering = true; schedule(); });
    root.addEventListener('mouseleave', function () { hovering = false; schedule(); });
    root.addEventListener('focusin', function () { focused = true; schedule(); });
    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) { focused = false; schedule(); }
    });
    document.addEventListener('visibilitychange', schedule);

    controls.hidden = false;
    root.classList.add('is-ready');
    setPaused(pausedByUser);
  }

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-rotate]'), init);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
