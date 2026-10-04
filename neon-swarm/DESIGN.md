# NEON SWARM — Design Document

**Status:** implementation-ready spec · v1.0 · 2026-10-04
**Target:** single-page HTML5 game, vanilla JavaScript + Canvas 2D, runs by double-clicking
`index.html` over `file://`. No build step, no server, no dependencies.
**Audience:** two programmers implement this spec directly. Every number below is final
unless marked `≈` (tuning allowed within ±15%).

---

## 0. Ground rules (read first)

- Pure vanilla JS. **No ES modules** (`import`/`export` are forbidden), no transpiler,
  no frameworks, no TypeScript.
- **Zero external assets.** No CDN, no images, no web fonts, no audio files, no `fetch`/
  XHR/WebSocket. All graphics are Canvas 2D draws; all audio is synthesized with WebAudio.
- No stubs, no TODOs, no empty functions. Every feature in this document must exist and work.
- In-game text: **English**. Code comments: short **English**.
- Units, everywhere: **seconds** for time, **px/s** for speeds, **px** for distances/positions.
  Never mix ms into game logic.
- The only DOM node is `<canvas id="game">`. Every screen (title, HUD, menus) is drawn on canvas.
- Determinism is not required; `Math.random` (via `GameUtil.rand`) is fine.

---

## 1. Identity

**Name:** NEON SWARM

**Pitch (one sentence):** You are the last light in a dead neon grid — hold the circle,
mow down an endless swarm, and stack absurd firepower until the grid takes you back.

**Three gameplay hooks:**

1. **Aimed gunplay in a survivors shell.** Unlike pure auto-battlers, you point the gun with
   the mouse and hold to fire. Multishot / pierce / crit upgrades turn one peashooter into a
   piercing fan of neon tracers — aiming stays relevant the whole run.
2. **Dash-dance aggression.** An invulnerable dash on a short cooldown, with upgrades that
   shorten it or refund it on kills, rewards weaving *through* the swarm instead of kiting
   in circles forever.
3. **Escalating spectacle.** Chain lightning, explosive rounds and a static field stack into
   screen-clearing storms, while a combo multiplier keeps score climbing as long as you
   never stop killing.

---

## 2. Core loop — second by second

### 2.1 Controls (locked decisions)

| Input | Action |
|---|---|
| `WASD` / Arrow keys | Move. Diagonal input normalized to length 1. |
| Mouse | **Aim.** A crosshair is drawn at the cursor; the gun always points at it. |
| **Hold LMB** | **Fire toward the cursor. LOCKED DECISION: there is NO auto-fire and NO toggle.** Holding fires; releasing stops; firing works while moving, standing still, and dashing. |
| `Space` | Dash (spec below). |
| `P` / `Esc` | Pause / resume (PLAYING ⇄ PAUSED only). |
| `M` | Toggle mute (any state; persisted). |
| `1` `2` `3` or click | Pick a level-up card (LEVELUP state). |
| Click / `Enter` / `Space` | Confirm on TITLE. |
| Click / `Enter` | Retry on GAME OVER; `T` returns to TITLE. `Q` in PAUSED quits to TITLE. |

**Dash:** 0.18 s burst at **4.2× move speed**. Direction = current movement axis; if no key
is held, dash toward the cursor. Grants **0.28 s i-frames** (intentionally slightly longer
than the dash itself — you can dash *through* bullets). Cooldown **2.5 s** (upgradeable).
Firing is allowed during a dash. A cyan ghost trail follows the dash.

**Taking damage:** any hit (contact or enemy bullet) triggers **global i-frames 0.6 s** —
player flashes red, screen-edge red vignette pulses. No damage stacks during i-frames.

### 2.2 A minute inside a run

1. Enemies spawn on a ring of radius `spawnRing = hypot(viewW, viewH)/2 + 80` around the
   player and converge. The camera follows the player over an **infinite grid world** —
   no walls, no arena bounds.
2. Kills drop **XP gems**. Gems inside the **magnet radius (70 px base)** accelerate toward
   the player and are absorbed on contact (r 12 around player).
3. The XP bar fills → **LEVEL UP**: world time slows to 0.25× for 0.35 s, then the game
   freezes into the level-up screen offering **3 upgrade cards** (mouse click or `1/2/3`).
   After picking, play resumes with 0.5 s i-frames. If one pickup crosses two thresholds,
   card offers queue back-to-back.
4. Every **35 s** the wave director raises pressure: banner "WAVE n", tighter spawn interval,
   and higher enemy stats. New enemy types unlock by wave (§3.3).
