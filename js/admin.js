(function () {
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
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

  function loadSubmissions(statusEl, listEl) {
    listEl.innerHTML = '';
    statusEl.textContent = 'Loading submissions...';
    statusEl.className = 'district-status';

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
        statusEl.textContent = '';
        if (!res.data || res.data.length === 0) {
          listEl.innerHTML = '<div class="notice">No submissions yet.</div>';
          return;
        }
        res.data.forEach(function (row) {
          listEl.appendChild(renderSubmission(row));
        });
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var statusEl = document.getElementById('admin-status');
    var listEl = document.getElementById('submissions-list');
    var logoutBtn = document.getElementById('logout-btn');

    supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        window.location.href = 'login.html';
        return;
      }

      var userId = session.user.id;

      supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle()
        .then(function (roleRes) {
          if (roleRes.error || !roleRes.data || roleRes.data.role !== 'admin') {
            statusEl.textContent = 'Your account isn’t authorized as an administrator. Contact a site admin if this is unexpected.';
            statusEl.className = 'district-status error';
            logoutBtn.style.display = 'inline-flex';
            return;
          }

          logoutBtn.style.display = 'inline-flex';
          loadSubmissions(statusEl, listEl);
        });
    });

    logoutBtn.addEventListener('click', function () {
      supabaseClient.auth.signOut().then(function () {
        window.location.href = 'login.html';
      });
    });

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;

      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      var newStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending';

      btn.disabled = true;

      supabaseClient.auth.getSession().then(function (sessionRes) {
        var session = sessionRes.data && sessionRes.data.session;
        var updates = { status: newStatus, reviewed_at: new Date().toISOString() };
        if (session) updates.reviewed_by = session.user.id;

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
            loadSubmissions(statusEl, listEl);
          });
      });
    });
  });
})();
