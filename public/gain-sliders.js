// ═══════════════════════════════════════════════════
//  AS Adventurer — Expression Gain Sliders
//  Real-time EXPRESSION_GAIN control for Smile / Frown / Surprised
//  Loaded after control.js
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
    surprised: { slider: 'gain-surprised', value: 'val-gain-surprised' }
  };

  const DEFAULT_GAIN = 3.0;

  function formatGain(v) {
    return Number(v).toFixed(1) + '×';
  }

  function getGainsFromUI() {
    return {
      smileGain: parseFloat(document.getElementById(GAIN_IDS.smile.slider).value) || DEFAULT_GAIN,
      frownGain: parseFloat(document.getElementById(GAIN_IDS.frown.slider).value) || DEFAULT_GAIN,
      surprisedGain: parseFloat(document.getElementById(GAIN_IDS.surprised.slider).value) || DEFAULT_GAIN
    };
  }

  let sendTimeout = null;
  function sendGains() {
    clearTimeout(sendTimeout);
    sendTimeout = setTimeout(async () => {
      const gains = getGainsFromUI();
      // Persist under both gains + nested in thresholds for compatibility
      const settings = loadSettings();
      const thresholds = settings.thresholds || {};
      thresholds.smileGain = gains.smileGain;
      thresholds.frownGain = gains.frownGain;
      thresholds.surprisedGain = gains.surprisedGain;
      saveSettings({
        gains: {
          smile: gains.smileGain,
          frown: gains.frownGain,
          surprised: gains.surprisedGain
        },
        thresholds
      });

      try {
        await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gains)
        });
      } catch (e) {
        /* ignore network blips */
      }
    }, 150); // snappier than threshold debounce — gain feels live
  }

  function applyGainToUI(key, val) {
    const ids = GAIN_IDS[key];
    if (!ids) return;
    const slider = document.getElementById(ids.slider);
    const label = document.getElementById(ids.value);
    if (!slider || !label) return;
    const n = Math.min(6, Math.max(1, Number(val) || DEFAULT_GAIN));
    slider.value = n;
    label.textContent = formatGain(n);
  }

  function restoreGains() {
    const settings = loadSettings();
    // Prefer dedicated gains object, fall back to thresholds.*Gain
    const g = settings.gains || {};
    const t = settings.thresholds || {};
    applyGainToUI('smile', g.smile ?? t.smileGain ?? DEFAULT_GAIN);
    applyGainToUI('frown', g.frown ?? t.frownGain ?? DEFAULT_GAIN);
    applyGainToUI('surprised', g.surprised ?? t.surprisedGain ?? DEFAULT_GAIN);
    // Push restored values to server
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
      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        label.textContent = formatGain(val);
        sendGains();
      });
    }
  }

  function wireReset() {
    const btn = document.getElementById('btn-reset-thresholds');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // After control.js resets thresholds, also reset gains
      setTimeout(() => {
        applyGainToUI('smile', DEFAULT_GAIN);
        applyGainToUI('frown', DEFAULT_GAIN);
        applyGainToUI('surprised', DEFAULT_GAIN);
        saveSettings({
          gains: { smile: DEFAULT_GAIN, frown: DEFAULT_GAIN, surprised: DEFAULT_GAIN }
        });
        sendGains();
      }, 50);
    });
  }

  // Init once DOM is ready (script is at end of body, so usually ready)
  function init() {
    // Ensure gain elements exist (from index.html Live Tracking section)
    if (!document.getElementById('gain-smile')) {
      console.warn('[gain] Gain sliders not found in DOM — is index.html up to date?');
      return;
    }
    wireSliders();
    wireReset();
    restoreGains();
    console.log('[gain] Expression gain sliders ready (default 3.0×)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
