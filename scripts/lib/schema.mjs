// JSON-LD nodes.
//
// Every claim here is taken from the site's own pages -- the founders and the
// nonpartisanship line come out of the footer, the Instagram handle out of the
// header, the mission out of about.html. Nothing is invented: structured data
// that asserts something the page does not support is a liability, not a
// ranking signal.

import { SITE_ORIGIN } from './fmt.mjs';

export const ORG_ID = `${SITE_ORIGIN}/#organization`;
export const SITE_ID = `${SITE_ORIGIN}/#website`;

const LOGO = `${SITE_ORIGIN}/assets/img/og-image.png`;

// The reason this file exists at all: "Miami-Dade Commission Watch" is three
// generic words that the county's own domain outranks for every one of them.
// Google has no way to learn the phrase names an organization unless the site
// says so in a form it reads as an entity claim. alternateName carries the
// spellings people actually type.
export function organization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    '@id': ORG_ID,
    name: 'Miami-Dade Commission Watch',
    alternateName: [
      'Miami Dade Commission Watch',
      'MDCW',
      'Miami-Dade County Commission Watch'
    ],
    url: `${SITE_ORIGIN}/`,
    logo: { '@type': 'ImageObject', url: LOGO, width: 1200, height: 630 },
    image: LOGO,
    description: 'Independent, nonpartisan tracking of the Miami-Dade County ' +
      'Board of County Commissioners: plain-language meeting summaries, a ' +
      'commissioner directory, and ways to get involved.',
    founder: [
      { '@type': 'Person', name: 'Conrad Gelber' },
      { '@type': 'Person', name: 'Daniel Llobet' }
    ],
    sameAs: ['https://instagram.com/miamidadecommissionwatch'],
    areaServed: {
      '@type': 'AdministrativeArea',
      name: 'Miami-Dade County, Florida'
    },
    knowsAbout: [
      'Miami-Dade Board of County Commissioners',
      'Miami-Dade County government',
      'county commission meetings',
      'local government transparency'
    ],
    publishingPrinciples: `${SITE_ORIGIN}/about.html`,
    isAccessibleForFree: true,
    // Stated verbatim on every page's footer.
    disambiguatingDescription: 'An independent, student-run civic project. ' +
      'Not affiliated with, operated by, or endorsed by Miami-Dade County government.'
  };
}

export function website() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: `${SITE_ORIGIN}/`,
    name: 'Miami-Dade Commission Watch',
    inLanguage: 'en-US',
    publisher: { '@id': ORG_ID }
  };
}

export function breadcrumbs(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: step.url
    }))
  };
}

// A meeting recap is reporting on a public meeting, so NewsArticle rather than
// the generic Article. The author is the organisation: recaps are staff work
// and carry no individual byline anywhere on the site.
export function meetingArticle(meeting, { published, modified }) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': `${meeting.__url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': meeting.__url },
    url: meeting.__url,
    headline: meeting.title,
    description: meeting.summary,
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    about: {
      '@type': 'Event',
      name: `${meeting.meeting_type} of the Miami-Dade Board of County Commissioners`,
      startDate: meeting.meeting_date,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      organizer: {
        '@type': 'GovernmentOrganization',
        name: 'Miami-Dade Board of County Commissioners',
        url: 'https://www.miamidade.gov/commission/'
      },
      location: {
        '@type': 'Place',
        name: 'Stephen P. Clark Government Center',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Miami',
          addressRegion: 'FL',
          addressCountry: 'US'
        }
      }
    }
  };
  if (published) node.datePublished = published;
  if (modified) node.dateModified = modified;

  const sections = (meeting.meeting_items || [])
    .map((i) => i.topic).filter(Boolean);
  if (sections.length) node.keywords = Array.from(new Set(sections)).join(', ');

  return node;
}

export function collectionPage({ url, name, description, items }) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#page`,
    url,
    name,
    description,
    inLanguage: 'en-US',
    isPartOf: { '@id': SITE_ID },
    publisher: { '@id': ORG_ID }
  };
  if (items && items.length) {
    node.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: it.url
      }))
    };
  }
  return node;
}
