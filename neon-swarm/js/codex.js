/* NEON SWARM - js/codex.js
 * The story layer (v2 "THE DAWN PROTOCOL"): the persistent Codex archive,
 * prologue lines, boss voices, wave whispers and game-over epitaphs.
 * Public global: window.GameCodex (alias GC). Pure data + unlock logic;
 * rendering lives in hud.js, triggers are called by main.js.
 *
 * Persistence key: neon-swarm.codex  {unlocked:{}, seen:{}, seenPrologue, won}
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var KEY = 'neon-swarm.codex';

  // ---- Codex entries ---------------------------------------------------------
  // id order doubles as the archive listing order. Enemy ids are unlocked by
  // first kill of that type; the rest by the triggers noted in each body.
  var ENTRIES = [
    { id: 'drone',    title: 'DRONE',           body: 'They pollinated the gardens of Sector 4. Now they carry the dark instead of seed-light. Aim low; they still fly their old routes.' },
    { id: 'darter',   title: 'DARTER',          body: 'A courier chassis that outlived its messages. It still winds up before it delivers.' },
    { id: 'splitter', title: 'SPLITTER',        body: 'The grid\'s recycling protocol, corrupted. It divides grief into smaller griefs.' },
    { id: 'mini',     title: 'FRAGMENT',        body: 'A shard of a splitter\'s regret. Quick, small, and honest about what it wants.' },
    { id: 'spitter',  title: 'SPITTER',         body: 'Turret-kin that grew legs and opinions. It keeps its distance the way fear keeps its distance from courage — closely.' },
    { id: 'brute',    title: 'BRUTE',           body: 'Load-bearing infrastructure gone feral. The grid built it to hold a sector up; now it only knows how to lean in.' },
    { id: 'weaver',   title: 'WEAVER',          body: 'Watch the line it draws before it lunges. The swarm learned geometry from our own streets.' },
    { id: 'mite',     title: 'MITE',            body: 'A spark that wants to be a sunrise so badly it burns itself out reaching you. Kill it fast or step back faster.' },
    { id: 'elite',    title: 'ELITE SWARMKIN',  body: 'White-hot. The swarm concentrates its stolen light into champions — and the light inside them can still be won back.' },
    { id: 'boss',     title: 'THE SOVEREIGNS',  body: 'Three shadows hold the dawn hostage. Each one you silence loosens the dark\'s grip on the grid.' },
    { id: 'nova',     title: 'NOVA PROTOCOL',   body: 'Your kills charge a dying star in miniature. Thirty lights offered, one sunrise returned. Aim it well.' },
    { id: 'pickup',   title: 'POWER PODS',      body: 'Overdrive, Havoc, Surge, Aegis — fragments of the old grid\'s emergency toolkit. Borrowed strength is still strength.' },
    { id: 'wave5',    title: 'WAVE V',          body: 'Five waves deep and the swarm sends its first argument. It is a poor negotiator.' },
    { id: 'surge',    title: 'THE THICKENING',  body: 'Sometimes the swarm forgets subtlety and simply becomes weather. Stand in the rain.' },
    { id: 'wave10',   title: 'WAVE X',          body: 'Half-way to dawn. The grid keeps a ledger: every light you return buys the sunrise a little more time.' },
    { id: 'wave15',   title: 'WAVE XV',         body: 'The last shadow does not come quietly. It has watched you for fifteen waves and learned nothing that will save it.' },
    { id: 'firstDeath', title: 'REBOOT',        body: 'Dying is a checkpoint, not an ending. The protocol reloads. The light remembers. Run again.' },
    { id: 'victory',  title: 'DAWN PROTOCOL',   body: 'Sector by sector the lights come home. What you protected was never just a grid — it was the morning.' }
  ];

  var BOSS_TITLES = ['THE FIRST SOVEREIGN', 'THE REMEMBERING', 'THE LAST SHADOW'];
  var BOSS_LINES = {
    1: 'IT REMEMBERS THE LIGHT',
    2: 'THE SWARM LEARNS',
    3: 'EVERYTHING ENDS AT THE DAWN'
  };
  var WHISPERS = {
    2: 'THE GRID REMEMBERS ITS GARDENERS',
    3: 'SOMETHING LEARNED YOUR SHADOW',
    6: 'THE SWARM WEAVES NEW PATTERNS',
    7: 'SMALL LIGHTS HUNGER FASTEST',
    9: 'THE SWARM ADAPTS. SO DO YOU.',
    11: 'THE DARK GROWS PATIENT',
    12: 'ALMOST. HOLD.',
    14: 'THE LAST SHADOW STIRS'
  };
  var EPITAPHS = [
    'THE GRID KEEPS A LIGHT ON FOR YOU.',
    'EVEN SUNRISES FALTER. RUN AGAIN.',
    'THE SWARM DOES NOT MOURN. THE GRID DOES.',
    'SIGNAL LOST. HOPE RETAINED.',
    'A CANDLE, NOT A FUNERAL.'
  ];
  var PROLOGUE = [
    'TWO YEARS AGO, THE GRID WENT DARK.',
    'THE SWARM ATE EVERY LIGHT BUT ONE.',
    'YOU ARE LUX-1 — THE LAST KERNEL.',
    'HOLD UNTIL THE DAWN PROTOCOL FIRES.'
  ];

  function load() {
    var d = GU.storage.get(KEY);
    var def = { unlocked: {}, seen: {}, seenPrologue: false, won: false };
    if (d && typeof d === 'object') {
      for (var k in def) if (d[k] !== undefined) def[k] = d[k];
    }
    return def;
  }

  var GC = {
    data: load(),
    ENTRIES: ENTRIES,
    PROLOGUE: PROLOGUE,

    save: function () { GU.storage.set(KEY, this.data); },

    // Unlock an entry; returns true only the first time (main may pulse HUD).
    unlock: function (id) {
      if (!id || this.data.unlocked[id]) return false;
      this.data.unlocked[id] = true;
      this.save();
      return true;
    },
    unlocked: function (id) { return !!this.data.unlocked[id]; },

    // Entries seen in the archive screen are no longer "new".
    markViewed: function () {
      for (var i = 0; i < ENTRIES.length; i++) {
        if (this.data.unlocked[ENTRIES[i].id]) this.data.seen[ENTRIES[i].id] = true;
      }
      this.save();
    },
    newCount: function () {
      var n = 0;
      for (var i = 0; i < ENTRIES.length; i++) {
        var id = ENTRIES[i].id;
        if (this.data.unlocked[id] && !this.data.seen[id]) n++;
      }
      return n;
    },
    unlockedCount: function () {
      var n = 0;
      for (var i = 0; i < ENTRIES.length; i++) if (this.data.unlocked[ENTRIES[i].id]) n++;
      return n;
    },

    bossTitle: function (n) {
      return BOSS_TITLES[n - 1] || ('SOVEREIGN ' + n);
    },
    bossLine: function (n) {
      return BOSS_LINES[n] || 'THE SWARM REMEMBERS YOU';
    },
    whisper: function (wave) {
      return WHISPERS[wave] || null;
    },
    epitaph: function (stats) {
      if (stats && stats.wave >= 15) return 'SO CLOSE TO THE DAWN.';
      if (stats && stats.kills >= 500) return 'YOU FELL LEGENDARY.';
      if (stats && stats.kills < 10) return 'THE SWARM DOES NOT MOURN.';
      return GU.pick(EPITAPHS);
    }
  };

  window.GameCodex = GC;
})();