5. Every **5th wave** a **boss** spawns: warning banner + alarm 1.5 s before it walks in
   from above the player. Regular spawns continue at ~55% rate during a boss wave.
6. On death (HP ≤ 0): slow-mo 0.2× for 0.9 s + explosion → **GAME OVER** screen with run
   stats and highscore.

### 2.3 XP and levels

- `xpToNext(level) = 4 + 3 × level` → level 1→2 needs 7, then 10, 13, 16, 19 …
- Enemy XP values gain `+4% per wave` (`xpMult`) so leveling does not stall late.
- Card offer: 3 **distinct** upgrades drawn by weight, excluding maxed ones. If fewer than
  3 remain available, fill the rest with the fallback card `Field Rations (heal 30 HP)`.

### 2.4 Score and combo

- Kill score = `enemy.baseScore × comboMult`.
- Each kill: `combo += 1`, combo timer reset to **2.0 s**; when the timer expires combo
  resets to 0.
- `comboMult = 1 + 0.1 × floor(combo / 10)`, **capped at ×3.0**. HUD shows `COMBO ×1.7`
  with a draining bar. Boss kill score: 500 × comboMult.

---

## 3. Bestiary

### 3.1 Regular enemies (wave-1 baseline, before wave multipliers)

| Type | HP | Speed (px/s) | Dmg | r (px) | XP | Score | Movement | Draw (Canvas 2D) |
|---|---|---|---|---|---|---|---|---|
| **Drone** | 20 | 95 | 8 | 11 | 1 | 10 | Direct chase, ±12° random jitter so packs don't collapse into one pixel. | Magenta `#ff2d95` triangle pointing at the player. |
| **Darter** | 12 | 60 cruise | 12 | 8 | 2 | 20 | Loop: cruise 1.6 s → **windup 0.35 s** (stops, stretches 1.6× along aim, brightens — mandatory telegraph) → lunge 0.35 s at **330 px/s** toward the position captured at windup end. | Cyan `#00e5ff` slim dart/arrow. |
| **Splitter** | 28 | 75 | 6 | 13 | 3 | 30 | Chase with sine weave (amplitude 24 px, period 1.8 s). On death spawns **2 minis** at ±30°. | Green `#39ff14` rotating square; minis are 0.55× squares, lighter green. |
| **Mini** | 8 | 130 | 4 | 7 | 1 | 5 | Direct chase, jitter like drone. | Small light-green square. |
| **Spitter** | 26 | 70 | 6 contact / **10** bullet | 10 | 3 | 30 | Keeps a 200–260 px ring: approach if > 260, backpedal if < 200, else strafe. Fire cycle **2.8 s** with 0.4 s windup glow; fires one enemy bullet (150 px/s, dmg 10, r 5, violet `#c86bff`) only if within 520 px. | Violet `#b26bff` diamond; core glows white during windup. |
| **Brute** | 85 | 52 | 20 | 20 | 5 | 50 | Direct chase, **70% knockback resistance**. | Orange `#ff9f1c` thick hexagon with pulsing inner ring. |

**Boss — SWARM SOVEREIGN** (every 5th wave, n = boss count):

- HP = `600 × 1.35^(n−1)` → 1st: 600, 2nd: 810, 3rd: 1094 …
- Contact dmg 25, radius 34, speed 68.
- **Attacks:** radial bullet burst — 14 violet bullets (170 px/s, dmg 10), rotating offset
  each volley. Phase timing: full HP → volley every 5 s; **below 60%** → every 4 s;
  **below 40%** → enrage (speed 92), volley every 3.5 s, and spawns 4 drones every 9 s
  (max 8 boss-spawned adds alive).
- **Draw:** red `#ff3131` octagon with a rotating outer ring and pulsing magenta core; HP
  bar top-center; spawn telegraph = "⚠ BOSS INCOMING" banner + alarm.
- **Death:** 8 gems × 5 XP, 3 shockwaves, hitstop 100 ms, trauma 0.4, +500 × comboMult.

### 3.2 Player baseline (all upgrades modify these)

| Property | Value |
|---|---|
| HP / max HP | 100 |
| Move speed | 220 px/s |
| Body radius | 11 |
| Weapon damage | 10 (`dmg = 10 × stats.dmgMult × (crit ? 2 : 1)`) |
| Fire rate | 2.5 shots/s (`interval = 1 / (2.5 × fireRateMult)`) |
| Bullet speed / radius / range | 520 px/s / 4 px / 640 px (bullets die 640 px from origin) |
| Bullets per shot / pierce | 1 / 0 |
| Crit | 5% chance, ×2 damage |
| Magnet radius | 70 px |
| Regen | 0 HP/s |
| Dash | 0.18 s @ 4.2× speed, 0.28 s i-frames, 2.5 s cooldown |

