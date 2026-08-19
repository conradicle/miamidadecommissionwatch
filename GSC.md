# Google Search Console: audit and fixes

Data pulled 2026-08-19 from the `sc-domain:miamidadecommissionwatch.com` property.
Branch: `seo/gsc-fixes`. Nothing pushed to `main`.

## Read this first

The property was created 2026-08-02, so "last 3 months" is really 16 days of data.
Every number below covers 2026-08-02 through 2026-08-17. Treat trends as provisional.

Totals: **33 clicks, 780 impressions, 4.2% CTR, average position 18.2.**

And the finding that matters more than anything else in this file:

> **63% of the site's search impressions point at a page that returns 404.**
> `/find-my-district.html` earned 495 of 780 impressions and 12 of 33 clicks. It was
> deleted on 2026-08-03 in commit `cd62429` ("Consolidate nav from 9 items to 6")
> with no redirect. `/commissioners.html` (102 impressions) died in the same commit.
> Together that is 597 of 780 impressions, 76% of the site's search visibility,
> currently landing on a hard 404.

Google has not fully re-crawled those URLs yet, which is the only reason they still
show impressions. Once it does, that traffic is gone. The 301s in `vercel.json` on
this branch are the fix, and they are the reason to deploy this branch soon rather
than at leisure.

## 1. Verification

Nothing to stage. The property is a **Domain property** (`sc-domain:`), which can only
exist if DNS TXT verification already succeeded. There is no verification file or meta
tag in the repo and none is needed. A domain property covers `http`, `https`, `www`,
non-`www`, and every subdomain at once, which is the right choice for this site.

If you ever need to re-verify, use the DNS TXT record at your registrar, not an HTML
file. The HTML-file method would create yet another indexable root-level page.

## 2. Sitemap and robots.txt

The sitemap was already submitted on 2026-08-02 and reads clean: status **Success**,
19 discovered pages, last read 2026-08-16. Re-submitting the same URL does nothing, so
I did not. Once this branch deploys, use **Sitemaps > the three-dot menu > refresh**, or
just wait for the next scheduled read.

What I changed:

- Dropped `<priority>` and `<changefreq>` from all 19 entries. Google has publicly
  ignored both for years; they were noise.
- Added `<lastmod>` per URL, sourced from each file's last git commit date. This one
  Google does use.
- Kept the canonical host as `https://www.` throughout, matching the live redirect chain.
- `robots.txt` now disallows `/admin.html`, `/login.html`, `/set-password.html`,
  `/drafts/`, and `/api/`. The sitemap reference is unchanged and still correct.

Validated locally: parses as well-formed XML, 19 `<loc>` entries, no malformed dates.
The live URL returns 200 today and will continue to; the file is served statically from
the repo root by Vercel, so the path does not change.

**Per-meeting URLs do not exist.** All meeting entries render inside `meetings.html`,
partly as static markup and partly through `js/meetings-feed.js` against Supabase. A
sitemap cannot list URLs that were never minted. See Blockers.

## 3. Index coverage

11 indexed, 15 not indexed, 3 reasons.

| Reason | Count | Repo cause | Status |
|---|---|---|---|
| Page with redirect | 3 | `http://www.`, `http://`, `https://` non-www all 301 to `https://www.` | Correct as-is. Not a defect. |
| Duplicate without user-selected canonical | 1 | `/index.html` served 200 alongside `/` with **zero canonical tags anywhere on the site**, and every nav bar linked to `index.html` | **Fixed** |
| Discovered - currently not indexed | 11 | Two are deleted pages that now 404; nine are real pages Google has queued but not crawled | Partly fixed, partly a crawl-budget wait |

The 11 "Discovered" URLs:

