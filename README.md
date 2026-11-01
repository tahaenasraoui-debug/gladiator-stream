
```markdown
<div align="center">

# ⚔️ GLADIATOR STREAM
**Zero-Latency Interactive Twitch Chat Boss-Raid Overlay for OBS & Streamlabs**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![WebSockets](https://img.shields.io/badge/WebSockets-30_Hz_Tick-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-60_FPS_Lerp-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Twitch IRC](https://img.shields.io/badge/Twitch_IRC-tmi.js-9146FF?style=for-the-badge&logo=twitch&logoColor=white)](https://tmijs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

*Built for the **Codex x TwitchCon Hackathon***

[Features](#-key-features) • [Architecture](#-system-architecture) • [Quick Start](#-quick-start) • [OBS Setup](#-obs--streamlabs-configuration) • [Gameplay & Classes](#-gameplay--mechanics) • [API & Protocol](#-websocket--rest-protocol)

</div>

---

## 📖 Overview

**Gladiator Stream** turns any live Twitch broadcast into a massively multiplayer co-op boss raid without requiring viewers to install browser extensions, log into third-party portals, or leave chat. 

Viewers type native chat commands (`!spawn`, `!attack`, `!heal`, `!taunt`) to drop custom gladiators directly onto the streamer's screen. An authoritative Node.js server computes combat physics and Boss AI at **30 ticks per second (TPS)** and streams state updates over local WebSockets to a transparent **1920x1080 HTML5 Canvas** overlay running at **60 FPS** with client-side linear interpolation (`lerp`).

---

## ✨ Key Features

- **Zero-Friction Twitch IRC Integration**: Connects anonymously to any public Twitch channel via `tmi.js`—no OAuth tokens or broadcaster API keys required to get started.
- **Authoritative 30Hz Game Loop**: Server-side state machine managing gladiator positioning, weapon range checks, knockback physics, and Boss AI telegraphs.
- **60 FPS Procedural Vector Canvas**: Zero external image assets required. All gladiators, class weapons, boss animations, projectile arcs, and particle bursts are rendered procedurally via native HTML5 Canvas 2D primitives.
- **Dynamic Raid Scaling**: Boss maximum HP scales dynamically in real time (`2500 Base HP + 650 HP per active gladiator`) while preserving current HP percentage.
- **Chat Flood Protection & GC**: Built-in `2000ms` per-user command rate limiter and automatic `60s` idle gladiator despawning keep CPU/RAM footprint near zero during massive chat raids.
- **Offline Hackathon Simulator (`?debug=true`)**: Built-in GUI toolbar and REST endpoint (`/api/simulate`) to simulate crowd spawns, coordinated attacks, and boss kills without needing an active Twitch stream.

---

## 🏗️ System Architecture

```text
+-----------------------------------------------------------------------+
|                           TWITCH CHAT (IRC)                           |
|          Viewers type: !spawn warrior | !attack | !heal | !taunt      |
+-----------------------------------+-----------------------------------+
                                    | (WebSocket IRC Stream)
                                    v
