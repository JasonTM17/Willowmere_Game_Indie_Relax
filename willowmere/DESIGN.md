# WILLOWMERE — Design Document

`v1.0 · 2026-10-05 · cozy adventure · HTML5, vanilla JS + Canvas 2D · runs from file://`

Constraints honoured everywhere below: **no ES modules, no `fetch()`, no network
assets, no `getImageData` on image-drawn canvases**. All "JSON" data lives as
plain `js/*.js` scripts attaching to `window.*` globals. Double-click
`index.html` → game runs.

---

## 1 · Title · Pitch · Hooks

**Title:** **Willowmere**

**Pitch.** The lakeside hamlet of Willowmere has one wound: its lighthouse has been
dark for two years, ever since old keeper Marlow walked into the hills carrying a
guilt he never explained. You arrive as the new Warden. The village hands you
Marlow's cottage, an overgrown garden, and a long list of small kindnesses. Tend
the light by tending the people — bake with Mira, fish with Finn, climb the tor
with Bramble — and when four Ember Lights of goodwill glow in your lantern, climb
the tower at night and decide who relights the lamp: Marlow, you, or a
twelve-year-old who has been practising all summer.

**Hooks**
1. **A village that lives without you.** 8 villagers keep hour-by-hour schedules and
   physically walk between them; 8 scripted ambient NPC↔NPC conversations play as
   speech bubbles you can step closer to read in full.
2. **Gentle adventure, no fail state.** Net critters by biome and hour, two-press
   timing fishing, slingshot drifting light-motes; a miss is a shrug, a catch is a
   gift waiting to happen.
3. **A world painted by the hour.** 8-minute days with per-hour colour grading, rain
   from Day 2, fireflies, leaf-fall, cloud shadows — and five vista points that open
   slow panorama postcards.

---

## 2 · World

One contiguous outdoor map. **Tile size 32 px · map 128×96 tiles (4096×3072 px).**
No interiors: every door, bench and hearth is an exterior interactable (§5.4).

| Region | Tiles (x,y) | Content |
|---|---|---|
| Meadow Village | 8–60 × 30–70 | green + well, 8 building fronts (bakery, shop, 6 cottages), notice board, 4 lamp posts |
| Willow Forest | y 0–30 all x, + west arm x 0–24 × y 30–44 | willows, wild hives, Old Stone Circle, fireflies |
| Lake | ellipse centre (88,40), radii 24×16 | pier, Heron Rock, reeds, fish |
| Beach & Sea | y 72–96, x 8–76; sea south of y 86 | tide pools, Junie's tent, lighthouse headland 66–72 × 78–86 |
| High Hills | x 96–128 × y 52–96 | terraces, Shepherd's Tor, Marlow's hut, windmill ruin |

Trails (path tiles, collision-free): village→forest (x=30), village→lake (y=48),
village→beach (x=24), lake→hills (y=60), beach→hills (y=84).

**Vista points (5).** Trigger: enter 2-tile radius → camera zooms 1.0→0.45 over
1.2 s, letterbox vignette + caption; leaves on any move key.

| Vista | Where (tile) | Caption |
|---|---|---|
| Willow Overlook | (30,8) | "From here, every chimney in Willowmere smokes like a friendly word." |
| Heron Rock | (102,28) | "The lake keeps yesterday's sky on the bottom." |
| Lighthouse Head | (69,88) | "Two years dark. The gulls still circle it, out of habit." |
| Shepherd's Tor | (112,60) | "The whole valley, and not one hurried thing in it." |
| Old Stone Circle | (14,18) | "Older than the lamp. It doesn't mind waiting." |

**Day/night cycle.** 1 game hour = 20 s real → full day 480 s ≈ 8 min. Clock is
continuous `hour` 0–24 plus integer `day`. Sky grade = full-canvas composite
overlay, values lerped between keyframes (`WWorld.hourTint`):

| hour | effect |
|---|---|
| 0 | multiply rgba(38,44,92,.55) |
| 4 | multiply rgba(52,50,110,.50) |
| 5.5 | screen rgba(255,150,80,.18) |
| 7 | screen rgba(255,200,120,.10) |
| 12 | none |
| 17 | screen rgba(255,170,90,.14) |
| 19 | screen rgba(255,110,90,.16) |
| 20.5 | multiply rgba(40,40,96,.45) |
| 22 | multiply rgba(24,30,72,.55) |

**Weather.** Day 1 clear. Day 2 = guaranteed rain (teaches the system). From Day 3
each 06:00 roll 35 % rain lasting to 17:00. Rain = ≤300 streak particles, ripple
rings where drops hit water tiles, `music-rain` loop crossfaded in, wet glints on
sand paths. During rain 9:00–17:00, Mira/Gideon/Rosa/Hana shelter inside
(schedule override); Finn, Marlow and Bramble stay out — "fish don't mind".

---

## 3 · Cast — 8 NPCs

All NPCs physically walk between schedule waypoints (speed 42 px/s, axis-first
steering, idle 2–4 s on arrival). Hearts 0–10 per NPC. Gifts: **loved +2♥,
liked +1♥, neutral +0.5♥, disliked −0.5♥**; one full-effect gift per NPC per day
(repeats that day give a polite line and +0). Friendship unlocks dialogue at 3♥
and 6♥ (`requires.friendship`).

### 3.1 The eight

**1 · Mira Thistle — baker, 28.** Home: bakery, west side of the green.
Voice: honeyed, food metaphors ("You look a little under-proofed, dear.").
Schedule: 5–7.5 bakery ovens · 7.5–11 bakery counter · 11–13 green (well) ·
13–17 counter · 17–20 dock stroll · 20+ home. Rain 9–17: bakery.
Gifts — loved: critter_butterfly, food_honeycomb · liked: fish_moonfish, mote ·
disliked: critter_cricket.

