// Hand-maintained commissioner profile facts.
//
// This is the "static" half of a commissioner page. Everything here is edited
// by a person in this file -- there is no dashboard for it and no database
// table behind it. The database only holds identity (name, district, term
// dates) so a roll-call vote can point at a person; see migration_14.
//
// RULES FOR EDITING
//   * Every field is optional. A field left null renders as "Not yet
//     recorded" -- which is the correct output. Do not guess a phone number,
//     a committee assignment, or a term expiration to fill a gap.
//   * `photo` must be a path to a file in assets/img/commissioners/. Do not
//     hotlink miamidade.gov images: the Content-Security-Policy in
//     vercel.json only allows img-src 'self', so a remote image silently
//     fails to load, and reusing the county's photography implies an
//     affiliation the footer explicitly disclaims.
//   * Update `verified` whenever you check a profile against the county's
//     own page. The date is shown to readers as a badge.
//
// STATUS: seeded from what the repo could already source (district, official
// profile URL, and the election schedule stated on elections.html). Photos,
// contact details, committee assignments and term expirations are NOT filled
// in -- they need a person to check each one against the county site.
(function () {
  function officialProfileUrl(district) {
    var padded = district < 10 ? '0' + district : '' + district;
    return 'https://www.miamidade.gov/global/government/commission/district' + padded + '/home.page';
  }

  // Under the charter's staggered schedule, even-numbered districts were on
  // the 2026 ballot and odd-numbered ones were last elected in 2024 and are
  // next up in 2028. Districts 1 and 5 are exceptions in 2026 -- see
  // elections.html, which is the sourced version of this.
  var NEXT_ELECTION = {
    1: '2028 (the 2026 special election filled the remainder of the term)',
    2: 'November 3, 2026',
    3: '2028',
    4: 'November 3, 2026',
    5: 'Runoff on the November 3, 2026 ballot',
    6: 'November 3, 2026',
    7: '2028',
    8: 'November 3, 2026',
    9: '2028',
    10: 'November 3, 2026',
    11: '2028',
    12: 'November 3, 2026',
    13: '2028'
  };

  function base(slug, district) {
    return {
      slug: slug,
      district: district,
      officialUrl: officialProfileUrl(district),
      nextElection: NEXT_ELECTION[district] || null,
      // --- fill these in by hand ---
      photo: null,          // e.g. 'assets/img/commissioners/rene-garcia.jpg'
      photoCredit: null,
      phone: null,
      email: null,
      office: null,
      committees: [],       // e.g. ['Transportation & Finance', 'Chair, Health & Society']
      termExpires: null,    // e.g. 'November 2028'
      bio: null,            // one or two plain-language sentences
      verified: null        // 'August 23, 2026'
    };
  }

  var PROFILES = {};
  [
    ['oliver-g-gilbert-iii', 1],
    ['marleine-bastien', 2],
    ['keon-hardemon', 3],
    ['micky-steinberg', 4],
    ['vicki-l-lopez', 5],
    ['natalie-milian-orbis', 6],
    ['raquel-a-regalado', 7],
    ['danielle-cohen-higgins', 8],
    ['kionne-l-mcghee', 9],
    ['anthony-rodriguez', 10],
    ['roberto-j-gonzalez', 11],
    ['juan-carlos-bermudez', 12],
    ['rene-garcia', 13],
    ['steve-gallon-iii', 1]
  ].forEach(function (row) {
    PROFILES[row[0]] = base(row[0], row[1]);
  });

  // Facts the site already states elsewhere, with the page that sources them.
  PROFILES['oliver-g-gilbert-iii'].termExpires = 'Resigning effective January 3, 2027';
  PROFILES['oliver-g-gilbert-iii'].bio =
    'Resigning effective January 3, 2027; Steve Gallon III was elected unopposed to succeed him.';

  PROFILES['steve-gallon-iii'].bio =
    'Elected unopposed in the 2026 District 1 special election when qualifying closed June 9. Takes office January 3, 2027.';

  PROFILES['vicki-l-lopez'].bio =
    'Appointed to the District 5 seat by the Board in November 2025. The seat is on the November 3, 2026 ballot in a runoff.';

  window.MDCW = window.MDCW || {};
  window.MDCW.profiles = PROFILES;
})();
