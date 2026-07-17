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

  /** Head pitch-down 0–1 from landmarks (0 ≈ level / looking ahead). */
  function getHeadPitchDown01(landmarks) {
    try {
      var leftEye = landmarks[33];
      var rightEye = landmarks[263];
      var eyeMidY = (leftEye.y + rightEye.y) / 2;
      var noseY = landmarks[1].y;
      var chinY = landmarks[152].y;
      var span = chinY - eyeMidY;
      if (!(span > 1e-6)) return 0;
      // Nose position along eye→chin axis (higher when looking down)
      var t = (noseY - eyeMidY) / span;
      // Neutral looking ahead is often ~0.42–0.50
      var down = Math.max(0, t - 0.50);
      return Math.min(1, down * 7);
    } catch (e) {
      return 0;
    }
  }

  /** Head roll (lateral tilt) 0–1 from eye-line angle. */
  function getHeadRoll01(landmarks) {
    try {
      var leftEye = landmarks[33];
      var rightEye = landmarks[263];
      var rollRad = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
      var absRoll = Math.abs(rollRad);
      // Deadzone ~2.5° so small camera/noise tilt is ignored
      var excess = Math.max(0, absRoll - 0.045);
      // ~15° (0.26 rad) → full contribution
      return Math.min(1, excess / 0.26);
    } catch (e) {
      return 0;
    }
  }

  /**
   * Landmark-only frown fallback when blendshapes are missing:
   * inner-brow raise + mouth-corner down + head pitch/roll.
   */
  function getFrownRatioFromLandmarks(landmarks) {
    try {
      var faceH = Math.abs(landmarks[10].y - landmarks[152].y);
      if (!(faceH > 1e-6)) return 0;

      // Inner brow raise (107 / 336) relative to eye tops
      var innerBrowY = (landmarks[107].y + landmarks[336].y) / 2;
      var eyeTopY = (landmarks[159].y + landmarks[386].y) / 2;
      var outerBrowY = (landmarks[70].y + landmarks[300].y) / 2;
      var absRaise = Math.max(0, eyeTopY - innerBrowY);
      var relRaise = Math.max(0, outerBrowY - innerBrowY);
      var brow = Math.min(1, absRaise * 9 * 0.55 + relRaise * 18 * 0.45);

      // Mouth corners down
      var mouthCenterY = (landmarks[13].y + landmarks[14].y) / 2;
      var cornerY = (landmarks[61].y + landmarks[291].y) / 2;
      var cornerDown = Math.max(0, (cornerY - mouthCenterY) / faceH);
      var mouth = Math.min(1, cornerDown * 28);

      var pitch = getHeadPitchDown01(landmarks);
      var roll = getHeadRoll01(landmarks);

      return Math.min(
        1.0,
        brow * 0.32 + mouth * 0.32 + pitch * 0.20 + roll * 0.16
      );
    } catch (e) {
      return 0;
    }
  }

  /**
   * Primary frown:
   *   browInnerUp + mouthFrownL/R + mouthShrugLower
   *   + head pitch (down) + head roll (tilt)
   * Blendshape channels are 0–100; head pose is 0–1 from landmarks.
   */
  function getFrownRatioFromBlendshapes(map, landmarks) {
    if (!map) return null;

    function num(key) {
      var v = Number(map[key]);
      return isFinite(v) ? v : null;
    }

    function avg(a, b) {
      var x = num(a);
      var y = num(b);
      if (x == null && y == null) return null;
      if (x == null) return y;
      if (y == null) return x;
      return (x + y) / 2;
    }

    var browInner = num('browInnerUp');
    var mouthFrown = avg('mouthFrownLeft', 'mouthFrownRight');
    var shrug = num('mouthShrugLower');

    // Need at least one facial channel present
    if (browInner == null && mouthFrown == null && shrug == null) return null;

    if (browInner == null) browInner = 0;
    if (mouthFrown == null) mouthFrown = 0;
    if (shrug == null) shrug = 0;

    // Soft floor kills neutral blendshape noise
    var FLOOR = 4;
    browInner = Math.max(0, browInner - FLOOR);
    mouthFrown = Math.max(0, mouthFrown - FLOOR);
    shrug = Math.max(0, shrug - FLOOR);

    var denom = 100 - FLOOR;
    var face =
      (browInner * 0.34 + mouthFrown * 0.34 + shrug * 0.22) / denom;

    var pitch = landmarks ? getHeadPitchDown01(landmarks) : 0;
    var roll = landmarks ? getHeadRoll01(landmarks) : 0;

    // Face-dominant; head tilt supports sad/concerned posture
    var score = face * 0.78 + pitch * 0.12 + roll * 0.10;
    if (score < 0) score = 0;
    if (score > 1) score = 1;

    // Debug helpers (optional meters / console)
    map._headPitchDown = Math.round(pitch * 100);
    map._headRoll = Math.round(roll * 100);

    return score;
  }

  function getFrownRatio(landmarks, blendShapeMap) {
    var fromBs = getFrownRatioFromBlendshapes(blendShapeMap, landmarks);
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
    getHeadPitchDown01: getHeadPitchDown01,
    getHeadRoll01: getHeadRoll01,
    injectGeometryScores: injectGeometryScores,
    applySensitivity: applySensitivity,
  };

  window.AS_Geometry = api;
  window.AS_BrokeAss = api;

  console.log(
    '[geometry] Ready — frown = browInnerUp + mouthFrown + shrug + pitch/roll'
  );
})();
