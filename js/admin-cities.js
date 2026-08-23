// Cities tab of the staff dashboard: the editor behind /cities/.
//
// Its own file rather than more of js/admin.js, which is already the largest
// script on the site. admin.js owns the shared chrome (auth, tabs, the county
// tools) and calls window.initAdminCities() once it knows who is signed in.
//
// Two audiences share this panel:
//   staff (owner/admin)  every city, plus the buttons that publish
//   city_editor          only the cities they were added to, and no publish
//                        button anywhere
// The missing button is convenience, not the control. Row Level Security in
// supabase/migration_13_cities.sql is what actually stops a student team
// putting something on the public site: their policies only accept rows whose
// review_status is 'draft' or 'pending'.
(function () {
  var ctx = null;      // { userId, role, isStaff }
  var cities = [];
  var currentCity = null;

  // ---------- helpers ----------
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(id) { return document.getElementById(id); }

  function setStatus(id, message, kind) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function reviewBadge(status) {
    var cls = { draft: 'draft', pending: 'pending', published: 'approved', archived: 'rejected' }[status] || 'draft';
    return '<span class="submission-status ' + cls + '">' + escapeHtml(status) + '</span>';
  }

  // The three buttons every reviewable row gets. Editors can move a row
  // forward to 'pending' and no further; staff publish, unpublish, and delete.
  function rowActions(row, table) {
    var html = '';
    if (!ctx.isStaff) {
      if (row.review_status === 'draft') {
        html += '<button type="button" class="btn btn-small btn-primary city-submit" data-table="' + table + '" data-id="' + row.id + '">Submit for review</button>';
      }
      if (row.review_status === 'draft' || row.review_status === 'pending') {
        html += ' <button type="button" class="btn btn-small btn-danger city-delete" data-table="' + table + '" data-id="' + row.id + '">Delete</button>';
      }
      return html;
    }
    if (row.review_status !== 'published') {
      html += '<button type="button" class="btn btn-small btn-primary city-publish" data-table="' + table + '" data-id="' + row.id + '">Publish</button>';
    } else {
      html += '<button type="button" class="btn btn-small btn-secondary city-unpublish" data-table="' + table + '" data-id="' + row.id + '">Unpublish</button>';
    }
    html += ' <button type="button" class="btn btn-small btn-danger city-delete" data-table="' + table + '" data-id="' + row.id + '">Delete</button>';
    return html;
  }

  // ---------- cities list + picker ----------
  function loadCities(preferSlug) {
    // RLS narrows this by itself: staff see every city, a city editor sees
    // only the ones they are on the team for, so there's no filter here.
    return supabaseClient
      .from('cities')
      .select('*')
      .order('sort_order', { ascending: true })
      .then(function (res) {
        var picker = el('city-picker');
        if (res.error) {
          setStatus('cities-status', 'Could not load cities: ' + res.error.message, 'error');
          return;
        }
        cities = res.data || [];

        if (cities.length === 0) {
          picker.innerHTML = '';
          el('city-workspace').style.display = 'none';
          setStatus('cities-status', ctx.isStaff
            ? 'No cities yet. Add one below to get started.'
            : 'You have not been added to a city team yet. Ask an editor to add you.', '');
          return;
        }

        picker.innerHTML = cities.map(function (c) {
          return '<option value="' + escapeHtml(c.slug) + '">' + escapeHtml(c.name) +
            (c.is_published ? '' : ' (unpublished)') + '</option>';
        }).join('');

        var wanted = preferSlug || (currentCity && currentCity.slug) || cities[0].slug;
        picker.value = wanted;
        if (!picker.value) picker.value = cities[0].slug;

        // A team with exactly one city has nothing to pick between.
        el('city-picker-row').style.display = cities.length > 1 ? 'flex' : 'none';
        selectCity(picker.value);
      });
  }

  function selectCity(slug) {
    currentCity = cities.filter(function (c) { return c.slug === slug; })[0] || null;
    if (!currentCity) return;

    el('city-workspace').style.display = '';
    setStatus('cities-status', '');

    el('city-public-link').href = '/cities/' + currentCity.slug;
    el('city-public-link').textContent = '/cities/' + currentCity.slug;

    if (ctx.isStaff) {
      el('cs-name').value = currentCity.name || '';
      el('cs-slug').value = currentCity.slug || '';
      el('cs-blurb').value = currentCity.blurb || '';
      el('cs-status').value = currentCity.status || 'team-needed';
      el('cs-website').value = currentCity.official_website || '';
      el('cs-order').value = currentCity.sort_order || 0;
      el('cs-published').checked = !!currentCity.is_published;
    }

    loadTeam();
    loadGovernment();
    loadList('city_sources');
    loadList('city_officials');
    loadMeetings();
  }

  // ---------- city settings (staff only) ----------
  function initCitySettings() {
    el('city-settings-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentCity) return;
      var patch = {
        name: el('cs-name').value.trim(),
        slug: el('cs-slug').value.trim().toLowerCase(),
        blurb: el('cs-blurb').value.trim(),
        status: el('cs-status').value,
        official_website: el('cs-website').value.trim() || null,
        sort_order: parseInt(el('cs-order').value, 10) || 0,
        is_published: el('cs-published').checked,
        updated_at: new Date().toISOString()
      };
      setStatus('city-settings-status', 'Saving...', '');
      supabaseClient.from('cities').update(patch).eq('id', currentCity.id).then(function (res) {
        if (res.error) {
          setStatus('city-settings-status', 'Could not save: ' + res.error.message, 'error');
          return;
        }
        setStatus('city-settings-status', 'Saved.', 'success');
        loadCities(patch.slug);
      });
    });

    el('add-city-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = el('nc-name').value.trim();
      var slug = el('nc-slug').value.trim().toLowerCase();
      if (!name || !slug) return;
      setStatus('add-city-status', 'Adding...', '');
      supabaseClient
        .from('cities')
        .insert({
          name: name,
          slug: slug,
          blurb: el('nc-blurb').value.trim(),
          sort_order: (cities.length + 1) * 10,
          is_published: false
        })
        .then(function (res) {
          if (res.error) {
            setStatus('add-city-status', 'Could not add: ' + res.error.message, 'error');
            return;
          }
          setStatus('add-city-status', 'Added. It stays unpublished until you tick “Live on the public site”.', 'success');
          el('add-city-form').reset();
          loadCities(slug);
        });
    });

    // Slug suggestion, so nobody has to think about URL formatting.
    el('nc-name').addEventListener('input', function () {
      var slugField = el('nc-slug');
      if (slugField.dataset.touched === 'true') return;
      slugField.value = el('nc-name').value.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    });
    el('nc-slug').addEventListener('input', function () {
      el('nc-slug').dataset.touched = 'true';
    });
  }

  // ---------- team ----------
  function loadTeam() {
    var listEl = el('city-team-list');
    listEl.innerHTML = '';
    if (!currentCity) return;

    // user_roles is readable in full only by the owner, so the embed is the
    // reliable way to show who is on a team; an admin still sees the rows,
    // just without the role label when the join comes back empty.
    supabaseClient
      .from('city_team_members')
      .select('user_id, added_at, user_roles(email, role, status)')
      .eq('city_id', currentCity.id)
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<p class="stat-empty">Could not load the team: ' + escapeHtml(res.error.message) + '</p>';
          return;
        }
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<p class="stat-empty">Nobody is on this team yet. Add an email above.</p>';
          return;
        }
        listEl.innerHTML = res.data.map(function (row) {
          var profile = row.user_roles || {};
          var label = profile.email || row.user_id;
          var meta = [profile.role, profile.status].filter(Boolean).join(' · ');
          return '<div class="stat-bar-row" style="grid-template-columns:1fr auto auto;">' +
            '<span class="sb-label">' + escapeHtml(label) +
              (meta ? ' <span style="color:var(--ink-400); font-size:13px;">(' + escapeHtml(meta) + ')</span>' : '') +
            '</span>' +
            (profile.status === 'revoked' ? '<span class="submission-status rejected">revoked</span>' : '<span></span>') +
            (ctx.isStaff
              ? '<button type="button" class="btn btn-small btn-danger city-team-remove" data-id="' + escapeHtml(row.user_id) + '">Remove</button>'
              : '<span></span>') +
            '</div>';
        }).join('');
      });
  }

  function initTeam() {
    el('city-invite-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentCity) return;
      var email = el('city-invite-email').value.trim();
      if (!email) return;

      setStatus('city-invite-status', 'Sending invite...', '');
      supabaseClient.auth.getSession().then(function (sessionRes) {
        var session = sessionRes.data && sessionRes.data.session;
        if (!session) {
          setStatus('city-invite-status', 'Your session expired. Sign in again.', 'error');
          return;
        }
        fetch('/api/admin-invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + session.access_token
          },
          body: JSON.stringify({ email: email, role: 'city_editor', city_id: currentCity.id })
        })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
          .then(function (result) {
            if (!result.ok) {
              setStatus('city-invite-status', result.body.error || 'Invite failed.', 'error');
              return;
            }
            setStatus('city-invite-status', result.body.existing
              ? 'That account already existed and has been added to the ' + currentCity.name + ' team.'
              : 'Invite sent. They set their own password from the email.', 'success');
            el('city-invite-form').reset();
            loadTeam();
          })
          .catch(function () {
            setStatus('city-invite-status', 'Could not reach the server.', 'error');
          });
      });
    });

    el('city-team-list').addEventListener('click', function (e) {
      var btn = e.target.closest('.city-team-remove');
      if (!btn || !currentCity) return;
      if (!window.confirm('Remove this person from the ' + currentCity.name + ' team? Their account stays, they just lose access to this city.')) return;
      supabaseClient
        .from('city_team_members')
        .delete()
        .eq('city_id', currentCity.id)
        .eq('user_id', btn.getAttribute('data-id'))
        .then(function (res) {
          if (res.error) {
            window.alert('Could not remove: ' + res.error.message);
            return;
          }
          loadTeam();
        });
    });
  }

  // ---------- government ----------
  function loadGovernment() {
    var listEl = el('city-gov-list');
    listEl.innerHTML = '';
    if (!currentCity) return;

    supabaseClient
      .from('city_government')
      .select('*')
      .eq('city_id', currentCity.id)
      .neq('review_status', 'archived')
      .order('submitted_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<p class="stat-empty">Could not load: ' + escapeHtml(res.error.message) + '</p>';
          return;
        }
        var rows = res.data || [];
        if (rows.length === 0) {
          listEl.innerHTML = '<p class="stat-empty">Nothing recorded yet. Fill in the form above and save a draft.</p>';
          return;
        }
        listEl.innerHTML = rows.map(function (row) {
          return '<div class="submission-card">' +
            reviewBadge(row.review_status) +
            '<h4 style="margin:10px 0 4px;">' + escapeHtml(row.body) + '</h4>' +
            (row.form ? '<p style="margin:0 0 6px; color:var(--ink-600);">' + escapeHtml(row.form) + '</p>' : '') +
            (row.note ? '<p style="margin:0 0 12px; color:var(--ink-600);">' + escapeHtml(row.note) + '</p>' : '') +
            '<div class="submission-actions">' + rowActions(row, 'city_government') + '</div>' +
            '</div>';
        }).join('');
      });
  }

  function initGovernment() {
    el('city-gov-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentCity) return;
      var body = el('gov-body').value.trim();
      if (!body) return;
      setStatus('city-gov-status', 'Saving...', '');
      supabaseClient
        .from('city_government')
        .insert({
          city_id: currentCity.id,
          body: body,
          form: el('gov-form-of').value.trim() || null,
          note: el('gov-note').value.trim() || null,
          review_status: 'draft',
          submitted_by: ctx.userId
        })
        .then(function (res) {
          if (res.error) {
            setStatus('city-gov-status', 'Could not save: ' + res.error.message, 'error');
            return;
          }
          setStatus('city-gov-status', 'Draft saved.', 'success');
          el('city-gov-form').reset();
          loadGovernment();
        });
    });
  }

  // ---------- simple lists (sources, officials) ----------
  function renderSourceRow(row) {
    return '<div class="submission-card">' +
      reviewBadge(row.review_status) +
      '<h4 style="margin:10px 0 4px;">' + escapeHtml(row.label) + '</h4>' +
      '<p class="mono" style="font-size:13px; color:var(--ink-400); margin:0 0 12px; word-break:break-all;">' + escapeHtml(row.url) + '</p>' +
      '<div class="submission-actions">' + rowActions(row, 'city_sources') + '</div>' +
      '</div>';
  }

  function renderOfficialRow(row) {
    var seat = row.seat + (row.seat_type === 'district' && row.district ? ' · District ' + row.district
      : (row.seat_type === 'at-large' ? ' · At large' : ''));
    var contact = [row.contact_email, row.contact_url].filter(Boolean).join(' · ');
    return '<div class="submission-card">' +
      reviewBadge(row.review_status) +
      '<h4 style="margin:10px 0 2px;">' + escapeHtml(row.name) + '</h4>' +
      '<p style="margin:0 0 6px; color:var(--ink-600);">' + escapeHtml(seat) +
        (row.term_ends ? ' · term ends ' + escapeHtml(row.term_ends) : '') + '</p>' +
      (contact ? '<p class="mono" style="font-size:13px; color:var(--ink-400); margin:0 0 12px; word-break:break-all;">' + escapeHtml(contact) + '</p>' : '') +
      '<div class="submission-actions">' + rowActions(row, 'city_officials') + '</div>' +
      '</div>';
  }

  var LIST_CONFIG = {
    city_sources: { listId: 'city-sources-list', render: renderSourceRow, empty: 'No sources yet.' },
    city_officials: { listId: 'city-officials-list', render: renderOfficialRow, empty: 'No officials recorded yet.' }
  };

  function loadList(table) {
    var config = LIST_CONFIG[table];
    var listEl = el(config.listId);
    listEl.innerHTML = '';
    if (!currentCity) return;

    supabaseClient
      .from(table)
      .select('*')
      .eq('city_id', currentCity.id)
      .neq('review_status', 'archived')
      .order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<p class="stat-empty">Could not load: ' + escapeHtml(res.error.message) + '</p>';
          return;
        }
        var rows = res.data || [];
        listEl.innerHTML = rows.length
          ? rows.map(config.render).join('')
          : '<p class="stat-empty">' + config.empty + '</p>';
      });
  }

  function initLists() {
    el('city-source-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentCity) return;
      setStatus('city-source-status', 'Saving...', '');
      supabaseClient
        .from('city_sources')
        .insert({
          city_id: currentCity.id,
          label: el('src-label').value.trim(),
          url: el('src-url').value.trim(),
          sort_order: parseInt(el('src-order').value, 10) || 0,
          review_status: 'draft',
          submitted_by: ctx.userId
        })
        .then(function (res) {
          if (res.error) {
            setStatus('city-source-status', 'Could not save: ' + res.error.message, 'error');
            return;
          }
          setStatus('city-source-status', 'Draft saved.', 'success');
          el('city-source-form').reset();
          loadList('city_sources');
        });
    });

    el('city-official-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentCity) return;
      setStatus('city-official-status', 'Saving...', '');
      supabaseClient
        .from('city_officials')
        .insert({
          city_id: currentCity.id,
          name: el('off-name').value.trim(),
          seat: el('off-seat').value.trim(),
          seat_type: el('off-seat-type').value,
          district: el('off-district').value.trim() || null,
          term_ends: el('off-term').value.trim() || null,
          contact_email: el('off-email').value.trim() || null,
          contact_url: el('off-url').value.trim() || null,
          sort_order: parseInt(el('off-order').value, 10) || 0,
          review_status: 'draft',
          submitted_by: ctx.userId
        })
        .then(function (res) {
          if (res.error) {
            setStatus('city-official-status', 'Could not save: ' + res.error.message, 'error');
            return;
          }
          setStatus('city-official-status', 'Draft saved.', 'success');
          el('city-official-form').reset();
          loadList('city_officials');
        });
    });
  }

  // ---------- meetings ----------
  // Same agenda-item shape as the county meeting editor in js/admin.js, so a
  // city recap reads identically to a county one on the public page.
  function createItemRow(item) {
    item = item || {};
    var wrap = document.createElement('div');
    wrap.className = 'meeting-item-row';
    wrap.innerHTML =
      '<div class="field-row">' +
        '<div class="field" style="flex:0 0 150px;"><label>Tag type</label>' +
          '<select class="ci-tag-type">' +
            '<option value="outcome"' + (item.tag_type === 'item_code' ? '' : ' selected') + '>Outcome</option>' +
            '<option value="item_code"' + (item.tag_type === 'item_code' ? ' selected' : '') + '>Item code</option>' +
          '</select></div>' +
        '<div class="field"><label>Tag label</label><input type="text" class="ci-tag-label" value="' + escapeHtml(item.tag_label || '') + '" required></div>' +
        '<div class="field" style="flex:0 0 150px;"><label>Outcome</label>' +
          '<select class="ci-tag-status">' +
            '<option value="">(none)</option>' +
            '<option value="passed"' + (item.tag_status === 'passed' ? ' selected' : '') + '>Passed</option>' +
            '<option value="failed"' + (item.tag_status === 'failed' ? ' selected' : '') + '>Failed</option>' +
            '<option value="deferred"' + (item.tag_status === 'deferred' ? ' selected' : '') + '>Deferred</option>' +
          '</select></div>' +
      '</div>' +
      '<div class="field"><label>Heading</label><input type="text" class="ci-heading" value="' + escapeHtml(item.heading || '') + '" required></div>' +
      '<div class="field"><label>Description</label><textarea class="ci-description" rows="2" required>' + escapeHtml(item.description || '') + '</textarea></div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Source label</label><input type="text" class="ci-source-label" value="' + escapeHtml(item.source_label || '') + '"></div>' +
        '<div class="field"><label>Source URL</label><input type="url" class="ci-source-url" value="' + escapeHtml(item.source_url || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>Why it matters</label><textarea class="ci-why" rows="2" required>' + escapeHtml(item.why_it_matters || '') + '</textarea></div>' +
      '<button type="button" class="btn btn-small btn-danger ci-remove">Remove item</button>';
    wrap.querySelector('.ci-remove').addEventListener('click', function () { wrap.remove(); });
    return wrap;
  }

  function collectItems() {
    var rows = [];
    el('city-meeting-items').querySelectorAll('.meeting-item-row').forEach(function (row, index) {
      rows.push({
        sort_order: index,
        tag_type: row.querySelector('.ci-tag-type').value,
        tag_label: row.querySelector('.ci-tag-label').value.trim(),
        tag_status: row.querySelector('.ci-tag-status').value || null,
        heading: row.querySelector('.ci-heading').value.trim(),
        description: row.querySelector('.ci-description').value.trim(),
        source_label: row.querySelector('.ci-source-label').value.trim() || null,
        source_url: row.querySelector('.ci-source-url').value.trim() || null,
        why_it_matters: row.querySelector('.ci-why').value.trim()
      });
    });
    return rows;
  }

  function loadMeetings() {
    var listEl = el('city-meetings-list');
    listEl.innerHTML = '';
    if (!currentCity) return;

    supabaseClient
      .from('city_meetings')
      .select('*, city_meeting_items(*)')
      .eq('city_id', currentCity.id)
      .neq('review_status', 'archived')
      .order('meeting_date', { ascending: false })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<p class="stat-empty">Could not load: ' + escapeHtml(res.error.message) + '</p>';
          return;
        }
        var rows = res.data || [];
        if (rows.length === 0) {
          listEl.innerHTML = '<p class="stat-empty">No meeting summaries yet.</p>';
          return;
        }
        listEl.innerHTML = rows.map(function (row) {
          var count = (row.city_meeting_items || []).length;
          return '<div class="submission-card">' +
            reviewBadge(row.review_status) +
            '<div class="submission-meta" style="margin-top:10px;">' + escapeHtml(row.meeting_type) + ' &middot; ' + escapeHtml(row.meeting_date) + '</div>' +
            '<h4 style="margin:4px 0;">' + escapeHtml(row.title) + '</h4>' +
            '<p style="margin:0 0 6px; color:var(--ink-600);">' + escapeHtml(row.summary) + '</p>' +
            '<p class="mono" style="font-size:12px; color:var(--ink-400); margin:0 0 12px;">' + count + ' agenda item' + (count === 1 ? '' : 's') + '</p>' +
            '<div class="submission-actions">' + rowActions(row, 'city_meetings') + '</div>' +
            '</div>';
        }).join('');
      });
  }

  function initMeetings() {
    el('city-add-item-btn').addEventListener('click', function () {
      el('city-meeting-items').appendChild(createItemRow());
    });

    el('city-meeting-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentCity) return;
      var items = collectItems();
      setStatus('city-meeting-status', 'Saving...', '');

      supabaseClient
        .from('city_meetings')
        .insert({
          city_id: currentCity.id,
          meeting_date: el('cm-date').value,
          meeting_type: el('cm-type').value.trim() || 'Regular Meeting',
          title: el('cm-title').value.trim(),
          summary: el('cm-summary').value.trim(),
          review_status: 'draft',
          submitted_by: ctx.userId
        })
        .select('id')
        .single()
        .then(function (res) {
          if (res.error || !res.data) {
            setStatus('city-meeting-status', 'Could not save: ' + (res.error ? res.error.message : 'unknown error'), 'error');
            return;
          }
          if (items.length === 0) {
            finishMeetingSave();
            return;
          }
          var meetingId = res.data.id;
          supabaseClient
            .from('city_meeting_items')
            .insert(items.map(function (item) {
              item.meeting_id = meetingId;
              return item;
            }))
            .then(function (itemRes) {
              if (itemRes.error) {
                setStatus('city-meeting-status', 'Meeting saved, but the agenda items failed: ' + itemRes.error.message, 'error');
                loadMeetings();
                return;
              }
              finishMeetingSave();
            });
        });
    });

    function finishMeetingSave() {
      setStatus('city-meeting-status', 'Draft saved.', 'success');
      el('city-meeting-form').reset();
      el('city-meeting-items').innerHTML = '';
      loadMeetings();
    }
  }

  // ---------- review actions, shared by every list ----------
  function patchRow(table, id, patch) {
    return supabaseClient.from(table).update(patch).eq('id', id);
  }

  function reloadFor(table) {
    if (table === 'city_government') loadGovernment();
    else if (table === 'city_meetings') loadMeetings();
    else loadList(table);
  }

  function initReviewActions() {
    el('city-workspace').addEventListener('click', function (e) {
      var btn = e.target.closest('.city-submit, .city-publish, .city-unpublish, .city-delete');
      if (!btn) return;
      var table = btn.getAttribute('data-table');
      var id = btn.getAttribute('data-id');
      btn.disabled = true;

      function done(res) {
        btn.disabled = false;
        if (res && res.error) {
          window.alert('That didn’t work: ' + res.error.message);
          return;
        }
        reloadFor(table);
      }

      if (btn.classList.contains('city-submit')) {
        patchRow(table, id, { review_status: 'pending' }).then(done);
        return;
      }

      if (btn.classList.contains('city-unpublish')) {
        patchRow(table, id, {
          review_status: 'draft',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString()
        }).then(done);
        return;
      }

      if (btn.classList.contains('city-delete')) {
        if (!window.confirm('Delete this permanently?')) {
          btn.disabled = false;
          return;
        }
        supabaseClient.from(table).delete().eq('id', id).then(done);
        return;
      }

      // Publish. city_government allows only one published row per city (a
      // partial unique index), so the outgoing one has to be archived first or
      // the insert of the new status collides.
      var patch = {
        review_status: 'published',
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString()
      };
      if (table === 'city_government' && currentCity) {
        supabaseClient
          .from('city_government')
          .update({ review_status: 'archived' })
          .eq('city_id', currentCity.id)
          .eq('review_status', 'published')
          .then(function (archiveRes) {
            if (archiveRes.error) {
              done(archiveRes);
              return;
            }
            patchRow(table, id, patch).then(done);
          });
        return;
      }
      patchRow(table, id, patch).then(done);
    });
  }

  // ---------- entry point ----------
  window.initAdminCities = function (context) {
    ctx = context;

    // Publishing, city settings, and adding a city are staff-only; a city
    // editor gets the same panel with those blocks absent.
    document.querySelectorAll('.staff-only').forEach(function (node) {
      node.style.display = ctx.isStaff ? '' : 'none';
    });
    if (!ctx.isStaff) {
      var hint = el('city-editor-hint');
      if (hint) hint.style.display = '';
    }

    el('city-picker').addEventListener('change', function () {
      selectCity(el('city-picker').value);
    });

    if (ctx.isStaff) initCitySettings();
    initTeam();
    initGovernment();
    initLists();
    initMeetings();
    initReviewActions();
    loadCities();
  };
})();
