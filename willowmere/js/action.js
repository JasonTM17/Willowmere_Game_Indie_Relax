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
    critter_butterfly: { name: 'Bướm', desc: 'Cánh đồng cỏ, 7:00\u201317:00.', kind: 'critter' },
    critter_cricket: { name: 'Dế', desc: 'Nhạc công buổi tối, 18:00\u201323:00.', kind: 'critter' },
    critter_oak_beetle: { name: 'Bọ sồi', desc: 'Bóng loáng rừng, 8:00\u201317:00.', kind: 'critter' },
    critter_firefly: { name: 'Đom đóm', desc: 'Đèn lồng rừng, 20:00\u201302:00.', kind: 'critter' },
    critter_luna_moth: { name: 'Bướm trăng', desc: 'Bướm nhạt quý hiếm, 21:00\u201302:00.', kind: 'critter' },
    critter_dragonfly: { name: 'Chuồn chuồn', desc: 'Mũi tên của hồ, 9:00\u201317:00.', kind: 'critter' },
    critter_mayfly: { name: 'Phù du', desc: 'Đàn chạng vạng trên hồ, 17:00\u201320:00.', kind: 'critter' },
    critter_sand_crab: { name: 'Cua cát', desc: 'Kẻ đi ngang bãi biển, 7:00\u201318:00.', kind: 'critter' },
    critter_glow_worm: { name: 'Sâu phát sáng', desc: 'Hạt sáng bãi đêm, 20:00\u201302:00.', kind: 'critter' },
    critter_grasshopper: { name: 'Châu chấu', desc: 'Vận động viên nhảy đồi, 7:00\u201317:00.', kind: 'critter' },
    fish_minnow: { name: 'Cá tép', desc: 'Mọi vùng nước, ban ngày.', kind: 'fish' },
    fish_perch: { name: 'Cá rô', desc: 'Hồ, 8:00\u201318:00.', kind: 'fish' },
    fish_flounder: { name: 'Cá bơn', desc: 'Biển, 7:00\u201317:00.', kind: 'fish' },
    fish_trout: { name: 'Cá hồi', desc: 'Hồ lúc chạng vạng.', kind: 'fish' },
    fish_carp: { name: 'Cá chép', desc: 'Hồ ban đêm.', kind: 'fish' },
    fish_moonfish: { name: 'Cá trăng', desc: 'Bạc đêm quý hiếm.', kind: 'fish' },
    mote: { name: 'Hạt Sáng', desc: 'Bóng liễu bị giữ lại giữa dòng trôi.', kind: 'treasure' },
    food_honeycomb: { name: 'Miếng tổ ong', desc: 'Mật rừng, vẫn còn vo ve.', kind: 'food' },
    seeds_pouch: { name: 'Túi hạt giống', desc: 'Túi vải hạt giống của Gideon.', kind: 'key' },
    moonbell: { name: 'Hoa chuông trăng', desc: 'Đóa hoa rừng đêm phát sáng.', kind: 'treasure' },
    lens_cloth: { name: 'Khăn lau thấu kính', desc: 'Khăn đánh bóng của người giữ đèn.', kind: 'key' },
    wool_cloak: { name: 'Áo choàng len', desc: 'Len đồi, chống mưa — phần lớn là vậy.', kind: 'key' },
    letter: { name: 'Lá thư cũ', desc: 'Vệt muối loang, được giữ nhiều năm.', kind: 'key' }
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
  var ITEM_UI_ROW = 5;      // ui.png item icons (row 5: honey, seeds, moonbell…)
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
      loved: 'Ôi \u2014 em thật đáng yêu. Món này đi thẳng vào mẻ nướng ngày mai.',
      liked: 'Cho chị á? Chị sẽ dùng nó với trà, cảm ơn em nhiều.',
      neutral: 'Trời ạ. Cũng\u2026 chu đáo lắm, em à.',
      disliked: 'Ôi em ơi. Dế à. Chị sẽ\u2026 tìm cho chúng một mái nhà thật xa.'
    },
    gideon: {
      loved: 'Hm. Gieo trong đất tốt, thứ này. Nó sẽ tốt trên bệ cửa ta.',
      liked: 'Một chiếc đèn lồng có cánh. Nhà kính tán thành.',
      neutral: 'Không phải cỏ xạ hương. Không hại. Chấp nhận.',
      disliked: 'Cá chép. Béo ao và tự mãn. Đống phân sẽ rút ra bài học.'
    },
    rosa: {
      loved: 'Hồi còn trẻ tôi đuổi theo bướm. Giờ chúng đến tìm tôi \u2014 thấy chưa?',
      liked: 'Miếng tổ ong! Đám vịt sẽ ghen tị và tôi chẳng quan tâm.',
      neutral: 'Quái gở thật. Nó lên bệ cửa sổ danh dự.',
      disliked: 'Cá bơn á? Cưng à, tôi dạy học bốn mươi năm. Tôi biết thế nào là thất vọng dẹp.'
    },
    marlow: {
      loved: 'Sâu phát sáng. Ánh sáng nhỏ, vẫn cháy. Aye \u2014 đó là cả nghề đấy.',
      liked: 'Cá trăng ban đêm. Ngọn đèn từng gọi chúng là những vầng trăng nhỏ.',
      neutral: 'Tốt bụng đấy. Ta chẳng còn chỗ mà ghét thứ gì nữa, những ngày này.',
      disliked: ''
    },
    finn: {
      loved: 'MỘT CON CÁ?! Quà đỉnh nhất LUÔN! Treo lên cờ thủy thủ đoàn!',
      liked: 'Chuồn chuồn! Như một con diều tí hon có ý kiến riêng!',
      neutral: 'Ooo. Sáng bóng-đại-khái. Chính thức là hàng hóa rồi.',
      disliked: 'Tổ ong á? Dính nhớp tay, thôi cảm ơn \u2014 anh cầm đi, em giám sát.'
    },
    hana: {
      loved: 'Cua cát. Đáng tin. Tự mang nhà theo người. Tôi nể điều đó.',
      liked: 'Hạt sáng. Kho: một ngôi sao nhỏ. Đã nhập sổ.',
      neutral: 'Ghi nhận, nhập sổ, cảm kích. Chủ yếu là nhập sổ.',
      disliked: 'Phù du. Chúng bầy đàn. Như tin đồn. Mang ra ngoài lại đi.'
    },
    bramble: {
      loved: 'Hm. Châu chấu. Mười bốn cái chân kiên nhẫn. Quà tốt.',
      liked: 'Len đồi sẽ thích anh. Món này giúp ích đấy.',
      neutral: 'Hm. Chấp nhận.',
      disliked: 'Bọ sồi. Cắn len. Đàn cừu bỏ phiếu chống.'
    },
    junie: {
      loved: 'Đom đóm \u2014 đúng cái màu xanh mà tôi không bao giờ pha được. Cảm ơn.',
      liked: 'Ô. Một chút màu sắc đồng ý được mang đi.',
      neutral: 'Bầu trời kia là một hơi thở đang nín. Thứ này cũng vậy. Cảm ơn.',
      disliked: ''
    }
  };
  var AGAIN_LINES = {
    mira: 'Một món quà mỗi ngày từ em là vừa đủ rồi \u2014 giữ bớt lòng tốt lại.',
    gideon: 'Một lễ mỗi ngày. Ong còn phải phân chia phấn hoa.',
    rosa: 'Hai lần một ngày? Hồi đó chúng tôi gọi thế là khoe khoang.',
    marlow: 'Anh cho đủ hôm nay rồi. Thủy triều cũng vậy.',
    finn: 'Oa, hai cái á? Túi em \u2014 ý em là túi ANH \u2014 có giới hạn!',
    hana: 'Đạt giới hạn ngày. Nhập hàng lại vào mai.',
    bramble: 'Hm. Một ngày một lần. Số đẹp.',
    junie: 'Một là quà. Hai là bộ sưu tập. Mai nhé.'
  };
  /* friendship per gift tier — DESIGN.md §3 table */
  var TIER_HEARTS = { loved: 2, liked: 1, neutral: 0.5, disliked: -0.5 };

  /* ---- module state ---- */
  var inventory = {};     // { itemKey: count }, ≤ MAX_KINDS distinct
  var critters = [];      // {id, def, x, y, wx, wy, wt, seed} — alive cap 40
  var motes = [];         // {x, y, seed} — alive cap 12
  var projs = [];         // slingshot pebbles in flight — cap 8
  var swingT = 0;         // net-swing arc timer (Q) — not the staff
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
    enemies.length = 0;
    swingT = 0;                             // net arc
    weapon.swingT = 0; weapon.cd = 0; weapon.outT = 0;
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
        WHUD.toast('Túi đồ đầy rồi \u2014 tối đa 24 loại.');
        return false;
      }
      inventory[key] = 0;
    }
    inventory[key] = Math.min(MAX_STACK, inventory[key] + n);
    WHUD.toast('Nhận được: ' + ITEMS[key].name + ' \u00d7' + inventory[key]);
    return true;
  }

  function count(key) { return inventory[key] || 0; }

  /* eating from the bag: food kinds give a heart back; anything else
     just gets a polite shrug. The player object comes via lastEnv. */
  function eat(key) {
    var it = ITEMS[key];
    var pl = lastEnv && lastEnv.player;
    if (!it || it.kind !== 'food' || count(key) <= 0) return false;
    if (!pl || pl.hp >= (pl.maxHp || 3)) {
      if (window.WHUD) WHUD.toast('Bụng còn no lắm.');
      return false;
    }
    remove(key, 1);
    pl.hp = Math.min(pl.maxHp || 3, pl.hp + 1);
    WAudio.sfx('gift');
    if (window.WParticles) {
      WParticles.emit('floattext', pl.x, pl.y - 44,
        { text: '+1', color: 'rgba(150,235,150,1)', life: 0.8 });
    }
    if (window.WHUD) WHUD.toast('Ăn ' + it.name + ' — ngọt và ấm lòng.');
    return true;
  }

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
      return { kind: 'critter', obj: c, x: c.x, y: c.y, label: 'Bắt ' + ITEMS[c.id].name };
    }
    if (m) return { kind: 'mote', obj: m, x: m.x, y: m.y, label: 'Hứng ánh sáng' };
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
          if (window.WHUD) WHUD.toast('Quay mặt ra nước để thả câu.');
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
        fish.marker = 0.5;   // matches the first updateFish tick (sin 0) so a
                             // same-frame press resolves instead of NaN-missing
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
          if (window.WHUD) WHUD.toast('Nó tuột mất rồi\u2026');
          WAudio.sfx('splash');
        }
        fish.state = 'idle';
        break;
      }
    }
  }

  /* the line snaps back in — on damage, on wandering off, on zone changes */
  function cancelFish(reason) {
    if (fish.state === 'idle') return;
    fish.state = 'idle';
    if (reason && window.WHUD) WHUD.toast(reason);
    if (window.WParticles) WParticles.emit('splash', fish.bx, fish.by, { vy: -50 });
    WAudio.sfx('splash');
  }

  function updateFish(dt, player) {
    /* wandering too far from the bobber reels the line in itself */
    if (fish.state !== 'idle' && player &&
        WU.dist(player.x, player.y, fish.bx, fish.by) > 76) {
      cancelFish('Bạn đi xa quá — thu dây lại.');
    }
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
        if (window.WHUD) WHUD.toast('Nó lặng lẽ trốn mất.');
      }
    } else if (fish.state === 'reel') {
      fish.reelT += dt;
      fish.markerT += dt;
      fish.marker = 0.5 + 0.5 * Math.sin(fish.markerT * WU.TAU * 1.2);  // 1.2 Hz
      if (fish.reelT > 2.5) {
        fish.state = 'idle';
        if (window.WHUD) WHUD.toast('Dây chùng xuống. Nó tuột mất rồi\u2026');
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
        for (j = enemies.length - 1; j >= 0; j--) {
          var fe = enemies[j];
          if (WU.dist(p.x, p.y, fe.x, fe.y - 8) < fe.def.r + 4) {
            hurtEnemy(fe, p.x - p.vx * 0.05, p.y - p.vy * 0.05);  // pushes along the shot
            projs.splice(i, 1);
            p = null;
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

  /* ==================== COMBAT ====================
     The wooden staff (J) and the two things that answer it:
     - 'wisp'  — a willow shadow held past its time (the same trapped light
       the motes are made of); nights 20:00-05:00 in forest / hills /
       headland. Pops into sparkles + a freed mote.
     - 'crab'  — rock crab, days 7:00-18:00 on the beach. Drops a sand crab.
     Enemies wander until the player steps inside their aggro radius, then
     chase; a touch costs 1 heart via WGame.hurtPlayer. Staff swings and
     slingshot pebbles both deal 1 damage with a knockback push. */

  var ENEMY_DEFS = {
    wisp: { hp: 2, speed: 46, r: 9, aggro: 150, drop: 'mote', hours: [20, 5] },
    crab: { hp: 3, speed: 32, r: 10, aggro: 110, drop: 'critter_sand_crab', hours: [7, 18] }
  };
  var enemies = [];
  var enemyT = 5;

  /* hour window, wrapping midnight: [20,5] means 20:00 -> 05:00 */
  function inHours(h, win) {
    return win[0] <= win[1] ? (h >= win[0] && h < win[1]) : (h >= win[0] || h < win[1]);
  }

  /* staff state: swingT = the active arc, cd = re-swing lockout,
     outT = the stick stays drawn while foes linger nearby */
  var weapon = { swingT: 0, cd: 0, outT: 0, dir: 'down' };
  var SWING_CD = 0.42, SWING_DUR = 0.26, SWING_R = 34, SWING_ARC = 1.15;

  function enemyWalkable(x, y) {
    return !WWorld.solidAt(x, y - 4) && !WWorld.solidAt(x, y + 4) &&
           !WWorld.solidAt(x - 4, y) && !WWorld.solidAt(x + 4, y) &&
           !WWorld.waterAt(x, y);
  }

  function makeEnemy(kind, x, y) {
    var def = ENEMY_DEFS[kind];
    return { kind: kind, def: def, hp: def.hp, x: x, y: y,
      wx: x, wy: y, wt: WU.rand(1, 3), kx: 0, ky: 0, kt: 0,
      windT: 0, restT: 0, flash: 0, seed: WU.rand(0, 6.283) };
  }

  function spawnEnemy(px, py, env) {
    var h = WU.hnorm(env.hour);
    var ang = WU.rand(0, WU.TAU), d = WU.rand(430, 610);   // just past the view edge
    var x = px + Math.cos(ang) * d, y = py + Math.sin(ang) * d;
    var biome = WWorld.biomeAt((x / WWorld.TILE) | 0, (y / WWorld.TILE) | 0);
    var kind = null;
    if (inHours(h, ENEMY_DEFS.crab.hours) && biome === 'beach') kind = 'crab';
    else if (inHours(h, ENEMY_DEFS.wisp.hours) &&
             (biome === 'forest' || biome === 'hills' || biome === 'headland')) kind = 'wisp';
    /* once the lamp burns, the held-back shadows are free — none return */
    if (kind === 'wisp' && window.WStory && WStory.flag('lampLit')) return;
    if (!kind || enemies.length >= 6 || !enemyWalkable(x, y)) return;
    enemies.push(makeEnemy(kind, x, y));
  }

  function hurtEnemy(e, sx, sy, dmg) {
    e.hp -= (dmg || 1);
    var dx = e.x - sx, dy = e.y - sy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    e.kx = dx / d * 200; e.ky = dy / d * 200; e.kt = 0.16;
    e.windT = 0;                                  // a landed hit interrupts the strike
    e.flash = 0.14;
    if (window.WParticles) {
      WParticles.emit('floattext', e.x, e.y - 20,
        { text: '−1', color: 'rgba(255,122,108,1)', life: 0.8 });
    }
    if (e.hp <= 0) {
      var i = enemies.indexOf(e);
      if (i >= 0) enemies.splice(i, 1);
      burst(e.x, e.y - 8, 'sparkle', 10);
      if (e.def.drop) add(e.def.drop, 1);
      if (e.kind === 'wisp' && window.WParticles) {
        WParticles.emit('mote', e.x, e.y - 10, {});   // the freed light, drifting
      }
      WAudio.sfx(e.kind === 'wisp' ? 'sparkle' : 'pop');
    } else {
      WAudio.sfx('hit');
    }
  }

  function updateEnemies(dt, player, env) {
    enemyT -= dt;
    if (enemyT <= 0) {
      enemyT = WU.rand(3, 6);
      spawnEnemy(player.x, player.y, env);
    }
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      var dp = WU.dist(e.x, e.y, player.x, player.y);
      if (dp > 640) { enemies.splice(i, 1); continue; }
      /* out of hours: a night shadow dissolves at dawn, a crab slips
         under the sand at dusk — a farewell, not a kill */
      if (!inHours(WU.hnorm(env.hour), e.def.hours)) {
        if (window.WParticles && dp < 480) {
          WParticles.emit(e.kind === 'wisp' ? 'sparkle' : 'splash', e.x, e.y - 8, {});
        }
        enemies.splice(i, 1);
        continue;
      }
      if (e.flash > 0) e.flash -= dt;
      if (e.restT > 0) e.restT -= dt;
      if (e.kt > 0) {                             // the hit's push owns the foe
        e.kt -= dt;
        var bx = e.x + e.kx * dt, by = e.y + e.ky * dt;
        if (enemyWalkable(bx, e.y)) e.x = bx;
        if (enemyWalkable(e.x, by)) e.y = by;
      } else if (e.windT > 0) {
        /* planted mid wind-up — the flash telegraphs the strike */
      } else {
        var chase = !player.boat && dp < e.def.aggro;
        var speed, tx, ty;
        if (chase) {
          speed = e.def.speed; tx = player.x; ty = player.y;
        } else {
          e.wt -= dt;
          if (e.wt <= 0) {
            e.wt = WU.rand(1.5, 3.5);
            e.wx = e.x + WU.rand(-46, 46);
            e.wy = e.y + WU.rand(-46, 46);
          }
          speed = e.def.speed * 0.4; tx = e.wx; ty = e.wy;
        }
        var dx = tx - e.x, dy = ty - e.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd > 2) {
          var nx = e.x + dx / dd * speed * dt;
          var ny = e.y + dy / dd * speed * dt;
          if (enemyWalkable(nx, e.y)) e.x = nx;
          if (enemyWalkable(e.x, ny)) e.y = ny;
        }
      }
      /* strike: reach + a 0.32 s wind-up the player can step out of;
         after it lands (or whiffs) the foe rests a beat. windT always
         ticks down — boarding a boat mid-charge must not freeze it */
      var rr = e.def.r + 13;
      if (e.windT > 0) {
        e.windT -= dt;
        if (e.windT <= 0) {
          if (!player.boat && dp < rr + 9 && window.WGame && WGame.hurtPlayer) {
            WGame.hurtPlayer(1, e.x, e.y);
          }
          e.restT = 0.9;
        }
      } else if (e.restT <= 0 && !player.boat && dp < rr) {
        e.windT = 0.32;
        WAudio.sfx('windup');            // hear it coming, not just see it
      }
      /* a hostile nearby keeps the staff in hand — and teaches J first */
      if (dp < 220) {
        weapon.outT = Math.max(weapon.outT, 1.2);
        if (window.WStory && !WStory.flag('staff_hint_shown')) {
          WStory.setFlag('staff_hint_shown', true);
          if (window.WHUD) WHUD.toast('Có thứ gì đó đang lại gần — nhấn J để vung gậy!');
        }
      }
    }
    /* soft separation — foes should bump shoulders, not fuse */
    for (var a = 0; a < enemies.length; a++) {
      for (var b2 = a + 1; b2 < enemies.length; b2++) {
        var ea = enemies[a], eb = enemies[b2];
        var sx = eb.x - ea.x, sy = eb.y - ea.y;
        var sd = Math.sqrt(sx * sx + sy * sy);
        var want = ea.def.r + eb.def.r + 3;
        if (sd > 0.01 && sd < want) {
          var push = (want - sd) * 0.5;
          sx = sx / sd * push; sy = sy / sd * push;
          if (enemyWalkable(ea.x - sx, ea.y - sy)) { ea.x -= sx; ea.y -= sy; }
          if (enemyWalkable(eb.x + sx, eb.y + sy)) { eb.x += sx; eb.y += sy; }
        }
      }
    }
  }

  /* J — the staff arc: 130° wedge ahead of the facing direction */
  function trySwing(player) {
    if (weapon.cd > 0) return false;
    weapon.cd = SWING_CD;
    weapon.swingT = SWING_DUR;
    weapon.outT = Math.max(weapon.outT, 3);
    weapon.dir = player.dir;               // locked: turning mid-swing stays honest
    WAudio.sfx('swing');
    var v = DIRV[player.dir] || DIRV.down;
    var base = Math.atan2(v[1], v[0]);
    var hit = false;
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      var dx = e.x - player.x, dy = e.y - (player.y - 10);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > SWING_R + e.def.r) continue;
      var da = Math.atan2(Math.sin(Math.atan2(dy, dx) - base),
                        Math.cos(Math.atan2(dy, dx) - base));
      if (Math.abs(da) > SWING_ARC) continue;
      hurtEnemy(e, player.x, player.y);
      hit = true;
    }
    if (window.WStory && !WStory.flag('staff_hint_shown')) {
      WStory.setFlag('staff_hint_shown', true);
      if (window.WHUD) WHUD.toast('Bạn rút gậy gỗ ra \u2014 J để vung quét, cẩn thận bóng đêm và cua đá.');
    }
    return hit;
  }

  function drawEnemy(ctx, e, cam) {
    var bob = Math.sin(e.seed * 7 + (lastEnv ? lastEnv.hour * 60 : 0)) * 2;
    var blink = e.flash > 0 || e.windT > 0;   // wound-flash AND strike telegraph
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    if (e.kind === 'wisp') {
      var cy = e.y - 14 + bob;
      /* soft violet halo, then the shadow body and its pale eyes */
      ctx.globalAlpha = blink ? 0.8 : 0.5;
      ctx.fillStyle = 'rgba(140,128,240,0.6)';
      ctx.beginPath(); ctx.arc(e.x, cy, 13, 0, WU.TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = blink ? '#f2ecff' : '#352e5e';
      ctx.beginPath(); ctx.arc(e.x, cy, 7.5, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = blink ? '#4a3f7a' : '#cfe8ff';
      ctx.fillRect(e.x - 3.4, cy - 1.5, 2, 2);
      ctx.fillRect(e.x + 1.4, cy - 1.5, 2, 2);
    } else {
      /* crab: shadow, scuttling legs, shell, claws, eye stalks */
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, 10, 3, 0, 0, WU.TAU); ctx.fill();
      ctx.strokeStyle = blink ? '#ffe9d0' : '#a8502e';
      ctx.lineWidth = 1.5;
      for (var l = -1; l <= 1; l += 2) {
        ctx.beginPath(); ctx.moveTo(e.x + l * 5, e.y - 4); ctx.lineTo(e.x + l * 11, e.y - 1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(e.x + l * 5, e.y - 7); ctx.lineTo(e.x + l * 11, e.y - 4); ctx.stroke();
      }
      var cy2 = e.y - 7 + bob * 0.4;
      ctx.fillStyle = blink ? '#ffcf9e' : '#c86238';
      ctx.beginPath(); ctx.ellipse(e.x, cy2, 7.5, 5.5, 0, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = blink ? '#ffe2c2' : '#e07840';
      ctx.beginPath(); ctx.arc(e.x - 8, cy2 - 3, 3, 0, WU.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(e.x + 8, cy2 - 3, 3, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = '#241a12';
      ctx.fillRect(e.x - 2.5, cy2 - 6, 1.6, 2.4);
      ctx.fillRect(e.x + 1, cy2 - 6, 1.6, 2.4);
    }
    /* hp pip bar — only once wounded */
    if (e.hp < e.def.hp) {
      ctx.fillStyle = 'rgba(20,20,26,0.8)';
      ctx.fillRect(e.x - 8, e.y - 27, 16, 3);
      ctx.fillStyle = '#ff7a6c';
      ctx.fillRect(e.x - 8, e.y - 27, 16 * e.hp / e.def.hp, 3);
    }
    ctx.restore();
  }

  /* the staff itself: a wooden stick resting at the shoulder while drawn,
     sweeping a 170° arc during swingT — drawn over the body */
  function drawWeapon(ctx, player) {
    if (weapon.outT <= 0) return;
    /* while the arc is live it honours the locked swing direction;
       at rest it simply follows wherever the player looks now */
    var d = weapon.swingT > 0 ? weapon.dir : player.dir;
    var v = DIRV[d] || DIRV.down;
    var b = Math.atan2(v[1], v[0]);
    var hx = player.x + v[0] * 5 - v[1] * 6;   // the hand: ahead-and-side
    var hy = player.y - 18 + v[1] * 3;
    var ang;
    if (weapon.swingT > 0) {
      var t = 1 - weapon.swingT / SWING_DUR;
      ang = b - 1.5 + t * 3;                    // sweeps past the facing line
    } else {
      ang = b + 1.05;                           // rest: along the shoulder
    }
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a5430';
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(17, 0); ctx.stroke();
    ctx.strokeStyle = '#caa06a';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-7, -1.1); ctx.lineTo(17, -1.1); ctx.stroke();
    ctx.restore();
    if (weapon.swingT > 0) {                    // the arc flash
      ctx.strokeStyle = 'rgba(255,240,200,' + (0.55 * weapon.swingT / SWING_DUR).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y - 10, 30, b - 1.15, b + 1.15);
      ctx.stroke();
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
      return { line: 'Bạn đưa tay tới, nhưng túi đồ trống.', delta: 0, tier: 'none' };
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
      line = AGAIN_LINES[npcId] || 'Một món quà mỗi ngày \u2014 giữ cho việc cho đi vẫn ấm áp.';
    } else {
      giftDay[npcId] = day;
      var pool = (GIFT_LINES[npcId] && GIFT_LINES[npcId][tier]) || '';
      line = pool || 'Cảm ơn, Quản lý.';
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
      updateEnemies(dt, player, env);
    }
    updateFish(dt, player);
    if (swingT > 0) swingT -= dt;
    if (weapon.swingT > 0) weapon.swingT -= dt;
    if (weapon.cd > 0) weapon.cd -= dt;
    if (weapon.outT > 0) weapon.outT -= dt;
    if (!env.frozen) updateProjs(dt);
  }

  /* ---- drawing ---- */

  function drawCritter(ctx, c) {
    /* vector shapes only: this atlas pack's critter cells hold unrelated
       minis (honey pots, farm animals), so the tinted fallback is the truth */
    var bob = Math.sin(c.seed + (lastEnv ? lastEnv.hour * 60 : 0)) * 1.5;
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
    drawWeapon(ctx, player);
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
    eat: eat,
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
    trySwing: trySwing,
    enemies: function () { return enemies; },
    spawnEnemyFor: function (kind, x, y) {   // test/debug hook
      var e = makeEnemy(kind, x, y);
      enemies.push(e);
      return e;
    },
    drawEnemy: drawEnemy,
    gift: gift,
    setAim: function (a) { aim = a; },
    fishState: function () { return fish.state; },
    cancelFish: cancelFish,
    clearEnemies: function () { enemies.length = 0; },
    update: update,
    drawUnder: drawUnder,
    drawOver: drawOver
  };
})();
