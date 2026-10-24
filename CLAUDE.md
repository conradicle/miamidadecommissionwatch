# Working rules for this repo

Miami-Dade Commission Watch — independent, nonpartisan, student-run coverage of the
Miami-Dade Board of County Commissioners. Plain HTML/CSS/JS, Supabase, Vercel, and one
build step (below).

## Build and deploy

Vercel runs `node scripts/build.mjs` on every deploy (`buildCommand` in `vercel.json`) and
serves **only** the `dist/` folder (`outputDirectory: "dist"`). Nothing in the repo root is
served directly. Until October 2026 the root itself was the output, which published
`supabase/*.sql`, `scripts/`, `vercel.json` and `package.json`; this layout exists to stop
that from happening again.

- **Root files are sources only.** The build reads `home.html`, `meetings.html`,
  `documents/index.html` and the other pages from the root, fills their
  `<!-- build:name -->` regions with Supabase content, and writes the result to `dist/`. It
  never writes to the root. Do not commit generated output (`meetings/*.html`,
  `documents/<type>/<date>.html`, `sitemap.xml`); the build regenerates it every time.
- **The allowlist.** `PUBLIC_FILES` in `scripts/build.mjs` is the complete list of what
  reaches `dist/`: top-level `*.html`, `robots.txt`, `city/index.html`, the four
  `documents/` shell pages, and `css/`, `js/` and `assets/` limited to the file types pages
  load. Nothing else is copied. A new public file or folder has to be added there on purpose;
  a new page in a subfolder 404s until it is.
- **The guard.** `checkDist()` runs at the end of every build. It fails the build (so the
  last good deployment keeps serving) if `dist/` contains anything on the forbidden list
  (`supabase/`, `scripts/`, `api/`, `drafts/`, `document-templates/`, dotfiles,
  `vercel.json`, `package*.json`, `.md`/`.sql`/`.mjs` and similar) or if a rewrite
  destination in `vercel.json` is missing from `dist/`. If it fails, fix the allowlist; never
  loosen the guard to get a deploy through.
- **Functions** in `api/` are built by Vercel from the project root and are unaffected by the
  output folder. `api/_*.js` are modules, not endpoints.
- **Locally:** `npm run build` writes `dist/` (gitignored); `npm run build:check` is a dry
  run. Preview `dist/`, not the root, or you are testing files production never serves. On
  a city subdomain any missing path returns 200 with the city page (the host rewrite), so
  check exposure against `www`.

## Before any audit or plan

Run `git fetch` and confirm the working tree is current with `origin/main` **before**
reading the code. State the commit you are working from at the top of whatever you write.

A plan written against a stale checkout is worse than no plan — it looks authoritative and
describes a site that no longer exists. This has already happened once: an audit was written
against a checkout 37 commits behind, and it documented a content system that had been
deleted, a `vercel.json` that existed, and a nav that had changed.

## Browser-dependent findings

Any claim about what a page *does* in a browser — rendering, translation, client-side
behavior, third-party widgets — must be verified in a real browser before it is written up
as a conclusion.

The in-app Chromium is not a real browser for this purpose. It breaks at least the Google
Translate Element widget, most likely through storage partitioning affecting the widget's
iframe. A feature that works fine for users fails silently there.

Two tests in the same browser engine are **one** observation, not two. If a finding depends
on browser behavior and it cannot be confirmed on a real device, report it as a hypothesis
with the confounder named — do not promote it to a conclusion. This rule exists because that
mistake was made here: the translation feature was reported as "entirely non-functional"
when it works correctly on iOS Safari.

## Minors

Volunteers and student contributors are high schoolers. **No minor's full legal name,
school, or grade appears in public output.** Public bylines are first name + last initial
("Ana R."). This applies to rendered pages, generated files, commit metadata, and anything
else a visitor or crawler can reach.

Nothing private goes in a publicly-readable Supabase table. Contact details and real names
live in staff-readable tables only.

Corrections and error reports route to staff, never to a volunteer. Do not build a public
contact channel to a minor.

## Asset versioning

Static assets are cache-busted with a date query string: `?v=YYYYMMDD`.

```html
<script src="js/translate.js?v=20260820"></script>
<link rel="stylesheet" href="css/style.css?v=20260821">
```

Changing a `.js` or `.css` file means bumping its `?v=` everywhere it is referenced, or
returning visitors keep the cached old copy. The nav and footer are duplicated across ~20
pages, so this is a per-page edit.

## Content Security Policy

`vercel.json` sets a real CSP (plus HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`). Anything added must fit within it, or the CSP must
be extended deliberately in the same change.

Before adding any third-party script, style, font, image host, or network call, check it
against the `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, and `frame-src`
directives already in `vercel.json`.

## Supabase

Schema changes are numbered SQL files in `supabase/`, applied **by hand** in the Supabase SQL
editor. There is no migration runner, so the repo and the live database can silently diverge.

**Verify the deployed schema before writing a migration that depends on it.**

Free tier: no backups, no point-in-time recovery. Content that exists only in Postgres is
content with no second copy.

RLS is the security boundary — the anon key is public by design and ships in
`js/supabase-client.js`. Policies must constrain *values*, not just existence: see
`migration_6`, which closed a hole where `with check (true)` let anyone POST an editorial
with `status: 'approved'` straight to the public feed. Note also that Postgres grants EXECUTE
on new functions to PUBLIC by default — revoke from `public`, not just `anon`
(see `migration_9`, `migration_10`).

## Editorial

`EDITORIAL-REVIEW-CHECKLIST.md` is the staff-facing standard for student editorial
submissions. It is not published. Extend it rather than duplicating it.

Every factual claim gets a source link. Summaries are plain language. The site takes no
position on candidates or parties.
