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
  var selMoved = false;     // arrows moved onto a choice this node (see advance)
  var openAt = 0;           // when the current node opened (box slide-in)
  var wrapCache = { key: '', font: '', maxW: -1, lines: null };
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
    if (req.vistaMin !== undefined) {
      /* §3.2 colours quest body: "visit 4 vistas (flag per vista)" — the
         turn-in choices gate on the same count the HUD hint shows */
      var seen = 0, W = window.WWorld, S2 = window.WStory;
      if (W && W.vistas && S2) {
        for (var vi = 0; vi < W.vistas.length; vi++) {
          if (S2.flag('vista_' + W.vistas[vi].id)) seen++;
        }
      }
      if (seen < req.vistaMin) return false;
    }
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
    selMoved = false;
    giftMode = false;
    hitRects.length = 0;
    openAt = (window.performance && performance.now) ? performance.now() : Date.now();
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
    var out = [];
    if (cur && cur.choices) {
      for (var i = 0; i < cur.choices.length; i++) {
        if (checkRequires(cur.choices[i].requires)) out.push(cur.choices[i]);
      }
    }
    /* §5.4: every NPC talk offers "(Give a gift…)" while the pouch holds
       anything. The choice is injected (not authored) so greetings, unlocks
       and quest nodes all grow it; the picker, WAction.gift and
       WStory.onGive do the rest. gift_result itself is excluded so the
       result line always ends the exchange cleanly. */
    if (cur && npcCtx && curId !== 'gift_result' && window.WAction) {
      var hasGift = false;
      for (var j = 0; j < out.length; j++) if (out[j].gift) { hasGift = true; break; }
      if (!hasGift && WAction.list().length > 0) {
        out.push({ label: '(Tặng một món quà\u2026)', gift: true, _gift: true });
      }
    }
    return out;
  }

  function advance() {
    if (!cur) return;
    if (typed < curText.length) { typed = curText.length; return; }  // E completes first
    var vc = visibleChoices();
    if (vc.length) {
      /* A lone injected gift choice keeps E = polite close (§6): the gift is
         chosen deliberately via its number key, a click, or ↑↓ + E. */
      if (vc.length === 1 && vc[0]._gift && !selMoved) { close(); return; }
      choose(sel); return;
    }
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
      lastGift = { speaker: npcCtx.def.name, text: 'Túi bạn trống rồi, Quản lý. Chưa có gì để cho \u2014 chưa thôi.' };
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
    lastGift = { speaker: npcCtx.def.name, text: res ? res.line : 'Cảm ơn, Quản lý.' };
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
    /* shared vector panel (util.js) — the ui.png 9-slice sampled critter
       icons and smeared blue across the box; WU.panel keeps one coherent
       dusk-parchment look with every other screen */
    WU.panel(ctx, x, y, w, h, { radius: 12 });
  }

  function drawPips(ctx, x, y, hearts) {
    var i, on, half;
    var useAtlas = window.WAssets && WAssets.has('ui');
    for (i = 0; i < 10; i++) {
      on = hearts >= i + 1;
      half = !on && hearts > i;
      var hx = x + i * 15;
      if (useAtlas) {
        var col = on || half ? 0 : 1;
        WAssets.sheet(ctx, 'ui', col * 16, 4 * 16, 16, 16, hx, y - 13, 13, 13);
        if (half) {
          /* half heart = empty sprite, then the full sprite clipped left */
          ctx.save();
          ctx.beginPath(); ctx.rect(hx, y - 13, 6.5, 13); ctx.clip();
          WAssets.sheet(ctx, 'ui', 0, 4 * 16, 16, 16, hx, y - 13, 13, 13);
          ctx.restore();
        }
      } else {
        ctx.font = '12px "Segoe UI",Verdana,sans-serif';
        ctx.textAlign = 'left';
        if (half) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillText('\u2665', hx, y);
          ctx.save();
          ctx.beginPath(); ctx.rect(hx, y - 10, 6.5, 12); ctx.clip();
          ctx.fillStyle = '#ff6c96';
          ctx.fillText('\u2665', hx, y);
          ctx.restore();
        } else {
          ctx.fillStyle = on ? '#ff6c96' : 'rgba(255,255,255,0.18)';
          ctx.fillText('\u2665', hx, y);
        }
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
    /* rounded well + soft inner gradient */
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, size, size, 9);
    else ctx.rect(x, y, size, size);
    ctx.clip();
    var pg = ctx.createLinearGradient(0, y, 0, y + size);
    pg.addColorStop(0, 'rgba(30,28,40,0.9)');
    pg.addColorStop(1, 'rgba(14,13,20,0.95)');
    ctx.fillStyle = pg;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 1;
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
    ctx.restore();
    /* speaker-tinted rim + gold hairline */
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x + 1, y + 1, size - 2, size - 2, 8);
    else ctx.rect(x + 1, y + 1, size - 2, size - 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,200,130,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x + 3.5, y + 3.5, size - 7, size - 7, 6);
    else ctx.rect(x + 3.5, y + 3.5, size - 7, size - 7);
    ctx.stroke();
  }

  function itemIcon(key, x, y) {
    var A = window.WAction;
    if (A && A.ITEMS[key]) {
      var kind = A.ITEMS[key].kind;
      if (kind === 'critter' || kind === 'fish') {
        /* this atlas pack has no critter/fish minis — kind-tinted token */
        WU.gemToken(ctx, x + 8, y + 8, 8, Math.abs(WAssets.keyHue(key)) % 360);
        return;
      }
      if (A.ITEM_UI_COL[key] !== undefined && window.WAssets && WAssets.has('ui')) {
        WAssets.sheet(ctx, 'ui', A.ITEM_UI_COL[key] * 16, 5 * 16, 16, 16, x, y, 16, 16);
      }
    }
  }

  /* Progressive reveal of the CACHED full-line wrap: a prefix of a line
     always fits where the full line fits, so the type-on never re-measures. */
  function typedLines(shown) {
    var key = curId + '\u0001' + curText;
    if (wrapCache.key !== key) {
      wrapCache.key = key;
      wrapCache.font = null;         // forces the font/maxW re-check below
      wrapCache.lines = null;
    }
    if (wrapCache.font !== curFont || wrapCache.maxW !== curMaxW) {
      wrapCache.font = curFont;
      wrapCache.maxW = curMaxW;
      wrapCache.lines = wrap(tctx, curText, curMaxW);
    }
    var lines = wrapCache.lines || [];
    var out = [], used = 0, i;
    for (i = 0; i < lines.length; i++) {
      var L = lines[i];
      var cost = L.length + (i > 0 ? 1 : 0);   // the joining space
      if (used + cost > shown) {
        out.push(L.slice(0, Math.max(0, shown - used)));
        return out;
      }
      out.push(L);
      used += cost;
    }
    return out;
  }
  var curFont = '', curMaxW = 0, tctx = null;

  function draw(ctx) {
    if (!cur) return;
    hookCanvas(ctx.canvas);
    hitRects.length = 0;
    var dprv = (window.WGame && typeof WGame.dpr === 'function')
      ? WGame.dpr() : (window.devicePixelRatio || 1);
    var vw = ctx.canvas.width / dprv;
    var vh = ctx.canvas.height / dprv;
    var w = Math.min(760, vw - 80);
    var vc = visibleChoices();
    /* the box grows so the choice list never climbs into the typed text or
       the portrait (portrait bottom sits at y+94; choices start y+128) */
    var h = vc.length ? Math.max(176, 128 + vc.length * 24) : 176;
    var x = (vw - w) / 2;
    var y = vh - h - 18;

    /* soft entrance: slide up + fade over ~180 ms (no state change) */
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var eIn = WU.easeInOut(Math.min(1, (now - openAt) / 180));
    y += (1 - eIn) * 12;
    ctx.globalAlpha = 0.25 + 0.75 * eIn;
    drawPanel(ctx, x, y, w, h);

    var isNarr = curSpeaker === 'narrator' || curSpeaker === '';
    var portrait = !isNarr;

    /* portrait */
    if (portrait) drawPortrait(ctx, x + 14, y + 18, 76);

    /* name plate — dark pill, speaker-tinted edge, gold hairline */
    if (!isNarr) {
      /* display name: map raw ids ("hana") back to the character's full name */
      var spkName = curSpeaker;
      if (window.WNpcs) {
        for (var dn = 0; dn < WNpcs.DEFS.length; dn++) {
          if (WNpcs.DEFS[dn].name === curSpeaker || WNpcs.DEFS[dn].id === curSpeaker) {
            spkName = WNpcs.DEFS[dn].name.split(' ')[0];
            break;
          }
        }
      }
      ctx.font = 'bold 13px "Segoe UI",Verdana,sans-serif';
      var nw = ctx.measureText(spkName).width + 34;
      var tint = CHAR_COLORS[curSpeaker] || '#ffd98a';
      var nx = x + 100;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(nx, y - 13, nw, 26, 13);
      else ctx.rect(nx, y - 13, nw, 26);
      ctx.fill();
      var ng = ctx.createLinearGradient(0, y - 13, 0, y + 13);
      ng.addColorStop(0, 'rgba(52,48,62,0.98)');
      ng.addColorStop(1, 'rgba(30,28,38,0.98)');
      ctx.fillStyle = ng;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(nx, y - 13, nw, 26, 13);
      else ctx.rect(nx, y - 13, nw, 26);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,200,130,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      /* speaker-colour tab */
      ctx.fillStyle = tint;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(nx + 6, y - 7, 4, 14, 2);
      else ctx.rect(nx + 6, y - 7, 4, 14);
      ctx.fill();
      ctx.fillStyle = '#ffe9b8';
      ctx.textAlign = 'left';
      ctx.fillText(spkName, nx + 18, y + 5);
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

    /* typed text (measured once per node, revealed per frame) */
    ctx.font = isNarr ? 'italic 15px Georgia,serif' : '15px "Segoe UI",Verdana,sans-serif';
    ctx.fillStyle = '#f2ead8';
    ctx.textAlign = 'left';
    var tx = portrait ? x + 104 : x + 20;
    curFont = ctx.font;
    curMaxW = w - (portrait ? 144 : 60);
    tctx = ctx;
    var lines = typedLines(Math.floor(typed));
    for (var i = 0; i < lines.length && i < 4; i++) {
      ctx.fillText(lines[i], tx, y + 38 + i * 21);
    }

    if (giftMode) {
      /* gift picker replaces the choice list */
      var gy = y + 52 + Math.min(3, lines.length) * 21;
      ctx.font = '12px "Segoe UI",Verdana,sans-serif';
      ctx.fillStyle = 'rgba(242,234,216,0.6)';
      ctx.fillText('Tặng quà \u2014 chọn một, hoặc \u2191\u2193 + E:', tx, gy);
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
    if (vc.length && typed >= curText.length) {
      var cy = y + h - vc.length * 24 - 10;
      ctx.font = '14px "Segoe UI",Verdana,sans-serif';
      for (i = 0; i < vc.length; i++) {
        var ry2 = cy + i * 24;
        hitRects.push({ kind: 'choice', i: i, x: x + 14, y: ry2 - 15, w: w - 28, h: 22 });
        if (i === sel) {
          ctx.fillStyle = 'rgba(255,214,130,0.14)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x + 16, ry2 - 15, w - 32, 22, 11);
          else ctx.rect(x + 16, ry2 - 15, w - 32, 22);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,214,130,0.75)';
          ctx.lineWidth = 1;
          ctx.stroke();
          /* number badge */
          ctx.fillStyle = '#ffd98a';
          ctx.beginPath(); ctx.arc(x + 28, ry2 - 4, 7.5, 0, WU.TAU); ctx.fill();
          ctx.fillStyle = '#241c10';
          ctx.font = 'bold 11px "Segoe UI",Verdana,sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(i + 1), x + 28, ry2 - 0.5);
          ctx.font = '14px "Segoe UI",Verdana,sans-serif';
          ctx.fillStyle = '#ffd98a';
          ctx.textAlign = 'left';
          ctx.fillText('\u25b8', x + 40, ry2);
          ctx.fillText(vc[i].label, x + 54, ry2);
        } else {
          ctx.fillStyle = 'rgba(207,198,176,0.85)';
          ctx.textAlign = 'left';
          ctx.fillText((i + 1) + '.', x + 22, ry2);
          ctx.fillStyle = 'rgba(242,234,216,0.78)';
          ctx.fillText(vc[i].label, x + 54, ry2);
        }
      }
    } else if (typed >= curText.length ||
               (vc.length === 1 && vc[0]._gift && !selMoved)) {
      /* the lone injected gift keeps E as "end conversation" (§6) */
      var pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.005);
      ctx.globalAlpha = 0.35 + 0.3 * pulse;
      WU.keycap(ctx, x + w - 58, y + h - 26, 18, 'E');
      ctx.globalAlpha = 1;
      ctx.font = '12px "Segoe UI",Verdana,sans-serif';
      ctx.fillStyle = 'rgba(242,234,216,0.8)';
      ctx.textAlign = 'left';
      ctx.fillText('\u25b8', x + w - 34, y + h - 12);
    }
    ctx.globalAlpha = 1;
  }

  /* keyboard nav, called by main */
  function navUp() {
    if (giftMode) { giftMove(-1); return; }
    var vc = visibleChoices();
    if (vc.length) { sel = (sel - 1 + vc.length) % vc.length; selMoved = true; if (window.WAudio) WAudio.sfx('click'); }
  }
  function navDown() {
    if (giftMode) { giftMove(1); return; }
    var vc = visibleChoices();
    if (vc.length) { sel = (sel + 1) % vc.length; selMoved = true; if (window.WAudio) WAudio.sfx('click'); }
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
      speaker: function () { return lastGift ? lastGift.speaker : 'Bạn'; },
      text: function () { return lastGift ? lastGift.text : '\u2026'; },
      next: null
    },
    sleep_offer: {
      speaker: 'narrator',
      text: 'Chiếc giường đã dọn gối sẵn sàng. Ngủ đến sáng?',
      choices: [
        { label: 'Ngủ đến sáng.', sleep: true },
        { label: 'Chưa đâu.', next: null }
      ]
    },
    intro_1: {
      speaker: 'narrator',
      text: 'Chuyến xe buýt thả bạn xuống nơi con đường kết thúc. Một tấm biển viết: WILLOWMERE.',
      next: 'intro_2'
    },
    intro_2: {
      speaker: 'narrator',
      text: 'Hai năm trước ngọn hải đăng tắt. Người giữ đèn già Marlow bước vào đồi núi, theo sau là nỗi tội.',
      next: 'intro_3'
    },
    intro_3: {
      speaker: 'narrator',
      text: 'Ngôi làng trao cho bạn căn nhà của Marlow, một vườn mọc um tùm, và một danh sách những điều tử tế nhỏ.',
      next: 'intro_4'
    },
    intro_4: {
      speaker: 'hana',
      setFlag: 'met_hana',
      text: 'Chìa khóa nhà. Không tính phí, không hoàn tiền. Chào mừng vào danh sách hàng tồn, Quản lý.',
      next: 'intro_5'
    },
    intro_5: {
      speaker: 'narrator',
      setFlag: 'key_given',
      text: 'Chăm sóc ánh sáng bằng cách chăm sóc con người. Ngọn đèn sẽ nói cho bạn biết khi nào đến lúc.',
      next: null
    },
    vista_willow_overlook: { speaker: 'narrator', text: 'Những hàng liễu nghiêng vào nhau như bạn già chia sẻ bí mật.' },
    vista_heron_rock: { speaker: 'narrator', text: 'Một con diệc nhìn bạn nhìn nó. Không ai nhúc nhích trước.' },
    vista_lighthouse_head: { speaker: 'narrator', text: 'Phòng đèn tối đen, nhưng cầu thang còn chắc. Sớm thôi.' },
    vista_shepherds_tor: { speaker: 'narrator', text: 'Gió trên này có mùi cỏ và sự kiên nhẫn.' },
    vista_old_stone_circle: { speaker: 'narrator', text: 'Những viên đá đã đếm nhiều đêm dài hơn của bạn.' }
  });

  /* greetings per NPC per daypart + friendship unlocks + night idles */
  (function () {
    var G = {
      mira: {
        am: 'Bánh nóng lúc bình minh \u2014 em ngửi thấy không? Đó là phần ngon nhất.',
        day: 'Trông em hơi non bột đấy, em à. Ngồi xuống. Ăn gì đi.',
        pm: 'Buổi tối ấm là để dạo bến. Đi bộ cùng suy nghĩ của mình nhé.',
        idle: 'Lò nguội rồi, em à. Đến bơ cũng đi ngủ.'
      },
      gideon: {
        am: 'Coi chừng cỏ xạ hương. Nó cũng đang coi chừng em.',
        day: 'Ong là chủ lao động công bằng. Giờ dài, trả lương thật.',
        pm: 'Nhà kính vẫn ấm đến giờ. Cây cối giữ giờ riêng của chúng.',
        idle: 'Cây đang mơ. Tốt nhất đừng làm phiền.'
      },
      rosa: {
        am: 'Hồi trẻ, chúng tôi tưới cây dưới ánh trăng. Không lý do. Truyền thống.',
        day: 'Đám vịt và tôi có thỏa thuận. Tôi mang bánh mì.',
        pm: 'Hồi trẻ\u2026 ôi thôi quên đi. Buổi tối đẹp nhỉ?',
        idle: 'Hồi trẻ tôi thức khuya. Giờ mặt trăng thức thay tôi.'
      },
      marlow: {
        am: 'Ấm nước sôi. Triều rút. Triều thì trung thực \u2014 ta cố là cả hai.',
        day: 'Người giữ đèn thì phải giữ. Ta đã không. Có hôm câu đó nặng hơn thường ngày.',
        pm: 'Ngọn tháp và ta có một thỏa thuận. Chúng ta chờ.',
        idle: 'Cũng không ngủ được à? Ngọn tháp giữ cả hai chúng ta.'
      },
      finn: {
        am: 'Chào buổi sáng! Giờ câu. ĐỈNH NHẤT. Cá rô còn chưa tỉnh để mà cãi!',
        day: 'Anh thấy hồ chưa? Lấp lánh. TO NHẤT. LUÔN.',
        pm: 'Xem ông nội nhìn ngọn tháp. Thở dài. DÀI NHẤT. LUÔN.',
        idle: 'Thêm một lần thả nữa. Thôi hai lần. Được rồi \u2014 về nhà.'
      },
      hana: {
        am: 'Thư đã phân loại. Bưu kiện: bốn. Bí ẩn: một.',
        day: 'Chào mừng đến cửa hàng. Giá cả: hợp lý. Chuyện phiếm: miễn phí.',
        pm: 'Kiểm kê hoàng hôn: một bầu trời, hơi cũ, không đổi trả.',
        idle: 'Cửa hàng đóng. Tin đồn: cũng đóng.'
      },
      bramble: {
        am: 'Hm. Chào buổi sáng. Số cừu: mười bốn. Số đẹp.',
        day: 'Đồi núi hướng đó đấy. Đồi không vội đâu.',
        pm: 'Đàn cừu uống nước bờ hồ. Ta canh. Cũng việc đó thôi, yên hơn.',
        idle: 'Cừu ngủ rồi. Ta vẫn đếm cho chắc.'
      },
      junie: {
        am: 'Ánh sáng trên mặt nước \u2014 đó là màu của một hơi thở đang nín.',
        day: 'Tôi đang pha một màu xanh lá chỉ tồn tại ở đây. Đừng nói ai nhé.',
        pm: 'Bầu trời lại làm trò đó nữa. Tôi chưa sẵn sàng vẽ nó đâu.',
        idle: 'Đêm có bảng màu riêng. Tôi chỉ là người cầm cọ.'
      }
    };
    var U3 = {
      mira: 'Em là người của làng rồi đấy, Quản lý. Thêm vỏ giòn, miễn phí, mãi mãi.',
      gideon: 'Bầy ong chấp nhận em rồi. Đó là vinh dự đấy, để ý.',
      rosa: 'Hồi trẻ tôi chưa từng gặp ai đáng giới thiệu với đám vịt.',
      marlow: 'Cậu lắng nghe như người giữ đèn. Hiếm hơn cậu tưởng đấy.',
      finn: 'Anh chính thức vào thủy thủ đoàn của em! Nhiệm vụ: mọi thứ. Lương: vinh quang.',
      hana: 'Cậu được giảm giá. Đừng hỏi cái nào. Nó công bằng hơn thôi.',
      bramble: 'Hm. Cậu đi lặng lắm. Tốt cho cừu. Tốt cho bạn bè.',
      junie: 'Tôi vẽ bạn vào nghiên cứu đồng cỏ. Ngay cạnh ánh sáng.'
    };
    var U6 = {
      mira: 'Chị đặt tên em cho một ổ bánh. Nó bán hết sạch. Đừng để nó vào đầu.',
      gideon: 'Nếu ta có mệnh hệ gì, chìa khóa nhà kính nằm dưới bụi xạ hương.',
      rosa: 'Tôi đã viết em vào hồi ký của mình. Chương mười hai. Chương đẹp.',
      marlow: 'Nếu ngọn đèn bao giờ cần đôi tay người giữ đèn nữa\u2026 tay ta vẫn nhớ.',
      finn: 'Khi em là thuyền trưởng nổi tiếng anh được đi miễn phí. MÃI MÃI.',
      hana: 'Cảm xúc: đã nhập lại. Số lượng có hạn. Cậu là lý do.',
      bramble: 'Đàn cừu nhận bước chân cậu rồi. Đó là thứ hiếm kiếm được.',
      junie: 'Willowmere có đủ mọi màu của tôi. Bạn là một trong số đó.'
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
