(function () {
  var currentUserId = null;
  var currentRole = null;

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
      '<div class="field-row">' +
        '<div class="field"><label>Source label (optional)</label><input type="text" class="mi-source-label" placeholder="e.g. Miami Herald"></div>' +
        '<div class="field"><label>Source URL (optional)</label><input type="url" class="mi-source-url" placeholder="https://..."></div>' +
      '</div>' +
      '<div class="field">' +
        '<label>Why it matters</label>' +
        '<textarea class="mi-why" rows="2" required></textarea>' +
      '</div>' +
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

    return row;
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
      row.querySelector('.mi-source-label').value = item.source_label || '';
      row.querySelector('.mi-source-url').value = item.source_url || '';
      row.querySelector('.mi-why').value = item.why_it_matters;
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

    function saveItems(meetingId, items) {
      var itemsWithMeetingId = items.map(function (item) {
        return Object.assign({ meeting_id: meetingId }, item);
      });
      return supabaseClient.from('meeting_items').insert(itemsWithMeetingId);
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
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var tagType = r.querySelector('.mi-tag-type').value;
        items.push({
          sort_order: i,
          tag_type: tagType,
          tag_label: r.querySelector('.mi-tag-label').value.trim(),
          tag_status: tagType === 'outcome' ? r.querySelector('.mi-tag-status').value : null,
          heading: r.querySelector('.mi-heading').value.trim(),
          description: r.querySelector('.mi-description').value.trim(),
          source_label: r.querySelector('.mi-source-label').value.trim() || null,
          source_url: r.querySelector('.mi-source-url').value.trim() || null,
          why_it_matters: r.querySelector('.mi-why').value.trim()
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
            supabaseClient
              .from('meeting_items')
              .delete()
              .eq('meeting_id', meetingId)
              .then(function (delRes) {
                if (delRes.error) {
                  statusEl.textContent = 'Meeting saved, but could not replace agenda items: ' + delRes.error.message;
                  statusEl.className = 'district-status error';
                  submitBtn.disabled = false;
                  return;
                }
                saveItems(meetingId, items).then(function (itemsRes) {
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
            saveItems(res.data.id, items).then(function (itemsRes) {
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
          .select('*, meeting_items(*)')
          .eq('id', editId)
          .single()
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
          fetch('/api/admin-generate-link', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ email: email })
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
          fetch('/api/admin-delete-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + session.access_token
            },
            body: JSON.stringify({ user_id: deleteId })
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
        fetch('/api/admin-invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + session.access_token
          },
          body: JSON.stringify({ email: emailInput.value.trim() })
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
          if (roleRes.error || !roleRes.data || status !== 'active' || (role !== 'admin' && role !== 'owner')) {
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
          initMeetings();
          initNewsletterStats();

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
