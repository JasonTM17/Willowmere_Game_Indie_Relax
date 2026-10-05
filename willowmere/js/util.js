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
