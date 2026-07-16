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
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const CAL_KEY = 'neutralCalibration'; // stored inside settings JSON

  // Built-in floors when user has not calibrated yet (0–100 scale)
  const DEFAULT_FLOORS = {
    mouthSmileLeft: 12,
    mouthSmileRight: 12,
    cheekSquintLeft: 14,
    cheekSquintRight: 14,
    eyeSquintLeft: 8,
    eyeSquintRight: 8,
    browDownLeft: 14,
    browDownRight: 14,
    browInnerUp: 12,
    mouthFrownLeft: 12,
    mouthFrownRight: 12,
    eyeWideLeft: 6,
    eyeWideRight: 6,
    jawOpen: 6,
    browOuterUpLeft: 6,
    browOuterUpRight: 6,
    mouthFunnel: 6,
  };

  // Extra headroom so tiny noise above the snapshot still zeros out
  const CALIBRATE_PADDING = 2;

  // Keys we care about for expression composites
  const TRACKED_KEYS = Object.keys(DEFAULT_FLOORS);

  let floors = { ...DEFAULT_FLOORS };
  let lastRawBlendshapes = null; // last pre-deadzone map from webcam
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

  function restoreCalibration() {
    const s = loadSettings();
    const cal = s[CAL_KEY];
    if (cal && cal.floors && typeof cal.floors === 'object') {
      floors = { ...DEFAULT_FLOORS, ...cal.floors };
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

  /**
   * Snapshot current face as neutral baseline.
   * Returns { ok, message, floors }.
   */
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
      // Store resting value + small padding so meter sits at 0 when still
      snapshot[key] = Math.max(0, Math.min(80, v + CALIBRATE_PADDING));
      count++;
    }

    // Also capture any other keys present in the map (future-proof)
    for (const [k, v] of Object.entries(lastRawBlendshapes)) {
      if (snapshot[k] !== undefined) continue;
      const n = Number(v);
      if (!isFinite(n) || n <= 0) continue;
      // Only mild floor for unlisted keys so we don't over-suppress
      if (n > 5) {
        snapshot[k] = Math.min(40, n + CALIBRATE_PADDING);
        count++;
      }
    }

    if (count === 0) {
      return { ok: false, message: 'No usable blendshapes in snapshot' };
    }

    floors = { ...DEFAULT_FLOORS, ...snapshot };
    isCalibrated = true;
    calibratedAt = new Date().toISOString();
    saveSettings({
      [CAL_KEY]: { floors: snapshot, at: calibratedAt },
    });

    console.log('[deadzone] Neutral calibrated from', count, 'shapes @', calibratedAt, snapshot);
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
            // Keep RAW for next calibrate click (before floors)
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

    // Public API for debugging / other scripts
    window.AS_calibrateNeutral = calibrateNeutral;
    window.AS_resetCalibration = resetCalibration;
    window.AS_getDeadzoneFloors = () => ({ ...floors, __calibrated: isCalibrated });

    console.log('[deadzone] Ready (calibrated=' + isCalibrated + ')');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
