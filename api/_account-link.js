// Creates (or finds) the login behind an approval or an invite, and hands back
// the link the email should carry.
//
// This replaces a helper pair that was copy-pasted into three endpoints, both
// halves of which were wrong:
//
//   1. They created the account with /auth/v1/invite, which *sends Supabase's
//      own generic "You've been invited to create an account" email*. So the
//      person got that instead of ours -- and ours, the one that explains what
//      city they now run, arrived second if at all.
//
//   2. They passed the landing page as `options.redirect_to`. That is the
//      supabase-js shape; the REST endpoint takes `redirect_to` at the top
//      level and ignores anything it doesn't recognise. The link therefore
//      fell back to the project's Site URL -- which is why clicking it landed
//      on the homepage with an error in the hash instead of on set-password.
//
// /admin/generate_link fixes both at once: it creates the user when the
// address is new, it never sends mail itself, and it returns the user id and
// the link together. The only email that goes out is the one the caller
// writes.
//
// NOTE: GoTrue only honours redirect_to if the URL is on the project's
// redirect allow-list (Authentication -> URL Configuration -> Redirect URLs).
// If it isn't, the link silently falls back to the Site URL again.
var SET_PASSWORD_URL = 'https://www.miamidadecommissionwatch.com/set-password.html';

// -> { userId, link }. Either can be null: a null userId means we could not
// create or find the account and the caller should stop; a null link means the
// account is fine but we could not mint a link, and the email should fall back
// to telling them to use "forgot password".
module.exports = async function createOrFindAccount(SUPABASE_URL, headers, email) {
  // 'invite' creates the account. It fails for an address that already has a
  // login -- a student who volunteered on another city first -- and 'recovery'
  // then covers that case, since a recovery link doubles as a set-password
  // link either way.
  var invited = await generateLink(SUPABASE_URL, headers, 'invite', email);
  if (invited.userId) return invited;

  var recovery = await generateLink(SUPABASE_URL, headers, 'recovery', email);
  if (recovery.userId) return recovery;

  // Both link calls failed. The account may still exist, and the membership
  // write needs its id more than the email needs a link.
  return { userId: await findUserId(SUPABASE_URL, headers, email), link: null };
};

async function generateLink(SUPABASE_URL, headers, type, email) {
  try {
    var r = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        type: type,
        email: email,
        redirect_to: SET_PASSWORD_URL
      })
    });
    if (!r.ok) return { userId: null, link: null };
    var data = await r.json();
    // GoTrue returns the user's own fields at the top level with the link
    // beside them; some versions nest them under user/properties instead.
    return {
      userId: (data.user && data.user.id) || data.id || null,
      link: data.action_link || (data.properties && data.properties.action_link) || null
    };
  } catch (err) {
    return { userId: null, link: null };
  }
}

async function findUserId(SUPABASE_URL, headers, email) {
  try {
    var r = await fetch(
      SUPABASE_URL + '/auth/v1/admin/users?filter=' + encodeURIComponent(email),
      { headers: headers }
    );
    if (!r.ok) return null;
    var data = await r.json();
    var users = (data && data.users) || [];
    for (var i = 0; i < users.length; i++) {
      if (users[i].email && users[i].email.toLowerCase() === email.toLowerCase()) {
        return users[i].id;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}
