# novel-ontology-pi

Turns a novel into a world you can watch. **Extraction** reads the book into a world model: what the text says, who says
and does each line, when it happens, and where every place and thing is. The **world engine** builds that world on the
ground, step by step: first the terrain, then where everyone stands, then how they move.

**See it:** the terrain step of vol 1, as Jev built it part by part:
[gardianofthedarkness.github.io/novel-ontology-pi/terrain/](https://gardianofthedarkness.github.io/novel-ontology-pi/terrain/).
The stages and their concepts: [/v2/](https://gardianofthedarkness.github.io/novel-ontology-pi/v2/).

## Where it stands

| Stage | Step | Status |
| --- | --- | --- |
| Extraction | The reading flow: scene tiling, sentence kinds, EM and EM² (who is this, here), facts, things, story time and the calendar, places in EM | **done** |
| Extraction | The place tree: places at their scales, the world script, sampling pools | **done** |
| World engine | Terrain: each place's kind and height, from Jev, placed as one optimization and settled | **done** (run 11, tag `terrain-run11`) |
| World engine | Spawning positions: where each character and thing stands when a scene begins | **next** |
| World engine | Movement and simulation: actions over time, paths, what breaks | later |

The detail, with what each step decided and why: [docs/v2/status.md](docs/v2/status.md). For a teammate catching up:
[docs/v2/whats-new.md](docs/v2/whats-new.md).

## How it is designed

- **The program does geometry; Jev does meaning.** Jev (the decision model) is asked what a place is and how high it rises;
  sizes, positions, overlaps and streets are computed. Nothing geometric is asked of a model.
- **Jev sees what the user sees.** Every terrain question carries two pictures of the world as it stands (a plan and a
  skyline), framed by the zoom engine to the part being asked about; the user watches the same world live.
- **Every Jev request is composed by one context engine.** No hand-built prompts: a request names its mode, and the engine
  gathers its sources, ranks them by the question, and cuts them to a budget.
- **Raw text, ranked by the question, and no filler.** A place's prompt carries the sentences around its exact name from
  its five best scenes (15 in all); facts and surroundings only when they are about that place; a section is left out
  rather than padded with the city's.
- **Pins are suggestions; placement is one optimization.** Where the text says a place is, it is pinned; the engine sizes
  each area by its pins, places it, and settles the whole part at once (distance, pins, overlaps and street forms in one
  potential). Pins turn green when settled.
- **Debugging by display.** Every step can be watched (World · Live, the replay); what the user sees decides what is fixed.
- **One concept map.** Every concept we invented is in [src/v2/concepts.ts](src/v2/concepts.ts), with where it lives in
  code and where it is designed; a stale pointer fails `npm test`.

## Where things live

```
src/v2/extraction/   the reading flow: EM, EM², facts, time, places, the place tree, the world script, pools
src/v2/context/      the context engine and its modes (reading, places, terrain), the zoom engine
src/v2/rules/        what code decides alone: the rules catalogue, the language profile
src/v2/concepts.ts   the concept map
world-engine/        the world engine's scripts: terrain spawning, the strand page, Jev's line, the world map
src/ground/stage/    the world's ground: the canvas of places, landscapes, lots, the underground
tools/pi-review/     the host and its pages (World · Live, the replay)
experiments/v2/      runs and pages: the reading, the workspace, comparisons, the concept and compatibility pages
docs/v2/             the design: start at docs/v2/README.md
docs/v1/             the v1 bundle's README and design (still runs)
```

## Running

```sh
npm install
npm run build
npm test                    # the v1 and v2 tests, the concept map included
npm run world-engine:test   # the world engine's own tests
```

The two models (a work model and Jev) are configured as in v1: see
[docs/v1/README-v1.md](docs/v1/README-v1.md#jev-key-management-jev-login--status--logout--ping). Then, on a book's
workspace:

```sh
node experiments/v2/read.mjs <novel-dir> <out-dir>                        # extraction: the v2 reading
node experiments/v2/workspace.mjs <novel-dir> <out-dir> <new-novel-dir>   # a world-first workspace from it
node dist/src/cli/cli.js sim terrain <new-novel-dir>                      # terrain, one part per step (--run: all)
node experiments/v2/terrain-replay.mjs <new-novel-dir> <out.html>         # the replay
```

Book text never leaves the workspace: the pages that hold it (the reading's inspect page, the replay) are private.

## v1

The v1 bundle (a Pi skill and CLI that turns a novel into a queryable ontology, with review, library, portraits and the
team playground) still runs. Its README is kept whole at [docs/v1/README-v1.md](docs/v1/README-v1.md); the docs index is
[docs/README.md](docs/README.md).
