/* Willowmere — npcs.js · window.WNpcs
   The eight villagers (DESIGN.md §3):
   - Real schedule movement: BFS path over the tile grid to the hour's POI,
     waypoint following at 42 px/s, wander (<=36 px) around the current POI,
     idle 2-4 s on arrival, rain shelter override 9:00-17:00.
   - Friendship 0-10 with toast + heart particles.
   - 8 scripted ambient NPC<->NPC conversations: eligibility (pair POI within
     3 tiles + hour window + requires) feeds a FIFO start queue (the player
     interaction / conversation queue), max 2 live sessions, 6 s per line,
     90 s pair cooldown. Speech bubbles above the current speaker on both
     sides as the lines alternate; within 5 tiles of the pair POI the current
     line also renders full-length in an "overheard" panel.
   NOTE on schedules: DESIGN §3.1 beats are restored in DEFS below; where a
   §3.3 pair window and a §3.1 beat could not both hold (the map is crossed
   at real-time 42 px/s, ~2-3 h between distant POIs), the pair window was
   re-pinned to where the beats actually overlap — see the PAIRS note.
   Bodies are drawn by main's y-sort pass, so drawBody/drawChar take the
   CURRENT camera (same frame as the world pass) — an omitted cam falls back
   to the cached one from draw(). */
