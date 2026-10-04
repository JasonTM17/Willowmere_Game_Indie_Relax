/* NEON SWARM - js/hud.js
 * HUD + every screen (TITLE / PLAYING / LEVELUP / PAUSED / GAME OVER), drawn
 * on canvas. Strictly read-only over game state. Public global: window.GameHUD
 * (alias HUD). Contract: DESIGN.md 5.2 + section 8.
 *
 * Banners live in a HUD-owned queue fed by game.showBanner(text).
 * HUD.cardRects is set by every drawLevelUp call; main.js hit-tests clicks.
 */
(function () {
  'use strict';

  var GU = window.GameUtil;
  var GI = window.GameInput;
  var GA = window.GameAudio;
  var GW = window.GameWaves;
  var GE = window.GameEntities;

  var FONT = 'Consolas, "Courier New", monospace';
  var TAU = GU.TAU;

  var COL = {
    cyan: '#35e6ff', hp: '#ff3355', red: '#ff3131', magenta: '#ff2d95',
    green: '#39ff14', ink: '#e8f6ff', dim: '#8ea2b8', faint: '#5f6f86',
    crit: '#ffb300', white: '#ffffff',
    panel: 'rgba(10,12,30,0.88)', panelLine: 'rgba(53,230,255,0.35)'
  };

  var BANNER_LIFE = 1.6; // seconds per queued banner (section 5.2)

  var banners = [];

  function txt(ctx, str, x, y, size, color, align, baseline) {
    ctx.font = size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = baseline || 'alphabetic';
    ctx.fillText(str, x, y);
  }

  function glowOn(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function glowOff(ctx) { ctx.shadowBlur = 0; }

  function dim(ctx, w, h, a, tint) {
    ctx.fillStyle = tint || ('rgba(3,3,12,' + a + ')');
    ctx.fillRect(0, 0, w, h);
  }

  function wrapText(str, maxChars) {
    var words = String(str).split(' ');
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (test.length <= maxChars) { cur = test; }
      else { if (cur) lines.push(cur); cur = words[i]; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  var HUD = {
    // Card hit rects; rewritten by every drawLevelUp call (section 5.2).
    cardRects: [],

    showBanner: function (text) {
      banners.push({ text: String(text), life: BANNER_LIFE });
      if (banners.length > 4) banners.shift();
    },

    clearBanners: function () { banners.length = 0; },

    // Raw-dt banner timing; banners never slow down with the world.
    update: function (dt) {
      if (banners.length === 0) return;
      banners[0].life -= dt;
      if (banners[0].life <= 0) banners.shift();
    },

    // Queued center-screen banners, 1.6 s fade each (front only).
    drawBanners: function (ctx, game) {
      if (banners.length === 0) return;
      var b = banners[0];
      var elapsed = BANNER_LIFE - b.life;
      var a = elapsed < 0.2 ? elapsed / 0.2 : (b.life < 0.35 ? b.life / 0.35 : 1);
      var col = b.text.indexOf('BOSS') !== -1 ? COL.red : COL.cyan;
      ctx.save();
      ctx.globalAlpha = GU.clamp(a, 0, 1);
      glowOn(ctx, col, 18);
      txt(ctx, b.text, game.viewW / 2, game.viewH * 0.28, 34, col, 'center');
      glowOff(ctx);
      ctx.restore();
    },

    // ---- PLAYING HUD (section 5.2 layout) ----------------------------------
    drawPlaying: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var p = game.player;
      if (!p) return;

      // XP bar: full width, h 8, cyan
      ctx.fillStyle = 'rgba(53,230,255,0.14)';
      ctx.fillRect(0, 0, vw, 8);
      ctx.fillStyle = COL.cyan;
      ctx.fillRect(0, 0, vw * GU.clamp(game.xp / game.xpNeed, 0, 1), 8);

      // LV badge
      ctx.fillStyle = 'rgba(5,8,20,0.85)';
      ctx.fillRect(14, 11, 58, 13);
      ctx.strokeStyle = 'rgba(53,230,255,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(14.5, 11.5, 57, 12);
      txt(ctx, 'LV ' + game.level, 43, 18, 10, COL.cyan, 'center', 'middle');

      // HP bar x16 y24 w220 h14 + hp/maxHp text
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(16, 24, 220, 14);
      ctx.fillStyle = COL.hp;
      ctx.fillRect(16, 24, 220 * GU.clamp(p.hp / p.maxHp, 0, 1), 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeRect(16.5, 24.5, 219, 13);
      txt(ctx, Math.ceil(p.hp) + '/' + p.maxHp, 126, 31, 11, COL.white, 'center', 'middle');

      // Score / best, top-right
      txt(ctx, 'SCORE', vw - 16, 26, 11, COL.dim, 'right');
      txt(ctx, GU.fmt(Math.floor(game.score)), vw - 16, 47, 20, COL.white, 'right');
      txt(ctx, 'BEST ' + GU.fmt(game.best ? Math.floor(game.best.score) : 0), vw - 16, 64, 12, COL.faint, 'right');

      // Wave label, top-center
      txt(ctx, 'WAVE ' + GW.state.wave, vw / 2, 27, 13, COL.dim, 'center');

      // Boss bar y40 w400 h10 while a boss is alive
      var boss = game.boss;
      if (boss && !boss.dead) {
        var bx = vw / 2 - 200;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(bx, 40, 400, 10);
        ctx.fillStyle = COL.red;
        ctx.fillRect(bx, 40, 400 * GU.clamp(boss.hp / boss.maxHp, 0, 1), 10);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.strokeRect(bx + 0.5, 40.5, 399, 9);
        txt(ctx, 'SWARM SOVEREIGN', vw / 2, 64, 10, COL.red, 'center');
      }

      // Combo bottom-left with a visibly draining bar (section 2.4)
      if (game.combo > 0) {
        var m = game.comboMult();
        var cc = m >= 3 ? COL.magenta : (m >= 2 ? COL.crit : COL.cyan);
        txt(ctx, 'COMBO x' + m.toFixed(1), 16, vh - 42, 15, cc, 'left');
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(16, vh - 34, 140, 5);
        ctx.fillStyle = cc;
        ctx.fillRect(16, vh - 34, 140 * GU.clamp(game.comboT / 2.0, 0, 1), 5);
      }

      // Dash indicator bottom-right: r 18 ring fill + SPACE label
      var cx = vw - 44;
      var cy = vh - 44;
      var cdMax = GE.PLAYER_BASE.dashCd * p.stats.dashCdMult;
      var df = cdMax > 0 ? 1 - GU.clamp(p.dashCd / cdMax, 0, 1) : 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, TAU);
      ctx.stroke();
      if (df > 0) {
        if (df >= 1) glowOn(ctx, COL.cyan, 10);
        ctx.strokeStyle = COL.cyan;
        ctx.beginPath();
        ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + df * TAU);
        ctx.stroke();
        glowOff(ctx);
      }
      txt(ctx, p.dashCd > 0 ? p.dashCd.toFixed(1) : 'RDY', cx, cy, 9,
        df >= 1 ? COL.cyan : COL.dim, 'center', 'middle');
      txt(ctx, 'SPACE', cx, cy + 30, 9, COL.faint, 'center');
    },

    // ---- TITLE (section 8) ---------------------------------------------------
    drawTitle: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var cxm = vw / 2;
      var logoY = vh * 0.28;
      glowOn(ctx, COL.cyan, 26);
      txt(ctx, 'NEON SWARM', cxm, logoY, 54, COL.cyan, 'center');
      glowOff(ctx);
      txt(ctx, 'the last light in a dead neon grid', cxm, logoY + 36, 13, COL.dim, 'center');

      // Controls panel = the how-to-play screen (section 8 TITLE spec)
      var pw = 470;
      var ph = 84;
      var px = cxm - pw / 2;
      var py = logoY + 64;
      ctx.fillStyle = COL.panel;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = COL.panelLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      txt(ctx, 'WASD MOVE  \u00B7  MOUSE AIM  \u00B7  HOLD LMB FIRE  \u00B7  SPACE DASH', cxm, py + 34, 14, COL.ink, 'center');
      txt(ctx, 'P PAUSE  \u00B7  M MUTE  \u00B7  STACK UPGRADES EVERY LEVEL', cxm, py + 62, 14, COL.ink, 'center');

      if (game.best) {
        txt(ctx, 'BEST ' + GU.fmt(Math.floor(game.best.score)) + '  \u00B7  WAVE ' + (game.best.wave || 1),
          cxm, py + ph + 36, 15, COL.crit, 'center');
      }
      ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(game.clock * 4));
      txt(ctx, 'CLICK TO START', cxm, py + ph + 86, 22, COL.white, 'center');
      ctx.globalAlpha = 1;
      if (GA.isMuted()) txt(ctx, 'AUDIO MUTED (M)', cxm, vh - 18, 11, COL.faint, 'center');
    },

    // ---- LEVELUP (section 8): dim overlay + 3 cards --------------------------
    drawLevelUp: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var p = game.player;
      var cards = game.levelUpCards || [];
      dim(ctx, vw, vh, 0.6);

      var CW = 232;
      var CH = 300;
      var GAP = 20;
      var total = cards.length * CW + Math.max(0, cards.length - 1) * GAP;
      var x0 = vw / 2 - total / 2;
      var y0 = vh / 2 - CH / 2 - 10;

      glowOn(ctx, COL.cyan, 18);
      txt(ctx, 'LEVEL ' + game.level + ' - CHOOSE AN UPGRADE', vw / 2, y0 - 34, 26, COL.cyan, 'center');
      glowOff(ctx);

      HUD.cardRects = [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var r = { x: x0 + i * (CW + GAP), y: y0, w: CW, h: CH };
        HUD.cardRects.push(r);
        var hov = GI.mouse.x >= r.x && GI.mouse.x <= r.x + r.w &&
                  GI.mouse.y >= r.y && GI.mouse.y <= r.y + r.h;
        ctx.fillStyle = COL.panel;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (hov) glowOn(ctx, COL.cyan, 16);
        ctx.strokeStyle = hov ? COL.cyan : 'rgba(53,230,255,0.4)';
        ctx.lineWidth = hov ? 2 : 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        glowOff(ctx);
        txt(ctx, '[' + (i + 1) + ']', r.x + 14, r.y + 28, 14, COL.cyan, 'left');
        txt(ctx, c.name, r.x + 14, r.y + 62, 17, COL.white, 'left');
        ctx.strokeStyle = 'rgba(53,230,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x + 14, r.y + 76);
        ctx.lineTo(r.x + r.w - 14, r.y + 76);
        ctx.stroke();
        var lines = wrapText(c.desc, 28);
        for (var li = 0; li < lines.length; li++) {
          txt(ctx, lines[li], r.x + 14, r.y + 100 + li * 17, 12, COL.dim, 'left');
        }
        // Current stack count "LV n/max"; the heal fallback never stacks.
        var stacks = p.upStacks[c.id] || 0;
        var maxLabel = isFinite(c.max) ? ('LV ' + stacks + ' / ' + c.max) : 'HEAL +30 HP';
        txt(ctx, maxLabel, r.x + 14, r.y + CH - 24, 13, COL.cyan, 'left');
      }
      txt(ctx, 'CLICK A CARD OR PRESS 1 / 2 / 3', vw / 2, y0 + CH + 34, 12, COL.faint, 'center');
    },

    // ---- PAUSED (section 8) ---------------------------------------------------
    drawPause: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      dim(ctx, vw, vh, 0.72);
      glowOn(ctx, COL.cyan, 20);
      txt(ctx, 'PAUSED', vw / 2, vh / 2 - 8, 44, COL.cyan, 'center');
      glowOff(ctx);
      txt(ctx, 'P / ESC RESUME  \u00B7  M MUTE  \u00B7  Q QUIT TO TITLE', vw / 2, vh / 2 + 40, 14, COL.dim, 'center');
      txt(ctx, 'WASD MOVE  \u00B7  HOLD LMB FIRE  \u00B7  SPACE DASH', vw / 2, vh / 2 + 66, 12, COL.faint, 'center');
    },

    // ---- GAME OVER (section 8): stats block + best ----------------------------
    drawGameOver: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var s = game.overStats;
      dim(ctx, vw, vh, 0.78, 'rgba(20,4,10,0.78)');
      glowOn(ctx, COL.red, 24);
      txt(ctx, 'GAME OVER', vw / 2, vh * 0.22, 46, COL.red, 'center');
      glowOff(ctx);
      if (!s) return;

      var pw = 360;
      var ph = 232;
      var px = vw / 2 - pw / 2;
      var py = vh * 0.22 + 22;
      ctx.fillStyle = COL.panel;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = COL.panelLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

      var rows = [
        ['TIME', GU.formatTime(s.time)],
        ['WAVE', String(s.wave)],
        ['LEVEL', String(s.level)],
        ['KILLS', GU.fmt(s.kills)],
        ['SCORE', GU.fmt(s.score)],
        ['BEST', GU.fmt(game.best ? Math.floor(game.best.score) : s.score)]
      ];
      for (var i = 0; i < rows.length; i++) {
        var ry = py + 40 + i * 30;
        txt(ctx, rows[i][0], px + 24, ry, 14, COL.dim, 'left');
        txt(ctx, rows[i][1], px + pw - 24, ry, 16, COL.white, 'right');
      }

      var by = py + ph;
      if (s.isNewBest) {
        ctx.globalAlpha = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(game.clock * 6));
        txt(ctx, 'NEW BEST!', vw / 2, by + 38, 20, COL.magenta, 'center');
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(game.clock * 4));
      txt(ctx, 'CLICK TO RETRY  \u00B7  T FOR TITLE', vw / 2, by + (s.isNewBest ? 74 : 44), 16, COL.white, 'center');
      ctx.globalAlpha = 1;
    }
  };

  window.GameHUD = HUD;
})();
