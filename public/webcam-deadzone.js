// ═══════════════════════════════════════════════════
//  AS Adventurer — Webcam neutral deadzone
//  MediaPipe still returns small mouthSmile/cheekSquint
//  / browDown values on a relaxed face (~10–18). After
//  gain (e.g. 3.8×) that becomes ~50 and false-triggers
//  Happy or Sad. We subtract a resting floor from those
//  blendshapes before they hit the server scoring pipeline.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  // Values are on the 0–100 scale used by control.js (score * 100).
  // Tuned so a typical neutral face → ~0 smile/frown after composite + gain.
  const FLOORS = {
    // Smile contributors (same strength as before)
    mouthSmileLeft: 12,
    mouthSmileRight: 12,
    cheekSquintLeft: 14,
    cheekSquintRight: 14,
    eyeSquintLeft: 8,
    eyeSquintRight: 8,
    // Frown contributors — matched to smile strength so resting
    // brow tension doesn't read as sad after gain
    browDownLeft: 14,
    browDownRight: 14,
    browInnerUp: 12,
    mouthFrownLeft: 12,
    mouthFrownRight: 12,
    // Surprised contributors
    eyeWideLeft: 6,
    eyeWideRight: 6,
    jawOpen: 6,
    browOuterUpLeft: 6,
    browOuterUpRight: 6,
    mouthFunnel: 6,
  };

  function applyDeadzone(map) {
    if (!map || typeof map !== 'object') return map;
    const out = { ...map };
    for (const [k, floor] of Object.entries(FLOORS)) {
      if (out[k] !== undefined) {
        out[k] = Math.max(0, Number(out[k]) - floor);
      }
    }
    return out;
  }

  // Patch WebSocket.send so webcam_tracking messages are cleaned
  // (must load BEFORE control.js creates its WebSocket)
  const proto = window.WebSocket && window.WebSocket.prototype;
  if (!proto || proto.__asDeadzonePatched) return;

  const origSend = proto.send;
  proto.send = function (data) {
    try {
      if (typeof data === 'string' && data.indexOf('webcam_tracking') !== -1) {
        const msg = JSON.parse(data);
        if (msg.type === 'webcam_tracking' && msg.blendShapes) {
          msg.blendShapes = applyDeadzone(msg.blendShapes);
          data = JSON.stringify(msg);
        }
      }
    } catch (e) {
      /* leave data unchanged */
    }
    return origSend.call(this, data);
  };
  proto.__asDeadzonePatched = true;
  console.log('[deadzone] Webcam neutral floors active (smile + frown resting bias removed)');
})();
