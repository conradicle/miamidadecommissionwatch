// Shared rules for official documents (Meeting Summaries, Agenda Summaries).
//
// One copy, used in three places: api/_documents.js checks uploads with it,
// scripts/build.mjs re-sanitizes stored HTML with it before prerendering, and
// scripts/build-doc.mjs runs the same document-number and PDF checks locally
// so a mistake shows up before the upload rather than after it. The leading
// underscore keeps it out of Vercel's function count, like the other helpers.
var zlib = require('zlib');
var sanitizeHtml = require('sanitize-html');

// ---------------------------------------------------------------------
// Types, languages, numbering
// ---------------------------------------------------------------------

var DOC_TYPES = {
  'meeting-summary': { code: 'MS', label: 'Meeting Summary', plural: 'Meeting Summaries' },
  'agenda-summary': { code: 'AS', label: 'Agenda Summary', plural: 'Agenda Summaries' }
};

// Documents are English today. The table already keys on language so a
// Spanish or Haitian Creole edition can be attached to the same meeting later
// without a schema change.
var LANGUAGES = { en: 'English', es: 'Spanish', ht: 'Haitian Creole' };

// 30 MB. A 60-page WeasyPrint PDF with the seal, watermark and two embedded
// font families comes out around 1 to 3 MB, so this is ten times headroom and
// still small enough that a wrong file (a scan, a video) is refused. Keep in
// step with file_size_limit on the document-uploads bucket in migration_27.
var MAX_PDF_BYTES = 30 * 1024 * 1024;

// The HTML travels in a JSON body, and Vercel caps request bodies at 4.5 MB.
var MAX_HTML_BYTES = 3 * 1024 * 1024;

// Published PDFs live in the public `documents` bucket but are always linked
// through our own domain: vercel.json rewrites /documents/files/* to the
// bucket, so no reader ever sees a Supabase address. Keep the prefix in step
// with that rewrite (and with the copies in js/admin-documents.js and
// js/document-preview.js, which cannot require this file).
var PDF_URL_PREFIX = '/documents/files/';

function publicPdfPath(storagePath) {
  if (!storagePath) return null;
  return PDF_URL_PREFIX + String(storagePath).split('/').map(encodeURIComponent).join('/');
}

