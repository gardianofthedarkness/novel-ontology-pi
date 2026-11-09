# Milestones: borrowing and spawning by type

The design: [borrow-and-spawn.md](borrow-and-spawn.md). The goal for 2026-11-02 (the user's): start at the city level,
run it, look, fix and run it again, then the next level, until it is clear whether the logic works down to buildings.

**The loop at every level:** run the level alone (`--from <level>` keeps the levels above it and drops the ones below),
look at it in World · Live, check the level's numbers below, fix, run that level again. Stand-in answers first (no paid
call); a real Jev run only when the user asks.

| | Milestone | Status |
| --- | --- | --- |
| M0 | Design, draft configurations, configuration test | done 2026-11-01, every decision taken (design §7) |
| M1 | Slots, borrowing and spawning in code; the bound tested; run from a level | done 2026-11-01: `--spawn`, `--from`; stand-in on vol 1 through streets |
| M2 | City level on vol 1, as one city of manifolds with a topology | done 2026-11-01: stand-in and Jev runs (2 paid calls) |
| M3 | District level on vol 1 | done 2026-11-01: stand-in and Jev runs (6 paid calls) |
| M4 | Street level on vol 1 | done 2026-11-01: stand-in and Jev runs (47 paid calls); sharing to decide |
| M5 | Building level on vol 1 | |
| M6 | Growth across books | |
| M7 | A real run; pools removed | |
| M8 | One settings registry: every knob in a schema, layered universe < book < place, `novel settings`, fill operators | M8a–c done 2026-11-09 (72 keys, 8 tables; commands; fill operators; rehearsal identical); M8d handles for anything + profiles begun 2026-11-09 |
| M9 | With the simulation: shared slots split where they are damaged | with the simulation stage |
| M10 | Models as code: nominate, brief, write or put, check; the warehouse (CC0 packs, our models, gkNextEngine's MIT kits) | built 2026-11-09 (23 of 23 pass; Pi skill); M10g–i the warehouse registry, its supply and its connections begun 2026-11-09; Codex/Claude Code left |
| M11 | Landmark shells: named, described buildings as code, their footprint and height in the fill | built 2026-11-09 (2 in volume 1; height into the lot, footprint the lot's) |
| M12 | People with bodies: a 7-bone standard, shared clips, parts by slot from the sheets | after M11 |
| M13 | All SCAD: quantised page meshes, vehicles and furniture from the kits, a building kit of our own, the baked packs retired, every remaining baked choice a layered setting (design §9) | items M13a–g listed 2026-11-09; M13g begun |
| W15 | A paid volume 1 run with M8, M10 and M11 in, against W14 | done 2026-11-09 (about $0.34 with the models and a crashed attempt) |

## M0 — Design and configuration

- [x] Design with the objective and its guards: `docs/v2/borrow-and-spawn.md`
- [x] Draft configurations: `config/terrain/city.json`, `district.json`, `street.json` (street densities read off today's landscapes)
- [x] `test/spawning-config.test.ts`: every kind one Jev can answer at its level, every use one the world knows
- [x] Decided: spares built and shown, a pinned slot visible to Jev (3); cross-parent ties at 0.3 (4); JSON, layered later (5)
- [x] Decided: damage by option A, terrain a book at once, the simulation splits damaged shares (1, §2.8); a new name spawns when its type's slots are all named, and a nominated place is permanent (2, §2.4, §4.5); unnamed shares and damage cleared for the next book (§4.5)

## M1 — Slots, borrowing and spawning in code (no model call)

- [x] Load the configurations through a resolver (defaults only for now; the seam for M8); spawn a parent's slots (a range picked once by a seed, kept): `src/v2/terrain/config.ts`
- [x] The rules (`admissible` in `src/v2/terrain/slots.ts`): a name takes a slot of its own; an unnamed mention shares, never with a mention of its own scene; spawn only as §2.4 allows; a place whose holder is higher up borrows under that holder (§2.5)
- [x] The level's choice energy: travel (cross-parent ties at 0.3) and pins, an unplaced slot costed where the engine would place it
- [ ] Positions: today's settle with the spare term γ at a level's end: moved to M3
- [x] Greedy in narrative order, then moves (a name to a better free slot, two names exchanging, an unnamed mention to a better share): `chooseSlots`
- [x] One mention at a time for the engine's step mode (`improve: false`, the level's earlier parts as fixed places), the moves when the level ends (`assigned`)
- [x] Slots in the universe's registry (`universe/terrain.json` `slots`), mirrored in the book's `terrain.json`: type, owner name, sharers by book and scene, damage, the configuration layer, kept offset, size; a slot no name owns kept as a site of its own (`by: "slot"`, `spare`)
- [x] The slot tree (`src/v2/terrain/tree.ts`): no pools; spare and shared slots as places; names and shares under their slots; read alike by terrain spawning and the export
- [x] World · Live: a spare slot has no pin, its name grey and only on the ground
- [x] `novel sim terrain <dir> --spawn [--from city|district|street]`, beside today's path until M7 (`world-engine/terrain/terrain-spawn.mjs`: each level ends with the moves, its spares placed, its areas' children spawned)
- [x] Tests (`test/spawning-slots.test.ts`): the bound (§3) over 20 synthetic books (240 unnamed mentions: 14 districts, flat once names stop), names exclusive and permanent across books, same-scene unnamed apart, unnamed shares and damage cleared at a new book, the same order gives the same world

**Pass:** tests green; today's terrain path unchanged (its tests and a stand-in run as before).

**Result (2026-11-01, stand-in answers, vol 1):**
- Today's path: a full stand-in run keeps the same 28 places, field for field, as before the change.
- Spawn mode, through streets: 2 cities spawned 12 district slots. The stand-in types every district a CBD, so 学园都市's
  three named districts took its two CBD slots and spawned a third; 10 spares placed. Those 13 districts spawned 76 street
  slots. The 18 unnamed streets used 10 of them: one shared by five mentions (the four 大道 and an underground passage), one
  by three, two by two. The street level's end made 2 moves (travel 421,236 → 413,848 tie·m) and placed 65 spare streets.
- `--from street` ran the streets again and nothing above them.
- A fix on the way: an area's extent is its size round its own node (a box kept in an earlier frame put spare streets 2.4 km
  out of 600 m districts); after it, the largest street offset is 413 m, 2 of 77 just past their district's edge.
- Seen in the world: spare streets stand apart from their district's built ground (the canvas takes a kept offset only as a
  direction), and 76 street areas make a world build 30–100 s instead of about 20 s.

## M2 — City level, as one city of manifolds

The user's direction before M2 (2026-11-01; design §8): M1's spare districts and streets stood apart from their city. A
city is one ground of manifolds that fade into each other, laid out by a topology (where each kind sits from the centre,
which kinds sit near or apart); a district is a centre of function on it. M1's tune is folded in: the layout by topology
replaces "placed by the first borrower"; districts as patches of the city's ground replace "areas at exact offsets".

- [x] Topology in `config/terrain/city.json`: each city kind's rings and pairs (§8.2), checked by the configuration test
- [x] At the city level's end, each city's district manifolds spawned where the city's energy is least (topology, pairs,
      pressure of the fading functions), each kept with its kind, centre, size and seed: the city's map, in the registry
- [x] The export builds a spawn-mode city's districts as patches of the city's own ground, not areas cut out of it; a spare
      one named grey at its centre, no pin
- [x] World · Live's step list: each manifold's kind, its ring and its energy terms
- [x] The map's log by book (§8.8, the user): every spawn, move, height change and borrowing in order, for replaying a book
- [x] The map's parenting (design §8.5): each manifold a vector from its parent's centre, in the parent's frame; only the
      city placed by the canvas, everything under it summed down the chain
