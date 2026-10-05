/* Willowmere — dialogue.js · window.WDialogue
   Data-driven engine (DESIGN.md §6). Nodes live in plain-object registries
   merged via register(map): generic nodes here (greetings per NPC per
   daypart, gift_result, sleep_offer, vista first-visit lines, the intro
   chain), quest/branch nodes in story.js.

   §6 requires semantics — every present key must pass (AND): flags,
   anyFlags, notFlags, friendship {npc:hearts}, hour [from,to] (wrap ok),
   dayMin, weather, quest {id,state}. Node-level requires gate entry via
   next/start (fail -> failNext or close); choice-level requires HIDE the
   choice. Type-on 40 chars/s; E completes the line then advances; choices
   via ↑↓ + E, number keys 1-9, or mouse click; Esc closes politely.

   Choice extensions used by story.js: setFlags {k:v}, take/give {item:n},
   gift:true (opens the picker), sleep:true (hands off to WGame.sleep),
   run:fn (side effect, e.g. WStory.climb). Every chosen flag goes through
   WStory.setFlag; each choice also records chose_<node>_<i> for the save.
   The box shows a portrait (character-tinted frame + sprite or vector
   bust), the name plate and friendship pips. */
window.WDialogue = (function () {
  'use strict';

  var TYPE_SPEED = 40;      // chars per second (§6)

  var nodes = {};
  var cur = null;
  var curId = '';
  var curText = '';
  var curSpeaker = '';
  var typed = 0;
  var sel = 0;
  var env = null;           // live env, assigned by main each frame
  var npcCtx = null;        // NPC we are talking to (WNpcs instance)
  var giftMode = false;
  var giftItems = [];
  var giftSel = 0;
  var lastGift = null;      // {speaker, text}
  var hitRects = [];        // {kind, i, x, y, w, h} for mouse clicks
  var canvasHooked = false;
  var canvas = null;

  /* portrait frame colour per speaker */
  var CHAR_COLORS = {
    you: '#3f8f86', mira: '#d99a4e', gideon: '#7a9a4e', rosa: '#c78bb0',
    marlow: '#8a9ab0', finn: '#e0b050', hana: '#9a8ac0', bramble: '#a08050',
    junie: '#7ab0b8'
  };
  var SPRITE_ROW = {
    you: 0, mira: 1, gideon: 2, rosa: 3, marlow: 4, finn: 5, hana: 6,
    bramble: 7, junie: 8
  };

  /* ---- registration ---- */
  function register(map) {
    if (!map) return;
    for (var k in map) if (map.hasOwnProperty(k)) nodes[k] = map[k];
  }

  /* ---- flags via WStory ---- */
  function setFlagLive(k, v) {
    if (window.WStory && typeof WStory.setFlag === 'function') WStory.setFlag(k, v);
  }

  function flag(k) {
    var S = window.WStory;
    if (S && S.flags && S.flags.hasOwnProperty(k)) return !!S.flags[k];
    return false;
  }

  /* ---- requires evaluation (§6 table) ---- */
  function checkRequires(req) {
    if (!req) return true;
    var e = env || (window.WWorld && WWorld.env) ||
            (window.WGame && WGame.env) || {};
    var h = e.hour !== undefined ? WU.hnorm(e.hour) : 12;
    var k, i;
    if (req.flags) for (i = 0; i < req.flags.length; i++) if (!flag(req.flags[i])) return false;
    if (req.anyFlags) {
      var any = false;
      for (i = 0; i < req.anyFlags.length; i++) if (flag(req.anyFlags[i])) any = true;
      if (!any) return false;
    }
    if (req.notFlags) for (i = 0; i < req.notFlags.length; i++) if (flag(req.notFlags[i])) return false;
    if (req.friendship) {
      if (!window.WNpcs) return false;
      for (k in req.friendship) {
        if (req.friendship.hasOwnProperty(k) && WNpcs.friend(k) < req.friendship[k]) return false;
      }
    }
    if (req.hour) {
      var a = req.hour[0], b = req.hour[1];
      var inR = a <= b ? (h >= a && h <= b) : (h >= a || h <= b);
      if (!inR) return false;
    }
    if (req.dayMin !== undefined && (e.day || 1) < req.dayMin) return false;
    if (req.weather && req.weather !== 'any' && (e.weather || 'clear') !== req.weather) return false;
    if (req.quest) {
      var q = window.WStory && WStory.QUESTS ? WStory.QUESTS[req.quest.id] : null;
      if (!q || q.state !== req.quest.state) return false;
    }
    if (req.items) {
      if (!window.WAction) return false;
      for (k in req.items) {
        if (req.items.hasOwnProperty(k) && WAction.count(k) < req.items[k]) return false;
      }
    }
    return true;
  }

  /* ---- node runtime ---- */
  function resolve(v) {
    return (typeof v === 'function') ? String(v()) : (v === undefined || v === null) ? '' : String(v);
  }

  function start(nodeId) {
    var n = nodes[nodeId];
    if (!n) return false;
    if (!checkRequires(n.requires)) {
      if (n.failNext) return start(n.failNext);
      return false;
    }
    if (n.setFlag) setFlagLive(n.setFlag, true);
    if (n.setFlags) for (var k in n.setFlags) if (n.setFlags.hasOwnProperty(k)) setFlagLive(k, n.setFlags[k]);
    cur = n;
    curId = nodeId;
    curText = String(resolve(n.text)).slice(0, 120);   // §12: line cap
    curSpeaker = resolve(n.speaker);
    typed = 0;
    sel = 0;
    giftMode = false;
    hitRects.length = 0;
    if (window.WGame && typeof WGame.onDialogueOpened === 'function') {
      WGame.onDialogueOpened();              // PLAY -> DIALOGUE when in play
    }
    return true;
  }

  function close() {
    cur = null;
    curId = '';
    npcCtx = null;
    giftMode = false;
    hitRects.length = 0;
  }

  function active() { return !!cur; }

  function update(dt) {
    if (!cur || giftMode) return;
    if (typed < curText.length) typed = Math.min(curText.length, typed + TYPE_SPEED * dt);
  }

  function visibleChoices() {
    if (!cur || !cur.choices) return [];
    var out = [];
    for (var i = 0; i < cur.choices.length; i++) {
      if (checkRequires(cur.choices[i].requires)) out.push(cur.choices[i]);
    }
    return out;
  }

  function advance() {
    if (!cur) return;
    if (typed < curText.length) { typed = curText.length; return; }  // E completes first
    var vc = visibleChoices();
    if (vc.length) { choose(sel); return; }
    if (cur.next) {
      var nx = cur.next;
      if (!start(nx)) close();
    } else {
      close();
    }
  }

  function applyChoiceEffects(c) {
    if (c.setFlag) setFlagLive(c.setFlag, true);
    if (c.setFlags) for (var k in c.setFlags) if (c.setFlags.hasOwnProperty(k)) setFlagLive(k, c.setFlags[k]);
    if (c.take && window.WAction) {
      for (var k2 in c.take) if (c.take.hasOwnProperty(k2)) WAction.remove(k2, c.take[k2]);
    }
    if (c.give && window.WAction) {
      for (var k3 in c.give) if (c.give.hasOwnProperty(k3)) WAction.add(k3, c.give[k3]);
    }
    if (typeof c.run === 'function') {
      try { c.run(); } catch (e) { /* a broken side effect must not eat the choice */ }
    }
  }

  function choose(i) {
    if (!cur) return;
    var vc = visibleChoices();
    var c = vc[i];
    if (!c) return;
    if (window.WAudio) WAudio.sfx('click');
    /* every choice writes a trace flag through WStory */
    setFlagLive('chose_' + curId + '_' + i, true);
    applyChoiceEffects(c);
    if (c.gift) { openGift(); return; }
    if (c.sleep) {
      close();
      if (window.WGame && typeof WGame.sleep === 'function') WGame.sleep();
      return;
    }
    if (c.next) {
      if (!start(c.next)) close();
    } else {
      close();
    }
  }

  /* ---- gift picker ---- */
  function openGift() {
    if (!window.WAction || !npcCtx) { close(); return; }
    giftItems = WAction.list();
    if (!giftItems.length) {
      lastGift = { speaker: npcCtx.def.name, text: 'Your pockets are empty, Warden. Nothing to give \u2014 yet.' };
      start('gift_result');
      return;
    }
    giftMode = true;
    giftSel = 0;
    hitRects.length = 0;
  }

  function giftMove(d) {
    if (!giftItems.length) return;
    giftSel = (giftSel + d + giftItems.length) % giftItems.length;
    if (window.WAudio) WAudio.sfx('click');
  }

  function giftGive() {
    if (!giftItems.length || !npcCtx) { giftMode = false; return; }
    var key = giftItems[giftSel];
    var res = WAction.gift(npcCtx.id, key);
    /* story-side reactions (early quest opens, palette node, ...) */
    if (window.WStory && typeof WStory.onGive === 'function') {
      WStory.onGive(npcCtx.id, key, res && res.tier);
    }
    lastGift = { speaker: npcCtx.def.name, text: res ? res.line : 'Thank you, Warden.' };
    giftMode = false;
    start('gift_result');
  }

  /* ---- NPC talk: node selection priority (§6) ---- */
  function daypart(h) {
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 17) return 'day';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
  }

  function startForNpc(npc) {
    if (!npc) return false;
    npcCtx = npc;
    /* record the meeting and re-sync quest states BEFORE picking a node,
       so a first talk can immediately surface its quest hook */
    if (window.WStory) {
      if (typeof WStory.onTalk === 'function') WStory.onTalk(npc.id);
      if (typeof WStory.update === 'function') {
        WStory.update(env || (window.WGame && WGame.env) || null);
      }
    }
    var S = window.WStory;
    var qn = (S && typeof S.questNodeFor === 'function') ? S.questNodeFor(npc.id) : null;
    if (qn && start(qn)) return true;
    var bonus = (S && typeof S.talkBonusNode === 'function') ? S.talkBonusNode(npc.id) : null;
    if (bonus && start(bonus)) return true;
    var hearts = window.WNpcs ? WNpcs.friend(npc.id) : 0;
    if (hearts >= 6 && npc.def.unlock6 && start(npc.def.unlock6)) return true;
    if (hearts >= 3 && npc.def.unlock3 && start(npc.def.unlock3)) return true;
    var part = daypart(env && env.hour !== undefined ? WU.hnorm(env.hour) : 12);
    var g = npc.def.greetings[part === 'night' ? 'evening' : part];
    if (g && start(g)) return true;
    return start(npc.id + '_idle');
  }

  /* ---- input hooks (mouse click + number keys) ----
     WInput owns arrows/E/Esc via main; these listeners add choice clicking
     and the 1-9 shortcut without touching the leaf input layer. */
  function hookCanvas(cv) {
    if (canvasHooked || !cv) return;
    canvasHooked = true;
    canvas = cv;
    cv.addEventListener('mousedown', onCanvasDown);
  }

  function onCanvasDown(e) {
    if (!active() || document.hidden) return;
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    for (var i = 0; i < hitRects.length; i++) {
      var h = hitRects[i];
      if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
        if (h.kind === 'choice') choose(h.i);
        else if (h.kind === 'gift') {
          giftSel = (giftSel + h.i) % giftItems.length;
          giftGive();
        }
        return;
      }
    }
  }

  function onDigit(e) {
    if (!active() || giftMode || document.hidden) return;
    var m = /^([1-9])$/.exec(e.code.replace(/^Digit|^Numpad/, ''));
    if (!m) return;
    var idx = parseInt(m[1], 10) - 1;
    if (typed < curText.length) { typed = curText.length; return; }
    var vc = visibleChoices();
    if (idx < vc.length) choose(idx);
  }
  window.addEventListener('keydown', onDigit);

  /* ---- drawing ---- */

  function wrap(ctx, text, maxW) {
    var words = String(text).split(' ');
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = t;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawPanel(ctx, x, y, w, h) {
    if (window.WAssets && WAssets.has('ui')) {
      /* 9-slice: 3x3 cells of 16px at (0,16) in ui.png */
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
    ctx.fillStyle = 'rgba(24,28,38,0.9)';
    ctx.strokeStyle = 'rgba(255,232,180,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }

  function drawPips(ctx, x, y, hearts) {
    ctx.font = '10px "Segoe UI",Verdana,sans-serif';
    for (var i = 0; i < 10; i++) {
      var on = hearts >= i + 1, half = !on && hearts > i;
      ctx.fillStyle = on ? '#ff6c96' : half ? '#ff6c96' : 'rgba(255,255,255,0.18)';
      if (half) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x + i * 13, y - 9, 6.5, 10); ctx.clip();
        ctx.fillText('\u2665', x + i * 13, y);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillText('\u2665', x + i * 13, y);
      } else {
        ctx.fillText('\u2665', x + i * 13, y);
      }
    }
  }

  /* Portrait: character-tinted frame + sprite bust (chars.png) or vector. */
  function drawPortrait(ctx, x, y, size) {
    var spk = curSpeaker;
    /* resolve full display names ("Mira Thistle") back to the id key */
    if (window.WNpcs) {
      for (var d = 0; d < WNpcs.DEFS.length; d++) {
        if (WNpcs.DEFS[d].name === spk || WNpcs.DEFS[d].id === spk) {
          spk = WNpcs.DEFS[d].id;
          break;
        }
      }
    }
    var tint = CHAR_COLORS[spk] || '#5a6470';
    var row = SPRITE_ROW[spk];
    ctx.fillStyle = 'rgba(14,17,24,0.85)';
    ctx.fillRect(x, y, size, size);
    if (row !== undefined && window.WAssets && WAssets.has('chars')) {
      WAssets.sheet(ctx, 'chars', 0, row * 48, 32, 48,
        x + 8, y + 6, size - 16, size - 12);
    } else {
      /* vector bust */
      var cx = x + size / 2;
      ctx.fillStyle = tint;
      ctx.fillRect(cx - 12, y + size * 0.5, 24, size * 0.42);
      ctx.fillStyle = '#e8c39a';
      ctx.beginPath(); ctx.arc(cx, y + size * 0.4, 11, 0, WU.TAU); ctx.fill();
      ctx.fillStyle = '#5a4632';
      ctx.beginPath(); ctx.arc(cx, y + size * 0.36, 11, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#20262c';
      ctx.fillRect(cx - 5, y + size * 0.37, 2.5, 3);
      ctx.fillRect(cx + 2.5, y + size * 0.37, 2.5, 3);
    }
    ctx.strokeStyle = tint;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
  }

  function itemIcon(key, x, y) {
    if (!window.WAssets || !WAssets.has('ui')) return;
    var A = window.WAction;
    var cell = null;
    if (A && A.ITEMS[key]) {
      var kind = A.ITEMS[key].kind;
      if (kind === 'critter') {
        var ci = -1, ORD = ['critter_butterfly', 'critter_cricket', 'critter_oak_beetle',
          'critter_firefly', 'critter_luna_moth', 'critter_dragonfly', 'critter_mayfly',
          'critter_sand_crab', 'critter_glow_worm', 'critter_grasshopper'];
        for (var i = 0; i < ORD.length; i++) if (ORD[i] === key) { ci = i; break; }
        if (ci >= 0) cell = [ci, 5];
      } else if (kind === 'fish') {
        var fi = -1, FOR = ['fish_minnow', 'fish_perch', 'fish_flounder',
          'fish_trout', 'fish_carp', 'fish_moonfish'];
        for (var j = 0; j < FOR.length; j++) if (FOR[j] === key) { fi = j; break; }
        if (fi >= 0) cell = [fi, 6];
      } else if (A.ITEM_UI_COL[key] !== undefined) {
        cell = [A.ITEM_UI_COL[key], 4];
      }
    }
    if (cell) WAssets.sheet(ctx, 'ui', cell[0] * 16, cell[1] * 16, 16, 16, x, y, 16, 16);
  }

  function draw(ctx) {
    if (!cur) return;
    hookCanvas(ctx.canvas);
    hitRects.length = 0;
    var dprv = (window.WGame && typeof WGame.dpr === 'function')
      ? WGame.dpr() : (window.devicePixelRatio || 1);
    var vw = ctx.canvas.width / dprv;
    var vh = ctx.canvas.height / dprv;
    var w = Math.min(760, vw - 80);
    var h = 176;
    var x = (vw - w) / 2;
    var y = vh - h - 18;
    drawPanel(ctx, x, y, w, h);

    var isNarr = curSpeaker === 'narrator' || curSpeaker === '';
    var portrait = !isNarr;

    /* portrait */
    if (portrait) drawPortrait(ctx, x + 14, y + 18, 76);

    /* name plate */
    if (!isNarr) {
      ctx.font = 'bold 13px "Segoe UI",Verdana,sans-serif';
      var nw = ctx.measureText(curSpeaker).width + 24;
      var tint = CHAR_COLORS[curSpeaker] || '#ffd98a';
      ctx.fillStyle = tint;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x + 100, y - 12, nw, 24, 6);
      else ctx.rect(x + 100, y - 12, nw, 24);
      ctx.fill();
      ctx.fillStyle = '#241c10';
      ctx.textAlign = 'left';
      ctx.fillText(curSpeaker, x + 112, y + 4);
    } else {
      ctx.font = 'italic 12px Georgia,serif';
      ctx.fillStyle = 'rgba(242,234,216,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText('\u00b7 \u00b7 \u00b7', x + 18, y + 6);
    }
    /* friendship pips only when the speaker is the NPC we are facing */
    if (npcCtx && (curSpeaker === npcCtx.id || curSpeaker === npcCtx.def.name)) {
      drawPips(ctx, x + w - 150, y + 2, WNpcs.friend(npcCtx.id));
    }

    /* typed text */
    ctx.font = isNarr ? 'italic 15px Georgia,serif' : '15px "Segoe UI",Verdana,sans-serif';
    ctx.fillStyle = '#f2ead8';
    ctx.textAlign = 'left';
    var tx = portrait ? x + 104 : x + 20;
    var shown = curText.slice(0, Math.floor(typed));
    var lines = wrap(ctx, shown, w - (portrait ? 144 : 60));
    for (var i = 0; i < lines.length && i < 4; i++) {
      ctx.fillText(lines[i], tx, y + 38 + i * 21);
    }

    if (giftMode) {
      /* gift picker replaces the choice list */
      var gy = y + 52 + Math.min(3, lines.length) * 21;
      ctx.font = '12px "Segoe UI",Verdana,sans-serif';
      ctx.fillStyle = 'rgba(242,234,216,0.6)';
      ctx.fillText('Give a gift \u2014 click one, or \u2191\u2193 + E:', tx, gy);
      var n = Math.min(3, giftItems.length);
      for (i = 0; i < n; i++) {
        var idx = (giftSel + i) % giftItems.length;
        var key = giftItems[idx];
        var name = (window.WAction && WAction.ITEMS[key]) ? WAction.ITEMS[key].name : key;
        var label = name + ' \u00d7' + WAction.count(key);
        var ry = gy + 20 + i * 24;
        if (i === 0) {
          ctx.fillStyle = 'rgba(255,214,130,0.16)';
          ctx.fillRect(x + 16, ry - 14, w - 32, 22);
          ctx.fillStyle = '#ffd98a';
          ctx.fillText('\u25b8', x + 20, ry);
        } else {
          ctx.fillStyle = '#cfc6b0';
        }
        hitRects.push({ kind: 'gift', i: i, x: x + 16, y: ry - 14, w: w - 32, h: 22 });
        itemIcon(key, x + 36, ry - 12);
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 56, ry);
      }
      return;
    }

    /* choices (visible once the line finished typing) */
    var vc = visibleChoices();
    if (vc.length && typed >= curText.length) {
      var cy = y + h - vc.length * 24 - 10;
      ctx.font = '14px "Segoe UI",Verdana,sans-serif';
      for (i = 0; i < vc.length; i++) {
        var ry2 = cy + i * 24;
        hitRects.push({ kind: 'choice', i: i, x: x + 14, y: ry2 - 15, w: w - 28, h: 22 });
        if (i === sel) {
          ctx.fillStyle = 'rgba(255,214,130,0.16)';
          ctx.fillRect(x + 16, ry2 - 15, w - 32, 22);
          ctx.fillStyle = '#ffd98a';
          ctx.textAlign = 'left';
          ctx.fillText((i + 1) + '. \u25b8 ' + vc[i].label, x + 20, ry2);
        } else {
          ctx.fillStyle = '#cfc6b0';
          ctx.textAlign = 'left';
          ctx.fillText((i + 1) + '.   ' + vc[i].label, x + 20, ry2);
        }
      }
    } else if (typed >= curText.length) {
      var pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.005);
      ctx.font = '12px "Segoe UI",Verdana,sans-serif';
      ctx.fillStyle = 'rgba(242,234,216,' + (0.35 + 0.3 * pulse) + ')';
      ctx.textAlign = 'left';
      ctx.fillText('E \u25b8', x + w - 40, y + h - 12);
    }
  }

  /* keyboard nav, called by main */
  function navUp() {
    if (giftMode) { giftMove(-1); return; }
    var vc = visibleChoices();
    if (vc.length) { sel = (sel - 1 + vc.length) % vc.length; if (window.WAudio) WAudio.sfx('click'); }
  }
  function navDown() {
    if (giftMode) { giftMove(1); return; }
    var vc = visibleChoices();
    if (vc.length) { sel = (sel + 1) % vc.length; if (window.WAudio) WAudio.sfx('click'); }
  }
  function confirm() {
    if (giftMode) { giftGive(); return; }
    advance();
  }
  function cancel() {
    if (giftMode) { giftMode = false; if (window.WAudio) WAudio.sfx('click'); return; }
    close(); // polite close (§6)
  }

  /* ================================================================
     GENERIC REGISTRY (§7): intro chain, sleep_offer, gift_result,
     vista first-visit lines, greetings / unlocks / idles per NPC.
     ================================================================ */
  register({
    gift_result: {
      speaker: function () { return lastGift ? lastGift.speaker : 'You'; },
      text: function () { return lastGift ? lastGift.text : '\u2026'; },
      next: null
    },
    sleep_offer: {
      speaker: 'narrator',
      text: 'The bed is turned down and waiting. Sleep until morning?',
      choices: [
        { label: 'Sleep until morning.', sleep: true },
        { label: 'Not yet.', next: null }
      ]
    },
    intro_1: {
      speaker: 'narrator',
      text: 'The bus leaves you where the road ends. A sign reads: WILLOWMERE.',
      next: 'intro_2'
    },
    intro_2: {
      speaker: 'narrator',
      text: 'Two years ago the lighthouse went dark. Old keeper Marlow walked into the hills, guilt in tow.',
      next: 'intro_3'
    },
    intro_3: {
      speaker: 'narrator',
      text: 'The village hands you Marlow\u2019s cottage, an overgrown garden, and a list of small kindnesses.',
      next: 'intro_4'
    },
    intro_4: {
      speaker: 'hana',
      setFlag: 'met_hana',
      text: 'Cottage key. No charge, no refunds. Welcome to inventory, Warden.',
      next: 'intro_5'
    },
    intro_5: {
      speaker: 'narrator',
      setFlag: 'key_given',
      text: 'Tend the light by tending the people. The lamp will tell you when it\u2019s time.',
      next: null
    },
    vista_willow_overlook: { speaker: 'narrator', text: 'The willows lean together like old friends sharing a secret.' },
    vista_heron_rock: { speaker: 'narrator', text: 'A heron watches you watch it. Neither of you moves first.' },
    vista_lighthouse_head: { speaker: 'narrator', text: 'The lamp room is dark, but the stair is sound. Someday soon.' },
    vista_shepherds_tor: { speaker: 'narrator', text: 'The wind up here smells of grass and patience.' },
    vista_old_stone_circle: { speaker: 'narrator', text: 'The stones have counted longer nights than yours.' }
  });

  /* greetings per NPC per daypart + friendship unlocks + night idles */
  (function () {
    var G = {
      mira: {
        am: 'Fresh loaves at dawn \u2014 you smell that? That\u2019s the good part.',
        day: 'You look a little under-proofed, dear. Sit. Eat something.',
        pm: 'Evening warmth is for dock strolls. Walk with your thoughts.',
        idle: 'Ovens are cold, dear. Even butter sleeps.'
      },
      gideon: {
        am: 'Mind the thyme. It minds you.',
        day: 'Bees are fair employers. Long hours, honest pay.',
        pm: 'The greenhouse stays warm even now. Plants keep their own hours.',
        idle: 'Plants are dreaming. Best not to interrupt.'
      },
      rosa: {
        am: 'When I was young, we watered by moonlight. No reason. Tradition.',
        day: 'The ducks and I have an arrangement. I bring bread.',
        pm: 'When I was young\u2026 oh, never mind. Lovely evening, isn\u2019t it?',
        idle: 'When I was young I stayed up late. Now the moon does it for me.'
      },
      marlow: {
        am: 'Kettle\u2019s on. Tide\u2019s out. Tide\u2019s honest \u2014 I try to be both.',
        day: 'A keeper keeps. I didn\u2019t. Some days that sentence weighs more.',
        pm: 'The tower and I have an understanding. We wait.',
        idle: 'Can\u2019t sleep either? The tower keeps us both.'
      },
      finn: {
        am: 'Morning! Best. Fishing. Hour. The perch aren\u2019t even awake to argue!',
        day: 'Did you see the lake? Biggest. Sparkle. EVER.',
        pm: 'Watched grandpa watch the tower. Biggest. Sigh. EVER.',
        idle: 'One more cast. Okay, two. Okay \u2014 home.'
      },
      hana: {
        am: 'Mail\u2019s sorted. Parcels: four. Mysteries: one.',
        day: 'Welcome to the shop. Prices: fair. Chatter: complimentary.',
        pm: 'Sunset inventory: one sky, slightly used, no returns.',
        idle: 'Shop\u2019s closed. Rumors: also closed.'
      },
      bramble: {
        am: 'Hm. Morning. Sheep count: fourteen. Good number.',
        day: 'Hills are up that way. Hills don\u2019t hurry.',
        pm: 'Flock drinks at the lake edge. I watch. Same thing, quieter.',
        idle: 'Sheep are asleep. I count them anyway.'
      },
      junie: {
        am: 'That light on the water \u2014 it\u2019s the colour of a held breath.',
        day: 'I\u2019m mixing a green that only exists here. Don\u2019t tell anyone.',
        pm: 'The sky\u2019s doing that thing again. I\u2019m not ready to paint it yet.',
        idle: 'The night has its own palette. I\u2019m just holding the brush.'
      }
    };
    var U3 = {
      mira: 'You\u2019re one of us now, Warden. Extra crust, no charge, forever.',
      gideon: 'The hive tolerates you now. That\u2019s an honour, mind.',
      rosa: 'When I was young I never met anyone worth introducing to the ducks.',
      marlow: 'You listen like a keeper. That\u2019s rarer than you\u2019d think.',
      finn: 'You\u2019re officially on my crew! Duties: everything. Pay: glory.',
      hana: 'You get the discount. Don\u2019t ask which one. It\u2019s just fairer.',
      bramble: 'Hm. You walk quiet. Good for sheep. Good for friends.',
      junie: 'I painted you into the meadow study. Right by the light.'
    };
    var U6 = {
      mira: 'I named a loaf after you. It sells out. Don\u2019t let it go to your head.',
      gideon: 'If anything happens to me, the greenhouse keys are under the thyme.',
      rosa: 'I\u2019ve written you into my memoirs. Chapter twelve. The good chapter.',
      marlow: 'If the lamp ever needs a keeper\u2019s hands again\u2026 mine remember.',
      finn: 'When I\u2019m a famous captain you get free passage. FOREVER.',
      hana: 'Feelings: back in stock. Limited supply. You\u2019re the reason.',
      bramble: 'The flock knows your step now. That\u2019s a rare thing to earn.',
      junie: 'Willowmere has all my colours. You\u2019re one of them.'
    };
    var map = {};
    for (var id in G) {
      if (!G.hasOwnProperty(id)) continue;
      map[id + '_am'] = { speaker: id, text: G[id].am, next: null };
      map[id + '_day'] = { speaker: id, text: G[id].day, next: null };
      map[id + '_pm'] = { speaker: id, text: G[id].pm, next: null };
      map[id + '_idle'] = { speaker: id, text: G[id].idle, next: null };
      map[id + '_3hearts'] = { speaker: id, text: U3[id], next: null };
      map[id + '_6hearts'] = { speaker: id, text: U6[id], next: null };
    }
    register(map);
  })();

  window.WDialogue = {
    register: register,
    start: start,
    startForNpc: startForNpc,
    active: active,
    update: update,
    advance: advance,
    choose: choose,
    visibleChoices: visibleChoices,
    checkRequires: checkRequires,
    draw: draw,
    navUp: navUp,
    navDown: navDown,
    confirm: confirm,
    cancel: cancel,
    close: close,
    npc: function () { return npcCtx; }
  };

  /* env setter (main assigns each frame) */
  Object.defineProperty(window.WDialogue, 'env', {
    set: function (v) { env = v; },
    get: function () { return env; }
  });

  return window.WDialogue;
})();