**2 · Gideon Root — herbalist & beekeeper, 61.** Home: greenhouse, forest edge.
Voice: clipped, plant metaphors ("Mind the thyme. It minds you.").
Schedule: 6–9 forest herb loop · 9–12 greenhouse · 12–13 lunch bench ·
13–18 greenhouse · 18–20 green bench · 20+ home. Rain 9–17: greenhouse.
Gifts — loved: critter_oak_beetle, critter_luna_moth · liked: critter_firefly ·
disliked: fish_carp.

**3 · Rosa Quill — retired teacher, 78.** Home: cottage with big garden, village east.
Voice: whimsical, starts with "When I was young…", gently meanders.
Schedule: 7–9 garden watering · 9–12 lake pier (feeds ducks) · 12–14 home nap ·
14–17 garden bench (reads) · 17–19 green · 19+ home. Rain 9–17: home porch.
Gifts — loved: critter_luna_moth, critter_cricket · liked: food_honeycomb ·
disliked: fish_flounder.

**4 · Old Marlow — the vanished lighthouse keeper, 74.** Home: driftwood hut, hills.
Voice: long sighs, nautical phrases, careful guilt ("A keeper keeps. I didn't.").
Schedule: 5–8 beach tide pools · 8–11 hut · 11–15 hills driftwood loop ·
15–18 hut · 18–21 lighthouse base (stares up) · 21+ hut.
Gifts — loved: critter_glow_worm, fish_moonfish · liked: mote · disliked: none
("I've no room to dislike anything, these days.").

**5 · Finn Marlow — Marlow's grandson, 12.** Home: dockside cottage.
Voice: rapid-fire, stammers when excited, superlatives ("Biggest. Wave. EVER.").
Schedule: 6–9 lake pier fishing · 9–12 scout loop (forest trail) · 12–13 pier
lunch with Rosa · 13–17 beach tide pools · 17–20 green games · 20+ home.
Gifts — loved: fish_any, critter_dragonfly · liked: critter_sand_crab ·
disliked: food_honeycomb ("sticky paws, no thanks").

**6 · Hana Oak — shopkeeper & postmistress, 35.** Home: rooms above the shop.
Voice: deadpan one-liners, inventory metaphors ("Feelings: out of stock.").
Schedule: 7–8 mail round (walks past every front door, ends at bakery 7.5–8) ·
8–19 shop counter · 19–20 dock sunset · 20+ home.
Gifts — loved: critter_sand_crab, mote · liked: fish_minnow ·
disliked: critter_mayfly ("they cluster. Like rumors.").

**7 · Bramble — hill shepherd, 45.** Home: hill hut. Voice: laconic, hums, counts
sheep instead of adjectives ("Hm. Fourteen. Good number.").
Schedule: 5–9 pasture walk with flock (3 sheep props) · 9–12 west overlook ·
12–14 nap under tree · 14–18 pasture · 18–19 lake edge (waters flock) · 19+ hut.
Gifts — loved: critter_grasshopper · liked: critter_sand_crab, fish_perch ·
disliked: critter_oak_beetle ("bites wool.").

**8 · Junie Vale — wandering painter, 24.** Home: tent on the beach.
Voice: floaty, colours as feelings ("That sky is a held breath.").
Schedule: 6–10 beach easel · 10–13 lake (paints pier) · 13–15 green ·
15–18 forest (paints light shafts) · 18–20 hills (paints sunset at the Tor vista) ·
20+ tent. Rain 9–17: tent (paints the rain anyway).
Gifts — loved: critter_firefly, mote · liked: any critter · disliked: none.

### 3.2 Questlines — 8 quests, each with two outcomes

Every completed questline awards **1 Ember Light** (main-arc fuel, §4). State
machine per quest: `locked → available → active → done_a | done_b`.

