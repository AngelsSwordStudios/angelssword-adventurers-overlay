const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const dgram = require('dgram');
const path = require('path');
const fs = require('fs');

// When compiled with pkg, __dirname points to a virtual snapshot filesystem.
// Use the exe's real directory for static files (public/, assets/).
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 }); // 64KB max message

// ── Config ──────────────────────────────────────────
const PREFERRED_PORT = 3000;
const MAX_PORT_ATTEMPTS = 10;   // Try 3000-3009
let PORT = PREFERRED_PORT;
const VTS_SEND_PORT = 21412;   // Port to SEND requests to VTS iPhone
const VTS_RECV_PORT = 11125;   // Port to RECEIVE tracking data from VTS
const IFACIAL_PORT = 49983;
let DEBUG_UDP = true;          // Log raw UDP packets for debugging
const ASSETS_DIR = path.join(APP_DIR, 'public', 'assets');

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// ── Serve static files ──────────────────────────────
app.use(express.static(path.join(APP_DIR, 'public')));
app.use(express.json({ limit: '16kb' }));

// ── Shared: state names and extensions ──────────────
const STATE_NAMES = [
  'neutral_idle', 'neutral_speaking',
  'happy_idle', 'happy_speaking',
  'sad_idle', 'sad_speaking',
  'surprised_idle', 'surprised_speaking',
  'typing',
  'eyes_closed'
];
const ASSET_EXTENSIONS = ['.webm', '.webp', '.gif', '.png', '.mp4'];
const SOUND_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];

let activeModel = 'Default'; // Current model name
let activeEmote = null;      // Currently active emote

// Resolve model directory path from model name (with path traversal protection)
function getModelDir(modelName) {
  const name = modelName || activeModel;
  if (name === 'Default') return ASSETS_DIR;
  const resolved = path.resolve(ASSETS_DIR, path.basename(name));
  // Ensure resolved path is inside ASSETS_DIR
  if (!resolved.startsWith(ASSETS_DIR)) return ASSETS_DIR;
  return resolved;
}

// Scan a directory for state assets
function scanModelAssets(modelDir, urlPrefix) {
  const assets = {};
  for (const state of STATE_NAMES) {
    for (const ext of ASSET_EXTENSIONS) {
      const filePath = path.join(modelDir, state + ext);
      if (fs.existsSync(filePath)) {
        assets[state] = `${urlPrefix}${state}${ext}`;
        break;
      }
    }
  }
  return assets;
}

// Scan a directory for sub-animations (recursive — subs can have their own subs)
function scanSubs(parentDir, parentUrlPath, depth = 0) {
  const MAX_DEPTH = 5; // Safety limit
  if (depth >= MAX_DEPTH) return [];

  const subsDir = path.join(parentDir, 'subs');
  if (!fs.existsSync(subsDir)) return [];

  const subs = [];
  try {
    const subEntries = fs.readdirSync(subsDir, { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) continue;
      const subDir = path.join(subsDir, subEntry.name);
      const subFiles = {};
      const subUrlPath = `${parentUrlPath}/subs/${encodeURIComponent(subEntry.name)}`;

      // Helper: build URL for a file in this sub directory
      const subUrl = (fileName, ext) => `${subUrlPath}/${fileName}${ext}`;

      // Helper: find a file with any supported extension
      const findFile = (baseName, extensions) => {
        for (const ext of extensions) {
          if (fs.existsSync(path.join(subDir, baseName + ext))) {
            return { url: subUrl(baseName, ext), ext };
          }
        }
        return null;
      };

      // Helper: scan for base + numbered variants
      const scanVariants = (baseNames, extensions, maxVariants = 20) => {
        const variants = [];
        let activeName = null;
        for (const name of baseNames) {
          const found = findFile(name, extensions);
          if (found) { activeName = name; variants.push(found.url); break; }
        }
        if (!activeName) return variants;
        for (let i = 2; i <= maxVariants; i++) {
          const found = findFile(activeName + i, extensions);
          if (found) variants.push(found.url);
          else break;
        }
        return variants;
      };

      // Helper: scan sound variants — supports both "intro_sound2" and "intro2_sound"
      const scanSoundVariants = (baseNames, extensions, maxVariants = 20) => {
        const variants = [];
        let activeName = null;
        for (const name of baseNames) {
          const found = findFile(name, extensions);
          if (found) { activeName = name; variants.push(found.url); break; }
        }
        if (!activeName) return variants;
        const parts = activeName.split('_');
        for (let i = 2; i <= maxVariants; i++) {
          const nameA = activeName + i;
          const nameB = parts.length >= 2 ? parts[0] + i + '_' + parts.slice(1).join('_') : null;
          const foundA = findFile(nameA, extensions);
          const foundB = nameB ? findFile(nameB, extensions) : null;
          if (foundA) variants.push(foundA.url);
          else if (foundB) variants.push(foundB.url);
          else break;
        }
        return variants;
      };

      // ── Scan idle (no variants — it loops) ──
      const idleFile = findFile('idle', ASSET_EXTENSIONS);
      if (idleFile) subFiles.idle = idleFile.url;

      // ── Scan speaking ──
      for (const fileName of ['speaking', 'idle_speaking']) {
        const found = findFile(fileName, ASSET_EXTENSIONS);
        if (found) { subFiles.speaking = found.url; break; }
      }

      // ── Scan animation/intro with variants ──
      const animVariants = scanVariants(['animation', 'intro'], ASSET_EXTENSIONS);
      if (animVariants.length > 0) {
        subFiles.animation = animVariants[0];
        if (animVariants.length > 1) subFiles.animation_variants = animVariants;
      }

      // ── Scan outro with variants ──
      const outroVariants = scanVariants(['outro'], ASSET_EXTENSIONS);
      if (outroVariants.length > 0) {
        subFiles.outro = outroVariants[0];
        if (outroVariants.length > 1) subFiles.outro_variants = outroVariants;
      }

      // ── Scan intro/sound with variants ──
      const soundVariants = scanSoundVariants(['intro_sound', 'sound'], SOUND_EXTENSIONS);
      if (soundVariants.length > 0) {
        subFiles.sound = soundVariants[0];
        if (soundVariants.length > 1) subFiles.sound_variants = soundVariants;
      }

      // ── Scan outro_sound with variants ──
      const outroSoundVariants = scanSoundVariants(['outro_sound'], SOUND_EXTENSIONS);
      if (outroSoundVariants.length > 0) {
        subFiles.outro_sound = outroSoundVariants[0];
        if (outroSoundVariants.length > 1) subFiles.outro_sound_variants = outroSoundVariants;
      }

      // ── Scan idle_sound (no variants — it loops) ──
      const idleSoundFile = findFile('idle_sound', SOUND_EXTENSIONS);
      if (idleSoundFile) subFiles.idle_sound = idleSoundFile.url;

      if (subFiles.animation || subFiles.idle) {
        // Recursively scan for nested subs
        const nestedSubs = scanSubs(subDir, subUrlPath, depth + 1);
        subs.push({ name: subEntry.name, files: subFiles, subs: nestedSubs });
      }
    }
  } catch (e) { /* ignore */ }
  return subs;
}

