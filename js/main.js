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
  var header = document.querySelector('.site-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 10);
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
