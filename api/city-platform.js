// One entry point for the city-platform actions, and for the staff document
// operations that also need the service role.
//
// Vercel's Hobby plan allows 12 Serverless Functions per deployment and this
// project was already at the ceiling, so filing a claim, deciding a claim and
// inviting an editor share a function instead of having one each. The actual
// logic still lives in a file per concern -- a leading underscore keeps those
// out of the function count -- and this dispatches to them.
//
// Each handler does its own authorization. Nothing is checked here beyond the
// op name, because the three have genuinely different rules: filing a claim is
// public, deciding one is staff-only, and inviting an editor requires owning
// the city named in the body.
//
// The dispatch key is `op`, not `action`, because _decide-claim.js already
// uses `action` for approve-versus-deny. Reusing the name put two `action`
// keys in the same JSON object, where the second silently won.
var submitClaim = require('./_submit-claim.js');
var decideClaim = require('./_decide-claim.js');
var cityInvite = require('./_city-invite.js');
var staffOps = require('./_staff-ops.js');
var officialPhoto = require('./_official-photo.js');
var documents = require('./_documents.js');
var bccSignup = require('./_bcc-signup.js');

var OPS = {
  submit_claim: submitClaim,
  decide_claim: decideClaim,
  invite_editor: cityInvite,

  // Staff or a member of the official's city: copies a pasted photo URL into
  // our own Storage so the city page's CSP will load it.
  import_official_photo: officialPhoto,

  // Staff-only, all three handled by one module because they share the same
  // "is this an active staff member" preamble.
  provision_domain: staffOps,
  transfer_ownership: staffOps,
  decide_invite: staffOps,

  // Staff-only official documents (Meeting and Agenda Summaries). Here rather
  // than in a function of their own only because of the Hobby plan ceiling
  // above; they share nothing else with the city platform.
  save_document_draft: documents,
  publish_document_version: documents,
  discard_document_draft: documents,

  // Public: a sign-up for the next BCC meeting from /attend. Turnstile-gated
  // inside the handler. Here for the same ceiling reason.
  submit_bcc_signup: bccSignup
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var op = req.body && req.body.op;
  var target = OPS[op];
  if (!target) {
    res.status(400).json({ error: 'Unknown operation' });
    return;
  }

  return target(req, res);
};
