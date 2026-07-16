# ⚔️ AS Adventurer (MediaPipe Edition)

**A free, open-source reactive overlay for streamers.**  
This is a **MediaPipe-first** fork of [AS Adventurer](https://github.com/AngelsSwordStudios/angelssword-adventurers-overlay) by Angel's Sword Studios.

**No VTube Studio, no iPhone, no paid apps required.**  
Just open the control panel, click **Start Webcam**, and your face drives the character in real time using Google MediaPipe Face Landmarker (runs entirely in the browser).

It still supports the original VTube Studio / iFacialMocap pipelines as optional advanced options.

> Original project by [Angel's Sword Studios](https://github.com/angelssword). This fork prioritises accessibility — anyone with a webcam can use full expression tracking for free.

---

## What It Does

Your **webcam** (or optional iPhone tracking) tracks your face. AS Adventurer reads your expressions in real time and swaps between different animations on stream:

| Expression     | What Triggers It                          |
|:---------------|:------------------------------------------|
| 😊 Happy       | Smiling (cheek + eye squint)              |
| 😢 Sad         | Frowning (brow + mouth)                   |
| 😮 Surprised   | Wide eyes + raised brows                  |
| 😑 Eyes Closed | Eyes shut for 1.5+ seconds                |
| 🎤 Speaking    | Microphone volume                         |
| ⌨️ Typing      | Keyboard activity                         |

Each state has its own idle and speaking animation. You provide the art — WebM, GIF, PNG, or MP4 — and AS Adventurer handles the rest.

### Emotes

On top of expressions, you can trigger **emotes** from the control panel — one-shot animations, held poses with intro/idle/outro sequences, and even nested sub-animations (e.g., draw sword → ignite → slash). Each emote can have sound effects and multiple variants that play randomly.

---

## Features

- **Face tracking** — **Primary: Webcam + MediaPipe** (no phone needed). Optional: VTube Studio / iFacialMocap
- **Voice detection** — microphone input with adjustable threshold + spectral typing detection
- **Typing detection** — keyboard activity triggers a typing animation
- **Multiple models** — switch characters on the fly from the control panel
- **Emote system** — one-shot, held, and nested sub-animation emotes with sound effects
- **Tunable thresholds** — smile sensitivity, expression hold, hysteresis, exit bias, transition speed
- **Crossfade / blur-pop transitions** — configurable swap animation between expression states
- **OBS-native** — transparent browser source, no plugins needed
- **Runs on bad computers** — lightweight single-process server, only the active model's assets are loaded
- **Standalone EXE** — build a portable release with no runtime dependencies
- **Localhost only** — nothing leaves your machine

---

## Quick Start

### From Source

```bash
# Clone this MediaPipe fork
git clone https://github.com/Manya3084/angelssword-adventurers-overlay-test.git
cd angelssword-adventurers-overlay-test
git checkout feature/mediapipe-primary

# Install dependencies
npm install

# Start the server
npm start
```

Then open:
- **Control Panel** → [http://localhost:3000](http://localhost:3000)
- **OBS Overlay** → `http://localhost:3000/overlay.html` (add as Browser Source)

**Recommended first run:**
1. Open the Control Panel
2. The **Webcam** tab is selected by default
3. Click **Start Webcam** → allow camera access
4. Smile / frown / open mouth and watch the live meters react
5. Enable Microphone for speaking detection
6. Drop your character assets into `public/assets/`

### From Release (no Node.js needed)

1. Download the latest release ZIP
2. Extract anywhere
3. Double-click `Start AS Adventurer.bat`
4. Open [http://localhost:3000](http://localhost:3000) in your browser

---

## Adding Your Character

Drop your animations into `public/assets/` — either at the root for a single model, or in a subfolder for multiple models.

### File Naming

```
public/assets/
  MyCharacter/
    neutral_idle.webm          ← Default resting state
    neutral_speaking.webm      ← Talking, neutral expression
    happy_idle.webm            ← Smiling
    happy_speaking.webm        ← Talking while smiling
    sad_idle.webm              ← Frowning
    sad_speaking.webm          ← Talking while frowning
    surprised_idle.webm        ← Surprised
    surprised_speaking.webm    ← Talking while surprised
    eyes_closed.webm           ← Eyes shut
    typing.webm                ← Keyboard typing
```

Only `neutral_idle` is truly required. Everything else is optional — if a state doesn't have an asset, AS Adventurer falls back gracefully.

**Supported formats:** `.webm` `.mp4` `.webp` `.gif` `.png`

### Emotes

```
public/assets/MyCharacter/emotes/
  wave/
    animation.webm              ← One-shot emote (Type 1)

  sword_draw/
    intro.webm                  ← Plays once on trigger
    idle.webm                   ← Loops while held
    speaking.webm               ← Loops while held + talking
    outro.webm                  ← Plays on release
    intro_sound.mp3             ← Sound on trigger
    outro_sound.mp3             ← Sound on release
    subs/
      ignition/                 ← Sub-animation (nested)
        intro.webm
        idle.webm
        subs/
          slash/
            animation.webm     ← One-shot, returns to parent
            sound.mp3
```

Emotes support **variants** — `intro.webm`, `intro2.webm`, `intro3.webm` play randomly.

---

## Connecting Face Tracking

### 🟢 Recommended: Webcam + MediaPipe (no extra software)

1. Open the Control Panel → **Webcam** tab (selected by default)
2. Click **Start Webcam**
3. Allow camera access when the browser asks
4. Face tracking starts instantly — no phone, no apps, no IP addresses

MediaPipe runs completely in your browser using WebAssembly + GPU (when available).  
Your face never leaves the machine.

**Tips for best results:**
- Good lighting on your face
- Camera at eye level
- Avoid strong backlight
- The live meters in the Control Panel show exactly what the system sees

### Optional: VTube Studio (iPhone) — Advanced

1. Open VTube Studio → Settings → 3rd Party PC Clients → Enable
2. Switch to the **VTube Studio** tab in the Control Panel
3. Enter your iPhone's IP and click **Connect VTS**
4. Phone and PC must be on the same WiFi network

### Optional: iFacialMocap (iPhone) — Advanced

1. Open iFacialMocap on your iPhone
2. Switch to the **iFacialMocap** tab
3. Enter your iPhone's IP and click **Connect iFacial**

### Microphone

1. Select your mic from the dropdown in the Control Panel
2. Click **Enable Microphone**
3. Keep the Control Panel tab open while streaming (it does the mic analysis)

---

## OBS Setup

1. Add a **Browser Source** in OBS
2. URL: `http://localhost:3000/overlay.html`
3. Set width/height to match your character dimensions
4. Background is transparent by default

**Debug mode:** Add `?debug=1` to see live expression state → `http://localhost:3000/overlay.html?debug=1`

---

## Ports

| Port  | Protocol | Purpose                          |
|:------|:---------|:---------------------------------|
| 3000  | HTTP/WS  | Web server + WebSocket           |
| 21412 | UDP      | VTube Studio (send) — optional   |
| 11125 | UDP      | VTube Studio (receive) — optional|
| 49983 | UDP      | iFacialMocap — optional          |

When using only MediaPipe + webcam, only port 3000 is used.

---

## Building a Release

To create a standalone EXE distribution (no Node.js required for end users):

```bash
node build-release.js
```

This creates `release/ASAdventurer/` with the EXE, launcher, README, and a bundled demo character — plus a `release/ASAdventurer.zip` ready to distribute.

---

## Tech Stack

- **Server:** Node.js, Express, WebSocket (`ws`)
- **Primary Tracking:** MediaPipe Face Landmarker (browser-side, WebAssembly)
- **Optional Tracking:** UDP sockets (VTube Studio / iFacialMocap protocol parsing)
- **Frontend:** Vanilla HTML/CSS/JS — no frameworks, no build step
- **Packaging:** `pkg` for standalone EXE builds

---

## Differences from Upstream

This fork (`angelssword-adventurers-overlay-test`) makes the following intentional changes:

- **MediaPipe / Webcam is the primary and default tracking method**
- Control panel opens with the Webcam tab selected
- Improved help text and onboarding for zero-setup face tracking
- VTube Studio and iFacialMocap remain fully supported as optional advanced modes
- README rewritten for accessibility-first messaging

---

## License

MIT — free for personal and commercial use. See [LICENSE](LICENSE) for details.

---

## Contributing

This project is open source because we believe everyone should be able to create, regardless of budget. If you want to contribute — bug fixes, features, documentation — PRs are welcome.

If you find this useful, consider crediting **Angel's Sword Studios** in your stream setup. 💛
