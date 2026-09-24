// Rebuild the public site after an editorial goes live or comes down.
//
// Called by the row triggers in supabase/migration_24 (via pg_net) whenever an
// editorial_submissions row moves into or out of 'approved'. It waits until
// changes stop arriving, then posts once to the Vercel deploy hook, so
// approving five pieces in a row starts one build, not five.
//
// Debounce: every call records itself in public.site_rebuild_state and then
// sleeps QUIET_SECONDS in the background. When it wakes, it deploys only if
// no newer change came in meanwhile -- the newest call always wins -- or if
// the batch has already waited MAX_WAIT_SECONDS. claim_site_rebuild() does
// that check and the reset in one statement, so exactly one call per batch
// deploys. A change that lands after a build has started opens a new batch
// and gets its own build; nothing is dropped.
//
// The hook URL is a bearer credential (anyone holding it can start builds),
// so it lives only in this function's secrets, never in the repo, a response
// body, or a log line. Same rule as api/publish-site.js.
//
// Secret to set (Edge Functions -> Secrets, or `supabase secrets set`):
//   VERCEL_DEPLOY_HOOK_URL  the Vercel deploy hook, same one api/publish-site uses
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform. The
// shared webhook secret is read from Vault (rebuild_site_webhook_secret(),
// migration_24), so it never has to be copied by hand.
//
// Deploy with JWT verification OFF -- pg_net calls without a user token, and
// the x-webhook-secret check below is the gate instead:
//   supabase functions deploy rebuild-site --no-verify-jwt --project-ref kpchirnlgjwdqducqdtx

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// A minute of quiet, and never more than three minutes behind the first change.
// Both stay well under the Edge Function wall-clock limit (150s on the free
// plan counts from each call, and each call sleeps only QUIET_SECONDS).
const QUIET_SECONDS = 60;
const MAX_WAIT_SECONDS = 180;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const HOOK_URL = Deno.env.get('VERCEL_DEPLOY_HOOK_URL') ?? '';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Constant-time compare, so the secret cannot be guessed a byte at a time.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`${name} answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Leaves the failure where staff can find it (site_rebuild_state.last_error)
// in addition to the function log. The hourly scripts/check-live.mjs run is
// the backstop that repairs a deploy that never happened.
async function recordError(message: string): Promise<void> {
  console.error(message);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/site_rebuild_state?id=eq.1`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ last_error: message, last_error_at: new Date().toISOString() })
    });
  } catch {
    // Already logged above; nothing more to do.
  }
}

async function deployWhenQuiet(requestId: string): Promise<void> {
  try {
    await new Promise((resolve) => setTimeout(resolve, QUIET_SECONDS * 1000));

    const claimed = await rpc('claim_site_rebuild', {
      p_request_id: requestId,
      p_max_wait_seconds: MAX_WAIT_SECONDS
    });
    if (claimed !== true) {
      console.log('A newer change is waiting; it will start the build.');
      return;
    }

    const res = await fetch(HOOK_URL, { method: 'POST' });
    if (!res.ok) {
      // The status only -- the body can echo project and hook identifiers.
      await recordError(`Vercel refused the build request (HTTP ${res.status}).`);
      return;
    }
    console.log('Rebuild requested.');
  } catch (err) {
    await recordError(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Read once per warm instance. Only a successful read is cached, so a secret
// created after the function first ran is picked up on the next call.
let webhookSecret = '';
async function getWebhookSecret(): Promise<string> {
  if (!webhookSecret) {
    const value = await rpc('rebuild_site_webhook_secret', {});
    if (typeof value === 'string') webhookSecret = value;
  }
  return webhookSecret;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !HOOK_URL) {
    console.error('rebuild-site is missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or VERCEL_DEPLOY_HOOK_URL.');
    return json(500, { error: 'Not configured' });
  }

  let secret = '';
  try {
    secret = await getWebhookSecret();
  } catch (err) {
    console.error(`Could not read the webhook secret: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!secret || !sameSecret(req.headers.get('x-webhook-secret') ?? '', secret)) {
    return json(401, { error: 'Unauthorized' });
  }
  // A typo pointing this at some other host would quietly turn it into a
  // request forwarder, so refuse anything that is not a Vercel deploy hook.
  if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\//.test(HOOK_URL)) {
    console.error('VERCEL_DEPLOY_HOOK_URL is not a Vercel deploy hook URL.');
    return json(500, { error: 'Not configured' });
  }

  let payload: {
    table?: string;
    record?: { status?: string } | null;
    old_record?: { status?: string } | null;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Expected a JSON body' });
  }

  // The trigger's WHEN clause already filters, but this function should not
  // rely on being wired up exactly one way: ignore anything the public page
  // cannot see.
  const wasPublic = payload.old_record?.status === 'approved';
  const isPublic = payload.record?.status === 'approved';
  if (payload.table !== 'editorial_submissions' || wasPublic === isPublic) {
    return json(200, { ok: true, ignored: true });
  }

  let requestId: unknown;
  try {
    requestId = await rpc('note_site_rebuild_request', {});
  } catch (err) {
    await recordError(`Could not record the change: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: 'Could not record the change' });
  }
  if (typeof requestId !== 'string') {
    await recordError('note_site_rebuild_request returned no id. Is the site_rebuild_state row missing?');
    return json(500, { error: 'Could not record the change' });
  }

  // Answer pg_net now and wait in the background; its timeout is 5 seconds.
  EdgeRuntime.waitUntil(deployWhenQuiet(requestId));
  return json(202, { ok: true, queued: true });
});
