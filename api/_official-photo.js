// Copy a city official's photo from wherever it was pasted from into our own
// Storage bucket, and point the row at the copy.
//
// The city subdomains' CSP (vercel.json) only allows images from our own
// origins plus the Supabase project, so a photo hotlinked from a city website
// never loads. Instead of widening img-src per city, every photo is copied
// once into the public official-photos bucket (supabase/migration_25) at
// official-photos/<city-slug>/<official-id>.<ext>, and photo_source_url keeps
// the address it came from.
//
// Two callers share importPhoto():
//   * the dashboards, through api/city-platform.js { op: 'import_official_photo' }
//     after saving an official with an external photo URL -- handled below;
//   * scripts/import-official-photos.mjs, the one-off backfill.
//
// The download happens here, on the server, never in the browser: the browser
// cannot read another site's image bytes (CORS), and the upload needs the
// service role. Because this fetches a URL a user typed, it only fetches
// https, refuses hosts that resolve to private or loopback addresses, follows
// at most three redirects (re-checking each hop), caps the size, and trusts
// the file's first bytes rather than its claimed Content-Type.
var dns = require('node:dns').promises;
var net = require('node:net');

var BUCKET = 'official-photos';
var MAX_BYTES = 5 * 1024 * 1024;   // matches the bucket's file_size_limit
var TIMEOUT_MS = 15000;
var MAX_REDIRECTS = 3;

// Legacy JWT service keys go in both headers, as the rest of api/ does. The
// newer sb_secret_ keys are not JWTs and go in apikey alone.
function serviceHeaders(key, extra) {
  var h = { apikey: key };
  if (!/^sb_/.test(key)) h.Authorization = 'Bearer ' + key;
  return Object.assign(h, extra || {});
}

function hostedPrefix(supabaseUrl) {
  return supabaseUrl.replace(/\/+$/, '') + '/storage/v1/object/public/' + BUCKET + '/';
}

// True for a URL that already points at our bucket, so saving a form that
// still shows the hosted copy does not re-import it.
function isHosted(supabaseUrl, url) {
  return typeof url === 'string' && url.indexOf(hostedPrefix(supabaseUrl)) === 0;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    var p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  var a = address.toLowerCase();
  if (a.indexOf('::ffff:') === 0) return isPrivateAddress(a.slice(7));
  return a === '::1' || a === '::' || a.indexOf('fc') === 0 || a.indexOf('fd') === 0 || a.indexOf('fe80') === 0;
}

async function assertFetchable(rawUrl) {
  var url;
  try { url = new URL(rawUrl); } catch (e) { throw new Error('That is not a valid web address.'); }
  if (url.protocol !== 'https:') throw new Error('Photo addresses must start with https://.');
  if (url.username || url.password) throw new Error('Photo addresses cannot contain a login.');
  var host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) throw new Error('Use the photo’s web address, not a bare IP address.');
  var addresses = await dns.lookup(host, { all: true }).catch(function () {
    throw new Error('Could not find the site ' + host + '.');
  });
  if (!addresses.length || addresses.some(function (a) { return isPrivateAddress(a.address); })) {
    throw new Error('That address points somewhere this server will not fetch from.');
  }
  return url;
}

function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return { mime: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

// Download with every guard above. Resolves to { bytes, mime, ext }.
async function downloadImage(sourceUrl) {
  var current = sourceUrl;
  for (var hop = 0; hop <= MAX_REDIRECTS; hop++) {
    var url = await assertFetchable(current);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    var res;
    try {
      res = await fetch(url.href, {
        redirect: 'manual',
        signal: controller.signal,
        // Some city sites (WordPress behind a WAF) refuse requests with no
        // browser-like User-Agent.
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiamiDadeCommissionWatch/1.0; +https://www.miamidadecommissionwatch.com)', Accept: 'image/*' }
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(err && err.name === 'AbortError' ? 'The photo took too long to download.' : 'Could not reach ' + url.hostname + '.');
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      current = new URL(res.headers.get('location'), url).href;
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new Error(url.hostname + ' answered HTTP ' + res.status + ' for that photo.');
    }
    var declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) {
      clearTimeout(timer);
      throw new Error('That photo is larger than 5 MB.');
    }

    var chunks = [];
    var total = 0;
    try {
      for await (var chunk of res.body) {
        total += chunk.length;
        if (total > MAX_BYTES) throw new Error('That photo is larger than 5 MB.');
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      clearTimeout(timer);
    }
    var bytes = Buffer.concat(chunks);
    var kind = sniffImage(bytes);
    if (!kind) throw new Error('That address did not return a JPEG, PNG, WebP or GIF image.');
    return { bytes: bytes, mime: kind.mime, ext: kind.ext };
  }
  throw new Error('That photo address redirects too many times.');
}

// Download, upload, and repoint the row. `official` needs id; `citySlug` is
// the folder. Resolves to the new public URL; throws with a readable message.
async function importPhoto(opts) {
  var supabaseUrl = opts.supabaseUrl.replace(/\/+$/, '');
  var key = opts.serviceKey;
  var image = await downloadImage(opts.sourceUrl);

  var path = encodeURIComponent(opts.citySlug) + '/' + encodeURIComponent(opts.officialId) + '.' + image.ext;
  var up = await fetch(supabaseUrl + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'POST',
    headers: serviceHeaders(key, {
      'Content-Type': image.mime,
      'x-upsert': 'true',
      'cache-control': '3600'
    }),
    body: image.bytes
  });
  if (!up.ok) {
    throw new Error('Storage refused the upload (HTTP ' + up.status + '): ' + (await up.text()).slice(0, 200));
  }

  // The version stamp makes a replaced photo show at once instead of after
  // the CDN's copy of the old one expires; the path itself stays stable.
  var publicUrl = hostedPrefix(supabaseUrl) + path + '?v=' + Date.now();

  var patch = await fetch(supabaseUrl + '/rest/v1/city_officials?id=eq.' + encodeURIComponent(opts.officialId), {
    method: 'PATCH',
    headers: serviceHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      photo_url: publicUrl,
      photo_source_url: opts.sourceUrl,
      updated_at: new Date().toISOString()
    })
  });
  if (!patch.ok) throw new Error('Saved the photo but could not update the official (HTTP ' + patch.status + ').');
  var rows = await patch.json();
  if (!rows || !rows.length) throw new Error('Saved the photo but that official no longer exists.');
  return publicUrl;
}

