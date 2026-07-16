// ═══════════════════════════════════════════════════
//  AS Adventurer — Optional calibrate + client gain
//
//  DEFAULT: MediaPipe passthrough (no floors).
//  Gain sliders amplify blendshapes before they hit the
//  server — so BOTH entering an expression AND returning
//  to neutral scale with the same gain (live scores).
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
    'browDownLeft', 'browDownRight', 'browInnerUp',
    'mouthFrownLeft', 'mouthFrownRight',
  ];
  const SURPRISED_KEYS = [
    'eyeWideLeft', 'eyeWideRight', 'jawOpen',
    'browOuterUpLeft', 'browOuterUpRight', 'mouthFunnel',
  ];
  const ALL_KEYS = [...new Set([...SMILE_KEYS, ...FROWN_KEYS, ...SURPRISED_KEYS])];

  const SMILE_SET = new Set(SMILE_KEYS);
  const FROWN_SET = new Set(FROWN_KEYS);
  const SURPRISED_SET = new Set(SURPRISED_KEYS);

  // MediaPipe default = zero floors
  const DEFAULT_FLOORS = Object.fromEntries(ALL_KEYS.map((k) => [k, 0]));
  const MAX_FLOOR = 50;
  const PAD = 2;

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

  function readGains() {
    const s = loadSettings();
    const g = s.gains || {};
    const t = s.thresholds || {};
    const clamp = (v) => {
      const n = Number(v);
      if (!isFinite(n)) return 1.0;
      return Math.min(6, Math.max(0.5, n));
    };
    return {
      smile: clamp(g.smile ?? t.smileGain ?? 1.0),
      frown: clamp(g.frown ?? t.frownGain ?? 1.0),
      surprised: clamp(g.surprised ?? t.surprisedGain ?? 1.0),
    };
  }

  function restoreCalibration() {
    const s = loadSettings();
    // Always clear legacy experimental calibrations unless v6+ intentional
    if (s[CAL_KEY] && (s[CAL_KEY].version || 0) < 6) {
      delete s[CAL_KEY];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
    const cal = loadSettings()[CAL_KEY];
    if (cal && cal.floors && typeof cal.floors === 'object') {
      floors = { ...DEFAULT_FLOORS, ...cal.floors };
      isCalibrated = true;
      calibratedAt = cal.at || null;
    } else {
      floors = { ...DEFAULT_FLOORS };
      isCalibrated = false;
      calibratedAt = null;
    }
    updateCalibUI();
  }

  function applyPipeline(map) {
    if (!map || typeof map !== 'object') return map;
    const out = { ...map };
    const gains = readGains();

    // 1) Optional floors (default all 0 = passthrough)
    for (const [k, floor] of Object.entries(floors)) {
      if (out[k] === undefined || !(floor > 0)) continue;
      out[k] = Math.max(0, Number(out[k]) - floor);
    }

    // 2) Gain — amplifies residual for enter AND return
    //    (same multiplier on the way up and down)
    for (const k of Object.keys(out)) {
      let g = 1.0;
      if (SMILE_SET.has(k)) g = gains.smile;
      else if (FROWN_SET.has(k)) g = gains.frown;
      else if (SURPRISED_SET.has(k)) g = gains.surprised;
      else continue;
      if (g === 1.0) continue;
      out[k] = Math.min(100, Math.max(0, Number(out[k]) * g));
    }
    return out;
  }

  function pushHistory(map) {
    rawHistory.push({ ...map });
    if (rawHistory.length > 40) rawHistory.shift();
  }

  function averageRecent(n) {
    const slice = rawHistory.slice(-n);
    if (!slice.length && lastRawBlendshapes) slice.push(lastRawBlendshapes);
    if (!slice.length) return null;
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
    for (const k of Object.keys(sums)) avg[k] = sums[k] / counts[k];
    return avg;
  }

  function calibrateNeutral(done) {
    if (calibrating) {
      const r = { ok: false, message: 'Already sampling' };
      if (done) done(r);
      return r;
    }
    if (!lastRawBlendshapes && !rawHistory.length) {
      const r = { ok: false, message: 'No face data yet — start webcam first' };
      if (done) done(r);
      return r;
    }

    calibrating = true;
    updateCalibUI();

    const finish = () => {
      calibrating = false;
      const avg = averageRecent(15);
      if (!avg) {
        const r = { ok: false, message: 'No blendshapes' };
        updateCalibUI();
        if (done) done(r);
        return r;
      }

      const snapshot = {};
      for (const key of ALL_KEYS) {
        const v = Number(avg[key]);
        snapshot[key] = isFinite(v)
          ? Math.min(MAX_FLOOR, Math.max(0, v + PAD))
          : 0;
      }

      floors = { ...DEFAULT_FLOORS, ...snapshot };
      isCalibrated = true;
      calibratedAt = new Date().toISOString();
      saveSettings({
        [CAL_KEY]: { floors: snapshot, at: calibratedAt, version: 6 },
      });

      console.log('[deadzone] Optional calibration applied', snapshot);
      updateCalibUI();
      const r = { ok: true, message: 'Calibrated', floors: snapshot };
      if (done) done(r);
      return r;
    };

    if (rawHistory.length >= 8) return finish();
    setTimeout(finish, 450);
    return { ok: true, pending: true, message: 'Sampling…' };
  }

  function resetCalibration() {
    floors = { ...DEFAULT_FLOORS };
    isCalibrated = false;
    calibratedAt = null;
    const s = loadSettings();
    delete s[CAL_KEY];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    updateCalibUI();
    return { ok: true, message: 'MediaPipe defaults (no floors)' };
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
          ? `Optional baseline ✓ (${when})`
          : 'Optional baseline ✓';
        statusEl.classList.add('calib-ok');
        statusEl.classList.remove('calib-default');
      } else {
        statusEl.textContent = 'MediaPipe defaults — use Gain sliders';
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
    const base = btn.dataset.label || btn.textContent;
    btn.dataset.label = base;
    btn.textContent = ok ? '✓ ' + (msg || 'Done') : '✗ ' + (msg || 'Failed');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = btn.dataset.label;
      btn.disabled = calibrating;
    }, 1800);
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
            // floors (optional) then gain (enter + return)
            msg.blendShapes = applyPipeline(msg.blendShapes);
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
          flashButton(btnCal, result.ok, result.ok ? 'Saved' : 'No data');
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
        flashButton(btnReset, true, 'Defaults');
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
      __gains: readGains(),
    });

    console.log('[pipeline] MediaPipe defaults + client gain (enter & return)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
