// ═══════════════════════════════════════════════════
//  AS Adventurer — Webcam neutral deadzone + calibration
//
//  One "Calibrate Neutral" click baselines ALL three
//  expression groups used by the meters:
//    😊 Smile  ·  😢 Frown  ·  😮 Surprised
//
//  We average several raw frames, set per-key floors,
//  subtract them on every webcam_tracking message
//  (before server gain), and persist to localStorage.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const CAL_KEY = 'neutralCalibration';

  // ── Expression key groups (MediaPipe camelCase 0–100) ──
  const SMILE_KEYS = [
    'mouthSmileLeft', 'mouthSmileRight',
    'cheekSquintLeft', 'cheekSquintRight',
    'eyeSquintLeft', 'eyeSquintRight',
  ];
  const FROWN_KEYS = [
    'browDownLeft', 'browDownRight',
    'browInnerUp',
    'mouthFrownLeft', 'mouthFrownRight',
  ];
  const SURPRISED_KEYS = [
    'eyeWideLeft', 'eyeWideRight',
    'jawOpen',
    'browOuterUpLeft', 'browOuterUpRight',
    'mouthFunnel',
    // browInnerUp also used in surprised composite on server
  ];

  const FROWN_KEY_SET = new Set(FROWN_KEYS);
  const SMILE_KEY_SET = new Set(SMILE_KEYS);
  const SURPRISED_KEY_SET = new Set(SURPRISED_KEYS);

  // All keys we ever floor / calibrate
  const ALL_KEYS = [...new Set([...SMILE_KEYS, ...FROWN_KEYS, ...SURPRISED_KEYS])];

  // Built-in floors when user has not calibrated yet
  const DEFAULT_FLOORS = {
    // Smile
    mouthSmileLeft: 12,
    mouthSmileRight: 12,
    cheekSquintLeft: 14,
    cheekSquintRight: 14,
    eyeSquintLeft: 8,
    eyeSquintRight: 8,
    // Frown (low — MediaPipe sad range is weak)
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

  // Hard caps so a bad snapshot never permanently kills an expression
  const MAX_FLOOR = {
    mouthSmileLeft: 22, mouthSmileRight: 22,
    cheekSquintLeft: 22, cheekSquintRight: 22,
    eyeSquintLeft: 16, eyeSquintRight: 16,
    browDownLeft: 10, browDownRight: 10,
    browInnerUp: 8,
    mouthFrownLeft: 8, mouthFrownRight: 8,
    eyeWideLeft: 12, eyeWideRight: 12,
    jawOpen: 12,
    browOuterUpLeft: 12, browOuterUpRight: 12,
    mouthFunnel: 12,
  };

  const PADDING = {
    smile: 2,
    frown: 1,
    surprised: 1,
  };

  // After floor: boost residual so weak MediaPipe ranges can fill meters
  const BOOST = {
    smile: 1.0,
    frown: 1.85,
    surprised: 1.35,
  };

  // Multi-frame sample for stable calibration
  const SAMPLE_FRAMES = 12;
  const SAMPLE_MS = 450;
  const HISTORY_MAX = 30;

  let floors = { ...DEFAULT_FLOORS };
  let lastRawBlendshapes = null;
  let rawHistory = []; // ring of recent raw maps
  let isCalibrated = false;
  let calibratedAt = null;
  let calibrating = false;

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

  function groupOf(key) {
    if (SMILE_KEY_SET.has(key)) return 'smile';
    if (FROWN_KEY_SET.has(key)) return 'frown';
    if (SURPRISED_KEY_SET.has(key)) return 'surprised';
    return 'other';
  }

  function clampFloor(key, value) {
    const max = MAX_FLOOR[key] != null ? MAX_FLOOR[key] : 15;
    return Math.max(0, Math.min(max, value));
  }

  function restoreCalibration() {
    const s = loadSettings();
    const cal = s[CAL_KEY];
    if (cal && cal.floors && typeof cal.floors === 'object') {
      const fixed = {};
      for (const [k, v] of Object.entries(cal.floors)) {
        fixed[k] = clampFloor(k, Number(v) || 0);
      }
      // Ensure every expression group key exists (merge defaults for missing)
      floors = { ...DEFAULT_FLOORS, ...fixed };
      for (const k of ALL_KEYS) {
        if (floors[k] === undefined) floors[k] = DEFAULT_FLOORS[k] || 0;
      }
      isCalibrated = true;
      calibratedAt = cal.at || null;
      console.log('[deadzone] Restored calibration (smile+frown+surprised) from', calibratedAt || 'storage');
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

    // Apply floors for every calibrated / default key
    for (const [k, floor] of Object.entries(floors)) {
      if (out[k] === undefined) continue;
      let v = Math.max(0, Number(out[k]) - floor);
      const g = groupOf(k);
      const boost = BOOST[g] || 1;
      if (boost !== 1 && v > 0) {
        v = Math.min(100, v * boost);
      }
      out[k] = v;
    }
    return out;
  }

  function pushHistory(map) {
    rawHistory.push({ ...map });
    if (rawHistory.length > HISTORY_MAX) rawHistory.shift();
  }

  /** Average recent raw frames for stable baselines */
  function averageRecent(frames) {
    const slice = rawHistory.slice(-frames);
    if (slice.length === 0 && lastRawBlendshapes) slice.push(lastRawBlendshapes);
    if (slice.length === 0) return null;

    const sums = {};
    const counts = {};
    for (const frame of slice) {
      for (const k of ALL_KEYS) {
        const v = Number(frame[k]);
        if (!isFinite(v)) continue;
        sums[k] = (sums[k] || 0) + v;
        counts[k] = (counts[k] || 0) + 1;
      }
      // Also pick up any extra keys present
      for (const [k, v] of Object.entries(frame)) {
        if (sums[k] !== undefined) continue;
        const n = Number(v);
        if (!isFinite(n)) continue;
        sums[k] = (sums[k] || 0) + n;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    const avg = {};
    for (const k of Object.keys(sums)) {
      avg[k] = sums[k] / counts[k];
    }
    return avg;
  }

  function buildSnapshotFromAverage(avg) {
    const snapshot = {};
    let smileN = 0, frownN = 0, surprisedN = 0;

    for (const key of ALL_KEYS) {
      const v = Number(avg[key]);
      if (!isFinite(v)) {
        // Still set a minimal floor from defaults so group is covered
        snapshot[key] = DEFAULT_FLOORS[key] || 0;
        continue;
      }
      const g = groupOf(key);
      const pad = PADDING[g] != null ? PADDING[g] : 1;
      const rawFloor = v > 0.5 ? v + pad : pad * 0.5;
      snapshot[key] = clampFloor(key, rawFloor);

      if (g === 'smile') smileN++;
      else if (g === 'frown') frownN++;
      else if (g === 'surprised') surprisedN++;
    }

    return { snapshot, smileN, frownN, surprisedN };
  }

  /**
   * Multi-frame calibrate for Smile + Frown + Surprised.
   * Returns a Promise-like result via callback path (sync after short wait).
   */
  function calibrateNeutral(done) {
    if (calibrating) {
      const r = { ok: false, message: 'Calibration already in progress' };
      if (done) done(r);
      return r;
    }

    if ((!lastRawBlendshapes || Object.keys(lastRawBlendshapes).length === 0) && rawHistory.length === 0) {
      const r = {
        ok: false,
        message: 'No face data yet — start webcam and face the camera first',
      };
      if (done) done(r);
      return r;
    }

    calibrating = true;
    updateCalibUI();

    // Prefer averaging frames we already have; if few, wait briefly for more
    const need = SAMPLE_FRAMES;
    const startLen = rawHistory.length;

    const finish = () => {
      const avg = averageRecent(Math.max(need, rawHistory.length));
      calibrating = false;

      if (!avg) {
        const r = { ok: false, message: 'No usable blendshapes in snapshot' };
        updateCalibUI();
        if (done) done(r);
        return r;
      }

      const { snapshot, smileN, frownN, surprisedN } = buildSnapshotFromAverage(avg);

      // Merge: defaults first so every group key always present, then snapshot
      floors = { ...DEFAULT_FLOORS, ...snapshot };
      isCalibrated = true;
      calibratedAt = new Date().toISOString();
      saveSettings({
        [CAL_KEY]: {
          floors: snapshot,
          at: calibratedAt,
          version: 4,
          groups: { smile: smileN, frown: frownN, surprised: surprisedN },
        },
      });

      console.log(
        '[deadzone] Calibrated Neutral v4 — smile keys:', smileN,
        'frown keys:', frownN,
        'surprised keys:', surprisedN,
        '@', calibratedAt,
        snapshot
      );

      updateCalibUI();
      const r = {
        ok: true,
        message: 'Calibrated Smile · Frown · Surprised',
        floors: snapshot,
        groups: { smile: smileN, frown: frownN, surprised: surprisedN },
      };
      if (done) done(r);
      return r;
    };

    // If we already have enough history, finish immediately
    if (rawHistory.length >= Math.min(6, need)) {
      return finish();
    }

    // Otherwise wait a short window for more frames
    setTimeout(finish, SAMPLE_MS);
    return { ok: true, message: 'Sampling neutral face…', pending: true };
  }

  function resetCalibration() {
    floors = { ...DEFAULT_FLOORS };
    isCalibrated = false;
    calibratedAt = null;
    const s = loadSettings();
    delete s[CAL_KEY];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    console.log('[deadzone] Calibration reset to defaults (all groups)');
    updateCalibUI();
    return { ok: true, message: 'Calibration cleared' };
  }

  function updateCalibUI() {
    const statusEl = document.getElementById('calib-status');
    const btnCal = document.getElementById('btn-calibrate-neutral');
    const btnReset = document.getElementById('btn-reset-calibration');

    if (statusEl) {
      if (calibrating) {
        statusEl.textContent = 'Sampling… hold neutral';
        statusEl.classList.remove('calib-ok', 'calib-default');
      } else if (isCalibrated) {
        const when = calibratedAt
          ? new Date(calibratedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        statusEl.textContent = when
          ? `Calibrated ✓ Smile · Frown · Surprised (${when})`
          : 'Calibrated ✓ Smile · Frown · Surprised';
        statusEl.classList.add('calib-ok');
        statusEl.classList.remove('calib-default');
      } else {
        statusEl.textContent = 'Using default floors (all expressions)';
        statusEl.classList.add('calib-default');
        statusEl.classList.remove('calib-ok');
      }
    }

    if (btnReset) {
      btnReset.style.display = isCalibrated ? '' : 'none';
    }

    if (btnCal) {
      btnCal.classList.toggle('calibrated', isCalibrated);
      btnCal.disabled = calibrating;
    }
  }

  function flashButton(btn, ok, msg) {
    if (!btn) return;
    const prev = btn.dataset.label || btn.textContent;
    btn.dataset.label = prev.includes('Calibrate') ? prev : (btn.dataset.label || '📷 Calibrate Neutral');
    const base = btn.dataset.label;
    btn.textContent = ok ? '✓ ' + (msg || 'Done') : '✗ ' + (msg || 'Failed');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = base;
      btn.disabled = calibrating;
    }, 2000);
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
            pushHistory(lastRawBlendshapes);
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

  function initUI() {
    restoreCalibration();

    const btnCal = document.getElementById('btn-calibrate-neutral');
    const btnReset = document.getElementById('btn-reset-calibration');

    if (btnCal) {
      btnCal.dataset.label = btnCal.textContent;
      btnCal.addEventListener('click', (e) => {
        e.preventDefault();
        const immediate = calibrateNeutral((result) => {
          flashButton(btnCal, result.ok, result.ok ? 'All set!' : 'No data');
          if (!result.ok && result.message) console.warn('[deadzone]', result.message);
        });
        // If multi-frame pending, show sampling state on button
        if (immediate && immediate.pending) {
          btnCal.textContent = 'Sampling…';
          btnCal.disabled = true;
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

    window.AS_calibrateNeutral = () =>
      new Promise((resolve) => {
        const r = calibrateNeutral(resolve);
        if (r && !r.pending) resolve(r);
      });
    window.AS_resetCalibration = resetCalibration;
    window.AS_getDeadzoneFloors = () => ({
      ...floors,
      __calibrated: isCalibrated,
      __groups: {
        smile: SMILE_KEYS,
        frown: FROWN_KEYS,
        surprised: SURPRISED_KEYS,
      },
    });

    console.log('[deadzone] Ready — calibrate links Smile + Frown + Surprised');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
