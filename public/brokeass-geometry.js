// ═══════════════════════════════════════════════════
//  BrokeAss VTuber geometry — smile / frown / open-mouth
//  Same spirit as tracker.py landmark ratios
//
//  Sensitivity: min(1, raw * mult) * 100  (BrokeAss debug meters)
//  Then stuffs blendshape channels so server composites match.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  /** Mouth open 0–1 — tracker.get_mouth_open_ratio */
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

  /** Smile 0–1 — tracker.get_smile_ratio (corners up ×12) */
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

  /** Eyebrow raise 0–1 — tracker.get_eyebrow_raise_ratio */
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
   * Frown / sad 0–1 — BrokeAss sad_frown uses LOW brow raise.
   * Continuous meter: brow drop toward eyes + mouth corners down
   * (inverse of smile corners).
   */
  function getFrownRatio(landmarks) {
    try {
      // --- Brow drop (opposite of raise) ---
      // When frowning, brows move down (larger y) toward/over the eyes.
      var leftBrowY = landmarks[55].y;
      var rightBrowY = landmarks[285].y;
      var browY = (leftBrowY + rightBrowY) / 2;
      var leftEyeTopY = landmarks[159].y;
      var rightEyeTopY = landmarks[386].y;
      var eyeTopY = (leftEyeTopY + rightEyeTopY) / 2;
      // Positive when brow is level with or below upper eyelid line
      var browDrop = Math.max(0, browY - eyeTopY + 0.025);
      var browFrown = Math.min(browDrop * 14.0, 1.0);

      // --- Mouth corners down (inverse smile) ---
      var leftCorner = landmarks[61];
      var rightCorner = landmarks[291];
      var upperLip = landmarks[13];
      var lowerLip = landmarks[14];
      var mouthCenterY = (upperLip.y + lowerLip.y) / 2;
      var cornerY = (leftCorner.y + rightCorner.y) / 2;
      var cornerDown = Math.max(0, cornerY - mouthCenterY);
      var mouthFrown = Math.min(cornerDown * 12.0, 1.0);

      // Weight brow more (BrokeAss sad is primarily brow-driven)
      return Math.min(1.0, browFrown * 0.55 + mouthFrown * 0.45);
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
    };
  }

  // BrokeAss: min(1.0, raw * mult) then ×100 for meters
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

    var smileScore = applySensitivity(rawSmile, gains.smile);
    var mouthScore = applySensitivity(rawMouth, gains.surprised);
    var frownScore = applySensitivity(rawFrown, gains.frown);

    blendShapeMap._smileRatio = smileScore;
    blendShapeMap._mouthOpenRatio = mouthScore;
    blendShapeMap._frownRatio = frownScore;
    blendShapeMap._rawMouthOpen = Math.min(100, rawMouth * 100);
    blendShapeMap._rawSmile = Math.min(100, rawSmile * 100);
    blendShapeMap._rawFrown = Math.min(100, rawFrown * 100);
    blendShapeMap._geometry = 1;

    // ── Smile channels → composite = smileScore ──
    // smile = 0.45*cheek + 0.35*eyeSquint + 0.20*mouthSmile
    var s = smileScore;
    blendShapeMap.cheekSquintLeft = s;
    blendShapeMap.cheekSquintRight = s;
    blendShapeMap.eyeSquintLeft = s;
    blendShapeMap.eyeSquintRight = s;
    blendShapeMap.mouthSmileLeft = s;
    blendShapeMap.mouthSmileRight = s;

    // ── Surprised (open mouth) → composite ≈ mouthScore ──
    // surprised = 0.35*ew + 0.35*jaw + 0.15*browUp + 0.15*funnel
    // browInner left at 0 → browUp = outer/2 → factor 0.925
    var m = Math.min(100, mouthScore / 0.925);
    blendShapeMap.eyeWideLeft = m;
    blendShapeMap.eyeWideRight = m;
    blendShapeMap.jawOpen = m;
    blendShapeMap.mouthFunnel = m;
    blendShapeMap.browOuterUpLeft = m;
    blendShapeMap.browOuterUpRight = m;

    // ── Frown channels → composite = frownScore ──
    // frown = 0.40*browDown + 0.30*browInnerUp + 0.30*mouthFrown
    var f = frownScore;
    blendShapeMap.browDownLeft = f;
    blendShapeMap.browDownRight = f;
    blendShapeMap.browInnerUp = f;
    blendShapeMap.mouthFrownLeft = f;
    blendShapeMap.mouthFrownRight = f;

    return blendShapeMap;
  }

  window.AS_BrokeAss = {
    getMouthOpenRatio: getMouthOpenRatio,
    getSmileRatio: getSmileRatio,
    getFrownRatio: getFrownRatio,
    getEyebrowRaiseRatio: getEyebrowRaiseRatio,
    injectGeometryScores: injectGeometryScores,
    applySensitivity: applySensitivity,
  };

  console.log('[brokeass] Geometry ready — smile + frown + open-mouth (surprise)');
})();
