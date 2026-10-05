/* Willowmere — particles.js · window.WParticles
   One pooled array, hard cap 400 live particles (rain ≤ 300).
   Types: rain, ripple, splash, firefly, leaf, mote, sparkle, heart, dust,
   floattext (alias: text).
   - emit(type, x, y, opts) — opts: {vx, vy, life, size, color, text, force}
   - setRain(intensity) — self-budgets ≤300 streaks while >0; a drop dying
     over a water tile converts into a ripple (needs world.waterAt in update).
   - WParticles.view {x,y,w,h} (world px) is written by WWorld each frame and
     used as the rain spawn field.
   - update(dt, world) · draw(ctx, cam) · clear() */
(function () {
  'use strict';

  var MAX = 400;
  var RAIN_MAX = 300;

  var T = {
    RAIN: 1, RIPPLE: 2, SPLASH: 3, FIREFLY: 4, LEAF: 5,
    MOTE: 6, SPARKLE: 7, HEART: 8, DUST: 9, FLOATTEXT: 10
  };
  var typeByName = {
    rain: T.RAIN, ripple: T.RIPPLE, splash: T.SPLASH, firefly: T.FIREFLY,
    leaf: T.LEAF, mote: T.MOTE, sparkle: T.SPARKLE, heart: T.HEART,
    dust: T.DUST, floattext: T.FLOATTEXT, text: T.FLOATTEXT
  };
  var LIFE = {};
  LIFE[T.RAIN] = 1.3;
  LIFE[T.RIPPLE] = 0.6;
  LIFE[T.SPLASH] = 0.5;
  LIFE[T.FIREFLY] = 6;
  LIFE[T.LEAF] = 4.5;
  LIFE[T.MOTE] = 8;
  LIFE[T.SPARKLE] = 0.7;
  LIFE[T.HEART] = 1.1;
  LIFE[T.DUST] = 1.4;
  LIFE[T.FLOATTEXT] = 1.3;

  var pool = [];
  var cursor = 0;
  var rainTarget = 0;
  var view = { x: 0, y: 0, w: 1024, h: 768 };

  for (var i = 0; i < MAX; i++) {
    pool.push({
      on: false, type: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, max: 1, seed: 0,
      size: 0, text: '', color: null
    });
  }

  function emit(type, x, y, opts) {
    opts = opts || {};
    var t = typeByName[type];
    if (!t) return null;
    var p = null;
    for (var tries = 0; tries < MAX; tries++) {
      var c = pool[cursor];
      cursor = (cursor + 1) % MAX;
      if (!c.on) { p = c; break; }
    }
    if (!p) {
      if (!opts.force) return null;           // pool full: rain/effects yield
      p = pool[cursor];
      cursor = (cursor + 1) % MAX;
    }
    p.on = true;
    p.type = t;
    p.x = x; p.y = y;
    p.vx = opts.vx || 0;
    p.vy = opts.vy || 0;
    p.max = p.life = opts.life || LIFE[t];
    p.seed = Math.random() * 6.283;
    p.size = opts.size || 0;
    p.text = opts.text || '';
    p.color = opts.color || null;
    return p;
  }

  function setRain(intensity) {
    rainTarget = Math.min(RAIN_MAX, Math.max(0, Math.round((intensity || 0) * RAIN_MAX)));
  }

  function spawnRain() {
    var live = 0, i, p;
    for (i = 0; i < MAX; i++) {
      if (pool[i].on && pool[i].type === T.RAIN) live++;
    }
    var n = Math.min(rainTarget - live, 8);
    for (var k = 0; k < n; k++) {
      emit('rain',
        view.x + Math.random() * view.w,
        view.y + Math.random() * view.h * 0.7,
        { vx: -18 - Math.random() * 14, vy: 470 + Math.random() * 90, life: 1.5 });
    }
  }

  function update(dt, world) {
    if (rainTarget > 0) spawnRain();
    for (var i = 0; i < MAX; i++) {
      var p = pool[i];
      if (!p.on) continue;
      var age = p.max - p.life;
      switch (p.type) {
        case T.RAIN:
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.y > view.y + view.h + 8) p.life = 0;
          break;
        case T.RIPPLE:
          break;
        case T.SPLASH:
          p.vy += 760 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case T.FIREFLY:
          p.vx = Math.cos(p.seed + age * 0.7) * 18;
          p.vy = Math.sin(p.seed * 1.7 + age * 0.9) * 12;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case T.LEAF:
          p.y += 26 * dt;
          p.x += Math.sin(age * 2 + p.seed) * 22 * dt;
          break;
        case T.MOTE:
          p.y += Math.sin(age * 1.5 + p.seed) * 7 * dt;
          p.x += Math.cos(age * 0.9 + p.seed) * 8 * dt;
          break;
        case T.SPARKLE:
          p.y -= 14 * dt;
          break;
        case T.HEART:
          p.y -= 34 * dt;
          p.x += Math.sin(age * 5 + p.seed) * 8 * dt;
          break;
        case T.DUST:
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case T.FLOATTEXT:
          p.y -= 26 * dt;
          break;
      }
      p.life -= dt;
      if (p.life <= 0) {
        if (p.type === T.RAIN) {
          if (world && typeof world.waterAt === 'function' && world.waterAt(p.x, p.y)) {
            /* a drop hitting water becomes a ripple ring */
            p.type = T.RIPPLE;
            p.vx = 0; p.vy = 0;
            p.max = p.life = 0.6;
          } else {
            p.on = false;
          }
        } else {
          p.on = false;
        }
      }
    }
  }

  function draw(ctx, cam) {
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    var i, p, a, age, bl, pu;

    /* rain: one batched path */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(176,206,240,1)';
    ctx.beginPath();
    for (i = 0; i < MAX; i++) {
      p = pool[i];
      if (p.on && p.type === T.RAIN) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.022);
      }
    }
    ctx.stroke();

    for (i = 0; i < MAX; i++) {
      p = pool[i];
      if (!p.on || p.type === T.RAIN) continue;
      a = p.max > 0 ? p.life / p.max : 0;
      if (a > 1) a = 1;
      age = p.max - p.life;
      switch (p.type) {
        case T.RIPPLE:
          ctx.globalAlpha = 0.55 * a;
          ctx.strokeStyle = 'rgba(232,246,255,1)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2 + (1 - a) * 9, 0, 6.283);
          ctx.stroke();
          break;
        case T.SPLASH:
          ctx.globalAlpha = 0.8 * a;
          ctx.fillStyle = 'rgba(214,238,255,1)';
          ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
          break;
        case T.FIREFLY:
          bl = (Math.sin(age * 2.6 + p.seed) + 1) / 2; // sine blink
          ctx.globalAlpha = 0.25 * a * bl;
          ctx.fillStyle = 'rgba(214,255,150,1)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 6.283); ctx.fill();
          ctx.globalAlpha = 0.9 * a * bl;
          ctx.fillStyle = 'rgba(240,255,190,1)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 6.283); ctx.fill();
          break;
        case T.LEAF:
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(age * 2 + p.seed) * 1.2);
          ctx.globalAlpha = 0.9 * a;
          ctx.fillStyle = 'rgba(157,184,95,1)';
          ctx.fillRect(-2.5, -1.5, 5, 3);
          ctx.restore();
          break;
        case T.MOTE:
          pu = 0.6 + 0.4 * Math.sin(age * 2.2 + p.seed);
          ctx.globalAlpha = 0.2 * a * pu;
          ctx.fillStyle = 'rgba(150,235,255,1)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 6.283); ctx.fill();
          ctx.globalAlpha = 0.85 * a * pu;
          ctx.fillStyle = 'rgba(220,250,255,1)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 6.283); ctx.fill();
          break;
        case T.SPARKLE:
          ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(255,250,220,1)';
          ctx.fillRect(p.x - 1, p.y - 3, 2, 6);
          ctx.fillRect(p.x - 3, p.y - 1, 6, 2);
          break;
        case T.HEART:
          ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(255,108,150,1)';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('\u2665', p.x, p.y);
          break;
        case T.DUST:
          ctx.globalAlpha = 0.5 * a;
          ctx.fillStyle = p.color || 'rgba(255,241,205,1)';
          ctx.fillRect(p.x, p.y, p.size || 1.5, p.size || 1.5);
          break;
        case T.FLOATTEXT:
          ctx.font = 'bold 12px "Segoe UI",Verdana,sans-serif';
          ctx.textAlign = 'center';
          ctx.globalAlpha = 0.7 * a;
          ctx.fillStyle = 'rgba(20,24,30,1)';
          ctx.fillText(p.text, p.x + 1, p.y + 1);
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color || 'rgba(255,255,255,1)';
          ctx.fillText(p.text, p.x, p.y);
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function clear() {
    for (var i = 0; i < MAX; i++) pool[i].on = false;
    rainTarget = 0;
  }

  window.WParticles = {
    emit: emit,
    setRain: setRain,
    update: update,
    draw: draw,
    clear: clear,
    view: view,
    MAX: MAX,
    count: function () {
      var n = 0;
      for (var i = 0; i < MAX; i++) if (pool[i].on) n++;
      return n;
    }
  };
})();
