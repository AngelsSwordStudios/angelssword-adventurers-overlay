// ═══════════════════════════════════════════════════
//  AS Adventurer — Expression Gain Sliders
//
//  Default 1.0× = raw MediaPipe.
//  Gain is applied CLIENT-SIDE to blendshapes (see
//  webcam-deadzone.js pipeline) so scores scale the
//  same way when starting an expression AND when
//  returning to neutral.
//  Server-side gain is held at 1.0× to avoid double scaling.
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
      smile: clampGain(document.getElementById(GAIN_IDS.smile.slider)?.value),
      frown: clampGain(document.getElementById(GAIN_IDS.frown.slider)?.value),
      surprised: clampGain(document.getElementById(GAIN_IDS.surprised.slider)?.value),
    };
  }

  let sendTimeout = null;
  function persistGains() {
    clearTimeout(sendTimeout);
    sendTimeout = setTimeout(async () => {
      const gains = getGainsFromUI();
      saveSettings({
        gains: {
          smile: gains.smile,
          frown: gains.frown,
          surprised: gains.surprised,
        },
      });

      // Keep server gain at 1.0 — client pipeline already amplifies enter + exit
      try {
        await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            smileGain: 1.0,
            frownGain: 1.0,
            surprisedGain: 1.0,
          }),
        });
      } catch (e) {
        /* ignore */
      }

      console.log('[gain] Client gains', gains.smile + '× /', gains.frown + '× /', gains.surprised + '× (server=1.0)');
    }, 100);
  }

  function applyGainToUI(key, val) {
    const ids = GAIN_IDS[key];
    if (!ids) return;
    const slider = document.getElementById(ids.slider);
    const label = document.getElementById(ids.value);
    if (!slider || !label) return;
    const n = clampGain(val);
    slider.min = String(MIN_GAIN);
    slider.max = String(MAX_GAIN);
    slider.step = '0.1';
    slider.value = n;
    label.textContent = formatGain(n);
  }

  function restoreGains() {
    const settings = loadSettings();
    const g = settings.gains || {};
    const t = settings.thresholds || {};
    applyGainToUI('smile', g.smile ?? t.smileGain ?? DEFAULT_GAIN);
    applyGainToUI('frown', g.frown ?? t.frownGain ?? DEFAULT_GAIN);
    applyGainToUI('surprised', g.surprised ?? t.surprisedGain ?? DEFAULT_GAIN);
    persistGains();
  }

  function wireSliders() {
    for (const [key, ids] of Object.entries(GAIN_IDS)) {
      const slider = document.getElementById(ids.slider);
      const label = document.getElementById(ids.value);
      if (!slider || !label) continue;
      slider.min = String(MIN_GAIN);
      slider.max = String(MAX_GAIN);
      slider.step = '0.1';
      slider.addEventListener('input', () => {
        const val = clampGain(slider.value);
        label.textContent = formatGain(val);
        persistGains();
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
        persistGains();
      }, 80);
    });
  }

  function init() {
    if (!document.getElementById('gain-smile')) {
      console.warn('[gain] Gain sliders not found');
      return;
    }
    wireSliders();
    wireReset();
    restoreGains();
    console.log('[gain] Ready — client-side gain amplifies enter + return (default 1.0×)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
