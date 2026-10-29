# Stage simulation records

What a strand's simulation produced (its buildings, things, motion and destruction) is kept with each book, so other sessions and tools can read it without running the player. The records are derived view data: never canon, never review packets, and private like the book they come from.

The engine itself is described in [stage-simulation-design.md](stage-simulation-design.md).

## Where

Everything is under `<novel-dir>/stage/`:

| File | What it holds | Made by |
|---|---|---|
| `simulation/index.json` | The strands recorded for this book: file, scene range, fork, title, the accepted run and every run (below) | the exporter with `--records` |
| `simulation/runs/<strand>/<run>.json` | One run of a strand: its full record (below), never overwritten | the exporter with `--records` |
| `simulation/<strand>.json` | The strand's accepted run, where readers look | the exporter with `--records` |
| `objects.json` | Buildings and large visible things detected per scene, matched to a model or shape | `novel stage objects` |
| `thing-boxes.json` | Jev's model pick per thing, and per placement its spot choice, close-up or sky answers and cast | `playground/two-view-things.mjs` |
| `impacts.json` | Jev's impact choice per fight: the spot (or no damage), the size, the box asked for comparison | `playground/impact-choices.mjs` |
| `architecture.json`, `movement.json` | Each place's building kind; Jev's typed movement answers | `novel stage architecture`, `novel stage movement` |

On the stage demo host, the records currently exist for book 2 (`~/claude-stage-demo/state/vol-2/novel/stage/simulation/christmas-eve.json`) and book 3 (`~/claude-stage-demo/state/vol-3/novel/stage/simulation/kuroko.json`).

## Runs

Every export with `--records` keeps the strand's record as a run of its own, never overwritten. A run carries `run: {id, inputs, engine}`:
- `inputs`: a hash of what it was made from (the book's ontology files and the stage's answers: architecture, objects, movement, Jev's placements and impacts);
- `engine`: the simulation engine's version (`ENGINE` in the exporter; the walk's seeds come from the scene keys under it).

The same outcome exported again is the same run. Each strand has one **accepted** run: its first, or the one exported with `--accept`. The accepted run is copied to `<strand>.json` and named in `index.json` (`accepted`, beside the list of `runs` with their counts). A newer run stays a candidate until it is accepted, so what other sessions read does not drift with every export. A record from before runs became the strand's first run when the next export ran.

## What is ontology and what is not

What the book **says** about its buildings and large things is ontology, reviewed like any fact: `novel stage objects` proposes a named building as a place inside its scene's place (Location, PART_OF), a large thing as an Item named in its scenes (MENTIONED_IN), after the identity check (universal EM's rules, against this book and the universe's list of things, `<library>/cast/<universe>.things.json`). Pi reviews that packet before the animation prep.

What the simulation **chose** (lots, skeletons, paths, which cells broke, sphere sizes, fitted placements) stays in these runs: permanent and versioned, never canon. Destruction as a fact ("this event destroyed that building") has no relation in the ontology yet; until it does, it lives only in the runs.

## A strand's record

Positions are in the place's own metres: x and z across its grid (2 m cells), y up (3 m floors). A unit is `[kind, i, j, k]` on its lot's grid, with kinds 1 corridor, 2 stair, 3 wall, 4 roof (k is the floor; the roof is k = floors).

- **`strand`:** id, scene range (`from`, `to`), `fork`, title.
- **`engine`:** the path-integral temperature `T`, turning cost `kappa`, climb weight `lambda`, and the run's counts (`notes`).
- **`people`:** name and colour per person id.
- **`buildings`:** per place id:
  - label, path in the place tree, kind (district, street, site), grid size;
  - its lots: label, detected name, role, model, footprint (`i0`, `j0`, `nx`, `nz`), floors, skeleton (one digit per cell: 0 mass, 1 corridor, 2 stair) and rooms.
- **`things`:** per thing: name, aliases, model or shape, detected size, and its placements. Each placement has its scene, event, place, base position, and fit: scale, turn, and extent in metres.
- **`migrations`:** who moved between places, scene by scene.
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
node playground/export-strand-demo.mjs --set <strands.json> <out.html> --vendor --records [--accept]
```

- The first two ask Jev (model picks and placements; impacts) and keep their answers, so a re-run only asks what changed.
- The strand page they read is the exporter's single-strand output with `--vendor`.
- The last writes the records and the page.
- `npm run build` first: the scripts load the compiled modules.

## Rules

- **Records are derived view data,** never canon. Nothing reads them back into the ontology, and they never go to review. The canon side of the same things comes from `novel stage objects` and its reviewed packet.
- **Runs are kept, not replaced.** Accept a run on purpose (`--accept`); never edit or delete one by hand.
- **They stay with the book:** private, like its text. Public pages get only summaries, names and places, through the exporter's guard against source quotes and private paths.
- **Read them, don't hand-edit them.** To change a record, change its inputs (Jev's answers, the engine) and export again.