function isDocType(value) {
  return Object.prototype.hasOwnProperty.call(DOC_TYPES, value);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  var d = new Date(value + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// MDCW-AS-2026-1020 for the Agenda Summary of the October 20, 2026 meeting.
// A translated edition may add its language: MDCW-AS-2026-1020-ES.
function expectedDocumentNumber(docType, meetingDate, language) {
  if (!isDocType(docType) || !isIsoDate(meetingDate)) return null;
  var base = 'MDCW-' + DOC_TYPES[docType].code + '-' + meetingDate.slice(0, 4) + '-' +
    meetingDate.slice(5, 7) + meetingDate.slice(8, 10);
  return language && language !== 'en' ? base + '-' + language.toUpperCase() : base;
}

// Returns null when the number fits the type and date, or a sentence saying
// what is wrong.
function checkDocumentNumber(number, docType, meetingDate, language) {
  var expected = expectedDocumentNumber(docType, meetingDate, language || 'en');
  if (!expected) return 'Choose a document type and a valid meeting date first.';
  if (String(number || '').trim().toUpperCase() !== expected) {
    return 'The document number for this type and meeting date should be ' + expected + '.';
  }
  return null;
}

// Versions are major.minor. A correction bumps the minor number: 1.0, 1.1, 1.2.
function parseVersion(value) {
  var m = /^(\d{1,3})\.(\d{1,3})$/.exec(String(value || '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

function compareVersions(a, b) {
  var pa = parseVersion(a);
  var pb = parseVersion(b);
  if (!pa || !pb) return 0;
  return pa.major - pb.major || pa.minor - pb.minor;
}

function nextVersion(existing) {
  var highest = null;
  (existing || []).forEach(function (v) {
    if (parseVersion(v) && (!highest || compareVersions(v, highest) > 0)) highest = v;
  });
  if (!highest) return '1.0';
  var p = parseVersion(highest);
  return p.major + '.' + (p.minor + 1);
}

// "11A5, 8O1 + 8N2" -> ['11A5', '8O1', '8N2']. Upper-cased so a search for
// 11a5 matches.
function splitList(value, upper) {
  var parts = Array.isArray(value) ? value : String(value || '').split(/[,;\n+]/);
  var seen = {};
  var out = [];
  parts.forEach(function (raw) {
    var v = String(raw || '').replace(/\s+/g, ' ').trim();
    if (upper) v = v.toUpperCase().replace(/\s+/g, '');
    if (!v || v.length > 80 || seen[v.toLowerCase()]) return;
    seen[v.toLowerCase()] = true;
    out.push(v);
  });
  return out.slice(0, 200);
}

// ---------------------------------------------------------------------
// Reading the template's own metadata
// ---------------------------------------------------------------------

function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function metaContent(html, name) {
  var re = new RegExp('<meta\\s+name="' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '"\\s+content="([^"]*)"', 'i');
  var m = re.exec(html);
  return m ? decodeEntities(m[1]).trim() : '';
}

// The templates carry <meta name="mdcw:..."> tags. The dashboard prefills the
// form from them and the server cross-checks the document number, so the
// wrong file cannot go up under the right title.
function readDocumentMeta(html) {
  var title = /<title>([\s\S]*?)<\/title>/i.exec(html || '');
  return {
    title: title ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() : '',
    summary: metaContent(html, 'description'),
    docType: metaContent(html, 'mdcw:doc-type'),
    meetingDate: metaContent(html, 'mdcw:meeting-date'),
    documentNumber: metaContent(html, 'mdcw:document-number'),
    version: metaContent(html, 'mdcw:version'),
    issued: metaContent(html, 'mdcw:issued'),
    items: splitList(metaContent(html, 'mdcw:items'), true),
    keywords: splitList(metaContent(html, 'mdcw:keywords'), false)
  };
}

// ---------------------------------------------------------------------
// PDF checks
// ---------------------------------------------------------------------

// Names that make a PDF do something when opened: run script, launch a
// program, carry another file inside it. WeasyPrint never writes any of them,
// so a PDF that has one did not come from our template.
var ACTIVE_PDF_NAMES = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA)\b/;

// The PDF's object dictionaries as text. Newer WeasyPrint (and most other
// writers) pack dictionaries into compressed object streams, where a plain
// text search sees nothing, so those are inflated and appended. Content
// streams (the drawn page) are not object streams and are left alone.
function pdfObjectText(buffer) {
  var text = buffer.toString('latin1');
  var parts = [text];
  var re = /\/Type\s*\/ObjStm\b[\s\S]*?stream\r?\n/g;
  var m;
  while ((m = re.exec(text))) {
    var start = m.index + m[0].length;
    var end = text.indexOf('endstream', start);
    if (end === -1) break;
    try {
      parts.push(zlib.inflateSync(buffer.slice(start, end)).toString('latin1'));
    } catch (e) {
      // Not Flate, or damaged. The plain-text search still runs.
    }
    re.lastIndex = end;
  }
  return parts.join('\n');
}

function checkPdf(buffer) {
  if (!buffer || !buffer.length) return 'The PDF is empty.';
  if (buffer.length > MAX_PDF_BYTES) {
    return 'The PDF is ' + Math.round(buffer.length / 1048576) + ' MB; the limit is ' +
      Math.round(MAX_PDF_BYTES / 1048576) + ' MB.';
  }
  if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
    return 'That file is not a PDF (it does not start with the PDF signature).';
  }
  if (buffer.slice(Math.max(0, buffer.length - 2048)).toString('latin1').indexOf('%%EOF') === -1) {
    return 'The PDF looks incomplete (no end-of-file marker). Try building it again.';
  }
  if (ACTIVE_PDF_NAMES.test(pdfObjectText(buffer))) {
    return 'The PDF contains scripts, attachments or other active content. Build it from the template with npm run build-doc.';
  }
  return null;
}

// Page count: every page is one dictionary with /Type /Page (the tree nodes
// above them say /Pages). Counted over the inflated object streams too, since
// that is where WeasyPrint 60+ puts them. null when nothing matches, and the
// upload form asks for the count instead.
function countPdfPages(buffer) {
  var pages = pdfObjectText(buffer).match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return pages && pages.length ? pages.length : null;
}

// ---------------------------------------------------------------------
// HTML sanitizing
// ---------------------------------------------------------------------

// Template images that have a web copy in /assets/img/documents/. Anything
// else, and every absolute or data: URL, is dropped: the page must not load
// a third-party image or carry a tracking pixel inside a document.
var WEB_IMAGES = { 'seal.png': true, 'seal-header.png': true };

var ALLOWED_TAGS = [
  'section', 'article', 'header', 'footer', 'aside', 'nav', 'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'figure', 'figcaption', 'blockquote', 'q', 'cite',
  'b', 'strong', 'i', 'em', 'u', 'small', 'sub', 'sup', 'abbr', 'mark', 'time', 'code', 'pre',
  'details', 'summary'
];

var CSS_LENGTH = /^-?\d*\.?\d+(pt|px|em|rem|%|in|mm|cm)?$/;

// Prefix every id so a document heading called "main" cannot collide with
// the site's own #main, and keep in-document links pointing at the prefixed
// ids. Idempotent: the build re-sanitizes stored HTML, and a second pass must
// not produce doc-doc-.
var ID_PREFIX = 'doc-';
function prefixId(id) {
  var clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!clean) return '';
  return clean.indexOf(ID_PREFIX) === 0 ? clean : ID_PREFIX + clean;
}

// Headings that arrived without an id were numbered during sanitizing
// (doc-section-1, -2, ...). Those numbers shift when a correction adds a
// section, which would break links people have shared, so they are renamed
// from the heading's own text: "Fiscal impact" becomes doc-fiscal-impact.
// Duplicates get -2, -3. Ids the author wrote are left alone.
function nameHeadings(html) {
  var used = {};
  html.replace(/\bid="([^"]+)"/g, function (m, id) { used[id] = true; return m; });
  return html.replace(/<h([23])([^>]*?)\bid="doc-section-\d+"([^>]*)>([\s\S]*?)<\/h\1>/g,
    function (m, level, before, after, inner) {
      var slug = inner.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'section';
      var id = ID_PREFIX + slug;
      var n = 2;
      while (used[id]) id = ID_PREFIX + slug + '-' + (n++);
      used[id] = true;
      return '<h' + level + before + 'id="' + id + '"' + after + '>' + inner + '</h' + level + '>';
    });
}

function bodyOf(html) {
  var m = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

// Returns { html, headingCount, textLength }. Scripts, styles, event
// handlers, forms, frames, embeds, SVG and external images are removed; links
// keep only http(s), mailto and in-page anchors. Every h2 and h3 leaves with
// an id, so the web table of contents can always link to it.
function sanitizeDocumentHtml(input) {
  var source = String(input || '');
  var sectionCounter = 0;
  var headingCount = 0;

  var html = sanitizeHtml(bodyOf(source), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'title', 'lang', 'dir'],
      a: ['href', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      col: ['span'],
      ol: ['start', 'type'],
      li: ['value'],
      time: ['datetime']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'margin-top': [CSS_LENGTH], 'margin-bottom': [CSS_LENGTH],
        'padding-top': [CSS_LENGTH], 'padding-bottom': [CSS_LENGTH],
        width: [CSS_LENGTH], 'font-size': [CSS_LENGTH],
        'text-align': [/^(left|right|center|justify)$/],
        'font-style': [/^(normal|italic)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'white-space': [/^(normal|nowrap)$/]
      }
    },
    // Dropped along with everything inside them, not just unwrapped.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object',
      'embed', 'svg', 'math', 'template', 'video', 'audio', 'canvas', 'form', 'head', 'title'],
    transformTags: {
      '*': function (tagName, attribs) {
        if (attribs.id) {
          var id = prefixId(attribs.id);
          if (id) attribs.id = id; else delete attribs.id;
        }
        // The web page has its own h1 (the document's title). The template's
        // h1 ("Agenda Summary" on the cover) keeps its look as a styled div.
        if (tagName === 'h1') {
          tagName = 'div';
          attribs['class'] = ((attribs['class'] || '') + ' doc-title').trim();
        }
        if ((tagName === 'h2' || tagName === 'h3') && !attribs.id) {
          sectionCounter += 1;
          attribs.id = ID_PREFIX + 'section-' + sectionCounter;
        }
        if (tagName === 'h2' || tagName === 'h3') headingCount += 1;

        if (tagName === 'a' && attribs.href) {
          var href = String(attribs.href).trim();
          if (href.charAt(0) === '#') {
            attribs.href = '#' + prefixId(href.slice(1));
          } else if (/^https?:\/\//i.test(href)) {
            attribs.rel = 'noopener noreferrer';
          } else if (!/^mailto:/i.test(href)) {
            delete attribs.href;
          }
        }

        if (tagName === 'img') {
          // assets/seal.png as the template writes it, or the web path a
          // first pass already rewrote it to.
          var m = /^(?:(?:\.\.\/|\.\/)*assets\/|\/assets\/img\/documents\/)([A-Za-z0-9._-]+)$/.exec(String(attribs.src || '').trim());
          if (m && WEB_IMAGES[m[1]]) {
            attribs.src = '/assets/img/documents/' + m[1];
          } else {
            attribs.src = '';
          }
          delete attribs.width;
          delete attribs.height;
        }
        return { tagName: tagName, attribs: attribs };
      }
    },
    exclusiveFilter: function (frame) {
      return frame.tag === 'img' && !frame.attribs.src;
    }
  });

  html = nameHeadings(html);
  var text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return { html: html.trim(), headingCount: headingCount, textLength: text.length };
}

module.exports = {
  DOC_TYPES: DOC_TYPES,
  LANGUAGES: LANGUAGES,
  MAX_PDF_BYTES: MAX_PDF_BYTES,
  MAX_HTML_BYTES: MAX_HTML_BYTES,
  PDF_URL_PREFIX: PDF_URL_PREFIX,
  publicPdfPath: publicPdfPath,
  isDocType: isDocType,
  isIsoDate: isIsoDate,
  expectedDocumentNumber: expectedDocumentNumber,
  checkDocumentNumber: checkDocumentNumber,
  parseVersion: parseVersion,
  compareVersions: compareVersions,
  nextVersion: nextVersion,
  splitList: splitList,
  readDocumentMeta: readDocumentMeta,
  checkPdf: checkPdf,
  countPdfPages: countPdfPages,
  sanitizeDocumentHtml: sanitizeDocumentHtml
};
