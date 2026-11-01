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
- [x] Draft configurations: `config/spawning/city.json`, `district.json`, `street.json` (street densities read off today's landscapes)
- [x] `test/spawning-config.test.ts`: every kind one Jev can answer at its level, every use one the world knows
- [x] Decided: spares built and shown, a pinned slot visible to Jev (3); cross-parent ties at 0.3 (4); JSON, layered later (5)
- [x] Decided: damage by option A, terrain a book at once, the simulation splits damaged shares (1, §2.8); a new name spawns when its type's slots are all named, and a nominated place is permanent (2, §2.4, §4.5); unnamed shares and damage cleared for the next book (§4.5)

## M1 — Slots, borrowing and spawning in code (no model call)

- [x] Load the configurations through a resolver (defaults only for now; the seam for M8); spawn a parent's slots (a range picked once by a seed, kept): `src/v2/spawning/config.ts`
- [x] The rules (`admissible` in `src/v2/spawning/slots.ts`): a name takes a slot of its own; an unnamed mention shares, never with a mention of its own scene; spawn only as §2.4 allows; a place whose holder is higher up borrows under that holder (§2.5)
- [x] The level's choice energy: travel (cross-parent ties at 0.3) and pins, an unplaced slot costed where the engine would place it
- [ ] Positions: today's settle with the spare term γ at a level's end: moved to M3
- [x] Greedy in narrative order, then moves (a name to a better free slot, two names exchanging, an unnamed mention to a better share): `chooseSlots`
- [x] One mention at a time for the engine's step mode (`improve: false`, the level's earlier parts as fixed places), the moves when the level ends (`assigned`)
- [x] Slots in the universe's registry (`universe/terrain.json` `slots`), mirrored in the book's `terrain.json`: type, owner name, sharers by book and scene, damage, the configuration layer, kept offset, size; a slot no name owns kept as a site of its own (`by: "slot"`, `spare`)
- [x] The slot tree (`src/v2/spawning/tree.ts`): no pools; spare and shared slots as places; names and shares under their slots; read alike by terrain spawning and the export
- [x] World · Live: a spare slot has no pin, its name grey and only on the ground
- [x] `novel sim terrain <dir> --spawn [--from city|district|street]`, beside today's path until M7 (`world-engine/terrain-spawn.mjs`: each level ends with the moves, its spares placed, its areas' children spawned)
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

- [x] Topology in `config/spawning/city.json`: each city kind's rings and pairs (§8.2), checked by the configuration test
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

**Result (2026-11-01, stand-in answers, `--spawn --until city`):** `src/v2/spawning/topology.ts` (the layout),
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
- Seen: one city, its districts' and streets' names inside it.
- To decide: sharing has no limit, so six mentions of one kind piled onto one avenue (the risk of design §4.4: sharing
  makes travel free); Jev put the alley 12 m under the street (the gate allows the street level under the street); a shared
  street takes its first sharer's height (35 m here, though two sharers said 20 m); a district does not unify to its streets
  (only a city has its open ground kept).

## M5 — Building level

- [ ] Street slots spawn building slots by `street.json` (density × area, uses by share)
- [ ] Named buildings borrow a slot of their use in their street (use from the language profile, else Jev); unnamed ones share
- [ ] The landscape fill builds the slots instead of a fill of its own
- [ ] Heights asked as the type's standard plus Jev's offset (+0 always an option; negative under the ground), at every
      level of the tree (design §8.9; the user's idea): it changes every height question, so it may come with M3 instead
- [ ] Floating objects (an underground cavern, a raised ring, a floating platform): asked their distance from the ground and
      their thickness; inventions placed as shapes nominated whatever the text calls them; none of them in a manifold's
      average or in unification (§8.9)

**Pass:** buildings a street within 10% of density × area; every named building on a lot of its use in its street, or a
logged spawn; the world builds in about today's time.

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

## M9 — Damage splits shares (with the simulation stage)

- [ ] When the simulation damages a shared slot, the sharers after that scene borrow again (design §2.8, option A); the text's own damage from a later extraction step (option B)
