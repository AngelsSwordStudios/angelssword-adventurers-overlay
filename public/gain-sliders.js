// ═══════════════════════════════════════════════════
//  AS Adventurer — Expression Gain Sliders
//
//  MediaPipe defaults: gain = 1.0× (raw scores).
//  Raise gain to amplify Smile / Frown / Surprised for
//  BOTH starting an expression AND returning to neutral
//  (server multiplies live scores; exit hysteresis uses
//  the same gained scores).
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSettings(updates) {
    const settings = loadSettings();
    Object.assign(settings, updates);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  const GAIN_IDS = {
    smile: { slider: 'gain-smile', value: 'val-gain-smile' },
    frown: { slider: 'gain-frown', value: 'val-gain-frown' },
    surprised: { slider: 'gain-surprised', value: 'val-gain-surprised' },
  };

  // MediaPipe default = no amplification
  const DEFAULT_GAIN = 1.0;
  const MIN_GAIN = 0.5;
  const MAX_GAIN = 6.0;

  function formatGain(v) {
    return Number(v).toFixed(1) + '×';
  }

  function clampGain(v) {
    const n = Number(v);
    if (!isFinite(n)) return DEFAULT_GAIN;
    return Math.min(MAX_GAIN, Math.max(MIN_GAIN, n));
  }

  function getGainsFromUI() {
    return {
      smileGain: clampGain(document.getElementById(GAIN_IDS.smile.slider)?.value),
      frownGain: clampGain(document.getElementById(GAIN_IDS.frown.slider)?.value),
      surprisedGain: clampGain(document.getElementById(GAIN_IDS.surprised.slider)?.value),
    };
  }

  let sendTimeout = null;
  function sendGains() {
    clearTimeout(sendTimeout);
    sendTimeout = setTimeout(async () => {
      const gains = getGainsFromUI();
      const settings = loadSettings();
      const thresholds = settings.thresholds || {};
      thresholds.smileGain = gains.smileGain;
      thresholds.frownGain = gains.frownGain;
      thresholds.surprisedGain = gains.surprisedGain;
      saveSettings({
        gains: {
          smile: gains.smileGain,
          frown: gains.frownGain,
          surprised: gains.surprisedGain,
        },
        thresholds,
      });

      try {
        await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gains),
        });
      } catch (e) {
        /* ignore */
      }
    }, 120);
  }

  function applyGainToUI(key, val) {
    const ids = GAIN_IDS[key];
    if (!ids) return;
    const slider = document.getElementById(ids.slider);
    const label = document.getElementById(ids.value);
    if (!slider || !label) return;
    const n = clampGain(val);
    slider.value = n;
    label.textContent = formatGain(n);
  }

  function restoreGains() {
    const settings = loadSettings();
    const g = settings.gains || {};
    const t = settings.thresholds || {};

    // If old 3.0 defaults are still stored from earlier experiments, treat
    // missing gains as 1.0 (MediaPipe). Explicit saved values still win.
    const smile = g.smile ?? t.smileGain ?? DEFAULT_GAIN;
    const frown = g.frown ?? t.frownGain ?? DEFAULT_GAIN;
    const surprised = g.surprised ?? t.surprisedGain ?? DEFAULT_GAIN;

    applyGainToUI('smile', smile);
    applyGainToUI('frown', frown);
    applyGainToUI('surprised', surprised);
    sendGains();
  }

  function wireSliders() {
    for (const [key, ids] of Object.entries(GAIN_IDS)) {
      const slider = document.getElementById(ids.slider);
      const label = document.getElementById(ids.value);
      if (!slider || !label) {
        console.warn('[gain] Missing elements for', key);
        continue;
      }
      // Ensure HTML range matches allowed band
      slider.min = String(MIN_GAIN);
      slider.max = String(MAX_GAIN);
      slider.step = '0.1';

      slider.addEventListener('input', () => {
        const val = clampGain(slider.value);
        label.textContent = formatGain(val);
        sendGains();
      });
    }
  }

  function wireReset() {
    const btn = document.getElementById('btn-reset-thresholds');
    if (!btn) return;
    btn.addEventListener('click', () => {
      setTimeout(() => {
        applyGainToUI('smile', DEFAULT_GAIN);
        applyGainToUI('frown', DEFAULT_GAIN);
        applyGainToUI('surprised', DEFAULT_GAIN);
        saveSettings({
          gains: {
            smile: DEFAULT_GAIN,
            frown: DEFAULT_GAIN,
            surprised: DEFAULT_GAIN,
          },
        });
        sendGains();
      }, 50);
    });
  }

  function init() {
    if (!document.getElementById('gain-smile')) {
      console.warn('[gain] Gain sliders not found in DOM');
      return;
    }
    wireSliders();
    wireReset();
    restoreGains();
    console.log('[gain] Ready — MediaPipe default 1.0× (amplifies enter + exit)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