| URL | Actual cause | Action |
|---|---|---|
| `/contact.html` | Not yet crawled. Thin page, low internal link weight. | Wait |
| `/elections.html` | Not yet crawled | Wait |
| `/explainer-fisher-island-fuel-depot.html` | **404.** Deleted 2026-08-18 in `8b4902e` | See Blockers |
| `/office-clerk-of-courts.html` | Not yet crawled | Wait |
| `/office-sheriff.html` | Not yet crawled | Wait |
| `/office-state-attorney.html` | Not yet crawled | Wait |
| `/office-supervisor-of-elections.html` | Not yet crawled | Wait |
| `/office-tax-collector.html` | Not yet crawled | Wait |
| `/officials.html` | Not yet crawled. Also the redirect target for `/commissioners.html`, so the new 301 will push equity here. | **Fixed indirectly** |
| `/speak-out-september.html` | **404.** Moved to `drafts/` in `b116983` ("Unpublish Speak Out September") | See Blockers |
| `/submit-editorial.html` | Not yet crawled | Wait |

"Discovered - currently not indexed" on a three-week-old site is normal. It means Google
knows the URL and has not spent crawl budget on it yet. It is not a defect, and there is
no tag to add that speeds it up. Internal links and inbound links do.

Checked and ruled out as causes: no `noindex` on any public page (only `admin.html`,
`login.html`, `set-password.html` carry it, correctly); no `robots.txt` block on any
public path before or after my change; no JS-only rendering on the pages in question
(`meetings.html` ships roughly 8 KB of static body text before its Supabase feed loads).

### Also found: unpublished content is publicly reachable

`https://www.miamidadecommissionwatch.com/drafts/speak-out-september.html` serves a full
200 with real content, headline and all. Commit `b116983` moved the file into `drafts/`
to unpublish it, but Vercel serves the whole repo, so moving it only changed its URL. Its
`og:url` still advertised the old root path, which now 404s.

I added `noindex, nofollow` to that file and a `Disallow: /drafts/` line to `robots.txt`.
I did not delete or alter a word of the page content.

## 4. Fixes applied on this branch

| Change | Files | Why |
|---|---|---|
| 301 `/find-my-district.html` to `/get-involved.html#find-district` | `vercel.json` | Recovers 495 impressions |
| 301 `/commissioners.html` to `/officials.html` | `vercel.json` | Recovers 102 impressions |
| 301 `/constitutional-offices.html` and `/editorials.html` | `vercel.json` | Also deleted in `cd62429`; no measured traffic but free to reclaim |
| `<link rel="canonical">` added to all 20 indexable pages | 20 `.html` | The site had none. This is what caused the duplicate-canonical exclusion. |
| Nav links `index.html` rewritten to `/` | 23 files, 2 per file | Stops the site from voting for the duplicate URL |
| `noindex` on the drafts page | `drafts/speak-out-september.html` | Unpublished content should not be indexable |
| `robots.txt` disallows for admin, auth, drafts, api | `robots.txt` | Keeps staff surfaces out of the index |
| Sitemap rebuilt with `lastmod`, priority and changefreq removed | `sitemap.xml` | See section 2 |
| Title tags and meta descriptions rewritten on 5 pages | 5 `.html` | See section 6 |

Scope check: the diff on every `.html` file touches only `<head>` tags and nav `href`
attributes. No summary, headline, "Why it matters" block, nonpartisanship note, sourcing
line, or translation disclaimer was modified. Verified by filtering the full diff.

## 5. Winnable queries (position 5 to 20, real impressions)

The pattern is unmistakable: this site ranks for one thing, and it is people trying to
find out what commission district they live in. Twenty-six of the top forty queries are
district-lookup intent. Every single one converts at 0%.

