/* Willowmere — hud.js · window.WHUD
   Read-only HUD (DESIGN.md §7): draws state through the public APIs and never
   mutates the game. Clock chip (day · hour · weather glyph), rain forecast
   ("rain tomorrow" derived from WWorld.weatherRoll, the same roll main uses),
   quest panel (active quests with their current step), toasts (new task /
   task accepted / task complete via a quest-state snapshot; item receipt
   toasts come from WAction.add; friendship toasts from WNpcs.addFriend),
   "E" prompt over the nearest target, tool chips, and the pouch (bag) opened
   with Tab — a HUD-internal overlay listing the 24 inventory slots (§5.4).
   Full screens: Title, Pause, Settings, Vista, Epilogue. Menu geometry is
   exposed via buttons() so main.js can hit-test mouse clicks against what
   was drawn. ui.png is used for the panel 9-slice + icons; everything has a
   vector fallback so an empty assets/ folder still renders cleanly. */
window.WHUD = (function () {
  'use strict';

  var toasts = [];           // {text, t}
  var prompt = null;         // {text, x, y}
  var buttons = [];          // last drawn screen's hit rects

  /* bag overlay (HUD-internal UI state only) — 24 slots per §5.4 */
  var bagOpen = false;
  var BAG_COLS = 6, BAG_ROWS = 4, BAG_SLOT = 42, BAG_GAP = 8;

  /* quest-state snapshot for transition toasts */
  var qSnap = null;
  var lastWeather = null;

  var VISTA_NAMES = {
    willow_overlook: 'Willow Overlook',
    heron_rock: 'Heron Rock',
    lighthouse_head: 'Lighthouse Head',
    shepherds_tor: 'Shepherd\u2019s Tor',
    old_stone_circle: 'Old Stone Circle'
  };

  /* ui.png critter / fish mini order (matches WAction registry order) */
  var CRITTER_ROW = 5, FISH_ROW = 6, ITEM_ROW = 4;
  var CRIT_ORDER = ['critter_butterfly', 'critter_cricket', 'critter_oak_beetle',
    'critter_firefly', 'critter_luna_moth', 'critter_dragonfly', 'critter_mayfly',
    'critter_sand_crab', 'critter_glow_worm', 'critter_grasshopper'];
  var FISH_ORDER = ['fish_minnow', 'fish_perch', 'fish_flounder',
    'fish_trout', 'fish_carp', 'fish_moonfish'];

  function font(size, bold, italic) {
    return (bold ? 'bold ' : '') + (italic ? 'italic ' : '') +
      size + 'px "Segoe UI",Verdana,sans-serif';
  }

  /* Backing-store DPR as built by WGame (devicePixelRatio alone is wrong
     where main clamps it, e.g. to 2). */
  function uiDpr() {
    return (window.WGame && typeof WGame.dpr === 'function')
      ? WGame.dpr() : (window.devicePixelRatio || 1);
  }

  /* ---- Tab opens the pouch (HUD-internal toggle; no game state touched) -- */
  function onKey(e) {
    if (e.code !== 'Tab') return;
    e.preventDefault();
    var g = window.WGame;
    if (g && typeof g.state === 'function' && g.state() === 'PLAY') {
      bagOpen = !bagOpen;
      WAudio.sfx('click');
    } else {
      bagOpen = false;
    }
  }
  document.addEventListener('keydown', onKey);

  /* ---- toasts / prompt ---- */
  function toast(text, ms) {
    if (toasts.length >= 3) toasts.shift();
    toasts.push({ text: String(text).slice(0, 120), t: ms || 2600 });
  }

  function promptAt(text, x, y, cam) {
    var z = cam && cam.zoom ? cam.zoom : 1;
    prompt = {
      text: String(text).slice(0, 120),
      x: (x - cam.x) * z,
      y: (y - cam.y) * z
    };
  }

  /* ---- primitives ---- */
  function hasUi() { return !!(window.WAssets && WAssets.has('ui')); }

  function panel(ctx, x, y, w, h) {
    if (hasUi()) {
      var s = 16, ix = 0, iy = 16;
      var x2 = x + w - s, y2 = y + h - s;
      WAssets.sheet(ctx, 'ui', ix, iy, s, s, x, y, s, s);
      WAssets.sheet(ctx, 'ui', ix + 2 * s, iy, s, s, x2, y, s, s);
      WAssets.sheet(ctx, 'ui', ix, iy + 2 * s, s, s, x, y2, s, s);
      WAssets.sheet(ctx, 'ui', ix + 2 * s, iy + 2 * s, s, s, x2, y2, s, s);
      WAssets.sheet(ctx, 'ui', ix + s, iy, s, s, x + s, y, w - 2 * s, s);
      WAssets.sheet(ctx, 'ui', ix + s, iy + 2 * s, s, s, x + s, y2, w - 2 * s, s);
      WAssets.sheet(ctx, 'ui', ix, iy + s, s, s, x, y + s, s, h - 2 * s);
      WAssets.sheet(ctx, 'ui', ix + 2 * s, iy + s, s, s, x2, y + s, s, h - 2 * s);
      WAssets.sheet(ctx, 'ui', ix + s, iy + s, s, s, x + s, y + s, w - 2 * s, h - 2 * s);
      return;
    }
    ctx.fillStyle = 'rgba(22,26,36,0.88)';
    ctx.strokeStyle = 'rgba(255,232,180,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }

  function icon(ctx, col, row, x, y, s) {
    if (!hasUi()) return false;
    WAssets.sheet(ctx, 'ui', col * 16, row * 16, 16, 16, x, y, s || 16, s || 16);
    return true;
  }

  function button(ctx, label, x, y, w, h, selected, dim, id) {
    buttons.push({ id: id, x: x, y: y, w: w, h: h });
    ctx.fillStyle = selected ? 'rgba(255,214,130,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = selected ? 'rgba(255,214,130,0.9)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.font = font(16, selected);
    ctx.textAlign = 'center';
    ctx.fillStyle = dim ? 'rgba(210,200,180,0.4)' : (selected ? '#ffd98a' : '#f2ead8');
    ctx.fillText(label, x + w / 2, y + h / 2 + 6);
  }

  /* ---- read-only lookups ---- */
  function firstNpcName(id) {
    if (!window.WNpcs) return '';
    var n = WNpcs.byId(id);
    return n ? n.def.name.split(' ')[0] : '';
  }

  function vistaSeenCount() {
    var S = window.WStory, W = window.WWorld, n = 0;
    if (!S || !W || !W.vistas) return 0;
    for (var i = 0; i < W.vistas.length; i++) {
      if (S.flag('vista_' + W.vistas[i].id)) n++;
    }
    return n;
  }

  /* current step of a quest, derived read-only from flags + inventory */
  function questStep(q) {
    var S = window.WStory, A = window.WAction;
    if (!S || !A) return '';
    if (q.state === 'available') {
      var nm = firstNpcName(q.npc);
      return nm ? 'Talk to ' + nm + '.' : 'Find a friend in the village.';
    }
    switch (q.id) {
      case 'the_dark_lamp': {
        var e = S.embers();
        var ready = e >= 4 && S.flag('marlow_confession');
        if (ready) return 'Climb the lighthouse tonight (after 20:00).';
        return 'Ember Lights ' + e + '/4' +
          (S.flag('marlow_confession') ? '' : ' \u00b7 hear Marlow out');
      }
      case 'honey_loaf':
        return A.count('food_honeycomb') > 0
          ? 'Bring the honeycomb to Mira.'
          : 'Gather honeycomb at the north hives.';
      case 'seeds_of_spring':
        return S.flag('seed_pouch_found')
          ? 'Return the seed pouch to Gideon.'
          : 'Search the east hill trail for the pouch.';
      case 'garden_show':
        return A.count('moonbell') > 0
          ? 'Bring the moonbell to Rosa.'
          : 'Find a moonbell in the night forest (21:00+).';
      case 'big_one':
        return S.flag('siltjaw_caught')
          ? 'Show Finn the catch.'
          : 'Fish the lake for Siltjaw (press F).';
      case 'parcel':
        return 'Decide the parcel\u2019s fate with Hana.';
      case 'lost_lamb':
        return 'Find the lamb in the forest after dark (20:00+).';
      case 'colors': {
        var seen = vistaSeenCount();
        return seen >= 4
          ? 'Bring Junie a firefly in a jar.'
          : 'Visit the vistas (' + seen + '/4).';
      }
      case 'keeper_regret':
        return 'Meet Marlow at the lighthouse base, 18:00\u201321:00.';
    }
    return String(q.hint || '');
  }

  /* quest-state snapshot diff \u2192 transition toasts (new / accepted / done) */
  function questTransitions() {
    var S = window.WStory;
    if (!S || !S.QUESTS) return;
    if (!qSnap) {
      qSnap = {};
      for (var k in S.QUESTS) {
        if (S.QUESTS.hasOwnProperty(k)) qSnap[k] = S.QUESTS[k].state;
      }
      return;
    }
    for (var k2 in S.QUESTS) {
      if (!S.QUESTS.hasOwnProperty(k2)) continue;
      var q = S.QUESTS[k2];
      var prev = qSnap[k2];
      if (prev === q.state) continue;
      qSnap[k2] = q.state;
      if (q.state === 'available' && prev === 'locked') {
        toast('New task: ' + q.title);
      } else if (q.state === 'active') {
        toast('Task accepted: ' + q.title);
      } else if (q.state === 'done_a' || q.state === 'done_b') {
        toast('Task complete: ' + q.title);
      }
    }
  }

  /* rain watch (read-only): toast on clear\u2192rain; chip forecasts tomorrow */
  function rainTomorrow(env) {
    if (!window.WWorld || !WWorld.weatherRoll) return false;
    return WWorld.weatherRoll((env.day || 1) + 1) === 'rain';
  }

  function rainWatch(env) {
    var w = env && env.weather ? env.weather : 'clear';
    if (lastWeather === null) { lastWeather = w; return; }
    if (w !== lastWeather) {
      if (w === 'rain') toast('Rain sweeps in from the sea.');
      else toast('The rain moves on.');
      lastWeather = w;
    }
  }

  /* ---- pouch (bag) ---- */
  function itemCell(key) {
    var A = window.WAction;
    if (!A || !A.ITEMS[key]) return null;
    var kind = A.ITEMS[key].kind, ci, fi;
    if (kind === 'critter') {
      ci = CRIT_ORDER.indexOf(key);
      return ci >= 0 ? [ci, CRITTER_ROW] : null;
    }
    if (kind === 'fish') {
      fi = FISH_ORDER.indexOf(key);
      return fi >= 0 ? [fi, FISH_ROW] : null;
    }
    return A.ITEM_UI_COL.hasOwnProperty(key) ? [A.ITEM_UI_COL[key], ITEM_ROW] : null;
  }

  function drawBag(ctx, vw, vh) {
    var A = window.WAction;
    var keys = (A && A.list) ? A.list() : [];
    var gridW = BAG_COLS * BAG_SLOT + (BAG_COLS - 1) * BAG_GAP;
    var gridH = BAG_ROWS * BAG_SLOT + (BAG_ROWS - 1) * BAG_GAP;
    var w = gridW + 36, h = gridH + 92;
    var x = Math.round(vw / 2 - w / 2), y = Math.round(vh / 2 - h / 2);

    ctx.fillStyle = 'rgba(8,10,16,0.45)';
    ctx.fillRect(0, 0, vw, vh);
    panel(ctx, x, y, w, h);

    ctx.textAlign = 'center';
    ctx.font = 'italic 19px Georgia,serif';
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('Pouch', vw / 2, y + 28);
    ctx.font = font(11);
    ctx.fillStyle = 'rgba(242,234,216,0.6)';
    ctx.fillText(keys.length + ' of ' + (BAG_COLS * BAG_ROWS) + ' slots', vw / 2, y + 44);

    ctx.textAlign = 'left';
    for (var r = 0; r < BAG_ROWS; r++) {
      for (var c = 0; c < BAG_COLS; c++) {
        var i = r * BAG_COLS + c;
        var sx = x + 18 + c * (BAG_SLOT + BAG_GAP);
        var sy = y + 56 + r * (BAG_SLOT + BAG_GAP);
        var key = keys[i] || null;
        ctx.fillStyle = key ? 'rgba(255,244,214,0.10)' : 'rgba(255,255,255,0.04)';
        ctx.strokeStyle = key ? 'rgba(255,232,180,0.45)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sx, sy, BAG_SLOT, BAG_SLOT, 7);
        else ctx.rect(sx, sy, BAG_SLOT, BAG_SLOT);
        ctx.fill();
        ctx.stroke();
        if (key) {
          var cell = itemCell(key);
          var drawn = false;
          if (cell && hasUi()) {
            WAssets.sheet(ctx, 'ui', cell[0] * 16, cell[1] * 16, 16, 16,
              sx + 13, sy + 9, 16, 16);
            drawn = true;
          }
          if (!drawn) {
            /* vector fallback: tinted token */
            ctx.fillStyle = '#cfc0a0';
            ctx.beginPath(); ctx.arc(sx + 21, sy + 17, 8, 0, WU.TAU); ctx.fill();
          }
          ctx.font = font(11, true);
          ctx.fillStyle = '#ffe9b8';
          ctx.fillText('\u00d7' + A.count(key), sx + 6, sy + BAG_SLOT - 6);
        }
      }
    }

    ctx.textAlign = 'center';
    ctx.font = font(11, false, true);
    ctx.fillStyle = 'rgba(242,234,216,0.55)';
    ctx.fillText('Tab \u2014 close', vw / 2, y + h - 16);
  }

  /* ---- in-world HUD ---- */
  function draw(ctx, env, state) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    var h = env && env.hour !== undefined ? WU.hnorm(env.hour) : 12;
    var dt = state && state.dt ? state.dt : 0;

    /* pouch only makes sense while freely wandering */
    var g = window.WGame;
    if (bagOpen && (!g || typeof g.state !== 'function' || g.state() !== 'PLAY')) {
      bagOpen = false;
    }

    /* read-only watchers: quest toasts + rain watch */
    questTransitions();
    rainWatch(env);

    /* clock chip */
    var time = WU.fmtHour(h);
    var label = 'Day ' + (env && env.day ? env.day : 1) + ' \u00b7 ' + time;
    ctx.font = font(13, true);
    var cw = ctx.measureText(label).width + 46;
    var cx = vw / 2 - cw / 2;
    panel(ctx, cx, 12, cw, 28);
    ctx.fillStyle = '#f2ead8';
    ctx.textAlign = 'left';
    ctx.fillText(label, cx + 12, 31);
    var night = h >= 20 || h < 5;
    var weather = env && env.weather ? env.weather : 'clear';
    var ic = night ? [8, 0] : (weather === 'rain' ? [7, 0] : [6, 0]);
    if (!icon(ctx, ic[0], ic[1], cx + cw - 24, 18)) {
      ctx.fillStyle = weather === 'rain' ? '#9fc4d4' : night ? '#cfd8ee' : '#ffd98a';
      ctx.beginPath(); ctx.arc(cx + cw - 18, 26, 5, 0, WU.TAU); ctx.fill();
      if (night) ctx.fillRect(cx + cw - 22, 18, 1, 2);
    }

    /* rain forecast chip: rain is rolled at 06:00 for the whole day */
    if (weather !== 'rain' && rainTomorrow(env)) {
      ctx.font = font(11, true);
      var fw = ctx.measureText('Rain tomorrow').width + 42;
      var fx = vw / 2 - fw / 2;
      panel(ctx, fx, 44, fw, 22);
      if (!icon(ctx, 7, 0, fx + 8, 48)) {
        ctx.fillStyle = '#9fc4d4';
        for (var di = 0; di < 3; di++) ctx.fillRect(fx + 9 + di * 4, 48 + (di % 2), 1.5, 7);
      }
      ctx.fillStyle = '#c8dcea';
      ctx.fillText('Rain tomorrow', fx + 28, 59);
    }

    /* quest panel: active quests (with current step), then available */
    var S = window.WStory;
    if (S && S.QUESTS) {
      var qs = [], k;
      for (k in S.QUESTS) if (S.QUESTS.hasOwnProperty(k)) qs.push(S.QUESTS[k]);
      qs.sort(function (a, b) {
        var av = a.state === 'active' ? 0 : a.state === 'available' ? 1 : 2;
        var bv = b.state === 'active' ? 0 : b.state === 'available' ? 1 : 2;
        return av - bv;
      });
      var shown = 0;
      var py = weather !== 'rain' && rainTomorrow(env) ? 74 : 56;
      ctx.textAlign = 'left';
      for (var i = 0; i < qs.length && shown < 3; i++) {
        var q = qs[i];
        if (q.state !== 'active' && q.state !== 'available') continue;
        var mark = q.state === 'active' ? '\u25cf ' : '\u25cb ';
        var title = mark + q.title;
        var step = questStep(q);
        ctx.font = font(13, true);
        var tw = Math.max(ctx.measureText(title).width, 210);
        ctx.font = font(11);
        tw = Math.max(tw, Math.min(260, ctx.measureText(step).width + 10));
        var pw = Math.min(300, tw + 24);
        panel(ctx, 12, py, pw, 46);
        ctx.font = font(13, true);
        ctx.fillStyle = q.state === 'active' ? '#ffd98a' : '#e8dcc0';
        ctx.fillText(title, 22, py + 18);
        ctx.font = font(11);
        ctx.fillStyle = 'rgba(242,234,216,0.7)';
        ctx.fillText(step.slice(0, 46), 22, py + 34);
        py += 54;
        shown++;
      }
    }

    /* tool chips */
    var chips = [['Q', 2, 0, 'Net'], ['F', 3, 0, 'Rod'], ['\u25ce', 4, 0, 'Sling'],
                 ['Tab', 5, 0, 'Bag']];
    var chx = vw - 12;
    ctx.textAlign = 'left';
    for (i = chips.length - 1; i >= 0; i--) {
      var c = chips[i];
      ctx.font = font(12, true);
      var w = c[0] === 'Tab' ? 72 : 64;
      chx -= w + 6;
      panel(ctx, chx, vh - 44, w, 26);
      if (!hasUi()) {
        ctx.fillStyle = '#d8cfc0';
        ctx.fillRect(chx + 8, vh - 38, 14, 14);
      } else {
        icon(ctx, c[1], c[2], chx + 8, vh - 39);
      }
      ctx.fillStyle = '#f2ead8';
      ctx.font = font(11, true);
      ctx.fillText(c[0] + ' ' + c[3], chx + 27, vh - 27);
    }

    /* toasts */
    var ty = vh - 66;
    for (i = toasts.length - 1; i >= 0; i--) {
      var t = toasts[i];
      t.t -= dt;
      if (t.t <= 0) { toasts.splice(i, 1); continue; }
      ctx.font = font(13);
      var twd = ctx.measureText(t.text).width + 28;
      var a = Math.min(1, t.t / 400);
      ctx.globalAlpha = a;
      panel(ctx, vw / 2 - twd / 2, ty - 24, twd, 30);
      ctx.fillStyle = '#f6eeda';
      ctx.textAlign = 'center';
      ctx.fillText(t.text, vw / 2, ty - 4);
      ctx.globalAlpha = 1;
      ty -= 36;
    }

    /* interaction prompt: "E \u2014 \u2026" over the nearest target */
    if (prompt) {
      ctx.font = font(13, true);
      var pw2 = ctx.measureText(prompt.text).width + 42;
      var px = WU.clamp(prompt.x - pw2 / 2, 8, vw - pw2 - 8);
      var pyy = WU.clamp(prompt.y - 40, 40, vh - 80);
      panel(ctx, px, pyy, pw2, 26);
      ctx.fillStyle = '#ffd98a';
      ctx.textAlign = 'center';
      ctx.fillText('E', px + 16, pyy + 18);
      ctx.fillStyle = '#f6eeda';
      ctx.font = font(13);
      ctx.fillText(prompt.text, px + 30 + (pw2 - 42) / 2, pyy + 18);
      prompt = null; // one frame per set
    }

    if (bagOpen) drawBag(ctx, vw, vh);
  }

  /* ---- Title ---- */
  function drawTitleOn(ctx, sel, hasSave) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    buttons.length = 0;

    /* vignette */
    var g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, 'rgba(10,14,22,0.55)');
    g.addColorStop(0.45, 'rgba(10,14,22,0.12)');
    g.addColorStop(1, 'rgba(10,14,22,0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    /* logo */
    ctx.textAlign = 'center';
    ctx.font = 'italic 700 58px Georgia,"Times New Roman",serif';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('WILLOWMERE', vw / 2 + 3, vh * 0.26 + 3);
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('WILLOWMERE', vw / 2, vh * 0.26);
    ctx.font = 'italic 17px Georgia,serif';
    ctx.fillStyle = 'rgba(246,236,210,0.85)';
    ctx.fillText('a small light, kept together', vw / 2, vh * 0.26 + 34);

    /* menu */
    var items = [
      { id: 'new', label: 'New Game' },
      { id: 'continue', label: hasSave ? 'Continue' : 'Continue (no save)', dim: !hasSave },
      { id: 'settings', label: 'Settings' }
    ];
    var bw = 240, bh = 44;
    var by = vh * 0.56;
    for (var i = 0; i < items.length; i++) {
      button(ctx, items[i].label, vw / 2 - bw / 2, by + i * (bh + 12), bw, bh,
        i === sel, items[i].dim, items[i].id);
    }
    ctx.font = font(12);
    ctx.fillStyle = 'rgba(242,234,216,0.6)';
    ctx.fillText('WASD move \u00b7 E interact \u00b7 Q net \u00b7 F rod \u00b7 click sling \u00b7 Tab pouch \u00b7 Esc pause', vw / 2, vh - 18);
  }

  /* ---- Pause ---- */
  function drawPauseOn(ctx, sel) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    buttons.length = 0;
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fillRect(0, 0, vw, vh);
    var w = 340, h = 320;
    var x = vw / 2 - w / 2, y = vh / 2 - h / 2;
    panel(ctx, x, y, w, h);
    ctx.textAlign = 'center';
    ctx.font = 'italic 26px Georgia,serif';
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('Paused', vw / 2, y + 44);
    var items = [
      { id: 'resume', label: 'Resume' },
      { id: 'save', label: 'Save' },
      { id: 'settings', label: 'Settings' },
      { id: 'quit', label: 'Quit to Title' }
    ];
    for (var i = 0; i < items.length; i++) {
      button(ctx, items[i].label, x + 40, y + 70 + i * 50, w - 80, 40, i === sel, false, items[i].id);
    }
    ctx.font = font(11, false, true);
    ctx.fillStyle = 'rgba(242,234,216,0.55)';
    ctx.fillText('Progress saves when you sleep, too.', vw / 2, y + h - 14);
  }

  /* ---- Settings ---- */
  function drawSettingsOn(ctx, sel, musicVol, sfxVol, muteOn) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    buttons.length = 0;
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fillRect(0, 0, vw, vh);
    var w = 380, h = 292;
    var x = vw / 2 - w / 2, y = vh / 2 - h / 2;
    panel(ctx, x, y, w, h);
    ctx.textAlign = 'center';
    ctx.font = 'italic 24px Georgia,serif';
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('Settings', vw / 2, y + 42);

    var rows = [
      { id: 'music', label: 'Music', v: musicVol },
      { id: 'sfx', label: 'SFX', v: sfxVol },
      { id: 'mute', label: muteOn ? 'Sound: Muted' : 'Sound: On' }
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y + 76 + i * 50;
      buttons.push({ id: rows[i].id, x: x + 30, y: ry - 20, w: w - 60, h: 44 });
      ctx.textAlign = 'left';
      ctx.font = font(15, sel === i);
      ctx.fillStyle = sel === i ? '#ffd98a' : '#f2ead8';
      ctx.fillText(rows[i].label, x + 34, ry);
      if (rows[i].v !== undefined) {
        var bx = x + 130, bw2 = 170;
        for (var s = 0; s < 10; s++) {
          ctx.fillStyle = (s < Math.round(rows[i].v * 10)) ? '#ffd98a' : 'rgba(255,255,255,0.12)';
          ctx.fillRect(bx + s * 17, ry - 13, 13, 16);
        }
        ctx.font = font(13);
        ctx.fillStyle = 'rgba(242,234,216,0.7)';
        ctx.fillText(String(Math.round(rows[i].v * 10)), bx + bw2 + 12, ry);
      } else {
        ctx.font = font(13);
        ctx.fillStyle = muteOn ? 'rgba(220,190,180,0.85)' : 'rgba(242,234,216,0.7)';
        ctx.fillText(muteOn ? 'everything silenced' : 'playing', x + 130, ry);
      }
      if (sel === i) {
        ctx.fillStyle = '#ffd98a';
        ctx.font = font(13);
        ctx.fillText('\u25c0 \u25b6', x + w - 56, ry);
      }
    }
    ctx.textAlign = 'center';
    button(ctx, 'Back', vw / 2 - 70, y + h - 56, 140, 38, sel === 3, false, 'back');
    ctx.font = font(11);
    ctx.fillStyle = 'rgba(242,234,216,0.5)';
    ctx.fillText('\u2190 \u2192 adjust \u00b7 E select \u00b7 Esc back', vw / 2, y + h - 12);
  }

  /* ---- Vista ---- */
  function drawVistaOn(ctx, vista, t) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    var e = WU.easeInOut(WU.clamp(t, 0, 1));
    var barH = vh * 0.14 * e;
    ctx.fillStyle = 'rgba(6,8,12,0.92)';
    ctx.fillRect(0, 0, vw, barH);
    ctx.fillRect(0, vh - barH, vw, barH);
    if (e > 0.5 && vista) {
      var a = (e - 0.5) * 2;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = font(13, true);
      ctx.fillStyle = '#ffd98a';
      var name = VISTA_NAMES[vista.id] || 'Willowmere';
      ctx.fillText(name.toUpperCase().split('').join('\u2009'), vw / 2, vh * 0.72);
      ctx.font = 'italic 17px Georgia,serif';
      ctx.fillStyle = '#f2ead8';
      /* wrap caption into two lines if long */
      var words = String(vista.caption).split(' ');
      var lines = [], line = '';
      for (var i = 0; i < words.length; i++) {
        var s = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(s).width > vw * 0.7 && line) { lines.push(line); line = words[i]; }
        else line = s;
      }
      if (line) lines.push(line);
      for (i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], vw / 2, vh * 0.78 + i * 24);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---- Epilogue ---- */
  function drawEpilogueOn(ctx, paragraphs, scrollT) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    ctx.fillStyle = 'rgba(7,9,14,0.94)';
    ctx.fillRect(0, 0, vw, vh);

    /* measure */
    var items = [], total = 0;
    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i];
      ctx.font = p.big ? 'italic 700 34px Georgia,serif' : 'italic 16px Georgia,serif';
      var lines = wrapPara(ctx, p.text, vw * 0.66);
      var hgt = p.big ? 60 : lines.length * 26 + 18;
      items.push({ p: p, lines: lines, h: hgt, font: ctx.font });
      total += hgt;
    }
    var endH = 60;
    var y = vh * 0.9 - scrollT * (total + endH);
    ctx.textAlign = 'center';
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (y > -80 && y < vh + 40) {
        ctx.font = it.font;
        ctx.fillStyle = it.p.big ? '#ffd98a' : '#e8dfcc';
        if (it.p.big) {
          ctx.fillText(it.lines.join(' '), vw / 2, y + 40);
        } else {
          for (var l = 0; l < it.lines.length; l++) {
            ctx.fillText(it.lines[l], vw / 2, y + 20 + l * 26);
          }
        }
      }
      y += it.h;
    }
    if (y > -60 && y < vh + 40) {
      var pulse = scrollT >= 1 ? 0.6 + 0.4 * Math.sin(performance.now() * 0.004) : 0.35;
      ctx.font = font(14, true);
      ctx.fillStyle = 'rgba(255,214,130,' + pulse.toFixed(3) + ')';
      ctx.fillText('\u2014 Press E to keep wandering \u2014', vw / 2, y + 36);
    }
  }

  function wrapPara(ctx, text, maxW) {
    var words = String(text).split(' ');
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  return {
    toast: toast,
    prompt: promptAt,
    draw: draw,
    drawTitleOn: drawTitleOn,
    drawPauseOn: drawPauseOn,
    drawSettingsOn: drawSettingsOn,
    drawVistaOn: drawVistaOn,
    drawEpilogueOn: drawEpilogueOn,
    buttons: function () { return buttons; },
    clearToasts: function () { toasts.length = 0; },
    /* full game-switch reset (New Game / Continue / Quit): quest-transition
       snapshot, rain watcher and the bag overlay must not leak between runs */
    resetWatchers: function () {
      qSnap = null;
      lastWeather = null;
      bagOpen = false;
    },
    bagOpen: function () { return bagOpen; }
  };
})();
