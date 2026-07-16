#!/usr/bin/env node
/**
 * Build script: Compiles AS Adventurer into a standalone EXE.
 * 
 * Usage: node build-exe.js
 * Or just double-click: build-exe.bat
 * 
 * Output goes to: dist/ASAdventurer/
 *   ├── ASAdventurer.exe
 *   ├── public/          (overlay, control panel, CSS, JS)
 *   │   └── assets/      (empty — user drops their model here)
 *   └── start.bat        (optional launcher)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist', 'ASAdventurer');
const PUBLIC_SRC = path.join(ROOT, 'public');
const PUBLIC_DEST = path.join(DIST, 'public');

// ── Helpers ──────────────────────────────────────
function log(msg) { console.log(`  ${msg}`); }

function copyDirSync(src, dest, exclude = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, []);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Main ─────────────────────────────────────────
console.log();
console.log('  ============================================');
console.log('   AS Adventurer — EXE Builder');
console.log('  ============================================');
console.log();

// 1. Check for pkg
log('Checking for pkg...');
try {
  execSync('npx --yes pkg --version', { stdio: 'pipe' });
} catch (e) {
  log('Installing pkg globally...');
  execSync('npm install -g pkg', { stdio: 'inherit' });
}

// 2. Clean dist
log('Cleaning dist folder...');
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

// 3. Compile EXE with pkg
log('Compiling server.js → ASAdventurer.exe ...');
const ICON = path.join(ROOT, 'icon.ico');
const pkgCmd = [
  'npx --yes pkg',
  `"${path.join(ROOT, 'server.js')}"`,
  '--targets node18-win-x64',
  '--output', `"${path.join(DIST, 'ASAdventurer.exe')}"`,
  '--compress GZip',
  fs.existsSync(ICON) ? `--icon "${ICON}"` : ''
].filter(Boolean).join(' ');

try {
  execSync(pkgCmd, { stdio: 'inherit', cwd: ROOT });
} catch (e) {
  console.error('\n  ❌ pkg compilation failed! Make sure you have run: npm install');
  process.exit(1);
}


// 4. Copy public/ folder (exclude assets — users bring their own)
log('Copying public/ files...');
copyDirSync(PUBLIC_SRC, PUBLIC_DEST, ['assets', 'generate-test-assets.html']);

// 5. Create empty assets directory with a readme
const assetsDir = path.join(PUBLIC_DEST, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(path.join(assetsDir, 'README.txt'),
`Place your character model folders here.

Each model folder should contain expression states like:
  neutral_idle.webm
  neutral_speaking.webm
  happy_idle.webm
  happy_speaking.webm
  etc.

For emotes, create an "emotes" subfolder:
  emotes/
    my_emote/
      intro.webm
      idle.webm
      outro.webm

See the main README for full documentation.
`);

// 6. Create a launcher bat
fs.writeFileSync(path.join(DIST, 'Start AS Adventurer.bat'),
`@echo off
echo.
echo  ============================================
echo   AS Adventurer - Starting...
echo  ============================================
echo.
cd /d "%~dp0"
ASAdventurer.exe
pause
`);

// 7. Summary
console.log();
log('✅ Build complete!');
console.log();
log(`Output: ${DIST}`);
log('');
log('Contents:');
log('  ASAdventurer.exe             — Double-click to run');
log('  Start AS Adventurer.bat      — Launcher with console');
log('  public/                      — Overlay & control panel');
log('  public/assets/               — Drop character models here');
console.log();
log('Zip up the "dist/ASAdventurer" folder to distribute!');
console.log();
