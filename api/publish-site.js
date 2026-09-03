// Trigger a rebuild of the public site.
//
// Supabase is the source of truth, but nothing in it reaches a visitor until
// scripts/build.mjs prerenders it into the HTML at deploy time -- and
// js/meetings-feed.js deliberately skips its runtime fetch when the list is
// prerendered, because fetching again would append a second copy of every
// meeting. So a meeting saved in the dashboard is invisible to the public until
// someone deploys. Before this endpoint existed the only way to deploy was to
// push a commit, which meant editorial content shipped on a developer's
// schedule. A September 1 recap sat unseen in the database for nine hours that
// way.
//
// This posts to a Vercel Deploy Hook, which starts a production build of the
// default branch. The hook URL is a bearer credential -- anyone holding it can
// spend build minutes -- so it lives in the VERCEL_DEPLOY_HOOK_URL environment
// variable, never in the repo and never in a response body. The browser only
// ever learns whether the build started.
//
// Set it in Vercel: Settings -> Git -> Deploy Hooks creates the URL, then
// Settings -> Environment Variables stores it under VERCEL_DEPLOY_HOOK_URL.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var HOOK_URL = process.env.VERCEL_DEPLOY_HOOK_URL;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }
  if (!HOOK_URL) {
    res.status(500).json({
      error: 'No deploy hook is configured. Add VERCEL_DEPLOY_HOOK_URL in the Vercel project settings.'
    });
    return;
  }

  // The hook URL comes from our own environment, not from the request, so this
  // is a configuration check rather than a defence against a hostile caller --
  // but a typo that pointed it at some other host would quietly turn this
  // endpoint into a request forwarder, so refuse anything that is not Vercel.
  if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\//.test(HOOK_URL)) {
    res.status(500).json({ error: 'The configured deploy hook is not a Vercel deploy hook URL.' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    // ---------- caller must be active staff ----------
    var callerRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SERVICE_ROLE_KEY }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    var caller = await callerRes.json();

    var roleRes = await fetch(
      SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + caller.id + '&select=role,status',
      { headers: serviceHeaders }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    if (!callerRole || callerRole.status !== 'active' ||
        (callerRole.role !== 'owner' && callerRole.role !== 'admin')) {
      res.status(403).json({ error: 'Only staff can publish the site.' });
      return;
    }

    // ---------- start the build ----------
    var hookRes = await fetch(HOOK_URL, { method: 'POST' });
    var hookBody = null;
    try { hookBody = await hookRes.json(); } catch (err) { hookBody = null; }

    if (!hookRes.ok) {
      // Never echo the hook response verbatim -- it can carry the project and
      // hook identifiers back to the browser.
      res.status(502).json({
        error: 'Vercel refused the build request (HTTP ' + hookRes.status + '). Check the deploy hook in the project settings.'
      });
      return;
    }

    var job = hookBody && hookBody.job ? hookBody.job : {};
    res.status(200).json({
      ok: true,
      job_id: job.id || null,
      state: job.state || 'PENDING'
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not reach Vercel to start the build.' });
  }
};
