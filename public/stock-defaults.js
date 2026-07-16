// ═══════════════════════════════════════════════════
//  AS Adventurer — MediaPipe stock defaults
//
//  Resets experimental thresholds/deadzone gains back to
//  original MediaPipe-friendly values. Gain sliders stay
//  as the sensitivity control (default 1.0× = raw).
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const FLAG = 'mediapipeDefaultsV7';

  const STOCK_THRESHOLDS = {
    smile: 20,
    frown: 25,
    surprised: 25,
    eyesClosed: 55,
    expressionHold: 300,
    exitBias: 0.4,
  };

  const STOCK_GAINS = {
    smile: 1.0,
    frown: 1.0,
    surprised: 1.0,
  };

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function save(updates) {
    const s = load();
    Object.assign(s, updates);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  function setSlider(id, valId, value, format) {
    const el = document.getElementById(id);
    const lab = document.getElementById(valId);
    if (el) el.value = value;
    if (lab) lab.textContent = format ? format(value) : value;
  }

  function applyToUI() {
    setSlider('threshold-smile', 'val-smile', STOCK_THRESHOLDS.smile);
    setSlider('threshold-frown', 'val-frown', STOCK_THRESHOLDS.frown);
    setSlider('threshold-surprised', 'val-surprised', STOCK_THRESHOLDS.surprised);
    setSlider('threshold-eyes', 'val-eyes', STOCK_THRESHOLDS.eyesClosed);
    setSlider('threshold-expression-hold', 'val-expression-hold', STOCK_THRESHOLDS.expressionHold, (v) => v + 'ms');
    setSlider('threshold-exit-bias', 'val-exit-bias', Math.round(STOCK_THRESHOLDS.exitBias * 100), (v) => v + '%');

    setSlider('gain-smile', 'val-gain-smile', STOCK_GAINS.smile, (v) => Number(v).toFixed(1) + '×');
    setSlider('gain-frown', 'val-gain-frown', STOCK_GAINS.frown, (v) => Number(v).toFixed(1) + '×');
    setSlider('gain-surprised', 'val-gain-surprised', STOCK_GAINS.surprised, (v) => Number(v).toFixed(1) + '×');
  }

  async function pushToServer() {
    const body = {
      smile: STOCK_THRESHOLDS.smile,
      frown: STOCK_THRESHOLDS.frown,
      surprised: STOCK_THRESHOLDS.surprised,
      eyesClosed: STOCK_THRESHOLDS.eyesClosed,
      expressionHold: STOCK_THRESHOLDS.expressionHold,
      exitBias: STOCK_THRESHOLDS.exitBias,
      smileGain: STOCK_GAINS.smile,
      frownGain: STOCK_GAINS.frown,
      surprisedGain: STOCK_GAINS.surprised,
    };
    try {
      await fetch('/api/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      /* server may not be up yet */
    }
  }

  function applyStock(reason) {
    applyToUI();
    save({
      [FLAG]: true,
      thresholds: {
        smile: STOCK_THRESHOLDS.smile,
        frown: STOCK_THRESHOLDS.frown,
        surprised: STOCK_THRESHOLDS.surprised,
        eyesClosed: STOCK_THRESHOLDS.eyesClosed,
        expressionHold: STOCK_THRESHOLDS.expressionHold,
        exitBias: STOCK_THRESHOLDS.exitBias,
        smileGain: STOCK_GAINS.smile,
        frownGain: STOCK_GAINS.frown,
        surprisedGain: STOCK_GAINS.surprised,
      },
      gains: { ...STOCK_GAINS },
      neutralCalibration: undefined,
    });
    // Explicitly drop calibration key
    const s = load();
    delete s.neutralCalibration;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

    if (window.AS_resetCalibration) {
      try {
        window.AS_resetCalibration();
      } catch (e) {}
    }

    pushToServer();
    console.log('[stock] MediaPipe defaults applied (' + reason + ')');
  }

  function init() {
    const s = load();
    if (!s[FLAG]) {
      applyStock('first-run v7');
    } else {
      // Still sync UI labels if HTML still shows old 5/6/6 baked-in values
      // only when no custom thresholds saved beyond stock flag
      pushToServer();
    }

    const btn = document.getElementById('btn-reset-thresholds');
    if (btn) {
      btn.addEventListener('click', () => {
        setTimeout(() => applyStock('reset button'), 60);
      });
    }

    window.AS_applyMediaPipeDefaults = () => applyStock('manual');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
