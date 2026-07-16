// ═══════════════════════════════════════════════════
//  Webcam loop — landmark geometry for expressions
//  Takes over Start/Stop webcam buttons and injects
//  landmark ratios into blendshape map.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  let ourActive = false;
  let faceLandmarker = null;
  let stream = null;
  let frameCount = 0;
  let lastFpsTime = 0;
  let lastFace = false;
  let ws = null;

  function ensureWS() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return ws;
    try {
      ws = new WebSocket('ws://' + location.host + '?type=control');
      ws.addEventListener('open', function () {
        console.log('[webcam-geometry] WS connected');
      });
      ws.addEventListener('close', function () {
        ws = null;
        if (ourActive) setTimeout(ensureWS, 1000);
      });
    } catch (e) {
      console.warn('[webcam-geometry] WS error', e);
    }
    return ws;
  }

  async function loadMP() {
    if (faceLandmarker) return faceLandmarker;
    var VER = '0.10.14';
    var vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VER + '/vision_bundle.mjs');
    var FaceLandmarker = vision.FaceLandmarker;
    var FilesetResolver = vision.FilesetResolver;
    var resolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VER + '/wasm'
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(resolver, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    console.log('[webcam-geometry] MediaPipe ready');
    return faceLandmarker;
  }

  function processFrame() {
    if (!ourActive || !faceLandmarker) return;
    var video = document.getElementById('webcam-video');
    if (!video || video.readyState < 2) {
      requestAnimationFrame(processFrame);
      return;
    }

    var now = performance.now();
    var result = faceLandmarker.detectForVideo(video, now);

    frameCount++;
    if (now - lastFpsTime >= 1000) {
      var fpsEl = document.getElementById('webcam-fps');
      if (fpsEl) fpsEl.textContent = frameCount + ' FPS';
      frameCount = 0;
      lastFpsTime = now;
    }

    var hasLandmarks = result.faceLandmarks && result.faceLandmarks.length > 0;
    var hasBlend = result.faceBlendshapes && result.faceBlendshapes.length > 0;

    if (hasLandmarks || hasBlend) {
      var blendShapeMap = {};

      if (hasBlend) {
        var cats = result.faceBlendshapes[0].categories;
        for (var i = 0; i < cats.length; i++) {
          blendShapeMap[cats[i].categoryName] = cats[i].score * 100;
        }
      }

      var geo = window.AS_Geometry || window.AS_BrokeAss;
      if (hasLandmarks && geo) {
        geo.injectGeometryScores(blendShapeMap, result.faceLandmarks[0]);
      }

      if (!lastFace) {
        lastFace = true;
        var faceEl = document.getElementById('webcam-face-status');
        if (faceEl) {
          faceEl.textContent = 'Detected ✓';
          faceEl.style.color = '#4ade80';
        }
      }

      var sock = ensureWS();
      if (sock && sock.readyState === 1) {
        sock.send(
          JSON.stringify({
            type: 'webcam_tracking',
            blendShapes: blendShapeMap,
          })
        );
      }
    } else if (lastFace) {
      lastFace = false;
      var faceEl2 = document.getElementById('webcam-face-status');
      if (faceEl2) {
        faceEl2.textContent = 'No face';
        faceEl2.style.color = '#f87171';
      }
    }

    requestAnimationFrame(processFrame);
  }

  function takeOver() {
    var btn = document.getElementById('btn-start-webcam');
    var stopBtn = document.getElementById('btn-stop-webcam');
    if (!btn) {
      console.warn('[webcam-geometry] start button missing');
      return;
    }

    var fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    fresh.addEventListener('click', async function () {
      var statusEl = document.getElementById('webcam-status');
      try {
        fresh.textContent = 'Loading MediaPipe...';
        fresh.disabled = true;
        if (statusEl) {
          statusEl.textContent = 'Status: Loading MediaPipe…';
          statusEl.style.color = '#94a3b8';
        }

        await loadMP();
        ensureWS();

        if (statusEl) statusEl.textContent = 'Status: Requesting camera...';
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
        var video = document.getElementById('webcam-video');
        video.srcObject = stream;
        await video.play();

        document.getElementById('webcam-container').style.display = 'block';
        fresh.style.display = 'none';
        var stopNow = document.getElementById('btn-stop-webcam');
        if (stopNow) stopNow.style.display = '';

        ourActive = true;
        frameCount = 0;
        lastFpsTime = performance.now();
        if (statusEl) {
          statusEl.textContent = 'Status: Tracking ✓ (geometry)';
          statusEl.style.color = '#4ade80';
        }
        processFrame();
      } catch (err) {
        console.error(err);
        fresh.textContent = 'Start Webcam';
        fresh.disabled = false;
        if (statusEl) {
          statusEl.textContent = 'Status: Error — ' + err.message;
          statusEl.style.color = '#f87171';
        }
      }
    });

    if (stopBtn) {
      var freshStop = stopBtn.cloneNode(true);
      stopBtn.parentNode.replaceChild(freshStop, stopBtn);
      freshStop.addEventListener('click', function () {
        ourActive = false;
        if (stream) {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
          stream = null;
        }
        document.getElementById('webcam-container').style.display = 'none';
        var startBtn = document.getElementById('btn-start-webcam');
        if (startBtn) {
          startBtn.style.display = '';
          startBtn.textContent = 'Start Webcam';
          startBtn.disabled = false;
        }
        freshStop.style.display = 'none';
        var statusEl = document.getElementById('webcam-status');
        if (statusEl) {
          statusEl.textContent = 'Status: Idle';
          statusEl.style.color = '#94a3b8';
        }
        var faceEl = document.getElementById('webcam-face-status');
        if (faceEl) faceEl.textContent = '—';
        var fpsEl = document.getElementById('webcam-fps');
        if (fpsEl) fpsEl.textContent = '—';
      });
    }

    console.log('[webcam-geometry] Buttons taken over — landmark geometry active');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(takeOver, 50);
    });
  } else {
    setTimeout(takeOver, 50);
  }
})();
