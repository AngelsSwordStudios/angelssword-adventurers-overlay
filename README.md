# ⚔️ AS Adventurer

**A free, open-source reactive overlay for streamers.** AS Adventurer bridges the gap between PNGtubing and VTube Studio — giving you expression-reactive characters without the cost or complexity of a full Live2D setup.

It's not meant to replace either. If you want a quick, lightweight reactive avatar that responds to your face and voice, this is for you. If you need full Live2D rigging, use VTube Studio. If you just want a static PNG that bounces, use a PNGtuber tool. AS Adventurer sits in the middle — **animated expression swaps driven by real facial tracking**.

It also works great for **Discord collab reactives** — drop your character sprites in a folder and go.

> Built by [Angel's Sword Studios](https://github.com/angelssword). Designed for creators on a budget.

---

## What It Does

Your iPhone (or webcam) tracks your face. AS Adventurer reads your expressions in real time and swaps between different animations on stream:

| Expression | What Triggers It |
|:-----------|:-----------------|
| 😊 Happy | Smiling (cheek + eye squint) |
| 😢 Sad | Frowning (brow + mouth) |
| 😮 Surprised | Wide eyes + raised brows |
| 😑 Eyes Closed | Eyes shut for 1.5+ seconds |
| 🎤 Speaking | Microphone volume |
| ⌨️ Typing | Keyboard activity |

Each state has its own idle and speaking animation. You provide the art — WebM, GIF, PNG, or MP4 — and AS Adventurer handles the rest.

### Emotes

On top of expressions, you can trigger **emotes** from the control panel — one-shot animations, held poses with intro/idle/outro sequences, and even nested sub-animations (e.g., draw sword → ignite → slash). Each emote can have sound effects and multiple variants that play randomly.

---

## Features

- **Face tracking** — VTube Studio (iPhone), iFacialMocap (iPhone), or webcam via MediaPipe
- **Voice detection** — microphone input with adjustable threshold
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
# Clone the repo
git clone https://github.com/angelssword/as-adventurer.git
cd as-adventurer

# Install dependencies
npm install

# Start the server
npm start
```

Then open:
- **Control Panel** → [http://localhost:3000](http://localhost:3000)
- **OBS Overlay** → `http://localhost:3000/overlay.html` (add as Browser Source)

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

### VTube Studio (iPhone)
1. Open VTube Studio → Settings → 3rd Party PC Clients → Enable
2. In the Control Panel, enter your iPhone's IP and click **Connect VTS**
3. Phone and PC must be on the same WiFi network

### iFacialMocap (iPhone)
1. Open iFacialMocap on your iPhone
2. In the Control Panel, enter your iPhone's IP and click **Connect iFacial**

### Microphone
1. Select your mic from the dropdown in the Control Panel
2. Click **Enable Microphone**
3. Keep the Control Panel tab open while streaming

---

## OBS Setup

1. Add a **Browser Source** in OBS
2. URL: `http://localhost:3000/overlay.html`
3. Set width/height to match your character dimensions
4. Background is transparent by default

**Debug mode:** Add `?debug=1` to see live expression state → `http://localhost:3000/overlay.html?debug=1`

---

## Ports

| Port | Protocol | Purpose |
|:-----|:---------|:--------|
| 3000 | HTTP/WS | Web server + WebSocket |
| 21412 | UDP | VTube Studio (send) |
| 11125 | UDP | VTube Studio (receive) |
| 49983 | UDP | iFacialMocap |

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
- **Tracking:** UDP sockets (VTube Studio / iFacialMocap protocol parsing)
- **Frontend:** Vanilla HTML/CSS/JS — no frameworks, no build step
- **Packaging:** `pkg` for standalone EXE builds

---

## License

MIT — free for personal and commercial use. See [LICENSE](LICENSE) for details.

---

## Contributing

This project is open source because we believe everyone should be able to create, regardless of budget. If you want to contribute — bug fixes, features, documentation — PRs are welcome.

If you find this useful, consider crediting **Angel's Sword Studios** in your stream setup. 💛
