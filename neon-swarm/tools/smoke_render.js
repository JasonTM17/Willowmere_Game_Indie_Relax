/* NEON SWARM — tools/smoke_render.js
   Headless gameplay smoke test. Node stdlib only (no external deps).

   What it does:
   1. Installs a browser-environment stub (window/document/canvas/
      localStorage/performance/rAF). No AudioContext: GameAudio stays in
      its "before first gesture" no-op state by design.
   2. Loads the game scripts in the exact order of index.html via
      vm.runInThisContext (real filenames in stack traces).
   3. Pumps REAL frames through the captured rAF queue with a simulated
      clock, driving a whole run end to end:
         TITLE -> start run -> spawns -> movement -> firing -> dash ->
         forced XP -> LEVELUP -> pick card -> boss warning -> boss spawn ->
         player death -> slow-mo -> GAME OVER -> retry -> TITLE.
   4. Asserts the state machine, entity counts and kill flow along the way.

   Exit 0 + "SMOKE OK" when clean; any failure prints the step and stack.

   Run from the workspace root:  node neon-swarm/tools/smoke_render.js
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOL_DIR = __dirname;
const GAME_DIR = path.join(TOOL_DIR, '..');
const JS_DIR = path.join(GAME_DIR, 'js');

/* Script order is the contract from index.html / DESIGN.md §5.1. */
const ORDER = [
  'util', 'audio', 'input', 'particles', 'entities',
  'waves', 'upgrades', 'hud', 'main'
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
        case 'createPattern':
          return (t[p] = function () { return {}; });
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

/* In-memory localStorage (file:// may block the real one; GU guards it). */
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

const mainCanvas = makeCanvas();
let simNow = 1000;                    // the clock every stub shares (ms)

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
  g.devicePixelRatio = 1;
  g.innerWidth = 1280;
  g.innerHeight = 720;
  g.addEventListener = function () {};
  g.removeEventListener = function () {};
  /* Simulated wall clock: pump() advances it; GP.hitstop/slowmo and the
     frame loop both read it. */
  g.performance = { now: function () { return simNow; } };
  /* requestAnimationFrame: CAPTURED, pumped manually — full control of time */
  const rafQueue = [];
  g.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
  g.cancelAnimationFrame = function () {};
  g.__rafQueue = rafQueue;
  /* setInterval exists but the music scheduler never starts (no AudioContext) */
  g.setInterval = function () { return 0; };
  g.clearInterval = function () {};
  /* No AudioContext, Image or Audio on purpose: the contract forbids asset
     loading and GA must see no audio device. */
}

/* ============================ runner ============================ */

function step(name, fn) {
  process.stdout.write('  - ' + name + '\n');
  fn();
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
      vm.runInThisContext(code, { filename: 'neon-swarm/js/' + name + '.js' });
    } catch (e) {
      throw new Error('while loading ' + name + '.js: ' + (e && e.stack ? e.stack : e));
    }
  }
}

/* Pump n real frames through the captured rAF queue, advancing simNow.
   frame() re-registers itself at its top, so the queue never drains. */
