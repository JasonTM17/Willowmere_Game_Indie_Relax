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
    willow_overlook: 'Đồi Liễu',
    heron_rock: 'Đá Diệc',
    lighthouse_head: 'Mũi Hải Đăng',
    shepherds_tor: 'Đỉnh Chăn Cừu',
    old_stone_circle: 'Vòng Đá Cổ'
  };

  /* ui.png atlas rows (160×112 sheet): hearts/tools/weather row 4,
     item icons row 5. Critter/fish cells hold unrelated sprites (chickens,
     honey pots) in this pack, so those kinds always draw vector tokens. */
  var ITEM_ROW = 5;

  function itemCell(key) {
    var A = window.WAction;
    if (!A || !A.ITEMS[key]) return null;
    if (A.ITEMS[key].kind === 'critter' || A.ITEMS[key].kind === 'fish') return null;
    return A.ITEM_UI_COL.hasOwnProperty(key) ? [A.ITEM_UI_COL[key], ITEM_ROW] : null;
  }

  function font(size, bold, italic) {
    return (bold ? 'bold ' : '') + (italic ? 'italic ' : '') +
      size + 'px "Segoe UI",Verdana,sans-serif';
  }

  /* cream with alpha — HUD text lives on this tone */
  function cream(a) { return 'rgba(242,234,216,' + a + ')'; }

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
    var t = ms || 2600;
    if (toasts.length >= 3) toasts.shift();
    toasts.push({ text: String(text).slice(0, 120), t: t, total: t });
  }

  function promptAt(text, x, y, cam) {
    var z = cam && cam.zoom ? cam.zoom : 1;
    prompt = {
      text: String(text).slice(0, 120),
      x: (x - cam.x) * z,
      y: (y - cam.y) * z
    };
  }

  /* ---- primitives ----
     Panels are drawn by the shared WU vector kit (util.js): the ui.png
     9-slice sat on atlas cells that hold critter icons, so it smeared
     blue rectangles and heart shards across every chip. The atlas is still
     used for the few sprites it does carry (hearts, item icons). */

  function hasUi() { return !!(window.WAssets && WAssets.has('ui')); }

  function panel(ctx, x, y, w, h, opts) {
    WU.panel(ctx, x, y, w, h, opts);
  }

  /* ui.png keeps real hearts at row 4 (full col 0, empty col 1) */
  function heart(ctx, x, y, s, full) {
    if (hasUi()) {
      WAssets.sheet(ctx, 'ui', (full ? 0 : 1) * 16, 4 * 16, 16, 16, x, y, s, s);
      return;
    }
    ctx.font = Math.round(s) + 'px "Segoe UI",Verdana,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = full ? '#ff6c96' : 'rgba(255,255,255,0.18)';
    ctx.fillText('\u2665', x, y + s);
  }

  function button(ctx, label, x, y, w, h, selected, dim, id) {
    buttons.push({ id: id, x: x, y: y, w: w, h: h });
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    if (selected) {
      g.addColorStop(0, 'rgba(255,214,130,0.28)');
      g.addColorStop(1, 'rgba(214,160,80,0.16)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.08)');
      g.addColorStop(1, 'rgba(255,255,255,0.03)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, h / 2);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = selected ? 'rgba(255,214,130,0.95)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected ? 2 : 1;
    if (selected) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,214,130,0.55)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.stroke();
    }
    ctx.font = font(16, selected);
    ctx.textAlign = 'center';
    ctx.fillStyle = dim ? cream(0.4) : (selected ? '#ffd98a' : '#f2ead8');
    ctx.fillText(label, x + w / 2, y + h / 2 + 6);
    if (selected && !dim) {
      ctx.fillStyle = '#ffd98a';
      var bob = Math.sin(performance.now() * 0.005) * 1.5;
      ctx.fillText('\u25c6', x + 20, y + h / 2 + 6 + bob);
      ctx.fillText('\u25c6', x + w - 20, y + h / 2 + 6 + bob);
    }
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
      return nm ? 'Nói chuyện với ' + nm + '.' : 'Tìm một người bạn trong làng.';
    }
    switch (q.id) {
      case 'the_dark_lamp': {
        var e = S.embers();
        var ready = e >= 4 && S.flag('marlow_confession');
        if (ready) return 'Leo hải đăng tối nay (sau 20:00).';
        return 'Ánh Than Hồng ' + e + '/4' +
          (S.flag('marlow_confession') ? '' : ' \u00b7 nghe Marlow tâm sự');
      }
      case 'honey_loaf':
        return A.count('food_honeycomb') > 0
          ? 'Mang miếng tổ ong cho Mira.'
          : 'Hái tổ ong ở bầy ong phía bắc.';
      case 'seeds_of_spring':
        return S.flag('seed_pouch_found')
          ? 'Trả túi hạt giống cho Gideon.'
          : 'Tìm túi hạt trên đường đồi phía đông.';
      case 'garden_show':
        return A.count('moonbell') > 0
          ? 'Mang hoa chuông trăng cho Rosa.'
          : 'Tìm hoa chuông trăng trong rừng đêm (21:00+).';
      case 'big_one':
        return S.flag('siltjaw_caught')
          ? 'Khoe chiến lợi với Finn.'
          : 'Câu Siltjaw ở hồ (nhấn F).';
      case 'parcel':
        return 'Quyết định số phận bưu kiện cùng Hana.';
      case 'lost_lamb':
        return 'Tìm cừu con trong rừng tối (20:00+).';
      case 'colors': {
        var seen = vistaSeenCount();
        return seen >= 4
          ? 'Mang cho Junie một hũ đom đóm.'
          : 'Ghé các điểm ngắm cảnh (' + seen + '/4).';
      }
      case 'keeper_regret':
        return 'Gặp Marlow ở chân hải đăng, 18:00\u201321:00.';
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
        toast('Nhiệm vụ mới: ' + q.title);
      } else if (q.state === 'active') {
        toast('Đã nhận: ' + q.title);
      } else if (q.state === 'done_a' || q.state === 'done_b') {
        toast('Hoàn thành: ' + q.title);
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
      if (w === 'rain') toast('Mưa từ biển tràn vào.');
      else toast('Mưa đã tạnh.');
      lastWeather = w;
    }
  }

  /* ---- pouch (bag) ---- */
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
    ctx.font = 'italic 20px "Times New Roman",serif';
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('Túi đồ', vw / 2, y + 30);
    /* gold flourish under the title */
    ctx.strokeStyle = 'rgba(240,200,130,0.5)';
    ctx.lineWidth = 1;
    var fl = 46;
    ctx.beginPath();
    ctx.moveTo(vw / 2 - fl, y + 40);
    ctx.lineTo(vw / 2 - 8, y + 40);
    ctx.moveTo(vw / 2 + 8, y + 40);
    ctx.lineTo(vw / 2 + fl, y + 40);
    ctx.stroke();
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(vw / 2 - 2.5, y + 37.5, 5, 5);
    ctx.save();
    ctx.translate(vw / 2, y + 40);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(22,20,30,1)';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
    ctx.font = font(11);
    ctx.fillStyle = cream(0.6);
    ctx.fillText(keys.length + '/' + (BAG_COLS * BAG_ROWS) + ' ô', vw / 2, y + 54);

    ctx.textAlign = 'left';
    for (var r = 0; r < BAG_ROWS; r++) {
      for (var c = 0; c < BAG_COLS; c++) {
        var i = r * BAG_COLS + c;
        var sx = x + 18 + c * (BAG_SLOT + BAG_GAP);
        var sy = y + 64 + r * (BAG_SLOT + BAG_GAP);
        var key = keys[i] || null;
        /* inset well: darker fill, soft inner shading, hairline rim */
        ctx.fillStyle = key ? 'rgba(255,244,214,0.10)' : 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sx, sy, BAG_SLOT, BAG_SLOT, 8);
        else ctx.rect(sx, sy, BAG_SLOT, BAG_SLOT);
        ctx.fill();
        ctx.strokeStyle = key ? 'rgba(255,232,180,0.55)' : 'rgba(255,255,255,0.10)';
        ctx.lineWidth = key ? 1.5 : 1;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(sx + 1.5, sy + 1.5, BAG_SLOT - 3, BAG_SLOT - 3, 6.5);
        else ctx.rect(sx + 1.5, sy + 1.5, BAG_SLOT - 3, BAG_SLOT - 3);
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
            /* vector fallback: kind-tinted gem token */
            WU.gemToken(ctx, sx + 21, sy + 17, 9, Math.abs(WAssets.keyHue(key)) % 360);
          }
          /* count badge */
          var cnt = '\u00d7' + A.count(key);
          ctx.font = font(11, true);
          var bw = ctx.measureText(cnt).width + 8;
          ctx.fillStyle = 'rgba(12,10,16,0.85)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(sx + BAG_SLOT - bw - 3, sy + BAG_SLOT - 16, bw, 13, 6);
          else ctx.rect(sx + BAG_SLOT - bw - 3, sy + BAG_SLOT - 16, bw, 13);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,232,180,0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#ffe9b8';
          ctx.textAlign = 'center';
          ctx.fillText(cnt, sx + BAG_SLOT - 3 - bw / 2, sy + BAG_SLOT - 6);
          ctx.textAlign = 'left';
        }
      }
    }

    ctx.textAlign = 'center';
    ctx.font = font(11, false, true);
    ctx.fillStyle = cream(0.55);
    ctx.fillText('Tab \u2014 đóng', vw / 2, y + h - 16);
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

    /* clock chip — warm pill, gold hour, vector weather glyph */
    var time = WU.fmtHour(h);
    var dayTxt = 'Ngày ' + (env && env.day ? env.day : 1);
    ctx.font = font(13, true);
    var hourTxt = time;
    var cw = ctx.measureText(dayTxt).width + ctx.measureText(hourTxt).width + 58;
    var cx = Math.round(vw / 2 - cw / 2);
    panel(ctx, cx, 12, cw, 30, { radius: 15, alpha: 0.88 });
    ctx.textAlign = 'left';
    ctx.fillStyle = cream(0.92);
    ctx.fillText(dayTxt, cx + 14, 31);
    var dayW = ctx.measureText(dayTxt).width;
    ctx.fillStyle = '#ffd98a';
    ctx.fillText(hourTxt, cx + 14 + dayW + 16, 31);
    ctx.fillStyle = 'rgba(240,200,130,0.45)';
    ctx.fillRect(cx + 14 + dayW + 6, 23, 2, 8);
    var night = h >= 20 || h < 5;
    var weather = env && env.weather ? env.weather : 'clear';
    var gl = night ? 'night' : (weather === 'rain' ? 'rain' : 'sun');
    WU.weatherGlyph(ctx, gl, cx + cw - 22, 19, 12);

    /* hearts — player hp rides the top-left corner */
    var pl = env && env.player;
    if (pl && typeof pl.hp === 'number') {
      var maxH = pl.maxHp || 3;
      panel(ctx, 12, 12, 22 + maxH * 18, 26, { radius: 13, alpha: 0.85 });
      for (var hi = 0; hi < maxH; hi++) heart(ctx, 22 + hi * 18, 17, 16, hi < pl.hp);
    }

    /* rain forecast chip: rain is rolled at 06:00 for the whole day */
    if (weather !== 'rain' && rainTomorrow(env)) {
      ctx.font = font(11, true);
      var fw = ctx.measureText('Ngày mai có mưa').width + 40;
      var fx = Math.round(vw / 2 - fw / 2);
      panel(ctx, fx, 48, fw, 22, { radius: 11, alpha: 0.85 });
      WU.weatherGlyph(ctx, 'rain', fx + 9, 52, 11);
      ctx.fillStyle = '#c8dcea';
      ctx.fillText('Ngày mai có mưa', fx + 26, 63);
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
      var py = weather !== 'rain' && rainTomorrow(env) ? 78 : 56;
      ctx.textAlign = 'left';
      for (var i = 0; i < qs.length && shown < 3; i++) {
        var q = qs[i];
        if (q.state !== 'active' && q.state !== 'available') continue;
        var title = q.title;
        var step = questStep(q);
        ctx.font = font(13, true);
        var tw = Math.max(ctx.measureText(title).width, 210);
        ctx.font = font(11);
        tw = Math.max(tw, Math.min(260, ctx.measureText(step).width + 10));
        var pw = Math.min(300, tw + 30);
        panel(ctx, 12, py, pw, 46, { accent: q.state === 'active' });
        /* status glyph: filled diamond for active, hollow for available */
        if (q.state === 'active') {
          ctx.save();
          ctx.translate(22, py + 13);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = '#ffd98a';
          ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
          ctx.restore();
        } else {
          ctx.strokeStyle = cream(0.55);
          ctx.lineWidth = 1.5;
          ctx.save();
          ctx.translate(22, py + 13);
          ctx.rotate(Math.PI / 4);
          ctx.strokeRect(-3.2, -3.2, 6.4, 6.4);
          ctx.restore();
        }
        ctx.font = font(13, true);
        ctx.fillStyle = q.state === 'active' ? '#ffd98a' : cream(0.85);
        ctx.fillText(title, 34, py + 18);
        ctx.font = font(11);
        ctx.fillStyle = cream(0.66);
        ctx.fillText(step.slice(0, 46), 34, py + 34);
        py += 54;
        shown++;
      }
    }

    /* tool chips — keycap + label, sized to content */
    var chips = [['Q', 'Lưới'], ['F', 'Cần'], ['J', 'Gậy'], ['\u25ce', 'Nỏ'], ['Tab', 'Túi']];
    var chx = vw - 12;
    ctx.textAlign = 'left';
    for (i = chips.length - 1; i >= 0; i--) {
      var c = chips[i];
      var capW = WU.keycapW(18, c[0]);
      ctx.font = font(12, true);
      var w = Math.round(7 + capW + 8 + ctx.measureText(c[1]).width + 10);
      chx -= w + 8;
      panel(ctx, chx, vh - 46, w, 28, { radius: 14, alpha: 0.85 });
      WU.keycap(ctx, chx + 7, vh - 41, 18, c[0]);
      ctx.fillStyle = cream(0.9);
      ctx.font = font(12, true);
      ctx.fillText(c[1], chx + 7 + capW + 8, vh - 27);
    }

    /* toasts (soft entrance: 180 ms fade + slide, soft exit over the tail) */
    var ty = vh - 68;
    for (i = toasts.length - 1; i >= 0; i--) {
      var t = toasts[i];
      t.t -= dt;
      if (t.t <= 0) { toasts.splice(i, 1); continue; }
      ctx.font = font(13);
      var twd = ctx.measureText(t.text).width + 34;
      var age = t.total - t.t;
      var aIn = Math.min(1, age / 180);
      var a = Math.min(aIn, t.t / 400);
      ctx.globalAlpha = a;
      var dy = (1 - aIn) * 6;
      panel(ctx, vw / 2 - twd / 2, ty - 26 + dy, twd, 30, { radius: 15, accent: true });
      ctx.fillStyle = '#f6eeda';
      ctx.textAlign = 'center';
      ctx.fillText(t.text, vw / 2 + 3, ty - 6 + dy);
      ctx.globalAlpha = 1;
      ty -= 38;
    }

    /* interaction prompt: "E — …" over the nearest target, gentle bob */
    if (prompt) {
      var bob2 = Math.sin(performance.now() * 0.006) * 1.5;
      ctx.font = font(13);
      var pw2 = ctx.measureText(prompt.text).width + 52;
      var px = WU.clamp(prompt.x - pw2 / 2, 8, vw - pw2 - 8);
      var pyy = WU.clamp(prompt.y - 40, 40, vh - 80) + bob2;
      panel(ctx, px, pyy, pw2, 28, { radius: 14, alpha: 0.9 });
      WU.keycap(ctx, px + 7, pyy + 5, 18, 'E');
      ctx.fillStyle = '#f6eeda';
      ctx.textAlign = 'center';
      ctx.fillText(prompt.text, px + 30 + (pw2 - 36) / 2, pyy + 19);
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
    g.addColorStop(0, 'rgba(10,14,22,0.6)');
    g.addColorStop(0.42, 'rgba(10,14,22,0.14)');
    g.addColorStop(1, 'rgba(10,14,22,0.7)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    var ly = vh * 0.24;

    /* soft radial glow behind the logo */
    var glow = ctx.createRadialGradient(vw / 2, ly, 20, vw / 2, ly, vw * 0.34);
    var pulse = 0.10 + 0.04 * Math.sin(performance.now() * 0.0012);
    glow.addColorStop(0, 'rgba(255,214,130,' + pulse.toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(255,214,130,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, vw, vh);

    /* logo: letter-spaced serif, cream-to-gold gradient over a soft shadow */
    var spaced = 'WILLOWMERE'.split('').join('\u2009');
    ctx.textAlign = 'center';
    ctx.font = 'italic 700 56px "Times New Roman",serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(spaced, vw / 2 + 3, ly + 4);
    var lg = ctx.createLinearGradient(0, ly - 46, 0, ly + 10);
    lg.addColorStop(0, '#faf3df');
    lg.addColorStop(0.55, '#f2e2b8');
    lg.addColorStop(1, '#e6c07a');
    ctx.fillStyle = lg;
    ctx.fillText(spaced, vw / 2, ly);
    ctx.font = 'italic 18px "Times New Roman",serif';
    ctx.fillStyle = 'rgba(246,236,210,0.9)';
    ctx.fillText('một ánh sáng nhỏ, giữ cùng nhau', vw / 2, ly + 34);

    /* gold flourish: line — diamond — line */
    var fy = ly + 58, half = 120;
    ctx.strokeStyle = 'rgba(240,200,130,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vw / 2 - half, fy); ctx.lineTo(vw / 2 - 12, fy);
    ctx.moveTo(vw / 2 + 12, fy); ctx.lineTo(vw / 2 + half, fy);
    ctx.stroke();
    ctx.save();
    ctx.translate(vw / 2, fy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = 'rgba(20,18,28,0.9)';
    ctx.fillRect(-2.2, -2.2, 4.4, 4.4);
    ctx.restore();

    /* menu */
    var items = [
      { id: 'new', label: 'Chơi mới' },
      { id: 'continue', label: hasSave ? 'Tiếp tục' : 'Tiếp tục (chưa có lưu)', dim: !hasSave },
      { id: 'settings', label: 'Cài đặt' }
    ];
    var bw = 264, bh = 46;
    var by = vh * 0.55;
    for (var i = 0; i < items.length; i++) {
      button(ctx, items[i].label, vw / 2 - bw / 2, by + i * (bh + 14), bw, bh,
        i === sel, items[i].dim, items[i].id);
    }

    /* controls hint in a quiet pill */
    var hint = 'WASD di chuyển \u00b7 E tương tác \u00b7 Q lưới \u00b7 F câu \u00b7 J gậy \u00b7 click nỏ \u00b7 Tab túi \u00b7 Esc tạm dừng';
    ctx.font = font(12);
    var hw = ctx.measureText(hint).width + 36;
    panel(ctx, vw / 2 - hw / 2, vh - 40, hw, 26, { radius: 13, alpha: 0.7 });
    ctx.fillStyle = cream(0.72);
    ctx.textAlign = 'center';
    ctx.fillText(hint, vw / 2, vh - 23);
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
    ctx.font = 'italic 26px "Times New Roman",serif';
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('Tạm dừng', vw / 2, y + 44);
    ctx.strokeStyle = 'rgba(240,200,130,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vw / 2 - 60, y + 56); ctx.lineTo(vw / 2 + 60, y + 56);
    ctx.stroke();
    ctx.fillStyle = '#ffd98a';
    ctx.save();
    ctx.translate(vw / 2, y + 56);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
    var items = [
      { id: 'resume', label: 'Tiếp tục' },
      { id: 'save', label: 'Lưu' },
      { id: 'settings', label: 'Cài đặt' },
      { id: 'quit', label: 'Về màn hình chính' }
    ];
    for (var i = 0; i < items.length; i++) {
      button(ctx, items[i].label, x + 40, y + 70 + i * 50, w - 80, 40, i === sel, false, items[i].id);
    }
    ctx.font = font(11, false, true);
    ctx.fillStyle = 'rgba(242,234,216,0.55)';
    ctx.fillText('Tiến trình cũng được lưu khi bạn ngủ.', vw / 2, y + h - 14);
  }

  /* ---- Settings ---- */
  function drawSettingsOn(ctx, sel, musicVol, sfxVol, muteOn) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    buttons.length = 0;
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fillRect(0, 0, vw, vh);
    var w = 380, h = 300;
    var x = vw / 2 - w / 2, y = vh / 2 - h / 2;
    panel(ctx, x, y, w, h);
    ctx.textAlign = 'center';
    ctx.font = 'italic 24px "Times New Roman",serif';
    ctx.fillStyle = '#f6ecd2';
    ctx.fillText('Cài đặt', vw / 2, y + 42);

    var rows = [
      { id: 'music', label: 'Nhạc', v: musicVol },
      { id: 'sfx', label: 'Hiệu ứng', v: sfxVol },
      { id: 'mute', label: 'Âm thanh' }
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
          var on2 = s < Math.round(rows[i].v * 10);
          ctx.fillStyle = on2 ? '#ffd98a' : 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx + s * 17, ry - 13, 13, 16, 4);
          else ctx.rect(bx + s * 17, ry - 13, 13, 16);
          ctx.fill();
        }
        ctx.font = font(13);
        ctx.fillStyle = 'rgba(242,234,216,0.7)';
        ctx.fillText(String(Math.round(rows[i].v * 10)), bx + bw2 + 12, ry);
      } else {
        ctx.font = font(13);
        ctx.fillStyle = muteOn ? 'rgba(220,190,180,0.85)' : 'rgba(242,234,216,0.7)';
        ctx.fillText(muteOn ? 'đã tắt tiếng' : 'đang phát', x + 130, ry);
      }
      if (sel === i) {
        ctx.fillStyle = '#ffd98a';
        ctx.font = font(13);
        ctx.fillText('\u25c0 \u25b6', x + w - 56, ry);
      }
    }
    ctx.textAlign = 'center';
    button(ctx, 'Quay lại', vw / 2 - 70, y + h - 56, 140, 38, sel === 3, false, 'back');
    ctx.font = font(11);
    ctx.fillStyle = 'rgba(242,234,216,0.5)';
    ctx.fillText('\u2190 \u2192 chỉnh \u00b7 E chọn \u00b7 Esc quay lại', vw / 2, y + h + 20);
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
      ctx.font = 'italic 17px "Times New Roman",serif';
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
  /* wrapping ~20 paragraphs with per-word measureText ran every frame of the
     45 s scroll; the result is cached per (paragraph array, viewport width) */
  var epiCache = { arr: null, vw: -1, items: null, total: 0 };

  function drawEpilogueOn(ctx, paragraphs, scrollT) {
    var vw = ctx.canvas.width / uiDpr();
    var vh = ctx.canvas.height / uiDpr();
    ctx.fillStyle = 'rgba(7,9,14,0.94)';
    ctx.fillRect(0, 0, vw, vh);

    /* measure (cached) */
    if (epiCache.arr !== paragraphs || epiCache.vw !== vw) {
      epiCache.arr = paragraphs;
      epiCache.vw = vw;
      epiCache.items = [];
      epiCache.total = 0;
      for (var m = 0; m < paragraphs.length; m++) {
        var pm = paragraphs[m];
        ctx.font = pm.big ? 'italic 700 34px "Times New Roman",serif' : 'italic 16px "Times New Roman",serif';
        var lm = wrapPara(ctx, pm.text, vw * 0.66);
        var hm = pm.big ? 60 : lm.length * 26 + 18;
        epiCache.items.push({ p: pm, lines: lm, h: hm, font: ctx.font });
        epiCache.total += hm;
      }
    }
    var items = epiCache.items;
    var total = epiCache.total;
    var endH = 60;
    var y = vh * 0.9 - scrollT * (total + endH);
    ctx.textAlign = 'center';
    for (var i = 0; i < items.length; i++) {
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
      ctx.fillText('\u2014 Nhấn E để tiếp tục dạo chơi \u2014', vw / 2, y + 36);
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
