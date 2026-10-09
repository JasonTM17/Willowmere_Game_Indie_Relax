/* NEON SWARM - js/waves.js
 * The spawn director: wave timer, spawn ticks, boss scheduling, difficulty
 * scaling and the anti-leak sweep. Spawns only - never mutates the player.
 * Public global: window.GameWaves (alias GW). Contract: DESIGN.md 5.2 + 3.3.
 *
 * main.js calls GW.reset(game) on run start and GW.update(dt, game) every
 * PLAYING frame with WORLD dt (raw dt x GP.getTimeScale()). Requires
 * game.enemies; game.player, game.viewW/game.viewH and game.showBanner are
 * used when present (falls back to the window size / no banner).
 *
 * state extras beyond the documented shape (HUD/main may read):
 *   state.bossWarnT  counts 1.5 -> 0 during the boss warning (red pulse)
 *   state.bossRef    the live GE.Boss (also mirrored on game.boss for HUD)
 *   state.bossQueued a wave-%5 boss was due while a previous boss was still
 *                    alive; the warning fires once that boss dies
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var GA = window.GameAudio;
  var GP = window.GameParticles;
  var GE = window.GameEntities;

  var WAVE_LEN = 35;       // seconds per wave (section 2.2)
  var BOSS_EVERY = 5;      // boss on every 5th wave
  var BOSS_WARN = 1.5;     // warning banner + alarm before the boss walks in
  var LEAK_CHECK = 0.5;    // anti-leak sweep cadence (section 3.3)
  var FIRST_SPAWN = 0.6;   // brief breath before the first spawn

  // Unlock wave + spawn weight per type (section 3.3 "Unlocks & weights").
  var UNLOCK = { drone: 1, darter: 2, splitter: 3, spitter: 4, brute: 4, weaver: 6, mite: 7 };
  var WEIGHT = { drone: 50, darter: 20, splitter: 15, spitter: 10, brute: 8, weaver: 12, mite: 14 };
  // v2: elite chance by wave; surge windows compress the spawn interval.
  var ELITE_CHANCE_LO = 0.06;   // waves 4-8
  var ELITE_CHANCE_HI = 0.10;   // waves 9+
  var SURGE_WAVES = { 8: true, 13: true };
  var SURGE_LEN = 20;           // seconds of compressed spawning
  var SURGE_MULT = 0.55;

  function viewSize(game) {
    var w = game.viewW, h = game.viewH;
    if (!w || !h) {
      w = Math.max(800, (typeof window !== 'undefined' && window.innerWidth) || 800);
      h = Math.max(600, (typeof window !== 'undefined' && window.innerHeight) || 600);
    }
    return { w: w, h: h };
  }

  // ring of radius hypot(viewW, viewH)/2 + 80 around the player (section 2.2)
  function spawnRing(game) {
    var v = viewSize(game);
    return Math.sqrt(v.w * v.w + v.h * v.h) / 2 + 80;
  }

  var GW = {
    WAVE_LEN: WAVE_LEN,          // exposed for the HUD wave-progress bar (v2)
    state: {
      wave: 1,
      waveTimer: 0,
      spawnTimer: 0,
      bossAlive: false,
      bossWarnT: 0,
      bossRef: null,
      bossQueued: false,
      surgeT: 0             // >0 while a surge window compresses spawn ticks
    },

    reset: function (game) {
      var st = this.state;
      st.wave = 1;
      st.waveTimer = 0;
      st.spawnTimer = FIRST_SPAWN;
      st.bossAlive = false;
      st.bossWarnT = 0;
      st.bossRef = null;
      st.bossQueued = false;
      st.surgeT = 0;
      this._leakT = 0;
      if (game) {
        game.boss = null;
        GA.setWave(1);
        if (typeof game.showBanner === 'function') game.showBanner('WAVE 1');
      }
    },

    // Difficulty for the current wave (section 3.3); baked into every spawn.
    scaling: function () {
      var w = this.state.wave;
      var boss = this.state.bossAlive;
      return {
        hpMult: 1 + 0.12 * (w - 1),
        speedMult: Math.min(1.55, 1 + 0.018 * (w - 1)),
        dmgMult: Math.min(2.0, 1 + 0.05 * (w - 1)),
        xpMult: 1 + 0.04 * (w - 1),
        // x1.8 interval during a boss wave = ~55% spawn rate; surges x0.55.
        spawnInterval: Math.max(0.16, 0.85 - 0.06 * (w - 1)) * (boss ? 1.8 : 1) *
          (this.state.surgeT > 0 ? SURGE_MULT : 1),
        maxAlive: Math.min(140, 60 + 10 * w)
      };
    },

    // Weighted sample among types unlocked by the current wave.
    pickType: function (wave) {
      var total = 0;
      var k;
      for (k in WEIGHT) if (UNLOCK[k] <= wave) total += WEIGHT[k];
      var roll = Math.random() * total;
      for (k in WEIGHT) {
        if (UNLOCK[k] > wave) continue;
        roll -= WEIGHT[k];
        if (roll <= 0) return k;
      }
      return 'drone';
    },

    update: function (dt, game) {
      if (!game || !game.enemies) return;
      var st = this.state;
      var p = game.player;

      // Boss death bookkeeping (entities set .dead; GW owns bossAlive). A
      // queued boss wave starts its warning now that the old boss is gone.
      if (st.bossRef && st.bossRef.dead) {
        st.bossRef = null;
        st.bossAlive = false;
        game.boss = null;
        if (st.bossQueued) {
          st.bossQueued = false;
          this._queueBossWarning(game);
        }
      }

      // Wave progression: a new wave every 35 s.
      st.waveTimer += dt;
      while (st.waveTimer >= WAVE_LEN) {
        st.waveTimer -= WAVE_LEN;
        st.wave += 1;
        this._onWaveStart(game);
      }

      // Boss warning countdown -> walks in from 500 px above the player.
      if (st.bossWarnT > 0) {
        st.bossWarnT -= dt;
        if (st.bossWarnT <= 0) this._spawnBoss(game);
      }

      // Surge window countdown (waves 8 and 13 open one via _onWaveStart).
      if (st.surgeT > 0) st.surgeT -= dt;

      // Regular spawn ticks; over the alive cap the tick is skipped.
      var sc = this.scaling();
      st.spawnTimer -= dt;
      while (st.spawnTimer <= 0) {
        st.spawnTimer += sc.spawnInterval;
        if (game.enemies.length < sc.maxAlive) this._spawnOne(game, sc);
      }

      // Anti-leak: anything farther than 1.6 x spawnRing teleports back to the
      // ring edge so pressure never leaks away (section 3.3).
      this._leakT -= dt;
      if (this._leakT <= 0 && p) {
        this._leakT = LEAK_CHECK;
        var ring = spawnRing(game);
        var lim = (1.6 * ring) * (1.6 * ring);
        var es = game.enemies;
        for (var i = 0; i < es.length; i++) {
          var e = es[i];
          if (GU.dist2(e.x, e.y, p.x, p.y) > lim) {
            var a = GU.angleTo(p.x, p.y, e.x, e.y);
            e.x = p.x + Math.cos(a) * ring;
            e.y = p.y + Math.sin(a) * ring;
            e.kbX = 0;
            e.kbY = 0;
          }
        }
      }
    },

    _onWaveStart: function (game) {
      var st = this.state;
      GA.setWave(st.wave);
      // Banner with any first-time unlocks (unlock table, section 3.3).
      var fresh = [];
      var k;
      for (k in UNLOCK) if (UNLOCK[k] === st.wave) fresh.push(k.toUpperCase());
      var text = 'WAVE ' + st.wave + (fresh.length ? ' \u00B7 NEW: ' + fresh.join(', ') : '');
      if (SURGE_WAVES[st.wave]) {                    // v2 surge event
        st.surgeT = SURGE_LEN;
        if (typeof game.showBanner === 'function') {
          game.showBanner('SURGE', 'THE SWARM THICKENS');
        }
      } else if (typeof game.showBanner === 'function') {
        var GC = window.GameCodex;                   // wave whispers (v2 story)
        var wh = GC && GC.whisper ? GC.whisper(st.wave) : null;
        game.showBanner(text, wh);
      }
      // Every 5th wave: warning banner + alarm 1.5 s before the boss walks in.
      // If a previous boss is still alive, defer instead of overwriting
      // st.bossRef (that would orphan the old boss: no HUD bar, x1.8 off).
      if (st.wave % BOSS_EVERY === 0) {
        if (st.bossAlive) st.bossQueued = true;
        else this._queueBossWarning(game);
      }
    },

    _queueBossWarning: function (game) {
      var st = this.state;
      st.bossWarnT = BOSS_WARN;
      var GC = window.GameCodex;              // runtime-only dep (loaded later)
      var n = Math.max(1, Math.floor(st.wave / BOSS_EVERY));
      var line = GC && GC.bossLine ? GC.bossLine(n) : null;
      if (typeof game.showBanner === 'function') game.showBanner('BOSS INCOMING', line);
      GA.bossWarn();
    },

    _spawnBoss: function (game) {
      var st = this.state;
      var p = game.player;
      var n = Math.max(1, Math.floor(st.wave / BOSS_EVERY));  // boss count
      var boss = new GE.Boss(game, p ? p.x : 0, p ? p.y - 500 : -500, n);
      var GC = window.GameCodex;
      if (GC && GC.bossTitle) boss.title = GC.bossTitle(n);   // HUD boss-bar name
      game.enemies.push(boss);
      game.boss = boss;              // convenience ref for the HUD boss bar
      st.bossAlive = true;
      st.bossRef = boss;
      GP.addTrauma(0.3);             // boss spawn shake (section 5.2)
    },

    _spawnOne: function (game, sc) {
      var p = game.player;
      var ring = spawnRing(game);
      var a = GU.rand(0, GU.TAU);
      var x = p ? p.x + Math.cos(a) * ring : Math.cos(a) * ring;
      var y = p ? p.y + Math.sin(a) * ring : Math.sin(a) * ring;
      var mult = { hpMult: sc.hpMult, speedMult: sc.speedMult, dmgMult: sc.dmgMult, xpMult: sc.xpMult };
      // v2 elite roll: 6% from wave 4, 10% from wave 9.
      var elite = this.state.wave >= 4 &&
        Math.random() < (this.state.wave >= 9 ? ELITE_CHANCE_HI : ELITE_CHANCE_LO);
      game.enemies.push(new GE.Enemy(game, x, y, this.pickType(this.state.wave), mult, elite));
    }
  };

  GW._leakT = 0;

  window.GameWaves = GW;
})();
