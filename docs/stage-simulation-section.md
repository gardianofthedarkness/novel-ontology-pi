# The simulation as its own section: limitations and checklist

The user's direction, 2026-10-28: running the animation is the product's game section, not a step of the analysis.
- It gets its own skill, its own frontend page and its own progress.
- The analysis data feeds it, and what a run produces feeds back as data.

This note records where things stand and a checklist for making it a fully automated process through the CLI. Nothing here is built yet. The engine itself is described in [stage-simulation-design.md](stage-simulation-design.md).

## Production, phase 1 (built)

The engine now runs as a product step; the engine itself is unchanged (`runStrand` in the exporter is its one entry point):
- **`novel sim strands <dir>`** ranks the book's story lines (timeline forks, as the engine walks them) by the scenes it would simulate.
- **`novel sim run <dir> --auto N | --strand <id> [--accept]`** runs the engine on them, no model calls, and keeps each as a versioned run with the player's data (`runs/<strand>/<run>.page.json`); a line's first run is its accepted one, a later one only with `--accept`.
- **`novel sim show <dir>`** lists each line's accepted run and whether it was made from the book as it is now.
- **The player in the app:** the host serves the engine's own page with the book's accepted runs inlined and three.js beside it (`play/?volume=N`, linked as **Simulation** from read mode and clips).
- **Pi:** `novel sim strands|run|show` are on its allowlist (`--auto` at most 5; never `--accept`, which is the user's), the checklist's stage section has a `simulation` step, and the novel-stage skill has its steps.

Still open from the checklist below: Jev's placement and impact pickers as Pi steps (they need captures), progress and a budget, the simulation as its own section rather than a stage step, and feeding runs back to the timeline and places views.

## Where it stands: limitations

1. **Tied to the analysis checklist.**
   - `novel checklist` ends with four stage items: scale, architecture, movement and the animation prep.
   - `novel stage prep` refuses until every other step is reviewed.
   - The `novel-stage` skill works the analysis checklist first.
   - So the animation waits on, and is reported as part of, the analysis.
2. **The new engine lives in a demo script.**
   - `playground/export-strand-demo.mjs` does the whole run: places composed from the place tree, the per-fork walk, the path-integral sampler, placed things, damage, and the page export.
   - No `novel` command runs it.
   - Its output is a page, not data.
3. **Strands are picked by hand** (`--from`, `--to`, `--fork`), and the strand list for a page is a hand-written JSON (`--set`).
4. **Stand-ins** where the design calls for a Jev question or a capture:

   | Now | Designed | State |
   |---|---|---|
   | Destinations from Jev's typed spot answers (`stage/movement.json`), mapped by `placeSpot` | Two-view destination boxes on captures, back-projected to cells | not built |
   | Direction from the path between spots | The 18-option direction ask per person per event (`src/digger/stage/directions.ts`) | question built, never asked |
   | Direct moves from power words in the summary | The direction ask's `direct-*` options, held to textual evidence | question built |
   | Damage box around the event's first actor | One Jev box per event on a capture, then 2D→3D | not built |
   | Damage strength from the embedding axis; damage words when a book has no event embeddings (book 3) | The embedding axis everywhere | embeddings missing for some books |
   | Things placed beside the event's first actor | Jev points on an auto-scaled top view | not built |
   | Named things grouped by name tokens | The EM system for specially named objects (A.A.A., 姬蜂) | not built |
   | Detected buildings take free lots | Recognised big buildings shrink existing ones; outside the circle, a temporary unnamed district | not built |

5. **No estimate, budget or progress.**
   - A demo export takes about a second because it asks nothing.
   - A real run would ask Jev per person per event (direction), per destination (two captures), per damage event, and per placed thing.
   - There is no estimate, no budget, and no progress report. Resuming works only through caches.
6. **Results are not stored.**
   - Traces, migrations, damage states and placed things exist only inside the exported page.
   - The timeline page is not told about migrations.
7. **The frontend is a standalone page.**
   - `playground/strand-demo.html` gets its data inlined at export. It is not part of the app and does not read live data.
   - Its picker lists only what was exported.
   - Read mode (`?read`) and clips (`?clips`) still play the older `stage/plan.json`.
8. **Pi cannot run all of it.** The Pi guard allows `novel stage show|scale|architecture|movement|prep`; `objects` and `forks` are not on its list.
9. **Publishing is manual.**
   - github.io is a hand-made commit to `demo-live`, and claude.ai pages are hand-published.
   - Phones need three.js served beside the page; the CDN does not load on the user's phone.

## Target shape

```
analysis (novel checklist, novel-ontology skill)           simulation (its own checklist, skill, page, progress)
  facts, place tree, strands, scenes, cast,     ── snapshot ──▶  inputs → strands → buildings, things → questions
  architecture kinds, objects, embeddings                        (directions, destinations, damage) → run → export
        ▲                                                                         │
        └──────────── traces, migrations, damage (derived, never canon) ◀────────┘
```

The analysis ends at its own last reviewed step. The simulation reads a pinned snapshot of the analysis outputs and never runs analysis or review. It writes runs as derived data with provenance. Those runs feed the timeline and places views; they never become canon facts or review packets.

## Checklist for a fully automated CLI process

### 1. Split from the analysis
- [ ] Take the stage items out of `novel checklist`. At most, keep one read-only line there saying whether the simulation's inputs are ready.
- [ ] Add `novel sim inputs <dir>`, a hashed snapshot of what the simulation reads:
  - the place tree with paths;
  - story strands and forks;
  - scenes, events and cast;
  - architecture kinds;
  - detected objects;
  - event embeddings.

  It names what is missing and the analysis command that makes it. It never runs that command.
- [ ] Each run records its snapshot hash and engine version.
  - When the analysis changes, the scene keys (a Merkle chain over people's histories, `walkTimeline`) mark only the affected scenes stale.
  - A re-run walks only those scenes.

### 2. Its own CLI namespace (`novel sim …`; the name is open)
- [ ] `checklist`: the simulation's own steps with status, counts, estimates and the next command, like `novel checklist`.
- [ ] `strands`: lists forks with their scene ranges, places, cast and fights, and ranks them. `--auto N` picks the top N, replacing the hand-picked ranges.
- [ ] `architecture` and `objects`: moved from `novel stage`, same behaviour.
- [ ] `directions`: the 18-option ask per person per event in the strand's cast.
- [ ] `destinations`: two-view boxes on captures, back-projected to cells.
- [ ] `damage`: one box per event that damages anything; strength from the embedding axis.
- [ ] `run`: the per-fork walk with the path-integral sampler. It writes `<dir>/sim/runs/<strand>.json`: moves, traces, migrations, and each place's damage and things per fork.
- [ ] `show`: readiness, spend and staleness per strand.
- [ ] `export`: the static page (`--set`, `--vendor`, the guard against quotes and private paths), ported from the demo script.
- [ ] Every Jev step follows the pattern `stage movement` already has:
  - `--max-calls` bounds the run, and it reports `complete: false` when the budget runs out;
  - answers are reused while their inputs are unchanged, so a stopped run continues;
  - `--no-jev` is a free, flagged run.

### 3. Capture (shared sight)
- [ ] Render the player itself, headless, on the desktop layout:
  - the live view;
  - a view rotated 90° above ground;
  - a top view for the macro scale and for placing things.

  Store each capture with its camera pose, so the reader can open the capture and Jev's answer.
- [ ] Choose the renderer: headless Chromium running the same player, or three.js under node with headless GL. Same pixels as the reader is the requirement.

### 4. Replace the stand-ins
- [ ] Work through the table above in the design record's build order: capture first, then destinations, directions, the macro loop, and damage.
- [ ] Each replacement keeps its stand-in as the `--no-jev` path, marked as a guess in the report.

### 5. Progress and budget
- [ ] Write `<dir>/sim/progress.json` atomically per step: done and total, Jev requests spent and estimated, and the current strand and scene. `novel sim show` prints it.
- [ ] The Pi host serves the simulation's progress at its own endpoint, beside `/api/stage`, with its own live activity. The viewer shows it in a Simulation panel, separate from the review progress.
- [ ] The job file gets its own simulation budget block (books, strands, maximum requests), apart from the analysis spend.

### 6. Its own skill
- [ ] Add `skills/novel-sim/SKILL.md`, or rewrite `novel-stage`. The skill:
  - reads the job;
  - works only `novel sim checklist`'s next list;
  - never runs analysis or review;
  - stops and reports when inputs are missing;
  - reports per strand: moves, unreachable moves, Jev spend, and what is still a guess.
- [ ] Pi guard: an allowlist for the `novel sim` verbs with bounded options (the `objects` and `forks` gap closes with it).

### 7. Its own frontend page: the game section
- [ ] Port the player (`playground/strand-demo.html`) into the app as its own page, for example `?play&book=N#strand`.
  - It reads runs from the host API instead of inlined data.
  - The picker comes from the list of runs.
  - Progress shows while a run computes.
  - three.js comes from the app bundle, not a CDN.
- [ ] Decide whether read mode and clips play simulation runs or stay on `stage/plan.json`.
- [ ] Keep the static export for github.io and claude.ai pages. Publishing stays a person's decision, never a step of the run.

### 8. Feeding back
- [ ] Store each run's traces, migrations, damage and placed things in the store as a derived layer with provenance: run id, snapshot hash, engine version and seed. Never canon, no review packets.
- [ ] The timeline page shows migrations between places. The places view shows each strand's damage and things.
- [ ] Open: whether the analysis may read simulation results as hints (where someone probably is), and how such hints are marked.

### 9. Determinism, tests and safety
- [ ] Seeds come from the scene keys, so the same snapshot and engine version give the same samples. `--resample` asks for a new draw; sampling is the semantics, so a new draw is a different outcome, not a fix.
- [ ] An end-to-end CLI test on an invented book with a scripted Jev, like `test/stage-environment.test.ts`.
- [ ] The public export keeps its guard: summaries, names and places only, no source quotes, no private paths.
- [ ] Missing event embeddings are reported by `novel sim inputs` with the command that makes them. A run without them is marked in its report.

## Open decisions
- **Name:** `novel sim`, or a new `novel stage` that drops the read-mode prep.
- **Budget:** one job file with a simulation block, or a separate simulation job.
- **Where the page lives:** a page of the playground app, or an app of its own.
- **Read mode and clips:** whether they become consumers of simulation runs.
- **Interactivity:** later phases, such as a reader steering a person or forking a "what if" strand, would make runs depend on the reader as well as on the snapshot.
