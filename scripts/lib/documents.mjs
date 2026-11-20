// Markup for the document library: index rows, "latest" cards, and the
// options each document page is rendered with.
//
// The document page itself comes from js/document-view.js (shared with the
// staff preview). This file is the build-only part: lists, links between a
// meeting's two documents, and the archive cut-off for the old tracker.

import { createRequire } from 'node:module';
import { SITE_ORIGIN, escapeHtml as esc, formatDate, formatDateShort } from './fmt.mjs';

const require = createRequire(import.meta.url);
const { sanitizeDocumentHtml, publicPdfPath } = require('../../api/_document-lib.js');

// The Meeting Tracker stops here. Keep in step with TRACKER_ARCHIVE_THROUGH
// in js/admin.js. Deliberately not enforced in the database.
export const TRACKER_ARCHIVE_THROUGH = '2026-10-31';
export const TRACKER_ARCHIVE_LABEL = 'Meeting Tracker Archive (through October 2026)';

export const DOC_TYPES = {
  'meeting-summary': {
    label: 'Meeting Summary',
    plural: 'Meeting Summaries',
    index: '/documents/meeting-summaries',
    file: 'documents/meeting-summaries.html',
    blurb: 'Published after each Board meeting: what happened, what passed or failed, and the major news from the meeting.'
  },
  'agenda-summary': {
    label: 'Agenda Summary',
    plural: 'Agenda Summaries',
    index: '/documents/agenda-summaries',
    file: 'documents/agenda-summaries.html',
    blurb: 'Published before each Board meeting: an in-depth guide to the agenda, with backstory, legislative history, fiscal impact and plain-language explanations of each item.'
  }
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Root-relative, on our own domain (see publicPdfPath in api/_document-lib.js).
export function publicPdfUrl(path) {
  return publicPdfPath(path);
}

export function documentPath(doc) {
  return `/documents/${doc.doc_type}/${doc.meeting_date}`;
}

export function documentUrl(doc) {
  return SITE_ORIGIN + documentPath(doc);
}

// English editions get pages. Other languages hang off them as extra PDF
// downloads until they have pages of their own.
export function pageDocuments(docs) {
  return docs.filter((d) => d.language === 'en');
}

// Defense in depth: the HTML was sanitized when it was uploaded, and the
// guard trigger only lets the server write it. Cleaning it again here costs
// milliseconds and means a row edited by some future path still cannot put a
// script on the public site.
export function cleanBodies(docs) {
  for (const d of docs) {
    if (d.current) d.current.body_html = sanitizeDocumentHtml(d.current.body_html).html;
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Everything the search box matches: title, summary, number, items (with and
// without spaces, so "11 A5" and "11a5" both work), keywords and the date in
// the forms people type it.
function searchText(doc) {
  const items = doc.item_numbers || [];
  return [
    doc.title, doc.summary, doc.document_number,
    items.join(' '), items.map((i) => i.replace(/\s+/g, '')).join(' '),
    (doc.keywords || []).join(' '),
    formatDate(doc.meeting_date), formatDateShort(doc.meeting_date), doc.meeting_date,
    DOC_TYPES[doc.doc_type].label
  ].join(' ').replace(/\s+/g, ' ').toLowerCase();
}

export function renderDocumentRow(doc) {
  const type = DOC_TYPES[doc.doc_type];
  const v = doc.current;
  const year = doc.meeting_date.slice(0, 4);
  const month = String(Number(doc.meeting_date.slice(5, 7)));
  const pdf = publicPdfUrl(v.public_pdf_path);
  const items = doc.item_numbers || [];
  const meta = [
    `<span class="doc-no notranslate">${esc(doc.document_number)}</span>`,
    v.page_count ? `<span>${esc(plural(Number(v.page_count), 'page'))}</span>` : '',
    `<span>Version ${esc(v.version)}</span>`
  ].filter(Boolean).join('<span class="doc-row-sep" aria-hidden="true">&middot;</span>');

  return `<article class="doc-row" data-doc="1" data-year="${year}" data-month="${month}" data-search="${esc(searchText(doc))}">` +
    `<div class="doc-row-date"><span class="doc-row-type">${esc(type.label)}</span>` +
    `<time datetime="${esc(doc.meeting_date)}">${esc(formatDate(doc.meeting_date))}</time></div>` +
    `<div class="doc-row-main">` +
    `<h3><a href="${esc(documentPath(doc))}">${esc(doc.title)}</a></h3>` +
    `<p>${esc(doc.summary)}</p>` +
    `<div class="doc-row-meta">${meta}</div>` +
    (items.length ? `<div class="doc-row-items"><span>Items:</span> <span class="notranslate">${esc(items.join(', '))}</span></div>` : '') +
    `</div>` +
    `<div class="doc-row-actions">` +
    (pdf ? `<a class="btn doc-download btn-small" href="${esc(pdf)}">Download PDF</a>` : '') +
    `<a class="doc-row-read" href="${esc(documentPath(doc))}">Read online</a>` +
    `</div>` +
    `</article>`;
}

export function renderDocumentList(docs, docType) {
  const rows = pageDocuments(docs).filter((d) => d.doc_type === docType);
  if (!rows.length) {
    return `<p class="doc-empty" data-doc-empty-initial>No ${esc(DOC_TYPES[docType].plural)} have been published yet. ` +
      `The first will appear here, newest first.</p>`;
  }
  return rows.map(renderDocumentRow).join('\n');
}

// Year and month choices for the filter, from the documents that exist, so
// nobody picks a month with nothing in it.
export function renderFilterOptions(docs, docType) {
  const rows = pageDocuments(docs).filter((d) => d.doc_type === docType);
  const years = Array.from(new Set(rows.map((d) => d.meeting_date.slice(0, 4)))).sort().reverse();
  const yearOptions = ['<option value="">All years</option>']
    .concat(years.map((y) => `<option value="${y}">${y}</option>`)).join('');
  const monthOptions = ['<option value="">All months</option>']
    .concat(MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`)).join('');
  return { yearOptions, monthOptions };
}

// The newest document of a type, as a card. Used on /documents and the
// homepage.
export function renderLatestCard(docs, docType, { headingLevel = 3 } = {}) {
  const type = DOC_TYPES[docType];
  const doc = pageDocuments(docs).find((d) => d.doc_type === docType);
  const h = `h${headingLevel}`;
  if (!doc) {
    return `<div class="doc-latest doc-latest-empty">` +
      `<span class="doc-latest-type">Latest ${esc(type.label)}</span>` +
      `<p>None published yet. ${esc(type.blurb)}</p>` +
      `<a class="doc-latest-all" href="${type.index}">${esc(type.plural)} &#8594;</a></div>`;
  }
  const pdf = publicPdfUrl(doc.current.public_pdf_path);
  return `<div class="doc-latest">` +
    `<span class="doc-latest-type">Latest ${esc(type.label)} &middot; ${esc(formatDate(doc.meeting_date))}</span>` +
    `<${h}><a href="${esc(documentPath(doc))}">${esc(doc.title)}</a></${h}>` +
    `<p>${esc(doc.summary)}</p>` +
    `<div class="doc-latest-actions">` +
    `<a class="btn btn-primary btn-small" href="${esc(documentPath(doc))}">Read online</a>` +
    (pdf ? `<a class="btn btn-secondary btn-small" href="${esc(pdf)}">Download PDF</a>` : '') +
    `<a class="doc-latest-all" href="${type.index}">All ${esc(type.plural)} &#8594;</a>` +
    `</div></div>`;
}

// ---------------------------------------------------------------------
// Meeting schedule
// ---------------------------------------------------------------------

// Today in Miami, not on the build machine (Vercel builds in UTC, which is
// already tomorrow by 8 p.m. Eastern).
export function todayInMiami() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// "09:30:00" -> "9:30 AM"
export function formatTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// "Tuesday, October 20, 2026 · 9:30 AM", the same wording js/home.js uses.
export function meetingWhen(row) {
  const time = formatTime(row.start_time);
  return `${weekday(row.meeting_date)}, ${formatDate(row.meeting_date)}${time ? ' &middot; ' + esc(time) : ''}`;
}

export function upcomingMeetings(schedule, today) {
  return schedule.filter((r) => r.meeting_date >= today);
}

// The homepage hero line. js/home.js refreshes it from the same table in the
// browser, so it moves on to the next date the day after a meeting even if
// nothing has been rebuilt.
// With nothing left on the schedule, the line says when to expect the next
// one. js/home.js has the same wording in noMeetingText().
export function noMeetingText(today) {
  const year = Number(String(today).slice(0, 4));
  const month = Number(String(today).slice(5, 7));
  // The county posts the next year's calendar late in the year, so an empty
  // schedule in November or December means the year's meetings are done.
  if (month >= 11) return `No more meetings in ${year}. Next meeting: January ${year + 1}, date TBA.`;
  return 'Next meeting: date TBA.';
}

// With no date posted, the card still points students to the interest form
// on /attend (#meeting-interest), which texts them when sign-ups open.
// js/home.js has the same markup in noMeetingButton().
export function noMeetingButton(today) {
  const year = Number(String(today).slice(0, 4));
  const month = Number(String(today).slice(5, 7));
  const label = month >= 11 ? `Get notified about ${year + 1} meetings` : 'Get notified about upcoming meetings';
  return `<a class="btn btn-primary next-meeting-btn" href="/attend#meeting-interest">${esc(label)}</a>`;
}

export function renderNextMeeting(schedule, today) {
  const next = upcomingMeetings(schedule, today).find((r) => !r.cancelled);
  if (!next) {
    return `<div class="label">Next BCC meeting</div><div class="date">${esc(noMeetingText(today))}</div>${noMeetingButton(today)}`;
  }
  const type = next.meeting_type && next.meeting_type !== 'Regular Meeting' ? ` (${esc(next.meeting_type)})` : '';
  return `<div class="label">Next BCC meeting${type}</div><div class="date">${meetingWhen(next)}</div>`;
}

// The list on /documents. Each card carries data-hide-after, so js/main.js
// drops it the day after the meeting without waiting for a rebuild. A
// meeting whose Agenda Summary is out links to it.
export function renderUpcomingList(schedule, docs, today) {
  const rows = upcomingMeetings(schedule, today);
  if (!rows.length) {
    return '<p class="doc-empty">No upcoming meetings are posted yet. See the county\'s ' +
      '<a href="https://www.miamidade.gov/resources/commission/documents/2026-bcc-calendar.pdf" target="_blank" rel="noopener">meeting calendar (PDF)</a>.</p>';
  }
  return rows.map((r) => {
    const agenda = pageDocuments(docs).find((d) => d.doc_type === 'agenda-summary' && d.meeting_date === r.meeting_date);
    const bits = [];
    if (r.cancelled) bits.push('<span class="schedule-cancelled">Cancelled</span>');
    if (r.location && !r.cancelled) bits.push(`<span>${esc(r.location)}</span>`);
    if (r.note) bits.push(`<span>${esc(r.note)}</span>`);
    if (agenda && !r.cancelled) bits.push(`<a href="${esc(documentPath(agenda))}">Read the Agenda Summary &#8594;</a>`);
    return `<div class="meeting-card schedule-card" data-hide-after="${esc(r.meeting_date)}">` +
      `<div class="meeting-card-date">${esc(r.meeting_type)} &middot; ${meetingWhen(r)}</div>` +
      (bits.length ? `<p class="schedule-meta">${bits.join('<span class="doc-row-sep" aria-hidden="true">&middot;</span>')}</p>` : '') +
      `</div>`;
  }).join('\n');
}

// Options for js/document-view.js's renderDocumentMain.
export function pageOptions(doc, allDocs) {
  const v = doc.current;
  const versionsOldestFirst = doc.versions.slice().reverse();
  const companionType = doc.doc_type === 'agenda-summary' ? 'meeting-summary' : 'agenda-summary';
  const companion = allDocs.find((d) => d.language === doc.language &&
    d.doc_type === companionType && d.meeting_date === doc.meeting_date);
  const translations = allDocs
    .filter((d) => d.translation_of === doc.id || (d.language !== 'en' &&
      d.doc_type === doc.doc_type && d.meeting_date === doc.meeting_date))
    .filter((d) => d.current && d.current.public_pdf_path)
    .map((d) => ({ language: d.language, pdfUrl: publicPdfUrl(d.current.public_pdf_path) }));

  return {
    doc: {
      doc_type: doc.doc_type,
      meeting_date: doc.meeting_date,
      language: doc.language,
      title: doc.title,
      summary: doc.summary,
      document_number: doc.document_number
    },
    version: v,
    firstVersion: versionsOldestFirst.length ? versionsOldestFirst[0].version : null,
    history: doc.versions.map((h) => ({
      version: h.version,
      issued_on: h.issued_on,
      change_note: h.change_note,
      pdfUrl: publicPdfUrl(h.public_pdf_path)
    })),
    pdfUrl: publicPdfUrl(v.public_pdf_path),
    companion: companion ? { href: documentPath(companion), title: companion.title } : null,
    translations,
    preview: false
  };
}

export function documentTitle(doc) {
  return `${DOC_TYPES[doc.doc_type].label}, BCC Meeting of ${formatDate(doc.meeting_date)}: ${doc.title}`;
}
