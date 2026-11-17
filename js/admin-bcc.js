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

  function miamiClock() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day + 'T' +
      values.hour + ':' + values.minute + ':' + values.second;
  }

  function todayISO() { return miamiClock().slice(0, 10); }

  function futureDeadline(value) {
    var time = new Date(value).getTime();
    return Number.isFinite(time) && time > Date.now();
  }

  // Match bcc_default_signup_close(): Saturday strictly before the meeting,
  // at 23:59:59 Miami time. Compare wall clocks so DST and staff travel do
  // not change whether the database default has already expired.
  function defaultDeadlinePassed(date) {
    var day = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(day.getTime())) return true;
    var daysBack = ((day.getUTCDay() || 7) % 7) + 1;
    day.setUTCDate(day.getUTCDate() - daysBack);
    return miamiClock() >= day.toISOString().slice(0, 10) + 'T23:59:59';
  }

  function openForSignups(m) {
    return m.is_open && m.meeting_date >= todayISO() && futureDeadline(m.signup_closes_at);
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
    if (m.meeting_date < todayISO()) return { label: 'Past meeting', cls: 'draft' };
    if (!m.is_open) return { label: 'Closed', cls: 'rejected' };
    if (!futureDeadline(m.signup_closes_at)) return { label: 'Deadline passed', cls: 'draft' };
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
          '<button type="button" class="btn btn-secondary btn-small" data-toggle="' + escapeHtml(m.id) + '"' +
            (m.meeting_date < today ? ' disabled' : '') + '>' +
            (openForSignups(m) ? 'Close sign-ups' : (m.is_open ? 'Reopen sign-ups' : 'Open sign-ups')) + '</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-edit="' + escapeHtml(m.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-delete-meeting="' + escapeHtml(m.id) + '">Delete</button>' +
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
    if (fields.is_open) {
      if (fields.meeting_date < todayISO()) {
        setStatus('bcc-form-status', 'A past meeting cannot be opened for sign-ups. Choose an upcoming meeting date.', 'error');
        el('bcc-date').focus();
        return;
      }
      var currentMeeting = meetings.filter(function (m) { return m.id === editingId; })[0];
      var dateMoved = currentMeeting && currentMeeting.meeting_date !== fields.meeting_date;
      var usesDefault = (!closeVal && (!editingId || closeTouched)) || (dateMoved && !closeTouched);
      var effectiveClose = (!editingId || closeTouched) ? closeVal : (currentMeeting || {}).signup_closes_at;
      var expired = usesDefault ? defaultDeadlinePassed(fields.meeting_date) : !futureDeadline(effectiveClose);
      if (expired) {
        setStatus('bcc-form-status', 'Choose a future sign-up closing time. The current or default deadline has already passed.', 'error');
        el('bcc-closes').focus();
        return;
      }
    }

    if (!editingId || closeTouched) {
      fields.signup_closes_at = closeVal ? new Date(closeVal).toISOString() : null;
    }

    var query = editingId
      ? supabaseClient.from('bcc_meetings').update(fields).eq('id', editingId)
      : supabaseClient.from('bcc_meetings').insert(fields);
    el('bcc-submit-btn').disabled = true;
    query.select('id, is_open, signup_closes_at').single().then(function (res) {
      el('bcc-submit-btn').disabled = false;
      if (res.error || !res.data) {
        setStatus('bcc-form-status', 'Could not save: ' + (res.error ? res.error.message : 'No meeting was saved. Refresh and try again.'), 'error');
        return;
      }
      if (res.data.is_open && !futureDeadline(res.data.signup_closes_at)) {
        setStatus('bcc-form-status', 'Meeting saved, but its deadline has passed. Choose a future closing time to open sign-ups.', 'error');
        load();
        return;
      }
      setStatus('bcc-form-status', editingId ? 'Saved.' : 'Added.', 'success');
      resetForm();
      load();
    }).catch(function () {
      el('bcc-submit-btn').disabled = false;
      setStatus('bcc-form-status', 'Could not reach the server. Please try again.', 'error');
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

  // Sign-ups go with the meeting (on delete cascade in migration_29), so the
  // prompt says how many before anything is removed.
  function deleteMeeting(id) {
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    var n = counts[id] || 0;
    if (!window.confirm('Delete the ' + formatDate(m.meeting_date) + ' meeting' +
      (n ? ' and its ' + n + ' sign-up' + (n === 1 ? '' : 's') : '') + '? This can’t be undone.')) return;
    supabaseClient.from('bcc_meetings').delete().eq('id', id).then(function (res) {
      if (res.error) {
        setStatus('bcc-form-status', 'Could not delete: ' + res.error.message, 'error');
        return;
      }
      if (editingId === id) resetForm();
      if (rosterMeetingId === id) {
        rosterMeetingId = null;
        el('bcc-roster').hidden = true;
      }
      setStatus('bcc-form-status', 'Meeting deleted.', 'success');
      load();
    });
  }

  function toggleOpen(id) {
    var m = meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    if (m.meeting_date < todayISO()) {
      setStatus('bcc-form-status', 'Past meetings cannot be reopened. Choose an upcoming meeting.', 'error');
      return;
    }
    var opening = !openForSignups(m);
    if (opening && !futureDeadline(m.signup_closes_at)) {
      startEdit(id);
      el('bcc-open').checked = true;
      el('bcc-form-heading').textContent = 'Reopen sign-ups';
      el('bcc-submit-btn').textContent = 'Save and reopen';
      setStatus('bcc-form-status', 'Choose a future closing time, then save to reopen sign-ups.', 'error');
      el('bcc-closes').focus();
      return;
    }
    supabaseClient.from('bcc_meetings').update({ is_open: opening }).eq('id', id)
      .select('id, is_open, signup_closes_at').single().then(function (res) {
        if (res.error || !res.data) {
          setStatus('bcc-form-status', 'Could not update: ' + (res.error ? res.error.message : 'No meeting was updated. Refresh and try again.'), 'error');
          return;
        }
        setStatus('bcc-form-status', res.data.is_open && !futureDeadline(res.data.signup_closes_at)
          ? 'The deadline has passed. Choose a future closing time to reopen sign-ups.'
          : (res.data.is_open ? 'Sign-ups opened.' : 'Sign-ups closed.'),
          res.data.is_open && !futureDeadline(res.data.signup_closes_at) ? 'error' : 'success');
        load();
      }).catch(function () {
        setStatus('bcc-form-status', 'Could not reach the server. Please try again.', 'error');
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
      .select('id, full_name, phone, school_type, school_name, school_email, mdcps_student_id, wants_public_comment, created_at')
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
        '<th>#</th><th>Name</th><th>Phone</th><th>School</th><th>Student ID</th><th>School email</th><th>Public comment</th><th>Signed up</th><th></th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + escapeHtml(r.full_name) + '</td>' +
          '<td><a href="tel:+1' + escapeHtml(r.phone) + '">' + escapeHtml(formatPhone(r.phone)) + '</a></td>' +
          '<td>' + escapeHtml(schoolLabel(r)) + '</td>' +
          '<td class="mono">' + escapeHtml(r.mdcps_student_id || '') + '</td>' +
          '<td>' + (r.school_email ? '<a href="mailto:' + escapeHtml(r.school_email) + '">' + escapeHtml(r.school_email) + '</a>' : '') + '</td>' +
          '<td>' + commentLabel(r.wants_public_comment) + '</td>' +
          '<td>' + escapeHtml(formatStamp(r.created_at)) + '</td>' +
          '<td><button type="button" class="btn btn-danger btn-small" data-delete-signup="' + escapeHtml(r.id) + '">Delete</button></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  // school_type and its fields: migration_33.
  function schoolLabel(r) {
    if (r.school_type === 'mdc') return 'Miami Dade College';
    if (r.school_type === 'other') return r.school_name || 'Other college or university';
    return 'MDCPS high school';
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
    var lines = [['Name', 'Phone', 'School', 'MDCPS student ID', 'School email', 'Public comment', 'Signed up'].map(csvCell).join(',')];
    rows.forEach(function (r) {
      lines.push([r.full_name, formatPhone(r.phone), schoolLabel(r), r.mdcps_student_id, r.school_email, commentLabel(r.wants_public_comment),
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

  // Same authenticated client and active-staff RLS as meeting rosters.
  var interestRows = [];
  async function loadInterest() {
    el('bcc-interest-export').disabled = true;
    el('bcc-interest-body').textContent = '';
    interestRows = [];
    setStatus('bcc-interest-status', 'Loading interest list…');
    try {
      // Page through results instead of silently stopping at PostgREST's limit.
      var all = [], offset = 0, batch;
      do {
        var result = await supabaseClient.from('bcc_meeting_interest')
          .select('id,full_name,phone,school_name,public_comment_interest,notification_consent,consented_at,consent_version,created_at,withdrawn_at,registration_type')
          .order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + 499);
        if (result.error) throw new Error(result.error.message);
        batch = result.data || [];
        all = all.concat(batch); offset += batch.length;
      } while (batch.length === 500);
      interestRows = all;
      var active = all.filter(function (r) { return r.notification_consent && !r.withdrawn_at; });
      setStatus('bcc-interest-status', active.length + ' consenting students · ' + (all.length - active.length) + ' removed');
      el('bcc-interest-export').disabled = !active.length;
      var html = '<div class="bcc-table-wrap"><table class="bcc-table"><thead><tr><th>Name</th><th>Mobile phone</th><th>School</th><th>Public comment</th><th>Submitted</th><th>Consent</th></tr></thead><tbody>';
      all.forEach(function (r) {
        html += '<tr><td>' + escapeHtml(r.full_name) + '</td><td>' + escapeHtml(formatPhone(r.phone)) + '</td><td>' + escapeHtml(r.school_name) + '</td><td>' + escapeHtml(r.public_comment_interest || 'Not supplied') + '</td><td>' + escapeHtml(formatStamp(r.created_at)) + '</td><td>' +
          (r.notification_consent && !r.withdrawn_at ? '<button type="button" class="btn btn-secondary btn-small" data-withdraw-interest="' + escapeHtml(r.id) + '">Stop notifications</button>' : 'Removed') + '</td></tr>';
      });
      el('bcc-interest-body').innerHTML = all.length ? html + '</tbody></table></div>' : '<p>No interest registrations yet.</p>';
      return active;
    } catch (err) {
      setStatus('bcc-interest-status', 'Could not load interest registrations. Check your connection and that the meeting interest migration has been applied.', 'error');
      return null;
    }
  }

  async function withdrawInterest(button) {
    var row = interestRows.filter(function (r) { return r.id === button.dataset.withdrawInterest; })[0];
    if (!row || !window.confirm('Stop meeting notifications for ' + formatPhone(row.phone) + '?')) return;
    button.disabled = true;
    try {
      var result = await supabaseClient.from('bcc_meeting_interest').update({ notification_consent: false,
        withdrawn_at: new Date().toISOString(), full_name: 'Removed', school_name: null, public_comment_interest: null })
        .eq('id', row.id).select('id').single();
      if (result.error || !result.data) throw new Error('Not saved');
      await loadInterest();
    } catch (err) {
      button.disabled = false;
      setStatus('bcc-interest-status', 'Could not save removal. Refresh and try again before sending texts.', 'error');
    }
  }

  async function exportInterest() {
    // Refresh consent at export time, not just when the dashboard opened.
    var active = await loadInterest();
    if (!active || !active.length) return;
    var lines = [['Registration type', 'Name', 'Mobile phone', 'School', 'Public comment interest', 'Notification consent', 'Consent recorded (UTC)', 'Consent version', 'Submitted (UTC)']];
    active.forEach(function (r) { lines.push([r.registration_type,r.full_name,r.phone,r.school_name,r.public_comment_interest || '', 'Yes',r.consented_at,r.consent_version,r.created_at]); });
    var blob = new Blob(['\ufeff' + lines.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bcc-meeting-interest.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  window.initAdminBcc = function (context) {
    ctx = context;
    if (!el('bcc-meeting-form')) return;
    el('bcc-interest-refresh').addEventListener('click', loadInterest);
    el('bcc-interest-export').addEventListener('click', exportInterest);
    el('bcc-interest-body').addEventListener('click', function (e) {
      var button = e.target.closest('button[data-withdraw-interest]');
      if (button) withdrawInterest(button);
    });
    loadInterest();
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
      else if (btn.dataset.deleteMeeting) deleteMeeting(btn.dataset.deleteMeeting);
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
