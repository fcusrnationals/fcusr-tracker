/* In-app camera.

   The `capture="environment"` attribute on a file input only does anything on a
   phone; desktop browsers ignore it completely and just open the file picker,
   which is why "Use camera" appeared to do nothing on a laptop. This opens a real
   camera stream instead, and works the same on both.

   Needs a secure context — https:// or localhost. Anything else has no camera
   access at all, by browser policy, and we say so plainly. */
(function (global) {
  'use strict';

  function supported() {
    return !!(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function secure() {
    return global.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
  }

  /* Documents photographed in a room are grey and low contrast. This pushes the
     paper towards white and the ink towards black — the same trick scanner apps
     use — without needing edge detection. */
  function enhance(canvas) {
    var ctx = canvas.getContext('2d');
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;

    // Sample the brightness spread so the correction suits this photo.
    var hist = new Uint32Array(256), i;
    for (i = 0; i < d.length; i += 4) {
      hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
    }
    var total = canvas.width * canvas.height;
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.10) { hi = i; break; } }
    if (hi - lo < 24) { lo = 0; hi = 255; }

    var scale = 255 / (hi - lo);
    for (i = 0; i < d.length; i += 4) {
      d[i]     = Math.max(0, Math.min(255, (d[i] - lo) * scale));
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - lo) * scale));
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - lo) * scale));
    }
    ctx.putImageData(img, 0, 0);
  }

  function rotate(canvas, degrees) {
    var out = document.createElement('canvas');
    var swap = degrees % 180 !== 0;
    out.width = swap ? canvas.height : canvas.width;
    out.height = swap ? canvas.width : canvas.height;
    var ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(degrees * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
  }

  /* Opens the camera and resolves with a File once the user keeps a shot.
     Resolves with null if they close without taking one. */
  function open(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!supported() || !secure()) {
        UI.modal({
          title: 'Camera not available',
          body: '<p class="small">' + (secure()
            ? 'This browser does not offer camera access.'
            : 'Browsers only allow the camera on a secure page (https, or localhost while testing). ' +
              'This page is served over plain http, so the camera is blocked by the browser itself.') +
            '</p><p class="small muted">Use <strong>Upload file</strong> instead — take the photo with your ' +
            'phone’s own camera app, or scan on the printer, then add the file here.</p>',
          footer: '<button type="button" class="btn btn-primary" data-close>Close</button>'
        });
        return resolve(null);
      }

      var stream = null;
      var shot = null;        // canvas holding the captured frame
      var docMode = opts.document !== false;

      var close = UI.modal({
        title: 'Camera',
        wide: true,
        dismissible: false,
        body:
          '<div class="cam">' +
            '<div class="cam-stage">' +
              '<video id="cam-video" playsinline muted autoplay></video>' +
              '<canvas id="cam-canvas" hidden></canvas>' +
            '</div>' +
            '<p class="small muted" id="cam-hint" style="margin-top:10px">' +
              'Lay the page flat, hold the camera directly above it, and let it fill the frame.</p>' +
            '<div class="row" id="cam-live" style="margin-top:10px">' +
              '<button type="button" class="btn btn-primary" id="cam-shoot">Take photo</button>' +
              '<label class="checkbox" style="align-items:center">' +
              '<input type="checkbox" id="cam-doc"' + (docMode ? ' checked' : '') + '>' +
              '<span>Clean up for documents</span></label>' +
            '</div>' +
            '<div class="row" id="cam-review" hidden style="margin-top:10px">' +
              '<button type="button" class="btn btn-primary" id="cam-keep">Use this photo</button>' +
              '<button type="button" class="btn" id="cam-retake">Retake</button>' +
              '<button type="button" class="btn" id="cam-rotate">Rotate</button>' +
            '</div>' +
          '</div>',
        footer: '<button type="button" class="btn" id="cam-cancel">Cancel</button>',
        onMount: function (root) {
          var video = root.querySelector('#cam-video');
          var canvas = root.querySelector('#cam-canvas');
          var live = root.querySelector('#cam-live');
          var review = root.querySelector('#cam-review');
          var hint = root.querySelector('#cam-hint');

          function stop() {
            if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
            stream = null;
          }

          function fail(err) {
            hint.innerHTML = '<span style="color:var(--st-overdue-fg);font-weight:600">' +
              U.esc(err && err.name === 'NotAllowedError'
                ? 'Camera permission was refused. Allow it in the browser address bar, then try again.'
                : 'No camera could be opened on this device.') + '</span>';
            live.hidden = true;
          }

          // The rear camera is the right default for photographing paper.
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 2200 } },
            audio: false
          }).then(function (s) {
            stream = s;
            video.srcObject = s;
          }).catch(fail);

          root.querySelector('#cam-shoot').addEventListener('click', function () {
            if (!video.videoWidth) return;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            if (root.querySelector('#cam-doc').checked) enhance(canvas);
            shot = canvas;
            video.hidden = true;
            canvas.hidden = false;
            live.hidden = true;
            review.hidden = false;
            hint.textContent = 'Readable? Keep it. Otherwise retake.';
          });

          root.querySelector('#cam-retake').addEventListener('click', function () {
            shot = null;
            video.hidden = false;
            canvas.hidden = true;
            live.hidden = false;
            review.hidden = true;
            hint.textContent = 'Lay the page flat, hold the camera directly above it, and let it fill the frame.';
          });

          root.querySelector('#cam-rotate').addEventListener('click', function () {
            if (!shot) return;
            var out = rotate(shot, 90);
            canvas.width = out.width;
            canvas.height = out.height;
            canvas.getContext('2d').drawImage(out, 0, 0);
            shot = canvas;
          });

          root.querySelector('#cam-keep').addEventListener('click', function () {
            if (!shot) return;
            shot.toBlob(function (blob) {
              stop();
              close();
              resolve(new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.9);
          });

          root.querySelector('#cam-cancel').addEventListener('click', function () {
            stop();
            close();
            resolve(null);
          });
        },
        onClose: function () {
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        }
      });
    });
  }

  global.Camera = { open: open, supported: supported, secure: secure, enhance: enhance };
})(window);
