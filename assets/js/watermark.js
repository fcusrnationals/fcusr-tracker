/* Watermark Studio — the council's watermark on a whole batch of photos.

       Upload photos → choose a watermark → adjust → preview → download

   Fetched only when the studio is opened (views/tools.js), because nothing
   else in the tracker needs any of this.

   Everything happens on this device. Photos are read, drawn onto a canvas with
   the watermark, and handed straight back as downloads; nothing is uploaded,
   nothing is synced, and nothing is kept after the tab closes. Documentation
   photos show students' faces, and there is no reason for them to travel.

   Kept on the device between visits: the watermark library (the logos, in
   IndexedDB — photos-sized data does not belong in the five megabytes of
   localStorage) and the presets (a few hundred bytes each, in localStorage).

   The screen shows the few controls almost everybody needs — photos,
   watermark, position, size, opacity, download — and folds the rest under
   "Advanced settings". */
(function (global) {
  'use strict';

  var LIB_KEY = 'fcusr.tracker.wm.library';
  var PRESET_KEY = 'fcusr.tracker.wm.presets';
  var DEFAULT_KEY = 'fcusr.tracker.wm.defaultPreset';
  var SEAL_ID = 'builtin-seal';
  var SEAL_SRC = 'assets/img/fcusr-seal.png';
  var STANDARD_ID = 'builtin-standard';

  var POSITIONS = [
    ['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'],
    ['cl', 'Center left'], ['cc', 'Center'], ['cr', 'Center right'],
    ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right']
  ];
  var UNITS = [['%', '% of the photo'], ['px', 'pixels (px)'], ['mm', 'millimetres (mm)'],
               ['cm', 'centimetres (cm)'], ['in', 'inches (in)']];
  var TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  function defaults() {
    return {
      position: 'br', x: 0.88, y: 0.9,
      width: 12, height: 0, unit: '%', keepAspect: true, scale: 100,
      margin: 30, marginUnit: 'px',
      opacity: 85, rotation: 0, dpi: 300,
      format: 'original', quality: 92, maxSide: 0,
      prefix: '', suffix: '_FCUSR'
    };
  }

  // The preset the council ships with, which nobody has to make.
  var STANDARD = {
    id: STANDARD_ID, name: 'FCUSR Documentation Standard', wmId: SEAL_ID, builtin: true,
    settings: { position: 'br', width: 12, unit: '%', margin: 30, marginUnit: 'px', opacity: 85 }
  };

  /* ---------- state, kept while the app is open ---------- */

  var S = {
    host: null,
    photos: [],          // { id, name, file, url, type, w, h, status, error, selected, override }
    active: '',          // the photo in the preview
    settings: defaults(),
    wmId: SEAL_ID,
    presetId: '',
    scope: 'all',        // 'all', or 'one' to adjust only the photo in the preview
    advOpen: false,
    busy: false, cancel: false, progress: null,
    started: false
  };

  var images = {};       // decoded pictures, by photo id or watermark id

  function uid() { return U.uid('wm'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; }

  /* ---------- saved on this device ---------- */

  function readJSON(key, fallback) {
    try { var v = JSON.parse(global.localStorage.getItem(key) || 'null'); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, v) {
    try { global.localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  // The logos. The list lives in localStorage; each picture in IndexedDB.
  var memoryOnly = {};   // when the browser refuses IndexedDB, for this visit only
  function library() { return readJSON(LIB_KEY, []).filter(function (x) { return x && x.id && x.name; }); }
  function saveLibrary(list) { writeJSON(LIB_KEY, list); }

  function libraryAll() {
    return [{ id: SEAL_ID, name: 'FCUSR Nationals Seal', builtin: true }].concat(library());
  }

  function wmSrc(id) {
    if (id === SEAL_ID) return Promise.resolve(SEAL_SRC);
    if (memoryOnly[id]) return Promise.resolve(memoryOnly[id]);
    if (!global.AssetDB) return Promise.reject(new Error('Saved watermarks are not available in this browser.'));
    return AssetDB.get('wm:' + id).then(function (v) {
      if (!v) throw new Error('That watermark is missing from this device. Upload it again.');
      return v;
    });
  }

  function storeWm(id, dataUrl) {
    if (!global.AssetDB) { memoryOnly[id] = dataUrl; return Promise.resolve(false); }
    return AssetDB.put('wm:' + id, dataUrl).then(function () { return true; })
      .catch(function () { memoryOnly[id] = dataUrl; return false; });
  }

  function presets() {
    return [STANDARD].concat(readJSON(PRESET_KEY, []).filter(function (p) { return p && p.id && p.name; }));
  }
  function savePresets(list) { writeJSON(PRESET_KEY, list.filter(function (p) { return !p.builtin; })); }
  function defaultPresetId() {
    var d = readJSON(DEFAULT_KEY, STANDARD_ID);
    return presets().some(function (p) { return p.id === d; }) ? d : STANDARD_ID;
  }
  function preset(id) { return presets().filter(function (p) { return p.id === id; })[0] || null; }

  /* ---------- pictures ---------- */

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('That picture could not be opened.')); };
      img.src = src;
    });
  }

  function photoImage(p) {
    if (images[p.id]) return Promise.resolve(images[p.id]);
    return loadImage(p.url).then(function (img) { images[p.id] = img; return img; });
  }

  function wmImage(id) {
    if (images['w:' + id]) return Promise.resolve(images['w:' + id]);
    return wmSrc(id).then(loadImage).then(function (img) {
      // An SVG with no size of its own reports zero; give it one to draw at.
      if (!img.naturalWidth) { img.width = 1000; img.height = 1000; }
      images['w:' + id] = img;
      return img;
    });
  }

  function iw(img) { return img.naturalWidth || img.width || 1; }
  function ih(img) { return img.naturalHeight || img.height || 1; }

  /* ---------- sizes and units ----------

     A photo has pixels and no physical size, so millimetres, centimetres and
     inches are read at a print resolution — 300 dots per inch unless changed.
     A percentage is of the photo: width of its width, height of its height,
     and the margin of its shorter side, so it is the same on every edge. */
  function toPx(v, unit, basis, dpi) {
    v = num(v, 0);
    if (unit === '%') return basis * v / 100;
    if (unit === 'mm') return v / 25.4 * dpi;
    if (unit === 'cm') return v / 2.54 * dpi;
    if (unit === 'in') return v * dpi;
    return v;
  }
  function fromPx(px, unit, basis, dpi) {
    if (unit === '%') return basis ? px / basis * 100 : 0;
    if (unit === 'mm') return px / dpi * 25.4;
    if (unit === 'cm') return px / dpi * 2.54;
    if (unit === 'in') return px / dpi;
    return px;
  }
  function round(v, unit) {
    var d = unit === 'px' ? 0 : unit === 'in' ? 2 : 1;
    var m = Math.pow(10, d);
    return Math.round(v * m) / m;
  }

  // Where the watermark lands on a photo, in that photo's own pixels.
  function layout(st, W, H, wm) {
    var dpi = clamp(num(st.dpi, 300), 30, 1200);
    var k = clamp(num(st.scale, 100), 5, 500) / 100;
    var w = Math.max(1, toPx(st.width, st.unit, W, dpi) * k);
    var ratio = ih(wm) / iw(wm);
    var h = (!st.keepAspect && num(st.height, 0) > 0)
      ? Math.max(1, toPx(st.height, st.unit, H, dpi) * k) : w * ratio;
    var m = toPx(st.margin, st.marginUnit, Math.min(W, H), dpi);
    var cx, cy;
    if (st.position === 'custom') {
      cx = clamp(num(st.x, 0.5), 0, 1) * W;
      cy = clamp(num(st.y, 0.5), 0, 1) * H;
    } else {
      var col = st.position.charAt(1), row = st.position.charAt(0);
      cx = col === 'l' ? m + w / 2 : col === 'r' ? W - m - w / 2 : W / 2;
      cy = row === 't' ? m + h / 2 : row === 'b' ? H - m - h / 2 : H / 2;
    }
    return { cx: cx, cy: cy, w: w, h: h, rot: num(st.rotation, 0) * Math.PI / 180 };
  }

  // The final size of a photo: its own, unless a longest side was set.
  function outSize(p, st) {
    var max = num(st.maxSide, 0);
    if (!max || Math.max(p.w, p.h) <= max) return { w: p.w, h: p.h };
    var k = max / Math.max(p.w, p.h);
    return { w: Math.round(p.w * k), h: Math.round(p.h * k) };
  }

  function paint(ctx, img, wm, st, W, H) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    if (!wm) return;
    var L = layout(st, W, H, wm);
    ctx.save();
    ctx.globalAlpha = clamp(num(st.opacity, 85), 0, 100) / 100;
    ctx.translate(L.cx, L.cy);
    if (L.rot) ctx.rotate(L.rot);
    ctx.drawImage(wm, -L.w / 2, -L.h / 2, L.w, L.h);
    ctx.restore();
  }

  function settingsFor(p) { return p && p.override ? p.override : S.settings; }

  /* ---------- output ---------- */

  var webpOk = null;
  function canWebp() {
    if (webpOk !== null) return webpOk;
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      webpOk = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { webpOk = false; }
    return webpOk;
  }

  function outType(p, st) {
    var want = st.format === 'jpeg' ? 'image/jpeg' : st.format === 'png' ? 'image/png'
      : st.format === 'webp' ? 'image/webp' : (TYPES[p.type] ? p.type : 'image/jpeg');
    if (want === 'image/webp' && !canWebp()) want = 'image/jpeg';
    return want;
  }

  function baseName(name) { return String(name || 'photo').replace(/\.[^.]+$/, ''); }
  function safe(s) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').slice(0, 60); }

  function outName(p, st) {
    return safe(st.prefix) + baseName(p.name) + safe(st.suffix) + '.' + TYPES[outType(p, st)];
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      try { canvas.toBlob(function (b) { resolve(b); }, type, quality); }
      catch (e) { resolve(null); }
    });
  }

  // One photo, full size, watermarked.
  function render(p) {
    var st = settingsFor(p);
    return Promise.all([photoImage(p), wmImage(S.wmId).catch(function () { return null; })])
      .then(function (res) {
        var size = outSize(p, st);
        var c = document.createElement('canvas');
        c.width = size.w;
        c.height = size.h;
        var ctx = c.getContext('2d');
        if (!ctx) throw new Error('This browser cannot draw pictures.');
        var type = outType(p, st);
        // A JPEG has no transparency; a transparent PNG would otherwise go black behind.
        if (type === 'image/jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, size.w, size.h); }
        paint(ctx, res[0], res[1], st, size.w, size.h);
        return toBlob(c, type, clamp(num(st.quality, 92), 40, 100) / 100).then(function (blob) {
          c.width = c.height = 0;                       // let the memory go now
          if (!blob) {
            throw new Error('Too large for this browser to process (' +
              Math.round(size.w * size.h / 1e6) + ' megapixels). Set a smaller size under ' +
              'Advanced settings, or use a computer.');
          }
          return { blob: blob, name: outName(p, st) };
        });
      });
  }

  /* ---------- a ZIP, built on the device ----------

     Stored, not compressed: a photo is already compressed, and squeezing it
     again costs a phone's battery for a percent or two. The photos themselves
     are handed to the Blob by reference rather than copied into memory, so
     fifty of them do not need fifty photos' worth of room at once. */
  var CRC = null;
  function crc32(bytes) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function readBytes(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error('A photo could not be read back.')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function utf8(s) {
    if (global.TextEncoder) return new TextEncoder().encode(s);
    var out = unescape(encodeURIComponent(s));
    var b = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) b[i] = out.charCodeAt(i);
    return b;
  }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  // entries: [{ name, blob, crc, size }]
  function buildZip(entries) {
    var parts = [], central = [], offset = 0;
    var t = dosTime(new Date());
    entries.forEach(function (e) {
      var name = utf8(e.name);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, t.time, true); h.setUint16(12, t.date, true);
      h.setUint32(14, e.crc, true); h.setUint32(18, e.size, true); h.setUint32(22, e.size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, e.blob);

      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, t.time, true);
      c.setUint16(14, t.date, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.size, true);
      c.setUint32(24, e.size, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + e.size;
    });
    var cdSize = central.reduce(function (n, x) { return n + x.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  // Two photos called IMG_1.jpg in one folder would overwrite each other when unzipped.
  function uniqueNames(list) {
    var used = {};
    list.forEach(function (x) {
      var n = x.name, i = 2;
      while (used[n.toLowerCase()]) {
        n = x.name.replace(/(\.[^.]+)$/, ' (' + i + ')$1');
        i++;
      }
      used[n.toLowerCase()] = 1;
      x.name = n;
    });
    return list;
  }

  /* ---------- adding photos ---------- */

  var ACCEPTED = /^image\/(jpeg|png|webp)$/;

  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var refused = [];
    list.forEach(function (f) {
      var type = f.type || (/\.jpe?g$/i.test(f.name) ? 'image/jpeg' : /\.png$/i.test(f.name) ? 'image/png'
        : /\.webp$/i.test(f.name) ? 'image/webp' : '');
      if (!ACCEPTED.test(type)) {
        refused.push(f.name + (/heic|heif/i.test(f.type + f.name)
          ? ' (iPhone HEIC photos cannot be opened here — share them as JPG, or set the camera to ' +
            '“Most Compatible”)'
          : ' (not a JPG, PNG or WEBP picture)'));
        return;
      }
      S.photos.push({
        id: uid(), name: f.name || 'photo.jpg', file: f, type: type,
        url: URL.createObjectURL(f), w: 0, h: 0, status: 'loading', error: '',
        selected: true, override: null
      });
    });
    if (refused.length) {
      UI.toast(U.plural(refused.length, 'file was', 'files were') + ' left out: ' + refused[0] +
        (refused.length > 1 ? ', and ' + (refused.length - 1) + ' more' : '') + '.', 'error');
    }
    if (!S.active && S.photos.length) S.active = S.photos[0].id;
    measure();
    draw();
  }

  // Read each photo's size in the background; a broken one is marked, not fatal.
  function measure() {
    var todo = S.photos.filter(function (p) { return p.status === 'loading'; });
    var chain = Promise.resolve();
    todo.forEach(function (p) {
      chain = chain.then(function () {
        return photoImage(p).then(function (img) {
          p.w = iw(img); p.h = ih(img); p.status = 'ready';
          // Keep only the one in the preview decoded; the rest are read again when needed.
          if (p.id !== S.active) delete images[p.id];
        }).catch(function () {
          p.status = 'error';
          p.error = 'This photo could not be opened. It may be damaged or in a format this browser cannot read.';
        }).then(function () { refreshThumb(p); refreshStatus(); if (p.id === S.active) preview(); });
      });
    });
  }

  function removePhoto(id) {
    var p = S.photos.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    URL.revokeObjectURL(p.url);
    delete images[p.id];
    S.photos = S.photos.filter(function (x) { return x.id !== id; });
    if (S.active === id) S.active = S.photos.length ? S.photos[0].id : '';
    draw();
  }

  function clearPhotos() {
    S.photos.forEach(function (p) { URL.revokeObjectURL(p.url); delete images[p.id]; });
    S.photos = [];
    S.active = '';
    S.scope = 'all';
    draw();
  }

  function activePhoto() { return S.photos.filter(function (p) { return p.id === S.active; })[0] || null; }

  /* ---------- the screen ---------- */

  function esc(s) { return U.esc(s); }

  function stepState() {
    var photos = S.photos.length > 0;
    return [
      ['Photos', photos], ['Watermark', !!S.wmId], ['Adjust', photos], ['Download', false]
    ];
  }

  function head() {
    return '<div class="page-head"><div><h1>Watermark Studio</h1>' +
      '<div class="sub">Add your official watermark to many documentation photos at once.</div></div></div>' +
      Workspace.hint('watermark', 'Everything happens on this device: your photos are never uploaded. ' +
        'Pick photos, choose a watermark or preset, check the preview, and download.') +
      '<ol class="wm-steps" aria-label="Steps">' + stepState().map(function (s, i) {
        return '<li class="' + (s[1] ? 'is-done' : '') + '"><span>' + (s[1] ? UI.icon('check') : (i + 1)) +
          '</span>' + esc(s[0]) + '</li>';
      }).join('') + '</ol>';
  }

  function dropzone(big) {
    return '<label class="wm-drop' + (big ? ' is-big' : '') + '" data-drop>' +
      '<input type="file" id="wm-files" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple>' +
      (big
        ? '<span class="wd-icon">' + UI.icon('image') + '</span><strong>Add photos</strong>' +
          '<span class="small muted">JPG, PNG or WEBP — as many as you like. Or drop them here.</span>' +
          '<span class="btn btn-primary wd-btn">' + UI.icon('upload') + 'Choose photos</span>'
        : '<span class="btn btn-sm">' + UI.icon('plus') + 'Add more photos</span>') +
      '</label>';
  }

  function stage() {
    if (!S.photos.length) return '<section class="wm-stage">' + dropzone(true) + '</section>';
    var p = activePhoto();
    var idx = S.photos.indexOf(p);
    return '<section class="wm-stage" aria-label="Preview">' +
      '<div class="wm-preview"><canvas id="wm-canvas" role="img" aria-label="Preview of the watermarked photo"></canvas>' +
      '<div class="wm-preview-msg" id="wm-msg" hidden></div></div>' +
      '<div class="wm-caption">' +
        '<button type="button" class="icon-btn" data-nav="-1" aria-label="Previous photo"' +
          (idx <= 0 ? ' disabled' : '') + '>' + UI.icon('back') + '</button>' +
        '<span class="wc-name"><strong>' + esc(p ? p.name : '') + '</strong>' +
          '<span class="small muted" id="wm-dims">' + (p && p.w ? p.w + ' × ' + p.h + ' px' : '') + '</span>' +
          (p && p.override ? ' <span class="chip st-for-review">Adjusted separately</span>' : '') + '</span>' +
        '<span class="small muted">' + (idx + 1) + ' of ' + S.photos.length + '</span>' +
        '<button type="button" class="icon-btn" data-nav="1" aria-label="Next photo"' +
          (idx >= S.photos.length - 1 ? ' disabled' : '') + ' style="transform:scaleX(-1)">' +
          UI.icon('back') + '</button>' +
      '</div>' +
      '<p class="tiny muted wm-drag-note">' + UI.icon('move') + 'Drag the watermark on the preview to place it exactly.</p>' +
      '<div class="wm-thumbs-head"><span class="small strong">' + U.plural(S.photos.length, 'photo') +
        ' · <span id="wm-selcount">' + selected().length + '</span> selected</span>' +
        '<span class="row" style="gap:6px">' +
        '<button type="button" class="btn btn-sm btn-ghost" data-select="all">Select all</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-select="none">Select none</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-clear>Remove all</button>' +
        dropzone(false) + '</span></div>' +
      '<ul class="wm-thumbs">' + S.photos.map(thumb).join('') + '</ul>' +
      '</section>';
  }

  function thumb(p) {
    return '<li class="wm-thumb' + (p.id === S.active ? ' is-active' : '') + (p.status === 'error' ? ' is-bad' : '') +
      '" data-thumb="' + p.id + '">' +
      '<button type="button" class="wt-open" data-open="' + p.id + '" aria-label="Preview ' + esc(p.name) + '">' +
        '<img src="' + esc(p.url) + '" alt="" loading="lazy" decoding="async"></button>' +
      '<label class="wt-check"><input type="checkbox" data-sel="' + p.id + '"' + (p.selected ? ' checked' : '') +
        (p.status === 'error' ? ' disabled' : '') + '><span class="sr-only">Include ' + esc(p.name) + '</span></label>' +
      '<button type="button" class="wt-remove" data-remove="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">' +
        UI.icon('close') + '</button>' +
      (p.override ? '<span class="wt-flag">Adjusted</span>' : '') +
      (p.status === 'error' ? '<span class="wt-err">' + UI.icon('alert') + 'Can’t open</span>' : '') +
      '</li>';
  }

  function refreshThumb(p) {
    if (!S.host) return;
    var li = S.host.querySelector('[data-thumb="' + p.id + '"]');
    if (li) li.outerHTML = thumb(p);
    wireThumbs();
  }

  function selected() {
    return S.photos.filter(function (p) { return p.selected && p.status !== 'error'; });
  }

  function watermarkCard() {
    var libs = libraryAll();
    var ps = presets();
    var def = defaultPresetId();
    var cur = preset(S.presetId);
    return '<div class="wm-card">' +
      '<h3>Watermark</h3>' +
      '<div class="wm-lib" role="radiogroup" aria-label="Choose a watermark">' +
      libs.map(function (w) {
        return '<label class="wm-lib-item' + (S.wmId === w.id ? ' is-on' : '') + '">' +
          '<input type="radio" name="wm-pick" value="' + esc(w.id) + '"' + (S.wmId === w.id ? ' checked' : '') + '>' +
          '<span class="wli-img" data-wm-thumb="' + esc(w.id) + '"></span>' +
          '<span class="wli-name">' + esc(w.name) + '</span></label>';
      }).join('') + '</div>' +
      '<div class="row" style="gap:6px;margin-top:8px">' +
        '<label class="btn btn-sm wm-upload-wm">' + UI.icon('upload') + 'Upload watermark' +
          '<input type="file" id="wm-newlogo" accept="image/png,image/svg+xml,image/webp,image/jpeg,.png,.svg,.webp,.jpg,.jpeg"></label>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-manage-lib>Manage library</button>' +
      '</div>' +
      '<div class="field" style="margin:14px 0 0"><label for="wm-preset">Preset</label>' +
      '<div class="row" style="gap:6px;flex-wrap:nowrap">' +
        '<select id="wm-preset" style="flex:1;min-width:0"><option value="">No preset — my own settings</option>' +
        ps.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (S.presetId === p.id ? ' selected' : '') + '>' +
            esc(p.name) + (p.id === def ? ' (default)' : '') + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="icon-btn" data-preset-menu aria-label="Preset options" aria-haspopup="menu">' +
          UI.icon('more') + '</button>' +
      '</div>' +
      '<div class="hint">' + (cur ? 'Using “' + esc(cur.name) + '”. Change anything and it becomes your own settings.'
        : 'Save what you set up as a preset and next time it is one tap.') + '</div></div>' +
      '</div>';
  }

  function posGrid(st) {
    return '<div class="wm-pos" role="radiogroup" aria-label="Position">' + POSITIONS.map(function (p) {
      var on = st.position === p[0];
      return '<label class="wm-pos-cell' + (on ? ' is-on' : '') + '" title="' + p[1] + '">' +
        '<input type="radio" name="wm-pos" value="' + p[0] + '"' + (on ? ' checked' : '') + '>' +
        '<span class="sr-only">' + p[1] + '</span><span class="dot"></span></label>';
    }).join('') + '</div>' +
    '<div class="tiny muted" style="margin-top:4px">' +
      (st.position === 'custom' ? 'Placed by hand. Pick a square to snap it back.'
        : POSITIONS.filter(function (p) { return p[0] === st.position; })[0][1]) + '</div>';
  }

  function slider(id, label, value, min, max, step, suffix) {
    return '<div class="field wm-slider"><label for="' + id + '">' + label +
      ' <output id="' + id + '-out">' + value + (suffix || '') + '</output></label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + (step || 1) +
      '" value="' + value + '"></div>';
  }

  function adjustCard() {
    var p = activePhoto();
    var st = S.scope === 'one' && p && p.override ? p.override : S.settings;
    var sizeIsPct = st.unit === '%';
    var dims = p && p.w ? p : null;
    return '<div class="wm-card">' +
      '<h3>Adjust</h3>' +
      (S.photos.length > 1 && p
        ? '<div class="segmented wm-scope" role="group" aria-label="Apply to">' +
          '<button type="button" data-scope="all" class="' + (S.scope === 'all' ? 'is-active' : '') + '" aria-pressed="' + (S.scope === 'all') + '">All photos</button>' +
          '<button type="button" data-scope="one" class="' + (S.scope === 'one' ? 'is-active' : '') + '" aria-pressed="' + (S.scope === 'one') + '">This photo only</button>' +
          '</div>' +
          (S.scope === 'one'
            ? '<p class="tiny muted" style="margin:6px 0 0">Changes here apply to <strong>' + esc(p.name) +
              '</strong> alone.' + (p.override ? ' <button type="button" class="linkish" data-reset-one>Use the shared settings again</button>' : '') + '</p>'
            : '')
        : '') +
      '<div class="field" style="margin-top:12px"><div class="field-label">Position</div>' + posGrid(st) + '</div>' +
      (sizeIsPct
        ? slider('wm-size', 'Size', round(st.width, '%'), 1, 60, 0.5, '% of width')
        : '<div class="field"><label for="wm-size-n">Size</label><div class="tiny muted">Width ' +
          round(st.width, st.unit) + ' ' + st.unit + ' — change it under Advanced settings.</div></div>') +
      slider('wm-opacity', 'Opacity', st.opacity, 5, 100, 1, '%') +
      '<details class="wm-adv" id="wm-adv"' + (S.advOpen ? ' open' : '') + '><summary>Advanced settings</summary>' +
        '<div class="wm-adv-body">' +
        '<div class="field-row">' +
          field('wm-x', 'Exact X (%)', round(st.position === 'custom' ? st.x * 100 : currentX(st, dims) * 100, '%'), 'number', 'min="0" max="100" step="0.1"') +
          field('wm-y', 'Exact Y (%)', round(st.position === 'custom' ? st.y * 100 : currentY(st, dims) * 100, '%'), 'number', 'min="0" max="100" step="0.1"') +
        '</div>' +
        '<div class="hint" style="margin:-8px 0 12px">The centre of the watermark, from the photo’s top-left corner.</div>' +
        '<div class="field"><label for="wm-unit">Size units</label><select id="wm-unit">' +
          UNITS.map(function (u) { return '<option value="' + u[0] + '"' + (st.unit === u[0] ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field-row">' +
          field('wm-w', 'Width (' + st.unit + ')', round(st.width, st.unit), 'number', 'min="0" step="any"') +
          field('wm-h', 'Height (' + st.unit + ')', st.keepAspect || !st.height ? '' : round(st.height, st.unit), 'number',
            'min="0" step="any"' + (st.keepAspect ? ' disabled placeholder="Automatic"' : ' placeholder="Automatic"')) +
        '</div>' +
        '<label class="checkbox" style="margin:-4px 0 12px"><input type="checkbox" id="wm-aspect"' + (st.keepAspect ? ' checked' : '') + '> Keep the watermark’s proportions</label>' +
        slider('wm-scale', 'Scale', st.scale, 10, 300, 1, '%') +
        '<div class="field-row">' +
          field('wm-margin', 'Distance from the edge', round(st.margin, st.marginUnit), 'number', 'min="0" step="any"') +
          '<div class="field"><label for="wm-munit">Units</label><select id="wm-munit">' +
            UNITS.map(function (u) { return '<option value="' + u[0] + '"' + (st.marginUnit === u[0] ? ' selected' : '') + '>' + u[0] + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        slider('wm-rot', 'Rotation', st.rotation, -180, 180, 1, '°') +
        field('wm-dpi', 'Print resolution for mm, cm and in (dots per inch)', st.dpi, 'number', 'min="30" max="1200" step="1"') +
        '<div class="field-row">' +
          '<div class="field"><label for="wm-format">Save as</label><select id="wm-format">' +
            [['original', 'Same as the original'], ['jpeg', 'JPEG'], ['png', 'PNG']]
              .concat(canWebp() ? [['webp', 'WEBP']] : [])
              .map(function (f) { return '<option value="' + f[0] + '"' + (st.format === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') +
          '</select></div>' +
          field('wm-max', 'Longest side (px)', st.maxSide || '', 'number', 'min="0" step="1" placeholder="Original size"') +
        '</div>' +
        slider('wm-quality', 'JPEG and WEBP quality', st.quality, 40, 100, 1, '%') +
        '<div class="field-row">' +
          field('wm-prefix', 'Add before the file name', st.prefix, 'text', 'maxlength="30" placeholder="e.g. FCUSR_"') +
          field('wm-suffix', 'Add after the file name', st.suffix, 'text', 'maxlength="30" placeholder="e.g. _FCUSR"') +
        '</div>' +
        '<p class="tiny muted" id="wm-example" style="margin:-6px 0 0">' + esc(example(st)) + '</p>' +
        '</div></details>' +
      '</div>';
  }

  function currentX(st, p) {
    if (!p) return st.x;
    var wm = images['w:' + S.wmId];
    if (!wm) return st.x;
    return layout(st, p.w, p.h, wm).cx / p.w;
  }
  function currentY(st, p) {
    if (!p) return st.y;
    var wm = images['w:' + S.wmId];
    if (!wm) return st.y;
    return layout(st, p.w, p.h, wm).cy / p.h;
  }

  function example(st) {
    var p = activePhoto();
    var name = p ? p.name : 'IMG_2381.jpg';
    var fake = { name: name, type: p ? p.type : 'image/jpeg' };
    return 'Example: ' + name + ' → ' + outName(fake, st);
  }

  function field(id, label, value, type, attrs) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input type="' + type + '" id="' + id + '" value="' + esc(value) + '" ' + (attrs || '') + '></div>';
  }

  function downloadCard() {
    var p = activePhoto();
    var sel = selected();
    var ready = S.photos.filter(function (x) { return x.status === 'ready'; });
    var bad = S.photos.filter(function (x) { return x.status === 'error'; });
    return '<div class="wm-card wm-dl">' +
      '<h3>Download</h3>' +
      (S.progress
        ? '<div class="wm-progress"><div class="progress"><span style="width:' + S.progress.pct + '%"></span></div>' +
          '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="small">' + esc(S.progress.text) +
          '</span><button type="button" class="btn btn-sm" data-cancel>Stop</button></div></div>'
        : '<div class="wm-dl-btns">' +
          '<button type="button" class="btn btn-primary" data-dl="all"' + (ready.length ? '' : ' disabled') + '>' +
            UI.icon('download') + 'Download all (' + ready.length + ')</button>' +
          '<button type="button" class="btn" data-dl="selected"' + (sel.length && sel.length < ready.length ? '' : ' disabled') + '>' +
            'Download selected (' + sel.length + ')</button>' +
          '<button type="button" class="btn btn-ghost" data-dl="one"' + (p && p.status === 'ready' ? '' : ' disabled') + '>' +
            'Download this photo</button>' +
          '</div>' +
          '<p class="tiny muted" style="margin:8px 0 0">Several photos come as one ZIP file. Each keeps its ' +
          'original size unless you set one under Advanced settings.</p>') +
      '<div id="wm-status">' + statusHtml(bad) + '</div>' +
      '</div>';
  }

  function statusHtml(bad) {
    bad = bad || S.photos.filter(function (x) { return x.status === 'error'; });
    if (!bad.length) return '';
    var ok = S.photos.length - bad.length;
    return '<div class="wm-bad">' + UI.icon('alert') + '<span>' +
      (bad.length === 1 ? 'One photo could not be opened' : bad.length + ' photos could not be opened') +
      (ok ? '. The remaining ' + U.plural(ok, 'photo is', 'photos are') + ' ready.' : '.') +
      ' <button type="button" class="linkish" data-drop-bad>Remove ' + (bad.length === 1 ? 'it' : 'them') +
      '</button></span></div>';
  }

  function refreshStatus() {
    if (!S.host) return;
    var el = S.host.querySelector('#wm-status');
    if (el) {
      el.innerHTML = statusHtml();
      var b = el.querySelector('[data-drop-bad]');
      if (b) b.addEventListener('click', function () {
        S.photos.filter(function (x) { return x.status === 'error'; }).forEach(function (x) { removePhoto(x.id); });
      });
    }
    var d = S.host.querySelector('#wm-dims');
    var p = activePhoto();
    if (d && p && p.w) d.textContent = p.w + ' × ' + p.h + ' px';
    var dl = S.host.querySelector('.wm-dl');
    if (dl && !S.progress) {
      var ready = S.photos.filter(function (x) { return x.status === 'ready'; }).length;
      var all = dl.querySelector('[data-dl="all"]');
      if (all) { all.disabled = !ready; all.lastChild.textContent = 'Download all (' + ready + ')'; }
      var one = dl.querySelector('[data-dl="one"]');
      if (one) one.disabled = !(p && p.status === 'ready');
    }
  }

  function draw() {
    if (!S.host || !document.body.contains(S.host)) return;
    S.host.innerHTML = '<div class="wm">' + head() +
      '<div class="wm-layout">' + stage() +
      '<aside class="wm-panel">' + watermarkCard() + adjustCard() + downloadCard() + '</aside>' +
      '</div></div>';
    wire();
    Workspace.wireHints(S.host);
    preview();
    fillLibThumbs();
  }

  function fillLibThumbs() {
    U.els('[data-wm-thumb]', S.host).forEach(function (el) {
      var id = el.getAttribute('data-wm-thumb');
      wmSrc(id).then(function (src) {
        el.innerHTML = '<img src="' + esc(src) + '" alt="">';
      }).catch(function () { el.innerHTML = UI.icon('alert'); });
    });
  }

  /* ---------- the preview ---------- */

  var frame = 0;
  function preview() {
    if (frame) return;
    frame = (global.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      frame = 0;
      drawPreview();
    });
  }

  var lastBox = null;
  function drawPreview() {
    if (!S.host) return;
    var canvas = S.host.querySelector('#wm-canvas');
    var msg = S.host.querySelector('#wm-msg');
    var p = activePhoto();
    if (!canvas || !p) return;
    if (p.status === 'error') {
      msg.hidden = false;
      msg.textContent = p.error;
      canvas.width = canvas.height = 0;
      return;
    }
    Promise.all([photoImage(p), wmImage(S.wmId).catch(function (err) {
      UI.toast(err.message, 'error');
      return null;
    })]).then(function (res) {
      var img = res[0], wm = res[1];
      var box = canvas.parentNode.getBoundingClientRect();
      var maxW = Math.max(200, box.width || 600);
      var W = iw(img), H = ih(img);
      var cssW = Math.min(maxW, W), cssH = cssW * H / W;
      var maxH = Math.max(260, (global.innerHeight || 800) * 0.62);
      if (cssH > maxH) { cssH = maxH; cssW = cssH * W / H; }
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = Math.round(cssW) + 'px';
      canvas.style.height = Math.round(cssH) + 'px';
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        msg.hidden = false;
        msg.textContent = 'This browser cannot show a preview, but downloads still work.';
        return;
      }
      msg.hidden = true;
      var st = settingsFor(p);
      /* The preview is the photo at screen size, so every measurement that is
         in pixels of the photo is scaled down with it — a 30 px margin on a
         4000 px photo is not 30 px on a 600 px preview. */
      var k = canvas.width / W;
      var scaled = previewSettings(st, k);
      paint(ctx, img, wm, scaled, canvas.width, canvas.height);
      if (wm) {
        var L = layout(scaled, canvas.width, canvas.height, wm);
        lastBox = { cx: L.cx / dpr, cy: L.cy / dpr, w: L.w / dpr, h: L.h / dpr, cssW: cssW, cssH: cssH };
      }
    }).catch(function (err) {
      msg.hidden = false;
      msg.textContent = err.message;
    });
  }

  // Settings as they apply to a copy of the photo scaled by k.
  function previewSettings(st, k) {
    var c = JSON.parse(JSON.stringify(st));
    if (c.unit === 'px') { c.width *= k; c.height *= k; }
    if (c.unit === 'mm' || c.unit === 'cm' || c.unit === 'in') c.dpi = c.dpi * k;
    if (c.marginUnit === 'px') c.margin *= k;
    if (c.marginUnit === 'mm' || c.marginUnit === 'cm' || c.marginUnit === 'in') {
      c.margin = toPx(c.margin, c.marginUnit, 0, st.dpi) * k;
      c.marginUnit = 'px';
    }
    return c;
  }

  /* ---------- changing settings ---------- */

  // The settings being edited: everybody's, or this one photo's own copy.
  function editing() {
    var p = activePhoto();
    if (S.scope === 'one' && p) {
      if (!p.override) p.override = JSON.parse(JSON.stringify(S.settings));
      return p.override;
    }
    return S.settings;
  }

  function changed(redraw) {
    // Anything touched by hand is no longer "the preset".
    if (S.scope === 'all' && S.presetId) {
      S.presetId = '';
      var sel = S.host && S.host.querySelector('#wm-preset');
      if (sel) sel.value = '';
    }
    if (redraw) draw(); else preview();
  }

  /* Switching units keeps the watermark exactly the size it is — the number
     changes, the picture does not. Measured against the photo in the preview. */
  function switchUnit(st, unit) {
    var p = activePhoto();
    var W = p && p.w ? p.w : 4000, H = p && p.h ? p.h : 3000;
    var dpi = num(st.dpi, 300);
    var wpx = toPx(st.width, st.unit, W, dpi);
    var hpx = st.height ? toPx(st.height, st.unit, H, dpi) : 0;
    st.width = round(fromPx(wpx, unit, W, dpi), unit);
    st.height = hpx ? round(fromPx(hpx, unit, H, dpi), unit) : 0;
    st.unit = unit;
  }

  function switchMarginUnit(st, unit) {
    var p = activePhoto();
    var B = p && p.w ? Math.min(p.w, p.h) : 3000;
    var dpi = num(st.dpi, 300);
    st.margin = round(fromPx(toPx(st.margin, st.marginUnit, B, dpi), unit, B, dpi), unit);
    st.marginUnit = unit;
  }

  function applyPreset(id, quiet) {
    var p = preset(id);
    if (!p) { S.presetId = ''; return; }
    S.settings = Object.assign(defaults(), p.settings || {});
    if (p.wmId && libraryAll().some(function (w) { return w.id === p.wmId; })) S.wmId = p.wmId;
    else if (p.wmId && !quiet) UI.toast('That preset’s watermark is no longer in your library, so the current one is kept.', 'error');
    S.presetId = id;
    S.scope = 'all';
  }

  /* ---------- wiring ---------- */

  function wire() {
    var root = S.host;

    var files = root.querySelector('#wm-files');
    if (files) files.addEventListener('change', function () { addFiles(files.files); files.value = ''; });
    U.els('[data-drop]', root).forEach(function (z) {
      z.addEventListener('dragover', function (ev) { ev.preventDefault(); z.classList.add('is-over'); });
      z.addEventListener('dragleave', function () { z.classList.remove('is-over'); });
      z.addEventListener('drop', function (ev) {
        ev.preventDefault();
        z.classList.remove('is-over');
        if (ev.dataTransfer) addFiles(ev.dataTransfer.files);
      });
    });

    U.els('[data-nav]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = S.photos.indexOf(activePhoto()) + Number(b.getAttribute('data-nav'));
        if (S.photos[i]) { S.active = S.photos[i].id; if (!S.photos[i].override) S.scope = 'all'; draw(); }
      });
    });
    wireThumbs();
    U.els('[data-select]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var on = b.getAttribute('data-select') === 'all';
        S.photos.forEach(function (p) { p.selected = on; });
        draw();
      });
    });
    var clear = root.querySelector('[data-clear]');
    if (clear) clear.addEventListener('click', function () {
      UI.confirm({
        title: 'Remove every photo?', message: 'They are only taken off this screen. Your original files are not touched.',
        confirmLabel: 'Remove all'
      }).then(function (ok) { if (ok) clearPhotos(); });
    });

    // Watermark and presets.
    U.els('input[name="wm-pick"]', root).forEach(function (r) {
      r.addEventListener('change', function () { S.wmId = r.value; changed(true); });
    });
    var logo = root.querySelector('#wm-newlogo');
    if (logo) logo.addEventListener('change', function () {
      var f = logo.files && logo.files[0];
      logo.value = '';
      if (f) uploadWatermark(f);
    });
    var lib = root.querySelector('[data-manage-lib]');
    if (lib) lib.addEventListener('click', manageLibrary);
    var ps = root.querySelector('#wm-preset');
    if (ps) ps.addEventListener('change', function () {
      if (ps.value) applyPreset(ps.value); else S.presetId = '';
      draw();
    });
    var pm = root.querySelector('[data-preset-menu]');
    if (pm) pm.addEventListener('click', function () { presetMenu(pm); });

    // Scope.
    U.els('[data-scope]', root).forEach(function (b) {
      b.addEventListener('click', function () { S.scope = b.getAttribute('data-scope'); draw(); });
    });
    var reset = root.querySelector('[data-reset-one]');
    if (reset) reset.addEventListener('click', function () {
      var p = activePhoto();
      if (p) p.override = null;
      S.scope = 'all';
      draw();
    });

    // Position.
    U.els('input[name="wm-pos"]', root).forEach(function (r) {
      r.addEventListener('change', function () { editing().position = r.value; changed(true); });
    });

    var adv = root.querySelector('#wm-adv');
    if (adv) adv.addEventListener('toggle', function () { S.advOpen = adv.open; });

    bindRange('wm-size', function (st, v) { st.width = v; }, '% of width');
    bindRange('wm-opacity', function (st, v) { st.opacity = v; }, '%');
    bindRange('wm-scale', function (st, v) { st.scale = v; }, '%');
    bindRange('wm-rot', function (st, v) { st.rotation = v; }, '°');
    bindRange('wm-quality', function (st, v) { st.quality = v; }, '%', true);

    bindNumber('wm-x', function (st, v) {
      var p = activePhoto();
      st.y = st.position === 'custom' ? st.y : currentY(st, p);
      st.x = clamp(v / 100, 0, 1); st.position = 'custom';
    }, true);
    bindNumber('wm-y', function (st, v) {
      var p = activePhoto();
      st.x = st.position === 'custom' ? st.x : currentX(st, p);
      st.y = clamp(v / 100, 0, 1); st.position = 'custom';
    }, true);
    bindNumber('wm-w', function (st, v) { st.width = Math.max(0, v); });
    bindNumber('wm-h', function (st, v) { st.height = Math.max(0, v); });
    bindNumber('wm-margin', function (st, v) { st.margin = Math.max(0, v); });
    bindNumber('wm-dpi', function (st, v) { st.dpi = clamp(v, 30, 1200); });
    bindNumber('wm-max', function (st, v) { st.maxSide = Math.max(0, Math.round(v)); }, false, true);

    var unit = root.querySelector('#wm-unit');
    if (unit) unit.addEventListener('change', function () { switchUnit(editing(), unit.value); changed(true); });
    var munit = root.querySelector('#wm-munit');
    if (munit) munit.addEventListener('change', function () { switchMarginUnit(editing(), munit.value); changed(true); });
    var aspect = root.querySelector('#wm-aspect');
    if (aspect) aspect.addEventListener('change', function () {
      var st = editing();
      st.keepAspect = aspect.checked;
      if (!aspect.checked && !st.height) {
        // Start the free height where the proportional one was, so nothing jumps.
        var p = activePhoto(), wm = images['w:' + S.wmId];
        if (p && p.w && wm) {
          var L = layout(st, p.w, p.h, wm);
          st.height = round(fromPx(L.h / (num(st.scale, 100) / 100), st.unit, p.h, num(st.dpi, 300)), st.unit);
        }
      }
      changed(true);
    });
    var fmt = root.querySelector('#wm-format');
    if (fmt) fmt.addEventListener('change', function () { editing().format = fmt.value; changed(false); updateExample(); });
    ['wm-prefix', 'wm-suffix'].forEach(function (fid) {
      var el = root.querySelector('#' + fid);
      if (el) el.addEventListener('input', function () {
        editing()[fid === 'wm-prefix' ? 'prefix' : 'suffix'] = el.value;
        changed(false);
        updateExample();
      });
    });

    // Downloads.
    U.els('[data-dl]', root).forEach(function (b) {
      b.addEventListener('click', function () { download(b.getAttribute('data-dl')); });
    });
    var stop = root.querySelector('[data-cancel]');
    if (stop) stop.addEventListener('click', function () { S.cancel = true; stop.disabled = true; });
    var dropBad = root.querySelector('[data-drop-bad]');
    if (dropBad) dropBad.addEventListener('click', function () {
      S.photos.filter(function (x) { return x.status === 'error'; }).forEach(function (x) { removePhoto(x.id); });
    });

    wireDrag();
  }

  function updateExample() {
    var el = S.host && S.host.querySelector('#wm-example');
    if (el) el.textContent = example(editing());
  }

  function bindRange(id, set, suffix, noPreview) {
    var el = S.host.querySelector('#' + id);
    if (!el) return;
    var out = S.host.querySelector('#' + id + '-out');
    el.addEventListener('input', function () {
      var v = Number(el.value);
      set(editing(), v);
      if (out) out.textContent = v + (suffix || '');
      // Quality changes the saved file, not the picture on screen.
      if (noPreview) { if (S.scope === 'all') S.presetId = ''; } else changed(false);
      if (id === 'wm-size') { var w = S.host.querySelector('#wm-w'); if (w) w.value = v; }
    });
  }

  function bindNumber(id, set, redraw, allowBlank) {
    var el = S.host.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('change', function () {
      if (el.value === '' && !allowBlank) return;
      set(editing(), el.value === '' ? 0 : Number(el.value));
      changed(!!redraw);
    });
    el.addEventListener('input', function () {
      if (el.value === '' || !isFinite(Number(el.value))) return;
      set(editing(), Number(el.value));
      changed(false);
    });
  }

  function wireThumbs() {
    var root = S.host;
    if (!root) return;
    U.els('[data-open]', root).forEach(function (b) {
      if (b._wired) return;
      b._wired = true;
      b.addEventListener('click', function () {
        S.active = b.getAttribute('data-open');
        var p = activePhoto();
        S.scope = p && p.override ? 'one' : 'all';
        draw();
      });
    });
    U.els('[data-sel]', root).forEach(function (c) {
      if (c._wired) return;
      c._wired = true;
      c.addEventListener('change', function () {
        var p = S.photos.filter(function (x) { return x.id === c.getAttribute('data-sel'); })[0];
        if (p) p.selected = c.checked;
        var n = root.querySelector('#wm-selcount');
        if (n) n.textContent = selected().length;
        var btn = root.querySelector('[data-dl="selected"]');
        var ready = S.photos.filter(function (x) { return x.status === 'ready'; }).length;
        if (btn) {
          btn.disabled = !(selected().length && selected().length < ready);
          btn.textContent = 'Download selected (' + selected().length + ')';
        }
      });
    });
    U.els('[data-remove]', root).forEach(function (b) {
      if (b._wired) return;
      b._wired = true;
      b.addEventListener('click', function () { removePhoto(b.getAttribute('data-remove')); });
    });
  }

  /* Dragging the watermark on the preview. It becomes a custom position, as
     fractions of the photo, so it lands in the same place on every photo
     whatever its size. */
  function wireDrag() {
    var canvas = S.host.querySelector('#wm-canvas');
    if (!canvas) return;
    var dragging = false, dx = 0, dy = 0;
    function point(ev) {
      var r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
    }
    canvas.addEventListener('pointerdown', function (ev) {
      if (!lastBox) return;
      var pt = point(ev);
      dragging = true;
      // Grab it where it was touched, so it does not jump to the finger.
      var inside = Math.abs(pt.x - lastBox.cx) < lastBox.w / 2 + 12 && Math.abs(pt.y - lastBox.cy) < lastBox.h / 2 + 12;
      dx = inside ? lastBox.cx - pt.x : 0;
      dy = inside ? lastBox.cy - pt.y : 0;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* older browsers */ }
      move(ev);
      ev.preventDefault();
    });
    function move(ev) {
      if (!dragging) return;
      var pt = point(ev);
      var st = editing();
      st.position = 'custom';
      st.x = clamp((pt.x + dx) / pt.w, 0, 1);
      st.y = clamp((pt.y + dy) / pt.h, 0, 1);
      changed(false);
    }
    canvas.addEventListener('pointermove', move);
    function end() {
      if (!dragging) return;
      dragging = false;
      draw();          // the controls catch up with where it was put
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /* ---------- the library ---------- */

  // Big logos are brought down to 2000 px across; SVGs are drawn to a PNG once.
  function prepareLogo(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
        return reject(new Error('A watermark has to be a PNG, SVG, WEBP or JPG picture.'));
      }
      var url = URL.createObjectURL(file);
      loadImage(url).then(function (img) {
        var w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
        var k = Math.min(1, 2000 / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k));
        c.height = Math.max(1, Math.round(h * k));
        var ctx = c.getContext('2d');
        if (!ctx) throw new Error('This browser cannot read pictures.');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height,
                  opaque: /jpe?g/i.test(file.type + file.name) });
      }).catch(function (err) { URL.revokeObjectURL(url); reject(err); });
    });
  }

  function uploadWatermark(file, replaceId) {
    prepareLogo(file).then(function (out) {
      if (replaceId) {
        var list = library();
        var item = list.filter(function (x) { return x.id === replaceId; })[0];
        if (!item) return;
        item.w = out.w; item.h = out.h; item.updatedAt = new Date().toISOString();
        return storeWm(replaceId, out.dataUrl).then(function (kept) {
          saveLibrary(list);
          delete images['w:' + replaceId];
          UI.toast('Watermark replaced.' + (kept ? '' : ' It is kept for this visit only — this browser will not store pictures.'));
          draw();
        });
      }
      askName(baseName(file.name).replace(/[_-]+/g, ' '), 'Name this watermark', function (name) {
        var id = uid();
        storeWm(id, out.dataUrl).then(function (kept) {
          var list = library();
          list.push({ id: id, name: name, w: out.w, h: out.h,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          saveLibrary(list);
          S.wmId = id;
          UI.toast('Saved to your watermark library.' + (kept ? '' : ' It is kept for this visit only — this browser will not store pictures.') +
            (out.opaque ? ' A JPG has no transparent background; a PNG usually looks better.' : ''));
          changed(true);
        });
      });
    }).catch(function (err) { UI.toast(err.message, 'error'); });
  }

  function askName(value, title, done) {
    UI.modal({
      title: title,
      body: '<div class="field"><label for="wm-name">Name</label>' +
        '<input type="text" id="wm-name" data-autofocus maxlength="60" value="' + esc(value) + '"></div>',
      footer: '<button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-ok>Save</button>',
      onMount: function (root, close) {
        var input = root.querySelector('#wm-name');
        function ok() {
          var v = input.value.trim();
          if (!v) { input.focus(); return; }
          close();
          done(v);
        }
        root.querySelector('[data-ok]').addEventListener('click', ok);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      }
    });
  }

  function manageLibrary() {
    var list = library();
    UI.modal({
      title: 'Watermark library',
      body: '<p class="small muted" style="margin-top:0">Saved on this device. The FCUSR Nationals Seal ' +
        'comes with the app and cannot be changed.</p>' +
        (list.length
          ? '<div class="list">' + list.map(function (w) {
              var used = presets().filter(function (p) { return p.wmId === w.id; }).length;
              return '<div class="wm-lib-row"><span class="wli-img" data-wm-thumb="' + esc(w.id) + '"></span>' +
                '<span class="rt"><strong>' + esc(w.name) + '</strong><span class="rs">' + w.w + ' × ' + w.h + ' px' +
                (used ? ' · used by ' + U.plural(used, 'preset') : '') + '</span></span>' +
                '<span class="row" style="gap:4px">' +
                '<button type="button" class="btn btn-sm" data-rename="' + esc(w.id) + '">Rename</button>' +
                '<label class="btn btn-sm">Replace<input type="file" hidden data-replace="' + esc(w.id) + '" ' +
                  'accept="image/png,image/svg+xml,image/webp,image/jpeg"></label>' +
                '<button type="button" class="btn btn-sm btn-danger" data-del="' + esc(w.id) + '">Delete</button>' +
                '</span></div>';
            }).join('') + '</div>'
          : UI.empty('Nothing saved yet', 'Upload your unit’s logo or a documentation watermark once, and ' +
              'it stays here for next time.', '', 'calm')),
      footer: '<button type="button" class="btn btn-primary" data-close>Done</button>',
      onMount: function (root, close) {
        U.els('[data-wm-thumb]', root).forEach(function (el) {
          wmSrc(el.getAttribute('data-wm-thumb')).then(function (src) {
            el.innerHTML = '<img src="' + esc(src) + '" alt="">';
          }).catch(function () { el.innerHTML = UI.icon('alert'); });
        });
        U.els('[data-rename]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var id = b.getAttribute('data-rename');
            var all = library();
            var item = all.filter(function (x) { return x.id === id; })[0];
            if (!item) return;
            close();
            askName(item.name, 'Rename watermark', function (name) {
              item.name = name;
              saveLibrary(all);
              UI.toast('Renamed.');
              draw();
              manageLibrary();
            });
          });
        });
        U.els('[data-replace]', root).forEach(function (inp) {
          inp.addEventListener('change', function () {
            var f = inp.files && inp.files[0];
            if (!f) return;
            close();
            uploadWatermark(f, inp.getAttribute('data-replace'));
          });
        });
        U.els('[data-del]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            var id = b.getAttribute('data-del');
            var item = library().filter(function (x) { return x.id === id; })[0];
            if (!item) return;
            close();
            UI.confirm({
              title: 'Delete “' + item.name + '”?',
              message: 'It is removed from this device’s library.',
              detail: 'Presets that use it will fall back to the watermark chosen at the time.',
              confirmLabel: 'Delete'
            }).then(function (ok) {
              if (!ok) return manageLibrary();
              saveLibrary(library().filter(function (x) { return x.id !== id; }));
              if (global.AssetDB) AssetDB.del('wm:' + id).catch(function () { /* already gone */ });
              delete memoryOnly[id];
              delete images['w:' + id];
              if (S.wmId === id) S.wmId = SEAL_ID;
              UI.toast('Watermark deleted.');
              draw();
            });
          });
        });
      }
    });
  }

  /* ---------- presets ---------- */

  function presetMenu(anchor) {
    var cur = preset(S.presetId);
    var def = defaultPresetId();
    var items =
      '<button type="button" data-set="save">' + UI.icon('plus') + 'Save current settings as a preset</button>' +
      (cur && !cur.builtin
        ? '<button type="button" data-set="update">' + UI.icon('refresh') + 'Update “' + esc(cur.name) + '”</button>' +
          '<button type="button" data-set="rename">' + UI.icon('edit') + 'Rename</button>'
        : '') +
      (cur ? '<button type="button" data-set="dup">' + UI.icon('copy') + 'Duplicate</button>' : '') +
      (cur && cur.id !== def ? '<button type="button" data-set="default">' + UI.icon('star') + 'Make it the default</button>' : '') +
      (cur && !cur.builtin ? '<div class="sep"></div><button type="button" class="danger" data-set="delete">' +
        UI.icon('trash') + 'Delete preset</button>' : '');
    UI.openMenu(anchor, items, function (act) {
      var list = readJSON(PRESET_KEY, []);
      var snap = function () {
        return { wmId: S.wmId, settings: JSON.parse(JSON.stringify(S.settings)) };
      };
      if (act === 'save') {
        return askName('', 'Name this preset', function (name) {
          var p = snap();
          p.id = uid(); p.name = name;
          list.push(p);
          savePresets(list);
          S.presetId = p.id;
          UI.toast('Preset saved. Next time: add photos, pick “' + name + '”, download.');
          draw();
        });
      }
      if (act === 'dup') {
        return askName(cur.name + ' (copy)', 'Name the copy', function (name) {
          var p = { id: uid(), name: name, wmId: cur.wmId, settings: JSON.parse(JSON.stringify(cur.settings)) };
          list.push(p);
          savePresets(list);
          S.presetId = p.id;
          UI.toast('Preset duplicated.');
          draw();
        });
      }
      if (act === 'default') {
        writeJSON(DEFAULT_KEY, cur.id);
        UI.toast('“' + cur.name + '” is now used whenever the studio opens.');
        return draw();
      }
      var mine = list.filter(function (p) { return p.id === S.presetId; })[0];
      if (!mine) return;
      if (act === 'update') {
        var s = snap();
        mine.wmId = s.wmId;
        mine.settings = s.settings;
        savePresets(list);
        return UI.toast('Preset updated.');
      }
      if (act === 'rename') {
        return askName(mine.name, 'Rename preset', function (name) {
          mine.name = name;
          savePresets(list);
          draw();
        });
      }
      if (act === 'delete') {
        UI.confirm({ title: 'Delete “' + mine.name + '”?', message: 'The preset is removed from this device.',
          confirmLabel: 'Delete' }).then(function (ok) {
          if (!ok) return;
          savePresets(list.filter(function (p) { return p.id !== mine.id; }));
          if (defaultPresetId() === mine.id) writeJSON(DEFAULT_KEY, STANDARD_ID);
          S.presetId = '';
          UI.toast('Preset deleted.');
          draw();
        });
      }
    });
  }

  /* ---------- downloading ---------- */

  function saveBlob(blob, name) { UI.downloadFile(name, blob); }

  /* The bar moves in place. Redrawing the whole studio for every photo would
     redraw the preview too, which is the slowest thing on the screen. */
  function showProgress(pct, text) {
    var first = !S.progress;
    S.progress = { pct: pct, text: text };
    var bar = S.host && S.host.querySelector('.wm-progress');
    if (first || !bar) return draw();
    bar.querySelector('.progress > span').style.width = pct + '%';
    bar.querySelector('.small').textContent = text;
  }

  function download(which) {
    if (S.busy) return;
    var list = which === 'one' ? [activePhoto()]
      : which === 'selected' ? selected()
      : S.photos.filter(function (p) { return p.status === 'ready'; });
    list = list.filter(function (p) { return p && p.status === 'ready'; });
    if (!list.length) return UI.toast('No photos are ready to download.', 'error');

    S.busy = true;
    S.cancel = false;
    var done = [], failed = [];
    var total = list.length;
    function step(i) {
      showProgress(Math.round(i / total * 100), 'Preparing ' + Math.min(i + 1, total) + ' of ' + total + '…');
    }

    var chain = Promise.resolve();
    list.forEach(function (p, i) {
      chain = chain.then(function () {
        if (S.cancel) return;
        step(i);
        return render(p).then(function (out) {
          if (total === 1) { done.push(out); return; }
          return readBytes(out.blob).then(function (bytes) {
            done.push({ name: out.name, blob: out.blob, crc: crc32(bytes), size: bytes.length });
          });
        }).catch(function (err) { failed.push({ p: p, why: err.message }); });
      });
    });

    chain.then(function () {
      if (S.cancel) { UI.toast('Stopped. Nothing was downloaded.'); return; }
      if (!done.length) throw new Error(failed.length ? failed[0].why : 'Nothing could be prepared.');
      if (total === 1) {
        saveBlob(done[0].blob, done[0].name);
      } else {
        showProgress(100, 'Packing the ZIP file…');
        var zip = buildZip(uniqueNames(done));
        saveBlob(zip, 'FCUSR-Watermarked-' + U.today() + '-' + done.length + '-photos.zip');
      }
      if (failed.length) {
        UI.toast((failed.length === 1 ? 'One photo could not be processed' : failed.length + ' photos could not be processed') +
          ' (' + failed[0].p.name + ': ' + failed[0].why + '). The remaining ' +
          U.plural(done.length, 'photo was', 'photos were') + ' downloaded.', 'error');
      } else {
        UI.toast(total === 1 ? 'Photo downloaded.' : U.plural(done.length, 'photo') + ' downloaded as one ZIP file.');
      }
    }).catch(function (err) {
      UI.toast('The photos could not be prepared: ' + err.message + ' Nothing you set up has been lost.', 'error');
    }).then(function () {
      S.busy = false;
      S.progress = null;
      draw();
    });
  }

  /* ---------- opening ---------- */

  function mount(host) {
    S.host = host;
    if (!S.started) {
      S.started = true;
      applyPreset(defaultPresetId(), true);
    }
    // Bring the watermark in first, so the X/Y fields can say where it actually is.
    wmImage(S.wmId).catch(function () { return null; }).then(function () {
      if (S.host === host) draw();
    });
    draw();
  }

  global.WatermarkStudio = {
    mount: mount,
    // For the tests: the parts that are pure arithmetic and bytes.
    _layout: layout, _toPx: toPx, _fromPx: fromPx, _crc32: crc32, _buildZip: buildZip,
    _outName: outName, _outSize: outSize, _presets: presets, _state: S, _addFiles: addFiles,
    _uniqueNames: uniqueNames, _switchUnit: switchUnit, _defaults: defaults
  };
})(window);
