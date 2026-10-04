/* NEON SWARM - js/upgrades.js
 * The 16 upgrade cards (section 4) + the Field Rations fallback, weighted
 * level-up rolls, and the single sanctioned path into player.stats.
 * Public global: window.GameUpgrades (alias GV). Contract: DESIGN.md 5.2.
 */
(function () {
  'use strict';

  // Card factory: apply() delegates to Player.applyUpgrade (entities.js owns
  // the per-id stat switch). stacks = the new stack count after this pick.
  function card(id, name, desc, max, w) {
    return {
      id: id, name: name, desc: desc, max: max, w: w,
      apply: function (player, stacks) { return player.applyUpgrade(id, stacks); }
    };
  }

  // Section 4 table, verbatim stats / maxes / weights.
  var UPGRADES = [
    card('damage',    'Amplify',         'Bullet damage x1.25',                              6, 100),
    card('firerate',  'Trigger',         'Fire rate x1.20',                                  5, 100),
    card('multishot', 'Split Barrel',    '+1 bullet per shot, full damage fan',              4, 70),
    card('pierce',    'Railcoat',        'Bullets survive +1 enemy hit',                     4, 70),
    card('vampiric',  'Leech Rounds',    '+1 HP healed per kill',                            5, 60),
    card('speed',     'Lightfoot',       'Move speed +12%',                                  5, 90),
    card('flow',      'Flow State',      'Dash-phase kills cut 1.0 s off dash cooldown',     3, 40),
    card('chain',     'Arc Web',         '30% chance: lightning arcs to 2 foes, 50% dmg',    3, 50),
    card('boom',      'Volatile Rounds', 'Final hit explodes: 45 px, 50% damage',            3, 50),
    card('magnet',    'Graviton Core',   'Magnet radius +45%',                               3, 80),
    card('maxhp',     'Reinforce',       '+25 max HP and heal 25',                           4, 90),
    card('regen',     'Nanoblood',       '+0.6 HP/s regeneration',                           4, 70),
    card('bullet',    'Hypersonic',      'Bullet speed +20%, bullet size +10%',              3, 70),
    card('aura',      'Static Field',    'Aura: 8 dps to foes within 65 px',                 3, 50),
    card('crit',      'Overclock',       'Crit chance +10% (base 5%, cap 60%)',              5, 80),
    card('greedy',    'Data Thirst',     'XP gained +25%',                                   3, 70)
  ];

  // Fallback card: offered only when fewer than 3 real upgrades remain;
  // never stacks and never enters the weighted pool (section 2.3 / 4).
  var FALLBACK = card('heal', 'Field Rations', 'Heal 30 HP', Infinity, 0);

  var GV = {
    UPGRADES: UPGRADES,
    FALLBACK: FALLBACK,

    byId: function (id) {
      for (var i = 0; i < UPGRADES.length; i++) {
        if (UPGRADES[i].id === id) return UPGRADES[i];
      }
      return id === 'heal' ? FALLBACK : null;
    },

    // 3 distinct non-maxed upgrades by weighted sample; heal fills the rest.
    roll3: function (player) {
      var avail = [];
      var i;
      for (i = 0; i < UPGRADES.length; i++) {
        if ((player.upStacks[UPGRADES[i].id] || 0) < UPGRADES[i].max) avail.push(UPGRADES[i]);
      }
      var out = [];
      while (out.length < 3 && avail.length > 0) {
        var total = 0;
        for (i = 0; i < avail.length; i++) total += avail[i].w;
        var roll = Math.random() * total;
        var idx = avail.length - 1;
        for (i = 0; i < avail.length; i++) {
          roll -= avail[i].w;
          if (roll <= 0) { idx = i; break; }
        }
        out.push(avail[idx]);
        avail.splice(idx, 1);
      }
      while (out.length < 3) out.push(FALLBACK);
      return out;
    },

    // The only code path allowed to mutate player.stats (via
    // Player.applyUpgrade). Increments upStacks, runs the card, and returns
    // false when the card is maxed or unknown (section 4 apply rule).
    apply: function (player, id) {
      var def = this.byId(id);
      if (!def) return false;
      var cur = player.upStacks[id] || 0;
      if (cur >= def.max) return false;
      var stacks = cur + 1;
      player.upStacks[id] = stacks;
      return def.apply(player, stacks) !== false;
    }
  };

  window.GameUpgrades = GV;
})();