### 3.3 Wave scaling (wave `w`, 1-indexed, wave length 35 s)

| Parameter | Formula |
|---|---|
| HP multiplier | `1 + 0.12 × (w−1)` |
| Speed multiplier | `min(1.55, 1 + 0.018 × (w−1))` |
| Damage multiplier | `min(2.0, 1 + 0.05 × (w−1))` |
| XP multiplier | `1 + 0.04 × (w−1)` |
| Spawn interval (s) | `max(0.16, 0.85 − 0.06 × (w−1))`; ×1.8 during a boss wave |
| Max alive enemies | `min(140, 60 + 10w)`; over cap → skip that spawn tick |

- **Unlocks & weights:** w1 drone (50) → w2 + darter (20) → w3 + splitter (15) →
  w4 + spitter (10) + brute (8). Type is picked by weighted sample each spawn.
- All multipliers are **baked into the enemy at spawn time** (hp, speed, dmg, xp).
- Anti-leak: any enemy farther than `1.6 × spawnRing` is teleported back to the ring edge
  (pressure never leaks away).

---

## 4. Upgrade table (16 cards, all stackable to their max)

**General apply rule:** for additive-tier stats (chain / boom / aura), the **first stack
sets the base value**, further stacks add the increment. Everything else applies as written.
Player keeps `upStacks[id]` counters; `GameUpgrades.apply` increments the counter, runs
`apply(player, stacks)`, and returns `false` if the card was maxed.

| # | id | Name | Effect per stack | Max | Weight |
|---|---|---|---|---|---|
| 1 | `damage` | Amplify | Bullet damage ×1.25 | 6 | 100 |
| 2 | `firerate` | Trigger | Fire rate ×1.20 | 5 | 100 |
| 3 | `multishot` | Split Barrel | +1 bullet per shot; full damage; fan spreads ±8° per extra bullet (bullet i of s shots: `aim − 4°(s−1) + 8°·i`) | 4 | 70 |
| 4 | `pierce` | Railcoat | +1 pierce (bullet survives 1 more enemy hit) | 4 | 70 |
| 5 | `vampiric` | Leech Rounds | +1 HP healed per kill | 5 | 60 |
| 6 | `speed` | Lightfoot | Move speed +12% | 5 | 90 |
| 7 | `flow` | Flow State | Kills made while dashing **or within 0.4 s after a dash ends** reduce dash cooldown by 1.0 s | 3 | 40 |
| 8 | `chain` | Arc Web | On bullet hit: 30% chance lightning arcs to **2** enemies within 170 px for 50% of the hit's damage. Further stacks: +10% chance (cap 80%) and +1 target | 3 | 50 |
| 9 | `boom` | Volatile Rounds | On bullet's final hit: explosion, 45 px radius, 50% damage. Further stacks: +15 px, +15% damage | 3 | 50 |
| 10 | `magnet` | Graviton Core | Magnet radius +45% | 3 | 80 |
| 11 | `maxhp` | Reinforce | +25 max HP **and** heal 25 | 4 | 90 |
| 12 | `regen` | Nanoblood | +0.6 HP/s | 4 | 70 |
| 13 | `bullet` | Hypersonic | Bullet speed +20%, bullet radius +10% | 3 | 70 |
| 14 | `aura` | Static Field | Aura around player: 8 dps to enemies within 65 px. Further stacks: +6 dps, +10 px | 3 | 50 |
| 15 | `crit` | Overclock | Crit chance +10% (base 5%, cap 60%), crits ×2 damage | 5 | 80 |
| 16 | `greedy` | Data Thirst | XP gained +25% | 3 | 70 |
| — | `heal` | Field Rations | Heal 30 HP. Fallback only (offered when < 3 real cards are available); never stacks | — | — |

**Proc ownership (locked):** `chain` and `boom` are evaluated in `main.js` inside the single
collision step (§5.3). Entities never roll upgrade procs themselves.

**Player `stats` object (literal default — copy verbatim):**

```js
stats = {
  dmgMult: 1, fireRateMult: 1, shots: 1, pierce: 0,
  lifestealPerKill: 0, speedMult: 1, dashCdMult: 1, flow: 0,
  chainChance: 0, chainTargets: 0,
  boomRadius: 0, boomDmgMult: 0,
  magnetMult: 1, regen: 0,
  bulletSpeedMult: 1, bulletSizeMult: 1,
  auraDps: 0, auraRadius: 0,
  critChance: 0.05, xpMult: 1
}
```

