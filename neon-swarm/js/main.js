/* NEON SWARM - js/main.js
 * Assembly, state machine, render loop, and the single collision step.
 * Public global: window.Game. Contract: DESIGN.md sections 5.2 / 5.3 / 6 / 7 / 8.
 *
 * States: TITLE -> PLAYING <-> PAUSED, PLAYING -> LEVELUP -> PLAYING,
 * PLAYING (dying, 0.9 s slow-mo) -> GAMEOVER -> PLAYING / TITLE. Retry is
 * unlimited; every run resets arrays, waves, stats and the banner queue.
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var GA = window.GameAudio;
  var GI = window.GameInput;
  var GP = window.GameParticles;
  var GE = window.GameEntities;
  var GW = window.GameWaves;
  var GV = window.GameUpgrades;
  var GC = window.GameCodex;
  var HUD = window.GameHUD;

  var BEST_KEY = 'neon-swarm.best';
  var SETTINGS_KEY = 'neon-swarm.settings';
  var ST = { TITLE: 0, PLAYING: 1, LEVELUP: 2, PAUSED: 3, GAMEOVER: 4, SETTINGS: 5,
             PROLOGUE: 6, CODEX: 7, ENDING: 8 };
  var MIN_W = 800;
  var MIN_H = 600;

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var viewW = MIN_W;
  var viewH = MIN_H;
  var vignette = null;
  var hurtVignette = null;
  var cam = { x: 0, y: 0 };

  // Collision infrastructure for the single step (section 5.3): a uniform grid
  // rebuilt per frame plus two scratch arrays for the nested queries.
  var grid = new GE.SpatialGrid(64);
  var candA = [];
  var candB = [];

  function xpToNext(level) { return 4 + 3 * level; }   // section 2.3

  function loadBest() {
    var b = GU.storage.get(BEST_KEY);
    if (b && typeof b.score === 'number' && isFinite(b.score)) return b;
    return null;
  }

  // Settings (v2): persisted, applied to audio/particles/HUD on change.
  function loadSettings() {
    var s = GU.storage.get(SETTINGS_KEY);
    var d = { music: 7, sfx: 8, shake: true, scanlines: true, minimap: true };
    if (s && typeof s === 'object') {
      for (var k in d) if (s[k] !== undefined) d[k] = s[k];
    }
    return d;
  }

  function applySettings() {
    var s = game.settings;
    GA.setMusicVolume(s.music / 10);
    GA.setSfxVolume(s.sfx / 10);
    GP.setShakeEnabled(s.shake);
    GU.storage.set(SETTINGS_KEY, s);
  }

  var game = {
    state: ST.TITLE,
    clock: 0,        // wall clock since load (UI blinking)
    animT: 0,        // decorative time; frozen during PAUSED
    titleT: 0,
    viewW: viewW,
    viewH: viewH,
    player: null,
    enemies: [],
    bullets: [],
    enemyBullets: [],
    gems: [],
    boss: null,
    score: 0,
    kills: 0,
    combo: 0,
    comboT: 0,
    level: 1,
    xp: 0,
    xpNeed: 7,
    pendingLevels: 0,   // queued card offers (one pickup may cross 2 thresholds)
    levelUpDelay: 0,
    levelUpCards: null,
    dying: false,
    deathT: 0,
    runTime: 0,
    overStats: null,
    best: null,

    // v2 screens/navigation state
    settings: loadSettings(),
    titleSel: 0,
    pauseSel: 0,
    settingsSel: 0,
    settingsFrom: ST.TITLE,          // where SETTINGS returns to
    titleItems: [
      { label: 'START RUN' },
      { label: 'CODEX' },
      { label: 'SETTINGS' }
    ],
    pauseItems: [
      { label: 'RESUME' },
      { label: 'SETTINGS' },
      { label: 'QUIT TO TITLE' }
    ],
    settingsItems: [
      { label: 'MUSIC', kind: 'slider', key: 'music' },
      { label: 'SFX', kind: 'slider', key: 'sfx' },
      { label: 'SCREEN SHAKE', kind: 'toggle', key: 'shake' },
      { label: 'SCANLINES', kind: 'toggle', key: 'scanlines' },
      { label: 'MINIMAP', kind: 'toggle', key: 'minimap' },
      { label: 'BACK', kind: 'back' }
    ],
    fadeT: 0,                        // state-transition fade, seconds remaining
    gridPulseT: 0,                   // wave-start ripple across the grid
    lastWave: 1,
    levelUpShownAt: 0,
    overShownAt: 0,
    epitaph: null,                   // set by the story layer (v2)

    // v2 story state
    prolLine: 0,                     // prologue typewriter position
    prolChars: 0,
    codexSel: 0,                     // codex list scroll position
    lastBossN: 0,                    // n of the most recently killed boss
    dawnBroken: false,               // DAWN ending already fired this run
    endless: false,                  // continuing past the victory threshold

    mouseWorld: function () {
      return { x: GI.mouse.x + cam.x, y: GI.mouse.y + cam.y };
    },

    comboMult: function () {                          // section 2.4, cap x3.0
      return Math.min(3, 1 + 0.1 * Math.floor(game.combo / 10));
    },

    showBanner: function (text, sub) { HUD.showBanner(text, sub); },

    // Killers already applied the combo multiplier (entities.js); never x2 here.
    addScore: function (n) { game.score += n; },

    addXP: function (n) {
      var p = game.player;
      if (!p || p.dead || game.state !== ST.PLAYING) return;
      game.xp += n;
      var crossed = false;
      while (game.xp >= game.xpNeed) {
        game.xp -= game.xpNeed;
        game.level += 1;
        game.xpNeed = xpToNext(game.level);
        game.pendingLevels += 1;
        crossed = true;
      }
      if (crossed && game.levelUpDelay <= 0) {
        GA.levelup();
        GP.slowmo(0.25, 0.35);                        // section 2.2 slow-mo
        GP.burst(p.x, p.y, { color: '#ffb300', count: 18, speed: [80, 220], life: [0.3, 0.6], size: 3 });
        GP.floatText(p.x, p.y - 26, 'LEVEL UP', { color: '#ffb300', size: 16 });
        game.levelUpDelay = 0.35;
      }
    },

    startRun: function () { startRun(); },
    showLevelUp: function () { showLevelUp(); },
    pickUpgrade: function (i) { pickUpgrade(i); },
    gameOver: function () { doGameOver(); }
  };

  window.Game = game;

  // ---- canvas / resize (section 7.7) -----------------------------------------

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = Math.max(MIN_W, window.innerWidth);
    viewH = Math.max(MIN_H, window.innerHeight);
    game.viewW = viewW;
    game.viewH = viewH;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vignette = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.36,
      viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(2,2,14,0.55)');
    hurtVignette = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.30,
      viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.70);
    hurtVignette.addColorStop(0, 'rgba(255,40,60,0)');
    hurtVignette.addColorStop(1, 'rgba(255,40,60,0.55)');
  }

  // ---- state transitions -------------------------------------------------------

  function startRun() {
    GP.reset();
    GW.reset(game);
    game.fadeT = 0.3;
    game.gridPulseT = 0;
    game.lastWave = 1;
    game.player = new GE.Player(game, 0, 0);
    game.enemies = [];
    game.bullets = [];
    game.enemyBullets = [];
    game.gems = [];
    game.pickups = [];
    game.boss = null;
    game.score = 0;
    game.kills = 0;
    game.combo = 0;
    game.comboT = 0;
    game.level = 1;
    game.xp = 0;
    game.xpNeed = xpToNext(1);
    game.pendingLevels = 0;
    game.levelUpDelay = 0;
    game.levelUpCards = null;
    game.dying = false;
    game.deathT = 0;
    game.runTime = 0;
    game.overStats = null;
    game.lastBossN = 0;
    game.dawnBroken = false;
    game.endless = false;
    cam.x = game.player.x - viewW / 2;                 // camera follow (5.3)
    cam.y = game.player.y - viewH / 2;
    HUD.clearBanners();
    game.state = ST.PLAYING;
    GA.startMusic();
  }

  function toTitle() {
    GA.stopMusic();
    game.titleSel = 0;
    game.fadeT = 0.3;
    game.state = ST.TITLE;
  }

  // START RUN entry: the prologue typewriter runs once ever (persisted);
  // every later run goes straight to PLAYING.
  function enterRun() {
    if (!GC.data.seenPrologue) {
      game.prolLine = 0;
      game.prolChars = 0;
      game.state = ST.PROLOGUE;
      game.fadeT = 0.3;
    } else {
      startRun();
    }
  }

  // The third Sovereign (boss n>=3, wave 15) dying fires the DAWN ending.
  // main owns this check; the run may then continue as Endless Protocol.
  function startEnding() {
    game.dawnBroken = true;
    GC.unlock('victory');
    GC.data.won = true;
    GC.save();
    GA.stopMusic();
    GA.dawn();
    game.fadeT = 0.6;
    game.state = ST.ENDING;
  }

  function showLevelUp() {
    game.levelUpCards = GV.roll3(game.player);
    game.levelUpShownAt = game.clock;                  // card deal-in timer
    game.state = ST.LEVELUP;                           // world freezes; cards in
  }

  function pickUpgrade(i) {
    if (game.state !== ST.LEVELUP) return;
    var card = game.levelUpCards && game.levelUpCards[i];
    if (!card) return;
    if (GV.apply(game.player, card.id)) GA.uiSelect();
    game.pendingLevels = Math.max(0, game.pendingLevels - 1);
    if (game.pendingLevels > 0) {
      game.levelUpCards = GV.roll3(game.player);       // queue back-to-back (2.2)
    } else {
      game.state = ST.PLAYING;
      game.player.iFrames = Math.max(game.player.iFrames, 0.5);   // resume i-frames
    }
  }

  // HP <= 0: slow-mo 0.2x for 0.9 s + explosion, then the GAME OVER screen.
  function startDeath() {
    if (game.dying) return;
    game.dying = true;
    game.deathT = 0.9;
    var p = game.player;
    GP.slowmo(0.2, 0.9);
    GP.burst(p.x, p.y, { color: '#35e6ff', count: 40, speed: [60, 260], life: [0.3, 0.7], size: 3.4 });
    GP.burst(p.x, p.y, { color: '#ffffff', count: 16, speed: [40, 160], life: [0.2, 0.5], size: 2.4 });
    GP.shockwave(p.x, p.y, '#35e6ff', 130, 0.35);
    GP.addTrauma(0.5);
    GP.hitstop(80);
    GA.explode();
  }

  function doGameOver() {
    var isNew = !game.best || game.score > game.best.score;
    var rec = {
      score: game.score,
      wave: GW.state.wave,
      level: game.level,
      kills: game.kills,
      time: Math.floor(game.runTime)
    };
    if (isNew) {
      game.best = rec;
      GU.storage.set(BEST_KEY, rec);                   // try/catch inside GU.storage
    }
    game.overStats = {
      time: rec.time, wave: rec.wave, level: rec.level,
      kills: rec.kills, score: rec.score, isNewBest: isNew
    };
    GC.unlock('firstDeath');
    game.epitaph = GC.epitaph(game.overStats);
    game.dying = false;
    game.overShownAt = game.clock;                     // stats count-up timer
    GA.stopMusic();
    GA.gameOver();
    game.fadeT = 0.3;
    game.state = ST.GAMEOVER;
  }

  // ---- the single collision step (section 5.3) ---------------------------------

  // Kill bookkeeping that entities.js deliberately leaves to main: kills,
  // combo, kill shake, lifesteal, flow refund; then the entity's own die().
  function handleKill(e) {
    if (e.killHandled) return;
    e.killHandled = true;
    game.kills += 1;
    game.combo += 1;
    // Story: first kill of each species / first elite / each Sovereign.
    if (e.isBoss) { game.lastBossN = e.n || 0; GC.unlock('boss'); }
    else GC.unlock(e.typeName);
    if (e.elite) GC.unlock('elite');
    var p = game.player;
    game.comboT = 2.0 + (p.stats.comboWindow || 0);    // Tempo widens the window
    p.novaCharge = Math.min(p.novaNeed, p.novaCharge + 1);   // every kill feeds the nova
    GP.addTrauma(0.05);                                // juice #1 kill shake
    if (p.stats.lifestealPerKill > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.stats.lifestealPerKill);
    }
    if (p.stats.flow > 0 && p.flowWindowActive()) {
      p.refundDash(p.stats.flow);                      // Flow State refund
    }
    e.die();
    // Shrapnel: kills fan out a ring of weak short-range fragments.
    if (p.stats.shrapnel > 0) {
      for (var sk = 0; sk < p.stats.shrapnel; sk++) {
        var sa = GU.rand(0, GU.TAU);
        if (game.bullets.length < 400) {
          game.bullets.push(new GE.Bullet(game, e.x, e.y, sa, {
            speed: 430, dmg: GE.PLAYER_BASE.dmg * p.stats.dmgMult * 0.35,
            pierce: 0, radius: 3, range: 230, crit: false
          }));
        }
      }
    }
  }

  // Arc Web: lightning arcs from the hit enemy to the nearest chainTargets
  // enemies within 170 px for 50% of the hit's damage (proc owned by main).
  function doChain(primary, bullet) {
    var st = game.player.stats;
    if (st.chainChance <= 0 || st.chainTargets <= 0) return;
    if (!GU.chance(st.chainChance)) return;
    var cands = grid.query(primary.x, primary.y, 170 + 40, candB);
    var hits = [];
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e === primary || e.dead || e.killHandled) continue;
      if (bullet.hitSet.has(e.id)) continue;
      var d2 = GU.dist2(primary.x, primary.y, e.x, e.y);
      if (d2 <= 170 * 170) hits.push({ e: e, d2: d2 });
    }
    hits.sort(function (a, b) { return a.d2 - b.d2; });
    var n = Math.min(st.chainTargets, hits.length);
    var dmg = bullet.dmg * 0.5;
    for (var k = 0; k < n; k++) {
      var t = hits[k].e;
      GP.bolt(primary.x, primary.y, t.x, t.y, '#35e6ff');
      if (t.onHit(dmg, primary.x, primary.y, {})) handleKill(t);
    }
  }

  // Volatile Rounds: on the bullet's final hit, explode for boomDmgMult of the
  // bullet's damage inside boomRadius (proc owned by main).
  function doBoom(bullet, primary) {
    var st = game.player.stats;
    if (st.boomRadius <= 0 || st.boomDmgMult <= 0) return;
    GP.shockwave(bullet.x, bullet.y, '#ffb300', st.boomRadius, 0.35);   // juice #14
    GP.burst(bullet.x, bullet.y, { color: '#ff9f1c', count: 12, speed: [60, 220], life: [0.25, 0.5], size: 3 });
    GA.explode();
    var cands = grid.query(bullet.x, bullet.y, st.boomRadius + 40, candB);
    var dmg = bullet.dmg * st.boomDmgMult;
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e === primary || e.dead || e.killHandled) continue;
      var rr = st.boomRadius + e.r;
      if (GU.dist2(bullet.x, bullet.y, e.x, e.y) <= rr * rr) {
        if (e.onHit(dmg, bullet.x, bullet.y, {})) handleKill(e);
      }
    }
  }

  // Ricochet: when a bullet would die at pierce-end, retarget it to the
  // nearest un-hit enemy within 260 px. Returns true when it kept flying.
  function tryRicochet(b) {
    var st = game.player.stats;
    if (!st.bounce || (b.bounced || 0) >= st.bounce) return false;
    var cands = grid.query(b.x, b.y, 300, candB);
    var best = null, bd = 260 * 260;
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e.dead || e.killHandled || b.hitSet.has(e.id)) continue;
      var d2 = GU.dist2(b.x, b.y, e.x, e.y);
      if (d2 < bd) { bd = d2; best = e; }
    }
    if (!best) return false;
    b.dead = false;
    b.bounced = (b.bounced || 0) + 1;
    b.angle = GU.angleTo(b.x, b.y, best.x, best.y);
    b.vx = Math.cos(b.angle) * b.speed;
    b.vy = Math.sin(b.angle) * b.speed;
    GP.bolt(b.x, b.y, best.x, best.y, '#aef6ff');
    return true;
  }

  // Nova bomb (RMB / Shift): 200 dmg inside 150 px, clears enemy bullets
  // inside 230 px. Charged by kills (player.novaCharge / novaNeed).
  function tryNova() {
    var p = game.player;
    if (!p || p.dead || p.novaCharge < p.novaNeed) return;
    p.novaCharge = 0;
    GC.unlock('nova');
    GP.shockwave(p.x, p.y, '#ffd166', 230, 0.45);
    GP.shockwave(p.x, p.y, '#ffffff', 150, 0.35);
    GP.burst(p.x, p.y, { color: '#ffd166', count: 40, speed: [120, 380], life: [0.3, 0.6], size: 3 });
    GP.addTrauma(0.4);
    GA.nova();
    GP.floatText(p.x, p.y - 30, 'NOVA', { color: '#ffd166', size: 18 });
    var NOVA_R = 150;
    var cands = grid.query(p.x, p.y, NOVA_R + 60, candB);
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e.dead || e.killHandled) continue;
      var nr = NOVA_R + e.r;
      if (GU.dist2(e.x, e.y, p.x, p.y) <= nr * nr) {
        if (e.onHit(200, p.x, p.y, {})) handleKill(e);
      }
    }
    for (i = 0; i < game.enemyBullets.length; i++) {
      var eb = game.enemyBullets[i];
      if (eb.dead) continue;
      if (GU.dist2(eb.x, eb.y, p.x, p.y) <= 230 * 230) {
        eb.dead = true;
        GP.burst(eb.x, eb.y, { color: '#c86bff', count: 3, speed: 80, life: 0.2, size: 1.8 });
      }
    }
  }

  function collide(edt) {
    var p = game.player;
    var st = p.stats;
    var i, j, e;

    // 1) player bullets x enemies: pierce / crit / chain / boom resolved here
    for (i = 0; i < game.bullets.length; i++) {
      var b = game.bullets[i];
      if (b.dead) continue;
      var cands = grid.query(b.x, b.y, b.radius + 40, candA);
      for (j = 0; j < cands.length; j++) {
        e = cands[j];
        if (e.dead || e.killHandled || b.dead) continue;
        if (b.hitSet.has(e.id)) continue;
        var rr = b.radius + e.r;
        if (GU.dist2(b.x, b.y, e.x, e.y) > rr * rr) continue;
        // Execution: bonus damage against enemies under 30% HP.
        var edmg = b.dmg;
        if (st.executeMult > 0 && e.hp / e.maxHp < 0.3) edmg *= (1 + st.executeMult);
        var died = e.onHit(edmg, b.x, b.y, { crit: b.crit });
        b.hitSet.add(e.id);
        doChain(e, b);
        var finalHit = false;
        if (b.pierce > 0) b.pierce -= 1;
        else { b.dead = true; finalHit = true; }
        if (finalHit && !tryRicochet(b)) doBoom(b, e);
        if (died) handleKill(e);
        if (b.dead) break;
      }
    }

    // 2) enemy bullets x player
    if (!p.dead) {
      for (i = 0; i < game.enemyBullets.length; i++) {
        var eb = game.enemyBullets[i];
        if (eb.dead) continue;
        var er = eb.r + p.r;
        if (GU.dist2(eb.x, eb.y, p.x, p.y) <= er * er) {
          if (p.iFrames > 0) continue;     // dash/hurt i-frames: pass through (2.1)
          eb.dead = true;
          if (p.takeDamage(eb.dmg, eb.x, eb.y)) startDeath();
        }
      }
    }

    // 3) enemies x player: contact damage (Plating resists a fraction) plus
    //    the mite detonation AoE resolved exactly once per detonated mite.
    if (!p.dead) {
      var resist = 1 - (st.contactResist || 0);
      for (i = 0; i < game.enemies.length; i++) {
        e = game.enemies[i];
        if (e.detonated && !e.detonateDone) {          // mite blast, once
          e.detonateDone = true;
          var dr = e.detonateRadius + p.r;
          if (GU.dist2(e.x, e.y, p.x, p.y) <= dr * dr) {
            if (p.takeDamage(e.detonateDmg * resist, e.x, e.y)) startDeath();
          }
          continue;
        }
        if (e.dead) continue;
        var cr = e.r + p.r;
        if (GU.dist2(e.x, e.y, p.x, p.y) <= cr * cr) {
          if (p.takeDamage(e.dmg * resist, e.x, e.y)) startDeath();
        }
      }
    }

    // 4) Static Field aura tick (continuous damage: no per-tick number spam)
    if (st.auraDps > 0 && st.auraRadius > 0) {
      var aCands = grid.query(p.x, p.y, st.auraRadius + 40, candB);
      for (i = 0; i < aCands.length; i++) {
        e = aCands[i];
        if (e.dead || e.killHandled) continue;
        var ar = st.auraRadius + e.r;
        if (GU.dist2(e.x, e.y, p.x, p.y) <= ar * ar) {
          e.hp -= st.auraDps * edt;
          e.flash = Math.max(e.flash, 0.03);
          if (e.hp <= 0) handleKill(e);
        }
      }
    }
    // 5) regen lives in Player.update; 6) gem pickup lives in Gem.update;
    // 7) combo timer decay runs in stepPlaying (order per section 5.3).

    // 8) power pickups x player (v2): walk over a pod to arm its timer.
    if (!p.dead) {
      for (i = 0; i < game.pickups.length; i++) {
        var pk = game.pickups[i];
        if (pk.dead) continue;
        var pr = 16 + p.r;
        if (GU.dist2(pk.x, pk.y, p.x, p.y) <= pr * pr) {
          pk.dead = true;
          var pdef = GE.PICKUP_TYPES[pk.kind];
          p.pickups[pk.kind] = pdef.dur;
          GC.unlock('pickup');
          GA.power();
          GP.burst(pk.x, pk.y, { color: pdef.color, count: 10, speed: 120, life: 0.3, size: 2.4 });
          GP.floatText(pk.x, pk.y - 14, pdef.name, { color: pdef.color, size: 13 });
        }
      }
    }
  }

  // Swap-remove dead entries; order within the array does not matter.
  function prune(arr) {
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].dead) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
  }

  // World update in the contract order (section 5.3). edt is world dt.
  function updateWorld(edt) {
    GW.update(edt, game);
    var i;
    if (!game.player.dead) game.player.update(edt);
    cam.x = game.player.x - viewW / 2;                 // camera follow (5.3): locked
    cam.y = game.player.y - viewH / 2;                 // to the player every frame
    for (i = 0; i < game.enemies.length; i++) game.enemies[i].update(edt);   // boss included
    for (i = 0; i < game.enemyBullets.length; i++) game.enemyBullets[i].update(edt);
    for (i = 0; i < game.bullets.length; i++) game.bullets[i].update(edt);
    grid.rebuild(game.enemies);
    collide(edt);
    for (i = 0; i < game.gems.length; i++) game.gems[i].update(edt);
    for (i = 0; i < game.pickups.length; i++) game.pickups[i].update(edt);
    prune(game.enemies);
    prune(game.bullets);
    prune(game.enemyBullets);
    prune(game.gems);
    prune(game.pickups);
    game.runTime += edt;
  }

  // ---- per-state steps ---------------------------------------------------------

  // Menu helpers: selection index wraps on ↑↓/W S; menuClick returns the
  // clicked item index, -2 when the click landed off-menu, -1 no click.
  function menuNav(sel, count) {
    if (GI.justPressed('ArrowUp') || GI.justPressed('KeyW')) return (sel + count - 1) % count;
    if (GI.justPressed('ArrowDown') || GI.justPressed('KeyS')) return (sel + 1) % count;
    return sel;
  }

  function menuClick() {
    if (!GI.consumeClick()) return -1;
    var mx = GI.mouse.x;
    var my = GI.mouse.y;
    for (var i = 0; i < HUD.menuRects.length; i++) {
      var r = HUD.menuRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.i;
    }
    return -2;
  }

  function backFromSettings() {
    game.state = game.settingsFrom;
    GA.uiSelect();
  }

  function stepPlaying(dt) {
    if (GI.justPressed('KeyP') || GI.justPressed('Escape')) {   // PLAYING -> PAUSED
      game.state = ST.PAUSED;
      GA.uiSelect();
      return;
    }

    // Death sequence: world runs at 0.2x (GP.slowmo) until the timer ends.
    if (game.dying) {
      game.deathT -= dt;
      var dts = dt * GP.getTimeScale();
      updateWorld(dts);
      GP.update(dts);
      HUD.update(dt);
      if (game.deathT <= 0) doGameOver();
      return;
    }

    if (GI.justPressed('Space')) game.player.tryDash();
    if (GI.consumeRmb() || GI.justPressed('ShiftLeft') || GI.justPressed('ShiftRight')) {
      tryNova();                                        // v2 nova bomb
    }

    // Wave-start ripple (v2): grid brightens + a ring rolls off the player.
    if (GW.state.wave !== game.lastWave) {
      game.lastWave = GW.state.wave;
      game.gridPulseT = 0.9;
      GP.shockwave(game.player.x, game.player.y, '#35e6ff', 420, 0.7);
      // Story triggers: wave milestones + the surge archive entries.
      GC.unlock('wave' + game.lastWave);
      if (game.lastWave === 8 || game.lastWave === 13) GC.unlock('surge');
    }
    game.gridPulseT = Math.max(0, game.gridPulseT - dt);

    // Level-up trigger: after the 0.35 s slow-mo, freeze into the card screen.
    if (game.pendingLevels > 0) {
      if (game.levelUpDelay > 0) game.levelUpDelay -= dt;
      if (game.levelUpDelay <= 0) { showLevelUp(); return; }
    }

    var edt = dt * GP.getTimeScale();                  // hitstop / slow-mo scale
    updateWorld(edt);

    // Victory check: the wave-15 Sovereign just fell -> DAWN ending.
    if (game.lastBossN >= 3 && !game.dawnBroken && !game.dying) {
      startEnding();
      return;
    }
    GP.update(edt);
    HUD.update(dt);

    if (game.comboT > 0) {                             // combo decay (section 2.4)
      game.comboT -= edt;
      if (game.comboT <= 0) { game.comboT = 0; game.combo = 0; }
    }
  }

  function step(dt) {
    game.clock += dt;
    game.fadeT = Math.max(0, game.fadeT - dt);         // transition overlay decay
    if (GI.justPressed('KeyM')) GA.toggleMute();       // any state (section 2.1)

    switch (game.state) {
      case ST.TITLE: {
        game.titleT += dt;
        cam.x = Math.sin(game.titleT * 0.06) * 480;    // slow drift over the grid
        cam.y = game.titleT * 16;
        var ti = game.titleItems;
        var prev = game.titleSel;
        game.titleSel = menuNav(game.titleSel, ti.length);
        if (game.titleSel !== prev) GA.uiSelect();
        var tc = menuClick();                          // >=0 item, -2 off-menu, -1 none
        var confirm = GI.justPressed('Enter') || GI.justPressed('Space');
        var pick = (tc >= 0) ? tc : ((confirm || tc === -2) ? game.titleSel : -1);
        if (pick >= 0 && pick < ti.length && !ti[pick].disabled) {
          GA.uiSelect();
          var label = ti[pick].label;
          if (label === 'SETTINGS') {
            game.settingsFrom = ST.TITLE;
            game.settingsSel = 0;
            game.state = ST.SETTINGS;
          } else if (label === 'CODEX') {
            game.codexSel = 0;
            game.state = ST.CODEX;
          } else {
            enterRun();
          }
        }
        HUD.update(dt);
        break;
      }

      case ST.PLAYING:
        stepPlaying(dt);
        break;

      case ST.LEVELUP:
        if (GI.consumeClick()) {                       // card hit-test via HUD rects
          var mx = GI.mouse.x;
          var my = GI.mouse.y;
          for (var i = 0; i < HUD.cardRects.length; i++) {
            var r = HUD.cardRects[i];
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
              pickUpgrade(i);
              break;
            }
          }
        }
        if (GI.justPressed('Digit1')) pickUpgrade(0);
        else if (GI.justPressed('Digit2')) pickUpgrade(1);
        else if (GI.justPressed('Digit3')) pickUpgrade(2);
        GP.update(dt * 0.3);                           // particles at 0.3x behind the overlay
        HUD.update(dt);
        break;

      case ST.PAUSED:
        if (GI.justPressed('KeyP') || GI.justPressed('Escape')) {
          game.state = ST.PLAYING;
          GA.uiSelect();
          break;
        }
        game.pauseSel = menuNav(game.pauseSel, game.pauseItems.length);
        var pc = menuClick();
        var pp = (pc >= 0) ? pc : (GI.justPressed('Enter') ? game.pauseSel : -1);
        if (pp >= 0 && pp < game.pauseItems.length) {
          GA.uiSelect();
          if (pp === 0) game.state = ST.PLAYING;
          else if (pp === 1) {
            game.settingsFrom = ST.PAUSED;
            game.settingsSel = 0;
            game.state = ST.SETTINGS;
          }
          else toTitle();
        } else if (GI.justPressed('KeyQ')) {
          toTitle();
        }
        break;

      case ST.SETTINGS: {
        var items = game.settingsItems;
        var prevS = game.settingsSel;
        game.settingsSel = menuNav(game.settingsSel, items.length);
        if (game.settingsSel !== prevS) GA.uiSelect();
        var mc = menuClick();
        if (mc >= 0 && mc < items.length) game.settingsSel = mc;
        var it = items[game.settingsSel];
        var left = GI.justPressed('ArrowLeft') || GI.justPressed('KeyA');
        var right = GI.justPressed('ArrowRight') || GI.justPressed('KeyD');
        var act = GI.justPressed('Enter') || (mc === game.settingsSel && mc >= 0);
        if (it.kind === 'slider' && (left || right)) {
          game.settings[it.key] = GU.clamp(game.settings[it.key] + (right ? 1 : -1), 0, 10);
          applySettings();
          GA.uiSelect();
        } else if (it.kind === 'toggle' && (left || right || act)) {
          game.settings[it.key] = !game.settings[it.key];
          applySettings();
          GA.uiSelect();
        } else if (it.kind === 'back' && act) {
          backFromSettings();
          break;
        }
        if (GI.justPressed('Escape')) backFromSettings();
        HUD.update(dt);
        break;
      }

      case ST.GAMEOVER:
        GP.update(dt);                                 // only GP runs (5.3): death explosion
        if (GI.consumeClick() || GI.justPressed('Enter')) startRun();
        else if (GI.justPressed('KeyT')) toTitle();
        break;

      case ST.PROLOGUE: {
        // Typewriter: 45 chars/s; any key/click completes or advances a line.
        var line = GC.PROLOGUE[game.prolLine];
        game.prolChars += dt * 45;
        var advance = GI.consumeClick() || GI.pressedThisFrame.size > 0;
        if (advance) {
          if (game.prolChars < line.length) {
            game.prolChars = line.length;              // first press: fill the line
          } else {
            game.prolLine += 1;
            game.prolChars = 0;
            GA.uiSelect();
            if (game.prolLine >= GC.PROLOGUE.length) {
              GC.data.seenPrologue = true;
              GC.save();
              startRun();
            }
          }
        }
        HUD.update(dt);
        break;
      }

      case ST.CODEX: {
        game.codexSel = menuNav(game.codexSel, GC.ENTRIES.length);
        if (GI.justPressed('Escape') || GI.justPressed('Enter') ||
            GI.justPressed('Space')) {
          GC.markViewed();
          GA.uiSelect();
          game.state = ST.TITLE;
        }
        HUD.update(dt);
        break;
      }

      case ST.ENDING:
        GP.update(dt * 0.5);                           // embers drift behind the dawn
        if (GI.justPressed('Enter') || GI.justPressed('Space')) {
          game.endless = true;
          GA.startMusic();
          game.showBanner('ENDLESS PROTOCOL', 'THE LIGHT HOLDS — RUN FOREVER');
          GP.shockwave(game.player.x, game.player.y, '#ffd166', 500, 0.8);
          game.state = ST.PLAYING;
        } else if (GI.justPressed('Escape')) {
          toTitle();
        }
        HUD.update(dt);
        break;
    }
  }

  // ---- rendering ---------------------------------------------------------------

  // Dead-grid skyline: a slow parallax layer (0.06) of silhouette blocks with
  // a few lit windows, deterministic per 512 px tile (v2).
  function drawSkyline() {
    var T = 512;
    var ox = cam.x * 0.06;
    var oy = cam.y * 0.06;
    var tx0 = Math.floor(ox / T) - 1;
    var ty0 = Math.floor(oy / T) - 1;
    var tw = Math.ceil(viewW / T) + 3;
    var th = Math.ceil(viewH / T) + 3;
    for (var ty = ty0; ty <= ty0 + th; ty++) {
      for (var tx = tx0; tx <= tx0 + tw; tx++) {
        var rng = GU.mulberry32(((tx * 73856093) ^ (ty * 19349663) ^ 0x9e3779b9) >>> 0);
        var bx = tx * T - ox;
        var by = ty * T - oy;
        var n = 2 + Math.floor(rng() * 3);
        for (var i = 0; i < n; i++) {
          var bw = 44 + rng() * 96;
          var bh = 60 + rng() * 170;
          var bxp = bx + rng() * (T - bw);
          var byp = by + rng() * (T - bh);
          ctx.fillStyle = 'rgba(9,9,26,0.8)';
          ctx.fillRect(bxp, byp, bw, bh);
          ctx.strokeStyle = 'rgba(53,230,255,0.05)';
          ctx.lineWidth = 1;
          ctx.strokeRect(bxp + 0.5, byp + 0.5, bw - 1, bh - 1);
          var lit = Math.floor(rng() * 4);
          for (var w = 0; w < lit; w++) {
            ctx.fillStyle = 'rgba(53,230,255,' + (0.05 + rng() * 0.10).toFixed(3) + ')';
            ctx.fillRect(bxp + 6 + rng() * (bw - 14), byp + 8 + rng() * (bh - 18), 3, 4);
          }
        }
      }
    }
  }

  function drawGrid() {                                // 48 px neon grid (juice #8)
    var gs = 48;
    var x0 = Math.floor(cam.x / gs) * gs;
    var y0 = Math.floor(cam.y / gs) * gs;
    var pulse = game.gridPulseT > 0 ? game.gridPulseT * 0.3 : 0;   // wave-start flash
    ctx.strokeStyle = 'rgba(90,40,200,' + (0.18 + pulse).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var x, y;
    for (x = x0; x <= cam.x + viewW + gs; x += gs) { ctx.moveTo(x, cam.y); ctx.lineTo(x, cam.y + viewH); }
    for (y = y0; y <= cam.y + viewH + gs; y += gs) { ctx.moveTo(cam.x, y); ctx.lineTo(cam.x + viewW, y); }
    ctx.stroke();
  }

  function drawStars(parallax, perTile, radius, color) {
    var T = 512;                                       // 512 px tiles (juice #8)
    var ox = cam.x * parallax;
    var oy = cam.y * parallax;
    var tx0 = Math.floor(ox / T);
    var ty0 = Math.floor(oy / T);
    var tw = Math.ceil(viewW / T) + 1;
    var th = Math.ceil(viewH / T) + 1;
    ctx.fillStyle = color;
    for (var ty = ty0; ty <= ty0 + th; ty++) {
      for (var tx = tx0; tx <= tx0 + tw; tx++) {
        var rng = GU.mulberry32(((tx * 73856093) ^ (ty * 19349663)) >>> 0);
        for (var i = 0; i < perTile; i++) {
          var sx = tx * T + rng() * T - ox;
          var sy = ty * T + rng() * T - oy;
          var spd = 0.6 + rng() * 1.8;
          var ph = rng() * GU.TAU;
          ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(game.animT * spd + ph));  // sin twinkle
          ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Scanline overlay (settings.scanlines): a cached 1x4 pattern, hand-rolled
  // line pass as fallback when createPattern is unavailable.
  var scanPattern = null;
  function drawScanlines() {
    if (!game.settings.scanlines) return;
    if (scanPattern === null) {
      scanPattern = false;
      if (document.createElement && ctx.createPattern) {
        var c = document.createElement('canvas');
        c.width = 1;
        c.height = 4;
        var c2 = c.getContext && c.getContext('2d');
        if (c2) {
          c2.fillStyle = 'rgba(0,0,0,0.55)';
          c2.fillRect(0, 3, 1, 1);
          var pat = ctx.createPattern(c, 'repeat');
          if (pat) scanPattern = pat;
        }
      }
    }
    ctx.save();
    if (scanPattern) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = scanPattern;
      ctx.fillRect(0, 0, viewW, viewH);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (var y = 3; y < viewH; y += 4) ctx.fillRect(0, y, viewW, 1);
    }
    ctx.restore();
  }

  function drawCrosshair() {                           // cyan ring + 4 ticks, x1.3 firing
    var x = GI.mouse.x;
    var y = GI.mouse.y;
    var r = GI.mouse.down ? 9 * 1.3 : 9;
    ctx.strokeStyle = '#35e6ff';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, GU.TAU);
    ctx.stroke();
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      ctx.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2));
      ctx.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.fillStyle = '#05050e';                         // render order per section 5.3
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(-cam.x + GP.shakeX, -cam.y + GP.shakeY);   // world layer only
    drawSkyline();                                     // v2 parallax silhouettes
    drawGrid();
    drawStars(0.15, 20, 1, '#9fd8ff');                 // far layer: 20 pts, r 1
    drawStars(0.35, 10, 1.6, '#ffffff');               // near layer: 10 pts, r 1.6
    if (game.state !== ST.TITLE && game.player) {   // a run exists to draw
      var g = game;
      var p = g.player;
      var i;
      for (i = 0; i < g.gems.length; i++) g.gems[i].draw(ctx);
      for (i = 0; i < g.pickups.length; i++) g.pickups[i].draw(ctx);
      p.drawAura(ctx);                                 // aura circle under enemies
      for (i = 0; i < g.enemies.length; i++) {
        if (!g.enemies[i].isBoss && !g.enemies[i].dead) g.enemies[i].draw(ctx);
      }
      if (g.boss && !g.boss.dead) g.boss.draw(ctx);
      for (i = 0; i < g.bullets.length; i++) g.bullets[i].draw(ctx);
      for (i = 0; i < g.enemyBullets.length; i++) g.enemyBullets[i].draw(ctx);
      if (!p.dead) p.draw(ctx);
    }
    GP.render(ctx);
    ctx.restore();

    // Screen-space overlays: hurt vignette, boss warning pulse, base vignette.
    if (game.state === ST.PLAYING && game.player && game.player.hurtFlashT > 0) {
      ctx.globalAlpha = Math.min(1, game.player.hurtFlashT / 0.15);   // juice #4
      ctx.fillStyle = hurtVignette;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.globalAlpha = 1;
    }
    // Low-HP heartbeat vignette below 30% (v2).
    if (game.state === ST.PLAYING && game.player && !game.player.dead &&
        game.player.hp / game.player.maxHp < 0.3) {
      ctx.globalAlpha = 0.10 + 0.06 * Math.sin(game.animT * 6);
      ctx.fillStyle = hurtVignette;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.globalAlpha = 1;
    }
    if (game.state === ST.PLAYING && GW.state.bossWarnT > 0) {       // juice #10
      var wa = (GW.state.bossWarnT / 1.5) * (0.30 + 0.16 * Math.sin(game.animT * 14));
      ctx.fillStyle = 'rgba(255,40,40,' + Math.max(0, wa).toFixed(3) + ')';
      ctx.fillRect(0, 0, viewW, viewH);
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, viewW, viewH);

    switch (game.state) {
      case ST.TITLE:
        HUD.drawTitle(ctx, game);
        break;
      case ST.PLAYING:
        HUD.drawPlaying(ctx, game);
        HUD.drawBanners(ctx, game);
        break;
      case ST.LEVELUP:
        HUD.drawPlaying(ctx, game);
        HUD.drawLevelUp(ctx, game);
        break;
      case ST.PAUSED:
        HUD.drawPlaying(ctx, game);
        HUD.drawPause(ctx, game);
        break;
      case ST.SETTINGS:
        if (game.player) HUD.drawPlaying(ctx, game);   // dim run behind pause settings
        HUD.drawSettings(ctx, game);
        break;
      case ST.GAMEOVER:
        HUD.drawPlaying(ctx, game);
        HUD.drawGameOver(ctx, game);
        break;
      case ST.PROLOGUE:
        HUD.drawPrologue(ctx, game);
        break;
      case ST.CODEX:
        HUD.drawCodex(ctx, game);
        break;
      case ST.ENDING:
        HUD.drawPlaying(ctx, game);                    // frozen victory field behind
        HUD.drawEnding(ctx, game);
        break;
    }
    drawCrosshair();                                 // OS cursor is hidden (css): the
                                                     // game owns the pointer everywhere
    drawScanlines();                                 // v2 CRT flavor (settings)
    if (game.fadeT > 0) {                            // state-transition fade
      ctx.fillStyle = 'rgba(3,3,12,' + (game.fadeT / 0.3).toFixed(3) + ')';
      ctx.fillRect(0, 0, viewW, viewH);
    }
  }

  // ---- loop + global events ------------------------------------------------------

  var last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);      // section 7.6 dt clamp
    last = now;
    if (game.state !== ST.PAUSED) game.animT += dt;
    step(dt);
    render();
    GI.endFrame();
  }

  // AudioContext only after the first user interaction (section 7.5).
  function onFirstGesture() {
    GA.init();
    window.removeEventListener('pointerdown', onFirstGesture, true);
    window.removeEventListener('keydown', onFirstGesture, true);
  }
  window.addEventListener('pointerdown', onFirstGesture, true);
  window.addEventListener('keydown', onFirstGesture, true);

  // Auto-pause on focus loss (section 7.8).
  function autoPause() {
    if (game.state === ST.PLAYING) game.state = ST.PAUSED;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) autoPause();
    else GA.resume();
  });
  window.addEventListener('blur', autoPause);

  // ---- boot -----------------------------------------------------------------------

  resize();
  window.addEventListener('resize', resize);
  GI.bind(canvas);
  GP.init(600);
  game.best = loadBest();
  applySettings();                                     // persisted audio/visual prefs
  requestAnimationFrame(frame);
})();
