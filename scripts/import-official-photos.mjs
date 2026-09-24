// One-off: copy every city official's hotlinked photo into our own Storage.
//
// Before migration_25, city_officials.photo_url pointed at the cities' own
// websites, which the CSP blocks on the city subdomains. This walks every
// official whose photo_url is not already in the official-photos bucket,
// downloads the image, uploads it to official-photos/<city-slug>/<id>.<ext>,
// and repoints the row -- keeping the old address in photo_source_url. It is
// the same importPhoto() the dashboards call through api/city-platform.js, so
// the backfill and every later edit store photos identically.
//
// A download that fails is logged and that row is left exactly as it was.
// Safe to re-run: rows already pointing at the bucket are skipped.
//
// Needs the service role (it writes to Storage and to every city's rows):
//
//   PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = '<key>'; node scripts/import-official-photos.mjs
//   bash:        SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/import-official-photos.mjs
//
// Add --dry-run to list what would be imported without downloading anything.
// Run supabase/migration_25 first; the bucket and photo_source_url come from it.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { importPhoto, isHosted, serviceHeaders } = require('../api/_official-photo.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

// Same source of truth for the project URL as scripts/lib/data.mjs.
const browserUrl = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(readFileSync(join(ROOT, 'js', 'supabase-client.js'), 'utf8'));
const SUPABASE_URL = process.env.SUPABASE_URL || (browserUrl && browserUrl[1]);
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL if not the project in js/supabase-client.js).');
  process.exit(1);
}

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/city_officials?select=id,name,photo_url,cities(slug)&photo_url=not.is.null&order=city_id,sort_order`,
  { headers: serviceHeaders(KEY) }
);
if (!res.ok) {
  console.error(`Could not read city_officials (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const rows = (await res.json()).filter((r) => !isHosted(SUPABASE_URL, r.photo_url));

console.log(`${rows.length} official(s) with an external photo${DRY_RUN ? ' (dry run)' : ''}\n`);

let copied = 0;
const failed = [];
for (const r of rows) {
  const label = `${r.cities?.slug ?? '?'} / ${r.name}`;
  if (!r.cities?.slug) {
    failed.push(label);
    console.log(`FAIL  ${label}: the official has no city`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`would copy  ${label}\n            ${r.photo_url}`);
    continue;
  }
  try {
    const url = await importPhoto({
      supabaseUrl: SUPABASE_URL,
      serviceKey: KEY,
      officialId: r.id,
      citySlug: r.cities.slug,
      sourceUrl: r.photo_url
    });
    copied++;
    console.log(`ok    ${label}\n      ${r.photo_url}\n   -> ${url}`);
  } catch (err) {
    failed.push(label);
    console.log(`FAIL  ${label}: ${err.message}\n      ${r.photo_url} (row left unchanged)`);
  }
}

if (!DRY_RUN) console.log(`\n${copied} copied, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