---

## 5. Source code contract (MANDATORY)

### 5.1 Files and load order

```
neon-swarm/
  index.html
  DESIGN.md
  js/
    util.js
    audio.js
    input.js
    particles.js
    entities.js
    waves.js
    upgrades.js
    hud.js
    main.js
```

`index.html` (exact content contract — the script order is **binding**):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEON SWARM</title>
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: #05050e; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="game"></canvas>
<!-- Load order is part of the contract. Do not reorder. -->
<script src="js/util.js"></script>
<script src="js/audio.js"></script>
<script src="js/input.js"></script>
<script src="js/particles.js"></script>
<script src="js/entities.js"></script>
<script src="js/waves.js"></script>
<script src="js/upgrades.js"></script>
<script src="js/hud.js"></script>
<script src="js/main.js"></script>
</body>
</html>
```

### 5.2 Per-file responsibilities and public API

Every file is a single IIFE in `'use strict'` mode that assigns **exactly one global**.
Because scripts execute in order, each file may alias earlier globals at its top:
`const GU = window.GameUtil;` etc. **Entities and subsystems receive the live `game`
instance through constructor/parameter injection — they never read `window.Game` directly**
(it does not exist until `main.js` runs).

**`js/util.js` → `window.GameUtil` (alias `GU`)** — math, RNG, storage, formatting. No DOM.

- `GU.TAU`
- `GU.clamp(v, min, max)`, `GU.lerp(a, b, t)`, `GU.damp(a, b, lambda, dt)`, `GU.easeOutCubic(t)`
- `GU.rand(a, b)`, `GU.randInt(a, b)` (inclusive), `GU.pick(arr)`, `GU.chance(p)`
- `GU.dist(ax, ay, bx, by)`, `GU.dist2(...)` (dist2 preferred in hot loops),
  `GU.angleTo(ax, ay, bx, by)`, `GU.norm(x, y) → {x, y, len}`
- `GU.mulberry32(seed)` (provided; not required for gameplay)
- `GU.storage.get(key) → value | null`, `GU.storage.set(key, val)` — JSON under `try/catch`,
  **never throw** (file:// + strict cookie settings can make localStorage throw)
- `GU.formatTime(sec) → "MM:SS"`, `GU.fmt(n)` (thousands separators), `GU.uid()`

**`js/audio.js` → `window.GameAudio` (alias `GA`)** — all SFX + music, 100% synthesized.

- `GA.init()` — idempotent; creates `AudioContext` + master gain. **Must be called from
  inside a user-gesture handler** (main.js calls it on the first pointerdown/keydown).
- `GA.resume()` — on `visibilitychange` visible.
- `GA.toggleMute() → muted`; persisted via `GU.storage` key `neon-swarm.muted`.
- SFX (each is a small oscillator/noise recipe; **no-op if the context is not unlocked**):
  `GA.shoot()` (square 880→440 Hz, 0.06 s, vol 0.08 — **rate-limited ≥ 60 ms apart**),
  `GA.hit()` (triangle 220 Hz, 0.05 s, 0.06; ≥ 40 ms apart),
  `GA.kill()` (saw 300→80 Hz + noise tick, 0.12 s, 0.12),
  `GA.explode()` (noise burst, lowpass 800→100 Hz, 0.25 s, 0.2),
  `GA.pickup(comboLevel)` (sine, pitch rises with combo, 0.05 s; ≥ 40 ms apart),
  `GA.levelup()` (3-note arpeggio 523/659/784 Hz, 0.3 s, 0.15),
  `GA.dash()` (highpass noise whoosh, 0.12 s, 0.1),
  `GA.hurt()` (square 180→60 Hz, 0.2 s, 0.25),
  `GA.bossWarn()` (two 110 Hz pulses, 0.5 s, 0.3), `GA.bossDie()`,
  `GA.uiSelect()` (sine 520 Hz, 0.06 s), `GA.gameOver()` (3 descending notes, 0.9 s)
- Voice cap: max **12 concurrent** voices in any 80 ms window; beyond that, skip silently.
- Music: `GA.startMusic()`, `GA.setWave(wave)`, `GA.stopMusic()`. `setInterval` 100 ms
  scheduler with 0.2 s lookahead; **112 BPM**; 8-step minor-pentatonic square bass
  (gain 0.12) + noise hats on offbeats (0.05); root cycles `[A2, C3, D3, G2]` by `wave % 4`.
  Total music gain kept low; loops forever until stop.

**`js/input.js` → `window.GameInput` (alias `GI`)** — keyboard + mouse, edge detection.

- `GI.bind(canvas)` — attaches window listeners once (keydown/keyup, mousemove,
  mousedown/mouseup, contextmenu suppressed on canvas, `preventDefault` on Space, arrows,
  Tab). Mouse stored in **CSS px relative to the canvas** (canvas fills the window, so
  `clientX/Y` directly).
- State: `GI.keys` (`Set` of `e.code`), `GI.mouse = { x, y, down }`,
  `GI.pressedThisFrame` (`Set`).
- `GI.axis() → {x, y}` — normalized WASD + arrows.
- `GI.justPressed(code)` — true on the frame the key went down (`e.code` form, e.g. `'KeyW'`).
- `GI.anyJustPressed()` — used by the title screen.
- `GI.consumeClick()` — true once per mousedown (menus poll this).
- `GI.endFrame()` — called by main at the end of every frame; clears per-frame sets.
- Relevant codes: `KeyW/A/S/D`, `Arrow*`, `Space`, `KeyM`, `KeyP`, `Escape`, `KeyQ`,
  `KeyT`, `Enter`, `Digit1-3`.

**`js/particles.js` → `window.GameParticles` (alias `GP`)** — particles, floating text,
shockwaves, lightning bolts, screenshake, hitstop. Owns **all transient visuals**.

- `GP.init(cap = 600)` (object-pooled; recycle oldest), `GP.reset()`
- `GP.burst(x, y, {color, count, speed, life, size})`
- `GP.trail(x, y, color, size)` — single short-lived fading dot (dash trail, bullet wakes)
- `GP.floatText(x, y, text, {color, size})` — damage numbers; cap 80 texts
- `GP.shockwave(x, y, color, maxRadius, dur)`
- `GP.bolt(x1, y1, x2, y2, color)` — jagged 4–6 segment lightning, life 0.12 s
- `GP.addTrauma(amount)`; shake = `trauma²`, offset ±12 px × trauma², decay 1.2/s;
  exposes `GP.shakeX / GP.shakeY` (main applies the translate to **world rendering only**)
- `GP.hitstop(ms)` — sets `timeScale = 0` for that wall-time duration
- `GP.getTimeScale() → number` — main multiplies world dt by this
- `GP.update(dt)`, `GP.render(ctx)` — world-space only; HUD never shakes

**`js/entities.js` → `window.GameEntities` (alias `GE`)** — data + motion + drawing of
everything that exists in the world. **No collision resolution and no upgrade procs here.**

- `GE.ENEMY_TYPES` (literal, mirrors §3.1 exactly):

```js
GE.ENEMY_TYPES = {
  drone:    { hp:20, speed:95,  dmg:8,  r:11, xp:1, score:10, color:'#ff2d95', kbResist:0 },
  darter:   { hp:12, speed:60,  dmg:12, r:8,  xp:2, score:20, color:'#00e5ff', kbResist:0,
              lungeSpeed:330, cruiseTime:1.6, windupTime:0.35, lungeTime:0.35 },
  splitter: { hp:28, speed:75,  dmg:6,  r:13, xp:3, score:30, color:'#39ff14', kbResist:0.2, weaveAmp:24 },
  mini:     { hp:8,  speed:130, dmg:4,  r:7,  xp:1, score:5,  color:'#7dff5e', kbResist:0 },
  spitter:  { hp:26, speed:70,  dmg:6,  r:10, xp:3, score:30, color:'#b26bff', kbResist:0.1,
              ringMin:200, ringMax:260, fireCd:2.8, bulletSpeed:150, bulletDmg:10 },
  brute:    { hp:85, speed:52,  dmg:20, r:20, xp:5, score:50, color:'#ff9f1c', kbResist:0.7 }
};
```

- `class GE.Player(game, x, y)` — fields: `x, y, r=11, hp, maxHp=100, stats` (§4 literal),
  `upStacks={}`, `fireTimer, dashTimer, dashCd, iFrames`, `facing` (aim angle).
  Methods: `update(dt)`, `tryDash()`, `shoot()` (uses `game.mouseWorld()`), `takeDamage(n)`
  (respects i-frames; returns whether it died), `applyUpgrade(id, stacks)`,
  `effectiveSpeed()`, `draw(ctx)`.
- `class GE.Enemy(game, x, y, typeName, mult)` — `mult = {hpMult, speedMult, dmgMult, xpMult}`
  from `GameWaves.scaling()` baked in at spawn. Fields: `type, x, y, r, hp, maxHp, speed,
  dmg, xp, score, color, flash, kbX, kbY` + behavior state (darter phase timer, spitter
  fire timer). Methods: `update(dt)`, `onHit(dmg, srcX, srcY)` (flash, knockback impulse
  ~60 px/s decaying as `e^(−10t)`; returns whether it died), `die()` (gems + particles +
  score + splitter minis), `draw(ctx)`.
- `class GE.Boss(game, x, y, n)` — phase machine per §3.1; `update(dt)`, `draw(ctx)`,
  `die()`.
- `class GE.Bullet(game, x, y, angle, opts)` — player bullet: `{speed, dmg, pierce, radius,
  range, traveled, hitSet}`. `class GE.EnemyBullet(game, x, y, angle, speed, dmg)`.
- `class GE.Gem(game, x, y, value)` — idle bob; magnet pull inside radius; absorb →
  `game.addXP(value × stats.xpMult)`.

**`js/waves.js` → `window.GameWaves` (alias `GW`)** — the spawn director. **Spawns only**;
never mutates the player.

- `GW.reset(game)`, `GW.update(dt, game)` — wave timer, spawn ticks, boss scheduling
  (wave % 5 === 0 → warning banner 1.5 s → spawn boss 500 px above player).
- `GW.state = { wave, waveTimer, spawnTimer, bossAlive }`
- `GW.scaling() → {hpMult, speedMult, dmgMult, xpMult, spawnInterval, maxAlive}` (§3.3)
- Weighted type pick per unlock table; banners pushed via `game.showBanner(text)`
  (`"WAVE 3"`, `"WAVE 4 · NEW: SPLITTER"`, `"BOSS INCOMING"`), plus `GA.bossWarn()` and
  `GP.addTrauma(0.3)` on boss spawn.

**`js/upgrades.js` → `window.GameUpgrades` (alias `GV`)** — card data + selection logic.

- `GV.UPGRADES` — array of `{id, name, desc, max, w, apply(player, stacks)}` (§4 table).
- `GV.roll3(player)` — weighted sample, 3 distinct, non-maxed, fallback `heal`.
- `GV.apply(player, id)` — increments `upStacks[id]`, calls `apply`, returns success bool.
  **The only code path allowed to mutate `player.stats`.**

**`js/hud.js` → `window.GameHUD` (alias `HUD`)** — HUD + all screens, drawn on canvas.
**Read-only**: never mutates game state.

- `HUD.drawPlaying(ctx, game)`, `HUD.drawTitle(ctx, game)`, `HUD.drawLevelUp(ctx, game)`,
  `HUD.drawPause(ctx, game)`, `HUD.drawGameOver(ctx, game)`
- `HUD.cardRects` — set by `drawLevelUp`; main uses it to hit-test card clicks.
- `HUD.showBanner(text)` + `HUD.update(dt)` — queued center-screen banners, 1.6 s fade.
- HUD layout: XP bar full-width top (h 8, cyan `#35e6ff`) + `LV n` badge; HP bar
  x16 y24 w220 h14 (`#ff3355`, white border) + `hp/maxHp` text; score top-right
  (`SCORE` + `BEST`); combo bottom-left with drain bar; dash indicator bottom-right
  (r 18 ring fill, `SPACE` label); wave label top-center; boss bar y40 w400 h10 when alive.