| Quest (NPC) | Hook | Choice → outcome A | Choice → outcome B |
|---|---|---|---|
| `honey_loaf` (Mira) | A wild honeycomb ripens in the forest hives; the loaf needs it | **Bake the village loaf** → `done_a`, flag `honey_to_mira`: green fills with shared bread, +1♥ to all 8 | **Trade it to Gideon** → `done_b`, flag `honey_to_gideon`: greenhouse blooms overnight, Gideon walks in rain with salve |
| `seeds_of_spring` (Gideon) | His seed pouch was lost on the hill trail (shiny interactable) | **Return it** → `done_a`, flag `seeds_returned`: greenhouse sprouts early, Gideon softens | **Slip it to Rosa** → `done_b`, flag `seeds_gifted`: Rosa's show bed erupts; she shares cuttings back with Gideon |
| `garden_show` (Rosa) | A moonbell (night-bloom, forest 21–24, glows) would win the show | **Pick it for her** → `done_a`, flag `show_won`: moonbell replanted at the lighthouse base — glows after the arc | **"Grow your own."** → `done_b`, flag `show_patience`: her garden self-blooms next morning; she laughs at herself |
| `big_one` (Finn) | The legendary lake fish "Siltjaw"; one successful stage-2 catch during the quest counts | **Help land Siltjaw** → `done_a`, flag `finn_big_one`: Finn dedicates it to grandpa; Marlow's confession unlocks earlier | **Convince him to release it** → `done_b`, flag `siltjaw_freed`: pier fireflies that night; Siltjaw surfaces once, tips a fin |
| `parcel` (Hana) | An unaddressed parcel sits on the counter | **Open it** → `done_a`, flag `parcel_kite`: a kite — hung in the shop, children gather daily | **Trace the sender** (Marlow's log page, requires `met_marlow`) → `done_b`, flag `parcel_lens`: it is Marlow's — grants item `lens_cloth` |
| `lost_lamb` (Bramble) | A lamb strayed into the forest after dark (20–24) | **Quiet net-snatch** → `done_a`, flag `lamb_quiet`: lamb named "Warden"; Bramble teaches the Shepherd's Tune (new SFX motif, +2♥) | **Lantern-led walk home** → `done_b`, flag `lamb_led`: Bramble builds a gate, gifts `wool_cloak` (cosmetic: white scarf sprite in rain) |
| `colors` (Junie) | She asks you to show her Willowmere's colours: visit 4 vistas (flag per vista) | **Bring a firefly jar to sketch** → `done_a`, flag `junie_stays`: "Willowmere has all my colours." She stays | **Suggest a dark-lighthouse study** → `done_b`, flag `junie_leaves`: she leaves for the city at dawn, promises to return |
| `keeper_regret` (Marlow; **requires 3♥**) | At the lighthouse base, 18–21, he finally speaks | **"The village never blamed you."** → flag `marlow_comforted` | **"Tell me about the storm."** → flag `marlow_log_open` (leads to the attic letter, §4) — both set `marlow_confession` |

### 3.3 Ambient NPC↔NPC conversations (8 pairs)

Engine: when both NPCs are within 3 tiles of the pair POI and the hour window and
`requires` (§6) hold, alternating **speech bubbles** (≤60 chars, cycle 6 s,
3–5 lines, pair cooldown 90 s). If the player is within 5 tiles, the current line
also renders full-length in a small "overheard" panel above the pair.

| id | pair | POI · hour | requires | Flavour |
|---|---|---|---|---|
| `am_honey` | Mira + Gideon | green well · 11–13 | — | honey price banter, 40 years running |
| `am_ducks` | Finn + Rosa | lake pier · 12–13 | — | which duck is "Kevin" |
| `am_post` | Hana + Mira | bakery door · 7.5–8 | — | parcels vs pastries |
| `am_tide` | Marlow + Bramble | beach tide pools · 5–8 | — | two silences, one kettle |
| `am_forecast` | Finn + Hana | dock · 19–20 | — | deadpan weather forecast |
| `am_colors` | Junie + Rosa | green · 14–15 | flag `met_junie` | the garden as a palette |
| `am_seeds` | Gideon + Rosa | green bench · 18–20 | quest `seeds_of_spring` done_a/b | line differs by outcome |
| `am_lamp` | Finn + Marlow | lighthouse base · 18–24 | flag `marlow_confession` | grandson & grandfather, quietly |

**Engine schedule notes (implementation, §3.1/§3.3).** The engine walks NPCs
at real-time 42 px/s, so crossing the map takes ~2–3 game-hours — longer than
some §3.1 beats. Consequences, all deliberate:

- Commutes are packed into the small hours so a beat is actually *stood at*:
  Marlow walks to the tide pools 2–5, leaves them at 7:00 so the §3.1 8–11
  hut beat is really stood (~10:30 after the ~3.5 h walk), and stays at the
  lighthouse base to 22:45 so Finn's evening visit (pair `am_lamp`) overlaps;
  Finn waits at the tower 19:30–22:30 (the green-games walk alone eats
  ~1.8 h) and is home from 22:30 rather than 20:00. Junie reaches the Tor
  ~20:2 and paints the last light; her forest light-shaft beat (15–18) had
  to give, as the Tor is a full map from the north forest.
- Pair windows are re-pinned to where the restored beats actually overlap:
  `am_post` 8.4–9 (mail round ends at the bakery), `am_colors` 16.9–17.6
  (Rosa's bench ends 16.5 so the pair can meet); `am_lamp` keeps the wide
  `18–24` window — the two stand at the base together ~21.4–22.5
  (Marlow 18–22.75, Finn 19.5–22.5), and the `marlow_confession` flag gates
  it.
- `am_tide` (Marlow + Bramble) has no shared geography under faithful §3.1 —
  his mornings are at the beach tide pools, Bramble's on the pasture — so it
  is kept as data but does not fire; `am_forecast` lost its dock overlap to
  Finn's restored green-games beat. Both are documented in `npcs.js`.
- Hana's §3.1 mail round walks four front doors (east cottage → west cottage
  → the Warden's cottage → bakery) between 7:00 and 9:00.

---

## 4 · Story — "The Dark Lamp of Willowmere"

**No fail state anywhere.** Nothing is timed, nothing can be lost, every action
ends in something gentle. The arc completes when the *player* decides.

**Arc.** Day 1: Hana hands you Marlow's cottage key (opening dialogue) and the
main quest `the_dark_lamp` becomes `available`. The lamp needs goodwill, not
spare parts: each of the 8 questlines (§3.2) yields an **Ember Light**; 4 embers
plus Marlow's confession are enough. The final scene happens at the tower top,
night only (20:00–24:00), via the lighthouse door interactable.

**Gates to climb:** `embers ≥ 4` **AND** flag `marlow_confession` **AND** hour 20–24.
Everything else is flavour. If `lens_cloth` is held, the polishing line changes;
otherwise you polish the fireglass with your sleeve (epilogue mentions it).

**Branch B1 — "Who keeps the lamp?"** (climb scene, choices:)
- **A · "Light it together."** → flag `lamp_together`. Marlow resumes as keeper,
  you are co-Warden.
- **B · "This one's mine. Rest, old friend."** → flag `lamp_sole`. You keep the
  lamp; Marlow finally sleeps, and starts leaving tea on your step.
- **C · "Let Finn strike the match."** *(visible only if flag `finn_big_one`)* →
  flag `lamp_finn`. Finn, 12, youngest keeper in county records.

**Branch B2 — "The lost boat."** The village myth says Marlow's storm night sank
a boat. Truth: the *Selkies* sheltered in the cove and left a thank-you letter,
now in Rosa's attic shed (interactable, unlocked after quest `garden_show` any
outcome; reading sets `truth_known`). At the confession or climb you may:
- **Tell him the Selkies made port** → flag `truth_told` (his guilt lifts fully).
- **Keep the myth, keep him company** → flag `secret_kept`.

**Endings (≥2, epilogue assembled from flags).** After the lamp is lit, the
screen fades to the **Epilogue**: a title plus paragraphs, each included only if
its flag holds — then "Press E — keep wandering" returns to free play with the
world visibly changed (night beam rotating, festival bunting on the green if
festival ending).

- Ending title **"The Festival of First Light"** — requires `truth_told` AND
  (`lamp_together` OR `lamp_finn`). Full village festival, Marlow laughs on cue.
- Ending title **"The Quiet Keeper"** — otherwise (`secret_kept` or `lamp_sole`).
  A quieter beam; the village draws Marlow out one cup of tea at a time.

Conditional epilogue paragraphs (each 1–2 sentences, flags in brackets):
`honey_to_mira` bread festival line · `honey_to_gideon` greenhouse line ·
`seeds_returned` / `seeds_gifted` · `show_won` moonbell glowing at the tower base
/ `show_patience` · `finn_big_one` mounted fish in the shop / `siltjaw_freed` ·
`parcel_kite` kite on the shop roof / `parcel_lens` cloth framed by the lamp ·
`lamb_quiet` a lamb named Warden / `lamb_led` the new gate · `junie_stays` her
easel by the pier / `junie_leaves` a letter with a city postmark ·
`lamp_together` / `lamp_sole` / `lamp_finn` keeper lines · `lens_cloth` or sleeve.

---

## 5 · Light actions

Player speed 84 px/s. Facing = last move direction. Tools are always carried.

### 5.1 Net (Q)
Q swings a 90° arc, radius 28 px, in the facing direction. Any critter inside the
arc is caught instantly (cozy: no escape once swung) → item added, sparkle
particles + `sfx net`. Critters flee at 60 px/s when the player is within 60 px —
a soft chase the player always wins.

### 5.2 Fishing (F, two-stage timing)
Needs standing within 1.5 tiles of a water tile, facing it.
1. **Stage 1 — the bite.** F casts the bobber (ripple, plop sfx). Wait 2–6 s
   random → bobber dips + "!" + `sfx bite`. Press F within 0.9 s to hook.
2. **Stage 2 — the line.** A timing bar appears (max 2.5 s): a marker oscillates
   at 1.2 Hz across a green band (width 30 % common fish, 18 % rare). Press F
   inside the band → catch. Miss either stage → "It got away…" and the bobber
   comes back. No penalty, no bait economy.

Fish table: `fish_minnow` any water 7–20 · `fish_perch` lake 8–18 ·
`fish_flounder` sea 7–17 · `fish_trout` lake dusk 17–20 · `fish_carp` lake night
20–2 · `fish_moonfish` any water night 21–2 (rare, band 18 %).

### 5.3 Slingshot (mouse aim + click)
Hold nothing, aim with the cursor, click fires a pebble (240 px/s, no gravity,
limit 1 in flight). Pebbles pop **motes** — glowing willow-wisp orbs that drift
near trees and lamp posts (≤12 alive; pop → `mote` item + chime + sparkle burst).
Hitting a tree shakes it: leaf burst, occasionally one idle critter drops out.
Critters are never harmed — a pebble near a critter only startles it.

### 5.4 Interactables & items
Exterior interactables (E within 1.2 tiles, prompt shown): cottage door (Sleep,
18:00+, §11) · lighthouse door (Climb, when gates pass) · Rosa's attic shed (the
letter) · wild hives (honeycomb, after Mira mentions it) · hill trail glint
(seed pouch) · notice board (duplicates quest log) · 5 signs · stone circle ·
pier end · the old cabinet (arcade, beside the player cottage). Interiors do
not exist; the "attic letter" is read at the shed door.

