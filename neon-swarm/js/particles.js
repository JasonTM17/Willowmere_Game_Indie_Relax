/* NEON SWARM - js/particles.js
 * All transient visuals: particles, floating text, shockwaves, lightning
 * bolts, screenshake (trauma model) and hitstop. World-space only - the HUD
 * never shakes. Public global: window.GameParticles (alias GP).
 * Contract: DESIGN.md section 5.2 + juice checklist section 6.
 *
 * Everything is object-pooled with a rotating cursor: when a pool is full the
 * oldest entry is recycled, so spawning never allocates.
 *
 * Time model:
 *   - GP.update(dt) receives the dt the caller chooses (typically world dt,
 *     i.e. raw dt x GP.getTimeScale()); dt <= 0 freezes everything, which is
 *     exactly the hitstop behavior.
 *   - GP.hitstop(ms) / GP.slowmo(scale, dur) are wall-clock based.
 *   - GP.slowmo is an additive hook for the level-up slow-mo (section 6.9);
 *     main.js may instead scale dt itself - both paths flow through
 *     GP.getTimeScale().
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var FONT = 'Consolas, "Courier New", monospace';

  var cap = 600;
  var pool = null;
  var cursor = 0;

  var textCap = 80;
  var texts = null;
  var textCursor = 0;

  var waveCap = 32;
  var waves = null; // shockwaves
  var waveCursor = 0;

  var boltCap = 64;
  var bolts = null;
  var boltCursor = 0;

  var trauma = 0;
  var hitstopUntil = 0; // wall-clock ms (performance.now)
  var slowmoScale = 1;
  var slowmoUntil = 0;

  function makeParticle() {
    return {
      alive: false,
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1,
      size: 2, color: '#ffffff',
      drag: 2.2
    };
  }

  var GP = {
    // Screenshake offsets, recomputed every update. World layer only.
    shakeX: 0,
    shakeY: 0,

    init: function (c) {
      var i;
      cap = c || 600;
      pool = new Array(cap);
      for (i = 0; i < cap; i++) pool[i] = makeParticle();
      cursor = 0;
      texts = new Array(textCap);
      for (i = 0; i < textCap; i++) {
        texts[i] = { alive: false, x: 0, y: 0, text: '', color: '#ffffff', size: 13, life: 0, maxLife: 0.6 };
      }
      textCursor = 0;
      waves = new Array(waveCap);
      for (i = 0; i < waveCap; i++) {
        waves[i] = { alive: false, x: 0, y: 0, color: '#ffffff', maxR: 0, life: 0, maxLife: 0.35 };
      }
      waveCursor = 0;
      bolts = new Array(boltCap);
      for (i = 0; i < boltCap; i++) {
        bolts[i] = { alive: false, pts: null, life: 0, maxLife: 0.12, color: '#35e6ff' };
      }
      boltCursor = 0;
      trauma = 0;
      GP.shakeX = 0;
      GP.shakeY = 0;
      hitstopUntil = 0;
      slowmoScale = 1;
      slowmoUntil = 0;
    },

    reset: function () {
      var i;
      if (pool) for (i = 0; i < cap; i++) pool[i].alive = false;
      if (texts) for (i = 0; i < textCap; i++) texts[i].alive = false;
      if (waves) for (i = 0; i < waveCap; i++) waves[i].alive = false;
      if (bolts) for (i = 0; i < boltCap; i++) bolts[i].alive = false;
      cursor = 0;
      textCursor = 0;
      waveCursor = 0;
      boltCursor = 0;
      trauma = 0;
      GP.shakeX = 0;
      GP.shakeY = 0;
      hitstopUntil = 0;
      slowmoScale = 1;
      slowmoUntil = 0;
    },

    // Radial particle burst. opts: {color, count, speed, life, size}
    //   speed/life may be a number (treated as the max; actual values are
    //   randomized below it, e.g. speed 260 -> 60-260 px/s per juice #3) or a
    //   [min, max] pair. Optional extras: angle + spread (deg-less radians)
    //   for directional bursts, drag for how fast sparks slow down.
    burst: function (x, y, o) {
      if (!pool) GP.init(600);
      o = o || {};
      var count = o.count || 8;
      var sMin, sMax;
      if (o.speed && typeof o.speed === 'object') {
        sMin = o.speed[0];
        sMax = o.speed[1];
      } else {
        sMax = o.speed || 200;
        sMin = sMax * 0.23; // 60..260 from speed 260
      }
      var lMax = o.life || 0.5;
      var lMin = lMax * 0.43; // 0.3..0.7 from life 0.7
      var size = o.size || 2.5;
      var baseAng = o.angle;
      var spread = (o.spread === undefined) ? GU.TAU : o.spread;
      var color = o.color || '#ffffff';
      var drag = (o.drag === undefined) ? 2.2 : o.drag;
      for (var i = 0; i < count; i++) {
        var p = pool[cursor];
        cursor = (cursor + 1) % cap;
        var ang = (baseAng === undefined) ? GU.rand(0, GU.TAU) : baseAng + GU.rand(-spread / 2, spread / 2);
        var sp = GU.rand(sMin, sMax);
        p.alive = true;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(ang) * sp;
        p.vy = Math.sin(ang) * sp;
        p.life = p.maxLife = GU.rand(lMin, lMax);
        p.size = size * GU.rand(0.7, 1.3);
        p.color = color;
        p.drag = drag;
      }
    },

    // Single short-lived fading dot (dash ghosts, bullet wakes).
    trail: function (x, y, color, size) {
      if (!pool) GP.init(600);
      var p = pool[cursor];
      cursor = (cursor + 1) % cap;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = GU.rand(-8, 8);
      p.vy = GU.rand(-8, 8);
      p.life = p.maxLife = 0.25;
      p.size = size || 3;
      p.color = color || '#35e6ff';
      p.drag = 0;
    },

    // Floating text (damage numbers). Cap 80, oldest recycled.
    floatText: function (x, y, text, o) {
      if (!texts) GP.init(600);
      o = o || {};
      var t = texts[textCursor];
      textCursor = (textCursor + 1) % textCap;
      t.alive = true;
      t.x = x;
      t.y = y;
      t.text = String(text);
      t.color = o.color || '#ffffff';
      t.size = o.size || 13;
      t.life = t.maxLife = 0.6;
    },

    // Expanding ring; reaches maxRadius in dur (0.35 s typical, juice #14).
    shockwave: function (x, y, color, maxRadius, dur) {
      if (!waves) GP.init(600);
      var w = waves[waveCursor];
      waveCursor = (waveCursor + 1) % waveCap;
      w.alive = true;
      w.x = x;
      w.y = y;
      w.color = color || '#ffffff';
      w.maxR = maxRadius || 60;
      w.maxLife = dur || 0.35;
      w.life = w.maxLife;
    },

    // Jagged 4-6 segment lightning bolt, life 0.12 s.
    bolt: function (x1, y1, x2, y2, color) {
      if (!bolts) GP.init(600);
      var b = bolts[boltCursor];
      boltCursor = (boltCursor + 1) % boltCap;
      var segs = GU.randInt(4, 6);
      var pts = b.pts || (b.pts = []);
      pts.length = 0;
      var dx = x2 - x1;
      var dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len; // perpendicular unit vector
      var ny = dx / len;
      for (var i = 0; i <= segs; i++) {
        var t = i / segs;
        var px = x1 + dx * t;
        var py = y1 + dy * t;
        if (i > 0 && i < segs) {
          var off = GU.rand(-1, 1) * Math.min(16, len * 0.18);
          px += nx * off;
          py += ny * off;
        }
        pts.push(px, py); // flat pairs
      }
      b.alive = true;
      b.life = b.maxLife = 0.12;
      b.color = color || '#35e6ff';
    },

    addTrauma: function (amount) {
      trauma = GU.clamp(trauma + amount, 0, 1);
    },

    // timeScale = 0 for this wall-time duration (juice #2).
    hitstop: function (ms) {
      var until = performance.now() + ms;
      if (until > hitstopUntil) hitstopUntil = until;
    },

    // Additive hook: scale world time for a duration (level-up slow-mo 0.25x
    // for 0.35 s). main.js may ignore this and scale dt itself.
    slowmo: function (scale, dur) {
      slowmoScale = GU.clamp(scale === undefined ? 1 : scale, 0, 1);
      slowmoUntil = performance.now() + (dur || 0);
    },

    // 0 during hitstop, the slow-mo scale during slowmo, else 1.
    getTimeScale: function () {
      var now = performance.now();
      if (now < hitstopUntil) return 0;
      if (now < slowmoUntil) return slowmoScale;
      return 1;
    },

    update: function (dt) {
      if (dt <= 0) return; // frozen (hitstop): hold particles and shake
      var i;
      if (pool) {
        for (i = 0; i < cap; i++) {
          var p = pool[i];
          if (!p.alive) continue;
          p.life -= dt;
          if (p.life <= 0) {
            p.alive = false;
            continue;
          }
          if (p.drag) {
            var d = Math.exp(-p.drag * dt);
            p.vx *= d;
            p.vy *= d;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      }
      if (texts) {
        for (i = 0; i < textCap; i++) {
          var t = texts[i];
          if (!t.alive) continue;
          t.life -= dt;
          if (t.life <= 0) {
            t.alive = false;
            continue;
          }
          t.y -= (40 / t.maxLife) * dt; // rise 40 px over the lifetime (juice #5)
        }
      }
      if (waves) {
        for (i = 0; i < waveCap; i++) {
          var w = waves[i];
          if (!w.alive) continue;
          w.life -= dt;
          if (w.life <= 0) w.alive = false;
        }
      }
      if (bolts) {
        for (i = 0; i < boltCap; i++) {
          var b = bolts[i];
          if (!b.alive) continue;
          b.life -= dt;
          if (b.life <= 0) b.alive = false;
        }
      }
      // Trauma decay 1.2/s; shake = trauma^2, offset within +/-12 px.
      trauma = Math.max(0, trauma - 1.2 * dt);
      var s = trauma * trauma;
      GP.shakeX = GU.rand(-12, 12) * s;
      GP.shakeY = GU.rand(-12, 12) * s;
    },

    // World-space rendering; the caller supplies the camera transform.
    render: function (ctx) {
      var i, j;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; // fake glow per section 5.3
      if (pool) {
        for (i = 0; i < cap; i++) {
          var p = pool[i];
          if (!p.alive) continue;
          var a = p.life / p.maxLife;
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          var r = p.size * (0.35 + 0.65 * a); // shrink as it fades
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, GU.TAU);
          ctx.fill();
        }
      }
      if (waves) {
        for (i = 0; i < waveCap; i++) {
          var w = waves[i];
          if (!w.alive) continue;
          var t = 1 - w.life / w.maxLife;
          var rr = w.maxR * GU.easeOutCubic(t);
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.strokeStyle = w.color;
          ctx.lineWidth = 0.5 + 3 * (1 - t);
          ctx.beginPath();
          ctx.arc(w.x, w.y, Math.max(0.1, rr), 0, GU.TAU);
          ctx.stroke();
        }
      }
      if (bolts) {
        for (i = 0; i < boltCap; i++) {
          var b = bolts[i];
          if (!b.alive || !b.pts) continue;
          var ba = b.life / b.maxLife;
          ctx.globalAlpha = ba * 0.9;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(b.pts[0], b.pts[1]);
          for (j = 2; j < b.pts.length; j += 2) ctx.lineTo(b.pts[j], b.pts[j + 1]);
          ctx.stroke();
          ctx.globalAlpha = ba;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(b.pts[0], b.pts[1]);
          for (j = 2; j < b.pts.length; j += 2) ctx.lineTo(b.pts[j], b.pts[j + 1]);
          ctx.stroke();
        }
      }
      ctx.restore();

      if (texts) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (i = 0; i < textCap; i++) {
          var tx = texts[i];
          if (!tx.alive) continue;
          ctx.globalAlpha = tx.life / tx.maxLife;
          ctx.fillStyle = tx.color;
          ctx.font = tx.size + 'px ' + FONT;
          ctx.fillText(tx.text, tx.x, tx.y);
        }
        ctx.restore();
      }
    }
  };

  window.GameParticles = GP;
})();
