// Fallback registry of municipal Commission Watch coverage areas.
//
// Since supabase/migration_13_city_program.sql, the live source of truth for
// the /cities/ section is the `cities` table in Supabase: students apply from
// start-a-city.html and staff approve cities from the admin dashboard, with
// no code change. The hub (js/cities-hub.js) and city pages (js/city-page.js)
// read the database first and fall back to this file only when that read
// fails (Supabase down, script blocked), so /cities/ never renders empty.
//
// Plain global, matching the rest of js/ (no build step, no modules).
//
// ---------- How a city gets added now ----------
// 1. Normal path: a student applies at start-a-city.html; staff hit Approve
//    in the admin dashboard's Cities tab. That inserts/updates the city's
//    row and it appears on /cities/ immediately, served at /cities/<slug>
//    by the shared template cities/city.html (vercel.json rewrites any
//    unclaimed /cities/:slug there).
// 2. Optional, for a mature city: give it a dedicated static page for
//    better SEO. Copy cities/miami-beach.html to cities/<slug>.html, update
//    the <title>, meta description, canonical URL, hero copy, and the
//    data-city-slug attribute on <body>, add a rewrite for the slug ABOVE
//    the generic /cities/:slug rule in vercel.json, and add the URL to
//    sitemap.xml. Content still comes from the database.
// 3. Keep this fallback roughly in sync with the table when convenient; it
//    only shows when the database is unreachable, so "roughly" is fine.
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
//                 Team members are minors: editors/contributors may hold full
//                 names here, but public pages render them through
//                 publicByline() as "First L." only (see js/public-byline.js),
//                 same as editorial bylines. contact must be a project alias
//                 (e.g. a shared cities@ address), never a student's personal
//                 or school email -- privacy.html promises those are never
//                 shown publicly.

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
      { label: 'Miami-Dade Supervisor of Elections', url: 'https://www.votemiamidade.gov/' }
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

// Maps a row from the Supabase `cities` table onto the object shape the
// renderers (and this fallback registry) use, so the rest of the code never
// cares which source a city came from. Cities served from the database always
// have a page: the shared template cities/city.html renders any approved slug.
function mdcwCityFromRow(row) {
  return {
    slug: row.slug,
    name: row.name,
    blurb: row.blurb || '',
    status: row.status || 'team-needed',
    hasPage: true,
    government: row.government || null,
    officialWebsite: row.official_website || null,
    sources: row.sources || [],
    team: row.team_public || null
  };
}

// Fetches the listed cities (or one city by slug) from Supabase, falling back
// to the static registry above whenever the database isn't reachable. Calls
// back with (cities: array) or (city: object|null) respectively -- always
// asynchronously, so callers have one code path.
function mdcwLoadCities(callback) {
  if (typeof supabaseClient === 'undefined') {
    setTimeout(function () { callback(MDCW_CITIES); }, 0);
    return;
  }
  supabaseClient
    .from('cities')
    .select('slug, name, blurb, status, government, official_website, sources, team_public')
    .eq('listed', true)
    .order('name', { ascending: true })
    .then(function (res) {
      if (res.error || !res.data) {
        callback(MDCW_CITIES);
        return;
      }
      callback(res.data.map(mdcwCityFromRow));
    })
    .catch(function () { callback(MDCW_CITIES); });
}

function mdcwLoadCity(slug, callback) {
  if (typeof supabaseClient === 'undefined') {
    setTimeout(function () { callback(mdcwFindCity(slug)); }, 0);
    return;
  }
  supabaseClient
    .from('cities')
    .select('slug, name, blurb, status, government, official_website, sources, team_public')
    .eq('listed', true)
    .eq('slug', slug)
    .then(function (res) {
      if (res.error || !res.data) {
        callback(mdcwFindCity(slug));
        return;
      }
      // A database that answered but has no such city is authoritative: no
      // registry fallback, so unlisting a city in the admin really hides it.
      callback(res.data.length > 0 ? mdcwCityFromRow(res.data[0]) : null);
    })
    .catch(function () { callback(mdcwFindCity(slug)); });
}
