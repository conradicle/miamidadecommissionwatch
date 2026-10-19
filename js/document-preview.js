// Staff preview of a document version: /documents/preview.html?version=<id>
//
// Renders a draft exactly as the public page will look, using the same
// js/document-view.js the build uses. Reads with the signed-in user's own
// session, so RLS decides: staff see drafts, everyone else sees nothing. The
// draft PDF is opened through a short-lived signed URL, since the uploads
// bucket is private.
(function () {
  var view = window.MDCWDocument;

  function status(message, kind) {
    var el = document.getElementById('doc-preview-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function publicPdfUrl(path) {
    if (!path) return null;
    return supabaseClient.storage.from('documents').getPublicUrl(path).data.publicUrl;
  }

  function cmpDesc(a, b) {
    return (b.version_major - a.version_major) || (b.version_minor - a.version_minor);
  }

  function load(versionId) {
    var version, doc, others;

    return supabaseClient
      .from('document_versions')
      .select('*, documents!document_versions_document_id_fkey(*)')
      .eq('id', versionId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) throw new Error('That version does not exist, or your account cannot see drafts.');
        version = res.data;
        doc = version.documents;
        return supabaseClient
          .from('document_versions')
          .select('id, version, version_major, version_minor, status, issued_on, change_note, public_pdf_path')
          .eq('document_id', doc.id);
      })
      .then(function (res) {
        if (res.error) throw res.error;
        others = (res.data || []).slice().sort(cmpDesc);
        var companionType = doc.doc_type === 'agenda-summary' ? 'meeting-summary' : 'agenda-summary';
        return supabaseClient
          .from('documents')
          .select('doc_type, meeting_date, title, status')
          .eq('doc_type', companionType)
          .eq('meeting_date', doc.meeting_date)
          .eq('language', doc.language)
          .maybeSingle();
      })
      .then(function (res) {
        var companion = res && !res.error ? res.data : null;
        var signed = version.status === 'draft' && version.upload_pdf_path
          ? supabaseClient.storage.from('document-uploads').createSignedUrl(version.upload_pdf_path, 3600)
          : Promise.resolve({ data: { signedUrl: publicPdfUrl(version.public_pdf_path) } });
        return signed.then(function (s) {
          return { companion: companion, pdfUrl: s && s.data ? s.data.signedUrl : null };
        });
      })
      .then(function (extra) {
        // History as it will read once this version is published: the
        // published versions plus this one.
        var history = others
          .filter(function (o) { return o.status === 'published' || o.id === version.id; })
          .map(function (o) {
            return {
              version: o.version,
              issued_on: o.issued_on,
              change_note: o.change_note,
              pdfUrl: o.id === version.id ? extra.pdfUrl : publicPdfUrl(o.public_pdf_path)
            };
          });
        var oldest = history.length ? history[history.length - 1].version : null;

        var html = view.renderDocumentMain({
          doc: {
            doc_type: doc.doc_type,
            meeting_date: doc.meeting_date,
            language: doc.language,
            // The version's own metadata: that is what publishing will show.
            title: version.title,
            summary: version.summary,
            document_number: version.document_number
          },
          version: version,
          firstVersion: oldest,
          history: history,
          pdfUrl: extra.pdfUrl,
          companion: extra.companion
            ? { href: view.docPath(extra.companion.doc_type, extra.companion.meeting_date), title: extra.companion.title }
            : null,
          translations: [],
          preview: version.status === 'draft'
        });

        document.getElementById('doc-preview-root').innerHTML = html;
        document.title = 'Preview: ' + version.title + ' - Miami-Dade Commission Watch';

        // The contents highlighter looks for the list on load, and the list
        // did not exist then.
        var s = document.createElement('script');
        s.src = '/js/document-page.js?v=20261019a';
        document.body.appendChild(s);
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!view || typeof supabaseClient === 'undefined') {
      status('The preview could not start. Reload the page.', 'error');
      return;
    }
    var versionId = new URLSearchParams(window.location.search).get('version');
    if (!versionId) {
      status('No version was given. Open a preview from the Documents tab of the staff dashboard.', 'error');
      return;
    }
    supabaseClient.auth.getSession().then(function (sessionRes) {
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        window.location.href = '/login.html';
        return;
      }
      load(versionId).catch(function (err) {
        status(err.message || 'The draft could not be loaded.', 'error');
      });
    });
  });
})();
