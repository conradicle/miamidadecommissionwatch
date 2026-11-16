// Opens meeting photos large, on /photos, /attend, the homepage and under
// Meeting Summaries. Each photo is a plain link to its full-size file, so
// without this script (or with a modifier-click) the browser just opens the
// image. With it, a <dialog> shows the photo with its caption, and the arrow
// keys or buttons step through the rest of the same set ([data-photo-group]).
// <dialog> brings Escape-to-close and focus trapping with it.
(function () {
  var dialog, img, caption, counter, prevBtn, nextBtn;
  var group = [];
  var index = 0;
  var opener = null;

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'photo-viewer';
    dialog.setAttribute('aria-label', 'Photo viewer');
    dialog.innerHTML =
      '<div class="photo-viewer-frame">' +
        '<img class="photo-viewer-img" alt="">' +
        '<div class="photo-viewer-bar">' +
          '<p class="photo-viewer-caption"></p>' +
          '<div class="photo-viewer-controls">' +
            '<span class="photo-viewer-count"></span>' +
            '<button type="button" class="photo-viewer-btn" data-step="-1" aria-label="Previous photo">&#8592;</button>' +
            '<button type="button" class="photo-viewer-btn" data-step="1" aria-label="Next photo">&#8594;</button>' +
            '<button type="button" class="photo-viewer-btn photo-viewer-close" aria-label="Close">&#10005;</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dialog);
    img = dialog.querySelector('.photo-viewer-img');
    caption = dialog.querySelector('.photo-viewer-caption');
    counter = dialog.querySelector('.photo-viewer-count');
    prevBtn = dialog.querySelector('[data-step="-1"]');
    nextBtn = dialog.querySelector('[data-step="1"]');

    dialog.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (btn && btn.dataset.step) show(index + Number(btn.dataset.step));
      else if (btn || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    });
    // Keep the caption bar as wide as the photo, so the caption sits under
    // it instead of at the far edge of the window. Never narrower than a
    // readable line.
    var bar = dialog.querySelector('.photo-viewer-bar');
    img.addEventListener('load', function () {
      bar.style.width = Math.max(img.clientWidth, Math.min(window.innerWidth * 0.92, 480)) + 'px';
    });
    dialog.addEventListener('close', function () {
      img.removeAttribute('src');
      if (opener) opener.focus();
    });
  }

  function show(i) {
    if (i < 0 || i >= group.length) return;
    index = i;
    var link = group[i];
    var thumb = link.querySelector('img');
    img.src = link.href;
    img.alt = thumb ? thumb.alt : '';
    caption.textContent = link.getAttribute('data-caption') || '';
    caption.hidden = !caption.textContent;
    var several = group.length > 1;
    counter.textContent = several ? (i + 1) + ' of ' + group.length : '';
    prevBtn.hidden = nextBtn.hidden = !several;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === group.length - 1;
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a.photo-link');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (typeof HTMLDialogElement !== 'function') return;
    e.preventDefault();
    if (!dialog) build();
    var root = link.closest('[data-photo-group]');
    group = root ? Array.prototype.slice.call(root.querySelectorAll('a.photo-link')) : [link];
    opener = link;
    show(group.indexOf(link));
    dialog.showModal();
  });
})();
