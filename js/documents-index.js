// Filters the document index (Meeting Summaries, Agenda Summaries).
//
// The rows are prerendered by scripts/build.mjs, each carrying data-year,
// data-month and data-search (title, summary, document number, item numbers
// and keywords, lower-cased). This only hides and shows them, so the full
// list is there for crawlers and for anyone without JavaScript.
//
// The current filters live in the query string (?q=11A5&year=2026&month=10),
// so a filtered list can be bookmarked or shared.
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // "11 A5" and "11a5" should both find 11A5, so spaces inside a term that
  // mixes digits and letters are dropped before matching.
  function terms(query) {
    return String(query || '').toLowerCase()
      .replace(/(\d)\s+([a-z])/g, '$1$2').replace(/([a-z])\s+(\d)/g, '$1$2')
      .split(/\s+/).filter(Boolean);
  }

  ready(function () {
    var list = document.getElementById('doc-list');
    var q = document.getElementById('doc-q');
    var year = document.getElementById('doc-year');
    var month = document.getElementById('doc-month');
    var count = document.getElementById('doc-count');
    var clear = document.getElementById('doc-clear');
    var empty = document.getElementById('doc-filter-empty');
    if (!list || !q || !year || !month) return;

    var rows = Array.prototype.slice.call(list.querySelectorAll('[data-doc]'));
    if (!rows.length) {
      // Nothing published yet: the filters would only filter an empty list.
      var bar = document.querySelector('.doc-filter');
      if (bar) bar.hidden = true;
      return;
    }

    var params = new URLSearchParams(window.location.search);
    if (params.get('q')) q.value = params.get('q');
    if (params.get('year')) year.value = params.get('year');
    if (params.get('month')) month.value = params.get('month');

    function apply() {
      var wanted = terms(q.value);
      var y = year.value;
      var m = month.value;
      var shown = 0;

      rows.forEach(function (row) {
        var hay = row.getAttribute('data-search') || '';
        var ok = (!y || row.getAttribute('data-year') === y) &&
          (!m || row.getAttribute('data-month') === m) &&
          wanted.every(function (t) { return hay.indexOf(t) !== -1; });
        row.hidden = !ok;
        if (ok) shown++;
      });

      var filtered = !!(wanted.length || y || m);
      if (count) {
        count.textContent = filtered
          ? 'Showing ' + shown + ' of ' + rows.length
          : rows.length + (rows.length === 1 ? ' document' : ' documents');
      }
      if (clear) clear.hidden = !filtered;
      if (empty) empty.hidden = shown !== 0;

      var next = new URLSearchParams();
      if (q.value.trim()) next.set('q', q.value.trim());
      if (y) next.set('year', y);
      if (m) next.set('month', m);
      var qs = next.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    }

    function reset() {
      q.value = '';
      year.value = '';
      month.value = '';
      apply();
      q.focus();
    }

    q.addEventListener('input', apply);
    year.addEventListener('change', apply);
    month.addEventListener('change', apply);
    if (clear) clear.addEventListener('click', reset);
    document.querySelectorAll('[data-doc-clear]').forEach(function (btn) {
      btn.addEventListener('click', reset);
    });

    apply();
  });
})();