**The old cabinet (Neon Swarm minigame):** a squat arcade cabinet at tile
(31,57), one tile east of the player's cottage door — something Marlow dragged
out of the lighthouse basement years ago. Its screen flickers cyan with a
light that is not the lamp's. Using it freezes the village (state `ARCADE`)
and opens `#arcade-overlay`, an iframe bezel running `../neon-swarm/` with its
own loop, input and `localStorage` — full isolation, zero shared globals. The
`✕ LEAVE` chrome button (or `Esc` when the bezel holds focus) calls
`WGame.closeArcade()`: the frame unloads to `about:blank`, music re-triggers,
and if the run inside reached the DAWN ending (`GameCodex.data.won`, readable
same-origin over http) the flag `arcade_dawn_seen` is set with a toast.

Items (registry `{id, name, desc, kind, tags}`): critters ×10, fish ×6, `mote`,
`food_honeycomb`, `seeds_pouch`, `moonbell`, `lens_cloth`, `wool_cloak`,
`letter`. Inventory is a `{itemKey: count}` map, cap 24 distinct kinds. Critter
table (biome · active hours): butterfly meadow 7–17 · cricket meadow 18–23 ·
oak beetle forest 8–17 · firefly forest 20–2 · luna moth forest 21–2 (rare) ·
dragonfly lake 9–17 · mayfly lake 17–20 · sand crab beach 7–18 · glow worm
beach 20–2 · grasshopper hills 7–17. Rain halves spawns. Alive cap 40, spawn
ring 6–14 tiles from the player in matching biome/hour, despawn beyond 20.

**Gifts.** Talk → "(Give a gift…)" choice (visible if inventory non-empty) →
simple picker listing items with the NPC's reaction preview hidden. The choice
is injected into every NPC-facing node while the pouch holds anything; when it
is the only choice, E still ends the conversation and the gift is given via
its number key, a click, or ↑↓ + E. Resolution:
`WAction.gift(npcId, itemKey)` → hearts per §3, heart particles, result line from
that NPC's voice. Loved gifts can unlock quests: e.g. giving Gideon a luna moth
at any time opens `seeds_of_spring` early; giving Junie motes opens a palette
dialogue node.

---

## 6 · Dialogue engine (data-driven, exact schema)

