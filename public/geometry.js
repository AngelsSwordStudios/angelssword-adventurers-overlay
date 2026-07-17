// ═══════════════════════════════════════════════════
//  Geometry — smile / frown / surprised / eyes
//  Sensitivity: min(1, raw * mult) * 100
//  Then stuffs blendshape channels for server composites.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  function getMouthOpenRatio(landmarks) {
    try {
      var upper = landmarks[13];
      var lower = landmarks[14];
      var mouthH = Math.abs(upper.y - lower.y);
      var faceH = Math.abs(landmarks[10].y - landmarks[152].y);
      return faceH > 0 ? mouthH / faceH : 0;
    } catch (e) {
      return 0;
    }
  }

  function getSmileRatio(landmarks) {
    try {
      var leftCorner = landmarks[61];
      var rightCorner = landmarks[291];
      var upperLip = landmarks[13];
      var lowerLip = landmarks[14];
      var mouthCenterY = (upperLip.y + lowerLip.y) / 2;
      var cornerY = (leftCorner.y + rightCorner.y) / 2;
      var smileAmount = Math.max(0, mouthCenterY - cornerY);
      return Math.min(smileAmount * 12.0, 1.0);
    } catch (e) {
      return 0;
    }
  }

  function getEyebrowRaiseRatio(landmarks) {
    try {
      var browY = (landmarks[55].y + landmarks[285].y) / 2;
      var eyeTopY = (landmarks[159].y + landmarks[386].y) / 2;
      var raiseAmount = Math.max(0, eyeTopY - browY);
      return Math.min(raiseAmount * 8.0, 1.0);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Frown 0–1 via nasolabial-fold deepen.
   * Measures how the crease region (nose wing → fold → mouth corner)
   * pulls in / deepens vs a relaxed face.
   */
  function getFrownRatio(landmarks) {
    try {
      var faceH = Math.abs(landmarks[10].y - landmarks[152].y);
      if (!(faceH > 1e-6)) return 0;

      /**
       * Per-side nasolabial score.
       * noseIdx  — nose wing (48 left / 278 right)
       * foldIdx  — crease mid region (205 left / 425 right)
       * cornerIdx — mouth corner (61 left / 291 right)
       * cheekIdx — outer cheek for width ref (234 left / 454 right)
       */
      function sideScore(noseIdx, foldIdx, cornerIdx, cheekIdx) {
        var nose = landmarks[noseIdx];
        var fold = landmarks[foldIdx];
        var corner = landmarks[cornerIdx];
        var cheek = landmarks[cheekIdx];

        // 1) Medial pull: fold moves toward nose vs outer cheek span
        var halfW = Math.abs(cheek.x - nose.x);
        if (!(halfW > 1e-6)) halfW = 1e-6;
        var foldFromNose = Math.abs(fold.x - nose.x);
        // Higher when fold sits closer to the nose (crease pulled in)
        var medial = Math.max(0, Math.min(1, 1 - foldFromNose / halfW));

        // 2) How tightly fold sits on the nose→mouth-corner chord
        //    (deeper fold → landmark sits closer to that path)
        var dx = corner.x - nose.x;
        var dy = corner.y - nose.y;
        var len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) return 0;
        var t = ((fold.x - nose.x) * dx + (fold.y - nose.y) * dy) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        var projX = nose.x + t * dx;
        var projY = nose.y + t * dy;
        var dist = Math.hypot(fold.x - projX, fold.y - projY);
        // Typical relaxed dist is a few % of face height; clamp to 0–1
        var onLine = Math.max(0, Math.min(1, 1 - (dist / faceH) * 10));

        // 3) Vertical tension: upper-lip / fold area lifts toward nose
        //    (common with nasolabial activation / displeasure)
        var midY = (nose.y + corner.y) / 2;
        var verticalPull = Math.max(0, (midY - fold.y) / faceH);
        var vert = Math.min(1, verticalPull * 14);

        return medial * 0.40 + onLine * 0.35 + vert * 0.25;
      }

      // Left / right nasolabial regions
      var left = sideScore(48, 205, 61, 234);
      var right = sideScore(278, 425, 291, 454);
      var avg = (left + right) / 2;

      // Mild boost so a clear deepen reaches the top of the meter
      return Math.min(1.0, avg * 1.25);
    } catch (e) {
      return 0;
    }
  }

  function getEyesClosedRatio(landmarks) {
    try {
      function ear(upper, lower, outer, inner) {
        var v = Math.abs(landmarks[upper].y - landmarks[lower].y);
        var h = Math.abs(landmarks[outer].x - landmarks[inner].x);
        return h > 1e-6 ? v / h : 0;
      }
      var left = ear(159, 145, 33, 133);
      var right = ear(386, 374, 263, 362);
      var openEar = (left + right) / 2;
      var OPEN = 0.22;
      var CLOSED = 0.05;
      var closed = (OPEN - openEar) / (OPEN - CLOSED);
      if (closed < 0) closed = 0;
      if (closed > 1) closed = 1;
      return closed;
    } catch (e) {
      return 0;
    }
  }

  function readGains() {
    if (window.AS_GAINS) {
      return {
        smile: Number(window.AS_GAINS.smile) || 1,
        surprised: Number(window.AS_GAINS.surprised) || 1,
        frown: Number(window.AS_GAINS.frown) || 1,
        eyes: Number(window.AS_GAINS.eyes) || 1,
      };
    }
    function clamp(v) {
      var n = parseFloat(v);
      return isFinite(n) ? Math.min(5, Math.max(0.5, n)) : 1;
    }
    return {
      smile: clamp(document.getElementById('gain-smile') && document.getElementById('gain-smile').value),
      surprised: clamp(document.getElementById('gain-surprised') && document.getElementById('gain-surprised').value),
      frown: clamp(document.getElementById('gain-frown') && document.getElementById('gain-frown').value),
      eyes: clamp(document.getElementById('gain-eyes') && document.getElementById('gain-eyes').value),
    };
  }

  function applySensitivity(raw01, mult) {
    var m = isFinite(mult) && mult > 0 ? mult : 1;
    return Math.min(100, Math.min(1.0, raw01 * m) * 100);
  }

  function injectGeometryScores(blendShapeMap, landmarks) {
    if (!landmarks || !landmarks.length) return blendShapeMap;
    var gains = readGains();

    var rawMouth = getMouthOpenRatio(landmarks);
    var rawSmile = getSmileRatio(landmarks);
    var rawFrown = getFrownRatio(landmarks);
    var rawEyes = getEyesClosedRatio(landmarks);

    var smileScore = applySensitivity(rawSmile, gains.smile);
    var mouthScore = applySensitivity(rawMouth, gains.surprised);
    var frownScore = applySensitivity(rawFrown, gains.frown);
    var eyesScore = applySensitivity(rawEyes, gains.eyes);

    blendShapeMap._smileRatio = smileScore;
    blendShapeMap._mouthOpenRatio = mouthScore;
    blendShapeMap._frownRatio = frownScore;
    blendShapeMap._eyesClosedRatio = eyesScore;
    blendShapeMap._rawMouthOpen = Math.min(100, rawMouth * 100);
    blendShapeMap._rawSmile = Math.min(100, rawSmile * 100);
    blendShapeMap._rawFrown = Math.min(100, rawFrown * 100);
    blendShapeMap._rawEyes = Math.min(100, rawEyes * 100);
    blendShapeMap._geometry = 1;

    var s = smileScore;
    blendShapeMap.cheekSquintLeft = s;
    blendShapeMap.cheekSquintRight = s;
    blendShapeMap.eyeSquintLeft = s;
    blendShapeMap.eyeSquintRight = s;
    blendShapeMap.mouthSmileLeft = s;
    blendShapeMap.mouthSmileRight = s;

    var m = Math.min(100, mouthScore / 0.925);
    blendShapeMap.eyeWideLeft = m;
    blendShapeMap.eyeWideRight = m;
    blendShapeMap.jawOpen = m;
    blendShapeMap.mouthFunnel = m;
    blendShapeMap.browOuterUpLeft = m;
    blendShapeMap.browOuterUpRight = m;

    // Frown channels stuffed so server composite = frownScore
    // (gain already applied — same path as other emotions)
    var f = frownScore;
    blendShapeMap.browDownLeft = f;
    blendShapeMap.browDownRight = f;
    blendShapeMap.browInnerUp = f;
    blendShapeMap.mouthFrownLeft = f;
    blendShapeMap.mouthFrownRight = f;

    blendShapeMap.eyeBlinkLeft = eyesScore;
    blendShapeMap.eyeBlinkRight = eyesScore;

    return blendShapeMap;
  }

  var api = {
    getMouthOpenRatio: getMouthOpenRatio,
    getSmileRatio: getSmileRatio,
    getFrownRatio: getFrownRatio,
    getEyesClosedRatio: getEyesClosedRatio,
    getEyebrowRaiseRatio: getEyebrowRaiseRatio,
    injectGeometryScores: injectGeometryScores,
    applySensitivity: applySensitivity,
  };

  window.AS_Geometry = api;
  window.AS_BrokeAss = api;

  console.log('[geometry] Ready — frown = nasolabial deepen');
})();
