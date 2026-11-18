// Renders scripts/og/share-card.html to assets/img/share-card.png (1200x630).
//
//   node scripts/og/render-share-card.mjs
//
// Serves the repo root on a throwaway localhost port so the template can load
// /css/style.css, the fonts and the seal exactly as the site does, then takes
// the screenshot with headless Google Chrome. No npm dependency: set CHROME to
// the browser binary if it is not in the default macOS location. Fails if the
// file comes out over 300 KB, because WhatsApp drops larger preview images.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT =join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'assets', 'img', 'share-card.png');
const MAX_BYTES = 300 * 1024;
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.png': 'image/png',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

// Async on purpose: a synchronous child would block this process, and with
// it the server Chrome is waiting on.
try {
  await run(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    '--virtual-time-budget=3000',
    `--screenshot=${OUT}`,
    `http://127.0.0.1:${port}/scripts/og/share-card.html`
  ], { timeout: 60000 });
} finally {
  server.close();
}

const { size } = await stat(OUT);
console.log(`wrote assets/img/share-card.png (${Math.round(size / 1024)} KB)`);
if (size > MAX_BYTES) {
  console.error('share card is over 300 KB; WhatsApp may not show it. Simplify the design.');
  process.exit(1);
}
