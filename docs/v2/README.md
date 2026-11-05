# v2: a guide by stage

v2 has two stages. **Extraction** reads the book into a world model; the **world engine** builds that world: the terrain
first, then where everyone stands, then how they move. Each part below goes from the concept (on the
[concept map](concepts.html), grouped by the same stages) to where it is designed and where it lives in code.

Where each step stands: [status.md](status.md). What changed in v2, for a teammate: [whats-new.md](whats-new.md).
What comes next, two tracks in parallel ([next-steps.md](next-steps.md)): A, the summarization layer (a work model's card and
scene digests and memory); B, [the world and the ontology as one loop](world-ontology.md) (system 2, the physics law
engine on every answer, a main agent's review with a high-privilege CLI, the world's evidence back into the ontology).

The director as faculties and specialists (Track A, A4–A5): [directing/Directing.md](directing/Directing.md), a page per
faculty and per director, how each is asked and what it may answer, all written from the code
(`node world-engine/director/directing-vault.mjs`). `docs/` opens as an Obsidian vault: standard markdown links, HTML
dashboards listed beside the notes.

The four design documents are journals: each section was written when the user decided it, dated, in the order of work.
Read them by the sections named here rather than from the top.

| Document | What it holds |
| --- | --- |
| [world-engine-v2.md](world-engine-v2.md) | The main journal: the structured-input principle (§1), extraction (§2.0–2.0.12), the terrain's design calls (§2.0.13–2.0.22), the world loop, movement, order of work |
| [context-engine.md](context-engine.md) | One engine composes every Jev request: modes, sources, ranking, budget |
| [world-model.md](world-model.md) | The world model and its laws (places a tree, matter a graph, time a tree); the engineering layers; place EM |
| [visual-context-engine.md](visual-context-engine.md) | What Jev sees (one renderer, the zoom engine), debugging by display, terrain spawning (§5–5.11) |
| [borrow-and-spawn.md](borrow-and-spawn.md) | Borrowing and spawning by type (next): configured children per type, slots, the characters'-travel objective, why a city stops growing |
| [milestones.md](milestones.md) | Its milestones, level by level |
| [schema.yaml](schema.yaml) | The reading's output files, field by field |
| [concepts.html](concepts.html) | Every concept in its stage and layer, with its code and its design (made from `src/v2/concepts.ts`) |
| [street-compatibility.html](street-compatibility.html) | Which street kinds share ground, which uses their buildings take, which models stand for them (made from the code's tables) |
| [universe-snapshots.md](universe-snapshots.md) | A universe's library: its fixed paths, a snapshot before each book's first run (where a rerun starts) and after each run, sharing a run's result with another user (`novel universe`) |
| [album.md](album.md) | The book's pictures anchored on v2's own sentences by their words, its people's portraits, and where World · Live shows them |
| [introduction.md](introduction.md) | The book's introduction read before the book: standing facts, the cast's other names, people it names as one, portraits by elimination |
| [world-engine.html](world-engine.html) | The reader's version of the journal up to the terrain's start |

## Stage 1: Extraction — done

From the book's sentences to a world model: what the text says, who each name and each line is, when it happens, where.

| Step | Design | Code |
| --- | --- | --- |
| The reading flow: scene tiling, sentence kinds, listing and typing | world-engine-v2.md §2.0, §2.1 | `src/v2/extraction/flow.ts`, `listing.ts`, `typing.ts`, `base.ts` |
| EM (which entity a name is) and EM² (who is this, here) | §2.0, §2.0.1; world-model.md §5 | `em.ts`, `roles.ts` |
| Facts, the action rule, crowds; things; concepts | §2.0.2–2.0.4 | `facts.ts`, `readingGraph.ts` |
| Story time, the calendar, the time tree | §2.0.5, §2.0.6 | `time.ts`, `hints.ts` |
| Places in EM, the place tree, scale, spatial words | §2.0.8, §2.0.10; world-model.md §2.1, §4, §5 | `placeEm.ts`, `placeRecommend.ts`, `spatial.ts` |
| The world script (each scene's place, who is there) | §2.0.9 | `script.ts`, `canon.ts` |
| Sampling pools (what the text does not nominate) | §2.0.11, §2.0.12 | `pools.ts` |
| The context engine and its reading and place modes | context-engine.md; world-model.md §6 | `src/v2/context/engine.ts`, `readingModes.ts`, `placeModes.ts` |
| The code rules and the language profile | world-model.md §3 | `src/v2/rules/` |

Runs: `experiments/v2/read.mjs` (the reading), `workspace.mjs` (a world-first workspace from it), `inspect.mjs` (the
reading as a page, private), `compare.mjs` (two readings side by side), `time.mjs` (story time again).

## Stage 2: World engine

### Terrain — done

Each place's kind and height asked of Jev, part by part (a city, then its districts, then its streets), with two pictures
of the world as it stands. The program sizes each area by its pins, places it as one optimization, settles the part, and
lays its streets.

| Step | Design | Code |
| --- | --- | --- |
| The loop for one part, what it keeps | visual-context-engine.md §5.1–5.6 | `world-engine/terrain/terrain-spawn.mjs` |
| Kinds by level, how high, the median and its manifold | §5.7, §5.8 | `src/v2/context/terrainModes.ts`, `src/v2/world/landscape.ts` |
| Pins as suggestions, compatibility, street forms | world-engine-v2.md §2.0.13–2.0.15 | `terrainModes.ts` (`OVERLAPS`), `src/v2/world/placeCanvas.ts` |
| Buildings, shells, the underground | §2.0.16–2.0.18 | `src/v2/world/useModels.ts`, `underground.ts`, `cityFill.ts` |
| Free ground, sized by pins, placement as one optimization | §2.0.20, §2.0.21 | `src/v2/context/zoom.ts` (`sizeByPins`, `placeArea`, `roomFor`) |
| Settling, pins that say what is settled | §2.0.22 | `zoom.ts` (`settle`), `world-engine/view/strand-demo.html` |
| What a terrain question carries: the scenes around the name | visual-context-engine.md §5.10 | `terrainModes.ts` (`sources`) |
| Pictures the places fill, turned; common sense | §5.11 | `zoom.ts` (`fillFrame`), `terrain-spawn.mjs` |
| The zoom engine, pins not circles, the live view | §3, §4.1, §5.9 | `zoom.ts`, `tools/pi-review/sim-world.html` |

Run: `node dist/src/cli/cli.js sim terrain <novel-dir>` (one part per step; `--run` for all), watched in World · Live;
`experiments/v2/terrain-replay.mjs` writes the replay. The run of record is run 11 (tag `terrain-run11`), published at
[/terrain/](https://gardianofthedarkness.github.io/novel-ontology-pi/terrain/).

### Borrowing and spawning by type — next

The user's redesign of how places get their areas (it replaces sampling pools, §2.0.11–2.0.12): each type spawns its
children by a configuration (`config/terrain/`), a place borrows a slot of its type in its parent or spawns one, level
by level in narrative order, keeping the characters' travel least. Design: [borrow-and-spawn.md](borrow-and-spawn.md);
progress: [milestones.md](milestones.md).

### Spawning positions — next

Designed with the user (2026-11-01): [spawning.md](spawning.md).

Where each character and thing stands when a scene begins, on the terrain the first step built: the scene's place from the
world script, who is there from EM², and a spot inside the place's built ground. Terrain spawning was designed as "the first
faculty of the spawning department" (visual-context-engine.md §5); the units and destinations it leads to are in
world-engine-v2.md §4.

### Movement and simulation — later

Per-character actions over time, paths on the ground, what breaks: world-engine-v2.md §3–4, and the earlier designs it
builds on ([stage-simulation-design.md](../stage-simulation-design.md), [world-first-design.md](../world-first-design.md)).
