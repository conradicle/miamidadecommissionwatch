(function () {
  var currentUserId = null;
  var currentRole = null;

  // Must stay in sync with public.mdcw_topics() in migration_14, api/_prefs.js
  // and js/meetings-feed.js. Four copies is three too many, but there is no
  // build step here to share one.
  var TOPICS = ['Housing', 'Transit', 'Zoning', 'Public Safety', 'Taxes & Budget', 'Environment', 'Parks', 'Other'];
  var DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  // Filled by loadCommissionerRoster() at startup. Stays empty when
  // migration_14 hasn't been applied, which disables the roll-call UI.
  var commissionerRoster = [];

  function loadCommissionerRoster() {
    return supabaseClient
      .from('commissioners')
      .select('id, slug, full_name, district')
      .eq('is_current', true)
      .order('district', { ascending: true })
      .then(function (res) {
        commissionerRoster = (!res.error && res.data) ? res.data : [];
      })
      .catch(function () { commissionerRoster = []; });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Reads one optional field off an item row. Empty means null, not '' and not
  // 0 -- an empty number input must not save as zero dollars or zero votes,
  // which would read on the public page as a real recorded figure.
  function fieldOrNull(row, selector, isText) {
    var el = row.querySelector(selector);
    if (!el) return null;
    var raw = el.value.trim();
    if (raw === '') return null;
    if (isText) return raw;
    var n = Number(raw);
    return isNaN(n) ? null : n;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    } catch (e) {
      return iso;
    }
  }

  function formatMeetingDate(dateStr) {
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  }

  // ---------- tabs ----------
  function initTabs() {
    var tabs = document.querySelectorAll('.admin-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelectorAll('.admin-panel').forEach(function (panel) {
          panel.style.display = 'none';
        });
        var target = document.getElementById('panel-' + tab.getAttribute('data-tab'));
        if (target) target.style.display = 'block';
      });
    });
  }

  // ---------- editorials ----------
  function renderSubmission(row) {
    var card = document.createElement('div');
    card.className = 'submission-card';

    var actionsHtml = '';
    if (row.status === 'pending') {
      actionsHtml =
        '<button type="button" class="btn btn-primary btn-small" data-action="approve" data-id="' + row.id + '">Approve &amp; Publish</button>' +
        '<button type="button" class="btn btn-danger btn-small" data-action="reject" data-id="' + row.id + '">Reject</button>';
    } else if (row.status === 'approved') {
      actionsHtml =
        '<button type="button" class="btn btn-secondary btn-small" data-action="unpublish" data-id="' + row.id + '">Move back to pending</button>' +
        '<button type="button" class="btn btn-danger btn-small" data-action="reject" data-id="' + row.id + '">Reject</button>';
    } else if (row.status === 'rejected') {
      actionsHtml =
        '<button type="button" class="btn btn-secondary btn-small" data-action="unpublish" data-id="' + row.id + '">Reconsider (back to pending)</button>';
    }

    card.innerHTML =
      '<div class="submission-meta">' +
        'Submitted ' + escapeHtml(formatDate(row.submitted_at)) +
        '<span class="submission-status ' + row.status + '">' + escapeHtml(row.status) + '</span>' +
      '</div>' +
      '<h3 style="margin-bottom:4px;">' + escapeHtml(row.title) + '</h3>' +
      '<p style="color:var(--ink-600); font-size:14px; margin-bottom:2px;">By ' + escapeHtml(row.name) + ', ' + escapeHtml(row.grade) + ' at ' + escapeHtml(row.school) + '</p>' +
      '<p style="color:var(--ink-400); font-size:13px; margin-bottom:0;">' + escapeHtml(row.school_email) + (row.topic ? ' &middot; Topic: ' + escapeHtml(row.topic) : '') + '</p>' +
      '<div class="submission-body">' + escapeHtml(row.body) + '</div>' +
      '<div class="submission-actions">' + actionsHtml + '</div>';

    return card;
  }

  function loadSubmissions() {
    var statusEl = document.getElementById('admin-status');
    var listEl = document.getElementById('submissions-list');
    listEl.innerHTML = '';

    supabaseClient
      .from('editorial_submissions')
      .select('*')
      .order('submitted_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          statusEl.textContent = 'Could not load submissions: ' + res.error.message;
          statusEl.className = 'district-status error';
          return;
        }
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<div class="notice">No submissions yet.</div>';
          return;
        }
        res.data.forEach(function (row) {
          listEl.appendChild(renderSubmission(row));
        });
      });
  }

  function initEditorials() {
    var listEl = document.getElementById('submissions-list');
    var statusEl = document.getElementById('admin-status');

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;

      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      var newStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending';

      btn.disabled = true;

      var updates = { status: newStatus, reviewed_at: new Date().toISOString(), reviewed_by: currentUserId };

      supabaseClient
        .from('editorial_submissions')
        .update(updates)
        .eq('id', id)
        .then(function (res) {
          if (res.error) {
            statusEl.textContent = 'Update failed: ' + res.error.message;
            statusEl.className = 'district-status error';
            btn.disabled = false;
            return;
          }
          loadSubmissions();
        });
    });

    loadSubmissions();
  }

  // ---------- meetings ----------
  function createItemRow() {
    var row = document.createElement('div');
    row.className = 'meeting-item-row';
    row.innerHTML =
      '<div class="field-row">' +
        '<div class="field">' +
          '<label>Tag type</label>' +
          '<select class="mi-tag-type">' +
            '<option value="outcome">Outcome (vote taken)</option>' +
            '<option value="item_code">No vote yet (item code)</option>' +
          '</select>' +
        '</div>' +
        '<div class="field mi-status-field">' +
          '<label>Outcome color</label>' +
          '<select class="mi-tag-status">' +
            '<option value="passed">Passed</option>' +
            '<option value="failed">Failed</option>' +
            '<option value="deferred">Deferred</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>Tag label</label>' +
        '<input type="text" class="mi-tag-label" placeholder="e.g. Passed, unanimous or Item 4B" required>' +
      '</div>' +
      '<div class="field">' +
        '<label>Item heading</label>' +
        '<input type="text" class="mi-heading" required>' +
      '</div>' +
      '<div class="field">' +
        '<label>Description</label>' +
        '<textarea class="mi-description" rows="2" required></textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label>Why it matters</label>' +
        '<textarea class="mi-why" rows="2" required></textarea>' +
      '</div>' +

      // ---- the structured record (migration_14) ----
      '<fieldset style="border:1px solid #ddd; border-radius:6px; padding:12px; margin:12px 0;">' +
        '<legend style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;">The record</legend>' +
        '<div class="field-row">' +
          '<div class="field"><label>Item code</label><input type="text" class="mi-item-code" placeholder="e.g. 8A1"></div>' +
          '<div class="field"><label>Legislation number</label><input type="text" class="mi-leg-number" placeholder="e.g. R-123-26"></div>' +
          '<div class="field"><label>Type</label><select class="mi-leg-type">' +
            '<option value="">—</option>' +
            ['Ordinance', 'Resolution', 'Report', 'Appointment', 'Public Hearing', 'Discussion Item', 'Other']
              .map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Dollar amount (plain number)</label><input type="number" step="0.01" class="mi-amount" placeholder="e.g. 31000000"></div>' +
          '<div class="field"><label>Sponsor</label><input type="text" class="mi-sponsor" placeholder="Commissioner name, exactly as on the roster"></div>' +
          '<div class="field"><label>Topic</label><select class="mi-topic">' +
            '<option value="">— none (won\'t match topic filters or alerts) —</option>' +
            TOPICS.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="field">' +
          '<label>Districts affected <span style="font-weight:400;">(tick none for countywide)</span></label>' +
          '<div class="mi-districts" style="display:flex; flex-wrap:wrap; gap:8px;">' +
            DISTRICTS.map(function (d) {
              return '<label style="display:flex; align-items:center; gap:4px; font-weight:400;">' +
                '<input type="checkbox" value="' + d + '"> D' + d + '</label>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Votes yes</label><input type="number" min="0" max="13" class="mi-vote-yes"></div>' +
          '<div class="field"><label>Votes no</label><input type="number" min="0" max="13" class="mi-vote-no"></div>' +
          '<div class="field"><label>Absent</label><input type="number" min="0" max="13" class="mi-vote-absent"></div>' +
        '</div>' +
      '</fieldset>' +

      // ---- sourcing: official record, then journalism ----
      '<fieldset style="border:1px solid #ddd; border-radius:6px; padding:12px; margin:12px 0;">' +
        '<legend style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;">Official record</legend>' +
        '<div class="field-row">' +
          '<div class="field"><label>County record URL</label><input type="url" class="mi-official-url" placeholder="https://www.miamidade.gov/govaction/..."></div>' +
          '<div class="field"><label>Link label</label><input type="text" class="mi-official-label" placeholder="County legislative record"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Agenda document URL</label><input type="url" class="mi-agenda-url" placeholder="https://..."></div>' +
          '<div class="field"><label>Vote record URL</label><input type="url" class="mi-voterec-url" placeholder="https://..."></div>' +
        '</div>' +
        '<p style="font-size:13px; color:#666; margin:4px 0 0;">The public page says "Primary county record not yet linked" when the first field is empty. News coverage belongs below, not here.</p>' +
      '</fieldset>' +

      '<fieldset style="border:1px solid #ddd; border-radius:6px; padding:12px; margin:12px 0;">' +
        '<legend style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;">Additional reporting</legend>' +
        '<div class="mi-sources"></div>' +
        '<button type="button" class="btn btn-secondary btn-small mi-add-source">Add a source</button>' +
      '</fieldset>' +

      '<fieldset style="border:1px solid #ddd; border-radius:6px; padding:12px; margin:12px 0;">' +
        '<legend style="font-size:12px; text-transform:uppercase; letter-spacing:.05em;">Roll call</legend>' +
        '<p style="font-size:13px; color:#666; margin:0 0 8px;">Optional. Leave every row on "not recorded" to publish only the tally above. Set them and the public page shows who voted which way.</p>' +
        '<div class="mi-rollcall"></div>' +
      '</fieldset>' +

      '<button type="button" class="btn btn-danger btn-small mi-remove">Remove item</button>' +
      '<hr>';

    var tagType = row.querySelector('.mi-tag-type');
    var statusField = row.querySelector('.mi-status-field');
    tagType.addEventListener('change', function () {
      statusField.style.display = tagType.value === 'outcome' ? 'block' : 'none';
    });
    row.querySelector('.mi-remove').addEventListener('click', function () {
      row.remove();
    });
    row.querySelector('.mi-add-source').addEventListener('click', function () {
      row.querySelector('.mi-sources').appendChild(createSourceRow());
    });

    renderRollCall(row.querySelector('.mi-rollcall'));

    return row;
  }

  function createSourceRow(source) {
    var el = document.createElement('div');
    el.className = 'mi-source-row field-row';
    el.innerHTML =
      '<div class="field"><label>Outlet</label><input type="text" class="ms-outlet" placeholder="e.g. WLRN"></div>' +
      '<div class="field"><label>Headline / label</label><input type="text" class="ms-label" placeholder="e.g. County OKs $2.5B in borrowing"></div>' +
      '<div class="field"><label>URL</label><input type="url" class="ms-url" placeholder="https://..."></div>' +
      '<button type="button" class="btn btn-danger btn-small ms-remove" style="align-self:flex-end;">Remove</button>';
    el.querySelector('.ms-remove').addEventListener('click', function () { el.remove(); });

    if (source) {
      el.querySelector('.ms-outlet').value = source.outlet || '';
      el.querySelector('.ms-label').value = source.label || '';
      el.querySelector('.ms-url').value = source.url || '';
    }
    return el;
  }

  // commissionerRoster is loaded once at dashboard start. Empty means
  // migration_14 hasn't been applied, in which case roll call is unavailable
  // and we say so rather than rendering an empty box.
  function renderRollCall(container) {
    if (!container) return;
    if (!commissionerRoster.length) {
      container.innerHTML = '<p style="font-size:13px; color:#666; margin:0;">' +
        'Roll call needs the commissioners table from migration_14. Apply it in the Supabase SQL editor to enable this.</p>';
      return;
    }
    container.innerHTML = commissionerRoster.map(function (c) {
      return '<div class="field-row" style="align-items:center; gap:8px;">' +
        '<div class="field" style="flex:1;"><label style="font-weight:400;">D' + c.district + ' · ' + escapeHtml(c.full_name) + '</label></div>' +
        '<div class="field"><select class="mv-vote" data-commissioner="' + escapeHtml(c.id) + '">' +
          '<option value="">not recorded</option>' +
          '<option value="yes">yes</option>' +
          '<option value="no">no</option>' +
          '<option value="abstain">abstain</option>' +
          '<option value="absent">absent</option>' +
          '<option value="recused">recused</option>' +
        '</select></div>' +
      '</div>';
    }).join('');
  }

  function renderMeetingAdmin(meeting) {
    var card = document.createElement('div');
    card.className = 'submission-card';
    var items = (meeting.meeting_items || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    var itemsHtml = items.map(function (item) {
      return '<li>' + escapeHtml(item.tag_label) + ': ' + escapeHtml(item.heading) + '</li>';
    }).join('');

    var agendaLabel = meeting.agenda_sent_at
      ? 'Re-send agenda email (sent ' + escapeHtml(formatDate(meeting.agenda_sent_at)) + ')'
      : 'Email subscribers: Agenda';
    var recapLabel = meeting.recap_sent_at
      ? 'Re-send recap email (sent ' + escapeHtml(formatDate(meeting.recap_sent_at)) + ')'
      : 'Email subscribers: Recap';

    card.innerHTML =
      '<div class="submission-meta">' + escapeHtml(meeting.meeting_type) + ' &middot; ' + escapeHtml(formatMeetingDate(meeting.meeting_date)) + '</div>' +
      '<h3 style="margin-bottom:4px;">' + escapeHtml(meeting.title) + '</h3>' +
      '<p style="color:var(--ink-600); font-size:14px;">' + escapeHtml(meeting.summary) + '</p>' +
      (itemsHtml ? '<ul style="margin:8px 0 14px; padding-left:20px; font-size:14px; color:var(--ink-600);">' + itemsHtml + '</ul>' : '') +
      '<div class="submission-actions">' +
        '<button type="button" class="btn btn-secondary btn-small" data-action="edit-meeting" data-id="' + meeting.id + '">Edit</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-action="send-agenda" data-id="' + meeting.id + '">' + agendaLabel + '</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-action="send-recap" data-id="' + meeting.id + '">' + recapLabel + '</button>' +
        '<button type="button" class="btn btn-danger btn-small" data-action="delete-meeting" data-id="' + meeting.id + '">Delete meeting</button>' +
      '</div>';

    return card;
  }

  function loadMeetingsAdmin() {
    var listEl = document.getElementById('meetings-admin-list');
    listEl.innerHTML = '';

    supabaseClient
      .from('meetings')
      .select('*, meeting_items(*)')
      .order('meeting_date', { ascending: false })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<div class="notice">Could not load meetings: ' + escapeHtml(res.error.message) + '</div>';
          return;
        }
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<div class="notice">No meetings added yet.</div>';
          return;
        }
        res.data.forEach(function (row) {
          listEl.appendChild(renderMeetingAdmin(row));
        });
      });
  }

  function initMeetings() {
    var form = document.getElementById('meeting-form');
    var itemsContainer = document.getElementById('meeting-items');
    var statusEl = document.getElementById('meeting-form-status');
    var listEl = document.getElementById('meetings-admin-list');
    var headingEl = document.getElementById('meeting-form-heading');
    var submitBtn = document.getElementById('meeting-submit-btn');
    var cancelBtn = document.getElementById('meeting-cancel-edit-btn');
    var editingMeetingId = null;

    itemsContainer.appendChild(createItemRow());

    document.getElementById('add-item-btn').addEventListener('click', function () {
      itemsContainer.appendChild(createItemRow());
    });

    function resetToCreateMode() {
      editingMeetingId = null;
      headingEl.textContent = 'Add a meeting';
      submitBtn.textContent = 'Publish meeting';
      cancelBtn.style.display = 'none';
      form.reset();
      itemsContainer.innerHTML = '';
      itemsContainer.appendChild(createItemRow());
    }

    cancelBtn.addEventListener('click', resetToCreateMode);

    function fillItemRow(row, item) {
      var tagTypeEl = row.querySelector('.mi-tag-type');
      tagTypeEl.value = item.tag_type;
      tagTypeEl.dispatchEvent(new Event('change'));
      if (item.tag_type === 'outcome' && item.tag_status) {
        row.querySelector('.mi-tag-status').value = item.tag_status;
      }
      row.querySelector('.mi-tag-label').value = item.tag_label;
      row.querySelector('.mi-heading').value = item.heading;
      row.querySelector('.mi-description').value = item.description;
      row.querySelector('.mi-why').value = item.why_it_matters;

      // Carrying the id through the form is what keeps an edit from deleting
      // and re-creating the row -- which would cascade away its sources and
      // its roll call. See saveItems().
      row.setAttribute('data-item-id', item.id || '');

      setVal(row, '.mi-item-code', item.item_code);
      setVal(row, '.mi-leg-number', item.legislation_number);
      setVal(row, '.mi-leg-type', item.legislation_type);
      setVal(row, '.mi-amount', item.amount_usd);
      setVal(row, '.mi-sponsor', item.sponsor);
      setVal(row, '.mi-topic', item.topic);
      setVal(row, '.mi-vote-yes', item.vote_yes);
      setVal(row, '.mi-vote-no', item.vote_no);
      setVal(row, '.mi-vote-absent', item.vote_absent);
      setVal(row, '.mi-official-url', item.official_url);
      setVal(row, '.mi-official-label', item.official_label);
      setVal(row, '.mi-agenda-url', item.agenda_document_url);
      setVal(row, '.mi-voterec-url', item.vote_record_url);

      var wanted = (item.districts || []).map(String);
      Array.prototype.forEach.call(row.querySelectorAll('.mi-districts input'), function (cb) {
        cb.checked = wanted.indexOf(cb.value) !== -1;
      });

      var sourcesEl = row.querySelector('.mi-sources');
      sourcesEl.innerHTML = '';
      (item.item_sources || []).slice().sort(function (a, b) {
        return (a.sort_order || 0) - (b.sort_order || 0);
      }).forEach(function (s) {
        sourcesEl.appendChild(createSourceRow(s));
      });

      (item.item_votes || []).forEach(function (v) {
        var sel = row.querySelector('.mv-vote[data-commissioner="' + v.commissioner_id + '"]');
        if (sel) sel.value = v.vote;
      });
    }

    function setVal(row, selector, value) {
      var el = row.querySelector(selector);
      if (el) el.value = (value === null || value === undefined) ? '' : value;
    }

    function enterEditMode(meeting) {
      editingMeetingId = meeting.id;
      headingEl.textContent = 'Edit meeting';
      submitBtn.textContent = 'Save changes';
      cancelBtn.style.display = 'inline-flex';

      document.getElementById('m-date').value = meeting.meeting_date;
      document.getElementById('m-type').value = meeting.meeting_type;
      document.getElementById('m-title').value = meeting.title;
      document.getElementById('m-summary').value = meeting.summary;

      itemsContainer.innerHTML = '';
      var items = (meeting.meeting_items || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      if (items.length === 0) {
        itemsContainer.appendChild(createItemRow());
      } else {
        items.forEach(function (item) {
          var row = createItemRow();
          itemsContainer.appendChild(row);
          fillItemRow(row, item);
        });
      }

      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Saves agenda items WITHOUT destroying their ids.
    //
    // The old implementation deleted every meeting_item on the meeting and
    // re-inserted them, which was harmless when an item was just text. It is
    // not harmless now: item_sources and item_votes reference meeting_items(id)
    // on delete cascade, so re-inserting would wipe every roll-call vote on the
    // meeting every time an editor fixed a typo in the summary.
    //
    // So: update rows that already have an id, insert the ones that don't,
    // and delete only the ones the editor actually removed from the form.
    function saveItems(meetingId, items, keepIds) {
      var updates = [];
      var inserts = [];

      items.forEach(function (entry) {
        var fields = Object.assign({ meeting_id: meetingId }, entry.fields);
        if (entry.id) updates.push({ id: entry.id, fields: fields, entry: entry });
        else inserts.push({ fields: fields, entry: entry });
      });

      // Remove items the editor deleted from the form.
      var deletion = keepIds.length
        ? supabaseClient.from('meeting_items').delete()
            .eq('meeting_id', meetingId)
            .not('id', 'in', '(' + keepIds.join(',') + ')')
        : supabaseClient.from('meeting_items').delete().eq('meeting_id', meetingId);

      return deletion.then(function (delRes) {
        if (delRes.error) return { error: delRes.error };

        var work = updates.map(function (u) {
          return supabaseClient.from('meeting_items').update(u.fields).eq('id', u.id)
            .then(function (res) {
              if (res.error) return res;
              return saveItemChildren(u.id, u.entry);
            });
        });

        if (inserts.length) {
          work.push(
            supabaseClient.from('meeting_items')
              .insert(inserts.map(function (i) { return i.fields; }))
              .select('id, sort_order')
              .then(function (res) {
                if (res.error) return res;
                // Match inserted rows back to their form entries by sort_order.
                var bySort = {};
                (res.data || []).forEach(function (r) { bySort[r.sort_order] = r.id; });
                return Promise.all(inserts.map(function (i) {
                  var newId = bySort[i.fields.sort_order];
                  return newId ? saveItemChildren(newId, i.entry) : { error: null };
                })).then(function (results) {
                  return firstError(results) || { error: null };
                });
              })
          );
        }

        return Promise.all(work).then(function (results) {
          return firstError(results) || { error: null };
        });
      });
    }

    function firstError(results) {
      for (var i = 0; i < results.length; i++) {
        if (results[i] && results[i].error) return results[i];
      }
      return null;
    }

    // item_sources and item_votes are leaf rows keyed only by item_id, so
    // replacing them wholesale is safe -- nothing references them.
    function saveItemChildren(itemId, entry) {
      return supabaseClient.from('item_sources').delete().eq('item_id', itemId)
        .then(function () {
          if (!entry.sources.length) return { error: null };
          return supabaseClient.from('item_sources').insert(
            entry.sources.map(function (s, i) {
              return Object.assign({ item_id: itemId, sort_order: i }, s);
            })
          );
        })
        .then(function (res) {
          if (res && res.error) return res;
          return supabaseClient.from('item_votes').delete().eq('item_id', itemId);
        })
        .then(function (res) {
          if (res && res.error) return res;
          if (!entry.votes.length) return { error: null };
          return supabaseClient.from('item_votes').insert(
            entry.votes.map(function (v) {
              return { item_id: itemId, commissioner_id: v.commissioner_id, vote: v.vote };
            })
          );
        })
        // migration_14 not applied: the item itself saved fine, the extras
        // simply have nowhere to go yet. Don't fail the whole save over it.
        .catch(function () { return { error: null }; });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var rows = itemsContainer.querySelectorAll('.meeting-item-row');
      if (rows.length === 0) {
        statusEl.textContent = 'Add at least one agenda item.';
        statusEl.className = 'district-status error';
        return;
      }

      var items = [];
      var keepIds = [];

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var tagType = r.querySelector('.mi-tag-type').value;
        var existingId = r.getAttribute('data-item-id') || null;
        if (existingId) keepIds.push(existingId);

        var districts = Array.prototype.slice
          .call(r.querySelectorAll('.mi-districts input:checked'))
          .map(function (cb) { return Number(cb.value); });

        var sources = Array.prototype.slice
          .call(r.querySelectorAll('.mi-source-row'))
          .map(function (sr) {
            return {
              outlet: sr.querySelector('.ms-outlet').value.trim(),
              label: sr.querySelector('.ms-label').value.trim(),
              url: sr.querySelector('.ms-url').value.trim()
            };
          })
          // All three columns are NOT NULL, so a half-filled row would fail
          // the whole save. Drop the blanks instead.
          .filter(function (s) { return s.outlet && s.label && s.url; });

        var votes = Array.prototype.slice
          .call(r.querySelectorAll('.mv-vote'))
          .filter(function (sel) { return sel.value; })
          .map(function (sel) {
            return { commissioner_id: sel.getAttribute('data-commissioner'), vote: sel.value };
          });

        items.push({
          id: existingId,
          sources: sources,
          votes: votes,
          fields: {
            sort_order: i,
            tag_type: tagType,
            tag_label: r.querySelector('.mi-tag-label').value.trim(),
            tag_status: tagType === 'outcome' ? r.querySelector('.mi-tag-status').value : null,
            heading: r.querySelector('.mi-heading').value.trim(),
            description: r.querySelector('.mi-description').value.trim(),
            why_it_matters: r.querySelector('.mi-why').value.trim(),
            item_code: fieldOrNull(r, '.mi-item-code', true),
            legislation_number: fieldOrNull(r, '.mi-leg-number', true),
            legislation_type: fieldOrNull(r, '.mi-leg-type', true),
            amount_usd: fieldOrNull(r, '.mi-amount'),
            sponsor: fieldOrNull(r, '.mi-sponsor', true),
            topic: fieldOrNull(r, '.mi-topic', true),
            districts: districts,
            vote_yes: fieldOrNull(r, '.mi-vote-yes'),
            vote_no: fieldOrNull(r, '.mi-vote-no'),
            vote_absent: fieldOrNull(r, '.mi-vote-absent'),
            official_url: fieldOrNull(r, '.mi-official-url', true),
            official_label: fieldOrNull(r, '.mi-official-label', true),
            agenda_document_url: fieldOrNull(r, '.mi-agenda-url', true),
            vote_record_url: fieldOrNull(r, '.mi-voterec-url', true)
          }
        });
      }

      var meetingFields = {
        meeting_date: document.getElementById('m-date').value,
        meeting_type: document.getElementById('m-type').value.trim(),
        title: document.getElementById('m-title').value.trim(),
        summary: document.getElementById('m-summary').value.trim()
      };

      submitBtn.disabled = true;
      statusEl.textContent = editingMeetingId ? 'Saving...' : 'Publishing...';
      statusEl.className = 'district-status';

      if (editingMeetingId) {
        var meetingId = editingMeetingId;
        supabaseClient
          .from('meetings')
          .update(meetingFields)
          .eq('id', meetingId)
          .then(function (res) {
            if (res.error) {
              statusEl.textContent = 'Could not save meeting: ' + res.error.message;
              statusEl.className = 'district-status error';
              submitBtn.disabled = false;
              return;
            }
            // saveItems does its own targeted deletion now -- the blanket
            // delete that used to sit here took the roll call with it.
            Promise.resolve()
              .then(function () {
                return saveItems(meetingId, items, keepIds).then(function (itemsRes) {
                  submitBtn.disabled = false;
                  if (itemsRes.error) {
                    statusEl.textContent = 'Meeting saved, but agenda items failed: ' + itemsRes.error.message;
                    statusEl.className = 'district-status error';
                    return;
                  }
                  statusEl.textContent = 'Meeting updated. Use the buttons below to (re-)send subscriber emails.';
                  statusEl.className = 'district-status success';
                  resetToCreateMode();
                  loadMeetingsAdmin();
                });
              });
          });
      } else {
        supabaseClient
          .from('meetings')
          .insert(Object.assign({ created_by: currentUserId }, meetingFields))
          .select()
          .single()
          .then(function (res) {
            if (res.error) {
              statusEl.textContent = 'Could not save meeting: ' + res.error.message;
              statusEl.className = 'district-status error';
              submitBtn.disabled = false;
              return;
            }
            saveItems(res.data.id, items, []).then(function (itemsRes) {
              submitBtn.disabled = false;
              if (itemsRes.error) {
                statusEl.textContent = 'Meeting saved, but agenda items failed: ' + itemsRes.error.message;
                statusEl.className = 'district-status error';
                return;
              }
              statusEl.textContent = 'Meeting published. Use the buttons below to email subscribers.';
              statusEl.className = 'district-status success';
              resetToCreateMode();
              loadMeetingsAdmin();
            });
          });
      }
    });

    listEl.addEventListener('click', function (e) {
      var editBtn = e.target.closest('button[data-action="edit-meeting"]');
      if (editBtn) {
        var editId = editBtn.getAttribute('data-id');
        supabaseClient
          .from('meetings')
          .select('*, meeting_items(*, item_sources(*), item_votes(commissioner_id, vote))')
          .eq('id', editId)
          .single()
          .then(function (res) {
            if (!res.error && res.data) return res;
            // migration_14 not applied: item_sources / item_votes don't exist.
            // Editing must still work, just without those sub-forms.
            return supabaseClient
              .from('meetings')
              .select('*, meeting_items(*)')
              .eq('id', editId)
              .single();
          })
          .then(function (res) {
            if (res.error || !res.data) {
              window.alert('Could not load meeting for editing.');
              return;
            }
            enterEditMode(res.data);
          });
        return;
      }

      var sendBtn = e.target.closest('button[data-action="send-agenda"], button[data-action="send-recap"]');
      if (sendBtn) {
        var kind = sendBtn.getAttribute('data-action') === 'send-agenda' ? 'agenda' : 'recap';
        var meetingId = sendBtn.getAttribute('data-id');
        var alreadySent = sendBtn.textContent.indexOf('Re-send') === 0;
        var confirmMsg = alreadySent
          ? 'This meeting already had a ' + kind + ' email sent. Send it again to every current subscriber?'
          : 'Email every subscriber the ' + kind + ' for this meeting now?';
        if (!window.confirm(confirmMsg)) return;

        sendBtn.disabled = true;
        var originalText = sendBtn.textContent;
        sendBtn.textContent = 'Sending...';

        supabaseClient.auth.getSession().then(function (sessionRes) {
          var session = sessionRes.data && sessionRes.data.session;
          if (!session) {
            sendBtn.disabled = false;
            sendBtn.textContent = originalText;
            window.alert('Your session has expired. Log out and log back in, then try again.');
            return;
          }
          fetch('/api/notify-subscribers', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ meeting_id: meetingId, kind: kind })
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (result) {
              sendBtn.disabled = false;
              if (!result.ok) {
                sendBtn.textContent = originalText;
                window.alert('Could not send: ' + (result.data.error || 'unknown error'));
                return;
              }
              window.alert('Sent to ' + result.data.sent + ' subscriber' + (result.data.sent === 1 ? '' : 's') + '.');
              loadMeetingsAdmin();
            })
            .catch(function () {
              sendBtn.disabled = false;
              sendBtn.textContent = originalText;
              window.alert('Could not reach the server.');
            });
        });
        return;
      }

      var deleteBtn = e.target.closest('button[data-action="delete-meeting"]');
      if (!deleteBtn) return;
      if (!window.confirm('Delete this meeting and all of its agenda items?')) return;
      var deleteId = deleteBtn.getAttribute('data-id');
      deleteBtn.disabled = true;
      supabaseClient
        .from('meetings')
        .delete()
        .eq('id', deleteId)
        .then(function (res) {
          if (res.error) {
            statusEl.textContent = 'Delete failed: ' + res.error.message;
            statusEl.className = 'district-status error';
            deleteBtn.disabled = false;
            return;
          }
          if (editingMeetingId === deleteId) resetToCreateMode();
          loadMeetingsAdmin();
        });
    });

    loadMeetingsAdmin();
  }

  // ---------- newsletter stats ----------
  function renderStatCard(number, label) {
    var card = document.createElement('div');
    // Not "card" -- that class is watched by main.js's scroll-reveal
    // IntersectionObserver, which only scans the DOM once at page load, so
    // cards inserted later by this async fetch would stay stuck at opacity 0.
    card.className = 'submission-card';
    card.style.textAlign = 'center';
    card.style.marginBottom = '0';
    card.innerHTML =
      '<div class="stat-number">' + escapeHtml(String(number)) + '</div>' +
      '<div class="stat-label">' + escapeHtml(label) + '</div>';
    return card;
  }

  function loadNewsletterStats() {
    var statusEl = document.getElementById('newsletter-stats-status');
    var gridEl = document.getElementById('newsletter-stats-grid');
    statusEl.textContent = 'Loading...';
    statusEl.className = 'district-status';

    supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        statusEl.textContent = 'Your session has expired. Log out and log back in, then try again.';
        statusEl.className = 'district-status error';
        return;
      }
      fetch('/api/newsletter-stats', {
        headers: { Authorization: 'Bearer ' + session.access_token }
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) {
            statusEl.textContent = 'Could not load newsletter stats: ' + (result.data.error || 'unknown error');
            statusEl.className = 'district-status error';
            return;
          }
          statusEl.textContent = '';
          gridEl.innerHTML = '';
          gridEl.appendChild(renderStatCard(result.data.subscribed, 'Current subscribers'));
          gridEl.appendChild(renderStatCard(result.data.newLast7Days, 'New in last 7 days'));
          gridEl.appendChild(renderStatCard(result.data.newLast30Days, 'New in last 30 days'));
          gridEl.appendChild(renderStatCard(result.data.unsubscribed, 'Unsubscribed (all time)'));
        })
        .catch(function () {
          statusEl.textContent = 'Could not reach the server.';
          statusEl.className = 'district-status error';
        });
    });
  }

  function initNewsletterStats() {
    document.getElementById('newsletter-stats-refresh').addEventListener('click', loadNewsletterStats);
    loadNewsletterStats();
  }

  // ---------- links page stats ----------
  // Human-readable names for the data-link ids in links.html. An id that
  // isn't here (an old card that was renamed, say) still shows, using the
  // raw id, rather than vanishing from the totals.
  var LINK_LABELS = {
    'meetings': 'Latest meeting recap',
    'find-district': 'Find your commissioner',
    'public-comment': 'How to speak at public comment',
    'elections': '2026 elections guide',
    'submit-editorial': 'Submit a student editorial',
    'editorials': 'Read student editorials',
    'join': 'Join Commission Watch',
    'officials': 'Elected officials directory',
    'about': 'About us',
    'contact': 'Contact us',
    'county-agendas': 'Official county agendas',
    'instagram': 'Instagram handle',
    'full-site': 'Back to the full site'
  };

  function renderBarRow(label, count, max) {
    var row = document.createElement('div');
    row.className = 'stat-bar-row';
    var pct = max > 0 ? Math.round((count / max) * 100) : 0;
    row.innerHTML =
      '<div class="sb-label">' + escapeHtml(label) + '</div>' +
      '<div class="sb-track"><div class="sb-fill" style="width:' + pct + '%;"></div></div>' +
      '<div class="sb-count">' + escapeHtml(String(count)) + '</div>';
    return row;
  }

  function renderBarList(containerId, rows, emptyText) {
    var el = document.getElementById(containerId);
    el.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'stat-empty';
      empty.textContent = emptyText;
      el.appendChild(empty);
      return;
    }
    var max = rows.reduce(function (m, r) { return Math.max(m, r.count); }, 0);
    rows.forEach(function (r) {
      el.appendChild(renderBarRow(r.label, r.count, max));
    });
  }

  function loadLinkStats() {
    var statusEl = document.getElementById('link-stats-status');
    var gridEl = document.getElementById('link-stats-grid');
    var days = document.getElementById('link-stats-range').value;
    statusEl.textContent = 'Loading...';
    statusEl.className = 'district-status';

    supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        statusEl.textContent = 'Your session has expired. Log out and log back in, then try again.';
        statusEl.className = 'district-status error';
        return;
      }
      fetch('/api/link-stats?days=' + encodeURIComponent(days), {
        headers: { Authorization: 'Bearer ' + session.access_token }
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok) {
            statusEl.textContent = 'Could not load link stats: ' + (result.data.error || 'unknown error');
            statusEl.className = 'district-status error';
            return;
          }
          statusEl.textContent = '';

          var views = result.data.views || 0;
          var totalClicks = result.data.totalClicks || 0;
          // Taps per open, not per person -- see the note in the panel.
          var perView = views > 0 ? (totalClicks / views).toFixed(2) : '--';

          gridEl.innerHTML = '';
          gridEl.appendChild(renderStatCard(views, 'Page opens'));
          gridEl.appendChild(renderStatCard(totalClicks, 'Links tapped'));
          gridEl.appendChild(renderStatCard(perView, 'Taps per open'));

          var clicks = (result.data.clicks || []).map(function (row) {
            return { label: LINK_LABELS[row.link] || row.link, count: row.count };
          });
          renderBarList('link-stats-clicks', clicks, 'No taps recorded in this window yet.');

          var sources = (result.data.sources || []).map(function (row) {
            return { label: row.source === 'direct' ? 'Direct / no tag' : row.source, count: row.count };
          });
          renderBarList('link-stats-sources', sources, 'No page opens recorded in this window yet.');
        })
        .catch(function () {
          statusEl.textContent = 'Could not reach the server.';
          statusEl.className = 'district-status error';
        });
    });
  }

  function initLinkStats() {
    document.getElementById('link-stats-refresh').addEventListener('click', loadLinkStats);
    document.getElementById('link-stats-range').addEventListener('change', loadLinkStats);
    loadLinkStats();
  }

  // ---------- staff (owner only) ----------
  function renderStaffRow(row) {
    var isSelf = row.user_id === currentUserId;
    var div = document.createElement('div');
    div.className = 'submission-card';
    div.innerHTML =
      '<div class="field-row" style="align-items:flex-end;">' +
        '<div class="field" style="flex:2;"><label>Email</label><div style="padding:10px 0; font-size:15px;">' + escapeHtml(row.email || row.user_id) + (isSelf ? ' <span style="color:var(--ink-400); font-size:13px;">(you)</span>' : '') + '</div></div>' +
        '<div class="field">' +
          '<label>Role</label>' +
          '<select class="staff-role" data-id="' + row.user_id + '" ' + (isSelf ? 'disabled' : '') + '>' +
            '<option value="admin"' + (row.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '<option value="owner"' + (row.role === 'owner' ? ' selected' : '') + '>Owner</option>' +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<button type="button" class="btn btn-small ' + (row.status === 'active' ? 'btn-danger' : 'btn-secondary') + ' staff-toggle-status" data-id="' + row.user_id + '" data-current="' + row.status + '" ' + (isSelf ? 'disabled' : '') + '>' +
            (row.status === 'active' ? 'Revoke access' : 'Restore access') +
          '</button>' +
        '</div>' +
        '<div class="field">' +
          '<button type="button" class="btn btn-small btn-secondary staff-gen-link" data-id="' + row.user_id + '" data-email="' + escapeHtml(row.email || '') + '" ' + (row.email ? '' : 'disabled') + '>Generate reset link</button>' +
        '</div>' +
        '<div class="field">' +
          '<button type="button" class="btn btn-small btn-danger staff-delete-user" data-id="' + row.user_id + '" data-email="' + escapeHtml(row.email || row.user_id) + '" ' + (isSelf ? 'disabled' : '') + '>Delete user</button>' +
        '</div>' +
      '</div>' +
      '<div class="submission-status ' + (row.status === 'active' ? 'approved' : 'rejected') + '" style="display:inline-block;">' + escapeHtml(row.status) + '</div>' +
      '<div class="staff-link-output" data-id="' + row.user_id + '" style="display:none; margin-top:12px;">' +
        '<div class="field-row" style="align-items:flex-end;">' +
          '<div class="field" style="flex:1;"><label>Reset link (valid 60 min, one-time use)</label><input type="text" class="link-input" readonly></div>' +
          '<div class="field" style="flex:0;"><button type="button" class="btn btn-small btn-secondary copy-link-btn">Copy</button></div>' +
        '</div>' +
      '</div>';
    return div;
  }

  function loadStaff() {
    var listEl = document.getElementById('staff-list');
    listEl.innerHTML = '';

    supabaseClient
      .from('user_roles')
      .select('*')
      .order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<div class="notice">Could not load staff: ' + escapeHtml(res.error.message) + '</div>';
          return;
        }
        res.data.forEach(function (row) {
          listEl.appendChild(renderStaffRow(row));
        });
      });
  }

  function initStaff() {
    var listEl = document.getElementById('staff-list');
    var inviteForm = document.getElementById('invite-form');
    var inviteStatus = document.getElementById('invite-status');

    listEl.addEventListener('change', function (e) {
      var select = e.target.closest('.staff-role');
      if (!select) return;
      var id = select.getAttribute('data-id');
      select.disabled = true;
      supabaseClient
        .from('user_roles')
        .update({ role: select.value })
        .eq('user_id', id)
        .then(function (res) {
          select.disabled = false;
          if (res.error) {
            window.alert('Could not update role: ' + res.error.message);
            return;
          }
          loadStaff();
        });
    });

    listEl.addEventListener('click', function (e) {
      var genBtn = e.target.closest('.staff-gen-link');
      if (genBtn) {
        var email = genBtn.getAttribute('data-email');
        var id = genBtn.getAttribute('data-id');
        var outputEl = listEl.querySelector('.staff-link-output[data-id="' + id + '"]');
        var linkInput = outputEl.querySelector('.link-input');
        genBtn.disabled = true;
        genBtn.textContent = 'Generating...';

        supabaseClient.auth.getSession().then(function (sessionRes) {
          var session = sessionRes.data && sessionRes.data.session;
          if (!session) {
            genBtn.disabled = false;
            genBtn.textContent = 'Generate reset link';
            window.alert('Your session has expired. Log out and log back in, then try again.');
            return;
          }
          fetch('/api/admin-users', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ action: 'generate_link', email: email })
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (result) {
              genBtn.disabled = false;
              genBtn.textContent = 'Generate reset link';
              if (!result.ok) {
                window.alert('Could not generate link: ' + (result.data.error || 'unknown error'));
                return;
              }
              linkInput.value = result.data.link;
              outputEl.style.display = 'block';
              linkInput.focus();
              linkInput.select();
            })
            .catch(function () {
              genBtn.disabled = false;
              genBtn.textContent = 'Generate reset link';
              window.alert('Could not reach the server.');
            });
        });
        return;
      }

      var copyBtn = e.target.closest('.copy-link-btn');
      if (copyBtn) {
        var input = copyBtn.closest('.staff-link-output').querySelector('.link-input');
        input.focus();
        input.select();
        navigator.clipboard.writeText(input.value).then(function () {
          var original = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = original; }, 1500);
        });
        return;
      }

      var deleteBtn = e.target.closest('.staff-delete-user');
      if (deleteBtn) {
        var deleteId = deleteBtn.getAttribute('data-id');
        var deleteEmail = deleteBtn.getAttribute('data-email');
        if (!window.confirm('Permanently delete ' + deleteEmail + '? This removes their staff access AND their login entirely. They would need a brand new invite to come back. This cannot be undone.')) {
          return;
        }
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';

        supabaseClient.auth.getSession().then(function (sessionRes) {
          var session = sessionRes.data && sessionRes.data.session;
          if (!session) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = 'Delete user';
            window.alert('Your session has expired. Log out and log back in, then try again.');
            return;
          }
          fetch('/api/admin-users', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ action: 'delete', user_id: deleteId })
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (result) {
              if (!result.ok) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Delete user';
                window.alert('Could not delete user: ' + (result.data.error || 'unknown error'));
                return;
              }
              loadStaff();
            })
            .catch(function () {
              deleteBtn.disabled = false;
              deleteBtn.textContent = 'Delete user';
              window.alert('Could not reach the server.');
            });
        });
        return;
      }

      var btn = e.target.closest('.staff-toggle-status');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var newStatus = btn.getAttribute('data-current') === 'active' ? 'revoked' : 'active';
      btn.disabled = true;
      supabaseClient
        .from('user_roles')
        .update({ status: newStatus })
        .eq('user_id', id)
        .then(function (res) {
          if (res.error) {
            window.alert('Could not update access: ' + res.error.message);
            btn.disabled = false;
            return;
          }
          loadStaff();
        });
    });

    inviteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailInput = document.getElementById('invite-email');
      var submitBtn = inviteForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      inviteStatus.textContent = 'Sending invite...';
      inviteStatus.className = 'district-status';

      supabaseClient.auth.getSession().then(function (sessionRes) {
        var session = sessionRes.data && sessionRes.data.session;
        if (!session) {
          submitBtn.disabled = false;
          inviteStatus.textContent = 'Your session has expired. Log out and log back in, then try again.';
          inviteStatus.className = 'district-status error';
          return;
        }
        fetch('/api/admin-users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + session.access_token
          },
          body: JSON.stringify({ action: 'invite', email: emailInput.value.trim() })
        })
          .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
          .then(function (result) {
            submitBtn.disabled = false;
            if (!result.ok) {
              inviteStatus.textContent = 'Invite failed: ' + (result.data.error || 'unknown error');
              inviteStatus.className = 'district-status error';
              return;
            }
            inviteStatus.textContent = 'Invite sent.';
            inviteStatus.className = 'district-status success';
            inviteForm.reset();
            loadStaff();
          })
          .catch(function () {
            submitBtn.disabled = false;
            inviteStatus.textContent = 'Invite failed: could not reach the server.';
            inviteStatus.className = 'district-status error';
          });
      });
    });

    loadStaff();
  }

  // ---------- bootstrap ----------
  document.addEventListener('DOMContentLoaded', function () {
    var statusEl = document.getElementById('admin-status');
    var logoutBtn = document.getElementById('logout-btn');
    var tabsEl = document.getElementById('admin-tabs');
    var staffTabBtn = document.getElementById('staff-tab-btn');

    supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        window.location.href = 'login.html';
        return;
      }

      currentUserId = session.user.id;

      supabaseClient
        .from('user_roles')
        .select('role, status')
        .eq('user_id', currentUserId)
        .maybeSingle()
        .then(function (roleRes) {
          var role = roleRes.data && roleRes.data.role;
          var status = roleRes.data && roleRes.data.status;
          // Staff only. City owners and their editors hold per-city roles in
          // city_memberships rather than a site-wide role here, and their own
          // editing screens are still to come; for now the Cities tab is the
          // staff view of every city.
          var isStaff = role === 'owner' || role === 'admin';
          if (roleRes.error || !roleRes.data || status !== 'active' || !isStaff) {
            statusEl.textContent = 'Your account isn’t authorized as staff, or your access has been revoked. Contact the site owner if this is unexpected.';
            statusEl.className = 'district-status error';
            logoutBtn.style.display = 'inline-flex';
            return;
          }

          currentRole = role;
          logoutBtn.style.display = 'inline-flex';
          tabsEl.style.display = 'flex';

          initTabs();

          initEditorials();
          loadCommissionerRoster().then(initMeetings);
          initNewsletterStats();
          initLinkStats();

          if (typeof window.initAdminCities === 'function') {
            window.initAdminCities({ userId: currentUserId, role: role, isStaff: isStaff });
          }
          if (typeof window.initAdminClaims === 'function') {
            window.initAdminClaims({ userId: currentUserId, role: role, isStaff: isStaff });
          }

          if (currentRole === 'owner') {
            staffTabBtn.style.display = 'inline-block';
            initStaff();
          }
        });
    });

    logoutBtn.addEventListener('click', function () {
      supabaseClient.auth.signOut().then(function () {
        window.location.href = 'login.html';
      });
    });
  });
})();
