// Cities tab of the staff dashboard: the editor behind every city subdomain.
//
// Its own file rather than more of js/admin.js, which is already the largest
// script on the site. admin.js owns the shared chrome (auth, tabs, the county
// tools) and calls window.initAdminCities() once it knows who is signed in.
//
// Everything here goes through PostgREST as the signed-in user, so Row Level
// Security in supabase/migration_17_city_platform.sql is what actually decides
// whether a write lands. Two rules in particular are enforced there, not here:
// a city owner cannot change their own slug, status or published flag (a
// trigger rejects it), and an editor cannot publish anything (another trigger
// rejects it). The UI not offering those controls is convenience, not the
// control.
(function () {
  var ctx = null;          // { userId, role, isStaff }
  var cities = [];
  var current = null;      // the selected city row
  var officials = [];
  var meetings = [];

  // ---------- helpers ----------
  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    var node = el('ac-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  // PostgREST returns the database's own message, which for our triggers is
  // already a sentence written for a person ("Only staff can change a city's
  // address"). Showing it beats replacing it with something vaguer.
  function reportError(prefix, error) {
    var detail = (error && (error.message || error.details)) || 'Unknown error';
    setStatus(prefix + ': ' + detail, 'error');
  }

  function val(id) {
    var node = el(id);
    return node ? node.value.trim() : '';
  }

  function checked(id) {
    var node = el(id);
    return !!(node && node.checked);
  }

  // An empty text input should store NULL, not '', so "no website" and
  // "website is the empty string" don't become the same thing.
  function orNull(v) { return v === '' ? null : v; }

  function publicUrl(slug) {
    return 'https://' + slug + '.miamidadecommissionwatch.com/';
  }

  function badge(status) {
    return '<span class="ac-badge ac-badge-' + status + '">' + status + '</span>';
  }

  // ---------- loading ----------
  function loadCities() {
    return window.supabaseClient
      .from('cities')
      .select('*')
      .order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error) { reportError('Could not load cities', res.error); return; }
        cities = res.data || [];
        renderCitySelect();
        if (cities.length) {
          var keep = current && cities.filter(function (c) { return c.id === current.id; })[0];
          selectCity(keep || cities[0]);
        } else {
          current = null;
          el('ac-workspace').style.display = 'none';
        }
      });
  }

  function renderCitySelect() {
    var select = el('ac-city-select');
    if (!select) return;
    select.innerHTML = cities.map(function (c) {
      return '<option value="' + escapeHtml(c.id) + '">' +
        escapeHtml(c.name) + ' (' + escapeHtml(c.slug) + ')</option>';
    }).join('');
  }

  function selectCity(city) {
    current = city;
    var select = el('ac-city-select');
    if (select) select.value = city.id;

    var link = el('ac-public-link');
    if (link) link.href = publicUrl(city.slug);

    el('ac-workspace').style.display = '';
    fillSettings(city);
    loadOfficials();
    loadMeetings();
  }

  // ---------- settings ----------
  function fillSettings(city) {
    el('ac-name').value = city.name || '';
    el('ac-body').value = city.body_name || '';
    el('ac-governance').value = city.governance || 'at-large';
    el('ac-status-select').value = city.status || 'unclaimed';
    el('ac-website').value = city.website || '';
    el('ac-comment-guide').value = city.comment_guide || '';
    el('ac-published').checked = !!city.is_published;

    // datetime-local wants YYYY-MM-DDTHH:MM in local time, while the column is
    // a timestamptz that arrives as ISO/UTC. Convert through the local offset
    // or the field shows the wrong hour.
    var next = '';
    if (city.next_meeting_at) {
      var d = new Date(city.next_meeting_at);
      var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      next = local.toISOString().slice(0, 16);
    }
    el('ac-next-meeting').value = next;
  }

  function saveSettings(e) {
    e.preventDefault();
    if (!current) return;
    setStatus('Saving…');

    var nextRaw = val('ac-next-meeting');
    var patch = {
      name: val('ac-name'),
      body_name: val('ac-body'),
      governance: val('ac-governance'),
      status: val('ac-status-select'),
      website: orNull(val('ac-website')),
      comment_guide: val('ac-comment-guide'),
      is_published: checked('ac-published'),
      next_meeting_at: nextRaw ? new Date(nextRaw).toISOString() : null,
      updated_at: new Date().toISOString()
    };

    window.supabaseClient
      .from('cities')
      .update(patch)
      .eq('id', current.id)
      .then(function (res) {
        if (res.error) { reportError('Could not save', res.error); return; }
        setStatus('Saved.', 'success');
        loadCities();
      });
  }

  // ---------- new city ----------
  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 63);
  }

  function createCity(e) {
    e.preventDefault();
    var name = val('ac-new-name');
    var slug = val('ac-new-slug');
    var governance = val('ac-new-governance');

    if (!governance) {
      setStatus('Choose how the city elects its seats — it decides what the map can honestly show.', 'error');
      return;
    }

    setStatus('Creating…');
    window.supabaseClient
      .from('cities')
      .insert({
        name: name,
        slug: slug,
        body_name: val('ac-new-body') || (name + ' City Commission'),
        governance: governance,
        status: 'active',
        is_published: false,
        sort_order: (cities.length + 1) * 10
      })
      .select()
      .maybeSingle()
      .then(function (res) {
        if (res.error) { reportError('Could not create the city', res.error); return; }
        el('ac-new-form').reset();
        el('ac-new-form').style.display = 'none';
        setStatus('Created. It is not visible to the public until you tick "Visible to the public", ' +
          'and the subdomain needs a CNAME in Cloudflare plus a domain in Vercel before it loads.', 'success');
        return loadCities().then(function () {
          var made = cities.filter(function (c) { return c.id === res.data.id; })[0];
          if (made) selectCity(made);
        });
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
        el('ac-count-officials').textContent = officials.length ? officials.length : '';
        renderOfficials();
      });
  }

  function renderOfficials() {
    var host = el('ac-officials-list');
    if (!officials.length) {
      host.innerHTML = '<p style="color:var(--ink-400); font-style:italic;">Nobody recorded yet.</p>';
      return;
    }
    host.innerHTML = officials.map(function (o) {
      var seat = o.seat + (o.seat_type === 'district' && o.district != null ? ' · District ' + o.district : '');
      return '<div class="ac-row">' +
        '<div class="ac-row-main">' +
          '<h4>' + escapeHtml(o.name) + badge(o.status) + '</h4>' +
          '<div class="ac-meta">' + escapeHtml(seat) + (o.term_ends ? ' · term ends ' + escapeHtml(o.term_ends) : '') + '</div>' +
        '</div>' +
        '<div class="submission-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-edit-official="' + escapeHtml(o.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-delete-official="' + escapeHtml(o.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function resetOfficialForm() {
    el('ac-official-form').reset();
    el('ac-official-id').value = '';
    el('ac-official-form-title').textContent = 'Add an official';
    syncDistrictField();
  }

  // A district number only means something for a district seat, so the field
  // appears only then. Storing one on an at-large seat would be inventing a
  // district that does not exist.
  function syncDistrictField() {
    var isDistrict = val('ac-official-seat-type') === 'district';
    el('ac-official-district-field').style.display = isDistrict ? '' : 'none';
    if (!isDistrict) el('ac-official-district').value = '';
  }

  function saveOfficial(e) {
    e.preventDefault();
    if (!current) return;
    setStatus('Saving…');

    var isDistrict = val('ac-official-seat-type') === 'district';
    var districtRaw = val('ac-official-district');
    var row = {
      city_id: current.id,
      name: val('ac-official-name'),
      seat: val('ac-official-seat'),
      seat_type: val('ac-official-seat-type'),
      district: isDistrict && districtRaw ? parseInt(districtRaw, 10) : null,
      photo_url: orNull(val('ac-official-photo')),
      contact_email: orNull(val('ac-official-email')),
      contact_url: orNull(val('ac-official-url')),
      term_ends: orNull(val('ac-official-term')),
      sort_order: parseInt(val('ac-official-order') || '0', 10),
      status: checked('ac-official-published') ? 'published' : 'draft',
      updated_at: new Date().toISOString()
    };

    var id = val('ac-official-id');
    var query = id
      ? window.supabaseClient.from('city_officials').update(row).eq('id', id)
      : window.supabaseClient.from('city_officials').insert(row);

    query.then(function (res) {
      if (res.error) { reportError('Could not save the official', res.error); return; }
      setStatus('Saved.', 'success');
      resetOfficialForm();
      loadOfficials();
    });
  }

  function editOfficial(id) {
    var o = officials.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    el('ac-official-id').value = o.id;
    el('ac-official-name').value = o.name || '';
    el('ac-official-seat').value = o.seat || '';
    el('ac-official-seat-type').value = o.seat_type || 'at-large';
    el('ac-official-district').value = o.district == null ? '' : o.district;
    el('ac-official-term').value = o.term_ends || '';
    el('ac-official-email').value = o.contact_email || '';
    el('ac-official-url').value = o.contact_url || '';
    el('ac-official-photo').value = o.photo_url || '';
    el('ac-official-order').value = o.sort_order == null ? 0 : o.sort_order;
    el('ac-official-published').checked = o.status === 'published';
    el('ac-official-form-title').textContent = 'Edit ' + o.name;
    syncDistrictField();
    el('ac-official-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteOfficial(id) {
    var o = officials.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    if (!window.confirm('Remove ' + o.name + ' from this city? This cannot be undone.')) return;
    window.supabaseClient
      .from('city_officials')
      .delete()
      .eq('id', id)
      .then(function (res) {
        if (res.error) { reportError('Could not delete', res.error); return; }
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
        el('ac-count-meetings').textContent = meetings.length ? meetings.length : '';
        renderMeetings();
      });
  }

  function renderMeetings() {
    var host = el('ac-meetings-list');
    if (!meetings.length) {
      host.innerHTML = '<p style="color:var(--ink-400); font-style:italic;">No meetings recorded yet.</p>';
      return;
    }
    host.innerHTML = meetings.map(function (m) {
      return '<div class="ac-row">' +
        '<div class="ac-row-main">' +
          '<h4>' + escapeHtml(m.title) + badge(m.status) + '</h4>' +
          '<div class="ac-meta">' + escapeHtml(m.meeting_date) + '</div>' +
        '</div>' +
        '<div class="submission-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-edit-meeting="' + escapeHtml(m.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-delete-meeting="' + escapeHtml(m.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function resetMeetingForm() {
    el('ac-meeting-form').reset();
    el('ac-meeting-id').value = '';
    el('ac-meeting-title').value = 'Regular Meeting';
    el('ac-meeting-form-title').textContent = 'Add a meeting';
  }

  function saveMeeting(e) {
    e.preventDefault();
    if (!current) return;
    setStatus('Saving…');

    var row = {
      city_id: current.id,
      meeting_date: val('ac-meeting-date'),
      title: val('ac-meeting-title'),
      agenda_url: orNull(val('ac-meeting-agenda')),
      video_url: orNull(val('ac-meeting-video')),
      summary: val('ac-meeting-summary'),
      status: checked('ac-meeting-published') ? 'published' : 'draft',
      updated_at: new Date().toISOString()
    };

    var id = val('ac-meeting-id');
    var query = id
      ? window.supabaseClient.from('city_meetings').update(row).eq('id', id)
      : window.supabaseClient.from('city_meetings').insert(row);

    query.then(function (res) {
      if (res.error) { reportError('Could not save the meeting', res.error); return; }
      setStatus('Saved.', 'success');
      resetMeetingForm();
      loadMeetings();
    });
  }

  function editMeeting(id) {
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    el('ac-meeting-id').value = m.id;
    el('ac-meeting-date').value = m.meeting_date || '';
    el('ac-meeting-title').value = m.title || '';
    el('ac-meeting-agenda').value = m.agenda_url || '';
    el('ac-meeting-video').value = m.video_url || '';
    el('ac-meeting-summary').value = m.summary || '';
    el('ac-meeting-published').checked = m.status === 'published';
    el('ac-meeting-form-title').textContent = 'Edit meeting';
    el('ac-meeting-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteMeeting(id) {
    if (!window.confirm('Delete this meeting? This cannot be undone.')) return;
    window.supabaseClient
      .from('city_meetings')
      .delete()
      .eq('id', id)
      .then(function (res) {
        if (res.error) { reportError('Could not delete', res.error); return; }
        setStatus('Deleted.', 'success');
        loadMeetings();
      });
  }

  // ---------- wiring ----------
  function showView(view) {
    ['settings', 'officials', 'meetings'].forEach(function (v) {
      el('ac-view-' + v).style.display = v === view ? '' : 'none';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#ac-nav .city-nav-btn'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });
  }

  function bind() {
    el('ac-city-select').addEventListener('change', function () {
      var city = cities.filter(function (c) { return c.id === this.value; }.bind(this))[0];
      if (city) selectCity(city);
    });

    el('ac-new-city').addEventListener('click', function () {
      var form = el('ac-new-form');
      form.style.display = form.style.display === 'none' ? '' : 'none';
    });
    el('ac-new-cancel').addEventListener('click', function () {
      el('ac-new-form').style.display = 'none';
    });
    el('ac-new-form').addEventListener('submit', createCity);

    // Typing a name suggests a subdomain, but never overwrites one the user
    // has edited -- the slug is DNS and shouldn't move under them.
    el('ac-new-name').addEventListener('input', function () {
      var slugField = el('ac-new-slug');
      if (!slugField.dataset.touched) slugField.value = slugify(this.value);
    });
    el('ac-new-slug').addEventListener('input', function () { this.dataset.touched = '1'; });

    el('ac-settings-form').addEventListener('submit', saveSettings);
    el('ac-official-form').addEventListener('submit', saveOfficial);
    el('ac-official-reset').addEventListener('click', resetOfficialForm);
    el('ac-official-seat-type').addEventListener('change', syncDistrictField);
    el('ac-meeting-form').addEventListener('submit', saveMeeting);
    el('ac-meeting-reset').addEventListener('click', resetMeetingForm);

    Array.prototype.forEach.call(document.querySelectorAll('#ac-nav .city-nav-btn'), function (btn) {
      btn.addEventListener('click', function () { showView(btn.getAttribute('data-view')); });
    });

    // Delegated, because the rows are re-rendered after every save.
    document.getElementById('panel-cities').addEventListener('click', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-edit-official')) editOfficial(t.getAttribute('data-edit-official'));
      if (t.hasAttribute('data-delete-official')) deleteOfficial(t.getAttribute('data-delete-official'));
      if (t.hasAttribute('data-edit-meeting')) editMeeting(t.getAttribute('data-edit-meeting'));
      if (t.hasAttribute('data-delete-meeting')) deleteMeeting(t.getAttribute('data-delete-meeting'));
    });
  }

  window.initAdminCities = function (context) {
    ctx = context;
    if (!el('panel-cities')) return;
    bind();
    showView('settings');
    loadCities();
  };
})();
