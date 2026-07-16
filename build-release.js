#!/usr/bin/env node
/**
 * Build a PUBLIC RELEASE of AS Adventurer.
 *
 * Creates:  release/ASAdventurer/
 *   ├── ASAdventurer.exe
 *   ├── Start AS Adventurer.bat
 *   ├── README.md  (public-facing, sanitized)
 *   └── public/
 *       ├── overlay.html, overlay.js, overlay.css
 *       ├── control panel files (index.html, control.js, control.css)
 *       └── assets/Queri/ (demo character)
 *
 * EXCLUDES from release:
 *   - debug-vts.js, generate-placeholders.js, generate-test-assets.html
 *   - setup.bat, start.bat (dev-only launchers)
 *   - build-exe.js, build-exe.bat, build-release.js, build-release.bat
 *   - package.json, package-lock.json, .gitignore
 *   - node_modules/, runtime/, dist/, .git/
 *   - Any personal assets (public/assets/*)
 *   - Any .rar, .zip, .lnk files
 *
 * Usage: node build-release.js
 * Or:    double-click build-release.bat
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RELEASE = path.join(ROOT, 'release', 'ASAdventurer');
const PUBLIC_SRC = path.join(ROOT, 'public');
const PUBLIC_DEST = path.join(RELEASE, 'public');

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

console.log();
console.log('  ============================================');
console.log('   AS Adventurer — Public Release Builder');
console.log('  ============================================');
console.log();

// 1. Check for pkg
log('Checking for pkg...');
try {
  execSync('npx --yes pkg --version', { stdio: 'pipe' });
} catch (e) {
  log('Installing pkg...');
  execSync('npm install -g pkg', { stdio: 'inherit' });
}

// 2. Clean release dir
log('Cleaning release folder...');
if (fs.existsSync(RELEASE)) {
  fs.rmSync(RELEASE, { recursive: true, force: true });
}
fs.mkdirSync(RELEASE, { recursive: true });

// 3. Compile EXE
log('Compiling server.js → ASAdventurer.exe ...');
const ICON = path.join(ROOT, 'icon.ico');
const pkgCmd = [
  'npx --yes pkg',
  `"${path.join(ROOT, 'server.js')}"`,
  '--targets node18-win-x64',
  '--output', `"${path.join(RELEASE, 'ASAdventurer.exe')}"`,
  '--compress GZip',
  fs.existsSync(ICON) ? `--icon "${ICON}"` : ''
].filter(Boolean).join(' ');

try {
  execSync(pkgCmd, { stdio: 'inherit', cwd: ROOT });
} catch (e) {
  console.error('\n  ❌ pkg compilation failed!');
  process.exit(1);
}


// 4. Copy public/ (exclude dev files and personal assets)
log('Copying public/ files...');
const PUBLIC_EXCLUDE = [
  'assets',                     // Users bring their own
  'generate-test-assets.html',  // Dev tool
];
copyDirSync(PUBLIC_SRC, PUBLIC_DEST, PUBLIC_EXCLUDE);

// 5. Create clean assets directory with default character
const assetsDir = path.join(PUBLIC_DEST, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

// Copy Queri as the default demo character
const defaultModelSrc = path.join(PUBLIC_SRC, 'assets', 'Queri');
const defaultModelDest = path.join(assetsDir, 'Queri');
if (fs.existsSync(defaultModelSrc)) {
  log('Including default character: Queri');
  copyDirSync(defaultModelSrc, defaultModelDest, ['trash']);
} else {
  log('⚠ Default character "Queri" not found in public/assets/ — skipping');
}

// Copy brand logo
const brandLogo = 'Angelsword-Logo-white_25pct.webp';
const brandSrc = path.join(PUBLIC_SRC, 'assets', brandLogo);
if (fs.existsSync(brandSrc)) {
  fs.copyFileSync(brandSrc, path.join(assetsDir, brandLogo));
  log('Including brand logo');
}
fs.writeFileSync(path.join(assetsDir, 'README.txt'),
`=== AS Adventurer — Asset Setup ===

Place your character model folders here. Each folder is a separate "model"
that you can switch between in the Control Panel.

FOLDER STRUCTURE
================

For a single model (no folder needed):
  assets/
    neutral_idle.webm
    neutral_speaking.webm
    happy_idle.webm
    happy_speaking.webm
    sad_idle.webm
    sad_speaking.webm
    surprised_idle.webm
    surprised_speaking.webm
    eyes_closed.webm
    typing.webm              (optional)

For multiple models:
  assets/
    MyCharacter/
      neutral_idle.webm
      neutral_speaking.webm
      ...
    AnotherCharacter/
      neutral_idle.webm
      ...

EMOTES (optional)
=================
  assets/MyCharacter/emotes/
    wave/
      animation.webm         (one-shot emote, Type 1)

    sword_draw/
      intro.webm             (plays once)
      idle.webm              (loops while active)
      speaking.webm           (loops while talking)
      outro.webm             (plays on release)
      subs/
        ignition/
          animation.webm     (transition in)
          idle.webm           (loops)
          subs/
            slash/
              animation.webm (one-shot, returns to parent)
              sound.mp3

SUPPORTED FORMATS
=================
  Video: .webm, .mp4
  Image: .webp, .gif, .png
  Audio: .mp3, .wav, .ogg, .m4a

VARIANTS
========
  Multiple versions of intro/outro play randomly:
    intro.webm, intro2.webm, intro3.webm
    intro_sound.mp3, intro_sound2.mp3, intro_sound3.mp3
`);

// 6. Write public-facing README
log('Writing public README...');
fs.writeFileSync(path.join(RELEASE, 'README.md'),
`# 🎭 AS Adventurer

A real-time streaming overlay that changes character expressions based on
**facial tracking** and **voice detection**. Designed for OBS Studio.

## Quick Start

1. **Extract** the folder anywhere on your PC
2. **Double-click** \`Start AS Adventurer.bat\`
3. **Open** http://localhost:3000 in your browser (the Control Panel)
4. **Add a Browser Source** in OBS pointing to \`http://localhost:3000/overlay.html\`

> Windows Firewall may prompt you to allow network access — click **Allow**.

## Requirements

- **Windows 10/11** (64-bit)
- **OBS Studio** (for streaming)
- **VTube Studio** on iPhone, OR **iFacialMocap** (for facial tracking)

## Adding Your Character

Place your character sprites/animations in the \`public/assets/\` folder.
See \`public/assets/README.txt\` for the full file naming guide.

### Minimum Files Needed

| File | What it does |
|:-----|:-------------|
| \`neutral_idle.webm\` | Default resting state |
| \`neutral_speaking.webm\` | Talking, neutral expression |

### Optional Expression States

| File | What it does |
|:-----|:-------------|
| \`happy_idle.webm\` / \`happy_speaking.webm\` | Smiling |
| \`sad_idle.webm\` / \`sad_speaking.webm\` | Frowning |
| \`surprised_idle.webm\` / \`surprised_speaking.webm\` | Surprised |
| \`eyes_closed.webm\` | Eyes shut for 1.5+ seconds |
| \`typing.webm\` | Keyboard typing animation |

Supported formats: \`.webm\`, \`.webp\`, \`.gif\`, \`.png\`, \`.mp4\`

## Connecting Face Tracking

### VTube Studio (iPhone)
1. Open **VTube Studio** → **Settings** → **3rd Party PC Clients** → Enable
2. In the Control Panel, enter your iPhone's IP and click **Connect VTS**
3. Phone and PC must be on the same WiFi network

### iFacialMocap (iPhone)
1. Open **iFacialMocap** on your iPhone
2. In the Control Panel, enter your iPhone's IP and click **Connect iFacial**

## Enabling Microphone

1. In the Control Panel, select your mic from the dropdown
2. Click **Enable Microphone**
3. Keep the Control Panel tab open while streaming

## Control Panel Features

- **Expression thresholds** — tune smile/frown/surprise sensitivity
- **Speaking hold** — how long to maintain talking animation (helps with stuttering)
- **Expression hold** — how long to stay in an expression before reverting
- **Emote triggers** — click to play emotes and sub-animations
- **Live monitoring** — see real-time expression scores

## OBS Setup

1. Add a **Browser Source** in OBS
2. URL: \`http://localhost:3000/overlay.html\`
3. Set width/height to match your character dimensions
4. Background is transparent by default

### Debug Mode
Add \`?debug=1\` to see live state info:
\`\`\`
http://localhost:3000/overlay.html?debug=1
\`\`\`

## Ports Used

| Port | Protocol | Purpose |
|:-----|:---------|:--------|
| 3000 | HTTP/WS | Web server + WebSocket |
| 21412 | UDP | VTube Studio (send) |
| 11125 | UDP | VTube Studio (receive) |
| 49983 | UDP | iFacialMocap |

## Troubleshooting

**Face tracking not connecting?**
- Ensure your iPhone app has PC client mode enabled
- Phone and PC must be on the same network
- Windows Firewall may prompt you — click Allow

**Mic stops working?**
- Keep the Control Panel browser tab open
- Select the correct device from the mic dropdown

**Expression flickering?**
- Increase the Expression Hold slider
- Raise the sensitivity thresholds
`);

// 7. Write launcher bat
fs.writeFileSync(path.join(RELEASE, 'Start AS Adventurer.bat'),
`@echo off
echo.
echo  ============================================
echo   AS Adventurer - Starting...
echo  ============================================
echo.
echo  Open http://localhost:3000 in your browser
echo  to access the Control Panel.
echo.
echo  Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
ASAdventurer.exe
pause
`);

// 8. Final scan — verify no sensitive files leaked
log('Verifying release contents...');
const FORBIDDEN_PATTERNS = [
  /debug/i, /\.lnk$/i, /\.rar$/i, /\.zip$/i, /\.7z$/i,
  /generate-placeholder/i, /generate-test/i,
  /setup\.bat$/i, /start\.bat$/i, /build-/i,
  /package.*\.json$/i, /\.gitignore$/i,
];

function scanForForbidden(dir, rel = '') {
  const issues = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      issues.push(...scanForForbidden(fullPath, relPath));
    } else {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(entry.name)) {
          issues.push(`  ⚠ SUSPICIOUS: ${relPath}`);
          break;
        }
      }
    }
  }
  return issues;
}

const issues = scanForForbidden(RELEASE);
if (issues.length > 0) {
  console.log();
  log('⚠ Potential issues found in release:');
  for (const issue of issues) console.log(issue);
  console.log();
}

// 9. Count and summarize
let fileCount = 0;
let totalSize = 0;
function countFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      countFiles(path.join(dir, entry.name));
    } else {
      fileCount++;
      totalSize += fs.statSync(path.join(dir, entry.name)).size;
    }
  }
}
countFiles(RELEASE);

const sizeMB = (totalSize / 1024 / 1024).toFixed(1);

console.log();
log('✅ Public release build complete!');
console.log();
log(`Output: ${RELEASE}`);
log(`Files:  ${fileCount} files (${sizeMB} MB)`);
log('');
log('Contents:');
log('  ASAdventurer.exe             — Double-click to run');
log('  Start AS Adventurer.bat      — Launcher with instructions');
log('  README.md                    — User documentation');
log('  public/                      — Overlay & control panel');
log('  public/assets/README.txt     — Asset setup guide');
console.log();

// 10. Generate SHA256 checksum for authenticity verification
const crypto = require('crypto');
const exeFile = path.join(RELEASE, 'ASAdventurer.exe');
if (fs.existsSync(exeFile)) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(exeFile)).digest('hex');
  const checksumContent = `SHA256 Checksum for ASAdventurer.exe
${'='.repeat(44)}

${hash}

To verify on Windows, open PowerShell and run:
  Get-FileHash ASAdventurer.exe -Algorithm SHA256

The hash should match the value above exactly.
If it doesn't, you may have a tampered copy — download only from official sources.
`;
  fs.writeFileSync(path.join(RELEASE, 'CHECKSUM.txt'), checksumContent);
  log('🔒 SHA256 Checksum:');
  log(`   ${hash}`);
  log('   (saved to CHECKSUM.txt)');
  console.log();
}

log('Zip up the "release/ASAdventurer" folder to distribute!');
console.log();

// 11. Create zip archive in release/
log('Creating zip archive...');
const archiver = require('archiver');
const RELEASE_DIR = path.join(ROOT, 'release');
const ZIP_PATH = path.join(RELEASE_DIR, 'ASAdventurer.zip');

// Remove old zip if it exists
if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

const output = fs.createWriteStream(ZIP_PATH);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const zipMB = (archive.pointer() / 1024 / 1024).toFixed(1);
  console.log();
  log(`📦 Archive created: release/ASAdventurer.zip (${zipMB} MB)`);
  console.log();
});

archive.on('error', (err) => {
  console.error('\n  ❌ Zip creation failed:', err.message);
});

archive.pipe(output);
archive.directory(RELEASE, 'ASAdventurer');
archive.finalize();
