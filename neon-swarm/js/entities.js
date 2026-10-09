/* NEON SWARM - js/entities.js
 * Data + motion + drawing of everything that exists in the world: player,
 * all 6 enemy types, boss, player/enemy bullets and XP gems.
 * Public global: window.GameEntities (alias GE). Contract: DESIGN.md 5.2.
 *
 * HARD RULES (section 5.2 / 5.4):
 *  - No collision resolution and no upgrade procs here. main.js owns the single
 *    collision step; this file only provides the pieces it drives:
 *      GE.SpatialGrid              uniform grid, rebuilt per frame, queried per
 *                                  bullet/aura/gem check (query returns center
 *                                  candidates; refine with GU.dist2)
 *      Bullet.hitSet/pierce/crit   per-bullet hit bookkeeping
 *      Enemy.onHit(dmg,sx,sy,o)    flash + knockback, returns "died"
 *      Enemy.die()                 gems + particles + score + splitter minis
 *      Boss.onHit/die()            same shape for the boss
 *      Player.flowWindowActive() / Player.refundDash(s)   for the flow upgrade
 *  - Entities never read window.Game; the live game instance is injected.
 *
 * Required game fields/methods (owned by main.js):
 *   game.player           GE.Player instance
 *   game.enemies          array (GameWaves spawns into it), cap 140
 *   game.bullets          player bullet array, cap 400
 *   game.enemyBullets     enemy bullet array, cap 200
 *   game.gems             gem array, cap 300
 *   game.mouseWorld()     -> {x, y} cursor in world space
 *   game.addXP(n), game.addScore(n), game.showBanner(text)
 *   game.comboMult()      optional - used for kill score when present
 *
 * Arrays are pruned by main.js (swap-remove on .dead); entities only push.
 * Kill score added here = base x game.comboMult() (main must NOT multiply
 * inside addScore, or the combo multiplier would be applied twice).
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var GA = window.GameAudio;
  var GI = window.GameInput;
  var GP = window.GameParticles;

  var DEG = Math.PI / 180;

  // Player baseline (section 3.2). Upgrades scale from these values.
  var PLAYER_BASE = {
    hp: 100, speed: 220, r: 11,
    dmg: 10, fireRate: 2.5,             // 10 dmg, 2.5 shots/s
    bulletSpeed: 520, bulletR: 4, bulletRange: 640,
    critChance: 0.05, critMult: 2,
    magnet: 70, pickupR: 12,
    dashTime: 0.18, dashMult: 4.2, dashIframes: 0.28, dashCd: 2.5,
    hitIframes: 0.6
  };

  // Death particle counts (juice #3); burst uses speed 60-260 px/s, life 0.3-0.7 s.
  var DEATH_PARTICLES = { drone: 8, darter: 10, splitter: 12, mini: 6, spitter: 10, brute: 16,
                          weaver: 10, mite: 12 };

  var JITTER = 12 * DEG;   // +/-12 deg heading jitter (drone/mini packs)
  var SPIT_RANGE = 520;    // spitter only fires within this distance
  var ENEMY_CAP = 140;     // perf cap on game.enemies (section 5.3)

  function killMult(game) {
    if (typeof game.comboMult === 'function') return game.comboMult();
    if (typeof game.combo === 'number') return Math.min(3, 1 + 0.1 * Math.floor(game.combo / 10));
    return 1;
  }

  // Push honoring a perf cap by recycling the oldest entry.
  function pushCapped(arr, item, cap) {
    if (arr.length >= cap) arr.shift();
    arr.push(item);
  }

  var GE = {};

  // ---- Literal enemy table, mirrors DESIGN.md 5.2 exactly -------------------
  GE.ENEMY_TYPES = {
    drone:    { hp: 20, speed: 95,  dmg: 8,  r: 11, xp: 1, score: 10, color: '#ff2d95', kbResist: 0 },
    darter:   { hp: 12, speed: 60,  dmg: 12, r: 8,  xp: 2, score: 20, color: '#00e5ff', kbResist: 0,
                lungeSpeed: 330, cruiseTime: 1.6, windupTime: 0.35, lungeTime: 0.35 },
    splitter: { hp: 28, speed: 75,  dmg: 6,  r: 13, xp: 3, score: 30, color: '#39ff14', kbResist: 0.2, weaveAmp: 24 },
    mini:     { hp: 8,  speed: 130, dmg: 4,  r: 7,  xp: 1, score: 5,  color: '#7dff5e', kbResist: 0 },
    spitter:  { hp: 26, speed: 70,  dmg: 6,  r: 10, xp: 3, score: 30, color: '#b26bff', kbResist: 0.1,
                ringMin: 200, ringMax: 260, fireCd: 2.8, bulletSpeed: 150, bulletDmg: 10 },
    brute:    { hp: 85, speed: 52,  dmg: 20, r: 20, xp: 5, score: 50, color: '#ff9f1c', kbResist: 0.7 },
    // v2 additions
    weaver:   { hp: 30, speed: 60,  dmg: 14, r: 12, xp: 4, score: 40, color: '#5b8cff', kbResist: 0.15,
                aimTime: 0.9, telegraphTime: 0.3, dartSpeed: 420, dartTime: 0.35 },
    mite:     { hp: 8,  speed: 175, dmg: 4,  r: 7,  xp: 2, score: 25, color: '#ff6b35', kbResist: 0,
                fuseRange: 46, fuseTime: 0.5, boomRadius: 70, boomDmg: 14 }
  };

  GE.PLAYER_BASE = PLAYER_BASE;

  // ---- SpatialGrid: collision infrastructure for main.js's single step ------
  // Buckets entities by cell; rebuild(enemies) once per frame, then query per
  // check. query(x, y, r, out) returns every entity whose CENTER lies in the
  // cells overlapped by the circle's bounding box - a superset of true hits,
  // so the caller refines with GU.dist2. Pass r >= bullet.radius + 34 (boss).
  class SpatialGrid {
    constructor(cell) {
      this.cell = cell || 64;
      this.cells = new Map();
    }
    _key(cx, cy) {
      return (cx + 32768) * 65536 + (cy + 32768);
    }
    clear() {
      var it = this.cells.values();
      var r;
      while (!(r = it.next()).done) r.value.length = 0;
      // The player roams an infinite world; drop far-away empty cells so the
      // map cannot grow without bound on long runs.
      if (this.cells.size > 1024) {
        var dead = [];
        this.cells.forEach(function (arr, k) { if (arr.length === 0) dead.push(k); });
        for (var i = 0; i < dead.length; i++) this.cells.delete(dead[i]);
      }
    }
    insert(e) {
      var k = this._key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
      var arr = this.cells.get(k);
      if (!arr) { arr = []; this.cells.set(k, arr); }
      arr.push(e);
    }
    rebuild(list) {
      this.clear();
      for (var i = 0; i < list.length; i++) {
        if (!list[i].dead) this.insert(list[i]);
      }
    }
    query(x, y, r, out) {
      out.length = 0;
      var c = this.cell;
      var x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
      var y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
      for (var cy = y0; cy <= y1; cy++) {
        for (var cx = x0; cx <= x1; cx++) {
          var arr = this.cells.get(this._key(cx, cy));
          if (!arr) continue;
          for (var i = 0; i < arr.length; i++) out.push(arr[i]);
        }
      }
      return out;
    }
  }
  GE.SpatialGrid = SpatialGrid;

  // ---- Player bullet ---------------------------------------------------------
  // Damage + crit are rolled at shoot time (section 3.2); main.js reads
  // bullet.crit to style the damage number, bullet.hitSet to honor pierce.
  class Bullet {
    constructor(game, x, y, angle, opts) {
      opts = opts || {};
      this.game = game;
      this.x = x;
      this.y = y;
      this.angle = angle;
      this.speed = opts.speed || PLAYER_BASE.bulletSpeed;
      this.vx = Math.cos(angle) * this.speed;
      this.vy = Math.sin(angle) * this.speed;
      this.dmg = opts.dmg || PLAYER_BASE.dmg;
      this.pierce = opts.pierce || 0;
      this.radius = opts.radius || PLAYER_BASE.bulletR;
      this.range = opts.range || PLAYER_BASE.bulletRange;
      this.traveled = 0;
      this.hitSet = new Set();  // enemy ids already damaged (pierce bookkeeping)
      this.crit = !!opts.crit;
      this.dead = false;
      this.wakeMark = 0;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.traveled += this.speed * dt;
      if (this.traveled - this.wakeMark > 26) {
        GP.trail(this.x, this.y, 'rgba(174,246,255,0.55)', 1.7);
        this.wakeMark = this.traveled;
      }
      if (this.traveled >= this.range) {  // bullets die 640 px from origin
        this.dead = true;
        GP.burst(this.x, this.y, { color: '#aef6ff', count: 3, speed: 60, life: 0.15, size: 1.8 });
      }
    }
    draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#aef6ff';
      ctx.lineWidth = this.radius;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.x - Math.cos(this.angle) * 10, this.y - Math.sin(this.angle) * 10);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  GE.Bullet = Bullet;

  // ---- Enemy bullet (spitter + boss volleys) ---------------------------------
  class EnemyBullet {
    constructor(game, x, y, angle, speed, dmg) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.angle = angle;
      this.speed = speed;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.dmg = dmg;
      this.r = 5;
      this.color = '#c86bff';
      this.traveled = 0;
      this.maxTravel = 1000;  // tuning: dies well past any screen edge
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.traveled += this.speed * dt;
      if (this.traveled >= this.maxTravel) this.dead = true;
    }
    draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, GU.TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 0.45, 0, GU.TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  GE.EnemyBullet = EnemyBullet;

  // ---- XP gem -----------------------------------------------------------------
  // Drops from kills; magnetizes inside player.stats.magnetMult x 70 px and is
  // absorbed on contact (r 12 around the player), granting value x xpMult.
  class Gem {
    constructor(game, x, y, value) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.value = value;
      this.r = 4 + Math.min(4, value);
      this.color = value < 2 ? '#39ff14' : (value < 5 ? '#35e6ff' : '#ff2d95');
      var a = GU.rand(0, GU.TAU);          // small pop on spawn
      this.vx = Math.cos(a) * GU.rand(10, 55);
      this.vy = Math.sin(a) * GU.rand(10, 55) - 30;
      this.magnetized = false;
      this.speed = 0;
      this.bob = GU.rand(0, GU.TAU);
      this.trailT = 0;
      this.dead = false;
    }
    update(dt) {
      var p = this.game.player;
      this.bob += dt * 3;
      if (!p) {                              // no player yet: just drift out
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= Math.exp(-3 * dt);
        this.vy *= Math.exp(-3 * dt);
        return;
      }
      var d2 = GU.dist2(this.x, this.y, p.x, p.y);
      var magnetR = PLAYER_BASE.magnet * p.stats.magnetMult;
      if (!this.magnetized && d2 <= magnetR * magnetR) this.magnetized = true;
      if (this.magnetized) {
        this.speed = Math.min(720, this.speed + 1500 * dt);   // accelerate in
        var d = Math.sqrt(d2) || 1;
        this.x += ((p.x - this.x) / d) * this.speed * dt;
        this.y += ((p.y - this.y) / d) * this.speed * dt;
        this.trailT -= dt;                                     // juice #13
        if (this.trailT <= 0) { GP.trail(this.x, this.y, this.color, 2.2); this.trailT = 0.05; }
        if (d2 <= PLAYER_BASE.pickupR * PLAYER_BASE.pickupR) { // absorb
          this.dead = true;
          this.game.addXP(this.value * p.stats.xpMult);
          var cl = (typeof this.game.combo === 'number') ? Math.min(12, Math.floor(this.game.combo / 10) * 2) : 0;
          GA.pickup(cl);
          GP.burst(this.x, this.y, { color: this.color, count: 4, speed: 90, life: 0.25, size: 2 });
        }
      } else {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        var dr = Math.exp(-3 * dt);
        this.vx *= dr;
        this.vy *= dr;
      }
    }
    draw(ctx) {
      var yo = Math.sin(this.bob) * 2;       // idle bob
      var r = this.r;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.25;                // fake glow keeps 300 gems cheap
      ctx.beginPath();
      ctx.arc(this.x, this.y + yo, r + 3.5, 0, GU.TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();                        // small diamond body
      ctx.moveTo(this.x, this.y + yo - r);
      ctx.lineTo(this.x + r, this.y + yo);
      ctx.lineTo(this.x, this.y + yo + r);
      ctx.lineTo(this.x - r, this.y + yo);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  GE.Gem = Gem;

  // Spawner honoring the gem cap: when full, the oldest gem is absorbed
  // instantly (section 5.3 perf caps).
  Gem.spawn = function (game, x, y, value) {
    if (!game.gems) game.gems = [];
    if (game.gems.length >= 300) {
      var old = game.gems.shift();
      if (old && !old.dead && game.player) game.addXP(old.value * game.player.stats.xpMult);
    }
    var g = new Gem(game, x, y, value);
    game.gems.push(g);
    return g;
  };

  // ---- Regular enemy (all 8 types, one class + per-type behavior) ------------
  class Enemy {
    constructor(game, x, y, typeName, mult, elite) {
      var def = GE.ENEMY_TYPES[typeName];
      this.game = game;
      this.id = GU.uid();
      this.type = def;            // def object (main/HUD read .type.r etc.)
      this.typeName = typeName;
      this.isBoss = false;
      mult = mult || { hpMult: 1, speedMult: 1, dmgMult: 1, xpMult: 1 };
      this.spawnMult = { hpMult: mult.hpMult, speedMult: mult.speedMult, dmgMult: mult.dmgMult, xpMult: mult.xpMult };
      this.x = x;
      this.y = y;
      this.r = def.r;
      this.maxHp = Math.round(def.hp * mult.hpMult);   // wave scaling baked at spawn
      this.hp = this.maxHp;
      this.speed = def.speed * mult.speedMult;
      this.lungeSpeed = (def.lungeSpeed || 0) * mult.speedMult;
      this.bulletSpeed = (def.bulletSpeed || 0) * mult.speedMult;
      this.bulletDmg = (def.bulletDmg || 0) * mult.dmgMult;
      this.dmg = def.dmg * mult.dmgMult;
      this.xp = def.xp * mult.xpMult;
      this.score = def.score;
      this.color = def.color;
      this.kbResist = def.kbResist || 0;
      // v2 elite variants: bigger, harder, white-hot - they drop triple gems
      // plus a guaranteed power pickup on death.
      this.elite = !!elite;
      if (this.elite) {
        this.r = Math.round(this.r * 1.4);
        this.maxHp = this.maxHp * 3;
        this.hp = this.maxHp;
        this.dmg = this.dmg * 1.5;
        this.xp = this.xp * 3;
        this.score = this.score * 3;
      }
      this.flash = 0;
      this.kbX = 0;
      this.kbY = 0;
      this.aimAngle = 0;
      this.t = GU.rand(0, GU.TAU);
      this.spin = GU.rand(0, GU.TAU);
      this.jitter = 0;
      this.jitterT = GU.rand(0.1, 0.5);
      this.weavePhase = GU.rand(0, GU.TAU);
      this.phase = 'cruise';                       // darter/weaver state machine
      this.phaseT = def.cruiseTime || def.aimTime || 0;
      this.lungeAngle = 0;
      this.dartCount = 0;                          // weaver zigzag alternation
      this.strafeDir = GU.chance(0.5) ? 1 : -1;    // spitter ring strafe
      this.strafeT = GU.rand(1.5, 3);
      this.fireTimer = def.fireCd ? def.fireCd * GU.rand(0.5, 1) : 0;
      this.fuse = 0;                               // mite detonation fuse
      this.detonated = false;                      // main resolves the AoE once
      this.detonateRadius = def.boomRadius || 0;
      this.detonateDmg = (def.boomDmg || 0) * mult.dmgMult * (this.elite ? 1.5 : 1);
      this.dead = false;
    }

    update(dt) {
      var def = this.type;
      var p = this.game.player;
      this.flash = Math.max(0, this.flash - dt);
      this.t += dt;
      // knockback impulse decays as e^(-10t)
      var kd = Math.exp(-10 * dt);
      this.kbX *= kd;
      this.kbY *= kd;

      var mvx = 0, mvy = 0;
      if (p) {
        var dx = p.x - this.x, dy = p.y - this.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / d, uy = dy / d;
        this.aimAngle = Math.atan2(dy, dx);

        switch (this.typeName) {
          case 'drone':
          case 'mini':
          case 'brute': {
            // Direct chase with +/-12 deg jitter so packs do not collapse.
            this.jitterT -= dt;
            if (this.jitterT <= 0) {
              this.jitterT = GU.rand(0.25, 0.65);
              this.jitter = GU.rand(-JITTER, JITTER);
            }
            var ja = this.aimAngle + this.jitter;
            mvx = Math.cos(ja) * this.speed;
            mvy = Math.sin(ja) * this.speed;
            break;
          }
          case 'darter': {
            // cruise -> windup (stop + telegraph) -> lunge at captured point
            this.phaseT -= dt;
            if (this.phase === 'cruise') {
              mvx = ux * this.speed;
              mvy = uy * this.speed;
              if (this.phaseT <= 0) { this.phase = 'windup'; this.phaseT = def.windupTime; }
            } else if (this.phase === 'windup') {
              if (this.phaseT <= 0) {              // capture target at windup END
                this.lungeAngle = GU.angleTo(this.x, this.y, p.x, p.y);
                this.aimAngle = this.lungeAngle;
                this.phase = 'lunge';
                this.phaseT = def.lungeTime;
              }
            } else {                               // fixed 0.35 s at lunge speed
              this.aimAngle = this.lungeAngle;
              mvx = Math.cos(this.lungeAngle) * this.lungeSpeed;
              mvy = Math.sin(this.lungeAngle) * this.lungeSpeed;
              if (this.phaseT <= 0) { this.phase = 'cruise'; this.phaseT = def.cruiseTime; }
            }
            break;
          }
          case 'splitter': {
            // chase + sine weave: 24 px lateral amplitude, 1.8 s period
            this.weavePhase += (GU.TAU / 1.8) * dt;
            var w = Math.cos(this.weavePhase) * def.weaveAmp * (GU.TAU / 1.8);
            mvx = ux * this.speed - uy * w;
            mvy = uy * this.speed + ux * w;
            break;
          }
          case 'spitter': {
            // hold a 200-260 px ring; strafe inside it
            this.strafeT -= dt;
            if (this.strafeT <= 0) { this.strafeT = GU.rand(1.5, 3); this.strafeDir *= -1; }
            if (d > def.ringMax) {
              mvx = ux * this.speed; mvy = uy * this.speed;
            } else if (d < def.ringMin) {
              mvx = -ux * this.speed; mvy = -uy * this.speed;
            } else {
              mvx = -uy * this.speed * 0.8 * this.strafeDir;
              mvy = ux * this.speed * 0.8 * this.strafeDir;
            }
            // fire cycle 2.8 s, last 0.4 s is the windup glow; only within 520 px
            this.fireTimer -= dt;
            if (this.fireTimer <= 0) {
              this.fireTimer = def.fireCd;
              if (d <= SPIT_RANGE) this._fireAt(p);
            }
            break;
          }
          case 'weaver': {
            // aim (zigzag drift) -> windup (freeze + telegraph) -> lunge
            this.phaseT -= dt;
            if (this.phase === 'cruise') {
              var lat = this.dartCount % 2 === 0 ? 1 : -1;   // alternate weave side
              mvx = ux * this.speed - uy * this.speed * 0.8 * lat;
              mvy = uy * this.speed + ux * this.speed * 0.8 * lat;
              if (this.phaseT <= 0) { this.phase = 'windup'; this.phaseT = def.telegraphTime; }
            } else if (this.phase === 'windup') {
              this.lungeAngle = GU.angleTo(this.x, this.y, p.x, p.y);  // track till launch
              this.aimAngle = this.lungeAngle;
              if (this.phaseT <= 0) {
                this.phase = 'lunge';
                this.phaseT = def.dartTime;
              }
            } else {
              this.aimAngle = this.lungeAngle;
              mvx = Math.cos(this.lungeAngle) * def.dartSpeed;
              mvy = Math.sin(this.lungeAngle) * def.dartSpeed;
              if (this.phaseT <= 0) {
                this.phase = 'cruise';
                this.phaseT = def.aimTime;
                this.dartCount++;
              }
            }
            break;
          }
          case 'mite': {
            // fast chase; inside fuseRange it locks and arms a 0.5 s fuse.
            // The AoE itself is resolved by main (single collision authority).
            if (this.fuse > 0) {
              this.fuse -= dt;
              if (this.fuse <= 0) {
                this.detonated = true;
                this.dead = true;
                GP.burst(this.x, this.y, { color: this.color, count: 14, speed: [80, 240], life: [0.25, 0.5], size: 3 });
                GP.shockwave(this.x, this.y, this.color, this.detonateRadius, 0.3);
                GP.addTrauma(0.25);
                GA.explode();
              }
              break;
            }
            mvx = ux * this.speed;
            mvy = uy * this.speed;
            if (d <= def.fuseRange) this.fuse = def.fuseTime;
            break;
          }
        }
      }

      this.x += (mvx + this.kbX) * dt;
      this.y += (mvy + this.kbY) * dt;
      if (this.typeName === 'splitter' || this.typeName === 'mini') this.spin += dt * 2.2;
    }

    _fireAt(p) {
      var a = GU.angleTo(this.x, this.y, p.x, p.y);
      var arr = this.game.enemyBullets || (this.game.enemyBullets = []);
      pushCapped(arr, new EnemyBullet(this.game, this.x, this.y, a, this.bulletSpeed, this.bulletDmg), 200);
    }

    // Bullet contact entry point. opts.crit styles the damage number.
    // Returns true when this hit killed the enemy (main then calls die()).
    onHit(dmg, srcX, srcY, opts) {
      if (this.dead) return false;
      this.hp -= dmg;
      this.flash = 0.08;                                   // white flash 80 ms
      var a = GU.angleTo(srcX, srcY, this.x, this.y);      // knockback ~60 px/s
      var imp = 60 * (1 - this.kbResist);
      this.kbX += Math.cos(a) * imp;
      this.kbY += Math.sin(a) * imp;
      var crit = opts && opts.crit;
      GP.floatText(this.x, this.y - this.r - 6, String(Math.max(1, Math.round(dmg))),
        crit ? { color: '#ffb300', size: 19 } : { color: '#ffffff', size: 13 });  // juice #5
      GA.hit();
      return this.hp <= 0;
    }

    // gems + particles + score (+ splitter minis). Kill bookkeeping (kills,
    // combo, lifesteal, flow refund, chain/boom procs) stays in main.js.
    die() {
      if (this.dead) return;
      this.dead = true;
      var n = DEATH_PARTICLES[this.typeName] || 8;
      GP.burst(this.x, this.y, { color: this.color, count: n, speed: [60, 260], life: [0.3, 0.7], size: 3 });
      if (this.typeName === 'brute') {
        GP.shockwave(this.x, this.y, this.color, 60, 0.35);  // juice #14
        GP.hitstop(40);                                      // juice #2
      }
      GA.kill();
      this.game.addScore(Math.round(this.score * killMult(this.game)));
      if (this.elite) {                          // triple gem fan + a power pickup
        for (var gi = 0; gi < 3; gi++) {
          var ga = this.aimAngle + (gi - 1) * 0.5;
          Gem.spawn(this.game, this.x + Math.cos(ga) * 18, this.y + Math.sin(ga) * 18, this.xp);
        }
        Pickup.spawn(this.game, this.x, this.y);
        GP.shockwave(this.x, this.y, '#ffffff', 70, 0.3);
      } else {
        Gem.spawn(this.game, this.x, this.y, this.xp);
      }
      if (this.typeName === 'splitter') {                    // 2 minis at +/-30 deg
        var es = this.game.enemies || (this.game.enemies = []);
        for (var i = -1; i <= 1; i += 2) {
          if (es.length >= ENEMY_CAP) break;                 // cap 140 (section 5.3)
          var a = this.aimAngle + i * 30 * DEG;
          es.push(new Enemy(this.game, this.x + Math.cos(a) * (this.r + 6),
            this.y + Math.sin(a) * (this.r + 6), 'mini', this.spawnMult));
        }
      }
    }

    draw(ctx) {
      var flashA = this.flash > 0 ? this.flash / 0.08 : 0;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalCompositeOperation = 'lighter';   // fake glow (section 5.3)
      switch (this.typeName) {
        case 'drone': {                           // magenta triangle at the player
          ctx.rotate(this.aimAngle);
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.moveTo(this.r + 5, 0);
          ctx.lineTo(-this.r, this.r * 0.85);
          ctx.lineTo(-this.r * 0.45, 0);
          ctx.lineTo(-this.r, -this.r * 0.85);
          ctx.closePath();
          ctx.fill();
          if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fill(); }
          break;
        }
        case 'darter': {                          // slim dart; stretches on windup
          var w = this.phase === 'windup' ? 1 - this.phaseT / this.type.windupTime : 0;
          ctx.rotate(this.aimAngle);
          ctx.scale(1 + 0.6 * w, 1);              // up to 1.6x along the aim
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.moveTo(this.r * 2.4, 0);
          ctx.lineTo(-this.r * 0.9, this.r);
          ctx.lineTo(-this.r * 0.3, 0);
          ctx.lineTo(-this.r * 0.9, -this.r);
          ctx.closePath();
          ctx.fill();
          var glow = Math.min(1, flashA + w * 0.6);
          if (glow > 0) { ctx.fillStyle = 'rgba(255,255,255,' + glow + ')'; ctx.fill(); }
          break;
        }
        case 'splitter':
        case 'mini': {                            // rotating square (mini = 0.55x)
          ctx.rotate(this.spin);
          var half = this.r * 0.75;
          ctx.fillStyle = this.color;
          ctx.fillRect(-half, -half, half * 2, half * 2);
          if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fillRect(-half, -half, half * 2, half * 2); }
          break;
        }
        case 'spitter': {                         // violet diamond, windup core glow
          ctx.rotate(this.aimAngle);
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.moveTo(this.r, 0);
          ctx.lineTo(0, this.r * 0.8);
          ctx.lineTo(-this.r, 0);
          ctx.lineTo(0, -this.r * 0.8);
          ctx.closePath();
          ctx.fill();
          if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fill(); }
          if (this.fireTimer <= 0.4) {            // 0.4 s windup glow
            var wt = 1 - Math.max(0, this.fireTimer) / 0.4;
            ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + 0.6 * wt) + ')';
            ctx.beginPath();
            ctx.arc(0, 0, this.r * 0.45, 0, GU.TAU);
            ctx.fill();
          }
          break;
        }
        case 'brute': {                           // thick hexagon + pulsing ring
          ctx.rotate(this.aimAngle);
          ctx.beginPath();
          for (var i = 0; i < 6; i++) {
            var a2 = i * GU.TAU / 6;
            if (i === 0) ctx.moveTo(Math.cos(a2) * this.r, Math.sin(a2) * this.r);
            else ctx.lineTo(Math.cos(a2) * this.r, Math.sin(a2) * this.r);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,159,28,0.3)';
          ctx.fill();
          ctx.strokeStyle = this.color;
          ctx.lineWidth = 4;
          ctx.stroke();
          if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fill(); }
          var pr = this.r * (0.45 + 0.12 * Math.sin(this.t * 4));
          ctx.strokeStyle = this.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, pr, 0, GU.TAU);
          ctx.stroke();
          break;
        }
        case 'weaver': {                          // slim double-chevron; telegraphs
          if (this.phase === 'windup') {          // dashed lunge preview line
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(91,140,255,0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(this.lungeAngle) * 150, Math.sin(this.lungeAngle) * 150);
            ctx.stroke();
            ctx.restore();
          }
          var ww = this.phase === 'windup' ? 1 - this.phaseT / this.type.telegraphTime : 0;
          ctx.rotate(this.aimAngle);
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.moveTo(this.r * 1.9, 0);
          ctx.lineTo(-this.r * 0.7, this.r * 0.95);
          ctx.lineTo(-this.r * 0.2, 0);
          ctx.lineTo(-this.r * 0.7, -this.r * 0.95);
          ctx.closePath();
          ctx.fill();
          var weaverGlow = Math.min(1, flashA + ww * 0.8);
          if (weaverGlow > 0) { ctx.fillStyle = 'rgba(255,255,255,' + weaverGlow + ')'; ctx.fill(); }
          break;
        }
        case 'mite': {                            // spiky ball; fuse expands a ring
          ctx.rotate(this.spin * 3);
          ctx.fillStyle = this.color;
          ctx.beginPath();
          for (var mi = 0; mi < 6; mi++) {
            var ma = mi * GU.TAU / 6;
            var mo = this.r, mi2 = this.r * 0.5;
            var ma2 = ma + GU.TAU / 12;
            if (mi === 0) ctx.moveTo(Math.cos(ma) * mo, Math.sin(ma) * mo);
            else ctx.lineTo(Math.cos(ma) * mo, Math.sin(ma) * mo);
            ctx.lineTo(Math.cos(ma2) * mi2, Math.sin(ma2) * mi2);
          }
          ctx.closePath();
          ctx.fill();
          if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fill(); }
          if (this.fuse > 0) {                    // detonation telegraph
            var fp = 1 - this.fuse / this.type.fuseTime;
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(255,107,53,' + (0.3 + 0.5 * fp) + ')';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, this.detonateRadius * fp, 0, GU.TAU);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
      }
      if (this.elite) {                           // pulsing white halo marker
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.45 + 0.3 * Math.sin(this.t * 6)) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 4, 0, GU.TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  GE.Enemy = Enemy;

  // ---- Boss: SWARM SOVEREIGN (section 3.1) -----------------------------------
  // n = boss count (wave / 5). HP = 600 x 1.35^(n-1). Radial 14-bullet volleys
  // with a rotating offset; faster below 60%; enrage below 40% (speed 92,
  // volley 3.5 s, 4 drone adds every 9 s, max 8 adds alive).
  class Boss {
    constructor(game, x, y, n) {
      this.game = game;
      this.id = GU.uid();
      this.isBoss = true;
      this.typeName = 'boss';
      this.n = n;
      this.x = x;
      this.y = y;
      this.r = 34;
      this.maxHp = Math.round(600 * Math.pow(1.35, n - 1));
      this.hp = this.maxHp;
      this.speed = 68;
      this.enragedSpeed = 92;
      this.dmg = 25;
      this.score = 500;
      this.color = '#ff3131';
      this.kbResist = 0.9;                      // bosses barely flinch
      this.type = { hp: this.maxHp, speed: this.speed, dmg: this.dmg, r: this.r, xp: 5, score: this.score, color: this.color, kbResist: this.kbResist };
      this.flash = 0;
      this.kbX = 0;
      this.kbY = 0;
      this.aimAngle = 0;
      this.t = 0;
      this.ringSpin = 0;
      this.phase = 0;                            // 0 full / 1 <60% / 2 <40% enrage
      this.volleyTimer = 1.2;                    // walk-in delay before volley 1
      this.volleyOffset = GU.rand(0, GU.TAU);
      this.addTimer = 9;
      this.adds = [];                            // boss-spawned drones
      // v2 escalation: n>=2 aimed bursts; n>=3 spiral (enrage) + telegraphed charge
      this.aimedTimer = 2.6;
      this.spiralTimer = 0;
      this.spiralA = GU.rand(0, GU.TAU);
      this.chargeState = 'idle';                 // idle -> windup -> dash -> idle
      this.chargeT = 6;
      this.chargeAngle = 0;
      this.dead = false;
    }

    volleyInterval() {
      var f = this.hp / this.maxHp;
      if (f < 0.4) return 3.5;
      if (f < 0.6) return 4;
      return 5;
    }

    update(dt) {
      var p = this.game.player;
      this.flash = Math.max(0, this.flash - dt);
      this.t += dt;
      this.ringSpin += dt * 1.6;
      var kd = Math.exp(-10 * dt);
      this.kbX *= kd;
      this.kbY *= kd;

      // phase machine + phase-change hitstop (juice #2)
      var f = this.hp / this.maxHp;
      var ph = f < 0.4 ? 2 : (f < 0.6 ? 1 : 0);
      if (ph !== this.phase) {
        this.phase = ph;
        GP.hitstop(40);
        GP.burst(this.x, this.y, { color: this.color, count: 14, speed: [80, 200], life: [0.3, 0.6], size: 3 });
      }

      if (p) {
        var dx = p.x - this.x, dy = p.y - this.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;

        // n>=3: telegraphed charge dash. windup freezes it while it locks the
        // aim line, then a fast straight dash that can flank a parked player.
        var charging = false;
        if (this.n >= 3) {
          this.chargeT -= dt;
          if (this.chargeState === 'idle') {
            if (this.chargeT <= 0 && d < 520) { this.chargeState = 'windup'; this.chargeT = 0.6; }
          } else if (this.chargeState === 'windup') {
            charging = true;
            this.chargeAngle = GU.angleTo(this.x, this.y, p.x, p.y);
            if (this.chargeT <= 0) { this.chargeState = 'dash'; this.chargeT = 0.5; }
          } else {
            charging = true;
            this.x += Math.cos(this.chargeAngle) * 300 * dt;
            this.y += Math.sin(this.chargeAngle) * 300 * dt;
            if (this.chargeT <= 0) { this.chargeState = 'idle'; this.chargeT = 7; }
          }
        }

        var sp = this.phase === 2 ? this.enragedSpeed : this.speed;
        if (!charging) {
          this.x += (dx / d * sp + this.kbX) * dt;
          this.y += (dy / d * sp + this.kbY) * dt;
        }

        // radial bullet burst: 14 violet bullets, rotating offset each volley
        this.volleyTimer -= dt;
        if (this.volleyTimer <= 0) {
          this.volleyTimer = this.volleyInterval();
          this.volleyOffset += 0.19;
          var eb = this.game.enemyBullets || (this.game.enemyBullets = []);
          for (var k = 0; k < 14; k++) {
            pushCapped(eb, new EnemyBullet(this.game, this.x, this.y,
              this.volleyOffset + k * (GU.TAU / 14), 170, 10), 200);
          }
          GP.addTrauma(0.25);                    // juice #1
        }

        // n>=2: aimed 3-burst on a faster cycle - the Sovereign aims back.
        if (this.n >= 2) {
          this.aimedTimer -= dt;
          if (this.aimedTimer <= 0) {
            this.aimedTimer = this.volleyInterval() * 0.55;
            var ba = GU.angleTo(this.x, this.y, p.x, p.y);
            var eb2 = this.game.enemyBullets || (this.game.enemyBullets = []);
            for (var k2 = -1; k2 <= 1; k2++) {
              pushCapped(eb2, new EnemyBullet(this.game, this.x, this.y,
                ba + k2 * 0.11, 195, 12), 200);
            }
          }
        }

        // n>=3: while enraged it also weaves a slow spiral under everything else.
        if (this.n >= 3 && this.phase === 2) {
          this.spiralTimer -= dt;
          this.spiralA += dt * 4;
          if (this.spiralTimer <= 0) {
            this.spiralTimer = 0.22;
            var eb3 = this.game.enemyBullets || (this.game.enemyBullets = []);
            pushCapped(eb3, new EnemyBullet(this.game, this.x, this.y,
              this.spiralA, 150, 10), 200);
          }
        }

        // enrage: 4 drone adds every 9 s, max 8 boss adds alive
        if (this.phase === 2) {
          this.addTimer -= dt;
          if (this.addTimer <= 0) {
            this.addTimer = 9;
            var alive = [];
            for (var i = 0; i < this.adds.length; i++) {
              if (!this.adds[i].dead && this.adds[i].hp > 0) alive.push(this.adds[i]);
            }
            this.adds = alive;
            var es = this.game.enemies || (this.game.enemies = []);
            for (var j = 0; j < Math.min(4, 8 - alive.length); j++) {
              if (es.length >= ENEMY_CAP) break;             // cap 140 (section 5.3)
              var a = GU.rand(0, GU.TAU);
              var dr = new Enemy(this.game, this.x + Math.cos(a) * (this.r + 14),
                this.y + Math.sin(a) * (this.r + 14), 'drone', null);
              this.adds.push(dr);
              es.push(dr);
            }
          }
        }
      }
    }

    onHit(dmg, srcX, srcY, opts) {
      if (this.dead) return false;
      this.hp -= dmg;
      this.flash = 0.08;
      var a = GU.angleTo(srcX, srcY, this.x, this.y);
      var imp = 60 * (1 - this.kbResist);
      this.kbX += Math.cos(a) * imp;
      this.kbY += Math.sin(a) * imp;
      var crit = opts && opts.crit;
      GP.floatText(this.x + GU.rand(-14, 14), this.y - this.r - 8, String(Math.max(1, Math.round(dmg))),
        crit ? { color: '#ffb300', size: 19 } : { color: '#ffffff', size: 13 });
      GA.hit();
      return this.hp <= 0;
    }

    // 8 gems x 5 XP, 3 shockwaves, hitstop 100 ms, trauma 0.4, +500 x comboMult.
    die() {
      if (this.dead) return;
      this.dead = true;
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * GU.TAU;
        Gem.spawn(this.game, this.x + Math.cos(a) * 26, this.y + Math.sin(a) * 26, 5);
      }
      GP.burst(this.x, this.y, { color: this.color, count: 60, speed: [60, 260], life: [0.3, 0.7], size: 3.4 });
      for (var s = 0; s < 3; s++) GP.shockwave(this.x, this.y, s % 2 ? '#ff2d95' : '#ff3131', 180, 0.35);
      GP.hitstop(100);
      GP.addTrauma(0.4);
      GA.bossDie();
      Pickup.spawn(this.game, this.x, this.y);      // Sovereigns drop loot
      this.game.addScore(Math.round(this.score * killMult(this.game)));
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      if (this.chargeState === 'windup') {        // telegraphed charge line
        ctx.strokeStyle = 'rgba(255,49,49,0.55)';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.chargeAngle) * 260, Math.sin(this.chargeAngle) * 260);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (this.chargeState === 'dash') {          // dash motion trail
        ctx.strokeStyle = 'rgba(255,49,49,0.35)';
        ctx.lineWidth = this.r * 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-Math.cos(this.chargeAngle) * this.r * 3,
                   -Math.sin(this.chargeAngle) * this.r * 3);
        ctx.stroke();
      }
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 18;                       // allowed on boss (glow policy)
      // octagon body
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = i * GU.TAU / 8;
        if (i === 0) ctx.moveTo(Math.cos(a) * this.r, Math.sin(a) * this.r);
        else ctx.lineTo(Math.cos(a) * this.r, Math.sin(a) * this.r);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,49,49,0.35)';
      ctx.fill();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 4;
      ctx.stroke();
      if (this.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (this.flash / 0.08) + ')'; ctx.fill(); }
      // rotating outer ring (4 arc segments)
      ctx.strokeStyle = 'rgba(255,49,49,0.9)';
      ctx.lineWidth = 2.5;
      for (var s = 0; s < 4; s++) {
        var a0 = this.ringSpin + s * (GU.TAU / 4);
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 10, a0, a0 + GU.TAU / 4 - 0.28);
        ctx.stroke();
      }
      // pulsing magenta core
      var cr = 9 + 3 * Math.sin(this.t * 5);
      ctx.fillStyle = '#ff2d95';
      ctx.beginPath();
      ctx.arc(0, 0, cr, 0, GU.TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, cr * 0.45, 0, GU.TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  GE.Boss = Boss;

  // ---- Player (section 2.1 + 3.2) ---------------------------------------------
  // Hold LMB to fire toward the cursor - LOCKED: no auto-fire, no toggle.
  // Firing works while moving, standing still and dashing.
  class Player {
    constructor(game, x, y) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.r = PLAYER_BASE.r;
      this.maxHp = PLAYER_BASE.hp;
      this.hp = PLAYER_BASE.hp;
      this.stats = {                            // section 4 literal, verbatim
        dmgMult: 1, fireRateMult: 1, shots: 1, pierce: 0,
        lifestealPerKill: 0, speedMult: 1, dashCdMult: 1, flow: 0,
        chainChance: 0, chainTargets: 0,
        boomRadius: 0, boomDmgMult: 0,
        magnetMult: 1, regen: 0,
        bulletSpeedMult: 1, bulletSizeMult: 1,
        auraDps: 0, auraRadius: 0,
        critChance: 0.05, xpMult: 1,
        // v2 card stats: bounce retargets at pierce-end; execute/Plating are
        // defensive ratios; comboWindow/shrapnel feed main's kill bookkeeping.
        bounce: 0, executeMult: 0, contactResist: 0, comboWindow: 0, shrapnel: 0
      };
      this.upStacks = {};
      // v2 nova bomb: kills charge it; main owns the blast (collision authority)
      this.novaCharge = 0;
      this.novaNeed = 30;
      // v2 timed power pickups; aegis is a one-hit shield with a lifespan
      this.pickups = { overdrive: 0, havoc: 0, surge: 0, aegis: 0 };
      this.fireTimer = 0;
      this.dashTimer = 0;
      this.dashCd = 0;
      this.iFrames = 0;
      this.facing = 0;                          // aim angle
      this.dashVX = 0;
      this.dashVY = 0;
      this.dashGraceT = 0;                      // > 0 within 0.4 s after a dash (flow window)
      this.ghostT = 0;
      this.hurtFlashT = 0;                      // red blink timer; main draws the vignette
      this.lastHitDir = 0;                      // damage-direction indicator (v2 HUD)
      this.lastHitT = 0;
      this.animT = 0;
      this.dead = false;
    }

    effectiveSpeed() {
      return PLAYER_BASE.speed * this.stats.speedMult * (this.pickups.surge > 0 ? 1.35 : 1);
    }

    // True while dashing or within 0.4 s after a dash ends (flow upgrade).
    flowWindowActive() {
      return this.dashTimer > 0 || this.dashGraceT > 0;
    }

    // Flow upgrade: refund seconds of dash cooldown (main calls on qualifying kills).
    refundDash(sec) {
      this.dashCd = Math.max(0, this.dashCd - sec);
    }

    // 0.18 s burst at 4.2x speed toward the movement axis (or the cursor),
    // 0.28 s i-frames, 2.5 s cooldown. Returns false when on cooldown.
    tryDash() {
      if (this.dashTimer > 0 || this.dashCd > 0) return false;
      var axis = GI.axis();
      var dir;
      if (axis.x !== 0 || axis.y !== 0) {
        dir = axis;
      } else {
        var m = this.game.mouseWorld();
        dir = GU.norm(m.x - this.x, m.y - this.y);
        if (dir.len === 0) dir = { x: 1, y: 0, len: 1 };
      }
      var sp = this.effectiveSpeed() * PLAYER_BASE.dashMult;
      this.dashVX = dir.x * sp;
      this.dashVY = dir.y * sp;
      this.dashTimer = PLAYER_BASE.dashTime;
      this.iFrames = Math.max(this.iFrames, PLAYER_BASE.dashIframes);
      this.dashCd = PLAYER_BASE.dashCd * this.stats.dashCdMult * (this.pickups.surge > 0 ? 0.4 : 1);
      this.dashGraceT = 0;
      this.ghostT = 0;
      GA.dash();
      return true;
    }

    // One volley: stats.shots bullets in a fan (-4 deg per side of the center,
    // 8 deg spacing), crit rolled per bullet, muzzle flash at the gun tip.
    shoot() {
      var m = this.game.mouseWorld();
      this.facing = GU.angleTo(this.x, this.y, m.x, m.y);
      var st = this.stats;
      var s = st.shots + (this.pickups.havoc > 0 ? 2 : 0);
      var tipX = this.x + Math.cos(this.facing) * 16;
      var tipY = this.y + Math.sin(this.facing) * 16;
      var arr = this.game.bullets || (this.game.bullets = []);
      for (var i = 0; i < s; i++) {
        var a = this.facing + (-4 * (s - 1) + 8 * i) * DEG;
        var crit = GU.chance(st.critChance);
        pushCapped(arr, new Bullet(this.game, tipX, tipY, a, {
          speed: PLAYER_BASE.bulletSpeed * st.bulletSpeedMult,
          dmg: PLAYER_BASE.dmg * st.dmgMult * (crit ? PLAYER_BASE.critMult : 1),
          pierce: st.pierce,
          radius: PLAYER_BASE.bulletR * st.bulletSizeMult,
          range: PLAYER_BASE.bulletRange,
          crit: crit
        }), 400);
      }
      GP.burst(tipX, tipY, { color: '#aef6ff', count: 3, speed: 130, life: 0.12, size: 2.2, angle: this.facing, spread: 0.7 });  // juice #12
      GA.shoot();
    }

    // Any hit (contact or enemy bullet) triggers 0.6 s global i-frames; no
    // damage stacks during them. srcX/srcY (optional) aim the HUD damage-
    // direction arc at the attacker. Returns whether this hit killed.
    takeDamage(n, srcX, srcY) {
      if (this.iFrames > 0 || this.dead) return false;
      if (this.pickups.aegis > 0) {              // AEGIS eats exactly one hit
        this.pickups.aegis = 0;
        this.iFrames = 0.5;                       // brief mercy window after the pop
        if (srcX !== undefined) {
          this.lastHitDir = GU.angleTo(this.x, this.y, srcX, srcY);
          this.lastHitT = 0.55;
        }
        GP.shockwave(this.x, this.y, '#39ff14', 40, 0.25);
        GA.shieldHit();
        return false;
      }
      this.hp = Math.max(0, this.hp - n);
      this.iFrames = PLAYER_BASE.hitIframes;
      this.hurtFlashT = 0.15;                 // red blink + vignette pulse
      if (srcX !== undefined) {
        this.lastHitDir = GU.angleTo(this.x, this.y, srcX, srcY);
        this.lastHitT = 0.55;
      }
      GP.addTrauma(0.15);                     // juice #1
      GP.hitstop(60);                         // juice #2
      GA.hurt();
      if (this.hp <= 0) {
        this.dead = true;
        return true;
      }
      return false;
    }

    // Stat mutation executor called by GameUpgrades.apply (the only allowed
    // path into player.stats). stacks = the new stack count for this card.
    // Additive-tier cards (chain/boom/aura) set their base on stack 1.
    applyUpgrade(id, stacks) {
      var st = this.stats;
      var first = stacks <= 1;
      switch (id) {
        case 'damage': st.dmgMult *= 1.25; break;
        case 'firerate': st.fireRateMult *= 1.20; break;
        case 'multishot': st.shots += 1; break;
        case 'pierce': st.pierce += 1; break;
        case 'vampiric': st.lifestealPerKill += 1; break;
        case 'speed': st.speedMult *= 1.12; break;
        case 'flow': st.flow += 1.0; break;   // seconds of dash-cd refund per qualifying kill
        case 'chain':
          if (first) { st.chainChance = 0.30; st.chainTargets = 2; }
          else { st.chainChance = Math.min(0.80, st.chainChance + 0.10); st.chainTargets += 1; }
          break;
        case 'boom':
          if (first) { st.boomRadius = 45; st.boomDmgMult = 0.50; }
          else { st.boomRadius += 15; st.boomDmgMult += 0.15; }
          break;
        case 'magnet': st.magnetMult *= 1.45; break;
        case 'maxhp': this.maxHp += 25; this.hp = Math.min(this.maxHp, this.hp + 25); break;
        case 'regen': st.regen += 0.6; break;
        case 'bullet': st.bulletSpeedMult *= 1.20; st.bulletSizeMult *= 1.10; break;
        case 'aura':
          if (first) { st.auraDps = 8; st.auraRadius = 65; }
          else { st.auraDps += 6; st.auraRadius += 10; }
          break;
        case 'crit': st.critChance = Math.min(0.60, st.critChance + 0.10); break;
        case 'greedy': st.xpMult *= 1.25; break;
        case 'heal': this.hp = Math.min(this.maxHp, this.hp + 30); break;  // fallback card
        // ---- v2 cards ------------------------------------------------------
        case 'nova': this.novaNeed = Math.max(12, this.novaNeed - 6); break;
        case 'ricochet': st.bounce += 1; break;
        case 'execution': st.executeMult += 0.18; break;
        case 'plating': st.contactResist = Math.min(0.45, st.contactResist + 0.15); break;
        case 'tempo': st.comboWindow += 0.7; break;
        case 'shrapnel': st.shrapnel = st.shrapnel === 0 ? 3 : st.shrapnel + 2; break;
        default: return false;
      }
      return true;
    }

    update(dt) {
      this.animT += dt;
      if (this.dashTimer > 0) {
        this.dashTimer -= dt;
        this.x += this.dashVX * dt;
        this.y += this.dashVY * dt;
        this.ghostT -= dt;
        if (this.ghostT <= 0) { GP.trail(this.x, this.y, '#35e6ff', 9); this.ghostT = 0.03; }  // 6 ghosts / dash, juice #11
        if (this.dashTimer <= 0) this.dashGraceT = 0.4;   // flow window opens
      } else {
        this.dashGraceT = Math.max(0, this.dashGraceT - dt);
        var axis = GI.axis();                             // normalized WASD/arrows
        this.x += axis.x * this.effectiveSpeed() * dt;
        this.y += axis.y * this.effectiveSpeed() * dt;
      }
      // SURGE also triples dash cooldown recovery while it lasts
      this.dashCd = Math.max(0, this.dashCd - dt * (this.pickups.surge > 0 ? 3 : 1));
      this.iFrames = Math.max(0, this.iFrames - dt);
      this.hurtFlashT = Math.max(0, this.hurtFlashT - dt);
      this.lastHitT = Math.max(0, this.lastHitT - dt);
      // timed power pickups decay here so LEVELUP/pause freeze them too
      for (var pk in this.pickups) {
        if (this.pickups[pk] > 0) this.pickups[pk] = Math.max(0, this.pickups[pk] - dt);
      }
      if (this.stats.regen > 0 && this.hp < this.maxHp) {
        this.hp = Math.min(this.maxHp, this.hp + this.stats.regen * dt);
      }

      // aim always tracks the cursor; holding LMB fires (no auto-fire - locked)
      var m = this.game.mouseWorld();
      this.facing = GU.angleTo(this.x, this.y, m.x, m.y);
      if (GI.mouse.down) {
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.shoot();
          this.fireTimer += 1 / (PLAYER_BASE.fireRate * this.stats.fireRateMult *
            (this.pickups.overdrive > 0 ? 1.6 : 1));
        }
      } else {
        this.fireTimer = 0;                               // first shot instant on press
      }
    }

    // Static Field ring; main calls this during the world render pass.
    drawAura(ctx) {
      var st = this.stats;
      if (st.auraDps <= 0 || st.auraRadius <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(53,230,255,0.05)';
      ctx.strokeStyle = 'rgba(53,230,255,' + (0.22 + 0.06 * Math.sin(this.animT * 4)) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, st.auraRadius, 0, GU.TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    draw(ctx) {
      var blinking = this.iFrames > 0 && Math.floor(this.animT * 12) % 2 === 0;
      var dashing = this.dashTimer > 0;
      ctx.save();
      if (blinking || dashing) ctx.globalAlpha = 0.55;
      ctx.shadowColor = '#35e6ff';
      ctx.shadowBlur = 14;                                // allowed on player (glow policy)
      // gun barrel toward the cursor
      ctx.strokeStyle = '#aef6ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(this.facing) * 6, this.y + Math.sin(this.facing) * 6);
      ctx.lineTo(this.x + Math.cos(this.facing) * 16, this.y + Math.sin(this.facing) * 16);
      ctx.stroke();
      // white core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, GU.TAU);
      ctx.fill();
      // ring: red while hurt/blinking, cyan otherwise
      ctx.strokeStyle = (this.hurtFlashT > 0 || blinking) ? '#ff3355' : '#35e6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, GU.TAU);
      ctx.stroke();
      if (this.pickups.aegis > 0) {               // AEGIS shield bubble
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(57,255,20,' + (0.55 + 0.25 * Math.sin(this.animT * 6)) + ')';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r + 7, this.animT * 1.5, this.animT * 1.5 + GU.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }
  GE.Player = Player;

  // ---- Power pickup (v2): hex pod dropped by elites/bosses --------------------
  // Kinds: overdrive (+fire rate), havoc (+shots), surge (+speed/dash), aegis
  // (one-hit shield). Effects live on player.pickups as seconds remaining.
  var PICKUP_TYPES = {
    overdrive: { color: '#35e6ff', label: 'OVR', dur: 12, name: 'OVERDRIVE' },
    havoc:     { color: '#ff2d95', label: 'HVC', dur: 12, name: 'HAVOC' },
    surge:     { color: '#ffb300', label: 'SRG', dur: 12, name: 'SURGE' },
    aegis:     { color: '#39ff14', label: 'AEG', dur: 20, name: 'AEGIS' }
  };
  GE.PICKUP_TYPES = PICKUP_TYPES;
  var PICKUP_CAP = 32;

  class Pickup {
    constructor(game, x, y, kind) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.kind = kind || GU.pick(Object.keys(PICKUP_TYPES));
      this.t = GU.rand(0, GU.TAU);
      this.ttl = 15;                              // pod decays on the ground
      this.dead = false;
    }

    update(dt) {
      this.t += dt;
      this.ttl -= dt;
      if (this.ttl <= 0) this.dead = true;
    }

    draw(ctx) {
      var def = PICKUP_TYPES[this.kind];
      var bob = Math.sin(this.t * 3) * 3;
      var blink = this.ttl < 4 && Math.floor(this.t * 8) % 2 === 0;   // expiring
      ctx.save();
      ctx.translate(this.x, this.y + bob);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = blink ? 0.35 : 1;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();                            // hex pod
      for (var i = 0; i < 6; i++) {
        var a = i * GU.TAU / 6 + this.t * 0.6;
        if (i === 0) ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
        else ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, 0, 0);
      ctx.restore();
    }
  }
  GE.Pickup = Pickup;
  Pickup.spawn = function (game, x, y, kind) {
    var arr = game.pickups || (game.pickups = []);
    if (arr.length < PICKUP_CAP) arr.push(new Pickup(game, x, y, kind));
  };

  window.GameEntities = GE;
})();
