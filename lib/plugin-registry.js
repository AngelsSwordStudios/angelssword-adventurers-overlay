const fs = require('node:fs');
const path = require('node:path');

function publicPluginPath(pluginId, fileName) {
  if (!fileName) return undefined;
  return `/plugins/${pluginId}/${fileName}`;
}

function isSafeName(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

function isSafePluginFile(pluginDir, fileName) {
  return fileName === undefined || (
    typeof fileName === 'string' &&
    path.basename(fileName) === fileName &&
    fs.existsSync(path.join(pluginDir, fileName))
  );
}

function discoverPlugins(publicDir) {
  const pluginsDir = path.join(publicDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) return [];

  const plugins = [];
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }

    const pluginDir = path.dirname(manifestPath);
    const browserFiles = [manifest.controlScript, manifest.overlayScript, manifest.controlStyle];
    if (
      manifest.id !== entry.name ||
      !isSafeName(manifest.id) ||
      typeof manifest.name !== 'string' ||
      typeof manifest.version !== 'string' ||
      !browserFiles.every(fileName => isSafePluginFile(pluginDir, fileName)) ||
      !Array.isArray(manifest.assetStates) ||
      !manifest.assetStates.every(isSafeName)
    ) {
      continue;
    }

    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      controlScript: publicPluginPath(entry.name, manifest.controlScript),
      overlayScript: publicPluginPath(entry.name, manifest.overlayScript),
      controlStyle: publicPluginPath(entry.name, manifest.controlStyle),
      assetStates: manifest.assetStates
    });
  }
  return plugins;
}

module.exports = { discoverPlugins };
