# Places phase 2: the holo stage (exploration)

A place replayed like a game, inside its phase 1 hologram. Open it from orbital
**Places** (▶ Enter for a selected place, ➝ Journey) or with a deep link:
`?holo=<place id or name | journey>&holoMode=diorama|cutscene|journey&holoBeat=<n>&holoPause`.
View only: nothing here writes to the archive.

## Three designs

| | Diorama | Cutscene | Journey |
|---|---|---|---|
| Feels like | a tactics game on a holotable | a visual novel / JRPG cutscene | a strategy game's campaign map |
| Camera | slow orbit over the place (drag to turn) | low establishing shot: the speaker in front, the building rising behind | high over every place of the universe |
| People | pawns in each person's colour, name plates | pawns, portraits by the dialogue box | pawns standing at their latest place |
| A beat shows | event card · speech bubble · red face-off with a lightning arc | dialogue box (quote first, then the record) · VS splash | scene card · glowing arcs for trips, newest brightest |
| HUD | party roster, quest log, replay timeline | letterbox, dialogue box, timeline | roster, log, timeline (trips amber) |

On a phone the stage keeps the scene, the timeline and the dialogue; the roster
and log fold away.

## What drives it

`holoScript.ts` turns the archive into beats. Nothing is invented for the view.

- **Scene card:** one per scene, in story order.
- **Records:** the scene's events and dialogue, in reading order.
- **Dialogue:** a dialogue card and the event telling the same moment become one beat.
- **People:** each record names its people, in the order the text names them.
- **Speaker:** whoever is named just before a speech verb (说/道/问/开口 …), because a card lists its people, not who talks.
- **Quotes:** only words after a speech verb count, so a quoted nickname (“恶宠饲养家”) is not speech.
- **Aliases:** "白井" and "白井黑子" are one person.
- **Conflict:** a keyword guess for now (a Jev yes/no is the obvious upgrade).
- **Journey:** runs on scene presence alone, so it spans every book.
- **Same-name places** (学园都市 ×3, not yet merged in the universe) are one stage and one building.

## Movement inside a building (Jev)

Each kind of building carries a **nav grid** (`holoNav.ts`): named spots and the
ways between them.

- **Tower:** street, front door, 1F … 6F, a stairwell through every floor, roof, back door, back alley.
- **Other kinds:** church, station, market, park, castle, village and district each have their own grid.

The spots sit in the hologram's own box, which the stage scales up 2.2× so
there is room to move inside.

`apps/playground/tools/movement-pick.mjs` asks Jev, which answers typed questions
only (no text), for the movement chain of a place.

1. **Where each person starts each scene:** a choice of spot, given the scene's opening.
2. **Who moves in each event:** a yes/no per person present. Everyone's current spot is part of the question, so the moves chain.
   - Someone the event names moves on an even chance.
   - Anyone else, such as an unnamed "大叔", moves only above 0.8.
3. **Where to, and how, for each mover:**
   - The destination is a choice of spot, and a mover always ends somewhere else.
   - The manner is one of walk, run, sneak, climb up, go down, fall, teleport or dragged.

The stage then walks each pawn along the grid's shortest way at its manner's
speed. Falls drop straight down and teleports blink. The scene's moves so far
stay drawn as a chain, with spot labels and a "➝ 5F · teleport" chip on each mover.

On 废弃大楼 (book 3, 6 scenes, 50 beats) it took 60 Jev calls at about 78 ms each and produced 13 moves:

- 白井 and 乐丘 take the stairs up to 2F together.
- 白井 teleports to 6F (her ability).
- 乐丘 "冲过头摔落", falling to the street.
- 滨面 runs down and out, tries the back door, then runs out front.

What is still rough:

- Starting spots default to 1F or the street too often; 滨面 starts on 1F though he is on the TV floor.
- Dialogue-only beats rarely move anyone.

### Checking the chain physically (exploration)

The rule: **if a scene does not say where someone starts, they start at the
centre of the building** (`centreSpot`: a middle floor of a tower, the nave of
a church, the plaza of a district). Then the chain of their moves is checked
backwards (`solveChain`, Viterbi over the nav grid):

- **Questions per mover:** Jev also answers which way they go: up, down, same level, out of the building, into the building.
- **What a move needs:**
  - Going down or falling needs a start higher than where it ends.
  - Climbing needs a start lower.
  - Leaving needs a start inside.
  - Going underground is unlikely unless a step says so outright.
