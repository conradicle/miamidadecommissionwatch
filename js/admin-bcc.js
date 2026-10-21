// BCC Sign-ups tab of the staff dashboard: meetings students can sign up for
// at /attend, and the roster for each.
//
// bcc_meetings and bcc_signups (migration_29) are staff-only under RLS, so
// staff read and write them directly with their own session, like the
// Schedule tab. Sign-ups are only ever created by the public form through
// api/city-platform.js; nothing here inserts one.
(function () {
  var ctx = null;
  var meetings = [];
  var counts = {};
  var schedule = [];
  var editingId = null;
  var closeTouched = false;
  var rosterMeetingId = null;
  var roster = [];

  var DEFAULT_LOCATION = 'Commission Chambers, Stephen P. Clark Government Center, 111 NW 1st Street, Miami';
  var DEFAULT_TITLE = 'Board of County Commissioners Meeting';
  var TZ = 'America/New_York';

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(id, message, kind) {
    var node = el(id);
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    if (!m) return '';
    var h = Number(m[1]);
    return (((h + 11) % 12) + 1) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function formatStamp(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-US', {
      timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function formatPhone(p) {
    var m = /^(\d{3})(\d{3})(\d{4})$/.exec(p || '');
    return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : (p || '');
  }

  function commentLabel(v) {
    return v === true ? 'Yes' : v === false ? 'No' : 'Maybe';
  }

  // <input type="datetime-local"> works in the browser's own time zone, which
  // for staff is Miami's. These convert between it and a stored timestamptz.
  function toLocalInput(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function meetingState(m) {
    if (!m.is_open) return { label: 'Closed', cls: 'rejected' };
    if (new Date(m.signup_closes_at) <= new Date()) return { label: 'Window passed', cls: 'draft' };
    return { label: 'Open', cls: 'approved' };
  }

  // ---------- meetings ----------

  function load() {
    return Promise.all([
      supabaseClient.from('bcc_meetings').select('*').order('meeting_date', { ascending: false }),
      supabaseClient.from('bcc_signups').select('meeting_id'),
      supabaseClient.from('meeting_schedule').select('meeting_date, start_time, meeting_type, location, cancelled')
        .gte('meeting_date', todayISO()).order('meeting_date', { ascending: true })
    ]).then(function (results) {
      var mRes = results[0];
      if (mRes.error) {
        el('bcc-meeting-list').innerHTML = '<p class="district-status error">Could not load meetings: ' +
          escapeHtml(mRes.error.message) + '</p>';
        return;
      }
      meetings = mRes.data || [];
      counts = {};
      (results[1].data || []).forEach(function (r) { counts[r.meeting_id] = (counts[r.meeting_id] || 0) + 1; });
      schedule = (results[2].data || []).filter(function (r) { return !r.cancelled; });
      renderScheduleOptions();
      renderMeetings();
      if (rosterMeetingId) loadRoster(rosterMeetingId);
    });
  }

  function renderScheduleOptions() {
    var select = el('bcc-from-schedule');
    select.innerHTML = '<option value="">Fill from the Schedule tab&hellip;</option>' +
      schedule.map(function (r, i) {
        return '<option value="' + i + '">' + escapeHtml(formatDate(r.meeting_date) + ' · ' + r.meeting_type) + '</option>';
      }).join('');
    select.hidden = schedule.length === 0;
  }

  function renderMeetings() {
    if (!meetings.length) {
      el('bcc-meeting-list').innerHTML = '<p class="stat-empty">No meetings yet. Add one above, tick “Open for sign-ups”, and /attend will show it.</p>';
      return;
    }
    var today = todayISO();
    function card(m) {
      var state = meetingState(m);
      var n = counts[m.id] || 0;
      return '<div class="submission-card bcc-meeting-card' + (m.id === rosterMeetingId ? ' is-selected' : '') + '">' +
        '<div class="submission-meta">' + escapeHtml(m.title) +
          '<span class="submission-status ' + state.cls + '">' + state.label + '</span></div>' +
        '<h3 style="margin:0 0 4px; font-size:18px;">' + escapeHtml(formatDate(m.meeting_date)) +
          (m.start_time ? ', ' + escapeHtml(formatTime(m.start_time)) : '') + '</h3>' +
        '<p style="margin:0; font-size:14px; color:var(--ink-600);">Sign-ups close ' + escapeHtml(formatStamp(m.signup_closes_at)) +
          ' &middot; <strong>' + n + '</strong> signed up</p>' +
        (m.notes ? '<p style="margin:6px 0 0; font-size:14px;">' + escapeHtml(m.notes) + '</p>' : '') +
        '<div class="submission-actions" style="margin-top:10px;">' +
          '<button type="button" class="btn btn-primary btn-small" data-roster="' + escapeHtml(m.id) + '">Roster (' + n + ')</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-toggle="' + escapeHtml(m.id) + '">' +
            (m.is_open ? 'Close sign-ups' : 'Open sign-ups') + '</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-edit="' + escapeHtml(m.id) + '">Edit</button>' +
        '</div></div>';
    }
    var upcoming = meetings.filter(function (m) { return m.meeting_date >= today; }).reverse();
    var past = meetings.filter(function (m) { return m.meeting_date < today; });
    el('bcc-meeting-list').innerHTML =
      '<h3>Upcoming</h3>' + (upcoming.length ? upcoming.map(card).join('') : '<p class="stat-empty">No upcoming meetings.</p>') +
      (past.length ? '<details style="margin-top:16px;"><summary style="cursor:pointer; font-weight:600;">Past meetings (' +
        past.length + ')</summary>' + past.map(card).join('') + '</details>' : '');
  }

  function resetForm() {
    editingId = null;
    closeTouched = false;
    el('bcc-meeting-form').reset();
    el('bcc-time').value = '09:30';
    el('bcc-title').value = DEFAULT_TITLE;
    el('bcc-location').value = DEFAULT_LOCATION;
    el('bcc-form-heading').textContent = 'Add a meeting';
    el('bcc-submit-btn').textContent = 'Save meeting';
    el('bcc-cancel-btn').hidden = true;
  }

  function onScheduleFill() {
    var r = schedule[Number(el('bcc-from-schedule').value)];
    if (!r) return;
    el('bcc-date').value = r.meeting_date;
    if (r.start_time) el('bcc-time').value = r.start_time.slice(0, 5);
    if (r.location) el('bcc-location').value = r.location;
    el('bcc-title').value = r.meeting_type === 'Regular Meeting' ? DEFAULT_TITLE : 'BCC ' + r.meeting_type;
    el('bcc-from-schedule').value = '';
  }

  function onSubmit(e) {
    e.preventDefault();
    var fields = {
      meeting_date: el('bcc-date').value,
      start_time: el('bcc-time').value || '09:30',
      title: el('bcc-title').value.trim(),
      location: el('bcc-location').value.trim(),
      is_open: el('bcc-open').checked,
      notes: el('bcc-notes').value.trim() || null
    };
    if (!fields.meeting_date || fields.title.length < 3) {
      setStatus('bcc-form-status', 'Enter a date and a title.', 'error');
      return;
    }
    // Only send a close time someone actually chose. Left out, the database
    // fills the Saturday before (and follows the date if it moves); blanked,
    // it goes back to that default.
    var closeVal = el('bcc-closes').value;
    if (!editingId || closeTouched) {
      fields.signup_closes_at = closeVal ? new Date(closeVal).toISOString() : null;
    }

    var query = editingId
      ? supabaseClient.from('bcc_meetings').update(fields).eq('id', editingId)
      : supabaseClient.from('bcc_meetings').insert(fields);
    el('bcc-submit-btn').disabled = true;
    query.then(function (res) {
      el('bcc-submit-btn').disabled = false;
      if (res.error) {
        setStatus('bcc-form-status', 'Could not save: ' + res.error.message, 'error');
        return;
      }
      setStatus('bcc-form-status', editingId ? 'Saved.' : 'Added.', 'success');
      resetForm();
      load();
    });
  }

  function startEdit(id) {
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    editingId = id;
    closeTouched = false;
    el('bcc-date').value = m.meeting_date;
    el('bcc-time').value = (m.start_time || '').slice(0, 5);
    el('bcc-title').value = m.title;
    el('bcc-location').value = m.location || '';
    el('bcc-closes').value = toLocalInput(m.signup_closes_at);
    el('bcc-open').checked = !!m.is_open;
    el('bcc-notes').value = m.notes || '';
    el('bcc-form-heading').textContent = 'Edit meeting';
    el('bcc-submit-btn').textContent = 'Save changes';
    el('bcc-cancel-btn').hidden = false;
    setStatus('bcc-form-status', '');
    el('bcc-meeting-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleOpen(id) {
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    var opening = !m.is_open;
    if (opening && new Date(m.signup_closes_at) <= new Date() &&
        !window.confirm('Sign-ups for this meeting closed ' + formatStamp(m.signup_closes_at) +
          '. Opening it won’t show it on /attend until you move the close time later. Open anyway?')) return;
    supabaseClient.from('bcc_meetings').update({ is_open: opening }).eq('id', id).then(function (res) {
      setStatus('bcc-form-status', res.error ? 'Could not update: ' + res.error.message
        : (opening ? 'Sign-ups opened.' : 'Sign-ups closed.'), res.error ? 'error' : 'success');
      load();
    });
  }

  // ---------- roster ----------

  function loadRoster(id) {
    rosterMeetingId = id;
    renderMeetings();
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    el('bcc-roster').hidden = false;
    el('bcc-roster-heading').textContent = m ? 'Roster: ' + formatDate(m.meeting_date) : 'Roster';
    el('bcc-roster-body').innerHTML = '<p class="stat-empty">Loading&hellip;</p>';
    supabaseClient.from('bcc_signups')
      .select('id, full_name, phone, mdcps_student_id, wants_public_comment, created_at')
      .eq('meeting_id', id)
      .order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          el('bcc-roster-body').innerHTML = '<p class="district-status error">Could not load the roster: ' +
            escapeHtml(res.error.message) + '</p>';
          return;
        }
        roster = res.data || [];
        renderRoster();
      });
  }

  function filteredRoster() {
    var f = el('bcc-roster-filter').value;
    return roster.filter(function (r) {
      if (f === 'yes') return r.wants_public_comment === true;
      if (f === 'maybe') return r.wants_public_comment === null;
      if (f === 'no') return r.wants_public_comment === false;
      if (f === 'yes-maybe') return r.wants_public_comment !== false;
      return true;
    });
  }

  function renderRoster() {
    var rows = filteredRoster();
    var yes = roster.filter(function (r) { return r.wants_public_comment === true; }).length;
    var maybe = roster.filter(function (r) { return r.wants_public_comment === null; }).length;
    el('bcc-roster-count').textContent = roster.length + ' signed up · ' + yes + ' want to comment · ' + maybe + ' maybe' +
      (rows.length !== roster.length ? ' · showing ' + rows.length : '');
    el('bcc-export').disabled = rows.length === 0;
    if (!rows.length) {
      el('bcc-roster-body').innerHTML = '<p class="stat-empty">' + (roster.length ? 'Nobody matches this filter.' : 'No sign-ups yet.') + '</p>';
      return;
    }
    el('bcc-roster-body').innerHTML =
      '<div class="bcc-table-wrap"><table class="bcc-table"><thead><tr>' +
        '<th>#</th><th>Name</th><th>Phone</th><th>Student ID</th><th>Public comment</th><th>Signed up</th><th></th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + escapeHtml(r.full_name) + '</td>' +
          '<td><a href="tel:+1' + escapeHtml(r.phone) + '">' + escapeHtml(formatPhone(r.phone)) + '</a></td>' +
          '<td class="mono">' + escapeHtml(r.mdcps_student_id) + '</td>' +
          '<td>' + commentLabel(r.wants_public_comment) + '</td>' +
          '<td>' + escapeHtml(formatStamp(r.created_at)) + '</td>' +
          '<td><button type="button" class="btn btn-danger btn-small" data-delete-signup="' + escapeHtml(r.id) + '">Delete</button></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function deleteSignup(id) {
    var r = roster.filter(function (x) { return x.id === id; })[0];
    if (!r || !window.confirm('Delete ' + r.full_name + '’s sign-up? This can’t be undone.')) return;
    supabaseClient.from('bcc_signups').delete().eq('id', id).then(function (res) {
      if (res.error) {
        window.alert('Could not delete: ' + res.error.message);
        return;
      }
      roster = roster.filter(function (x) { return x.id !== id; });
      counts[rosterMeetingId] = Math.max(0, (counts[rosterMeetingId] || 1) - 1);
      renderMeetings();
      renderRoster();
    });
  }

  // A leading = + - @ makes Excel and Sheets treat a cell as a formula. Names
  // come from the public, so neutralize them before they reach a spreadsheet.
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var rows = filteredRoster();
    var m = meetings.filter(function (x) { return x.id === rosterMeetingId; })[0];
    var lines = [['Name', 'Phone', 'MDCPS student ID', 'Public comment', 'Signed up'].map(csvCell).join(',')];
    rows.forEach(function (r) {
      lines.push([r.full_name, formatPhone(r.phone), r.mdcps_student_id, commentLabel(r.wants_public_comment),
        formatStamp(r.created_at)].map(csvCell).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var suffix = el('bcc-roster-filter').value === 'all' ? '' : '-' + el('bcc-roster-filter').value;
    a.download = 'bcc-signups-' + (m ? m.meeting_date : 'roster') + suffix + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  window.initAdminBcc = function (context) {
    ctx = context;
    if (!el('bcc-meeting-form')) return;
    resetForm();
    el('bcc-meeting-form').addEventListener('submit', onSubmit);
    el('bcc-cancel-btn').addEventListener('click', function () { resetForm(); setStatus('bcc-form-status', ''); });
    el('bcc-closes').addEventListener('input', function () { closeTouched = true; });
    el('bcc-from-schedule').addEventListener('change', onScheduleFill);
    el('bcc-meeting-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.roster) loadRoster(btn.dataset.roster);
      else if (btn.dataset.toggle) toggleOpen(btn.dataset.toggle);
      else if (btn.dataset.edit) startEdit(btn.dataset.edit);
    });
    el('bcc-roster-filter').addEventListener('change', renderRoster);
    el('bcc-export').addEventListener('click', exportCsv);
    el('bcc-roster-body').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-delete-signup]');
      if (btn) deleteSignup(btn.dataset.deleteSignup);
    });
    load();
  };
})();
