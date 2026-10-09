/* NEON SWARM - js/audio.js
 * 100% synthesized SFX + procedural music via WebAudio. No audio files, no network.
 * Public global: window.GameAudio (alias GA). Contract: DESIGN.md section 5.2.
 *
 * GA.init() must be called from inside a user-gesture handler (first
 * pointerdown/keydown); every SFX is a silent no-op until then. Mute state is
 * persisted through GameUtil.storage under "neon-swarm.muted".
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var MUTE_KEY = 'neon-swarm.muted';

  // --- context / buses -------------------------------------------------------
  var ctx = null;      // AudioContext; stays null until a user gesture unlocks it
  var master = null;   // mute rides here
  var sfxBus = null;
  var musicBus = null; // music kept at a low total level
  var noiseBuf = null; // shared 1 s white-noise buffer
  var muted = false;
  var inited = false;
  var sfxVol = 1;        // 0..1 straight into sfxBus (settings screen)
  var musicVol = 0.5;    // 0..1 straight into musicBus (kept low vs sfx)

  // Voice cap: max 12 starts in any 80 ms window, then skip silently.
  // Applied to SFX; the music scheduler is periodic by design and bypasses it.
  var VOICE_CAP = 12;
  var VOICE_WINDOW = 80; // ms
  var voiceStamps = [];
  var lastPlay = {};     // per-SFX rate limiting

  // Music: 112 BPM, 8-step minor-pentatonic square bass + offbeat noise hats.
  var BPM = 112;
  var STEP = 60 / BPM / 2;                    // 8th-note step length (s)
  var LOOKAHEAD = 0.2;                        // schedule this far ahead (s)
  var ROOTS = [110.0, 130.81, 146.83, 98.0];  // A2, C3, D3, G2 (cycle by wave % 4)
  var BASS = [0, 0, 7, 0, 3, 0, 10, 12];      // semitone offsets, minor pentatonic
  var musicTimer = null;
  var musicPlaying = false;
  var musicWanted = false;
  var nextNoteTime = 0;
  var stepIndex = 0;
  var wave = 0;

  function allowVoice() {
    var t = performance.now();
    var keep = [];
    for (var i = 0; i < voiceStamps.length; i++) {
      if (t - voiceStamps[i] < VOICE_WINDOW) keep.push(voiceStamps[i]);
    }
    voiceStamps = keep;
    if (voiceStamps.length >= VOICE_CAP) return false;
    voiceStamps.push(t);
    return true;
  }

  function rateOk(name, gapMs) {
    var t = performance.now();
    if (lastPlay[name] !== undefined && t - lastPlay[name] < gapMs) return false;
    lastPlay[name] = t;
    return true;
  }

  function ready() {
    return ctx !== null && !muted;
  }

  // One enveloped oscillator note.
  function tone(type, f0, f1, t, dur, vol, dest) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== null && f1 !== f0) {
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.008, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // One enveloped noise burst through an optional sweepable filter.
  function noise(t, dur, vol, filterType, f0, f1, dest) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var head = src;
    if (filterType) {
      var f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime(f0, t);
      if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      src.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(dest || sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function musicTick() {
    if (!ctx) return;
    var ahead = ctx.currentTime + LOOKAHEAD;
    while (nextNoteTime < ahead) {
      scheduleStep(stepIndex, nextNoteTime);
      stepIndex = (stepIndex + 1) % 8;
      nextNoteTime += STEP;
    }
  }

  function scheduleStep(i, t) {
    var root = ROOTS[wave % 4];
    var f = root * Math.pow(2, BASS[i] / 12);
    tone('square', f, f, t, STEP * 0.82, 0.12, musicBus);                 // bass, gain 0.12
    if (i % 2 === 1) noise(t, 0.045, 0.05, 'highpass', 6500, 0, musicBus); // offbeat hat, gain 0.05
  }

  var GA = {
    // Idempotent; must be called from a user-gesture handler.
    init: function () {
      if (inited) {
        if (ctx && ctx.state === 'suspended') GA.resume();
        return;
      }
      inited = true;
      muted = GU.storage.get(MUTE_KEY) === true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // WebAudio unavailable: silent mode
      try {
        ctx = new AC();
      } catch (e) {
        ctx = null;
        return;
      }
      if (ctx.state === 'suspended') GA.resume();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicVol; // keep total music gain low
      musicBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      if (musicWanted) GA.startMusic();
    },

    // Call on visibilitychange -> visible.
    resume: function () {
      if (ctx && ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) { /* ignore */ }
      }
    },

    isMuted: function () {
      return muted;
    },

    toggleMute: function () {
      muted = !muted;
      GU.storage.set(MUTE_KEY, muted);
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },

    // Settings sliders (0..1). Safe before init: the values are applied
    // when the buses are created.
    setSfxVolume: function (v) {
      sfxVol = GU.clamp(v, 0, 1);
      if (sfxBus) sfxBus.gain.value = sfxVol;
    },
    setMusicVolume: function (v) {
      musicVol = GU.clamp(v, 0, 1) * 0.5; // music stays under sfx by design
      if (musicBus) musicBus.gain.value = musicVol;
    },
    getSfxVolume: function () { return sfxVol; },
    getMusicVolume: function () { return musicVol / 0.5; },

    // ---- SFX (each is a silent no-op before GA.init) -----------------------

    shoot: function () { // square 880->440 Hz, 0.06 s, vol 0.08, >= 60 ms apart
      if (!ready() || !rateOk('shoot', 60) || !allowVoice()) return;
      tone('square', 880, 440, ctx.currentTime, 0.06, 0.08);
    },

    hit: function () { // triangle 220 Hz, 0.05 s, 0.06, >= 40 ms apart
      if (!ready() || !rateOk('hit', 40) || !allowVoice()) return;
      tone('triangle', 220, 220, ctx.currentTime, 0.05, 0.06);
    },

    kill: function () { // saw 300->80 Hz + noise tick, 0.12 s, 0.12
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sawtooth', 300, 80, t, 0.12, 0.12);
      noise(t, 0.04, 0.08, 'highpass', 2000, 0);
    },

    explode: function () { // noise burst, lowpass 800->100 Hz, 0.25 s, 0.2
      if (!ready() || !allowVoice()) return;
      noise(ctx.currentTime, 0.25, 0.2, 'lowpass', 800, 100);
    },

    pickup: function (comboLevel) { // sine, pitch rises with combo, 0.05 s, >= 40 ms apart
      if (!ready() || !rateOk('pickup', 40) || !allowVoice()) return;
      var step = GU.clamp(Math.floor(comboLevel) || 0, 0, 12);
      var f = 587.33 * Math.pow(2, step / 12);
      tone('sine', f, f, ctx.currentTime, 0.05, 0.08);
    },

    levelup: function () { // 3-note arpeggio 523/659/784 Hz, 0.3 s, 0.15
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sine', 523.25, 523.25, t, 0.12, 0.15);
      tone('sine', 659.25, 659.25, t + 0.09, 0.12, 0.15);
      tone('sine', 783.99, 783.99, t + 0.18, 0.16, 0.15);
    },

    dash: function () { // highpass noise whoosh, 0.12 s, 0.1
      if (!ready() || !allowVoice()) return;
      noise(ctx.currentTime, 0.12, 0.1, 'highpass', 2500, 6000);
    },

    hurt: function () { // square 180->60 Hz, 0.2 s, 0.25
      if (!ready() || !rateOk('hurt', 80) || !allowVoice()) return;
      tone('square', 180, 60, ctx.currentTime, 0.2, 0.25);
    },

    bossWarn: function () { // two 110 Hz pulses, 0.5 s, 0.3
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('square', 110, 110, t, 0.16, 0.3);
      tone('square', 110, 110, t + 0.3, 0.16, 0.3);
    },

    bossDie: function () { // long crash: saw drop + sub sine + filtered noise
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sawtooth', 200, 30, t, 0.7, 0.26);
      tone('sine', 55, 28, t, 0.6, 0.3);
      noise(t, 0.8, 0.28, 'lowpass', 600, 60);
    },

    uiSelect: function () { // sine 520 Hz, 0.06 s
      if (!ready() || !rateOk('uiSelect', 40) || !allowVoice()) return;
      tone('sine', 520, 520, ctx.currentTime, 0.06, 0.08);
    },

    gameOver: function () { // 3 descending notes, 0.9 s
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sine', 392.0, 392.0, t, 0.26, 0.18);
      tone('sine', 311.13, 311.13, t + 0.3, 0.26, 0.18);
      tone('sine', 233.08, 233.08, t + 0.6, 0.3, 0.18);
    },

    // ---- v2 SFX ---------------------------------------------------------------

    nova: function () { // radial blast: sub drop + wide filtered noise wash
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sine', 160, 30, t, 0.45, 0.32);
      tone('sawtooth', 320, 50, t, 0.3, 0.14);
      noise(t, 0.4, 0.22, 'lowpass', 2400, 120);
    },

    power: function () { // pickup: bright rising 2-tone chirp
      if (!ready() || !rateOk('power', 60) || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sine', 660, 660, t, 0.07, 0.12);
      tone('sine', 880, 1320, t + 0.07, 0.12, 0.12);
    },

    shieldHit: function () { // aegis blocks a hit: glassy ping + small noise
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('triangle', 1240, 880, t, 0.12, 0.16);
      noise(t, 0.06, 0.06, 'highpass', 4000, 0);
    },

    codex: function () { // archive unlock blip: soft two-note tick
      if (!ready() || !rateOk('codex', 120) || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sine', 392, 392, t, 0.08, 0.1);
      tone('sine', 587.33, 587.33, t + 0.09, 0.1, 0.1);
    },

    dawn: function () { // victory fanfare: major arp, bright and slow
      if (!ready() || !allowVoice()) return;
      var t = ctx.currentTime;
      tone('sine', 523.25, 523.25, t, 0.3, 0.16);
      tone('sine', 659.25, 659.25, t + 0.16, 0.3, 0.16);
      tone('sine', 783.99, 783.99, t + 0.32, 0.34, 0.16);
      tone('sine', 1046.5, 1046.5, t + 0.48, 0.5, 0.14);
      noise(t + 0.48, 0.7, 0.05, 'highpass', 6000, 0);
    },

    // ---- Music --------------------------------------------------------------

    startMusic: function () {
      musicWanted = true;
      if (!ctx || musicPlaying) return;
      musicPlaying = true;
      nextNoteTime = ctx.currentTime + 0.08;
      stepIndex = 0;
      // setInterval here is the sole allowed timer (section 7.6, music exception).
      musicTimer = setInterval(musicTick, 100);
    },

    setWave: function (w) {
      wave = Math.max(0, Math.floor(w) || 0);
    },

    stopMusic: function () {
      musicWanted = false;
      if (musicTimer !== null) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
      musicPlaying = false;
    }
  };

  window.GameAudio = GA;
})();
