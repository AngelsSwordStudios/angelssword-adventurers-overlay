// ═══════════════════════════════════════════════════
//  BrokeAss VTuber geometry — smile + open mouth
//  Same formulas as tracker.py (landmark ratios, not blendshapes)
//
//  mouth open → surprise   smile corners → smile
//  Sensitivity: min(1, raw * gain) then ×100 for meters
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  /**
   * Mouth open ratio (0–1)
   * upper lip 13, lower lip 14, forehead 10, chin 152
   * Exactly matches BrokeAss tracker.get_mouth_open_ratio()
   */
  function getMouthOpenRatio(landmarks) {
    try {
      const upper = landmarks[13];
      const lower = landmarks[14];
      const mouthH = Math.abs(upper.y - lower.y);
      const faceH = Math.abs(landmarks[10].y - landmarks[152].y);
      return faceH > 0 ? mouthH / faceH : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Smile ratio (0–1)
   * corners 61 & 291 vs mouth centre (13+14)/2
   * Exactly matches BrokeAss tracker.get_smile_ratio()
   * smile_amount * 12.0, clamped to 1.0
   */
  function getSmileRatio(landmarks) {
    try {
      const leftCorner = landmarks[61];
      const rightCorner = landmarks[291];
      const upperLip = landmarks[13];
      const lowerLip = landmarks[14];
      const mouthCenterY = (upperLip.y + lowerLip.y) / 2;
      const cornerY = (leftCorner.y + rightCorner.y) / 2;
      // corners above centre (smaller y) → smile
      const smileAmount = Math.max(0, mouthCenterY - cornerY);
      return Math.min(smileAmount * 12.0, 1.0);
    } catch {
      return 0;
    }
  }

  /**
   * Eyebrow raise (0–1) — same as BrokeAss get_eyebrow_raise_ratio
   * Used for frown/sad optionally later
   */
  function getEyebrowRaiseRatio(landmarks) {
    try {
      const leftBrowY = landmarks[55].y;
      const rightBrowY = landmarks[285].y;
      const browY = (leftBrowY + rightBrowY) / 2;
      const leftEyeTopY = landmarks[159].y;
      const rightEyeTopY = landmarks[386].y;
      const eyeTopY = (leftEyeTopY + rightEyeTopY) / 2;
      const raiseAmount = Math.max(0, eyeTopY - browY);
      return Math.min(raiseAmount * 8.0, 1.0);
    } catch {
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
    const clamp = (v) => {
      const n = parseFloat(v);
      return isFinite(n) ? Math.min(5, Math.max(0.5, n)) : 1;
    };
    return {
      smile: clamp(document.getElementById('gain-smile')?.value),
      surprised: clamp(document.getElementById('gain-surprised')?.value),
      frown: clamp(document.getElementById('gain-frown')?.value),
    };
  }

  /**
   * Apply BrokeAss sensitivity:
   *   display/score = min(1.0, raw * mult) * 100  → 0–100 meter
   * Same as AnimationDebugDialog.update_live_values()
   */
  function applySensitivity(raw01, mult) {
    const m = isFinite(mult) && mult > 0 ? mult : 1;
    return Math.min(100, Math.min(1.0, raw01 * m) * 100);
  }

  /**
   * Inject BrokeAss geometry scores into a blendShape map.
   * landmarks = result.faceLandmarks[0] (array of {x,y,z})
   */
  function injectGeometryScores(blendShapeMap, landmarks) {
    if (!landmarks || !landmarks.length) return blendShapeMap;
    const gains = readGains();

    const rawMouth = getMouthOpenRatio(landmarks);
    const rawSmile = getSmileRatio(landmarks);
    const rawBrow = getEyebrowRaiseRatio(landmarks);

    // Surprise = open mouth (BrokeAss surprise_shock uses mouth_open_ratio)
    blendShapeMap._mouthOpenRatio = applySensitivity(rawMouth, gains.surprised);
    // Smile = mouth corner geometry
    blendShapeMap._smileRatio = applySensitivity(rawSmile, gains.smile);
    // Brow raise available for debug / future frown mapping
    blendShapeMap._browRaiseRatio = applySensitivity(rawBrow, gains.frown);

    // Raw (pre-gain) for calibration/debug
    blendShapeMap._rawMouthOpen = Math.min(100, rawMouth * 100);
    blendShapeMap._rawSmile = Math.min(100, rawSmile * 100);

    return blendShapeMap;
  }

  window.AS_BrokeAss = {
    getMouthOpenRatio,
    getSmileRatio,
    getEyebrowRaiseRatio,
    injectGeometryScores,
    applySensitivity,
  };

  console.log('[brokeass] Geometry helpers ready (smile + open-mouth)');
})();
