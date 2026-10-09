/* Willowmere — util.js · window.WU
   Pure helpers: math, seeded RNG, never-throw storage, game-clock format.
   Leaf library: never calls game layers. */
(function () {
  'use strict';

  var WU = {};

  WU.TAU = Math.PI * 2;

  /* ---- math ---- */
  WU.clamp = function (v, min, max) {
    return v < min ? min : (v > max ? max : v);
  };

  WU.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  WU.dist = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };

  WU.rand = function (min, max) {
    if (min === undefined) { min = 0; max = 1; }
    else if (max === undefined) { max = min; min = 0; }
    return min + Math.random() * (max - min);
  };

  WU.randInt = function (min, max) {
    return Math.floor(WU.rand(min, max + 1));
  };

  WU.pick = function (arr) {
    return arr[(Math.random() * arr.length) | 0];
  };

  WU.chance = function (p) {
    return Math.random() < p;
  };

  /* Move cur toward tgt by at most step (used for fades, camera, particles). */
  WU.approach = function (cur, tgt, step) {
    if (cur < tgt) return Math.min(cur + step, tgt);
    if (cur > tgt) return Math.max(cur - step, tgt);
    return tgt;
  };

  /* ---- game clock ---- */

  /* Wrap any hour value into [0, 24). */
  WU.hnorm = function (h) {
    h = h % 24;
    if (h < 0) h += 24;
    return h;
  };

  /* 7.5 -> "07:30" */
  WU.fmtHour = function (h) {
    h = WU.hnorm(h);
    var hh = Math.floor(h);
    var mm = Math.floor((h - hh) * 60 + 0.5);
    if (mm >= 60) { mm -= 60; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  };

  WU.easeInOut = function (t) {
    t = WU.clamp(t, 0, 1);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  };

  /* ---- deterministic RNG (mulberry32) — map build ---- */
  WU.seed = function (seed) {
    var a = (seed | 0) >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Stateless hash for two ints -> [0,1). Tile detail variation. */
  WU.hash2 = function (x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  /* ---- color helpers (lighting / colour-grade) ---- */

  /* mix two [r,g,b] arrays */
  WU.mix = function (a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  };

  /* '#rrggbb' -> [r,g,b] */
  WU.hexRgb = function (hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* [r,g,b], alpha -> 'rgba(r,g,b,a)' */
  WU.rgba = function (c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  };

  /* ---- shared vector UI kit ----
   The ui.png atlas panels clash with the game's warm palette, so every
   screen draws panels/chips from here: one coherent parchment-on-dusk look,
   independent of the atlas. Pure draw calls; no game layers touched. */

var UI_GOLD = 'rgba(240,200,130,';
var UI_CREAM = 'rgba(242,234,216,';

function uiPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/* Dusk panel: soft shadow, warm gradient, gold hairline, inner highlight. */
WU.panel = function (ctx, x, y, w, h, opts) {
  opts = opts || {};
  var r = opts.radius !== undefined ? opts.radius : 10;
  var a = opts.alpha !== undefined ? opts.alpha : 0.94;

  /* drop shadow (cheap: one offset translucent pass) */
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  uiPath(ctx, x - 1, y + 2, w + 2, h + 3, r + 1);
  ctx.fill();

  /* body */
  var g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(43,40,54,' + a + ')');
  g.addColorStop(1, 'rgba(22,20,30,' + Math.min(1, a + 0.04) + ')');
  ctx.fillStyle = g;
  uiPath(ctx, x, y, w, h, r);
  ctx.fill();

  /* gold hairline + inner highlight */
  ctx.strokeStyle = UI_GOLD + '0.55)';
  ctx.lineWidth = 1.5;
  uiPath(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.strokeStyle = UI_CREAM + '0.09)';
  ctx.lineWidth = 1;
  uiPath(ctx, x + 2.5, y + 2.5, w - 5, h - 5, Math.max(2, r - 3));
  ctx.stroke();

  if (opts.accent) {
    /* gold accent bar (quest cards, toasts) */
    ctx.fillStyle = UI_GOLD + '0.9)';
    uiPath(ctx, x + 4, y + 6, 3, h - 12, 1.5);
    ctx.fill();
  }
};

/* Small keyboard key cap (Q, F, E, Tab…) with a pressed-look bottom bevel.
   Width grows for multi-letter labels ("Tab"); returns the cap width. */
WU.keycapW = function (s, label) {
  return Math.max(s, String(label).length * s * 0.48 * 0.62 + 12);
};

WU.keycap = function (ctx, x, y, s, label) {
  var w = WU.keycapW(s, label);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  uiPath(ctx, x, y + 1.5, w, s, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(66,62,78,0.98)';
  uiPath(ctx, x, y, w, s - 1.5, 5);
  ctx.fill();
  ctx.strokeStyle = UI_GOLD + '0.55)';
  ctx.lineWidth = 1;
  uiPath(ctx, x + 0.5, y + 0.5, w - 1, s - 2.5, 4.5);
  ctx.stroke();
  ctx.fillStyle = '#ffe9b8';
  ctx.font = 'bold ' + Math.round(s * 0.48) + 'px "Segoe UI",Verdana,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + s * 0.62);
  return w;
};

/* Round item token for inventory fallbacks: deterministic hue + kind ring. */
WU.gemToken = function (ctx, x, y, r, hue) {
  var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.2, x, y, r);
  g.addColorStop(0, 'hsl(' + hue + ',45%,62%)');
  g.addColorStop(1, 'hsl(' + hue + ',38%,38%)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, WU.TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,210,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, WU.TAU); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.22, 0, WU.TAU); ctx.fill();
};

/* Weather glyph: sun / rain / moon, drawn to match the HUD's palette. */
WU.weatherGlyph = function (ctx, kind, x, y, s) {
  var i;
  if (kind === 'rain') {
    ctx.fillStyle = 'rgba(150,190,214,0.95)';
    for (i = 0; i < 3; i++) ctx.fillRect(x + i * (s * 0.38), y + s * 0.45 + (i % 2) * s * 0.18, Math.max(1, s * 0.1), s * 0.4);
    ctx.fillStyle = 'rgba(200,214,226,0.9)';
    ctx.beginPath();
    ctx.arc(x + s * 0.3, y + s * 0.25, s * 0.28, Math.PI, 0);
    ctx.arc(x + s * 0.65, y + s * 0.25, s * 0.34, Math.PI * 0.9, 0);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'night') {
    ctx.fillStyle = '#cfd8ee';
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.42, Math.PI * 0.32, Math.PI * 1.68);
    ctx.arc(x + s * 0.78, y + s * 0.36, s * 0.34, Math.PI * 1.5, Math.PI * 0.55, true);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.3, 0, WU.TAU); ctx.fill();
    for (i = 0; i < 8; i++) {
      var an = (i / 8) * WU.TAU;
      ctx.fillRect(x + s * 0.5 + Math.cos(an) * s * 0.44 - 0.75,
                   y + s * 0.5 + Math.sin(an) * s * 0.44 - 0.75, 1.5, 1.5);
    }
  }
};

/* ---- storage: never throws (file:// may block localStorage) ---- */

  WU.save = function (key, obj) {
    try {
      window.localStorage.setItem(key, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  };

  WU.load = function (key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : null;
    } catch (e) {
      return null;
    }
  };

  window.WU = WU;
})();