All nodes live in plain-object registries: `WDialogue.register(nodeMap)` merges
maps (generic + greeting nodes in `dialogue.js`; quest/branch nodes in
`story.js`, registered at boot). Node selection priority for talking to an NPC:
active quest node → friendship unlock node (3♥/6♥) → schedule-flavoured greeting
pool by hour → generic idle line. Choosing repeats the highest applicable node.

```js
// node registry, keyed by id:
{
  "mira_meet": {
    speaker: "mira",                     // NPC id | "you" | "narrator"
    text: "You must be the new Warden! Honey loaf — on the house.",  // ≤120 chars
    setFlag: "met_mira",                 // optional, applied when node ENTERS
    next: null,                          // optional auto-next id; null = close box
    choices: [                           // optional; overrides next when present
      { label: "I'd love one.", next: "mira_meet_2" },
      { label: "Maybe later.", next: null },
      { label: "(Give a gift…)", gift: true, next: "gift_result" },   // opens picker
      { label: "About the lamp…", next: "mira_lamp",
        setFlag: "asked_mira_lamp",
        requires: { flags: ["ember_ready"], friendship: { mira: 3 }, hour: [7, 20] } }
    ]
  }
}
```

`requires` semantics — an object whose **every present key** must pass (AND):

| key | form | passes when |
|---|---|---|
| `flags` | `["a","b"]` | every flag truthy |
| `anyFlags` | `["a","b"]` | at least one truthy |
| `notFlags` | `["a"]` | none present |
| `friendship` | `{ npcId: minHearts }` | each NPC ≥ min |
| `hour` | `[from, to]` | `WU.hnorm(hour)` in range, inclusive, wrap OK (`[20,26]` = 20:00–02:00) |
| `dayMin` | `2` | `day ≥ 2` |
| `weather` | `"rain" \| "clear"` | matches; `"any"`/absent = always |
| `quest` | `{ id, state }` | quest state equals `"locked" \| "available" \| "active" \| "done_a" \| "done_b"` |

Engine rules: node-level `requires` gate entry via `next`/`start` (failed gate →
node is skipped, follow its fallback `failNext` if present, else close);
choice-level `requires` **hide** non-passing choices from the list. Typewriter
40 chars/s; E completes the line, then advances / opens choices (↑↓ + E, Esc
closes politely). Evaluator: `WDialogue.checkRequires(req)` vs live state.

---

## 7 · MANDATORY source contract

`index.html` loads exactly these classic scripts, in this order, at the end of
`<body>` (no `type="module"`, no `async`):

```html
<script src="js/util.js"></script>      <!-- window.WU -->
<script src="js/manifest.js"></script>  <!-- window.WManifest (asset agent owns) -->
<script src="js/assets.js"></script>    <!-- window.WAssets -->
<script src="js/audio.js"></script>     <!-- window.WAudio -->
<script src="js/input.js"></script>     <!-- window.WInput -->
<script src="js/particles.js"></script> <!-- window.WParticles -->
<script src="js/world.js"></script>     <!-- window.WWorld -->
<script src="js/npcs.js"></script>      <!-- window.WNpcs -->
<script src="js/dialogue.js"></script>  <!-- window.WDialogue -->
<script src="js/story.js"></script>     <!-- window.WStory -->
<script src="js/action.js"></script>    <!-- window.WAction -->
<script src="js/hud.js"></script>       <!-- window.WHUD -->
<script src="js/main.js"></script>      <!-- window.WGame -->
```

Layering: `util→input` are leaf libs, never calling game layers; `world…hud` may read leaf
libs and data tables from files above them; `main.js` is the ONLY orchestrator running the
frame loop. Per frame: `WGame.update → WWorld/WNpcs/WStory/WAction/WParticles → draw pass`.

### js/util.js — `window.WU`
Math, time, storage. Pure functions.
`WU.clamp(v,min,max)` · `WU.lerp(a,b,t)` · `WU.dist(ax,ay,bx,by)` ·
`WU.rand(min,max)` · `WU.randInt(min,max)` · `WU.pick(arr)` · `WU.chance(p)` ·
`WU.approach(cur,tgt,step)` · `WU.hnorm(h)` (wrap 0–24) ·
`WU.fmtHour(h)` → `"07:30"` · `WU.easeInOut(t)` ·
`WU.save(key,obj)` / `WU.load(key)` → `obj|null` (localStorage inside try/catch,
JSON parse guarded) · `WU.seed(seed)` → deterministic `()=>float` for map build.

### js/manifest.js — `window.WManifest` (owned by the asset agent)
```js
window.WManifest = { art: { tiles:"assets/art/tiles.png", decor:"assets/art/decor.png",
  chars:"assets/art/chars.png", props:"assets/art/props.png", ui:"assets/art/ui.png" },
  audio: { "music-day":"assets/audio/music-day.mp3", "music-night":"assets/audio/music-night.mp3",
           "music-rain":"assets/audio/music-rain.mp3" } };
```
The asset agent may ship fewer keys; **every consumer must treat any key as
possibly missing** (fallbacks below), including `WManifest` itself being `{}`.

### js/assets.js — `window.WAssets`
Image/Audio preloader, `file://`-safe (plain `Image.src`/`Audio.src`, relative).
`WAssets.load(onProgress)` — iterates manifest, resolves when all settled (an
`onerror` marks the key missing and CONTINUES, never throws). Signatures:
`WAssets.img(key)` → `HTMLImageElement|null` · `WAssets.has(key)` → bool ·
`WAssets.audio(key)` → `Audio|null` (loop=true, preload=auto, never autoplayed) ·
`WAssets.sheet(ctx,key, sx,sy,sw,sh, dx,dy,dw,dh)` — drawImage guarded: if the
key is missing it draws a flat tinted placeholder rect instead (vector
fallback), so the world renders identically-shaped without art.

