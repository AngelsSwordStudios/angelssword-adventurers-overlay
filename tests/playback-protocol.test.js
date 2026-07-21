const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIR = path.join(ROOT, 'public', 'assets', 'BridgeTest');
const PORT = 39127;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function writeFixture(relativePath) {
  const filePath = path.join(MODEL_DIR, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture');
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server startup timed out')), 10000);
    const onData = (chunk) => {
      if (chunk.toString().includes(`http://localhost:${PORT}`)) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited during startup with code ${code}`));
    });
  });
}

function connect(type) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/?type=${type}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function messages(socket) {
  const queue = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    } else {
      queue.push(message);
    }
  });
  return (predicate) => {
    const existingIndex = queue.findIndex(predicate);
    if (existingIndex >= 0) return Promise.resolve(queue.splice(existingIndex, 1)[0]);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('WebSocket message timed out'));
      }, 3000);
      waiters.push({ predicate, resolve, timeout });
    });
  };
}

async function request(pathname, body) {
  const response = await fetch(BASE_URL + pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, json };
}

test('serializes Type 1 and exposes Type 2 held/toggle lifecycle', async (t) => {
  writeFixture(path.join('emotes', 'wave', 'animation.png'));
  writeFixture(path.join('emotes', 'sword', 'intro.png'));
  writeFixture(path.join('emotes', 'sword', 'idle.png'));
  writeFixture(path.join('emotes', 'sword', 'outro.png'));
  writeFixture(path.join('emotes', 'sword', 'subs', 'slash', 'animation.png'));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let overlay;
  let plugin;
  t.after(() => {
    if (overlay) overlay.close();
    if (plugin) plugin.close();
    child.kill('SIGTERM');
    fs.rmSync(MODEL_DIR, { recursive: true, force: true });
  });

  await waitForServer(child);
  assert.equal((await request('/api/animation/status')).json.phase, 'idle');
  assert.equal((await request('/api/models/select', { model: 'BridgeTest' })).status, 200);

  overlay = await connect('overlay');
  plugin = await connect('plugin');
  const nextOverlay = messages(overlay);
  const nextPlugin = messages(plugin);
  await nextPlugin((message) => message.type === 'animation_state' && message.phase === 'idle');

  const wave = await request('/api/emote/toggle', { name: 'wave' });
  assert.equal(wave.status, 202);
  assert.equal(wave.json.state.phase, 'playing');
  assert.equal((await request('/api/emote/toggle', { name: 'sword' })).status, 409);

  const waveTrigger = await nextOverlay((message) => message.type === 'emote' && message.action === 'trigger');
  overlay.send(JSON.stringify({ type: 'animation_state', phase: 'idle', reason: 'ended', requestId: waveTrigger.requestId }));
  const waveDone = await nextPlugin((message) => message.phase === 'idle' && message.requestId === waveTrigger.requestId);
  assert.equal(waveDone.reason, 'ended');

  const sword = await request('/api/emote/toggle', { name: 'sword' });
  assert.equal(sword.status, 202);
  const swordTrigger = await nextOverlay((message) => message.type === 'emote' && message.action === 'trigger');
  overlay.send(JSON.stringify({ type: 'animation_state', phase: 'held', requestId: swordTrigger.requestId }));
  await nextPlugin((message) => message.phase === 'held');

  const held = (await request('/api/animation/status')).json;
  assert.equal(held.busy, false);
  assert.equal(held.occupied, true);
  assert.equal((await request('/api/emote/toggle', { name: 'wave' })).status, 409);

  const sub = await request('/api/emote/sub', { name: 'slash' });
  assert.equal(sub.status, 202);
  assert.equal(sub.json.state.phase, 'sub_playing');
  await nextOverlay((message) => message.type === 'emote' && message.action === 'sub');
  overlay.send(JSON.stringify({ type: 'animation_state', phase: 'held', requestId: swordTrigger.requestId }));
  await nextPlugin((message) => message.phase === 'held');

  const release = await request('/api/emote/toggle', { name: 'sword' });
  assert.equal(release.status, 202);
  assert.equal(release.json.action, 'release');
  await nextOverlay((message) => message.type === 'emote' && message.action === 'release');
  overlay.send(JSON.stringify({ type: 'animation_state', phase: 'idle', reason: 'released', requestId: swordTrigger.requestId }));
  await nextPlugin((message) => message.phase === 'idle' && message.reason === 'released');

  assert.deepEqual(await request('/api/animation/status'), {
    status: 200,
    json: {
      phase: 'idle',
      busy: false,
      occupied: false,
      requestId: null,
      emote: null,
      emoteType: null,
      reason: 'released'
    }
  });
});
