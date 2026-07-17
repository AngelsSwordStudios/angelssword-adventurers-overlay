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
   * Frown / sad 0–1
   * Primary: inner-brow raise (concerned / sad brows)
   * Secondary: slight mouth-corner down
   * (no pure brow-drop)
   */
  function getFrownRatio(landmarks) {
    try {
      // --- Inner brow raise (landmarks 107 / 336) ---
      // y increases downward; raised brow → smaller y → larger (eyeTop - brow)
      var leftInnerY = landmarks[107].y;
      var rightInnerY = landmarks[336].y;
      var innerBrowY = (leftInnerY + rightInnerY) / 2;
      var eyeTopY = (landmarks[159].y + landmarks[386].y) / 2;
      var absoluteInnerRaise = Math.max(0, eyeTopY - innerBrowY);

      // Prefer inner raised relative to outer brow (classic sad AU1 shape)
      var leftOuterY = landmarks[70].y;
      var rightOuterY = landmarks[300].y;
      var outerBrowY = (leftOuterY + rightOuterY) / 2;
      // When inner is higher than outer, outerY - innerY > 0
      var relativeInnerUp = Math.max(0, outerBrowY - innerBrowY);

      // Blend absolute + relative so neutral faces stay low
      var innerBrow = Math.min(
        1.0,
        absoluteInnerRaise * 9.0 * 0.55 + relativeInnerUp * 18.0 * 0.45
      );

      // --- Slight mouth corner down (inverse smile) ---
      var leftCorner = landmarks[61];
      var rightCorner = landmarks[291];
      var upperLip = landmarks[13];
      var lowerLip = landmarks[14];
      var mouthCenterY = (upperLip.y + lowerLip.y) / 2;
      var cornerY = (leftCorner.y + rightCorner.y) / 2;
      var cornerDown = Math.max(0, cornerY - mouthCenterY);
      // Softer scale than smile so mouth is only a slight contribution
      var mouthFrown = Math.min(cornerDown * 10.0, 1.0);

      // ~70% inner brow · ~30% mouth corners
      return Math.min(1.0, innerBrow * 0.70 + mouthFrown * 0.30);
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

    // Frown channels still stuffed so server composite = frownScore
    // (gain already applied above — same path as other emotions)
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

  console.log('[geometry] Ready — frown = inner-brow raise + slight mouth-corner down');
})();
