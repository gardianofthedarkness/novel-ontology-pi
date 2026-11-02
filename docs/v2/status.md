# Where v2 stands (2026-11-01)

| Stage | Step | Status |
| --- | --- | --- |
| Extraction | The reading flow | **done**, run on vol 1 end to end |
| Extraction | The place tree, the world script, pools | **done** |
| World engine | Terrain | **done**: run 11 (commit `44cf6a1`, tag `terrain-run11`) |
| World engine | Borrowing and spawning by type | **in progress**: city to building level built (M0–M5), growth across books next; [design](borrow-and-spawn.md), [milestones](milestones.md) |
| World engine | Spawning positions | next |
| World engine | Movement and simulation | later |

## Extraction — done

Every scene is read once. The sentences go to scene tiling, sentence kinds and listing at once; then EM batch by batch,
the card scan, each scene's context, story time and EM². Each Jev request is a structured state composed by the context
engine (world-engine-v2.md §1). What it gives the world engine:

- **Who:** EM (which entity each name is) and EM² (who says or does each line, who each description of a person means).
- **What happened:** the fact ledger as the evidence of both EMs, with the action rule and crowds; only named things,
  vehicles and weapons; concepts and their owners.
- **When:** story time, the calendar and the time tree.
- **Where:** places in EM, the place tree at its scales (a city, a district, a street, a building), spatial words that are
  no places of their own, and the world script: each scene's place and who is there.
- **What the text leaves open:** sampling pools, so a city the text barely describes still gets districts and streets of
  the right kinds.

## World engine, step 1: terrain — done

Part by part, from the cities down to their streets: Jev is asked what each place is (its kind) and how high it rises,
with the scenes around its name and two pictures of the world as it stands. The program then sizes the area by its pins,
places it, settles the part, and lays its streets; World · Live shows each step, pins green when settled, yellow while not.

Run 11 on vol 1 (the user's call: "near perfect"): 28 parts in 57 Jev calls, about 348,000 input tokens. Areas came out
32–640 m from the spot the text suggested; the largest kept offset from its holder is 1,026 m. Published at
[/terrain/](https://gardianofthedarkness.github.io/novel-ontology-pi/terrain/).

What the terrain step learned, kept as rules:

- **A prompt carries the place's own text.** The sentences around its exact name in its five best scenes for the question
  (15 in all); facts and surroundings only when they are about that place. Whole scenes overflowed Jev's state; one best
  scene was too narrow; the city's facts in a district's prompt misled it.
- **Placement never reads the built world's own positions.** The canvas takes a kept area's offset only as a direction and
  packs places apart; placing by those drifted positions fed back into the canvas and pushed streets kilometres out (run
  10, reverted). Placement works from each holder's node plus its kept offset.
- **Pictures are framed to what they ask about**: 95% of the part's elements in view, the map turned (every 3°) to fit them.

Open on terrain, not blocking the next step: the canvas places a kept district by direction rather than at its exact
offset, so an outline can sit beside its towers; the fix is for the canvas to honour the kept offset (`bear` in
`src/v2/world/placeCanvas.ts`).

## World engine: borrowing and spawning by type — in progress

Today every unnamed mention becomes an area of its own in a pool, so a city grows with the number of scenes; over 20
books it would not stop. The user's redesign (2026-11-01): each type spawns its children by a configuration file, a place
borrows a slot of its type in its parent or spawns one, level by level in narrative order, under the characters'-travel
objective. Unnamed mentions share slots, so only new names can grow a city. Design: [borrow-and-spawn.md](borrow-and-spawn.md);
progress: [milestones.md](milestones.md).

Built so far (M0–M5, 2026-11-01): a city born basic and deformed to Jev's kind, its districts and streets as manifolds
laid out by its topology, heights unified; a street's buildings as its form's lots, which named and unnamed buildings
borrow by their use; floating objects asked their distance from the ground and their thickness. The buildings are drawn
by one model table of CC0 kits ([model-kit.md](model-kit.md)); living areas are an East Asian megacity's
([living-areas.md](living-areas.md)). Next: growth across books (M6).

## World engine: spawning positions — next

Where each character and thing stands when a scene begins: the scene's place (the world script), who is there (EM²), and a
spot in that place's built ground. Designed in outline (visual-context-engine.md §5, world-engine-v2.md §4); its own
design comes first.

## Later

Movement and simulation: per-character actions over time, paths on the ground, what breaks (world-engine-v2.md §3–4).
