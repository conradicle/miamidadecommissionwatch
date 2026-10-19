// Staff-only document operations: save a draft, publish it, discard it.
//
// These run on the server for the same reason claim approvals do: each needs
// something the browser must not be trusted with. Saving sanitizes the HTML
// and checks the PDF before anything is stored; publishing copies the PDF
// into the public bucket, which only the service role can write. The guard
// triggers in migration_27 refuse the same writes from anywhere else, so this
// file is the only path a document takes to the public site.
//
// Flow, from the Documents tab of the dashboard:
//   1. the browser uploads the PDF to document-uploads/uploads/<user id>/...
//      (staff-only storage policy) and reads the HTML file as text
//   2. save_document_draft  -> checks both, stores sanitized HTML, writes the
//                              draft version (replacing an earlier draft)
//   3. staff preview the draft at /documents/preview.html
//   4. publish_document_version -> copies the PDF to the public bucket under a
//                              versioned name and makes the version current
//
// Published versions are never touched again. A correction is a new upload,
// which becomes the next version (1.0 -> 1.1) and keeps the old one listed.
var lib = require('./_document-lib.js');

var UPLOAD_BUCKET = 'document-uploads';
var PUBLIC_BUCKET = 'documents';

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

module.exports = async function handler(req, res) {
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  var body = req.body || {};
  var op = body.op;

  var serviceHeaders = {
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  // ---------- small REST helpers ----------
  async function rest(method, path, payload, extraHeaders) {
    var headers = Object.assign({}, serviceHeaders, extraHeaders || {});
    var r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: method,
      headers: headers,
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    var text = await r.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) {
      var message = (data && (data.message || data.error)) || ('Database error ' + r.status);
      var err = new Error(message);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  async function storageGet(bucket, path) {
    var r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + encodePath(path), {
      headers: { Authorization: 'Bearer ' + SERVICE_ROLE_KEY, apikey: SERVICE_ROLE_KEY }
    });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }

  // x-upsert false: storage answers 409 rather than replace an existing file.
  async function storagePut(bucket, path, bytes, contentType) {
    var r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + encodePath(path), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': contentType,
        'x-upsert': 'false',
        'cache-control': 'max-age=31536000'
      },
      body: bytes
    });
    if (!r.ok) {
      var text = await r.text();
      var err = new Error(r.status === 409 || /exists/i.test(text)
        ? 'A file already exists at ' + bucket + '/' + path + '. Published files are never replaced.'
        : 'Storage refused the file (' + r.status + ').');
      err.status = r.status;
      throw err;
    }
  }

  async function storageRemove(bucket, paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) return;
    try {
      await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket, {
        method: 'DELETE',
        headers: serviceHeaders,
        body: JSON.stringify({ prefixes: list })
      });
    } catch (e) {
      // Orphaned draft files cost a little storage and nothing else.
    }
  }

  try {
    // ---------- caller must be active staff ----------
    var callerRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SERVICE_ROLE_KEY }
    });
    if (!callerRes.ok) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    var caller = await callerRes.json();

    var roleRes = await fetch(
      SUPABASE_URL + '/rest/v1/user_roles?user_id=eq.' + caller.id + '&select=role,status',
      { headers: serviceHeaders }
    );
    var roleRows = await roleRes.json();
    var callerRole = roleRows && roleRows[0];
    if (!callerRole || callerRole.status !== 'active' ||
        (callerRole.role !== 'owner' && callerRole.role !== 'admin')) {
      res.status(403).json({ error: 'Only staff can do that.' });
      return;
    }

    // =====================================================================
    // Save a draft
    // =====================================================================
    if (op === 'save_document_draft') {
      var docType = body.doc_type;
      var meetingDate = body.meeting_date;
      var language = body.language || 'en';
      var title = String(body.title || '').replace(/\s+/g, ' ').trim();
      var summary = String(body.summary || '').replace(/\s+/g, ' ').trim();
      var documentNumber = String(body.document_number || '').trim().toUpperCase();
      var issuedOn = body.issued_on;
      var changeNote = String(body.change_note || '').trim();
      var itemNumbers = lib.splitList(body.item_numbers, true);
      var keywords = lib.splitList(body.keywords, false);
      var pdfPath = String(body.upload_pdf_path || '');
      var html = typeof body.html === 'string' ? body.html : '';

      if (!lib.isDocType(docType)) return res.status(400).json({ error: 'Choose Meeting Summary or Agenda Summary.' });
      if (!lib.isIsoDate(meetingDate)) return res.status(400).json({ error: 'Enter the meeting date.' });
      if (!lib.LANGUAGES[language]) return res.status(400).json({ error: 'Unknown language.' });
      if (title.length < 3 || title.length > 300) return res.status(400).json({ error: 'The title should be 3 to 300 characters.' });
      if (summary.length < 10 || summary.length > 1200) return res.status(400).json({ error: 'The summary should be two or three sentences (10 to 1,200 characters).' });
      if (!lib.isIsoDate(issuedOn)) return res.status(400).json({ error: 'Enter the issue date.' });
      if (changeNote.length > 1000) return res.status(400).json({ error: 'Keep the correction note under 1,000 characters.' });
      var numberProblem = lib.checkDocumentNumber(documentNumber, docType, meetingDate, language);
      if (numberProblem) return res.status(400).json({ error: numberProblem });
      if (body.version && !lib.parseVersion(body.version)) {
        return res.status(400).json({ error: 'Versions look like 1.0 or 1.1.' });
      }

      // The PDF must be one this caller just uploaded, not any object in the
      // bucket.
      var ownPrefix = 'uploads/' + caller.id + '/';
      if (pdfPath.indexOf(ownPrefix) !== 0 || !/^[A-Za-z0-9/_.-]+\.pdf$/.test(pdfPath) || pdfPath.indexOf('..') !== -1) {
        return res.status(400).json({ error: 'Upload the PDF first.' });
      }
      if (!html) return res.status(400).json({ error: 'Choose the HTML source file the PDF was built from.' });
      if (Buffer.byteLength(html, 'utf8') > lib.MAX_HTML_BYTES) {
        return res.status(400).json({ error: 'The HTML file is over 3 MB. Remove embedded images and try again.' });
      }

      // The template's own metadata must agree with the form, so a v1.0 file
      // cannot go up as v1.1 or one meeting's file under another's number.
      var meta = lib.readDocumentMeta(html);
      if (meta.documentNumber && meta.documentNumber.toUpperCase() !== documentNumber) {
        return res.status(400).json({
          error: 'The HTML file says it is ' + meta.documentNumber + ', but the form says ' + documentNumber + '. Check you chose the right file.'
        });
      }

      // ---------- the PDF ----------
      var pdf = await storageGet(UPLOAD_BUCKET, pdfPath);
      if (!pdf) return res.status(400).json({ error: 'The uploaded PDF could not be found. Upload it again.' });
      var pdfProblem = lib.checkPdf(pdf);
      if (pdfProblem) {
        await storageRemove(UPLOAD_BUCKET, [pdfPath]);
        return res.status(400).json({ error: pdfProblem });
      }
      var pageCount = lib.countPdfPages(pdf) || Number(body.page_count) || null;
      if (!pageCount || pageCount < 1 || pageCount > 5000) {
        return res.status(400).json({ error: 'The page count could not be read from this PDF. Enter it in the form.' });
      }

      // ---------- the HTML ----------
      var clean = lib.sanitizeDocumentHtml(html);
      if (clean.textLength < 200) {
        return res.status(400).json({ error: 'The HTML file has almost no text after cleaning. Choose the HTML the PDF was built from.' });
      }
      if (!clean.headingCount) {
        return res.status(400).json({ error: 'The HTML file has no section headings (h2 or h3), so the web page would have no table of contents.' });
      }

      // ---------- the document ----------
      var doc = null;
      if (body.document_id) {
        var byId = await rest('GET', 'documents?id=eq.' + encodeURIComponent(body.document_id) + '&select=*');
        doc = byId && byId[0];
        if (!doc) return res.status(404).json({ error: 'That document no longer exists.' });
        if (doc.doc_type !== docType || doc.meeting_date !== meetingDate || doc.language !== language) {
          return res.status(400).json({ error: 'A new version must keep the same type, meeting date and language.' });
        }
      } else {
        var existing = await rest('GET', 'documents?doc_type=eq.' + docType +
          '&meeting_date=eq.' + meetingDate + '&language=eq.' + language + '&select=*');
        doc = existing && existing[0];
      }

      var versions = doc
        ? await rest('GET', 'document_versions?document_id=eq.' + doc.id +
            '&select=id,version,status,upload_pdf_path,upload_html_path')
        : [];
      var published = versions.filter(function (v) { return v.status === 'published'; });
      var draft = versions.filter(function (v) { return v.status === 'draft'; })[0] || null;
      var publishedNumbers = published.map(function (v) { return v.version; });

      var version = body.version || (draft ? draft.version : lib.nextVersion(publishedNumbers));
      var notNewer = publishedNumbers.filter(function (v) { return lib.compareVersions(version, v) <= 0; });
      if (notNewer.length) {
        return res.status(400).json({
          error: 'Version ' + notNewer.join(', ') + ' is already published. This upload needs a higher number, such as ' +
            lib.nextVersion(publishedNumbers) + '.'
        });
      }
      if (meta.version && meta.version !== version) {
        return res.status(400).json({
          error: 'The HTML file says version ' + meta.version + ', but this upload is version ' + version + '. Update the version in the HTML and rebuild the PDF.'
        });
      }
      if (published.length && !changeNote) {
        return res.status(400).json({ error: 'Say what this version corrects. The note is shown in the public version history.' });
      }

      if (!doc) {
        var created = await rest('POST', 'documents', {
          doc_type: docType,
          meeting_date: meetingDate,
          language: language,
          status: 'draft',
          title: title,
          summary: summary,
          document_number: documentNumber,
          item_numbers: itemNumbers,
          keywords: keywords,
          page_count: pageCount,
          created_by: caller.id
        }, { Prefer: 'return=representation' });
        doc = created[0];
      }

      // Sanitized HTML is what gets stored, in the bucket as a file and in
      // the row for the build. The raw upload is never kept.
      var htmlPath = 'sanitized/' + doc.id + '/v' + version + '-' + Date.now() + '.html';
      await storagePut(UPLOAD_BUCKET, htmlPath, Buffer.from(clean.html, 'utf8'), 'text/html');

      var versionRow = {
        version: version,
        title: title,
        summary: summary,
        document_number: documentNumber,
        item_numbers: itemNumbers,
        keywords: keywords,
        issued_on: issuedOn,
        change_note: changeNote || null,
        // Only a correction can be marked for email; a first publication is
        // always mailed (api/notify-subscribers.js).
        notify_subscribers: published.length > 0 && body.notify_subscribers === true,
        page_count: pageCount,
        pdf_bytes: pdf.length,
        upload_pdf_path: pdfPath,
        upload_html_path: htmlPath,
        body_html: clean.html
      };

      var saved;
      if (draft) {
        saved = await rest('PATCH', 'document_versions?id=eq.' + draft.id + '&status=eq.draft',
          versionRow, { Prefer: 'return=representation' });
        if (!saved || !saved.length) throw new Error('The draft changed while saving. Reload and try again.');
        // The draft's previous files are superseded; nothing public used them.
        var stale = [];
        if (draft.upload_pdf_path && draft.upload_pdf_path !== pdfPath) stale.push(draft.upload_pdf_path);
        if (draft.upload_html_path) stale.push(draft.upload_html_path);
        await storageRemove(UPLOAD_BUCKET, stale);
      } else {
        versionRow.document_id = doc.id;
        versionRow.status = 'draft';
        versionRow.created_by = caller.id;
        saved = await rest('POST', 'document_versions', versionRow, { Prefer: 'return=representation' });
      }

      // A document nobody has seen yet takes the draft's metadata, so the
      // dashboard list reads right. A published one keeps what readers see
      // until the new version is published.
      if (doc.status === 'draft') {
        await rest('PATCH', 'documents?id=eq.' + doc.id, {
          title: title,
          summary: summary,
          document_number: documentNumber,
          item_numbers: itemNumbers,
          keywords: keywords,
          page_count: pageCount
        });
      }

      res.status(200).json({
        ok: true,
        document_id: doc.id,
        version_id: saved[0].id,
        version: version,
        page_count: pageCount,
        replaced_draft: !!draft
      });
      return;
    }

    // =====================================================================
    // Publish a draft
    // =====================================================================
    if (op === 'publish_document_version') {
      var versionId = body.version_id;
      if (!versionId) return res.status(400).json({ error: 'Which version?' });

      var rows = await rest('GET', 'document_versions?id=eq.' + encodeURIComponent(versionId) + '&select=*');
      var v = rows && rows[0];
      if (!v) return res.status(404).json({ error: 'That version no longer exists.' });
      if (v.status !== 'draft') return res.status(400).json({ error: 'Version ' + v.version + ' is already published.' });

      var docs = await rest('GET', 'documents?id=eq.' + v.document_id + '&select=*');
      var d = docs && docs[0];
      if (!d) return res.status(404).json({ error: 'That document no longer exists.' });

      var others = await rest('GET', 'document_versions?document_id=eq.' + d.id + '&status=eq.published&select=version');
      var clash = (others || []).filter(function (o) { return lib.compareVersions(v.version, o.version) <= 0; });
      if (clash.length) {
        return res.status(400).json({ error: 'Version ' + clash[0].version + ' is already published; this draft needs a higher number.' });
      }

      var file = await storageGet(UPLOAD_BUCKET, v.upload_pdf_path);
      if (!file) return res.status(400).json({ error: 'The draft PDF is missing. Upload the version again.' });
      var problem = lib.checkPdf(file);
      if (problem) return res.status(400).json({ error: problem });

      // Versioned name, never reused: what was public stays at its address.
      var publicPath = d.doc_type + '/' + d.meeting_date + '/' + d.language + '/' +
        v.document_number + '-v' + v.version + '.pdf';
      await storagePut(PUBLIC_BUCKET, publicPath, file, 'application/pdf');

      var now = new Date().toISOString();
      await rest('PATCH', 'document_versions?id=eq.' + v.id + '&status=eq.draft', {
        status: 'published',
        published_at: now,
        published_by: caller.id,
        public_pdf_path: publicPath
      });
      await rest('PATCH', 'documents?id=eq.' + d.id, {
        status: 'published',
        current_version_id: v.id,
        title: v.title,
        summary: v.summary,
        document_number: v.document_number,
        item_numbers: v.item_numbers,
        keywords: v.keywords,
        page_count: v.page_count,
        first_published_at: d.first_published_at || now
      });

      res.status(200).json({
        ok: true,
        version: v.version,
        pdf_url: lib.publicPdfPath(publicPath)
      });
      return;
    }

    // =====================================================================
    // Discard a draft
    // =====================================================================
    if (op === 'discard_document_draft') {
      var discardId = body.version_id;
      if (!discardId) return res.status(400).json({ error: 'Which version?' });
      var found = await rest('GET', 'document_versions?id=eq.' + encodeURIComponent(discardId) + '&select=*');
      var dv = found && found[0];
      if (!dv) return res.status(404).json({ error: 'That draft no longer exists.' });
      if (dv.status !== 'draft') return res.status(400).json({ error: 'Published versions cannot be discarded.' });

      await rest('DELETE', 'document_versions?id=eq.' + dv.id + '&status=eq.draft');
      await storageRemove(UPLOAD_BUCKET, [dv.upload_pdf_path, dv.upload_html_path]);

      // A document that never went public goes with its only draft.
      var parent = await rest('GET', 'documents?id=eq.' + dv.document_id + '&select=id,status');
      if (parent && parent[0] && parent[0].status === 'draft') {
        await rest('DELETE', 'documents?id=eq.' + dv.document_id + '&status=eq.draft');
      }

      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown operation' });
  } catch (err) {
    res.status(err.status && err.status < 500 ? 400 : 500).json({ error: err.message || 'Something went wrong.' });
  }
};
