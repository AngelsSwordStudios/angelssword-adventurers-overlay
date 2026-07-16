// ═══════════════════════════════════════════════════
//  AS Adventurer — Expression Gain Sliders
//
//  Live path:
//    slider input → update label + window.AS_GAINS (instant)
//                → localStorage (sync)
//                → POST server gains = 1.0 (avoid double scale)
//
//  webcam-deadzone.js reads window.AS_GAINS every frame
//  and multiplies blendshapes (enter + return).
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  const STORAGE_KEY = 'as-adventurer-settings';
  const DEFAULT_GAIN = 1.0;
  const MIN_GAIN = 0.5;
  const MAX_GAIN = 6.0;

  const GAIN_IDS = {
    smile: { slider: 'gain-smile', value: 'val-gain-smile' },
    frown: { slider: 'gain-frown', value: 'val-gain-frown' },
    surprised: { slider: 'gain-surprised', value: 'val-gain-surprised' },
  };

  // Live gains — read by webcam-deadzone.js every frame
  window.AS_GAINS = {
    smile: DEFAULT_GAIN,
    frown: DEFAULT_GAIN,
    surprised: DEFAULT_GAIN,
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
    return Number(v).toFixed(1) + '×';
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

  /** Push live object + storage immediately (no debounce on the live path) */
  function commitGains(gains, { network } = { network: true }) {
    const g = {
      smile: clampGain(gains.smile),
      frown: clampGain(gains.frown),
      surprised: clampGain(gains.surprised),
    };

    window.AS_GAINS.smile = g.smile;
    window.AS_GAINS.frown = g.frown;
    window.AS_GAINS.surprised = g.surprised;

    saveSettings({ gains: { ...g } });

    // Update labels if present
    for (const key of Object.keys(GAIN_IDS)) {
      const lab = document.getElementById(GAIN_IDS[key].value);
      if (lab) lab.textContent = formatGain(g[key]);
    }

    if (network) scheduleServerGainNeutralize();
    return g;
  }

  // Server multiplies composites by expressionGains — keep those at 1.0
  // so only our client-side blendshape gain applies (enter + return).
  let serverTimer = null;
  function scheduleServerGainNeutralize() {
    clearTimeout(serverTimer);
    serverTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            smileGain: 1.0,
            frownGain: 1.0,
            surprisedGain: 1.0,
          }),
        });
        if (!res.ok) {
          console.warn('[gain] Server rejected gain neutralize', res.status);
        }
      } catch (e) {
        /* offline */
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
    slider.min = String(MIN_GAIN);
    slider.max = String(MAX_GAIN);
    slider.step = '0.1';
    slider.value = String(n);
    label.textContent = formatGain(n);
  }

  function restoreGains() {
    const settings = loadSettings();
    const g = settings.gains || {};
    const t = settings.thresholds || {};
    const smile = g.smile ?? t.smileGain ?? DEFAULT_GAIN;
    const frown = g.frown ?? t.frownGain ?? DEFAULT_GAIN;
    const surprised = g.surprised ?? t.surprisedGain ?? DEFAULT_GAIN;

    applyGainToUI('smile', smile);
    applyGainToUI('frown', frown);
    applyGainToUI('surprised', surprised);

    commitGains({ smile, frown, surprised }, { network: true });
  }

  function wireSliders() {
    for (const [key, ids] of Object.entries(GAIN_IDS)) {
      const slider = document.getElementById(ids.slider);
      if (!slider) {
        console.warn('[gain] Missing slider #' + ids.slider);
        continue;
      }
      slider.min = String(MIN_GAIN);
      slider.max = String(MAX_GAIN);
      slider.step = '0.1';

      // input = every tick while dragging (live)
      slider.addEventListener('input', () => {
        const gains = readSliders();
        commitGains(gains, { network: true });
        console.log(
          '[gain] live',
          gains.smile.toFixed(1) + '× smile /',
          gains.frown.toFixed(1) + '× frown /',
          gains.surprised.toFixed(1) + '× surprised'
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
        commitGains(
          { smile: DEFAULT_GAIN, frown: DEFAULT_GAIN, surprised: DEFAULT_GAIN },
          { network: true }
        );
      }, 80);
    });
  }

  function init() {
    if (!document.getElementById('gain-smile')) {
      console.warn('[gain] #gain-smile not in DOM — sliders not connected');
      return;
    }
    wireSliders();
    wireReset();
    restoreGains();

    // Debug helpers
    window.AS_getGains = () => ({ ...window.AS_GAINS });
    window.AS_setGain = (key, val) => {
      if (!GAIN_IDS[key]) return;
      applyGainToUI(key, val);
      commitGains(readSliders(), { network: true });
    };

    console.log('[gain] Connected — live AS_GAINS', window.AS_GAINS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