- **Revising the start:** when a later move cannot follow from the assumed start, the start is revised, with the reason (for example "climb up to 3F needs a start lower").
- **Dropping a move:** each step may also mean "did not move", weighted by Jev's who-moves probability. A move that cannot physically happen from anywhere likely is dropped instead of bending the whole chain.
- **On the stage:** "? 4 people at the centre — the scene does not say where", "↶ starts 2F: climb up to 3F needs a start lower", and "➝ 6F · teleport (Jev: 3F)" when the chain overrules Jev's pick.

Findings on 废弃大楼:

- **Tell Jev only known spots.** Putting the assumed centre ("滨面 — 4F") into the question anchored Jev: nearly every destination became 3F/4F, including "碧海 falls … to 4F (1.0)". Unknown starts are now worded "somewhere in the building (not stated)", and the centre is used only for drawing and for the solver's prior.
- **Revision works on clear cases.** Before moves could be dropped, it revised 白井's start down to 2F ("climb up to 3F needs a start lower") and lifted 碧海's start to the roof because Jev said she fell to 6F. The second shows the risk: Jev's "fall" was wrong (she crashed into an acrylic tank), and the physics then faithfully put her on the roof.
- **"Did not move" makes it conservative.** With that option the chain keeps the centre unless a confident move contradicts it, and drops impossible low-confidence moves (乐丘 "falling" from the street up to 6F).
- **Answers vary between runs.** The per-event answers move between runs and sit near decision boundaries, so the prior and penalty weights (hand-set in `holoNav.ts`) matter.
- **Possible next steps:**
  - Ask with the whole scene as context instead of one event.
  - Use Jev's own confidence.
  - Treat recurring manners per person as evidence (teleport for 白井, falls for the 大叔).
  - Re-ask only the steps the solver overrules.

Plans are served per place at `api/holo-moves?place=<id>`. In this exploration
that endpoint is the design preview's snapshot host. Read mode (below) moves
the same work into the CLI and serves the prepared plan with `api/stage`.

## Read mode (desktop)

A **Read mode** link in the top bar opens the same page with `?read`.

- **Layout:** the book's text sits in a reading panel, and the hologram of the page's place fills the rest.
- **Waking a page:** a page wakes when the text has rested on it for about ¾ second, so fast scrolling wakes nothing.
- **The replay:** the page's records play once in its place, squeezed into about 10 seconds.
  - The sentences being played light up in the text.
  - The stage can't be touched during the replay; afterwards the reader can turn it, scrub it and click it.
- **Coming back:** a page already played opens at its last moment.
- **Frame budget:** the hologram draws frames only while something moves. On book 3 that was about 5,500 draw calls a second during a replay, and none while idle or while the text scrolls.

### Where the data comes from

Two Jev faculties and a last step, each a report under `<book>/stage/`. These are view inputs: no review packet, never canon. The steps are `novel stage architecture|movement|prep`, run on request in the order of the `stage` section of `novel checklist`. That section is never part of a book's `complete` or `next`, so the analysis loop never spends Jev on animation and a universe's atlas never waits for it. The stage reads reviewed canon only (a place awaiting review is not staged), and each paid step refuses while the analysis steps it builds on are unfinished, unless `--force`.

- **architecture:** each place's building, a sub-kind of place.
  - Runs after story time and the place tree, beside strands and causality.
  - The name shortlists up to four kinds; Jev then picks among pictures of them (`assets/architecture/<kind>.png`) under neutral option names.
  - A place that contains a district is a city, whatever its name suggests (学园都市).
- **movement:** who moves where, how and which way, per event.
  - Each scene's cast is who is present, read as the strands view and causality read it (the answered cast where "who is present?" was asked, else the recorded one), plus whoever its events record taking part. Someone only mentioned, or named in an event's evidence, is not on stage.
  - Needs the buildings picked, so Jev chooses among real spots. Answers are spot ids of the building's nav grid, so they are reused only while that grid (its spots, names, hints and ways) and the questions stay the same.
  - `--max-calls` is never exceeded: each scene reserves the most it can cost (its opening, then two calls per event) and gives back what it did not spend.
- **stage (the animation prep):** no model calls, and only once every other step is done and reviewed.
  - Every chain is checked physically, and the result is one plan per place.
  - Served at `api/stage`, with the text at `api/book-text?block=N`.

Answers are kept per place and per scene and reused while their inputs stay the same, so a later run asks only about what changed.

On a copy of book 3 (144 scenes, 9 places with scenes):

