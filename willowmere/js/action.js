/* Willowmere — action.js · window.WAction
   Light actions (DESIGN.md §5): inventory (24 item slots, counted), critter
   field (spawn by biome+hour, cap 40; net swing = round hitbox ahead of the
   player), two-stage timing fishing at the water's edge, slingshot that pops
   drifting motes (1 pebble in flight), gift resolution (removes the
   item, moves hearts per the §3 tables). drawUnder: motes, critters, bobber
   line, pebbles · drawOver: net arc, "!" bite marker, timing bar, aim dots. */
window.WAction = (function () {
  'use strict';

  /* ---- item registry (§5.4) ---- */
  var ITEMS = {
    critter_butterfly: { name: 'Butterfly', desc: 'Meadow wings, 7:00\u201317:00.', kind: 'critter' },
    critter_cricket: { name: 'Cricket', desc: 'Evening fiddler, 18:00\u201323:00.', kind: 'critter' },
    critter_oak_beetle: { name: 'Oak Beetle', desc: 'Forest shiny, 8:00\u201317:00.', kind: 'critter' },
    critter_firefly: { name: 'Firefly', desc: 'Forest lantern, 20:00\u201302:00.', kind: 'critter' },
    critter_luna_moth: { name: 'Luna Moth', desc: 'Rare pale moth, 21:00\u201302:00.', kind: 'critter' },
    critter_dragonfly: { name: 'Dragonfly', desc: 'Lake dart, 9:00\u201317:00.', kind: 'critter' },
    critter_mayfly: { name: 'Mayfly', desc: 'Lake dusk swirl, 17:00\u201320:00.', kind: 'critter' },
    critter_sand_crab: { name: 'Sand Crab', desc: 'Beach sideways walker, 7:00\u201318:00.', kind: 'critter' },
    critter_glow_worm: { name: 'Glow Worm', desc: 'Beach night bead, 20:00\u201302:00.', kind: 'critter' },
    critter_grasshopper: { name: 'Grasshopper', desc: 'Hills jumper, 7:00\u201317:00.', kind: 'critter' },
    fish_minnow: { name: 'Minnow', desc: 'Any water, day.', kind: 'fish' },
    fish_perch: { name: 'Perch', desc: 'Lake, 8:00\u201318:00.', kind: 'fish' },
    fish_flounder: { name: 'Flounder', desc: 'Sea, 7:00\u201317:00.', kind: 'fish' },
    fish_trout: { name: 'Trout', desc: 'Lake at dusk.', kind: 'fish' },
    fish_carp: { name: 'Carp', desc: 'Lake at night.', kind: 'fish' },
    fish_moonfish: { name: 'Moonfish', desc: 'Rare night silver.', kind: 'fish' },
    mote: { name: 'Light Mote', desc: 'A willow-wisp caught mid-drift.', kind: 'treasure' },
    food_honeycomb: { name: 'Honeycomb', desc: 'Wild honey, still humming.', kind: 'food' },
    seeds_pouch: { name: 'Seed Pouch', desc: "Gideon's canvas pouch of seeds.", kind: 'key' },
    moonbell: { name: 'Moonbell', desc: 'Night forest bloom that glows.', kind: 'treasure' },
    lens_cloth: { name: 'Lens Cloth', desc: "A keeper's polishing cloth.", kind: 'key' },
    wool_cloak: { name: 'Wool Cloak', desc: 'Hill wool, rain-proof, mostly.', kind: 'key' },
    letter: { name: 'Weathered Letter', desc: 'Salt-stained, kept for years.', kind: 'key' }
  };

  /* Inventory-lite: 24 slots (distinct item kinds, §5.4 cap), each holding
     a count. */
  var MAX_KINDS = 24;
  var MAX_STACK = 99;

  /* critter table: biome · active hours (wrap allowed) */
  var CRITTERS = [
    { id: 'critter_butterfly', biome: 'meadow', from: 7, to: 17, rare: 0 },
    { id: 'critter_cricket', biome: 'meadow', from: 18, to: 23, rare: 0 },
    { id: 'critter_oak_beetle', biome: 'forest', from: 8, to: 17, rare: 0 },
    { id: 'critter_firefly', biome: 'forest', from: 20, to: 2, rare: 0 },
    { id: 'critter_luna_moth', biome: 'forest', from: 21, to: 2, rare: 0.28 },
    { id: 'critter_dragonfly', biome: 'lake', from: 9, to: 17, rare: 0 },
    { id: 'critter_mayfly', biome: 'lake', from: 17, to: 20, rare: 0 },
    { id: 'critter_sand_crab', biome: 'beach', from: 7, to: 18, rare: 0 },
    { id: 'critter_glow_worm', biome: 'beach', from: 20, to: 2, rare: 0 },
    { id: 'critter_grasshopper', biome: 'hills', from: 7, to: 17, rare: 0 }
  ];
  var CRITTER_UI_ROW = 5;   // ui.png minis, cols 0-9
  var FISH_UI_ROW = 6;      // ui.png minis, cols 0-5
  var ITEM_UI_ROW = 4;      // ui.png item icons
  var ITEM_UI_COL = {
    food_honeycomb: 0, seeds_pouch: 1, moonbell: 2, lens_cloth: 3,
    letter: 4, wool_cloak: 5, mote: 7
  };

  var FISH_DEFS = [
    { id: 'fish_minnow', biome: null, from: 7, to: 20, rare: false },
    { id: 'fish_perch', biome: 'lake', from: 8, to: 18, rare: false },
    { id: 'fish_flounder', biome: 'sea', from: 7, to: 17, rare: false },
    { id: 'fish_trout', biome: 'lake', from: 17, to: 20, rare: false },
    { id: 'fish_carp', biome: 'lake', from: 20, to: 2, rare: false },
    { id: 'fish_moonfish', biome: null, from: 21, to: 2, rare: true }
  ];

  /* gift result lines, per NPC voice (§3.1) */
  var GIFT_LINES = {
    mira: {
      loved: 'Oh \u2014 you sweet thing. This goes straight into tomorrow\u2019s bake.',
      liked: 'For me? I\u2019ll take that with tea, thank you kindly.',
      neutral: 'Well now. That\u2019s\u2026 thoughtful, dear.',
      disliked: 'Oh dear. Crickets. I\u2019ll\u2026 find them a home far away.'
    },
    gideon: {
      loved: 'Hm. Rooted in good soil, this one. It\u2019ll do well on my sill.',
      liked: 'A lantern with wings. The greenhouse approves.',
      neutral: 'Not thyme. Not harmful. Accepted.',
      disliked: 'Carp. Pond-fattened and proud of it. The compost will learn.'
    },
    rosa: {
      loved: 'When I was young I chased moths. Now they come to me \u2014 you see?',
      liked: 'Honeycomb! The ducks will be jealous and I will not care.',
      neutral: 'How whimsical. It goes on the windowsill of honour.',
      disliked: 'A flounder? Darling, I taught for forty years. I know a flat disappointment.'
    },
    marlow: {
      loved: 'A glow-worm. Small light, kept going. Aye \u2014 that\u2019s the whole trade.',
      liked: 'Moonfish by night. The lamp used to call them little moons.',
      neutral: 'Kind of you. I\u2019ve no room to dislike anything, these days.',
      disliked: ''
    },
    finn: {
      loved: 'A FISH?! Best. Gift. EVER. It\u2019s going on the crew flag!',
      liked: 'A dragonfly! It\u2019s like a tiny kite with opinions!',
      neutral: 'Ooh. Shiny-ish. Officially cargo now.',
      disliked: 'Honeycomb? Sticky paws, no thanks \u2014 you hold it, I\u2019ll supervise.'
    },
    hana: {
      loved: 'A sand crab. Reliable. Carries its house. I respect that.',
      liked: 'A light mote. Inventory: one small star. Filed.',
      neutral: 'Noted, logged, appreciated. Mostly logged.',
      disliked: 'Mayflies. They cluster. Like rumors. Take them back outside.'
    },
    bramble: {
      loved: 'Hm. Grasshopper. Fourteen legs of patience. Good gift.',
      liked: 'Hill wool would like you. This helps.',
      neutral: 'Hm. Accepted.',
      disliked: 'Oak beetle. Bites wool. The flock votes no.'
    },
    junie: {
      loved: 'A firefly \u2014 that\u2019s the exact green I could never mix. Thank you.',
      liked: 'Oh. A little colour that agreed to be carried.',
      neutral: 'That sky is a held breath. So is this. Thank you.',
      disliked: ''
    }
  };
  var AGAIN_LINES = {
    mira: 'One gift a day from you is plenty, dear \u2014 save some kindness.',
    gideon: 'One offering a day. Even bees ration the pollen.',
    rosa: 'Twice in one day? When I was young we called that showing off.',
    marlow: 'You\u2019ve given enough today. So have the tides.',
    finn: 'Whoa, two? My pockets \u2014 I mean YOUR pockets \u2014 have limits!',
    hana: 'Daily limit reached. Restocking tomorrow.',
    bramble: 'Hm. Once a day. Good number.',
    junie: 'One is a gift. Two is a collection. Tomorrow, maybe.'
  };
  /* friendship per gift tier — DESIGN.md §3 table */
  var TIER_HEARTS = { loved: 2, liked: 1, neutral: 0.5, disliked: -0.5 };

  /* ---- module state ---- */
  var inventory = {};     // { itemKey: count }, ≤ MAX_KINDS distinct
  var critters = [];      // {id, def, x, y, wx, wy, wt, seed} — alive cap 40
  var motes = [];         // {x, y, seed} — alive cap 12
  var projs = [];         // slingshot pebbles in flight — cap 8
  var swingT = 0;
  var spawnT = 1, moteT = 2;
  var lastEnv = null;
  var aim = null;         // {x,y} world point under cursor (set by main)
  var giftDay = {};       // npcId -> day stamp of last full-effect gift

  /* fishing FSM */
  var fish = {
    state: 'idle',        // idle | wait | bite | reel
    t: 0, reelT: 0, biteT: 0,
    bx: 0, by: 0,         // bobber
    marker: 0, markerT: 0, bandPos: 0.4, bandW: 0.3,
    fishId: null
  };

  /* reset clears in place: main.js holds WAction.inventory / WAction.giftDay
     by reference for save + load, so those object identities must never change */
  function reset() {
    var k;
    for (k in inventory) if (inventory.hasOwnProperty(k)) delete inventory[k];
    for (k in giftDay) if (giftDay.hasOwnProperty(k)) delete giftDay[k];
    critters.length = 0;
    motes.length = 0;
    projs.length = 0;
    swingT = 0;
    fish.state = 'idle';
  }

  function kindCount() {
    var n = 0, k;
    for (k in inventory) if (inventory.hasOwnProperty(k)) n++;
    return n;
  }

  /* ---- inventory (single funnel for gains; every add announces itself) ---- */
  function add(key, n) {
    n = n || 1;
    if (!ITEMS[key] || !window.WHUD) return false;
    if (!inventory[key]) {
      if (kindCount() >= MAX_KINDS) {
        WHUD.toast('Your pouch is full \u2014 24 kinds at most.');
        return false;
      }
      inventory[key] = 0;
    }
    inventory[key] = Math.min(MAX_STACK, inventory[key] + n);
    WHUD.toast('Received: ' + ITEMS[key].name + ' \u00d7' + inventory[key]);
    return true;
  }

  function count(key) { return inventory[key] || 0; }

  function remove(key, n) {
    n = n || 1;
    if (!inventory[key] || inventory[key] < n) return false;
    inventory[key] -= n;
    if (inventory[key] <= 0) delete inventory[key];
    return true;
  }

  function setInventory(inv) {
    var k;
    for (k in inventory) if (inventory.hasOwnProperty(k)) delete inventory[k];
    if (!inv) return;
    for (k in inv) {
      if (inv.hasOwnProperty(k) && ITEMS[k] && typeof inv[k] === 'number' &&
          inv[k] > 0 && kindCount() < MAX_KINDS) {
        inventory[k] = Math.min(MAX_STACK, Math.floor(inv[k]));
      }
    }
  }

  /* sorted key list for the gift picker and the bag */
  function list() {
    var out = [];
    for (var k in inventory) if (inventory.hasOwnProperty(k)) out.push(k);
    out.sort();
    return out;
  }

  /* ---- hour window (wrap-safe) ---- */
  function inWindow(h, from, to) {
    return from <= to ? (h >= from && h < to) : (h >= from || h < to);
  }

  /* ---- critter field: spawn ring 6\u201314 tiles, matching biome + hour ---- */
  function matchingDefs(biome, h) {
    var out = [];
    for (var i = 0; i < CRITTERS.length; i++) {
      var c = CRITTERS[i];
      if (c.biome === biome && inWindow(h, c.from, c.to)) out.push(c);
    }
    return out;
  }

  function spawnCritter(px, py, env) {
    var h = WU.hnorm(env.hour);
    var ang = WU.rand(0, WU.TAU);
    var d = WU.rand(192, 448);                    // ring 6-14 tiles
    var x = px + Math.cos(ang) * d, y = py + Math.sin(ang) * d;
    var biome = WWorld.biomeAt((x / WWorld.TILE) | 0, (y / WWorld.TILE) | 0);
    var defs = matchingDefs(biome, h);
    if (!defs.length) return;
    var def = WU.pick(defs);
    if (def.rare && !WU.chance(def.rare)) return;   // rare = its own pass rate
    if (WWorld.solidAt(x, y) || WWorld.waterAt(x, y)) return;
    if (critters.length >= 40) return;            // alive cap (§12)
    critters.push({
      id: def.id, def: def, x: x, y: y,
      wx: x, wy: y, wt: WU.rand(1, 3),
      seed: WU.rand(0, 6.283)
    });
  }

  function critterWalkable(c, x, y) {
    return !WWorld.solidAt(x, y - 4) && !WWorld.solidAt(x, y + 4) &&
           !WWorld.solidAt(x - 4, y) && !WWorld.solidAt(x + 4, y) &&
           !WWorld.waterAt(x, y);
  }

  function startle(c) {
    c.wt = WU.rand(1.2, 2.4);
    var px = lastEnv && lastEnv.player ? lastEnv.player.x : c.x - 40;
    var py = lastEnv && lastEnv.player ? lastEnv.player.y : c.y;
    var ang = Math.atan2(c.y - py, c.x - px);
    c.wx = c.x + Math.cos(ang) * 90;
    c.wy = c.y + Math.sin(ang) * 90;
  }

  function updateCritters(dt, player, env) {
    spawnT -= dt;
    var rainHalf = env.weather === 'rain' ? 2 : 1;   // rain halves spawns (§5.4)
    if (spawnT <= 0) {
      spawnT = WU.rand(1.1, 2.2) * rainHalf;
      spawnCritter(player.x, player.y, env);
    }
    for (var i = critters.length - 1; i >= 0; i--) {
      var c = critters[i];
      var dp = WU.dist(c.x, c.y, player.x, player.y);
      if (dp > 640) { critters.splice(i, 1); continue; }   // despawn > 20 tiles
      var speed, tx, ty;
      if (dp < 60) {                                        // soft flee, player wins
        speed = 60;
        var ang = Math.atan2(c.y - player.y, c.x - player.x);
        tx = c.x + Math.cos(ang) * 60;
        ty = c.y + Math.sin(ang) * 60;
      } else {
        c.wt -= dt;
        if (c.wt <= 0) {
          c.wt = WU.rand(1.5, 3.5);
          c.wx = c.x + WU.rand(-40, 40);
          c.wy = c.y + WU.rand(-40, 40);
        }
        speed = 20;
        tx = c.wx; ty = c.wy;
      }
      var dx = tx - c.x, dy = ty - c.y;
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > 2) {
        var nx = c.x + dx / dd * speed * dt;
        var ny = c.y + dy / dd * speed * dt;
        if (critterWalkable(c, nx, c.y)) c.x = nx;
        if (critterWalkable(c, c.x, ny)) c.y = ny;
      }
    }
  }

  function nearestOf(arr, px, py, r) {
    var best = null, bestD = r;
    for (var i = 0; i < arr.length; i++) {
      var d = WU.dist(px, py, arr[i].x, arr[i].y);
      if (d <= bestD) { bestD = d; best = arr[i]; }
    }
    return best;
  }

  function nearestCritter(px, py, r) { return nearestOf(critters, px, py, r); }
  function nearestMote(px, py, r) { return nearestOf(motes, px, py, r); }

  /* E on a critter or mote: gentle hand catch */
  function nearestCatchable(px, py, r) {
    var c = nearestCritter(px, py, r);
    var m = nearestMote(px, py, r);
    if (c && (!m || WU.dist(px, py, c.x, c.y) <= WU.dist(px, py, m.x, m.y))) {
      return { kind: 'critter', obj: c, x: c.x, y: c.y, label: 'Catch ' + ITEMS[c.id].name };
    }
    if (m) return { kind: 'mote', obj: m, x: m.x, y: m.y, label: 'Gather light' };
    return null;
  }

  function catchCritter(c) {
    var i = critters.indexOf(c);
    if (i < 0) return false;
    if (!add(c.id, 1)) return false;   // pouch full: the critter stays alive
    critters.splice(i, 1);
    burst(c.x, c.y - 8, 'sparkle', 7);
    WAudio.sfx('catch');
    return true;
  }

  /* ---- motes (§5.3, alive cap 12) ---- */
  function updateMotes(dt, player, env) {
    moteT -= dt;
    if (moteT <= 0) {
      moteT = WU.rand(2.5, 5);
      if (motes.length < 12) {
        var x, y, ok = false;
        var torches = (window.WWorld && WWorld.torches) || [];
        if (torches.length && WU.chance(0.5)) {
          var t = WU.pick(torches);
          x = t.x + WU.rand(-60, 60); y = t.y + WU.rand(-30, 40);
          ok = WU.dist(x, y, player.x, player.y) < 640;
        } else {
          var ang = WU.rand(0, WU.TAU), d = WU.rand(120, 420);
          x = player.x + Math.cos(ang) * d;
          y = player.y + Math.sin(ang) * d;
          var biome = WWorld.biomeAt((x / WWorld.TILE) | 0, (y / WWorld.TILE) | 0);
          ok = biome === 'forest' || biome === 'meadow';
        }
        if (ok && !WWorld.solidAt(x, y)) motes.push({ x: x, y: y, seed: WU.rand(0, 6.283) });
      }
    }
    for (var i = motes.length - 1; i >= 0; i--) {
      if (WU.dist(motes[i].x, motes[i].y, player.x, player.y) > 760) motes.splice(i, 1);
    }
  }

  function popMote(m) {
    var i = motes.indexOf(m);
    if (i < 0) return false;
    if (!add('mote', 1)) return false;   // pouch full: the mote keeps drifting
    motes.splice(i, 1);
    burst(m.x, m.y, 'sparkle', 8);
    WAudio.sfx('chime');
    return true;
  }

  /* ---- particles helper ---- */
  function burst(x, y, type, n) {
    var P = window.WParticles;
    if (!P) return;
    for (var i = 0; i < n; i++) {
      P.emit(type, x + WU.rand(-8, 8), y + WU.rand(-8, 8), {
        vx: WU.rand(-30, 30), vy: WU.rand(-50, -10), life: WU.rand(0.4, 0.8)
      });
    }
  }

  /* ---- net (§5.1): Q swings a round hitbox, radius 28, ahead of the facing
     direction; anything inside is caught instantly (cozy: no escape) ---- */
  var DIRV = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
  var NET_R = 28;          // hitbox radius (px)
  var NET_PUSH = 10;       // hitbox centre pushed toward the facing side

  function tryNet(player) {
    swingT = 0.22;
    WAudio.sfx('net');
    var v = DIRV[player.dir] || DIRV.down;
    var cx = player.x + v[0] * NET_PUSH;
    var cy = player.y - 6 + v[1] * NET_PUSH;
    var caught = 0;
    for (var i = critters.length - 1; i >= 0; i--) {
      var c = critters[i];
      if (WU.dist(cx, cy, c.x, c.y - 4) <= NET_R + 6) {   // +6 = critter body
        if (!add(c.id, 1)) continue;   // pouch full: this one stays loose
        critters.splice(i, 1);
        caught++;
        burst(c.x, c.y - 8, 'sparkle', 6);
      }
    }
    if (caught) WAudio.sfx('catch');
  }

  /* ---- fishing (§5.2): stage 1 bite, stage 2 timing bar ---- */
  function pickFish(biome, h) {
    var q = [], i, f;
    for (i = 0; i < FISH_DEFS.length; i++) {
      f = FISH_DEFS[i];
      if (inWindow(h, f.from, f.to) && (f.biome === null || f.biome === biome)) q.push(f);
    }
    if (!q.length) return 'fish_minnow';
    for (i = 0; i < q.length; i++) {
      if (q[i].rare && WU.chance(0.25)) return q[i].id;
    }
    var others = [];
    for (i = 0; i < q.length; i++) if (!q[i].rare) others.push(q[i].id);
    return others.length ? WU.pick(others) : q[0].id;
  }

  function tryFish(player, world) {
    switch (fish.state) {
      case 'idle': {
        var v = DIRV[player.dir] || DIRV.down;
        var fx = player.x + v[0] * 40, fy = player.y + v[1] * 40;
        if (!world.waterAt(fx, fy)) {
          if (window.WHUD) WHUD.toast('Face open water to cast.');
          return;
        }
        var tx = ((fx / world.TILE) | 0) * world.TILE + world.TILE / 2;
        var ty = ((fy / world.TILE) | 0) * world.TILE + world.TILE / 2;
        fish.bx = tx; fish.by = ty;
        fish.state = 'wait';
        fish.t = WU.rand(2, 6);
        WAudio.sfx('plop');
        if (window.WParticles) WParticles.emit('ripple', tx, ty, {});
        break;
      }
      case 'wait': // early reel-in
        fish.state = 'idle';
        if (window.WParticles) WParticles.emit('splash', fish.bx, fish.by, { vy: -60 });
        break;
      case 'bite': // stage 2: hook in time
        fish.state = 'reel';
        fish.reelT = 0;
        fish.markerT = 0;
        fish.fishId = pickFish(
          world.biomeAt((fish.bx / world.TILE) | 0, (fish.by / world.TILE) | 0),
          lastEnv ? WU.hnorm(lastEnv.hour) : 12);
        fish.bandW = fish.fishId === 'fish_moonfish' ? 0.18 : 0.30;
        fish.bandPos = WU.rand(0.08, 0.92 - fish.bandW);
        WAudio.sfx('reel');
        break;
      case 'reel': {
        var hit = fish.marker >= fish.bandPos && fish.marker <= fish.bandPos + fish.bandW;
        if (hit) {
          if (add(fish.fishId, 1)) {
            burst(fish.bx, fish.by, 'splash', 6);
            burst(player.x, player.y - 30, 'sparkle', 8);
            WAudio.sfx('catch');
            if (window.WStory && WStory.QUESTS.big_one &&
                WStory.QUESTS.big_one.state === 'active') {
              WStory.setFlag('siltjaw_caught', 1);
            }
          }
        } else {
          if (window.WHUD) WHUD.toast('It got away\u2026');
          WAudio.sfx('splash');
        }
        fish.state = 'idle';
        break;
      }
    }
  }

  function updateFish(dt) {
    if (fish.state === 'wait') {
      fish.t -= dt;
      if (fish.t <= 0) {
        fish.state = 'bite';
        fish.biteT = 0.9;
        WAudio.sfx('bite');
        if (window.WParticles) WParticles.emit('splash', fish.bx, fish.by, { vy: -70 });
      }
    } else if (fish.state === 'bite') {
      fish.biteT -= dt;
      if (fish.biteT <= 0) {
        fish.state = 'idle';
        if (window.WHUD) WHUD.toast('It slipped away quietly.');
      }
    } else if (fish.state === 'reel') {
      fish.reelT += dt;
      fish.markerT += dt;
      fish.marker = 0.5 + 0.5 * Math.sin(fish.markerT * WU.TAU * 1.2);  // 1.2 Hz
      if (fish.reelT > 2.5) {
        fish.state = 'idle';
        if (window.WHUD) WHUD.toast('The line went slack. It got away\u2026');
        WAudio.sfx('splash');
      }
    }
  }

  /* ---- slingshot (§5.3): pebbles fly straight at 240 px/s; limit 1 in flight ---- */
  var MAX_PROJS = 1;
  var PROJ_SPEED = 240;

  function trySling(tx, ty, player) {
    if (projs.length >= MAX_PROJS) return;
    var dx = tx - player.x, dy = ty - (player.y - 20);
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 4) return;
    projs.push({
      x: player.x, y: player.y - 20,
      vx: dx / d * PROJ_SPEED, vy: dy / d * PROJ_SPEED
    });
    WAudio.sfx('click');
  }

  function updateProjs(dt) {
    if (!projs.length) return;
    var steps = 2;
    var px = lastEnv && lastEnv.player ? lastEnv.player.x : -9999;
    var py = lastEnv && lastEnv.player ? lastEnv.player.y : -9999;
    for (var i = projs.length - 1; i >= 0; i--) {
      var p = projs[i];
      for (var s = 0; s < steps && p; s++) {
        p.x += p.vx * dt / steps;
        p.y += p.vy * dt / steps;
        var j, m2;
        for (j = motes.length - 1; j >= 0; j--) {
          m2 = motes[j];
          if (WU.dist(p.x, p.y, m2.x, m2.y) < 12) {
            projs.splice(i, 1);
            p = null;
            popMote(m2);
            break;
          }
        }
        if (!p) break;
        for (j = 0; j < critters.length; j++) {
          if (WU.dist(p.x, p.y, critters[j].x, critters[j].y) < 14) {
            startle(critters[j]);                // critters are never harmed
            projs.splice(i, 1);
            p = null;
            break;
          }
        }
        if (!p) break;
        if (WWorld.solidAt(p.x, p.y)) {
          /* tree shake: leaf burst, occasionally an idle critter drops out */
          burst(p.x, p.y, 'leaf', 6);
          if (WU.chance(0.35)) {
            var biome = WWorld.biomeAt((p.x / WWorld.TILE) | 0, (p.y / WWorld.TILE) | 0);
            var h = lastEnv ? WU.hnorm(lastEnv.hour) : 12;
            var defs = matchingDefs(biome, h);
            if (defs.length && critters.length < 40) {
              var def = WU.pick(defs);
              if (!def.rare || WU.chance(def.rare)) {   // same rare gate as spawnCritter
                critters.push({
                  id: def.id, def: def,
                  x: p.x, y: p.y + 4, wx: p.x, wy: p.y + 4,
                  wt: 2, seed: WU.rand(0, 6.283)
                });
              }
            }
          }
          projs.splice(i, 1);
          p = null;
          break;
        }
        if (WU.dist(p.x, p.y, px, py) > 320) {
          projs.splice(i, 1);
          p = null;
        }
      }
    }
  }

  /* ---- gifts (§5.4): removes the item, moves hearts per the §3 tables;
     one full-effect gift per NPC per day (flag stamp gift_<npc>_<day>) ---- */
  function gift(npcId, itemKey) {
    var def = null, pos = null;
    if (window.WNpcs) {
      var inst = WNpcs.byId(npcId);
      if (inst) { def = inst.def; pos = inst; }
    }
    if (!ITEMS[itemKey] || count(itemKey) <= 0) {
      return { line: 'You reach for it, but your pouch is empty.', delta: 0, tier: 'none' };
    }
    var env = lastEnv || { day: 1 };
    var day = env.day || 1;
    var again = giftDay[npcId] === day;
    var tier = 'neutral';
    if (def) {
      var kind = ITEMS[itemKey].kind;
      if (def.loved.indexOf(itemKey) >= 0) tier = 'loved';
      else if (def.liked.indexOf(itemKey) >= 0 ||
               (def.liked.indexOf('critter_any') >= 0 && kind === 'critter') ||
               (def.liked.indexOf('fish_any') >= 0 && kind === 'fish')) tier = 'liked';
      else if (def.disliked.indexOf(itemKey) >= 0) tier = 'disliked';
    }
    var delta = TIER_HEARTS[tier];
    var line;
    if (again) {
      delta = 0;
      line = AGAIN_LINES[npcId] || 'One gift a day \u2014 it keeps the giving kind.';
    } else {
      giftDay[npcId] = day;
      var pool = (GIFT_LINES[npcId] && GIFT_LINES[npcId][tier]) || '';
      line = pool || 'Thank you, Warden.';
    }
    remove(itemKey, 1);                          // the gift leaves the pouch
    if (window.WNpcs) WNpcs.addFriend(npcId, delta);
    /* DESIGN §5.4: a luna moth for Gideon opens seeds_of_spring early */
    if (npcId === 'gideon' && itemKey === 'critter_luna_moth' && window.WStory &&
        WStory.QUESTS.seeds_of_spring) {
      var sq = WStory.QUESTS.seeds_of_spring.state;
      if (sq === 'locked' || sq === 'available') WStory.setFlag('seeds_asked', true);
    }
    if (pos && delta > 0 && window.WParticles) {
      WParticles.emit('heart', pos.x, pos.y - 46, {});
    }
    WAudio.sfx(delta >= 1 ? 'gift' : 'heart');
    return { line: line, delta: delta, tier: tier };
  }

  /* ---- per-frame update ---- */
  function update(dt, player, env) {
    lastEnv = env;
    if (!env.frozen) {
      updateCritters(dt, player, env);
      updateMotes(dt, player, env);
    }
    updateFish(dt);
    if (swingT > 0) swingT -= dt;
    if (!env.frozen) updateProjs(dt);
  }

  /* ---- drawing ---- */

  function drawCritter(ctx, c) {
    var idx = -1, i;
    for (i = 0; i < CRITTERS.length; i++) if (CRITTERS[i].id === c.id) { idx = i; break; }
    var bob = Math.sin(c.seed + (lastEnv ? lastEnv.hour * 60 : 0)) * 1.5;
    if (window.WAssets && WAssets.has('ui') && idx >= 0) {
      WAssets.sheet(ctx, 'ui', idx * 16, CRITTER_UI_ROW * 16, 16, 16,
        c.x - 8, c.y - 16 + bob, 16, 16);
      return;
    }
    /* vector fallback: small body, type-tinted */
    var colors = {
      critter_butterfly: '#f2b6c6', critter_cricket: '#6b6b3a',
      critter_oak_beetle: '#5c4a2f', critter_firefly: '#d8f27a',
      critter_luna_moth: '#bfe8d8', critter_dragonfly: '#7ec8e0',
      critter_mayfly: '#d8d0b0', critter_sand_crab: '#e0a070',
      critter_glow_worm: '#c8e86a', critter_grasshopper: '#8fb05a'
    };
    var col = colors[c.id] || '#d8d8b0';
    if (c.id === 'critter_firefly' || c.id === 'critter_glow_worm') {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(c.seed * 3);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(c.x, c.y - 6 + bob, 5, 0, WU.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 6 + bob, 3.5, 2.5, 0, 0, WU.TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(c.x - 2.5, c.y - 9.5 + bob, 2, 1.5);
    ctx.fillRect(c.x + 0.5, c.y - 9.5 + bob, 2, 1.5);
  }

  function drawUnder(ctx, cam, player) {
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    var i;
    for (i = 0; i < motes.length; i++) {
      var m = motes[i];
      var pu = 0.6 + 0.4 * Math.sin(m.seed + (lastEnv ? lastEnv.hour * 40 : 0));
      ctx.globalAlpha = 0.22 * pu;
      ctx.fillStyle = 'rgba(150,235,255,1)';
      ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, WU.TAU); ctx.fill();
      ctx.globalAlpha = 0.9 * pu;
      ctx.fillStyle = 'rgba(226,250,255,1)';
      ctx.beginPath(); ctx.arc(m.x, m.y, 2.6, 0, WU.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (i = 0; i < critters.length; i++) drawCritter(ctx, critters[i]);
    /* bobber + line while fishing */
    if (fish.state !== 'idle') {
      ctx.strokeStyle = 'rgba(240,240,230,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - 24);
      ctx.lineTo(fish.bx, fish.by - 3);
      ctx.stroke();
      ctx.fillStyle = '#d84838';
      ctx.beginPath(); ctx.arc(fish.bx, fish.by - 3, 3, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = '#f4f0e4';
      ctx.beginPath(); ctx.arc(fish.bx, fish.by - 5, 2, 0, WU.TAU); ctx.fill();
    }
    /* pebbles in flight */
    ctx.fillStyle = '#9b958b';
    for (i = 0; i < projs.length; i++) {
      ctx.beginPath(); ctx.arc(projs[i].x, projs[i].y, 2.5, 0, WU.TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawOver(ctx, cam, player) {
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    /* net swing arc */
    if (swingT > 0) {
      var v = DIRV[player.dir] || DIRV.down;
      var base = Math.atan2(v[1], v[0]);
      var t = 1 - swingT / 0.22;
      ctx.strokeStyle = 'rgba(250,246,230,' + (0.75 * (1 - t) + 0.15).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y - 12, 28, base - Math.PI / 4, base + Math.PI / 4);
      ctx.stroke();
    }
    /* "!" bite marker */
    if (fish.state === 'bite') {
      var bob = Math.sin(performance.now() * 0.02) * 3;
      ctx.font = 'bold 18px "Segoe UI",Verdana,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(30,26,20,0.85)';
      ctx.fillText('!', fish.bx + 1, fish.by - 16 + bob + 1);
      ctx.fillStyle = '#ffd24a';
      ctx.fillText('!', fish.bx, fish.by - 16 + bob);
    }
    /* timing bar (stage 2) */
    if (fish.state === 'reel') {
      var bw = 130, bx = player.x - bw / 2, by = player.y - 64;
      ctx.fillStyle = 'rgba(20,24,30,0.8)';
      ctx.fillRect(bx - 3, by - 3, bw + 6, 14);
      ctx.fillStyle = '#3a4250';
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = '#5fae62';
      ctx.fillRect(bx + fish.bandPos * bw, by, fish.bandW * bw, 8);
      ctx.fillStyle = '#f4e8c0';
      ctx.fillRect(bx + fish.marker * bw - 1, by - 3, 3, 14);
    }
    /* sling aim dots */
    if (aim && projs.length < MAX_PROJS) {
      var dx = aim.x - player.x, dy = aim.y - (player.y - 20);
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (var k = 1; k <= 4; k++) {
        var t2 = k / 4;
        ctx.fillRect(player.x + dx * t2 - 1, player.y - 20 + dy * t2 - 1, 2, 2);
      }
    }
    ctx.restore();
  }

  /* E-interaction on whatever nearestCatchable returned */
  function collect(c) {
    if (!c) return false;
    if (c.kind === 'mote') { popMote(c.obj); return true; }
    if (c.kind === 'critter') return catchCritter(c.obj);
    return false;
  }

  return {
    ITEMS: ITEMS,
    ITEM_UI_COL: ITEM_UI_COL,
    inventory: inventory,
    giftDay: giftDay,
    reset: reset,
    add: add,
    count: count,
    remove: remove,
    setInventory: setInventory,
    list: list,
    nearestCritter: nearestCritter,
    nearestMote: nearestMote,
    nearestCatchable: nearestCatchable,
    catchByHand: catchCritter,
    collect: collect,
    tryNet: tryNet,
    tryFish: tryFish,
    trySling: trySling,
    gift: gift,
    setAim: function (a) { aim = a; },
    fishState: function () { return fish.state; },
    update: update,
    drawUnder: drawUnder,
    drawOver: drawOver
  };
})();
