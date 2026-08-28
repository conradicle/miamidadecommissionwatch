// One entry point for the three city-platform actions.
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

var OPS = {
  submit_claim: submitClaim,
  decide_claim: decideClaim,
  invite_editor: cityInvite,

  // Staff-only, all three handled by one module because they share the same
  // "is this an active staff member" preamble.
  provision_domain: staffOps,
  transfer_ownership: staffOps,
  decide_invite: staffOps
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
