// Schedule tab of the staff dashboard: upcoming BCC meeting dates.
//
// meeting_schedule (migration_27) is plain public information from the
// county calendar, so staff write it directly with their own session; RLS
// limits writes to active staff. Nothing here needs the service role.
(function () {
  var ctx = null;
  var rows = [];
  var editingId = null;

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    var node = el('schedule-status');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatWhen(row) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.meeting_date);
    var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    var date = d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : row.meeting_date;
    var t = /^(\d{1,2}):(\d{2})/.exec(row.start_time || '');
    if (t) {
      var h = Number(t[1]);
      date += ', ' + (((h + 11) % 12) + 1) + ':' + t[2] + ' ' + (h < 12 ? 'AM' : 'PM');
    }
    return date;
  }

  function load() {
    return supabaseClient
      .from('meeting_schedule')
      .select('*')
      .order('meeting_date', { ascending: true })
      .then(function (res) {
        if (res.error) {
          el('schedule-list').innerHTML = '<p class="district-status error">Could not load the schedule: ' +
            escapeHtml(res.error.message) + '</p>';
          return;
        }
        rows = res.data || [];
        render();
      });
  }

  function render() {
    var today = todayISO();
    var upcoming = rows.filter(function (r) { return r.meeting_date >= today; });
    var past = rows.filter(function (r) { return r.meeting_date < today; }).reverse();

    function card(r) {
      return '<div class="submission-card" style="padding:16px 20px; margin-bottom:12px;">' +
        '<div class="submission-meta">' + escapeHtml(r.meeting_type) +
          (r.cancelled ? '<span class="submission-status rejected">Cancelled</span>' : '') + '</div>' +
        '<h3 style="margin:0 0 4px; font-size:18px;">' + escapeHtml(formatWhen(r)) + '</h3>' +
        (r.location ? '<p style="margin:0; font-size:14px; color:var(--ink-600);">' + escapeHtml(r.location) + '</p>' : '') +
        (r.note ? '<p style="margin:4px 0 0; font-size:14px;">' + escapeHtml(r.note) + '</p>' : '') +
        '<div class="submission-actions" style="margin-top:10px;">' +
          '<button type="button" class="btn btn-secondary btn-small" data-edit="' + escapeHtml(r.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-delete="' + escapeHtml(r.id) + '">Delete</button>' +
        '</div></div>';
    }

    el('schedule-list').innerHTML =
      '<h3>Upcoming</h3>' + (upcoming.length ? upcoming.map(card).join('')
        : '<p class="stat-empty">No upcoming dates. Add them from the county calendar so the homepage can show the next meeting.</p>') +
      (past.length ? '<details style="margin-top:16px;"><summary style="cursor:pointer; font-weight:600;">Past dates (' +
        past.length + ')</summary>' + past.map(card).join('') + '</details>' : '');
  }

  function resetForm() {
    editingId = null;
    el('schedule-form').reset();
    el('s-time').value = '09:30';
    el('s-type').value = 'Regular Meeting';
    el('s-location').value = 'Commission Chambers, Stephen P. Clark Government Center, 111 NW 1st Street, Miami';
    el('schedule-form-heading').textContent = 'Add a meeting date';
    el('schedule-submit-btn').textContent = 'Save date';
    el('schedule-cancel-btn').hidden = true;
  }

  function onSubmit(e) {
    e.preventDefault();
    var fields = {
      meeting_date: el('s-date').value,
      start_time: el('s-time').value || null,
      meeting_type: el('s-type').value.trim(),
      location: el('s-location').value.trim() || null,
      note: el('s-note').value.trim() || null,
      cancelled: el('s-cancelled').checked
    };
    if (!fields.meeting_date || fields.meeting_type.length < 3) {
      setStatus('Enter a date and a meeting type.', 'error');
      return;
    }
    var query = editingId
      ? supabaseClient.from('meeting_schedule').update(fields).eq('id', editingId)
      : supabaseClient.from('meeting_schedule').insert(Object.assign({ created_by: ctx.userId }, fields));
    el('schedule-submit-btn').disabled = true;
    query.then(function (res) {
      el('schedule-submit-btn').disabled = false;
      if (res.error) {
        setStatus(/duplicate|unique/i.test(res.error.message)
          ? 'That date already has a ' + fields.meeting_type + '. Edit it instead.'
          : 'Could not save: ' + res.error.message, 'error');
        return;
      }
      setStatus(editingId ? 'Saved.' : 'Added.', 'success');
      resetForm();
      load();
    });
  }

  function startEdit(id) {
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    editingId = id;
    el('s-date').value = r.meeting_date;
    el('s-time').value = (r.start_time || '').slice(0, 5);
    el('s-type').value = r.meeting_type;
    el('s-location').value = r.location || '';
    el('s-note').value = r.note || '';
    el('s-cancelled').checked = !!r.cancelled;
    el('schedule-form-heading').textContent = 'Edit meeting date';
    el('schedule-submit-btn').textContent = 'Save changes';
    el('schedule-cancel-btn').hidden = false;
    setStatus('');
    el('schedule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function remove(id) {
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r || !window.confirm('Delete ' + r.meeting_type + ' on ' + formatWhen(r) +
      '? If the meeting was called off, marking it cancelled tells readers more.')) return;
    supabaseClient.from('meeting_schedule').delete().eq('id', id).then(function (res) {
      setStatus(res.error ? 'Could not delete: ' + res.error.message : 'Deleted.', res.error ? 'error' : 'success');
      load();
    });
  }

  window.initAdminSchedule = function (context) {
    ctx = context;
    if (!el('schedule-form')) return;
    el('schedule-form').addEventListener('submit', onSubmit);
    el('schedule-cancel-btn').addEventListener('click', function () { resetForm(); setStatus(''); });
    el('schedule-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.edit) startEdit(btn.dataset.edit);
      else if (btn.dataset.delete) remove(btn.dataset.delete);
    });
    load();
  };
})();
