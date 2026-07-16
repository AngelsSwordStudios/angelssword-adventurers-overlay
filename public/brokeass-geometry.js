// ═══════════════════════════════════════════════════
//  BrokeAss VTuber geometry — smile + open mouth
//  Same formulas as tracker.py (landmark ratios)
//
//  Sensitivity (gain sliders): min(1, raw * mult) * 100
//  same as BrokeAss AnimationDebugDialog.update_live_values
//
//  Then STUFFS blendshape channels so server composites
//  equal those scores (no server change required).
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

  // BrokeAss: min(1.0, raw * mult) then scale to 0–100 meter
  function applySensitivity(raw01, mult) {
    var m = isFinite(mult) && mult > 0 ? mult : 1;
    return Math.min(100, Math.min(1.0, raw01 * m) * 100);
  }

  function injectGeometryScores(blendShapeMap, landmarks) {
    if (!landmarks || !landmarks.length) return blendShapeMap;
    var gains = readGains();

    var rawMouth = getMouthOpenRatio(landmarks);
    var rawSmile = getSmileRatio(landmarks);
    var rawBrow = getEyebrowRaiseRatio(landmarks);

    var smileScore = applySensitivity(rawSmile, gains.smile);
    var mouthScore = applySensitivity(rawMouth, gains.surprised);

    blendShapeMap._smileRatio = smileScore;
    blendShapeMap._mouthOpenRatio = mouthScore;
    blendShapeMap._browRaiseRatio = applySensitivity(rawBrow, gains.frown);
    blendShapeMap._rawMouthOpen = Math.min(100, rawMouth * 100);
    blendShapeMap._rawSmile = Math.min(100, rawSmile * 100);
    blendShapeMap._geometry = 1; // flag for deadzone: skip re-gain

    // ── Stuff channels so server composites == our scores ──
    // smile = 0.45*cheek + 0.35*eyeSquint + 0.20*mouthSmile
    var s = smileScore;
    blendShapeMap.cheekSquintLeft = s;
    blendShapeMap.cheekSquintRight = s;
    blendShapeMap.eyeSquintLeft = s;
    blendShapeMap.eyeSquintRight = s;
    blendShapeMap.mouthSmileLeft = s;
    blendShapeMap.mouthSmileRight = s;

    // surprised = 0.35*eyeWide + 0.35*jaw + 0.15*browUp + 0.15*funnel
    // browUp = ((outerL+outerR)/2 + browInner)/2 — keep browInner 0 so frown stays clean
    // → browUp = outer/2 → surprised = 0.35m+0.35m+0.15*(m/2)+0.15m = 0.925m
    var m = Math.min(100, mouthScore / 0.925);
    blendShapeMap.eyeWideLeft = m;
    blendShapeMap.eyeWideRight = m;
    blendShapeMap.jawOpen = m;
    blendShapeMap.mouthFunnel = m;
    blendShapeMap.browOuterUpLeft = m;
    blendShapeMap.browOuterUpRight = m;

    return blendShapeMap;
  }

  window.AS_BrokeAss = {
    getMouthOpenRatio: getMouthOpenRatio,
    getSmileRatio: getSmileRatio,
    getEyebrowRaiseRatio: getEyebrowRaiseRatio,
    injectGeometryScores: injectGeometryScores,
    applySensitivity: applySensitivity,
  };

  console.log('[brokeass] Geometry ready — smile corners + open-mouth (tracker.py)');
})();
