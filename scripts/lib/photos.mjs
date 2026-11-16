// Meeting photos (migration_34): the /photos gallery, the strip under each
// Meeting Summary, the homepage photo in "Attend with us", and the photos on
// /attend. Rows arrive already filtered to published ones (fetchPhotos).
//
// Every photo is two files: <date>/<uuid>.jpg (long edge 2000px) and
// <date>/<uuid>-thumb.jpg (800px). Grids load the thumbnail and offer the
// full file through srcset; js/photo-viewer.js opens the full file large.

import { SUPABASE_URL } from './data.mjs';
import { escapeHtml as esc, formatDate } from './fmt.mjs';

// PHOTOS_BASE_URL lets a local build serve test images from dist/ (see
// PHOTOS_FIXTURE in data.mjs). Production uses the public bucket.
const BASE = (process.env.PHOTOS_BASE_URL || `${SUPABASE_URL}/storage/v1/object/public/meeting-photos`).replace(/\/$/, '');
const THUMB_EDGE = 800;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function longDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${formatDate(iso)}`;
}

function fullSrc(p) { return `${BASE}/${p.storage_path}`; }
function thumbSrc(p) { return `${BASE}/${p.storage_path.replace(/\.jpg$/, '-thumb.jpg')}`; }

function thumbSize(p) {
  const scale = Math.min(1, THUMB_EDGE / Math.max(p.width, p.height));
  return { w: Math.round(p.width * scale), h: Math.round(p.height * scale) };
}

// Credit is a person's name and may be a student's, so it goes through the
// site's one rule for how a minor's name appears (js/public-byline.js).
function captionText(p, byline) {
  const credit = p.credit ? byline(p.credit) : '';
  return [p.caption || '', credit ? `Photo: ${credit}` : ''].filter(Boolean).join(' · ');
}

function figure(p, byline, { sizes, eager = false, cls = 'photo' } = {}) {
  const t = thumbSize(p);
  const text = captionText(p, byline);
  return `<figure class="${cls}">` +
    `<a class="photo-link" href="${esc(fullSrc(p))}" data-caption="${esc(text)}">` +
    `<img src="${esc(thumbSrc(p))}" srcset="${esc(thumbSrc(p))} ${t.w}w, ${esc(fullSrc(p))} ${p.width}w" ` +
    `sizes="${esc(sizes)}" width="${t.w}" height="${t.h}" alt="${esc(p.alt_text)}"` +
    // The hero photo is on the first screen: load it first, not lazily.
    `${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></a>` +
    (text ? `<figcaption>${esc(text)}</figcaption>` : '') +
    '</figure>';
}

const GRID_SIZES = '(min-width: 1080px) 340px, (min-width: 640px) 45vw, 92vw';

export function groupByMeeting(photos) {
  const groups = [];
  for (const p of photos) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== p.meeting_date) groups.push(g = { date: p.meeting_date, photos: [] });
    g.photos.push(p);
  }
  return groups;
}

// --- /photos -------------------------------------------------------------

export function renderGallery(photos, docs, byline) {
  if (!photos.length) {
    return '<p class="photos-empty">No photos are up yet. Photos from the next Board meeting will appear here after it.</p>';
  }
  return groupByMeeting(photos).map((g) => {
    const summary = docs.find((d) => d.doc_type === 'meeting-summary' && d.meeting_date === g.date && d.language === 'en');
    const n = g.photos.length;
    return `<section class="photo-meeting" id="${esc(g.date)}" aria-labelledby="photos-${esc(g.date)}">` +
      '<div class="photo-meeting-head">' +
      '<div>' +
      '<span class="eyebrow">Board of County Commissioners</span>' +
      `<h2 id="photos-${esc(g.date)}">${esc(longDate(g.date))}</h2>` +
      '</div>' +
      '<p class="photo-meeting-meta">' +
      `<span>${n} ${n === 1 ? 'photo' : 'photos'}</span>` +
      (summary ? `<a href="/documents/meeting-summary/${esc(g.date)}">Read the Meeting Summary &#8594;</a>` : '') +
      '</p>' +
      '</div>' +
      `<div class="photo-grid" data-photo-group>${g.photos.map((p) => figure(p, byline, { sizes: GRID_SIZES })).join('')}</div>` +
      '</section>';
  }).join('\n');
}

// --- under a Meeting Summary --------------------------------------------

