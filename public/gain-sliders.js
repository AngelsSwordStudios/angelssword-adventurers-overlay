// ═══════════════════════════════════════════════════
//  Gain sliders — BrokeAss style (0.5× – 5.0×)
//  smile / frown / surprised / eyes
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const DEFAULT_GAIN = 1.0;
  const MIN_GAIN = 0.5;
  const MAX_GAIN = 5.0;

  const GAIN_IDS = {
    smile: { slider: 'gain-smile', value: 'val-gain-smile' },
    frown: { slider: 'gain-frown', value: 'val-gain-frown' },
    surprised: { slider: 'gain-surprised', value: 'val-gain-surprised' },
    eyes: { slider: 'gain-eyes', value: 'val-gain-eyes' },
  };

  window.AS_GAINS = {
    smile: DEFAULT_GAIN,
    frown: DEFAULT_GAIN,
    surprised: DEFAULT_GAIN,
    eyes: DEFAULT_GAIN,
  };

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

  function formatGain(v) {
    return Number(v).toFixed(2) + 'x';
  }

  function clampGain(v) {
    const n = Number(v);
    if (!isFinite(n)) return DEFAULT_GAIN;
    return Math.min(MAX_GAIN, Math.max(MIN_GAIN, n));
  }

  function readSliders() {
    const out = {};
    for (const key of Object.keys(GAIN_IDS)) {
      const el = document.getElementById(GAIN_IDS[key].slider);
      out[key] = clampGain(el ? el.value : DEFAULT_GAIN);
    }
    return out;
  }

  function commitGains(gains) {
    const g = {
      smile: clampGain(gains.smile),
      frown: clampGain(gains.frown),
      surprised: clampGain(gains.surprised),
      eyes: clampGain(gains.eyes),
    };
    window.AS_GAINS.smile = g.smile;
    window.AS_GAINS.frown = g.frown;
    window.AS_GAINS.surprised = g.surprised;
    window.AS_GAINS.eyes = g.eyes;
    saveSettings({ gains: { ...g } });
    for (const key of Object.keys(GAIN_IDS)) {
      const lab = document.getElementById(GAIN_IDS[key].value);
      if (lab) lab.textContent = formatGain(g[key]);
    }
    clearTimeout(commitGains._t);
    commitGains._t = setTimeout(async () => {
      try {
        await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ smileGain: 1, frownGain: 1, surprisedGain: 1 }),
        });
      } catch (e) {}
    }, 120);
    return g;
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
    slider.step = '0.05';
    slider.value = String(n);
    label.textContent = formatGain(n);
  }

  function restoreGains() {
    const settings = loadSettings();
    const g = settings.gains || {};
    applyGainToUI('smile', g.smile ?? DEFAULT_GAIN);
    applyGainToUI('frown', g.frown ?? DEFAULT_GAIN);
    applyGainToUI('surprised', g.surprised ?? DEFAULT_GAIN);
    applyGainToUI('eyes', g.eyes ?? DEFAULT_GAIN);
    commitGains(readSliders());
  }

  function wireSliders() {
    for (const [key, ids] of Object.entries(GAIN_IDS)) {
      const slider = document.getElementById(ids.slider);
      if (!slider) continue;
      slider.min = String(MIN_GAIN);
      slider.max = String(MAX_GAIN);
      slider.step = '0.05';
      slider.addEventListener('input', () => {
        const gains = readSliders();
        commitGains(gains);
        console.log(
          '[gain]',
          gains.smile.toFixed(2) + 'x smile /',
          gains.frown.toFixed(2) + 'x frown /',
          gains.surprised.toFixed(2) + 'x surprised /',
          gains.eyes.toFixed(2) + 'x eyes'
        );
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
        applyGainToUI('eyes', DEFAULT_GAIN);
        commitGains({
          smile: DEFAULT_GAIN,
          frown: DEFAULT_GAIN,
          surprised: DEFAULT_GAIN,
          eyes: DEFAULT_GAIN,
        });
      }, 80);
    });
  }

  function init() {
    if (!document.getElementById('gain-smile')) return;
    wireSliders();
    wireReset();
    restoreGains();
    window.AS_getGains = () => ({ ...window.AS_GAINS });
    console.log('[gain] smile/frown/surprised/eyes 0.5–5.0× ready', window.AS_GAINS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
