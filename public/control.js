// ═══════════════════════════════════════════════════
//  AS Adventurer — Control Panel Logic
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  // ── Settings Persistence ────────────────────────
  const STORAGE_KEY = 'as-adventurer-settings';

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
  }

  function saveSettings(updates) {
    const settings = loadSettings();
    Object.assign(settings, updates);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  const savedSettings = loadSettings();

  // ── WebSocket ───────────────────────────────────
  const wsUrl = `ws://${location.host}?type=control`;
  let ws = null;

  function connectWS() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      document.getElementById('ws-status').classList.add('connected');
      document.getElementById('ws-status-text').textContent = 'Connected';
      // Send current settings on (re)connect
      const currentSettings = loadSettings();
      const vol = currentSettings.sfxMuted ? 0 : (currentSettings.sfxVolume !== undefined ? currentSettings.sfxVolume / 100 : 1);
      ws.send(JSON.stringify({ type: 'config', sfxVolume: vol }));
      // Sync transition settings on connect
      if (currentSettings.swapDuration !== undefined) {
        ws.send(JSON.stringify({ type: 'config', swapDuration: currentSettings.swapDuration }));
      }
      ws.send(JSON.stringify({ type: 'config', crossfadeMode: currentSettings.crossfadeMode || false }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'expression' || data.type === 'tracking') {
          updateTrackingDisplay(data);
        }
        if (data.type === 'emote') {
          // Sync emote button state from external triggers
          if (data.action === 'trigger' && data.emote) {
            activeEmoteName = data.emote.name;
            updateEmoteButtons();
          } else if (data.action === 'release') {
            activeEmoteName = null;
            updateEmoteButtons();
          }
        }
        if (data.type === 'model_change') {
          loadEmotes();
        }
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      document.getElementById('ws-status').classList.remove('connected');
      document.getElementById('ws-status-text').textContent = 'Disconnected';
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => ws.close();
  }

  // ── Tracking Display ────────────────────────────
  const expressionIcons = {
    neutral: '😐',
    happy: '😊',
    sad: '😢',
    surprised: '😮',
    eyes_closed: '😑'
  };

  const expressionLabels = {
    neutral: 'Neutral',
    happy: 'Happy',
    sad: 'Sad',
    surprised: 'Surprised',
    eyes_closed: 'Eyes Closed'
  };

  function updateTrackingDisplay(data) {
    // Expression icon & label
    const icon = document.getElementById('current-expression-icon');
    const label = document.getElementById('current-expression-label');
    icon.textContent = expressionIcons[data.expression] || '😐';
    label.textContent = expressionLabels[data.expression] || 'Unknown';

    // Source
    const sourceNames = {
      vtube_studio: 'VTube Studio',
      ifacialmocap: 'iFacialMocap',
      webcam: 'Webcam'
    };
    document.getElementById('tracking-source').textContent = sourceNames[data.source] || data.source;

    // Meters
    const smile = data.smile || 0;
    const frown = data.frown || 0;
    const surprised = data.surprised || 0;
    const eyes = data.eyesClosed || 0;

    document.getElementById('meter-smile').style.width = Math.min(100, smile) + '%';
    document.getElementById('meter-smile-val').textContent = Math.round(smile);
    document.getElementById('meter-frown').style.width = Math.min(100, frown) + '%';
    document.getElementById('meter-frown-val').textContent = Math.round(frown);
    document.getElementById('meter-surprised').style.width = Math.min(100, surprised) + '%';
    document.getElementById('meter-surprised-val').textContent = Math.round(surprised);
    document.getElementById('meter-eyes').style.width = Math.min(100, eyes) + '%';
    document.getElementById('meter-eyes-val').textContent = Math.round(eyes);
  }

  // ── Source Tabs ─────────────────────────────────
  const tabs = document.querySelectorAll('.source-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.source-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${tab.dataset.source}`).classList.add('active');
    });
  });

  // ── VTube Studio Connection ───────────────────
  const vtsIpInput = document.getElementById('vts-ip');
  if (savedSettings.vtsIP) vtsIpInput.value = savedSettings.vtsIP;

  document.getElementById('btn-connect-vts').addEventListener('click', async () => {
    const ip = vtsIpInput.value.trim();
    const status = document.getElementById('vts-status');
    if (!ip) { status.textContent = 'Please enter an IP address'; status.className = 'connection-status error'; return; }

    saveSettings({ vtsIP: ip });
    status.textContent = 'Connecting...';
    status.className = 'connection-status';

    try {
      const res = await fetch('/api/connect-vts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneIP: ip })
      });
      const data = await res.json();
      if (data.success) {
        status.textContent = `✓ ${data.message}`;
        status.className = 'connection-status success';
      } else {
        status.textContent = `✗ ${data.error}`;
        status.className = 'connection-status error';
      }
    } catch (e) {
      status.textContent = `✗ ${e.message}`;
      status.className = 'connection-status error';
    }
  });

  // ── iFacialMocap Connection ─────────────────
  const ifacialIpInput = document.getElementById('ifacial-ip');
  if (savedSettings.ifacialIP) ifacialIpInput.value = savedSettings.ifacialIP;

  document.getElementById('btn-connect-ifacial').addEventListener('click', async () => {
    const ip = ifacialIpInput.value.trim();
    const status = document.getElementById('ifacial-status');
    if (!ip) { status.textContent = 'Please enter an IP address'; status.className = 'connection-status error'; return; }

    saveSettings({ ifacialIP: ip });
    status.textContent = 'Connecting...';
    status.className = 'connection-status';

    try {
      const res = await fetch('/api/connect-ifacial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneIP: ip })
      });
      const data = await res.json();
      if (data.success) {
        status.textContent = `✓ ${data.message}`;
        status.className = 'connection-status success';
      } else {
        status.textContent = `✗ ${data.error}`;
        status.className = 'connection-status error';
      }
    } catch (e) {
      status.textContent = `✗ ${e.message}`;
      status.className = 'connection-status error';
    }
  });

  // ── Webcam (MediaPipe fallback) ─────────────────
  let webcamStream = null;
  let webcamActive = false;
  let faceLandmarker = null;

  document.getElementById('btn-start-webcam').addEventListener('click', startWebcam);
  document.getElementById('btn-stop-webcam').addEventListener('click', stopWebcam);

  async function startWebcam() {
    try {
      document.getElementById('btn-start-webcam').textContent = 'Loading MediaPipe...';
      document.getElementById('btn-start-webcam').disabled = true;

      // Load MediaPipe
      if (!faceLandmarker) {
        await loadMediaPipe();
      }

      webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      const video = document.getElementById('webcam-video');
      video.srcObject = webcamStream;
      await video.play();

      document.getElementById('webcam-container').style.display = 'block';
      document.getElementById('btn-start-webcam').style.display = 'none';
      document.getElementById('btn-stop-webcam').style.display = '';

      webcamActive = true;
      processWebcamFrame();
    } catch (e) {
      console.error('Webcam error:', e);
      document.getElementById('btn-start-webcam').textContent = `Error: ${e.message}`;
      document.getElementById('btn-start-webcam').disabled = false;
    }
  }

  function stopWebcam() {
    webcamActive = false;
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    document.getElementById('webcam-container').style.display = 'none';
    document.getElementById('btn-start-webcam').style.display = '';
    document.getElementById('btn-start-webcam').textContent = 'Start Webcam';
    document.getElementById('btn-start-webcam').disabled = false;
    document.getElementById('btn-stop-webcam').style.display = 'none';
  }

  async function loadMediaPipe() {
    // Dynamically load MediaPipe vision module
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs');
    const { FaceLandmarker, FilesetResolver } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true
    });
    console.log('[webcam] MediaPipe FaceLandmarker loaded');
  }

  function processWebcamFrame() {
    if (!webcamActive || !faceLandmarker) return;

    const video = document.getElementById('webcam-video');
    if (video.readyState < 2) {
      requestAnimationFrame(processWebcamFrame);
      return;
    }

    const result = faceLandmarker.detectForVideo(video, performance.now());

    if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
      const blendshapes = result.faceBlendshapes[0].categories;

      // Send ALL blendshapes to the server as raw tracking data.
      // The server will apply the same composite scoring, thresholds,
      // and hysteresis as VTube Studio / iFacialMocap sources.
      const blendShapeMap = {};
      for (const bs of blendshapes) {
        // MediaPipe uses camelCase names — the server's get() helper handles both
        // camelCase and VTS PascalCase, so these will be matched correctly.
        // Multiply by 100 to match the 0-100 scale the server expects.
        blendShapeMap[bs.categoryName] = bs.score * 100;
      }

      // Send as a webcam tracking packet (same format as UDP tracking)
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'webcam_tracking',
          blendShapes: blendShapeMap
        }));
      }
    }

    requestAnimationFrame(processWebcamFrame);
  }

  // ── Threshold Sliders ───────────────────────────
  function setupSlider(id, valueId, formatFn, onChange) {
    const slider = document.getElementById(id);
    const valueEl = document.getElementById(valueId);

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      valueEl.textContent = formatFn ? formatFn(val) : val;
      if (onChange) onChange(val);
    });
  }

  // Debounced threshold update
  let thresholdTimeout = null;
  function sendThresholds() {
    clearTimeout(thresholdTimeout);
    thresholdTimeout = setTimeout(async () => {
      const thresholds = {
        smile: parseFloat(document.getElementById('threshold-smile').value),
        frown: parseFloat(document.getElementById('threshold-frown').value),
        surprised: parseFloat(document.getElementById('threshold-surprised').value),
        eyesClosed: parseFloat(document.getElementById('threshold-eyes').value),
        expressionHold: parseFloat(document.getElementById('threshold-expression-hold').value),
        exitBias: parseFloat(document.getElementById('threshold-exit-bias').value) / 100,
      };
      saveSettings({ thresholds });
      try {
        await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(thresholds)
        });
      } catch (e) { /* ignore */ }
    }, 300);
  }

  // Restore saved thresholds
  if (savedSettings.thresholds) {
    const t = savedSettings.thresholds;
    if (t.smile !== undefined) { document.getElementById('threshold-smile').value = t.smile; document.getElementById('val-smile').textContent = t.smile; }
    if (t.frown !== undefined) { document.getElementById('threshold-frown').value = t.frown; document.getElementById('val-frown').textContent = t.frown; }
    if (t.surprised !== undefined) { document.getElementById('threshold-surprised').value = t.surprised; document.getElementById('val-surprised').textContent = t.surprised; }
    if (t.eyesClosed !== undefined) { document.getElementById('threshold-eyes').value = t.eyesClosed; document.getElementById('val-eyes').textContent = t.eyesClosed; }
    if (t.expressionHold !== undefined) { document.getElementById('threshold-expression-hold').value = t.expressionHold; document.getElementById('val-expression-hold').textContent = t.expressionHold + 'ms'; }
    if (t.exitBias !== undefined) { document.getElementById('threshold-exit-bias').value = Math.round(t.exitBias * 100); document.getElementById('val-exit-bias').textContent = Math.round(t.exitBias * 100) + '%'; }
    // Push restored thresholds to server
    sendThresholds();
  }

  // Restore speaking hold from saved settings
  let speakingHoldMs = 400;
  if (savedSettings.speakingHold !== undefined) {
    speakingHoldMs = savedSettings.speakingHold;
    document.getElementById('threshold-speaking-hold').value = speakingHoldMs;
    document.getElementById('val-speaking-hold').textContent = speakingHoldMs + 'ms';
  }

  setupSlider('threshold-smile', 'val-smile', null, sendThresholds);
  setupSlider('threshold-frown', 'val-frown', null, sendThresholds);
  setupSlider('threshold-surprised', 'val-surprised', null, sendThresholds);
  setupSlider('threshold-eyes', 'val-eyes', null, sendThresholds);

  setupSlider('threshold-speaking-hold', 'val-speaking-hold', (v) => v + 'ms', (val) => {
    speakingHoldMs = val;
    saveSettings({ speakingHold: val });
  });

  setupSlider('threshold-expression-hold', 'val-expression-hold', (v) => v + 'ms', sendThresholds);
  setupSlider('threshold-exit-bias', 'val-exit-bias', (v) => v + '%', sendThresholds);

  setupSlider('threshold-mic', 'val-mic', null, (val) => {
    // Send mic threshold to overlay via WebSocket
    saveSettings({ micThreshold: val });
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'config', micThreshold: val }));
    }
  });

  setupSlider('threshold-delay', 'val-delay', (v) => (v / 1000).toFixed(1) + 's', (val) => {
    saveSettings({ eyesClosedDelay: val });
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'config', eyesClosedDelayMs: val }));
    }
  });

  setupSlider('threshold-typing', 'val-typing', null, (val) => {
    saveSettings({ typingSensitivity: val });
  });

  setupSlider('threshold-sfx-volume', 'val-sfx-volume', (v) => v + '%', (val) => {
    saveSettings({ sfxVolume: val });
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'config', sfxVolume: val / 100 }));
    }
  });

  setupSlider('threshold-swap-duration', 'val-swap-duration', (v) => v + 'ms', (val) => {
    saveSettings({ swapDuration: val });
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'config', swapDuration: val }));
    }
  });

  // Crossfade mode toggle
  const crossfadeModeBtn = document.getElementById('btn-crossfade-mode');
  const crossfadeWarning = document.getElementById('crossfade-warning');
  let crossfadeMode = savedSettings.crossfadeMode || false;

  function updateCrossfadeModeBtn() {
    crossfadeModeBtn.textContent = crossfadeMode ? 'ON' : 'OFF';
    crossfadeModeBtn.classList.toggle('toggle-on', crossfadeMode);
    crossfadeModeBtn.classList.toggle('toggle-off', !crossfadeMode);
    crossfadeWarning.style.display = crossfadeMode ? '' : 'none';
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'config', crossfadeMode }));
    }
  }

  crossfadeModeBtn.addEventListener('click', () => {
    crossfadeMode = !crossfadeMode;
    saveSettings({ crossfadeMode });
    updateCrossfadeModeBtn();
  });

  // SFX mute toggle
  const sfxMuteBtn = document.getElementById('btn-toggle-sfx');
  let sfxMuted = savedSettings.sfxMuted || false;

  function updateSfxMuteBtn() {
    sfxMuteBtn.textContent = sfxMuted ? 'OFF' : 'ON';
    sfxMuteBtn.classList.toggle('toggle-on', !sfxMuted);
    sfxMuteBtn.classList.toggle('toggle-off', sfxMuted);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'config', sfxVolume: sfxMuted ? 0 : parseFloat(document.getElementById('threshold-sfx-volume').value) / 100 }));
    }
  }

  sfxMuteBtn.addEventListener('click', () => {
    sfxMuted = !sfxMuted;
    saveSettings({ sfxMuted });
    updateSfxMuteBtn();
  });

  // ── Reset to Defaults ───────────────────────────
  const DEFAULTS = {
    'threshold-smile': { value: 20, display: 'val-smile', format: v => v },
    'threshold-frown': { value: 25, display: 'val-frown', format: v => v },
    'threshold-surprised': { value: 25, display: 'val-surprised', format: v => v },
    'threshold-eyes': { value: 55, display: 'val-eyes', format: v => v },
    'threshold-mic': { value: 12, display: 'val-mic', format: v => v },
    'threshold-typing': { value: 5, display: 'val-typing', format: v => v },
    'threshold-speaking-hold': { value: 400, display: 'val-speaking-hold', format: v => v + 'ms' },
    'threshold-delay': { value: 1500, display: 'val-delay', format: v => (v / 1000).toFixed(1) + 's' },
    'threshold-expression-hold': { value: 300, display: 'val-expression-hold', format: v => v + 'ms' },
    'threshold-exit-bias': { value: 40, display: 'val-exit-bias', format: v => v + '%' },
    'threshold-sfx-volume': { value: 100, display: 'val-sfx-volume', format: v => v + '%' },
    'threshold-swap-duration': { value: 200, display: 'val-swap-duration', format: v => v + 'ms' },
  };

  document.getElementById('btn-reset-thresholds').addEventListener('click', () => {
    for (const [id, def] of Object.entries(DEFAULTS)) {
      const el = document.getElementById(id);
      if (el) {
        el.value = def.value;
        document.getElementById(def.display).textContent = def.format(def.value);
      }
    }
    // Update internal state
    speakingHoldMs = 400;
    sfxMuted = false;
    updateSfxMuteBtn();
    crossfadeMode = false;
    updateCrossfadeModeBtn();
    // Sync to server
    sendThresholds();
    // Clear saved threshold settings
    saveSettings({
      thresholds: undefined,
      micThreshold: undefined,
      typingSensitivity: undefined,
      eyesClosedDelay: undefined,
      speakingHold: undefined,
      sfxVolume: undefined,
      sfxMuted: false,
      swapDuration: undefined,
      crossfadeMode: false,
    });
    console.log('[cfg] Reset all thresholds to defaults');
  });

  // Restore mic threshold, typing sensitivity, delay, and SFX volume
  if (savedSettings.micThreshold !== undefined) {
    document.getElementById('threshold-mic').value = savedSettings.micThreshold;
    document.getElementById('val-mic').textContent = savedSettings.micThreshold;
  }
  if (savedSettings.typingSensitivity !== undefined) {
    document.getElementById('threshold-typing').value = savedSettings.typingSensitivity;
    document.getElementById('val-typing').textContent = savedSettings.typingSensitivity;
  }
  if (savedSettings.eyesClosedDelay !== undefined) {
    const delayEl = document.getElementById('threshold-delay');
    if (delayEl) {
      delayEl.value = savedSettings.eyesClosedDelay;
      document.getElementById('val-delay').textContent = (savedSettings.eyesClosedDelay / 1000).toFixed(1) + 's';
    }
  }
  if (savedSettings.sfxVolume !== undefined) {
    document.getElementById('threshold-sfx-volume').value = savedSettings.sfxVolume;
    document.getElementById('val-sfx-volume').textContent = savedSettings.sfxVolume + '%';
  }
  if (savedSettings.swapDuration !== undefined) {
    document.getElementById('threshold-swap-duration').value = savedSettings.swapDuration;
    document.getElementById('val-swap-duration').textContent = savedSettings.swapDuration + 'ms';
  }
  updateSfxMuteBtn();
  updateCrossfadeModeBtn();

  // ── Assets Status ───────────────────────────
  const stateNames = [
    'neutral_idle', 'neutral_speaking',
    'happy_idle', 'happy_speaking',
    'sad_idle', 'sad_speaking',
    'surprised_idle', 'surprised_speaking',
    'typing',
    'eyes_closed'
  ];

  async function loadAssetStatus(modelName) {
    try {
      const url = modelName ? `/api/assets?model=${encodeURIComponent(modelName)}` : '/api/assets';
      const res = await fetch(url);
      const assets = await res.json();
      const grid = document.getElementById('assets-grid');
      grid.innerHTML = '';

      for (const state of stateNames) {
        const item = document.createElement('div');
        item.className = 'asset-item';

        const dot = document.createElement('div');
        dot.className = `asset-status ${assets[state] ? 'found' : 'missing'}`;

        const name = document.createElement('span');
        name.className = 'asset-name';
        name.textContent = state;

        item.appendChild(dot);
        item.appendChild(name);
        grid.appendChild(item);
      }
    } catch (e) {
      console.warn('Failed to load asset status:', e);
    }
  }

  // ── Model Selector ──────────────────────────
  const modelSelect = document.getElementById('model-select');
  const modelInfo = document.getElementById('model-info');

  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      const { models, active } = await res.json();

      modelSelect.innerHTML = '';
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = `${model.name} (${model.assetCount} assets)`;
        if (model.name === active) option.selected = true;
        modelSelect.appendChild(option);
      }

      if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models found</option>';
        modelInfo.textContent = 'No asset folders detected.';
      } else {
        modelInfo.textContent = `${models.length} model(s) available`;
      }

      // Load assets for the active model
      loadAssetStatus(active);
    } catch (e) {
      console.warn('Failed to load models:', e);
    }
  }

  modelSelect.addEventListener('change', async () => {
    const selectedModel = modelSelect.value;
    if (!selectedModel) return;

    try {
      await fetch('/api/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel })
      });
      console.log(`[model] Switched to: ${selectedModel}`);
      loadAssetStatus(selectedModel);
    } catch (e) {
      console.warn('Failed to switch model:', e);
    }
  });

  // ── Emotes ─────────────────────────────────────
  let activeEmoteName = null;
  let activeSubPath = []; // Tracks navigation depth for nested subs
  let emotesList = [];

  function updateEmoteButtons() {
    const buttons = document.querySelectorAll('#emote-grid .emote-btn');
    buttons.forEach(btn => {
      if (btn.dataset.emoteName === activeEmoteName) {
        btn.classList.add('emote-active');
      } else {
        btn.classList.remove('emote-active');
      }
    });

    // Show/hide sub-animations (stacked layers for nested subs)
    const subContainer = document.getElementById('sub-animations');
    const activeEmote = emotesList.find(e => e.name === activeEmoteName);

    // Clear all existing sub sections
    subContainer.innerHTML = '';
    subContainer.style.display = 'none';

    if (activeEmote && activeEmote.emoteType === 2 && activeEmote.subs && activeEmote.subs.length > 0) {
      // Render sub layers: first the emote's subs, then each active sub's children
      const renderSubLevel = (subs, pathPrefix, depth) => {
        if (!subs || subs.length === 0) return;

        const label = document.createElement('div');
        label.className = 'sub-label';
        label.textContent = depth === 0
          ? '⚡ Sub-Animations'
          : `⚡ ${activeSubPath[depth - 1]} → Sub-Animations`;
        subContainer.appendChild(label);

        const grid = document.createElement('div');
        grid.className = 'emote-grid';

        for (const sub of subs) {
          const btn = document.createElement('button');
          btn.className = 'emote-btn sub-btn';

          // Highlight if this sub is the active one at this depth
          const isActive = activeSubPath[depth] === sub.name;
          if (isActive) btn.classList.add('sub-active');

          btn.innerHTML = `⚡ ${sub.name}`;

          const badges = [];
          if (sub.files.sound) badges.push('🔊');
          if (sub.files.idle) badges.push('🔄');
          if (sub.subs && sub.subs.length > 0) badges.push(`📂 ${sub.subs.length}`);
          if (badges.length > 0) {
            btn.innerHTML += `<span class="emote-type">${badges.join(' ')}</span>`;
          }

          const apiPath = pathPrefix ? `${pathPrefix}/${sub.name}` : sub.name;

          btn.addEventListener('click', async () => {
            btn.classList.add('sub-firing');
            setTimeout(() => btn.classList.remove('sub-firing'), 300);
            try {
              await fetch('/api/emote/sub', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: apiPath })
              });

              if (isActive) {
                // Toggle off — truncate path at this depth
                activeSubPath = activeSubPath.slice(0, depth);
              } else if (sub.files.idle) {
                // Activate — set path to this sub (truncate deeper levels)
                activeSubPath = [...activeSubPath.slice(0, depth), sub.name];
              }
              updateEmoteButtons();
            } catch (e) { console.warn('[emote] Sub trigger failed:', e); }
          });
          grid.appendChild(btn);
        }

        subContainer.appendChild(grid);
        subContainer.style.display = '';

        // If a sub at this depth is active and has children, render next level
        if (activeSubPath[depth]) {
          const activeSub = subs.find(s => s.name === activeSubPath[depth]);
          if (activeSub && activeSub.subs && activeSub.subs.length > 0) {
            const nextPath = pathPrefix ? `${pathPrefix}/${activeSub.name}` : activeSub.name;
            renderSubLevel(activeSub.subs, nextPath, depth + 1);
          }
        }
      };

      renderSubLevel(activeEmote.subs, '', 0);
    }
  }

  async function loadEmotes() {
    const grid = document.getElementById('emote-grid');
    try {
      const res = await fetch('/api/emotes');
      emotesList = await res.json();

      grid.innerHTML = '';

      if (!emotesList.length) {
        grid.innerHTML = '<div class="help-text">No emotes found for this model.</div>';
        return;
      }

      for (const emote of emotesList) {
        const btn = document.createElement('button');
        btn.className = 'emote-btn';
        btn.dataset.emoteName = emote.name;
        btn.innerHTML = `${emote.name}<span class="emote-type">Type ${emote.emoteType}</span>`;

        if (emote.emoteType === 1) {
          // Type 1: click to trigger (one-shot)
          btn.addEventListener('click', async () => {
            try {
              await fetch('/api/emote/trigger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: emote.name })
              });
            } catch (e) { console.warn('[emote] Trigger failed:', e); }
          });
        } else if (emote.emoteType === 2) {
          // Type 2: toggle on/off
          btn.addEventListener('click', async () => {
            try {
              if (activeEmoteName === emote.name) {
                // Release
                await fetch('/api/emote/release', { method: 'POST' });
                activeEmoteName = null;
                activeSubPath = [];
                updateEmoteButtons();
              } else {
                // Trigger
                await fetch('/api/emote/trigger', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: emote.name })
                });
                activeEmoteName = emote.name;
                activeSubPath = [];
                updateEmoteButtons();
              }
            } catch (e) { console.warn('[emote] Toggle failed:', e); }
          });
        }

        grid.appendChild(btn);
      }
    } catch (e) {
      console.warn('[emote] Failed to load emotes:', e);
      grid.innerHTML = '<div class="help-text">Failed to load emotes.</div>';
    }
  }

  loadEmotes();

  // ── State Override ─────────────────────────────
  document.querySelectorAll('.state-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = btn.dataset.state;

      // Update button highlight
      document.querySelectorAll('.state-btn').forEach(b => b.classList.remove('state-btn-active'));
      btn.classList.add('state-btn-active');

      if (state === 'auto') {
        // Return to camera tracking
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'state_override', override: null }));
        }
      } else {
        // Send manual override
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'state_override', override: state }));
        }
      }
    });
  });

  // ── Copy OBS URL ────────────────────────────────
  const obsUrlEl = document.getElementById('obs-url');
  obsUrlEl.textContent = `${location.origin}/overlay.html`;
  document.getElementById('btn-copy-url').addEventListener('click', () => {
    const url = obsUrlEl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-copy-url');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }).catch(() => {});
  });

  // ── Microphone Detection ────────────────────────
  let micStream = null;
  let micActive = false;
  let micAnalyser = null;
  let micAudioCtx = null;  // Keep at module scope to prevent GC
  let micSource = null;    // Keep at module scope to prevent GC
  let micIsSpeaking = false;
  let micIsTyping = false;
  let micLastSpeakingTime = 0;
  let micLastTypingTime = 0;      // For typing hold timer
  let micTypingHits = [];          // Timestamps of detected keystrokes
  let micTypingConfirmed = false;  // True once 2 hits within 500ms
  let micAboveThresholdSince = null;  // For noise gate attack timing
  let micLastVoiceFrame = null;       // Last time a voice-like frame was detected
  let micInterval = null;          // setInterval handle for mic processing (fallback)
  let micWorker = null;            // Web Worker for background-safe mic timing
  let micDataArray = null;         // Pre-allocated Uint8Array for FFT data
  let typingEnabled = savedSettings.typingEnabled !== false; // Default: on

  // Init typing toggle button state
  const typingToggleBtn = document.getElementById('btn-toggle-typing');
  if (!typingEnabled) {
    typingToggleBtn.textContent = 'OFF';
    typingToggleBtn.classList.remove('toggle-on');
    typingToggleBtn.classList.add('toggle-off');
  }
  typingToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    typingEnabled = !typingEnabled;
    typingToggleBtn.textContent = typingEnabled ? 'ON' : 'OFF';
    typingToggleBtn.classList.toggle('toggle-on', typingEnabled);
    typingToggleBtn.classList.toggle('toggle-off', !typingEnabled);
    saveSettings({ typingEnabled });
  });

  document.getElementById('btn-start-mic').addEventListener('click', startMic);
  document.getElementById('btn-stop-mic').addEventListener('click', stopMic);

  let micDevicesLoaded = false;
  const micSelect = document.getElementById('mic-select');

  // Populate mic dropdown — only requests getUserMedia once for permission
  async function loadMicDevices() {
    // Never re-enumerate while mic is actively capturing
    if (micActive) return;
    // Don't re-enumerate if we already have devices
    if (micDevicesLoaded) return;

    try {
      // Request permission once (needed to see device labels)
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      micSelect.innerHTML = '';

      if (audioInputs.length === 0) {
        micSelect.innerHTML = '<option value="">No microphones found</option>';
        return;
      }

      audioInputs.forEach((device, i) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${i + 1}`;
        micSelect.appendChild(option);
      });

      micDevicesLoaded = true;
      console.log(`[mic] Found ${audioInputs.length} audio input devices`);

      // Restore saved mic device selection
      if (savedSettings.micDeviceId) {
        micSelect.value = savedSettings.micDeviceId;
      }
    } catch (e) {
      console.warn('[mic] Could not enumerate devices:', e);
      micSelect.innerHTML = '<option value="">Grant mic access first</option>';
    }
  }

  // Load devices once on page load
  loadMicDevices();

  async function startMic() {
    try {
      const btn = document.getElementById('btn-start-mic');
      btn.textContent = 'Requesting access...';
      btn.disabled = true;

      // Use selected device if available
      const selectedDeviceId = micSelect.value;
      const audioSettings = {
        // NOTE: noiseSuppression DISABLED — Chrome's built-in suppression
        // adds 1-2s voice activity hold time that causes visible delay.
        // We handle noise filtering ourselves (high-pass filter + attack gate).
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: false,
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {})
      };
      const audioConstraints = { audio: audioSettings, video: false };

      micStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
      micAudioCtx = new AudioContext();
      // Resume context if suspended (Chrome autoplay policy)
      if (micAudioCtx.state === 'suspended') await micAudioCtx.resume();

      micSource = micAudioCtx.createMediaStreamSource(micStream);

      // High-pass filter: cuts low-freq rumble from keyboard/desk vibrations
      const highPass = micAudioCtx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 85;  // Below typical voice range

      micAnalyser = micAudioCtx.createAnalyser();
      micAnalyser.fftSize = 1024; // 512 bins — needed for spectral voice/click detection
      micAnalyser.smoothingTimeConstant = 0.3;
      micSource.connect(highPass);
      highPass.connect(micAnalyser);

      micActive = true;
      micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
      saveSettings({ micDeviceId: micSelect.value });
      document.getElementById('btn-start-mic').style.display = 'none';
      document.getElementById('btn-stop-mic').style.display = '';
      document.getElementById('mic-display').style.display = 'block';

      // Show which device is active
      const activeLabel = micSelect.options[micSelect.selectedIndex]?.textContent || 'Default';
      document.getElementById('mic-state').textContent = activeLabel;
      document.getElementById('mic-state').style.color = '#4ade80';

      // Use a Web Worker for the mic processing timer.
      // Browsers throttle setInterval to ~1000ms when the tab is hidden/minimized,
      // which makes speaking detection unresponsive. A Web Worker's timer runs
      // at full speed regardless of tab visibility.
      const workerBlob = new Blob([
        `let tid; onmessage = e => { if (e.data === 'start') { tid = setInterval(() => postMessage('tick'), 33); } else if (e.data === 'stop') { clearInterval(tid); } };`
      ], { type: 'application/javascript' });
      micWorker = new Worker(URL.createObjectURL(workerBlob));
      micWorker.onmessage = () => processMicFrame();
      micWorker.postMessage('start');
      console.log(`[mic] Started: ${activeLabel} (Web Worker timer @ 33ms)`);
    } catch (e) {
      console.error('[mic] Error:', e);
      const btn = document.getElementById('btn-start-mic');
      btn.textContent = 'Error: ' + e.message;
      btn.disabled = false;
    }
  }

  function stopMic() {
    micActive = false;
    if (micWorker) { micWorker.postMessage('stop'); micWorker.terminate(); micWorker = null; }
    if (micInterval) { clearInterval(micInterval); micInterval = null; }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    // Clean up audio processing chain to free resources
    if (micSource) { try { micSource.disconnect(); } catch (e) {} micSource = null; }
    if (micAudioCtx) { micAudioCtx.close().catch(() => {}); micAudioCtx = null; }
    micAnalyser = null;
    micDataArray = null;
    document.getElementById('btn-start-mic').style.display = '';
    document.getElementById('btn-start-mic').textContent = 'Enable Microphone';
    document.getElementById('btn-start-mic').disabled = false;
    document.getElementById('btn-stop-mic').style.display = 'none';
    document.getElementById('mic-display').style.display = 'none';
    document.getElementById('mic-state').textContent = 'Not started';
    document.getElementById('mic-state').style.color = '';
  }

  function processMicFrame() {
    if (!micActive || !micAnalyser) return;

    const dataArray = micDataArray;
    if (!dataArray) return;
    micAnalyser.getByteFrequencyData(dataArray);

    // ── Frequency bin mapping ───────────────────────
    // FFT size 1024 → 512 bins. At 48kHz: each bin ≈ 46.9Hz
    // At 44.1kHz: each bin ≈ 43.1Hz
    // We use approximate ranges that work for both sample rates:
    const sampleRate = micAudioCtx?.sampleRate || 48000;
    const binHz = sampleRate / 1024;

    // Voice fundamentals + harmonics: 85Hz – 1000Hz
    const voiceLow  = Math.floor(85 / binHz);
    const voiceHigh = Math.ceil(1000 / binHz);

    // Keyboard click energy zone: 2000Hz – 8000Hz
    const clickLow  = Math.floor(2000 / binHz);
    const clickHigh = Math.min(Math.ceil(8000 / binHz), dataArray.length - 1);

    // ── Compute band energies ───────────────────────
    let voiceEnergy = 0;
    for (let i = voiceLow; i <= voiceHigh; i++) {
      voiceEnergy += dataArray[i] * dataArray[i];
    }
    voiceEnergy = Math.sqrt(voiceEnergy / (voiceHigh - voiceLow + 1));

    let clickEnergy = 0;
    for (let i = clickLow; i <= clickHigh; i++) {
      clickEnergy += dataArray[i] * dataArray[i];
    }
    clickEnergy = Math.sqrt(clickEnergy / (clickHigh - clickLow + 1));

    // ── Overall RMS (for meter display) ─────────────
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const micLevel = Math.sqrt(sum / dataArray.length);

    // ── Voiceness ratio ─────────────────────────────
    // Voice: concentrated energy in 85-1000Hz range
    // Keyboard: energy spread across 2000-8000Hz (clicks, clacks)
    // Ratio: voiceEnergy / (voiceEnergy + clickEnergy)
    //   → Voice ≈ 0.6-0.9, Keyboard ≈ 0.1-0.35
    const totalBandEnergy = voiceEnergy + clickEnergy;
    const voiceness = totalBandEnergy > 1 ? voiceEnergy / totalBandEnergy : 0;
    const isVoiceLike = voiceness > 0.4; // Below 0.4 = too much click energy

    const micThreshold = parseFloat(document.getElementById('threshold-mic').value);
    const typingThreshold = parseFloat(document.getElementById('threshold-typing').value);
    const wasSpeaking = micIsSpeaking;
    const now = Date.now();

    // ── Noise gate with spectral check ──────────────
    // Speaking: level above mic threshold AND voice-like spectrum
    // Typing:  level above typing threshold AND NOT voice-like spectrum
    const ATTACK_MS = 50;   // Short enough for responsive feel
    const RELEASE_MS = speakingHoldMs; // Controlled by Speaking Hold slider
    const TYPING_HOLD_MS = 2000; // Keep typing animation for 2s after last keystroke

    const isLoudEnoughForVoice = micLevel > micThreshold;
    const isLoudEnoughForTyping = micLevel > typingThreshold;
    const wasTyping = micIsTyping;

    if (isLoudEnoughForVoice && isVoiceLike) {
      if (!micAboveThresholdSince) micAboveThresholdSince = now;
      micLastVoiceFrame = now; // Track last "good" voice frame
      if (now - micAboveThresholdSince >= ATTACK_MS) {
        micIsSpeaking = true;
        micIsTyping = false;
        micLastSpeakingTime = now;
      }
    } else {
      // Grace period: don't reset attack timer instantly on a single bad frame.
      // Voice has natural dips (consonants, breaths) that can cause momentary drops.
      // Only reset if we haven't seen a voice frame in ATTACK_GRACE_MS.
      const ATTACK_GRACE_MS = 100;
      if (!micLastVoiceFrame || now - micLastVoiceFrame > ATTACK_GRACE_MS) {
        micAboveThresholdSince = null;
      }
      if (now - micLastSpeakingTime > RELEASE_MS) {
        micIsSpeaking = false;
      }
      // Typing: detect keystroke-like sounds (only if enabled)
      if (typingEnabled && isLoudEnoughForTyping && !isVoiceLike && !micIsSpeaking) {
        // Record this hit and prune old ones (>500ms)
        micTypingHits.push(now);
        micTypingHits = micTypingHits.filter(t => now - t < 500);
        // Require 2 hits within 500ms to confirm typing
        if (micTypingHits.length >= 2) {
          micTypingConfirmed = true;
          micLastTypingTime = now;
        }
      }
      // Stay in typing state as long as confirmed and within hold window
      micIsTyping = typingEnabled && !micIsSpeaking && micTypingConfirmed && (now - micLastTypingTime < TYPING_HOLD_MS);
      // Reset confirmed flag when hold expires
      if (!micIsTyping) micTypingConfirmed = false;
    }

    // Update UI
    const pct = Math.min(100, (micLevel / 60) * 100);
    document.getElementById('meter-mic').style.width = pct + '%';
    document.getElementById('meter-mic-val').textContent = Math.round(micLevel);
    document.getElementById('mic-voice-icon').textContent = micIsSpeaking ? '🔊' : micIsTyping ? '⌨️' : '🔇';
    document.getElementById('mic-voice-label').textContent = micIsSpeaking
      ? 'Speaking' : micIsTyping ? 'Typing' : 'Idle';

    // Send state change to overlay via WebSocket
    if (wasSpeaking !== micIsSpeaking || wasTyping !== micIsTyping) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'speaking',
          speaking: micIsSpeaking,
          typing: micIsTyping
        }));
      }
    }
  }

  // ── Init ────────────────────────────────────────
  connectWS();
  loadModels(); // Load immediately on page load

  // Refresh models & assets periodically (picks up new model folders)
  setInterval(loadModels, 10000);
})();
