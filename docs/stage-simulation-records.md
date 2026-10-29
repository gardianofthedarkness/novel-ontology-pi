# Stage simulation records

What a strand's simulation produced (its buildings, things, motion and destruction) is kept with each book, so other sessions and tools can read it without running the player. The records are derived view data: never canon, never review packets, and private like the book they come from.

The engine itself is described in [stage-simulation-design.md](stage-simulation-design.md).

## Where

Everything is under `<novel-dir>/stage/`:

| File | What it holds | Made by |
|---|---|---|
| `simulation/index.json` | The strands recorded for this book: file, scene range, fork, title, export time, scene/hit/thing counts | the exporter with `--records` |
| `simulation/<strand>.json` | One strand's full record (below) | the exporter with `--records` |
| `objects.json` | Buildings and large visible things detected per scene, matched to a model or shape | `novel stage objects` |
| `thing-boxes.json` | Jev's model pick per thing, and per placement its spot choice, close-up or sky answers and cast | `playground/two-view-things.mjs` |
| `impacts.json` | Jev's impact choice per fight: the spot (or no damage), the size, the box asked for comparison | `playground/impact-choices.mjs` |
| `scale.json` | Each place's scale: region, city, district, street, building or room (Jev) | `novel stage scale` |
| `architecture.json`, `movement.json` | Each place's building kind; Jev's typed movement answers | `novel stage architecture`, `novel stage movement` |

On the stage demo host, the records currently exist for book 2 (`~/claude-stage-demo/state/vol-2/novel/stage/simulation/christmas-eve.json`) and book 3 (`~/claude-stage-demo/state/vol-3/novel/stage/simulation/kuroko.json`).

## A strand's record

Positions are in the place's own metres: x and z across its grid (2 m cells), y up (3 m floors). A unit is `[kind, i, j, k]` on its lot's grid, with kinds 1 corridor, 2 stair, 3 wall, 4 roof (k is the floor; the roof is k = floors).

- **`strand`:** id, scene range (`from`, `to`), `fork`, title.
- **`engine`:** the path-integral temperature `T`, turning cost `kappa`, climb weight `lambda`, and the run's counts (`notes`); `travel`: the map's own `T`, `kappa`, lattice `cell` and boundary `crossing` cost (μ, ν).
- **`people`:** name and colour per person id.
- **`buildings`:** per place id:
  - label, path in the place tree, `scale` (Jev's region, city, district, street, building or room), the kind it is built as (district, street, site), grid size;
  - its lots: label, detected name, role, model, footprint (`i0`, `j0`, `nx`, `nz`), floors, skeleton (one digit per cell: 0 mass, 1 corridor, 2 stair) and rooms.
- **`things`:** per thing: name, aliases, model or shape, detected size, and its placements. Each placement has its scene, event, place, base position, and fit: scale, turn, and extent in metres.
- **`migrations`:** who moved between places, scene by scene, and each one's `route`:
  - `exit`: the walk out of the old place, as its graph's nodes;
  - `path`: the curve across the place map, as points in map metres;
  - `entry`: the walk into the new place, as its graph's nodes, ending where the scene finds them;
  - `metres` across the map, and the place boundaries `crossed`.
- **`macro`:** the place map: each place's circle (`x`, `z`, `r`), its grid's centre (`spotX`, `spotZ`), and a region's own disc (`own`). Map metres are the stage's world metres: a place's grid is centred on its spot.
- **`scenes`:** per scene: its place, where each person starts, and its events. Each event has:
  - its summary;
  - its **moves:** person, how (walk, run, fall, jump, teleport, direct), the spot, and the path as points;
  - its **hit**, if any:
    - the impact `sphere` (centre and radius), and the event's `strength`;
    - per building reached: the energy, the units `blasted`, the units `fallen` (each with where it came to rest), and the skeleton cells destroyed, fallen and cut off from the ground.
  - **`hitThings`:** the things the hit broke.

## Making them again

```bash
node playground/two-view-things.mjs <strand-page.html> <novel-dir> --vendor <dir>
node playground/impact-choices.mjs <strand-page.html> <novel-dir> --vendor <dir>
node playground/export-strand-demo.mjs --set <strands.json> <out.html> --vendor --records
```

- The first two ask Jev (model picks and placements; impacts) and keep their answers, so a re-run only asks what changed.
- The strand page they read is the exporter's single-strand output with `--vendor`.
- The last writes the records and the page.
- `npm run build` first: the scripts load the compiled modules.

## Rules

- **Records are derived view data,** never canon. Nothing reads them back into the ontology, and they never go to review.
- **They stay with the book:** private, like its text. Public pages get only summaries, names and places, through the exporter's guard against source quotes and private paths.
- **Read them, don't hand-edit them.** To change a record, change its inputs (Jev's answers, the engine) and export again.
