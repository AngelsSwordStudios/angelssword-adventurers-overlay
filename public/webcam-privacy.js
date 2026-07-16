// ═══════════════════════════════════════════════════
//  AS Adventurer — Webcam Preview Privacy Toggle
//  Hides the live camera feed for privacy while
//  MediaPipe face tracking continues uninterrupted.
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

  // Default: preview visible (false = not hidden)
  let previewHidden = !!loadSettings().webcamPreviewHidden;

  function applyPreviewState() {
    const wrap = document.getElementById('webcam-preview-wrap');
    const overlay = document.getElementById('webcam-privacy-overlay');
    const btn = document.getElementById('btn-toggle-webcam-preview');
    if (!wrap || !overlay || !btn) return;

    if (previewHidden) {
      wrap.classList.add('privacy-on');
      overlay.style.display = 'flex';
      btn.textContent = '👁 Preview OFF';
      btn.classList.add('preview-off');
      btn.title = 'Show camera preview (tracking stays on either way)';
    } else {
      wrap.classList.remove('privacy-on');
      overlay.style.display = 'none';
      btn.textContent = '👁 Preview ON';
      btn.classList.remove('preview-off');
      btn.title = 'Hide camera preview for privacy (tracking stays on)';
    }
  }

  function togglePreview() {
    previewHidden = !previewHidden;
    saveSettings({ webcamPreviewHidden: previewHidden });
    applyPreviewState();
  }

  function init() {
    const btn = document.getElementById('btn-toggle-webcam-preview');
    if (!btn) {
      console.warn('[privacy] Preview toggle button not found');
      return;
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      togglePreview();
    });
    applyPreviewState();
    console.log('[privacy] Webcam preview toggle ready (hidden=' + previewHidden + ')');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
