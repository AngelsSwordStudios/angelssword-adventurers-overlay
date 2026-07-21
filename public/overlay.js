// ═══════════════════════════════════════════════════
//  AS Adventurer — Client Logic
//  Combines face tracking + mic detection → asset state
// ═══════════════════════════════════════════════════

(() => {
  'use strict';

  // ── Config ──────────────────────────────────────
  const CONFIG = {
    wsUrl: `ws://${location.host}?type=overlay`,
    eyesClosedDelayMs: 1500,   // Must be closed this long to trigger eyes_closed
    reconnectMs: 3000,         // WebSocket reconnect delay
    swapDuration: 200,         // Transition duration in ms (blur-pop or crossfade)
    crossfadeMode: false,      // false = blur-pop (OBS-safe), true = opacity crossfade
  };

  // Parse URL params for overrides
  const params = new URLSearchParams(location.search);
  const debug = params.get('debug') === '1';
  if (params.get('eyes_delay')) CONFIG.eyesClosedDelayMs = parseFloat(params.get('eyes_delay'));

  // ── State ───────────────────────────────────────
  let currentExpression = 'neutral'; // neutral | happy | sad | eyes_closed
  let isSpeaking = false;
  let isTyping = false;
  let stateOverride = null; // null = auto (camera), or forced expression
  let currentStateKey = 'neutral_idle';
  let eyesClosedSince = null;
  let assets = {};
  let ws = null;

  // ── Emote State ────────────────────────────────
  let emoteState = 'inactive'; // inactive | intro | active | outro
  let activeEmote = null;
  let subStack = [];             // Stack of active sub-animations (deepest = last)
  let subAnimPlaying = false;  // True while sub one-shot animation is playing
  let emoteGifTimeout = null;

  // ── DOM refs ────────────────────────────────────
  const layers = {};
  const stateKeys = [
    'neutral_idle', 'neutral_speaking',
    'happy_idle', 'happy_speaking',
    'sad_idle', 'sad_speaking',
    'surprised_idle', 'surprised_speaking',
    'typing',
    'eyes_closed'
  ];

  for (const key of stateKeys) {
    layers[key] = document.getElementById(`layer-${key}`);
  }

  const overlayContainer = document.getElementById('overlay-container');
  const emoteLayer = document.getElementById('layer-emote');

  function ensureLayer(state) {
    if (layers[state]) return layers[state];
    const layer = document.createElement('div');
    layer.className = 'asset-layer';
    layer.id = `layer-${state}`;
    overlayContainer.insertBefore(layer, emoteLayer);
    layers[state] = layer;
    return layer;
  }

  const debugPanel = document.getElementById('debug-panel');
  const debugState = document.getElementById('debug-state');
  const debugExpression = document.getElementById('debug-expression');
  const debugVoice = document.getElementById('debug-voice');

  if (debug) debugPanel.classList.add('visible');

  // ── Load Assets ─────────────────────────────────
  let currentModel = null;

  async function loadAssets(modelName) {
    try {
      const url = modelName ? `/api/assets?model=${encodeURIComponent(modelName)}` : '/api/assets';
      const res = await fetch(url);
      assets = await res.json();
      currentModel = modelName || 'Default';
      console.log(`[overlay] Assets loaded for model "${currentModel}":`, assets);

      for (const [state, url] of Object.entries(assets)) {
        const layer = ensureLayer(state);

        const isVideo = url.endsWith('.webm') || url.endsWith('.mp4');
        if (isVideo) {
          const video = document.createElement('video');
          video.src = url;
          video.loop = true;
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          video.preload = 'auto';
          // Start playing but hidden
          video.play().catch(() => {});
          layer.appendChild(video);
        } else {
          const img = document.createElement('img');
          img.src = url;
          img.loading = 'eager';
          layer.appendChild(img);
        }
      }

      // Show initial state
      updateDisplay();
    } catch (e) {
      console.warn('[overlay] Failed to load assets:', e);
    }
  }

  // Clear all layers (for model switching)
  function clearLayers() {
    for (const layer of Object.values(layers)) {
      if (layer) layer.innerHTML = '';
    }
    // Also clear any active emote
    clearEmote();
    // Reset state so updateDisplay re-activates the right layer
    currentStateKey = null;
  }

  // ── Emote System ───────────────────────────────
  function loadEmoteAsset(url, loop = false) {
    const oldChildren = [...emoteLayer.children];
    const ext = url.split('.').pop().toLowerCase();

    function removeOld() {
      oldChildren.forEach(c => c.remove());
    }

    // Shared styles: position absolutely within the layer so old+new stack
    // on top of each other (not side-by-side in flex layout)
    function applyAbsoluteStyles(el) {
      el.style.position = 'absolute';
      el.style.bottom = '0';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.height = '100%';
      el.style.width = 'auto';
      el.style.maxWidth = 'none';
    }

    if (['webm', 'mp4'].includes(ext)) {
      const video = document.createElement('video');
      video.src = url;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.loop = loop;
      video.preload = 'auto';
      applyAbsoluteStyles(video);

      // Append new element immediately (stacks on top of old)
      emoteLayer.appendChild(video);

      // Remove old content once first frame is ready
      video.addEventListener('loadeddata', removeOld, { once: true });
      // Fallback: only remove old if new video has actually loaded.
      // On cold cache the new video may take >150ms to fetch — don't
      // yank the old content out from under it, let loadeddata handle it.
      setTimeout(() => {
        if (oldChildren[0]?.parentElement && video.readyState >= 2) {
          removeOld();
        }
      }, 150);

      video.play().catch(() => {});
      return video;
    } else {
      const img = document.createElement('img');
      img.src = url;
      applyAbsoluteStyles(img);

      emoteLayer.appendChild(img);
      img.onload = removeOld;
      setTimeout(() => {
        if (oldChildren[0]?.parentElement && img.complete && img.naturalWidth > 0) {
          removeOld();
        }
      }, 150);

      return img;
    }
  }

  // ── SFX Volume ─────────────────────────────────
  let sfxVolume = 1; // 0-1, controlled by control panel
  let activeSounds = []; // Track one-shot sounds so we can kill them

  // Helper: play a sound URL if present (tracked for cleanup)
  function playSound(url) {
    if (!url || sfxVolume === 0) return;
    try {
      const a = new Audio(url);
      a.volume = sfxVolume;
      a.addEventListener('ended', () => {
        const idx = activeSounds.indexOf(a);
        if (idx !== -1) activeSounds.splice(idx, 1);
      }, { once: true });
      // Clean up if audio fails to load/play
      a.addEventListener('error', () => {
        const idx = activeSounds.indexOf(a);
        if (idx !== -1) activeSounds.splice(idx, 1);
      }, { once: true });
      activeSounds.push(a);
      a.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // Helper: stop all tracked one-shot sounds immediately
  function stopAllSounds() {
    activeSounds.forEach(a => {
      a.pause();
      a.currentTime = 0;
    });
    activeSounds = [];
  }

  // ── Web Audio API for looping sounds (crossfade loop) ──
  let audioCtx = null;
  let subIdleLoadId = 0; // Incremented to invalidate stale async loads
  let subIdleActive = false;
  let subIdleNodes = [];  // Track all active sources/gains for cleanup
  let subIdleBuffer = null;
  let subIdleTimers = []; // Track scheduled timeouts

  const CROSSFADE_MS = 800; // Crossfade duration in ms

  function startSubIdleAudio(url) {
    stopSubIdleAudio();
    if (!url || sfxVolume === 0) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const loadId = ++subIdleLoadId;
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => audioCtx.decodeAudioData(buf))
      .then(decoded => {
        if (loadId !== subIdleLoadId) return;
        subIdleBuffer = decoded;
        subIdleActive = true;
        scheduleLoop(0); // Start first iteration immediately
      })
      .catch(() => {});
  }

  function scheduleLoop(startDelay) {
    if (!subIdleActive || !subIdleBuffer || !audioCtx) return;

    const duration = subIdleBuffer.duration;
    const crossfadeSec = CROSSFADE_MS / 1000;
    // Don't crossfade if the sound is too short
    const useCrossfade = duration > crossfadeSec * 3;
    const fadeTime = useCrossfade ? crossfadeSec : 0;

    const now = audioCtx.currentTime + startDelay;

    // Create source + gain for this iteration
    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    source.buffer = subIdleBuffer;
    source.connect(gain);
    gain.connect(audioCtx.destination);

    // Fade in
    if (fadeTime > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(sfxVolume, now + fadeTime);
    } else {
      gain.gain.setValueAtTime(sfxVolume, now);
    }

    // Fade out before end
    if (fadeTime > 0) {
      const fadeOutStart = now + duration - fadeTime;
      gain.gain.setValueAtTime(sfxVolume, fadeOutStart);
      gain.gain.linearRampToValueAtTime(0, now + duration);
    }

    source.start(now);
    source.stop(now + duration);

    // Track for cleanup
    subIdleNodes.push({ source, gain });

    // Clean up finished nodes
    source.onended = () => {
      try { source.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
      subIdleNodes = subIdleNodes.filter(n => n.source !== source);
    };

    // Schedule next iteration to start when fade-out begins (so they overlap)
    const nextDelay = Math.max(100, (duration - fadeTime) * 1000); // Min 100ms to prevent timer flooding
    if (nextDelay > 0) {
      const timer = setTimeout(() => {
        subIdleTimers = subIdleTimers.filter(t => t !== timer);
        if (subIdleActive) scheduleLoop(0);
      }, (startDelay * 1000) + nextDelay);
      subIdleTimers.push(timer);
    }
  }

  function stopSubIdleAudio() {
    subIdleLoadId++;
    subIdleActive = false;
    subIdleBuffer = null;
    // Clear all scheduled loops
    for (const t of subIdleTimers) clearTimeout(t);
    subIdleTimers = [];
    // Stop all active sources
    for (const node of subIdleNodes) {
      try { node.source.stop(0); } catch (e) {}
      try { node.source.disconnect(); } catch (e) {}
      try { node.gain.disconnect(); } catch (e) {}
    }
    subIdleNodes = [];
  }

  function handleEmoteTrigger(emote) {
    if (emoteState !== 'inactive') clearEmote(true); // true = skip deferred layer clear (we're about to load new content)
    activeEmote = emote;
    const files = emote.files || {};

    if (emote.emoteType === 1) {
      // Type 1: one-shot animation
      emoteState = 'active';
      const url = files.animation;
      if (!url) { clearEmote(); return; }

      // Play animation sound effect
      playSound(files.animation_sound);

      const el = loadEmoteAsset(url, false);
      const ext = url.split('.').pop().toLowerCase();

      if (['webm', 'mp4'].includes(ext)) {
        el.addEventListener('ended', () => clearEmote(), { once: true });
        // Wait for first frame before showing emote layer
        el.addEventListener('loadeddata', () => {
          emoteLayer.classList.add('active');
          updateDisplay();
        }, { once: true });
      } else {
        // GIF/image: show on load, auto-clear after duration (default 3s)
        emoteGifTimeout = setTimeout(() => clearEmote(), emote.duration || 3000);
        el.onload = () => { emoteLayer.classList.add('active'); updateDisplay(); };
      }
      console.log(`[emote] Type 1 trigger: ${emote.name}`);

    } else if (emote.emoteType === 2) {
      // Type 2: intro → idle loop (→ outro on release)

      // Helper: pick a random variant from array or use fallback
      const pickVar = (variants, fallback) => {
        if (variants && variants.length > 0) {
          const idx = Math.floor(Math.random() * variants.length);
          return { url: variants[idx], idx };
        }
        return fallback ? { url: fallback, idx: 0 } : null;
      };
      const pickSndByIdx = (variants, fallback, idx) => {
        if (variants && variants.length > 0) {
          return variants[idx < variants.length ? idx : Math.floor(Math.random() * variants.length)];
        }
        return fallback || null;
      };

      // Pick intro variant
      const introPick = pickVar(files.intro_variants, files.intro);

      if (introPick?.url) {
        emoteState = 'intro';
        const el = loadEmoteAsset(introPick.url, false);

        // Preload idle + speaking assets while intro plays so they're
        // already in browser cache when the intro ends (prevents blank
        // frame flicker on cold cache / first trigger).
        const preloads = [];
        for (const preloadUrl of [files.idle, files.animation, files.speaking]) {
          if (!preloadUrl) continue;
          const ext = preloadUrl.split('.').pop().toLowerCase();
          if (['webm', 'mp4'].includes(ext)) {
            const pv = document.createElement('video');
            pv.preload = 'auto';
            pv.src = preloadUrl;
            pv.load();
            preloads.push(pv); // Hold reference to prevent GC during intro
          } else {
            const pi = new Image();
            pi.src = preloadUrl;
            preloads.push(pi);
          }
        }

        // Play paired intro sound
        const introSnd = pickSndByIdx(files.intro_sound_variants, files.intro_sound, introPick.idx);
        playSound(introSnd);

        // Wait for first frame before showing
        const activate = () => {
          emoteLayer.classList.add('active');
          updateDisplay();
        };
        const ext = introPick.url.split('.').pop().toLowerCase();
        if (['webm', 'mp4'].includes(ext)) {
          el.addEventListener('loadeddata', activate, { once: true });
        } else {
          el.onload = activate;
        }

        el.addEventListener('ended', () => {
          if (emoteState !== 'intro') return; // was cancelled
          emoteState = 'active';
          preloads.length = 0; // Release preload references
          const idleUrl = isSpeaking && files.speaking ? files.speaking : (files.idle || files.animation);
          if (idleUrl) loadEmoteAsset(idleUrl, true);
          console.log(`[emote] Intro ended, entering idle loop`);
        }, { once: true });

        const varCount = files.intro_variants?.length || 1;
        console.log(`[emote] Type 2 trigger with intro: ${emote.name} (variant ${introPick.idx + 1}/${varCount})`);
      } else {
        // No intro — go straight to idle loop
        emoteState = 'active';
        const idleUrl = isSpeaking && files.speaking ? files.speaking : (files.idle || files.animation);
        if (idleUrl) {
          const el = loadEmoteAsset(idleUrl, true);
          const ext = idleUrl.split('.').pop().toLowerCase();
          if (['webm', 'mp4'].includes(ext)) {
            el.addEventListener('loadeddata', () => {
              emoteLayer.classList.add('active');
              updateDisplay();
            }, { once: true });
          } else {
            el.onload = () => { emoteLayer.classList.add('active'); updateDisplay(); };
          }
        }
        console.log(`[emote] Type 2 trigger (no intro): ${emote.name}`);
      }
    }
  }

  function handleEmoteRelease() {
    if (emoteState === 'inactive') return;
    const files = activeEmote?.files || {};

    // Helper: pick a random variant
    const pickVar = (variants, fallback) => {
      if (variants && variants.length > 0) {
        const idx = Math.floor(Math.random() * variants.length);
        return { url: variants[idx], idx };
      }
      return fallback ? { url: fallback, idx: 0 } : null;
    };
    const pickSndByIdx = (variants, fallback, idx) => {
      if (variants && variants.length > 0) {
        return variants[idx < variants.length ? idx : Math.floor(Math.random() * variants.length)];
      }
      return fallback || null;
    };

    // Play an outro animation and call onDone when finished
    const playOutro = (outroFiles, onDone) => {
      const outroPick = pickVar(outroFiles?.outro_variants, outroFiles?.outro);
      if (outroPick?.url) {
        const outroSnd = pickSndByIdx(outroFiles.outro_sound_variants, outroFiles.outro_sound, outroPick.idx);
        if (outroSnd) playSound(outroSnd);
        const el = loadEmoteAsset(outroPick.url, false);
        el.addEventListener('ended', onDone, { once: true });
        return true;
      }
      return false;
    };

    emoteState = 'outro';
    stopSubIdleAudio();

    // Unwind the sub stack: play each sub's outro in reverse, then parent outro
    const unwindStack = () => {
      if (subStack.length > 0) {
        const sub = subStack.pop();
        if (!playOutro(sub.files, unwindStack)) {
          unwindStack(); // No outro, continue unwinding
        } else {
          console.log(`[emote] Playing sub outro: ${sub.name}`);
        }
      } else {
        // Stack empty — play parent outro or clear
        if (!playOutro(files, () => clearEmote())) {
          clearEmote();
        } else {
          console.log(`[emote] Playing parent outro`);
        }
      }
    };

    unwindStack();
  }

  function clearEmote(skipLayerClear = false) {
    if (emoteGifTimeout) { clearTimeout(emoteGifTimeout); emoteGifTimeout = null; }
    emoteState = 'inactive';
    activeEmote = null;
    stopAllSounds();
    subStack = [];
    subAnimPlaying = false;
    stopSubIdleAudio();
    // Activate the correct expression layer first
    currentStateKey = null;
    updateDisplay();

    if (!skipLayerClear) {
      // Wait for the expression layer's video to render a frame before hiding
      // the emote layer — prevents flicker when the video was deprioritized.
      const activeExprLayer = Object.values(layers).find(l => l.classList.contains('active'));
      const video = activeExprLayer?.querySelector('video');

      const hideEmote = () => {
        emoteLayer.classList.remove('active');
        emoteLayer.innerHTML = '';
      };

      if (video && video.readyState < 3) {
        // Video hasn't rendered a frame yet — wait for it
        let hidden = false;
        const doHide = () => { if (!hidden) { hidden = true; hideEmote(); } };
        video.addEventListener('playing', doHide, { once: true });
        setTimeout(doHide, 150); // Fallback: don't hang forever
      } else {
        // Video already ready or image asset — one frame is enough
        requestAnimationFrame(hideEmote);
      }
    } else {
      // Immediate cleanup of old content (new emote is about to load)
      emoteLayer.innerHTML = '';
    }
    console.log(`[emote] Cleared, returning to expression tracking`);
  }

  function handleSubAnimation(sub) {
    // Only works during an active Type 2 emote
    if (emoteState !== 'active' || !activeEmote) return;

    // Helper: pick a random item from an array (or fallback to single value)
    const pickVariant = (variants, fallback) => {
      if (variants && variants.length > 0) {
        const idx = Math.floor(Math.random() * variants.length);
        return { url: variants[idx], idx };
      }
      return fallback ? { url: fallback, idx: 0 } : null;
    };

    // Helper: pick a sound variant matching a given index
    const pickSoundByIdx = (variants, fallback, idx) => {
      if (variants && variants.length > 0) {
        return variants[idx < variants.length ? idx : Math.floor(Math.random() * variants.length)];
      }
      return fallback || null;
    };

    // Helper: get the current parent's files (top of stack or emote itself)
    const getParentFiles = () => {
      if (subStack.length > 0) return subStack[subStack.length - 1].files || {};
      return activeEmote.files || {};
    };

    // Helper: load the parent's idle animation
    const returnToParentIdle = () => {
      const parentFiles = getParentFiles();
      const idleUrl = isSpeaking && parentFiles.speaking ? parentFiles.speaking : parentFiles.idle;
      if (idleUrl) loadEmoteAsset(idleUrl, true);
      // Restart parent's idle sound if it has one
      startSubIdleAudio(parentFiles.idle_sound || null);
    };

    const activeSub = subStack.length > 0 ? subStack[subStack.length - 1] : null;

    // Toggle: if same sub is on top of stack, pop it (return to parent idle)
    if (activeSub && activeSub.name === sub.name) {
      stopAllSounds();
      stopSubIdleAudio();

      const outroPick = pickVariant(sub.files?.outro_variants, sub.files?.outro);
      const outroSound = outroPick
        ? pickSoundByIdx(sub.files?.outro_sound_variants, sub.files?.outro_sound, outroPick.idx)
        : sub.files?.outro_sound;
      if (outroSound) playSound(outroSound);

      subStack.pop(); // Remove from stack

      if (outroPick?.url) {
        subAnimPlaying = true;
        const el = loadEmoteAsset(outroPick.url, false);
        el.addEventListener('ended', () => {
          subAnimPlaying = false;
          if (emoteState !== 'active' || !activeEmote) return;
          returnToParentIdle();
          console.log(`[emote] Sub outro done, returned to parent idle (stack depth: ${subStack.length})`);
        }, { once: true });
      } else {
        returnToParentIdle();
      }
      console.log(`[emote] Deactivating sub: ${sub.name} (stack depth: ${subStack.length})`);
      return;
    }

    // New sub — push onto stack
    const animPick = pickVariant(sub.files?.animation_variants, sub.files?.animation);
    const url = animPick?.url || null;
    const hasSubIdle = !!(sub.files?.idle);

    if (!url && !hasSubIdle) return;

    // Play sound effect
    const introSound = animPick
      ? pickSoundByIdx(sub.files?.sound_variants, sub.files?.sound, animPick.idx)
      : sub.files?.sound;
    if (introSound) playSound(introSound);

    if (animPick) {
      const variantCount = sub.files?.animation_variants?.length || 1;
      console.log(`[emote] Sub-animation: ${sub.name} (variant ${animPick.idx + 1}/${variantCount})`);
    }

    // Stop current sub's idle sound before transitioning
    stopSubIdleAudio();

    const enterSubIdle = () => {
      subAnimPlaying = false;
      if (emoteState !== 'active' || !activeEmote) return;
      if (hasSubIdle) {
        // Push sub onto stack
        subStack.push(sub);
        const idleUrl = isSpeaking && sub.files.speaking ? sub.files.speaking : sub.files.idle;
        if (idleUrl) loadEmoteAsset(idleUrl, true);
        startSubIdleAudio(sub.files?.idle_sound);
        console.log(`[emote] Entered sub-state: ${sub.name} (stack depth: ${subStack.length})`);
      } else {
        // No sub idle — return to current parent idle
        returnToParentIdle();
        console.log(`[emote] Sub-animation ended, returning to parent idle`);
      }
    };

    if (url) {
      subAnimPlaying = true;
      const el = loadEmoteAsset(url, false);
      const ext = url.split('.').pop().toLowerCase();
      if (['webm', 'mp4'].includes(ext)) {
        el.addEventListener('ended', enterSubIdle, { once: true });
      } else {
        setTimeout(enterSubIdle, 2000);
      }
    } else {
      enterSubIdle();
    }
  }

  // ── Expression Updates (from server/tracking) ───
  function handleExpression(data) {
    // Skip camera tracking when manual override is active
    if (stateOverride) return;

    const expr = data.expression;

    if (expr === 'eyes_closed') {
      if (!eyesClosedSince) eyesClosedSince = Date.now();
      if (Date.now() - eyesClosedSince >= CONFIG.eyesClosedDelayMs) {
        currentExpression = 'eyes_closed';
      }
      // Don't change expression until delay met
    } else {
      eyesClosedSince = null;
      currentExpression = expr;
    }

    updateDisplay();
  }

  // NOTE: Mic detection is handled by the Control Panel and sent
  // via WebSocket as {type:'speaking', speaking:bool}.
  // OBS browser sources can't access getUserMedia.

  // ── Display Update ──────────────────────────────
  function updateDisplay() {
    // Emotes have ABSOLUTE priority — override everything
    if (emoteState !== 'inactive') {
      // Only hide expression layers once the emote content is ready and visible.
      // The emote trigger's activate() callback adds 'active' to emoteLayer
      // after loadeddata/onload fires — until then, keep expression layers
      // visible as a fallback to prevent flash-to-nothing on cold cache.
      if (emoteLayer.classList.contains('active')) {
        for (const [key, layer] of Object.entries(layers)) {
          layer.classList.remove('active');
        }
      }
      if (debug) {
        debugState.textContent = `emote:${emoteState}`;
        debugExpression.textContent = `Emote: ${activeEmote?.name || '?'}`;
        debugVoice.textContent = `Voice: ${isSpeaking ? '🔊 Speaking' : '🔇 Idle'}`;
      }
      return;
    }

    let newStateKey;

    // Determine effective expression — override wins over camera tracking
    const effectiveExpression = stateOverride && stateOverride !== 'typing'
      ? stateOverride
      : currentExpression;
    const effectiveTyping = stateOverride === 'typing'
      ? true
      : (stateOverride ? false : isTyping); // Override suppresses mic typing

    if (effectiveExpression === 'eyes_closed') {
      newStateKey = 'eyes_closed';
    } else if (effectiveTyping && !isSpeaking && assets['typing']) {
      // Typing overrides expression (but speaking wins over typing)
      newStateKey = 'typing';
    } else {
      newStateKey = `${effectiveExpression}_${isSpeaking ? 'speaking' : 'idle'}`;
    }

    newStateKey = window.ASAPluginHost?.resolveDisplayState({
      baseStateKey: newStateKey,
      expression: effectiveExpression,
      speaking: isSpeaking,
      typing: effectiveTyping,
      assets
    }) || newStateKey;

    if (newStateKey === currentStateKey) return;

    const prevKey = currentStateKey;
    currentStateKey = newStateKey;

    // Instant swap with frame-ready gate:
    // Show new layer immediately, but keep old visible until
    // new layer's video has rendered a frame (prevents flash-to-nothing).
    const newLayer = layers[newStateKey];
    if (newLayer) {
      newLayer.classList.add('active');

      if (!CONFIG.crossfadeMode) {
        // Blur-pop mode: apply transition animation
        newLayer.classList.remove('transition-swap');
        void newLayer.offsetWidth; // Force reflow to restart animation
        newLayer.classList.add('transition-swap');
      }

      const video = newLayer.querySelector('video');
      if (video) {
        video.play().catch(() => {});

        // Wait for the video to actually render a FRESH frame before hiding
        // old layers. readyState alone is NOT enough — a browser-paused video
        // still reports readyState >= 3 while showing a stale freeze frame.
        const targetState = newStateKey; // Capture for closure
        const hideOld = () => {
          // Guard: if state changed since we started, don't touch layers
          if (currentStateKey !== targetState) return;
          for (const [key, layer] of Object.entries(layers)) {
            if (key !== targetState) {
              layer.classList.remove('active');
              // Pause hidden videos to free CPU (especially for lower-end PCs).
              // They'll be play()'d again when their layer becomes active.
              const v = layer.querySelector('video');
              if (v && !v.paused) v.pause();
            }
          }
        };

        // Video is actively playing AND has data → safe to swap immediately
        const isLive = !video.paused && video.readyState >= 3;

        if (CONFIG.crossfadeMode && CONFIG.swapDuration > 0) {
          if (isLive) {
            setTimeout(hideOld, CONFIG.swapDuration);
          } else {
            video.addEventListener('playing', () => {
              setTimeout(hideOld, CONFIG.swapDuration);
            }, { once: true });
            setTimeout(hideOld, CONFIG.swapDuration + 150);
          }
        } else {
          if (isLive) {
            hideOld();
          } else {
            // Wait for actual playback — 'playing' fires when the video
            // is genuinely advancing frames, not just buffered.
            video.addEventListener('playing', hideOld, { once: true });
            setTimeout(hideOld, 150); // Fallback
          }
        }
      } else {
        // Image asset
        if (CONFIG.crossfadeMode && CONFIG.swapDuration > 0) {
          // Delay hiding old layers for crossfade
          const targetState = newStateKey;
          setTimeout(() => {
            if (currentStateKey !== targetState) return;
            for (const [key, layer] of Object.entries(layers)) {
              if (key !== targetState) layer.classList.remove('active');
            }
          }, CONFIG.swapDuration);
        } else {
          // Instant swap
          for (const [key, layer] of Object.entries(layers)) {
            if (key !== newStateKey) layer.classList.remove('active');
          }
        }
      }
    }

    // Debug
    if (debug) {
      debugState.textContent = currentStateKey;
      debugExpression.textContent = `Expression: ${currentExpression}`;
      debugVoice.textContent = `Voice: ${isSpeaking ? '🔊 Speaking' : isTyping ? '⌨️ Typing' : '🔇 Idle'}`;
    }

    console.log(`[overlay] State: ${prevKey} → ${newStateKey}`);
  }

  // ── WebSocket Connection ────────────────────────
  function connectWS() {
    // Clean up old WebSocket to prevent zombie connections on reconnect
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch (e) {}
    }
    ws = new WebSocket(CONFIG.wsUrl);

    ws.onopen = () => {
      console.log('[ws] Connected');
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'expression') {
          handleExpression(data);
        } else if (data.type === 'speaking') {
          const wasSpeaking = isSpeaking;
          isSpeaking = data.speaking;
          isTyping = !!data.typing;
          // Swap emote speaking/idle assets when speaking state changes
          if (emoteState === 'active' && activeEmote?.emoteType === 2 && wasSpeaking !== isSpeaking && !subAnimPlaying) {
            // Use sub-animation files if a sub is active, otherwise parent emote
            const currentSub = subStack.length > 0 ? subStack[subStack.length - 1] : null;
            const files = currentSub ? (currentSub.files || {}) : (activeEmote.files || {});
            if (files.speaking && files.idle) {
              const assetUrl = isSpeaking ? files.speaking : files.idle;
              loadEmoteAsset(assetUrl, true);
            }
          }
          updateDisplay();
        } else if (data.type === 'config') {
          // Dynamic config updates
          if (data.eyesClosedDelayMs !== undefined) CONFIG.eyesClosedDelayMs = data.eyesClosedDelayMs;
          if (data.sfxVolume !== undefined) {
            sfxVolume = parseFloat(data.sfxVolume);
            // Update currently-playing looping audio
            for (const node of subIdleNodes) {
              try { node.gain.gain.setValueAtTime(sfxVolume, audioCtx.currentTime); } catch (e) {}
            }
          }
          if (data.swapDuration !== undefined) {
            CONFIG.swapDuration = parseInt(data.swapDuration, 10);
            document.getElementById('overlay-container')
              .style.setProperty('--swap-duration', CONFIG.swapDuration + 'ms');
          }
          if (data.crossfadeMode !== undefined) {
            CONFIG.crossfadeMode = !!data.crossfadeMode;
            document.getElementById('overlay-container')
              .classList.toggle('crossfade-mode', CONFIG.crossfadeMode);
          }
        } else if (data.type === 'model_change') {
          console.log(`[overlay] Model change: ${currentModel} → ${data.model}`);
          clearLayers();
          await loadAssets(data.model);
        } else if (data.type === 'state_override') {
          stateOverride = data.override; // null = auto, or expression name
          if (stateOverride) {
            // Force the expression, including typing/eyes_closed
            if (stateOverride === 'typing') {
              isTyping = true;
              currentExpression = 'neutral';
            } else if (stateOverride === 'eyes_closed') {
              currentExpression = 'eyes_closed';
            } else {
              isTyping = false;
              currentExpression = stateOverride;
            }
          }
          currentStateKey = null; // Force re-evaluation
          updateDisplay();
        } else if (data.type === 'plugin_event') {
          window.ASAPluginHost?.emitPluginEvent(data);
        } else if (data.type === 'emote') {
          if (data.action === 'trigger' && data.emote) {
            handleEmoteTrigger(data.emote);
          } else if (data.action === 'release') {
            handleEmoteRelease();
          } else if (data.action === 'sub' && data.sub) {
            handleSubAnimation(data.sub);
          }
        }
      } catch (e) {
        if (!(e instanceof SyntaxError)) console.warn('[ws] Message handler error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[ws] Disconnected, reconnecting...');
      setTimeout(connectWS, CONFIG.reconnectMs);
    };

    ws.onerror = (err) => {
      console.warn('[ws] Error:', err);
      ws.close();
    };
  }

  // ── Init ────────────────────────────────────────
  async function init() {
    console.log('[overlay] Initializing...');
    console.log('[overlay] Debug mode:', debug);
    window.ASAPluginHost?.setDisplayUpdater(updateDisplay);
    await loadAssets();
    connectWS();
    console.log('[overlay] Ready');
  }

  init();
})();
