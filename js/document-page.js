// Document page: marks the section you are reading in the contents list, and
// folds the phone-width contents away after you pick a section.
//
// The contents list is plain links prerendered by the build, so all of this
// is optional polish. Without it the jump links still work.
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var inline = document.querySelector('.doc-toc-inline');
    if (inline) {
      // Fold the list first, then jump. Folding after the browser's own jump
      // shortens the page above the target and leaves it far down the screen.
      inline.addEventListener('click', function (e) {
        var link = e.target.closest('a[href^="#"]');
        if (!link) return;
        var target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
        if (!target) return;
        e.preventDefault();
        inline.open = false;
        target.scrollIntoView({ block: 'start' });
        if (window.history && history.pushState) history.pushState(null, '', link.getAttribute('href'));
      });
    }

    var links = document.querySelectorAll('.doc-toc-side a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var byId = {};
    var headings = [];
    links.forEach(function (link) {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      var target = document.getElementById(id);
      if (!target) return;
      byId[id] = link;
      headings.push(target);
    });

    var visible = {};
    function mark() {
      // The first heading on screen wins; failing that, the last one above it.
      var current = null;
      for (var i = 0; i < headings.length; i++) {
        if (visible[headings[i].id]) { current = headings[i]; break; }
      }
      if (!current) {
        for (var j = headings.length - 1; j >= 0; j--) {
          if (headings[j].getBoundingClientRect().top < 160) { current = headings[j]; break; }
        }
      }
      links.forEach(function (l) { l.classList.remove('is-active'); });
      if (current && byId[current.id]) {
        var active = byId[current.id];
        active.classList.add('is-active');
        // Keep the marked entry in view in a long contents list, without
        // moving the page itself.
        var box = active.closest('.doc-toc-side');
        if (box) {
          var top = active.offsetTop - box.offsetTop;
          if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
            box.scrollTop = top - box.clientHeight / 3;
          }
        }
      }
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible[entry.target.id] = entry.isIntersecting; });
      mark();
    }, { rootMargin: '-140px 0px -55% 0px', threshold: 0 });
    headings.forEach(function (h) { io.observe(h); });
  });
})();