| Query | Impr | Pos | Page that should rank | What's missing |
|---|---:|---:|---|---|
| my district | 60 | 9.1 | `/get-involved.html#find-district` | Ranked for `/find-my-district.html`, which now 404s. Redirect fixes the URL; title now says "Find My District". |
| miami-dade county commissioners district map | 24 | 10.5 | `/get-involved.html` | The word "map" appears nowhere in the page's title or description. The Leaflet map is there; the metadata never says so. |
| miami dade county district map | 22 | 12.5 | `/get-involved.html` | Same |
| miami dade district map | 19 | 11.4 | `/get-involved.html` | Same |
| miami dade county commission district map | 14 | 10.9 | `/get-involved.html` | Same |
| miami-dade county district map | 10 | 11.1 | `/get-involved.html` | Same |
| miami dade county commissioners district map | 10 | 12.6 | `/get-involved.html` | Same |
| a que distrito pertenece mi direccion | 7 | 9.6 | `/get-involved.html` | Spanish intent, English-only metadata. The site has ES/HT toggles but no `hreflang` and no translated `<title>`. Google is ranking an English page against a Spanish query on link signals alone. |
| miami dade districts | 7 | 17.4 | `/officials.html` | Page lists 13 districts but was not indexed at all |
| find my district | 6 | 6.7 | `/get-involved.html#find-district` | Redirect + new title |
| que distrito es mi ubicación | 5 | 6.6 | `/get-involved.html` | Same Spanish gap |
| my dist | 5 | 8.2 | `/get-involved.html` | Same |
| which district do i live in | 4 | 7.5 | `/get-involved.html` | New description opens with "Enter your address to see which Miami-Dade County Commission district you live in", which is close to a verbatim match |
| what district do i live in | 4 | 10.0 | `/get-involved.html` | Same |
| what's my district | 4 | 10.5 | `/get-involved.html` | Same |
| find my county commissioner | 3 | 8.3 | `/get-involved.html` | Same |
| commissioner district map | 3 | 8.7 | `/get-involved.html` | Same |
| which district am i in | 3 | 9.0 | `/get-involved.html` | Same |
| miami dade county commissioners map | 3 | 11.0 | `/officials.html` | Not indexed |
| what district am i in for county commissioner | 2 | 8.0 | `/get-involved.html` | Same |
| what district am i in | 2 | 8.5 | `/get-involved.html` | Same |
| county commissioner map | 2 | 9.5 | `/get-involved.html` | Same |
| miami dade districts map | 2 | 14.0 | `/get-involved.html` | Same |
| miami dade district 8 map | 2 | 19.5 | none | No per-district page exists. See Blockers. |

For contrast, the queries you might expect a commission-watch site to own are all far
outside striking distance: "miami dade commission" sits at 33.5, "miami dade county
commission meeting" at 35.5, "miami dade bcc" at 41.0, "miami-dade county commission"
at 63.7. Those are contested by the county's own domain and are not winnable in the near
term. Do not spend effort there yet.

My read: the district finder is the whole business right now. It is the only feature on
the site with organic demand, it sits on page one for most of its query set, and it is
currently pointed at a dead URL. Fixing that one thing is worth more than everything
else in this document combined.

## 6. Pages with impressions and near-zero CTR

| Page | Clicks | Impr | CTR |
|---|---:|---:|---:|
| `/` | 17 | 78 | 21.8% |
| `/find-my-district.html` | 12 | 495 | **2.4%** (404) |
| `/commissioners.html` | 2 | 102 | **2.0%** (404) |
| `/about.html` | 2 | 50 | 4.0% |
| `/meetings.html` | 1 | 82 | **1.2%** |
| `/get-involved.html` | 1 | 25 | 4.0% |
| `/office-public-defender.html` | 0 | 10 | **0%** |
| `/faq.html` | 0 | 4 | 0% |

The two worst performers are 404s, so their CTR is not a copywriting problem. The rest
had titles built on a `Section - Site Name` template that says nothing a searcher wants.

Rewritten (title tag and meta description only, plus the matching OG and Twitter tags):

**`/get-involved.html`**
- Was: `Get Involved - Miami-Dade Commission Watch`
- Now: `Find My District: Miami-Dade Commission District Map`
- Desc: "Enter your address to see which Miami-Dade County Commission district you live in, who your commissioner is, and how to speak at a Board meeting."

**`/officials.html`**
- Was: `Elected Officials - Miami-Dade Commission Watch`
- Now: `Miami-Dade County Commissioners: All 13 Districts`
- Desc: "Every Miami-Dade County commissioner by district, plus the county's seven constitutional officers. Names, districts, offices, and contact links."

**`/meetings.html`**
- Was: `Meeting Tracker - Miami-Dade Commission Watch`
- Now: `Miami-Dade Commission Meetings: Agendas and Summaries`
- Desc: "Plain-language summaries of every Miami-Dade Board of County Commissioners meeting: what was discussed, what was decided, and how commissioners voted."

