/* NEON SWARM - js/hud.js
 * HUD + every screen (TITLE / PLAYING / LEVELUP / PAUSED / SETTINGS /
 * GAME OVER / CODEX / PROLOGUE / DAWN), drawn on canvas. Strictly
 * read-only over game state. Public global: window.GameHUD (alias HUD).
 * Contract: DESIGN.md 5.2 + section 8 (+ v2 addendum).
 *
 * Menus: main owns the selection index (game.titleSel etc.); HUD draws the
 * items and writes HUD.menuRects so main can hit-test clicks, exactly like
 * HUD.cardRects on the level-up screen.
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
    crit: '#ffb300', white: '#ffffff', gold: '#ffd166', violet: '#b26bff',
    panel: 'rgba(10,12,30,0.88)', panelLine: 'rgba(53,230,255,0.35)',
    sel: 'rgba(53,230,255,0.12)'
  };

  // Rarity tiers derived from card weight (lower weight = rarer tech).
  function rarityOf(card) {
    if (card.id === 'heal') return { label: 'SUPPLY', color: COL.green };
    if (card.w >= 90) return { label: 'STANDARD', color: COL.dim };
    if (card.w >= 60) return { label: 'ADVANCED', color: COL.cyan };
    return { label: 'PROTOTYPE', color: COL.magenta };
  }

  var BANNER_LIFE = 1.9; // seconds per queued banner (v2: room for sub-lines)

  var banners = [];

  function txt(ctx, str, x, y, size, color, align, baseline) {
    ctx.font = size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = baseline || 'alphabetic';
    ctx.fillText(str, x, y);
  }

  // Letter-spaced variant (Chrome supports ctx.letterSpacing; assigning it is
  // harmless elsewhere).
  function txtL(ctx, str, x, y, size, color, align, ls) {
    var prev = ctx.letterSpacing;
    ctx.letterSpacing = ls;
    txt(ctx, str, x, y, size, color, align);
    ctx.letterSpacing = prev;
  }

  function glowOn(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function glowOff(ctx) { ctx.shadowBlur = 0; }

  function dim(ctx, w, h, a, tint) {
    ctx.fillStyle = tint || ('rgba(3,3,12,' + a + ')');
    ctx.fillRect(0, 0, w, h);
  }

  // Neon panel: fill + border + corner accents (the v2 panel look).
  function panel(ctx, x, y, w, h, lineColor) {
    ctx.fillStyle = COL.panel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = lineColor || COL.panelLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    var c = 9;
    ctx.strokeStyle = lineColor || COL.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
    ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
    ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
    ctx.stroke();
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

  // Segmented bar helper: fill with a border + optional divider ticks.
  function bar(ctx, x, y, w, h, frac, fill, border, segs) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w * GU.clamp(frac, 0, 1), h);
    ctx.strokeStyle = border || 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (segs) {
      ctx.strokeStyle = 'rgba(5,5,14,0.7)';
      for (var i = 1; i < segs; i++) {
        var sx = x + (w * i / segs);
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.lineTo(sx, y + h);
        ctx.stroke();
      }
    }
  }

  /* ---- card icon glyphs (v2) --------------------------------------------------
     One stroke/fill glyph per upgrade id, drawn inside a square of side s
     centered on (cx, cy). Data-driven, no assets. */
  function drawCardIcon(ctx, id, cx, cy, s, color) {
    var h = s / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (id) {
      case 'damage':   // chevron up + plus
        ctx.moveTo(-h * 0.7, h * 0.3); ctx.lineTo(0, -h * 0.5); ctx.lineTo(h * 0.7, h * 0.3);
        ctx.moveTo(0, h * 0.15); ctx.lineTo(0, h * 0.8);
        ctx.moveTo(-h * 0.32, h * 0.5); ctx.lineTo(h * 0.32, h * 0.5);
        ctx.stroke(); break;
      case 'firerate': // triple chevron right
        for (var i = -1; i <= 1; i++) {
          ctx.moveTo(i * h * 0.55 - h * 0.3, -h * 0.55);
          ctx.lineTo(i * h * 0.55 + h * 0.3, 0);
          ctx.lineTo(i * h * 0.55 - h * 0.3, h * 0.55);
        }
        ctx.stroke(); break;
      case 'multishot':// fan of 3 rays
        for (var a = -1; a <= 1; a++) {
          ctx.moveTo(0, h * 0.7);
          ctx.lineTo(Math.sin(a * 0.6) * h * 0.9, -Math.cos(a * 0.6) * h * 0.9 + h * 0.15);
        }
        ctx.stroke(); break;
      case 'pierce':   // arrow through a bar
        ctx.moveTo(-h * 0.9, 0); ctx.lineTo(h * 0.75, 0);
        ctx.moveTo(h * 0.4, -h * 0.35); ctx.lineTo(h * 0.75, 0); ctx.lineTo(h * 0.4, h * 0.35);
        ctx.moveTo(-h * 0.15, -h * 0.6); ctx.lineTo(-h * 0.15, h * 0.6);
        ctx.stroke(); break;
      case 'vampiric': // drop
        ctx.moveTo(0, -h * 0.8);
        ctx.quadraticCurveTo(h * 0.75, h * 0.1, h * 0.42, h * 0.5);
        ctx.quadraticCurveTo(0, h * 0.9, -h * 0.42, h * 0.5);
        ctx.quadraticCurveTo(-h * 0.75, h * 0.1, 0, -h * 0.8);
        ctx.fill(); break;
      case 'speed':    // wind streaks
        for (var r = -1; r <= 1; r++) {
          ctx.moveTo(-h * 0.8, r * h * 0.4);
          ctx.lineTo(h * (0.5 - Math.abs(r) * 0.15), r * h * 0.4);
        }
        ctx.stroke(); break;
      case 'flow':     // circular arrow
        ctx.arc(0, 0, h * 0.62, -2.4, 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(h * 0.62 * Math.cos(0.9) - 5, h * 0.62 * Math.sin(0.9) - 2);
        ctx.lineTo(h * 0.62 * Math.cos(0.9) + 6, h * 0.62 * Math.sin(0.9) + 2);
        ctx.stroke(); break;
      case 'chain':    // lightning bolt
        ctx.moveTo(h * 0.15, -h * 0.9); ctx.lineTo(-h * 0.45, h * 0.1);
        ctx.lineTo(h * 0.05, h * 0.1); ctx.lineTo(-h * 0.15, h * 0.9);
        ctx.lineTo(h * 0.45, -h * 0.1); ctx.lineTo(-h * 0.05, -h * 0.1);
        ctx.closePath(); ctx.fill(); break;
      case 'boom':     // core + rays
        ctx.arc(0, 0, h * 0.3, 0, TAU); ctx.fill();
        ctx.beginPath();
        for (var k = 0; k < 8; k++) {
          var an = k * TAU / 8;
          ctx.moveTo(Math.cos(an) * h * 0.5, Math.sin(an) * h * 0.5);
          ctx.lineTo(Math.cos(an) * h * 0.85, Math.sin(an) * h * 0.85);
        }
        ctx.stroke(); break;
      case 'magnet':   // horseshoe
        ctx.arc(0, -h * 0.1, h * 0.55, Math.PI, 0, false);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-h * 0.55, -h * 0.1); ctx.lineTo(-h * 0.55, h * 0.6);
        ctx.moveTo(h * 0.55, -h * 0.1); ctx.lineTo(h * 0.55, h * 0.6);
        ctx.stroke(); break;
      case 'maxhp':    // shield + cross
        ctx.moveTo(0, -h * 0.85); ctx.lineTo(h * 0.65, -h * 0.5);
        ctx.lineTo(h * 0.65, h * 0.1); ctx.lineTo(0, h * 0.85);
        ctx.lineTo(-h * 0.65, h * 0.1); ctx.lineTo(-h * 0.65, -h * 0.5);
        ctx.closePath(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.35); ctx.lineTo(0, h * 0.35);
        ctx.moveTo(-h * 0.32, 0); ctx.lineTo(h * 0.32, 0);
        ctx.stroke(); break;
      case 'regen':    // cross
        ctx.moveTo(0, -h * 0.7); ctx.lineTo(0, h * 0.7);
        ctx.moveTo(-h * 0.7, 0); ctx.lineTo(h * 0.7, 0);
        ctx.stroke(); break;
      case 'bullet':   // streak
        ctx.moveTo(-h * 0.85, 0); ctx.lineTo(h * 0.55, 0);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(h * 0.7, 0, h * 0.18, 0, TAU); ctx.fill(); break;
      case 'aura':     // ring + center
        ctx.arc(0, 0, h * 0.72, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, h * 0.22, 0, TAU); ctx.fill(); break;
      case 'crit':     // 4-point star
        ctx.moveTo(0, -h * 0.85); ctx.lineTo(h * 0.2, -h * 0.2); ctx.lineTo(h * 0.85, 0);
        ctx.lineTo(h * 0.2, h * 0.2); ctx.lineTo(0, h * 0.85); ctx.lineTo(-h * 0.2, h * 0.2);
        ctx.lineTo(-h * 0.85, 0); ctx.lineTo(-h * 0.2, -h * 0.2); ctx.closePath();
        ctx.fill(); break;
      case 'greedy':   // gem diamond
        ctx.moveTo(0, -h * 0.75); ctx.lineTo(h * 0.6, 0); ctx.lineTo(0, h * 0.75);
        ctx.lineTo(-h * 0.6, 0); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-h * 0.6, 0); ctx.lineTo(h * 0.6, 0); ctx.stroke(); break;
      case 'heal':     // rations: box + cross
        ctx.strokeRect(-h * 0.65, -h * 0.45, h * 1.3, h * 0.9);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.25); ctx.lineTo(0, h * 0.25);
        ctx.moveTo(-h * 0.25, 0); ctx.lineTo(h * 0.25, 0);
        ctx.stroke(); break;
      /* v2 action upgrades */
      case 'nova':     // starburst
        for (var nb = 0; nb < 6; nb++) {
          var na = nb * TAU / 6;
          ctx.moveTo(Math.cos(na) * h * 0.25, Math.sin(na) * h * 0.25);
          ctx.lineTo(Math.cos(na) * h * 0.85, Math.sin(na) * h * 0.85);
        }
        ctx.stroke(); break;
      case 'ricochet': // bouncing zigzag
        ctx.moveTo(-h * 0.8, -h * 0.5); ctx.lineTo(-h * 0.1, h * 0.2);
        ctx.lineTo(h * 0.1, -h * 0.2); ctx.lineTo(h * 0.8, h * 0.5);
        ctx.stroke(); break;
      case 'execution':// downward strike
        ctx.moveTo(-h * 0.55, -h * 0.6); ctx.lineTo(0, h * 0.75);
        ctx.lineTo(h * 0.55, -h * 0.6);
        ctx.stroke(); break;
      case 'plating':  // layered arc (armor)
        ctx.arc(0, 0, h * 0.75, Math.PI * 0.8, Math.PI * 2.2);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, h * 0.45, Math.PI * 0.8, Math.PI * 2.2);
        ctx.stroke(); break;
      case 'tempo':    // clock
        ctx.arc(0, 0, h * 0.7, 0, TAU); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, -h * 0.45);
        ctx.moveTo(0, 0); ctx.lineTo(h * 0.3, 0);
        ctx.stroke(); break;
      case 'shrapnel': // scatter dots
        ctx.arc(0, 0, h * 0.2, 0, TAU); ctx.fill();
        for (var sd = 0; sd < 5; sd++) {
          var sa = sd * TAU / 5 + 0.5;
          ctx.beginPath();
          ctx.arc(Math.cos(sa) * h * 0.62, Math.sin(sa) * h * 0.62, h * 0.11, 0, TAU);
          ctx.fill();
        }
        break;
      default:         // generic chip
        ctx.strokeRect(-h * 0.6, -h * 0.6, h * 1.2, h * 1.2);
        ctx.beginPath(); ctx.arc(0, 0, h * 0.2, 0, TAU); ctx.fill();
        break;
    }
    ctx.restore();
  }

  /* ---- generic vertical menu --------------------------------------------------
     items: [{label, sub, disabled}]. Writes HUD.menuRects for click hit-test. */
  function drawMenu(ctx, items, sel, cx, y0, opts) {
    opts = opts || {};
    var lineH = opts.lineH || 34;
    var w = opts.w || 320;
    HUD.menuRects = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var y = y0 + i * lineH;
      var rect = { x: cx - w / 2, y: y - lineH * 0.62, w: w, h: lineH, i: i };
      HUD.menuRects.push(rect);
      var hov = GI.mouse.x >= rect.x && GI.mouse.x <= rect.x + rect.w &&
                GI.mouse.y >= rect.y && GI.mouse.y <= rect.y + rect.h;
      var on = (i === sel || hov) && !it.disabled;
      if (on) {
        ctx.fillStyle = COL.sel;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        glowOn(ctx, COL.cyan, 12);
      }
      var col = it.disabled ? COL.faint : (on ? COL.white : COL.dim);
      txt(ctx, (on ? '> ' : '  ') + it.label, cx - w / 2 + 14, y, 15, col, 'left', 'middle');
      if (it.sub) txt(ctx, it.sub, cx + w / 2 - 14, y, 12, it.disabled ? COL.faint : COL.faint, 'right', 'middle');
      if (on) glowOff(ctx);
    }
    return y0 + items.length * lineH;
  }

  /* ---- minimap radar (v2) ----------------------------------------------------- */
  function drawMinimap(ctx, game) {
    if (!game.settings.minimap) return;
    var vw = game.viewW;
    var p = game.player;
    var R = 46;
    var cx = vw - 72;
    var cy = 128;
    var range = 800;                     // world px mapped onto R
    var k = R / range;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(8,10,26,0.72)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(53,230,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, TAU);
    ctx.strokeStyle = 'rgba(53,230,255,0.16)';
    ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, TAU); ctx.clip();
    var i, dx, dy;
    for (i = 0; i < game.gems.length; i++) {
      var g = game.gems[i];
      if (g.dead) continue;
      dx = (g.x - p.x) * k; dy = (g.y - p.y) * k;
      if (dx * dx + dy * dy > R * R) continue;
      ctx.fillStyle = 'rgba(57,255,20,0.7)';
      ctx.fillRect(cx + dx - 0.5, cy + dy - 0.5, 1.6, 1.6);
    }
    for (i = 0; i < game.enemies.length; i++) {
      var e = game.enemies[i];
      if (e.dead) continue;
      dx = (e.x - p.x) * k; dy = (e.y - p.y) * k;
      if (dx * dx + dy * dy > R * R) {
        var dd = Math.sqrt(dx * dx + dy * dy);
        dx = dx / dd * (R - 2); dy = dy / dd * (R - 2);   // edge-clamped dot
      }
      ctx.fillStyle = e.isBoss ? COL.red : (e.elite ? COL.white : e.color);
      var rr = e.isBoss ? 3 : (e.elite ? 2.2 : 1.4);
      ctx.fillRect(cx + dx - rr / 2, cy + dy - rr / 2, rr, rr);
    }
    ctx.restore();
    ctx.fillStyle = COL.white;
    ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  var HUD = {
    // Card hit rects; rewritten by every drawLevelUp call (section 5.2).
    cardRects: [],
    // Menu hit rects; rewritten by every drawMenu call (v2).
    menuRects: [],

    showBanner: function (text, sub) {
      banners.push({ text: String(text), sub: sub || null, life: BANNER_LIFE });
      if (banners.length > 4) banners.shift();
    },

    clearBanners: function () { banners.length = 0; },

    // Raw-dt banner timing; banners never slow down with the world.
    update: function (dt) {
      if (banners.length === 0) return;
      banners[0].life -= dt;
      if (banners[0].life <= 0) banners.shift();
    },

    // Queued center-screen banners; optional sub line (wave whispers, boss voice).
    drawBanners: function (ctx, game) {
      if (banners.length === 0) return;
      var b = banners[0];
      var elapsed = BANNER_LIFE - b.life;
      var a = elapsed < 0.2 ? elapsed / 0.2 : (b.life < 0.35 ? b.life / 0.35 : 1);
      var col = b.text.indexOf('BOSS') !== -1 ? COL.red : COL.cyan;
      ctx.save();
      ctx.globalAlpha = GU.clamp(a, 0, 1);
      glowOn(ctx, col, 18);
      txtL(ctx, b.text, game.viewW / 2, game.viewH * 0.28, 34, col, 'center', '3px');
      glowOff(ctx);
      if (b.sub) txt(ctx, b.sub, game.viewW / 2, game.viewH * 0.28 + 30, 13, COL.dim, 'center');
      ctx.restore();
    },

    // ---- PLAYING HUD (section 5.2 layout + v2) ------------------------------
    drawPlaying: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var p = game.player;
      if (!p) return;

      // XP bar: full width, h 8, cyan + travelling shimmer
      var xpF = GU.clamp(game.xp / game.xpNeed, 0, 1);
      ctx.fillStyle = 'rgba(53,230,255,0.14)';
      ctx.fillRect(0, 0, vw, 8);
      ctx.fillStyle = COL.cyan;
      ctx.fillRect(0, 0, vw * xpF, 8);
      if (xpF > 0.02) {
        var shx = ((game.animT * 140) % (vw + 120)) - 60;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(GU.clamp(shx, 0, vw * xpF), 0, 30, 8);
        ctx.globalCompositeOperation = 'source-over';
      }

      // LV badge
      panel(ctx, 14, 12, 58, 15);
      txt(ctx, 'LV ' + game.level, 43, 19.5, 10, COL.cyan, 'center', 'middle');

      // HP bar, segmented every 25 HP; pulses below 30%
      var low = p.hp / p.maxHp < 0.3;
      var hpCol = COL.hp;
      if (low) hpCol = (Math.sin(game.animT * 8) > 0) ? COL.hp : '#ff6b7f';
      bar(ctx, 16, 32, 220, 14, p.hp / p.maxHp, hpCol,
        low ? 'rgba(255,80,100,0.9)' : 'rgba(255,255,255,0.75)',
        Math.round(p.maxHp / 25));
      txt(ctx, Math.ceil(p.hp) + '/' + p.maxHp, 126, 39, 11, COL.white, 'center', 'middle');

      // Score / best, top-right
      txt(ctx, 'SCORE', vw - 16, 26, 11, COL.dim, 'right');
      txt(ctx, GU.fmt(Math.floor(game.score)), vw - 16, 48, 21, COL.white, 'right');
      txt(ctx, 'BEST ' + GU.fmt(game.best ? Math.floor(game.best.score) : 0), vw - 16, 66, 12, COL.faint, 'right');

      // Wave label + progress bar (35 s per wave)
      txt(ctx, 'WAVE ' + GW.state.wave, vw / 2, 27, 13, COL.dim, 'center');
      var wfrac = GU.clamp(GW.state.waveTimer / GW.WAVE_LEN, 0, 1);
      ctx.fillStyle = 'rgba(53,230,255,0.15)';
      ctx.fillRect(vw / 2 - 70, 33, 140, 3);
      ctx.fillStyle = GW.state.bossAlive ? COL.red : COL.cyan;
      ctx.fillRect(vw / 2 - 70, 33, 140 * wfrac, 3);

      // Boss bar y40 w400 h10 while a boss is alive
      var boss = game.boss;
      if (boss && !boss.dead) {
        var bx = vw / 2 - 200;
        bar(ctx, bx, 44, 400, 10, boss.hp / boss.maxHp, COL.red, 'rgba(255,255,255,0.75)');
        txtL(ctx, boss.title || 'SWARM SOVEREIGN', vw / 2, 66, 10, COL.red, 'center', '4px');
      }

      // Combo bottom-left with a visibly draining bar (section 2.4)
      if (game.combo > 0) {
        var m = game.comboMult();
        var cc = m >= 3 ? COL.magenta : (m >= 2 ? COL.crit : COL.cyan);
        var pulse = m >= 2 ? 1 + 0.08 * Math.sin(game.animT * 10) : 1;
        glowOn(ctx, cc, m >= 2 ? 10 : 0);
        txt(ctx, 'COMBO x' + m.toFixed(1), 16, vh - 46, Math.round(15 * pulse), cc, 'left');
        glowOff(ctx);
        txt(ctx, String(game.combo), 130, vh - 46, 11, COL.faint, 'left');
        bar(ctx, 16, vh - 38, 140, 5, game.comboT / (2.0 + (p.stats.comboWindow || 0)), cc, 'rgba(255,255,255,0.2)');
      }

      // Dash indicator bottom-right: r 18 ring fill + SPACE label
      var cx = vw - 44;
      var cy = vh - 44;
      var cdMax = GE.PLAYER_BASE.dashCd * p.stats.dashCdMult;
      var df = cdMax > 0 ? 1 - GU.clamp(p.dashCd / cdMax, 0, 1) : 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(cx, cy, 18, 0, TAU); ctx.stroke();
      if (df > 0) {
        if (df >= 1) glowOn(ctx, COL.cyan, 10);
        ctx.strokeStyle = COL.cyan;
        ctx.beginPath(); ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + df * TAU); ctx.stroke();
        glowOff(ctx);
      }
      txt(ctx, p.dashCd > 0 ? p.dashCd.toFixed(1) : 'RDY', cx, cy, 9,
        df >= 1 ? COL.cyan : COL.dim, 'center', 'middle');
      txt(ctx, 'SPACE', cx, cy + 30, 9, COL.faint, 'center');

      // Nova ring (v2, left of the dash ring) — drawn only once nova exists
      if (p.novaCharge !== undefined) {
        var nx = vw - 96;
        var nf = GU.clamp(p.novaCharge / p.novaNeed, 0, 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(nx, cy, 15, 0, TAU); ctx.stroke();
        if (nf > 0) {
          if (nf >= 1) glowOn(ctx, COL.gold, 12);
          ctx.strokeStyle = COL.gold;
          ctx.beginPath(); ctx.arc(nx, cy, 15, -Math.PI / 2, -Math.PI / 2 + nf * TAU); ctx.stroke();
          glowOff(ctx);
        }
        txt(ctx, nf >= 1 ? 'NOVA' : Math.floor(nf * 100) + '%', nx, cy, 8,
          nf >= 1 ? COL.gold : COL.dim, 'center', 'middle');
        txt(ctx, 'RMB', nx, cy + 27, 9, COL.faint, 'center');
      }

      // Active power pickups (v2): icon chips under the HP bar
      if (p.pickups) {
        var px = 16;
        var py = 52;
        var kinds = ['overdrive', 'havoc', 'surge', 'aegis'];
        var pkCol = { overdrive: COL.cyan, havoc: COL.magenta, surge: COL.crit, aegis: COL.green };
        for (var ki = 0; ki < kinds.length; ki++) {
          var kn = kinds[ki];
          var t = p.pickups[kn];
          if (!t || t <= 0) continue;
          panel(ctx, px, py, 64, 18, pkCol[kn]);
          txt(ctx, kn.toUpperCase().slice(0, 4) + ' ' + Math.ceil(t) + 's',
            px + 32, py + 9, 10, pkCol[kn], 'center', 'middle');
          px += 70;
        }
      }

      // Damage-direction arc at the screen edge (v2)
      if (p.lastHitT > 0) {
        var aa = p.lastHitT / 0.55;
        var rr2 = Math.min(vw, vh) * 0.42;
        ctx.save();
        ctx.translate(vw / 2, vh / 2);
        ctx.rotate(p.lastHitDir);
        ctx.globalAlpha = aa * 0.75;
        ctx.strokeStyle = COL.hp;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, rr2, -0.4, 0.4);
        ctx.stroke();
        ctx.restore();
      }

      drawMinimap(ctx, game);
    },

    // ---- TITLE (v2): chromatic logo + real menu -------------------------------
    drawTitle: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var cxm = vw / 2;
      var logoY = vh * 0.26;

      // Chromatic aberration: magenta + cyan offsets behind the white core.
      var wob = Math.sin(game.animT * 1.7) * 1.5;
      txt(ctx, 'NEON SWARM', cxm - 2 - wob, logoY, 56, COL.magenta, 'center');
      txt(ctx, 'NEON SWARM', cxm + 2 + wob, logoY, 56, COL.cyan, 'center');
      glowOn(ctx, COL.cyan, 22);
      txt(ctx, 'NEON SWARM', cxm, logoY, 56, COL.ink, 'center');
      glowOff(ctx);
      txtL(ctx, 'THE LAST LIGHT IN A DEAD NEON GRID', cxm, logoY + 34, 12, COL.dim, 'center', '5px');

      // Version tag
      txt(ctx, 'v2.0 · THE DAWN PROTOCOL', cxm, logoY + 56, 10, COL.faint, 'center');

      // Menu (items + selection owned by main)
      var mY = vh * 0.52;
      var endY = drawMenu(ctx, game.titleItems || [], game.titleSel, cxm, mY, { lineH: 38, w: 300 });

      if (game.best) {
        txt(ctx, 'BEST ' + GU.fmt(Math.floor(game.best.score)) + '  ·  WAVE ' + (game.best.wave || 1) +
          '  ·  ' + GU.formatTime(game.best.time || 0), cxm, endY + 34, 13, COL.crit, 'center');
      }
      ctx.globalAlpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(game.clock * 4));
      txt(ctx, 'ENTER / CLICK — CONFIRM   ·   ↑↓ — SELECT', cxm, vh - 42, 11, COL.faint, 'center');
      ctx.globalAlpha = 1;
      if (GA.isMuted()) txt(ctx, 'AUDIO MUTED (M)', cxm, vh - 18, 11, COL.faint, 'center');
    },

    // ---- LEVELUP (v2): rarity stripe, icon, deal-in animation -------------------
    drawLevelUp: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var p = game.player;
      var cards = game.levelUpCards || [];
      dim(ctx, vw, vh, 0.62);

      var CW = 238;
      var CH = 310;
      var GAP = 22;
      var total = cards.length * CW + Math.max(0, cards.length - 1) * GAP;
      var x0 = vw / 2 - total / 2;
      var y0 = vh / 2 - CH / 2 - 14;

      glowOn(ctx, COL.cyan, 18);
      txtL(ctx, 'LEVEL ' + game.level + ' — CHOOSE AN UPGRADE', vw / 2, y0 - 36, 24, COL.cyan, 'center', '2px');
      glowOff(ctx);

      // Deal-in animation: cards slide up + fade in, staggered 90 ms.
      var dt2 = game.clock - (game.levelUpShownAt || 0);

      HUD.cardRects = [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var rar = rarityOf(c);
        var inT = GU.clamp((dt2 - i * 0.09) / 0.32, 0, 1);
        var ease = GU.easeOutCubic(inT);
        var r = { x: x0 + i * (CW + GAP), y: y0 + (1 - ease) * 26, w: CW, h: CH };
        HUD.cardRects.push(r);
        var hov = GI.mouse.x >= r.x && GI.mouse.x <= r.x + r.w &&
                  GI.mouse.y >= r.y && GI.mouse.y <= r.y + r.h;
        ctx.save();
        ctx.globalAlpha = inT;
        if (hov) ctx.translate(0, -5);   // hover lift
        panel(ctx, r.x, r.y, r.w, r.h, hov ? rar.color : 'rgba(53,230,255,0.3)');
        // rarity stripe + label
        ctx.fillStyle = rar.color;
        ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 4);
        txtL(ctx, rar.label, r.x + 14, r.y + 26, 9, rar.color, 'left', '3px');
        txt(ctx, '[' + (i + 1) + ']', r.x + r.w - 14, r.y + 28, 13, COL.dim, 'right');
        // icon
        drawCardIcon(ctx, c.id, r.x + r.w / 2, r.y + 78, 44, hov ? rar.color : COL.cyan);
        // name + divider + desc
        txt(ctx, c.name, r.x + r.w / 2, r.y + 132, 16, COL.white, 'center');
        ctx.strokeStyle = 'rgba(53,230,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x + 16, r.y + 144);
        ctx.lineTo(r.x + r.w - 16, r.y + 144);
        ctx.stroke();
        var lines = wrapText(c.desc, 30);
        for (var li = 0; li < lines.length; li++) {
          txt(ctx, lines[li], r.x + r.w / 2, r.y + 166 + li * 17, 11, COL.dim, 'center');
        }
        // Stack pips: filled/empty up to max (heal shows HEAL +30 HP instead).
        var stacks = p.upStacks[c.id] || 0;
        if (isFinite(c.max)) {
          var pw = Math.min(12, (r.w - 60) / c.max);
          var sx = r.x + r.w / 2 - (c.max * pw) / 2;
          for (var s = 0; s < c.max; s++) {
            ctx.fillStyle = s < stacks ? rar.color : 'rgba(255,255,255,0.12)';
            ctx.fillRect(sx + s * pw, r.y + CH - 40, pw - 3, 6);
          }
          txt(ctx, 'LV ' + stacks + ' / ' + c.max, r.x + r.w / 2, r.y + CH - 16, 11, COL.dim, 'center');
        } else {
          txt(ctx, 'HEAL +30 HP', r.x + r.w / 2, r.y + CH - 24, 12, COL.green, 'center');
        }
        if (hov) { glowOn(ctx, rar.color, 14); ctx.strokeStyle = rar.color; ctx.lineWidth = 2; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); glowOff(ctx); }
        ctx.restore();
      }
      txt(ctx, 'CLICK A CARD OR PRESS 1 / 2 / 3', vw / 2, y0 + CH + 38, 12, COL.faint, 'center');
    },

    // ---- PAUSED (v2): real menu -----------------------------------------------
    drawPause: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      dim(ctx, vw, vh, 0.72);
      glowOn(ctx, COL.cyan, 20);
      txtL(ctx, 'PAUSED', vw / 2, vh / 2 - 90, 42, COL.cyan, 'center', '8px');
      glowOff(ctx);
      txt(ctx, 'RUN TIME ' + GU.formatTime(game.runTime) + '  ·  WAVE ' + GW.state.wave +
        '  ·  ' + GU.fmt(Math.floor(game.score)), vw / 2, vh / 2 - 56, 13, COL.dim, 'center');
      drawMenu(ctx, game.pauseItems || [], game.pauseSel, vw / 2, vh / 2 - 8, { lineH: 36, w: 280 });
      txt(ctx, 'P / ESC — RESUME', vw / 2, vh - 40, 12, COL.faint, 'center');
    },

    // ---- SETTINGS (v2): sliders + toggles --------------------------------------
    drawSettings: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var s = game.settings;
      dim(ctx, vw, vh, 0.78);
      glowOn(ctx, COL.cyan, 18);
      txtL(ctx, 'SETTINGS', vw / 2, vh * 0.24, 30, COL.cyan, 'center', '6px');
      glowOff(ctx);

      var rows = game.settingsItems || [];
      var x0 = vw / 2 - 200;
      var y0 = vh * 0.34;
      var lineH = 44;
      HUD.menuRects = [];
      for (var i = 0; i < rows.length; i++) {
        var it = rows[i];
        var y = y0 + i * lineH;
        var rect = { x: x0 - 14, y: y - 16, w: 428, h: 36, i: i };
        HUD.menuRects.push(rect);
        var hov = GI.mouse.x >= rect.x && GI.mouse.x <= rect.x + rect.w &&
                  GI.mouse.y >= rect.y && GI.mouse.y <= rect.y + rect.h;
        var on = i === game.settingsSel || hov;
        if (on) { ctx.fillStyle = COL.sel; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
        txt(ctx, it.label, x0, y + 4, 14, on ? COL.white : COL.dim, 'left', 'middle');
        if (it.kind === 'slider') {
          var v = s[it.key] / 10;
          bar(ctx, x0 + 190, y - 3, 160, 10, v, COL.cyan, 'rgba(53,230,255,0.4)', 10);
          txt(ctx, String(s[it.key]), x0 + 372, y + 4, 12, on ? COL.white : COL.dim, 'left', 'middle');
        } else if (it.kind === 'toggle') {
          var bv = !!s[it.key];
          txt(ctx, bv ? 'ON' : 'OFF', x0 + 250, y + 4, 14,
            bv ? COL.green : COL.faint, 'left', 'middle');
          if (on) txt(ctx, '◄ ► / ENTER', x0 + 372, y + 4, 11, COL.faint, 'left', 'middle');
        } else {
          txt(ctx, 'BACK', x0 + 250, y + 4, 14, on ? COL.white : COL.dim, 'left', 'middle');
        }
      }
      txt(ctx, '↑↓ SELECT  ·  ←→ ADJUST  ·  ESC BACK', vw / 2, y0 + rows.length * lineH + 28, 12, COL.faint, 'center');
    },

    // ---- GAME OVER (v2): count-up stats + epitaph line --------------------------
    drawGameOver: function (ctx, game) {
      var vw = game.viewW;
      var vh = game.viewH;
      var s = game.overStats;
      dim(ctx, vw, vh, 0.8, 'rgba(20,4,10,0.8)');
      glowOn(ctx, COL.red, 24);
      txtL(ctx, 'SIGNAL LOST', vw / 2, vh * 0.2, 46, COL.red, 'center', '4px');
      glowOff(ctx);
      if (!s) return;

      // Rotating epitaph (main picks one per death).
      if (game.epitaph) {
        txt(ctx, game.epitaph, vw / 2, vh * 0.2 + 34, 13, COL.dim, 'center');
      }

      var pw = 380;
      var ph = 236;
      var px = vw / 2 - pw / 2;
      var py = vh * 0.2 + 52;
      panel(ctx, px, py, pw, ph);

      // Count-up: rows fade in staggered; the big numbers count to target.
      var t = game.clock - (game.overShownAt || 0);
      var kf = GU.easeOutCubic(GU.clamp(t / 0.9, 0, 1));
      var rows = [
        ['TIME', GU.formatTime(s.time)],
        ['WAVE', String(s.wave)],
        ['LEVEL', String(s.level)],
        ['KILLS', GU.fmt(Math.floor(s.kills * kf))],
        ['SCORE', GU.fmt(Math.floor(s.score * kf))],
        ['BEST', GU.fmt(game.best ? Math.floor(game.best.score) : s.score)]
      ];
      for (var i = 0; i < rows.length; i++) {
        var ry = py + 40 + i * 30;
        ctx.globalAlpha = GU.clamp((t - i * 0.08) / 0.3, 0, 1);
        txt(ctx, rows[i][0], px + 26, ry, 14, COL.dim, 'left');
        txt(ctx, rows[i][1], px + pw - 26, ry, 16, i === 4 ? COL.gold : COL.white, 'right');
        ctx.globalAlpha = 1;
      }

      var by = py + ph;
      if (s.isNewBest) {
        ctx.globalAlpha = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(game.clock * 6));
        glowOn(ctx, COL.magenta, 12);
        txt(ctx, 'NEW BEST!', vw / 2, by + 38, 20, COL.magenta, 'center');
        glowOff(ctx);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(game.clock * 4));
      txt(ctx, 'CLICK TO RETRY  ·  T FOR TITLE', vw / 2, by + (s.isNewBest ? 74 : 44), 16, COL.white, 'center');
      ctx.globalAlpha = 1;
    }
  };

  window.GameHUD = HUD;
})();
