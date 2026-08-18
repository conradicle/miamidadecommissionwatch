document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Sticky header gains a shadow once the page has scrolled past the top.
  // The newsletter bar within it also hides on scroll-down (past a small
  // threshold, so it doesn't flicker from jitter near the top) and reappears
  // on any scroll-up, to give scrolling content more room. max-height is set
  // from measured content height (rather than a guessed CSS value) so the
  // collapse animates cleanly instead of jumping partway through.
  var header = document.querySelector('.site-header');
  var newsletterBar = document.querySelector('.header-newsletter');
  var HIDE_THRESHOLD = 40;

  function showNewsletterBar() {
    newsletterBar.classList.remove('header-newsletter-hidden');
    newsletterBar.style.maxHeight = newsletterBar.scrollHeight + 'px';
  }

  function hideNewsletterBar() {
    // Set the current height explicitly first so the browser has a real
    // starting value to transition from (can't animate from "none").
    newsletterBar.style.maxHeight = newsletterBar.scrollHeight + 'px';
    newsletterBar.offsetHeight; // force reflow so the change above registers
    newsletterBar.classList.add('header-newsletter-hidden');
    newsletterBar.style.maxHeight = '0px';
  }

  if (newsletterBar) {
    showNewsletterBar();
    window.addEventListener('resize', function () {
      if (!newsletterBar.classList.contains('header-newsletter-hidden')) {
        newsletterBar.style.maxHeight = newsletterBar.scrollHeight + 'px';
      }
    });
  }

  if (header) {
    var lastScrollY = window.scrollY;
    window.addEventListener('scroll', function () {
      var currentScrollY = window.scrollY;
      header.classList.toggle('scrolled', currentScrollY > 10);

      if (newsletterBar) {
        var isHidden = newsletterBar.classList.contains('header-newsletter-hidden');
        if (currentScrollY > lastScrollY && currentScrollY > HIDE_THRESHOLD && !isHidden) {
          hideNewsletterBar();
        } else if (currentScrollY < lastScrollY && isHidden) {
          showNewsletterBar();
        }
      }

      lastScrollY = currentScrollY;
    }, { passive: true });
  }

  // Scroll-reveal: fade/slide in cards as they enter the viewport. Only
  // engages when IntersectionObserver exists; otherwise content just stays
  // visible (the CSS only hides elements once .animate-on is added below).
  if ('IntersectionObserver' in window) {
    document.body.classList.add('animate-on');
    var revealSelector = '.card, .meeting-card, .roster-card, .founder-card, .partner-card, .stat-item, .faq-item';
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll(revealSelector).forEach(function (el) {
      io.observe(el);
    });
  }
});
