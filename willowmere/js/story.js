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


  /* ---- quest defs (§7 shape) ---- */
  var QUESTS = {
    the_dark_lamp: {
      id: 'the_dark_lamp', npc: 'hana', title: 'Ngọn Đèn Tắt của Willowmere',
      hint: 'Thiện ý thắp đèn: 4 Ánh Than, lời thú nhận của Marlow, rồi leo lên sau 20:00.',
      embers: 0, state: 'locked', outcomes: null
    },
    honey_loaf: {
      id: 'honey_loaf', npc: 'mira', title: 'Ổ Bánh Mật Ong',
      hint: 'Tổ ong rừng chín ở bầy ong phía bắc.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'honey_to_mira', label: 'Ổ bánh của làng' }, b: { flag: 'honey_to_gideon', label: 'Hoa nở nhà kính' } }
    },
    seeds_of_spring: {
      id: 'seeds_of_spring', npc: 'gideon', title: 'Hạt Giống Mùa Xuân',
      hint: 'Một túi hạt giống bị rơi trên đường mòn đồi, phía đông.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'seeds_returned', label: 'Trả lại nó' }, b: { flag: 'seeds_gifted', label: 'Lén đưa cho Rosa' } }
    },
    garden_show: {
      id: 'garden_show', npc: 'rosa', title: 'Cuộc Thi Vườn',
      hint: 'Hoa chuông trăng nở trong rừng đêm (21:00+) và phát sáng.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'show_won', label: 'Hái cho cô ấy' }, b: { flag: 'show_patience', label: 'Tự trồng của mình' } }
    },
    big_one: {
      id: 'big_one', npc: 'finn', title: 'Chú Cá Khủng',
      hint: 'Con cá hồ huyền thoại Siltjaw. Một lần câu trúng trong lúc làm nhiệm vụ là đủ.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'finn_big_one', label: 'Kéo Siltjaw lên bờ' }, b: { flag: 'siltjaw_freed', label: 'Thả nó đi' } }
    },
    parcel: {
      id: 'parcel', npc: 'hana', title: 'Bưu Kiện Không Địa Chỉ',
      hint: 'Một bưu kiện không tên nằm trên quầy cửa hàng hai năm rồi.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'parcel_kite', label: 'Mở ra' }, b: { flag: 'parcel_lens', label: 'Lần theo người gửi' } }
    },
    lost_lamb: {
      id: 'lost_lamb', npc: 'bramble', title: 'Cừu Con Lạc',
      hint: 'Một con cừu con lạc vào rừng sau khi trời tối (20:00+).',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'lamb_quiet', label: 'Chộp lưới lặng lẽ' }, b: { flag: 'lamb_led', label: 'Dắt về bằng đèn lồng' } }
    },
    colors: {
      id: 'colors', npc: 'junie', title: 'Willowmere trong Sắc Màu',
      hint: 'Junie muốn đất trời khoe màu: đi tham quan các danh lam.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'junie_stays', label: 'Lọ đom đóm' }, b: { flag: 'junie_leaves', label: 'Nghiên cứu bóng tối' } }
    },
    keeper_regret: {
      id: 'keeper_regret', npc: 'marlow', title: 'Nỗi Hối Hận của Người Giữ Đèn',
      hint: 'Ở chân hải đăng buổi tối, Marlow cuối cùng cũng lên tiếng.',
      embers: 1, state: 'locked',
      outcomes: { a: { flag: 'marlow_comforted', label: 'Chưa từng trách' }, b: { flag: 'marlow_log_open', label: 'Cơn bão' } }
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
    if (window.WHUD) WHUD.toast('Ngọn đèn của Willowmere lại cháy sáng.');
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
      if (window.WHUD) WHUD.toast('Một ổ khóa nhỏ. Hình như nó đang chờ cuộc thi vườn.');
      if (window.WAudio) WAudio.sfx('click');
      return;
    }
    if (flag('truth_known')) {
      if (window.WHUD) WHUD.toast('Lá thư vẫn nằm đúng chỗ bạn để, đã đọc và gấp lại.');
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
    /* B4 — the keeper's staff: after his confession resolves, Marlow hands
       over the stick that carried him up the lamp stairs (WAction reads
       keeper_staff live: longer reach, wider arc, hits for 2) */
    if (npcId === 'marlow' && isDone(QUESTS.keeper_regret) && !flag('keeper_staff')) {
      if (window.WHUD) WHUD.toast('Marlow đưa cho bạn Gậy Giữ Đèn \u2014 vung xa và nặng hơn.');
      return 'marlow_staff';
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
        if (window.WHUD) WHUD.toast('Mắt Gideon sáng lên \u2014 ông nhắc đến túi hạt giống bị mất.');
      }
    }
    if (npcId === 'junie' && itemKey === 'mote' && !flag('junie_palette')) {
      setFlag('junie_palette', true);
      if (window.WHUD) WHUD.toast('Junie giơ hạt sáng lên trước ánh sáng, thích thú.');
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
      WHUD.toast('Sổ màu của Junie: ' + vistasSeen() + '/5 danh lam.');
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
      food_honeycomb: 'Tổ ong rừng, vẫn còn vo ve. Mira sẽ cần thứ này.',
      critter_firefly: 'Một chiếc đèn lồng có cánh \u2014 Junie từng nhắc muốn phác thảo chúng.',
      moonbell: 'Nó phát sáng như ngọn đèn còn nhớ mặt trời.'
    };
    if (FIRST[itemKey] && !flag('got_' + itemKey)) {
      setFlag('got_' + itemKey, true);
      if (window.WHUD) WHUD.toast(FIRST[itemKey]);
    }
  }

  /* onCollect is fired from inside WAction.add itself — wrapping the export
     used to miss every internal caller (net catches, motes, fish) */

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
        if (window.WHUD) WHUD.toast('Một Ánh Than hòa vào ánh sáng của bạn. (' + emberTotal + ')');
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
        if (window.WHUD) WHUD.toast('Bãi cỏ ngập mùi bánh mì chia nhau. (+1\u2665 tất cả)');
      });
    }
    if (flag('lamb_quiet')) {
      once('_fx_tune', function () {
        if (window.WNpcs) WNpcs.addFriend('bramble', 2);
        if (window.WAudio) WAudio.sfx('tune');
        if (window.WHUD) WHUD.toast('Bramble dạy bạn Khúc Người Chăn Cừu.');
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
    out.push({ text: festival ? 'Lễ Hội Ánh Sáng Đầu Tiên' : 'Người Giữ Đèn Thầm Lặng', big: true });
    out.push({ text: festival
      ? 'Tin tức còn chạy nhanh hơn ánh đèn. Đến tối hôm sau bãi cỏ đã căng đầy cờ tam giác, còn Marlow \u2014 người tránh đám đông suốt hai năm \u2014 cười đúng một cái thật vang.'
      : 'Chùm sáng chậm rãi quay trên Willowmere, yên tĩnh hơn lễ hội một chút, vững vàng hơn nỗi sợ một chút. Ngôi làng bắt đầu kéo Marlow ra ngoài, từng tách trà một.' });
    if (flag('honey_to_mira')) out.push({ text: 'Mira nướng ổ bánh lễ hội cao đến mức nhìn thấy từ bến tàu. Chẳng ai bận tâm nó hơi nghiêng.' });
    if (flag('honey_to_gideon')) out.push({ text: 'Nhà kính nở hoa trái mùa, còn Gideon giả vờ không tự hào. Ông tự hào cực kỳ.' });
    if (flag('seeds_returned')) out.push({ text: 'Mầm sớm của Gideon mọc thành từng hàng thẳng đến mức có thể chỉnh đồng hồ theo đó.' });
    if (flag('seeds_gifted')) out.push({ text: 'Luống dự thi của Rosa bùng nổ sắc màu; bà gửi lại những nhánh giâm kèm ghi chú: \u201cGửi từ một góc nhìn đẹp hơn.\u201d' });
    if (flag('show_won')) out.push({ text: 'Một đóa chuông trăng phát sáng ở chân hải đăng, được trồng lại nơi người giữ đèn nhìn thấy.' });
    if (flag('show_patience')) out.push({ text: 'Vườn Rosa nở theo lịch riêng của nó \u2014 điều bà tuyên bố là \u201chành vi đạt giải nhất\u201d.' });
    if (flag('finn_big_one')) out.push({ text: 'Siltjaw treo trong cửa hàng, nét chữ của Finn: \u201cCÁ CỦA ÔNG NỘI (đa phần là của ông).\u201d' });
    if (flag('siltjaw_freed')) out.push({ text: 'Vài đêm bến tàu ngập đom đóm, và một lần \u2014 chỉ đúng một lần \u2014 một chiếc vây lớn nhô lên khỏi mặt nước.' });
    if (flag('parcel_kite')) out.push({ text: 'Một con diều bay trên bãi cỏ hầu hết các buổi chiều, buộc vào mái cửa hàng như lá cờ của một quốc gia không tồn tại.' });
    if (flag('parcel_lens')) out.push({ text: 'Chiếc khăn lau thấu kính treo đóng khung cạnh ngọn đèn, gấp theo đúng kiểu người giữ đèn gấp đồ.' });
    if (flag('lamb_quiet')) out.push({ text: 'Một con cừu con tên Warden đi theo đàn của Bramble \u2014 và thỉnh thoảng, theo cả bạn.' });
    if (flag('lamb_led')) out.push({ text: 'Cánh cổng mới ở rìa rừng mở ra dễ dàng và đóng lại nhẹ nhàng, giống Bramble.' });
    if (flag('junie_stays')) out.push({ text: 'Giá vẽ của Junie đứng cạnh bến tàu hầu hết các buổi sáng. Willowmere có đủ mọi màu của cô ấy.' });
    if (flag('junie_leaves')) out.push({ text: 'Một lá thư đến với dấu bưu thành phố: những bức tranh về một hồ nước \u2014 và bức nào cũng có một ngọn đèn trong đó.' });
    if (flag('lens_cloth')) {
      out.push({ text: 'Chiếc khăn lau thấu kính đã làm phần việc thầm lặng của nó, và ánh sáng đi qua trong veo.' });
    } else {
      out.push({ text: 'Bạn lau kính lửa bằng ống tay áo. Thế là đủ. Vốn dĩ nó luôn là đủ.' });
    }
    if (flag('lamp_together')) out.push({ text: 'Marlow trông đèn bốn đêm một tuần và ngủ đúng giấc ba đêm còn lại. Bạn là đồng-Quản lý \u2014 nghĩa chủ yếu là bạn được dùng chiếc cốc đẹp.' });
    if (flag('lamp_sole')) out.push({ text: 'Ngọn đèn giờ là của bạn. Marlow để lại trà trước bậc cửa vài buổi sáng, và chưa từng nhắc đến.' });
    if (flag('lamp_finn')) out.push({ text: 'Finn Marlow, mười hai tuổi, là người giữ đèn trẻ nhất trong sổ sách của hạt. Cậu ấy chưa ngừng cười tủm tỉm.' });
    if (flag('truth_told')) out.push({ text: 'Và đám Selkie, dù đang ra khơi ở đâu, biết rằng vịnh nước vẫn nhớ họ.' });
    if (flag('secret_kept')) out.push({ text: 'Ngôi làng giữ lấy huyền thoại của mình, và huyền thoại giữ Marlow đỡ cô đơn.' });
    if (festival) out.push({ text: 'Đến mùa hè: Lễ Hội Ánh Sáng Đầu Tiên đầu tiên. Ban tổ chức đã cãi nhau về chuyện cờ tam giác.' });
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
    m.q_honey_loaf_hook = N('mira', 'Ổ Bánh Mật Ong cần tổ ong rừng \u2014 bầy ong phía bắc. Mang cho chị một miếng và cả làng ăn ngon.', {
      requires: { quest: { id: 'honey_loaf', state: 'available' } },
      choices: [
        C('Em sẽ xem bầy ong có gì.', { setFlags: { honey_loaf_active: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_honey_loaf_turnin = N('mira', 'Có tin gì về tổ ong chưa, em?', {
      requires: { quest: { id: 'honey_loaf', state: 'active' } },
      choices: [
        C('Một miếng đây, còn ấm.', {
          requires: { items: { food_honeycomb: 1 } },
          take: { food_honeycomb: 1 }, setFlags: { honey_to_mira: 1 }, next: 'q_honey_loaf_done'
        }),
        C('(Đem đổi cho Gideon thay vì vậy.)', {
          requires: { items: { food_honeycomb: 1 } },
          take: { food_honeycomb: 1 }, setFlags: { honey_to_gideon: 1 }, next: 'q_honey_done_b'
        }),
        C('Đàn ong vẫn đang bàn bạc.')
      ]
    });
    m.q_honey_loaf_done = N('mira', 'Cả bãi cỏ sẽ thơm mùi thứ bảy. Cảm ơn em, Quản lý.');
    m.q_honey_done_b = N('mira', 'Gideon được miếng đó à? Người đó mặc cả mọi thứ, trừ lòng tốt. Đổi tốt đấy, em.');

    /* ---- seeds_of_spring (Gideon) ---- */
    m.q_seeds_of_spring_hook = N('gideon', 'Ta làm rơi túi hạt giống trên đường mòn đồi, phía đông. Công một mùa vụ trong một cái túi vải.', {
      requires: { quest: { id: 'seeds_of_spring', state: 'available' } },
      choices: [
        C('Em sẽ để mắt tìm.', { setFlags: { seeds_asked: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_seeds_of_spring_turnin = N('gideon', 'Trên đường đi có thấy gì hình túi vải không?', {
      requires: { quest: { id: 'seeds_of_spring', state: 'active' } },
      choices: [
        C('Hạt giống của ông đây, còn nguyên.', {
          requires: { items: { seeds_pouch: 1 } },
          take: { seeds_pouch: 1 }, setFlags: { seeds_returned: 1 }, next: 'q_seeds_done_a'
        }),
        C('Vẫn đang tìm.')
      ]
    });
    m.q_seeds_done_a = N('gideon', 'Mầm sớm, hàng nào hàng nấy. Bạn có phúc của người hái lượm đấy, Quản lý.');
    m.q_seeds_done_b = N('rosa', 'Hạt của Gideon, luống của tôi. Hai chúng ta sẽ nuôi cả con phố này.');

    /* ---- garden_show (Rosa) — B also carries the seeds-gift cross-choice ---- */
    m.q_garden_show_hook = N('rosa', 'Cuộc thi cần một đóa chuông trăng \u2014 rừng đêm, sau 21:00, phát sáng. Hồi trẻ tôi đã tự chạy đến đó rồi.', {
      requires: { quest: { id: 'garden_show', state: 'available' } },
      choices: [
        C('Em sẽ hái một đóa cho cô.', { setFlags: { garden_show_active: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_garden_show_turnin = N('rosa', 'Trong túi có thứ gì phát sáng không, em?', {
      requires: { quest: { id: 'garden_show', state: 'active' } },
      choices: [
        C('Một đóa chuông trăng, hái trong rừng đêm.', {
          requires: { items: { moonbell: 1 } },
          take: { moonbell: 1 }, setFlags: { show_won: 1 }, next: 'q_garden_done_a'
        }),
        C('Tự trồng của mình đi, Rosa. Em tin vào vườn của cô.', {
          setFlags: { show_patience: 1 }, next: 'q_garden_done_b'
        }),
        C('(Lén đưa cô ấy túi hạt của Gideon.)', {
          requires: { items: { seeds_pouch: 1 }, quest: { id: 'seeds_of_spring', state: 'active' } },
          take: { seeds_pouch: 1 }, setFlags: { seeds_gifted: 1 }, next: 'q_seeds_done_b'
        })
      ]
    });
    m.q_garden_done_a = N('rosa', 'Cho tôi á? Nó sẽ đi dự thi \u2014 rồi về chân hải đăng, ngắm nước.');
    m.q_garden_done_b = N('rosa', 'Ha! Láo nhé. \u2026Hình như cái vườn lại đồng ý với em, ngộ thật.');

    /* ---- big_one (Finn) ---- */
    m.q_big_one_hook = N('finn', 'Ông nội bảo Siltjaw vẫn còn trong hồ. CON CÁ. TO NHẤT. CÒN SỐNG. Câu cùng em đi!', {
      requires: { quest: { id: 'big_one', state: 'available' } },
      choices: [
        C('Chốt. Một con cá huyền thoại.', { setFlags: { big_one_active: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_big_one_turnin = N('finn', 'Sao?! Cần câu có cong không?!', {
      requires: { quest: { id: 'big_one', state: 'active' } },
      choices: [
        C('(Giơ chiến lợi phẩm lên.) Siltjaw chào cậu nè.', {
          requires: { flags: ['siltjaw_caught'] },
          setFlags: { finn_big_one: 1 }, next: 'q_big_one_done_a'
        }),
        C('Siltjaw là của hồ, Finn à. Để huyền thoại bơi tiếp đi.', {
          requires: { flags: ['siltjaw_caught'] },
          setFlags: { siltjaw_freed: 1 }, next: 'q_big_one_done_b'
        })
      ]
    });
    m.q_big_one_done_a = N('finn', 'ĐỀ TẶNG: ông nội, người giữ đèn giỏi nhất từng quên đi ngủ. Có làm mẫu vật treo tường không?!');
    m.q_big_one_done_b = N('finn', '\u2026Được rồi. Nể phục. LỚN NHẤT. Tụi mình đã gặp nó \u2014 và thả nó đi.');

    /* ---- parcel (Hana) ---- */
    m.q_parcel_hook = N('hana', 'Một bưu kiện không địa chỉ nằm trên quầy tôi hai năm rồi. Danh dự của người trông bưu điện: tìm nhà cho nó.', {
      requires: { quest: { id: 'parcel', state: 'available' } },
      choices: [
        C('Em sẽ giúp giải mã.', { setFlags: { parcel_active: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_parcel_turnin = N('hana', 'Báo cáo tiến độ chiếc hộp bí ẩn nào?', {
      requires: { quest: { id: 'parcel', state: 'active' } },
      choices: [
        C('Mở ra. Tò mò thắng.', { setFlags: { parcel_kite: 1 }, next: 'q_parcel_done_a' }),
        C('Lần theo người gửi \u2014 có khi là Marlow?', {
          requires: { flags: ['met_marlow'] },
          setFlags: { parcel_lens: 1 }, give: { lens_cloth: 1 }, next: 'q_parcel_done_b'
        })
      ]
    });
    m.q_parcel_done_a = N('hana', 'Một con diều. Một con diều rất đẹp. Nó lên mái cửa hàng \u2014 quy tắc mới.');
    m.q_parcel_done_b = N('hana', 'Nét chữ của ông ấy. Chiếc khăn lau thấu kính cũ \u2014 ông ấy sẽ muốn nó gần ngọn đèn. Mang theo đi.');

    /* ---- lost_lamb (Bramble); the scene is a story interactable, night ---- */
    m.q_lost_lamb_hook = N('bramble', 'Thiếu một cừu con. Mười bốn vào, mười ba ra. Nó đi về phía bắc sau khi tối \u2014 ta đếm giỏi hơn ban ngày.', {
      requires: { quest: { id: 'lost_lamb', state: 'available' } },
      choices: [
        C('Em sẽ đưa nó về nhà.', { setFlags: { lost_lamb_active: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_lost_lamb_turnin = N('bramble', 'Tiếng be be trong rừng, qua đường mòn phía bắc. Đi theo tai, đừng theo chân.', {
      requires: { quest: { id: 'lost_lamb', state: 'active' } }
    });
    m.q_lost_lamb_scene = N('narrator', 'Một con cừu con, lún đến gối trong bóng liễu, be be với bóng tối như thể bóng tối mắc nợ nó một câu trả lời.', {
      choices: [
        C('(Chộp lưới, nhanh và lặng.)', { setFlags: { lamb_quiet: 1 }, next: 'q_lamb_done_a' }),
        C('(Đèn lồng lên. Dắt về nhà thật chậm.)', { setFlags: { lamb_led: 1 }, give: { wool_cloak: 1 }, next: 'q_lamb_done_b' })
      ]
    });
    m.q_lamb_done_a = N('bramble', 'Đôi tay khéo. Lại đủ mười bốn. Làm quen với Warden đi \u2014 và đây là Khúc Người Chăn Cừu.');
    m.q_lamb_done_b = N('bramble', 'Dắt bằng đèn. Cách tử tế. Cầm lấy áo choàng \u2014 len đồi, chống mưa, phần lớn là vậy.');

    /* ---- colors (Junie) ---- */
    m.q_colors_hook = N('junie', 'Tôi đến vì một màu và tìm thấy bốn mươi. Dẫn tôi đi xem danh lam \u2014 chỗ nào đất trời khoe màu.', {
      requires: { quest: { id: 'colors', state: 'available' } },
      choices: [
        C('Nhận thử thách.', { setFlags: { colors_active: 1 } }),
        C('Để hôm khác vậy.')
      ]
    });
    m.q_colors_turnin = N('junie', function () {
      var n = vistasSeen();
      return 'Có thấy gì trông như một hơi thở đang nín không? (' + n + '/5 danh lam, ghi vào sổ nhé.)';
    }, {
      requires: { quest: { id: 'colors', state: 'active' } },
      choices: [
        C('Một lọ đom đóm \u2014 phác thảo chúng lúc đang sáng.', {
          /* §3.2: the quest body is the vistas — both outcomes need >= 4 seen */
          requires: { items: { critter_firefly: 1 }, vistaMin: 4 },
          take: { critter_firefly: 1 }, setFlags: { junie_stays: 1 }, next: 'q_colors_done_a'
        }),
        C('Thay vào đó hãy vẽ hải đăng tắt. Có những màu biết chờ.', {
          requires: { vistaMin: 4 },
          setFlags: { junie_leaves: 1 }, next: 'q_colors_done_b'
        })
      ]
    });
    m.q_colors_done_a = N('junie', 'Willowmere có đủ mọi màu của tôi. Tôi ở lại \u2014 giá vẽ đặt cạnh bến tàu.');
    m.q_colors_done_b = N('junie', 'Một nghiên cứu về bóng tối\u2026 bức tranh can đảm nhất ở đây. Tôi sẽ viết thư \u2014 và quay lại vì những hồ nước.');

    /* ---- keeper_regret (Marlow) — the confession, plus B2 at the confession ---- */
    m.q_keeper_regret_hook = N('marlow', 'Cậu cứ ghé tháp hoài. Nỗi tội cũng vậy. Hôm nào đó, hỏi ta điều gì đi. Không phải hôm nay.', {
      requires: { quest: { id: 'keeper_regret', state: 'available' } },
      choices: [C('(Cho ông ấy thời gian.)', { setFlags: { keeper_active: 1 } })]
    });
    m.q_keeper_regret_turnin = N('marlow', '\u2026Đêm ngọn đèn tắt, ta đông cứng. Người giữ đèn thì phải giữ. Ta đã không. Nói gì đi, Quản lý.', {
      /* §3.2: the confession happens at the lighthouse base, 18-21. The
         schedule parks Marlow there 18:00-21:30 (he arrives walking ~19:20
         from the hills), so the hour gate pins the scene to its time and
         place. */
      requires: { quest: { id: 'keeper_regret', state: 'active' }, hour: [18, 21] },
      choices: [
        C('Làng chưa từng trách ông đâu, Marlow.', {
          setFlags: { marlow_comforted: 1, marlow_confession: 1 }, next: 'q_keeper_done_a'
        }),
        C('Kể cho tôi nghe về cơn bão đi.', {
          setFlags: { marlow_log_open: 1, marlow_confession: 1 }, next: 'q_keeper_done_b'
        }),
        C('Đám Selkie đã vào bến an toàn. Rosa giữ lá thư của họ.', {
          requires: { flags: ['truth_known'] },
          setFlags: { truth_told: 1 }, next: 'q_truth_told'
        }),
        C('(Giữ lấy huyền thoại. Ở bên ông ấy thay vào đó.)', {
          setFlags: { secret_kept: 1 }
        })
      ]
    });
    m.q_keeper_done_a = N('marlow', '\u2026Không à? Hm. Có lẽ lỗi vốn chỉ là của riêng ta giữ. Cảm ơn, Quản lý.');
    m.q_keeper_done_b = N('marlow', 'Mưa như sắt. Trang nhật ký của ta nằm trong một bưu kiện đâu đó \u2014 phần còn lại của câu chuyện.');
    m.q_truth_told = N('marlow', 'Họ VÀO BẾN được à? (Ông bật cười một tiếng, như một sợi dây được tháo nút.) Đi thôi \u2014 ngọn đèn không tự thắp đâu.');
    /* B4 — keeper staff hand-off (talkBonusNode fires this once) */
    m.marlow_staff = N('marlow', 'Cây gậy này chống ta lên cầu thang đèn mười lăm năm. Cán vẫn ấm lửa \u2014 cầm lấy, đêm dài cần một tay chắc.', {
      setFlags: { keeper_staff: 1 }, next: 'marlow_staff_done'
    });
    m.marlow_staff_done = N('marlow', 'Vung rộng hơn, nện nặng hơn. Chỉ nhớ một điều ta đã quên: đừng để bóng nào qua được.');

    /* ---- climb branch: B2 (the truth) resolves first, then B1 (the keeper).
       When the truth is already known and untold, climb_menu offers it and
       falls through to climb_b1 via failNext; otherwise B1 comes straight up. ---- */
    m.climb_menu = N('narrator', 'Trước khi châm lửa: huyền thoại cũ về đêm bão nằm giữa bạn và Marlow.', {
      requires: { flags: ['truth_known'], notFlags: ['truth_told', 'secret_kept'] },
      failNext: 'climb_b1',
      choices: [
        C('Nói với ông ấy đám Selkie đã vào bến.', {
          setFlags: { truth_told: 1 }, next: 'climb_truth'
        }),
        C('(Giữ lấy huyền thoại. Chỉ nói rằng ngọn đèn đã đợi.)', {
          setFlags: { secret_kept: 1 }, next: 'climb_secret'
        })
      ]
    });
    m.climb_b1 = N('narrator', 'Ngọn đèn tắt đang chờ. Ai sẽ giữ ánh sáng của Willowmere?', {
      choices: [
        C('Thắp nó cùng nhau.', { setFlags: { lamp_together: 1 }, next: 'climb_together' }),
        C('Việc này của tôi. Nghỉ ngơi đi, bạn già.', { setFlags: { lamp_sole: 1 }, next: 'climb_sole' }),
        C('Để Finn quẹt diêm.', {
          requires: { flags: ['finn_big_one'] },
          setFlags: { lamp_finn: 1 }, next: 'climb_finn'
        })
      ]
    });
    m.climb_together = N('narrator', 'Mỗi người một tay cầm. Kính lửa bắt lửa \u2014 Willowmere có hai người giữ đèn.', { next: 'climb_scene' });
    m.climb_sole = N('narrator', 'Bạn một mình nhấc que diêm. Marlow cuối cùng cũng ngồi xuống, đặt lại bốn mươi năm.', { next: 'climb_scene' });
    m.climb_finn = N('narrator', 'Tay Finn run đúng một lần. Ngọn đèn đón lấy lửa như thể nó đợi cậu ấy.', { next: 'climb_scene' });
    m.climb_truth = N('narrator', 'Nỗi tội rời khỏi ông như triều rút. \u201cVậy lá thư là thật. Tất cả đều thật.\u201d', { next: 'climb_b1' });
    m.climb_secret = N('narrator', 'Có những cơn bão không được kể. Bạn đứng cạnh ông ấy; màn đêm đứng cạnh cả hai.', { next: 'climb_b1' });
    m.climb_scene = N('narrator', 'Ngọn đèn gầm lên sống dậy. Bên kia thung lũng, từng cửa sổ sáng lên \u2014 chỉ đường về nhà.');

    /* ---- the attic letter (B2) ---- */
    m.shed_letter_1 = N('narrator', 'Sau những khay hạt giống: một lá thư vệt muối, giữ nhiều năm, gửi cho một người không còn sống ở đây.', { next: 'shed_letter_2' });
    m.shed_letter_2 = N('narrator', '\u201cGửi người giữ đèn \u2014 đám Selkie đã vào vịnh của anh đêm cơn bão. Chúng tôi sống là nhờ anh.\u201d', {
      setFlags: { truth_known: 1 }
    });

    /* ---- bonus node: Junie's mote palette (opened by onGive) ---- */
    m.junie_palette = N('junie', 'Một hạt ánh hồ\u2026 đúng cái màu xanh tôi không bao giờ pha được. Cảm ơn, Quản lý.', {
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
      label: 'Hái hoa chuông trăng',
      requires: { flags: ['garden_show_active'], hour: [21, 24], notFlags: ['moonbell_picked'] },
      onUse: function () {
        if (window.WAction && WAction.add('moonbell', 1)) {
          WStory.setFlag('moonbell_picked', true);
          if (window.WHUD) WHUD.toast('Một đóa chuông trăng, sáng như ngọn đèn còn nhớ mặt trời.');
          if (window.WAudio) WAudio.sfx('sparkle');
        }
      }
    });
    list.push({
      id: 'lost_lamb',
      x: 26 * WWorld.TILE, y: 26 * WWorld.TILE, w: WWorld.TILE, h: WWorld.TILE + 16,
      label: 'Đến gần cừu con',
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
