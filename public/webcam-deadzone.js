// ═══════════════════════════════════════════════════
//  AS Adventurer — Webcam neutral deadzone + calibration
//
//  Calibrate Neutral baselines Smile + Frown + Surprised.
//
//  Fix (frown stuck ~20–30):
//  MediaPipe often reports high resting browInnerUp/browDown.
//  Old code capped frown floors at ~8, so residual never
//  zeroed and boost locked the meter mid-range. Floors can
//  now track true resting values; boost only applies to
//  meaningful residual above the floor.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const CAL_KEY = 'neutralCalibration';

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
  ];

  const FROWN_KEY_SET = new Set(FROWN_KEYS);
  const SMILE_KEY_SET = new Set(SMILE_KEYS);
  const SURPRISED_KEY_SET = new Set(SURPRISED_KEYS);
  const ALL_KEYS = [...new Set([...SMILE_KEYS, ...FROWN_KEYS, ...SURPRISED_KEYS])];

  // Defaults used only when user has NOT calibrated.
  // Frown defaults stay moderate — real zeroing needs Calibrate.
  const DEFAULT_FLOORS = {
    mouthSmileLeft: 12,
    mouthSmileRight: 12,
    cheekSquintLeft: 14,
    cheekSquintRight: 14,
    eyeSquintLeft: 8,
    eyeSquintRight: 8,
    browDownLeft: 8,
    browDownRight: 8,
    browInnerUp: 10, // often elevated at rest on MediaPipe
    mouthFrownLeft: 6,
    mouthFrownRight: 6,
    eyeWideLeft: 5,
    eyeWideRight: 5,
    jawOpen: 5,
    browOuterUpLeft: 5,
    browOuterUpRight: 5,
    mouthFunnel: 5,
  };

  // Allow calibration to track true resting values (was 8–10 — too low!)
  const MAX_FLOOR = {
    mouthSmileLeft: 40, mouthSmileRight: 40,
    cheekSquintLeft: 40, cheekSquintRight: 40,
    eyeSquintLeft: 30, eyeSquintRight: 30,
    browDownLeft: 45, browDownRight: 45,
    browInnerUp: 45,
    mouthFrownLeft: 35, mouthFrownRight: 35,
    eyeWideLeft: 30, eyeWideRight: 30,
    jawOpen: 30,
    browOuterUpLeft: 30, browOuterUpRight: 30,
    mouthFunnel: 30,
  };

  const PADDING = { smile: 2.5, frown: 2.5, surprised: 2, other: 1.5 };

  // Only boost residual that is clearly above noise (after floor).
  // When calibrated, mild boost; when not, slightly stronger for frown.
  const BOOST_ABOVE = 4; // don't boost residual ≤ this
  const BOOST = { smile: 1.0, frown: 1.45, surprised: 1.25, other: 1.0 };

  const SAMPLE_FRAMES = 15;
  const SAMPLE_MS = 500;
  const HISTORY_MAX = 40;

  let floors = { ...DEFAULT_FLOORS };
  let lastRawBlendshapes = null;
  let rawHistory = [];
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
    const max = MAX_FLOOR[key] != null ? MAX_FLOOR[key] : 40;
    return Math.max(0, Math.min(max, value));
  }

  function restoreCalibration() {
    const s = loadSettings();
    const cal = s[CAL_KEY];
    // v5+ only — drop old calibrations that used broken low max floors
    if (cal && cal.floors && typeof cal.floors === 'object' && (cal.version || 0) >= 5) {
      const fixed = {};
      for (const [k, v] of Object.entries(cal.floors)) {
        fixed[k] = clampFloor(k, Number(v) || 0);
      }
      floors = { ...DEFAULT_FLOORS, ...fixed };
      for (const k of ALL_KEYS) {
        if (floors[k] === undefined) floors[k] = DEFAULT_FLOORS[k] || 0;
      }
      isCalibrated = true;
      calibratedAt = cal.at || null;
      console.log('[deadzone] Restored v' + cal.version + ' calibration', calibratedAt, floors);
    } else {
      // Invalidate stale calibrations from broken floor-cap era
      if (cal) {
        delete s[CAL_KEY];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        console.log('[deadzone] Cleared outdated calibration (re-calibrate for frown fix)');
      }
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
      if (out[k] === undefined) continue;
      let v = Math.max(0, Number(out[k]) - floor);

      // Boost only meaningful residual (not the stuck mid-band noise)
      const g = groupOf(k);
      const boost = BOOST[g] || 1;
      if (boost > 1 && v > BOOST_ABOVE) {
        // Scale only the part above noise floor
        v = BOOST_ABOVE + (v - BOOST_ABOVE) * boost;
        v = Math.min(100, v);
      }
      out[k] = v;
    }
    return out;
  }

  function pushHistory(map) {
    rawHistory.push({ ...map });
    if (rawHistory.length > HISTORY_MAX) rawHistory.shift();
  }

  function averageRecent(frames) {
    const slice = rawHistory.slice(-frames);
    if (slice.length === 0 && lastRawBlendshapes) slice.push(lastRawBlendshapes);
    if (slice.length === 0) return null;

    const sums = {};
    const counts = {};
    for (const frame of slice) {
      for (const [k, raw] of Object.entries(frame)) {
        const v = Number(raw);
        if (!isFinite(v)) continue;
        sums[k] = (sums[k] || 0) + v;
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
    const debug = { smile: {}, frown: {}, surprised: {} };

    // Always cover ALL expression keys
    for (const key of ALL_KEYS) {
      const v = Number(avg[key]);
      const g = groupOf(key);
      const pad = PADDING[g] != null ? PADDING[g] : PADDING.other;

      let floorVal;
      if (isFinite(v)) {
        // Floor = resting average + padding (this is what zeros the meter)
        floorVal = clampFloor(key, Math.max(0, v) + pad);
      } else {
        floorVal = DEFAULT_FLOORS[key] || 0;
      }
      snapshot[key] = floorVal;

      if (g === 'smile') {
        smileN++;
        debug.smile[key] = { raw: isFinite(v) ? +v.toFixed(1) : null, floor: +floorVal.toFixed(1) };
      } else if (g === 'frown') {
        frownN++;
        debug.frown[key] = { raw: isFinite(v) ? +v.toFixed(1) : null, floor: +floorVal.toFixed(1) };
      } else if (g === 'surprised') {
        surprisedN++;
        debug.surprised[key] = { raw: isFinite(v) ? +v.toFixed(1) : null, floor: +floorVal.toFixed(1) };
      }
    }

    // Also floor any other elevated keys present in the average
    for (const [k, v] of Object.entries(avg)) {
      if (snapshot[k] !== undefined) continue;
      const n = Number(v);
      if (!isFinite(n) || n < 3) continue;
      snapshot[k] = clampFloor(k, n + PADDING.other);
    }

    return { snapshot, smileN, frownN, surprisedN, debug };
  }

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

    const finish = () => {
      const avg = averageRecent(Math.max(SAMPLE_FRAMES, rawHistory.length));
      calibrating = false;

      if (!avg) {
        const r = { ok: false, message: 'No usable blendshapes in snapshot' };
        updateCalibUI();
        if (done) done(r);
        return r;
      }

      const { snapshot, smileN, frownN, surprisedN, debug } = buildSnapshotFromAverage(avg);

      floors = { ...DEFAULT_FLOORS, ...snapshot };
      isCalibrated = true;
      calibratedAt = new Date().toISOString();
      saveSettings({
        [CAL_KEY]: {
          floors: snapshot,
          at: calibratedAt,
          version: 5,
          groups: { smile: smileN, frown: frownN, surprised: surprisedN },
        },
      });

      console.log('[deadzone] Calibrated Neutral v5 — Smile/Frown/Surprised');
      console.log('[deadzone] Frown floors (should match your resting face):', debug.frown);
      console.log('[deadzone] Smile floors:', debug.smile);
      console.log('[deadzone] Surprised floors:', debug.surprised);

      updateCalibUI();
      const r = {
        ok: true,
        message: 'Calibrated Smile · Frown · Surprised',
        floors: snapshot,
        debug,
      };
      if (done) done(r);
      return r;
    };

    if (rawHistory.length >= 8) {
      return finish();
    }

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
    console.log('[deadzone] Calibration reset');
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
        statusEl.textContent = 'Using default floors — click Calibrate';
        statusEl.classList.add('calib-default');
        statusEl.classList.remove('calib-ok');
      }
    }

    if (btnReset) btnReset.style.display = isCalibrated ? '' : 'none';
    if (btnCal) {
      btnCal.classList.toggle('calibrated', isCalibrated);
      btnCal.disabled = calibrating;
    }
  }

  function flashButton(btn, ok, msg) {
    if (!btn) return;
    const base = btn.dataset.label || '📷 Calibrate Neutral';
    btn.dataset.label = base.includes('Calibrate') ? base : '📷 Calibrate Neutral';
    btn.textContent = ok ? '✓ ' + (msg || 'Done') : '✗ ' + (msg || 'Failed');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = btn.dataset.label;
      btn.disabled = calibrating;
    }, 2000);
  }

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
      } catch (e) { /* pass */ }
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
      __lastRaw: lastRawBlendshapes,
    });

    console.log('[deadzone] Ready v5 — frown floor caps raised; re-calibrate required');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