**`js/main.js` → `window.Game` (alias none needed)** — assembly, state machine, loop.

- Canvas setup: backing store = CSS size × `min(devicePixelRatio, 2)`;
  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`; `resize` handler recomputes. Min window 800×600.
- States: `TITLE`, `PLAYING`, `LEVELUP`, `PAUSED`, `GAMEOVER`.
- `game.mouseWorld()`, `game.showBanner(text)`, `game.addXP(n)`, `game.addScore(n)`,
  `game.showLevelUp()`, `game.pickUpgrade(i)`, `game.gameOver()`, `game.startRun()`.
- Highscore via `GU.storage` key `neon-swarm.best` = `{score, wave, kills, time}`;
  compare by score; `NEW BEST!` banner on game over.

### 5.3 Shared conventions (locked)

- **Camera:** `cam.x = player.x − viewW/2`, `cam.y = player.y − viewH/2`. Grid and entities
  draw in world space with `ctx.translate(−cam.x + GP.shakeX, −cam.y + GP.shakeY)`.
- **Collision authority:** exactly one place — `main.js`. Steps, in order:
  player bullets × enemies (apply pierce, `chain`, `boom`, crit, lifesteal-on-kill) →
  enemy bullets × player → enemies × player (contact) → aura tick (dps × dt) → regen →
  gem pickup → combo timer decay. Circle-circle via `GU.dist2`.
- **Update order (PLAYING):** `GI` → `GW` → player → enemies → boss → enemy bullets →
  player bullets → collisions → gems → `GP` → `HUD.update` → combo decay.
- **Render order:** clear `#05050e` → grid + starfield → gems → aura circle → enemies →
  boss → player bullets → enemy bullets → player → particles → HUD → banners/overlays.