- **architecture:** 9 picture choices.
- **movement:** 121 scenes, 1,064 Jev requests in 17 s.
- **prep:** 0.4 s, giving:
  - 89 moves.
  - 32 moves where Jev picked the spot the person already stood on, so they moved within it.
  - 31 moves that could not physically follow, which were dropped.
  - 53 starts revised.

Places now carry an indoor/outdoor flag per spot: in a district, falling off a rooftop into the street counts as going "out".

### Stage clips (phones too)

A **Clips** link in the top bar (shown on phones as well) opens `?clips&book=N`: the book's prepared animation as a reel of short pieces, to see quickly what a book's animation looks like.

- **A clip** is one scene of one place, cut to its run of at most 9 beats with the most moves.
- **The picks:** the busiest scene of each building kind first, then the busiest overall, up to 10 per book, with a fair share per place; they play in reading order.
- **Playing:** each clip replays once in about 12 seconds, with the event (and who speaks) and its original sentences under the stage; then the next clip follows unless the reel is paused. Prev/next, a sideways swipe on the caption, or the clip strip jump around; after a replay the stage can be turned and scrubbed.
- **On a phone** the stage's own heading, event cards and speech bubbles stay hidden: the caption carries them, so they don't cover the people.

**A page to share.** `node playground/export-clips-demo.mjs <live-volumes.json> <out.html> [--catalog catalog.json] [--fragment]` (after `npm run build`) writes the same player and clips as one self-contained file (`apps/playground/clips-demo.html`, about 1.6 MB for books 1–3).
- Each clip keeps only its scene's beats (summaries and names), its place and the prepared moves.
- Quotes, sentence ids, the book's text, the archive and Pi are left out, and nothing on the page calls a host.
- Clips of one place share one stage script.
- `--fragment` drops the document wrapper for hosts that add their own (a claude.ai Artifact).

### Pi prepares it

Pi has a fourth skill, `skills/novel-stage/SKILL.md`: finish the book's checklist, then buildings, movement (budget about 1.2× the stage estimate) and prep. The runner lists it in `NOVEL_JOB.json` (`animation`) and asks Pi to read it before any Jev stage request. Refusals for running a step too early are `STEP_WAITING`, not `INTERNAL`.

Run by Pi on copies of books 1–3 (2026-10-28):

| Book | Buildings (by kind) | Scenes asked | Jev requests | Moves kept | Dropped / revised starts |
|---|---|---|---|---|---|
| 1 | city 1, none 1 | 69 | 678 | 40 | 17 / 31 |
| 2 | city 4, hospital 2, station 2, home 1 | 46 | 479 | 32 | 22 / 22 |
| 3 | city 5, tower 1, home 1, office 1, none 1 | 121 | 1,177 | 93 | 30 / 51 |

- Book 1's causality sweep still has about 40,000 pairs to examine, beyond any job's limits, so its prep refuses. Its plan on the demo copy was prepared with `--force`.
- Jev answered in about 85 ms (median), so a whole book's movement took 10–20 s.
- The first run hit a host bug: Pi's call observer rebuilt Jev's request headers and dropped the image opt-in, so every picture choice failed with a 400. The observer now passes that one header on.

### Jev's native box (explored)

Jev 1.14 can answer a `box` question: one target in an image, as top/bottom/left/right fractions. On the tower picture:

- **Landmarks:** it found the whole tower (0.48), the rooftop (0.60) and the front door (0.78) well.
- **Floors:** "the third floor" landed on 1F–2F (0.27). Counting floors is a job for code, not the box.

**Moves as boxes on two views (probe).** `stage-views.html?kind=…&view=front|side` draws a building straight from the front and from the side with a flat camera, floors labelled, and publishes the exact pixel ↔ world frame. A box's centre in the front view gives across and height; in the side view, depth and height. The two heights cross-check each other.

On the 11 moves of 废弃大楼 (`jev-1.14.0`, 10–11 requests, 134–166 ms each with two pictures):

- **Start and end boxes:**
  - **Paths, not spots:** for a climb or a run, Jev boxes the whole path, a tall strip over the stairwell from the ground to the roof. The strip's centre lands on a middle floor, so "滨面 runs down the stairs" read as 3F → 5F.
  - **Starts:** these sit on the ground floor or the door (the same 1F habit as text).
  - **Disagreeing views:** in "falls out of the back door" the front view puts him outside and the side view inside.
  - **Where it helped:** it caught "did not really move" well. Start = end in 7 of 11, including 4 of the 5 moves the physics check dropped.
  - **Height check works:** the two views' heights agreed 0.7–1.0 on most moves and 0.4–0.6 on the shaky ones.
