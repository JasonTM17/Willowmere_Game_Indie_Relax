/* Willowmere — world.js · window.WWorld
   Deterministic 128x96-tile world (4096x3072 px, tile 32).
   - build(): seeded generation — biomes, lake ellipse + sea, trails, village
     green + 8 buildings, pier, props, collision grid, POI table, 5 vistas,
     interactables, torches; also the per-tile variant table and the static
     draw lists (water-edge tiles, wet tiles, trees) used by drawOver.
   - Queries: biomeAt / solidAt / waterAt / weatherRoll.
   - Draw: drawBack (sky + 2 parallax hill silhouettes + a blitted static-
     ground cache with animated water on top + props + story scenery),
     drawOver (canopy + cloud shadows + glints from the build-time lists),
     drawLights (pre-baked night glow sprites + lighthouse beam when
     WStory.lampLit).
   - hourTint(hour): keyframe colour-grade layers (§2 of DESIGN.md).
   - Atlas art is used when WAssets.has(key); otherwise the same shapes are
     drawn as vector art in the DESIGN palette. No getImageData, no fetch. */
window.WWorld = (function () {
  'use strict';

  /* ---- constants ---- */
  var TILE = 32, W = 128, H = 96;
  var WPX = W * TILE, HPX = H * TILE;
  var SKY_H = 224;            // camera look-up margin (see bounds())
  var MAP_SEED = 20261005;    // fixed seed: build() is deterministic

  var B_MEADOW = 0, B_FOREST = 1, B_LAKE = 2, B_SEA = 3, B_BEACH = 4,
      B_HILLS = 5, B_HEAD = 6;
  var BIOME_NAMES = ['meadow', 'forest', 'lake', 'sea', 'beach', 'hills', 'headland'];

  var PAL = {
    meadow: ['#79b356', '#71a951', '#80b95d', '#6ca24b'],
    forestFloor: ['#557d43', '#4f7540'],
    beach: ['#e7d49f', '#dfcb93'],
    hills: ['#8fbb63', '#86b25c'],
    head: ['#9aa1a4', '#8f979b'],
    waterLake: '#3f7fae',
    waterSea: '#34709c',
    waterDeep: '#2d6489',
    waterHi: 'rgba(160,215,240,0.5)',
    foam: 'rgba(235,248,255,0.85)',
    trail: '#c8a26b',
    pathStone: '#b9b3a4',
    trunk: '#6b4a2f',
    leaf1: '#4e7d46', leaf2: '#5b8c50', leaf3: '#456e3e',
    pine: '#3c6b50',
    rock: '#9b958b', rockDark: '#87827a',
    wood: '#8a6a45', woodDark: '#6e5232',
    roofRed: '#b5533c', roofSlate: '#7a8aa0', roofBrown: '#8a5a3a',
    wall: '#e8dcc0', wall2: '#d9c9a8',
    glass: '#9fc4d4', glassHi: '#d8ecf2',
    tent: '#d8c27a', tentDark: '#b8a262',
    lamp: '#ffd98a',
    hive: '#d8a53c',
    sheep: '#f2efe6'
  };

  /* tiles.png cells (8x4 grid of 32px, per DESIGN §8): [col,row] */
  var TC = {
    grassFlower: [4, 0],
    water0: 0, waterRow: 1, waterEdge: [4, 1],
    sand0: 5, stone: [7, 1],
    stone2: [0, 2], cliff: [1, 2], forestFloor0: 3,
    bridgeH: [5, 2], trailDirt: [7, 2],
    hillGrass: [0, 3], hillRock: [1, 3], terraceEdge: [2, 3], seaFoam: [3, 3]
  };

  /* props.png / decor.png cells — row-major packing implied by DESIGN §8. */
  var PROP_CELLS = {
    bakery: [0, 0, 4, 3], shop: [4, 0, 4, 3],
    cottage_a: [8, 0, 3, 3], cottage_b: [11, 0, 3, 3], cottage_c: [0, 3, 3, 3],
    well: [3, 3, 2, 2], notice_board: [5, 3, 2, 2], tent: [7, 3, 2, 2],
    bench: [9, 3, 1, 1], torch: [10, 3, 1, 1], lamp_post: [11, 3, 1, 1],
    sign: [12, 3, 1, 1], fence_h: [13, 3, 1, 1], fence_v: [14, 3, 1, 1],
    pier_plank: [15, 3, 1, 1],
    boat: [0, 6, 2, 1], lighthouse: [0, 6, 3, 6], greenhouse: [3, 6, 4, 3],
    hut: [7, 6, 3, 2],
    sheep: [7, 8, 1, 1], gate: [10, 8, 1, 1], hay: [11, 8, 1, 1],
    windmill_ruin: [12, 8, 3, 4], hive: [0, 12, 1, 1]
  };
  var DECOR_CELLS = {
    willow_big: [0, 0, 3, 4], willow_small: [3, 0, 2, 3], pine: [5, 0, 2, 3],
    bush: [7, 0, 1, 1], reeds: [8, 0, 1, 2], rock: [9, 0, 1, 1],
    flowers: [10, 0, 1, 1]
  };

  /* ---- module state ---- */
  var biome, water, edge, trail, path, pier, solid, blocked;
  var tvar = null;        // per-tile hash variant (0..255), precomputed at build
  var props = [];
  var propGrid = null;
  var buildings = [];
  var torches = [];
  var poi = {};
  var vistas = [];
  var interactables = [];
  var built = false;
  var frame = 0;

  /* static draw lists (§13 perf): water-edge tiles, wet path/trail tiles and
     trees are all immutable after build(), so drawOver stops re-scanning the
     viewport grid every frame */
  var edgeList = null;    // Int32Array [tx,ty,...]
  var wetList = null;     // Int32Array [tx,ty,...]
  var treeList = [];      // indices into props (willows + pines)

  /* static-ground cache: biome/path/trail/pier tiles never change after
     build(), so they render once into an offscreen canvas and blit in one
     drawImage; only water (and foam/highlights on it) draws per frame */
  var gCache = null;
  var gcOx = 0, gcOy = 0, gcW = 0, gcH = 0, gcAtlas = null;
  var GC_MARGIN = 4;      // tiles of slack around the viewport
  var GC_MAX_PX = 4.0e6;  // memory gate (~16 MB); larger views draw directly

  var time = 0, lastNow = 0;   // internal visual clock (water, clouds, sway)
  var ffTimer = 0, leafTimer = 0, smokeT = 0;

  /* Zoom-aware: the cache key includes the current transform scale, so a
     camera zoom (vista 0.45) recomputes the world-space viewport. */
  var vcache = { cw: -1, ch: -1, sc: -1, w: 0, h: 0, dpr: 1 };

  var api = null; // assigned at the bottom; closures below reference it

  /* ---- small helpers ---- */
  function idx(x, y) { return y * W + x; }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function baseBiome(tx, ty) {
    if (ty < 30 || (tx < 24 && ty < 44)) return B_FOREST;              // Willow Forest + west arm
    var dx = (tx - 88) / 24, dy = (ty - 40) / 16;
    if (dx * dx + dy * dy <= 1) return B_LAKE;                          // lake ellipse
    if (tx >= 96 && ty >= 52) return B_HILLS;                           // High Hills
    if (ty >= 72 && tx < 80) {                                          // Beach & Sea
      if (ty >= 86) return B_SEA;
      if (tx >= 66 && tx <= 72 && ty >= 78 && ty <= 85) return B_HEAD;  // lighthouse headland
      return B_BEACH;
    }
    return B_MEADOW;
  }

  /* ============================== BUILD ============================== */

  function addProp(p) {
    p._f = 0; // drawProps frame marker
    p._s = 0; // drawOver shadow frame marker
    props.push(p);
    return p;
  }

  /* anchor bottom-centre (trees, small props) */
  function addBC(kind, tx, ty, wCells, hCells, sheet, solid, extra) {
    var p = {
      kind: kind, sheet: sheet || 'decor',
      anchor: 'bc',
      x: tx * TILE + TILE / 2, y: (ty + 1) * TILE,
      w: wCells * TILE, h: hCells * TILE,
      solid: !!solid,
      cells: DECOR_CELLS[kind] || PROP_CELLS[kind] || null,
      sway: WU.hash2(tx, ty) * 6.283
    };
    if (extra) for (var k in extra) p[k] = extra[k];
    return addProp(p);
  }

  /* anchor top-left (buildings) */
  function addTL(kind, tx, ty, wCells, hCells, sheet, solid, extra) {
    var p = {
      kind: kind, sheet: sheet || 'props',
      anchor: 'tl',
      x: tx * TILE, y: ty * TILE,
      w: wCells * TILE, h: hCells * TILE,
      solid: !!solid,
      cells: PROP_CELLS[kind] || null,
      sway: 0
    };
    if (extra) for (var k in extra) p[k] = extra[k];
    return addProp(p);
  }

  function markSolidRect(tx, ty, w, h) {
    for (var y = ty; y < ty + h; y++) {
      for (var x = tx; x < tx + w; x++) {
        if (inMap(x, y)) solid[idx(x, y)] = 1;
      }
    }
  }

  function markBlockedRect(tx, ty, w, h) {
    for (var y = ty; y < ty + h; y++) {
      for (var x = tx; x < tx + w; x++) {
        if (inMap(x, y)) blocked[idx(x, y)] = 1;
      }
    }
  }

  function setPoi(name, tx, ty) {
    poi[name] = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }

  function carveH(x0, x1, y) {
    for (var x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (!inMap(x, y)) continue;
      var i = idx(x, y);
      if (!water[i]) trail[i] = 1;
    }
  }

  function carveV(x, y0, y1) {
    for (var y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      if (!inMap(x, y)) continue;
      var i = idx(x, y);
      if (!water[i]) trail[i] = 1;
    }
  }

  /* Buildings per DESIGN §2/§5.4 — dtx/dty is the door tile (south face). */
  var BUILDING_DEFS = [
    { kind: 'bakery',       tx: 26, ty: 47, w: 4, h: 3, dtx: 28, dty: 50, dPoi: 'bakery_door' },
    { kind: 'shop',         tx: 39, ty: 46, w: 4, h: 3, dtx: 41, dty: 49, dPoi: 'shop_door' },
    { kind: 'cottage_a',    tx: 26, ty: 43, w: 3, h: 3, dtx: 27, dty: 46, dPoi: 'cottageA_door' },
    { kind: 'cottage_c',    tx: 40, ty: 42, w: 3, h: 3, dtx: 41, dty: 45, dPoi: 'cottageC_door' },
    { kind: 'cottage_b',    tx: 46, ty: 52, w: 3, h: 3, dtx: 47, dty: 55, dPoi: 'rosa_door' },
    { kind: 'cottage_a',    tx: 44, ty: 56, w: 3, h: 3, dtx: 45, dty: 59, dPoi: 'finn_door' },
    { kind: 'cottage_c',    tx: 28, ty: 54, w: 3, h: 3, dtx: 29, dty: 57, dPoi: 'player_door' },
    { kind: 'greenhouse',   tx: 31, ty: 29, w: 4, h: 3, dtx: 33, dty: 32, dPoi: 'greenhouse_door' },
    { kind: 'hut',          tx: 104, ty: 64, w: 3, h: 2, dtx: 105, dty: 66, dPoi: 'bramble_hut_door' },
    { kind: 'hut',          tx: 102, ty: 70, w: 3, h: 2, dtx: 103, dty: 72, dPoi: 'marlow_hut_door' },
    { kind: 'tent',         tx: 29, ty: 78, w: 2, h: 2, dtx: 30, dty: 80, dPoi: 'tent_door' },
    { kind: 'lighthouse',   tx: 68, ty: 79, w: 3, h: 6, dtx: 69, dty: 85, dPoi: 'lighthouse_door' },
    { kind: 'windmill_ruin', tx: 118, ty: 71, w: 3, h: 4, dtx: 119, dty: 75, dPoi: null },
    { kind: 'shed',         tx: 49, ty: 53, w: 1, h: 1, dtx: 49, dty: 54, dPoi: 'rosa_shed' }
  ];

  var SIGN_DEFS = [
    { tx: 30, ty: 45, text: 'Phía bắc: Rừng Liễu. Coi chừng liễu rủ; chúng cũng đang coi chừng bạn.' },
    { tx: 45, ty: 47, text: 'Phía đông: Hồ Willowmere. Cầu tàu rất hợp để trầm tư.' },
    { tx: 24, ty: 59, text: 'Phía nam: Bãi Biển. Vũng triều đẹp nhất lúc bình minh.' },
    { tx: 94, ty: 59, text: 'Phía đông: Đồi Cao. Đỉnh Tor đang nhìn lại bạn.' },
    { tx: 79, ty: 83, text: 'Mũi Đất: ngọn đèn cũ. Tắt đã hai năm.' }
  ];

  var VISTA_DEFS = [
    { id: 'willow_overlook', tx: 30, ty: 8, caption: 'Từ đây, mỗi ống khói của Willowmere đều thở ra một lời thân thiện.' },
    /* DESIGN places heron_rock at (102,28), which falls inside the lake
       ellipse; nudged to the walkable north shore 2 tiles up. */
    { id: 'heron_rock', tx: 102, ty: 26, caption: 'Hồ giữ bầu trời của ngày hôm qua ở tận đáy.' },
    /* DESIGN places lighthouse_head at (69,88), which is open sea; nudged to
       the headland lip. */
    { id: 'lighthouse_head', tx: 69, ty: 86, caption: 'Hai năm tắt ngấm. Mấy con hải âu vẫn vòng quanh, theo thói quen.' },
    { id: 'shepherds_tor', tx: 112, ty: 60, caption: 'Cả thung lũng hiện ra, và không một thứ gì vội vã trong đó.' },
    { id: 'old_stone_circle', tx: 14, ty: 18, caption: 'Cổ hơn cả ngọn đèn. Nó chẳng ngại chờ đợi.' }
  ];

  /* ---- interactable onUse implementations (engine-stage behaviour) ---- */

  function toast(msg) {
    var Hud = window.WHUD;
    if (Hud && typeof Hud.toast === 'function') Hud.toast(msg);
  }

  function blip(name) {
    var A = window.WAudio;
    if (A && typeof A.sfx === 'function') A.sfx(name);
  }

  function envNow() {
    return (api && api.env) || (window.WGame && window.WGame.env) || null;
  }

  function doorPlayerUse() {
    var e = envNow();
    var h = e && e.hour !== undefined ? WU.hnorm(e.hour) : 12;
    var night = h >= 18 || h < 5;
    if (night && window.WGame && typeof window.WGame.sleep === 'function') {
      window.WGame.sleep();
      return;
    }
    if (!night) toast('Trời còn sáng lắm \u2014 quay lại sau 18:00 nhé.');
    else toast('Chiếc giường đã trải sẵn, chờ bạn.');
    blip('click');
  }

  function doorLighthouseUse() {
    var S = window.WStory;
    if (S && typeof S.canClimb === 'function' && S.canClimb(envNow())) {
      if (window.WDialogue && typeof window.WDialogue.start === 'function') {
        window.WDialogue.start('climb_menu'); // story registers the node at boot
        return;
      }
      toast('Phòng đèn đang chờ phía trên.');
      blip('bell');
      return;
    }
    toast('Cửa tháp khép kín. Không khóa đâu \u2014 nó đang chờ.');
    blip('click');
  }

  function shedUse() {
    var S = window.WStory;
    if (S && typeof S.readLetter === 'function') { S.readLetter(envNow()); return; }
      toast('Một ổ khóa nhỏ. Bên trong, lá thư xào xạc \u2014 được giữ nhiều năm, cho một ai đó.');
    blip('click');
  }

  function hiveUse() {
    /* `this` is the interactable record; the used-day stamp rides the saved
       flag pool so a reload can't grant a second comb from the same hive */
    var A = window.WAction;
    var S = window.WStory;
    var e = envNow();
    var day = e && e.day ? e.day : 1;
    var key = 'hive_day_' + this.id;
    var stamped = (S && S.flags && S.flags[key] === day) || this._usedDay === day;
    if (stamped) {
      toast('Ong vẫn đang làm thêm. Mai quay lại nhé.');
      return;
    }
    if (A && typeof A.add === 'function') {
      A.add('food_honeycomb', 1);
      this._usedDay = day;
      if (S && typeof S.setFlag === 'function') S.setFlag(key, day);
      toast('Bạn lấy được một miếng tổ ong. Đàn ong vo ve tán thành.');
      blip('pop');
    } else {
      toast('Tổ ong ù ù, nặng trĩu mật.');
      blip('click');
    }
  }

  function seedGlintUse() {
    if (this._taken) return;
    var A = window.WAction;
    var S = window.WStory;
    if (A && typeof A.add === 'function') {
      A.add('seeds_pouch', 1);
      this._taken = true;
      if (S && typeof S.setFlag === 'function') S.setFlag('seed_pouch_found', true);
      toast('Một túi hạt giống rơi trên đường đồi. Gideon sẽ muốn nó lại lắm.');
      blip('pop');
    } else {
      toast('Có gì đó lấp lánh trên đường mòn \u2014 một túi vải nhỏ đựng hạt giống.');
      blip('click');
    }
  }

  function noticeBoardUse() {
    /* §5.4: the board duplicates the quest log — same entries the HUD panel
       shows (active first, then available), capped at the 3-toast limit. */
    var S = window.WStory;
    var rows = [];
    if (S && S.QUESTS) {
      for (var k in S.QUESTS) if (S.QUESTS.hasOwnProperty(k)) rows.push(S.QUESTS[k]);
      rows.sort(function (a, b) {
        var av = a.state === 'active' ? 0 : a.state === 'available' ? 1 : 2;
        var bv = b.state === 'active' ? 0 : b.state === 'available' ? 1 : 2;
        return av - bv;
      });
    }
    var shown = 0;
    for (var i = 0; i < rows.length && shown < 3; i++) {
      var q = rows[i];
      if (q.state !== 'active' && q.state !== 'available') continue;
      toast((q.state === 'active' ? '\u25cf ' : '\u25cb ') + q.title);
      shown++;
    }
    if (!shown) {
      toast('"BẢNG THỦY TRIỀU \u00b7 CỦA RƠI CỦA LẠC \u00b7 BAN LỄ HỘI \u2014 hoãn, năm thứ hai liên tiếp."');
    }
    blip('click');
  }

  function stoneCircleUse() {
    toast('Mấy tảng đá mát lạnh và cổ hơn cả ngọn đèn.');
    blip('bell');
  }

  function pierEndUse() {
    toast('Hải âu cãi nhau chuyện không đâu. Hồ vẫn giữ bầu trời của hôm qua.');
    blip('splash');
  }

  /* The old cabinet: hands off to the Neon Swarm minigame overlay
     (main.js). Someone dragged it out of the lighthouse basement years
     ago; its screen still hums with a light that is not the lamp's. */
  function arcadeUse(game) {
    if (game && typeof game.openArcade === 'function') game.openArcade();
    else if (window.WGame && typeof WGame.openArcade === 'function') WGame.openArcade();
    else toast('Chiếc tủ chớp nhẹ rồi thôi ý định.');
  }

  function makeInteractable(id, tx, ty, label, onUse, requires) {
    var it = {
      id: id,
      x: tx * TILE, y: ty * TILE, w: TILE, h: TILE + 16,
      label: label,
      onUse: onUse
    };
    if (requires) it.requires = requires;
    return it;
  }

  /* ============================== BUILD (cont.) ============================== */

  function build() {
    biome = new Uint8Array(W * H);
    water = new Uint8Array(W * H);
    edge = new Uint8Array(W * H);
    trail = new Uint8Array(W * H);
    path = new Uint8Array(W * H);
    pier = new Uint8Array(W * H);
    solid = new Uint8Array(W * H);
    blocked = new Uint8Array(W * H);
    tvar = new Uint8Array(W * H);
    edgeList = null;
    wetList = null;
    treeList.length = 0;
    gCache = null;
    /* Clear in place: api exposes these by reference, so rebuild (New Game)
       must not swap the objects out from under consumers. */
    props.length = 0;
    buildings.length = 0;
    torches.length = 0;
    vistas.length = 0;
    interactables.length = 0;
    for (var pk in poi) if (poi.hasOwnProperty(pk)) delete poi[pk];
    propGrid = new Array(W * H);
    built = false;

    var rng = WU.seed(MAP_SEED);
    var tx, ty, i;

    /* 1. biome field + water (+ precomputed per-tile variants) */
    for (ty = 0; ty < H; ty++) {
      for (tx = 0; tx < W; tx++) {
        i = idx(tx, ty);
        var b = baseBiome(tx, ty);
        biome[i] = b;
        water[i] = (b === B_LAKE || b === B_SEA) ? 1 : 0;
        tvar[i] = (WU.hash2(tx, ty) * 256) | 0;
      }
    }

    /* 2. water edge flags (water tile touching land) */
    for (ty = 0; ty < H; ty++) {
      for (tx = 0; tx < W; tx++) {
        i = idx(tx, ty);
        if (!water[i]) continue;
        if ((inMap(tx - 1, ty) && !water[idx(tx - 1, ty)]) ||
            (inMap(tx + 1, ty) && !water[idx(tx + 1, ty)]) ||
            (inMap(tx, ty - 1) && !water[idx(tx, ty - 1)]) ||
            (inMap(tx, ty + 1) && !water[idx(tx, ty + 1)]) ||
            ty === 0 || tx === 0 || tx === W - 1) {
          edge[i] = 1;
        }
      }
    }

    /* 3. trails (collision-free) per DESIGN §2 */
    carveV(30, 6, 44);          // village -> forest (x=30)
    carveH(43, 64, 48);         // village -> lake shore (y=48)
    carveV(64, 44, 48);         // shore connector to the pier head
    carveV(24, 58, 78);         // village -> beach (x=24)
    carveH(92, 112, 60);        // lake -> hills (y=60)
    carveH(54, 96, 84);         // beach -> hills (y=84)

    /* 4. village stone plaza around the well */
    for (ty = 45; ty <= 55; ty++) {
      for (tx = 29; tx <= 39; tx++) {
        var ddx = tx - 34, ddy = ty - 50;
        if (ddx * ddx + ddy * ddy <= 25) {
          i = idx(tx, ty);
          if (!water[i] && !trail[i]) path[i] = 1;
        }
      }
    }

    /* 5. pier over the lake (walkable water, y=44, x 65..75) */
    for (tx = 65; tx <= 75; tx++) {
      i = idx(tx, 44);
      pier[i] = 1;
      blocked[i] = 1; // keep scatter off it
    }

    /* 6. buildings: solid footprint + blocked ring + door POI + prop */
    for (var b = 0; b < BUILDING_DEFS.length; b++) {
      var bd = BUILDING_DEFS[b];
      markSolidRect(bd.tx, bd.ty, bd.w, bd.h);
      markBlockedRect(bd.tx - 1, bd.ty - 1, bd.w + 2, bd.h + 2);
      var bp = addTL(bd.kind, bd.tx, bd.ty, bd.w, bd.h, 'props', false);
      bp.dtx = bd.dtx; bp.dty = bd.dty;
      buildings.push(bd);
      if (bd.dPoi) setPoi(bd.dPoi, bd.dtx, bd.dty);
    }

    /* 7. fixed props */
    var well = addTL('well', 33, 49, 2, 2, 'props', true);
    well.kind = 'well';
    markBlockedRect(32, 48, 4, 4);
    setPoi('green_well', 34, 51);

    var board = addTL('notice_board', 36, 48, 2, 1, 'props', true);
    board.kind = 'notice_board';
    markBlockedRect(35, 47, 4, 3);
    setPoi('notice_board', 37, 49);

    var lampTiles = [[30, 47], [38, 47], [30, 53], [38, 53]];
    for (var l = 0; l < lampTiles.length; l++) {
      addBC('lamp_post', lampTiles[l][0], lampTiles[l][1], 1, 2, 'props', true);
      blocked[idx(lampTiles[l][0], lampTiles[l][1])] = 1;
    }

    addBC('bench', 37, 52, 1, 1, 'props', false); // green bench
    setPoi('green_bench', 37, 52);
    addBC('bench', 31, 33, 1, 1, 'props', false); // Gideon's lunch bench
    setPoi('lunch_bench', 31, 33);
    addBC('bench', 50, 57, 1, 1, 'props', false); // Rosa's garden bench
    setPoi('garden_bench', 50, 57);

    /* wild hives (forest) */
    var hiveTiles = [[20, 14], [24, 10], [18, 22]];
    for (var hv = 0; hv < hiveTiles.length; hv++) {
      var hx = hiveTiles[hv][0], hy = hiveTiles[hv][1];
      addBC('hive', hx, hy, 1, 1, 'props', true);
      blocked[idx(hx, hy)] = 1;
      setPoi('hive_' + (hv + 1), hx, hy);
    }
    setPoi('forest_hives', 20, 14);

    /* Old Stone Circle: ring of 8 stones around (14,18) */
    for (var s = 0; s < 8; s++) {
      var ang = s / 8 * WU.TAU;
      var sx = Math.round(14 + Math.cos(ang) * 2.5);
      var sy = Math.round(18 + Math.sin(ang) * 2.5);
      if (inMap(sx, sy)) {
        addBC('stone', sx, sy, 1, 1, null, true);
        blocked[idx(sx, sy)] = 1;
      }
    }
    setPoi('stone_circle', 14, 18);

    /* tide pools (beach) */
    var poolTiles = [[17, 80], [19, 82], [21, 79]];
    for (var tp = 0; tp < poolTiles.length; tp++) {
      addBC('pool', poolTiles[tp][0], poolTiles[tp][1], 1, 1, null, false);
      blocked[idx(poolTiles[tp][0], poolTiles[tp][1])] = 1;
    }
    setPoi('tide_pools', 19, 81);

    /* Heron Rock + big shore rock */
    addBC('rock_big', 103, 25, 2, 2, null, true);
    markBlockedRect(102, 24, 2, 2);
    setPoi('heron_rock', 103, 25);

    /* sheep at the pasture (Bramble's flock props) */
    var sheepTiles = [[100, 56], [104, 56], [101, 59]];
    for (var sh = 0; sh < sheepTiles.length; sh++) {
      addBC('sheep', sheepTiles[sh][0], sheepTiles[sh][1], 1, 1, 'props', false);
    }
    setPoi('pasture_1', 100, 55); setPoi('pasture_2', 104, 55);
    setPoi('pasture_3', 100, 59); setPoi('pasture_4', 104, 59);

    /* rowboat moored by the pier */
    addBC('boat', 77, 43, 2, 1, 'props', false);
    setPoi('boat', 77, 43);

    /* nap tree on the hills */
    addBC('pine', 109, 62, 2, 3, 'decor', true);
    blocked[idx(109, 62)] = 1;
    setPoi('nap_tree', 109, 62);

    /* 8. seeded scatter per biome */
    for (ty = 0; ty < H; ty++) {
      for (tx = 0; tx < W; tx++) {
        i = idx(tx, ty);
        if (blocked[i] || solid[i] || trail[i] || path[i] || pier[i] || water[i]) continue;
        var bio = biome[i];
        var r = rng();
        if (bio === B_FOREST) {
          if (r < 0.045) addBC('willow_big', tx, ty, 3, 4, 'decor', true);
          else if (r < 0.11) addBC('willow_small', tx, ty, 2, 3, 'decor', true);
          else if (r < 0.135) addBC('bush', tx, ty, 1, 1, 'decor', false);
          else if (r < 0.15) addBC('rock', tx, ty, 1, 1, 'decor', true);
          else if (r < 0.19) addBC('flowers', tx, ty, 1, 1, 'decor', false);
        } else if (bio === B_MEADOW) {
          if (r < 0.004) addBC('willow_small', tx, ty, 2, 3, 'decor', true);
          else if (r < 0.012) addBC('bush', tx, ty, 1, 1, 'decor', false);
          else if (r < 0.016) addBC('rock', tx, ty, 1, 1, 'decor', true);
          else if (r < 0.06) addBC('flowers', tx, ty, 1, 1, 'decor', false);
        } else if (bio === B_BEACH) {
          if (r < 0.014) addBC('rock', tx, ty, 1, 1, 'decor', true);
        } else if (bio === B_HILLS) {
          if (r < 0.02) addBC('pine', tx, ty, 2, 3, 'decor', true);
          else if (r < 0.05) addBC('rock', tx, ty, 1, 1, 'decor', true);
          else if (r < 0.065) addBC('bush', tx, ty, 1, 1, 'decor', false);
        } else if (bio === B_HEAD) {
          if (r < 0.03) addBC('rock', tx, ty, 1, 1, 'decor', true);
        }
      }
    }

    /* reeds along the waterline */
    for (ty = 1; ty < H - 1; ty++) {
      for (tx = 1; tx < W - 1; tx++) {
        i = idx(tx, ty);
        if (water[i] || blocked[i] || solid[i] || trail[i] || path[i]) continue;
        if (edge[idx(tx + 1, ty)] || edge[idx(tx - 1, ty)] ||
            (inMap(tx, ty + 1) && water[idx(tx, ty + 1)]) ||
            (inMap(tx, ty - 1) && water[idx(tx, ty - 1)])) {
          if (rng() < 0.12) addBC('reeds', tx, ty, 1, 2, 'decor', false);
        }
      }
    }

    /* 9. solid grid: border + water (pier stays walkable) + props */
    for (tx = 0; tx < W; tx++) {
      solid[idx(tx, 0)] = 1;
      solid[idx(tx, H - 1)] = 1;
    }
    for (ty = 0; ty < H; ty++) {
      solid[idx(0, ty)] = 1;
      solid[idx(W - 1, ty)] = 1;
    }
    for (i = 0; i < W * H; i++) {
      if (water[i] && !pier[i]) solid[i] = 1;
    }
    for (var pp = 0; pp < props.length; pp++) {
      var prop = props[pp];
      if (!prop.solid) continue;
      if (prop.anchor === 'tl') {
        markSolidRect(prop.x / TILE, prop.y / TILE, prop.w / TILE, prop.h / TILE);
      } else {
        var ptx = Math.round((prop.x - TILE / 2) / TILE);
        var pty = Math.round((prop.y - TILE) / TILE);
        if (inMap(ptx, pty)) solid[idx(ptx, pty)] = 1;
      }
    }

    /* 10. prop grid (tile -> prop indices) for culled drawing */
    for (pp = 0; pp < props.length; pp++) {
      prop = props[pp];
      var x0, y0, x1, y1;
      if (prop.anchor === 'tl') {
        x0 = prop.x; y0 = prop.y; x1 = prop.x + prop.w; y1 = prop.y + prop.h;
      } else {
        x0 = prop.x - prop.w / 2; x1 = prop.x + prop.w / 2;
        y0 = prop.y - prop.h; y1 = prop.y;
      }
      var gx0 = clamp(Math.floor(x0 / TILE), 0, W - 1);
      var gx1 = clamp(Math.floor((x1 - 0.01) / TILE), 0, W - 1);
      var gy0 = clamp(Math.floor(y0 / TILE), 0, H - 1);
      var gy1 = clamp(Math.floor((y1 - 0.01) / TILE), 0, H - 1);
      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          var cell = propGrid[idx(gx, gy)];
          if (!cell) { cell = []; propGrid[idx(gx, gy)] = cell; }
          cell.push(pp);
        }
      }
    }

    /* 11. remaining schedule POIs (pixel coords for npcs.js) */
    var MORE_POI = {
      green: [36, 51], green_games: [36, 50],
      bakery_oven: [26, 50], bakery_counter: [29, 50],
      shop_counter: [40, 49],
      greenhouse: [32, 31],
      garden: [51, 56],
      dock: [72, 44], pier: [70, 44],
      beach: [24, 80], easel: [27, 76], tent: [30, 79],
      hut_bramble: [105, 66], west_overlook: [98, 58], lake_edge: [80, 57],
      hut: [103, 71], driftwood_1: [110, 57], driftwood_2: [114, 63],
      lighthouse_base: [69, 85], lighthouse: [69, 82],
      scout_trail_1: [30, 24], scout_trail_2: [30, 12], forest_paint: [22, 16],
      tor: [112, 60], windmill: [119, 75]
    };
    var name;
    for (name in MORE_POI) {
      if (MORE_POI.hasOwnProperty(name)) setPoi(name, MORE_POI[name][0], MORE_POI[name][1]);
    }

    /* 12. vistas */
    for (var v = 0; v < VISTA_DEFS.length; v++) {
      var vd = VISTA_DEFS[v];
      vistas.push({
        id: vd.id,
        x: vd.tx * TILE + TILE / 2,
        y: vd.ty * TILE + TILE / 2,
        caption: vd.caption,
        seenLocal: false
      });
    }

    /* 13. interactables (§5.4) */
    interactables.push(makeInteractable('door_player', 29, 57, 'Ngủ', doorPlayerUse));
    /* no `requires` here: the door/shed always take the prompt, and onUse
       explains why they stay shut — an invisible interactable reads as a
       bug, a locked one with a line reads as a promise */
    interactables.push(makeInteractable('door_lighthouse', 69, 85, 'Leo tháp', doorLighthouseUse));
    interactables.push(makeInteractable('rosa_shed', 49, 54, 'Đọc lá thư', shedUse));
    for (hv = 0; hv < hiveTiles.length; hv++) {
      interactables.push(makeInteractable(
        'hive_' + (hv + 1), hiveTiles[hv][0], hiveTiles[hv][1],
        'Lấy tổ ong', hiveUse));
    }
    interactables.push(makeInteractable(
      'seed_glint', 98, 60, 'Nhặt túi hạt giống', seedGlintUse,
      { notFlags: ['seed_pouch_found', 'seeds_returned', 'seeds_gifted'] }));
    interactables.push(makeInteractable('notice_board', 37, 49, 'Đọc bảng tin', noticeBoardUse));
    for (s = 0; s < SIGN_DEFS.length; s++) {
      (function (sd, n) {
        interactables.push(makeInteractable('sign_' + (n + 1), sd.tx, sd.ty, 'Đọc biển chỉ', function () {
          toast(sd.text);
          blip('click');
        }));
      })(SIGN_DEFS[s], s);
      addBC('sign', SIGN_DEFS[s].tx, SIGN_DEFS[s].ty, 1, 1, 'props', true);
    }
    interactables.push(makeInteractable('stone_circle', 14, 18, 'Chạm vào đá cổ', stoneCircleUse));
    interactables.push(makeInteractable('pier_end', 75, 44, 'Ngắm hồ', pierEndUse));
    interactables.push(makeInteractable('arcade_cabinet', 31, 57, 'Chơi chiếc tủ cũ', arcadeUse));
    solid[idx(31, 57)] = 1;                       // the cabinet blocks its tile

    /* 14. torches (night glow sources) */
    for (l = 0; l < lampTiles.length; l++) {
      torches.push({ x: lampTiles[l][0] * TILE + TILE / 2, y: lampTiles[l][1] * TILE + 4 });
    }
    torches.push({ x: 28 * TILE + 16, y: 49 * TILE + 6 });  // bakery lantern
    torches.push({ x: 33 * TILE + 16, y: 32 * TILE + 6 });  // greenhouse lantern
    torches.push({ x: 30 * TILE + 16, y: 79 * TILE + 6 });  // Junie's tent lantern

    /* 15. static draw lists — edge-water tiles, wet path/trail tiles, trees
       (everything here is immutable after build; drawOver iterates these
       short lists instead of rescanning the whole viewport) */
    var eCount = 0, wCount = 0, pi;
    for (i = 0; i < W * H; i++) {
      if (edge[i]) eCount++;
      if (trail[i] || path[i]) wCount++;
    }
    edgeList = new Int32Array(eCount * 2);
    wetList = new Int32Array(wCount * 2);
    eCount = 0; wCount = 0;
    for (ty = 0; ty < H; ty++) {
      for (tx = 0; tx < W; tx++) {
        i = idx(tx, ty);
        if (edge[i]) { edgeList[eCount++] = tx; edgeList[eCount++] = ty; }
        if (trail[i] || path[i]) { wetList[wCount++] = tx; wetList[wCount++] = ty; }
      }
    }
    treeList.length = 0;
    for (pi = 0; pi < props.length; pi++) {
      var kind = props[pi].kind;
      if (kind === 'willow_big' || kind === 'willow_small' || kind === 'pine') {
        treeList.push(pi);
      }
    }

    built = true;
  }

  function ensureBuilt() { if (!built) build(); }

  /* ============================== QUERIES ============================== */

  function biomeAt(tx, ty) {
    if (!inMap(tx, ty)) return 'meadow';
    return BIOME_NAMES[biome[idx(tx, ty)]];
  }

  function solidAt(px, py) {
    if (px < 0 || py < 0 || px >= WPX || py >= HPX) return true;
    return solid[idx((px / TILE) | 0, (py / TILE) | 0)] === 1;
  }

  /* Water includes the lake and the sea but not pier planks (walkable). */
  function waterAt(px, py) {
    if (px < 0 || py < 0 || px >= WPX || py >= HPX) return false;
    var i = idx((px / TILE) | 0, (py / TILE) | 0);
    return water[i] === 1 && pier[i] !== 1;
  }

  /* Day 1 clear · Day 2 guaranteed rain · then 35% at 06:00. */
  function weatherRoll(day) {
    day = day | 0;
    if (day <= 1) return 'clear';
    if (day === 2) return 'rain';
    var r = WU.seed(0x9E37 + day * 7919)();
    return r < 0.35 ? 'rain' : 'clear';
  }

  /* ---- vista + interactable helpers ---- */

  function vistaAt(px, py) {
    for (var i = 0; i < vistas.length; i++) {
      var v = vistas[i];
      if (WU.dist(px, py, v.x, v.y) <= 72) return v;
    }
    return null;
  }

  function markVistaSeen(id) {
    for (var i = 0; i < vistas.length; i++) {
      if (vistas[i].id === id) vistas[i].seenLocal = true;
    }
    var S = window.WStory;
    if (S && typeof S.setFlag === 'function') S.setFlag('vista_' + id, true);
  }

  function vistaSeen(v) {
    var S = window.WStory;
    if (S && typeof S.flag === 'function') return !!S.flag('vista_' + v.id);
    return !!v.seenLocal;
  }

  /* §6 requires semantics (subset), reading live state defensively. */
  function checkReq(req) {
    if (!req) return true;
    var e = envNow() || {};
    var S = window.WStory;
    function flag(k) {
      if (S && S.flags && S.flags.hasOwnProperty(k)) return !!S.flags[k];
      return false;
    }
    var k;
    if (req.flags) {
      for (k = 0; k < req.flags.length; k++) if (!flag(req.flags[k])) return false;
    }
    if (req.anyFlags) {
      var any = false;
      for (k = 0; k < req.anyFlags.length; k++) if (flag(req.anyFlags[k])) any = true;
      if (!any) return false;
    }
    if (req.notFlags) {
      for (k = 0; k < req.notFlags.length; k++) if (flag(req.notFlags[k])) return false;
    }
    if (req.friendship) {
      var N = window.WNpcs;
      if (!N || typeof N.friend !== 'function') return false;
      for (var npc in req.friendship) {
        if (req.friendship.hasOwnProperty(npc) && N.friend(npc) < req.friendship[npc]) return false;
      }
    }
    if (req.hour) {
      var h = e.hour !== undefined ? WU.hnorm(e.hour) : 12;
      var a = req.hour[0], b = req.hour[1];
      var inR = a <= b ? (h >= a && h <= b) : (h >= a || h <= b);
      if (!inR) return false;
    }
    if (req.dayMin !== undefined && (e.day || 1) < req.dayMin) return false;
    if (req.weather && req.weather !== 'any' && (e.weather || 'clear') !== req.weather) return false;
    if (req.quest) {
      var q = S && S.QUESTS ? S.QUESTS[req.quest.id] : null;
      if (!q || q.state !== req.quest.state) return false;
    }
    if (req.items) {
      var A = window.WAction;
      if (!A || typeof A.count !== 'function') return false;
      for (var item in req.items) {
        if (req.items.hasOwnProperty(item) && A.count(item) < req.items[item]) return false;
      }
    }
    return true;
  }

  function nearestInteractable(px, py) {
    ensureBuilt();
    var best = null, bestD = 44; // ~1.2 tiles + a little reach
    for (var i = 0; i < interactables.length; i++) {
      var it = interactables[i];
      if (it._taken) continue;
      if (!checkReq(it.requires)) continue;
      var dx = Math.max(it.x - px, 0, px - (it.x + it.w));
      var dy = Math.max(it.y - py, 0, py - (it.y + it.h));
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= bestD) { bestD = d; best = it; }
    }
    return best;
  }

  function useInteractable(it, game) {
    if (!it || typeof it.onUse !== 'function') return null;
    it.onUse.call(it, game || window.WGame || null);
    return it;
  }

  function useNearest(px, py, game) {
    return useInteractable(nearestInteractable(px, py), game);
  }

  /* ============================== CLOCK / VIEW ============================== */

  function tickClock() {
    var n = (window.performance && performance.now) ? performance.now() : Date.now();
    if (!lastNow) lastNow = n;
    var dt = (n - lastNow) / 1000;
    lastNow = n;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    time += dt;
    return dt;
  }

  function viewSize(ctx) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var sc = 1;
    try {
      if (ctx.getTransform) {
        var m = ctx.getTransform();
        if (m && m.a > 0) sc = m.a;
      }
    } catch (e) { /* sc stays 1 */ }
    if (vcache.cw !== cw || vcache.ch !== ch || vcache.sc !== sc) {
      vcache.dpr = sc;
      vcache.w = cw / sc;
      vcache.h = ch / sc;
      vcache.cw = cw;
      vcache.ch = ch;
      vcache.sc = sc;
    }
    return vcache;
  }

  /* ============================== LIGHT / GRADE ============================== */

  /* 0 = full day, 1 = deep night. Ramps 17-20 up, 5-7 down. */
  function darkness(h) {
    h = WU.hnorm(h);
    if (h >= 20 || h < 5) return 1;
    if (h >= 18) return (h - 18) / 2;
    if (h < 7) return 1 - (h - 5) / 2;
    return 0;
  }

  /* Keyframes from DESIGN §2. Returns [{op, color}] — may hold two layers
     when adjacent keyframes use different composite ops. Cached per bucket. */
  var KF = [
    [0, 'multiply', 38, 44, 92, 0.55],
    [4, 'multiply', 52, 50, 110, 0.50],
    [5.5, 'screen', 255, 150, 80, 0.18],
    [7, 'screen', 255, 200, 120, 0.10],
    [12, 'screen', 255, 255, 255, 0],
    [17, 'screen', 255, 170, 90, 0.14],
    [19, 'screen', 255, 110, 90, 0.16],
    [20.5, 'multiply', 40, 40, 96, 0.45],
    [22, 'multiply', 24, 30, 72, 0.55]
  ];
  var tintCache = {};

  function rgbaStr(r, g, b, a) {
    return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';
  }

  function hourTint(hour) {
    var h = WU.hnorm(hour);
    var bucket = Math.round(h * 20);
    if (tintCache[bucket]) return tintCache[bucket];

    /* timeline: 0..22 from KF, 22..24 wraps to KF[0] (== hour 0) */
    var a = KF[KF.length - 1], b = KF[0], bEnd = 24;
    for (var i = 0; i < KF.length - 1; i++) {
      if (h >= KF[i][0] && h < KF[i + 1][0]) {
        a = KF[i]; b = KF[i + 1]; bEnd = b[0];
        break;
      }
    }
    var t = (h - a[0]) / (bEnd - a[0]);
    if (t < 0) t = 0; if (t > 1) t = 1;

    var layers;
    if (a[1] === b[1]) {
      layers = [{
        op: a[1],
        color: rgbaStr(
          a[2] + (b[2] - a[2]) * t,
          a[3] + (b[3] - a[3]) * t,
          a[4] + (b[4] - a[4]) * t,
          a[5] + (b[5] - a[5]) * t)
      }];
    } else {
      layers = [
        { op: a[1], color: rgbaStr(a[2], a[3], a[4], a[5] * (1 - t)) },
        { op: b[1], color: rgbaStr(b[2], b[3], b[4], b[5] * t) }
      ];
    }
    tintCache[bucket] = layers;
    return layers;
  }

  /* Convenience: composite the grade full-canvas (main calls after lights). */
  function applyTint(ctx, env) {
    var e = env || api.env || {};
    var layers = hourTint(e.hour !== undefined ? e.hour : 12);
    var vs = viewSize(ctx);
    for (var i = 0; i < layers.length; i++) {
      ctx.globalCompositeOperation = layers[i].op === 'multiply' ? 'multiply' : 'screen';
      ctx.fillStyle = layers[i].color;
      ctx.fillRect(0, 0, vs.w, vs.h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================== DRAW: BACK ============================== */

  function skyColors(h) {
    var dayT = [111, 183, 221], dayH = [207, 232, 239];
    var setT = [124, 110, 166], setH = [242, 169, 107];
    var nT = [16, 21, 50], nH = [35, 44, 85];
    var n = darkness(h);
    var s = Math.exp(-Math.pow(h - 19.3, 2) / 1.4) + Math.exp(-Math.pow(h - 6.2, 2) / 1.1);
    s = clamp(s, 0, 1) * (1 - n);
    var top = WU.mix(dayT, setT, s); top = WU.mix(top, nT, n);
    var hor = WU.mix(dayH, setH, s); hor = WU.mix(hor, nH, n);
    return [top, hor];
  }

  function drawRidge(ctx, color, baseY, amp, phase, offX, offY, vw, vh) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, vh);
    for (var x = 0; x <= vw + 16; x += 16) {
      var y = baseY + offY -
        (Math.sin((x + offX + phase) * 0.011) * amp +
         Math.sin((x + offX) * 0.027 + phase * 2) * amp * 0.5);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(vw, vh);
    ctx.closePath();
    ctx.fill();
  }

  function drawParallax(ctx, cam, vw, vh, h) {
    var cols = skyColors(h);
    var grad = ctx.createLinearGradient(0, 0, 0, vh * 0.6);
    grad.addColorStop(0, WU.rgba(cols[0], 1));
    grad.addColorStop(1, WU.rgba(cols[1], 1));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);

    /* 2 silhouette layers, offset cam.x*0.35 / cam.y*0.2 (DESIGN §13) */
    var offX = cam.x * 0.35, offY = cam.y * 0.2;
    drawRidge(ctx, '#6f86ab', vh * 0.30, 26, 137, offX, offY, vw, vh);
    drawRidge(ctx, '#55688c', vh * 0.36, 34, 511, offX, offY, vw, vh);

    drawNightSky(ctx, vw, vh, offX, offY, h);
  }

  /* ---- night sky: fixed star field + moon, fading in with darkness ---- */
  var stars = null;
  function ensureStars() {
    if (stars) return;
    stars = [];
    var r = WU.seed(0x051AB);   // fixed field: identical every night
    for (var i = 0; i < 70; i++) {
      stars.push({ x: r(), y: r() * 0.6, s: r() < 0.85 ? 1 : 2, ph: r() * 6.283 });
    }
  }

  function drawNightSky(ctx, vw, vh, offX, offY, h) {
    var n = darkness(h);
    if (n <= 0.45) return;
    ensureStars();
    var a = Math.min(1, (n - 0.45) / 0.4);
    var span = vw * 1.35;
    ctx.fillStyle = '#e9f0ff';
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var sx = ((st.x * span - offX * 0.08) % span + span) % span;
      if (sx > vw) continue;
      ctx.globalAlpha = a * (0.45 + 0.4 * Math.sin(time * 1.6 + st.ph));
      ctx.fillRect(sx, st.y * vh, st.s, st.s);
    }
    /* moon with a soft halo (pre-baked sprite, alpha by darkness) */
    var mx = vw * 0.76 - offX * 0.05, my = vh * 0.13 + offY * 0.05;
    glowSpriteAt(ctx, mx, my, 44, ensureGlowSprites('moon'), a);
  }

  function drawWaterTile(ctx, tx, ty, x, y, atlas, isSea, hsIn) {
    var hs = (hsIn === undefined) ? WU.hash2(tx, ty) : hsIn / 255;
    if (atlas) {
      var f = (Math.floor((Math.sin(time * 2) + 1) * 1.999) + ((hs * 4) | 0)) % 4;
      WAssets.sheet(ctx, 'tiles', (TC.water0 + f) * TILE, TC.waterRow * TILE, TILE, TILE, x, y, TILE, TILE);
      if (isSea) {
        ctx.fillStyle = 'rgba(20,40,70,0.12)';
        ctx.fillRect(x, y, TILE, TILE);
      }
    } else {
      ctx.fillStyle = isSea ? PAL.waterSea : PAL.waterLake;
      ctx.fillRect(x, y, TILE, TILE);
    }
    /* moving highlight (sine clock) */
    var ph = (Math.sin(time * 1.7 + (tx * 0.6 + ty * 0.9) * 1.3) + 1) / 2;
    var hx = ((hs * 23 + time * 8) % 26) | 0;
    ctx.fillStyle = PAL.waterHi;
    ctx.fillRect(x + hx, y + 4 + ((ph * 22) | 0) % 24, 9, 2);
    /* foam where water meets land */
    if (edge[idx(tx, ty)]) {
      var up = inMap(tx, ty - 1) && !water[idx(tx, ty - 1)];
      var down = inMap(tx, ty + 1) && !water[idx(tx, ty + 1)];
      var left = inMap(tx - 1, ty) && !water[idx(tx - 1, ty)];
      var right = inMap(tx + 1, ty) && !water[idx(tx + 1, ty)];
      ctx.globalAlpha = 0.5 + 0.35 * Math.sin(time * 2.2 + tx + ty);
      ctx.fillStyle = PAL.foam;
      if (up) ctx.fillRect(x, y, TILE, 3);
      if (down) ctx.fillRect(x, y + TILE - 3, TILE, 3);
      if (left) ctx.fillRect(x, y, 3, TILE);
      if (right) ctx.fillRect(x + TILE - 3, y, 3, TILE);
      ctx.globalAlpha = 1;
      if (atlas && up && isSea) {
        WAssets.sheet(ctx, 'tiles', TC.seaFoam[0] * TILE, TC.seaFoam[1] * TILE, TILE, TILE, x, y, TILE, TILE);
      }
    }
  }

  function drawPierTile(ctx, x, y, atlas) {
    if (atlas) {
      WAssets.sheet(ctx, 'tiles', TC.bridgeH[0] * TILE, TC.bridgeH[1] * TILE, TILE, TILE, x, y, TILE, TILE);
    } else {
      ctx.fillStyle = PAL.wood;
      ctx.fillRect(x, y + 4, TILE, TILE - 8);
      ctx.fillStyle = PAL.woodDark;
      ctx.fillRect(x, y + 4, TILE, 2);
      ctx.fillRect(x, y + TILE - 6, TILE, 2);
      ctx.fillRect(x + 6, y + 6, 2, TILE - 12);
      ctx.fillRect(x + 22, y + 6, 2, TILE - 12);
    }
  }

  function drawGroundTile(ctx, tx, ty, x, y, atlas, hsIn) {
    var i = idx(tx, ty);
    var b = biome[i];
    var hs = (hsIn === undefined) ? WU.hash2(tx, ty) * 256 : hsIn;
    hs = hs / 255;
    var cell = null;
    var base;
    switch (b) {
      case B_FOREST:
        base = PAL.forestFloor[(hs * 2) | 0];
        cell = [TC.forestFloor0 + ((hs * 2) | 0), 2];
        break;
      case B_BEACH:
        base = PAL.beach[(hs * 2) | 0];
        cell = [TC.sand0 + ((hs * 2) | 0), 1];
        break;
      case B_HILLS:
        base = hs < 0.15 ? PAL.rockDark : PAL.hills[(hs * 2) | 0];
        cell = hs < 0.15 ? TC.hillRock : TC.hillGrass;
        if (!inMap(tx, ty + 1) || biome[idx(tx, ty + 1)] !== B_HILLS) cell = TC.terraceEdge;
        break;
      case B_HEAD:
        base = hs < 0.4 ? PAL.head[1] : PAL.head[0];
        cell = hs < 0.4 ? TC.stone2 : TC.stone;
        break;
      default: // meadow
        base = PAL.meadow[(hs * 4) | 0];
        cell = hs < 0.05 ? TC.grassFlower : [(hs * 4) | 0, 0];
        break;
    }
    if (atlas && cell) {
      WAssets.sheet(ctx, 'tiles', cell[0] * TILE, cell[1] * TILE, TILE, TILE, x, y, TILE, TILE);
    } else {
      ctx.fillStyle = base;
      ctx.fillRect(x, y, TILE, TILE);
      if (hs > 0.8) { // sparse detail speck
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        ctx.fillRect(x + ((hs * 97) % 26 | 0), y + ((hs * 53) % 26 | 0), 3, 2);
      }
    }
  }

  function drawPathOverlay(ctx, x, y, atlas) {
    if (atlas) {
      var c = 5 + ((x + y) % 3);
      WAssets.sheet(ctx, 'tiles', c * TILE, 0, TILE, TILE, x, y, TILE, TILE);
    } else {
      ctx.fillStyle = PAL.pathStone;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x + 4, y + 12, 6, 3);
      ctx.fillRect(x + 18, y + 22, 7, 3);
    }
  }

  function drawTrailOverlay(ctx, x, y, atlas) {
    if (atlas) {
      WAssets.sheet(ctx, 'tiles', TC.trailDirt[0] * TILE, TC.trailDirt[1] * TILE, TILE, TILE, x, y, TILE, TILE);
    } else {
      ctx.fillStyle = PAL.trail;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fillRect(x + 8, y + 8, 5, 3);
      ctx.fillRect(x + 20, y + 20, 6, 3);
    }
  }

  function buildGroundCache(ox, oy, cw, ch, atlas) {
    if (!gCache || gCache.width !== cw || gCache.height !== ch) {
      gCache = document.createElement('canvas');
      gCache.width = cw;
      gCache.height = ch;
    }
    var g = gCache.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, ch);
    var tx0 = ox / TILE, ty0 = oy / TILE;
    var tx1 = Math.min(W - 1, ((ox + cw) / TILE) | 0);
    var ty1 = Math.min(H - 1, ((oy + ch) / TILE) | 0);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var i = idx(tx, ty);
        var x = tx * TILE - ox, y = ty * TILE - oy;
        if (water[i]) continue;                 // water stays a live layer
        if (pier[i]) { drawPierTile(g, x, y, atlas); continue; }
        drawGroundTile(g, tx, ty, x, y, atlas, tvar[i]);
        if (path[i]) drawPathOverlay(g, x, y, atlas);
        else if (trail[i]) drawTrailOverlay(g, x, y, atlas);
      }
    }
    gcOx = ox; gcOy = oy; gcW = cw; gcH = ch; gcAtlas = atlas;
  }

  function drawTiles(ctx, cam, vw, vh) {
    var atlas = !!(window.WAssets && WAssets.has('tiles'));
    var tx0 = clamp((cam.x / TILE) | 0, 0, W - 1);
    var ty0 = clamp((cam.y / TILE) | 0, 0, H - 1);
    var tx1 = clamp(((cam.x + vw) / TILE) | 0, 0, W - 1);
    var ty1 = clamp(((cam.y + vh) / TILE) | 0, 0, H - 1);

    /* Fast path: ground/path/trail/pier live in one offscreen canvas and blit
       once per frame; only water tiles (animated) draw individually on top.
       The cache is tile-aligned and carries a few tiles of slack, so it
       re-renders only every few tile crossings, not every frame. Very large
       viewports (vista zoom-out, 4K) skip the cache on a memory gate. */
    var wantW = vw + GC_MARGIN * 2 * TILE;
    var wantH = vh + GC_MARGIN * 2 * TILE;
    if (wantW * wantH <= GC_MAX_PX) {
      var ox = clamp(((cam.x / TILE) | 0) - GC_MARGIN, 0, W - 1) * TILE;
      var oy = clamp(((cam.y / TILE) | 0) - GC_MARGIN, 0, H - 1) * TILE;
      var cw = Math.min(wantW, WPX - ox);
      var ch = Math.min(wantH, HPX - oy);
      if (!gCache || gcW !== cw || gcH !== ch || gcOx !== ox || gcOy !== oy ||
          gcAtlas !== atlas) {
        try { buildGroundCache(ox, oy, cw, ch, atlas); }
        catch (e) { gCache = null; }             // fall back to the direct path
      }
      if (gCache) {
        ctx.drawImage(gCache, gcOx, gcOy);
        for (var wy = ty0; wy <= ty1; wy++) {
          for (var wx = tx0; wx <= tx1; wx++) {
            var wi = idx(wx, wy);
            if (water[wi]) {
              drawWaterTile(ctx, wx, wy, wx * TILE, wy * TILE, atlas,
                biome[wi] === B_SEA, tvar[wi]);
            }
          }
        }
        return;
      }
    }

    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var i = idx(tx, ty);
        var x = tx * TILE, y = ty * TILE;
        if (pier[i]) { drawPierTile(ctx, x, y, atlas); continue; }
        if (water[i]) {
          drawWaterTile(ctx, tx, ty, x, y, atlas, biome[i] === B_SEA, tvar[i]);
          continue;
        }
        drawGroundTile(ctx, tx, ty, x, y, atlas, tvar[i]);
        if (path[i]) drawPathOverlay(ctx, x, y, atlas);
        else if (trail[i]) drawTrailOverlay(ctx, x, y, atlas);
      }
    }
  }

  /* ---- props ---- */

  function rect(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  }

  function drawTree(ctx, p) {
    var sway = Math.sin(time * 1.3 + p.sway) * 2.2;
    var x = p.x, y = p.y; // bottom-centre
    if (p.kind === 'willow_big') {
      rect(ctx, x - 6, y - 34, 12, 34, PAL.trunk);
      ctx.fillStyle = PAL.leaf1;
      ctx.beginPath(); ctx.ellipse(x + sway, y - 72, 44, 26, 0, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = PAL.leaf2;
      ctx.beginPath(); ctx.ellipse(x - 20 + sway, y - 52, 32, 18, 0, 0, WU.TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 22 + sway, y - 55, 28, 16, 0, 0, WU.TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(60,90,55,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var s = 0; s < 4; s++) {
        var dx = -30 + s * 20 + sway;
        ctx.moveTo(x + dx, y - 46);
        ctx.lineTo(x + dx + sway * 0.5, y - 28);
      }
      ctx.stroke();
    } else if (p.kind === 'willow_small') {
      rect(ctx, x - 4, y - 24, 8, 24, PAL.trunk);
      ctx.fillStyle = PAL.leaf2;
      ctx.beginPath(); ctx.ellipse(x + sway, y - 40, 28, 18, 0, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = PAL.leaf3;
      ctx.beginPath(); ctx.ellipse(x + sway * 0.6, y - 28, 20, 12, 0, 0, WU.TAU); ctx.fill();
    } else if (p.kind === 'pine') {
      rect(ctx, x - 4, y - 18, 8, 18, PAL.trunk);
      ctx.fillStyle = PAL.pine;
      ctx.beginPath();
      ctx.moveTo(x - 28 + sway * 0.4, y - 18);
      ctx.lineTo(x + sway, y - 88);
      ctx.lineTo(x + 28 + sway * 0.4, y - 18);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2f5a42';
      ctx.beginPath();
      ctx.moveTo(x - 20 + sway * 0.5, y - 44);
      ctx.lineTo(x + sway, y - 88);
      ctx.lineTo(x + 20 + sway * 0.5, y - 44);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawBuilding(ctx, p) {
    var x = p.x, y = p.y, w = p.w, h = p.h;
    var doorX = (p.dtx !== undefined ? p.dtx * TILE + 8 : x + w / 2 - 8);
    var doorY = y + h - 26;
    switch (p.kind) {
      case 'bakery':
        rect(ctx, x + 4, y + 18, w - 8, h - 22, PAL.wall);
        ctx.fillStyle = PAL.roofRed;
        ctx.beginPath();
        ctx.moveTo(x - 2, y + 20); ctx.lineTo(x + w / 2, y - 4); ctx.lineTo(x + w + 2, y + 20);
        ctx.closePath(); ctx.fill();
        for (var st = 0; st < 8; st++) {
          rect(ctx, x + 6 + st * 14, y + h - 40, 14, 12, st % 2 ? '#c4574a' : '#efe6d2');
        }
        rect(ctx, doorX, doorY, 16, 26, PAL.woodDark);
        rect(ctx, x + 20, y + 30, 20, 16, PAL.lamp);
        rect(ctx, x + w - 44, y + 30, 20, 16, PAL.lamp);
        break;
      case 'shop':
        rect(ctx, x + 4, y + 18, w - 8, h - 22, PAL.wall2);
        ctx.fillStyle = PAL.roofSlate;
        ctx.beginPath();
        ctx.moveTo(x - 2, y + 20); ctx.lineTo(x + w / 2, y - 4); ctx.lineTo(x + w + 2, y + 20);
        ctx.closePath(); ctx.fill();
        rect(ctx, x + 10, y + 24, w - 20, 14, PAL.wood);
        rect(ctx, doorX, doorY, 16, 26, PAL.woodDark);
        rect(ctx, x + 18, y + 44, 24, 16, PAL.lamp);
        break;
      case 'greenhouse':
        ctx.fillStyle = PAL.glass;
        ctx.fillRect(x + 3, y + 14, w - 6, h - 18);
        ctx.strokeStyle = PAL.glassHi;
        ctx.lineWidth = 2;
        for (var gp = 1; gp < 5; gp++) {
          ctx.beginPath();
          ctx.moveTo(x + 3 + gp * (w - 6) / 5, y + 14);
          ctx.lineTo(x + 3 + gp * (w - 6) / 5, y + h - 4);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(x - 2, y + 16); ctx.lineTo(x + w / 2, y - 6); ctx.lineTo(x + w + 2, y + 16);
        ctx.closePath(); ctx.fill();
        rect(ctx, doorX, doorY, 16, 26, PAL.woodDark);
        break;
      case 'hut':
        rect(ctx, x + 4, y + 20, w - 8, h - 24, PAL.wood);
        ctx.strokeStyle = PAL.woodDark;
        ctx.lineWidth = 1;
        for (var pl = 0; pl < 4; pl++) {
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 24 + pl * 8);
          ctx.lineTo(x + w - 4, y + 24 + pl * 8);
          ctx.stroke();
        }
        ctx.fillStyle = '#7a5c3a';
        ctx.beginPath();
        ctx.moveTo(x - 4, y + 22); ctx.lineTo(x + w / 2, y + 2); ctx.lineTo(x + w + 4, y + 22);
        ctx.closePath(); ctx.fill();
        rect(ctx, doorX, doorY, 16, 26, '#4a3524');
        break;
      case 'tent':
        ctx.fillStyle = PAL.tent;
        ctx.beginPath();
        ctx.moveTo(x - 4, y + h); ctx.lineTo(x + w / 2, y - 6); ctx.lineTo(x + w + 4, y + h);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.tentDark;
        ctx.beginPath();
        ctx.moveTo(x + w / 2 - 10, y + h); ctx.lineTo(x + w / 2, y + h - 22); ctx.lineTo(x + w / 2 + 10, y + h);
        ctx.closePath(); ctx.fill();
        break;
      case 'lighthouse': {
        rect(ctx, x, y + h - 10, w, 10, PAL.rockDark);
        var bands = 5, bh = (h - 26) / bands, w0 = w - 12, topW = w0 * 0.55;
        for (var b2 = 0; b2 < bands; b2++) {
          var ft = b2 / (bands - 1);
          var xx = x + 6 + (w0 - topW) / 2 * ft;
          var ww = w0 - (w0 - topW) * ft;
          rect(ctx, xx, y + h - 10 - (b2 + 1) * bh, ww, bh + 1, b2 % 2 ? '#e9e4da' : '#c65b4a');
        }
        var lx = x + w / 2;
        rect(ctx, lx - 17, y + 5, 34, 15, '#3a4250');
        rect(ctx, lx - 12, y + 9, 24, 8, PAL.lamp);
        rect(ctx, lx - 19, y + 3, 38, 3, '#2c3340');
        rect(ctx, lx - 8, y + h - 32, 16, 24, '#4a3524');
        break;
      }
      case 'windmill_ruin':
        ctx.fillStyle = PAL.rock;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + h); ctx.lineTo(x + 16, y + 10); ctx.lineTo(x + w - 14, y + 22);
        ctx.lineTo(x + w - 6, y + h); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = PAL.woodDark;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y + 16); ctx.lineTo(x + w / 2 + 30, y - 8);
        ctx.moveTo(x + w / 2, y + 16); ctx.lineTo(x + w / 2 - 14, y - 14);
        ctx.stroke();
        break;
      case 'shed':
        rect(ctx, x + 4, y + 10, w - 8, h - 10, PAL.wood);
        ctx.fillStyle = '#5f4630';
        ctx.beginPath();
        ctx.moveTo(x - 2, y + 12); ctx.lineTo(x + w / 2, y - 4); ctx.lineTo(x + w + 2, y + 12);
        ctx.closePath(); ctx.fill();
        rect(ctx, doorX, doorY + 4, 14, 20, '#3d2c1c');
        break;
      case 'well':
        ctx.fillStyle = PAL.rock;
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h - 8, w / 2 - 2, 10, 0, 0, WU.TAU); ctx.fill();
        rect(ctx, x + 6, y + h - 40, 4, 34, PAL.wood);
        rect(ctx, x + w - 10, y + h - 40, 4, 34, PAL.wood);
        ctx.fillStyle = PAL.roofRed;
        ctx.beginPath();
        ctx.moveTo(x - 2, y + h - 36); ctx.lineTo(x + w / 2, y + h - 52); ctx.lineTo(x + w + 2, y + h - 36);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2c4a63';
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h - 9, w / 2 - 10, 6, 0, 0, WU.TAU); ctx.fill();
        break;
      case 'notice_board':
        rect(ctx, x + 6, y + 8, 4, 24, PAL.woodDark);
        rect(ctx, x + w - 10, y + 8, 4, 24, PAL.woodDark);
        rect(ctx, x + 2, y, w - 4, 18, PAL.wood);
        rect(ctx, x + 6, y + 3, 12, 10, '#f4efdf');
        rect(ctx, x + 22, y + 3, 12, 12, '#e6dcc2');
        break;
    }
  }

  function vectorProp(ctx, p) {
    var x = p.x, y = p.y;
    switch (p.kind) {
      case 'willow_big': case 'willow_small': case 'pine':
        drawTree(ctx, p); break;
      case 'bush':
        ctx.fillStyle = PAL.leaf3;
        ctx.beginPath(); ctx.ellipse(x, y - 8, 12, 9, 0, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = PAL.leaf2;
        ctx.beginPath(); ctx.ellipse(x - 4, y - 11, 8, 6, 0, 0, WU.TAU); ctx.fill();
        break;
      case 'rock': case 'rock_big': {
        var r = p.kind === 'rock_big' ? 2 : 1;
        ctx.fillStyle = PAL.rock;
        ctx.beginPath();
        ctx.moveTo(x - 14 * r, y);
        ctx.lineTo(x - 10 * r, y - 12 * r);
        ctx.lineTo(x + 2 * r, y - 16 * r);
        ctx.lineTo(x + 13 * r, y - 8 * r);
        ctx.lineTo(x + 14 * r, y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.rockDark;
        ctx.fillRect(x - 8 * r, y - 6 * r, 10 * r, 3 * r);
        break;
      }
      case 'flowers': {
        var hs = WU.hash2(p.x | 0, p.y | 0);
        var cols = ['#f2b6c6', '#f7e08c', '#f4f4f4', '#c9a7eb'];
        for (var f = 0; f < 3; f++) {
          ctx.fillStyle = cols[(hs * 7 + f) % 4 | 0];
          ctx.fillRect(x - 8 + f * 8 + (hs * 6 | 0), y - 6 - (f % 2) * 4, 3, 3);
        }
        break;
      }
      case 'reeds':
        ctx.strokeStyle = '#6f9457';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var rd = 0; rd < 4; rd++) {
          var rx = x - 8 + rd * 6;
          ctx.moveTo(rx, y);
          ctx.quadraticCurveTo(rx + 2, y - 16, rx + Math.sin(time * 1.5 + rd) * 3, y - 26);
        }
        ctx.stroke();
        break;
      case 'lamp_post':
        rect(ctx, x - 2, y - 44, 4, 44, '#3a4250');
        rect(ctx, x - 6, y - 54, 12, 12, '#3a4250');
        rect(ctx, x - 4, y - 52, 8, 8, PAL.lamp);
        break;
      case 'sign':
        rect(ctx, x - 2, y - 26, 4, 26, PAL.woodDark);
        rect(ctx, x - 12, y - 38, 24, 14, PAL.wood);
        ctx.strokeStyle = 'rgba(60,45,30,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 33); ctx.lineTo(x + 8, y - 33);
        ctx.moveTo(x - 8, y - 29); ctx.lineTo(x + 4, y - 29);
        ctx.stroke();
        break;
      case 'bench':
        rect(ctx, x - 14, y - 14, 28, 5, PAL.wood);
        rect(ctx, x - 14, y - 26, 28, 4, PAL.wood);
        rect(ctx, x - 12, y - 10, 3, 10, PAL.woodDark);
        rect(ctx, x + 9, y - 10, 3, 10, PAL.woodDark);
        break;
      case 'sheep': {
        var bob = Math.sin(time * 1.4 + p.sway) * 1.2;
        ctx.fillStyle = PAL.sheep;
        ctx.beginPath(); ctx.ellipse(x, y - 9 + bob, 11, 8, 0, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath(); ctx.ellipse(x + 9, y - 13 + bob, 4, 3.5, 0, 0, WU.TAU); ctx.fill();
        rect(ctx, x - 6, y - 3 + bob, 2, 4, '#3a3a3a');
        rect(ctx, x + 3, y - 3 + bob, 2, 4, '#3a3a3a');
        break;
      }
      case 'boat':
        ctx.fillStyle = '#7a5c3a';
        ctx.beginPath();
        ctx.moveTo(x - 26, y - 8);
        ctx.quadraticCurveTo(x, y + 4, x + 26, y - 8);
        ctx.quadraticCurveTo(x, y - 14, x - 26, y - 8);
        ctx.closePath(); ctx.fill();
        rect(ctx, x - 3, y - 26, 2, 18, PAL.woodDark);
        break;
      case 'hive':
        ctx.fillStyle = PAL.hive;
        ctx.beginPath(); ctx.ellipse(x, y - 10, 11, 12, 0, 0, WU.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,80,20,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 9, y - 8); ctx.lineTo(x + 9, y - 8);
        ctx.moveTo(x - 10, y - 13); ctx.lineTo(x + 10, y - 13);
        ctx.stroke();
        ctx.fillStyle = '#5c3d12';
        ctx.fillRect(x - 2, y - 6, 4, 4);
        break;
      case 'pool':
        ctx.fillStyle = PAL.rock;
        ctx.beginPath(); ctx.ellipse(x, y - 4, 14, 8, 0, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = '#5b9cc7';
        ctx.beginPath(); ctx.ellipse(x, y - 5, 9, 5, 0, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x - 4, y - 7, 4, 1);
        break;
      case 'stone':
        ctx.fillStyle = '#a8adb0';
        ctx.beginPath();
        ctx.moveTo(x - 10, y); ctx.lineTo(x - 7, y - 20); ctx.lineTo(x + 6, y - 24);
        ctx.lineTo(x + 11, y - 6); ctx.lineTo(x + 8, y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8f9497';
        ctx.fillRect(x - 5, y - 14, 10, 3);
        break;
      default:
        if (BUILDING_KINDS[p.kind]) drawBuilding(ctx, p);
    }
  }

  var BUILDING_KINDS = {
    bakery: 1, shop: 1, greenhouse: 1, hut: 1, tent: 1, lighthouse: 1,
    windmill_ruin: 1, shed: 1, well: 1, notice_board: 1
  };

  /* Story-owned interactables (story.js) have no atlas cells: draw them as
     vector art, visible exactly when their E prompt is (checkReq sync).
     DESIGN §3.2 — moonbell "night-bloom… glows"; the lamb bleats in the
     forest after dark. */
  function drawStoryInteractables(ctx, cam, vw, vh) {
    for (var i = 0; i < interactables.length; i++) {
      var it = interactables[i];
      if (it._taken) continue;
      if (it.id !== 'moonbell' && it.id !== 'lost_lamb' && it.id !== 'arcade_cabinet') continue;
      if (it.x > cam.x + vw + 48 || it.x + it.w < cam.x - 48 ||
          it.y > cam.y + vh + 48 || it.y + it.h < cam.y - 48) continue;
      if (!checkReq(it.requires)) continue;
      var cx = it.x + it.w / 2, base = it.y + TILE;   // tile bottom = ground line
      if (it.id === 'moonbell') {
        /* pale bloom on a stem with a soft night glow */
        var pulse = 0.75 + 0.25 * Math.sin(time * 2.1);
        glowSpriteAt(ctx, cx, base - 20, 26, ensureGlowSprites('cool'), 0.42 * pulse);
        ctx.strokeStyle = '#4f7a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, base);
        ctx.quadraticCurveTo(cx + 3, base - 10, cx, base - 18);
        ctx.stroke();
        ctx.fillStyle = '#dff3ff';
        for (var p = 0; p < 5; p++) {
          var a = p / 5 * WU.TAU + time * 0.4;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(a) * 5, base - 20 + Math.sin(a) * 5, 4, 2.4, a, 0, WU.TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.arc(cx, base - 20, 2.4, 0, WU.TAU); ctx.fill();
      } else if (it.id === 'arcade_cabinet') {
        /* squat cabinet, ~24 px wide, 34 px tall; the screen flickers with a
           light that is not the lamp's — a hint of what lives inside */
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(cx, base + 1, 14, 3.5, 0, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = '#141422';                                  // body
        ctx.fillRect(cx - 12, base - 34, 24, 34);
        ctx.strokeStyle = '#2b2b45';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 11.5, base - 33.5, 23, 33);
        ctx.fillStyle = '#1e1e33';                                  // marquee
        ctx.fillRect(cx - 11, base - 34, 22, 6);
        var mk = 0.5 + 0.5 * Math.sin(time * 3.1);
        ctx.fillStyle = 'rgba(53,230,255,' + (0.25 + 0.4 * mk) + ')';
        ctx.fillRect(cx - 9, base - 32.5, 18, 3);
        ctx.fillStyle = '#05050e';                                  // screen
        ctx.fillRect(cx - 9, base - 26, 18, 14);
        var sc = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 7.3 + 1.7));
        ctx.fillStyle = 'rgba(53,230,255,' + (0.55 * sc) + ')';
        ctx.fillRect(cx - 7, base - 24, 14, 10);
        ctx.fillStyle = 'rgba(255,45,149,' + (0.5 * sc) + ')';       // pixel sprite
        ctx.fillRect(cx - 3 + Math.sin(time * 2.2) * 3, base - 22, 5, 5);
        ctx.fillStyle = '#2b2b45';                                  // controls
        ctx.fillRect(cx - 9, base - 10, 18, 4);
        ctx.fillStyle = '#ff5fa8';
        ctx.beginPath(); ctx.arc(cx - 4, base - 8, 1.6, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = '#35e6ff';
        ctx.beginPath(); ctx.arc(cx + 4, base - 8, 1.6, 0, WU.TAU); ctx.fill();
        if (glowSpriteAt) {
          glowSpriteAt(ctx, cx, base - 20, 22, ensureGlowSprites('cool'), 0.18 + 0.12 * sc);
        }
      } else {
        /* the lamb: small white body + head, gentle bob */
        var bob = Math.sin(time * 2.2) * 1.2;
        var ly = base - 10 + bob;
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath(); ctx.ellipse(cx, base, 10, 3, 0, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = PAL.sheep;
        ctx.beginPath(); ctx.ellipse(cx - 2, ly, 9, 6.5, 0, 0, WU.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 7, ly - 4, 4, 0, WU.TAU); ctx.fill();
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(cx + 6, ly - 8, 2, 2);
        ctx.fillRect(cx - 6, ly + 3, 2, 4);
        ctx.fillRect(cx + 1, ly + 3, 2, 4);
      }
    }
  }

  /* §3.2 outcome scenery: quest results leave visible marks on the world —
     the greenhouse bloom, Rosa's erupting show bed, the replanted moonbell
     at the tower base, the shop-roof kite, Bramble's forest gate and old
     Siltjaw's fin by the pier (junie_leaves moves her schedule in npcs.js).
     All draw-only, each gated by one flag read and viewport-checked. */
  function storyFlag(k) {
    var S = window.WStory;
    return !!(S && typeof S.flag === 'function' && S.flag(k));
  }

  function inView(x, y, cam, vw, vh, m) {
    return x > cam.x - m && x < cam.x + vw + m &&
           y > cam.y - m && y < cam.y + vh + m;
  }

  function flowerTuft(ctx, x, y, c) {
    ctx.fillStyle = '#3f6d3a';
    ctx.fillRect(x - 1, y - 5, 2, 5);
    ctx.fillStyle = c;
    ctx.fillRect(x - 2, y - 9, 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - 1, y - 8, 1.5, 1.5);
  }

  function drawStoryProps(ctx, cam, vw, vh) {
    var T = TILE;
    var cols = ['#f2b6c6', '#f7e08c', '#f4f4f4', '#c9a7eb'];
    var i, x, y;

    /* honey_to_gideon — the greenhouse blooms out of season */
    if (storyFlag('honey_to_gideon')) {
      for (i = 0; i < 10; i++) {
        x = (31 + (i % 5)) * T + 6 + ((i * 13) % 18);
        y = (33 + ((i / 5) | 0)) * T + 6 + ((i * 7) % 12);
        if (inView(x, y, cam, vw, vh, 32)) flowerTuft(ctx, x, y, cols[i % 4]);
      }
    }

    /* seeds_gifted — Rosa's show bed erupts in colour */
    if (storyFlag('seeds_gifted')) {
      for (i = 0; i < 10; i++) {
        x = (50 + (i % 5)) * T + 4 + ((i * 11) % 20);
        y = (57 + ((i / 5) | 0)) * T + 4 + ((i * 5) % 12);
        if (inView(x, y, cam, vw, vh, 32)) flowerTuft(ctx, x, y, cols[(i + 2) % 4]);
      }
    }

    /* show_won — the moonbell replanted where a keeper can see it glows */
    if (storyFlag('show_won')) {
      var mbx = 71 * T + 16, mby = 86 * T;      // beside the tower door
      if (inView(mbx, mby, cam, vw, vh, 48)) {
        var e2 = api.env || {};
        var dark = darkness(e2.hour !== undefined ? e2.hour : 12);
        var pulse = 0.75 + 0.25 * Math.sin(time * 2.1);
        glowSpriteAt(ctx, mbx, mby - 20, 26, ensureGlowSprites('cool'),
          (0.18 + 0.4 * dark) * pulse);
        ctx.strokeStyle = '#4f7a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mbx, mby);
        ctx.quadraticCurveTo(mbx + 3, mby - 10, mbx, mby - 18);
        ctx.stroke();
        ctx.fillStyle = '#dff3ff';
        for (var p2 = 0; p2 < 5; p2++) {
          var a3 = p2 / 5 * WU.TAU + time * 0.4;
          ctx.beginPath();
          ctx.ellipse(mbx + Math.cos(a3) * 5, mby - 20 + Math.sin(a3) * 5,
            4, 2.4, a3, 0, WU.TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.arc(mbx, mby - 20, 2.4, 0, WU.TAU); ctx.fill();
      }
    }

    /* parcel_kite — the kite flies from the shop roof, "a flag for no nation" */
    if (storyFlag('parcel_kite')) {
      var ax = 1312, ay = 46 * T - 6;           // shop roof apex
      var kx = ax + Math.sin(time * 0.8) * 10;
      var ky = ay - 64 + Math.cos(time * 0.6) * 8;
      if (inView(kx, ky, cam, vw, vh, 80)) {
        ctx.strokeStyle = 'rgba(90,70,50,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + kx) / 2 + 6, (ay + ky) / 2, kx, ky);
        ctx.stroke();
        ctx.fillStyle = '#e2574c';
        ctx.beginPath();
        ctx.moveTo(kx, ky - 12);
        ctx.lineTo(kx + 8, ky);
        ctx.lineTo(kx, ky + 16);
        ctx.lineTo(kx - 8, ky);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f7e08c';
        ctx.beginPath();
        ctx.moveTo(kx, ky - 12);
        ctx.lineTo(kx + 8, ky);
        ctx.lineTo(kx, ky);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7ec8e0';
        ctx.fillRect(kx - 2 + Math.sin(time * 2.2) * 3, ky + 22, 4, 3);
        ctx.fillRect(kx - 4 + Math.sin(time * 2.6 + 1) * 5, ky + 30, 4, 3);
      }
    }

    /* lamb_led — the new gate at the forest edge opens easily */
    if (storyFlag('lamb_led')) {
      var gx = 30 * T, gy = 30 * T;             // north trail x the forest line
      if (inView(gx, gy, cam, vw, vh, 64)) {
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(gx - 3, gy - 26, 5, 26);
        ctx.fillRect(gx + TILE - 2, gy - 26, 5, 26);
        ctx.fillStyle = PAL.woodDark;
        ctx.fillRect(gx - 5, gy - 26, TILE + 10, 4);
        ctx.fillRect(gx - 3, gy - 16, TILE + 6, 3);
        ctx.fillRect(gx - 3, gy - 7, TILE + 6, 3);
      }
    }

    /* siltjaw_freed — every so often the big fin tips the water by the pier */
    if (storyFlag('siltjaw_freed')) {
      var cyc = time % 18;
      if (cyc < 5) {
        var fh = Math.sin(cyc / 5 * Math.PI);
        if (fh > 0.08) {
          var fix = 72.5 * T, fiy = 46.5 * T + 6;
          if (inView(fix, fiy, cam, vw, vh, 48)) {
            var hh = fh * 10;
            ctx.fillStyle = '#43575e';
            ctx.beginPath();
            ctx.moveTo(fix - 9, fiy);
            ctx.quadraticCurveTo(fix - 1, fiy - hh * 1.6, fix + 8, fiy - hh * 0.4);
            ctx.quadraticCurveTo(fix, fiy - hh * 0.2, fix - 9, fiy);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(235,248,255,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(fix, fiy + 1, 14 * fh, 3 * fh, 0, 0, WU.TAU);
            ctx.stroke();
          }
        }
      }
    }
  }

  function drawProps(ctx, cam, vw, vh) {    frame++;
    var hasDecor = !!(window.WAssets && WAssets.has('decor'));
    var hasProps = !!(window.WAssets && WAssets.has('props'));
    var tx0 = clamp((cam.x / TILE) | 0, 0, W - 1);
    var ty0 = clamp((cam.y / TILE) | 0, 0, H - 1);
    var tx1 = clamp(((cam.x + vw) / TILE) | 0, 0, W - 1);
    var ty1 = clamp(((cam.y + vh) / TILE) | 0, 0, H - 1);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var cell = propGrid[idx(tx, ty)];
        if (!cell) continue;
        for (var k = 0; k < cell.length; k++) {
          var p = props[cell[k]];
          if (p._f === frame) continue;
          p._f = frame;
          var bx0 = p.anchor === 'tl' ? p.x : p.x - p.w / 2;
          var by0 = p.anchor === 'tl' ? p.y : p.y - p.h;
          if (bx0 > cam.x + vw || bx0 + p.w < cam.x || by0 > cam.y + vh || by0 + p.h < cam.y) continue;

          var useSheet = p.cells && (p.sheet === 'props' ? hasProps : hasDecor);
          if (useSheet && window.WAssets) {
            var fc = p.cells;
            if (p.kind === 'sheep') {
              var fr = ((time * 1.4 + p.sway) | 0) % 3;
              fc = [7 + fr, 8, 1, 1];
            }
            if (p.anchor === 'tl') {
              WAssets.sheet(ctx, p.sheet, fc[0] * TILE, fc[1] * TILE, fc[2] * TILE, fc[3] * TILE, p.x, p.y, p.w, p.h);
            } else {
              WAssets.sheet(ctx, p.sheet, fc[0] * TILE, fc[1] * TILE, fc[2] * TILE, fc[3] * TILE,
                p.x - p.w / 2, p.y - p.h, p.w, p.h);
            }
          } else {
            vectorProp(ctx, p);
          }
        }
      }
    }
  }

  /* hearth chimneys that raise a thin smoke thread (view-culled; §1 hook:
     "every chimney in Willowmere smokes like a friendly word") */
  var CHIMNEYS = [
    { x: 28 * TILE, y: 47 * TILE - 2 },      // bakery
    { x: 29.5 * TILE, y: 54 * TILE - 4 },    // the Warden's cottage
    { x: 47.5 * TILE, y: 52 * TILE - 4 },    // Rosa's cottage
    { x: 103.5 * TILE, y: 70 * TILE }        // Marlow's hut
  ];

  /* ambient weather + wildlife emission (fireflies 20:00-02:00, forest leaves) */
  function ambient(dt, cam, vw, vh) {
    var e = api.env;
    if (!e || !window.WParticles) return;
    var h = WU.hnorm(e.hour !== undefined ? e.hour : 12);
    if (e.weather === 'rain') WParticles.setRain(1);
    else WParticles.setRain(0);
    WParticles.view.x = cam.x;
    WParticles.view.y = cam.y;
    WParticles.view.w = vw;
    WParticles.view.h = vh;
    if (h >= 20 || h < 2) {
      ffTimer -= dt;
      while (ffTimer <= 0) {
        ffTimer += WU.rand(0.25, 0.7);
        var fx = cam.x + WU.rand(0, vw), fy = cam.y + WU.rand(0, vh);
        var fb = biomeAt((fx / TILE) | 0, (fy / TILE) | 0);
        if (fb === 'forest' || fb === 'meadow') {
          WParticles.emit('firefly', fx, fy, { life: WU.rand(4, 8) });
        }
      }
    }
    var cb = biomeAt(((cam.x + vw / 2) / TILE) | 0, ((cam.y + vh / 2) / TILE) | 0);
    if (cb === 'forest') {
      leafTimer -= dt;
      while (leafTimer <= 0) {
        leafTimer += WU.rand(0.35, 0.9);
        var lx = cam.x + WU.rand(0, vw), ly = cam.y + WU.rand(0, vh * 0.6);
        if (biomeAt((lx / TILE) | 0, (ly / TILE) | 0) === 'forest') {
          WParticles.emit('leaf', lx, ly - 40, { vy: 26 });
        }
      }
    }

    /* thin chimney smoke so the village visibly breathes (view-culled,
       a few particles/sec: negligible against the 400 pool) */
    smokeT -= dt;
    while (smokeT <= 0) {
      smokeT += WU.rand(0.55, 1.15);
      for (var ci = 0; ci < CHIMNEYS.length; ci++) {
        var ch = CHIMNEYS[ci];
        if (ch.x < cam.x - 60 || ch.x > cam.x + vw + 60 ||
            ch.y < cam.y - 80 || ch.y > cam.y + vh + 60) continue;
        if (WU.chance(0.65)) {
          WParticles.emit('dust', ch.x + WU.rand(-2, 2), ch.y, {
            vx: WU.rand(3, 12) + (e.weather === 'rain' ? 10 : 0),
            vy: -14 - WU.rand(0, 8),
            life: WU.rand(1.7, 2.6),
            size: 2,
            color: 'rgba(208,208,214,0.85)'
          });
        }
      }
    }
  }

  function drawBack(ctx, cam, env) {
    ensureBuilt();
    api.env = env || api.env;
    var dt = tickClock();
    var vs = viewSize(ctx);
    var vw = vs.w, vh = vs.h;
    var e = api.env || {};
    var h = WU.hnorm(e.hour !== undefined ? e.hour : 12);

    drawParallax(ctx, cam, vw, vh, h);
    /* tiles + props are drawn in world px: apply the camera here (drawOver
       and drawLights do their own matching translate). */
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    drawTiles(ctx, cam, vw, vh);
    drawProps(ctx, cam, vw, vh);
    drawStoryInteractables(ctx, cam, vw, vh);
    drawStoryProps(ctx, cam, vw, vh);
    ctx.restore();
    ambient(dt, cam, vw, vh);
  }

  /* ============================== DRAW: OVER ============================== */

  function drawOver(ctx, cam, env) {
    ensureBuilt();
    api.env = env || api.env;
    tickClock();
    var vs = viewSize(ctx);
    var vw = vs.w, vh = vs.h;
    var e = api.env || {};

    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

    /* canopy shadows under trees — the tree list is fixed at build() */
    ctx.fillStyle = 'rgba(10,20,15,0.13)';
    for (var ti = 0; ti < treeList.length; ti++) {
      var p = props[treeList[ti]];
      if (p.x < cam.x - 80 || p.x > cam.x + vw + 80 ||
          p.y < cam.y - 40 || p.y > cam.y + vh + 40) continue;
      var big = p.kind === 'willow_big';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 2, big ? 30 : 20, big ? 11 : 8, 0, 0, WU.TAU);
      ctx.fill();
    }

    /* 3 drifting cloud shadows, alpha 0.08 */
    ctx.fillStyle = 'rgba(20,30,40,0.08)';
    for (var c = 0; c < 3; c++) {
      var cx = ((c * 1730 + time * 16) % (WPX + 900)) - 450;
      var cy = ((c * 1100 + time * 11) % (HPX + 700)) - 350;
      if (cx + 320 < cam.x || cx - 320 > cam.x + vw || cy + 180 < cam.y || cy - 180 > cam.y + vh) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 300, 150, 0, 0, WU.TAU);
      ctx.fill();
    }

    /* water rim glints on the build-time edge list (no viewport grid scan) */
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (var ei = 0; ei < edgeList.length; ei += 2) {
      var tx = edgeList[ei], ty = edgeList[ei + 1];
      if (tx * TILE < cam.x - TILE || tx * TILE > cam.x + vw ||
          ty * TILE < cam.y - TILE || ty * TILE > cam.y + vh) continue;
      var gl = 0.10 + 0.14 * Math.sin(time * 2.5 + tvar[idx(tx, ty)] * 0.0246);
      if (gl <= 0.02) continue;
      ctx.globalAlpha = gl;
      if (inMap(tx, ty - 1) && !water[idx(tx, ty - 1)]) ctx.fillRect(tx * TILE + 6, ty * TILE + 2, 9, 2);
      if (inMap(tx, ty + 1) && !water[idx(tx, ty + 1)]) ctx.fillRect(tx * TILE + 14, ty * TILE + TILE - 4, 9, 2);
    }
    ctx.globalAlpha = 1;

    /* wet glints on sand paths while raining (same build-time list) */
    if (e.weather === 'rain') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (var wi = 0; wi < wetList.length; wi += 2) {
        var wx = wetList[wi], wy = wetList[wi + 1];
        if (wx * TILE < cam.x - TILE || wx * TILE > cam.x + vw ||
            wy * TILE < cam.y - TILE || wy * TILE > cam.y + vh) continue;
        ctx.globalAlpha = 0.06 + 0.08 * Math.sin(time * 3 + tvar[idx(wx, wy)] * 0.0353);
        ctx.fillRect(wx * TILE + 8, wy * TILE + 10, 10, 2);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /* ============================== DRAW: LIGHTS ============================== */

  /* Radial glows are pre-baked sprites (created once, blitted with
     globalAlpha) — createRadialGradient per torch per frame was the most
     expensive op on night frames. */
  var glowSprites = null;
  function ensureGlowSprites(which) {
    if (!glowSprites) {
      function radial(size, r, g, b) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var g2 = c.getContext('2d');
        var grad = g2.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.9)');
        grad.addColorStop(0.4, 'rgba(' + r + ',' + g + ',' + b + ',0.4)');
        grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
        g2.fillStyle = grad;
        g2.fillRect(0, 0, size, size);
        return c;
      }
      glowSprites = {
        warm: radial(128, 255, 205, 130),   // torch / lantern light
        cool: radial(128, 190, 235, 255),   // moonbell bloom
        moon: radial(128, 236, 241, 255)    // lunar halo
      };
    }
    return glowSprites[which];
  }

  function glowSpriteAt(ctx, x, y, r, sp, alpha) {
    if (!sp) return;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  /* Lighthouse beam: a pre-baked wedge sprite (apex at 0, half-width), spun
     with rotate() — no gradients or arc fills per frame. */
  var beamSprite = null;
  function ensureBeam() {
    if (beamSprite) return beamSprite;
    var c = document.createElement('canvas');
    c.width = 256;
    c.height = 56;                       // apex (0,28), opening toward +x
    var g2 = c.getContext('2d');
    var grad = g2.createRadialGradient(0, 28, 10, 0, 28, 256);
    grad.addColorStop(0, 'rgba(255,244,200,1)');
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    g2.fillStyle = grad;
    g2.beginPath();
    g2.moveTo(0, 28);
    g2.lineTo(256, 0);
    g2.lineTo(256, 56);
    g2.closePath();
    g2.fill();
    beamSprite = c;
    return c;
  }

  function lampLit() {
    var S = window.WStory;
    return !!(S && S.lampLit);
  }

  function drawLights(ctx, cam, env) {
    ensureBuilt();
    api.env = env || api.env;
    var vs = viewSize(ctx);
    var vw = vs.w, vh = vs.h;
    var e = api.env || {};
    var h = WU.hnorm(e.hour !== undefined ? e.hour : 12);
    var d = darkness(h);
    var lit = lampLit();
    if (d <= 0.02 && !lit) return;

    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    ctx.globalCompositeOperation = 'lighter';

    if (d > 0.02) {
      /* torches / lamp posts: r200 additive glows with flicker */
      for (var i = 0; i < torches.length; i++) {
        var t = torches[i];
        if (t.x < cam.x - 220 || t.x > cam.x + vw + 220 || t.y < cam.y - 220 || t.y > cam.y + vh + 220) continue;
        var flick = 0.9 + 0.1 * Math.sin(time * 6 + i * 2.1);
        glowSpriteAt(ctx, t.x, t.y, 200, ensureGlowSprites('warm'), 0.30 * d * flick);
      }
      /* player lantern: r140 */
      var pl = e.player;
      if (pl && typeof pl.x === 'number') {
        glowSpriteAt(ctx, pl.x, pl.y, 140, ensureGlowSprites('warm'), 0.28 * d);
      }
    }

    /* lighthouse beam — rotating, only after the lamp is relit */
    if (lit) {
      var lx = 69.5 * TILE, ly = 79 * TILE + 16;
      var ang = time * 0.5;
      var bs = ensureBeam();
      var blen = 760, bh = 56 * (blen / 256);
      for (var k = 0; k < 2; k++) {
        var a2 = ang + k * Math.PI;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(a2);
        ctx.globalAlpha = 0.30 * Math.max(0.25, d);
        ctx.drawImage(bs, 0, -bh / 2, blen, bh);
        ctx.restore();
      }
    }

    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================== API ============================== */

  api = {
    TILE: TILE,
    W: W,
    H: H,
    SKY_H: SKY_H,
    MAP_SEED: MAP_SEED,
    env: null,

    build: build,
    isBuilt: function () { return built; },

    /* Camera clamp rect — includes a 224px sky margin at the north so the
       parallax hill silhouettes can be seen. */
    bounds: function () {
      return { x: 0, y: -SKY_H, w: WPX, h: HPX + SKY_H };
    },

    biomeAt: biomeAt,
    solidAt: solidAt,
    waterAt: waterAt,
    weatherRoll: weatherRoll,

    poi: poi,
    vistas: vistas,
    interactables: interactables,
    torches: torches,
    hooks: {}, // later stages may override per-id: WWorld.hooks.door_lighthouse = fn

    vistaAt: vistaAt,
    markVistaSeen: markVistaSeen,
    vistaSeen: vistaSeen,
    checkReq: checkReq,
    nearestInteractable: nearestInteractable,
    useInteractable: useInteractable,
    useNearest: useNearest,

    darknessAt: darkness,
    hourTint: hourTint,
    applyTint: applyTint,

    drawBack: drawBack,
    drawOver: drawOver,
    drawLights: drawLights
  };

  /* interactable hooks: an override set by a later stage wins over built-ins */
  var baseUseNearest = useNearest;
  api.useNearest = function (px, py, game) {
    var it = nearestInteractable(px, py);
    if (!it) return null;
    var hook = api.hooks[it.id];
    if (typeof hook === 'function') {
      hook.call(it, game || window.WGame || null);
      return it;
    }
    return baseUseNearest(px, py, game);
  };

  return api;
})();
