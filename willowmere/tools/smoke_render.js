/* Willowmere — tools/smoke_render.js
   Headless render smoke test. Node stdlib only (no external deps).

   What it does:
   1. Installs the full browser-environment stub (window/document/canvas/
      localStorage/Image/Audio/rAF) required by the game's classic scripts.
   2. Loads the 13 game scripts in the exact order of index.html via
      vm.runInThisContext (real filenames in stack traces).
   3. Re-runs the build path (WWorld.build / WNpcs.init) and replays the
      whole draw pass in main.js order, plus WStory/WAction/WParticles
      updates and a full WDialogue open/update/draw/close cycle.
   4. A second pass with night+rain env exercises the dark-tint, light-glow
      and rain branches of world.js.

   Exit 0 + "SMOKE OK" when clean; any thrown error prints its full stack
   and exits 1.

   Run from the workspace root:  node willowmere/tools/smoke_render.js
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOL_DIR = __dirname;
const GAME_DIR = path.join(TOOL_DIR, '..');
const JS_DIR = path.join(GAME_DIR, 'js');

/* Script order is the contract from index.html / DESIGN.md §7. */
const ORDER = [
  'util', 'manifest', 'assets', 'audio', 'input', 'particles',
  'world', 'npcs', 'dialogue', 'story', 'action', 'hud', 'main'
];

/* ============================ stubs ============================ */

/* Proxy 2D context: every unknown method is a cached no-op; the handful of
   methods that must RETURN values are special-cased. Property writes are
   stored so read-backs behave like a real context. */
function makeCtx(canvas) {
  const props = { canvas: canvas };
  const noops = Object.create(null);
  return new Proxy(props, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p in t) return t[p];
      switch (p) {
        case 'measureText':
          return (t[p] = function () { return { width: 64 }; });
        case 'createLinearGradient':
        case 'createRadialGradient':
        case 'createConicGradient':
          return (t[p] = function () { return { addColorStop: function () {} }; });
        case 'getTransform':
          return (t[p] = function () {
            return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
          });
      }
      if (!(p in noops)) noops[p] = function () {};
      return noops[p];
    },
    set(t, p, v) {
      if (typeof p !== 'symbol') t[p] = v;
      return true;
    }
  });
}

function makeCanvas() {
  const c = {
    width: 1280,
    height: 720,
    style: {},
    addEventListener: function () {},
    removeEventListener: function () {},
    getBoundingClientRect: function () {
      return { x: 0, y: 0, left: 0, top: 0,
               width: c.width, height: c.height,
               right: c.width, bottom: c.height };
    },
    toDataURL: function () { return 'data:image/png;base64,'; }
  };
  c.getContext = function (type) {
    if (String(type) !== '2d') return null;
    if (!c._ctx) c._ctx = makeCtx(c);
    return c._ctx;
  };
  return c;
}

/* In-memory localStorage (file:// may block the real one; WU guards it). */
function makeStorage() {
  const m = Object.create(null);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    clear: function () { for (const k in m) delete m[k]; },
    key: function (i) { return Object.keys(m)[i] !== undefined ? Object.keys(m)[i] : null; },
    get length() { return Object.keys(m).length; }
  };
}

/* Image/Audio: inert. onload/onerror assignable, events never fire, so the
   game exercises its vector-fallback render paths (by design). */
class ImageStub {
  constructor() {
    this.src = '';
    this.width = 0; this.height = 0;
    this.naturalWidth = 0; this.naturalHeight = 0;
    this.complete = false;
    this.onload = null; this.onerror = null;
  }
  addEventListener() {}
  removeEventListener() {}
}

class AudioStub {
  constructor() {
    this.src = '';
    this.loop = false;
    this.preload = 'auto';
    this.volume = 1;
    this.muted = false;
    this.onload = null; this.onerror = null;
  }
  addEventListener() {}
  removeEventListener() {}
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
}

const mainCanvas = makeCanvas();

