/* Willowmere — main.js · window.WGame
   The ONLY orchestrator (DESIGN.md §7): state machine TITLE / PLAY / DIALOGUE
   / VISTA / PAUSE / SETTINGS / EPILOGUE, rAF loop with clamped dt, DPR canvas,
   camera + zoom, save/load/sleep, music director, vista triggers, auto-pause.
   Draw order: drawBack -> drawUnder -> y-sorted bodies -> drawOver ->
   drawOver(world) -> bunting -> particles -> lights -> hour tint -> HUD ->
   dialogue -> fades. WInput.endFrame() last in every frame. */
window.WGame = (function () {
  'use strict';

  var SAVE_KEY = 'willowmere_save';

  var canvas = null, ctx = null;
  var dpr = 1;
  var state = 'TITLE';       // TITLE|PLAY|DIALOGUE|VISTA|PAUSE|SETTINGS|EPILOGUE
  var prePause = 'PLAY';     // state to return to after pause/settings
  var settingsReturn = 'TITLE';

  var env = {
    day: 1, hour: 18.4, weather: 'clear', night: false,
    frozen: false, player: null
  };
  var player = { x: 944, y: 1872, dir: 'down', walkT: 0, moving: false, speed: 84, boat: null,
    hp: 3, maxHp: 3, invuln: 0, kx: 0, ky: 0, kt: 0 };
  var lastStep = -1;         // walk-frame counter at the last emitted footstep

  var cam = { x: 0, y: 0 };
  var zoom = 1, zoomTgt = 1;
  /* smoothed follow focus + look-ahead (polish): the zoom eases, so the pan
     should too; clamping and the integer translate stay as they were */
  var camFx = 944, camFy = 1872;
  var lookX = 0, lookY = 0;

  var last = 0, raf = 0;
  var hasSave = false;
  var saveInfo = null;          // cached readSave() for the title's save line
  var OPTS_KEY = 'willowmere_opts';
  var opts = { shake: true };   // accessibility prefs, persisted separately from the save
  var pulseT = 0;               // slow clock for ambient UI pulses (low-hp warning)
  var curMusic = '';
  var audioReadySeen = false;
  var arcadeOverlay = null;     // the old cabinet: Neon Swarm iframe overlay

  var titleSel = 0;
  var titleConfirmNew = false;   // armed by the first "Chơi mới" press when a save exists
  var pauseSel = 0;
  var settingsSel = 0;
  var vista = null;          // active vista record {v, t, first}
  var vinside = false;       // player was inside a vista radius last PLAY frame
  var epi = { shown: false, t: 0, scroll: 0, lines: [] };
  var sleepFx = { active: false, phase: 0, t: 0 };
  var enterFx = 0;           // black veil lifting after title -> world
  var faintFx = { active: false, phase: 0, t: 0 };
  var hurtFx = 0;              // red vignette seconds-left after taking a hit
  var shakeT = 0;              // camera shake seconds-left — same trigger
  var dayCard = { t: 0, day: 1 }; // "— Ngày N —" morning title card
  var regenT = 45;             // one heart quietly mends every 45 s of play

  /* ============================== BOOT ============================== */

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(320, Math.floor(w * dpr));
    canvas.height = Math.max(240, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function boot() {
    canvas = document.getElementById('game');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    WInput.attach(canvas);
    WWorld.build();          // deterministic; story interactables re-added by wrapper
    WNpcs.init();
    env.player = player;
    syncEnv();
    zoomTgt = 0.8;           // title backdrop: gentle pull-back over the green

    hasSave = anySaveExists();
    saveInfo = readSave();
    var o = WU.load(OPTS_KEY);
    if (o && typeof o === 'object') for (var ok2 in o) opts[ok2] = o[ok2];
    WAssets.load();          // background; placeholders render until settled

    /* sleep offer via hook (overrides world's direct sleep call) */
    WWorld.hooks.door_player = function () {
      var h = WU.hnorm(env.hour);
      if (h >= 18 || h < 5) {
        WDialogue.start('sleep_offer');
        if (WDialogue.active()) state = 'DIALOGUE';
      } else if (h < 7) {
        WHUD.toast('Trời còn tối \u2014 đợi mặt trời lên đã.');   // darkness clears at 07:00
        WAudio.sfx('click');
      } else {
        WHUD.toast('Trời còn sáng lắm \u2014 quay lại sau 18:00 nhé.');
        WAudio.sfx('click');
      }
    };

    /* the old cabinet (Neon Swarm overlay): the ✕ close button, plus two Esc
       paths — the keydown below only fires while the parent page (bezel)
       holds focus; while the iframe holds focus, Neon Swarm relays Esc from
       its own title screen as a 'wm-arcade-esc' message (a keydown inside
       the iframe never reaches this window). Only the cabinet's own frame
       is trusted as the message source. */
    arcadeOverlay = document.getElementById('arcade-overlay');
    var closeBtn = document.getElementById('arcade-close');
    if (closeBtn) closeBtn.addEventListener('click', closeArcade);
    window.addEventListener('keydown', function (e) {
      if (state === 'ARCADE' && e.code === 'Escape') {
        WInput.consume('pause');      // the same Esc must not reopen pause a frame later
        closeArcade();
      }
    });
    window.addEventListener('message', function (e) {
      var frame = document.getElementById('arcade-frame');
      if (state === 'ARCADE' && e.data === 'wm-arcade-esc' &&
          frame && e.source === frame.contentWindow) {
        closeArcade();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) autoPause();
    });
    window.addEventListener('blur', autoPause);

    last = (window.performance && performance.now) ? performance.now() : Date.now();
    raf = requestAnimationFrame(frame);
  }

  function autoPause() {
    if (state === 'ARCADE') return;   // the iframe losing focus is normal play
    if (state === 'PLAY' || state === 'DIALOGUE' || state === 'VISTA') {
      /* a hidden tab may never come back — keep the day it had */
      if (document.hidden) saveGame(true);
      prePause = state === 'PAUSE' ? prePause : state;
      state = 'PAUSE';
      pauseSel = 0;
    }
  }

  /* ============================== ARCADE ============================== */
  /* The old cabinet: Neon Swarm boots inside an iframe with its own loop,
     input and localStorage — full isolation, zero shared globals. The
     village freezes behind it (state ARCADE skips the world update). */
  function openArcade() {
    if (state !== 'PLAY' && state !== 'DIALOGUE') return;
    var frame = document.getElementById('arcade-frame');
    if (!arcadeOverlay || !frame) return;
    WDialogue.close();
    env.frozen = true;
    WAudio.stopMusic();
    frame.src = '../neon-swarm/index.html';
    arcadeOverlay.hidden = false;
    try { frame.contentWindow && frame.contentWindow.focus(); } catch (e) {}
    state = 'ARCADE';
    WAudio.sfx('interact');
  }

  function closeArcade() {
    if (state !== 'ARCADE') return;
    var frame = document.getElementById('arcade-frame');
    /* If the run in there reached the DAWN ending, the cabinet remembers.
       contentWindow is same-origin over http; file:// may refuse — fine. */
    var won = false;
    try {
      won = !!(frame && frame.contentWindow && frame.contentWindow.GameCodex &&
               frame.contentWindow.GameCodex.data && frame.contentWindow.GameCodex.data.won);
    } catch (e) { won = false; }
    if (frame) frame.src = 'about:blank';      // kills the loop + audio
    if (arcadeOverlay) arcadeOverlay.hidden = true;
    /* the relay close happens with the iframe still holding focus (no
       parent-page click moved it) — hand the keyboard back or every key
       after leaving the cabinet dies with it */
    try { window.focus(); } catch (e) {}
    env.frozen = false;
    curMusic = '';                              // re-trigger musicKey next update
    state = 'PLAY';
    if (won && !WStory.flag('arcade_dawn_seen')) {
      WStory.setFlag('arcade_dawn_seen', true);
      WHUD.toast('Màn hình chiếc tủ dịu xuống, ấm hơn hẳn. Thứ gì đó vừa thức dậy trong lưới neon.');
      WAudio.sfx('chime');
    } else {
      WAudio.sfx('click');
    }
  }

  /* ============================== STATE ============================== */

  function toTitle() {
    state = 'TITLE';
    titleSel = 0;
    titleConfirmNew = false;
    hasSave = anySaveExists();
    saveInfo = readSave();
    env.hour = 18.4;
    env.frozen = false;
    if (player.boat) { player.boat.prop._inUse = false; player.boat = null; }
    player.invuln = 0;
    player.kt = 0;
    faintFx.active = false;
    sleepFx.active = false;     // a quit out of a sleep fade must not veil the title
    hurtFx = 0;
    zoomTgt = 0.8;
    WParticles.clear();
    WAction.setAim(null);
    WDialogue.close();          // a pause opened from DIALOGUE must not leak it
    WHUD.resetWatchers();
    curMusic = '';
  }

  function newGame() {
    WStory.reset();
    WAction.reset();
    WWorld.build();
    WNpcs.init();            // POIs exist after build; NPCs start at home
    WParticles.clear();
    env.day = 1;
    env.hour = 7.5;
    env.weather = 'clear';
    player.x = 944;
    player.y = 1872;
    player.dir = 'down';
    player.boat = null;
    player.hp = player.maxHp;
    player.invuln = 0;
    player.kx = 0; player.ky = 0; player.kt = 0;
    zoomTgt = 1;
    epi.shown = false;
    sleepFx.active = false;
    faintFx.active = false;
    hurtFx = 0;
    snapCamera();
    syncEnv();
    WHUD.clearToasts();
    WHUD.resetWatchers();
    enterFx = 0.9;           // lift the veil into the intro scene
    WDialogue.start('intro_1');
    state = WDialogue.active() ? 'DIALOGUE' : 'PLAY';
  }

  function continueGame() {
    var d = readSave();
    if (!d) { WHUD.toast('File lưu cũ hoặc hỏng — không đọc được. Chơi mới nhé.'); return; }
    WStory.reset();
    WAction.reset();
    WWorld.build();
    WNpcs.init();
    WParticles.clear();

    env.day = (typeof d.day === 'number' && d.day >= 1) ? d.day : 1;
    env.hour = (typeof d.hour === 'number') ? WU.hnorm(d.hour) : 6.5;
    env.weather = (d.weather === 'rain') ? 'rain' : 'clear';
    /* the weather stamp rides new saves; older files derive it — past 06:00
       the day was already rolled, before 06:00 the stamp still belongs to
       the previous day (undefined lets the 06:00 roll run) */
    if (typeof d.weatherDay === 'number') env.weatherDay = d.weatherDay;
    else env.weatherDay = (WU.hnorm(env.hour) >= 6) ? env.day : undefined;
    if (d.player && typeof d.player.x === 'number') {
      if (typeof d.player.hp === 'number' && d.player.hp <= 0) {
        /* hp 0 can only exist in a save taken mid-faint (autoPause during
           the fade): skip straight to the wake-up updateFaint was heading
           for — doorstep, whole again (main.js updateFaint phase 1) */
        player.x = 944;
        player.y = 1872;
        player.dir = 'down';
        player.hp = player.maxHp;
        player.invuln = 2.5;
      } else {
        player.x = d.player.x;
        player.y = d.player.y;
        player.dir = d.player.dir || 'down';
        if (typeof d.player.hp === 'number') {
          player.hp = WU.clamp(Math.floor(d.player.hp), 1, player.maxHp);
        }
      }
    }
    /* boats: hulls keep where they were moored; being aboard round-trips too */
    if (d.boats) {
      for (k = 0; k < d.boats.length; k++) {
        var br = WWorld.boatById(d.boats[k].id);
        if (br) WWorld.moveBoat(br, d.boats[k].x, d.boats[k].y);
      }
    }
    player.boat = null;
    if (d.boat) {
      var aboard = WWorld.boatById(d.boat);
      if (aboard && boatFree(player.x, player.y)) {
        player.boat = aboard;
        aboard.prop._inUse = true;
      }
    }
    /* flags + vistas */
    var k;
    if (d.flags) for (k in d.flags) if (d.flags.hasOwnProperty(k)) WStory.setFlag(k, d.flags[k]);
    if (d.vistas) for (k in d.vistas) if (d.vistas.hasOwnProperty(k)) WStory.setFlag('vista_' + k, true);
    WStory.lampLit = !!d.lampLit;
    /* quests */
    var valid = { locked: 1, available: 1, active: 1, done_a: 1, done_b: 1 };
    if (d.quests) {
      for (k in d.quests) {
        if (d.quests.hasOwnProperty(k) && WStory.QUESTS[k] && valid[d.quests[k]]) {
          WStory.QUESTS[k].state = d.quests[k];
        }
      }
    }
    /* friendship first: story.update gates keeper_regret on hearts */
    if (d.friend) for (k in d.friend) if (d.friend.hasOwnProperty(k)) WNpcs.setFriend(k, d.friend[k]);
    WStory.recomputeEmbers();
    /* inventory + gifts */
    WAction.setInventory(d.inv);
    if (d.giftsToday) {
      for (k in d.giftsToday) if (d.giftsToday.hasOwnProperty(k)) WAction.giftDay[k] = d.giftsToday[k];
    }
    zoomTgt = 1;
    epi.shown = !!WStory.lampLit;   // a lit lamp does not replay the epilogue
    sleepFx.active = false;
    snapCamera();
    syncEnv();
    WHUD.resetWatchers();
    WHUD.clearToasts();
    WHUD.toast('Chào mừng trở lại Willowmere.');
    enterFx = 0.9;
    state = 'PLAY';
  }

  /* the smoothed follow starts from the player, never sweeps across the map */
  function snapCamera() {
    camFx = player.x;
    camFy = player.y;
    lookX = 0;
    lookY = 0;
    vista = null;
    vinside = false;
  }

  function readSave() {
    var d = WU.load(SAVE_KEY);
    if (!d || typeof d !== 'object' || d.v !== 1) return null;
    return d;
  }

  /* a corrupt/old-version save still deserves the "Chơi tiếp" entry —
     picking it then explains the file can't be read, instead of the
     option silently vanishing */
  function anySaveExists() {
    if (readSave()) return true;
    try { return !!window.localStorage.getItem(SAVE_KEY); }
    catch (e) { return false; }
  }

  function saveGame(silent) {
    var quests = {}, k;
    for (k in WStory.QUESTS) if (WStory.QUESTS.hasOwnProperty(k)) quests[k] = WStory.QUESTS[k].state;
    var friend = {};
    var list = WNpcs.list();
    for (var i = 0; i < list.length; i++) friend[list[i].id] = list[i].hearts;
    var vistas = {};
    var vs = WWorld.vistas;
    for (i = 0; i < vs.length; i++) {
      if (WStory.flag('vista_' + vs[i].id)) vistas[vs[i].id] = true;
    }
    var data = {
      v: 1,
      day: env.day,
      hour: env.hour,
      weather: env.weather,
      weatherDay: env.weatherDay,   // the 06:00 weather stamp (§2) rides the save
      player: { x: Math.round(player.x), y: Math.round(player.y), dir: player.dir, hp: player.hp },
      flags: WStory.flags,
      quests: quests,
      friend: friend,
      inv: WAction.inventory,
      giftsToday: WAction.giftDay,
      lampLit: WStory.lampLit,
      vistas: vistas,
      boat: player.boat ? player.boat.id : null,
      boats: WWorld.boats.map(function (r) { return { id: r.id, x: r.prop.x, y: r.prop.y }; })
    };
    var ok = WU.save(SAVE_KEY, data);
    if (!silent) WHUD.toast(ok ? 'Đã lưu.' : 'Không lưu được ở đây (file:// có thể chặn bộ nhớ).');
    hasSave = !!ok;
    if (ok) saveInfo = data;
    return ok;
  }

  /* ============================== SLEEP ============================== */

  function sleep() {
    if (state !== 'PLAY' && state !== 'DIALOGUE') return;
    if (sleepFx.active) return;
    WDialogue.close();
    sleepFx.active = true;
    sleepFx.phase = 0;
    sleepFx.t = 0;
    state = 'PLAY';
    env.frozen = true;
    if (WAction.cancelFish) WAction.cancelFish();   // no bobber waits out the night
    WAudio.sfx('sleep');
  }

  /* midnight roll-over shared by play and vista so the day counter (and its
     "Ngày N." toast) behaves the same in both states */
  function rollMidnight() {
    if (env.hour >= 24) {
      env.hour -= 24;
      env.day += 1;
      WHUD.toast('Ngày ' + env.day + '.');
    }
  }

  function updateSleep(dt) {
    sleepFx.t += dt;
    if (sleepFx.phase === 0 && sleepFx.t >= 1) {
      sleepFx.phase = 1;
      sleepFx.t = 0;
      /* only the evening side (18:00-24:00) owes a new day number: a night
         owl already paid it at the midnight roll-over, so a 00:00-05:59
         sleep wakes into 06:30 of the same day (no day-fragment) */
      if (env.hour >= 6) env.day += 1;
      env.hour = 6.5;
      env.weather = WWorld.weatherRoll(env.day);
      env.weatherDay = env.day;    // the 06:30 wake counts as the 06:00 roll
      player.hp = player.maxHp;      // sleep knits everything back together
      player.invuln = 0;
      WParticles.clear();
      if (WAction.clearEnemies) WAction.clearEnemies();   // morning is safe
      saveGame(true);
      WHUD.toast('Ngày ' + env.day + ' \u2014 06:30. ' + (env.weather === 'rain' ? 'Mưa gõ trên mái.' : 'Nắng sớm trong vắt.'));
    } else if (sleepFx.phase === 1 && sleepFx.t >= 1) {
      sleepFx.active = false;
      env.frozen = false;
      dayCard.t = 3.2;             // wake to a proper title card, not just a toast
      dayCard.day = env.day;
    }
  }

  /* ============================== ENV / MUSIC ============================== */

  function syncEnv() {
    var h = WU.hnorm(env.hour);
    env.night = h >= 20 || h < 5;
  }

  function musicKey() {
    if (state === 'TITLE') return 'music-day';
    if (state === 'EPILOGUE') return 'music-night';
    if (state === 'PLAY' || state === 'DIALOGUE' || state === 'VISTA' ||
        state === 'PAUSE' || state === 'SETTINGS') {
      if (env.weather === 'rain') return 'music-rain';
      var h = WU.hnorm(env.hour);
      return (h >= 19 || h < 5) ? 'music-night' : 'music-day';
    }
    return curMusic;
  }

  /* ============================== PLAYER ============================== */

  function boxFree(px, py) {
    return !WWorld.solidAt(px - 8, py - 8) && !WWorld.solidAt(px + 8, py - 8) &&
           !WWorld.solidAt(px - 8, py + 2) && !WWorld.solidAt(px + 8, py + 2);
  }

  /* afloat = the whole foot-box on water; pier planks read as land, so the
     hull bumps the decking instead of gliding over it */
  function boatFree(px, py) {
    return WWorld.waterAt(px - 8, py - 8) && WWorld.waterAt(px + 8, py - 8) &&
           WWorld.waterAt(px - 8, py + 2) && WWorld.waterAt(px + 8, py + 2);
  }

  function updatePlayer(dt) {
    if (player.invuln > 0) player.invuln -= dt;
    /* a hit staggers: knockback owns the feet for its 0.22 s */
    if (player.kt > 0) {
      player.kt -= dt;
      var kfree = player.boat ? boatFree : boxFree;
      var bx = player.x + player.kx * dt, by = player.y + player.ky * dt;
      if (kfree(bx, player.y)) player.x = bx;
      if (kfree(player.x, by)) player.y = by;
      player.moving = false;
      return;
    }
    var ax = WInput.axis();
    player.moving = !!(ax.x || ax.y);
    if (player.moving) {
      if (Math.abs(ax.x) >= Math.abs(ax.y)) player.dir = ax.x > 0 ? 'right' : 'left';
      else player.dir = ax.y > 0 ? 'down' : 'up';
      var free = player.boat ? boatFree : boxFree;
      var spd = player.boat ? 62 : player.speed;   // oars are slower than legs
      var nx = player.x + ax.x * spd * dt;
      if (free(nx, player.y)) player.x = nx;
      var ny = player.y + ax.y * spd * dt;
      if (free(player.x, ny)) player.y = ny;
      player.walkT += dt;
      if (player.boat) {
        /* oar-stroke wake: a soft white fleck slides off the stern */
        var wt = (player.walkT * 2.4) | 0;
        if (wt !== lastStep && window.WParticles) {
          lastStep = wt;
          WParticles.emit('dust',
            player.x + WU.rand(-10, 10), player.y + 2,
            { vx: WU.rand(-4, 4), vy: WU.rand(4, 12), life: WU.rand(0.4, 0.7),
              size: 1.5, color: 'rgba(235,245,250,0.7)' });
        }
        return;
      }
      /* footfall on every second walk-frame toggle (~2.7 steps/s): the synth
         'footstep' blip + a puff of dust underfoot — both systems already
         existed, so this is near-zero cost feedback for a walk-and-talk */
      var t = (player.walkT * 5.5) | 0;
      if (t !== lastStep) {
        lastStep = t;
        if (t % 2 === 0) {
          WAudio.sfx('footstep');
          if (window.WParticles) {
            WParticles.emit('dust',
              player.x + WU.rand(-4, 4), player.y + WU.rand(-2, 2),
              { vx: WU.rand(-6, 6), vy: WU.rand(-16, -4), life: WU.rand(0.35, 0.6),
                size: 1.5, color: 'rgba(150,132,96,0.8)' });
          }
        }
      }
    }
  }

  /* ============================== COMBAT ============================== */

  function hurtPlayer(dmg, sx, sy) {
    if (player.invuln > 0 || faintFx.active || sleepFx.active) return;
    if (state !== 'PLAY' && state !== 'DIALOGUE' && state !== 'VISTA') return;
    player.hp = Math.max(0, player.hp - (dmg || 1));
    player.invuln = 1.2;
    var dx = player.x - sx, dy = player.y - sy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    player.kx = dx / d * 190; player.ky = dy / d * 190; player.kt = 0.22;
    hurtFx = 0.4;
    if (opts.shake) shakeT = 0.16;       // the camera feels it too — unless the player asked it not to
    if (window.WAction && WAction.cancelFish) WAction.cancelFish('Dây đứt mất rồi!');
    WAudio.sfx('hurt');
    if (window.WParticles) {
      WParticles.emit('floattext', player.x, player.y - 44,
        { text: '−1', color: 'rgba(255,122,108,1)', life: 0.8 });
    }
    if (player.hp <= 0) startFaint();
  }

  /* a gentle defeat: fade, then wake at your own doorstep, whole again */
  function startFaint() {
    if (faintFx.active) return;
    faintFx.active = true;
    faintFx.phase = 0;
    faintFx.t = 0;
    env.frozen = true;
    WAction.setAim(null);
    WAudio.sfx('sleep');
  }

  function updateFaint(dt) {
    faintFx.t += dt;
    if (faintFx.phase === 0 && faintFx.t >= 1.1) {
      faintFx.phase = 1;
      faintFx.t = 0;
      if (player.boat) { player.boat.prop._inUse = false; player.boat = null; }
      player.x = 944; player.y = 1872; player.dir = 'down';
      player.hp = player.maxHp;
      player.invuln = 2.5;
      player.kx = 0; player.ky = 0; player.kt = 0;
      snapCamera();
      WParticles.clear();
      WHUD.toast('Bạn tỉnh dậy trước cửa nhà \u2014 đầu còn ong ong. Những bóng đã tan.');
    } else if (faintFx.phase === 1 && faintFx.t >= 1) {
      faintFx.active = false;
      WAction.clearEnemies && WAction.clearEnemies();   // the doorstep is safe
      env.frozen = false;
      saveGame(true);
    }
  }

  /* ============================== INTERACT ============================== */

  function distToRect(px, py, r) {
    var dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    var dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* where the boat can put you ashore: a walkable (incl. pier) spot reached
     by pressing toward land — facing direction preferred */
  var SHORE_DIRS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  function shoreSpot() {
    var dirs = SHORE_DIRS.slice();
    var f = { up: 0, down: 1, left: 2, right: 3 }[player.dir];
    dirs.unshift(dirs.splice(f, 1)[0]);      // try the way you face first
    for (var i = 0; i < dirs.length; i++) {
      for (var r = 26; r <= 64; r += 6) {
        var tx = player.x + dirs[i].x * r, ty = player.y + dirs[i].y * r;
        if (!WWorld.waterAt(tx, ty) && boxFree(tx, ty)) return { x: tx, y: ty };
      }
    }
    return null;
  }

  function boardBoat(id) {
    if (player.boat) return;
    var rec = WWorld.boatById(id);
    if (!rec) return;
    var p = WWorld.boatBoardPoint(rec);
    if (!p) { WHUD.toast('Xuồng không nổi được ở đây.'); return; }
    player.x = p.x; player.y = p.y;
    player.boat = rec;
    rec.prop._inUse = true;
    WAudio.sfx('splash');
    WHUD.toast(rec.id === 'boat_sea'
      ? 'Bạn đẩy xuồng ra biển. E cập bờ khi thấy đất liền.'
      : 'Bạn đẩy xuồng ra hồ. E cập bờ khi thấy đất liền.');
  }

  function disembark(spot) {
    var rec = player.boat;
    if (!rec) return;
    WWorld.moveBoat(rec, player.x, player.y);   // the hull stays where you left it
    rec.prop._inUse = false;
    player.x = spot.x; player.y = spot.y;
    player.boat = null;
    WAudio.sfx('splash');
  }

  function bestInteract() {
    var px = player.x, py = player.y;
    var best = null;
    if (player.boat) {
      var shore = shoreSpot();
      if (shore) return { kind: 'shore', obj: shore, x: shore.x, y: shore.y - 40, label: 'Cập bờ', d: 0 };
      return null;
    }
    var n = WNpcs.nearestTo(px, py, 60);
    if (n) {
      best = { kind: 'npc', obj: n, x: n.x, y: n.y - 40,
        label: 'Nói chuyện với ' + n.def.name.split(' ')[0], d: WU.dist(px, py, n.x, n.y) };
    }
    var it = WWorld.nearestInteractable(px, py);
    if (it) {
      var d = distToRect(px, py, it);
      if (!best || d < best.d) {
        best = { kind: 'inter', obj: it, x: it.x + it.w / 2, y: it.y + it.h / 2, label: it.label, d: d };
      }
    }
    var c = WAction.nearestCatchable(px, py, 44);
    if (c) {
      d = WU.dist(px, py, c.x, c.y);
      if (!best || d < best.d) {
        best = { kind: 'catch', obj: c, x: c.x, y: c.y, label: c.label, d: d };
      }
    }
    return best;
  }

  function doInteract() {
    var b = bestInteract();
    if (!b) {
      if (player.boat) WHUD.toast('Chưa thấy bờ — chèo sát vào hơn.');
      return;
    }
    if (b.kind === 'npc') {
      WAudio.sfx('interact');
      if (WDialogue.startForNpc(b.obj)) state = 'DIALOGUE';
    } else if (b.kind === 'inter') {
      WWorld.useNearest(player.x, player.y, WGame);
      if (WDialogue.active()) state = 'DIALOGUE';
    } else if (b.kind === 'catch') {
      WAction.collect(b.obj);
    } else if (b.kind === 'shore') {
      disembark(b.obj);
    }
  }

  /* ============================== VISTA ============================== */

  function updateVistaTrigger() {
    if (state !== 'PLAY' || sleepFx.active || player.boat) return;
    var v = WWorld.vistaAt(player.x, player.y);
    if (!v) { vinside = false; return; }   // §2: fire on ENTERING the radius
    if (vinside) return;                   // staying inside never re-fires it
    vinside = true;
    if (WWorld.vistaSeen(v)) {
      /* a known view gets a short caption instead of the full takeover —
         the panorama is for the first meeting, not the tenth crossing */
      WWorld.markVistaSeen(v.id);
      WHUD.toast(v.caption, 1500);
      WAudio.sfx('chime');
      return;
    }
    /* onReach first: it toasts the colors tally on a fresh vista, and
       markVistaSeen sets the very same flag — the old order killed the toast */
    if (WStory && typeof WStory.onReach === 'function') WStory.onReach(v.id);
    WWorld.markVistaSeen(v.id);
    vista = { v: v, t: 0, first: true };
    state = 'VISTA';
    zoomTgt = 0.45;
    WAction.setAim(null);      // no sling dots over the panorama
    WAudio.sfx('vista');
  }

  function updateVista(dt) {
    vista.t += dt;
    if (vista.t > 0.7) {
      var ax = WInput.axis();
      /* Esc/P skips the panorama like E/J — endFrame() clears the edge, so
         the same press cannot reopen PAUSE a frame later */
      var leave = !!(ax.x || ax.y) || WInput.down('net') || WInput.down('fish') ||
                  WInput.pressed('interact') || WInput.pressed('attack') ||
                  WInput.pressed('pause');
      if (leave || vista.t > 3.5) {   // ~3 s of panorama, then back to play
        var v = vista;
        vista = null;
        state = 'PLAY';
        zoomTgt = 1;
        if (v.first && WDialogue.start('vista_' + v.v.id)) {
          state = 'DIALOGUE';
        } else if (v.first) {
          WHUD.toast(v.v.caption);
        }
      }
    }
  }

  /* ============================== UPDATE ============================== */

  function update(dt) {
    WAudio.update(dt);
    /* ambient director: rain hush > sea swell > night crickets. Title gets
       the dusk chorus too — the camera sits on the village at 18:24. */
    var ambKind = null;
    if (state !== 'ARCADE' && WAudio.setAmbient) {
      if (env.weather === 'rain') ambKind = 'rain';
      else {
        var pb = WWorld.biomeAt((player.x / 32) | 0, (player.y / 32) | 0);
        var hh = WU.hnorm(env.hour);
        if (pb === 'sea' || pb === 'beach') ambKind = 'waves';
        else if (hh >= 19 || hh < 5) ambKind = 'night';
      }
      WAudio.setAmbient(ambKind);
    }
    /* after the first user gesture the AudioContext exists: re-issue the
       music key once (early play() attempts are rejected pre-gesture) */
    if (!audioReadySeen && WAudio.ready()) {
      audioReadySeen = true;
      curMusic = '';
    }
    WDialogue.env = env;   // live state for requires checks
    WWorld.env = env;
    syncEnv();
    pulseT += dt;
    /* the morning card fades in every state — a pause or quit-to-title
       must not freeze it on screen */
    if (dayCard.t > 0) dayCard.t -= dt;

    switch (state) {
      case 'TITLE': updateTitle(dt); break;
      case 'PLAY': updatePlay(dt); break;
      case 'DIALOGUE': updateDialogue(dt); break;
      case 'VISTA': updateVistaState(dt); break;
      case 'PAUSE': updatePause(dt); break;
      case 'SETTINGS': updateSettings(dt); break;
      case 'EPILOGUE': updateEpilogue(dt); break;
      case 'ARCADE': break;   // world frozen; the iframe owns input + time
    }

    var key = musicKey();
    if (key && key !== curMusic) {
      curMusic = key;
      WAudio.playMusic(key);
    }
  }

  function updateTitle(dt) {
    env.frozen = false;        // the village lives behind the menu
    WNpcs.update(dt, env);
    WParticles.update(dt, WWorld);
    if (WInput.pressed('up')) { titleSel = (titleSel + 2) % 3; titleConfirmNew = false; WAudio.sfx('click'); }
    if (WInput.pressed('down')) { titleSel = (titleSel + 1) % 3; titleConfirmNew = false; WAudio.sfx('click'); }
    if (WInput.pressed('pause') && titleConfirmNew) titleConfirmNew = false;
    if (WInput.pressed('interact')) activateTitle();
    var bs = WHUD.buttons();
    for (var i = 0; i < bs.length; i++) {
      if (hit(WInput.mouse, bs[i])) {
        if (titleSel !== i) { titleSel = i; titleConfirmNew = false; WAudio.sfx('click'); }
        if (WInput.mouse.clicked) activateTitle();
      }
    }
  }

  function activateTitle() {
    if (titleSel === 0) {
      /* a save on file gets one extra beat before a fresh start
         buries it — autosaves would quietly overwrite it anyway */
      if (hasSave && !titleConfirmNew) {
        titleConfirmNew = true;
        WAudio.sfx('click');
        return;
      }
      titleConfirmNew = false;
      WAudio.sfx('interact');
      newGame();
    }
    else if (titleSel === 1) {
      if (hasSave) { WAudio.sfx('interact'); continueGame(); }
      else WAudio.sfx('click');
    } else {
      WAudio.sfx('click');
      settingsReturn = 'TITLE';
      settingsSel = 0;
      state = 'SETTINGS';
    }
  }

  /* §2: a rain roll lasts to 17:00 only — nights stay clear (the roll itself
     is deterministic per day, so this needs no extra state). */
  function clearExpiredRain() {
    if (env.weather === 'rain' && WU.hnorm(env.hour) >= 17) env.weather = 'clear';
  }

  function updatePlay(dt) {
    var bagged = WHUD.bagOpen && WHUD.bagOpen();
    var journaled = WHUD.journalOpen && WHUD.journalOpen();
    var overlaid = bagged || journaled;
    if (faintFx.active) {
      env.frozen = true;
      updateFaint(dt);
    } else if (sleepFx.active) {
      env.frozen = true;
      updateSleep(dt);
    } else if (overlaid) {
      /* the pouch and journal soft-pause the world: no free enemy hits or
         expired fish bites while the player is behind a panel */
      env.frozen = true;
    } else {
      env.frozen = false;
      updatePlayer(dt);
      env.hour += dt / 20;                     // 1 hour = 20 s
      rollMidnight();
      /* hearts mend slowly on their own; a full sleep restores them all */
      if (player.hp < player.maxHp) {
        regenT -= dt;
        if (regenT <= 0) { regenT = 45; player.hp += 1; }
      }
    }
    if (hurtFx > 0) hurtFx -= dt;
    if (shakeT > 0) shakeT -= dt;
    clearExpiredRain();
    /* §2: each day's weather rolls once at 06:00 — a midnight roll would
       rain 00:00-06:00, and nights stay clear. weatherDay stamps the day
       already rolled (the roll is deterministic per day, no save needed). */
    if (WU.hnorm(env.hour) >= 6 && env.weatherDay !== env.day) {
      env.weatherDay = env.day;
      env.weather = WWorld.weatherRoll(env.day);
    }
    syncEnv();

    WStory.update(env);
    WAction.update(dt, player, env);
    WNpcs.update(dt, env);
    WParticles.update(dt, WWorld);
    updateVistaTrigger();
    if (state !== 'PLAY') return;   // a vista took over this frame

    /* the open pouch owns combat keys: E eats, and swing/net/fish/sling
       must not reach the world behind the bag */
    /* sling aim + fire */
    var m = WInput.mouse;
    if (m.inside) {
      WAction.setAim({ x: cam.x + m.x / zoom, y: cam.y + m.y / zoom });
      if (m.clicked && !sleepFx.active && !faintFx.active && !overlaid) {
        WAction.trySling(cam.x + m.x / zoom, cam.y + m.y / zoom, player);
      }
    } else {
      WAction.setAim(null);
    }

    if (!sleepFx.active && !faintFx.active) {
      if (WInput.pressed('interact')) {
        /* bag open: E eats the hovered food instead of touching the world */
        if (bagged) {
          var hk = WHUD.bagHover && WHUD.bagHover();
          if (hk) WAction.eat(hk);
        } else if (!journaled) {
          doInteract();
        }
      }
      if (!overlaid && WInput.pressed('attack')) WAction.trySwing(player);
      if (!overlaid && WInput.pressed('net')) {
        if (player.boat) WHUD.toast('Lưới không với được từ xuồng.');
        else WAction.tryNet(player);
      }
      if (!overlaid && WInput.pressed('fish')) WAction.tryFish(player, WWorld);
      if (WInput.pressed('pause')) { prePause = 'PLAY'; pauseSel = 0; state = 'PAUSE'; }
    }

    /* epilogue trigger: the lamp was just lit */
    if (WStory.lampLit && !epi.shown && state === 'PLAY' && !sleepFx.active) {
      epi.shown = true;
      epi.scroll = 0;
      epi.lines = WStory.epilogueLines();
      state = 'EPILOGUE';
      WAudio.sfx('bell');
    }

    /* interaction prompt (the HUD chip already draws the "E") */
    var b = (state === 'PLAY' && !sleepFx.active) ? bestInteract() : null;
    if (b) WHUD.prompt(b.label, b.x, b.y, { x: cam.x, y: cam.y, zoom: zoom });
  }

  function updateDialogue(dt) {
    env.frozen = true;
    WDialogue.env = env;
    WAction.setAim(null);      // sling dots hide while talking
    WDialogue.update(dt);
    if (WInput.pressed('up')) WDialogue.navUp();
    if (WInput.pressed('down')) WDialogue.navDown();
    if (WInput.pressed('interact')) WDialogue.confirm();
    if (WInput.pressed('pause')) WDialogue.cancel();
    WStory.update(env);
    WAction.update(dt, player, env);
    WNpcs.update(dt, env);
    WParticles.update(dt, WWorld);
    if (!WDialogue.active()) state = 'PLAY';
  }

  function updateVistaState(dt) {
    env.frozen = true;
    env.hour += dt / 20;
    rollMidnight();
    clearExpiredRain();
    syncEnv();
    WStory.update(env);
    WAction.update(dt, player, env);
    WNpcs.update(dt, env);
    WParticles.update(dt, WWorld);
    updateVista(dt);
  }

  function updatePause(dt) {
    /* drawBack keeps emitting ambient particles behind the veil: keep the
       pool ticking so nothing accumulates as a frozen clump */
    WParticles.update(dt, WWorld);
    if (WInput.pressed('up')) { pauseSel = (pauseSel + 3) % 4; WAudio.sfx('click'); }
    if (WInput.pressed('down')) { pauseSel = (pauseSel + 1) % 4; WAudio.sfx('click'); }
    if (WInput.pressed('pause')) { state = prePause; return; }
    if (WInput.pressed('interact')) activatePause();
    var bs = WHUD.buttons();
    for (var i = 0; i < bs.length; i++) {
      if (hit(WInput.mouse, bs[i])) {
        if (pauseSel !== i) { pauseSel = i; WAudio.sfx('click'); }  // hover = same cue as keys
        if (WInput.mouse.clicked) activatePause();
      }
    }
  }

  function activatePause() {
    if (pauseSel === 0) { WAudio.sfx('click'); state = prePause; }
    else if (pauseSel === 1) { WAudio.sfx('click'); saveGame(); }
    else if (pauseSel === 2) {
      WAudio.sfx('click');
      settingsReturn = 'PAUSE';
      settingsSel = 0;
      state = 'SETTINGS';
    } else {
      WAudio.sfx('click');
      toTitle();
    }
  }

  function updateSettings(dt) {
    WParticles.update(dt, WWorld);
    var rows = 5;                     // music · sfx · mute · shake · back
    if (WInput.pressed('up')) { settingsSel = (settingsSel + rows - 1) % rows; WAudio.sfx('click'); }
    if (WInput.pressed('down')) { settingsSel = (settingsSel + 1) % rows; WAudio.sfx('click'); }
    var step = 0;
    if (WInput.pressed('left')) step = -1;
    if (WInput.pressed('right')) step = 1;
    if (settingsSel === 2) {          // mute row: any direction or E toggles
      if (step !== 0 || WInput.pressed('interact')) {
        WAudio.setMuted(!WAudio.isMuted());
        WAudio.sfx(WAudio.isMuted() ? 'pop' : 'chime');
      }
    } else if (settingsSel === 3) {   // screen shake: accessibility toggle
      if (step !== 0 || WInput.pressed('interact')) {
        opts.shake = !opts.shake;
        WU.save(OPTS_KEY, opts);
        WAudio.sfx(opts.shake ? 'chime' : 'pop');
      }
    } else if (step !== 0 && settingsSel < 2) {
      if (settingsSel === 0) {
        WAudio.setMusicVolume(WAudio.getMusicVolume() + step * 0.1);
      } else {
        WAudio.setSfxVolume(WAudio.getSfxVolume() + step * 0.1);
      }
      WAudio.sfx('click'); // live preview blip
    }
    if (WInput.pressed('pause')) { state = settingsReturn; return; }
    if (WInput.pressed('interact') && settingsSel === 4) { WAudio.sfx('click'); state = settingsReturn; }
    var bs = WHUD.buttons();
    for (var i = 0; i < bs.length; i++) {
      if (hit(WInput.mouse, bs[i])) {
        var want = bs[i].id === 'music' ? 0 : bs[i].id === 'sfx' ? 1 :
                   bs[i].id === 'mute' ? 2 : bs[i].id === 'shake' ? 3 : 4;
        if (settingsSel !== want) { settingsSel = want; WAudio.sfx('click'); }
        if (WInput.mouse.clicked) {
          if (bs[i].id === 'back') { WAudio.sfx('click'); state = settingsReturn; }
          else if (bs[i].id === 'mute') {
            WAudio.setMuted(!WAudio.isMuted());
            WAudio.sfx(WAudio.isMuted() ? 'pop' : 'chime');
          } else if (bs[i].id === 'shake') {
            opts.shake = !opts.shake;
            WU.save(OPTS_KEY, opts);
            WAudio.sfx(opts.shake ? 'chime' : 'pop');
          }
        }
      }
    }
  }

  function updateEpilogue(dt) {
    env.frozen = true;
    epi.scroll = Math.min(1, epi.scroll + dt / 45);
    WParticles.update(dt, WWorld);
    if (WInput.pressed('interact')) {
      if (epi.scroll < 1) epi.scroll = 1;
      else {
        state = 'PLAY';
        WHUD.toast('Chơi tự do \u2014 ngọn đèn đã sáng. Ngôi làng là của bạn.');
      }
    }
  }

  function hit(m, r) {
    return m.inside && m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
  }

  /* ============================== DRAW ============================== */

  function updateCamera(dt) {
    zoom += (zoomTgt - zoom) * Math.min(1, dt * 3.2);
    if (Math.abs(zoomTgt - zoom) < 0.002) zoom = zoomTgt;
    var vs = viewWH();
    var vw = vs.w / zoom, vh = vs.h / zoom;
    /* world-space view half size feeds the enemy spawn ring (action.js) */
    if (WAction.setViewHalf) WAction.setViewHalf(vw / 2, vh / 2);
    var cx, cy;
    if (state === 'TITLE') {
      cx = 1088 + Math.sin(performance.now() * 0.00008) * 40;
      cy = 1632 + Math.cos(performance.now() * 0.00006) * 26;
    } else if (state === 'VISTA' && vista) {
      cx = vista.v.x + Math.sin(performance.now() * 0.0003) * 14;
      cy = vista.v.y + Math.cos(performance.now() * 0.00023) * 10;
    } else {
      /* smoothed follow + a small look-ahead in the walking direction, so a
         step no longer jerks the whole frame; the ease matches the zoom's */
      camFx += (player.x - camFx) * Math.min(1, dt * 7);
      camFy += (player.y - camFy) * Math.min(1, dt * 7);
      var ltx = player.moving ? (player.dir === 'left' ? -18 : player.dir === 'right' ? 18 : 0) : 0;
      var lty = player.moving ? (player.dir === 'up' ? -12 : player.dir === 'down' ? 12 : 0) : 0;
      lookX += (ltx - lookX) * Math.min(1, dt * 4);
      lookY += (lty - lookY) * Math.min(1, dt * 4);
      cx = camFx + lookX;
      cy = camFy + lookY;
    }
    var b = WWorld.bounds();
    cam.x = WU.clamp(cx - vw / 2, b.x, b.x + b.w - vw);
    cam.y = WU.clamp(cy - vh / 2, b.y, b.y + b.h - vh);
    if (shakeT > 0) {          // decaying jitter — a hit you can feel
      var sa = shakeT / 0.16;
      cam.x += (Math.random() - 0.5) * 5 * sa;
      cam.y += (Math.random() - 0.5) * 5 * sa;
    }
  }

  function viewWH() {
    return { w: canvas.width / dpr, h: canvas.height / dpr };
  }

  function drawWorldPass() {
    var vs = viewWH();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    ctx.imageSmoothingEnabled = false;
    WWorld.drawBack(ctx, cam, env);
    WAction.drawUnder(ctx, cam, player);

    /* y-sorted bodies: NPCs + foes + player (player hidden behind the
       title menu); foes join the same sort so depth stays honest */
    var list = WNpcs.list();
    var foes = (WAction.enemies ? WAction.enemies() : []);
    var i, n;
    var ents = [];
    for (i = 0; i < list.length; i++) {
      n = list[i];
      if (!n.hidden) ents.push({ y: n.y, npc: n });
    }
    for (i = 0; i < foes.length; i++) ents.push({ y: foes[i].y, foe: foes[i] });
    ents.sort(function (a, b) { return a.y - b.y; });
    var pY = player.y;
    var playerDrawn = false;
    var showPlayer = state !== 'TITLE';
    for (i = 0; i < ents.length; i++) {
      var e2 = ents[i];
      if (showPlayer && !playerDrawn && e2.y > pY) {
        drawPlayerBody();
        playerDrawn = true;
      }
      if (e2.npc) WNpcs.drawBody(ctx, e2.npc, cam);
      else WAction.drawEnemy(ctx, e2.foe, cam);
    }
    if (showPlayer && !playerDrawn) drawPlayerBody();
    WNpcs.draw(ctx, cam, env);

    WAction.drawOver(ctx, cam, player);
    WWorld.drawOver(ctx, cam, env);
    if (WStory.flag('festival')) drawBunting(ctx, cam);
    WParticles.draw(ctx, cam);
    WWorld.drawLights(ctx, cam, env);
    WWorld.applyTint(ctx, env);
  }

  function drawPlayerBody() {
    /* hull and cloak draw at raw world coords (drawChar applies its own
       camera translate), so each gets the module-standard save/translate */
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    if (player.boat) WWorld.drawBoatHull(ctx, player.x, player.y);
    ctx.restore();
    var frame = player.moving ? 1 + (((player.walkT * 5.5) | 0) % 2) : 0;
    /* invulnerability blink: after a hit the body flickers instead of
       pretending nothing happened */
    var blink = player.invuln > 0 && (((player.invuln * 14) | 0) % 2 === 0);
    if (blink) ctx.globalAlpha = 0.45;
    WNpcs.drawChar(ctx, player.x, player.y, player.dir, frame, 0, cam);
    ctx.globalAlpha = 1;
    /* wool cloak: white scarf in the rain (cosmetic, §3.2 lost_lamb B) */
    if (WAction.count('wool_cloak') > 0 && env.weather === 'rain') {
      ctx.save();
      ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
      ctx.fillStyle = 'rgba(245,242,235,0.95)';
      ctx.fillRect(player.x - 6, player.y - 34, 12, 4);
      ctx.fillRect(player.x - 8, player.y - 31, 4, 9);
      ctx.restore();
    }
  }

  function drawBunting(ctx, cam) {
    /* festival bunting strung between the four lamp posts on the green;
       drawn in world space, so it needs the module-standard translate */
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    var posts = [[30, 47], [38, 47], [30, 53], [38, 53]];
    var colors = ['#e2574c', '#f2b6c6', '#7ec8e0', '#f7e08c', '#8fb05a'];
    var now = performance.now() * 0.001;
    for (var s = 0; s < 2; s++) {
      var a = posts[s * 2], b = posts[s * 2 + 1];
      var x0 = a[0] * 32 + 16, y0 = a[1] * 32 + 30;
      var x1 = b[0] * 32 + 16, y1 = b[1] * 32 + 30;
      ctx.strokeStyle = 'rgba(90,70,50,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2, y0 + 14, x1, y1);
      ctx.stroke();
      var n = 8;
      for (var i = 1; i < n; i++) {
        var t = i / n;
        var sag = Math.sin(t * Math.PI) * 14;
        var x = x0 + (x1 - x0) * t;
        var y = y0 + sag + Math.sin(now * 1.4 + i) * 1.5;
        ctx.fillStyle = colors[(i + s) % colors.length];
        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 12);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw() {
    var vs = viewWH();
    var vw = vs.w, vh = vs.h;

    if (state === 'EPILOGUE') {
      drawWorldPass();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      WHUD.drawEpilogueOn(ctx, epi.lines, epi.scroll);
      WInput.endFrame();
      return;
    }

    drawWorldPass();

    /* screen-space UI */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if (state === 'TITLE') {
      WHUD.drawTitleOn(ctx, titleSel, hasSave, saveInfo, titleConfirmNew);
      if (WHUD.drawToasts) WHUD.drawToasts(ctx, frameState.dt || 1 / 60, vw, vh);
    } else if (state === 'VISTA' && vista) {
      WHUD.drawVistaOn(ctx, vista.v, Math.min(1, vista.t / 1.2));
    } else if (state === 'PAUSE') {
      WHUD.draw(ctx, env, frameState);
      WHUD.drawPauseOn(ctx, pauseSel);
    } else if (state === 'SETTINGS') {
      if (settingsReturn === 'TITLE') {
        WHUD.drawTitleOn(ctx, -1, hasSave, saveInfo);
      } else {
        WHUD.draw(ctx, env, frameState);
      }
      WHUD.drawSettingsOn(ctx, settingsSel, WAudio.getMusicVolume(), WAudio.getSfxVolume(),
        WAudio.isMuted ? WAudio.isMuted() : false, opts.shake);
    } else {
      /* PLAY / DIALOGUE / ARCADE (the iframe covers the screen anyway) */
      WHUD.draw(ctx, env, frameState);
    }

    if (WDialogue.active() && (state === 'DIALOGUE' || state === 'PLAY')) {
      WDialogue.draw(ctx);
    }

    /* hurt vignette — the rim of the world goes red for a blink */
    if (hurtFx > 0) {
      var ha = Math.min(0.38, hurtFx);
      var hg = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.3, vw / 2, vh / 2, vh * 0.8);
      hg.addColorStop(0, 'rgba(150,26,30,0)');
      hg.addColorStop(1, 'rgba(150,26,30,' + ha.toFixed(3) + ')');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, vw, vh);
    }

    /* one heart left — the rim breathes a quiet, persistent warning */
    if (player.hp === 1 && hurtFx <= 0 && !faintFx.active && !sleepFx.active &&
        (state === 'PLAY' || state === 'DIALOGUE' || state === 'VISTA' || state === 'PAUSE')) {
      var la = 0.10 + Math.sin(pulseT * 4.2) * 0.055;
      var lg = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.3, vw / 2, vh / 2, vh * 0.8);
      lg.addColorStop(0, 'rgba(150,26,30,0)');
      lg.addColorStop(1, 'rgba(150,26,30,' + la.toFixed(3) + ')');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, vw, vh);
    }

    /* morning title card — "Ngày N" breathes once over the fresh day */
    if (dayCard.t > 0) {
      var dc = 3.2 - dayCard.t;                       // age
      var da = Math.min(1, dc / 0.6, dayCard.t / 0.9);
      ctx.globalAlpha = Math.max(0, da);
      ctx.textAlign = 'center';
      ctx.font = 'italic 44px "Times New Roman",serif';
      ctx.shadowColor = 'rgba(10,12,18,0.9)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#f6ecd2';
      try { ctx.letterSpacing = '6px'; } catch (e) { /* older canvas: no spacing */ }
      ctx.fillText('Ngày ' + dayCard.day, vw / 2, vh * 0.42);
      try { ctx.letterSpacing = '0px'; } catch (e) { /* restore */ }
      ctx.shadowBlur = 0;
      ctx.font = 'italic 16px "Times New Roman",serif';
      ctx.fillStyle = 'rgba(246,236,210,0.75)';
      ctx.fillText(env.weather === 'rain' ? 'mưa rơi trên mái làng' : 'một ngày mới ở Willowmere',
        vw / 2, vh * 0.42 + 30);
      var lw = 60 + Math.min(1, dc / 1.2) * 80;       // rule grows as it settles
      ctx.strokeStyle = 'rgba(255,222,150,' + (da * 0.8).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(vw / 2 - lw, vh * 0.42 - 34);
      ctx.lineTo(vw / 2 + lw, vh * 0.42 - 34);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* sleep fade */
    if (sleepFx.active) {
      var a = sleepFx.phase === 0 ? Math.min(1, sleepFx.t) : 1 - Math.min(1, sleepFx.t);
      ctx.fillStyle = 'rgba(6,8,12,' + a.toFixed(3) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }

    /* faint fade — warmer, duskier dark than the sleep one */
    if (faintFx.active) {
      var fa = faintFx.phase === 0 ? Math.min(1, faintFx.t / 1.1) : 1 - Math.min(1, faintFx.t);
      ctx.fillStyle = 'rgba(28,10,18,' + fa.toFixed(3) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }

    /* title → world: a quick veil lifting, warmer than a hard cut */
    if (enterFx > 0) {
      ctx.fillStyle = 'rgba(8,9,14,' + Math.min(1, enterFx / 0.9).toFixed(3) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }

    WInput.endFrame();
  }

  var frameState = { dt: 0, zoom: 1 };

  function frame(t) {
    var dt = (t - last) / 1000;
    last = t;
    if (!isFinite(dt)) dt = 0;   /* a dead timestamp must not NaN the loop dead */
    dt = WU.clamp(dt, 0, 0.05);
    if (enterFx > 0) enterFx -= dt;
    frameState.dt = dt;
    frameState.zoom = zoom;

    update(dt);
    updateCamera(dt);
    draw();

    raf = requestAnimationFrame(frame);
  }

  /* ============================== API ============================== */

  window.WGame = {
    env: env,
    boot: boot,
    sleep: sleep,
    /* DPR the backing store was built with (UI layers must read this —
       devicePixelRatio alone is wrong where main clamps it to 2) */
    dpr: function () { return dpr; },
    onDialogueOpened: function () {
      if (state === 'PLAY') state = 'DIALOGUE';
    },
    openArcade: openArcade,
    closeArcade: closeArcade,
    boardBoat: boardBoat,
    hurtPlayer: hurtPlayer,
    state: function () { return state; },
    player: player
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return window.WGame;
})();