- **Time:** `dt = min(0.05, (now − last)/1000)`; world uses `edt = dt × GP.getTimeScale()`;
  HUD/banners use raw `dt`. During LEVELUP, world update is skipped but `GP.update(dt×0.3)`
  keeps running behind the dim overlay. During PAUSED nothing updates. During GAMEOVER
  only `GP` runs so the death explosion plays out.
- **Perf caps:** enemies 140, player bullets 400, enemy bullets 200, particles 600, gems 300
  (absorb oldest instantly when over), floating texts 80. Arrays iterate with swap-remove.
- **Glow policy (perf):** `ctx.shadowBlur` only on player, boss and gems; everything else
  fakes glow with `globalCompositeOperation = 'lighter'`.
- **Fonts:** `'Consolas, "Courier New", monospace'` only (system font, no web font).
- **Color palette:** bg `#05050e`, grid `rgba(90,40,200,0.18)`, stars `#9fd8ff`/`#ffffff`,
  player core `#ffffff` + ring `#35e6ff`, player bullets `#aef6ff`, enemy bullets `#c86bff`,
  gems `#39ff14` (small) / `#35e6ff` (2–4) / `#ff2d95` (5+), damage numbers `#ffffff`
  (crit `#ffb300`, ×1.5 size), HP bar `#ff3355`, XP bar `#35e6ff`. Enemy colors in §3.1.

