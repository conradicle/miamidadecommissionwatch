// Photos tab of the staff dashboard: pictures from Board meetings.
//
// meeting_photos and the meeting-photos bucket (migration_34) are written
// directly with the staff member's own session; RLS and the storage policies
// limit every write to active staff. Nothing here needs the service role.
//
// Every upload is redrawn on a canvas and re-encoded as JPEG before it leaves
// the browser. That does two jobs: it caps the size (a 12 MP phone photo
// becomes a ~2000px file of a few hundred KB, plus an 800px thumbnail for
// grids), and it drops the EXIF block, so no GPS location, capture time or
// camera serial is ever stored. Students' phones geotag by default; this is
// the step that keeps where a student was standing out of a public file.
(function () {
  var BUCKET = 'meeting-photos';
  var FULL_EDGE = 2000;
  var THUMB_EDGE = 800;
  var MAX_FILES = 20;

  var ctx = null;
  var rows = [];

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    var node = el('photo-status');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // Uploads start with this. Publishing is refused until someone replaces it
  // with a description of what is actually in the photo.
  function placeholderAlt(iso) {
    return 'Photo from the Board of County Commissioners meeting on ' + formatDate(iso).replace(/^\w+, /, '');
  }

  function thumbPath(path) { return path.replace(/\.jpg$/, '-thumb.jpg'); }

  function publicUrl(path) {
    return supabaseClient.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Same v4 shape as randomUUID, for the storage_path check in migration_34.
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ---------------------------------------------------------------------
  // Image processing
  // ---------------------------------------------------------------------

  // Decode with the camera's rotation applied. createImageBitmap honours EXIF
  // orientation when asked; the <img> fallback does so by default in every
  // current browser.
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return decodeWithImg(file);
      });
    }
    return decodeWithImg(file);
  }

  function decodeWithImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(file.name + ' could not be read. If it is a HEIC photo from an iPhone, upload it from Safari or export it as JPEG first.'));
      };
      img.src = url;
    });
  }

  function encode(source, maxEdge) {
    var w = source.width;
    var h = source.height;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var c2d = canvas.getContext('2d');
    c2d.imageSmoothingQuality = 'high';
    c2d.drawImage(source, 0, 0, cw, ch);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('The browser could not encode the photo.'));
        else resolve({ blob: blob, width: cw, height: ch });
      }, 'image/jpeg', 0.85);
    });
  }

  function processFile(file) {
    return decode(file).then(function (source) {
      return Promise.all([encode(source, FULL_EDGE), encode(source, THUMB_EDGE)]).then(function (out) {
        if (source.close) source.close();
        return { full: out[0], thumb: out[1] };
      });
    });
  }

  // ---------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------

  function uploadOne(file, date, credit, sortOrder) {
    var id = newId();
    var path = date + '/' + id + '.jpg';
    var store = supabaseClient.storage.from(BUCKET);
    return processFile(file).then(function (img) {
      return store.upload(path, img.full.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' })
        .then(function (res) {
          if (res.error) throw new Error('Upload failed for ' + file.name + ': ' + res.error.message);
          return store.upload(thumbPath(path), img.thumb.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
        })
        .then(function (res) {
          if (res.error) throw new Error('Thumbnail upload failed for ' + file.name + ': ' + res.error.message);
          return supabaseClient.from('meeting_photos').insert({
            meeting_date: date,
            storage_path: path,
            width: img.full.width,
            height: img.full.height,
            alt_text: placeholderAlt(date),
            credit: credit || null,
            sort_order: sortOrder,
            created_by: ctx.userId
          });
        })
        .then(function (res) {
          if (res.error) throw new Error('Could not save ' + file.name + ': ' + res.error.message);
        })
        .catch(function (err) {
          // Leave no orphan files behind a failed save.
          store.remove([path, thumbPath(path)]);
          throw err;
        });
    });
  }

  function onUpload(e) {
    e.preventDefault();
    var date = el('ph-date').value;
    var credit = el('ph-credit').value.trim();
    var files = Array.prototype.slice.call(el('ph-files').files || []);
    if (!date) { setStatus('Choose the meeting date.', 'error'); return; }
    if (!files.length) { setStatus('Choose at least one photo.', 'error'); return; }
    if (files.length > MAX_FILES) { setStatus('Upload at most ' + MAX_FILES + ' photos at a time.', 'error'); return; }

    var start = rows.filter(function (r) { return r.meeting_date === date; }).length;
    var btn = el('ph-upload-btn');
    btn.disabled = true;
    var done = 0;
    var failures = [];

    // One at a time: phones on school wifi, and each file is decoded into a
    // full-size canvas, so parallel uploads mostly buy memory pressure.
    files.reduce(function (chain, file, i) {
      return chain.then(function () {
        setStatus('Processing and uploading ' + (i + 1) + ' of ' + files.length + '...');
        return uploadOne(file, date, credit, start + i)
          .then(function () { done++; })
          .catch(function (err) { failures.push(err.message); });
      });
    }, Promise.resolve()).then(function () {
      btn.disabled = false;
      el('ph-files').value = '';
      if (failures.length) {
        setStatus(done + ' uploaded, ' + failures.length + ' failed. ' + failures.join(' '), 'error');
      } else {
        // Say plainly that nothing is public yet: an empty /photos right
        // after an upload reads as a failure otherwise.
        setStatus(done + (done === 1 ? ' photo' : ' photos') + ' uploaded as ' + (done === 1 ? 'a draft' : 'drafts') +
          '. Drafts are not on /photos. To show one there: write its alt text, tick the release box and Published, ' +
          'click Save, then Publish to site and reload /photos after about a minute.', 'success');
      }
      load();
    });
  }

  // ---------------------------------------------------------------------
  // List and edit
  // ---------------------------------------------------------------------

  function load() {
    return supabaseClient
      .from('meeting_photos')
      .select('*')
      .order('meeting_date', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          el('photo-list').innerHTML = '<p class="district-status error">Could not load photos: ' +
            escapeHtml(res.error.message) +
            (/meeting_photos/.test(res.error.message) ? ' Run supabase/migration_34_meeting_photos.sql in the Supabase SQL editor first.' : '') +
            '</p>';
          return;
        }
        rows = res.data || [];
        render();
      });
  }

  function card(r) {
    var id = escapeHtml(r.id);
    return '<div class="photo-admin-card" data-id="' + id + '">' +
      '<img src="' + escapeHtml(publicUrl(thumbPath(r.storage_path))) + '" alt="" loading="lazy">' +
      '<div class="photo-admin-body">' +
        '<div class="photo-admin-state' + (r.published ? ' is-live' : '') + '">' + (r.published ? 'Published' : 'Draft') +
          (r.is_featured ? ' · Featured' : '') + '</div>' +
        '<div class="field"><label for="alt-' + id + '">Alt text <span class="field-hint">what is in the photo, for screen readers</span></label>' +
          '<textarea id="alt-' + id + '" data-field="alt_text" maxlength="300">' + escapeHtml(r.alt_text) + '</textarea></div>' +
        '<div class="field"><label for="cap-' + id + '">Caption <span class="field-hint">optional; first name and last initial only</span></label>' +
          '<input type="text" id="cap-' + id + '" data-field="caption" maxlength="200" value="' + escapeHtml(r.caption || '') + '"></div>' +
        '<div class="field"><label for="cred-' + id + '">Credit</label>' +
          '<input type="text" id="cred-' + id + '" data-field="credit" maxlength="80" value="' + escapeHtml(r.credit || '') + '"></div>' +
        '<div class="photo-admin-checks">' +
          '<label><input type="checkbox" data-field="consent_confirmed"' + (r.consent_confirmed ? ' checked' : '') + '>' +
            '<span>A signed photo release is on file for every minor in this photo, and nobody shown asked to be left out</span></label>' +
          '<label><input type="checkbox" data-field="is_featured"' + (r.is_featured ? ' checked' : '') + '>' +
            '<span>Featured: the newest featured photo leads the homepage; the next one goes in "Attend with us" and on /attend</span></label>' +
          '<label><input type="checkbox" data-field="published"' + (r.published ? ' checked' : '') + '>' +
            '<span>Published</span></label>' +
        '</div>' +
        '<div class="submission-actions">' +
          '<button type="button" class="btn btn-primary btn-small" data-save="' + id + '">Save</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-delete="' + id + '">Delete</button>' +
        '</div>' +
        '<div class="district-status" data-card-status role="status" aria-live="polite"></div>' +
      '</div></div>';
  }

  function render() {
    if (!rows.length) {
      el('photo-list').innerHTML = '<p class="stat-empty">No photos yet. Upload some above.</p>';
      return;
    }
    var groups = [];
    rows.forEach(function (r) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== r.meeting_date) groups.push(g = { date: r.meeting_date, items: [] });
      g.items.push(r);
    });
    el('photo-list').innerHTML = groups.map(function (g) {
      var live = g.items.filter(function (r) { return r.published; }).length;
      return '<section class="photo-admin-group">' +
        '<h3>' + escapeHtml(formatDate(g.date)) + ' <span class="field-hint" style="display:inline;">' +
          g.items.length + ' photos, ' + live + ' published</span></h3>' +
        '<div class="photo-admin-grid">' + g.items.map(card).join('') + '</div></section>';
    }).join('');
  }

  function cardStatus(cardEl, message, kind) {
    var node = cardEl.querySelector('[data-card-status]');
    node.textContent = message || '';
    node.className = 'district-status' + (kind ? ' ' + kind : '');
  }

  function save(id) {
    var r = rows.filter(function (x) { return x.id === id; })[0];
    var cardEl = el('photo-list').querySelector('[data-id="' + id + '"]');
    if (!r || !cardEl) return;
    function val(f) { return cardEl.querySelector('[data-field="' + f + '"]'); }
    var fields = {
      alt_text: val('alt_text').value.trim(),
      caption: val('caption').value.trim() || null,
      credit: val('credit').value.trim() || null,
      consent_confirmed: val('consent_confirmed').checked,
      is_featured: val('is_featured').checked,
      published: val('published').checked
    };
    if (fields.alt_text.length < 10) {
      cardStatus(cardEl, 'Alt text needs at least 10 characters.', 'error');
      return;
    }
    if (fields.published && !fields.consent_confirmed) {
      cardStatus(cardEl, 'Tick the photo release box before publishing.', 'error');
      return;
    }
    if (fields.published && fields.alt_text === placeholderAlt(r.meeting_date)) {
      cardStatus(cardEl, 'Describe what is in the photo before publishing; the alt text is still the placeholder.', 'error');
      return;
    }
    cardStatus(cardEl, 'Saving...');
    supabaseClient.from('meeting_photos').update(fields).eq('id', id).then(function (res) {
      if (res.error) {
        cardStatus(cardEl, 'Could not save: ' + res.error.message, 'error');
        return;
      }
      Object.assign(r, fields);
      var state = cardEl.querySelector('.photo-admin-state');
      state.textContent = (r.published ? 'Published' : 'Draft') + (r.is_featured ? ' · Featured' : '');
      state.className = 'photo-admin-state' + (r.published ? ' is-live' : '');
      cardStatus(cardEl, 'Saved. Publish to site to update the public pages.', 'success');
    });
  }

  function remove(id) {
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r || !window.confirm('Delete this photo from ' + formatDate(r.meeting_date) +
      '? The files are removed from storage and this cannot be undone. If it is on the public site, it disappears at the next rebuild.')) return;
    supabaseClient.storage.from(BUCKET).remove([r.storage_path, thumbPath(r.storage_path)]).then(function (res) {
      if (res.error) {
        setStatus('Could not delete the files: ' + res.error.message, 'error');
        return;
      }
      return supabaseClient.from('meeting_photos').delete().eq('id', id).then(function (del) {
        setStatus(del.error ? 'Files removed, but the row could not be deleted: ' + del.error.message : 'Deleted.',
          del.error ? 'error' : 'success');
        load();
      });
    });
  }

  function initPublish() {
    var btn = el('photo-publish-site-btn');
    var status = el('photo-publish-site-status');
    btn.addEventListener('click', function () {
      if (typeof window.mdcwStartSiteBuild !== 'function') return;
      if (!window.confirm('Rebuild the public site now? Everything currently saved goes live, including drafts marked published on other tabs. The site updates about a minute after the build starts.')) return;
      btn.disabled = true;
      status.textContent = '';
      window.mdcwStartSiteBuild().then(function (result) {
        btn.disabled = false;
        status.textContent = result.ok ? 'Build started. Check /photos in about a minute.' : result.message;
        status.className = 'district-status ' + (result.ok ? 'success' : 'error');
      });
    });
  }

  window.initAdminPhotos = function (context) {
    ctx = context;
    if (!el('photo-upload-form') || !context.isStaff) return;
    el('photo-upload-form').addEventListener('submit', onUpload);
    el('photo-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.save) save(btn.dataset.save);
      else if (btn.dataset.delete) remove(btn.dataset.delete);
    });
    initPublish();
    load();
  };
})();