function installGlobals() {
  const g = globalThis;
  g.window = g;
  g.document = {
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    getElementById: function () { return mainCanvas; },
    createElement: function (tag) {
      return String(tag).toLowerCase() === 'canvas' ? makeCanvas() : {
        style: {}, textContent: '',
        setAttribute: function () {}, appendChild: function () {},
        addEventListener: function () {}
      };
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    body: { appendChild: function () {}, addEventListener: function () {} }
  };
  g.localStorage = makeStorage();
  g.Image = ImageStub;
  g.Audio = AudioStub;
  g.devicePixelRatio = 1;
  g.innerWidth = 1280;
  g.innerHeight = 720;
  /* window.addEventListener targets — captured no-ops, never dispatched */
  g.addEventListener = function () {};
  g.removeEventListener = function () {};
  /* requestAnimationFrame: CAPTURED, never run — no frame loop executes */
  const rafQueue = [];
  g.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
  g.cancelAnimationFrame = function () {};
  g.__rafQueue = rafQueue;   // inspected by the boot assertion below
  /* No AudioContext defined on purpose: WAudio.init() must see none and the
     whole synth path stays in its "before first gesture" no-op state. */
}

/* ============================ runner ============================ */

let failed = false;

function step(name, fn) {
  process.stdout.write('  - ' + name + '\n');
  try {
    fn();
  } catch (e) {
    failed = true;
    process.stdout.write('\n');
    console.error('SMOKE FAIL at step: ' + name);
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
}

function loadScripts() {
  for (const name of ORDER) {
    const file = path.join(JS_DIR, name + '.js');
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch (e) {
      throw new Error('cannot read game script ' + file + ': ' + e.message);
    }
    try {
      vm.runInThisContext(code, { filename: 'willowmere/js/' + name + '.js' });
    } catch (e) {
      throw new Error('while loading ' + name + '.js: ' + (e && e.stack ? e.stack : e));
    }
  }
}

/* One full draw pass, exactly the call order of main.js drawWorldPass(). */
function drawWorldPass(ctx, env, cam, player) {
  const WWorld = globalThis.WWorld, WNpcs = globalThis.WNpcs,
        WAction = globalThis.WAction, WParticles = globalThis.WParticles;

  WWorld.drawBack(ctx, cam, env);                       // tiles/props/parallax/ambient
  WAction.drawUnder(ctx, cam, player);                  // ground-level effects

  /* y-sorted bodies: NPCs + player, player hidden behind title (never here) */
  const list = WNpcs.list();
  let drawn = 0;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.hidden) continue;                             // away villagers draw nothing
    WNpcs.drawBody(ctx, n, cam);
    drawn++;
  }
  WNpcs.drawChar(ctx, player.x, player.y, player.dir, 0, 0, cam);  // player body
  WNpcs.draw(ctx, cam, env);                            // bubbles / ambient overlays

  WAction.drawOver(ctx, cam, player);                   // rod line, sling, projectiles
  WWorld.drawOver(ctx, cam, env);                       // canopies, rooftops
  WParticles.draw(ctx, cam);
  WWorld.drawLights(ctx, cam, env);                     // glows, beams
  WWorld.applyTint(ctx, env);                           // hour colour-grade
  return { npcs: list.length, drawn: drawn };
}

function drawScreenUI(ctx, env) {
  const WHUD = globalThis.WHUD, WAudio = globalThis.WAudio;
  WHUD.draw(ctx, env, { dt: 1 / 60, zoom: 1 });
  WHUD.drawTitleOn(ctx, 0, false);
  WHUD.drawPauseOn(ctx, 0);
  WHUD.drawSettingsOn(ctx, 0, WAudio.getMusicVolume(), WAudio.getSfxVolume(),
    WAudio.isMuted ? WAudio.isMuted() : false);
}

/* ============================ main ============================ */

