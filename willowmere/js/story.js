/* Willowmere — story.js · window.WStory
   "The Dark Lamp of Willowmere" (DESIGN.md §3.2/§4):
   - flags (persisted by main) + 9 quests: the main arc + 8 NPC questlines,
     state machine locked -> available -> active -> done_a | done_b.
   - Every completed questline awards 1 Ember Light. Gates to climb:
     embers >= 4 AND flag marlow_confession AND hour 20-24.
   - Branch B1 "who keeps the lamp" (together / sole / Finn) and branch B2
     "the lost boat" (tell the Selkies' truth / keep the myth) -> two endings
     assembled from the flag pool in epilogueLines().
   - Progression API for other layers: onTalk / onGive / onReach / onCollect
     (collect is wired by wrapping WAction.add once it exists).
   - Quest/branch dialogue nodes are registered into WDialogue at boot; two
     story-owned interactables (moonbell, the lost lamb) re-add after every
     WWorld.build via a wrapper. */
window.WStory = (function () {
  'use strict';

  var flags = {};          // single flag registry; never rebound (reset clears in place)
  var lampLit = false;
  var actionHooked = false;

  /* ---- quest defs (§7 shape) ---- */
  var QUESTS = {
    the_dark_lamp: {
      id: 'the_dark_lamp', npc: 'hana', title: 'The Dark Lamp of Willowmere',
      hint: 'Goodwill lights the lamp: 4 Ember Lights, Marlow\u2019s confession, then climb after 20:00.',
      embers: 0, state: 'locked', outcomes: null
    },
    honey_loaf: {
      id: 'honey_loaf', npc: 'mira', title: 'The Honey Loaf',
      hint: 'Wild honeycomb ripens in the north hives.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'honey_to_mira', label: 'Village loaf' }, b: { flag: 'honey_to_gideon', label: 'Greenhouse bloom' } }
    },
    seeds_of_spring: {
      id: 'seeds_of_spring', npc: 'gideon', title: 'Seeds of Spring',
      hint: 'A seed pouch was lost on the hill trail, east side.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'seeds_returned', label: 'Return it' }, b: { flag: 'seeds_gifted', label: 'Slip it to Rosa' } }
    },
    garden_show: {
      id: 'garden_show', npc: 'rosa', title: 'The Garden Show',
      hint: 'A moonbell blooms in the night forest (21:00+) and glows.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'show_won', label: 'Pick it for her' }, b: { flag: 'show_patience', label: 'Grow your own' } }
    },
    big_one: {
      id: 'big_one', npc: 'finn', title: 'The Big One',
      hint: 'The legendary lake fish Siltjaw. One good catch during the quest counts.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'finn_big_one', label: 'Land Siltjaw' }, b: { flag: 'siltjaw_freed', label: 'Let it go' } }
    },
    parcel: {
      id: 'parcel', npc: 'hana', title: 'The Unaddressed Parcel',
      hint: 'A parcel with no name has sat on the shop counter for two years.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'parcel_kite', label: 'Open it' }, b: { flag: 'parcel_lens', label: 'Trace the sender' } }
    },
    lost_lamb: {
      id: 'lost_lamb', npc: 'bramble', title: 'The Lost Lamb',
      hint: 'A lamb strayed into the forest after dark (20:00+).',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'lamb_quiet', label: 'Quiet net-snatch' }, b: { flag: 'lamb_led', label: 'Lantern-led walk' } }
    },
    colors: {
      id: 'colors', npc: 'junie', title: 'Willowmere in Colour',
      hint: 'Junie wants the land to show off: visit the vistas.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'junie_stays', label: 'Firefly jar' }, b: { flag: 'junie_leaves', label: 'Dark study' } }
    },
    keeper_regret: {
      id: 'keeper_regret', npc: 'marlow', title: 'The Keeper\u2019s Regret',
      hint: 'At the lighthouse base in the evening, Marlow finally speaks.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'marlow_comforted', label: 'Never blamed' }, b: { flag: 'marlow_log_open', label: 'The storm' } }
    }
  };

  var emberTotal = 0;

  /* ---- flags ---- */
  function setFlag(k, v) {
    if (v === undefined) v = true;
    flags[k] = v;
  }
  function flag(k) {
    return flags.hasOwnProperty(k) ? !!flags[k] : false;
  }

  function embers() { return emberTotal; }

  function reset() {
    /* clear in place: WStory.flags is exposed by reference to consumers */
    for (var k in flags) if (flags.hasOwnProperty(k)) delete flags[k];
    lampLit = false;
    emberTotal = 0;
    for (var q in QUESTS) {
      if (QUESTS.hasOwnProperty(q)) {
        QUESTS[q].state = 'locked';
        delete QUESTS[q]._emberGiven;
      }
    }
  }

  /* ---- gates ---- */
  function canClimb(env) {
    var e = env || (window.WGame && WGame.env) || {};
    var h = e.hour !== undefined ? WU.hnorm(e.hour) : 12;
    return emberTotal >= 4 && flag('marlow_confession') && h >= 20;
  }

  /* finn_big_one unlocks Marlow's confession earlier (§3.2) */
  function marlowHeartGate() {
    return flag('finn_big_one') ? 2 : 3;
  }

  /* ---- branches (§4) ---- */

  /* B1 — who keeps the lamp. Sets lampLit + festival + main quest done. */
  function climb(choice) {
    if (choice === 'a') setFlag('lamp_together', true);
    else if (choice === 'b') setFlag('lamp_sole', true);
    else if (choice === 'c') setFlag('lamp_finn', true);
    lampLit = true;
    setFlag('festival', isFestival());
    var q = QUESTS.the_dark_lamp;
    if (q.state !== 'done_a' && q.state !== 'done_b') q.state = 'done_a';
    if (window.WAudio) WAudio.sfx('bell');
    if (window.WHUD) WHUD.toast('The lamp of Willowmere burns again.');
  }

  function isFestival() {
    return flag('truth_told') && (flag('lamp_together') || flag('lamp_finn'));
  }

  /* B2 — the lost boat: tell the truth or keep the myth. */
  function truth(choice) {
    if (choice === 'told') setFlag('truth_told', true);
    else setFlag('secret_kept', true);
  }

  /* ---- the attic letter (B2 source of truth_known) ---- */
  function readLetter(env) {
    if (!flag('show_won') && !flag('show_patience')) {
      if (window.WHUD) WHUD.toast('A small lock. It seems to be waiting for the garden show.');
      if (window.WAudio) WAudio.sfx('click');
      return;
    }
    if (flag('truth_known')) {
      if (window.WHUD) WHUD.toast('The letter is where you left it, read and folded.');
      return;
    }
    if (window.WDialogue && WDialogue.start('shed_letter_1')) {
      if (window.WGame && WGame.onDialogueOpened) WGame.onDialogueOpened();
    }
  }

  /* ---- talk node priority helpers ---- */
  function questNodeFor(npcId) {
    for (var k in QUESTS) {
      if (!QUESTS.hasOwnProperty(k)) continue;
      if (k === 'the_dark_lamp') continue;   // main arc is driven by the tower door
      var q = QUESTS[k];
      if (q.npc !== npcId) continue;
      if (q.state === 'available') return 'q_' + k + '_hook';
      if (q.state === 'active') return 'q_' + k + '_turnin';
    }
    return null;
  }

  /* one-off bonus node above greetings: Junie's mote-palette thanks (§5.4) */
  function talkBonusNode(npcId) {
    if (npcId === 'junie' && flag('junie_palette') && !flag('junie_palette_said')) {
      return 'junie_palette';
    }
    return null;
  }

  /* ---- progression API ---- */

  /* any layer that starts a talk calls this (dialogue.startForNpc does) */
  function onTalk(npcId) {
    if (!npcId) return;
    if (!flag('met_' + npcId)) setFlag('met_' + npcId, true);
  }

  /* gift resolution side effects (§5.4): loved gifts can open quests */
  function onGive(npcId, itemKey, tier) {
    if (npcId === 'gideon' && itemKey === 'critter_luna_moth') {
      if (QUESTS.seeds_of_spring.state === 'locked') {
        QUESTS.seeds_of_spring.state = 'available';
        if (window.WHUD) WHUD.toast('Gideon\u2019s eyes shine \u2014 he mentions his lost seed pouch.');
      }
    }
    if (npcId === 'junie' && itemKey === 'mote' && !flag('junie_palette')) {
      setFlag('junie_palette', true);
      if (window.WHUD) WHUD.toast('Junie holds the mote up to the light, delighted.');
    }
    if (npcId === 'mira' && itemKey === 'food_honeycomb' &&
        QUESTS.honey_loaf.state === 'locked') {
      QUESTS.honey_loaf.state = 'available';
    }
  }

  /* vista reached (world.js marks the same flag; this API stays in sync) */
  function onReach(vistaId) {
    var k = 'vista_' + vistaId;
    var fresh = !flag(k);
    setFlag(k, true);
    if (fresh && QUESTS.colors.state === 'active' && window.WHUD) {
      WHUD.toast('Junie\u2019s colour notes: ' + vistasSeen() + '/5 vistas.');
    }
  }

  function vistasSeen() {
    var ids = ['willow_overlook', 'heron_rock', 'lighthouse_head', 'shepherds_tor', 'old_stone_circle'];
    var n = 0;
    for (var i = 0; i < ids.length; i++) if (flag('vista_' + ids[i])) n++;
    return n;
  }

  /* item collected — wired by wrapping WAction.add once action.js exists */
  function onCollect(itemKey) {
    var FIRST = {
      food_honeycomb: 'Wild honeycomb, still humming. Mira could use this.',
      critter_firefly: 'A lantern with wings \u2014 Junie mentioned sketching these.',
      moonbell: 'It glows like a lamp that remembers the sun.'
    };
    if (FIRST[itemKey] && !flag('got_' + itemKey)) {
      setFlag('got_' + itemKey, true);
      if (window.WHUD) WHUD.toast(FIRST[itemKey]);
    }
  }

  function hookAction() {
    if (actionHooked || !window.WAction || typeof WAction.add !== 'function') return;
    actionHooked = true;
    var baseAdd = WAction.add;
    WAction.add = function (key, n) {
      var ok = baseAdd(key, n);
      if (ok && window.WStory && WStory.onCollect) WStory.onCollect(key);
      return ok;
    };
  }

  /* silent recount after loading a save */
  function recomputeEmbers() {
    emberTotal = 0;
    for (var k in QUESTS) {
      if (!QUESTS.hasOwnProperty(k) || k === 'the_dark_lamp') continue;
      var q = QUESTS[k];
      if (q.state === 'done_a' || q.state === 'done_b') {
        q._emberGiven = true;
        emberTotal += q.embers;
      }
    }
  }

  /* ---- per-frame drive ---- */
  function setState(id, s) { QUESTS[id].state = s; }
  function isDone(q) { return q.state === 'done_a' || q.state === 'done_b'; }

  function awardIfDone(q) {
    if (isDone(q) && !q._emberGiven) {
      q._emberGiven = true;
      if (q.embers > 0) {
        emberTotal += q.embers;
        if (window.WHUD) WHUD.toast('An Ember Light joins yours. (' + emberTotal + ')');
        if (window.WAudio) WAudio.sfx('bell');
      }
    }
  }

  function once(mark, fn) {
    if (flag(mark)) return;
    setFlag(mark, true);
    fn();
  }

  function allFriendPlusOne() {
    if (!window.WNpcs) return;
    for (var i = 0; i < WNpcs.DEFS.length; i++) {
      var id = WNpcs.DEFS[i].id;
      var inst = WNpcs.byId(id);
      if (inst) {
        WNpcs.setFriend(id, inst.hearts + 1);
        if (window.WParticles) {
          WParticles.emit('heart', inst.x + WU.rand(-6, 6), inst.y - 46, { life: 1.1 });
        }
      }
    }
  }

  function update(env) {
    var e = env || {};
    hookAction();

    /* --- availability gates (first meeting opens the quest) --- */
    if (QUESTS.honey_loaf.state === 'locked' && flag('met_mira')) setState('honey_loaf', 'available');
    if (QUESTS.seeds_of_spring.state === 'locked' && flag('met_gideon')) setState('seeds_of_spring', 'available');
    if (QUESTS.garden_show.state === 'locked' && flag('met_rosa')) setState('garden_show', 'available');
    if (QUESTS.big_one.state === 'locked' && flag('met_finn')) setState('big_one', 'available');
    if (QUESTS.parcel.state === 'locked' && flag('met_hana')) setState('parcel', 'available');
    if (QUESTS.lost_lamb.state === 'locked' && flag('met_bramble')) setState('lost_lamb', 'available');
    if (QUESTS.colors.state === 'locked' && flag('met_junie')) setState('colors', 'available');
    if (QUESTS.keeper_regret.state === 'locked' && flag('met_marlow') &&
        window.WNpcs && WNpcs.friend('marlow') >= marlowHeartGate()) {
      setState('keeper_regret', 'available');
    }
    if (QUESTS.the_dark_lamp.state === 'locked' && flag('key_given')) setState('the_dark_lamp', 'available');

    /* --- activation gates (player accepted the hook) --- */
    if (QUESTS.honey_loaf.state === 'available' && flag('honey_loaf_active')) setState('honey_loaf', 'active');
    if (QUESTS.seeds_of_spring.state === 'available' &&
        (flag('seeds_asked') || flag('seed_pouch_found'))) setState('seeds_of_spring', 'active');
    if (QUESTS.garden_show.state === 'available' && flag('garden_show_active')) setState('garden_show', 'active');
    if (QUESTS.big_one.state === 'available' && flag('big_one_active')) setState('big_one', 'active');
    if (QUESTS.parcel.state === 'available' && flag('parcel_active')) setState('parcel', 'active');
    if (QUESTS.lost_lamb.state === 'available' && flag('lost_lamb_active')) setState('lost_lamb', 'active');
    if (QUESTS.colors.state === 'available' && flag('colors_active')) setState('colors', 'active');
    if (QUESTS.keeper_regret.state === 'available' && flag('keeper_active')) setState('keeper_regret', 'active');
    if (QUESTS.the_dark_lamp.state === 'available' &&
        emberTotal >= 4 && flag('marlow_confession')) setState('the_dark_lamp', 'active');

    /* --- outcomes from the flag pool --- */
    if (!isDone(QUESTS.honey_loaf)) {
      if (flag('honey_to_mira')) setState('honey_loaf', 'done_a');
      else if (flag('honey_to_gideon')) setState('honey_loaf', 'done_b');
    }
    if (!isDone(QUESTS.seeds_of_spring)) {
      if (flag('seeds_returned')) setState('seeds_of_spring', 'done_a');
      else if (flag('seeds_gifted')) setState('seeds_of_spring', 'done_b');
    }
    if (!isDone(QUESTS.garden_show)) {
      if (flag('show_won')) setState('garden_show', 'done_a');
      else if (flag('show_patience')) setState('garden_show', 'done_b');
    }
    if (!isDone(QUESTS.big_one)) {
      if (flag('finn_big_one')) setState('big_one', 'done_a');
      else if (flag('siltjaw_freed')) setState('big_one', 'done_b');
    }
    if (!isDone(QUESTS.parcel)) {
      if (flag('parcel_kite')) setState('parcel', 'done_a');
      else if (flag('parcel_lens')) setState('parcel', 'done_b');
    }
    if (!isDone(QUESTS.lost_lamb)) {
      if (flag('lamb_quiet')) setState('lost_lamb', 'done_a');
      else if (flag('lamb_led')) setState('lost_lamb', 'done_b');
    }
    if (!isDone(QUESTS.colors)) {
      if (flag('junie_stays')) setState('colors', 'done_a');
      else if (flag('junie_leaves')) setState('colors', 'done_b');
    }
    if (!isDone(QUESTS.keeper_regret)) {
      if (flag('marlow_comforted')) setState('keeper_regret', 'done_a');
      else if (flag('marlow_log_open')) setState('keeper_regret', 'done_b');
    }
    if (!isDone(QUESTS.the_dark_lamp) && lampLit) setState('the_dark_lamp', 'done_a');

    /* --- embers --- */
    for (var k in QUESTS) {
      if (QUESTS.hasOwnProperty(k) && k !== 'the_dark_lamp') awardIfDone(QUESTS[k]);
    }

    /* --- outcome side effects --- */
    if (flag('honey_to_mira')) {
      once('_fx_bread', function () {
        allFriendPlusOne();
        if (window.WHUD) WHUD.toast('The green fills with the smell of shared bread. (+1\u2665 all)');
      });
    }
    if (flag('lamb_quiet')) {
      once('_fx_tune', function () {
        if (window.WNpcs) WNpcs.addFriend('bramble', 2);
        if (window.WAudio) WAudio.sfx('tune');
        if (window.WHUD) WHUD.toast('Bramble teaches you the Shepherd\u2019s Tune.');
      });
    }
    if (flag('siltjaw_freed')) {
      once('_fx_pierflies', function () {
        var pp = window.WWorld && WWorld.poi ? WWorld.poi.pier : null;
        if (pp && window.WParticles) {
          for (var i = 0; i < 10; i++) {
            WParticles.emit('firefly', pp.x + WU.rand(-60, 60), pp.y + WU.rand(-30, 30),
              { life: WU.rand(5, 9) });
          }
        }
      });
    }

    /* --- branch B1 chosen via flags -> finalise the climb --- */
    if (!lampLit && (flag('lamp_together') || flag('lamp_sole') || flag('lamp_finn'))) {
      climb();
    }
    /* festival can flip later if the truth surfaces after lighting */
    if (lampLit && !!flags.festival !== isFestival()) {
      setFlag('festival', isFestival());
    }
  }

  /* ---- epilogue assembly (§4): title + conditional paragraphs ---- */
  function epilogueLines() {
    var festival = isFestival();
    var out = [];
    out.push({ text: festival ? 'The Festival of First Light' : 'The Quiet Keeper', big: true });
    out.push({ text: festival
      ? 'Word travels faster than lamplight. By the next evening the green is strung with bunting, and Marlow \u2014 who has avoided crowds for two years \u2014 laughs exactly on cue.'
      : 'The beam turns its slow circle over Willowmere, a little quieter than festivals, a little steadier than fear. The village begins drawing Marlow out, one cup of tea at a time.' });
    if (flag('honey_to_mira')) out.push({ text: 'Mira bakes the festival loaf tall enough to see from the pier. Nobody minds that it leans.' });
    if (flag('honey_to_gideon')) out.push({ text: 'The greenhouse blooms out of season, and Gideon pretends not to be proud. He is extremely proud.' });
    if (flag('seeds_returned')) out.push({ text: 'Gideon\u2019s early sprouts come up in rows so straight you could set a clock by them.' });
    if (flag('seeds_gifted')) out.push({ text: 'Rosa\u2019s show bed erupts in colour; she sends cuttings back with a note: \u201cFrom a better view.\u201d' });
    if (flag('show_won')) out.push({ text: 'A moonbell glows at the lighthouse base, replanted where a keeper can see it.' });
    if (flag('show_patience')) out.push({ text: 'Rosa\u2019s garden blooms on its own schedule, which she declares \u201cshow-winning behaviour\u201d.' });
    if (flag('finn_big_one')) out.push({ text: 'Siltjaw hangs in the shop, labelled in Finn\u2019s hand: \u201cGRANDPA\u2019S FISH (mostly his).\u201d' });
    if (flag('siltjaw_freed')) out.push({ text: 'Some nights the pier fills with fireflies, and once \u2014 just once \u2014 a big fin tips the water.' });
    if (flag('parcel_kite')) out.push({ text: 'A kite flies over the green most afternoons, tied to the shop roof like a flag for no nation.' });
    if (flag('parcel_lens')) out.push({ text: 'The lens cloth hangs framed by the lamp, folded the way a keeper folds things.' });
    if (flag('lamb_quiet')) out.push({ text: 'A lamb named Warden follows Bramble\u2019s flock and, occasionally, you.' });
    if (flag('lamb_led')) out.push({ text: 'The new gate at the forest edge opens easily and closes kindly, like Bramble.' });
    if (flag('junie_stays')) out.push({ text: 'Junie\u2019s easel stands by the pier most mornings. Willowmere has all her colours.' });
    if (flag('junie_leaves')) out.push({ text: 'A letter arrives with a city postmark: paintings of a lake, and every single one has a lamp in it.' });
    if (flag('lens_cloth')) {
      out.push({ text: 'The lens cloth did its quiet work, and the light came through clean.' });
    } else {
      out.push({ text: 'You polished the fireglass with your sleeve. It was enough. It was always going to be enough.' });
    }
    if (flag('lamp_together')) out.push({ text: 'Marlow keeps the light four nights a week and sleeps properly the other three. You are co-Warden, which mostly means you get the good mug.' });
    if (flag('lamp_sole')) out.push({ text: 'The lamp is yours now. Marlow leaves tea on your step some mornings, and never once mentions it.' });
    if (flag('lamp_finn')) out.push({ text: 'Finn Marlow, twelve, is the youngest keeper in county records. He has not stopped grinning.' });
    if (flag('truth_told')) out.push({ text: 'And the Selkies, wherever they sail, know the cove remembers them.' });
    if (flag('secret_kept')) out.push({ text: 'The village keeps its myth, and the myth keeps Marlow company.' });
    if (festival) out.push({ text: 'Come summer: the first Festival of First Light. The committee is already arguing about bunting.' });
    return out;
  }

  /* ================================================================
     DIALOGUE NODES — quest hooks, turn-ins, branches (§3.2/§4)
     All node texts <= 120 chars (§12 data cap).
     ================================================================ */
  function N(speaker, text, extra) {
    var n = { speaker: speaker, text: text, next: null };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) n[k] = extra[k];
    return n;
  }
  function C(label, extra) {
    var c = { label: label, next: null };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) c[k] = extra[k];
    return c;
  }

  function registerNodes() {
    if (!window.WDialogue) return;
    var m = {};

    /* ---- honey_loaf (Mira) ---- */
    m.q_honey_loaf_hook = N('mira', 'The Honey Loaf needs wild honeycomb \u2014 the north hives. Bring me a piece and the village eats well.', {
      requires: { quest: { id: 'honey_loaf', state: 'available' } },
      choices: [
        C('I\u2019ll see what the hives have.', { setFlags: { honey_loaf_active: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_honey_loaf_turnin = N('mira', 'Any luck with the honeycomb, dear?', {
      requires: { quest: { id: 'honey_loaf', state: 'active' } },
      choices: [
        C('One piece, still warm.', {
          requires: { items: { food_honeycomb: 1 } },
          take: { food_honeycomb: 1 }, setFlags: { honey_to_mira: 1 }, next: 'q_honey_loaf_done'
        }),
        C('(Trade it to Gideon instead.)', {
          requires: { items: { food_honeycomb: 1 } },
          take: { food_honeycomb: 1 }, setFlags: { honey_to_gideon: 1 }, next: 'q_honey_done_b'
        }),
        C('The bees are still deliberating.')
      ]
    });
    m.q_honey_loaf_done = N('mira', 'The whole green will smell like Saturday. Thank you, Warden.');
    m.q_honey_done_b = N('mira', 'Gideon got it? That man haggles over everything but kindness. Good trade, dear.');

    /* ---- seeds_of_spring (Gideon) ---- */
    m.q_seeds_of_spring_hook = N('gideon', 'I dropped my seed pouch on the hill trail, east side. A season\u2019s work in one canvas bag.', {
      requires: { quest: { id: 'seeds_of_spring', state: 'available' } },
      choices: [
        C('I\u2019ll keep an eye out.', { setFlags: { seeds_asked: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_seeds_of_spring_turnin = N('gideon', 'Anything canvas-shaped on your walks?', {
      requires: { quest: { id: 'seeds_of_spring', state: 'active' } },
      choices: [
        C('Your seeds, safe and sound.', {
          requires: { items: { seeds_pouch: 1 } },
          take: { seeds_pouch: 1 }, setFlags: { seeds_returned: 1 }, next: 'q_seeds_done_a'
        }),
        C('Still looking.')
      ]
    });
    m.q_seeds_done_a = N('gideon', 'Early sprouts, every row. You have a gatherer\u2019s luck, Warden.');
    m.q_seeds_done_b = N('rosa', 'Gideon\u2019s seeds, my bed. Between us we\u2019ll feed the whole street.');

    /* ---- garden_show (Rosa) — B also carries the seeds-gift cross-choice ---- */
    m.q_garden_show_hook = N('rosa', 'The show needs a moonbell \u2014 night forest, after 21:00, glowing. When I was young I\u2019d have run there myself.', {
      requires: { quest: { id: 'garden_show', state: 'available' } },
      choices: [
        C('I\u2019ll pick one for you.', { setFlags: { garden_show_active: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_garden_show_turnin = N('rosa', 'Any glow in your pockets, dear?', {
      requires: { quest: { id: 'garden_show', state: 'active' } },
      choices: [
        C('A moonbell, picked from the night forest.', {
          requires: { items: { moonbell: 1 } },
          take: { moonbell: 1 }, setFlags: { show_won: 1 }, next: 'q_garden_done_a'
        }),
        C('Grow your own, Rosa. I believe in the garden.', {
          setFlags: { show_patience: 1 }, next: 'q_garden_done_b'
        }),
        C('(Slip her Gideon\u2019s seed pouch.)', {
          requires: { items: { seeds_pouch: 1 }, quest: { id: 'seeds_of_spring', state: 'active' } },
          take: { seeds_pouch: 1 }, setFlags: { seeds_gifted: 1 }, next: 'q_seeds_done_b'
        })
      ]
    });
    m.q_garden_done_a = N('rosa', 'For me? It goes to the show \u2014 then to the lighthouse base, to watch the water.');
    m.q_garden_done_b = N('rosa', 'Ha! Cheeky. \u2026The garden seems to agree with you, apparently.');

    /* ---- big_one (Finn) ---- */
    m.q_big_one_hook = N('finn', 'Grandpa says Siltjaw\u2019s still in the lake. BIGGEST. FISH. ALIVE. Catch it with me!', {
      requires: { quest: { id: 'big_one', state: 'available' } },
      choices: [
        C('Deal. One legendary fish.', { setFlags: { big_one_active: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_big_one_turnin = N('finn', 'Well?! Is the rod bending?!', {
      requires: { quest: { id: 'big_one', state: 'active' } },
      choices: [
        C('(Hold up the catch.) Siltjaw says hello.', {
          requires: { flags: ['siltjaw_caught'] },
          setFlags: { finn_big_one: 1 }, next: 'q_big_one_done_a'
        }),
        C('Siltjaw is the lake\u2019s, Finn. Let the legend keep swimming.', {
          setFlags: { siltjaw_freed: 1 }, next: 'q_big_one_done_b'
        })
      ]
    });
    m.q_big_one_done_a = N('finn', 'DEDICATION: to grandpa, best keeper who ever forgot to sleep. Can we mount it?!');
    m.q_big_one_done_b = N('finn', '\u2026Okay. Biggest. Respect. EVER. We met it \u2014 and we let it go.');

    /* ---- parcel (Hana) ---- */
    m.q_parcel_hook = N('hana', 'An unaddressed parcel has sat on my counter for two years. Postmistress\u2019s honour: find its home.', {
      requires: { quest: { id: 'parcel', state: 'available' } },
      choices: [
        C('I\u2019ll help solve it.', { setFlags: { parcel_active: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_parcel_turnin = N('hana', 'Progress report on the mystery box?', {
      requires: { quest: { id: 'parcel', state: 'active' } },
      choices: [
        C('Open it. Curiosity wins.', { setFlags: { parcel_kite: 1 }, next: 'q_parcel_done_a' }),
        C('Trace the sender \u2014 Marlow, maybe?', {
          requires: { flags: ['met_marlow'] },
          setFlags: { parcel_lens: 1 }, give: { lens_cloth: 1 }, next: 'q_parcel_done_b'
        })
      ]
    });
    m.q_parcel_done_a = N('hana', 'A kite. A very good kite. It goes on the shop roof \u2014 house rule now.');
    m.q_parcel_done_b = N('hana', 'His handwriting. His old lens cloth \u2014 he\u2019d want it near the lamp. Carry it.');

    /* ---- lost_lamb (Bramble); the scene is a story interactable, night ---- */
    m.q_lost_lamb_hook = N('bramble', 'One lamb short. Fourteen in, thirteen out. It went north after dark \u2014 I count better in daylight.', {
      requires: { quest: { id: 'lost_lamb', state: 'available' } },
      choices: [
        C('I\u2019ll bring it home.', { setFlags: { lost_lamb_active: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_lost_lamb_turnin = N('bramble', 'Bleating\u2019s in the forest, past the north trail. Follow your ears, not your feet.', {
      requires: { quest: { id: 'lost_lamb', state: 'active' } }
    });
    m.q_lost_lamb_scene = N('narrator', 'A small lamb, knee-deep in willow shadow, bleating at the dark like it\u2019s owed an answer.', {
      choices: [
        C('(Net-snatch, quick and quiet.)', { setFlags: { lamb_quiet: 1 }, next: 'q_lamb_done_a' }),
        C('(Lantern up. Walk it home slow.)', { setFlags: { lamb_led: 1 }, give: { wool_cloak: 1 }, next: 'q_lamb_done_b' })
      ]
    });
    m.q_lamb_done_a = N('bramble', 'Quiet hands. Fourteen again. Meet Warden \u2014 and here\u2019s the Shepherd\u2019s Tune.');
    m.q_lamb_done_b = N('bramble', 'Lantern-led. Kind way. Take the cloak \u2014 hill wool, rain-proof, mostly.');

    /* ---- colors (Junie) ---- */
    m.q_colors_hook = N('junie', 'I came for one colour and found forty. Show me the vistas \u2014 anywhere the land shows off.', {
      requires: { quest: { id: 'colors', state: 'available' } },
      choices: [
        C('Challenge accepted.', { setFlags: { colors_active: 1 } }),
        C('Maybe later.')
      ]
    });
    m.q_colors_turnin = N('junie', function () {
      var n = vistasSeen();
      return 'Seen anything that looked like a held breath? (' + n + '/5 vistas, for my notes.)';
    }, {
      requires: { quest: { id: 'colors', state: 'active' } },
      choices: [
        C('A firefly jar \u2014 sketch them while they glow.', {
          requires: { items: { critter_firefly: 1 } },
          take: { critter_firefly: 1 }, setFlags: { junie_stays: 1 }, next: 'q_colors_done_a'
        }),
        C('Paint the dark lighthouse instead. Some colours wait.', {
          setFlags: { junie_leaves: 1 }, next: 'q_colors_done_b'
        })
      ]
    });
    m.q_colors_done_a = N('junie', 'Willowmere has all my colours. I\u2019m staying \u2014 the easel goes by the pier.');
    m.q_colors_done_b = N('junie', 'A dark study\u2026 the bravest canvas here. I\u2019ll write from the city. I return for lakes.');

    /* ---- keeper_regret (Marlow) — the confession, plus B2 at the confession ---- */
    m.q_keeper_regret_hook = N('marlow', 'You keep coming by the tower. So does the guilt. Ask me something, someday. Not today.', {
      requires: { quest: { id: 'keeper_regret', state: 'available' } },
      choices: [C('(Give him time.)', { setFlags: { keeper_active: 1 } })]
    });
    m.q_keeper_regret_turnin = N('marlow', '\u2026The night the lamp died, I froze. A keeper keeps. I didn\u2019t. Say something, Warden.', {
      /* §3.2: the confession happens at the lighthouse base, 18-21; Marlow's
         schedule already parks him there 18-23.5, so the hour gate pins the
         scene to its time and place. */
      requires: { quest: { id: 'keeper_regret', state: 'active' }, hour: [18, 21] },
      choices: [
        C('The village never blamed you, Marlow.', {
          setFlags: { marlow_comforted: 1, marlow_confession: 1 }, next: 'q_keeper_done_a'
        }),
        C('Tell me about the storm.', {
          setFlags: { marlow_log_open: 1, marlow_confession: 1 }, next: 'q_keeper_done_b'
        }),
        C('The Selkies made port. Rosa kept their letter.', {
          requires: { flags: ['truth_known'] },
          setFlags: { truth_told: 1 }, next: 'q_truth_told'
        }),
        C('(Keep the myth. Keep him company instead.)', {
          setFlags: { secret_kept: 1 }
        })
      ]
    });
    m.q_keeper_done_a = N('marlow', '\u2026No? Hm. Perhaps blame was only ever mine to hold. Thank you, Warden.');
    m.q_keeper_done_b = N('marlow', 'Rain like iron. My log page is in a parcel somewhere \u2014 the rest of that story.');
    m.q_truth_told = N('marlow', 'They MADE port? (He laughs once, like a rope untying.) Come \u2014 the lamp won\u2019t light itself.');

    /* ---- climb branch: B2 (the truth) resolves first, then B1 (the keeper).
       When the truth is already known and untold, climb_menu offers it and
       falls through to climb_b1 via failNext; otherwise B1 comes straight up. ---- */
    m.climb_menu = N('narrator', 'Before the match: the old myth of the storm night sits between you and Marlow.', {
      requires: { flags: ['truth_known'], notFlags: ['truth_told', 'secret_kept'] },
      failNext: 'climb_b1',
      choices: [
        C('Tell him the Selkies made port.', {
          setFlags: { truth_told: 1 }, next: 'climb_truth'
        }),
        C('(Keep the myth. Say only that the lamp waited.)', {
          setFlags: { secret_kept: 1 }, next: 'climb_secret'
        })
      ]
    });
    m.climb_b1 = N('narrator', 'The dark lamp waits. Who keeps the light of Willowmere?', {
      choices: [
        C('Light it together.', { setFlags: { lamp_together: 1 }, next: 'climb_together' }),
        C('This one\u2019s mine. Rest, old friend.', { setFlags: { lamp_sole: 1 }, next: 'climb_sole' }),
        C('Let Finn strike the match.', {
          requires: { flags: ['finn_big_one'] },
          setFlags: { lamp_finn: 1 }, next: 'climb_finn'
        })
      ]
    });
    m.climb_together = N('narrator', 'One handle each. The fireglass catches \u2014 Willowmere has two keepers.', { next: 'climb_scene' });
    m.climb_sole = N('narrator', 'You lift the match alone. Marlow sits down at last, setting down forty years.', { next: 'climb_scene' });
    m.climb_finn = N('narrator', 'Finn\u2019s hands shake exactly once. The lamp takes the flame like it waited for him.', { next: 'climb_scene' });
    m.climb_truth = N('narrator', 'The guilt goes out of him like a tide. \u201cThen the letter was true. All of it.\u201d', { next: 'climb_b1' });
    m.climb_secret = N('narrator', 'Some storms stay untold. You stand with him; the night stands with you both.', { next: 'climb_b1' });
    m.climb_scene = N('narrator', 'The lamp roars alive. Across the valley, windows light one by one \u2014 pointing home.');

    /* ---- the attic letter (B2) ---- */
    m.shed_letter_1 = N('narrator', 'Behind the seed trays: a salt-stained letter, kept for years, addressed to no one still living here.', { next: 'shed_letter_2' });
    m.shed_letter_2 = N('narrator', '\u201cTo the keeper \u2014 the Selkies made port in your cove the night of the storm. We live because of you.\u201d', {
      setFlags: { truth_known: 1 }
    });

    /* ---- bonus node: Junie's mote palette (opened by onGive) ---- */
    m.junie_palette = N('junie', 'A mote of lake-light\u2026 that\u2019s the exact blue I could never mix. Thank you, Warden.', {
      setFlag: 'junie_palette_said'
    });

    WDialogue.register(m);
  }

  /* ---- story-owned interactables (re-added after every world build) ---- */
  function addStoryInteractables() {
    if (!window.WWorld) return;
    var list = WWorld.interactables;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === 'moonbell' || list[i].id === 'lost_lamb') return; // idempotent
    }
    list.push({
      id: 'moonbell',
      x: 21 * WWorld.TILE, y: 20 * WWorld.TILE, w: WWorld.TILE, h: WWorld.TILE + 16,
      label: 'Pick the moonbell',
      requires: { flags: ['garden_show_active'], hour: [21, 24], notFlags: ['moonbell_picked'] },
      onUse: function () {
        if (window.WAction && WAction.add('moonbell', 1)) {
          WStory.setFlag('moonbell_picked', true);
          if (window.WHUD) WHUD.toast('A moonbell, glowing like a lamp that remembers the sun.');
          if (window.WAudio) WAudio.sfx('sparkle');
        }
      }
    });
    list.push({
      id: 'lost_lamb',
      x: 26 * WWorld.TILE, y: 26 * WWorld.TILE, w: WWorld.TILE, h: WWorld.TILE + 16,
      label: 'Approach the lamb',
      requires: { flags: ['lost_lamb_active'], hour: [20, 24], notFlags: ['lamb_quiet', 'lamb_led'] },
      onUse: function () {
        if (window.WDialogue && WDialogue.start('q_lost_lamb_scene')) {
          if (window.WGame && WGame.onDialogueOpened) WGame.onDialogueOpened();
        }
      }
    });
  }

  registerNodes();
  if (window.WWorld && typeof WWorld.build === 'function') {
    var baseBuild = WWorld.build;
    WWorld.build = function () {
      baseBuild();
      addStoryInteractables();
    };
  }

  window.WStory = {
    flags: flags,
    QUESTS: QUESTS,
    setFlag: setFlag,
    flag: flag,
    embers: embers,
    canClimb: canClimb,
    climb: climb,
    truth: truth,
    readLetter: readLetter,
    questNodeFor: questNodeFor,
    talkBonusNode: talkBonusNode,
    onTalk: onTalk,
    onGive: onGive,
    onReach: onReach,
    onCollect: onCollect,
    epilogueLines: epilogueLines,
    update: update,
    reset: reset,
    recomputeEmbers: recomputeEmbers,
    marlowHeartGate: marlowHeartGate,
    lampLit: false, // replaced below with a getter/setter pair
    setLampLit: function (v) { lampLit = !!v; }
  };
  Object.defineProperty(window.WStory, 'lampLit', {
    get: function () { return lampLit; },
    set: function (v) { lampLit = !!v; }
  });

  return window.WStory;
})();
