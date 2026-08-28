// Creates a city's subdomain: the Cloudflare DNS record and the Vercel domain.
//
// This was the last manual step in an otherwise self-serve flow -- approving a
// claim made a city live in the database but its address 404'd until somebody
// opened two dashboards. Now approval calls this, and staff can re-run it from
// the Cities tab if it failed or if the city predates the automation.
//
// BOTH STEPS ARE IDEMPOTENT. Re-running is how you retry, so "already exists"
// from either provider is success, not an error. That matters because the two
// calls can half-succeed: a DNS record with no Vercel domain serves nothing,
// and a Vercel domain with no DNS record never verifies.
//
// PROVISIONING NEVER FAILS THE THING THAT CALLED IT. A city whose claim was
// approved is live in the database whatever happens here; its address can be
// fixed afterwards. The reverse -- refusing to approve because an API call
// failed -- would leave a student with nothing.

var ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'miamidadecommissionwatch.com';

// The CNAME target is per Vercel project, not a generic hostname. Vercel shows
// it on the domain row; the legacy cname.vercel-dns.com also works.
var DNS_TARGET = process.env.CITY_DNS_TARGET || '01e74edb75f50fad.vercel-dns-017.com';

// Not secrets -- these identify the project, they do not grant access to it.
// Defaulted so the only thing that has to be configured is the two tokens.
var VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_5cHJwL6b0CypR2DztuZBgzY10pkc';
var VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

// Cloudflare must stay DNS-only. Proxying a Vercel domain through Cloudflare
// breaks certificate issuance, and the orange cloud is the single most common
// way to take one of these subdomains offline.
var PROXIED = false;

async function provisionSubdomain(slug) {
  var result = {
    slug: slug,
    host: slug + '.' + ROOT_DOMAIN,
    configured: true,
    dns: null,
    domain: null,
    ok: false
  };

  var CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  var CF_ZONE = process.env.CLOUDFLARE_ZONE_ID;
  var VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

  if (!CF_TOKEN || !CF_ZONE || !VERCEL_TOKEN) {
    result.configured = false;
    result.error = 'Subdomain automation is not configured on the server. ' +
      'Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID and VERCEL_API_TOKEN.';
    return result;
  }

  result.dns = await createDnsRecord(CF_TOKEN, CF_ZONE, slug);
  result.domain = await addVercelDomain(VERCEL_TOKEN, result.host);
  result.ok = result.dns.ok && result.domain.ok;

  if (!result.ok) {
    result.error = [result.dns.error, result.domain.error].filter(Boolean).join(' ');
  }
  return result;
}

// ---------- Cloudflare ----------
async function createDnsRecord(token, zoneId, slug) {
  try {
    var res = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'CNAME',
        name: slug,
        content: DNS_TARGET,
        proxied: PROXIED,
        ttl: 1, // 1 means "automatic" to Cloudflare
        comment: 'City subdomain, created by Commission Watch'
      })
    });
    var data = await res.json().catch(function () { return {}; });

    if (res.ok && data.success) return { ok: true, state: 'created' };

    // 81053/81057 are Cloudflare's "a record with this name already exists".
    // That is the state we want, so it counts as success.
    var errors = (data && data.errors) || [];
    for (var i = 0; i < errors.length; i++) {
      if (errors[i].code === 81053 || errors[i].code === 81057 ||
          /already exists/i.test(errors[i].message || '')) {
        return { ok: true, state: 'already existed' };
      }
    }

    return {
      ok: false,
      state: 'failed',
      error: 'Cloudflare: ' + ((errors[0] && errors[0].message) || 'could not create the DNS record.')
    };
  } catch (err) {
    return { ok: false, state: 'failed', error: 'Cloudflare: could not be reached.' };
  }
}

// ---------- Vercel ----------
async function addVercelDomain(token, host) {
  try {
    var url = 'https://api.vercel.com/v10/projects/' +
      encodeURIComponent(VERCEL_PROJECT_ID) + '/domains';
    if (VERCEL_TEAM_ID) url += '?teamId=' + encodeURIComponent(VERCEL_TEAM_ID);

    var res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: host })
    });
    var data = await res.json().catch(function () { return {}; });

    if (res.ok) return { ok: true, state: 'added' };

    var code = (data && data.error && data.error.code) || '';
    if (res.status === 409 || code === 'domain_already_in_use' ||
        /already/i.test((data.error && data.error.message) || '')) {
      return { ok: true, state: 'already added' };
    }

    return {
      ok: false,
      state: 'failed',
      error: 'Vercel: ' + ((data.error && data.error.message) || 'could not add the domain.')
    };
  } catch (err) {
    return { ok: false, state: 'failed', error: 'Vercel: could not be reached.' };
  }
}

module.exports = provisionSubdomain;
module.exports.provisionSubdomain = provisionSubdomain;
