// Writes api/_sanitize-html.js: sanitize-html and its dependencies bundled
// into one CommonJS file.
//
// Why: sanitize-html 2.17.6+ require()s htmlparser2 12, which ships only as
// an ES module. Plain Node 22+ allows that, but Vercel's function runtime
// does not, so api/city-platform.js crashed on load (ERR_REQUIRE_ESM,
// FUNCTION_INVOCATION_FAILED) for every op, not only documents. The bundle
// has no require() of an ES module left in it. Older sanitize-html avoids the
// problem but has open XSS advisories, so it is not an option.
//
// Run after changing the sanitize-html version in package.json:
//   npm run vendor-sanitizer
// scripts/build.mjs refuses to build while the bundle and package.json
// disagree, so a forgotten re-run fails the deploy instead of shipping an
// older sanitizer than the one we think we have.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const version = JSON.parse(readFileSync(require.resolve('sanitize-html/package.json'), 'utf8')).version;

await build({
  entryPoints: [require.resolve('sanitize-html')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'api/_sanitize-html.js',
  legalComments: 'inline',
  banner: {
    js: '// sanitize-html ' + version + ' bundled by scripts/vendor-sanitizer.mjs. Do not edit; re-run the script.'
  },
  logLevel: 'warning'
});

console.log('api/_sanitize-html.js: sanitize-html ' + version);
