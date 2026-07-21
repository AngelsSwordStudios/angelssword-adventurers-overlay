const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { discoverPlugins } = require('../lib/plugin-registry');

test('discovers a plugin and exposes only its declared browser files and model states', () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-plugins-'));
  const pluginDir = path.join(publicDir, 'plugins', 'example-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'control.js'), '');
  fs.writeFileSync(path.join(pluginDir, 'overlay.js'), '');
  fs.writeFileSync(path.join(pluginDir, 'plugin.css'), '');
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'example-plugin',
    name: 'Example Plugin',
    version: '1.0.0',
    controlScript: 'control.js',
    overlayScript: 'overlay.js',
    controlStyle: 'plugin.css',
    assetStates: ['neutral_example']
  }));

  assert.deepEqual(discoverPlugins(publicDir), [{
    id: 'example-plugin',
    name: 'Example Plugin',
    version: '1.0.0',
    controlScript: '/plugins/example-plugin/control.js',
    overlayScript: '/plugins/example-plugin/overlay.js',
    controlStyle: '/plugins/example-plugin/plugin.css',
    assetStates: ['neutral_example']
  }]);
});

test('skips malformed and path-traversing manifests without hiding valid plugins', () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-plugins-'));
  const pluginsDir = path.join(publicDir, 'plugins');

  const validDir = path.join(pluginsDir, 'valid-plugin');
  fs.mkdirSync(validDir, { recursive: true });
  fs.writeFileSync(path.join(validDir, 'control.js'), '');
  fs.writeFileSync(path.join(validDir, 'plugin.json'), JSON.stringify({
    id: 'valid-plugin',
    name: 'Valid Plugin',
    version: '1.0.0',
    controlScript: 'control.js',
    assetStates: []
  }));

  const traversalDir = path.join(pluginsDir, 'traversal');
  fs.mkdirSync(traversalDir, { recursive: true });
  fs.writeFileSync(path.join(traversalDir, 'plugin.json'), JSON.stringify({
    id: 'traversal',
    name: 'Traversal',
    version: '1.0.0',
    controlScript: '../outside.js',
    assetStates: []
  }));

  const malformedDir = path.join(pluginsDir, 'malformed');
  fs.mkdirSync(malformedDir, { recursive: true });
  fs.writeFileSync(path.join(malformedDir, 'plugin.json'), '{not json');

  assert.deepEqual(discoverPlugins(publicDir), [{
    id: 'valid-plugin',
    name: 'Valid Plugin',
    version: '1.0.0',
    controlScript: '/plugins/valid-plugin/control.js',
    overlayScript: undefined,
    controlStyle: undefined,
    assetStates: []
  }]);
});