// Scan a model directory for emotes
const EMOTE_FILE_NAMES = ['animation', 'intro', 'idle', 'speaking', 'outro'];

function scanEmotes(modelDir) {
  const emotesDir = path.join(modelDir, 'emotes');
  if (!fs.existsSync(emotesDir)) return [];

  // Build URL prefix from modelDir
  const modelName = path.basename(modelDir);
  const isRoot = modelDir === ASSETS_DIR;
  const urlBase = isRoot
    ? '/assets/emotes/'
    : `/assets/${encodeURIComponent(modelName)}/emotes/`;

  const emotes = [];
  let entries;
  try {
    entries = fs.readdirSync(emotesDir, { withFileTypes: true });
  } catch (e) {
    console.warn('[emotes] Could not scan emotes directory:', e.message);
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const emoteDir = path.join(emotesDir, entry.name);
    const files = {};

    for (const fileName of EMOTE_FILE_NAMES) {
      for (const ext of ASSET_EXTENSIONS) {
        const filePath = path.join(emoteDir, fileName + ext);
        if (fs.existsSync(filePath)) {
          files[fileName] = `${urlBase}${encodeURIComponent(entry.name)}/${fileName}${ext}`;
          break;
        }
      }
    }

    // Helper: find a file with any supported extension in the emote dir
    const emoteUrl = (fileName, ext) =>
      `${urlBase}${encodeURIComponent(entry.name)}/${fileName}${ext}`;

    const findEmoteFile = (baseName, extensions) => {
      for (const ext of extensions) {
        if (fs.existsSync(path.join(emoteDir, baseName + ext))) {
          return { url: emoteUrl(baseName, ext), ext };
        }
      }
      return null;
    };

    // Scan for numbered variants of a file (e.g. intro, intro2, intro3...)
    const scanEmoteVariants = (baseNames, extensions, maxVariants = 20) => {
      const variants = [];
      let activeName = null;
      for (const name of baseNames) {
        const found = findEmoteFile(name, extensions);
        if (found) {
          activeName = name;
          variants.push(found.url);
          break;
        }
      }
      if (!activeName) return variants;
      for (let i = 2; i <= maxVariants; i++) {
        const found = findEmoteFile(activeName + i, extensions);
        if (found) variants.push(found.url);
        else break;
      }
      return variants;
    };

    // Scan for sound variants — supports both "intro_sound2" and "intro2_sound" naming
    const scanSoundVariants = (baseNames, extensions, maxVariants = 20) => {
      const variants = [];
      let activeName = null;
      for (const name of baseNames) {
        const found = findEmoteFile(name, extensions);
        if (found) {
          activeName = name;
          variants.push(found.url);
          break;
        }
      }
      if (!activeName) return variants;
      // Try both conventions: intro_sound2 and intro2_sound
      const parts = activeName.split('_');
      for (let i = 2; i <= maxVariants; i++) {
        // Convention 1: intro_sound2, outro_sound2
        const nameA = activeName + i;
        // Convention 2: intro2_sound, outro2_sound
        const nameB = parts.length >= 2 ? parts[0] + i + '_' + parts.slice(1).join('_') : null;
        const foundA = findEmoteFile(nameA, extensions);
        const foundB = nameB ? findEmoteFile(nameB, extensions) : null;
        if (foundA) variants.push(foundA.url);
        else if (foundB) variants.push(foundB.url);
        else break;
      }
      return variants;
    };

    // ── Scan intro variants ──
    const introVariants = scanEmoteVariants(['intro'], ASSET_EXTENSIONS);
    if (introVariants.length > 1) files.intro_variants = introVariants;

    // ── Scan outro variants ──
    const outroVariants = scanEmoteVariants(['outro'], ASSET_EXTENSIONS);
    if (outroVariants.length > 1) files.outro_variants = outroVariants;

    // ── Scan sound variants (intro_sound, outro_sound, animation_sound) ──
    for (const soundBase of ['intro_sound', 'outro_sound', 'animation_sound']) {
      // Find base sound
      for (const ext of SOUND_EXTENSIONS) {
        const filePath = path.join(emoteDir, soundBase + ext);
        if (fs.existsSync(filePath)) {
          files[soundBase] = `${urlBase}${encodeURIComponent(entry.name)}/${soundBase}${ext}`;
          break;
        }
      }
      // Find variants
      const soundVars = scanSoundVariants([soundBase], SOUND_EXTENSIONS);
      if (soundVars.length > 1) files[soundBase + '_variants'] = soundVars;
    }

    // Determine emote type
    let emoteType = null;
    if (files.animation) {
      emoteType = 1; // One-shot
    } else if (files.idle) {
      emoteType = 2; // State change
    }

    // Log detected variants
    if (files.intro_variants) console.log(`[emotes] ${entry.name}: ${files.intro_variants.length} intro variants`);
    if (files.outro_variants) console.log(`[emotes] ${entry.name}: ${files.outro_variants.length} outro variants`);
    if (files.intro_sound_variants) console.log(`[emotes] ${entry.name}: ${files.intro_sound_variants.length} intro_sound variants`);
    if (files.outro_sound_variants) console.log(`[emotes] ${entry.name}: ${files.outro_sound_variants.length} outro_sound variants`);

    if (emoteType !== null) {
      // Scan for sub-animations recursively
      const subs = scanSubs(emoteDir, `${urlBase}${encodeURIComponent(entry.name)}`);
      emotes.push({ name: entry.name, emoteType, files, subs });
    }
  }

  return emotes;
}