### 5.4 Ownership map (who may write what)

| Data | Owner (write) | Everyone else |
|---|---|---|
| Game state, arrays (enemies/bullets/gems), score, kills, timer | `Game` (main.js) | read-only |
| `player.stats` | `GameUpgrades.apply` only | read-only |
| Spawning | `GameWaves` (pushes into `game.enemies`) | — |
| Particles / shake / hitstop / floating text | `GameParticles` | request via its API |
| Screens & card hit rects | `GameHUD` | read-only |
| Audio | `GameAudio` | fire events only |

---

## 6. Juice checklist (mandatory — each row is an acceptance criterion)

| # | Effect | Owner | Locked spec |
|---|---|---|---|
| 1 | Screenshake | `GP` | trauma 0..1, offset ±12 px × trauma², decay 1.2/s; +0.15 player hurt, +0.05 kill, +0.25 boss volley, +0.4 boss death. World layer only. |
| 2 | Hitstop | `GP.hitstop` | 40 ms brute kill / boss phase change, 60 ms player hurt, 100 ms boss death. Never on normal drone kills. |
| 3 | Death particles | `GP.burst` | drone 8 · darter 10 · splitter 12 · mini 6 · spitter 10 · brute 16 · boss 60 + 3 shockwaves; speed 60–260 px/s, life 0.3–0.7 s, enemy's color. |
| 4 | Hit flash | `Enemy.flash` / player | enemy flashes white 80 ms on damage; player flashes red + red vignette 150 ms (and 0.6 s i-frames). |
| 5 | Floating damage numbers | `GP.floatText` | every hit; rise 40 px over 0.6 s, fade out; white, crits `#ffb300` at ×1.5 size. |
| 6 | Combo & score | HUD | §2.4; combo bar drains visibly; score readout. |
| 7 | SFX per event | `GA` | shoot, hit, kill, explode, pickup, levelup, dash, hurt, bossWarn, bossDie, uiSelect, gameOver — every gameplay event has a sound (§5.2 recipes, rate-limited). |
| 8 | Neon grid + starfield | main render | 48 px grid scrolling with camera; 2 star layers (20 pts @ 0.15 parallax r 1, 10 pts @ 0.35 parallax r 1.6 with `sin` twinkle), 512 px tiles, vignette overlay. |
| 9 | Level-up slow-mo + cards | main/HUD | timeScale 0.25 for 0.35 s → LEVELUP; hovered card glows; `uiSelect` on pick. |
| 10 | Boss warning | `GW`/HUD | banner `BOSS INCOMING` + `GA.bossWarn()` + red screen pulse for 1.5 s before spawn. |
| 11 | Dash trail | `GP` | 6 cyan ghosts over the dash, life 0.25 s. |
| 12 | Muzzle flash | `GP` | 3 sparks at the gun tip per shot (paired with rate-limited `shoot` sfx). |
| 13 | Gem magnetism | `Gem`/`GP` | gems streak toward the player with a short trail when magnetized. |
| 14 | Shockwaves | `GP.shockwave` | on `boom` explosions, brute death (r 60), boss death (r 180), maxRadius reached in 0.35 s. |