- [x] Heights as averages, unified at spawn (§8.6): a spare district's height is what keeps the city's average, within its
      kind's range; where the range cannot hold it, the city's average moves (replaces the earlier tune's "lower third")

**Pass:** 学园都市 and 纽约, both metropolises: each one blended city of 6 district manifolds, no gap or hole between them;
the CBDs within 0.3 of the city's radius, industry beyond 0.7; the energy terms logged. A stand-in run of the city level
(`--spawn --from city`), then Jev (four calls) when the user asks, looked at in World · Live.

Decided (design §8.7): later books may squeeze and re-unify earlier ones; rings as shares of the radius; heights unified
within the deformation limit (a higher part lowers only the highest non-nominated and damaged parts, only so far).

Moved to later levels: below and above the street apart, and a share asked its kind only (M4, streets).

**Result (2026-11-01, stand-in answers, `--spawn --until city`):** `src/v2/terrain/topology.ts` (the layout),
`heights.ts` (unification within the deformation limit), `averageOverMedian` in the landscape engine, the map log at
`universe/maps/<book>.json`.
- Each metropolis: 6 district manifolds, radius 991 m; CBDs at 0.24 and 0.30 of the radius, dwelling areas 0.46–0.64,
  industry 0.84; the pressure of overlapping edges 9.3 → 0.06 after the moves.
- Heights held the city's average (20.4 m): CBDs 75.8 m, dwelling 8.4 m, industry 6.1 m, the open ground 8.2 m. Built:
  CBDs 83–91 m, dwelling about 9.5 m, industry 7.6 m, open ground 11.1 m (raised where the CBDs fade into it); the whole
  city 19.7 m.
- Seen: one city each, the CBD towers in the middle fading out into low ground, no gap or hole.
- Fixed on the way: the open ground (one patch over the whole city, older than the districts) flattened the CBDs to 10 m,
  since a lot draws its height from older ground that reaches it; the manifolds now come first, the tallest first, and the
  open ground is flat, of its own landscape (`open` in the configuration: a metropolis's is commercial).
- Not yet: the named districts (第七学区 and the others) still stand as pins beside the city until the district level
  borrows manifolds for them (M3).

**Jev run (2026-11-01, the host, `novel sim terrain --spawn --from city --until city --run`; run 11 backed up first):**
Jev: 学园都市 a metropolis (57%), median 10 m; 纽约 a metropolis (98%), median 15 m (2 paid calls, 14,324 input tokens;
纽约's answers from the cache). 学园都市's average 13.6 m holds with its CBDs at 38.7 m (inside a CBD's range, which starts
at 36.3 m) and builds them at 43–47 m; 纽约's CBDs at 75.8 m build at 83–89 m; dwelling areas 8.7–10 m, industry 6.4–6.9 m.
Two compatibility faults found and fixed: `novel sim terrain` refused `--spawn`, `--from` and `--until` (its list of flags
had not been given them; the stand-ins had called the engine directly); and the first world of a `--from` run was built
from the terrain file before the dropped levels were saved, so Jev's first city picture showed run 11's districts and pools.

**Again with a born city and heights as additions (2026-11-01, the user's calls; 4 paid calls, 27,478 input tokens):** each
city is born a basic city (5 districts at the standard height) before Jev is asked, and the height is asked as the kind's
standard plus an addition. Jev: 学园都市 a metropolis (58%), +26 m (21% sure), an average of 34 m; 纽约 a metropolis
(83%), +47 m (26% sure), 55 m. Before, with absolute medians on an empty map: 13.6 m and 20.4 m. Both cities deformed as
designed (a second CBD added, all laid out again, the CBDs alike at 128 and 140 m). Not yet clear whether Jev reads the
addition or the picture: the heights picture looks at the city's middle, which in a born city is its CBD, so it sees
towers; and 纽约's open ground had to rise to 50 m to hold 55 m with only two CBDs. To try: the same pictures asked both
ways (absolute and as an addition); the heights picture across the whole city for a city's average; more CBDs for a
taller city (the configuration by height).

**The height probe (2026-11-01, the user's two experiments; `--probe-heights`, 6 paid calls, 59,682 input tokens):** the
born cities asked four ways each, absolute averages or additions to the standard, on the picture at the middle (the CBD)
or on three across the city (the middle, a dwelling district halfway out, one near the edge). Jev's answer and its three
likeliest slices:

| City | Wording | Picture | Answer | Likeliest |
| --- | --- | --- | --- | --- |
| 学园都市 | absolute | middle | H, 34 m | H 60%, G 23%, I 10% |
| 学园都市 | absolute | across | H, 34 m | H 36%, G 35%, F 16% |
| 学园都市 | addition | middle | H, +26 m | H 29%, I 21%, G 19% |
| 学园都市 | addition | across | E, +0 m | E 28%, F 26%, H 20% |
| 纽约 | absolute | middle | H, 34 m | H 51%, G 25%, I 11% |
| 纽约 | absolute | across | H, 34 m | H 37%, G 30%, F 17% |
| 纽约 | addition | middle | I, +47 m | I 33%, H 23%, J 18% |
| 纽约 | addition | across | I, +47 m | I 33%, J 26%, H 24% |

- **The wording:** Jev reads absolute averages surely and alike for both pictures (H, 51–60% at the middle); as
  additions it is unsure (28–33% at best) and inconsistent: 纽约 moves up to +47 m, 学园都市 swings from +26 m to +0 m
  between the pictures. It does not read the addition reliably; the absolute height is the better question.
- **The picture:** with absolute heights, the three pictures across the city shift the answer down toward G (20 m) and
  make Jev less sure, as they should: a city's average includes its low districts. The middle alone (a CBD) leans high.
- **Proposed:** ask absolute averages, the standard kept only as the lowest slice; for a city (or any area whose middle is
  not like the rest), the heights pictures across it.

**Built (the user's call, "per area type minimum hard gate"; 2026-11-01, 3 paid calls, 32,421 input tokens):** absolute
averages from each kind's minimum up, nothing below it, no slice under the street for a city or a district; a city shown
its middle, a district halfway out and one near its edge. Jev: 学园都市 C, an average of 20 m (C 42%, D 31%, B 22%); 纽约 C,
20 m (C 43%, D 35%, B 15%): the two cities alike, between the probe's G and H. Each deformed to it: the CBDs at 73.4 m,
dwelling areas 8.4 m, industry 6.1 m, the open ground 8.2 m.

## M3 — District level

- [x] 第七学区, 第六学区, 第十五学区 borrow (vol 1 has no unnamed district); the moves at the level's end
- [x] Spare districts with their type's default terrain, unified with the city (M2)
- [x] A named district is a manifold of its city: the canvas embeds it exactly at its kept vector inside the city's ground
      (never pushed, no ground of its own); its ground a patch of the city's
- [x] Borrowing by the characters' travel alone: ties lifted to the level, kept positions only, no pin
- [x] A named district decided: its height stands, the city unifies to it within the deformation limit; a district spawned
      beyond the configuration laid out with the rest
- [ ] Settling with the spare term γ: not needed so far (the topology's layout and the moves hold the districts apart)

**Pass:** no spawn on vol 1 (3 names within the quotas); every district inside its city; the characters' travel (tie·m)
logged before and after the swaps and the settle, and no worse than run 11's at this level; the largest kept offset
under the city's size.

**Jev run (2026-11-01, `--spawn --from district --until district --run`; 6 paid calls, 40,348 input tokens):**
- 第七学区 a dwelling area (74%), 19 m on average (C, 51%), on a dwelling manifold 512 m out (0.52 of the radius);
  第六学区 a CBD (52%, dwelling 34%), 61 m (B, 39%), 156 m out; 第十五学区 a CBD (94%), 61 m (B, 38%), 316 m out. No spawn:
  Jev's kinds fit the metropolis's configuration; no move at the level's end (the travel was least as borrowed).
- 学园都市 kept its 20 m average: after 第七学区, taller than a dwelling area's default, a spare CBD was lowered by the
  deformation limit (73.4 → 62.7 m); after the two lower CBDs the rest rose a little (dwelling 10.2 m, industry 7.9 m).
- Built: 第六学区 and 第十五学区 66.7 m, 第七学区 19.9 m, the spares 10.5–11.4 m, the open ground 13 m; the city 17.6 m against
  its 20 m. Each district stands exactly at its kept vector inside the city; seen as one city, the towers in its middle.
- Not yet: the travel before and after has no comparison with run 11 (run 11 did not lift ties to the level; at this level
  it had none). The unnamed streets still stand as markers until the street level (M4).

## M4 — Street level

- [x] Every district, spare ones too, spawns its street slots by `district.json`
- [x] Vol 1's street mentions (18, all unnamed now that pools are gone) borrow; unnamed ones share across scenes; streets
      held only by a city borrow among all its districts' slots
- [x] Every placed manifold an embedded place, its ground a patch of the city's at the sum of the vectors down its chain
- [x] Ties to a place above the level count as the distance to its area (nothing inside it)

**Pass:** street areas within the bound; how many avenues the four 大道 became, and why; streets on their forms as
today; tie·m against run 11's; every street inside its district.

**Stand-in (2026-11-01):** the 18 streets on 9 slots; 2 moves at the level's end (travel 10,358 → 9,100 tie·m); 68 spares;
builds about 30 s. Two faults found and fixed on the way: a street placed inside a district took that district for an
obstacle and fell back to its centre (five stacked on one point, one build of 738 s); and `--from` kept slots placed by
borrowing (only a parent's topology layout should be kept).

**Jev run (2026-11-01, `--spawn --from street --until street --run`; 47 paid calls, 320,161 input tokens):**
- 13 streets borrowed 6 slots: the four 大道 (scenes 12, 26, 28, 34) with 柏油马路 and 整条街道 became **one avenue** in
  第六学区 (a CBD); 广场 26 and 34 one square in 第六学区; 十字路口 and 人行步道 one square in 第十五学区; 站前广场 a station
  in a spare dwelling district; 小巷 an alley in 第七学区; 大桥 a waterfront in 第六学区, spawned (no district of 学园都市
  has one in its configuration). The other 5 (地下通道 a cut, 6 m down; 平台, 停机坪, 飞机跑道, 空中庭院 platforms) Jev
  boxed as shapes, outside the slots, as before. 65 spares placed; 3 of 71 street slots a little past their district's
  edge; no move at the level's end.
- The calls (47): a kind question for every street (18, 158,155 input tokens, about 8,800 a call: two pictures and up to
  15 sentences), a height question for every street (18, 84,995), and a box for each of the 5 shapes (11, 77,011: three of
  them boxed again twice when their first box lay over places they may not cover). Since: a later sharer's height
  reshapes its shared street instead of being dropped (the user's call; design §8.10).
- Seen: one city, its districts' and streets' names inside it.
- Seen by the user after the run: spare avenues in industrial districts, and platforms at 100 m over dwelling areas.
  Tuned (design §8.10): `only` in district.json (an avenue and a commercial centre only in a CBD; an industrial district
  spawns two alleys, no avenue); a raised platform moves among buildings that reach its height. Stand-in from the
  district level: no avenue or centre outside a CBD. Not yet run with Jev (the platforms are Jev's shapes).
- To decide: sharing has no limit, so six mentions of one kind piled onto one avenue (the risk of design §4.4: sharing
  makes travel free); Jev put the alley 12 m under the street (the gate allows the street level under the street); a shared
  street takes its first sharer's height (35 m here, though two sharers said 20 m); a district does not unify to its streets
  (only a city has its open ground kept).

**Jev rerun with the tunings (2026-11-01, `--spawn --from district --until street --run`; 51 paid calls, 346,454 input
tokens; questions: 21 kind, 21 height, 9 box):**
- Districts: 第七学区 a dwelling area (average 19 m), 第六学区 a CBD (97 m), 第十五学区 a CBD (61 m); 学园都市 unified to
  22.8 m.
- No avenue or centre slot outside a CBD. The four 大道 with 整条街道 now one avenue in 第十五学区, 柏油马路 and 大道 12
  one in 第六学区; 广场 26, 广场 34 and 十字路口 one square in 第六学区; 站前广场 and 人行步道 a station in a spare dwelling
  district; 小巷 an alley in 第七学区; 大桥 a waterfront spawned in 第十五学区.
- Platforms moved among buildings that reach them: 平台 (6 m) and 停机坪 (25 m) into 第七学区 (its buildings reach 32 m),
  飞机跑道 (100 m) into 第十五学区 (160 m), 空中庭院 (25 m) into 第六学区 (256 m). 地下通道 (a cut) stays in a spare
  industrial district.
- Shared streets reshaped by later sharers: the square 16 → 13.6 m (广场 26 said 11 m); the avenue 41 → 34.9 → 29.7 m
  (整条街道 and 大道 28 said 23 m), each lowering at most 15%.
- Two moves at the level's end (大道 34 to 第十五学区's avenue, 广场 34 to 第六学区's square): travel 9,658 → 8,496 tie·m.
- Seen by the user: the buildings do not look like a modern living area. The causes: an industrial hall is drawn as the
  fantasy kit's market stall; a house as a small office (office-c); and a city's open ground (`open` in city.json) is
  the commercial landscape, so the ground between districts is shops. Next, before M5: a new building model kit (models
  found online for the modern configurations, and how a building is assigned one).

## Model kit (before M5)

- [x] Free modern models found on the web, CC0 only (the repository and its pages are public): Kenney's City Kit
      (Suburban) and City Kit (Industrial), Quaternius's Downtown City MegaKit; baked with KayKit's blocks not used before
- [x] One table, `config/models.json`, for the fill, the engine's lots and shells, and named buildings: each use's models
      with the floors each can stand for; old-world models only on ancient ground
- [x] A city's open ground is housing (`open` in city.json)

**Seen (vol 1, 2026-11-01, rebuilt with no model call):** the open ground 1,897 buildings (1,312 houses, 368 blocks of
flats, 89 towers); the industrial ground 119 of 121 from the industrial kit; no stall or cart left. The page 1.97 → 2.52
MB. Design: [model-kit.md](model-kit.md).

- [x] Living areas an East Asian megacity's (the user's call; other regions an option for M8): higher least heights for a
      city, a dwelling area and a residential street, a tail of residential towers, lots for blocks of flats, flats from
      four floors. Research and values: [living-areas.md](living-areas.md). Seen on a copy of vol 1: the living area's
      median 3 → 4 floors, one in ten above 12 (was 7), houses 69% → 32%, 312 buildings of 10 floors or more (was 115).

## M5 — Building level

- [x] Street slots spawn building slots: the lots their forms build (frontage, rows behind it to the street's edge, a
      square's rings), a slot of its use each; `street.json`'s densities measured from the forms (design §6, as built)
- [x] Named buildings borrow a slot of their use under their holder (use from the language profile; Jev's answer for the
      rest is a later step); unnamed ones share; a spawn gives its use to a spare lot
- [x] The fill builds the slots: a borrowed building stands on its lot exactly (a staged one's grid there, a marker on it)
- [x] ~~Heights asked as the type's standard plus Jev's offset~~ Replaced at M3 by absolute averages with a hard minimum
      (design §8.9: the height probe)
- [x] Floating objects (a platform, a sphere, a ring, a cavern): asked their distance from the ground and their thickness;
      every shape nominated in the universe's registry; none of them in a manifold's average or in unification (§8.9)

**Pass:** buildings a street within 10% of density × area; every named building on a lot of its use in its street, or a
logged spawn; the world builds in about today's time.

**Stand-in (2026-11-01, on copies of vol 1 after the M4 rerun; no model call):**
- **Slots:** the streets' forms gave 675 building slots before the rows behind the frontage, and about 1,000 after. 45 of
  the 50 buildings the text names or mentions took a lot of their use:
  - 3 named ones borrowed for good: 常盘台中学 a school lot of 第七学区's residential street, 飞镖酒吧 a bar lot of an
    alley there, 豚草不动产写字楼 an office lot of 第十五学区's avenue;
  - 38 unnamed ones shared (29 lots in all, at most 4 on one);
  - 4 spawned on a spare lot given their use (a cinema, a hospital, a car park, a shop);
  - 7 moves at the level's end (飞镖酒吧 nearer its scenes: 16,659 → 13,355 tie·m on the first copy).
  The 5 the language profile cannot type (a tunnel, an underground structure, ruins, a used-car dealer, a grimoire
  library in another city) stay where the canvas puts them. The building level asks Jev nothing; its builds take 33–37 s.
- **Density:** the drafts assumed area-filling lots, while a street's form built only its frontage, leaving most of its
  ground empty (15–25% of density × area). Now the forms fill their ground with rows behind the frontage and rings round a
  square, and `street.json`'s densities are what the forms build on their own ground, measured. In the city the streets
  hold 62% of that: a commercial centre 98%, a station front 93%, a square 74%, an alley 69%, a shopping street 65%, a
  residential street 52%, an avenue 29%. The roads crossing a street break its rows. A road along an avenue's axis broke
  them too (fixed: a street's own road), and a crossing was tested against a building's longest side (fixed: its
  footprint toward the road). Avenues still lose most rows in a CBD, likely to the room the export clears round each
  street marker on them; not yet looked into. **The 10% pass is not met.**
- **Avenues and crossings take the ground's own (the user's design, after the stand-in):** an avenue takes a road of the
  city at least 18 m wide, and a crossing (a new street kind) a meeting of roads at least 12 m wide (`takes` in
  street.json). Neither builds a form; the city's lots round them are their buildings. On the copy, vol 1's 8 avenues went
  from 15 buildings in all to 111. The densities of the streets that hold city lots (an avenue, a centre, a station front,
  a square, a park) are measured on vol 1's city now: 6.3, 7.8, 5.8, 13.3 and 0.5 a hectare. Rows elsewhere are laid
  between the roads crossing them.
- **Floating objects:** a stand-in run asked each its thickness after its distance from the ground and kept both;
  nominated in the universe. On a copy with spans set, a deck draws 22–25 m up on legs, and a cavern becomes a hall from
  18 m down, 12 m tall.
- **Two faults from M4 found on the way:**
  - a named place on a slot left the slot's own children loose round the map: 第七学区 on a dwelling slot, with that
    slot's seven streets. The shared station front of 站前广场 and 人行步道 was one of them. Now held children go to the
    place, the rest are removed.
  - a run `--from` a level ran the ends of the levels above it again, and their moves reshuffled what the earlier Jev run
    had settled. Now they stand.
- **Paid by mistake:** a test run through the CLI asked Jev twice (a street's kind and height) before it stalled. Test
  runs go through a stand-in client now.

**Jev run (2026-11-01, on the host, `--spawn --from street --run`; 48 paid calls, 318,070 input tokens):**
- **Streets:**
  - Jev typed 十字路口 a crossing. It spawned one in 第六学区 on a crossing of arterial roads, and 柏油马路 shares it
    (reshaped 16 → 26 m).
  - The 大道 took avenue slots laid on arterial roads.
  - One move at the level's end (9,319 → 9,170 tie·m).
  - The street forms and the city's lots on streets gave 1,223 building slots.
- **Floating objects:**
  - the underground passage, its top 6 m under the street, 6 m thick;
  - the deck, 3 m up and 6 m thick, moved into 第七学区;
  - the helipad and the runway, each 100 m up and 1 m thick, moved into 第六学区 and 第十五学区;
  - the sky garden, 25 m up and 25 m thick, moved into 第六学区.

  All 5 are nominated in the universe.
- **Buildings:**
  - 45 took 31 lots: 3 named borrowed for good (the school, the bar, the office on 大道), 40 shared, 2 spawned (a cinema
    on a station front's shop lot, a car park).
  - 6 moves at the level's end.
  - 4 have no use the profile knows.
  - The level asks nothing and takes seconds.
- **Density in the city:** an avenue 87%, a centre 97%, a square 95%, a station front 111%, a shopping street 59%, an
  alley 55%, a residential street 39%; 60% overall. The page is 2.57 MB.
- **Seen in the pictures, fixed after (no model call; the building level run again):**
  - shapes were drawn at their markers' canvas spots, not where terrain kept them: the sky garden stood over an
    industrial district;
  - two raised platforms moved onto one district's middle (now the nearest spot inside it, at the next street run);
  - a city lot's building slot had no street in its id.

**The building level asked as every level (the user, after the run: every level the same process):** Jev is shown the
skyline and the map and asked each building's kind, from the building level's own kinds (26 uses: a house, a block of
flats, a dormitory, a school, a shop, an office, a government office…, with floors for each), then, once it has borrowed
a lot of that kind, its height on slices through its street. The lot takes the kind and the height; the building blinks
on its lot in World · Live while it is asked. Stand-in on a copy of the host's state (no model call): 98 questions for 49
buildings, all on lots of their kind with their heights. Not yet run with Jev: about 98 calls.

**The user's building level (after the first asked run):**
- [x] Shapes at the building level: a floating one asked its distance from the ground and its thickness, merging into
      the buildings there; a ground shape asked its top, pushing them outward; both placed where travel is least.
- [x] An inventory of about 90 building types (`config/terrain/building-types.json`), searched by a building's name and
      the sentences round it; Jev chooses among the ten nearest and the shapes. The search is by words until an
      embedding model is configured.
- [x] A rare type with no lot of its use under its holder stands where travel is least and pushes the buildings round it
      outward, drawn as a building of its own.

Stand-in on a copy of the host's state (no model call; its kind the search's first, its height a middle slice): 100
questions for 49 buildings. 46 took a type (a student dormitory, a mixed-use building, a school, a detention centre, a
convenience store, a subway station…), 3 were shapes, and 2 rare kinds (a cinema, a car park) were placed apart. Not yet
run with Jev.

**The building level with Jev (2026-11-01, on the host, `--spawn --from building --run`, the search by meaning on v1's
bge-small-zh-v1.5; 100 paid calls, 632,961 input tokens):**
- **Choices:** of 49 buildings, Jev took the search's first type for 34, its 2nd–6th for 13, and made 2 shapes (the
  tunnel and the underground structure, caverns 6–24 m down).
  - Well read: 常盘台中学 a girls' academy; 看守所 a detention centre; 检察厅 a prosecutors' office; 二手车经销商 a car
    dealer; 回转寿司店 a sushi restaurant.
  - Three rare kinds stood apart (a cinema, the ruins, a car park).
- **The search:** on 63 names judged by hand, the right type was first for 78% by words and 90% by meaning, and in the ten
  for 84% by words and 100% by meaning. After the types that differed only by height were merged: 95% first, 98% in the
  ten.
- **A bigger model, tried (the user's ask):** BAAI/bge-m3 (multilingual, 1024 dimensions, 2.3 GB) downloaded and served
  beside the small one. On the same 63 names it put the right type first for 92% (meaning and words) and 78% (meaning
  alone), against bge-small-zh-v1.5's 95% and 92%. It got three wrong that the small one got right (a place to eat called a
  bakery, a hall for swimming and ball games a bowling alley). The small Chinese model stays.
- **Seen by the user, changed after:** a building's height was offered by its kind (a convenience store 1–5 floors), and
  several descriptions said how tall a type is. Now every building is offered the same slices, from under the street to a
  hundred floors; no description speaks of height; a building taller than its use's models is drawn as a tower. This run's
  heights were asked the old way.
- **Not yet:** Jev put 6 buildings under the street (the sushi restaurant, a ramen shop, the subway station, the car
  park…); an underground building is not built as a hall yet.

- [x] The search decides a building's type when it is sure (its first leads its second by 0.5), Jev when it is not;
      the inventory knows shapes too (a tunnel, a cavern, a raised deck). On 70 names: 56 sure, all right.
      Stand-in on a copy of the host's state (the real local embeddings): the search decided 43 of 49 buildings, Jev was
      asked 6 (office-like names); 57 questions in all, from 100.

**The building level with Jev, the search deciding when sure (2026-11-01, on the host at 5599c6c, `--spawn --from
building --run`; 58 questions, 54 paid and 4 answered from the cache of the earlier run; 277,964 input and 6,507 output
tokens for the 54):**
- **Types:** the search decided 43 of 49, Jev 6, as in the stand-in. Jev's six: a real-estate office (豚草不动产写字楼),
  three mixed-use buildings (低层办公, two 复合大楼), a hospital (医疗机构), and the underground car park as an
  underground structure, a cavern 6 m down. Each was the search's first but one (低层办公, its third).
- **Heights on the one scale:** 19 buildings at 1 floor, 4 at 2, 12 at 5, 1 at 8, 1 at 20, 2 at 60, 5 at 100, and 5
  under the street. Read from the text: the two fifty-storey towers at 60 floors, the high-rise tower flats at 100. They
  stand as skyscrapers over the city's fill.
- **Seen, not yet changed:**
  - Where its scenes say little, Jev's answer spreads over the slices and the likeliest is often 1 floor: 高层大厦
    (scene 40), whose scene is on its roof, has 0.36 on 1 floor and 0.20 on 100, and is drawn at 1 floor. Every such
    low answer has a height confidence under 0.4.
  - Unnamed buildings share a lot of their use, never two of one scene. Six office-like ones from six scenes share one
    station lot, at 1 to 60 floors, and the lot is drawn at their mean, 12 floors, so the fifty-storey tower is lost.
  - 12 of the 49 are shops, restaurants and a cinema, each on a lot of its own and asked a height.
  - A shape's site had no `offered` list; it does now.

**Heights at every level, after that run (the user, 2026-11-01; borrow-and-spawn.md §8.9):**
- [x] A minimum at every level: area kinds had theirs (their least median); a building type's least floors
      (`config/terrain/heights.json`, for an East Asian megacity) are now its lowest slice above the street (an office
      three floors, a hospital four).
- [x] The text's own measures (`src/v2/context/measures.ts`): a number and a unit of height in a place's name and own
      sentences (五十层, 两百米高, 地下三层, 35 floors), found by pattern, offered as slices of their own, "as the text
      says", at every level. In this book only the two fifty-storey towers' names give one; no named place's sentences do.
- [x] Unnamed buildings share a lot only when their heights are within a factor of two, in the borrowing and in the
      level's closing moves; two named buildings exchange lots only where both may stand.
- Tried and removed (the user's call): where an answer spread wide, the part took its kind's usual height. Replayed, it
  lowered the real-estate office tower from 20 floors to 5 and a building in a scene of towers from 100 to 12.

Replayed without a model call, the minimum alone: Jev's real answers from the run above, each answer's weights moved onto
the new slices at the nearest height (under a type's minimum, onto its lowest slice). A real run will differ, since Jev
would weigh the new slices itself.
- One-floor buildings 19 → 11, all shops, stations and the ruins; offices 3 floors or more (高层大厦, 大厦, two 大楼),
  the hospital 4.
- The towers as Jev read them: 20, 60 and 100 floors.
- Mixed lots 0: the four towers (60–100 floors) share one lot, the low offices another; before, the station lot mixed 1
  and 60 floors.
- A cinema read at 8 floors comes out at 2: its weights under the minimum all land on its lowest slice, which then leads.
  高层大厦 is likewise held at the minimum, 3 floors.
- [x] Towers are types again (the user: 高层大厦 is a tower, and a tower is 30 floors at least): an office tower and a
      residential tower, split out of the office building and the block of flats they had been merged into, each with a
      minimum of 30 floors. The search: 96% first by meaning (95% before), 80% by words (78%); the sure rule still decides
      55 of the 70 names, none wrongly.
      Replayed: 高层大厦 an office tower at its minimum, 30 floors (it had been 1); 五十层以上的高楼 an office tower at 60;
      高层塔楼公寓 a residential tower at 100; plain 大楼, 大厦 and the flats stay office buildings and blocks. 五十层的高层大楼
      is not sure with its sentences, so Jev chooses, office tower first among the ten (the replay kept the run's office
      building).
- A cinema read at 8 floors coming out at 2 is for the composite buildings (a cinema on a mall's upper floors), not
  the minimum.

**Tall buildings and the streets round them (the user, 2026-11-01; borrow-and-spawn.md §8.11):**
- [x] Above 100 m the taller the thicker (no side under height / 8), the fill it covers cleared; a street wider the
      more towers stand round it (1 + share × mean height / 400). Both after the fill, so lots and slots stay.
- [x] The CBD's manifold tuned so a few towers reach about 600 m (spread 0.6, tail 0.15, index 3); no cap.
- Rebuilt on the host's terrain (no model call): 87 towers grown and 127 low buildings cleared; 29 above 100 m still
  over 8:1 (most just over; one 849 m draw between close roads); 366 roads widened. 第六学区 (median 80): 849, 591 (its
  landmark), 483 and 477 m; New York's CBDs (median 61): 450 m each.

**Composite buildings, no model call (the user, 2026-11-01; borrow-and-spawn.md §6):**
- [x] 22 tenant types (shops, restaurants, bars, cafés, a cinema, a convenience store, a bank branch…) join a host under
      their holder where travel is least, at its foot, upper floors or under it; no lot, no height question. A tenant a
      scene is set in stays a building of its own.
- [x] Drawn: the host's base (shops under a tower) where it stands four floors or more; the tenant's marker at its host;
      in the place tree, in its host's street.
- Replayed on the host's state (Jev's real answers, no model call): 11 tenants, 58 questions → 47. A convenience store
  at the 80-floor mixed-use tower's foot (drawn with its podium); five shops at an office's foot by the station; both
  cinemas on malls' upper floors; a patisserie in a station. The darts bar, set in a scene, stays a building. The ramen
  shop Jev had put under the street stands at its host's foot: no sentence of it says 地下.

**The building level with Jev on all of it (2026-11-01, on the host at 05ca519; the minimum gate, tower types, the text's
measures, composite buildings, tall buildings and wide streets; 47 paid calls, 243,935 input and 5,126 output tokens,
from 58 and 100 before):**
- **Types:** the search decided 43 of 49, Jev 6. 11 tenants joined hosts, asked nothing: the scene-3 convenience store
  under the street in the subway station; five shops at an office's foot; both cinemas on malls' upper floors.
- **The text's measures, taken:** both fifty-storey towers office towers at 50 floors (Jev 99% and 91% sure); the
  residential tower at 44 floors.
- **Towers:** 高层大厦 an office tower at 100 floors; the minimum held every office at 3 floors or more.
- **Wrong:**
  - A 44-floor measure in one sentence naming three buildings was offered to each, and the "low-rise offices" took it
    (75% sure). The measure stands nearest one of them; it should be offered to that one only.
  - Answers Jev was unsure of still land far out: 大楼 (scene 2) at 100 floors (11% sure), the real-estate office tower at
    1 floor (17%).
- **The world:** 89 towers grown, 120 low buildings cleared, 367 roads widened; 30 above 100 m still over 8:1; the
  tallest 849 m (the CBD's tail).
- [x] After it (the user: "those offices, you know their usual type, set that usual height as the minimum gate";
      "every area type needs a minimum gate, the type configuration dictionary needs to be fulfilled"): one dictionary,
      `config/terrain/heights.json`, whole. Every building type at its usual height (an office building 12 floors, a
      mixed-use street building 8, a real-estate firm's office building 12, a block of flats 10, a hotel 15, a hospital 8,
      a school 4, a tower 30); every area kind of every level at its least median (as before, now in the dictionary and
      read from it). On this run's answers 17 buildings would be lifted: 豚草不动产写字楼 1 → 12 floors; 大厦, 两栋大楼 and
      大楼 (scene 29) 3 → 12; the flats 5 → 10; the hospital 4 → 8. A minimum lifts; 大楼 (scene 2) stays at 100 floors.

**Composite parts on their floors (the user, 2026-11-01; borrow-and-spawn.md §6; with Jev on the host, 00:17 UTC):**
- [x] A part's floor and size: fixed for a convenience store (floor one, 120 m²), a drugstore, a florist, a bank branch;
      else one question to Jev with no picture. Its use's model on that floor of its host, at a random spot, roughly.
- [x] The Buildings panel in World · Live shows each part's floor, size and who chose them.
- Run: 9 paid calls for 9 parts (14,416 input and 1,469 output tokens; the buildings' questions answered from the
  cache). The two convenience stores on floor one, as fixed; at the fifty-storey tower's foot the sushi restaurant 200 m²
  and the patisserie and donut shop on floor one, the ramen shop one floor under the street (42% sure); the cinema on a
  mall lot's floor 4, 500 m²; the cinema of 购物中心 its whole ground floor, 358 m².

**The terrain loop: basically done (the user, 2026-11-01).** City, district, street and building levels, each asked as
every level is; the building inventory, the minimum gate, the text's measures, composite buildings, tall buildings and
wide streets, the Buildings panel. The repository was then laid out by the concept map's layers (`src/v2/terrain`,
`src/v2/world`, `world-engine/{terrain,world,view,live}`; config in `config/terrain`). Next: spawning positions, where
each character and thing stands when a scene begins.

**The building level with Jev on the whole dictionary (2026-11-01, on the host at 0f632a6; 47 questions, 36 paid and 11
from the cache; 190,936 input and 3,816 output tokens):**
- **The minimum held everywhere:** 豚草不动产写字楼 at 12 floors (42% sure), every office 12 or more, the flats 10, the
  hospital 8, the dormitories 5, the stations 2.
- **The text's measures** as before: both fifty-storey towers at 50 floors, the residential tower at 44.
- **Tenants:** the five shops by the station now at the foot of the fifty-storey office tower (drawn with its podium).
- **Wrong, and more of it:** offices Jev was unsure of now leap to the top slice: 大楼 (scene 2), 两栋大楼 and 大楼
  (scene 29) at 100 floors, 18–22% sure (3 floors in the run before, under the old minimum); the flats of scene 34 at
  100 (34%). With the minimum at 12 an office is offered 12, 20, 35, 60 and 100 floors, and the CBD tuned round them
  stands taller in the picture. The "low-rise offices" still take the 44-floor measure of another building (92% sure).

## M6 — Growth across books

- [ ] Vols 1–4 in order (stand-in), then a 20-book replay (the four books again with fresh scene ids)
- [ ] Areas a city after each book, by level

**Pass:** the curve flattens: a book that brings no new names adds no area; a new name adds at most one, and only beyond
its type's quota; every name stands on its first book's slot; unnamed shares start empty in each book.

## M7 — A real run, and pools removed

- [ ] A paid Jev run on vol 1, level by level, when the user asks
- [ ] Pools removed (`src/v2/extraction/pools.ts` pools, `poolOf`, pool parts in terrain spawning); `--spawn` the default
- [ ] Concept map, guide, status and the terrain io updated

## M8 — One settings registry (the user, 2026-11-09: "unify all the configuration files we have")

Design: [models-and-settings.md](models-and-settings.md) §4; journal [world-engine-v2.md](world-engine-v2.md) §2.0.23.
Was "configurations of one's own, not now"; the user brought it forward so the main agent can change building generation
"in a quick and context aware way". No model calls in any step.

- [x] **M8a The schema and the resolver** (built 2026-11-09, the user: "dig out the hard rules and make them into our
      universal world generator schema"). `config/world.schema.json`: 69 keys and 8 tables. Each key has its default
      (today's value), unit, range, meaning, where it is used, the layers that may override it, and its kind: hard (a gate
      or limit), knob, physics (a measured constant), structure (the grid itself) or presentation. Groups: grid and body,
      the fill, landscape, layers, tall buildings, underground, places and spawning, Jev's views, named buildings,
      walking, roads, the highway, the laws and talk distances, the smoother and occupation, crowds, the director, the
      replay clock. Tables: `config/terrain/*.json`, `config/models.json`, and the landscape kinds, moved out of
      `landscape.ts` into `config/terrain/landscapes.json` (their building rule, a function in code, is now data: steps
      [from floors, type]). `src/v2/settings.ts`: `setting(key, scope)`, `table(name, scope)`, `resolveSetting` (value
      and where it came from), `problemsOf`; layers defaults < `<universe>/settings.json` < `<novel>/stage/settings.json`
      < a place's own (`places.<id>`), objects merging key by key. Read by 26 modules instead of their literals (cityFill,
      landscape, tall, underground, placeCanvas, topology, heights, inventory, slots, holoNav, positions, highways,
      roads, laws, attacks, smoother, occupation, crowd, director, on-the-move, float, terrain, terrain-spawn,
      impact-choices, export-strand-demo). Rules written more than once are one key now: earshot (laws, director,
      smoother), face-to-face talk (laws, smoother), the cell and the floor (four files each). Not wired yet: the
      player's own copies of the replay clock and smooth mode (`wired: false`); the code passes no scope yet, so layers
      take effect from M8b/c.
      *Tests:* `test/world-schema.test.ts`, 6 of 6: every key documented and its default in range, every file it names
      exists; the code reads only keys the schema has and reads every wired key (a scan of `setting(` and `table(`
      calls); the landscape steps; layers in order with objects merged; a layer setting what it may not, an unknown
      part, a wrong shape and a value out of range refused; Infinity kept. Engine tests 184 of 184; the TypeScript suite
      829 of 830 (`init.test.js` expects `/var/...` where macOS gives `/private/var/...`; it fails the same on the W14
      checkout without this change). *Evidence:* the first quarter's rehearsal (units 1–84 on `rehearsal-novel-w13j`)
      before (`d20261109064146`) and after (`d20261109064813`): the page identical but its export time, the report
      identical but its timing (236 moves, the same laws). *Cost:* none.
- [x] **M8b The commands** (built 2026-11-09). `novel settings show|explain|set|unset|diff`
      (src/cli/commands/extract/settingsCommands.ts): `show` the values as they resolve and where each part came from;
      `explain` meaning, unit, range, kind, layers and when a change takes effect (each group's `after` in the schema:
      the next run, a terrain step, the transport step's `--rebuild`); `set` checks a value before it writes it to the
      layer it belongs in (the book's, else the universe's; `--place` a place's part), logs who and why, and `--before`
      takes the book's new before snapshot; `unset` falls back; `diff` lists the overrides in force or what changed since
      a snapshot. Each director run records the overrides in force (`run.json` `settings`). *Tests:*
      `test/settings-commands.test.ts`, 4 of 4 (show and prefixes; explain and near keys; set to the right layer, a place's
      part, refusals out of range, at a layer not allowed, not settable, an unknown part, without --why; tables, unset,
      diff against defaults and against a before snapshot). *Evidence:* on the rehearsal copy, `set fill.streets
      {"arterial":24}` and a place's `fill.ops` in two commands; the rebuilt world had arterials of 24 m and more (from
      18) and the operators' props; `unset` put it back. Not yet: a Pi session doing it from a one-line request.
- [x] **M8c Fill operators** (built 2026-11-09). The book's and its universe's layers reach every module (the resolver
      takes the book from `NOVEL_SETTINGS_BOOK` or the command's novel folder before the modules read their values);
      a place's own layer reaches its fill (`fill.streets`) and its expressway (`highway.knobs`: the transport step's knobs
      by city, the ramps' pull at export). `fill.ops` (src/v2/world/fillOps.ts): scatter (open ground, streets, plazas),
      line (along roads of a level, every so many metres, one side or both) and ring, of trees, street lights, benches,
      bins, parked cars and bollards, never in a building or on a carriageway; the player draws them as instanced shapes.
      Structures are never scattered: they stay the fill's and the text's. *Tests:* `test/fill-ops.test.ts` 3 of 3.
      *Evidence:* on the rehearsal copy, Academy City with three operators got 1,390 street lights, 600 trees, 120 parked
      cars (still: scratchpad); with no override the first quarter's rehearsal is identical to the baseline again
      (236 moves, page and report the same).
- [x] **M8d Handles for anything** (built 2026-11-09) (the user, 2026-11-09: "not only think about American or European or anything, think
      of it as anything"; design §8.2). A Settings panel in World · Live generated from the schema itself: every group
      with its `about` and `after`, every key with its value, its source layer, unit and range (a slider for the 26
      ranged numbers), the tables as rows; scoped to the book or the place shown. A change goes `POST /play/settings` to
      the host, which runs `settingsSet` (checked, layered, logged with the panel's why, `--before` as a tick) and
      answers with the problems or when it takes effect. Profiles are named sets of overrides and nothing more:
      `novel settings profile save|apply|list` (`<universe>/profiles/<name>.json`); none built in. *Evidence:* a change
      from the panel lands in the layer's log and shows in `novel settings diff`; a profile saved from one library's
      overrides applies to a scratch library (the same `diff`). *Built:* `tools/pi-review/sim-settings.mjs` + the host's
      `/play/settings.json` and `POST /play/settings`; the Settings panel in World · Live (75 keys in 22 groups, sliders
      for the ranged ones, a why field, a place field, a before tick); `novel settings profile save|apply|list`.
      *Evidence:* `test/warehouse.test.ts` (a profile of 2 overrides saved from one scratch library and applied to
      another: the same `diff`), `tools/pi-review/sim-settings.test.mjs` (a change with a why lands in the layer's
      log as "World · Live"; a wrong value is refused); headless Chrome on a host: the panel lists 75 keys, a refused
      value answers 400 with the schema's words. *Cost:* none.

**Pass:** no knob left outside the schema; today's world rebuilt identically with no override; the agent changes a
place's generation in one command and sees it after a terrain rebuild. **Cost:** none (no model calls).

## M9 — Damage splits shares (with the simulation stage)

- [ ] When the simulation damages a shared slot, the sharers after that scene borrow again (design §2.8, option A); the text's own damage from a later extraction step (option B)

## M10 — Models as code (the user, 2026-11-09)

Design: [models-and-settings.md](models-and-settings.md) §2–3, §5; journal §2.0.23. Runs after the reading, before the
terrain loop. Tools: OpenSCAD 2026.10.11 (`--backend=manifold`, coloured OFF), manifold-3d 3.2.1 (closed-solid check),
both installed 2026-11-09. Tried first in a scratch test: 5 of volume 1's things, 5 closed solids, about 10,500 tokens.

- [x] **M10a Toolchain and contract** (built 2026-11-09). `src/v2/models/scad.ts` (OpenSCAD's manifold backend to a
      coloured OFF; measure; manifold-3d's closed-solid check with each piece's box; the player's Y-up mesh) and
      `contract.ts` (the rules the writer reads, the checks). Thresholds in the schema (`models.contract`). A rule from the
      first run: 9 of 14 failed on rotors a few centimetres off their hub and a 0.65 m robot 6 cm low, none of it visible
      at 30 m; the ground tolerance is now the larger of 5 cm and 5% of the height, and a piece within the larger of
      15 cm and 2% of the longest side of the body counts as attached (a piece further floats and fails, with where it
      is). *Tests:* `test/models.test.ts` 7 of 7 (a passing box with its colours; blades under the ground; a rotor 1 m off
      fails, 5 cm off is attached; a 30 m knife against 0.3 m; broken code; floating pieces; nominate).
- [x] **M10b Nominate** (built 2026-11-09). `novel model nominate`: the settei cast's things (universe/props.json) with
      the sentences naming them and their scenes; a kind that can have its own model gets one when seen in 2 scenes or
      named in 3 sentences (`models.nominate`), at most 40 a book; small kinds take a part. *Evidence:* volume 1, 157
      things: 23 own (helicopters, cleaning robots, a drone, a car, the wind turbine, the big screen, two VTOL aircraft, a
      crane, trucks, the airship, the Hammerhead, cars, a billboard, a stretcher...), 134 parts. A few generic labels made
      it in (a "car", a fire extinguisher typed as a machine): a cast question, not a rule.
- [x] **M10c Brief, write, put, check** (built 2026-11-09). `novel model brief|write|put|check|list|show`; the store
      per universe (`universe/models`: `<id>.scad` the truth, `.off` and `.mesh.json` derived, `catalog.json`,
      `usage.json`). *Evidence (rehearsal library, a clone of library 16):* 23 written; 12 passed the first contract, 19
      when re-checked under the scaled one, the last 4 each on one rewrite with the new feedback: 23 of 23. *Cost:* 62
      requests, 73,902 prompt and 79,906 completion tokens: $0.108 at the work model's rates. Not yet: a model put by Pi
      from `brief` alone.
- [x] **M10d The warehouse** (built 2026-11-09, partly). gkNextEngine's 12 kits and catalogue (668 modules, MIT) kept beside
      our CC0 packs (`~/claude-world-first/model-packs/gknextengine-scad`; their comments are Chinese, so not in this public
      repository); `novel model parts '<kind>'`, `use <thing> kit:<module>` (rendered, checked), `bind` (the work model picks
      from a shortlist by kind). *Evidence:* 135 small things: 17 bound (pistols, lanterns, a medkit, a van, a helicopter,
      a display case), 117 with no fitting part (the kits hold 7 weapons and 12 items), 1 failed its ground check.
      *Cost:* 9 requests, $0.020. Not yet: matching by embeddings; our CC0 packs bound (`pack:`) and drawn.
- [x] **M10e In the replay** (built 2026-11-09). The director draws a thing with a checked model (its own, or a kit part)
      as it, at the model's size (`scadModels` on the page); the player builds it with its colours; a Models button in the
      player and World · Live (on by default; off shows the old shapes). *Evidence:* the first quarter's rehearsal with
      models hidden and shown: the laws identical; no modelled thing is on stage in units 1–84 (they come later: 154, 158,
      197), so W15 shows them.
- [x] **M10f Every agent host** (built 2026-11-09, Pi only). `skills/novel-models/SKILL.md` (models and settings), in the
      Pi runner's manifest; it loads through Pi's own resource loader (`tools/pi-review/library-access.test.mjs`, 7 of 7 with
      the runner's tests). Codex and Claude Code wait for the adaptor's setup engine (adapters/README.md).
      *Found by the volume 2 console test (2026-11-09, the user: "see if the pi console is able to efficiently retrieve
      context to modify the configurations files"):* Pi read the manifest and the skill in 30 s and then had every
      `novel settings` and `novel warehouse` command refused: the scoped CLI's guard (`tools/pi-review/guard.mjs`) knew
      none of `settings`, `warehouse` or `model`, so the skill's commands were never runnable from Pi. Added, scoped to
      the assigned book, a why wherever something is written, a download only with the user's `--ok`, a folder
      registered only under the packs root (`guard.test.mjs`, 21 of 21).
- [x] **M10g The warehouse registry** (built 2026-11-09) (the user, 2026-11-09; design §8.3). One registry of sources outside any library
      (`~/claude-world-first/model-packs/warehouse.json`), each with its kind (a SCAD kit or a glTF folder), path,
      licence and URL; a catalogue per source in gkNextEngine's record shape, built by us: a SCAD kit's modules
      evaluated with OpenSCAD and measured as models are, a glTF folder's files measured and baked to the player's mesh.
      `novel warehouse list|add|refresh`; `kit`, `pack` and `own` registered as the built-in sources. The licence gate:
      CC0, MIT, Apache-2.0, BSD, CC-BY-4.0 with attribution; anything else only with the user's recorded OK. *Evidence:*
      a scratch kit of three modules and a one-file glTF folder registered and catalogued in the tests
      (`test/warehouse.test.ts`: the module with a required parameter is no part, the buried one is not ok, the glTF
      cube's size and colour come through); `novel warehouse list` on this Mac: kit 668 (665 ok), pack 114, own 25.
      *Cost:* none.
- [x] **M10h Supply and search** (built 2026-11-09; `fetch` written, not yet run against a real download) (design §8.3, §8.5). `novel warehouse fetch <name> <url> --licence --ok "<the user's
      words>"` (a download needs the user's permission: never without `--ok`; into its own new folder, LICENSE and
      SOURCE.txt kept, 200 MB by default); `find "<words>"` over every catalogue by name, category, the reading's size
      and, when the local embedding server is up, embeddings; `show`. The skill's "Your own warehouse": where to look,
      what never to take, the download rules. Pi's manifest and allowlist take `novel warehouse`. *Evidence:* `find`
      ranks the scratch kit's pine first for "pine tree" within its source and `kit:cw_nature_pine` first over 665 real
      parts; the skill loads through Pi's loader (`library-access.test.mjs`); the manifest names `novel warehouse`.
      Embeddings were dropped the same day after the Ponytail review (design §9.6): an exact name first, then words,
      kinds and size; nothing to run. *Cost:* none.
- [x] **M10i The warehouse connected to the configuration** (built 2026-11-09) (design §8.4, §8.6). Slots as settings: `fill.props`
      (a part per prop kind, by place), `models.vehicles` (a part per vehicle kind), `models.parts` (a part per thing
      kind, taken by `bind` before the work model is asked), and parts in the `models.uses` table with a floors range;
      `novel warehouse use <part> for <slot>` as sugar over `novel settings set`. The export puts each used part's mesh
      on the page and the player draws props, lots and vehicles as the part. A Warehouse panel in World · Live: sources,
      categories, search, Assign. *Evidence:* the first quarter's rehearsal identical with no override; with `prop:tree`
      bound to a kit tree the page's `scadModels` holds it and the trees' mesh is the part's. *Done:* the first
      quarter's rehearsal identical with no override (236 moves, the same laws, the same report as before this work);
      `novel warehouse use kit:cw_nature_pine for prop:tree` on the rehearsal copy, then the world page: `scadModels`
      3 (the two landmarks and the pine), the city's landscape carries `propModels.tree → scad:we14cbf2b`, 1,944
      trees drawn as the kit's stepped pine (still in the scratchpad). Also found and fixed on the way: the export
      drew building uses from the static `config/models.json`, not the layered `models.uses` table M8a had declared
      (now `table('models.uses')`). Not yet seen in a rehearsal: a vehicle slot (the first quarter's vehicles have
      their own models) and a building use's part. *Cost:* none.

**Pass:** every nominated thing has a model or a part; every model passes its checks; the first quarter's rehearsal
unchanged in laws and moves (a model is a look). **Cost:** reported per model and per book.

## M11 — Landmark shells

- [x] Named landmarks (built 2026-11-09): the terrain's building sites the text names (not "the building" of a scene)
      nominated with the things; written with a building brief (footprint about the lot's, height about its floors, its
      named parts, entrance toward -y); the export puts the model on the lot (a shell the lot's plan scales) and its height
      into the lot's floors. *Evidence:* volume 1 has 2 (the Darts Bar, Tokiwadai Middle School), both written on the first
      try ($0.004); the first quarter with them: laws identical, only their two lots changed height (8 → 4 and 1 → 5
      floors) and one scene (83) has 2 more moves round them; stills in the scratchpad.

## M12 — People with bodies (later)

- [ ] A character kit after gkNextEngine's `kit_char` (MIT): a 7-bone standard (root, torso, head, arms, legs), parts by
      slot (head, hair, hat, torso, arms, legs, accessories) chosen from each person's sheet and the stills cast's looks;
      shared clips (walk, run, sit, fall, fight) as keyframe data; a socket for what they hold. *Evidence:* unit 52's
      walk with steps beside the capsules; frame time on a phone. *Cost:* none or a little (slot choices by the work
      model).

## M13 — All SCAD (proposed 2026-11-09; design §9)

The user asked whether the whole project can be SCAD with one warehouse, for the least context and effort. Measured:
the page pays 30 bytes a triangle for a SCAD model against 13 for a baked one (an encoding, ours to change); the MIT
kits cover every vehicle and prop kind and most low-rise uses, none over 20 m; towers, stations and halls are ours to
write (about $0.1 for 60 modules). Steps, each with evidence and cost in design §9.5:

- [ ] **M13a Quantised SCAD meshes on the page** (int16 + step, a colour palette). *Evidence:* the first quarter's page
      bytes before and after. *Cost:* none.
- [ ] **M13b Vehicles from the kits:** `models.vehicles` filled for the 9 kinds as the universe's default; the player's
      hand-built forms and `vehicleModels.json` retired. *Evidence:* every vehicle on a rehearsal page a `scad:` model.
- [ ] **M13c A building kit of our own** (`kits/nv_kit.scad`, MIT): a module per use and style, named at birth, written
      by the work model from a use brief; towers and podiums; `models.uses` filled from it. *Evidence:* the first quarter
      drawn from the kit alone. *Cost:* about $0.1.
- [ ] **M13d Furniture from the kits:** a `models.furniture` slot; `furnitureModels.json` retired.
- [ ] **M13e The baked packs retired:** `architectureModels.json`, the bakers and the glTF path dropped from the
      critical path (2.8 MB out of the repository; 525 MB off the Mac when the user empties the packs folder).
- [ ] **M13f People as a rig** (M12).
- [x] **M13g Every baked choice a layered setting** (built 2026-11-09) (the user, 2026-11-09: "if mesh still exist, make every baked setting
      configurable based on context"): while baked models remain, what picks them is a setting in the schema, resolved
      by universe < book < place like every knob, never a constant in code: the underground halls' models (`models.halls`,
      was `UNDER_MODELS` in the player), the rooms' furniture recipes by room kind (`models.furniture`, a table, was
      `RECIPES` in rooms.mjs), the vehicle picks by name words (`models.vehicleWords`, was `modelOf` in transport.mjs),
      the plain prop looks (`view.props`). *Built:* `models.halls`, `models.vehicleWords` (checked before the built-in
      word rules), `view.props` (height and colour a kind; a kit-unit part scales to the height), and the table
      `models.furniture` (`config/furniture.json`, 17 room kinds, moved out of rooms.mjs); the export puts `hallModels`
      and `propLooks` on the page and the player reads them. 78 keys, 9 tables. *Evidence:* schema 6/6 (every default
      valid, every key read), engine 184/184; an override of each seen on a page: not yet. *Cost:* none.
- [x] **Recall by name, free** (built 2026-11-09, with M10h): `find` matches a part's name, label or reference exactly
      first; a written model is `own:<label's slug>`. *Evidence:* `test/warehouse.test.ts` (a model named at birth found
      with `exact: true` by its label, by slug and by id). *Cost:* none.

## W15 — Volume 1 again, with models and settings (a paid run, when the user asks)

Against W14 (`d20261109020441`, $0.17): laws broken by kind, moves, held, speakers settled; models drawn and their
checks; the run's cost with the models' share on its own line. Before it: M8a–c, M10a–e and M11 rehearsed on the first
quarter, and a new `before` snapshot with the models and settings in.

- [x] **Run** (2026-11-09, library 16, checkout `app-cca9324-w15`, before `0017`). The first attempt
      (`d20261109073558`) died in scene 153 on the first road drive any full run had played: the drive's life seconds
      were put on the path as `at`, hiding the array's own `at()` (fixed as `times`, 1c354b8). The rerun
      (`d20261109081436`, `--discard-edits`; scenes 1–152 asked of Jev again, see the cost) finished all 286 scenes; after
      snapshot `0019`.
- *Evidence against W14:*

  | | W14 | W15 |
  | --- | --- | --- |
  | Jev calls | 504 | 516 |
  | Moves (moved / unmoved) | 878 / 330 | 872 / 325 |
  | Laws broken | L6 5, L9 3, L10 7 | L6 6, L9 3, L10 7 |
  | Held for review | 129 (13 batches) | 127 (13 batches) |
  | Speakers: world applied / held | 93 / 94 | 90 / 92 |
  | Jev review: stood | 7 of 50 | 7 of 50 |
  | System 2 differing from Jev | 161 of 274 | 158 of 277 |
  | Drives on the road graph (`drove`) | 0 | 0 |
  | Vehicle moves on the page | | 13 (4 change floor: 2 an aircraft's, and two found wrong below) |

  The car in unit 154 was W14's L10 "carried 144 floors to the office"; with its own model it became a vehicle and
  was moved, not held (see below). New in W15: two L10 roof leaps to an office (units 11, 162), one L10 with no place
  to stand (119), one L6 across 40 floors (237).
- *Models drawn:* all 23 of the page's models (21 things and vehicles, 2 landmark shells on their lots; the player's
  `__models()`: 23 of 23 drawn), and 3,189 pieces of street furniture from `fill.ops` in the city. Page 9.3 MB.
- *Cost:* the rerun $0.15 (Jev $0.12, system 2 $0.03); the crashed attempt about $0.07 more (its 224 Jev answers,
  about $0.05, were asked again: Jev's cache key holds the pictures, which render a little differently each run, so a
  rerun never replays Jev; system 2's text-only answers did replay, 117 of them); the models $0.13 once, before
  filming (71 requests); together about $0.34.
- *Review:* Pi answered all 13 batches (43 who-speaks items, 09:41–10:02 UTC; with Jev's 7 that stood, 50 answers),
  kept as snapshot `0020-manual`; not applied (a `--from-last` second pass applies them). 127 held items stay open.
- *Found after the report (2026-11-09):* no move in W15 drove the road graph; the page's three `ride` moves are
  vehicles on the walk grid. Two vehicles were moved as people up stairs: unit 154's car, by a layout note ("floor 3,
  stated"), walked 135 m round the block and up an office tower to floor 3 (the still that looked like the Darts Bar's
  rooms is that tower); unit 179's van ran up six floors by the on-foot way a ride falls back to (meant for a rider who
  gets off). Fixed in the director: a vehicle that rides and does not fly never takes a path that changes floor (a road
  drive and a blow's throw excepted); such a move is held (L10) or, for a quiet layout move, left unplayed, and a rider
  who goes on up the stairs leaves the vehicle where it stands.
  *Evidence:* engine tests 184 of 184; the first quarter's rehearsal identical with and without it (236 moves, the
  same laws, the same report); units 150–180 rehearsed with and without it: before, unit 154's car went to "a wall of
  the shop (4 floors), floor 3" and to the 144-floor office's floor 3; after, those two moves are left unplayed and the
  car keeps to the street (77 → 75 moves, laws unchanged). A cached replay of W15 cannot check it: Jev's cache key holds
  the pictures, which render a little differently each run (the replay stopped at the first question, unpaid).

## Evidence and cost, as they land

| Step | Date | Tests | Evidence | Model calls | Cost |
| --- | --- | --- | --- | --- | --- |
| Scratch test of models as code | 2026-11-09 | none (scratch) | 5 of 5 closed solids; the turbine failed the ground check twice, then passed; 4 of 5 in several pieces | 6 work-model requests | about 10,500 tokens |
| M8a world generator schema | 2026-11-09 | world-schema 6/6, engine 184/184, TS 829/830 (1 old) | first-quarter rehearsal identical before and after (page and report) | none | none |
| M8b–c settings commands, fill operators | 2026-11-09 | settings-commands 4/4, fill-ops 3/3 | overrides took effect on a copy (arterials 24 m, 2,110 props); first quarter identical with none | none | none |
| M10a–c models as code | 2026-11-09 | models 7/7 | 23 of 23 of volume 1's nominated things pass the contract (12 first run, 19 after the scaled rule, 4 rewrites) | 62 work-model requests | $0.108 |
| M10d warehouse | 2026-11-09 | | 17 of 135 small things bound to a kit part, 117 none | 9 | $0.020 |
| M10e–f, M11 | 2026-11-09 | Pi skill loader 7/7 | first quarter with models: laws identical; 2 landmarks drawn, their lots' heights from their models | 2 | $0.004 |
| M8d handles + profiles, M10g–i warehouse | 2026-11-09 | warehouse 5/5, sim-settings 2/2, settings-commands 4/4, schema 6/6, engine 184/184 | first quarter identical with no override; the pine drawn for 1,944 trees; panels on a host list 75 keys and 807 parts | none | none |
| W15 paid volume 1 | 2026-11-09 | | 286 of 286 scenes after one crash fixed (1c354b8); laws L6 6, L9 3, L10 7 (W14: 5, 3, 7); 23 of 23 models drawn; no road drive (two vehicles walked up stairs: fixed after); 127 held | 516 + 224 Jev, 255 + 58 system 2 | $0.15 rerun + about $0.07 crashed attempt + $0.13 models = about $0.34 |

