/* NEON SWARM - js/util.js
 * Math, RNG, storage and formatting helpers. No DOM access.
 * Public global: window.GameUtil (alias GU). Contract: DESIGN.md section 5.2.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Frame-rate independent exponential approach toward b.
  function damp(a, b, lambda, dt) {
    return a + (b - a) * (1 - Math.exp(-lambda * dt));
  }

  function easeOutCubic(t) {
    t = clamp(t, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  // rand(a, b): float in [a, b). rand(x): float in [0, x).
  function rand(a, b) {
    if (b === undefined) {
      b = a;
      a = 0;
    }
    return a + Math.random() * (b - a);
  }

  // Inclusive on both ends.
  function randInt(a, b) {
    return Math.floor(rand(a, b + 1));
  }

  function pick(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function chance(p) {
    return Math.random() < p;
  }

  function dist2(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return dx * dx + dy * dy;
  }

  function dist(ax, ay, bx, by) {
    return Math.sqrt(dist2(ax, ay, bx, by));
  }

  function angleTo(ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  }

  // Returns the unit vector { x, y } plus len = the ORIGINAL input length
  // (direction and magnitude in one call); zero-length input yields the zero
  // vector with len 0.
  function norm(x, y) {
    var len = Math.sqrt(x * x + y * y);
    if (len === 0) return { x: 0, y: 0, len: 0 };
    return { x: x / len, y: y / len, len: len };
  }

  // Small fast seeded PRNG (used for starfield tiles and the like).
  // Gameplay randomness uses Math.random via rand/chance above.
  function mulberry32(seed) {
    seed = seed | 0;
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // localStorage wrapper. Never throws: file:// plus strict cookie settings can
  // make the storage object itself inaccessible, so every access is guarded and
  // failure degrades to "no persistence".
  var storage = {
    get: function (key) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    set: function (key, val) {
      try {
        window.localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        /* persistence unavailable - degrade silently */
      }
    }
  };

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // "MM:SS"; minutes may exceed 99 on very long runs.
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return pad2(m) + ':' + pad2(s);
  }

  // Thousands separators: 1234567 -> "1,234,567".
  function fmt(n) {
    n = Number(n);
    if (!isFinite(n)) return '0';
    var s = String(Math.abs(n));
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + parts.join('.');
  }

  var uidCounter = 0;

  function uid() {
    uidCounter += 1;
    return 'n' + uidCounter.toString(36) + Math.floor(Math.random() * 0x7fffffff).toString(36);
  }

  window.GameUtil = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    damp: damp,
    easeOutCubic: easeOutCubic,
    rand: rand,
    randInt: randInt,
    pick: pick,
    chance: chance,
    dist: dist,
    dist2: dist2,
    angleTo: angleTo,
    norm: norm,
    mulberry32: mulberry32,
    storage: storage,
    formatTime: formatTime,
    fmt: fmt,
    uid: uid
  };
})();
