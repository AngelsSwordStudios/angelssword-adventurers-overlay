// ═══════════════════════════════════════════════════
//  AS Adventurer — Webcam Preview Privacy Toggle
//  Hides the live camera feed for privacy while
//  MediaPipe face tracking continues uninterrupted.
//  Default: preview OFF (hidden).
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

  // Default OFF for privacy: hide preview unless user explicitly enabled it.
  // webcamPreviewVisible === true → show feed; anything else → hidden.
  const saved = loadSettings();
  let previewVisible = saved.webcamPreviewVisible === true;

  function applyPreviewState() {
    const wrap = document.getElementById('webcam-preview-wrap');
    const overlay = document.getElementById('webcam-privacy-overlay');
    const btn = document.getElementById('btn-toggle-webcam-preview');
    if (!wrap || !overlay || !btn) return;

    if (!previewVisible) {
      wrap.classList.add('privacy-on');
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      btn.textContent = '👁 Preview OFF';
      btn.classList.add('preview-off');
      btn.classList.remove('preview-on');
      btn.title = 'Show camera preview (tracking stays on either way)';
    } else {
      wrap.classList.remove('privacy-on');
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      btn.textContent = '👁 Preview ON';
      btn.classList.add('preview-on');
      btn.classList.remove('preview-off');
      btn.title = 'Hide camera preview for privacy (tracking stays on)';
    }
  }

  function togglePreview() {
    previewVisible = !previewVisible;
    saveSettings({ webcamPreviewVisible: previewVisible });
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
    console.log('[privacy] Webcam preview toggle ready (visible=' + previewVisible + ', default=off)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