// ── API: List available models ──────────────────────
app.get('/api/models', (req, res) => {
  const models = [];

  // Check for root-level assets (backward compat → "Default" model)
  const rootAssets = scanModelAssets(ASSETS_DIR, '/assets/');
  if (Object.keys(rootAssets).length > 0) {
    models.push({ name: 'Default', assetCount: Object.keys(rootAssets).length });
  }

  // Scan subfolders as named models
  try {
    const entries = fs.readdirSync(ASSETS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const modelDir = path.join(ASSETS_DIR, entry.name);
        const modelAssets = scanModelAssets(modelDir, `/assets/${encodeURIComponent(entry.name)}/`);
        if (Object.keys(modelAssets).length > 0) {
          models.push({ name: entry.name, assetCount: Object.keys(modelAssets).length });
        }
      }
    }
  } catch (e) {
    console.warn('[models] Could not scan asset directories:', e.message);
  }

  res.json({ models, active: activeModel });
});

// ── API: List assets for a model ────────────────────
app.get('/api/assets', (req, res) => {
  const modelName = req.query.model || activeModel;

  let assets;
  if (modelName === 'Default') {
    assets = scanModelAssets(ASSETS_DIR, '/assets/');
  } else {
    const modelDir = path.join(ASSETS_DIR, modelName);
    if (fs.existsSync(modelDir)) {
      assets = scanModelAssets(modelDir, `/assets/${encodeURIComponent(modelName)}/`);
    } else {
      assets = {};
    }
  }
  res.json(assets);
});

// ── API: Select active model ────────────────────────
app.post('/api/models/select', (req, res) => {
  const { model } = req.body;
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model name required' });
  // Sanitize: strip path components, limit length
  const sanitized = path.basename(model).substring(0, 100);
  if (!sanitized) return res.status(400).json({ error: 'invalid model name' });
  activeModel = sanitized;
  console.log(`[model] Switched to: ${activeModel}`);

  // Broadcast model change to all overlay clients
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'model_change', model: activeModel }));
    }
  }

  res.json({ success: true, active: activeModel });
});

// ── API: Emotes ─────────────────────────────────────
app.get('/api/emotes', (req, res) => {
  const modelDir = getModelDir(activeModel);
  const emotes = scanEmotes(modelDir);
  res.json(emotes);
});

app.post('/api/emote/trigger', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'emote name required' });

  const modelDir = getModelDir(activeModel);

  const emotes = scanEmotes(modelDir);
  const emote = emotes.find(e => e.name === name);
  if (!emote) return res.status(404).json({ error: `emote '${name}' not found` });

  activeEmote = emote;
  console.log(`[emote] Triggered: ${name} (type ${emote.emoteType})`);
  broadcastAll({ type: 'emote', action: 'trigger', name, emote });
  res.json({ success: true, emote });
});

app.post('/api/emote/release', (req, res) => {
  console.log(`[emote] Released: ${activeEmote ? activeEmote.name : '(none)'}`);
  activeEmote = null;
  broadcastAll({ type: 'emote', action: 'release' });
  res.json({ success: true });
});

app.post('/api/emote/sub', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'sub-animation name required' });
  if (!activeEmote) return res.status(400).json({ error: 'no emote is active' });

  // Support nested paths: "ignition/slash" walks emote → ignition → slash
  const parts = name.split('/');
  let currentSubs = activeEmote.subs || [];
  let sub = null;
  const pathParts = [];

  for (const part of parts) {
    sub = currentSubs.find(s => s.name === part);
    if (!sub) return res.status(404).json({ error: `sub-animation '${part}' not found at path '${pathParts.join('/')}'` });
    pathParts.push(part);
    currentSubs = sub.subs || [];
  }

  console.log(`[emote] Sub-animation: ${activeEmote.name} → ${name}`);
  broadcastAll({ type: 'emote', action: 'sub', sub, parentEmote: activeEmote.name });
  res.json({ success: true, sub });
});