window.WNpcs = (function () {
  'use strict';

  /* ---- character defs (§3.1 shape) ---- */
  var DEFS = [
    {
      id: 'mira', name: 'Mira Thistle', role: 'baker', homePoi: 'bakery_door',
      spriteRow: 1, voice: 'mira', speed: 42,
      schedule: [
        { from: 5, to: 7.5, poi: 'bakery_oven' },
        { from: 7.5, to: 11, poi: 'bakery_counter' },
        { from: 11, to: 13, poi: 'green_well' },
        { from: 13, to: 17, poi: 'bakery_counter' },
        { from: 17, to: 19.5, poi: 'dock' },
        { from: 19.5, to: 24, poi: 'bakery_door' }
      ],
      rainPoi: 'bakery_counter',
      loved: ['critter_butterfly', 'food_honeycomb'],
      liked: ['fish_moonfish', 'mote'],
      disliked: ['critter_cricket'],
      unlock3: 'mira_3hearts', unlock6: 'mira_6hearts',
      greetings: { morning: 'mira_am', day: 'mira_day', evening: 'mira_pm' }
    },
    {
      id: 'gideon', name: 'Gideon Root', role: 'herbalist', homePoi: 'greenhouse_door',
      spriteRow: 2, voice: 'gideon', speed: 42,
      schedule: [
        { from: 6, to: 9, poi: 'forest_hives' },
        { from: 9, to: 11.5, poi: 'greenhouse' },
        { from: 11.5, to: 13.5, poi: 'green_well' },
        { from: 13.5, to: 18.5, poi: 'greenhouse' },
        { from: 18.5, to: 20.5, poi: 'green_bench' },
        { from: 20.5, to: 24, poi: 'greenhouse_door' }
      ],
      rainPoi: 'greenhouse',
      loved: ['critter_oak_beetle', 'critter_luna_moth'],
      liked: ['critter_firefly'],
      disliked: ['fish_carp'],
      unlock3: 'gideon_3hearts', unlock6: 'gideon_6hearts',
      greetings: { morning: 'gideon_am', day: 'gideon_day', evening: 'gideon_pm' }
    },
    {
      id: 'rosa', name: 'Rosa Quill', role: 'retired teacher', homePoi: 'rosa_door',
      spriteRow: 3, voice: 'rosa', speed: 42,
      /* §3.1: 7-9 garden · 9-12 pier · 12-14 nap · 14-17 bench · 17-19 green ·
         19+ home. Bench ends 30 min early so the Junie/Rosa palette pair
         (am_colors) still overlaps on the green; Rosa's bench->green walk
         takes ~0.6 h, so the pair fires from ~17.6. */
      schedule: [
        { from: 0, to: 7, poi: 'rosa_door' },
        { from: 7, to: 9, poi: 'garden' },
        { from: 9, to: 12.5, poi: 'pier' },
        { from: 12.5, to: 14, poi: 'rosa_door' },
        { from: 14, to: 16.5, poi: 'garden_bench' },
        { from: 16.5, to: 20.5, poi: 'green_well' },
        { from: 20.5, to: 24, poi: 'rosa_door' }
      ],
      rainPoi: 'rosa_door',
      loved: ['critter_luna_moth', 'critter_cricket'],
      liked: ['food_honeycomb'],
      disliked: ['fish_flounder'],
      unlock3: 'rosa_3hearts', unlock6: 'rosa_6hearts',
      greetings: { morning: 'rosa_am', day: 'rosa_day', evening: 'rosa_pm' }
    },
    {
      id: 'marlow', name: 'Old Marlow', role: 'former keeper', homePoi: 'marlow_hut_door',
      spriteRow: 4, voice: 'marlow', speed: 42,
      /* §3.1: 5-8 tide pools · 8-11 hut · 11-15 driftwood loop · 15-18 hut ·
         18-21 lighthouse base · 21+ hut. The engine walks at real-time
         42 px/s (hut -> beach = ~3.2 h), so the tide-pool commute is packed
         into 2-5 and he stands the whole §3.1 5-8 beat. Lighthouse runs to
         21.5 so Finn's evening visit overlaps it (pair am_lamp). */
      schedule: [
        { from: 0, to: 2, poi: 'hut' },
        { from: 2, to: 5, poi: 'tide_pools' },
        { from: 5, to: 8, poi: 'tide_pools' },
        { from: 8, to: 11, poi: 'hut' },
        { from: 11, to: 13, poi: 'driftwood_1' },
        { from: 13, to: 15, poi: 'driftwood_2' },
        { from: 15, to: 18, poi: 'hut' },
        { from: 18, to: 21.5, poi: 'lighthouse_base' },
        { from: 21.5, to: 24, poi: 'hut' }
      ],
      rainPoi: null,
      loved: ['critter_glow_worm', 'fish_moonfish'],
      liked: ['mote'],
      disliked: [],
      unlock3: 'marlow_3hearts', unlock6: 'marlow_6hearts',
      greetings: { morning: 'marlow_am', day: 'marlow_day', evening: 'marlow_pm' }
    },
    {
      id: 'finn', name: 'Finn Marlow', role: 'grandson', homePoi: 'finn_door',
      spriteRow: 5, voice: 'finn', speed: 42,
      /* §3.1 beats restored: dawn pier (with the Rosa duck-lunch pair),
         forest scout loop, beach tide pools, green games, a wait for
         grandpa at the tower, home late evening. Long walks are absorbed by
         the beat windows (pier -> scout trail alone is ~1.7 h). */
      schedule: [
        { from: 0, to: 5.5, poi: 'finn_door' },
        { from: 5.5, to: 12, poi: 'pier' },
        { from: 12, to: 14, poi: 'scout_trail_1' },
        { from: 14, to: 17, poi: 'tide_pools' },
        { from: 17, to: 19.5, poi: 'green_games' },
        { from: 19.5, to: 21, poi: 'lighthouse_base' },
        { from: 21, to: 24, poi: 'finn_door' }
      ],
      rainPoi: null,
      loved: ['fish_any', 'critter_dragonfly'],
      liked: ['critter_sand_crab'],
      disliked: ['food_honeycomb'],
      unlock3: 'finn_3hearts', unlock6: 'finn_6hearts',
      greetings: { morning: 'finn_am', day: 'finn_day', evening: 'finn_pm' }
    },
    {
      id: 'hana', name: 'Hana Oak', role: 'shopkeeper', homePoi: 'shop_door',
      spriteRow: 6, voice: 'hana', speed: 42,
      /* §3.1: the 7-8 mail round walks past the front doors again (east
         cottages -> the Warden's cottage), ending at the bakery ~08:30,
         where the parcels-vs-pastries pair (am_post) fires. */
      schedule: [
        { from: 0, to: 7, poi: 'shop_door' },
        { from: 7, to: 7.5, poi: 'cottageC_door' },
        { from: 7.5, to: 8.1, poi: 'cottageA_door' },
        { from: 8.1, to: 8.5, poi: 'player_door' },
        { from: 8.5, to: 9, poi: 'bakery_door' },
        { from: 9, to: 18, poi: 'shop_counter' },
        { from: 18, to: 21.5, poi: 'dock' },
        { from: 21.5, to: 24, poi: 'shop_door' }
      ],
      rainPoi: 'shop_counter',
      loved: ['critter_sand_crab', 'mote'],
      liked: ['fish_minnow'],
      disliked: ['critter_mayfly'],
      unlock3: 'hana_3hearts', unlock6: 'hana_6hearts',
      greetings: { morning: 'hana_am', day: 'hana_day', evening: 'hana_pm' }
    },
    {
      id: 'bramble', name: 'Bramble', role: 'shepherd', homePoi: 'bramble_hut_door',
      spriteRow: 7, voice: 'bramble', speed: 42,
      /* §3.1: 5-9 pasture walk (split across the flock POIs so the rounds
         are visible), 9-12 west overlook, 12-14 nap tree, 14-18 pasture,
         18-19 lake edge, 19+ hut. */
      schedule: [
        { from: 0, to: 5, poi: 'bramble_hut_door' },
        { from: 5, to: 6.5, poi: 'pasture_1' },
        { from: 6.5, to: 8, poi: 'pasture_3' },
        { from: 8, to: 9, poi: 'pasture_2' },
        { from: 9, to: 12, poi: 'west_overlook' },
        { from: 12, to: 14, poi: 'nap_tree' },
        { from: 14, to: 18, poi: 'pasture_2' },
        { from: 18, to: 19.5, poi: 'lake_edge' },
        { from: 19.5, to: 24, poi: 'bramble_hut_door' }
      ],
      rainPoi: null,
      loved: ['critter_grasshopper'],
      liked: ['critter_sand_crab', 'fish_perch'],
      disliked: ['critter_oak_beetle'],
      unlock3: 'bramble_3hearts', unlock6: 'bramble_6hearts',
      greetings: { morning: 'bramble_am', day: 'bramble_day', evening: 'bramble_pm' }
    },
    {
      id: 'junie', name: 'Junie Vale', role: 'painter', homePoi: 'tent_door',
      spriteRow: 8, voice: 'junie', speed: 42,
      /* §3.1 with the 18-20 sunset beat restored at the Tor: the green
         session ends 17.5 and she reaches the Tor ~20.2 (green -> Tor is
         ~2.9 h), painting the last light until 21.5. The forest light-shaft
         beat (15-18) had to give: the Tor is a full map away from the north
         forest at this engine's walk speed. */
      schedule: [
        { from: 0, to: 6, poi: 'tent_door' },
        { from: 6, to: 10, poi: 'easel' },
        { from: 10, to: 13.5, poi: 'pier' },
        { from: 13.5, to: 17.5, poi: 'green_well' },
        { from: 17.5, to: 21.5, poi: 'tor' },
        { from: 21.5, to: 24, poi: 'tent_door' }
      ],
      rainPoi: 'tent_door',
      loved: ['critter_firefly', 'mote'],
      liked: ['critter_any'],
      disliked: [],
      unlock3: 'junie_3hearts', unlock6: 'junie_6hearts',
      greetings: { morning: 'junie_am', day: 'junie_day', evening: 'junie_pm' }
    }
  ];

  /* ---- ambient pairs (§3.3). requires checked via WWorld.checkReq /
     WDialogue.checkRequires (flags · quest state · vistaMin). Windows are
     pinned to where the restored §3.1 schedules actually put both members:
     cross-map walks take 2-3 h at this engine's speed, so a pair only fires
     while BOTH schedule beats target the same POI. am_tide (Marlow+Bramble)
     has no shared geography under faithful §3.1 — his mornings are at the
     tide pools, Bramble's on the pasture — so it is kept as §3.3 data but
     does not fire; am_forecast lost its dock overlap to Finn's green games.
     am_lamp fires in the short window where both stand at the tower base. ---- */
  var PAIRS = [
    { id: 'am_honey', a: 'mira', b: 'gideon', poi: 'green_well', hour: [11, 13], requires: null, lines: [
      { sp: 'mira', text: 'Forty years, Gideon, and you still haggle over honey.' },
      { sp: 'gideon', text: 'Forty years, and it is still overpriced thistle syrup.' },
      { sp: 'mira', text: 'And yet the loaf never skips a week.' },
      { sp: 'gideon', text: 'Hm. Neither do I.' }
    ] },
    { id: 'am_ducks', a: 'finn', b: 'rosa', poi: 'pier', hour: [9.5, 13], requires: null, lines: [
      { sp: 'finn', text: 'Rosa! The big one \u2014 that is Kevin, I would bet my rod!' },
      { sp: 'rosa', text: 'When I was young, ducks never had names. Now I know six.' },
      { sp: 'finn', text: 'Kevin. Kevin. KEVIN. He remembers me, watch!' },
      { sp: 'rosa', text: 'He remembers the bread, dear. Let him.' }
    ] },
    { id: 'am_post', a: 'hana', b: 'mira', poi: 'bakery_door', hour: [8.4, 9], requires: null, lines: [
      { sp: 'hana', text: 'Three parcels, one summons, zero pastries reserved.' },
      { sp: 'mira', text: 'One parcel, and I will trade you a heel of honey loaf.' },
      { sp: 'hana', text: 'Feelings: out of stock. Carbs: overstocked. Deal.' }
    ] },
    /* kept for §3.3 fidelity; unreachable on the restored schedules (see NOTE) */
    { id: 'am_tide', a: 'marlow', b: 'bramble', poi: 'tide_pools', hour: [5, 8], requires: null, lines: [
      { sp: 'marlow', text: 'A keeper keeps. I keep meaning to say something.' },
      { sp: 'bramble', text: 'Hm. Fourteen herons this morning. Good number.' },
      { sp: 'marlow', text: 'Kettle is on, if your silence wants company.' },
      { sp: 'bramble', text: 'It does.' }
    ] },
    /* lost its overlap when Finn's §3.1 green-games beat came back */
    { id: 'am_forecast', a: 'finn', b: 'hana', poi: 'dock', hour: [19, 21], requires: null, lines: [
      { sp: 'finn', text: 'Biggest. Fog. EVER. Tomorrow. I feel it in my boots!' },
      { sp: 'hana', text: 'Forecast: clouds, with a chance of you being right once.' },
      { sp: 'finn', text: 'You will SEE. And then you will owe me a ta\u2026 a compliment.' },
      { sp: 'hana', text: 'Rain check.' }
    ] },
    { id: 'am_colors', a: 'junie', b: 'rosa', poi: 'green_well', hour: [16.9, 17.6],
      requires: { flags: ['met_junie'] }, lines: [
      { sp: 'junie', text: 'Your garden is a held breath, Rosa. A whole palette.' },
      { sp: 'rosa', text: 'When I was young I called it weeds. Age improved my eye.' },
      { sp: 'junie', text: 'Age is just a longer sketchbook.' }
    ] },
    { id: 'am_seeds_a', a: 'gideon', b: 'rosa', poi: 'green_bench', hour: [18, 20.5],
      requires: { quest: { id: 'seeds_of_spring', state: 'done_a' } }, lines: [
      { sp: 'gideon', text: 'She brought my seeds home. Early sprouts, every row.' },
      { sp: 'rosa', text: 'And you shared the cuttings back. Circle closed.' },
      { sp: 'gideon', text: 'Good soil. Good courier. Good number of sprouts: all.' }
    ] },
    { id: 'am_seeds_b', a: 'gideon', b: 'rosa', poi: 'green_bench', hour: [18, 20.5],
      requires: { quest: { id: 'seeds_of_spring', state: 'done_b' } }, lines: [
      { sp: 'gideon', text: 'Rosa\u2019s show bed came up bright as a market stall.' },
      { sp: 'rosa', text: 'Your seeds, Gideon. I only gave them a better view.' },
      { sp: 'gideon', text: 'Hm. The view argues back. Keep the bed.' }
    ] },
    { id: 'am_lamp', a: 'finn', b: 'marlow', poi: 'lighthouse_base', hour: [18, 24],
      requires: { flags: ['marlow_confession'] }, lines: [
      { sp: 'finn', text: 'Grandpa. When it lights again \u2014 can I count the flashes?' },
      { sp: 'marlow', text: 'Aye. We will count them together, every one.' },
      { sp: 'finn', text: 'Even the one that lands on the hills? ESPECIALLY that one.' }
    ] }
  ];

  /* ---- module state ---- */
  var list = [];          // live NPC instances
  var sessions = [];      // live ambient conversations
  var pend = [];          // FIFO start queue of eligible pair ids
  var queued = {};        // pairId -> in pend
  var cool = {};          // pairId -> seconds left
  var startCd = 0;        // gap between session starts
  var pathBudget = 0;     // BFS runs allowed this frame (reset in update)
  var LINE_T = 6;         // seconds per spoken line (§3.3 cycle)
  var NEAR = 96;          // 3 tiles from the pair POI
  var OVERHEAR = 160;     // 5 tiles for the full-length panel
  var MAX_SESSIONS = 2;

  var lastCam = { x: 0, y: 0 };  // cached by draw(); bodies need the pan

  function byId(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function inWindow(h, w) {
    var a = w[0], b = w[1];
    return a <= b ? (h >= a && h < b) : (h >= a || h < b);
  }

  /* ============================== INIT ============================== */

  function init() {
    list.length = 0;
    sessions.length = 0;
    pend.length = 0;
    queued = {};
    cool = {};
    startCd = 0;
    var poi = (window.WWorld && WWorld.poi) || {};
    for (var i = 0; i < DEFS.length; i++) {
      var d = DEFS[i];
      var p = poi[d.homePoi] || { x: 1000, y: 1500 };
      list.push({
        id: d.id, def: d,
        x: p.x, y: p.y,
        anchorName: d.homePoi, anchor: p,
        mode: 'idle', idleT: WU.rand(0.5, 2.5),
        wx: p.x, wy: p.y,            // wander target
        path: null, pi: 0,           // BFS waypoints
        stuckT: 0, repathCd: 0, lastX: p.x, lastY: p.y,
        dir: 'down', walkT: 0, moving: false,
        hearts: 0, bubble: null
      });
    }
  }

  /* ============================== MOVEMENT ============================== */

  function schedulePoi(def, h) {
    for (var i = 0; i < def.schedule.length; i++) {
      var s = def.schedule[i];
      if (h >= s.from && h < s.to) return s.poi;
    }
    return def.schedule.length ? def.schedule[def.schedule.length - 1].poi : null;
  }

  function walkable(px, py) {
    if (!window.WWorld) return true;
    return !WWorld.solidAt(px - 7, py - 3) && !WWorld.solidAt(px + 7, py - 3) &&
           !WWorld.solidAt(px - 7, py + 3) && !WWorld.solidAt(px + 7, py + 3);
  }

  /* --- BFS over the tile grid; goal may be a blocked POI tile (adjacency). --- */
  var bfsPrev = null, bfsQ = null;
  function tileFree(tx, ty) {
    return !WWorld.solidAt(tx * WWorld.TILE + 16, ty * WWorld.TILE + 16);
  }
  function findPath(sx, sy, gx, gy) {
    var W2 = WWorld.W, H2 = WWorld.H, T = WWorld.TILE;
    if (sx === gx && sy === gy) return [];
    if (!bfsPrev) {
      bfsPrev = new Int32Array(W2 * H2);
      bfsQ = new Int32Array(W2 * H2);
    }
    bfsPrev.fill(-2);
    var gFree = tileFree(gx, gy);
    var si = sy * W2 + sx, gi = gy * W2 + gx;
    if (!tileFree(sx, sy)) return null;      // standing inside a wall: probe fallback
    var qh = 0, qt = 0, found = -1;
    bfsPrev[si] = -1;
    bfsQ[qt++] = si;
    while (qh < qt && found < 0) {
      var cur = bfsQ[qh++];
      var cx = cur % W2, cy = (cur / W2) | 0;
      if (cur === gi || (!gFree && Math.abs(cx - gx) + Math.abs(cy - gy) === 1)) {
        found = cur;
        break;
      }
      var nb, nx, ny;
      for (var d = 0; d < 4; d++) {
        nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue;
        nb = ny * W2 + nx;
        if (bfsPrev[nb] !== -2 || !tileFree(nx, ny)) continue;
        bfsPrev[nb] = cur;
        bfsQ[qt++] = nb;
      }
    }
    if (found < 0) return null;
    /* collect start->goal and keep every 2nd waypoint (the goal is always
       kept): stepToward's probe fan absorbs skipped tiles, halving the
       waypoint-object churn on long crossings */
    var rev = [];
    var n = found;
    while (n !== -1) { rev.push(n); n = bfsPrev[n]; }
    var path = [];
    var k;
    for (k = rev.length - 1; k >= 0; k -= 2) {
      path.push({ x: (rev[k] % W2) * T + 16, y: ((rev[k] / W2) | 0) * T + 16 });
    }
    if ((rev.length - 1) % 2 !== 0) {
      path.push({ x: (rev[0] % W2) * T + 16, y: ((rev[0] / W2) | 0) * T + 16 });
    }
    return path;
  }

  function faceTo(n, dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) n.dir = dx > 0 ? 'right' : 'left';
    else n.dir = dy > 0 ? 'down' : 'up';
  }

  /* Move one step toward a pixel target with a probe fan (walls, wander). */
  var PROBE = [0, 0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4];
  function stepToward(n, tx, ty, dt) {
    var dx = tx - n.x, dy = ty - n.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 3) return true;
    var sp = n.def.speed * dt;
    if (sp > d) sp = d;
    var base = Math.atan2(dy, dx);
    for (var i = 0; i < PROBE.length; i++) {
      var a = base + PROBE[i];
      var nx = n.x + Math.cos(a) * sp, ny = n.y + Math.sin(a) * sp;
      if (walkable(nx, ny)) {
        n.x = nx; n.y = ny;
        faceTo(n, Math.cos(a), Math.sin(a));
        n.walkT += dt;
        n.moving = true;
        return false;
      }
    }
    n.moving = false;
    return false;
  }

  function updateNpc(n, dt, env) {
    var h = env && env.hour !== undefined ? WU.hnorm(env.hour) : 12;
    var name = schedulePoi(n.def, h);
    /* outcome scenery (§3.2 junie_leaves): after the dark study she is away
       for the city during the day — parked (and hidden) at the tent from
       dawn to dusk, back home in the evenings. */
    if (n.id === 'junie' && window.WStory && typeof WStory.flag === 'function' &&
        WStory.flag('junie_leaves')) {
      if (h >= 6 && h < 18) { n.hidden = true; name = n.def.homePoi; }
      else { n.hidden = false; name = 'tent_door'; }
    } else if (n.id === 'junie') {
      n.hidden = false;
    }
    if (env && env.weather === 'rain' && h >= 9 && h < 17 && n.def.rainPoi) {
      name = n.def.rainPoi;
    }
    if (name && name !== n.anchorName) {
      n.anchorName = name;
      n.anchor = (window.WWorld && WWorld.poi[name]) || n.anchor;
      n.path = null;
      n.mode = 'travel';
      n.stuckT = 0;
    }
    n.moving = false;
    if (env && env.frozen) return;           // NPCs pause during dialogue
    if (n.repathCd > 0) n.repathCd -= dt;

    if (n.mode === 'idle') {
      n.idleT -= dt;
      if (n.idleT <= 0) {
        /* wander around the current anchor point (<=36 px) */
        var ax = n.anchor.x + WU.rand(-36, 36);
        var ay = n.anchor.y + WU.rand(-36, 36);
        if (walkable(ax, ay) && WU.dist(ax, ay, n.anchor.x, n.anchor.y) <= 40) {
          n.wx = ax; n.wy = ay; n.mode = 'wander';
        } else {
          n.idleT = WU.rand(0.8, 1.6);
        }
      }
      return;
    }

    if (n.mode === 'wander') {
      if (stepToward(n, n.wx, n.wy, dt)) {
        n.mode = 'idle';
        n.idleT = WU.rand(2, 4);             // idle 2-4 s on arrival (§3)
      }
      return;
    }

    /* travel: follow the BFS path to the schedule POI. At most 2 BFS runs
       per frame (hour switches otherwise make several NPCs pathfind in the
       same tick); whoever misses the budget probe-walks one frame. */
    if (!n.path) {
      var T = (window.WWorld && WWorld.TILE) || 32;
      if (pathBudget > 0) {
        pathBudget--;
        n.path = findPath((n.x / T) | 0, (n.y / T) | 0,
                          (n.anchor.x / T) | 0, (n.anchor.y / T) | 0);
        n.pi = 0;
        n.stuckT = 0;
        if (!n.path) { stepToward(n, n.anchor.x, n.anchor.y, dt); return; } // probe fallback
        if (!n.path.length) { n.mode = 'idle'; n.idleT = WU.rand(2, 4); return; }
      } else {
        stepToward(n, n.anchor.x, n.anchor.y, dt);   // budget spent: probe this frame
        return;
      }
    }
    var wp = n.path[n.pi];
    var last = n.pi >= n.path.length - 1;
    var gx = last ? n.anchor.x : wp.x;
    var gy = last ? n.anchor.y : wp.y;
    var arrived = stepToward(n, gx, gy, dt);
    if (last && WU.dist(n.x, n.y, n.anchor.x, n.anchor.y) < 6) arrived = true;
    if (arrived) {
      n.mode = 'idle';
      n.idleT = WU.rand(2, 4);
      n.path = null;
      return;
    }
    if (!last) {
      if (WU.dist(n.x, n.y, wp.x, wp.y) < 5) n.pi++;
    }
    /* stuck detection -> recompute the path (cooldown keeps it cheap) */
    var moved = WU.dist(n.x, n.y, n.lastX, n.lastY);
    if (moved < n.def.speed * dt * 0.3) n.stuckT += dt;
    else n.stuckT = 0;
    if (n.stuckT > 1.2 && n.repathCd <= 0) {
      n.path = null;
      n.repathCd = 2;
      n.stuckT = 0;
    }
    n.lastX = n.x; n.lastY = n.y;
  }

  function update(dt, env) {
    pathBudget = 2;          // at most 2 BFS pathfinds per frame
    for (var i = 0; i < list.length; i++) updateNpc(list[i], dt, env);
    ambient(dt, env);
  }

  /* ============================== AMBIENT (§3.3) ============================== */

  function pairOk(p, h) {
    if (cool[p.id] > 0) return false;
    if (!inWindow(h, p.hour)) return false;
    if (p.requires) {
      var chk = (window.WWorld && WWorld.checkReq) ? WWorld.checkReq : null;
      var chk2 = (window.WDialogue && WDialogue.checkRequires) ? WDialogue.checkRequires : null;
      var fn = chk2 || chk;
      if (fn && !fn(p.requires)) return false;
    }
    var pp = (window.WWorld && WWorld.poi) ? WWorld.poi[p.poi] : null;
    if (!pp) return false;
    var a = byId(p.a), b = byId(p.b);
    if (!a || !b) return false;
    if (WU.dist(a.x, a.y, pp.x, pp.y) > NEAR) return false;
    if (WU.dist(b.x, b.y, pp.x, pp.y) > NEAR) return false;
    return true;
  }

  function inSession(pid) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].pair.id === pid) return true;
    return false;
  }

  function startSession(p) {
    sessions.push({ pair: p, lines: p.lines, idx: 0, t: 0 });
    var a = byId(p.a), b = byId(p.b);
    if (a) faceTo(a, (b ? b.x : a.x) - a.x, (b ? b.y : a.y) - a.y);
    if (b) faceTo(b, (a ? a.x : b.x) - b.x, (a ? a.y : b.y) - b.y);
  }

  function endSession(s) {
    cool[s.pair.id] = 90;                    // pair cooldown 90 s (§3.3)
    var a = byId(s.pair.a), b = byId(s.pair.b);
    if (a) a.bubble = null;
    if (b) b.bubble = null;
  }

  function ambient(dt, env) {
    var k, i;
    for (k in cool) if (cool[k] > 0) cool[k] -= dt;

    /* advance live sessions (paused while a dialogue freezes the world) */
    var frozen = env && env.frozen;
    if (!frozen) {
      for (i = sessions.length - 1; i >= 0; i--) {
        var s = sessions[i];
        s.t += dt;
        if (s.t >= LINE_T) {
          s.t = 0;
          s.idx++;
          if (s.idx >= s.lines.length) {
            endSession(s);
            sessions.splice(i, 1);
          }
        }
      }
    }

    /* refresh the current speaker's bubble */
    for (i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.bubble) {
        n.bubble.t -= dt * 0.5;
        if (n.bubble.t <= 0) n.bubble = null;
      }
    }
    for (i = 0; i < sessions.length; i++) {
      var ss = sessions[i];
      var line = ss.lines[Math.min(ss.idx, ss.lines.length - 1)];
      var spk = byId(line.sp);
      if (spk) spk.bubble = { text: line.text, t: 1 };
    }

    if (frozen) return;

    /* FIFO start queue: eligible pairs enqueue once, start one per gap */
    var h = env && env.hour !== undefined ? WU.hnorm(env.hour) : 12;
    for (i = 0; i < PAIRS.length; i++) {
      var p = PAIRS[i];
      if (queued[p.id] || cool[p.id] > 0 || inSession(p.id)) continue;
      if (!pairOk(p, h)) continue;
      pend.push(p.id);
      queued[p.id] = true;
    }
    startCd -= dt;
    if (startCd <= 0 && sessions.length < MAX_SESSIONS && pend.length) {
      var pid = pend.shift();
      queued[pid] = false;
      for (i = 0; i < PAIRS.length; i++) {
        if (PAIRS[i].id === pid) {
          if (pairOk(PAIRS[i], h)) { startSession(PAIRS[i]); startCd = 0.9; }
          break;
        }
      }
    }
  }

  /* ============================== FRIENDSHIP ============================== */

  function friend(id) {
    var n = byId(id);
    return n ? n.hearts : 0;
  }

  function fmtHearts(v) {
    var r = Math.round(v * 2) / 2;
    return (r % 1 === 0) ? String(r) : r.toFixed(1);
  }

  function addFriend(id, amt) {
    var n = byId(id);
    if (!n || !amt) return;
    n.hearts = WU.clamp(n.hearts + amt, 0, 10);
    var P = window.WParticles;
    if (P && amt > 0) {
      for (var i = 0; i < 3; i++) {
        P.emit('heart', n.x + WU.rand(-8, 8), n.y - 44 + WU.rand(-6, 6),
          { life: WU.rand(0.8, 1.3) });
      }
    }
    if (window.WHUD && WHUD.toast) {
      WHUD.toast(n.def.name + ' \u2014 ' + fmtHearts(n.hearts) + ' \u2665');
    }
  }

  function setFriend(id, v) {
    var n = byId(id);
    if (n) n.hearts = WU.clamp(Number(v) || 0, 0, 10);
  }

  /* Interaction priority: the nearest NPC wins the E prompt (main resolves
     NPC vs interactable vs catchable the same way). */
  function nearestTo(px, py, r) {
    var best = null, bestD = r;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.hidden) continue;               // away villagers take no prompts
      var d = WU.dist(px, py, n.x, n.y);
      if (d <= bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /* ============================== DRAW ============================== */

  var DIR_COL = { down: 0, left: 1, right: 2, up: 3 };

  /* Shared body renderer. Public drawChar is called by main for the player
     WITHOUT a camera translate, so it applies the passed camera itself
     (lastCam is only the fallback when a caller omits it).
     Raw (translated) callers use drawBody / rawChar. */
  function rawChar(ctx, x, y, dir, frame, row) {
    var col = DIR_COL[dir] || 0;
    if (window.WAssets && WAssets.has('chars')) {
      /* chars.png is 4 cols x 9 rows: one 32x48 frame per direction
         (down/left/right/up); 'frame' gives a 1px step bob while walking */
      WAssets.sheet(ctx, 'chars', col * 32, row * 48, 32, 48,
        x - 16, y - 48 - ((frame % 2) ? 1 : 0), 32, 48);
      return;
    }
    /* vector fallback: shadow, coat, head, face by direction */
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(x, y - 2, 9, 3.5, 0, 0, WU.TAU); ctx.fill();
    var bob = frame ? Math.sin(frame * 3.1) * 1.2 : 0;
    var bodyY = y - 26 + bob;
    var coat = row === 0 ? '#3f8f86' : 'hsl(' + ((row * 47) % 360) + ',32%,45%)';
    ctx.fillStyle = coat;
    ctx.fillRect(x - 7, bodyY, 14, 24);
    ctx.fillStyle = '#2c3a44';
    ctx.fillRect(x - 6, bodyY + 22, 5, 4);
    ctx.fillRect(x + 1, bodyY + 22, 5, 4);
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath(); ctx.arc(x, bodyY - 7, 6.5, 0, WU.TAU); ctx.fill();
    ctx.fillStyle = '#5a4632';
    ctx.beginPath(); ctx.arc(x, bodyY - 9, 6.5, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#20262c';
    if (dir === 'down') { ctx.fillRect(x - 3, bodyY - 7, 2, 2); ctx.fillRect(x + 1, bodyY - 7, 2, 2); }
    else if (dir === 'left') ctx.fillRect(x - 4, bodyY - 7, 2, 2);
    else if (dir === 'right') ctx.fillRect(x + 2, bodyY - 7, 2, 2);
  }

  function drawChar(ctx, x, y, dir, frame, row, cam) {
    var c = cam || lastCam;
    ctx.save();
    ctx.translate(-Math.round(c.x), -Math.round(c.y));
    rawChar(ctx, x, y, dir, frame, row);
    ctx.restore();
  }

  function walkFrame(n) {
    if (!n.moving) return 0;
    return 1 + (((n.walkT * 5.5) | 0) % 2);
  }

  function drawBody(ctx, n, cam) {
    var c = cam || lastCam;
    ctx.save();
    ctx.translate(-Math.round(c.x), -Math.round(c.y));
    rawChar(ctx, n.x, n.y, n.dir, walkFrame(n), n.def.spriteRow);
    ctx.restore();
  }

  function wrapText(ctx, text, maxW, maxLines) {
    var words = String(text).split(' ');
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) {
        lines.push(cur);
        cur = words[i];
        if (lines.length >= maxLines) break;
      } else {
        cur = t;
      }
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    return lines;
  }

  /* Bubble text changes only every 6 s — measure each distinct line once. */
  var bubbleCache = { key: null, maxW: -1, font: '', lines: null };
  var overheardCache = { key: null, maxW: -1, font: '', lines: null };
  function wrapCached(ctx, text, maxW, maxLines, font, cache) {
    if (cache.key !== text || cache.maxW !== maxW || cache.font !== font) {
      cache.key = text;
      cache.maxW = maxW;
      cache.font = font;
      ctx.font = font;
      cache.lines = wrapText(ctx, text, maxW, maxLines);
    }
    return cache.lines;
  }

  function drawBubble(ctx, x, y, text) {
    var f = '12px "Segoe UI",Verdana,sans-serif';
    var lines = wrapCached(ctx, text, 148, 3, f, bubbleCache);
    ctx.font = f;
    var w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
    w += 16;
    var h = lines.length * 15 + 12;
    var bx = x - w / 2, by = y - 64 - h;
    ctx.fillStyle = 'rgba(250,246,232,0.94)';
    ctx.strokeStyle = 'rgba(60,50,36,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 7);
    else ctx.rect(bx, by, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(250,246,232,0.94)';
    ctx.beginPath();
    ctx.moveTo(x - 5, by + h); ctx.lineTo(x + 5, by + h); ctx.lineTo(x, by + h + 7);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a3226';
    ctx.textAlign = 'left';
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + 8, by + 17 + i * 15);
  }

  /* Full-length "overheard" panel above the pair POI (player within 5 tiles). */
  function drawOverheard(ctx, s) {
    var line = s.lines[Math.min(s.idx, s.lines.length - 1)];
    var spk = byId(line.sp);
    var pp = (window.WWorld && WWorld.poi) ? WWorld.poi[s.pair.poi] : null;
    if (!spk || !pp) return;
    var f = '13px "Segoe UI",Verdana,sans-serif';
    var text = spk.def.name.split(' ')[0] + ': \u201c' + line.text + '\u201d';
    var lines = wrapCached(ctx, text, 240, 3, f, overheardCache);
    ctx.font = f;
    var w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
    w += 20;
    var h = lines.length * 17 + 14;
    var bx = pp.x - w / 2, by = pp.y - 96 - h;
    ctx.fillStyle = 'rgba(28,32,40,0.85)';
    ctx.strokeStyle = 'rgba(255,225,170,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 8);
    else ctx.rect(bx, by, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4ecd8';
    ctx.textAlign = 'left';
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + 10, by + 20 + i * 17);
  }

  /* Bubbles + overheard panels; also caches the camera for drawBody/drawChar. */
  function draw(ctx, cam, env) {
    if (cam) { lastCam.x = cam.x; lastCam.y = cam.y; }
    ctx.save();
    ctx.translate(-Math.round(lastCam.x), -Math.round(lastCam.y));
    var player = env && env.player;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.hidden) continue;
      if (n.bubble && n.bubble.t > 0) drawBubble(ctx, n.x, n.y, n.bubble.text);
    }
    if (player) {
      for (i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var pp = (window.WWorld && WWorld.poi) ? WWorld.poi[s.pair.poi] : null;
        if (pp && WU.dist(player.x, player.y, pp.x, pp.y) <= OVERHEAR) {
          drawOverheard(ctx, s);
        }
      }
    }
    ctx.restore();
  }

  window.WNpcs = {
    DEFS: DEFS,
    init: init,
    update: update,
    ambient: ambient,
    draw: draw,
    drawBody: drawBody,
    drawChar: drawChar,
    walkFrame: walkFrame,
    list: function () { return list; },
    byId: byId,
    nearestTo: nearestTo,
    friend: friend,
    addFriend: addFriend,
    setFriend: setFriend
  };
  return window.WNpcs;
})();
