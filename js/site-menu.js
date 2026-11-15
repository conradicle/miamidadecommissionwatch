// Accessibility for the phone menu in the shared header (700px and below).
// js/main.js owns the open/close click on .nav-toggle; this file watches the
// .open class it sets and adds what main.js does not: Escape to close, close
// on an outside click or when focus leaves, an accurate aria-label on the
// button, and inert + aria-hidden on the nav while it is closed so a keyboard
// or screen reader cannot land on links nobody can see.
//
// Above 700px the full nav is always on screen, so none of that applies and
// the nav must never be inert there. The breakpoint matches css/style.css.
(function () {
  'use strict';
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  var phone = window.matchMedia('(max-width: 700px)');

  function isOpen() { return nav.classList.contains('open'); }

  function sync() {
    var hidden = phone.matches && !isOpen();
    nav.inert = hidden;
    if (hidden) nav.setAttribute('aria-hidden', 'true');
    else nav.removeAttribute('aria-hidden');
    toggle.setAttribute('aria-label', isOpen() ? 'Close navigation' : 'Open navigation');
  }

  function closeMenu(returnFocus) {
    if (!isOpen()) return;
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  }

  sync();
  new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ['class'] });
  // Crossing the breakpoint (rotating a tablet, resizing a window) closes
  // the menu and re-evaluates inert.
  var onChange = function () { closeMenu(false); sync(); };
  if (phone.addEventListener) phone.addEventListener('change', onChange);
  else phone.addListener(onChange);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && phone.matches && isOpen()) closeMenu(true);
  });
  document.addEventListener('click', function (event) {
    if (phone.matches && !event.target.closest('.site-header')) closeMenu(false);
  });
  nav.addEventListener('focusout', function (event) {
    if (!phone.matches) return;
    var next = event.relatedTarget;
    if (next && !nav.contains(next) && next !== toggle) closeMenu(false);
  });
  nav.addEventListener('click', function (event) {
    if (phone.matches && event.target.closest('a')) closeMenu(false);
  });
})();
