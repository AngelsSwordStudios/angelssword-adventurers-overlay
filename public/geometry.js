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
   * Landmark fallback: lower-lip press + chin raise (0 at rest).
   * - Press: lips squeeze (mouth opening shrinks below a soft band)
   * - Chin raise: chin moves up toward lower lip
   */
  function getFrownRatioFromLandmarks(landmarks) {
    try {
      var faceH = Math.abs(landmarks[10].y - landmarks[152].y);
      if (!(faceH > 1e-6)) return 0;

      var upperLipY = landmarks[13].y;
      var lowerLipY = landmarks[14].y;
      // lower lip centre (better for press than 14 alone)
      var lowerCentreY = landmarks[17] ? landmarks[17].y : lowerLipY;
      var chinY = landmarks[152].y;

      // --- Lower lip press: opening smaller than relaxed closed ---
      var openAmt = Math.max(0, (lowerCentreY - upperLipY) / faceH);
      // Typical relaxed closed ~0.015–0.035 of faceH; press goes lower
      var press = Math.max(0, 0.022 - openAmt);
      var pressScore = Math.min(1, press * 55);

      // --- Chin raise: chin–lower-lip gap shrinks ---
      var chinGap = Math.max(0, (chinY - lowerCentreY) / faceH);
      // Neutral gap often ~0.08–0.14; raised chin reduces it
      var chinRaise = Math.max(0, 0.11 - chinGap);
      var chinScore = Math.min(1, chinRaise * 14);

      // Gate: if mouth is clearly open (talking), suppress press/chin false positives
      if (openAmt > 0.05) {
        pressScore *= 0.15;
        chinScore *= 0.35;
      }

      return Math.min(1.0, pressScore * 0.55 + chinScore * 0.45);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Preferred: MediaPipe blendshapes for lip press + chin/lower shrug.
   * Values in blendShapeMap are already 0–100; near 0 at rest.
   */
  function getFrownRatioFromBlendshapes(map) {
    if (!map) return null;

    function avg(a, b) {
      var x = Number(map[a]);
      var y = Number(map[b]);
      var n = 0;
      var s = 0;
      if (isFinite(x)) {
        s += x;
        n++;
      }
      if (isFinite(y)) {
        s += y;
        n++;
      }
      return n ? s / n : null;
    }

    var press = avg('mouthPressLeft', 'mouthPressRight');
    var shrug = Number(map.mouthShrugLower);
    if (!isFinite(shrug)) shrug = null;

    // Optional extra chin-ish cue if present
    var jawFwd = Number(map.jawForward);
    if (!isFinite(jawFwd)) jawFwd = 0;

    if (press == null && shrug == null) return null;
    if (press == null) press = 0;
    if (shrug == null) shrug = 0;

    var FLOOR = 3;
    press = Math.max(0, press - FLOOR);
    shrug = Math.max(0, shrug - FLOOR);
    jawFwd = Math.max(0, jawFwd - FLOOR);

    // Weight press + lower shrug; tiny jawForward assist
    var score =
      (press * 0.55 + shrug * 0.40 + jawFwd * 0.05) / (100 - FLOOR);
    if (score < 0) score = 0;
    if (score > 1) score = 1;
    return score;
  }

  function getFrownRatio(landmarks, blendShapeMap) {
    var fromBs = getFrownRatioFromBlendshapes(blendShapeMap);
    if (fromBs != null) return fromBs;
    return getFrownRatioFromLandmarks(landmarks);
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
    var rawFrown = getFrownRatio(landmarks, blendShapeMap);
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

  console.log('[geometry] Ready — frown = lower lip press / chin raise');
})();