### js/audio.js — `window.WAudio`
`WAudio.init()` — create `AudioContext` once; called ONLY from the first
keydown/pointerdown handler. `WAudio.playMusic(key)` — crossfade (2 s) between
the three Audio elements; unknown/missing key = keep current, warn once.
`WAudio.sfx(name)` — synthesized WebAudio blips: click, chime, splash, plop,
bite, reel, net, pop, gift, heart, bell, tune (Shepherd's Tune motif).
`WAudio.setMusicVolume(v)` / `WAudio.setSfxVolume(v)` (0–1, persisted in
settings) · `WAudio.update(dt)` — fade ramps · all SFX no-op before `init()`.

### js/input.js — `window.WInput`
`WInput.attach(canvas)` · action map: move WASD/arrows, interact E/Enter,
net Q, fish F, pause Esc/P, up/down/left/right for menus.
`WInput.axis()` → `{x,y}` · `WInput.down(action)` → bool ·
`WInput.pressed(action)` → edge-true for one frame · `WInput.mouse` →
`{x,y,inside,clicked,released}` in CSS-pixel canvas space ·
`WInput.endFrame()` — clears edges; main calls it last in every frame.
Prevent default on arrows/space; ignore input when document hidden.

### js/particles.js — `window.WParticles`
Single pooled array, hard cap **400**. `WParticles.emit(type,x,y,opts)` — types:
`rain, ripple, splash, firefly, leaf, mote, sparkle, heart, dust`.
`WParticles.setRain(intensity)` — self-budgets ≤300 rain streaks while >0;
drops over water tiles convert to ripples on death.
`WParticles.update(dt, world)` · `WParticles.draw(ctx, cam)` ·
`WParticles.clear()` (scene/weather changes).

### js/world.js — `window.WWorld`
`WWorld.TILE=32 · W=128 · H=96`. `WWorld.build()` — deterministic (WU.seed)
generation of: biome field, water ellipse, trails, prop placement, collision
grid, POI table `WWorld.poi = { name:{x,y}, … }` (pixel, e.g. `green_well`,
`bakery_door`, `pier_end`, `pasture_1..4`, `lighthouse_base`, `tor`),
`WWorld.vistas` (§2), `WWorld.interactables` `[{id,x,y,w,h,label,requires?,onUse(game)}]`,
`WWorld.torches [{x,y}]`. Queries: `WWorld.biomeAt(tx,ty)`, `WWorld.solidAt(px,py)`,
`WWorld.waterAt(px,py)`, `WWorld.weatherRoll(day)`.
Draw: `WWorld.drawBack(ctx,cam,env)` — sky band + **parallax hill silhouettes**
(2 layers, offset `cam.x*0.35 / cam.y*0.2`) + ground tiles **culled to viewport**
+ water (4-frame sine cycle) + props. `WWorld.drawOver(ctx,cam,env)` — canopy
shadows, **cloud shadows** (3 drifting alpha-0.08 ellipses), water rim glints.
`WWorld.hourTint(hour)` → keyframe table §2 (returns composite ops + rgba).
`WWorld.drawLights(ctx,cam,env)` — night: radial-gradient glow (additive)
radius 140 at the player, 200 at each torch/lamp; lighthouse beam cone rotating
only when `WStory.lampLit`.

### js/npcs.js — `window.WNpcs`
`WNpcs.DEFS` — the 8 defs (§3.1) in this exact shape:
```js
{ id:"mira", name:"Mira Thistle", role:"baker", homePoi:"bakery_door", spriteRow:1,
  voice:"mira", speed:42,
  schedule:[ {from:5, to:7.5, poi:"bakery_counter"}, {from:7.5, to:11, poi:"bakery_counter"},
             {from:11, to:13, poi:"green_well"}, /* …rest */ ],
  rainPoi:"bakery_counter",                    // rain shelter override 9–17
  loved:["critter_butterfly","food_honeycomb"], liked:["fish_moonfish","mote"],
  disliked:["critter_cricket"],
  unlock3:"mira_3hearts", unlock6:"mira_6hearts",          // dialogue node ids
  greetings:{ morning:"mira_am", day:"mira_day", evening:"mira_pm" } }
```
`WNpcs.init()` · `WNpcs.update(dt, env)` — schedule → target POI; axis-first
walk with solid-avoid; rain override; idle bob. `WNpcs.draw(ctx,cam,env)` —
sprites + speech bubbles; `WNpcs.nearestTo(px,py,r)` → npc|null (E prompt);
`WNpcs.friend(id)` / `WNpcs.addFriend(id, amt)` (toast + hearts);
`WNpcs.ambient(dt, env)` — the 8 pair defs (§3.3) `{id,a,b,poi,hour,requires,
lines:[{sp,text}]}` with bubbles + overheard panel + cooldown.

### js/dialogue.js — `window.WDialogue`
Engine per §6. `WDialogue.register(map)` · `WDialogue.start(nodeId)` ·
`WDialogue.active()` → bool · `WDialogue.update(dt)` (typewriter) ·
`WDialogue.advance()` / `WDialogue.choose(i)` / `WDialogue.visibleChoices()` ·
`WDialogue.checkRequires(req)` · `WDialogue.draw(ctx)` — box, name plate,
typed text, choices, friendship pips. Registry includes generic nodes: greetings
per NPC per daypart, `gift_result`, `sleep_offer`, vista first-visit lines.

### js/story.js — `window.WStory`
`WStory.flags` (persisted) · `WStory.setFlag(k,v)` / `WStory.flag(k)` ·
`WStory.QUESTS` — defs in this shape:
```js
{ id:"honey_loaf", npc:"mira", title:"The Honey Loaf",
  hint:"Wild honeycomb ripens in the north hives.", embers:1, state:"locked",
  outcomes:{ a:{flag:"honey_to_mira", label:"Village loaf"},
             b:{flag:"honey_to_gideon", label:"Greenhouse bloom"} } }
```
`WStory.update(env)` — drives quest states from flags, awards Ember Lights
(toast "An Ember Light joins yours."), advances `the_dark_lamp` ·
`WStory.embers()` · `WStory.canClimb(env)` → bool (§4 gates) ·
`WStory.climb(choice)` — applies B1 branch, sets `lampLit` + festival flag ·
`WStory.truth(choice)` — applies B2 · `WStory.epilogueLines()` →
`[{text}]` evaluated from the flag pool (§4) · registers quest/branch dialogue
nodes via `WDialogue.register` at boot · `WStory.reset()` for New Game.

### js/action.js — `window.WAction`
`WAction.inventory` map + `WAction.add(itemKey,n)` / `count(k)` / `remove(k,n)` ·
`WAction.update(dt, player, env)` — critter spawn/despawn (≤40), mote field
(≤12), fishing FSM `idle→cast→wait→bite→reel→(catch|flee)`, projectile ·
`WAction.tryNet(player)`, `WAction.tryFish(player, world)`,
`WAction.trySling(tx,ty)` · `WAction.gift(npcId, itemKey)` → result line +
hearts (§5; once-per-day full effect via flag `gift_<npc>_<day>`) ·
`WAction.drawUnder/drawOver(ctx,cam,player)` — bobber, aim line, critters,
motes, net arc, "!" bite marker, timing bar.

### js/hud.js — `WHUD`
`WHUD.toast(text, ms)` (queue, ≤3, bottom-centre) · `WHUD.prompt(text, x, y,
cam)` — floating "E — Talk to Mira" over the nearest target · `WHUD.draw(ctx,
env, state)` — clock chip (Day · hh:mm · weather glyph), quest panel (≤3 active:
title + hint), tool hint chips (Q net · F rod · mouse sling), hearts in the
dialogue box. Screens: `WHUD.drawTitle(sel, hasSave)`, `WHUD.drawPause`,
`WHUD.drawSettings(musicVol, sfxVol)`, `WHUD.drawVista(vista, t)` (letterbox +
caption), `WHUD.drawEpilogue(paragraphs, scrollT)`. All menu hit-testing via
`WInput` (keyboard ↑↓/E + mouse); every string ≤120 chars.

### js/main.js — `WGame`
`WGame.boot()` on DOMContentLoaded: canvas setup, `WInput.attach`,
`WAssets.load` → title. State machine: `TITLE, PLAY, DIALOGUE, VISTA, PAUSE,
SETTINGS, EPILOGUE`. Frame loop (rAF): `dt = WU.clamp((t-last)/1000, 0, 0.05)`;
per-state update; draw order `WWorld.drawBack → WAction.drawUnder → WNpcs +
player (y-sorted) → WAction.drawOver → WWorld.drawOver → WParticles →
WWorld.drawLights → hour tint → WHUD → WDialogue`; then `WInput.endFrame()`.
Camera: follow player, world-clamped, `zoomCur` lerps to `zoomTgt`
(1.0 play / 0.45 vista). DPR handling: `canvas.width = cssW*dpr`,
`ctx.setTransform(dpr,0,0,dpr,0,0)`, `imageSmoothingEnabled=false`.
First gesture → `WAudio.init()`. `visibilitychange`/blur → auto-PAUSE.
Owns `WGame.env = {day, hour, weather, night}` (hour advances `dt/20`),
player object, save/load (§11), music director (day/night/rain key by env).

---

## 8 · Assets — fixed keys & sheet layouts

`WManifest.art` keys are exactly: **`tiles, decor, chars, props, ui`** →
`assets/art/<key>.png`. `WManifest.audio` keys exactly:
**`music-day, music-night, music-rain`** → `assets/audio/<key>.mp3`
(seamless loops). Any missing key/asset = silent vector/audio fallback, no
crash (§7 assets.js/audio.js).

Sprite grid is 32 px; character frames 32×48. Anchor: bottom-centre, feet at
frame bottom. Sheets:

| sheet | layout |
|---|---|
| `tiles.png` | 8×4 grid of 32px cells — r0: grass×4, grass_flower, path×3 · r1: water×4 (anim frames), water_edge, sand×2, stone · r2: stone2, cliff×2, forest_floor×2, bridge_h, bridge_v, trail_dirt · r3: hill_grass, hill_rock, terrace_edge, sea_foam |
| `decor.png` | multi-cell props, anchor bottom-centre — willow_big 3×4 cells, willow_small 2×3, pine 2×3, bush 1×1, reeds 1×2, rock 1×1, flowers 1×1 |
| `chars.png` | 9 rows × 12 cols — row 0 = player (teal coat, red scarf), rows 1–8 = NPCs in §3.1 order; per row: 4 directions (down,left,right,up) × 3 walk frames, frame 32×48 |
| `props.png` | house_bakery 4×3, shop 4×3, cottage_a/b/c 3×3 each, well 2×2, notice_board 2×2, tent 2×2, lighthouse 3×6, greenhouse 4×3, hut 3×2, bench, torch, lamp_post, sign, fence_h/v, pier_plank, boat, hive, sheep ×3 frames, gate, hay, windmill_ruin 3×4 |
| `ui.png` | 9-slice panel, heart full/empty (16px), icons 16px: net, rod, sling, clock, sun, rain, moon, E-prompt chip · item icons 16px: honeycomb, seeds, moonbell, cloth, letter, cloak, kite, mote · critter minis 16px ×10 · fish minis ×6 |

The art agent may improve contents but MUST keep these keys, cell sizes and
frame counts — `world.js/npcs.js/hud.js` index by the coordinates implied here.

---

## 9 · `file://` technical experience (binding rules)

1. **No `fetch()`, no XHR, no ES modules, no dynamic `import()`.** All data
   (dialogue, quests, schedules, map tables) lives as `js/*.js` scripts
   attaching to `window.*` globals — `file://` blocks CORS/fetch, never `<script>`.
2. Images load via `new Image()` with **relative** paths from `WManifest`; music
   via `Audio` elements with relative `src` and `loop=true`. No CDN, no fonts
   fetched at runtime (HUD text = canvas `font` with system stacks).
3. **No `getImageData`** anywhere a remote/local image has been drawn (taints
   the canvas); all lighting/grade effects use gradients + composite ops.
4. `localStorage` only through `WU.save/WU.load` (try/catch; file:// may block
   storage — game must run fine with saving disabled, Continue hidden).
5. `AudioContext` created only after the first user gesture; all SFX no-op
   before that. Audio elements are never autoplayed.
6. One `requestAnimationFrame` loop; `dt` clamped to ≤50 ms (tab-back spikes);
   game logic is dt-scaled, never frame-counted.
7. DPR-aware canvas sizing with `setTransform`; world rendered at logical CSS
   pixels, `imageSmoothingEnabled=false` for crisp pixel art.
8. Auto-pause on `blur`/`visibilitychange` (state PLAY → PAUSE); on return, no
   time is simulated for the gap.
9. No console errors on a clean run with zero assets present — the game must be
   playable (flat-colour world, silent) with an empty `assets/` folder.

---

## 10 · Screens

| Screen | Enter via | Contents | Exit via |
|---|---|---|---|
| **Title** | boot | animated meadow backdrop (world render at dusk grade), logo, **New Game / Continue** (dimmed if no save) **/ Settings** | E/click |
| **Playing** | title/epilogue/dialogue-close | HUD: clock chip, quest log, toasts, E prompt, tool chips; ambient bubbles; vista triggers | Esc → Pause |
| **Dialogue** | E near NPC / interactable | §6 box + choices; world continues animating behind, NPCs pause | Esc politely closes |
| **Vista** | enter vista radius | zoom-out 0.45, letterbox vignette, caption; camera still drifts slightly | any move key |
| **Pause** | Esc/P | Resume / Save / Settings / Quit to Title ("progress saves when you sleep too") | Esc |
| **Settings** | title/pause | Music 0–10, SFX 0–10 (←→ adjust, live-preview blip) | Esc back |
| **Epilogue** | lamp-lit cutscene end | scroll of assembled paragraphs (§4), then free play; world keeps the new state (beam, bunting) | E — keep wandering |

Controls recap: move WASD/arrows · E interact/talk/confirm · Q net · F fishing ·
mouse aim+click slingshot · Esc/P pause · ↑↓ menu · mouse click menus.

---

## 11 · Save

One slot, key `"willowmere_save"`, via `WU.save/load` (§9.4). Written by:
**sleeping in your bed** (cottage door interactable, offered 18:00+; fades out,
next morning 06:30, weather rolled per §2 — Day 2 forced rain) and the
**Save** button in Pause. `Continue` on the title reads the slot.

```js
{ v:1, day:2, hour:6.5, weather:"clear",
  player:{x:512, y:1500, dir:"down"},
  flags:{ met_hana:true, honey_to_mira:true },
  quests:{ honey_loaf:"done_a", seeds_of_spring:"active" },
  friend:{ mira:4.5, gideon:1 },
  inv:{ critter_butterfly:2, mote:5 },
  giftsToday:{ mira:2 },        // day-stamp of last full gift per npc
  lampLit:false, vistas:{ willow_overlook:true } }
```

On load: rebuild world deterministically (`WWorld.build()` is seed-fixed), apply
flags/quests/friendship/inventory, place player, resume. Corrupt/absent slot →
Continue hidden, no error.

---

## 12 · Performance caps

| Cap | Value | Enforced in |
|---|---|---|
| Critters alive | ≤ 40 | `WAction.update` |
| Motes alive | ≤ 12 | `WAction.update` |
| Particles | ≤ 400 total (rain ≤ 300) | `WParticles` pool |
| Tile draw | viewport only | `WWorld.drawBack` cull rect |
| Static ground | one offscreen cache, blit per frame; animated water on top; ~4.0 M px² memory gate, bigger views (vista zoom-out, 4K) draw tile-by-tile | `WWorld.drawTiles` |
| Night glows | pre-baked radial sprites (torch/lantern, moonbell, moon, beam wedge) — no `createRadialGradient` per frame | `WWorld.drawLights` |
| Dialogue line | ≤ 120 chars; bubble ≤ 60 | data + `WHUD` clamp |
| Toasts | ≤ 3 | `WHUD.toast` |
| NPCs | 8 (+3 sheep props) | `WNpcs.DEFS` |
| NPC pathfinding | ≤ 2 BFS runs per frame; waypoints thinned ×2 | `WNpcs.update` |
| Audio elements | 3 music (crossfaded) | `WAudio` |

Target 60 fps on integrated graphics; plain `drawImage`/`fillRect`/gradients only, no per-frame allocations in hot loops.

---

## 13 · Mandatory landscape checklist

Each item is a hard requirement, with its owning call site:

| Requirement | Where |
|---|---|
| Distant-hill parallax | `WWorld.drawBack` — 2 silhouette layers, offset `cam.x*0.35`, `cam.y*0.2` |
| Animated water | tiles `water_0..3` cycled on a sine clock + pier/sea foam row in `drawBack` |
| Night light: player + torches | `WWorld.drawLights` — additive pre-baked glow sprites r140 player / r200 torch & lamp posts (flicker = alpha); lighthouse beam wedge sprite when `lampLit` |
| Fireflies | `firefly` particles, forest & meadow, hour 20–2, sine blink |
| Falling leaves | `leaf` particles in forest band, wind drift; tree-shake bursts from slingshot |
| Rain | `setRain` streaks + ripples on water + `music-rain` + sand glints (§2) |
| Moving cloud shadows | `WWorld.drawOver` — 3 ellipses, alpha .08, drifting on a slow loop |
| Colour-grade by hour | `WWorld.hourTint` keyframes (§2) composited full-canvas after lights |

---

*Every feature above is implementable as-is; nothing here is a stub, and no feature may ship as one.*