// ── WebSocket connections ───────────────────────────
const clients = new Set();

wss.on('connection', (ws, req) => {
  // Connection limit
  if (clients.size >= 50) {
    ws.close(1013, 'too many connections');
    return;
  }

  // Origin validation — only allow localhost connections
  const origin = req.headers.origin || '';
  if (origin && !origin.match(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/)) {
    console.warn(`[ws] Rejected connection from origin: ${origin}`);
    ws.close(1008, 'origin not allowed');
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const rawType = url.searchParams.get('type') || 'overlay';
  const clientType = ['overlay', 'control'].includes(rawType) ? rawType : 'overlay';

  ws.clientType = clientType;
  ws.isAlive = true;
  ws._msgCount = 0;
  ws._msgResetTime = Date.now();
  clients.add(ws);
  console.log(`[ws] ${clientType} connected (${clients.size} total)`);

  ws.on('message', (data) => {
    try {
      // Rate limit: max 120 messages/second per client
      const now = Date.now();
      if (now - ws._msgResetTime > 1000) { ws._msgCount = 0; ws._msgResetTime = now; }
      if (++ws._msgCount > 120) return;

      const msg = JSON.parse(data);
      // Control panel sending data → forward to overlays
      if (ws.clientType === 'control') {
        if (msg.type === 'expression' || msg.type === 'speaking' || msg.type === 'config' || msg.type === 'emote' || msg.type === 'state_override') {
          broadcast(msg, 'overlay');
        }
        // Webcam tracking: process through the same pipeline as VTS/iFacial
        if (msg.type === 'webcam_tracking' && msg.blendShapes) {
          const result = detectExpression(msg.blendShapes);
          const trackingData = {
            type: 'expression',
            ...result,
            source: 'webcam'
          };
          throttledBroadcast(trackingData);
        }
      }
    } catch (e) { /* ignore malformed */ }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] ${clientType} disconnected (${clients.size} total)`);
  });

  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat to clean dead connections
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

function broadcast(data, targetType) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1 && (!targetType || client.clientType === targetType)) {
      client.send(msg);
    }
  }
}

// Broadcast to ALL clients (both overlay and control)
function broadcastAll(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// ── Expression Detection ────────────────────────────
// Thresholds (can be adjusted via control panel)
let thresholds = {
  smile: 20,
  frown: 25,
  surprised: 25,
  eyesClosed: 55
};

function detectExpression(blendShapes) {
  // Helper that tries multiple key name conventions
  const get = (...names) => {
    for (const name of names) {
      if (blendShapes[name] !== undefined) return blendShapes[name];
    }
    return 0;
  };

  // ── Raw blend shape values ───────────────────────
  // Eyes
  const eyeBlinkL   = get('EyeBlinkLeft',    'eyeBlink_L',    'eyeBlinkLeft');
  const eyeBlinkR   = get('EyeBlinkRight',   'eyeBlink_R',   'eyeBlinkRight');
  const eyeSquintL  = get('EyeSquintLeft',   'eyeSquint_L',  'eyeSquintLeft');
  const eyeSquintR  = get('EyeSquintRight',  'eyeSquint_R',  'eyeSquintRight');
  const eyeWideL    = get('EyeWideLeft',     'eyeWide_L',    'eyeWideLeft');
  const eyeWideR    = get('EyeWideRight',    'eyeWide_R',    'eyeWideRight');

  // Brows
  const browDownL   = get('BrowDownLeft',    'browDown_L',    'browDownLeft');
  const browDownR   = get('BrowDownRight',   'browDown_R',   'browDownRight');
  const browInnerUp = get('BrowInnerUp',     'browInnerUp',  'browInner_Up');
  const browOuterL  = get('BrowOuterUpLeft', 'browOuterUp_L','browOuterUpLeft');
  const browOuterR  = get('BrowOuterUpRight','browOuterUp_R','browOuterUpRight');

  // Cheeks (strongest genuine smile indicator)
  const cheekSquintL = get('CheekSquintLeft',  'cheekSquint_L', 'cheekSquintLeft');
  const cheekSquintR = get('CheekSquintRight', 'cheekSquint_R', 'cheekSquintRight');

  // Mouth
  const mouthSmileL = get('MouthSmileLeft',  'mouthSmile_L', 'mouthSmileLeft');
  const mouthSmileR = get('MouthSmileRight', 'mouthSmile_R', 'mouthSmileRight');
  const mouthFrownL = get('MouthFrownLeft',  'mouthFrown_L', 'mouthFrownLeft');
  const mouthFrownR = get('MouthFrownRight', 'mouthFrown_R', 'mouthFrownRight');
  const jawOpen     = get('JawOpen',         'jawOpen',      'jaw_Open');
  const mouthFunnel = get('MouthFunnel',     'mouthFunnel',  'mouth_Funnel');

  // ── Composite scores ─────────────────────────────
  const eyesClosed = (eyeBlinkL + eyeBlinkR) / 2;

  // Happy: cheek squint (Duchenne marker) + eye squint + mouth smile
  const cheekSquint = (cheekSquintL + cheekSquintR) / 2;
  const eyeSquint   = (eyeSquintL + eyeSquintR) / 2;
  const mouthSmile  = (mouthSmileL + mouthSmileR) / 2;
  const smile = (cheekSquint * 0.45) + (eyeSquint * 0.35) + (mouthSmile * 0.20);

  // Sad: brow furrow + inner brow raise + mouth frown
  const browDown    = (browDownL + browDownR) / 2;
  const mouthFrown  = (mouthFrownL + mouthFrownR) / 2;
  const frown = (browDown * 0.40) + (browInnerUp * 0.30) + (mouthFrown * 0.30);

  // Surprised: eyes wide open + jaw open (O-mouth) + raised brows
  // These are the OPPOSITE of happy (wide eyes vs squint, open mouth vs smile)
  const eyeWide   = (eyeWideL + eyeWideR) / 2;
  const browUp    = ((browOuterL + browOuterR) / 2 + browInnerUp) / 2;
  const surprised = (eyeWide * 0.35) + (jawOpen * 0.35) + (browUp * 0.15) + (mouthFunnel * 0.15);

  // ── Expression priority: eyes_closed > surprised > happy > sad > neutral
  if (eyesClosed > thresholds.eyesClosed) {
    return { expression: 'eyes_closed', confidence: eyesClosed, smile, frown, surprised, eyesClosed };
  }
  if (surprised > thresholds.surprised && surprised > smile && surprised > frown) {
    return { expression: 'surprised', confidence: surprised, smile, frown, surprised, eyesClosed };
  }
  if (smile > thresholds.smile && smile > frown) {
    return { expression: 'happy', confidence: smile, smile, frown, surprised, eyesClosed };
  }
  if (frown > thresholds.frown && frown > smile) {
    return { expression: 'sad', confidence: frown, smile, frown, surprised, eyesClosed };
  }
  return { expression: 'neutral', confidence: 100, smile, frown, surprised, eyesClosed };
}

// ── iFacialMocap Parser ─────────────────────────────
function parseIFacialMocap(data) {
  const str = data.toString('utf-8').trim();
  const blendShapes = {};

  // iFacialMocap format: "blendShapeName-value|blendShapeName-value|...=head|rx#val|ry#val..."
  // Split on the = sign first to separate blend shapes from head rotation
  const mainPart = str.split('=')[0];
  if (!mainPart) return blendShapes;

  const parts = mainPart.split('|');
  for (const part of parts) {
    if (!part || part.includes('#')) continue;
    const dashIdx = part.lastIndexOf('-');
    if (dashIdx > 0) {
      const name = part.substring(0, dashIdx);
      const value = parseFloat(part.substring(dashIdx + 1));
      if (!isNaN(value) && name.length > 0) {
        blendShapes[name] = value;  // iFacialMocap values are already 0-100
      }
    }
  }
  return blendShapes;
}

// ── VTube Studio Parser ─────────────────────────────
function parseVTubeStudio(data) {
  try {
    const json = JSON.parse(data.toString('utf-8'));

    // VTS uses PascalCase: "BlendShapes", "FaceFound", etc.
    // Check for face found (case-insensitive)
    const faceFound = json.FaceFound ?? json.faceFound;
    if (faceFound === false) return null; // No face detected

    // Find blend shapes array/object (try both cases)
    const rawBS = json.BlendShapes || json.blendShapes;

    if (rawBS && typeof rawBS === 'object') {
      const bs = {};

      if (Array.isArray(rawBS)) {
        // VTS sends array of {k: "name", v: value} objects
        for (const item of rawBS) {
          const key = item.k ?? item.key ?? item.name ?? item.K;
          // Use ?? for val since 0 is a valid value but || would skip it
          const val = item.v ?? item.value ?? item.V ?? 0;
          if (key !== undefined && key !== null) {
            // VTS values are 0.0-1.0 floats, convert to 0-100 scale
            const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
            bs[key] = numVal <= 1.0 ? numVal * 100 : numVal;
          }
        }
      } else {
        // Object format: { "eyeBlink_L": 0.5, ... }
        for (const [key, val] of Object.entries(rawBS)) {
          bs[key] = typeof val === 'number' && val <= 1.0 ? val * 100 : parseFloat(val) || 0;
        }
      }

      if (Object.keys(bs).length > 0) return bs;
    }

    // Fallback: if it has FaceFound but no BlendShapes we recognized
    if (faceFound !== undefined) {
      console.log('[vts-parser] FaceFound but no BlendShapes parsed. Keys:', Object.keys(json).join(', '));
    }
  } catch (e) {
    // Not JSON — fall back to iFacialMocap format
    return parseIFacialMocap(data);
  }
  return null;
}

// ── Rate limiter + expression hysteresis ────────────
let lastBroadcast = 0;
const BROADCAST_INTERVAL = 33; // ~30fps max

// Hysteresis: prevent flickering by requiring an expression
// to be stable for HYSTERESIS_MS before switching.
// EXIT_BIAS: once in an expression, the score must drop further
// below threshold to leave (e.g., enter happy at 20, exit at 8).
let HYSTERESIS_MS = 300;        // Time to confirm ENTERING an emotion
let EXIT_HYSTERESIS_MS = 150;   // Time to confirm LEAVING an emotion (faster = easier to return to neutral)
let EXIT_BIAS = 0.4;            // Must drop to threshold × EXIT_BIAS to leave (0.4 = 40% of entry threshold)
let currentExpression = 'neutral';
let pendingExpression = null;
let pendingExpressionSince = 0;

function throttledBroadcast(data) {
  const now = Date.now();
  if (now - lastBroadcast < BROADCAST_INTERVAL) return;
  lastBroadcast = now;

  // Apply exit bias: when the raw detection wants to change expression,
  // check if the switch makes sense or if we should hold the current one.
  if (data.expression !== currentExpression && currentExpression !== 'neutral') {
    const currentScore = getCurrentExpressionScore(data, currentExpression);
    const enterThreshold = thresholds[currentExpression] || 20;
    const exitThreshold = enterThreshold * EXIT_BIAS;

    if (data.expression === 'neutral') {
      // Returning to neutral: only hold if current emotion is still above its ENTRY threshold.
      // (Using entry threshold, not exit threshold — makes neutral easier to reach)
      if (currentScore > enterThreshold) {
        data = { ...data, expression: currentExpression };
        pendingExpression = null;
      }
    } else {
      // Switching between emotions (e.g., happy → sad):
      // Allow the switch if the NEW emotion's score is higher than the current one.
      // Only suppress if current emotion is still dominant.
      const newScore = getCurrentExpressionScore(data, data.expression);
      if (currentScore > exitThreshold && currentScore >= newScore) {
        // Current emotion is still dominant — suppress the switch
        data = { ...data, expression: currentExpression };
        pendingExpression = null;
      }
      // If new emotion is stronger (newScore > currentScore), allow the switch
    }
  }

  // Time-based hysteresis: require stability before committing
  if (data.expression !== currentExpression) {
    if (data.expression !== pendingExpression) {
      // New candidate expression — start the timer
      pendingExpression = data.expression;
      pendingExpressionSince = now;
    } else {
      // Use shorter hysteresis when returning to neutral (makes leaving emotions faster)
      const requiredMs = (data.expression === 'neutral') ? EXIT_HYSTERESIS_MS : HYSTERESIS_MS;
      if (now - pendingExpressionSince >= requiredMs) {
        // Candidate has been stable long enough — commit the switch
        console.log(`[expr] ${currentExpression} → ${data.expression}`);
        currentExpression = data.expression;
        pendingExpression = null;
      }
    }
    // Override the expression to current (don't switch yet)
    data = { ...data, expression: currentExpression };
  } else {
    // Expression matches current — reset any pending
    pendingExpression = null;
  }

  broadcastAll(data);
}

// Helper: get the score for a specific expression from tracking data
function getCurrentExpressionScore(data, expr) {
  switch (expr) {
    case 'happy': return data.smile || 0;
    case 'sad': return data.frown || 0;
    case 'surprised': return data.surprised || 0;
    case 'eyes_closed': return data.eyesClosed || 0;
    default: return 0;
  }
}

// ── UDP: iFacialMocap listener ──────────────────────
// Helper: process any received blend shape data
const MAX_UDP_PACKETS_PER_SECOND = 240;
let keysDumped = {};  // Track per-source: { vtube_studio: true, ifacialmocap: true }
const trackingSourceIPs = { vtube_studio: null, ifacialmocap: null };
const udpRateLimits = {
  vtube_studio: { windowStart: 0, count: 0 },
  ifacialmocap: { windowStart: 0, count: 0 }
};

function setTrackingSourceIP(source, address) {
  trackingSourceIPs[source] = address;
  udpRateLimits[source] = { windowStart: Date.now(), count: 0 };
}

function allowTrackingPacket(source, rinfo) {
  if (rinfo.address !== trackingSourceIPs[source]) return false;

  const now = Date.now();
  const rate = udpRateLimits[source];
  if (now - rate.windowStart >= 1000) {
    rate.windowStart = now;
    rate.count = 0;
  }
  if (rate.count >= MAX_UDP_PACKETS_PER_SECOND) return false;
  rate.count++;
  return true;
}

function handleTrackingData(msg, source) {
  const str = msg.toString('utf-8');

  // Debug: log first packet from each source
  if (DEBUG_UDP) {
    console.log(`[udp][${source}] RAW (${msg.length} bytes): ${str.substring(0, 200)}...`);
    DEBUG_UDP = false; // Only log first packet to avoid spam
    setTimeout(() => { DEBUG_UDP = true; }, 10000); // Re-enable after 10s
  }

  // Try VTS JSON format first
  let blendShapes = parseVTubeStudio(msg);
  if (!blendShapes || Object.keys(blendShapes).length === 0) {
    // Try iFacialMocap pipe-delimited format
    blendShapes = parseIFacialMocap(msg);
  }

  if (blendShapes && Object.keys(blendShapes).length > 0) {
    // One-time dump of all blend shape keys and sample values (per source)
    if (!keysDumped[source]) {
      keysDumped[source] = true;
      console.log(`[blend][${source}] ${Object.keys(blendShapes).length} blend shapes detected. Keys and values:`);
      for (const [key, val] of Object.entries(blendShapes)) {
        console.log(`  ${key}: ${val}`);
      }
    }

    const result = detectExpression(blendShapes);
    throttledBroadcast({
      type: 'expression',
      ...result,
      source
    });
  } else if (DEBUG_UDP) {
    console.log(`[udp][${source}] Packet received but no blend shapes parsed (${msg.length} bytes)`);
  }
}

// ── UDP: iFacialMocap listener ──────────────────────
let ifacialPacketCount = 0;
const ifacialSocket = dgram.createSocket('udp4');
ifacialSocket.on('message', (msg, rinfo) => {
  if (!allowTrackingPacket('ifacialmocap', rinfo)) return;
  ifacialPacketCount++;
  if (ifacialPacketCount <= 3 || ifacialPacketCount % 1800 === 0) {
    console.log(`[udp] iFacialMocap packet #${ifacialPacketCount} from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
  }
  handleTrackingData(msg, 'ifacialmocap');
});
ifacialSocket.on('error', (err) => {
  console.log(`[udp] iFacialMocap error: ${err.message}`);
});
try {
  ifacialSocket.bind(IFACIAL_PORT, '0.0.0.0', () => {
    console.log(`[udp] iFacialMocap listening on 0.0.0.0:${IFACIAL_PORT}`);
  });
} catch (e) {
  console.log(`[udp] Could not bind iFacialMocap port ${IFACIAL_PORT}: ${e.message}`);
}

// ── UDP: VTube Studio listener (receive port) ───────
const vtsRecvSocket = dgram.createSocket('udp4');
let vtsKeepAliveInterval = null;
let vtsPacketCount = 0;

vtsRecvSocket.on('message', (msg, rinfo) => {
  if (!allowTrackingPacket('vtube_studio', rinfo)) return;
  vtsPacketCount++;
  if (vtsPacketCount <= 3 || vtsPacketCount % 300 === 0) {
    console.log(`[udp] VTS packet #${vtsPacketCount} from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
  }
  handleTrackingData(msg, 'vtube_studio');
});
vtsRecvSocket.on('error', (err) => {
  console.log(`[udp] VTube Studio recv error: ${err.message}`);
});
try {
  vtsRecvSocket.bind(VTS_RECV_PORT, '0.0.0.0', () => {
    console.log(`[udp] VTube Studio RECEIVE listening on 0.0.0.0:${VTS_RECV_PORT}`);
  });
} catch (e) {
  console.log(`[udp] Could not bind VTS recv port ${VTS_RECV_PORT}: ${e.message}`);
}

// Also listen on the send port in case VTS echoes back there
let vtsSendPacketCount = 0;
const vtsSendSocket = dgram.createSocket('udp4');
vtsSendSocket.on('message', (msg, rinfo) => {
  if (!allowTrackingPacket('vtube_studio', rinfo)) return;
  vtsSendPacketCount++;
  if (vtsSendPacketCount <= 3 || vtsSendPacketCount % 300 === 0) {
    console.log(`[udp] VTS data on SEND port from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
  }
  handleTrackingData(msg, 'vtube_studio');
});
vtsSendSocket.on('error', (err) => {
  console.log(`[udp] VTube Studio send-port error: ${err.message}`);
});
try {
  vtsSendSocket.bind(VTS_SEND_PORT, '0.0.0.0', () => {
    console.log(`[udp] VTube Studio SEND also listening on 0.0.0.0:${VTS_SEND_PORT}`);
  });
} catch (e) {
  console.log(`[udp] Could not bind VTS send port ${VTS_SEND_PORT} (may be in use): ${e.message}`);
}

// ── API: Connect to VTube Studio iPhone ─────────────
app.post('/api/connect-vts', (req, res) => {
  const { phoneIP } = req.body;
  if (!phoneIP || typeof phoneIP !== 'string') return res.status(400).json({ error: 'phoneIP required' });
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(phoneIP)) return res.status(400).json({ error: 'invalid IP address format' });

  // Request data on BOTH our receive port and send port
  const request = JSON.stringify({
    messageType: 'iOSTrackingDataRequest',
    time: 5.0,
    sentBy: 'ASAdventurer',
    ports: [VTS_RECV_PORT, VTS_SEND_PORT]
  });

  console.log(`[vts] Sending request to ${phoneIP}:${VTS_SEND_PORT}`);
  console.log(`[vts] Request body: ${request}`);
  console.log(`[vts] Expecting data back on ports: ${VTS_RECV_PORT}, ${VTS_SEND_PORT}`);

  const reqSocket = dgram.createSocket('udp4');
  reqSocket.send(request, VTS_SEND_PORT, phoneIP, (err) => {
    reqSocket.close();
    if (err) {
      console.log(`[vts] Send error: ${err.message}`);
      return res.status(500).json({ error: 'failed to connect to VTube Studio' });
    }

    setTrackingSourceIP('vtube_studio', phoneIP);
    console.log(`[vts] ✓ Request sent to ${phoneIP}:${VTS_SEND_PORT}`);

    // Keep-alive: re-request every 4s (VTS streams expire after 'time' seconds)
    if (vtsKeepAliveInterval) clearInterval(vtsKeepAliveInterval);
    vtsKeepAliveInterval = setInterval(() => {
      const kaSocket = dgram.createSocket('udp4');
      kaSocket.send(request, VTS_SEND_PORT, phoneIP, (err) => {
        kaSocket.close();
        if (err) console.log(`[vts] Keep-alive error: ${err.message}`);
      });
    }, 4000);

    res.json({ success: true, message: `Connected to ${phoneIP}. Waiting for data on ports ${VTS_RECV_PORT}/${VTS_SEND_PORT}...` });
  });
});

// ── API: Connect to iFacialMocap ────────────────────
app.post('/api/connect-ifacial', (req, res) => {
  const { phoneIP } = req.body;
  if (!phoneIP || typeof phoneIP !== 'string') return res.status(400).json({ error: 'phoneIP required' });
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(phoneIP)) return res.status(400).json({ error: 'invalid IP address format' });

  const handshake = 'iFacialMocap_sahuasouryya9218sauhuiayeta91555dy3719';

  // Send handshake FROM the already-bound ifacialSocket (port 49983).
  // The phone sends data back to the source IP:port of the handshake.
  // Using a throwaway socket would send from a random port, and data
  // would be sent back to that random (now closed) port — going nowhere.
  ifacialSocket.send(handshake, IFACIAL_PORT, phoneIP, (err) => {
    if (err) return res.status(500).json({ error: 'failed to connect to iFacialMocap' });
    setTrackingSourceIP('ifacialmocap', phoneIP);
    console.log(`[ifm] Handshake sent to ${phoneIP}:${IFACIAL_PORT} (from port ${IFACIAL_PORT})`);
    res.json({ success: true, message: `Connected to ${phoneIP}` });
  });
});