// ---------- the dashboard route: { op: 'import_official_photo', official_id, source_url } ----------
async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured for photo imports.' });
    return;
  }

  var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var body = req.body || {};
  var officialId = typeof body.official_id === 'string' ? body.official_id : '';
  var sourceUrl = typeof body.source_url === 'string' ? body.source_url.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(officialId) || !sourceUrl || sourceUrl.length > 2000) {
    res.status(400).json({ error: 'An official and a photo address are required.' });
    return;
  }
  if (isHosted(SUPABASE_URL, sourceUrl)) {
    res.status(200).json({ ok: true, photo_url: sourceUrl });
    return;
  }

  var headers = serviceHeaders(SERVICE_ROLE_KEY, { 'Content-Type': 'application/json' });

  try {
    var callerRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SERVICE_ROLE_KEY }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Your session has expired. Log out and back in, then try again.' });
      return;
    }
    var caller = await callerRes.json();

    var offRes = await fetch(
      SUPABASE_URL + '/rest/v1/city_officials?id=eq.' + officialId + '&select=id,city_id,cities(slug)',
      { headers: headers }
    );
    var official = (await offRes.json())[0];
    if (!official || !official.cities) {
      res.status(404).json({ error: 'That official no longer exists.' });
      return;
    }

    // Same people who may edit the row under RLS (migration_17): active
    // staff, or an owner or editor of this official's city. Checked against
    // the tables, not taken from the request.
    var roleRes = await fetch(SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + caller.id + '&select=role,status', { headers: headers });
    var staffRow = (await roleRes.json())[0];
    var isStaff = !!(staffRow && staffRow.status === 'active' && (staffRow.role === 'owner' || staffRow.role === 'admin'));
    if (!isStaff) {
      var memRes = await fetch(
        SUPABASE_URL + '/rest/v1/city_memberships?user_id=eq.' + caller.id +
          '&city_id=eq.' + official.city_id + '&select=role',
        { headers: headers }
      );
      var membership = (await memRes.json())[0];
      if (!membership || (membership.role !== 'owner' && membership.role !== 'editor')) {
        res.status(403).json({ error: 'You can only change photos for your own city.' });
        return;
      }
    }

    // Each import is an outbound download; 60 an hour per person is far more
    // than a roster needs and caps what a hijacked account could make us fetch.
    var limitRes = await fetch(SUPABASE_URL + '/rest/v1/rpc/check_rate_limit', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ p_key: 'officialphoto:' + caller.id, p_limit: 60, p_window_seconds: 3600 })
    }).catch(function () { return null; });
    if (limitRes && limitRes.ok && (await limitRes.json()) === false) {
      res.status(429).json({ error: 'That is a lot of photo imports for one hour. Try again later.' });
      return;
    }

    var photoUrl = await importPhoto({
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_ROLE_KEY,
      officialId: official.id,
      citySlug: official.cities.slug,
      sourceUrl: sourceUrl
    });
    res.status(200).json({ ok: true, photo_url: photoUrl });
  } catch (err) {
    // importPhoto's messages are written for the person who pasted the URL.
    res.status(422).json({ error: (err && err.message) || 'Could not import that photo.' });
  }
}

module.exports = handler;
module.exports.importPhoto = importPhoto;
module.exports.downloadImage = downloadImage;
module.exports.isHosted = isHosted;
module.exports.serviceHeaders = serviceHeaders;
