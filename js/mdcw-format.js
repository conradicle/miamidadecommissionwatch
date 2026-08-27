// Shared formatting and escaping helpers.
//
// meetings-feed.js already carried its own escapeHtml/safeHref; the homepage
// briefing and the commissioner pages need the same two functions plus money
// and date formatting. One copy, so a fix to the escaping applies everywhere
// rather than to whichever file someone remembered.
(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only allow http/https links so a staff-entered URL can't carry a
  // javascript: URI (or similar) that executes when a visitor clicks it.
  // Returns null for anything else; callers render no link in that case.
  function safeHref(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (e) {
      return null;
    }
  }

  // Dates come out of Postgres as plain YYYY-MM-DD. Parsing that bare string
  // gives UTC midnight, which renders as the previous day west of Greenwich --
  // hence the explicit midday local time.
  function formatDate(dateStr, opts) {
    if (!dateStr) return '';
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', opts || {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  }

  function formatDateShort(dateStr) {
    return formatDate(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Dollar figures on agenda items span five orders of magnitude ($40K grants
  // to $2.5B bond authorisations), so abbreviate rather than printing fifteen
  // digits into a one-line record.
  function formatMoney(amount) {
    var n = Number(amount);
    if (!isFinite(n) || n === 0) return '';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + trimZero(n / 1e9) + 'B';
    if (abs >= 1e6) return '$' + trimZero(n / 1e6) + 'M';
    if (abs >= 1e3) return '$' + trimZero(n / 1e3) + 'K';
    return '$' + n.toFixed(0);
  }

  function trimZero(n) {
    // 2.50 -> "2.5", 2.00 -> "2", 31.4 -> "31.4"
    return parseFloat(n.toFixed(1)).toString();
  }

  function plural(n, one, many) {
    return n === 1 ? one : (many || one + 's');
  }

  // Today in local time as YYYY-MM-DD, for comparing against meeting_date.
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  window.MDCW = window.MDCW || {};
  window.MDCW.fmt = {
    escapeHtml: escapeHtml,
    safeHref: safeHref,
    formatDate: formatDate,
    formatDateShort: formatDateShort,
    formatMoney: formatMoney,
    plural: plural,
    todayISO: todayISO
  };
})();
