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
| M8 | Option: configurations per universe, per place, or by a function or review | not now |
| M9 | With the simulation: shared slots split where they are damaged | with the simulation stage |

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

## M8 — Configurations of one's own (an option, not now)

- [ ] A universe's own files (`<library>/universe/spawning/`), a place's own under `places`, a function or a review by Jev or an agent (design §5)
- [ ] A region's living areas as a choice (the user, 2026-11-01): East Asian megacity now ([living-areas.md](living-areas.md));
      a European city, an American suburb as other profiles of the same heights, lots and model mixes

## M9 — Damage splits shares (with the simulation stage)

- [ ] When the simulation damages a shared slot, the sharers after that scene borrow again (design §2.8, option A); the text's own damage from a later extraction step (option B)