// ── API: Update thresholds ──────────────────────────
app.post('/api/thresholds', (req, res) => {
  const { smile, frown, surprised, eyesClosed, expressionHold, exitBias } = req.body;
  // Validate all values as finite numbers within reasonable ranges
  const isNum = (v, min, max) => typeof v === 'number' && isFinite(v) && v >= min && v <= max;
  if (smile !== undefined) { if (!isNum(smile, 0, 100)) return res.status(400).json({ error: 'invalid smile threshold' }); thresholds.smile = smile; }
  if (frown !== undefined) { if (!isNum(frown, 0, 100)) return res.status(400).json({ error: 'invalid frown threshold' }); thresholds.frown = frown; }
  if (surprised !== undefined) { if (!isNum(surprised, 0, 100)) return res.status(400).json({ error: 'invalid surprised threshold' }); thresholds.surprised = surprised; }
  if (eyesClosed !== undefined) { if (!isNum(eyesClosed, 0, 100)) return res.status(400).json({ error: 'invalid eyesClosed threshold' }); thresholds.eyesClosed = eyesClosed; }
  if (expressionHold !== undefined) { if (!isNum(expressionHold, 0, 30000)) return res.status(400).json({ error: 'invalid expressionHold' }); HYSTERESIS_MS = expressionHold; console.log(`[cfg] Expression hold: ${HYSTERESIS_MS}ms`); }
  if (exitBias !== undefined) { if (!isNum(exitBias, 0, 1)) return res.status(400).json({ error: 'invalid exitBias' }); EXIT_BIAS = exitBias; console.log(`[cfg] Exit bias: ${(EXIT_BIAS * 100).toFixed(0)}%`); }
  console.log(`[cfg] Thresholds updated:`, thresholds);
  res.json({ success: true, thresholds });
});

