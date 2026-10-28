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

Two Jev faculties and a last step, each a report under `<book>/stage/`. These are view inputs: no review packet, never canon. The steps are `novel stage architecture|movement|prep`, run in the order `novel checklist` gives.

- **architecture:** each place's building, a sub-kind of place.
  - Runs after story time and the place tree, beside strands and causality.
  - The name shortlists up to four kinds; Jev then picks among pictures of them (`assets/architecture/<kind>.png`) under neutral option names.
  - A place that contains a district is a city, whatever its name suggests (学园都市).
- **movement:** who moves where, how and which way, per event.
  - Needs the whole file extracted, so each scene's cast comes from the cast-candidate scorer over the full character list.
  - Needs the buildings picked, so Jev chooses among real spots.
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

## Open questions

- Should the CLI own movement extraction, recorded on events (spot, manner) with review like other facts, or stay a view-side proposal?
- Do the remaining kinds need hand-built interior grids (church nave / bell tower, station platforms), or is one generic storey grid enough?
- Conflict, speaker and alias detection could become Jev questions too, batched per scene the way movement is.