+-----------------------------------------------------------------------+
|                       NODE.JS BACKEND (server.js)                     |
|                                                                       |
|  +---------------------+    +--------------------------------------+  |
|  | Per-User Rate Limit |--->| Command Parser & Entity Manager      |  |
|  | (2000ms Cooldown)   |    | (!spawn, !attack, !heal, !taunt)     |  |
|  +---------------------+    +------------------+-------------------+  |
|                                                |                      |
|                                                v                      |
|                             +--------------------------------------+  |
|                             | Authoritative Tick Engine (30 TPS)   |  |
|                             | - Boss AI Finite State Machine       |  |
|                             | - Range & Knockback Physics          |  |
|                             | - 60s Idle Entity Garbage Collector  |  |
|                             +------------------+-------------------+  |
+------------------------------------------------|----------------------+
                                                 | (ws:// Delta & State Packets)
                                                 v
+-----------------------------------------------------------------------+
|                OBS BROWSER SOURCE OVERLAY (public/arena.js)           |
|                                                                       |
|  - 1920x1080 Transparent Viewport (rgba(0,0,0,0))                     |
|  - 60 FPS requestAnimationFrame Loop with Linear Interpolation (lerp) |
|  - Procedural Boss & Class Renderer + Floating Combat Text Engine     |
+-----------------------------------------------------------------------+

```

---

## 🚀 Quick Start

### Prerequisites

* **Node.js** `v18.0.0` or higher
* **npm** `v9.0.0` or higher
* **OBS Studio** or **Streamlabs Desktop** (optional for local browser testing)

### 1. Clone & Install

```bash
git clone [https://github.com/tahaenasraoui-debug/gladiator-stream.git](https://github.com/tahaenasraoui-debug/gladiator-stream.git)
cd gladiator-stream
npm install

```

### 2. Configure Environment

Create a `.env` file in the project root:

```ini
PORT=3000
TWITCH_CHANNEL=your_twitch_username

```

*(Tip: You can put any live streamer's handle in `TWITCH_CHANNEL` to test with real chat traffic immediately).*

### 3. Launch the Server

```bash
# Production start
npm start

# Development mode (auto-restarts on file changes)
npm run dev

```

Once running, you will see:

```text
====================================================
⚔️  GLADIATOR STREAM OVERLAY SERVER RUNNING
🔗 OBS Browser Source URL: http://localhost:3000
🧪 Test Mode Overlay URL:  http://localhost:3000/?debug=true
📺 Listening to Twitch:    #your_twitch_username
====================================================

```

---

## 🎥 OBS & Streamlabs Configuration

1. Open **OBS Studio** and locate your active Scene.
2. Under **Sources**, click **`+`** $\rightarrow$ **Browser**.
3. Name it `Gladiator Stream Overlay` and configure the properties:

| Property | Value |
| --- | --- |
| **URL** | `http://localhost:3000` |
| **Width** | `1920` |
| **Height** | `1080` |
| **Use custom frame rate** | Checked (`60` FPS) |
| **Custom CSS** | *Leave blank* (Transparency is native) |
| **Refresh browser when scene becomes active** | Checked |

4. Keep the Browser Source at the top of your source hierarchy so the HUD and bottom-screen arena render cleanly over your gameplay or camera feed.

---

## 🎮 Gameplay & Mechanics

### Chat Commands

| Command | Cooldown | Effect |
| --- | --- | --- |
| `!spawn warrior` | `2.0s` | Spawns (or switches class to) a high-HP melee **Warrior**. |
| `!spawn archer` | `2.0s` | Spawns (or switches class to) a long-range **Archer** firing curved arrows. |
| `!spawn mage` | `2.0s` | Spawns (or switches class to) an arcane **Mage** with boosted AoE healing. |
| `!attack` | `2.0s` | Advances into weapon range and strikes the Boss (`22%` Critical Hit chance for `1.75x` DMG). |
| `!heal` | `2.0s` | Emits a `260px` emerald radiance aura, restoring HP to self and all nearby allies. |
| `!taunt` | `2.0s` | Forces Boss aggro onto the caster and grants **+50% Damage Reduction** for `8 seconds`. |

### Class Specifications

| Class | Base HP | Base ATK | Attack Range | Move Speed | Special Trait |
| --- | --- | --- | --- | --- | --- |
| **Warrior** 🔴 | `160 HP` | `24 DMG` | `110 px` (Melee) | `7 px/tick` | Highest survivability for tanking Boss cleaves |
| **Archer** 🟢 | `100 HP` | `32 DMG` | `480 px` (Long) | `9 px/tick` | Outranges Boss `AOE_SLAM` (`320px`) naturally |
| **Mage** 🔵 | `90 HP` | `38 DMG` | `380 px` (Mid) | `6 px/tick` | `!heal` restores **+55 HP** instead of +35 HP |

### Boss AI State Machine (`Malakor the Annihilator`)

Malakor cycles autonomously through a 4-stage finite state machine:

1. **`IDLE` (`2.5s`)**: Acquires an aggro target (prioritizing `!taunt` casters) and stalks horizontally toward them.
2. **`WINDUP` (`1.5s`)**: Halts movement and projects a pulsing crimson danger zone on the arena floor:
* **`AOE_SLAM`**: `320px` omnidirectional shockwave around the Boss (`38 Base DMG` + knockback).
* **`CLEAVE`**: `240px` directional frontal heavy strike (`48 Base DMG` + knockback).


3. **`STRIKE` (`0.5s`)**: Executes hit detection, triggers camera screen-shake, and applies damage/knockback. Gladiators reduced to `0 HP` immediately respawn at the arena perimeter.
4. **`COOLDOWN` (`1.6s`)**: Brief recovery window where gladiators can counter-attack safely.

When Malakor's HP hits `0`, a **Victory Fireworks Sequence** triggers, displaying the **Top 5 Damage Dealers** and the player who landed the killing blow before resetting automatically after `30 seconds`.

---

## 🔌 WebSocket & REST Protocol

### Server-to-Client WebSocket Packets

All WebSocket messages follow the envelope `{ "type": "<EVENT_TYPE>", "payload": { ... } }`:

| Event Type | Trigger Frequency | Description |
| --- | --- | --- |
| `STATE_TICK` | `30 Hz` (Every `33.3ms`) | Full snapshot of Boss coordinates/HP/state, active gladiator array, and victory timer. |
| `ATTACK_VFX` | On `!attack` | Spawns melee slash particles or ranged projectile trajectories (`fromX/Y` $\rightarrow$ `toX/Y`). |
| `FLOATING_TEXT` | On Hit / Heal / Buff | Spawns animated combat text (`CRIT`, `DAMAGE`, `HEAL`, `BUFF`). |
| `BOSS_TELEGRAPH` | On Boss `WINDUP` | Renders the ground warning zone with exact radius and duration (`1500ms`). |
| `BOSS_IMPACT` | On Boss `STRIKE` | Triggers client camera shake and ground-slam particle burst. |
| `BOSS_DEFEATED` | On Boss `0 HP` | Triggers victory banner, killer announcement, and Top 5 leaderboard array. |

### Local Simulation REST Endpoint

You can inject synthetic chat commands via HTTP `POST` for automated testing, Stream Deck buttons, or custom channel point redemptions:

```bash
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"username": "StreamKnight", "message": "!spawn warrior"}'

```

---

## 📂 Project Structure

```text
gladiator-stream/
├── package.json          # Dependencies (express, ws, tmi.js, dotenv) & npm scripts
├── .env                  # Local environment configuration (PORT, TWITCH_CHANNEL)
├── server.js             # Twitch IRC bridge, rate limiter, 30Hz physics/AI loop, WS server
├── README.md             # Project documentation
└── public/
    ├── index.html        # 1920x1080 OBS overlay DOM, Boss HUD, Victory Banner, Debug UI
    ├── style.css         # Transparent layout, glassmorphic HUD bars, keyframe animations
    └── arena.js          # 60FPS Canvas 2D engine, entity lerp, procedural sprites & VFX

```

---

## 📜 License

Distributed under the **MIT License**. Built with passion for real-time interactive streaming.

```

```
