/* Willowmere — assets.js · window.WAssets
   Image/Audio preloader, file://-safe.
   - Images via new Image() with relative src from WManifest; onerror marks the
     key missing and loading CONTINUES (never throws).
   - Audio via Audio elements (loop=true, preload=auto); never autoplayed here.
   - Every consumer must treat any manifest key as possibly missing, including
     WManifest itself being undefined or {}.
   - No network I/O of any kind (no XHR/fetch-style calls), no getImageData anywhere. */
(function () {
  'use strict';

  var images = {};   // art key -> HTMLImageElement (only when loaded ok)
  var audios = {};   // audio key -> Audio element
  var state = {};    // "art:key" / "audio:key" -> 'pending' | 'ok' | 'missing'
  var total = 0, done = 0;
  var started = false, finished = false;
  var progressCb = null;
  var waiters = [];

  function manifest() {
    var m = window.WManifest;
    return (m && typeof m === 'object') ? m : {};
  }

  function finish() {
    finished = true;
    var ws = waiters;
    waiters = [];
    for (var i = 0; i < ws.length; i++) {
      try { ws[i](true); } catch (e) { /* consumer error must not break us */ }
    }
  }

  function settle(ns, s) {
    if (state[ns] === 'ok' || state[ns] === 'missing') return; // already settled
    state[ns] = s;
    done++;
    if (progressCb) {
      try { progressCb(done, total); } catch (e) { /* ignore */ }
    }
    if (done >= total && total > 0) finish();
  }

  function loadImage(it) {
    var img;
    try { img = new Image(); } catch (e) { settle(it.ns, 'missing'); return; }
    img.onload = function () { images[it.key] = img; settle(it.ns, 'ok'); };
    img.onerror = function () { settle(it.ns, 'missing'); };
    img.src = it.path;
  }

  function loadAudio(it) {
    var a;
    try { a = new Audio(); } catch (e) { settle(it.ns, 'missing'); return; }
    a.loop = true;
    a.preload = 'auto';
    var settled = false;
    var ok = function () {
      if (settled) return;
      settled = true;
      audios[it.key] = a;
      settle(it.ns, 'ok');
    };
    var bad = function () {
      if (settled) return;
      settled = true;
      settle(it.ns, 'missing');
    };
    a.addEventListener('canplaythrough', ok);
    a.addEventListener('loadeddata', ok);
    a.addEventListener('error', bad);
    a.src = it.path;
    /* Some browsers never fire events for file:// media: treat as usable after
       a grace period; WAudio still guards every play() against real errors. */
    window.setTimeout(function () {
      if (!settled) { settled = true; audios[it.key] = a; settle(it.ns, 'ok'); }
    }, 4000);
  }

  function begin() {
    var m = manifest();
    var art = m.art || {};
    var aud = m.audio || {};
    var keys = [];
    var k;
    for (k in art) if (art.hasOwnProperty(k)) keys.push({ ns: 'art:' + k, kind: 'art', key: k, path: art[k] });
    for (k in aud) if (aud.hasOwnProperty(k)) keys.push({ ns: 'audio:' + k, kind: 'audio', key: k, path: aud[k] });
    total = keys.length;
    done = 0;
    if (total === 0) { finish(); return; }
    for (var i = 0; i < keys.length; i++) {
      var it = keys[i];
      state[it.ns] = 'pending';
      if (it.kind === 'art') loadImage(it);
      else loadAudio(it);
    }
  }

  /* WAssets.load(onProgress) -> Promise; onProgress(done, total) as keys settle. */
  function load(onProgress) {
    if (typeof onProgress === 'function') progressCb = onProgress;
    if (finished) return Promise.resolve(true);
    var p = new Promise(function (res) { waiters.push(res); });
    if (!started) { started = true; begin(); }
    return p;
  }

  /* ---- queries (all safe when the key is missing) ---- */

  function img(key) {
    return state['art:' + key] === 'ok' ? (images[key] || null) : null;
  }

  function has(key) {
    return state['art:' + key] === 'ok';
  }

  /* Audio|null — element only if the key was never marked missing.
     WAudio guards play() errors; a still-loading file is returned as-is. */
  function audio(key) {
    if (state['audio:' + key] === 'missing') return null;
    return audios[key] || null;
  }

  /* Deterministic placeholder tint per key (flat vector fallback). */
  function keyHue(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  function placeholder(ctx, key, dx, dy, dw, dh) {
    var hue = keyHue(String(key));
    ctx.fillStyle = 'hsl(' + hue + ',28%,44%)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.fillStyle = 'hsl(' + hue + ',28%,34%)';
    ctx.fillRect(dx, dy + dh - Math.min(4, dh * 0.15), dw, Math.min(4, dh * 0.15));
  }

  /* Guarded atlas blit. Missing key (or dead drawImage) -> flat tinted rect. */
  function sheet(ctx, key, sx, sy, sw, sh, dx, dy, dw, dh) {
    var im = img(key);
    if (im) {
      try {
        ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
        return true;
      } catch (e) { /* fall through to placeholder */ }
    }
    placeholder(ctx, key, dx, dy, dw, dh);
    return false;
  }

  window.WAssets = {
    load: load,
    img: img,
    has: has,
    audio: audio,
    sheet: sheet,
    /* true once every manifest key has settled ok or missing */
    isLoaded: function () { return finished; },
    progress: function () { return { done: done, total: total }; }
  };
})();
