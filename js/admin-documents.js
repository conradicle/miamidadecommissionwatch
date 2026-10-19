// Documents tab of the staff dashboard: upload, preview and publish Meeting
// Summaries and Agenda Summaries.
//
// Reading is done with the signed-in user's own token, so RLS decides what is
// visible (staff see drafts; nobody else does). Writing is not done from
// here. The PDF goes straight to the private uploads bucket, which staff may
// write to, and everything after that (checking the PDF, sanitizing the HTML,
// saving the draft, publishing, discarding) happens behind /api/city-platform
// with the service role, the same split as claim approvals in
// js/admin-claims.js. The guard triggers in migration_27 refuse those writes
// from anywhere else.
(function () {
  var ctx = null;
  var docs = [];
  // Set when the form is uploading a new version of an existing document.
  var target = null;
  var htmlText = '';

  var TYPE_LABELS = { 'meeting-summary': 'Meeting Summary', 'agenda-summary': 'Agenda Summary' };
  var TYPE_CODES = { 'meeting-summary': 'MS', 'agenda-summary': 'AS' };
  var MAX_PDF_BYTES = 30 * 1024 * 1024;
  var MAX_HTML_BYTES = 3 * 1024 * 1024;

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(id, message, kind) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function formatDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Mirrors expectedDocumentNumber in api/_document-lib.js, which has the
  // final say.
  function expectedNumber(type, date) {
    if (!TYPE_CODES[type] || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
    return 'MDCW-' + TYPE_CODES[type] + '-' + date.slice(0, 4) + '-' + date.slice(5, 7) + date.slice(8, 10);
  }

  function parseVersion(v) {
    var m = /^(\d{1,3})\.(\d{1,3})$/.exec(String(v || '').trim());
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  function nextVersion(list) {
    var top = null;
    list.forEach(function (v) {
      var p = parseVersion(v);
      if (p && (!top || p[0] > top[0] || (p[0] === top[0] && p[1] > top[1]))) top = p;
    });
    return top ? top[0] + '.' + (top[1] + 1) : '1.0';
  }

  function publicPdfUrl(path) {
    return path ? supabaseClient.storage.from('documents').getPublicUrl(path).data.publicUrl : null;
  }

  function withToken(fn) {
    return supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) throw new Error('Your session has expired. Log out and log back in, then try again.');
      return fn(session);
    });
  }

  function callServer(payload) {
    return withToken(function (session) {
      return fetch('/api/city-platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || 'The server could not do that.');
          return data;
        });
      });
    });
  }

  // ---------- reading the template's metadata ----------
  // Same tags api/_document-lib.js reads; used here only to fill the form.
  function meta(html, name) {
    var re = new RegExp('<meta\\s+name="' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s+content="([^"]*)"', 'i');
    var m = re.exec(html);
    if (!m) return '';
    var t = document.createElement('textarea');
    t.innerHTML = m[1];
    return t.value.trim();
  }

  // ---------- loading ----------
  // Leaves a message from publish or discard in place: it is the answer to
  // what the user just did, and the reload is only housekeeping.
  function load() {
    var statusEl = el('doc-admin-status');
    var showLoading = !statusEl.textContent;
    if (showLoading) setStatus('doc-admin-status', 'Loading...');
    return supabaseClient
      .from('documents')
      .select('*, document_versions!document_versions_document_id_fkey(id, version, version_major, version_minor, status, issued_on, change_note, page_count, public_pdf_path, title, document_number, published_at, created_at)')
      .order('meeting_date', { ascending: false })
      .then(function (res) {
        if (res.error) {
          var missing = /documents/.test(res.error.message) && /(does not exist|schema cache)/.test(res.error.message);
          setStatus('doc-admin-status', missing
            ? 'The documents table is not in the database yet. Apply supabase/migration_27_documents.sql.'
            : 'Could not load documents: ' + res.error.message, 'error');
          return;
        }
        docs = (res.data || []).map(function (d) {
          d.versions = (d.document_versions || []).slice().sort(function (a, b) {
            return (b.version_major - a.version_major) || (b.version_minor - a.version_minor);
          });
          return d;
        });
        if (showLoading) setStatus('doc-admin-status', '');
        render();
        refreshContext();
      });
  }

  function findDoc(type, date) {
    return docs.filter(function (d) {
      return d.doc_type === type && d.meeting_date === date && d.language === 'en';
    })[0] || null;
  }

  // ---------- list ----------
  function render() {
    var list = el('doc-admin-list');
    if (!docs.length) {
      list.innerHTML = '<p class="stat-empty">No documents yet. Upload the first one above.</p>';
      return;
    }
    list.innerHTML = docs.map(function (d) {
      var draft = d.versions.filter(function (v) { return v.status === 'draft'; })[0];
      var published = d.versions.filter(function (v) { return v.status === 'published'; });
      var current = d.versions.filter(function (v) { return v.id === d.current_version_id; })[0];
      var publicPath = '/documents/' + d.doc_type + '/' + d.meeting_date;

      var versionsHtml = '<ul class="doc-admin-versions">' + d.versions.map(function (v) {
        var pdf = publicPdfUrl(v.public_pdf_path);
        return '<li><span class="v">v' + escapeHtml(v.version) + '</span>' +
          '<span class="submission-status ' + v.status + '">' + (v.status === 'published' ? 'Published' : 'Draft') + '</span>' +
          (v.id === d.current_version_id ? '<span>current</span>' : '') +
          '<span>Issued ' + escapeHtml(formatDate(v.issued_on)) + '</span>' +
          (v.page_count ? '<span>' + escapeHtml(v.page_count) + ' pages</span>' : '') +
          '<a href="/documents/preview.html?version=' + encodeURIComponent(v.id) + '" target="_blank" rel="noopener">Preview</a>' +
          (pdf ? '<a href="' + escapeHtml(pdf) + '" target="_blank" rel="noopener">PDF</a>' : '') +
          (v.change_note ? '<span class="note">' + escapeHtml(v.change_note) + '</span>' : '') +
          '</li>';
      }).join('') + '</ul>';

      var actions = [];
      if (draft) {
        actions.push('<a class="btn btn-secondary btn-small" href="/documents/preview.html?version=' +
          encodeURIComponent(draft.id) + '" target="_blank" rel="noopener">Preview draft v' + escapeHtml(draft.version) + '</a>');
        actions.push('<button type="button" class="btn btn-primary btn-small" data-publish="' + escapeHtml(draft.id) +
          '">Publish v' + escapeHtml(draft.version) + '</button>');
        actions.push('<button type="button" class="btn btn-danger btn-small" data-discard="' + escapeHtml(draft.id) +
          '">Discard draft</button>');
      }
      if (published.length) {
        actions.push('<button type="button" class="btn btn-secondary btn-small" data-new-version="' + escapeHtml(d.id) +
          '">Upload a correction</button>');
        actions.push('<a class="btn btn-secondary btn-small" href="' + publicPath + '" target="_blank" rel="noopener">Public page</a>');
      }

      return '<div class="submission-card">' +
        '<div class="submission-meta">' + escapeHtml(TYPE_LABELS[d.doc_type]) + ' &middot; meeting of ' +
          escapeHtml(formatDate(d.meeting_date)) + ' &middot; ' + escapeHtml(d.document_number) +
          '<span class="submission-status ' + d.status + '">' + (d.status === 'published' ? 'Published' : 'Draft') + '</span></div>' +
        '<h3 style="margin:0 0 6px;">' + escapeHtml(draft && d.status === 'draft' ? draft.title : d.title) + '</h3>' +
        (current ? '<p style="margin:0 0 4px; font-size:14px; color:var(--ink-600);">Readers see version ' + escapeHtml(current.version) +
          (current.published_at ? ', published ' + escapeHtml(formatDate(current.published_at)) : '') + '.</p>' : '') +
        (draft && published.length ? '<p style="margin:0 0 4px; font-size:14px; color:var(--gold-700);">Draft correction v' +
          escapeHtml(draft.version) + ' is waiting to be published.</p>' : '') +
        versionsHtml +
        '<div class="submission-actions">' + actions.join('') + '</div>' +
        '</div>';
    }).join('');
  }

  // ---------- form context: new document or new version ----------
  function refreshContext() {
    var type = el('doc-type').value;
    var date = el('doc-date').value;
    var existing = target || (type && date ? findDoc(type, date) : null);
    var context = el('doc-form-context');
    var changeWrap = el('doc-change-wrap');

    if (!existing) {
      context.hidden = true;
      changeWrap.hidden = true;
      el('doc-form-heading').textContent = 'Upload a document';
      if (!el('doc-version').value) el('doc-version').value = '1.0';
      return;
    }

    var published = existing.versions.filter(function (v) { return v.status === 'published'; })
      .map(function (v) { return v.version; });
    var draft = existing.versions.filter(function (v) { return v.status === 'draft'; })[0];
    var suggested = draft ? draft.version : nextVersion(published);
    if (!el('doc-version').value || el('doc-version').dataset.auto === '1') {
      el('doc-version').value = suggested;
      el('doc-version').dataset.auto = '1';
    }

    var text;
    if (published.length) {
      text = 'This is a new version of ' + existing.document_number + '. Version ' + published.join(', ') +
        ' ' + (published.length === 1 ? 'is' : 'are') + ' published and will stay available. This upload should be version ' +
        suggested + (draft ? ' and replaces the unpublished draft.' : '.');
      el('doc-form-heading').textContent = 'Upload a correction';
    } else {
      text = existing.document_number + ' already has an unpublished draft. Saving replaces it.';
      el('doc-form-heading').textContent = 'Replace the draft';
    }
    context.textContent = text;
    context.hidden = false;
    changeWrap.hidden = !published.length;
    el('doc-cancel-btn').hidden = false;
  }

  function suggestNumber() {
    var expected = expectedNumber(el('doc-type').value, el('doc-date').value);
    var input = el('doc-number');
    // Only fills a blank field or one it filled itself. A number typed by
    // hand or read from the file is left for the save check to judge.
    if (expected && (!input.value || input.dataset.auto === '1')) {
      input.value = expected;
      input.dataset.auto = '1';
    }
  }

  function resetForm() {
    el('doc-form').reset();
    target = null;
    htmlText = '';
    ['doc-number', 'doc-version'].forEach(function (id) {
      delete el(id).dataset.auto;
      delete el(id).dataset.fromFile;
    });
    el('doc-type').disabled = false;
    el('doc-date').disabled = false;
    el('doc-issued').value = todayISO();
    el('doc-cancel-btn').hidden = true;
    updateCount();
    refreshContext();
  }

  function updateCount() {
    var n = el('doc-summary').value.length;
    el('doc-summary-count').textContent = n ? '(' + n + ' characters)' : '';
  }

  // ---------- files ----------
  function onHtmlChosen() {
    var file = el('doc-html').files[0];
    htmlText = '';
    if (!file) return;
    if (file.size > MAX_HTML_BYTES) {
      setStatus('doc-form-status', 'That HTML file is over 3 MB. Remove embedded images and try again.', 'error');
      return;
    }
    file.text().then(function (text) {
      htmlText = text;
      var type = meta(text, 'mdcw:doc-type');
      var date = meta(text, 'mdcw:meeting-date');
      var filled = [];
      function set(id, value, label) {
        if (!value || el(id).disabled) return;
        el(id).value = value;
        filled.push(label);
      }
      if (TYPE_LABELS[type] && !target) set('doc-type', type, 'type');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !target) set('doc-date', date, 'meeting date');
      set('doc-issued', meta(text, 'mdcw:issued'), 'issue date');
      var number = meta(text, 'mdcw:document-number');
      if (number) { set('doc-number', number, 'document number'); el('doc-number').dataset.fromFile = '1'; delete el('doc-number').dataset.auto; }
      var version = meta(text, 'mdcw:version');
      if (version) { set('doc-version', version, 'version'); delete el('doc-version').dataset.auto; }
      var title = /<title>([\s\S]*?)<\/title>/i.exec(text);
      if (!el('doc-title').value && title) {
        var t = document.createElement('textarea');
        t.innerHTML = title[1];
        set('doc-title', t.value.replace(/\s+/g, ' ').trim(), 'title');
      }
      set('doc-summary', meta(text, 'description'), 'summary');
      set('doc-items', meta(text, 'mdcw:items'), 'item numbers');
      set('doc-keywords', meta(text, 'mdcw:keywords'), 'keywords');
      updateCount();
      suggestNumber();
      refreshContext();
      setStatus('doc-form-status', filled.length
        ? 'Filled in from the HTML file: ' + filled.join(', ') + '. Check each field, then choose the PDF.'
        : 'This HTML file has no MDCW metadata tags, so fill in the form by hand.', filled.length ? 'success' : '');
    });
  }

  function checkPdfFile(file) {
    if (!file) return Promise.resolve('Choose the PDF file.');
    if (file.size > MAX_PDF_BYTES) return Promise.resolve('The PDF is over 30 MB.');
    if (file.size < 1000) return Promise.resolve('That PDF is too small to be a document.');
    return file.slice(0, 5).text().then(function (head) {
      return head === '%PDF-' ? null : 'That file is not a PDF.';
    });
  }

  // ---------- save ----------
  function onSubmit(e) {
    e.preventDefault();
    var btn = el('doc-submit-btn');
    var type = el('doc-type').value;
    var date = el('doc-date').value;
    var number = el('doc-number').value.trim().toUpperCase();
    var expected = expectedNumber(type, date);
    var existing = target || findDoc(type, date);
    var hasPublished = existing && existing.versions.some(function (v) { return v.status === 'published'; });

    var problem = null;
    if (!htmlText) problem = 'Choose the HTML source file.';
    else if (!date) problem = 'Enter the meeting date.';
    else if (!el('doc-issued').value) problem = 'Enter the issue date.';
    else if (number !== expected) problem = 'The document number for this type and meeting date should be ' + expected + '.';
    else if (!parseVersion(el('doc-version').value)) problem = 'Versions look like 1.0 or 1.1.';
    else if (el('doc-title').value.trim().length < 3) problem = 'Enter a title.';
    else if (el('doc-summary').value.trim().length < 10) problem = 'Write a short summary of two or three sentences.';
    else if (hasPublished && !el('doc-change').value.trim()) problem = 'Say what this version corrects. Readers see the note in the version history.';
    if (problem) {
      setStatus('doc-form-status', problem, 'error');
      return;
    }

    var pdfFile = el('doc-pdf').files[0];
    btn.disabled = true;
    setStatus('doc-form-status', 'Checking the PDF...');

    checkPdfFile(pdfFile).then(function (pdfProblem) {
      if (pdfProblem) throw new Error(pdfProblem);
      setStatus('doc-form-status', 'Uploading the PDF...');
      var random = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      var path = 'uploads/' + ctx.userId + '/' + random + '.pdf';
      return supabaseClient.storage.from('document-uploads')
        .upload(path, pdfFile, { contentType: 'application/pdf', upsert: false })
        .then(function (res) {
          if (res.error) throw new Error('The PDF upload failed: ' + res.error.message);
          return path;
        });
    }).then(function (path) {
      setStatus('doc-form-status', 'Checking the files and saving the draft...');
      return callServer({
        op: 'save_document_draft',
        document_id: target ? target.id : undefined,
        doc_type: type,
        meeting_date: date,
        language: 'en',
        title: el('doc-title').value.trim(),
        summary: el('doc-summary').value.trim(),
        document_number: number,
        version: el('doc-version').value.trim(),
        issued_on: el('doc-issued').value,
        change_note: el('doc-change').value.trim(),
        item_numbers: el('doc-items').value,
        keywords: el('doc-keywords').value,
        page_count: el('doc-pages').value ? Number(el('doc-pages').value) : undefined,
        upload_pdf_path: path,
        html: htmlText
      });
    }).then(function (result) {
      btn.disabled = false;
      resetForm();
      var status = el('doc-form-status');
      status.className = 'district-status success';
      status.innerHTML = 'Saved draft version ' + escapeHtml(result.version) + ' (' + escapeHtml(result.page_count) +
        ' pages). <a href="/documents/preview.html?version=' + encodeURIComponent(result.version_id) +
        '" target="_blank" rel="noopener">Preview it</a>, then publish it from the list below.';
      return load();
    }).catch(function (err) {
      btn.disabled = false;
      setStatus('doc-form-status', err.message || 'Could not save the draft.', 'error');
    });
  }

  // ---------- list actions ----------
  function versionById(id) {
    for (var i = 0; i < docs.length; i++) {
      for (var j = 0; j < docs[i].versions.length; j++) {
        if (docs[i].versions[j].id === id) return { doc: docs[i], version: docs[i].versions[j] };
      }
    }
    return null;
  }

  function publish(versionId, button) {
    var found = versionById(versionId);
    if (!found) return;
    var label = found.doc.document_number + ', version ' + found.version.version;
    if (!window.confirm('Publish ' + label + '?\n\n' +
      'It goes on the public site and cannot be changed or taken down afterwards. ' +
      'A later correction becomes a new version, and this one stays downloadable.\n\n' +
      'Did you check the preview?')) return;

    button.disabled = true;
    setStatus('doc-admin-status', 'Publishing ' + label + '...');
    callServer({ op: 'publish_document_version', version_id: versionId })
      .then(function () {
        setStatus('doc-admin-status', 'Published ' + label + '. Starting the site rebuild...', 'success');
        var build = typeof window.mdcwStartSiteBuild === 'function'
          ? window.mdcwStartSiteBuild()
          : Promise.resolve({ ok: false, message: 'Use Publish to site on the Tracker archive tab.' });
        return build.then(function (result) {
          setStatus('doc-admin-status', result.ok
            ? 'Published ' + label + '. The site is rebuilding; the page is live in about a minute.'
            : 'Published ' + label + ', but the rebuild did not start: ' + result.message, result.ok ? 'success' : 'error');
        });
      })
      .catch(function (err) {
        setStatus('doc-admin-status', err.message || 'Could not publish.', 'error');
      })
      .then(load);
  }

  function discard(versionId, button) {
    var found = versionById(versionId);
    if (!found) return;
    if (!window.confirm('Discard draft version ' + found.version.version + ' of ' + found.doc.document_number +
      '? Its uploaded files are deleted. Published versions are not affected.')) return;
    button.disabled = true;
    callServer({ op: 'discard_document_draft', version_id: versionId })
      .then(function () { setStatus('doc-admin-status', 'Draft discarded.', 'success'); })
      .catch(function (err) { setStatus('doc-admin-status', err.message || 'Could not discard the draft.', 'error'); })
      .then(load);
  }

  function startNewVersion(docId) {
    var d = docs.filter(function (x) { return x.id === docId; })[0];
    if (!d) return;
    resetForm();
    target = d;
    el('doc-type').value = d.doc_type;
    el('doc-date').value = d.meeting_date;
    el('doc-type').disabled = true;
    el('doc-date').disabled = true;
    el('doc-number').value = d.document_number;
    el('doc-title').value = d.title;
    el('doc-summary').value = d.summary;
    el('doc-items').value = (d.item_numbers || []).join(', ');
    el('doc-keywords').value = (d.keywords || []).join(', ');
    el('doc-version').dataset.auto = '1';
    el('doc-version').value = '';
    updateCount();
    refreshContext();
    setStatus('doc-form-status', 'Choose the corrected HTML and PDF. Remember to raise the version number inside the HTML before building the PDF.');
    el('doc-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- init ----------
  window.initAdminDocuments = function (context) {
    ctx = context;
    if (!el('doc-form')) return;

    el('doc-issued').value = todayISO();
    el('doc-html').addEventListener('change', onHtmlChosen);
    el('doc-type').addEventListener('change', function () { suggestNumber(); refreshContext(); });
    el('doc-date').addEventListener('change', function () { suggestNumber(); refreshContext(); });
    el('doc-number').addEventListener('input', function () {
      delete el('doc-number').dataset.auto;
      delete el('doc-number').dataset.fromFile;
    });
    el('doc-version').addEventListener('input', function () { delete el('doc-version').dataset.auto; });
    el('doc-summary').addEventListener('input', updateCount);
    el('doc-form').addEventListener('submit', onSubmit);
    el('doc-cancel-btn').addEventListener('click', function () {
      resetForm();
      setStatus('doc-form-status', '');
    });
    el('doc-refresh').addEventListener('click', load);

    el('doc-admin-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.publish) publish(btn.dataset.publish, btn);
      else if (btn.dataset.discard) discard(btn.dataset.discard, btn);
      else if (btn.dataset.newVersion) startNewVersion(btn.dataset.newVersion);
    });

    load();
  };
})();
