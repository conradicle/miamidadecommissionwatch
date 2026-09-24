// Saving an official's photo from the two dashboards (admin.html's Cities tab
// and city-admin.html).
//
// A pasted photo address is never stored as-is. City websites are not in the
// CSP's img-src, so a hotlinked photo would be blocked on the city page;
// instead the row is saved first and then api/city-platform.js
// { op: 'import_official_photo' } downloads the image on the server, puts it
// in the official-photos bucket and repoints the row. The browser cannot do
// the copy itself: it is not allowed to read another site's image bytes.
//
// Plain global, matching the rest of js/ (no build step, no modules). Needs
// js/supabase-client.js loaded first for SUPABASE_URL and supabaseClient.
(function () {
  var PREFIX = String(window.SUPABASE_URL || '').replace(/\/+$/, '') +
    '/storage/v1/object/public/official-photos/';

  // Already a copy in our bucket (for example, the form still showing the
  // current photo), so there is nothing to import.
  function isHosted(url) {
    return typeof url === 'string' && url.indexOf(PREFIX) === 0;
  }

  // What to write to photo_url in the save itself, given the form value and
  // whether this is an existing row. An external URL is left out (update) or
  // null (insert) -- the import sets it once the copy exists.
  //   returns { fields: {...columns to merge into the row}, importUrl: string|null }
  function planSave(formValue, isExisting) {
    var value = formValue ? String(formValue).trim() : '';
    if (!value) return { fields: { photo_url: null, photo_source_url: null }, importUrl: null };
    if (isHosted(value)) return { fields: { photo_url: value }, importUrl: null };
    return { fields: isExisting ? {} : { photo_url: null }, importUrl: value };
  }

  // Resolves, never rejects, with { ok, message, photoUrl }.
  function importFromUrl(officialId, sourceUrl) {
    return window.supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        return { ok: false, message: 'Your session has expired. Log out and back in, then try again.' };
      }
      return fetch('/api/city-platform', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ op: 'import_official_photo', official_id: officialId, source_url: sourceUrl })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (data) {
            if (!r.ok) return { ok: false, message: data.error || 'Could not copy the photo.' };
            return { ok: true, message: '', photoUrl: data.photo_url };
          });
        })
        .catch(function () {
          return { ok: false, message: 'Could not reach the server.' };
        });
    });
  }

  window.OfficialPhoto = { isHosted: isHosted, planSave: planSave, importFromUrl: importFromUrl };
})();
