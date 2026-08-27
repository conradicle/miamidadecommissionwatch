// Claims tab of the staff dashboard: requests from the public to run a city.
//
// Reading is done with the signed-in user's own token, so RLS decides what is
// visible -- claim_requests is staff-only, which is why students cannot read
// each other's names, emails and schools.
//
// Deciding is NOT done from here. Approving has to create a login, write a
// membership, flip the city live and send mail, which needs the service role;
// that all lives in /api/decide-claim. This file collects the decision and
// posts it.
(function () {
  var ctx = null;
  var claims = [];
  var view = 'pending';

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    var node = el('claims-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }

  // ---------- loading ----------
  function load() {
    return window.supabaseClient
      .from('claim_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          setStatus('Could not load claims: ' + (res.error.message || 'unknown error'), 'error');
          return;
        }
        claims = res.data || [];
        var pending = claims.filter(function (c) { return c.status === 'pending'; }).length;
        var counter = el('claims-count');
        if (counter) counter.textContent = pending ? pending : '';
        render();
      });
  }

  function render() {
    var host = el('claims-list');
    var rows = claims.filter(function (c) {
      return view === 'pending' ? c.status === 'pending' : c.status !== 'pending';
    });

    if (!rows.length) {
      host.innerHTML = '<p style="color:var(--ink-400); font-style:italic;">' +
        (view === 'pending' ? 'No requests waiting.' : 'Nothing decided yet.') + '</p>';
      return;
    }

    host.innerHTML = rows.map(function (c) {
      var head = '<h4 style="margin:0 0 4px;">' + escapeHtml(c.city_name) +
        '<span class="ac-badge ac-badge-' + (c.status === 'approved' ? 'published' : 'draft') + '">' +
        escapeHtml(c.status) + '</span></h4>';

      var meta = '<div class="ac-meta">' + escapeHtml(c.requester_name) + ' &middot; ' +
        '<a href="mailto:' + escapeHtml(c.requester_email) + '">' + escapeHtml(c.requester_email) + '</a>' +
        ' &middot; ' + formatDate(c.created_at) + '</div>';

      var detail = '<p style="font-size:14px; margin:8px 0 4px;">' +
        '<strong>Affiliation:</strong> ' + escapeHtml(c.affiliation || 'not given') + '<br>' +
        '<strong>Has a team:</strong> ' + (c.has_team ? 'yes' : 'no') + '</p>';

      if (c.reason) {
        detail += '<div class="submission-body">' + escapeHtml(c.reason) + '</div>';
      }
      if (c.denial_reason) {
        detail += '<p style="font-size:14px;"><strong>Denied because:</strong> ' +
          escapeHtml(c.denial_reason) + '</p>';
      }

      var actions = '';
      if (c.status === 'pending') {
        // Governance has to be chosen here: a city cannot go active without it
        // (the CHECK in migration_18), and guessing it would put invented
        // districts on the map.
        actions =
          '<div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--line);">' +
            '<div class="field" style="max-width:340px;">' +
              '<label for="claim-gov-' + escapeHtml(c.id) + '">How does ' +
                escapeHtml(c.city_name) + ' elect its seats?</label>' +
              '<select id="claim-gov-' + escapeHtml(c.id) + '">' +
                '<option value="">Choose before approving&hellip;</option>' +
                '<option value="at-large">At large (every seat citywide)</option>' +
                '<option value="district">By district</option>' +
              '</select>' +
            '</div>' +
            '<div class="field" style="max-width:460px;">' +
              '<label for="claim-reason-' + escapeHtml(c.id) + '">Reason, if denying (optional)</label>' +
              '<input type="text" id="claim-reason-' + escapeHtml(c.id) + '" maxlength="400">' +
            '</div>' +
            '<div class="submission-actions">' +
              '<button type="button" class="btn btn-primary btn-small" data-approve="' + escapeHtml(c.id) + '">Approve</button>' +
              '<button type="button" class="btn btn-danger btn-small" data-deny="' + escapeHtml(c.id) + '">Deny</button>' +
            '</div>' +
          '</div>';
      }

      return '<div class="admin-form" style="margin-bottom:18px;">' +
        head + meta + detail + actions + '</div>';
    }).join('');
  }

  // ---------- deciding ----------
  function decide(claimId, action) {
    var claim = claims.filter(function (c) { return c.id === claimId; })[0];
    if (!claim) return;

    var governance = '';
    var govField = el('claim-gov-' + claimId);
    if (govField) governance = govField.value;

    if (action === 'approve') {
      if (!governance) {
        setStatus('Choose how ' + claim.city_name + ' elects its seats first — the map needs it to be accurate.', 'error');
        return;
      }
      if (!window.confirm('Approve ' + claim.requester_name + ' to run ' + claim.city_name +
          '? They will be emailed a login and can publish immediately.')) return;
    } else {
      if (!window.confirm('Deny this request? ' + claim.city_name +
          ' goes back on the list for someone else.')) return;
    }

    var reasonField = el('claim-reason-' + claimId);
    setStatus(action === 'approve' ? 'Approving…' : 'Denying…');

    window.supabaseClient.auth.getSession().then(function (sessionRes) {
      var token = sessionRes && sessionRes.data && sessionRes.data.session &&
        sessionRes.data.session.access_token;
      if (!token) {
        setStatus('Your session expired. Reload and sign in again.', 'error');
        return;
      }

      return fetch('/api/decide-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
          claim_id: claimId,
          action: action,
          governance: governance || undefined,
          denial_reason: reasonField ? reasonField.value.trim() : ''
        })
      })
        .then(function (res) {
          return res.json().then(function (body) { return { ok: res.ok, body: body }; });
        })
        .then(function (result) {
          if (!result.ok) {
            setStatus((result.body && result.body.error) || 'That did not work.', 'error');
            return;
          }
          setStatus(action === 'approve'
            ? claim.city_name + ' is live and ' + claim.requester_name + ' has been emailed a login. ' +
              'Its subdomain still needs a CNAME in Cloudflare and a domain in Vercel.'
            : 'Denied, and ' + claim.city_name + ' is back on the list.', 'success');
          load();
          if (typeof window.reloadAdminCities === 'function') window.reloadAdminCities();
        });
    });
  }

  // ---------- wiring ----------
  window.initAdminClaims = function (context) {
    ctx = context;
    if (!el('panel-claims')) return;

    Array.prototype.forEach.call(document.querySelectorAll('#claims-nav .city-nav-btn'), function (btn) {
      btn.addEventListener('click', function () {
        view = btn.getAttribute('data-claims');
        Array.prototype.forEach.call(document.querySelectorAll('#claims-nav .city-nav-btn'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        render();
      });
    });

    // Delegated, because rows are re-rendered after every decision.
    el('panel-claims').addEventListener('click', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-approve')) decide(t.getAttribute('data-approve'), 'approve');
      if (t.hasAttribute('data-deny')) decide(t.getAttribute('data-deny'), 'deny');
    });

    load();
  };
})();
