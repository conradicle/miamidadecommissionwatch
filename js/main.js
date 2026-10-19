document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // The Documents menu is a <details>, which opens and closes on its own.
  // On a desktop dropdown it should also close when you click elsewhere or
  // press Escape, the way every other menu does.
  var navMenus = document.querySelectorAll('.nav-menu');
  if (navMenus.length) {
    document.addEventListener('click', function (e) {
      navMenus.forEach(function (menu) {
        if (menu.open && !menu.contains(e.target)) menu.open = false;
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      navMenus.forEach(function (menu) {
        if (menu.open) {
          menu.open = false;
          menu.querySelector('summary').focus();
        }
      });
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
    // Minimum real movement (in px) required before the bar's state can
    // flip again, so residual scroll noise near the threshold, or the
    // sub-pixel jitter some browsers report while a smooth scroll settles,
    // can't toggle it back and forth. A small scroll gesture (slow trackpad
    // drag, or the rubber-band settle at the end of a scroll) routinely
    // produces single ticks of 10-15px in alternating directions, so the
    // buffer needs to clear that comfortably rather than just filter
    // sub-pixel noise.
    var DIRECTION_CHANGE_BUFFER = 24;
    // The newsletter bar sits in normal flow inside the sticky header, so
    // collapsing/expanding it changes the header's height while it's
    // pinned to the top. That shifts every element below it (nav included)
    // on the very frame the CSS transition starts, which the browser's
    // scroll-anchoring reports back as a scroll event - read by this same
    // handler as a direction change, toggling the bar again, which shifts
    // things again, and so on. The visible result is the nav bar rapidly
    // bobbing between the two layouts instead of settling. Muting the
    // handler for the duration of our own transition breaks that loop;
    // it doesn't affect genuine user scrolling, which keeps generating
    // events after the mute window ends.
    var TRANSITION_MS = 400;
    var mutedUntil = 0;
    window.addEventListener('scroll', function () {
      var currentScrollY = window.scrollY;
      header.classList.toggle('scrolled', currentScrollY > 10);

      if (Date.now() < mutedUntil) {
        return;
      }

      if (newsletterBar) {
        var isHidden = newsletterBar.classList.contains('header-newsletter-hidden');
        var delta = currentScrollY - lastScrollY;
        if (delta > DIRECTION_CHANGE_BUFFER && currentScrollY > HIDE_THRESHOLD && !isHidden) {
          hideNewsletterBar();
          mutedUntil = Date.now() + TRANSITION_MS;
          lastScrollY = currentScrollY;
        } else if (delta < -DIRECTION_CHANGE_BUFFER && isHidden) {
          showNewsletterBar();
          mutedUntil = Date.now() + TRANSITION_MS;
          lastScrollY = currentScrollY;
        } else if (Math.abs(delta) > DIRECTION_CHANGE_BUFFER) {
          lastScrollY = currentScrollY;
        }
      } else {
        lastScrollY = currentScrollY;
      }
    }, { passive: true });
  }

  // Scroll-reveal: fade/slide in cards as they enter the viewport. Only
  // engages when IntersectionObserver exists; otherwise content just stays
  // visible (the CSS only hides elements once .animate-on is added below).
  if ('IntersectionObserver' in window) {
    document.body.classList.add('animate-on');
    var revealSelector = '.card, .meeting-card, .roster-card, .founder-card, .partner-card, .team-member, .stat-item, .faq-item';
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
      // threshold must stay 0. A ratio threshold is a fraction of the
      // ELEMENT, so an element taller than the viewport can never reach it:
      // a meeting card with a full agenda runs to ~13,500px, and 12% of that
      // is ~1,600px of a ~800px screen. It would sit at opacity:0 forever,
      // visible for one frame before .animate-on lands and then fading out.
      // The reveal is delayed by the rootMargin below instead, which is a
      // fraction of the VIEWPORT and so behaves the same at any card height.
    }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll(revealSelector).forEach(function (el) {
      io.observe(el);
    });

    // Feed scripts (editorials, news posts, meetings) fetch data and append
    // cards after this DOMContentLoaded handler already ran, so they'd never
    // get observed above and would stay stuck at opacity:0. Watch for those
    // later insertions too.
    var mo = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches(revealSelector)) io.observe(node);
          node.querySelectorAll(revealSelector).forEach(function (el) {
            io.observe(el);
          });
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
});
