// The city team's dashboard (/city-admin.html).
//
// Who sees what is decided by city_memberships, not by this file. Every query
// below runs as the signed-in user, so Row Level Security answers "which
// cities?" by itself -- selecting from `cities` here returns exactly the ones
// this person holds a role on, and nothing else. There is no city id in a URL
// to tamper with.
//
// Two rules the UI reflects but does NOT enforce, both from migration_17:
//   * an editor cannot publish -- guard_publish_rights rejects it
//   * an owner cannot rename their slug, publish their city, change its
//     governance or lift a suspension -- guard_city_staff_columns rejects it
// Hiding those controls is courtesy. Deleting this file would not grant them.
(function () {
  var session = null;
  var memberships = [];   // [{ city_id, role }]
  var cities = [];
  var current = null;
  var role = null;        // role on the CURRENT city
  var officials = [];
  var meetings = [];
  var team = [];

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    var node = el('ca-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function reportError(prefix, error) {
    var detail = (error && (error.message || error.details)) || 'Unknown error';
    setStatus(prefix + ': ' + detail, 'error');
  }

  function val(id) { var n = el(id); return n ? n.value.trim() : ''; }
  function checked(id) { var n = el(id); return !!(n && n.checked); }
  function orNull(v) { return v === '' ? null : v; }

  function badge(status) {
    return '<span class="ac-badge ac-badge-' + status + '">' +
      (status === 'published' ? 'live' : 'draft') + '</span>';
  }

  // An editor's writes must stay drafts. The trigger enforces it; this keeps
  // the UI from asking for something that will be refused.
  function statusFor(checkboxId) {
    if (role !== 'owner') return 'draft';
    return checked(checkboxId) ? 'published' : 'draft';
  }

  // Live rows are the owner's to change or remove (supabase/migration_27).
  // The trigger refuses an editor's save or delete with a message; this just
  // keeps the Delete button off rows it would refuse.
  function canRemove(row) {
    return role === 'owner' || row.status !== 'published';
  }

  // ---------- boot ----------
  function start() {
    window.supabaseClient.auth.getSession().then(function (res) {
      session = res && res.data && res.data.session;
      if (!session) {
        window.location.href = '/login.html';
        return;
      }
      el('logout-btn').style.display = 'inline-flex';

      // RLS scopes this to cities the user holds a membership on.
      return window.supabaseClient
        .from('city_memberships')
        .select('city_id, role')
        .eq('user_id', session.user.id)
        .then(function (memberRes) {
          if (memberRes.error) { reportError('Could not load your cities', memberRes.error); return; }
          memberships = memberRes.data || [];
          if (!memberships.length) {
            setStatus('This account isn’t on any city team. If you were expecting access, ' +
              'ask whoever invited you to check.', 'error');
            return;
          }
          return loadCities();
        });
    });
  }

  function roleFor(cityId) {
    var m = memberships.filter(function (x) { return x.city_id === cityId; })[0];
    return m ? m.role : null;
  }

  function loadCities() {
    return window.supabaseClient
      .from('cities')
      .select('*')
      .in('id', memberships.map(function (m) { return m.city_id; }))
      .order('name', { ascending: true })
      .then(function (res) {
        if (res.error) { reportError('Could not load your cities', res.error); return; }
        cities = res.data || [];
        if (!cities.length) {
          setStatus('Your city isn’t set up yet. Check back shortly.', 'error');
          return;
        }

        el('ca-shell').style.display = '';
        el('ca-city-select').innerHTML = cities.map(function (c) {
          return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>';
        }).join('');
        // A one-city team is the normal case; hide a pointless dropdown.
        el('ca-city-select').parentNode.style.display = cities.length > 1 ? '' : 'none';

        selectCity(cities[0]);
      });
  }

  function selectCity(city) {
    current = city;
    role = roleFor(city.id);

    document.body.classList.toggle('is-city-owner', role === 'owner');
    el('ca-title').textContent = city.name;
    el('ca-role-label').textContent = role === 'owner' ? 'You own this city' : 'You’re an editor here';
    el('ca-editor-hint').style.display = role === 'owner' ? 'none' : '';
    el('ca-public-link').href = 'https://' + city.slug + '.miamidadecommissionwatch.com/';

    if (!city.is_published) {
      setStatus('This city isn’t visible to the public yet. Staff turn that on once you’ve ' +
        'got something on it.', '');
    } else {
      setStatus('');
    }

    fillAbout(city);
    fillBoundary(city);
    loadOfficials();
    loadMeetings();
    if (role === 'owner') loadTeam();
  }

  // ---------- about & comment ----------
  function fillAbout(city) {
    el('ca-body').value = city.body_name || '';
    el('ca-website').value = city.website || '';
    el('ca-next-note').value = city.next_meeting_note || '';
    el('ca-comment-guide').value = city.comment_guide || '';

    var next = '';
    if (city.next_meeting_at) {
      var d = new Date(city.next_meeting_at);
      var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      next = local.toISOString().slice(0, 16);
    }
    el('ca-next-meeting').value = next;
  }

  function saveAbout(e) {
    e.preventDefault();
    var nextRaw = val('ca-next-meeting');
    setStatus('Saving…');

    window.supabaseClient
      .from('cities')
      .update({
        body_name: val('ca-body'),
        website: orNull(val('ca-website')),
        next_meeting_at: nextRaw ? new Date(nextRaw).toISOString() : null,
        next_meeting_note: orNull(val('ca-next-note')),
        comment_guide: val('ca-comment-guide')
      })
      .eq('id', current.id)
      .then(function (res) {
        if (res.error) { reportError('Could not save', res.error); return; }
        setStatus('Saved.', 'success');
      });
  }

  // ---------- officials ----------
  function loadOfficials() {
    return window.supabaseClient
      .from('city_officials')
      .select('*')
      .eq('city_id', current.id)
      .order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error) { reportError('Could not load officials', res.error); return; }
        officials = res.data || [];
        el('ca-count-officials').textContent = officials.length || '';
        renderOfficials();
      });
  }

  function renderOfficials() {
    var host = el('ca-officials-list');
    if (!officials.length) {
      host.innerHTML = '<p style="color:var(--ink-400); font-style:italic;">Nobody added yet.</p>';
      return;
    }
    host.innerHTML = officials.map(function (o) {
      var seat = o.seat + (o.seat_type === 'district' && o.district != null ? ' · District ' + o.district : '');
      return '<div class="ac-row"><div class="ac-row-main">' +
        '<h4>' + escapeHtml(o.name) + badge(o.status) + '</h4>' +
        '<div class="ac-meta">' + escapeHtml(seat) + '</div></div>' +
        '<div class="submission-actions">' +
        '<button type="button" class="btn btn-secondary btn-small" data-edit-official="' + escapeHtml(o.id) + '">Edit</button>' +
        (canRemove(o) ? '<button type="button" class="btn btn-danger btn-small" data-delete-official="' + escapeHtml(o.id) + '">Remove</button>' : '') +
        '</div></div>';
    }).join('');
  }

  function syncDistrictField() {
    var isDistrict = val('ca-official-seat-type') === 'district';
    el('ca-official-district-field').style.display = isDistrict ? '' : 'none';
    if (!isDistrict) el('ca-official-district').value = '';
  }

  function resetOfficialForm() {
    el('ca-official-form').reset();
    el('ca-official-id').value = '';
    el('ca-official-form-title').textContent = 'Add a commissioner';
    syncDistrictField();
  }

  function saveOfficial(e) {
    e.preventDefault();
    setStatus('Saving…');

    var isDistrict = val('ca-official-seat-type') === 'district';
    var districtRaw = val('ca-official-district');

    // An at-large city has no districts to assign, so refuse rather than
    // silently writing a number the map would then have to ignore.
    if (isDistrict && current.governance === 'at-large') {
      setStatus('Every seat in ' + current.name + ' is elected citywide, so a seat can’t belong ' +
        'to a district. If that’s wrong, ask staff to correct the city’s governance type.', 'error');
      return;
    }

    var row = {
      city_id: current.id,
      name: val('ca-official-name'),
      seat: val('ca-official-seat'),
      seat_type: val('ca-official-seat-type'),
      district: isDistrict && districtRaw ? parseInt(districtRaw, 10) : null,
      contact_email: orNull(val('ca-official-email')),
      contact_url: orNull(val('ca-official-url')),
      term_ends: orNull(val('ca-official-term')),
      sort_order: parseInt(val('ca-official-order') || '0', 10),
      status: statusFor('ca-official-published'),
      updated_at: new Date().toISOString()
    };

    var id = val('ca-official-id');
    // A pasted external photo is not saved as a hotlink: the row is saved
    // first, then the server copies the image into our bucket (see
    // js/official-photo.js).
    var photo = window.OfficialPhoto.planSave(val('ca-official-photo'), !!id);
    Object.assign(row, photo.fields);

    var query = id
      ? window.supabaseClient.from('city_officials').update(row).eq('id', id).select('id')
      : window.supabaseClient.from('city_officials').insert(row).select('id');

    query.then(function (res) {
      if (res.error) { reportError('Could not save', res.error); return; }
      var saved = res.data && res.data[0];
      if (!saved) { setStatus('Nothing was saved. Reload the page and try again.', 'error'); return; }
      if (!photo.importUrl) {
        setStatus('Saved.', 'success');
        resetOfficialForm();
        loadOfficials();
        return;
      }
      setStatus('Saved. Copying the photo…');
      window.OfficialPhoto.importFromUrl(saved.id, photo.importUrl).then(function (result) {
        if (result.ok) {
          setStatus('Saved, and the photo was copied to our storage.', 'success');
        } else {
          setStatus('Saved, but the photo could not be copied: ' + result.message +
            ' The official is saved without the new photo.', 'error');
        }
        resetOfficialForm();
        loadOfficials();
      });
    });
  }

  function editOfficial(id) {
    var o = officials.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    el('ca-official-id').value = o.id;
    el('ca-official-name').value = o.name || '';
    el('ca-official-seat').value = o.seat || '';
    el('ca-official-seat-type').value = o.seat_type || 'at-large';
    el('ca-official-district').value = o.district == null ? '' : o.district;
    el('ca-official-term').value = o.term_ends || '';
    el('ca-official-email').value = o.contact_email || '';
    el('ca-official-url').value = o.contact_url || '';
    el('ca-official-photo').value = o.photo_url || '';
    el('ca-official-order').value = o.sort_order == null ? 0 : o.sort_order;
    el('ca-official-published').checked = o.status === 'published';
    el('ca-official-form-title').textContent = 'Edit ' + o.name;
    syncDistrictField();
    el('ca-official-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteOfficial(id) {
    var o = officials.filter(function (x) { return x.id === id; })[0];
    if (!o || !window.confirm('Remove ' + o.name + '? This cannot be undone.')) return;
    window.supabaseClient.from('city_officials').delete().eq('id', id).then(function (res) {
      if (res.error) { reportError('Could not remove', res.error); return; }
      setStatus('Removed.', 'success');
      loadOfficials();
    });
  }

  // ---------- meetings ----------
  function loadMeetings() {
    return window.supabaseClient
      .from('city_meetings')
      .select('*')
      .eq('city_id', current.id)
      .order('meeting_date', { ascending: false })
      .then(function (res) {
        if (res.error) { reportError('Could not load meetings', res.error); return; }
        meetings = res.data || [];
        el('ca-count-meetings').textContent = meetings.length || '';
        renderMeetings();
      });
  }

  function renderMeetings() {
    var host = el('ca-meetings-list');
    if (!meetings.length) {
      host.innerHTML = '<p style="color:var(--ink-400); font-style:italic;">No meetings yet.</p>';
      return;
    }
    host.innerHTML = meetings.map(function (m) {
      return '<div class="ac-row"><div class="ac-row-main">' +
        '<h4>' + escapeHtml(m.title) + badge(m.status) + '</h4>' +
        '<div class="ac-meta">' + escapeHtml(m.meeting_date) + '</div></div>' +
        '<div class="submission-actions">' +
        '<button type="button" class="btn btn-secondary btn-small" data-edit-meeting="' + escapeHtml(m.id) + '">Edit</button>' +
        (canRemove(m) ? '<button type="button" class="btn btn-danger btn-small" data-delete-meeting="' + escapeHtml(m.id) + '">Delete</button>' : '') +
        '</div></div>';
    }).join('');
  }

  function resetMeetingForm() {
    el('ca-meeting-form').reset();
    el('ca-meeting-id').value = '';
    el('ca-meeting-title').value = 'Regular Meeting';
    el('ca-meeting-form-title').textContent = 'Add a meeting';
  }

  function saveMeeting(e) {
    e.preventDefault();
    setStatus('Saving…');

    var row = {
      city_id: current.id,
      meeting_date: val('ca-meeting-date'),
      title: val('ca-meeting-title'),
      agenda_url: orNull(val('ca-meeting-agenda')),
      video_url: orNull(val('ca-meeting-video')),
      summary: val('ca-meeting-summary'),
      status: statusFor('ca-meeting-published'),
      updated_at: new Date().toISOString()
    };

    var id = val('ca-meeting-id');
    var query = id
      ? window.supabaseClient.from('city_meetings').update(row).eq('id', id)
      : window.supabaseClient.from('city_meetings').insert(row);

    query.then(function (res) {
      if (res.error) { reportError('Could not save', res.error); return; }
      setStatus('Saved.', 'success');
      resetMeetingForm();
      loadMeetings();
    });
  }

  function editMeeting(id) {
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    el('ca-meeting-id').value = m.id;
    el('ca-meeting-date').value = m.meeting_date || '';
    el('ca-meeting-title').value = m.title || '';
    el('ca-meeting-agenda').value = m.agenda_url || '';
    el('ca-meeting-video').value = m.video_url || '';
    el('ca-meeting-summary').value = m.summary || '';
    el('ca-meeting-published').checked = m.status === 'published';
    el('ca-meeting-form-title').textContent = 'Edit meeting';
    el('ca-meeting-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteMeeting(id) {
    if (!window.confirm('Delete this meeting? This cannot be undone.')) return;
    window.supabaseClient.from('city_meetings').delete().eq('id', id).then(function (res) {
      if (res.error) { reportError('Could not delete', res.error); return; }
      setStatus('Deleted.', 'success');
      loadMeetings();
    });
  }

  // ---------- boundaries ----------
  function fillBoundary(city) {
    var explainer = el('ca-map-explainer');
    if (city.governance === 'at-large') {
      explainer.textContent = 'Every seat in ' + city.name + ' is elected citywide, so there are ' +
        'no districts to map. Upload a single shape holding the city limits and the map will ' +
        'draw the outline. Do not split it into districts the city does not have.';
    } else {
      explainer.textContent = city.name + ' elects by district, so this needs one shape per ' +
        'district, each with a numeric "district" property. That is what lets the map answer ' +
        '“you are in District 3”.';
    }

    var text = el('ca-boundary-text');
    text.value = city.boundary_geojson ? JSON.stringify(city.boundary_geojson, null, 2) : '';
    setBoundaryStatus(city.boundary_geojson
      ? 'Boundaries are loaded' + (city.boundary_updated_at
          ? ', last updated ' + new Date(city.boundary_updated_at).toLocaleDateString('en-US') : '') + '.'
      : 'No boundaries uploaded yet. The map section says so rather than showing an empty frame.');
  }

  function setBoundaryStatus(message, kind) {
    var node = el('ca-boundary-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function readBoundaryFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    // 6 MB is already far past what a simplified boundary should be; anything
    // bigger is a raw shapefile export and will make the page crawl on a phone.
    if (file.size > 6 * 1024 * 1024) {
      setBoundaryStatus('That file is ' + Math.round(file.size / 1048576) + ' MB. Simplify it first — ' +
        'see the README in assets/data/cities.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      el('ca-boundary-text').value = String(reader.result || '');
      setBoundaryStatus('Loaded ' + file.name + '. Check it looks right, then save.');
    };
    reader.onerror = function () { setBoundaryStatus('Could not read that file.', 'error'); };
    reader.readAsText(file);
  }

  // Validated here as well as by the CHECK constraint, because a person
  // pasting the wrong thing deserves a sentence explaining what is wrong
  // rather than a Postgres constraint name.
  function validateBoundary(raw) {
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { error: 'That isn’t valid JSON. If you exported from a GIS tool, make sure you ' +
        'chose GeoJSON rather than shapefile or KML.' };
    }
    if (!parsed || parsed.type !== 'FeatureCollection') {
      return { error: 'The top level needs to be a FeatureCollection. If you have a single ' +
        'Feature, wrap it: {"type":"FeatureCollection","features":[ your feature ]}.' };
    }
    if (!Array.isArray(parsed.features) || !parsed.features.length) {
      return { error: 'That FeatureCollection has no features in it.' };
    }
    if (current.governance === 'district') {
      var missing = parsed.features.filter(function (f) {
        return !f.properties || f.properties.district == null;
      }).length;
      if (missing) {
        return { error: missing + ' of ' + parsed.features.length + ' shapes have no "district" ' +
          'property. Without it the map can’t tell which district an address falls in.' };
      }
    }
    return { value: parsed };
  }

  function saveBoundary() {
    var raw = el('ca-boundary-text').value.trim();
    if (!raw) { setBoundaryStatus('Paste the GeoJSON or choose a file first.', 'error'); return; }

    var result = validateBoundary(raw);
    if (result.error) { setBoundaryStatus(result.error, 'error'); return; }

    setBoundaryStatus('Saving…');
    window.supabaseClient
      .from('cities')
      .update({ boundary_geojson: result.value, boundary_updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .then(function (res) {
        if (res.error) {
          setBoundaryStatus('Could not save: ' + (res.error.message || 'unknown error'), 'error');
          return;
        }
        current.boundary_geojson = result.value;
        setBoundaryStatus('Saved. ' + result.value.features.length +
          ' shape' + (result.value.features.length === 1 ? '' : 's') + ' are live on your map.', 'success');
      });
  }

  function clearBoundary() {
    if (!window.confirm('Remove the boundaries from your map?')) return;
    window.supabaseClient
      .from('cities')
      .update({ boundary_geojson: null, boundary_updated_at: null })
      .eq('id', current.id)
      .then(function (res) {
        if (res.error) { setBoundaryStatus('Could not remove: ' + res.error.message, 'error'); return; }
        current.boundary_geojson = null;
        el('ca-boundary-text').value = '';
        setBoundaryStatus('Removed.', 'success');
      });
  }

  // ---------- team ----------
  function loadTeam() {
    return window.supabaseClient
      .from('city_memberships')
      .select('user_id, role, created_at')
      .eq('city_id', current.id)
      .then(function (res) {
        if (res.error) { reportError('Could not load the team', res.error); return; }
        team = res.data || [];
        el('ca-count-team').textContent = team.length || '';
        renderTeam();
      });
  }

  function renderTeam() {
    var host = el('ca-team-list');
    if (!team.length) { host.innerHTML = ''; return; }

    // Only ids are readable here -- city_memberships carries no email, and the
    // policy on user_roles does not expose other people's rows to a city
    // owner. Showing "editor since <date>" is honest about what we know.
    host.innerHTML = '<h3 style="margin:0 0 10px;">On this city</h3>' + team.map(function (m) {
      var isMe = session && m.user_id === session.user.id;
      var label = m.role === 'owner' ? 'Owner' : 'Editor';
      var since = m.created_at ? new Date(m.created_at).toLocaleDateString('en-US') : '';
      return '<div class="ac-row"><div class="ac-row-main">' +
        '<h4>' + label + (isMe ? ' (you)' : '') + '</h4>' +
        '<div class="ac-meta">since ' + escapeHtml(since) + '</div></div>' +
        (m.role === 'editor'
          ? '<div class="submission-actions"><button type="button" class="btn btn-danger btn-small" ' +
            'data-remove-member="' + escapeHtml(m.user_id) + '">Remove</button></div>'
          : '') +
        '</div>';
    }).join('');
  }

  function inviteEditor(e) {
    e.preventDefault();
    var email = val('ca-invite-email');
    var statusNode = el('ca-invite-status');
    statusNode.textContent = 'Sending…';
    statusNode.className = 'district-status';

    fetch('/api/city-platform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({ op: 'invite_editor', city_id: current.id, email: email })
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (result) {
        if (!result.ok) {
          statusNode.textContent = (result.body && result.body.error) || 'That didn’t work.';
          statusNode.className = 'district-status error';
          return;
        }
        el('ca-invite-form').reset();
        statusNode.textContent = result.body.pending
          ? 'Sent to staff for approval. They’ll be added once it’s approved.'
          : 'Invited. They’ll get an email with a link to set a password.';
        statusNode.className = 'district-status success';
        loadTeam();
      })
      .catch(function () {
        statusNode.textContent = 'Could not reach the server. Try again.';
        statusNode.className = 'district-status error';
      });
  }

  function removeMember(userId) {
    if (!window.confirm('Remove this editor from your city? They keep their login but lose access here.')) return;
    window.supabaseClient
      .from('city_memberships')
      .delete()
      .eq('city_id', current.id)
      .eq('user_id', userId)
      .then(function (res) {
        if (res.error) { reportError('Could not remove them', res.error); return; }
        setStatus('Removed.', 'success');
        loadTeam();
      });
  }

  // ---------- wiring ----------
  function showView(view) {
    ['officials', 'meetings', 'about', 'map', 'team'].forEach(function (v) {
      var node = el('ca-view-' + v);
      if (node) node.style.display = v === view ? '' : 'none';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#ca-nav .city-nav-btn'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!el('ca-shell') || typeof window.supabaseClient === 'undefined') return;

    el('logout-btn').addEventListener('click', function () {
      window.supabaseClient.auth.signOut().then(function () {
        window.location.href = '/login.html';
      });
    });

    el('ca-city-select').addEventListener('change', function () {
      var city = cities.filter(function (c) { return c.id === this.value; }.bind(this))[0];
      if (city) selectCity(city);
    });

    Array.prototype.forEach.call(document.querySelectorAll('#ca-nav .city-nav-btn'), function (btn) {
      btn.addEventListener('click', function () { showView(btn.getAttribute('data-view')); });
    });

    el('ca-official-form').addEventListener('submit', saveOfficial);
    el('ca-official-reset').addEventListener('click', resetOfficialForm);
    el('ca-official-seat-type').addEventListener('change', syncDistrictField);
    el('ca-meeting-form').addEventListener('submit', saveMeeting);
    el('ca-meeting-reset').addEventListener('click', resetMeetingForm);
    el('ca-about-form').addEventListener('submit', saveAbout);
    el('ca-boundary-file').addEventListener('change', readBoundaryFile);
    el('ca-boundary-save').addEventListener('click', saveBoundary);
    el('ca-boundary-clear').addEventListener('click', clearBoundary);
    el('ca-invite-form').addEventListener('submit', inviteEditor);

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.hasAttribute) return;
      if (t.hasAttribute('data-edit-official')) editOfficial(t.getAttribute('data-edit-official'));
      if (t.hasAttribute('data-delete-official')) deleteOfficial(t.getAttribute('data-delete-official'));
      if (t.hasAttribute('data-edit-meeting')) editMeeting(t.getAttribute('data-edit-meeting'));
      if (t.hasAttribute('data-delete-meeting')) deleteMeeting(t.getAttribute('data-delete-meeting'));
      if (t.hasAttribute('data-remove-member')) removeMember(t.getAttribute('data-remove-member'));
    });

    showView('officials');
    start();
  });
})();
