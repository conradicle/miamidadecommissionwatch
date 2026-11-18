// Ambassadors tab of the staff dashboard: School Ambassador applications
// from /ambassadors.
//
// ambassador_applications (migration_36) is staff-only under RLS, so staff
// read it directly with their own session, like the BCC Sign-ups tab.
// Staff can change one column, status; the database refuses any other edit.
// Applications are only ever created by the public form through
// api/city-platform.js; nothing here inserts one.
(function () {
  var rows = [];
  var loadSeq = 0;
  // Applications whose details are expanded, kept across a re-render.
  var openIds = {};

  var STATUSES = ['new', 'reviewing', 'appointed', 'declined'];
  var STATUS_LABELS = { new: 'New', reviewing: 'Reviewing', appointed: 'Appointed', declined: 'Declined' };
  var GRADE_LABELS = { '9': '9th grade', '10': '10th grade', '11': '11th grade', '12': '12th grade', college: 'College' };
  var ABSENCE_LABELS = { yes: 'Yes', no: 'No', not_sure: 'Not sure' };
  var COLUMNS = 'id,full_name,email,phone,school_name,grade,graduation_year,attended_bcc_with_mdcw,involvement,motivation,leadership_experience,expected_turnout,knows_absence_contact,guardian_name,guardian_phone,acknowledged_duties,status,submitted_at,status_updated_at';

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    var node = el('amb-admin-status');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function formatStamp(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
      });
    } catch (e) {
      return iso;
    }
  }

  function formatPhone(p) {
    var m = /^(\d{3})(\d{3})(\d{4})$/.exec(p || '');
    return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : (p || '');
  }

  function answer(label, value, opts) {
    var empty = value == null || value === '';
    var html;
    if (empty) html = '<span style="color:var(--ink-400);">Not given</span>';
    else if (opts && opts.href) html = '<a href="' + escapeHtml(opts.href) + '">' + escapeHtml(value) + '</a>';
    else html = escapeHtml(value);
    return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + html + '</dd></div>';
  }

  function renderOne(r) {
    var gradeLabel = GRADE_LABELS[r.grade] || r.grade;
    var options = STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + STATUS_LABELS[s] + '</option>';
    }).join('');
    var guardian = r.guardian_name || r.guardian_phone
      ? [r.guardian_name, r.guardian_phone ? formatPhone(r.guardian_phone) : ''].filter(Boolean).join(', ')
      : '';

    return '<details class="submission-card amb-app" data-id="' + escapeHtml(r.id) + '"' + (openIds[r.id] ? ' open' : '') + '>' +
      '<summary>' +
        '<span class="amb-app-name">' + escapeHtml(r.full_name) + '</span>' +
        '<span class="submission-status ' + escapeHtml(r.status) + '">' + escapeHtml(STATUS_LABELS[r.status] || r.status) + '</span>' +
        '<span class="amb-app-sub">' + escapeHtml(r.school_name) + ' &middot; ' + escapeHtml(gradeLabel) + ' &middot; applied ' + escapeHtml(formatStamp(r.submitted_at)) + '</span>' +
      '</summary>' +
      '<div class="amb-app-body">' +
        '<dl class="amb-app-answers">' +
          answer('Email', r.email, { href: 'mailto:' + r.email }) +
          answer('Phone', formatPhone(r.phone), { href: 'tel:+1' + r.phone }) +
          answer('School', r.school_name) +
          answer('Grade', gradeLabel) +
          answer('Graduation year', r.graduation_year) +
          answer('Attended a BCC meeting with MDCW', r.attended_bcc_with_mdcw ? 'Yes' : 'No') +
          answer('Involvement with MDCW so far', r.involvement) +
          answer('Why they want to be ambassador', r.motivation) +
          answer('Organizing or leadership experience', r.leadership_experience) +
          answer('Students they think would come', r.expected_turnout) +
          answer('Knows who handles excused absences', ABSENCE_LABELS[r.knows_absence_contact] || r.knows_absence_contact) +
          answer('Parent or guardian', guardian) +
          answer('Confirmed they understand the role', r.acknowledged_duties ? 'Yes' : 'No') +
          answer('Submitted', formatStamp(r.submitted_at)) +
          (r.status_updated_at ? answer('Status last changed', formatStamp(r.status_updated_at)) : '') +
        '</dl>' +
        '<div class="amb-app-actions">' +
          '<label for="amb-status-' + escapeHtml(r.id) + '" style="margin:0; font-weight:600;">Status</label>' +
          '<select id="amb-status-' + escapeHtml(r.id) + '" data-status-for="' + escapeHtml(r.id) + '">' + options + '</select>' +
          '<button type="button" class="btn btn-primary btn-small" data-save-status="' + escapeHtml(r.id) + '">Save status</button>' +
        '</div>' +
      '</div>' +
    '</details>';
  }

  function render() {
    var filter = el('amb-admin-filter').value;
    var shown = filter === 'all' ? rows : rows.filter(function (r) { return r.status === filter; });
    var newCount = rows.filter(function (r) { return r.status === 'new'; }).length;
    var counter = el('amb-new-count');
    if (counter) counter.textContent = newCount ? newCount : '';

    if (!rows.length) {
      el('amb-admin-list').innerHTML = '<p class="stat-empty">No applications yet.</p>';
      return;
    }
    if (!shown.length) {
      el('amb-admin-list').innerHTML = '<p class="stat-empty">No applications with this status.</p>';
      return;
    }
    el('amb-admin-list').innerHTML = shown.map(renderOne).join('');
  }

  async function load() {
    var seq = ++loadSeq;
    setStatus('Loading applications…');
    try {
      var res = await supabaseClient
        .from('ambassador_applications')
        .select(COLUMNS)
        .order('submitted_at', { ascending: false });
      if (seq !== loadSeq) return;
      if (res.error) throw res.error;
      rows = res.data || [];
      var counts = {};
      rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
      setStatus(rows.length + ' application' + (rows.length === 1 ? '' : 's') +
        (rows.length ? ' · ' + STATUSES.map(function (s) { return (counts[s] || 0) + ' ' + STATUS_LABELS[s].toLowerCase(); }).join(' · ') : ''));
      render();
    } catch (err) {
      if (seq !== loadSeq) return;
      rows = [];
      el('amb-admin-list').innerHTML = '';
      setStatus('Could not load applications. Check your connection and that migration_36 has been run in Supabase.', 'error');
    }
  }

  async function saveStatus(id, button) {
    var select = document.querySelector('select[data-status-for="' + id + '"]');
    var row = rows.filter(function (r) { return r.id === id; })[0];
    if (!select || !row) return;
    var next = select.value;
    if (STATUSES.indexOf(next) === -1) return;
    if (next === row.status) {
      setStatus('Status is already ' + STATUS_LABELS[next].toLowerCase() + '.');
      return;
    }
    button.disabled = true;
    try {
      var res = await supabaseClient
        .from('ambassador_applications')
        .update({ status: next })
        .eq('id', id)
        .select(COLUMNS)
        .single();
      if (res.error || !res.data) throw res.error || new Error('no row');
      Object.assign(row, res.data);
      openIds[id] = true;
      setStatus(row.full_name + ' is now marked ' + STATUS_LABELS[next].toLowerCase() + '.', 'success');
      render();
    } catch (err) {
      button.disabled = false;
      setStatus('Could not save that status. Refresh and try again.', 'error');
    }
  }

  window.initAdminAmbassadors = function () {
    if (!el('amb-admin-list')) return;
    el('amb-admin-refresh').addEventListener('click', load);
    el('amb-admin-filter').addEventListener('change', render);
    el('amb-admin-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-save-status]');
      if (btn) saveStatus(btn.dataset.saveStatus, btn);
    });
    // Remember which applications are expanded so a save or refresh keeps them open.
    el('amb-admin-list').addEventListener('toggle', function (e) {
      var d = e.target;
      if (d && d.matches && d.matches('details.amb-app')) {
        if (d.open) openIds[d.dataset.id] = true;
        else delete openIds[d.dataset.id];
      }
    }, true);
    load();
  };
})();