function main() {
  process.stdout.write('[smoke_render] willowmere headless render smoke\n');
  step('install browser-environment stubs', installGlobals);
  step('load 13 game scripts in index.html order', loadScripts);

  const g = globalThis;
  const WWorld = g.WWorld, WNpcs = g.WNpcs, WStory = g.WStory,
        WAction = g.WAction, WParticles = g.WParticles,
        WDialogue = g.WDialogue, WGame = g.WGame;

  /* boot() ran during main.js load (readyState 'complete'): it must have
     grabbed the canvas, built the world, inited NPCs and scheduled a frame */
  step('boot ran at load (canvas grabbed, rAF captured, world built)', function () {
    if (!WGame || !WGame.player) throw new Error('WGame.player missing — boot did not run');
    if (g.__rafQueue.length < 1) throw new Error('requestAnimationFrame was never captured — boot did not schedule a frame');
    if (mainCanvas.width !== 1280 || mainCanvas.height !== 720) {
      throw new Error('canvas is ' + mainCanvas.width + 'x' + mainCanvas.height +
                      ', expected 1280x720 after resize()');
    }
    if (!WWorld.isBuilt()) throw new Error('WWorld.isBuilt() is false after boot');
  });

  step('WWorld.build() + WNpcs.init() (re-run like newGame)', function () {
    WWorld.build();
    WNpcs.init();
    if (!WWorld.isBuilt()) throw new Error('WWorld.isBuilt() false after explicit build()');
    const list = WNpcs.list();
    if (!list || list.length === 0) throw new Error('WNpcs.list() empty after init()');
  });

  const player = WGame.player;
  const cam = { x: 900, y: 1780 };
  const ctx = mainCanvas.getContext('2d');

  /* ---- pass 1: the env fixed by the ask (day, 09:30, clear) ---- */
  const env1 = { day: 1, hour: 9.5, weather: 'clear', night: false,
                 frozen: false, player: player };

  step('update pass (WStory.update / WAction.update / WParticles.update)', function () {
    WStory.update(env1);                       // main.js updatePlay order
    WAction.update(1 / 60, player, env1);
    WParticles.update(1 / 60, WWorld);
  });

  step('WWorld.drawBack', function () { WWorld.drawBack(ctx, cam, env1); });
  step('WAction.drawUnder', function () { WAction.drawUnder(ctx, cam, player); });
  step('y-sorted bodies (WNpcs.drawBody per non-hidden NPC)', function () {
    const r = (function () {
      const list = WNpcs.list();
      let drawn = 0;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.hidden) continue;
        WNpcs.drawBody(ctx, n, cam);
        drawn++;
      }
      return { npcs: list.length, drawn: drawn };
    })();
    if (r.npcs === 0) throw new Error('no NPCs in list');
    if (r.drawn === 0) throw new Error('every NPC was hidden — nothing drawn');
    process.stdout.write('      (' + r.drawn + '/' + r.npcs + ' NPCs drawn)\n');
  });
  step('WNpcs.drawChar (player body)', function () {
    WNpcs.drawChar(ctx, player.x, player.y, player.dir, 0, 0, cam);
  });
  step('WNpcs.draw (overlays)', function () { WNpcs.draw(ctx, cam, env1); });
  step('WAction.drawOver', function () { WAction.drawOver(ctx, cam, player); });
  step('WWorld.drawOver', function () { WWorld.drawOver(ctx, cam, env1); });
  step('WParticles.draw', function () { WParticles.draw(ctx, cam); });
  step('WWorld.drawLights', function () { WWorld.drawLights(ctx, cam, env1); });
  step('WWorld.applyTint', function () { WWorld.applyTint(ctx, env1); });
  step('screen-space HUD (draw / drawTitleOn / drawPauseOn / drawSettingsOn)',
       function () { drawScreenUI(ctx, env1); });

  step('WDialogue: register -> start -> update(2) -> draw -> close', function () {
    WDialogue.register({
      smoke_test_node: {
        speaker: 'narrator',
        text: 'Smoke test: this node exists only inside the headless harness.'
      }
    });
    if (!WDialogue.start('smoke_test_node')) {
      throw new Error('WDialogue.start("smoke_test_node") returned false');
    }
    if (!WDialogue.active()) throw new Error('WDialogue not active after start()');
    WDialogue.update(2);                       // fully types the line
    WDialogue.draw(ctx);
    WDialogue.close();
    if (WDialogue.active()) throw new Error('WDialogue still active after close()');
  });

  /* ---- combat FSM: spawn, telegraphed strike, interrupt, dawn dissolve ----
     hurtPlayer no-ops in TITLE state, so assertions stay on enemy internals */
  step('combat FSM (wind-up -> hit interrupt -> dawn despawn)', function () {
    if (typeof WAction.spawnEnemyFor !== 'function') {
      throw new Error('WAction.spawnEnemyFor missing');
    }
    if (typeof WAction.clearEnemies !== 'function') {
      throw new Error('WAction.clearEnemies missing');
    }
    WAction.clearEnemies();
    var e = WAction.spawnEnemyFor('wisp', player.x + 16, player.y);
    if (!e) throw new Error('spawnEnemyFor returned null');
    if (WAction.enemies().length !== 1) throw new Error('enemies().length !== 1');

    var envN = { day: 1, hour: 23, weather: 'clear', night: true,
                 frozen: false, player: player };
    var sawWind = false;
    for (var f = 0; f < 90 && !sawWind; f++) {
      WAction.update(1 / 60, player, envN);
      if (e.windT > 0) sawWind = true;
    }
    if (!sawWind) throw new Error('adjacent wisp never entered wind-up');

    /* a landed staff hit interrupts the charge and costs the wisp 1 hp */
    player.dir = 'right';
    if (!WAction.trySwing(player)) throw new Error('trySwing missed an adjacent wisp');
    if (e.windT !== 0) throw new Error('wind-up survived a landed hit');
    if (e.hp !== 1) throw new Error('wisp hp !== 1 after one hit, got ' + e.hp);

    /* daybreak frees the shadow without a fight */
    var envD = { day: 1, hour: 10, weather: 'clear', night: false,
                 frozen: false, player: player };
    WAction.update(1 / 60, player, envD);
    if (WAction.enemies().length !== 0) throw new Error('wisp survived past dawn');
    player.dir = 'down';
  });

  step('fishing cancel + bag eat (safe calls)', function () {
    if (typeof WAction.cancelFish !== 'function') {
      throw new Error('WAction.cancelFish missing');
    }
    WAction.cancelFish();                 // idle: must be a quiet no-op
    if (typeof WAction.eat !== 'function') throw new Error('WAction.eat missing');
    if (WAction.eat('moonbell')) throw new Error('ate a non-food item');
    if (WAction.eat('nothing_at_all')) throw new Error('ate nothing');
  });

  /* ---- pass 2: night + rain (dark tint, light glows, rain particles) ---- */
  const env2 = { day: 2, hour: 22.5, weather: 'rain', night: true,
                 frozen: false, player: player };
  step('night+rain pass (full draw chain again, rain + glow branches)', function () {
    /* run a handful of frames: a single pass can legitimately emit zero drops
       (rain spawn is per-frame probabilistic) and flake the assertion */
    for (var f = 0; f < 12; f++) {
      WStory.update(env2);
      WAction.update(1 / 60, player, env2);
      WParticles.update(1 / 60, WWorld);
      drawWorldPass(ctx, env2, cam, player);
    }
    drawScreenUI(ctx, env2);
    if (WParticles.count() === 0) throw new Error('no rain particles alive in a rain pass');
  });

  if (failed) process.exit(1);                  // unreachable; kept for clarity
  process.stdout.write('\nSMOKE OK\n');
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error('SMOKE FAIL (uncaught):');
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
}