- **The current spot ringed, end box only (≤ one floor):** Jev boxed the ring itself in 10 of 11 moves. A drawn marker anchors it just as "滨面 — 4F" did in the text.
- **Everyone in the scene drawn as a named dot:**
  - **Labels are read:** asked for the dot labelled with the mover's name, Jev boxed it in 8 of 11 front and 9 of 11 side views.
  - **The end stays on the own dot:** its end box stayed on the mover's own dot in 9 of 11 moves.
- **Everyone but the mover drawn:**
  - **Pulled to the others:** the end box went to the other people (白井's moves all landed on the 4F group).
  - **Paths, view by view:** single views sometimes traced the path, e.g. 4F down the stairwell to the door for "runs down the stairs", or down the back for "falls out of the iron door".
  - **Read as paths:** reading tall boxes by their end in the direction of travel put that fall on the back door. Still, only 1 of 11 matched the typed choice.
  - **Views pull apart:** the two views snap to different things, so their 3D average mixes unrelated answers.

Verdict for now: boxes do not replace the typed spot choices for movement.

- **A locator, not a planner:** the box locates what is drawn (people by name, landmarks), and an end box snaps to the nearest drawn referent.
- **Height is the weak axis:** counting floors and telling up from down is what movement needs most.

Possible next steps:

- **Find on a floor, not a floor:** a box on a top-down plan of one floor (which side, by the window, at the TV), where the typed choice has only one spot per floor and a 2D layout is natural for a box.
- **Calibrate spots once per model:** fix each model's spots to its drawing (the building's edges, its doors, its roof; floors spaced evenly between them in code) from front and side renders.
- **Leave movement as typed choices:** movement keeps its spot choices, which give the probabilities the physics check needs.
- **Caveats:**
  - Box needs `jev-1.14.0` (the CLI is pinned to 1.13), and TypeSafe calls it experimental.
  - It always returns a box, so pair it with a yes/no question.

## Toward simulation: the per-fork environment (in progress)

Movement is being rebuilt for simulation in later phases, not only for the animation. The design, decided 2026-10-28:

- **Everyone acts.** In each event, every person in the scene's cast is walked in turn, the event's actors first. Each acts on their own: one of 14 directions (6 axial, 8 cube diagonals), "same as someone already handled in this event", or no move. A destination follows.
- **Sampled, not searched.** The path is a sample from a discrete path integral over the place's walkable space, weighted e^(−S/T), where S is effort under gravity plus a turning cost. A sample is what happens, as in the real world; the animation shows one.
- **Buildings are built around their circulation, not drawn as random cells.** This follows the research on the math handout and a generation recommendation, both from 2026-10-28.
  - **Why random cells fail:** they cannot carry a scene.
    - A destination that has to happen to be open caps success at pⁿ.
    - Scattered stair holes fail: a two-floor house needs 5.6% openings even with every cell open.
    - The 14-direction cell threshold is 0.142, not about 0.20 as the handout said.
  - **What replaces them:** the hall or corridor, doors and stair cores come first, and rooms grow around them. Percolation stays only as a model for random blockages.
  - **Ends:** a move's end is picked from the reachable cells under Jev's box.
  - **The walk:** its temperature stays under a certified bound: T < 0.92 for buildings plus ground at λ = 8, κ = 1. Paths are drawn exactly with the h-transform.
- **Fights keep people close.** When two people fight but end too far apart, their earlier positions are recalculated backwards, the way scene starts are inferred.

The per-fork environment (`src/digger/stage/environment.ts`) is the part that does not wait on the math:

- **Forks:** the lane runs of the story strands, as the story view draws them.
- **World lines, not places:** each person's state goes from the last scene they were in to the next, and a scene holds only its own cast.
  - They keep their position when they were last at the same stage place.
  - They arrive afresh when they come from elsewhere.
  - A flashback starts afresh and hands nothing on.
  - Why not per place: carrying people through a place from the start of the timeline piles up everyone ever there.
- **The walk:** a scene runs once its people's earlier scenes are done, and independent forks run side by side (6 at a time by default).
  - A mover decides starts and outcomes. Later that is Jev's answers plus the path engine; for now, the tests use a scripted one.
  - "With" takes the leader's destination, or leaves the follower where they are when the leader stays.
