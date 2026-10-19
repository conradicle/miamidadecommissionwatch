// The document page: header, download button, version history, table of
// contents and the document itself.
//
// One copy, used twice. scripts/build.mjs loads this file (the same way it
// loads js/public-byline.js) to prerender every published document, and
// documents/preview.html runs it in the browser to show staff a draft. The
// preview therefore cannot drift from what the public page will look like.
// That is also why it touches no DOM: it takes data and returns HTML strings.
//
// The document body arrives already sanitized (api/_document-lib.js) and with
// an id on every h2 and h3, which is what the table of contents links to.
(function (root) {
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var TYPES = {
    'meeting-summary': {
      label: 'Meeting Summary', plural: 'Meeting Summaries',
      index: '/documents/meeting-summaries', companion: 'agenda-summary'
    },
    'agenda-summary': {
      label: 'Agenda Summary', plural: 'Agenda Summaries',
      index: '/documents/agenda-summaries', companion: 'meeting-summary'
    }
  };

  var LANGUAGE_NAMES = { en: 'English', es: 'Español', ht: 'Kreyòl ayisyen' };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // From the date parts, not the platform formatter, so the build machine's
  // timezone cannot move a date. Same reasoning as scripts/lib/fmt.mjs.
  function formatDate(value, short) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return String(value || '');
    var names = short ? MONTHS_SHORT : MONTHS;
    return names[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function formatBytes(n) {
    n = Number(n);
    if (!n || !isFinite(n)) return '';
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function docPath(docType, meetingDate) {
    return '/documents/' + docType + '/' + meetingDate;
  }

  function decode(s) {
    return String(s || '')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  // [{ level: 2|3, id, text }] from the body's h2 and h3 headings, in order.
  // The document's own printed contents page is skipped: on the web the
  // sticky contents replaces it, and its page numbers mean nothing here.
  function buildToc(bodyHtml) {
    var out = [];
    var re = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
    var m;
    while ((m = re.exec(String(bodyHtml || '')))) {
      var id = /\bid="([^"]+)"/.exec(m[2]);
      if (!id) continue;
      var text = decode(m[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!text || /^(table of )?contents$/i.test(text)) continue;
      out.push({ level: Number(m[1]), id: id[1], text: text });
    }
    return out;
  }

  // Each table gets a scrolling box, so on a phone a wide table scrolls
  // sideways instead of squeezing its columns to a word each.
  function wrapTables(bodyHtml) {
    return String(bodyHtml || '')
      .replace(/<table\b/g, '<div class="doc-table-wrap"><table')
      .replace(/<\/table>/g, '</table></div>');
  }

  // notranslate: the entries are the document's own headings, and the
  // document stays in English, so the list has to match it.
  function renderTocList(entries) {
    return '<ol class="doc-toc-list notranslate" translate="no">' + entries.map(function (e) {
      return '<li class="doc-toc-l' + e.level + '"><a href="#' + esc(e.id) + '">' + esc(e.text) + '</a></li>';
    }).join('') + '</ol>';
  }

  // opts:
  //   doc        { doc_type, meeting_date, language, title, summary, document_number }
  //   version    the version shown: { version, issued_on, page_count, pdf_bytes, change_note, body_html }
  //   firstVersion  the earliest published version number, or null
  //   history    published versions, newest first: [{ version, issued_on, change_note, pdfUrl }]
  //   pdfUrl     the official PDF for `version`
  //   companion  { href, title } when the other document for this meeting exists
  //   translations  [{ language, pdfUrl }] for other-language editions
  //   preview    true on the staff preview: a banner, and no indexable links
  function renderDocumentMain(opts) {
    var doc = opts.doc;
    var v = opts.version;
    var type = TYPES[doc.doc_type];
    var companionType = TYPES[type.companion];
    var toc = buildToc(v.body_html);
    var meetingLine = 'BCC Meeting of ' + formatDate(doc.meeting_date);
    var isUpdate = opts.firstVersion && opts.firstVersion !== v.version;

    var html = '';
    html += '<section class="section doc-page">\n<div class="wrap">\n';

    if (opts.preview) {
      html += '<div class="doc-preview-banner" role="status"><strong>Draft preview.</strong> ' +
        'Only staff can see this page. Version ' + esc(v.version) + ' is not published.</div>\n';
    }

    html += '<nav class="breadcrumb" aria-label="Breadcrumb">' +
      '<a href="/">Home</a><span class="breadcrumb-sep" aria-hidden="true">&rsaquo;</span>' +
      '<a href="/documents">Documents</a><span class="breadcrumb-sep" aria-hidden="true">&rsaquo;</span>' +
      '<a href="' + type.index + '">' + esc(type.plural) + '</a><span class="breadcrumb-sep" aria-hidden="true">&rsaquo;</span>' +
      '<span aria-current="page">' + esc(formatDate(doc.meeting_date, true)) + '</span></nav>\n';

    html += '<header class="doc-head">' +
      '<img class="doc-head-seal" src="/assets/img/documents/seal.png" alt="" width="96" height="96">' +
      '<div class="doc-head-text">' +
      '<span class="doc-eyebrow">' + esc(type.label) + ' &middot; ' + esc(meetingLine) + '</span>' +
      '<h1>' + esc(doc.title) + '</h1>' +
      '<p class="doc-lede">' + esc(doc.summary) + '</p>' +
      '</div></header>\n';

    html += '<dl class="doc-control">' +
      '<div><dt>Document No.</dt><dd class="notranslate">' + esc(doc.document_number) + '</dd></div>' +
      '<div><dt>Version</dt><dd>' + esc(v.version) + '</dd></div>' +
      '<div><dt>Issued</dt><dd>' + esc(formatDate(v.issued_on)) + '</dd></div>' +
      (v.page_count ? '<div><dt>Pages</dt><dd>' + esc(v.page_count) + '</dd></div>' : '') +
      '</dl>\n';

    if (isUpdate) {
      html += '<p class="doc-updated"><strong>Updated ' + esc(formatDate(v.issued_on)) +
        ', version ' + esc(v.version) + '.</strong>' +
        (v.change_note ? ' ' + esc(v.change_note) : '') +
        ' Earlier versions are listed under Version history.</p>\n';
    }

    var fileFacts = ['PDF'];
    if (v.page_count) fileFacts.push(plural(Number(v.page_count), 'page'));
    if (v.pdf_bytes) fileFacts.push(formatBytes(v.pdf_bytes));

    html += '<div class="doc-actions">' +
      (opts.pdfUrl
        ? '<a class="btn doc-download" href="' + esc(opts.pdfUrl) + '">Download official PDF</a>'
        : '<span class="btn doc-download" aria-disabled="true">PDF not available</span>') +
      '<span class="doc-file-facts">' + esc(fileFacts.join(', ')) + '</span>' +
      '</div>\n';

    // Companion: the other document for the same meeting.
    if (opts.companion) {
      html += '<p class="doc-companion"><span class="doc-companion-label">' +
        esc(companionType.label) + ' for this meeting</span> ' +
        '<a href="' + esc(opts.companion.href) + '">' + esc(opts.companion.title) + ' &#8594;</a></p>\n';
    } else if (doc.doc_type === 'agenda-summary') {
      html += '<p class="doc-companion doc-companion-pending">The Meeting Summary for this meeting will be linked here once it is published.</p>\n';
    }

    // Plain page text on purpose, so the language switcher translates this
    // line along with the menus.
    if (!opts.translations || !opts.translations.length) {
      html += '<p class="doc-edition-note">Official English edition. Spanish and Haitian Creole editions coming soon.</p>\n';
    }

    if (opts.translations && opts.translations.length) {
      html += '<p class="doc-translations">Also available: ' + opts.translations.map(function (t) {
        return '<a href="' + esc(t.pdfUrl) + '" lang="' + esc(t.language) + '">' +
          esc(LANGUAGE_NAMES[t.language] || t.language) + ' (PDF)</a>';
      }).join(' &middot; ') + '</p>\n';
    }

    if (opts.history && opts.history.length > 1) {
      html += '<details class="doc-history"><summary>Version history (' +
        plural(opts.history.length, 'version') + ')</summary><ol>' +
        opts.history.map(function (h) {
          var current = h.version === v.version;
          return '<li><span class="doc-history-v">Version ' + esc(h.version) +
            (current ? ' (current)' : '') + '</span>' +
            '<span class="doc-history-date">Issued ' + esc(formatDate(h.issued_on)) + '</span>' +
            (h.change_note ? '<span class="doc-history-note">' + esc(h.change_note) + '</span>' : '') +
            (h.pdfUrl ? '<a href="' + esc(h.pdfUrl) + '">Download version ' + esc(h.version) + ' (PDF)</a>' : '') +
            '</li>';
        }).join('') + '</ol></details>\n';
    }

    html += '<div class="doc-layout">\n';
    if (toc.length) {
      html += '<nav class="doc-toc doc-toc-side" aria-label="Contents"><p class="doc-toc-title">Contents</p>' +
        renderTocList(toc) + '</nav>\n';
    }
    html += '<div class="doc-main">\n';
    if (toc.length) {
      html += '<details class="doc-toc doc-toc-inline"><summary>Contents (' + plural(toc.length, 'section') +
        ')</summary><nav aria-label="Contents">' + renderTocList(toc) + '</nav></details>\n';
    }
    // The official text is never machine-translated: Google Translate's
    // widget skips anything marked notranslate (translate="no" is the
    // standard spelling of the same thing). The page around it, menus and
    // buttons included, still translates.
    html += '<article class="mdcw-doc notranslate" translate="no" lang="' + esc(doc.language || 'en') + '">\n' +
      wrapTables(v.body_html) + '\n</article>\n';
    html += '<p class="doc-foot"><a href="' + type.index + '">All ' + esc(type.plural) + ' &#8594;</a>' +
      (opts.pdfUrl ? ' <a href="' + esc(opts.pdfUrl) + '">Download official PDF</a>' : '') + '</p>\n';
    html += '</div>\n</div>\n';

    html += '</div>\n</section>\n';
    return html;
  }

  root.MDCWDocument = {
    TYPES: TYPES,
    esc: esc,
    formatDate: formatDate,
    formatBytes: formatBytes,
    docPath: docPath,
    buildToc: buildToc,
    renderDocumentMain: renderDocumentMain
  };
})(typeof window !== 'undefined' ? window : this);
