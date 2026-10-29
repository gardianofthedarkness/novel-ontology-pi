# Stage simulation: design record

Status: direction agreed 2026-10-28; partly built (see [What exists](#what-exists)). Companion to [places-holo-stage.md](places-holo-stage.md), which records the experiments.

The stage is being rebuilt for simulation in later phases, not only for animation. What happens is sampled, as in the real world, and the animation shows one sample.

## Principle: shared sight

Every faculty that decides something about the stage decides from the same views the reader sees. This covers Jev, a Pi agent, and the damage and destination faculties. Agent and reader attend to the same picture.

- **One renderer.** Questions are asked over captures of the live viewer: the same scene, buildings, people and labels. There is no special diagram or hidden coordinate system that only the model sees. A move's arrows and a destination's boxes are drawn on that capture.
- **Every ask is recorded.** It keeps the camera pose, the frame size, a hash of the image and the answer, so it can be replayed, audited and shown back.
- **Sync both ways.**
  - **What the model saw:** the reader can open the exact capture and see the box or arrow it picked.
  - **What the reader looks at:** the model can be asked about the reader's view.
  - **Disagreement:** both sides point at one picture.
- **Desktop renderer (assumption).** Captures come from the desktop layout of the viewer, rendered on this Mac, rather than the phone layout. This reads "the mac version" as the desktop viewer and still needs confirming.

## Two scales, one loop

The **macro** view is the places system as it exists: the orbital Places view and Journey.
- Places are spheres, with containment and connections between them.
- Trips are arcs between places.
- People stand at their latest place.

The **micro** view is a place's interior: its grid, its buildings and the people in them.

- **Grids exist only inside a view.** A place's micro layout is generated when the reader or a faculty opens it, from the place tree and a recorded seed, and dropped when out of view.
  - Persistent state lives on the place: damage, positions and the lots already given out. Grids hold none of it.
- **Macro is the same 3D world.**
  - Every place sits on its circle of the place tree (nested circles on the ground), with its buildings on top.
  - **The layout is automatic, the production one** (`placeTreeCircles` in `timePlace.ts`; the places map fits the same layout to its canvas). Nothing is placed or sized by hand:
    - each place reserves a disc as wide as its own content: its grid on the stage, its own scenes on the map;
    - a region that is itself a place keeps that disc above its children, never on top of them;
    - siblings pack together (places linked by moves sit closer), and a final settling pass guarantees no two circles at a level overlap.
  - When people move between places, the camera zooms out, shifts across and settles on the next place, as a hand on the mouse would. The reader can orbit at any moment.
  - A trace arcs between the circles for every move between places.
  - For a destination in another place, Jev boxes it on a top-down capture of this macro view.
- **Traces stay in the database.** The redesign moves the place system anyway, so each person's per-scene trace is kept as data: where they entered, moved and left, and every migration between places. The timeline page is notified of place migrations, so a person's move from one place to another shows there too.
- **The loop between scales:**
  - A move inside a place is decided and walked at micro scale.
  - A move to another place is decided at macro scale: the destination is boxed on a capture of the macro view, where places are visible as spheres and links.
  - The micro engine then walks the person out of one place and into the next.
- **Places move and change.** Extraction keeps revising the place tree. The macro view always works with whatever tree exists now. A micro layout regenerates only for the subtree that changed, keyed by place id plus a fingerprint of its children.

## Places grow with the story

Buildings are added as the story detects them, not fixed up front.

- **What a place holds at a story moment:**
  - the architectures named so far on the strand;
  - generated filler for the rest of its area.
- **Stable lots.** A newly named building claims a free lot, or takes over a generic one. Lots already given out never move, so earlier scenes replay identically.
- **The place-system redesign.**
  - An architecture is the smallest unit of place.
  - Jev types the groups above it (city, district, street, plaza) on the existing place-tree path.
  - Jev may add an unnamed architecture under a group when a scene needs one.
  - Nothing becomes a free-standing entity outside the tree.

## Things the text puts in a place

**What is detected today:**
- The time-place faculty extracts places (Location entities in the place tree).
- The stage's architecture faculty types each one as a building kind: a name shortlist, then Jev picks among pictures.

**What is not detected:** buildings and objects that events mention but that are not places, such as a tower seen in passing, a giant metal sphere or an airship.

**Proposed:**
1. **Detect** the physical structures and objects each event mentions, as words.
2. **Match the word to the model library** with the open-source embedder the project already runs locally (BAAI/bge-small-zh-v1.5, used by causality).
   - The match is against each model's names and description in Chinese and English: towers, skyscrapers, offices, a hospital, a station, a church, a market, a keep, a fountain, a windmill.
   - The nearest model above a threshold is used, drawn at random among that kind's variants.
3. **One ranking for everything.** The four pure shapes (an oval, a sphere, a box, a diamond) are ranked together with the library's models, and the best match wins, shape or building.
4. **Jev picks the model first** (user decision, 2026-10-28: a prior layer instead of the embedding's top match, which stays only as the fallback).
   - One choice call per thing, on a labelled sheet of every model the stage can draw: the Kenney buildings, plus the basic shapes box, oval, triangle, diamond and donut. A sphere is a kind of oval.
   - The model is then fitted as large as fits inside the cast its two boxes give:
     - a model keeps its proportions, scaling evenly and turning 0° or 90°, whichever fits larger;
     - a basic shape stretches to fill the cast;
     - a donut stands on edge in a cast taller than it is wide.
   - **First try** (9 things): plausible picks for 6. The helicopter became an oval, the small room and the long pipe boxes, and the station, a building and the lab wide blocks. The scaffolding and the torii became the market, and the rails a wide block. Confidence was low (0.15–0.54).
5. **Jev boxes where it goes, in a two-call mini loop** (user decision, 2026-10-28; it replaces the top-down pointing and the floating rule, which the user dropped as over-engineering). Each call is a box question (Jev 1.14: one bounding box as fractions of the picture) plus a yes/no on whether the spot is in the picture at all:
   1. **The reader's view** of the place at that moment.
   2. **A side view** of the same moment: turned 90° (left or right, drawn from the placement), lowered to a near-level look, and aimed at the first box, which is drawn in as a beam (everything that box could mean in 3D).
   - **The 3D box:** the points of the place both pictures show inside their boxes give the centre. The size is each box measured in metres at that depth: view 1's width across; view 2's width along view 1's line of sight, and its height. A thing that starts at the ground stands on it, and one higher up stays where the boxes put it.
   - **When view 2's box covers most of the beam,** depth along it is marked uncertain and taken as about the width.
   - **Built as a demo:** the player's capture mode (`?capture`, `window.__stage`) and `playground/two-view-things.mjs` (headless Chrome, `<book>/stage/thing-boxes.json`).
   - **First try** (book 3's Kuroko strand, 10 placements, 20 calls, 30 s): position and height are right for about half.
     - The scaffolding, the helicopter in the air, the long pipe, the lab, and the small room up in a building are plausible.
     - Things with nothing to fix them along the beam (in the air, or generic "building" mentions) get a whole-beam second box.
     - One box landed on a person's name label.
   - **Rotation sweep and a fourth call** (user question, 2026-10-29): the side view at six turns in one call (±45°, ±90°, ±135°, one box question per picture), keeping the turn Jev is surest of; when that is still under 0.5 or spans the beam, a top view aimed at the beam (a fourth call) joins the solve.
     - **Measured on the same 10 scenes:** mean box confidence by turn was −45° 0.21, +45° 0.17, −90° 0.17, −135° 0.16, +90° 0.14, +135° 0.11. No turn stands out.
     - ±90° spanned the beam least (5 and 7 of 10), as the geometry predicts. Every placement stayed under 0.5, so all 10 asked the top view (confidence 0.09–0.57).
     - The top view removed the 40–70 m casts: footprints are now 8–34 m. But it brought the helicopter to the ground (from above, nothing shows height), and the torii's three boxes did not meet.
     - Carving from all eight stills at once, weighted by confidence, was worse (30–57 m casts) and is kept only as a measurement.
     - Cost: 2 calls per placement plus the model pick, about 6 s per placement.
   - **Masking front buildings** (user request, 2026-10-29): each still fades the buildings standing between the camera and what it looks at (the beam, or the people present) to a faint outline, skeleton left out; a building the target is inside stays.
     - **Same 10 scenes, same model picks, all views asked again:** mean side confidence went from 0.16 to 0.18, and the reader's view from 0.25 to 0.26. The top view went from 0.26 to 0.22.
     - Side boxes spanning the beam went from 43 to 48 of 60, and solved placements from 9 to 8.
     - The helicopter stayed in the air this time (20.8–34.8 m), but the long pipe grew to 37 × 35 × 34 m. No systematic gain: the differences are within how much Jev's boxes vary from run to run.
     - **Reading:** a box question locates a thing that is in the picture. Here the thing is not drawn yet, so Jev's confidence stays near 0.2 whatever the view.
     - Likely better: draw the picked model at a few candidate spots (along the beam, beside the people), labelled, and ask a choice, where Jev reports its confidence.
   - **Candidates, then zoom, then boxes** (user design, 2026-10-29; now the default, `--method candidates`):
     1. **Spots from the scene, with no model call.** Anchors: the people (those moving in the event first); the buildings the event names (their roof and front); the open ground, sampled across the place; and things already there.
        - Each spot is the thing's footprint at its detected size, centred on open ground and mostly clear of buildings, standing on the ground (or on the floor or roof where its anchor is; 10 m up for a thing in the air).
        - A farthest-point spread keeps 8 spots, the first beside the first person.
     2. **Choice (call 1):** the reader's view with each spot as a lettered white ghost of the picked model, and "none" as an option.
     3. **Zoom (call 2):** four close-ups of the chosen spot in one call, a box on each: from the reader's side and from a low look turned 90°, each with only a ring at the spot and with the ghost drawn. The boxes are solved around the spot only, so a beam cannot make depth ambiguous.
     - **Same 10 scenes:**

       | Option | Confidence | Placed | Largest side ÷ detected size |
       |---|---|---|---|
       | Box loop, masked | about 0.18 | 8/10 | often 2–3 |
       | Candidates, choice only | 0.32 (2 "none") | 10/10 | 1 |
       | + zoomed boxes, ring | 0.44 / 0.40 | 10/10 | 0.65 |
       | + zoomed boxes, ghost | **0.55 / 0.47** | 10/10 | 0.6 |

     - The ghost close-ups are the default: Jev is surest of them, and its boxes do not just copy the ghost (they come out at about 0.6 of its size).
     - Example: the small interrogation-like room went beside 白井黑子 on the floor she stands on (choice 0.68), as an 8 × 7 × 2.5 m room 15 m up.
   - **Sky** (user request, 2026-10-29): the choice always offers "sky".
     - **When sky counts:** only when Jev gives it at least twice the probability of "none". Otherwise it is just a way of saying no ground spot fits: two generic "building" mentions picked sky at 0.24–0.28 against "none" at 0.20–0.21.
     - **Then two turns from two directions of the sky,** high up and looking down so the ground shows, with height poles (10, 20, 40, 60 m) beside the people as a ruler:
       1. **Find:** the air above the first person, wide. Box confidence was 0.03–0.06: empty sky gives Jev little to box.
       2. **Lock:** zoomed on what turn 1 found, with the ghost drawn there. Box confidence 0.62–0.74.
     - **First try:** the transport helicopter picked sky (0.27 against "none" ≤ 0.09) and was locked at 21 × 20 × 20 m, 39–59 m up. A building's weak sky pick (0.12) went back to its ground spot.
     - **Turn 1 is now a choice on sky ghosts** (user decision, 2026-10-29), the pattern that works on the ground.
       - The ghosts sit 15, 30 and 50 m up (at least 8 m above a roof) over the people (those moving first), over the place's middle and over the buildings the event names, spread to 8.
       - One choice on both sky pictures, the same letters in each.
       - Then the lock turn boxes the chosen ghost from both directions.
     - **The helicopter again:** Jev picked "over 白井黑子, 30 m up" at probability 0.35, with "none" at 0.06; boxing empty sky had given 0.03–0.06. The lock turn was 0.57 / 0.59, locking it at 22 × 17 × 19 m, 24–43 m up.
     - Only one thing in this strand is in the air, so this is one example, not a measurement.
     - **Height by choice, 2D position from above** (user decision, 2026-10-29): the sky ghost choice now only locks the height.
       - A top-down 2D map follows: orthographic, north up, centred on the chosen ghost and drawn at its height. One box on it reads directly as metres on the ground, the horizontal position and footprint. This replaces the two-direction lock turn.
       - The helicopter: picked "over 白井黑子, 30 m up" (0.30). The map box (0.61) locked a 21 × 12 m footprint, 30–41 m up.
     - **Universe:** the height choice also offers "universe", meaning not in this place's sky at all but out in space (a satellite, a ship in orbit). With the same "at least twice none" rule, it goes far above the place (150 m in the demo).
       - It is meant as a place of its own in the place system once that has one.
       - The helicopter gave it 0.00; nothing in this strand has tried it yet.
6. **Placement rules:**
   - **A recognised building makes room.** Placed on top of, or over part of, an existing building, the places engine shrinks the existing architectures, everywhere, to give it space.
   - **Outside the current circle,** a building gives birth to a temporary, unnamed district: a new circle.
     - It is hidden while other volumes are being processed.
     - It is visible when all timelines are selected.
   - **Packing:** districts and their circles pack like the ontology bubbles, scaling themselves to make room for their neighbours.

**Objects once placed:**
- **They sit still.** No spinning: an object rests where it was put, fitted to the box Jev draws. The box gives its footprint, and the matched model or shape gives its proportions.
- **Small objects** (small next to the buildings around them) never shrink the view.
- **Big objects** (not small next to the buildings) likely have structures inside.
  - They get a skeleton of their own and can be damaged like a building.
  - When one matches a building type in the library, existing buildings shrink to make room.
- **The library grows from its source.** Novels bring vehicles, aircraft, ships and machines. The library search should include more of the source the models came from (the Kenney CC0 catalog: vehicles, aircraft, space and so on), baked into the same int16 format.
  - The bake tool named in commit `9d988e0` (`tools/architecture-models.mjs`) was never committed; it needs writing again and committing.

**Objects are part of the world** (built for the demo, 2026-10-28):
- **One thing per named object.** Mentions of one named thing (A.A.A. and Anti-Art Attachment; 巨型姬蜂, 姬蜂型FIVE_Over and FIVE_Over Modelcase) become one thing.
  - For now the stand-in links names that share a distinctive token: a Latin word, an acronym, or a rare pair of characters.
  - The current EM faculty should decide these identities, as it does for characters.
- **Things move with the story.** A thing glides to wherever a later event puts it, across places too.
- **Big things (10 m or more) carry structure inside, automatically.** The 天桥, a train or a warehouse gets a small skeleton of corridors and rooms that hits break away.
- **Every thing is part of the walk.**
  - Its top is walked like a roof: landed on by sky arcs, crossed, left by falls.
  - A small thing (8 m or less) on the ground is walked around.
  - Bigger ones are raised structures.
  - A thing stands beside the actor whose event places it, so no one is walled in.
- **Damage:** events of strength 0.8 or more damage buildings and the things near them.
- **No other model datasets for now:** Kenney's current kits only.

**Persistence:** placed objects and each place's damage belong to the place on the strand, not to the scene in view. Once the story puts something there or damages it, it stays, through every camera glide between places, until the timeline is rewound before that moment.

**Library source for now:** Kenney's Car Kit and Space Kit, just for the demo. A searchable open-source model library would be better later.

**Variety:** every lot wears an artistic model (the Kenney CC0 kits baked in `architectureModels.json`), drawn per lot from its kind's variants. The walkable skeleton glows inside.

## Moves: 14 directions, and the sky

- **The direction ask** (`src/digger/stage/directions.ts`). For each person in an event (the scene's cast, the event's actors first), Jev picks one of 18 directions relative to the view, or "with" someone already handled in this event, or none. The 18:
  - **14 cube directions:** 6 axial and 8 diagonals, drawn as arrows at the person on the capture. The up-diagonals launch the person into the air.
  - **4 direct directions,** for the superhumans novels have: the person goes straight to the destination, ignoring gravity and walls. The question says to choose them only when the text directly says or shows this character using an ability for the move; without that evidence, never.
- **On the ground:** the path integral over the walkable graph, as now.
- **In the sky:** a direction with an upward part (up, or the four up-diagonals), with a manner that leaves the ground (jump, fly, thrown, blown), adds airborne edges.
  - Each is a ballistic arc under gravity, x(t) = x₀ + v·t − ½·g·t²·ŷ.
  - Its launch speed is bounded by what the person can do.
  - It lands where the arc first meets a surface: a roof, a street or a ledge.
  - Arcs are part of the same ensemble: their cost (launch energy, landing impact) enters the action, so the sampler weighs flying against walking.
  - This is where gravity changes the physics; on the walkable graph it only shows as climb cost and falls.
- **Capabilities.** Jump speed, flight and teleport are asked once per character, or read from the ontology. They bound the arcs: an esper who flies is not held to a jump's speed.

## Destinations: two views, two boxes

- **Two captures per destination ask:**
  - **View A:** the reader's current camera.
  - **View B:** the same target seen from a camera rotated 90° about the vertical axis, to a random side, above ground.
- **Jev boxes the destination on each view.** Each box is back-projected to a prism through its camera. The destination set Y is the walkable cells inside both prisms.
  - **Why two views:** the earlier probe found one box is weak on height. A second view at right angles fixes height and depth.
- **Fallbacks.** When the two prisms miss each other, the boxes are widened. Failing that, one view is used and the ask is recorded as weak.
- **Leaving the place:** the destination ask runs on the macro view's capture instead (see the loop above).

## Buildings: skeletons

A building is its circulation only: corridors and stairs on 2 m cells and 3 m floors, with rooms as boxes. Details are in `skeleton.ts` and the exploration notes.

- **Corridors:** a cell is corridor with σ(h + a·axial + c·diagonal + v·above/below + f·facade).
- **Stairs** are protected cores.
- **The building** is the street door's cluster, redrawn until the door reaches a core.
- **A room** is a box of free mass that holds a cell beside a corridor, grown with σ(g − α(|R| − m̄)).

## Damage

- **One Jev call per event:** a bounding box on the capture, drawn where the event damages something. No separate building or degree questions.
- **A 2D-to-3D engine** back-projects the box into the place and guesses the most plausible damaged region: the buildings it covers, on the floors it spans.
- **Strength from the event's embedding.**
  - The event's vector (from the causality faculty's sidecar) is projected onto the book's own destruction direction.
  - That direction is the difference of mean vectors between events that wreck things and events that fight nowhere: one direction in semantic space, read off like a lens.
  - It follows the family of interpretability work that treats concepts as directions in a representation space. The user pointed to Anthropic's published papers; the exact paper is still to be named.
- **Damage is a step down the building's percolation curve,** inside the region only:
  - Occupation drops by strength × 0.6, and reinforced stair cores lose a third of that.
  - What can no longer reach the ground floor is cut off. A blasted ground floor opens its own way out, so losing the street door alone no longer cuts off a whole building.
- **What it cuts off:** whatever stands but no longer reaches the street door glows red, and so does any room whose corridors are all cut off.
- **Damage persists on the place** and is applied in story order. A scene sees a hit only if the hit happened before it (happens-before across strands, not reading order).


**Impacts chosen like placements** (user design, 2026-10-29; `playground/impact-choices.mjs`): the fights the stand-in found breaking something are asked again, on pictures, the way things are placed.
1. **Where it hits (one choice):** the place just before the hit, from the reader's camera, with lettered red spheres at the likely impact points.
   - The points: the faces of the buildings by the fighters (those moving first), level with them; the nearest roofs; and the building nearest the middle between the first two fighters.
   - The options include "no damage".
2. **How big (one call):** close-ups of the chosen point from the reader's side and from the side, with concentric red spheres 4, 8, 16 and 32 m across, labelled 1–4, and one choice on both. The same call boxes the blast on a close-up with only the point marked, to compare a box with the choice.
3. **The damage:** every building the chosen sphere reaches loses a step down its percolation curve inside the sphere (`degrade()` now takes an optional sphere).
   - A blast reaches into the building it hits: chosen on a face, the sphere centres on that building's nearest standing cell, because the skeleton lies inside and a sphere on the face alone often touched nothing.
   - The strength still comes from the event's embedding.
4. **The animation follows the skeleton's change:**
   - Every cell the hit took becomes a fragment, launched from where it stood, out from the impact (faster near it and in a harder hit) and up, falling under gravity to rest on the ground.
   - The impact's sphere swells to its chosen size and fades. What the hit cut off glows red, as before.

**Buildings as structural units; the lowest stable shape after a blast** (user principle, 2026-10-29; `apps/playground/src/data/structure.ts`). This replaces the percolation step for chosen impacts.
- **Units:** a building's units sit on the skeleton's grid (2 × 2 × 3 m): its corridors and stairs, a wall on every outer cell of every floor, and a roof over the footprint.
  - Bonds: walls 1, roof 1.5, corridors 2, stairs 4. Stairs are no longer immune: they used to break at a third of the corridors' rate, so a hit through a stair tube looked like it missed.
- **Energy:** E = E₀ · s · (d / 8 m)³. It grows with the chosen diameter, not with what the blast touches; s is the event's strength.
  - A unit at distance ρ receives E / (4π max(ρ, ½ m)²). An 8 m blast at full strength breaks walls out to 3 m.
- **The shape after the blast** minimizes F = Σ_broken (b_u − e_u) + g Σ m_u y_u over shapes where every standing unit has a load path to the ground: down through the unit below, or sideways along its own layer (slabs, walls) for at most 2 units; a stair also hangs on the corridor beside it.
  - Breaking exactly the units whose energy exceeds their bond minimizes the first sum.
  - Every unit then left without a load path falls straight down onto the first support below and lies as rubble. Falling only lowers the potential energy, so one pass reaches the fixed point.
- **The player:** a building a structural hit reaches shows its walls and roof as units instead of its artistic shell, without the broken and fallen ones; fallen units lie as rubble.
  - During the hit, blasted units (wall panels among them) fly out, and fallen units drop straight down a beat later.
- **Book 2** (18 sphere hits): 303 units blasted, 34 fell.
  - 16 m blasts carry about 900 energy units and take 30–70 units each, walls and roofs mostly. The worst brought 19 corridor units down.
  - 8 m blasts (about 100) take 1–6, and their roofs or corridors fall where they lose support.
  - The blast centres on the struck building's nearest standing unit, so every hit, even the 4 m one, breaks what it touches.

**Book 2's strand** (22 fights, 40 calls, 64 s):
- **"No damage" for 4,** all fights that break nothing: a carry over a snowy roof, a leap over roofs, a throw into the air, pulling someone out of a fire. The stand-in had counted all four as hits.
- **Where:** choice confidence 0.27.
- **Size:** 8 m chosen 13 times, 16 m 4 times, 4 m once; choice confidence 0.27.
- **The box comparison:** box confidence 0.43; the box measured about 0.66 of the chosen size.
- **Damage:** 18 sphere hits took 69 cells (the stand-in boxes took 58); 17 of 18 hits broke something.

## Motion: the path integral

- Every walk from start to its first entry into Y weighs exp(−S/T). The action S adds metres walked, λ × metres climbed and κ(1 − cos θ) per turn.
- A walk is drawn exactly with the h-transform: solve h = Q·h + b once per (map, Y), then step with Q·h/h.
- T stays under the certified bound, 0.92 for 2 m steps at λ = 8 and κ = 1. The bound reproduces the research figure for 1 m steps.
- The mode (the least-action path) is a diagnostic; the sample is what happens.

## Timeline: the per-fork environment

- **People, not places, carry state.** Each person's state is handed along their own world line, so a scene holds only its own cast.
- **What they carry:** position and heading at the same place. Arriving from elsewhere starts afresh.
- **Keys:** scenes are keyed by inputs plus their people's histories, so a rerun walks only what changed. Seeds follow the keys.

## What exists

As of 2026-10-28, uncommitted on `claude/place-read-mode`.

| Piece | Where | State |
|---|---|---|
| Per-fork environment, `novel stage forks` | `src/digger/stage/environment.ts` | built, tested |
| Path integral: sampler and temperature bound | `apps/playground/src/data/pathIntegral.ts` | built, matches exact enumeration |
| Skeleton buildings, rooms, damage, robustness | `apps/playground/src/data/skeleton.ts` | built, tested |
| Places of skeleton buildings, movement graph, hits | `apps/playground/src/data/skeletonPlace.ts` | built, tested |
| Floor plans with rooms and doors (stage 1) | `apps/playground/src/data/buildingPlan.ts` | built; superseded by skeletons for the stage |
| Ground-floor districts | `apps/playground/src/data/placeGroup.ts` | built; superseded by `skeletonPlace` |
| Strand demo: two strands to pick from (book 2's Christmas Eve, book 3's Kuroko; `#kuroko` opens the second) | github.io `stage-strand/`, `playground/strand-demo.html`, exported with `--set` | public |
| Skeleton lab | `playground/skeleton-lab.html` | local |

**Built for the animation:**
- **Sky arcs:** up-diagonal launches at 7, 10 and 13 m/s, landing no higher than they started, priced by launch effort.
- **Direct moves.**
- **The 2D macro view** with migration traces.

**Still stand-ins:**
- Destinations come from Jev's typed spot answers.
- The damage region is a box around the event's first actor, standing in for Jev's box. Its strength already comes from the embedding direction, applied from 0.7 up.
- Direct moves come from words in the event summary that show a power being used to move.
- Traces and migrations are exported with the demo, not yet stored in the database or sent to the timeline page.
- Detected buildings take a place's free lots; shrinking existing buildings and temporary districts are not built.
- There are no captures yet: the macro view is shown, not captured for Jev.

The full list of stand-ins, and a checklist for running the simulation as its own section of the product (its own CLI, skill, page and progress), is in [stage-simulation-section.md](stage-simulation-section.md).

## Build order (proposed)

1. **Capture.** Render the stage from the player itself on the desktop layout: a capture with its camera pose, from the reader's camera and from a rotated one. The reader can open any capture and its answer.
2. **Two-view destination boxes.** Back-project and intersect, replacing the typed spot answers. Probe the two-view boxes on one strand before a full run.
3. **The 14-direction ask and sky arcs** in the path integral, with per-character capabilities.
4. **The macro loop.**
   - Capture the macro view and box destinations across places.
   - Walk exits and arrivals.
   - Grow places with stable lots.
5. **The Jev damage question,** degree and two boxes, in story order across strands.
6. **The place-system redesign** (architectures and Jev-typed groups) under step 4.

## Open questions

- **"The mac version":** does it mean the desktop viewer on this Mac, as assumed above, or the macro view?
- **Cost:** two image asks per destination and one per direction ask. Is the price per book acceptable?
- **Sky arcs and buildings:** what can be landed on (roofs, balconies, ledges), and whether windows are exits.
- **Reach of damage:** does damage stay with the place for later books in the universe?
