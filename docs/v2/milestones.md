# Milestones: borrowing and spawning by type

The design: [borrow-and-spawn.md](borrow-and-spawn.md). The goal for 2026-11-02 (the user's): start at the city level,
run it, look, fix and run it again, then the next level, until it is clear whether the logic works down to buildings.

**The loop at every level:** run the level alone (`--from <level>` keeps the levels above it and drops the ones below),
look at it in World · Live, check the level's numbers below, fix, run that level again. Stand-in answers first (no paid
call); a real Jev run only when the user asks.

| | Milestone | Status |
| --- | --- | --- |
| M0 | Design, draft configurations, configuration test | done 2026-11-01, every decision taken (design §7) |
| M1 | Slots, borrowing and spawning in code; the bound tested; run from a level | core done 2026-11-01 (`src/v2/spawning/`, 7 tests); wiring into terrain spawning next |
| M2 | City level on vol 1 | |
| M3 | District level on vol 1 | |
| M4 | Street level on vol 1 | |
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
- [ ] Positions: today's settle with the spare term γ, over this book's slots
- [x] Greedy in narrative order, then moves (a name to a better free slot, two names exchanging, an unnamed mention to a better share): `chooseSlots`
- [ ] One mention at a time for the engine's step mode (borrow after each kind answer; the moves when the level ends)
- [ ] Slots in `terrain.json` and the universe's registry: type, owner name, sharers by book and scene (so a damaged share can split, §2.8), which configuration layer, kept offset
- [ ] `novel sim terrain <dir> --spawn [--from city|district|street|building]`, beside today's path until M7
- [x] Tests (`test/spawning-slots.test.ts`): the bound (§3) over 20 synthetic books (240 unnamed mentions: 14 districts, flat once names stop), names exclusive and permanent across books, same-scene unnamed apart, unnamed shares and damage cleared at a new book, the same order gives the same world

**Pass:** tests green; today's terrain path unchanged (its tests and a stand-in run as before).

## M2 — City level

- [ ] Cities typed as today; each city spawns its district slots by `city.json` when the city level ends
- [ ] World · Live: spare slots as grey pins ("dwelling · spare"); the step list says borrowed, shared, spawned

**Pass:** 学园都市 and 纽约, both metropolises, 6 district slots each, all inside their city; no pool district.

## M3 — District level

- [ ] 第七学区, 第六学区, 第十五学区 borrow; unnamed district mentions borrow; the swap pass; settle with spares
- [ ] Spare districts with their type's default terrain

**Pass:** no spawn on vol 1 (3 names within the quotas); every district inside its city; the characters' travel (tie·m)
logged before and after the swaps and the settle, and no worse than run 11's at this level; the largest kept offset
under the city's size.

## M4 — Street level

- [ ] Every district, spare ones too, spawns its street slots by `district.json`
- [ ] Vol 1's 21 street mentions (18 unnamed) borrow; unnamed ones share across scenes; streets held only by a city borrow among all its districts' slots

**Pass:** street areas within the bound; how many avenues the four 大道 became, and why; streets on their forms as
today; tie·m against run 11's; every street inside its district.

## M5 — Building level

- [ ] Street slots spawn building slots by `street.json` (density × area, uses by share)
- [ ] Named buildings borrow a slot of their use in their street (use from the language profile, else Jev); unnamed ones share
- [ ] The landscape fill builds the slots instead of a fill of its own

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