export function renderStrip(photos, date, byline) {
  const these = photos.filter((p) => p.meeting_date === date);
  if (!these.length) return '';
  const shown = these.slice(0, 6);
  const more = these.length > shown.length
    ? `All ${these.length} photos from this meeting &#8594;`
    : 'See them in the photo gallery &#8594;';
  return '<section class="section photo-strip" aria-labelledby="photo-strip-heading"><div class="wrap">' +
    '<span class="eyebrow">From the chamber</span>' +
    '<h2 id="photo-strip-heading">Photos from this meeting</h2>' +
    `<div class="photo-grid" data-photo-group>${shown.map((p) => figure(p, byline, { sizes: GRID_SIZES })).join('')}</div>` +
    `<p class="photo-strip-more"><a href="/photos#${esc(date)}">${more}</a></p>` +
    '</div></section>';
}

// --- homepage and /attend -----------------------------------------------

// Featured photos first, newest meeting first; if nothing is featured, the
// newest published photos stand in so the spot is never empty once any
// photo is live.
function pick(photos, n) {
  const featured = photos.filter((p) => p.is_featured);
  const rest = photos.filter((p) => !p.is_featured);
  return featured.concat(rest).slice(0, n);
}

// The top of the homepage is the most-seen spot on the site, so only a photo
// staff marked Featured can go there: the newest one. With none featured the
// seal stays (the fallback is home.html's own markup in that region).
export const HERO_MAX = 6;
const HERO_SIZES = '(min-width: 1080px) 420px, (min-width: 900px) 40vw, 92vw';

export function heroPhotos(photos) {
  return photos.filter((p) => p.is_featured).slice(0, HERO_MAX);
}

// One featured photo: a still image, as before. Several: a slideshow that
// js/hero-rotator.js turns, newest meeting first. Without that script (or
// before it runs) only the first slide shows and the controls stay hidden,
// so the hero never depends on JavaScript.
export function renderHeroMedia(photos, byline, fallback) {
  const slides = heroPhotos(photos);
  if (!slides.length) return fallback;
  if (slides.length === 1) {
    return '<div class="hero-photo" data-photo-group>' +
      figure(slides[0], byline, { sizes: HERO_SIZES, eager: true, cls: 'photo photo-hero' }) +
      '</div>';
  }
  const n = slides.length;
  return '<div class="hero-photo hero-rotator" data-photo-group data-rotate ' +
    'role="group" aria-roledescription="carousel" aria-label="Photos from County Commission meetings">' +
    '<div class="hero-slides">' +
    slides.map((p, i) =>
      `<div class="hero-slide${i === 0 ? ' is-active' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}"` +
      // inert: a hidden slide's link is neither focusable nor read out.
      `${i === 0 ? '' : ' inert'}>` +
      figure(p, byline, { sizes: HERO_SIZES, eager: i === 0, cls: 'photo photo-hero' }) +
      '</div>').join('') +
    '</div>' +
    '<div class="hero-controls" hidden>' +
    '<button type="button" class="hero-pause" aria-label="Pause the slideshow" data-label-play="Play the slideshow" data-label-pause="Pause the slideshow">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-pause"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>' +
    '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-play"><path d="M5 3.5v9a.5.5 0 0 0 .77.42l7-4.5a.5.5 0 0 0 0-.84l-7-4.5A.5.5 0 0 0 5 3.5z"/></svg>' +
    '</button>' +
    '<div class="hero-dots">' +
    slides.map((p, i) => `<button type="button" class="hero-dot" aria-label="Show photo ${i + 1} of ${n}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('') +
    '</div>' +
    '</div>' +
    '</div>';
}

// "Attend with us" shows a photo that is not already in the hero.
export function renderHomePhoto(photos, byline) {
  const hero = new Set(heroPhotos(photos));
  const [p] = pick(photos.filter((x) => !hero.has(x)), 1);
  if (!p) return '';
  return `<div class="attend-photo" data-photo-group>` +
    figure(p, byline, { sizes: '(min-width: 900px) 420px, 92vw', cls: 'photo photo-feature' }) +
    `<p class="attend-photo-more"><a href="/photos">More photos from the chamber &#8594;</a></p>` +
    '</div>';
}

export function renderAttendPhotos(photos, byline) {
  const shown = pick(photos, 3);
  if (!shown.length) return '';
  // The whole band, so a page with no photos yet has no empty section.
  return '<section class="section section-alt attend-photos" aria-labelledby="attend-photos-heading"><div class="wrap">' +
    '<span class="eyebrow">From the chamber</span>' +
    '<h2 id="attend-photos-heading">What a meeting day looks like</h2>' +
    `<div class="photo-grid photo-grid-3" data-photo-group>${shown.map((p) => figure(p, byline, { sizes: GRID_SIZES })).join('')}</div>` +
    '<p class="photo-strip-more"><a href="/photos">More photos from past meetings &#8594;</a></p>' +
    '</div></section>';
}
