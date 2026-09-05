/* Image storage for accomplishment reports.

   Photos cannot live in localStorage — the whole origin gets about 5 MB, and six
   phone photos is 10–15 MB before you start. IndexedDB has no such ceiling (the
   browser offers a share of free disk), so every scan and photo goes here and the
   tracker's own record keeps only the id.

   Everything is compressed on the way in. A 4 MB phone photo becomes roughly
   250 KB at a size that still prints cleanly on A4, which keeps the finished PDF
   small enough to email and cheap to upload to Drive later. */
(function (global) {
  'use strict';

  var DB_NAME = 'fcusr.assets';
  var STORE = 'images';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('This browser has no IndexedDB.'));
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function put(id, dataUrl) { return tx('readwrite', function (s) { return s.put(dataUrl, id); }); }
  function get(id) { return tx('readonly', function (s) { return s.get(id); }); }
  function del(id) { return tx('readwrite', function (s) { return s.delete(id); }); }

  function getMany(ids) {
    return Promise.all((ids || []).map(function (id) {
      return get(id).then(function (v) { return { id: id, dataUrl: v || '' }; });
    }));
  }

  // Remove every image belonging to one report.
  function delPrefix(prefix) {
    return tx('readwrite', function (s) {
      var req = s.openKeyCursor();
      req.onsuccess = function () {
        var cur = req.result;
        if (!cur) return;
        if (String(cur.key).indexOf(prefix) === 0) s.delete(cur.key);
        cur.continue();
      };
      return req;
    });
  }

  function usage() {
    if (!global.navigator || !navigator.storage || !navigator.storage.estimate) {
      return Promise.resolve(null);
    }
    return navigator.storage.estimate().then(function (e) {
      return { used: e.usage || 0, quota: e.quota || 0 };
    });
  }

  /* ---------- compression ----------
     Draws the picture into a canvas at a printable size and re-encodes it. The
     EXIF orientation flag is honoured, because phone photos are routinely stored
     sideways and would otherwise print rotated. */

  function compress(file, opts) {
    opts = opts || {};
    var maxDim = opts.maxDim || 1600;
    var quality = opts.quality || 0.82;

    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        return reject(new Error('That file is not an image.'));
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That image could not be opened.')); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));

          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('This browser cannot process images.'));
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);

          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({
            dataUrl: dataUrl,
            width: cw,
            height: ch,
            bytes: Math.round(dataUrl.length * 0.75),
            originalBytes: file.size,
            name: file.name || 'image'
          });
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  // Store a picked file and hand back the id the report should remember.
  function addFile(reportId, file, opts) {
    return compress(file, opts).then(function (out) {
      var id = reportId + ':' + U.uid('img');
      return put(id, out.dataUrl).then(function () {
        out.id = id;
        return out;
      });
    });
  }

  global.AssetDB = {
    put: put, get: get, del: del, getMany: getMany, delPrefix: delPrefix,
    compress: compress, addFile: addFile, usage: usage
  };
})(window);
