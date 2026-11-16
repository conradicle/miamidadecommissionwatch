// Server-side twin of the render functions in js/meetings-feed.js,
// js/editorials-feed.js and js/municipalities.js.
//
// The markup here is deliberately identical to what those files build in the
// browser, down to the attribute order, because the same filter code in
// meetings-feed.js has to walk both. js/meetings.html's filter indexes the DOM
// rather than the query result, so a prerendered card that carries different
// data-* attributes than a client-rendered one would silently drop out of
// every filter.

import { escapeHtml as esc, safeHref, formatDate, formatMoney, clip } from './fmt.mjs';

// ---------------------------------------------------------------------
// Per-meeting URLs
// ---------------------------------------------------------------------

function slugifyType(type) {
  return String(type || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'meeting';
}

// One page per meeting, addressed by date. Two meetings can legitimately share
// a date (a regular meeting and a budget hearing often do), so a collision
// falls back to date + meeting type rather than letting one page overwrite the
// other on disk.
export function assignMeetingPaths(meetings) {
  const byDate = new Map();
  for (const m of meetings) {
    const d = m.meeting_date || 'undated';
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(m);
  }

  for (const [date, group] of byDate) {
    for (const m of group) {
      m.__slug = group.length === 1 ? date : `${date}-${slugifyType(m.meeting_type)}`;
      m.__path = `/meetings/${m.__slug}.html`;
      m.__url = `https://www.miamidadecommissionwatch.com${m.__path}`;
    }
    // A date whose meetings share a type too would still collide. Disambiguate
    // by position so the build can never drop a meeting on the floor.
    const seen = new Set();
    for (const m of group) {
      let slug = m.__slug;
      let n = 2;
      while (seen.has(slug)) slug = `${m.__slug}-${n++}`;
      seen.add(slug);
      m.__slug = slug;
      m.__path = `/meetings/${slug}.html`;
      m.__url = `https://www.miamidadecommissionwatch.com${m.__path}`;
    }
  }
  return meetings;
}

// The freshest timestamp anywhere in the meeting, for <lastmod>. Items carry
// updated_at; the meeting row itself only has created_at.
export function meetingTouchedAt(meeting) {
  const stamps = [meeting.created_at];
  for (const it of meeting.meeting_items || []) {
    stamps.push(it.updated_at, it.published_at);
  }
  const usable = stamps.filter(Boolean).sort();
  return usable.length ? usable[usable.length - 1] : null;
}

// ---------------------------------------------------------------------
// Meeting items -- ports of js/meetings-feed.js
// ---------------------------------------------------------------------

function recordLine(item) {
  const bits = [];

  if (item.item_code) bits.push('<span class="item-code">' + esc(item.item_code) + '</span>');
  if (item.legislation_number) bits.push('<span class="rec-leg">' + esc(item.legislation_number) + '</span>');
  if (item.legislation_type) bits.push('<span>' + esc(item.legislation_type) + '</span>');

  const money = item.amount_usd ? formatMoney(item.amount_usd) : '';
  if (money) bits.push('<span class="rec-amount">' + esc(money) + '</span>');
  if (item.sponsor) bits.push('<span>Sponsored by ' + esc(item.sponsor) + '</span>');

  const tally = voteTally(item);
  if (tally) bits.push('<span>' + esc(tally) + '</span>');

  if (!bits.length && !item.topic && !(item.districts && item.districts.length)) return '';

  let html = bits.join('<span class="sep">&middot;</span>');

  if (item.topic) {
    html += (html ? '<span class="sep">&middot;</span>' : '') +
      '<span class="rec-topic">' + esc(item.topic) + '</span>';
  }
  if (item.districts && item.districts.length) {
    html += '<span class="rec-district">D' +
      item.districts.map((d) => esc(String(d))).join(', D') + '</span>';
  } else if (item.topic || bits.length) {
    html += '<span class="rec-district">Countywide</span>';
  }

  return '<div class="item-record">' + html + '</div>';
}

function voteTally(item) {
  let yes = item.vote_yes;
  let no = item.vote_no;

  if (typeof yes !== 'number' && item.item_votes && item.item_votes.length) {
    yes = item.item_votes.filter((v) => v.vote === 'yes').length;
    no = item.item_votes.filter((v) => v.vote === 'no').length;
  }
  if (typeof yes !== 'number' || typeof no !== 'number') return '';

  const verb = item.tag_status === 'failed' ? 'Failed'
    : item.tag_status === 'deferred' ? 'Deferred' : 'Passed';
  return verb + ' ' + yes + '–' + no;
}

function sourcesBlock(item) {
  const out = [];
  const officialLinks = [];

  [
    { url: item.official_url, label: item.official_label || 'County legislative record' },
    { url: item.agenda_document_url, label: 'Agenda document' },
    { url: item.vote_record_url, label: 'Vote record' }
  ].forEach((s) => {
    if (!s.url) return;
    const href = safeHref(s.url);
    if (!href) return;
    officialLinks.push('<li><a href="' + esc(href) + '" target="_blank" rel="noopener">' +
      esc(s.label) + ' &#8599;</a></li>');
  });

  if (officialLinks.length) {
    out.push('<div class="source-group official"><span class="label">Official record</span>' +
      '<ul class="source-list">' + officialLinks.join('') + '</ul></div>');
  } else {
    out.push('<div class="source-group official"><span class="label">Official record</span>' +
      '<p class="source-missing" style="margin:0;">Primary county record not yet linked for this item.</p></div>');
  }

  let extra = (item.item_sources || []).slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((s) => {
      const href = safeHref(s.url);
      if (!href) return '';
      return '<li><span class="outlet">' + esc(s.outlet) + '</span>' +
        '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(s.label) + ' &#8599;</a></li>';
    })
    .filter(Boolean);

  if (!extra.length && item.source_url) {
    const legacyHref = safeHref(item.source_url);
    if (legacyHref) {
      extra.push('<li><a href="' + esc(legacyHref) + '" target="_blank" rel="noopener">' +
        esc(item.source_label || 'Source') + ' &#8599;</a></li>');
    }
  }

  if (extra.length) {
    out.push('<div class="source-group"><span class="label">Additional reporting</span>' +
      '<ul class="source-list">' + extra.join('') + '</ul></div>');
  }

  return '<div class="sources">' + out.join('') + '</div>';
}

function rollCallBlock(item, idx) {
  const votes = item.item_votes || [];
  if (!votes.length) return '';

  const id = 'rollcall-' + idx;
  const rows = votes.slice()
    .sort((a, b) => {
      const da = a.commissioners ? a.commissioners.district : 99;
      const db = b.commissioners ? b.commissioners.district : 99;
      return da - db;
    })
    .map((v) => {
      const c = v.commissioners || {};
      return '<div class="rollcall-row">' +
        '<span class="rc-name"><span class="rc-district">D' + esc(String(c.district || '?')) + '</span>' +
        esc(c.full_name || 'Unknown') + '</span>' +
        '<span class="rc-vote ' + esc(v.vote) + '">' + esc(v.vote) + '</span>' +
        '</div>';
    });

  return '<button type="button" class="rollcall-toggle" aria-expanded="false" aria-controls="' + id + '">' +
    'Show roll call (' + votes.length + ')</button>' +
    '<div class="rollcall" id="' + id + '" hidden>' + rows.join('') + '</div>';
}

function renderItem(item, meeting, idx) {
  const tagHtml = item.tag_type === 'outcome'
    ? '<span class="outcome ' + esc(item.tag_status || 'passed') + '">' + esc(item.tag_label) + '</span>'
    : '<span class="item-code">' + esc(item.tag_label) + '</span>';

  const attrs = [
    'class="item-block"',
    'data-item="1"',
    'data-date="' + esc(meeting.meeting_date || '') + '"',
    'data-status="' + esc(item.tag_status || '') + '"',
    'data-topic="' + esc(item.topic || '') + '"',
    'data-districts="' + esc((item.districts || []).join(',')) + '"',
    'data-commissioners="' + esc((item.item_votes || [])
      .map((v) => (v.commissioners ? v.commissioners.slug : ''))
      .filter(Boolean).join(',')) + '"'
  ];

  return '<div ' + attrs.join(' ') + '>' +
    recordLine(item) +
    '<div class="item-head">' + tagHtml + '</div>' +
    '<h4 style="margin-bottom:6px;">' + esc(item.heading) + '</h4>' +
    '<p style="color:var(--ink-600); margin-bottom:0;">' + esc(item.description) + '</p>' +
    '<div class="why-matters"><span class="label">Why it matters</span>' + esc(item.why_it_matters) + '</div>' +
    sourcesBlock(item) +
    rollCallBlock(item, idx) +
    '</div>';
}

// The card as it appears in the tracker list on meetings.html. `linkTitle`
// turns the heading into a link to the meeting's own page; the meeting page
// itself renders the same card with the heading plain, since linking a page
// to itself helps nobody.
export function renderMeetingCard(meeting, counter, { linkTitle = true } = {}) {
  const items = meeting.meeting_items || [];

  const heading = linkTitle
    ? '<h3><a class="meeting-card-link" href="' + esc(meeting.__path) + '">' + esc(meeting.title) + '</a></h3>'
    : '<h3>' + esc(meeting.title) + '</h3>';

  const permalink = linkTitle
    ? '<p class="meeting-card-more"><a href="' + esc(meeting.__path) + '">Full recap: ' +
      esc(formatDate(meeting.meeting_date)) + ' &#8594;</a></p>'
    : '';

  return '<div class="meeting-card" data-meeting="1" data-date="' + esc(meeting.meeting_date || '') + '">' +
    '<div class="meeting-card-date">' + esc(meeting.meeting_type) + ' &middot; ' +
      esc(formatDate(meeting.meeting_date)) + '</div>' +
    heading +
    '<p class="meeting-card-summary">' + esc(meeting.summary) + '</p>' +
    items.map((it) => renderItem(it, meeting, counter.next())).join('') +
    permalink +
    '</div>';
}

// The items alone, for a meeting's own page. That page puts the meeting title
// in the <h1> and the summary in the lede, so rendering the whole card there
// too would print both twice.
export function renderItems(meeting, counter) {
  return (meeting.meeting_items || [])
    .map((it) => renderItem(it, meeting, counter.next()))
    .join('');
}

export function makeCounter() {
  let n = 0;
  return { next: () => n++ };
}

export function renderMeetingList(meetings) {
  const counter = makeCounter();
  return meetings.map((m) => renderMeetingCard(m, counter, { linkTitle: true })).join('\n');
}

// ---------------------------------------------------------------------
// Editorials -- port of js/editorials-feed.js
// ---------------------------------------------------------------------

function editorialDate(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// Same slug rules as the browser, including the used-slug counter, so
// news.html#ed-my-title keeps pointing at the same card after prerendering.
export function makeEditorialSlugger() {
  const used = Object.create(null);
  return function slugify(title) {
    let base = String(title == null ? '' : title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '');
    if (!base) base = 'editorial';
    let slug = base;
    let n = 2;
    while (used[slug]) slug = base + '-' + n++;
    used[slug] = true;
    return 'ed-' + slug;
  };
}

// row.byline arrives already reduced by public_byline() in the database.
export function renderEditorials(rows) {
  const slugify = makeEditorialSlugger();
  return rows.map((row) => {
    const id = slugify(row.title);
    const bodyId = id + '-body';
    return '<article class="editorial-card" id="' + esc(id) + '" data-date="' + esc(row.submitted_at) + '">' +
      '<div class="editorial-meta">Editorial <span aria-hidden="true">·</span> <time datetime="' + esc(row.submitted_at) + '">' + esc(editorialDate(row.submitted_at)) + '</time></div>' +
      '<h2><a href="#' + esc(id) + '">' + esc(row.title) + '</a></h2>' +
      '<p class="editorial-byline">By ' + esc(row.byline) + '</p>' +
      '<p class="editorial-excerpt">' + esc(String(row.body || '').trim().slice(0, 420)) + '</p>' +
      '<details class="editorial-reading"><summary>Read editorial <span aria-hidden="true">→</span></summary>' +
      '<p class="editorial-body" id="' + esc(bodyId) + '">' + esc(row.body) + '</p></details></article>';
  }).join('\n');
}

// ---------------------------------------------------------------------
// Municipalities -- port of js/municipalities.js
// ---------------------------------------------------------------------

// The page has two lists: covered cities as cards linking to their own site,
// and every other city in a quieter grid with a link into the claim form
// further down the page. The three pieces come back separately because they
// sit in different places in get-involved.html. The count uses every row
// anon can read, so it moves on its own as cities are claimed or added.
const CITY_STATUS = {
  pending: { label: 'requested', className: 'tag-pending' },
  suspended: { label: 'paused', className: 'tag-suspended' }
};

function citySiteUrl(slug) {
  return 'https://' + encodeURIComponent(slug) + '.miamidadecommissionwatch.com/';
}

export function renderMunicipalities(cities) {
  const covered = cities.filter((c) => c.status === 'active');
  const open = cities.filter((c) => c.status !== 'active');

  const coveredHtml = covered.length
    ? covered.map((c) =>
        '<li><a class="card muni-card" href="' + citySiteUrl(c.slug) + '" target="_blank" rel="noopener">' +
          '<h4>' + esc(c.name) + '</h4>' +
          '<p>Read our ' + esc(c.name) + ' coverage</p>' +
          '<span class="muni-card-url mono">' + esc(c.slug) + '.miamidadecommissionwatch.com</span>' +
        '</a></li>'
      ).join('')
    : '<li class="muni-empty">No city has a team yet.</li>';

  const countHtml = covered.length + ' of ' + cities.length + ' cities covered';

  const openHtml = open.map((c) => {
    const name = '<span class="muni-name">' + esc(c.name) + '</span>';
    if (c.status === 'unclaimed') {
      return '<li class="muni">' + name +
        '<a class="muni-claim" href="#request" data-claim="' + esc(c.slug) + '">' +
        'Apply to cover this city<span class="sr-only">: ' + esc(c.name) + '</span></a></li>';
    }
    const meta = CITY_STATUS[c.status] || CITY_STATUS.pending;
    return '<li class="muni">' + name +
      '<span class="muni-tag ' + meta.className + '">' + meta.label + '</span></li>';
  }).join('');

  return { covered: coveredHtml, count: countHtml, open: openHtml };
}

// ---------------------------------------------------------------------
// Team roster
// ---------------------------------------------------------------------

// Initials for the monogram shown when a member has no photo. Requiring a
// headshot before someone can be listed makes every addition wait on a photo
// nobody has yet, so the fallback is the default path, not the error path.
function initials(displayName) {
  const tokens = String(displayName).split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const first = tokens[0][0] || '';
  const last = tokens.length > 1 ? tokens[tokens.length - 1][0] || '' : '';
  return (first + last).toUpperCase().replace(/[^A-Z\u00C0-\u024F]/g, '');
}

// `byline` is js/public-byline.js, the one copy of how a minor's name may
// appear publicly. Running every roster name through it means a full name
// pasted into contributors.json still reaches the page as "First L." -- the
// same guarantee the editorials already get, enforced in one place.
export function renderTeam(teams, byline) {
  return teams.map((team) => {
    const members = team.members.map((member) => {
      const name = byline(member.name);
      const face = member.photo
        ? '<img class="team-avatar" src="' + esc(member.photo) + '" alt="" loading="lazy">'
        : '<span class="team-avatar team-avatar-monogram" aria-hidden="true">' + esc(initials(name)) + '</span>';
      const bio = member.bio
        ? '<p class="team-bio">' + esc(member.bio) + '</p>'
        : '';

      return '<li class="team-member">' + face +
        '<div class="team-member-text">' +
          '<span class="team-name">' + esc(name) + '</span>' +
          '<span class="team-role">' + esc(member.role) + '</span>' +
          bio +
        '</div>' +
      '</li>';
    }).join('');

    const blurb = team.blurb ? '<p class="team-group-blurb">' + esc(team.blurb) + '</p>' : '';
    // A team's size and the members named on the page are different numbers on
    // purpose: appearing here is opt-in, and most of the roster are minors. An
    // unnamed member still counts toward the team, so `size` wins when it is set.
    const count = typeof team.size === 'number' ? team.size : team.members.length;
    // "1 person" next to a heading that already names one role is noise, so a
    // single-member group wears no count.
    const size = count > 1
      ? '<span class="team-group-count">' + count + ' people</span>'
      : '';

    return '<div class="team-group">' +
      '<h3 class="team-group-name">' + esc(team.name) + size + '</h3>' +
      blurb +
      '<ul class="team-grid">' + members + '</ul>' +
    '</div>';
  }).join('');
}

export { esc, clip };
