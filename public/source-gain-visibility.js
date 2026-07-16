// ═══════════════════════════════════════════════════
//  Show Gain sliders only for Webcam (MediaPipe).
//  VTube Studio / iFacialMocap have their own tuning
//  on the phone — hide Gain + Calibrate to avoid confusion.
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  function setWebcamOnlyControls(visible) {
    document.querySelectorAll('.meter-gain').forEach((el) => {
      el.style.display = visible ? '' : 'none';
    });

    const calib = document.getElementById('calib-row');
    if (calib) calib.style.display = visible ? '' : 'none';

    // Optional note under Live Tracking when phone source is selected
    let note = document.getElementById('gain-source-note');
    if (!visible) {
      if (!note) {
        note = document.createElement('p');
        note.id = 'gain-source-note';
        note.className = 'help-text';
        note.style.marginTop = '8px';
        note.style.marginBottom = '0';
        const meters = document.querySelector('.meters');
        if (meters && meters.parentNode) {
          meters.parentNode.insertBefore(note, meters);
        }
      }
      note.textContent =
        'Gain & Calibrate apply to Webcam only. For VTube Studio / iFacialMocap, use Expression Thresholds and the phone app settings.';
      note.style.display = '';
    } else if (note) {
      note.style.display = 'none';
    }
  }

  function sourceFromActiveTab() {
    const active = document.querySelector('.source-tab.active');
    return (active && active.dataset.source) || 'webcam';
  }

  function applyForSource(source) {
    setWebcamOnlyControls(source === 'webcam');
  }

  function wireTabs() {
    document.querySelectorAll('.source-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        // Run after control.js toggles .active
        requestAnimationFrame(() => {
          applyForSource(tab.dataset.source || sourceFromActiveTab());
        });
      });
    });
  }

  function init() {
    wireTabs();
    applyForSource(sourceFromActiveTab());
    console.log('[source-ui] Gain sliders visible only for Webcam');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