- **Keys and reuse:** each scene is keyed by its inputs, the mover's version and the keys of the scenes its people come from.
  - A later run walks only the scenes downstream of a change, along the people it touches.
  - Each turn gets a seed from that key, so the same history samples the same way.

`novel stage lines <book> [--line <scene-id>]` shows it, with no model calls (a line is a fork of the timeline, not a `novel fork` branch). On the demo copies, before the stage read presence only:

| Book | Scenes (staged) | Lines | Splits / merges | People per scene, max | Per place if carried from the start, max | People entering scenes: stay / arrive / fresh |
|---|---|---|---|---|---|---|
| 1 | 77 (69) | 14 | 4 / 5 | 8 | 29 | 224 / 3 / 30 |
| 2 | 84 (46) | 21 | 8 / 9 | 8 | 13 | 110 / 62 / 31 |
| 3 | 144 (121) | 29 | 13 / 14 | 7 | 42 | 216 / 117 / 47 |

Walking book 3 with a test mover takes 6 ms for 3,759 turns, so the environment adds nothing noticeable to a run.

### Generated floors (stage 1)

`apps/playground/src/data/buildingPlan.ts` generates one floor and its street from a spec and a seed.

- **Spine first.** A house gets a hall back from the front door; a short hall leaves one room across the back. A school floor gets a corridor along its length, with a lobby from the street.
- **Rooms and doors.** Rooms are cut from the bands beside the spine, the largest taking the first uses on the program. Every room opens onto the spine.
  - Public rooms (living, kitchen, lobby) may be walked through.
  - Two neighbouring public rooms sometimes get a door between them, a loop.
  - Private rooms (bedroom, bath, classroom, office) are only destinations.
- **Stair cores are reserved now,** one per house and one or two per school floor, because they couple floors. Their flights come in stage 2.
- **Checked as a walker would move:**
  - The movement grid has 0.5 m cells, with walls on cell edges.
  - Moving between rooms is allowed only through a portal, and a diagonal step only where both axial routes are free. That makes it exact for a 0.5 m body.
  - The certificate records, per room, the regions a walker passes from the street, through public rooms only.
  - Its failure codes are `core_does_not_fit`, `no_clear_door` and `unreachable_target`.
  - A failed candidate is redrawn from the next independent stream, at most 12 times, then reported with its failures.
- **Measured over 1,000 seeds each:** every plan passed on its first candidate. Construction guarantees the access, and the certificate re-checks it.

| Archetype | Rooms | Variation | Time per plan |
|---|---|---|---|
| House (12 × 10 m) | 6–8 | a living–kitchen loop in about a quarter | 0.55 ms |
| School floor (60 × 20 m) | 15–19 | a second stair in about half | 6.7 ms |

`planSvg` draws a plan: rooms by use, walls from the movement grid (so the gaps are doors), the entrance and stair cores.