// ── Start (auto-find available port) ────────────────
function tryListen(port, attempt) {
  if (attempt >= MAX_PORT_ATTEMPTS) {
    console.error(`\n  ✗ Could not find an available port (tried ${PREFERRED_PORT}-${PREFERRED_PORT + MAX_PORT_ATTEMPTS - 1})`);
    console.error('  Close the other process or set a custom port with: PORT=XXXX node server.js\n');
    process.exit(1);
  }

  // Suppress the duplicate error from WebSocketServer
  // (it re-emits the HTTP server's EADDRINUSE)
  const wssErrorHandler = () => {};
  wss.on('error', wssErrorHandler);

  server.once('error', (err) => {
    wss.removeListener('error', wssErrorHandler);
    if (err.code === 'EADDRINUSE') {
      console.log(`  Port ${port} in use, trying ${port + 1}...`);
      server.close(() => tryListen(port + 1, attempt + 1));
    } else {
      throw err;
    }
  });

  server.listen(port, '127.0.0.1', () => {
    wss.removeListener('error', wssErrorHandler);
    PORT = port;
    console.log('');
    console.log('  ·  ✦ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✦  ·');
    console.log('');
    console.log('         ⚔  A S  A D V E N T U R E R  ⚔');
    console.log('        Angel\'s  Sword  Studios');
    console.log('');
    console.log('  ·  ✦ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✦  ·');
    console.log('');
    console.log(`    Control Panel:  http://localhost:${PORT}`);
    console.log(`    OBS Overlay:    http://localhost:${PORT}/overlay.html`);
    console.log('');
    console.log(`    VTube Studio:   send=${VTS_SEND_PORT} recv=${VTS_RECV_PORT}`);
    console.log(`    iFacialMocap:   UDP port ${IFACIAL_PORT}`);
    console.log('');
    if (PORT !== PREFERRED_PORT) {
      console.log(`    ⚠  Port ${PREFERRED_PORT} was busy, using ${PORT} instead`);
      console.log('');
    }
    console.log('    Place your assets in: public/assets/');
    console.log('');
  });
}

// Allow override via environment variable: PORT=8080 node server.js
PORT = parseInt(process.env.PORT, 10) || PREFERRED_PORT;
tryListen(PORT, 0);

// ── Graceful Shutdown ───────────────────────────────
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  if (vtsKeepAliveInterval) clearInterval(vtsKeepAliveInterval);
  wss.close();
  server.close(() => {
    console.log('  Server closed.');
    process.exit(0);
  });
  // Force exit after 3s if cleanup hangs
  setTimeout(() => process.exit(0), 3000);
});
process.on('SIGTERM', () => process.emit('SIGINT'));