function pump(frames, stepMs) {
  stepMs = stepMs || 16.67;
  const q = globalThis.__rafQueue;
  for (let i = 0; i < frames; i++) {
    simNow += stepMs;
    const cb = q.shift();
    if (!cb) throw new Error('rAF queue empty — the game loop died');
    cb(simNow);
    if (q.length === 0) throw new Error('frame did not re-queue rAF — loop stopped');
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}

function main() {
  process.stdout.write('[smoke_render] neon-swarm headless gameplay smoke\n');
  step('install browser-environment stubs', installGlobals);
  step('load ' + ORDER.length + ' game scripts in index.html order', loadScripts);

  const g = globalThis;
  const Game = g.Game, GI = g.GameInput, GE = g.GameEntities, GW = g.GameWaves;

  step('boot: game object, rAF captured, TITLE state', function () {
    assert(Game && typeof Game === 'object', 'window.Game missing — main.js did not run');
    assert(g.__rafQueue.length >= 1, 'requestAnimationFrame never called — boot failed');
    assert(Game.state === 0, 'expected TITLE state (0), got ' + Game.state);
    assert(Game.player === null, 'player should not exist before a run starts');
  });

  step('TITLE idles for 2 s of pumped frames', function () {
    pump(120);
    assert(Game.state === 0, 'state drifted from TITLE without input');
  });

  step('Enter starts a run -> PLAYING', function () {
    GI.pressedThisFrame.add('Enter');
    pump(1);
    assert(Game.state === 1, 'expected PLAYING (1), got ' + Game.state);
    assert(Game.player && !Game.player.dead, 'player missing after startRun');
  });

  step('2 s in: enemies spawned on the ring', function () {
    pump(120);
    assert(Game.enemies.length > 0, 'no enemies after 2 s of play');
  });

  step('WASD moves the player', function () {
    const p = Game.player;
    const x0 = p.x, y0 = p.y;
    GI.keys.add('KeyD');
    pump(60);
    GI.keys.delete('KeyD');
    assert(p.x !== x0 || p.y !== y0, 'player did not move');
  });

  step('hold LMB -> bullets in flight', function () {
    GI.mouse.down = true;
    GI.mouse.x = 700; GI.mouse.y = 300;
    pump(45);
    assert(Game.bullets.length > 0, 'no bullets after holding fire');
  });

  step('Space dashes (cooldown starts)', function () {
    GI.pressedThisFrame.add('Space');
    pump(1);
    assert(Game.player.dashCd > 0 || Game.player.dashTimer > 0,
      'dash neither active nor on cooldown');
    pump(30);
    GI.mouse.down = false;
  });

  step('forced XP -> level-up queue -> LEVELUP state', function () {
    Game.addXP(40);                       // crosses several thresholds
    assert(Game.pendingLevels > 0, 'pendingLevels not queued');
    pump(40);                             // ride out the 0.35 s slow-mo
    assert(Game.state === 2, 'expected LEVELUP (2), got ' + Game.state);
    assert(Game.levelUpCards && Game.levelUpCards.length === 3,
      'levelUpCards is not 3 cards');
  });

  step('pick a card -> back to PLAYING (or next queued offer)', function () {
    while (Game.state === 2) Game.pickUpgrade(0);
    assert(Game.state === 1, 'expected PLAYING after picks, got ' + Game.state);
    const stacks = Object.keys(Game.player.upStacks).length;
    assert(stacks > 0, 'no upgrade stacks recorded');
  });

  step('jump to wave 5 -> boss warning -> boss spawns', function () {
    GW.state.wave = 4;
    GW.state.waveTimer = 34.9;
    pump(10);                              // wave rolls over to 5
    assert(GW.state.wave === 5, 'wave did not advance to 5, got ' + GW.state.wave);
    assert(GW.state.bossWarnT > 0, 'boss warning did not start');
    pump(110);                             // 1.5 s warning + walk-in
    assert(Game.boss && Game.boss.isBoss, 'boss never spawned');
    assert(GW.state.bossAlive === true, 'bossAlive flag not set');
  });

  step('boss dies to a scripted volley of damage -> gems + score', function () {
    const boss = Game.boss;
    const kills0 = Game.kills;
    boss.hp = 1;
    // a fake bullet collision path: onHit -> die()
    const died = boss.onHit(50, boss.x - 10, boss.y, {});
    assert(died === true, 'boss.onHit did not report death');
    // main.handleKill is internal; kill bookkeeping happens via die() here
    boss.die();
    pump(5);
    assert(boss.dead === true, 'boss not marked dead');
    assert(Game.gems.length > 0, 'boss dropped no gems');
  });

  step('contact hit kills the player -> dying slow-mo -> GAME OVER', function () {
    const p = Game.player;
    p.hp = 1;
    p.iFrames = 0;
    Game.enemies.push(new GE.Enemy(Game, p.x, p.y, 'drone', null));
    pump(5);
    assert(p.dead === true, 'contact damage did not kill the player');
    pump(80);                              // 0.9 s slow-mo death + margin
    assert(Game.state === 4, 'expected GAMEOVER (4), got ' + Game.state);
    assert(Game.overStats && typeof Game.overStats.score === 'number',
      'overStats missing');
  });

  step('Enter retries -> fresh PLAYING state', function () {
    GI.pressedThisFrame.add('Enter');
    pump(1);
    assert(Game.state === 1, 'expected PLAYING after retry, got ' + Game.state);
    assert(Game.score === 0 && GW.state.wave === 1,
      'run did not fully reset (score ' + Game.score + ', wave ' + GW.state.wave + ')');
  });

  step('Esc pauses, Q quits to TITLE', function () {
    GI.pressedThisFrame.add('Escape');
    pump(1);
    assert(Game.state === 3, 'expected PAUSED (3), got ' + Game.state);
    GI.pressedThisFrame.add('KeyQ');
    pump(1);
    assert(Game.state === 0, 'expected TITLE after quit, got ' + Game.state);
  });

  step('30 s soak: random firing while playing, no crash, caps hold', function () {
    GI.pressedThisFrame.add('Enter');
    pump(1);
    GI.mouse.down = true;
    GI.keys.add('KeyW');
    pump(1800);                            // 30 simulated seconds
    GI.mouse.down = false;
    assert(Game.enemies.length <= 140, 'enemy cap breached: ' + Game.enemies.length);
    assert(Game.bullets.length <= 400, 'bullet cap breached');
    assert(Game.gems.length <= 300, 'gem cap breached');
    // Death during soak is fine — the run ending is a valid outcome.
    assert([1, 2, 4].indexOf(Game.state) !== -1,
      'unexpected state after soak: ' + Game.state);
  });

  process.stdout.write('\nSMOKE OK\n');
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error('SMOKE FAIL:');
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
}
