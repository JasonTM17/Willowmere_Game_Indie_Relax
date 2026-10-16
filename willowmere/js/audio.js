/* Willowmere — audio.js · window.WAudio
   - Music: up to 3 Audio elements from WManifest.audio, crossfaded (2 s).
     Missing/unknown key = keep current track, warn once, never crash.
   - SFX: synthesized WebAudio blips; silent no-ops before init().
   - AudioContext is created only from the first keydown/pointerdown gesture
     (this module self-registers that hook; idempotent for later callers).
   - Music/SFX volumes are 0-1, persisted via WU (never-throw storage). */
(function () {
  'use strict';

  var SETTINGS_KEY = 'willowmere_settings';

  var ctx = null;        // AudioContext (after first gesture)
  var sfxGain = null;    // master SFX gain
  var noiseBuf = null;   // shared white-noise buffer

  var musicVol = 1.0;
  var sfxVol = 0.8;
  var muted = false;     // master mute (Settings); keeps the stored volumes

  var cur = null;        // current music slot {el, vol, target, dying}
  var fades = [];        // active fade slots
  var warned = {};       // once-per-key warnings

  /* ---- settings (persisted, never-throw) ---- */
  (function readSettings() {
    var s = window.WU && WU.load(SETTINGS_KEY);
    if (s) {
      if (typeof s.music === 'number') musicVol = Math.min(1, Math.max(0, s.music));
      if (typeof s.sfx === 'number') sfxVol = Math.min(1, Math.max(0, s.sfx));
      muted = s.muted === true;
    }
  })();

  function persist() {
    if (window.WU) WU.save(SETTINGS_KEY, { music: musicVol, sfx: sfxVol, muted: muted });
  }

  /* ---- context ---- */

  function init() {
    if (ctx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      sfxGain = ctx.createGain();
      sfxGain.gain.value = sfxVol;
      sfxGain.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  /* First user gesture — browsers require it before any sound. */
  function firstGesture() {
    init();
    resume();
  }
  document.addEventListener('keydown', firstGesture);
  document.addEventListener('pointerdown', firstGesture);

  /* ---- music (Audio elements + volume crossfade) ---- */

  function musicElement(key) {
    if (!window.WAssets) return null;
    return WAssets.audio(key); // null when the key is missing
  }

  /* Returns true if playback started; false = missing key, current kept,
     or no gesture yet. §9.5: Audio elements are never autoplayed — before
     the AudioContext exists we simply wait; main's music director re-issues
     the current key once WAudio.ready() turns true after the first gesture. */
  function playMusic(key) {
    if (!key) return false;
    if (!ctx) return false;
    var el = musicElement(key);
    if (!el) {
      if (!warned[key]) {
        warned[key] = true;
        try { console.warn('[WAudio] music not available, staying silent: ' + key); } catch (e) { /* ignore */ }
      }
      return false;
    }
    if (cur && cur.el === el) { cur.target = musicVol; return true; }

    el.loop = true;
    el.volume = 0;
    var dead = false;
    el.addEventListener('error', function () { dead = true; });
    try {
      var p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () { dead = true; }); // file missing / autoplay blocked
      }
    } catch (e) {
      return false;
    }
    if (cur) { cur.target = 0; cur.dying = true; }
    var slot = { el: el, vol: 0, target: musicVol, dying: false };
    slot.isDead = function () { return dead; };
    /* one element, one slot: a re-request of a still-dying track must drop
       the stale slot WITHOUT pausing — el was play()ed just above and is the
       live one; the stale slot only has to stop existing so its bottom-out
       pause never fires and it quits fighting el.volume */
    for (var f = fades.length - 1; f >= 0; f--) {
      if (fades[f].el === el) fades.splice(f, 1);
    }
    fades.push(slot);
    cur = slot;
    return true;
  }

  function stopMusic() {
    if (cur) { cur.target = 0; cur.dying = true; cur = null; }
  }

  /* ---- ambient loops: rain hiss, sea swell, night crickets ----
     One layer at a time, crossfaded; the game loop picks the kind. */
  var amb = { kind: null, src: null, f: null, g: null, lfo: null, cricketT: 0 };
  var AMB_LEVEL = { rain: 0.05, waves: 0.042, night: 0 };

  function stopAmbient() {
    if (amb.src) { try { amb.src.stop(); } catch (e) { /* ignore */ } }
    if (amb.lfo) { try { amb.lfo.stop(); } catch (e) { /* ignore */ } }
    if (amb.g) {
      try {
        amb.g.gain.cancelScheduledValues(ctx.currentTime);
        amb.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
      } catch (e) { /* ignore */ }
    }
    amb.src = null; amb.f = null; amb.g = null; amb.lfo = null;
    amb.kind = null;
  }

  function setAmbient(kind) {
    /* nothing to do when: already running, already idle, or blocked the
       same way as last call — the caller re-asserts every frame, so a
       blocked wish (muted / no ctx yet) simply tries again next frame */
    if (kind === amb.kind) {
      if (amb.g || !kind || !ctx || !sfxGain || muted) return;
    }
    stopAmbient();
    amb.kind = kind;
    if (!kind || !ctx || !sfxGain || muted) return;
    var t = ctx.currentTime;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(AMB_LEVEL[kind] || 0.001, t + 1.6); // fade the world in
    g.connect(sfxGain);
    amb.g = g;
    if (kind === 'rain' || kind === 'waves') {
      var src = ctx.createBufferSource();
      src.buffer = getNoiseBuf();
      src.loop = true;
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = kind === 'rain' ? 1500 : 480;
      src.connect(f); f.connect(g); src.start();
      amb.src = src; amb.f = f;
      if (kind === 'waves') {
        /* slow swell: an LFO breathing on the noise's loudness */
        var lfo = ctx.createOscillator();
        lfo.frequency.value = 0.42;
        var lg = ctx.createGain();
        lg.gain.value = (AMB_LEVEL.waves) * 0.55;
        lfo.connect(lg); lg.connect(g.gain); lfo.start();
        amb.lfo = lfo;
      }
    }
    /* 'night' needs no loop — update() schedules cricket chirps */
  }

  /* Called once per frame by the game loop; ramps volumes (~2 s full fade). */
  function update(dt) {
    /* cricket chirps: 3 quick trills, irregular spacing, keep it shy */
    if (amb.kind === 'night' && ctx && sfxGain && !muted) {
      amb.cricketT -= dt;
      if (amb.cricketT <= 0) {
        amb.cricketT = 0.7 + Math.random() * 1.1;
        var base = 4100 + Math.random() * 900;
        for (var c = 0; c < 3; c++) tone(base, base * 0.94, 0.045, 'sine', 0.011, c * 0.075);
      }
    }
    if (!fades.length) return;
    var step = Math.max(musicVol, 0.2) * 0.5 * dt;
    for (var i = fades.length - 1; i >= 0; i--) {
      var s = fades[i];
      if (s.isDead()) {
        try { s.el.pause(); } catch (e) { /* ignore */ }
        fades.splice(i, 1);
        if (cur === s) cur = null;
        continue;
      }
      s.vol = WU.approach(s.vol, (s.dying || muted) ? 0 : s.target, step);
      try { s.el.volume = WU.clamp(s.vol, 0, 1); } catch (e) { /* ignore */ }
      if (s.dying && s.vol <= 0.001) {
        try { s.el.pause(); } catch (e) { /* ignore */ }
        fades.splice(i, 1);
        if (cur === s) cur = null;
      }
    }
  }

  /* ---- SFX synthesis ---- */

  function tone(f0, f1, dur, type, vol, when) {
    if (!ctx || !sfxGain) return;
    var t = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol || 0.15), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function getNoiseBuf() {
    if (!ctx) return null;
    if (!noiseBuf) {
      var len = ctx.sampleRate | 0;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function noise(dur, vol, fc, when) {
    if (!ctx || !sfxGain) return;
    if (!getNoiseBuf()) return;
    var t = ctx.currentTime + (when || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = fc || 1200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol || 0.1), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /* click · chime · splash · plop · bite · reel · net · pop · gift · heart ·
     bell · tune (Shepherd's Tune motif) + footstep, vista, catch, sparkle,
     interact, sleep. Unknown names fall back to a soft click. */
  function sfx(name) {
    if (!ctx || muted) return;     // no-op before first gesture / while muted
    resume();
    switch (name) {
      case 'click':
        tone(880, 660, 0.06, 'square', 0.10); break;
      case 'interact':
        tone(520, 700, 0.09, 'triangle', 0.13); break;
      case 'chime':
        tone(880, 880, 0.20, 'sine', 0.11);
        tone(1318, 1318, 0.26, 'sine', 0.09, 0.09); break;
      case 'sparkle':
        tone(1568, 2093, 0.16, 'sine', 0.07);
        tone(2093, 2637, 0.14, 'sine', 0.05, 0.08); break;
      case 'splash':
        noise(0.30, 0.16, 900);
        tone(240, 120, 0.22, 'sine', 0.07); break;
      case 'plop':
        tone(340, 110, 0.13, 'sine', 0.18); break;
      case 'bite':
        tone(660, 660, 0.05, 'square', 0.15);
        tone(880, 880, 0.07, 'square', 0.15, 0.08); break;
      case 'reel':
        for (var i = 0; i < 5; i++) noise(0.03, 0.07, 3000, i * 0.06); break;
      case 'net':
        noise(0.22, 0.12, 1800);
        tone(520, 170, 0.20, 'sine', 0.05); break;
      case 'swing':                       /* staff whoosh */
        noise(0.14, 0.13, 2600);
        tone(300, 140, 0.10, 'triangle', 0.06); break;
      case 'hit':                         /* staff connects */
        noise(0.08, 0.16, 900);
        tone(200, 90, 0.12, 'square', 0.12); break;
      case 'hurt':                        /* player takes a hit */
        tone(220, 110, 0.22, 'square', 0.14);
        noise(0.18, 0.10, 700); break;
      case 'windup':                      /* a foe draws its strike back */
        tone(160, 240, 0.20, 'sawtooth', 0.08); break;
      case 'pop':
        tone(520, 1040, 0.09, 'sine', 0.15); break;
      case 'catch':
        tone(523, 523, 0.10, 'triangle', 0.13);
        tone(784, 784, 0.12, 'triangle', 0.11, 0.08);
        tone(1046, 1046, 0.18, 'triangle', 0.09, 0.16); break;
      case 'gift':
        tone(523, 523, 0.12, 'triangle', 0.12);
        tone(659, 659, 0.12, 'triangle', 0.11, 0.10);
        tone(784, 784, 0.20, 'triangle', 0.10, 0.20); break;
      case 'heart':
        tone(990, 740, 0.18, 'triangle', 0.11); break;
      case 'bell':
        tone(660, 660, 0.9, 'sine', 0.11);
        tone(1320, 1319, 0.5, 'sine', 0.04); break;
      case 'tune': { // Shepherd's Tune motif
        var n = [392, 440, 494, 587, 494, 440, 392];
        for (var k = 0; k < n.length; k++) tone(n[k], n[k], 0.24, 'sine', 0.10, k * 0.22);
        break;
      }
      case 'footstep':
        /* slight per-step pitch spread so a walk does not sound metronomic */
        noise(0.05, 0.04, 420 + Math.random() * 260); break;
      case 'vista':
        tone(262, 262, 0.9, 'sine', 0.08);
        tone(330, 330, 0.9, 'sine', 0.07, 0.05);
        tone(392, 392, 0.9, 'sine', 0.06, 0.10);
        tone(523, 523, 1.1, 'sine', 0.05, 0.15); break;
      case 'sleep':
        tone(392, 392, 0.5, 'sine', 0.08);
        tone(294, 294, 0.8, 'sine', 0.07, 0.30); break;
      default:
        tone(880, 660, 0.06, 'square', 0.10);
    }
  }

  /* ---- volumes ---- */

  function setMusicVolume(v) {
    musicVol = WU.clamp(v, 0, 1);
    for (var i = 0; i < fades.length; i++) {
      if (!fades[i].dying) fades[i].target = musicVol;
    }
    persist();
  }

  function setSfxVolume(v) {
    sfxVol = WU.clamp(v, 0, 1);
    if (sfxGain) sfxGain.gain.value = sfxVol;
    persist();
  }

  /* Master mute (Settings row): silences music + SFX without touching the
     persisted volume levels; unmuting ramps back to the stored values. */
  function setMuted(v) {
    muted = !!v;
    stopAmbient();   // loops don't ride sfxGain's level — silence them now;
                     // the next per-frame setAmbient rebuilds after unmute
    persist();
  }

  window.WAudio = {
    init: init,
    playMusic: playMusic,
    stopMusic: stopMusic,
    sfx: sfx,
    update: update,
    setMusicVolume: setMusicVolume,
    setSfxVolume: setSfxVolume,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    getMusicVolume: function () { return musicVol; },
    getSfxVolume: function () { return sfxVol; },
    ready: function () { return !!ctx; },
    setAmbient: setAmbient,
    ambient: function () { return amb.kind; }   // test hook: which loop the world asked for
  };
})();
