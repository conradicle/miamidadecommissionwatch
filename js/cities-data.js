// Registry of municipal Commission Watch coverage areas.
//
// Miami-Dade Commission Watch covers county government at the site root; this
// file is the single source of truth for the /cities/ section, where student
// teams can cover an individual municipality's government. The cities hub
// (js/cities-hub.js) and every city page (js/city-page.js) render from this
// registry, so adding or updating a city here updates everything that shows it.
//
// Plain global, matching the rest of js/ (no build step, no modules).
//
// ---------- How to add a city ----------
// 1. Add an entry to MDCW_CITIES below. Start with status 'team-needed' and
//    hasPage false; that alone puts the city's card on /cities/.
// 2. When the city is ready for its own page, copy cities/miami-beach.html to
//    cities/<slug>.html, update the <title>, meta description, canonical URL,
//    hero copy, and the data-city-slug attribute on <body>, then set hasPage
//    to true here. The clean URL /cities/<slug> already works: vercel.json
//    rewrites any /cities/:slug to /cities/:slug.html.
// 3. Add the new URL to sitemap.xml.
//
// ---------- Editorial rules for this file ----------
// * Never invent anything. No made-up student teams, officials, meeting
//   schedules, or sources. A city with no team says so plainly.
// * Government structure varies by municipality: numbers of seats, districts
//   vs. at-large, terminology ("Commission" vs. "Council"), meeting cadence.
//   That's why `government` is per-city free text instead of shared fields
//   that quietly assume every city works like the county.
// * Only list a source you have actually checked. Official links here carry
//   the same weight as the county sources on the main site.
//
// ---------- Fields ----------
// slug            URL segment: /cities/<slug>. Lowercase, hyphenated.
// name            Display name, e.g. "Miami Beach".
// blurb           One sentence for the hub card.
// status          'active'      -- a student team is publishing coverage
//                 'forming'     -- a team exists but hasn't launched yet
//                 'team-needed' -- no team yet; the card invites students
// hasPage         true once cities/<slug>.html exists and is linkable.
// government      null until verified. Otherwise { body, form, note }:
//                 body: name of the governing body, e.g. "Miami Beach City
//                       Commission"; form: form of government; note: one
//                       sentence on structure (seats, at-large vs districts).
// officialWebsite null until verified. The city government's own site.
// sources         Array of { label, url } official links, verified before
//                 adding. Empty until coverage begins.
// team            null until a real team exists. Otherwise { name, editors,
//                 contributors, advisor, contact, launched, coverage } --
//                 fill only the parts that are true; renderers skip the rest.

var MDCW_CITIES = [
  {
    slug: 'miami-beach',
    name: 'Miami Beach',
    blurb: 'Coverage of the City of Miami Beach government, run by students in Miami Beach.',
    status: 'team-needed',
    hasPage: true,
    government: {
      body: 'Miami Beach City Commission',
      form: 'Commission–City Manager',
      note: 'The Mayor and six Commissioners are elected citywide (at large), unlike the county commission’s 13 single-member districts.'
    },
    officialWebsite: 'https://www.miamibeachfl.gov/',
    sources: [
      { label: 'City of Miami Beach — official website', url: 'https://www.miamibeachfl.gov/' },
      { label: 'Miami-Dade County Elections Department', url: 'https://www.votemiamidade.gov/' }
    ],
    team: null
  },
  {
    slug: 'miami',
    name: 'City of Miami',
    blurb: 'Coverage of the City of Miami government, run by students in Miami.',
    status: 'team-needed',
    hasPage: false,
    government: null,
    officialWebsite: null,
    sources: [],
    team: null
  },
  {
    slug: 'coral-gables',
    name: 'Coral Gables',
    blurb: 'Coverage of the City of Coral Gables government, run by students in Coral Gables.',
    status: 'team-needed',
    hasPage: false,
    government: null,
    officialWebsite: null,
    sources: [],
    team: null
  },
  {
    slug: 'miami-gardens',
    name: 'Miami Gardens',
    blurb: 'Coverage of the City of Miami Gardens government, run by students in Miami Gardens.',
    status: 'team-needed',
    hasPage: false,
    government: null,
    officialWebsite: null,
    sources: [],
    team: null
  },
  {
    slug: 'hialeah',
    name: 'Hialeah',
    blurb: 'Coverage of the City of Hialeah government, run by students in Hialeah.',
    status: 'team-needed',
    hasPage: false,
    government: null,
    officialWebsite: null,
    sources: [],
    team: null
  },
  {
    slug: 'homestead',
    name: 'Homestead',
    blurb: 'Coverage of the City of Homestead government, run by students in Homestead.',
    status: 'team-needed',
    hasPage: false,
    government: null,
    officialWebsite: null,
    sources: [],
    team: null
  }
];

// Human-readable label + CSS modifier for each status. Rendering code should
// go through these rather than hardcoding strings, so a new status only needs
// to be added here.
var MDCW_CITY_STATUS = {
  'active': { label: 'Active coverage', className: 'city-status-active' },
  'forming': { label: 'Team forming', className: 'city-status-forming' },
  'team-needed': { label: 'Student team needed', className: 'city-status-needed' }
};

function mdcwFindCity(slug) {
  for (var i = 0; i < MDCW_CITIES.length; i++) {
    if (MDCW_CITIES[i].slug === slug) return MDCW_CITIES[i];
  }
  return null;
}