**`/about.html`**
- Was: `About - Miami-Dade Commission Watch`
- Now: `About Miami-Dade Commission Watch: Mission and Method`
- Desc: "Who runs Miami-Dade Commission Watch, how we summarize county government, and the editorial policy behind every meeting recap we publish."

**`/office-public-defender.html`**
- Was: `Public Defender - Miami-Dade Commission Watch`
- Now: `Miami-Dade Public Defender: Office, Duties, Who Holds It`
- Desc: "What the Miami-Dade Public Defender does, how the office is elected and funded, and who currently holds it."

All titles land between 49 and 56 characters, all descriptions between 107 and 150, so
none should truncate in a desktop SERP. The six sibling `office-*.html` pages share the
old template and will need the same treatment once they accumulate impressions worth
optimizing against; right now only the public defender page has any.

## 7. Core Web Vitals, Mobile Usability, Manual Actions, Security

- **Core Web Vitals**: "Not enough usage data in the last 90 days" for both mobile and
  desktop. CrUX needs real Chrome traffic volume the site does not have yet. Nothing to
  fix and nothing to read. Run PageSpeed Insights against `/get-involved.html` if you
  want lab data; the Leaflet map and the geojson district file are the likely LCP risk.
- **Mobile Usability**: this report no longer exists. Google retired it in December 2023.
  There is nothing to pull.
- **Manual Actions**: no issues detected.
- **Security Issues**: no issues detected.
- **HTTPS**: the property has an HTTPS report; the three `http://` URLs in the redirect
  bucket are the expected upgrade chain, not a problem.

## Blockers

Things I did not do because they need your decision.

**1. No per-meeting URLs exist, so the sitemap cannot cover meeting entries.**
Every summary lives inside `meetings.html`. The request asked for a sitemap covering
"every individual Meeting Tracker entry" and that is not possible against the current
architecture. Building it means minting `/meetings/2026-08-04.html` style pages, which
means moving published summary text, which your rules forbid me from doing unsupervised.
Worth doing eventually: individual meeting pages are the natural landing pages for
queries like "miami dade commission agenda" (currently position 25.0) and "miami dade
county commission meeting" (35.5). Tell me to build it and I will, copying summary text
verbatim rather than rewriting.

**2. `/explainer-fisher-island-fuel-depot.html` is a 404 that Google has queued.**
Deleted yesterday in `8b4902e`. I did not add a redirect because there is no equivalent
page and pointing it at an unrelated URL invites a soft-404. Three options: leave it to
404 naturally (fine, costs nothing, it had no measured impressions), restore the page, or
301 it to `/meetings.html`. I would leave it.

**3. `/speak-out-september.html` is a 404 by intent, until it isn't.**
You unpublished it in `b116983` "until the September launch". It is 2026-08-19. When you
republish, put the file back at the repo root rather than linking to `drafts/`, and strip
the `noindex` I added. Flagging it so the noindex does not silently survive launch.

**4. No `hreflang` and no translated metadata, against clear Spanish demand.**
"a que distrito pertenece mi direccion" (7 impressions, position 9.6) and "que distrito
es mi ubicación" (5, position 6.6) are ranking an English page. The site has EN/ES/HT
toggles through `js/translate.js`, but client-side Google Translate produces no separate
URLs, so there is nothing for `hreflang` to point at and nothing for Google to index in
Spanish. Fixing this properly means real translated pages at real URLs. That is a content
and editorial-policy decision, not a mechanical one, and it interacts with your
translation disclaimer, which I did not touch.

**5. Should `/index.html` 301 to `/`?**
I fixed the duplicate with a canonical tag and by repointing 46 nav links, which is the
safe fix. An explicit 301 would be stronger but risks a redirect loop depending on how
Vercel resolves the root path against the same file. I would deploy this branch, confirm
the duplicate exclusion clears in a couple of weeks, and only add the 301 if it does not.

**6. Deploy and verify.**
I validated the new `sitemap.xml` locally: well-formed XML, 19 `<loc>` entries. I could
not verify it returns 200 at the live URL because the branch is not deployed. After merge,
confirm `https://www.miamidadecommissionwatch.com/sitemap.xml` returns 200, then spot-check
that `https://www.miamidadecommissionwatch.com/find-my-district.html` returns 301 rather
than 404. That second check is the one that matters.