---

## 7. Technical constraints (hard requirements)

1. Runs by double-clicking `index.html` over **`file://`** — no server, no build step.
2. **No ES modules** (no `import`/`export`), no bundler, no frameworks. One IIFE per file,
   one global per file (§5).
3. **No network**: no `fetch`, XHR, WebSocket, no CDN, no external images/fonts/audio.
4. `localStorage` is only touched through `GameUtil.storage`, fully wrapped in `try/catch`;
   failure degrades to "no persistence", never an exception.
5. `AudioContext` is created **only after the first user interaction** (`GA.init()` from the
   first pointerdown/keydown); SFX are silent no-ops before that; `GA.resume()` on
   visibilitychange.
6. Game loop: `requestAnimationFrame`, `dt = min(0.05, (now − last)/1000)`; world dt scaled
   by `GP.getTimeScale()` (hitstop / slow-mo). No `setInterval` for game logic (music
   scheduler is the sole exception, per §5.2).
7. Canvas backing store scaled by `min(devicePixelRatio, 2)` with matching `setTransform`;
   CSS size always equals the window; `resize` handler keeps it correct.
8. **Auto-pause on focus loss**: `window.blur` and `document.visibilitychange → hidden`
   switch PLAYING → PAUSED.
9. Input hygiene: `preventDefault` on Space/arrows/Tab (no page scroll), contextmenu
   suppressed on the canvas; no `alert/confirm/prompt` anywhere.
10. All per-entity state integrates with `dt` — no frame-count timers.

---

## 8. Screens and state machine

```
                 click / Enter / Space
  ┌───────┐ ────────────────────────────▶ ┌─────────┐
  │ TITLE │                               │ PLAYING │◀──────────┐
  └───────┘ ◀── T ──┐                    └─────────┘           │
       ▲           │                     │    ▲ │  ▲            │
       │           │            P/Esc    │    │ │  │ pick card  │ death (slow-mo 0.9s)
       │           │                     ▼    │ ▼  │            │
       │           │                 ┌────────┐│ LEVELUP ──────┘
       │      ┌─────────┐  Q ──────▶│ PAUSED ││ (cards 1/2/3, queues)
       │      │GAMEOVER│           └────────┘└──▶ back to PLAYING
       └──────┤        │ ◀─────────────── death
              └────────┘  click / Enter = retry
```

- **TITLE** — neon logo, controls panel (`WASD move · MOUSE aim · HOLD LMB fire · SPACE dash ·
  P pause · M mute`), best score, blinking `CLICK TO START`. First click also unlocks audio.
- **PLAYING** — full HUD (§5.2) + crosshair at the cursor (cyan ring + 4 ticks, ×1.3 while
  firing). Banners queue center-screen: `WAVE n`, `NEW: <TYPE>`, `BOSS INCOMING`, `NEW BEST!`.
- **LEVELUP** — world frozen (particles at 0.3×), dim overlay, 3 cards. Each card: name,
  one-line effect, current stack count `LV 2/6`. Select: click or `1/2/3`.
- **PAUSED** — dim overlay, `PAUSED`, hints: `P/ESC resume · M mute · Q quit to title`.
- **GAME OVER** — `GAME OVER`, stats block: TIME, WAVE, LEVEL, KILLS, SCORE, BEST
  (+ `NEW BEST!` when beaten), `CLICK TO RETRY · T FOR TITLE`.

---

## 9. Definition of done (manual acceptance, run by the implementers)

Mark each `NOT_RUN` until executed on this machine:

1. Double-click `index.html` → title screen, zero console errors.
2. A 60 s run: movement, hold-to-fire, dash (with cooldown ring), gems magnetize,
   at least 3 level-ups with distinct cards applied and stacking correctly.
3. Wave 5: boss warning banner, boss fight with volleys and adds, boss death juice.
4. Death → slow-mo → game over stats correct → retry resets everything → title works.
5. Reload the page: best score and mute state persist (`file://` localStorage).
6. Alt-tab mid-run → game auto-pauses; returning does not fast-forward time.
7. 140 enemies on screen without visible stutter; DPR-crisp rendering on a HiDPI display.
8. Mute toggle works in every state; no audio before the first click (autoplay-safe).
