// ═══════════════════════════════════════════════════
//  AS Adventurer — Webcam neutral deadzone + calibration
//
//  MediaPipe returns small non-zero blendshapes on a
//  relaxed face. Gain multiplies that bias (e.g. 13×3.8≈50).
//
//  Default: fixed floors for smile/frown/surprised.
//  Better: click "Calibrate Neutral" while holding a
//  relaxed face — we snapshot current blendshapes and
//  use those as your personal baseline (saved in localStorage).
//
//  NOTE: Frown signals from MediaPipe are weaker than smile
//  (mouthFrown / browDown often only reach ~15–30 when sad).
//  Floors for frown keys are kept lower so real frowns still
//  survive deadzone + gain.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const CAL_KEY = 'neutralCalibration';

  // Built-in floors when user has not calibrated yet (0–100 scale).
  // Smile floors stay higher (resting smile bias is common).
  // Frown floors stay LOW — MediaPipe sad shapes rarely go high.
  const DEFAULT_FLOORS = {
    // Smile (strong resting bias on many faces)
    mouthSmileLeft: 12,
    mouthSmileRight: 12,
    cheekSquintLeft: 14,
    cheekSquintRight: 14,
    eyeSquintLeft: 8,
    eyeSquintRight: 8,
    // Frown — KEEP LOW so real frowns still register
    browDownLeft: 5,
    browDownRight: 5,
    browInnerUp: 4,
    mouthFrownLeft: 4,
    mouthFrownRight: 4,
    // Surprised
    eyeWideLeft: 5,
    eyeWideRight: 5,
    jawOpen: 5,
    browOuterUpLeft: 5,
    browOuterUpRight: 5,
    mouthFunnel: 5,
  };

  // Max floor we ever allow from calibration (prevents a bad snapshot
  // or high resting brow from permanently killing frown/smile).
  const MAX_FLOOR = {
    mouthSmileLeft: 22,
    mouthSmileRight: 22,
    cheekSquintLeft: 22,
    cheekSquintRight: 22,
    eyeSquintLeft: 16,
    eyeSquintRight: 16,
    // Frown hard-capped lower
    browDownLeft: 10,
    browDownRight: 10,
    browInnerUp: 8,
    mouthFrownLeft: 8,
    mouthFrownRight: 8,
    eyeWideLeft: 12,
    eyeWideRight: 12,
    jawOpen: 12,
    browOuterUpLeft: 12,
    browOuterUpRight: 12,
    mouthFunnel: 12,
  };

  const FROWN_KEYS = new Set([
    'browDownLeft', 'browDownRight', 'browInnerUp',
    'mouthFrownLeft', 'mouthFrownRight',
  ]);

  // Extra headroom only for smile-like resting noise
  const CALIBRATE_PADDING_SMILE = 2;
  const CALIBRATE_PADDING_FROWN = 1;
  const CALIBRATE_PADDING_OTHER = 1;

  const TRACKED_KEYS = Object.keys(DEFAULT_FLOORS);

  let floors = { ...DEFAULT_FLOORS };
  let lastRawBlendshapes = null;
  let isCalibrated = false;
  let calibratedAt = null;

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSettings(updates) {
    const s = loadSettings();
    Object.assign(s, updates);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  function clampFloor(key, value) {
    const max = MAX_FLOOR[key] != null ? MAX_FLOOR[key] : 15;
    return Math.max(0, Math.min(max, value));
  }

  function restoreCalibration() {
    const s = loadSettings();
    const cal = s[CAL_KEY];
    if (cal && cal.floors && typeof cal.floors === 'object') {
      // Re-clamp stored floors (older calibrations may have had high frown floors)
      const fixed = {};
      for (const [k, v] of Object.entries(cal.floors)) {
        fixed[k] = clampFloor(k, Number(v) || 0);
      }
      floors = { ...DEFAULT_FLOORS, ...fixed };
      isCalibrated = true;
      calibratedAt = cal.at || null;
      console.log('[deadzone] Restored neutral calibration from', calibratedAt || 'storage');
    } else {
      floors = { ...DEFAULT_FLOORS };
      isCalibrated = false;
      calibratedAt = null;
    }
    updateCalibUI();
  }

  function applyDeadzone(map) {
    if (!map || typeof map !== 'object') return map;
    const out = { ...map };
    for (const [k, floor] of Object.entries(floors)) {
      if (out[k] !== undefined) {
        out[k] = Math.max(0, Number(out[k]) - floor);
      }
    }
    return out;
  }

  function calibrateNeutral() {
    if (!lastRawBlendshapes || Object.keys(lastRawBlendshapes).length === 0) {
      return {
        ok: false,
        message: 'No face data yet — start webcam and face the camera first',
      };
    }

    const snapshot = {};
    let count = 0;

    for (const key of TRACKED_KEYS) {
      const v = Number(lastRawBlendshapes[key]);
      if (!isFinite(v)) continue;

      let pad = CALIBRATE_PADDING_OTHER;
      if (FROWN_KEYS.has(key)) pad = CALIBRATE_PADDING_FROWN;
      else if (key.indexOf('Smile') !== -1 || key.indexOf('Squint') !== -1 || key.indexOf('cheek') !== -1) {
        pad = CALIBRATE_PADDING_SMILE;
      }

      // Only floor what's actually elevated at rest (ignore pure zeros)
      // Still store a small floor so tiny noise stays quiet
      const rawFloor = v > 0.5 ? v + pad : pad * 0.5;
      snapshot[key] = clampFloor(key, rawFloor);
      count++;
    }

    if (count === 0) {
      return { ok: false, message: 'No usable blendshapes in snapshot' };
    }

    floors = { ...DEFAULT_FLOORS, ...snapshot };
    isCalibrated = true;
    calibratedAt = new Date().toISOString();
    saveSettings({
      [CAL_KEY]: { floors: snapshot, at: calibratedAt, version: 2 },
    });

    console.log('[deadzone] Neutral calibrated (v2) from', count, 'shapes @', calibratedAt, snapshot);
    updateCalibUI();
    return {
      ok: true,
      message: 'Neutral calibrated — meters should sit near 0 now',
      floors: snapshot,
    };
  }

  function resetCalibration() {
    floors = { ...DEFAULT_FLOORS };
    isCalibrated = false;
    calibratedAt = null;
    const s = loadSettings();
    delete s[CAL_KEY];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    console.log('[deadzone] Calibration reset to defaults');
    updateCalibUI();
    return { ok: true, message: 'Calibration cleared — using default floors' };
  }

  function updateCalibUI() {
    const statusEl = document.getElementById('calib-status');
    const btnCal = document.getElementById('btn-calibrate-neutral');
    const btnReset = document.getElementById('btn-reset-calibration');

    if (statusEl) {
      if (isCalibrated) {
        const when = calibratedAt
          ? new Date(calibratedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        statusEl.textContent = when ? `Calibrated ✓ (${when})` : 'Calibrated ✓';
        statusEl.classList.add('calib-ok');
        statusEl.classList.remove('calib-default');
      } else {
        statusEl.textContent = 'Using default floors';
        statusEl.classList.add('calib-default');
        statusEl.classList.remove('calib-ok');
      }
    }

    if (btnReset) {
      btnReset.style.display = isCalibrated ? '' : 'none';
    }

    if (btnCal) {
      btnCal.classList.toggle('calibrated', isCalibrated);
    }
  }

  function flashButton(btn, ok, msg) {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = ok ? '✓ ' + (msg || 'Done') : '✗ ' + (msg || 'Failed');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = prev;
      btn.disabled = false;
    }, 1800);
  }

  // ── Patch WebSocket.send ─────────────────────────
  const proto = window.WebSocket && window.WebSocket.prototype;
  if (proto && !proto.__asDeadzonePatched) {
    const origSend = proto.send;
    proto.send = function (data) {
      try {
        if (typeof data === 'string' && data.indexOf('webcam_tracking') !== -1) {
          const msg = JSON.parse(data);
          if (msg.type === 'webcam_tracking' && msg.blendShapes) {
            lastRawBlendshapes = { ...msg.blendShapes };
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
  }

  // ── Wire UI ──────────────────────────────────────
  function initUI() {
    restoreCalibration();

    const btnCal = document.getElementById('btn-calibrate-neutral');
    const btnReset = document.getElementById('btn-reset-calibration');

    if (btnCal) {
      btnCal.addEventListener('click', (e) => {
        e.preventDefault();
        const result = calibrateNeutral();
        flashButton(btnCal, result.ok, result.ok ? 'Calibrated!' : 'No data');
        if (!result.ok && result.message) {
          console.warn('[deadzone]', result.message);
        }
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', (e) => {
        e.preventDefault();
        resetCalibration();
        flashButton(btnReset, true, 'Reset');
      });
    }

    window.AS_calibrateNeutral = calibrateNeutral;
    window.AS_resetCalibration = resetCalibration;
    window.AS_getDeadzoneFloors = () => ({ ...floors, __calibrated: isCalibrated });

    console.log('[deadzone] Ready (calibrated=' + isCalibrated + ', frown-friendly floors)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