Next:
- **Stage 2:** floors and stair flights.
- **Stage 3:** scene queries and the sampler (Jev's boxes over the plan, the h-transform walk, the backward pass for fights).
- **Stage 4:** lifts and districts.
- **The hologram:** drawing a generated plan.

### One strand, continuous (demo)

https://gardianofthedarkness.github.io/novel-ontology-pi/stage-strand/ plays book 2's Christmas Eve battle in 3D, start to end. It covers scenes 29–64 of the strand that starts at scene 6: Misaka and Shokuhou against Anna Sprengel across 购物美食大街, 第十五学区 and 第七学区. Built with `playground/export-strand-demo.mjs` into the `playground/strand-demo.html` player (three.js from a CDN).

- **Places from the place tree** (`placeGroup.ts`):
  - A street or district is composed of architectures: its building children take named lots, as 医院 and 地铁站 do in 第七学区, and generated buildings fill the rest.
  - Streets, alleys and a plaza join the lots.
  - Roofs are reached by stair cores, crossed by jumps over alleys, and left by falls.
- **Percolation:** clutter closes 12% of outdoor cells and 8% of indoor cells, never in a doorway. A draw that cuts a room off is redrawn; it took 1–2 draws per place.
- **Path integral** (`pathIntegral.ts`):
  - Each of the 64 moves is an exact h-transform draw at T = 0.355, which is 0.6 of the bound for 0.5 m steps with κ = 1.
  - 14 more draws of each move show the ensemble.
  - The bound reproduces the research's 8-direction figure (0.562562), and the sampler matches exhaustive enumeration on a small loop.
- **Persistence:** positions and headings are carried along each person's world line by the stage environment.
- **Not new yet:**
  - Where each move ends still comes from Jev's typed spot answers in the book's movement report.
  - Upper floors are outlines only; just the ground floors and roofs are walkable.
- **Size and speed:** 21 scenes, 217 events and 64 moves make 275 KB. The export takes about 5 s (43 field solves).

**Skeleton version (2026-10-28):**
- **Buildings:** the strand's places are now skeleton buildings (`skeletonPlace.ts`), so every floor is walkable: 26 of 63 moves climb to upper floors, up to level 8.
- **Damage:**
  - Combat events damage the building where they happen, in story order: 18 hits destroying 37 cells. Later scenes walk what is left, and what is cut off glows red.
  - How hard an event hits is read from its summary's wording, standing in for a Jev damage question.
- **Sharing:** shown privately first, before github.io.

### Skeleton buildings (exploration)

`apps/playground/src/data/skeleton.ts` models a building as its circulation only: corridors and stairs on 2 m cells and 3 m floors, with rooms as whole boxes attached to them. The lab is `playground/skeleton-lab.html`, built with `export-skeleton-lab.mjs`.

- **Corridors:** a cell is corridor with σ(h + a·axial + c·diagonal + v·above/below + f·facade), sampled by Gibbs sweeps (an auto-logistic field).
  - a > 0 lets corridors run on, and c < 0 keeps them one cell wide.
  - v makes floors resemble each other, and f leaves the facade to rooms.
- **Stairs are protected cores** (1–2 per building). When stairs could appear wherever two floors aligned, every aligned column became a shaft.
- **Conditioning:** the building is the street door's cluster, redrawn until the door reaches a core.
  - Over 200 seeds every building was accepted, after 1.7 / 4.1 / 2.5 draws on average (house / school / tower).
  - A building takes 0.3–22 ms to generate.
- **Rooms:**
  - A room is a box of free mass on one floor that holds a cell beside a corridor.
  - It grows a side at a time with σ(g − α(|R| − m̄)), so every room opens onto circulation.
  - Mass no room reaches stays solid: 10% / 35% / 13% of the house / school / tower.
- **Damage:** a hit of degree d at p loses each standing cell with q_d · exp(−|x − p|² / 2σ_d²).

  | Degree | q (loss at the impact) | Reach |
  |---|---|---|
  | scratched | 0.25 | 3 m |
  | damaged | 0.5 | 5 m |
  | heavy | 0.75 | 8 m |
  | destroyed | 0.95 | 12 m |

  Whatever stands but cannot reach the door is cut off (glows red), and so is any room whose corridors are all cut off.

Uniform damage (each circulation cell lost with chance q), 20 buildings × 40 draws each:

| Building | Measure | q = 0.05 | 0.1 | 0.2 | 0.3 |
|---|---|---|---|---|---|
| House | circulation reached | 87% | 74% | 57% | 44% |
| House | top floor reached | 85% | 72% | 53% | 37% |
| School | circulation reached | 49% | 26% | 11% | 6% |
| School | top floor reached | 62% | 34% | 15% | 7% |
| Tower | circulation reached | 46% | 20% | 5% | 2% |
| Tower | top floor reached | 50% | 20% | 3% | 0% |

The skeletons sit just above their percolation threshold: thin tree-like corridors and stairs in series. Small damage cascades, which suits a fight but may be too fragile. The knobs are more cores, loops (a less negative c) and a denser field h.

### Place system redesign (proposed)

An architecture becomes the smallest unit of place, and everything above it is a group built on the existing place tree, not a separate entity.

- **Groups and architectures:**
  - Jev types each non-leaf place as a group: city, district, street, plaza or campus.
  - Its building children are architectures.
  - A scene set at a group can be placed by Jev in one of its architectures or open spaces, or in an unnamed generated one added under that group.
- **Layout:** composed recursively, city → district → street or plaza → architecture.
- **Movement:** a move between two children is a walk in their parent's composed space.

## Open questions

- Should the CLI own movement extraction, recorded on events (spot, manner) with review like other facts, or stay a view-side proposal?
- Do the remaining kinds need hand-built interior grids (church nave / bell tower, station platforms), or is one generic storey grid enough?
- Conflict, speaker and alias detection could become Jev questions too, batched per scene the way movement is.
- The environment matches "the same place" exactly: someone last seen in a room arrives afresh in the building that holds it. Should a position carry across the place tree?
