# Auto-filled cities, places inside them, and rooms

A design for filling every city, district and street with buildings from a recipe, so scenes play in a whole city rather than a 64 × 48 m grid per place. Agreed with the user on 2026-10-29. It follows [stage-simulation-design.md](stage-simulation-design.md), and #83's split between ontology and versioned runs.

Destruction in a filled city is left for later.

## The plan, as agreed

- **Filled at birth:** a city, district or street is filled with buildings when it is born, in the style of the first model set (Kenney's city kit): a generated road network and lots, with skyscrapers in the core.
- **Places inside:** a smaller place takes a part of its parent's generated ground. It is never generated separately.
- **Named and generated buildings:**
  - Buildings the story names (reviewed ontology, #83) are permanent.
  - When one first appears, it borrows a generated building's place, at run time.
  - The building is ontology; where it stands is animation data in versioned runs.
- **Unknown starts:** a person whose start is unknown spawns at a generated building near the middle of the smallest place they are known to be in.
- **Camera:** it frames the tightest view that holds the scene's active people and what is happening.
- **Drift:** a scene's focus drifts with everyone's moves. When it reaches the edge, the city grows.
- **Places page:** it shows the latest accepted runs, scaled so every permanent building reads.

## Revisions to the plan (all accepted)

1. **Store the recipe, not the city.** A city is a pure function of its seed (its place id), the recipe's version and the radius it was born with. Only the parts in view are built, and runs keep only what they change: borrowings, spawns, growth, destruction.
2. **The base city never depends on the run.** Every strand and fork shares it and adds its own changes, in story time. The places page can show every city filled before any run.
3. **Real sizes per scale.** A city is hundreds of metres to kilometres across, a district hundreds of metres. A street is a road, not a circle. The road network comes first.
4. **Borrowing at every scale:**
   - a district takes a region;
   - a street takes a road;
   - a building takes a lot, or a whole block;
   - a room takes a generated room (below).
5. **Places stay where they were born.** A newborn place goes into free space and never moves when later places are born. An approved re-parent is a new version, never a silent move. (Today's map re-packs on every export; that ends here.)
6. **Grow outward, never rescale.** Rescaling would move every stored position (Jev's things and impacts, paths, borrowed lots) and break the physics: 3 m floors, blast energy ∝ d³, jump arcs.
   - Growth takes in more of the plane: the radius × 1.3 each time.
   - It is capped by scale. Past the cap, the scene has left the place, which is a change of place.
   - The places page's autoscale is a view zoom only.
7. **A borrowed lot fits its building:** by footprint and height for its kind, near where the text puts it. A building needing more ground than any lot takes a whole block. Once borrowed, it is permanent, and earlier scenes show the same building unnamed.
8. **Records point at ontology ids and the tree version they were built on.** Merges, re-parents and rejected proposals rebuild what depends on them.
9. **Named means reviewed.** That is reviewed Locations at building scale (#83). A generic mention ("a convenience store") borrows for one scene only.
10. **Spawns are stable.** A person starts at a free lot's door, drawn by a normal around the middle of the place (σ = r / 2): the same lot every time for the same person and place, never in a named building.
11. **The camera keeps a buffer.** It has minimum and maximum zoom and sees through buildings in front. When people are far apart, it frames the current event's actors.
12. **Only the focus drifts.** Destruction stays where it happened, and named buildings and placed things stay put. New spots, impacts and Jev's pictures come from the focus window. The path integral is solved on that window only: a 1 km city at 2 m cells is about 250,000 cells per floor.
13. **Building on the branches.** City filling builds on #83's ontology buildings and versioned runs. #82 has merged #81; #83 merges #82.
    - #83's session is making the engine a CLI (`novel sim`) behind one `runStrand` export, so the filled city can replace the per-place grids behind it.
    - On phones: instanced shells and level of detail.

## Rooms

A room is not a lot and not a circle: it is a box on a floor of a building, so it is realized differently from places above it. The ontology keeps one relation, PART_OF. Scale decides how the stage realizes it:

| Scale | Realized as |
|---|---|
| city, district | a region of its parent's generated ground |
| street | a generated road |
| building | a generated lot, or block |
| room | a generated room in a building's skeleton (`RoomBox`: floor, footprint, doors) |
| part of a building (stairwell, corridor, lobby, roof, basement) | the skeleton's own stair core, corridors, entrance or roof; no new geometry |

**Ontology**
- A room is a Location at room scale, PART_OF its building when the text says which one.
- Rooms are mostly generic nouns, so a room's identity is (building, kind), as a generic place scoped to its building.
- When the text never names the building, the room is PART_OF what it does name. The tree repair treats that as a missing level, not an error.
- Detection (`novel stage objects`):
  - marks rooms (`room: true` on a detected building);
  - never lists furniture (a rule in its prompt, and a name filter in code);
  - the scale question's "room" no longer includes furniture.
  - #83 maps a room to a Location PART_OF the scene's building, or PART_OF the scene's place when that is not a building.

**Animation** (versioned, like buildings)
- Generated rooms get kinds by the building's role: wards, a security room by the entrance and operating rooms in a hospital; classrooms, labs and offices in a school.
- A named room borrows the generated room that fits its kind's size, floor and neighbours. Where the text gives clues, Jev picks among lettered rooms in a cutaway view.
- When none fits, only that floor is generated again, as a new version.
- An unnamed host is an anonymous building near the focus, kept. When the text later names it, the room moves under it through review. This needs a "move parent" proposal, which the review gate does not have yet.
- A scene in a room:
  - loads its building;
  - frames the room in a cutaway;
  - spawns unknown starts inside the room;
  - adds the room and its door to the movement spots.

## The first mock (built)

**The recipe:** `src/ground/stage/cityFill.ts`, version 1.
- **Main roads:** the plane is cut into super-blocks, the Voronoi cells of one jittered site per 180 m square. Each depends only on the sites around it, so any window of the city agrees with the whole. Their edges are 18 m arterial roads.
- **Blocks:** each super-block is split across its longer side again and again; the first split is a 12 m collector road, later ones 8 m local roads.
- **Lots and buildings:** blocks are split into lots, keeping only lots that face a road. Each lot's building stands back from its edges, faces its road, and has floors from a density field fixed by the radius the city was born with. Its kind follows from its floors: skyscraper, tower, office or house.
- **Growth:** roads are cut a road's width past the edge, and go on once the city grows.
- **Helpers:**
  - `placeChild`: a circle placed once, as near the middle as there is room;
  - `borrowLots`: a lot by the ground the kind needs, or a whole block;
  - `borrowRoad`;
  - `spawnOf`;
  - `growToReach`: × 1.3 per step, capped at 3 × the birth radius.

**The mock:** `playground/city-fill-mock.mjs` writes `playground/city-fill-mock.html` with an invented city:
- a city 900 m across;
- three districts born in turn;
- a named street on a main road;
- a hospital and a school, each taking a whole block (14 and 7 lots);
- a tower and a café on the street;
- two spawns;
- one growth step after a scene drifted past the edge.

The city has 2,710 lots, 2,686 buildings and 561 roads within 585 m, built in about 20 ms.

**Tests** (`test/city-fill.test.ts`, 6):
- the same city every time, and a window agrees with the whole;
- every lot faces a road, lots fit their blocks, and the core is taller than the edge;
- growth adds ground and changes no lot or building already there;
- districts are inside their city and apart, the first born takes the middle, and later births never move earlier ones;
- borrowing gives a hospital its ground and a house a small free lot; a shop on a street faces it; nothing is borrowed twice; borrowings survive growth;
- spawns are stable, never in a named building, near the middle and spread out.

## Landscapes (built, on mocks)

The plain city filled every circle with the same kind of buildings, so a future city and an ancient one looked alike. Now a place's ground has a **landscape**, picked by Jev, and is filled **from its centre** only.

- **Types** (`src/ground/stage/landscape.ts`):
  - modern skyscrapers;
  - a commercial quarter;
  - a living area;
  - an industrial area;
  - a harbour;
  - a park (an amusement park too);
  - a village;
  - an ancient castle;
  - farmland.
- **Patches.** Each type is a family of shapes. A patch is one shape: an outline r(θ) = R·ρ(θ) drawn afresh from its seed, but always shaped like its landscape:
  - a compact blob for towers;
  - a lobed village;
  - a boxy superellipse for industry, harbours and fields;
  - a bastioned fort for a castle.
- **Height** rises over the depth inside the outline: a core of towers peaking in the middle, a flat or low spread, or a keep within walls.
- **Filling.** A patch is filled with the city fabric cut to its type's block and lot size, with its type's buildings, set-backs and gaps (a farm is mostly fields, a park mostly lawn). A castle gets walls along its outline and a keep at its centre.
- **Filled from the centre.** A place's first patch is at its centre; nothing is filled edge to edge, and ground between places stays empty.
- **New parts:** a patch placed against the edge where a scene drifted (within a margin of the edge) or where a new strand enters. It always covers the point that called for it, and the place's circle grows to hold it.
- **Nothing already there changes.** Ground is cut by the oldest patch that reaches it (a super-block by its block size, a block by its lot size), and the oldest patch owns any lot inside it. So a new part never changes an older one's lots or buildings. The tests check this lot by lot.
- **Heights and eras.**
  - **Caps:** each type has a height cap: commercial 60 m, residential 45, industrial and harbour 30, park 20, village 12, castle 60 (its keep), farm 10. Skyscraper cores peak anywhere from 80 m to 1,000 m, drawn skewed so most peak at a few hundred metres. No building is ever taller than 1,000 m.
  - **Modern types merge at any height** (skyscrapers, commercial, residential, industrial, harbour, park). They may overlap. A new part's buildings within 80 m of an older modern part rise or fall toward that part's height at its edge, past the new type's own cap if need be. Only the newer part bends; the older stays as it was.
  - **Ancient types never merge** (castle, village, farm). A part that is ancient, or placed beside ancient ground, moves out until its outline clears every other patch, and keeps its cap.
  - **Tested:** caps for every type; peaks varied and never past 1,000 m; homes at a 650 m core's seam taller than twice those 120 m away and past their own cap; castles, villages and farms clear of the towers.
- **The probabilistic manifold.**
  - **Soft edges:** a patch's edge is a probability: a lot belongs to it with σ(signed distance / softness), with the softness by type (castle 4 m: a wall; residential and village 30 m: thinning out). Beyond three softnesses, nothing.
  - **Ownership by birth order:** lots are claimed in birth order, each patch with its own draw for the lot. A newer patch only draws for lots every older one passed over, so it never takes one.
  - **Heights are draws** from the type's height manifold: log-normal round its profile.
  - **Two height manifolds merging:** a lot of a modern part draws from older modern ground beside it with the chance that ground's heights reach it. The reach is σ(signed distance / (softness + H/10)), so a 600 m core tapers over 85 m. Otherwise the lot draws from its own heights.
  - **Tested both ways round:**
    - towers first: homes' heights fall band by band away from the towers, and the share drawing tower heights falls from about 20–25% to under half that;
    - homes first: the newer towers step down to meet them.
    - Either way, the older ground never changes.
- **Skyscrapers** peak at 600 m at most. The taller a core:
  - **Wider plots:** a building is at most SLENDER = 8 times as tall as its footprint is wide, and core plots are planned for the tallest towers likely there.
  - **Wider streets:** every road in a core is 1 + H/400 times as wide, 2.5 times round a 600 m core.
  - **A signature tower** at the centre, at the peak, H/8 wide, on open ground of its own.
- **Stadiums:** an oval bowl at the centre with an apron, and parking with a few halls round it.
- **Commercial quarters:** an open plaza at the centre with a fountain, and a 30 m boulevard through it along the patch's turn.
- **Districts beside a city** (`placeBeside`): placed by its filled centre in their own direction, each filled from its own centre. Nothing already placed moves.
- **What is kept** is the landscape, in the ontology, as the place's `landscape` property: its patches (type, centre, radius, height, lot size, seed and the shape's numbers). It goes through the shared review gate (`landscapeProposal` in `src/digger/stage/landscape.ts`, an entity update that keeps the place's other properties). The filling is never kept: the patches draw it again identically. Named buildings and rooms are kept as ontology, as before.
  - **Mock size:** five places' landscapes take 1,829 bytes.
- **The question** (`src/digger/stage/landscape.ts`): one Jev choice per city, district or street. Regions are too varied to be one landscape; buildings and rooms are not ground. Jev reads:
  - the name and scale;
  - the tree path and places inside it;
  - its first scenes;
  - the buildings named there;
  - the first three sentences naming it.
  Answers are kept and asked again only when that changes.

**Trial on books 1–3 and vol 4** (jev-1.14.0, 24 places, nothing written):
- **学园都市:** skyscrapers in vols 2–4 (0.68–0.92), commercial against skyscrapers 0.43/0.41 in vol 1.
- **Commercial:** 车站前, 购物美食大街, 第十三学区, London.
- **Skyscrapers:** 伦敦市场 (London's financial district), 东京都, 洛杉矶 and its downtown.
- **第六学区:** park, 0.98. This came only once Jev saw the sentences: before, from its bare scene ids, it said industrial.
- **Harbour:** 长滩市 and 游艇停泊港.
- **第二十三学区:** industrial, 0.90; it is the airport district.
- **华盛顿特区:** none, with almost nothing in its scenes.

A city that spans books needs its landscape from all of them, not from the first book alone.

**The mock** (`playground/landscape-mock.mjs`, stills in the session):
- a city: skyscrapers at its centre, then a commercial and a residential part added at drifts, its circle growing 209 → 449 → 533 m;
- beside it, a walled castle quarter, docks, a village and fields;
- a named building pinned to the lot it borrowed.

**Drawn as the frontend's cyan holograms** (`playground/landscape-mock.html`): a faint cyan fill with cyan edges (white for named buildings), fields and lawns as faint ground. The building forms:
- **Baked Kenney models:** 13 towers, 3 skyscrapers, offices and the keep.
- **Procedural forms per landscape:**
  - stepped and twin skyscrapers, and spires;
  - podium towers;
  - slab, L- and U-shaped apartments;
  - gabled and flat houses, cottages, townhouses;
  - sawtooth halls and halls with chimneys and tanks;
  - warehouses and cranes;
  - pavilions and Ferris wheels;
  - farmhouses with silos.
- **Which variant:** picked per building from its position.
- **More kits:** kenney.nl answers scripted downloads with a 403 bot check, which we do not get around. Its other CC0 kits (City Kit Suburban and Industrial, Fantasy Town, Castle Kit) can be downloaded by hand and baked with `apps/playground/tools/architecture-models.mjs`.

## Places as circles, built from the bottom up (the canvas)

A design change from the user (2026-10-29): a recognised district like 第七学区 is a circle of its own, born on the canvas on its own. It is not a box inside its city's map. The build order runs upward, from the smallest units known to belong to bigger areas, and each circle grows as things are built inside it (`src/ground/stage/placeCanvas.ts`).

- **Own frames:** every open place (city, district, street) is a circle in its own frame, at an offset in its parent's frame. Buildings and rooms are units: a lot in the nearest open place that holds them.
- **Bottom-up births:** when the story first names a place, each missing place above it is born, outermost first, so the smallest is born into the circle that holds it. A building in 第七学区 brings 学园都市 and 第七学区 into being and then takes a lot.
- **Where a newborn goes:** the free spot nearest its parent's middle (or toward a direction), clear of its siblings and of the parent's own ground. Places with no parent (a second city, a street the tree has not placed) are born beside one another.
- **Growth:** a circle encloses its own ground, its units and its children, never less than its scale's least radius. It grows when a unit or a new part is added, and the growth carries up.
- **Collisions:** a circle that grows into a sibling pushes it aside, whole. A child growing into its parent's own ground moves off it, whole. Places only ever move as rigid circles in their parent's frame, so nothing inside any place moves in its own frame.
- **Tested** (`test/place-canvas.test.ts`, 6):
  - bottom-up births and nesting;
  - growth carried up to the city;
  - pushes leave every other place's ground and buildings unchanged in its own frame;
  - a ward growing into the city's core moves off it;
  - top-level places kept apart;
  - the same story builds the same canvas.
- **Book 3 built this way** (`playground/canvas-mock.mjs`, story order, nothing written):
  1. 第七学区, the first place named, brings 学园都市 and itself into being; 废弃大楼 takes a lot in it.
  2. 第八学区, 第二十三学区 and the 第六学区 park are born inside 学园都市, with 秘密住宅 on a lot in 第六学区; the analysis centre takes a lot in the city's own ground.
  3. 遁影隧道, still without a parent, is born beside the city.
  4. Two drifts grow 第七学区 from 245 m to 653 m. 学园都市 grows from 836 m to 1,553 m to hold it, and 遁影隧道 is pushed further out.
- **Jev's box loop now plays a smaller part.** Districts no longer sit as boxes in their city's map. Its lettered choice (centre, or A–H round the edge) becomes the `toward` of a newborn circle, and its boxes place parts and buildings inside a place.

**Jev places districts by box** (`playground/landscape-boxes.mjs`, on 学园都市's districts in book 3; a trial, nothing written):
- **The procedure:** a district starts as a default box at the city's centre. In story order, Jev looks at the city from above (its ground so far, the districts placed so far, labelled) with the sentences that first mention the district and others that name it. It then works in two steps:
  1. **A choice:** the centre box (O), or one of eight lettered boxes round the edge of the city so far (A–H).
  2. **Refining turns:** whether the box fits, or a better box.
  The district's patch then joins the city in birth order.
- **First version, boxes only:** Jev anchored on the box it was shown. Every district stayed near the centre, each turn moving it by about 10–30 m. The lettered choice fixed that.
- **Result, book 3:**
  - 第七学区 south (0.47);
  - 第八学区 at the centre (0.38);
  - 第二十三学区 south beyond it (0.21);
  - 第六学区 east (0.08).
  Refining turns then move and resize the box by tens of metres.
- **The text rarely says where a district lies,** so the choices are unsure. Relations stated in the text ("crossed into 第七学区 from …") and travel between districts should weigh in next.
- **A place across books** takes the landscape Jev was surest of (学园都市: skyscrapers 0.92 in vol 2, against a near-tie in vol 1).

**The Jev trace** (strand pages on io, `?trace` or the Jev trace button): every runtime Jev decision at the current moment, in a panel and on the stage:
- **Moves:** each person's chance of moving, how, which way, and the three likeliest spots, with the one used in white.
- **Things:** the model pick and runners-up, the lettered spots, the pick, and the box solved from its close-ups, in gold.
- **Impacts:** the lettered spots, with the pick in red, and the size.
- **Scene starts:** the stated start and its spots.

**Polish left:**
- main roads still stick out past a patch's outline;
- farmland and villages get city-width main roads (narrower tracks per type).

## Built on #83's wired-in design (2026-10-29)

The user asked that the systems from here build on #83's design (`novel sim`, versioned runs, the app's player), not the io page alone. Branch `claude/place-canvas` starts from #83's head.

- **Modules with the stage:** `cityFill.ts`, `landscape.ts` and `placeCanvas.ts` moved to `src/ground/stage/`, as #82 did with the nav grids. The view re-exports them, and the CLI faculty never imports the frontend.
- **`novel stage landscape <dir>`:**
  - one Jev choice per city, district and street (by Jev's scale), kept in `stage/landscape.json`;
  - proposes a `cs_stage_landscape_*` packet, each place's landscape as its `landscape` property;
  - the checklist's `landscape` item comes after `scale`, and the simulation waits for its review like any stage step;
  - Pi may run it (guard, skill step) and review its packets through the gate (`stageLandscapeChangesetIds`);
  - applying a packet does not re-arm the causality sweep.
- **Temporary areas** (`holderFor`, `adopt`): a building known only to lie in a city gets an unnamed district of that city, `tmp:<city>:<building>`. It is born like any place and filled with the city's landscape. When the text names the area, `adopt` turns the temporary area into it, in place, with everything it holds.
- **The engine (`runStrand`, engine `strand-demo-3`):**
  - the place map is the canvas, built bottom-up in story order;
  - a newborn circle takes the free spot toward the sibling it has the most travel with;
  - a staged open place keeps its grid at its middle, and a staged building stands on a lot of its holder;
  - each open place's landscape is filled around the staged grids and sent to the player as faint hologram blocks and roads;
  - the map lattice's cell grows with the map, so a city-sized canvas stays a few hundred cells across;
  - `scale.json` and `landscape.json` are now among a run's inputs.
- **Who goes together:**
  - Jev is asked, at a scene's opening, for each pair of its first six cast members whether they arrive together; and per event, for each mover and anyone else present, whether the two go together and end up beside each other.
  - Older answers keep theirs, and only the pairs are asked (`pairsCallLimit`).
  - The engine joins the pairs into groups. A group's leader is its first member in walk order, and the others end on the free node beside the leader, the leader's way.
  - Answers from before the pairs fall back to two people the event names going to the same spot.
- **Seeing through, in the player:** while it plays, a building between the camera and the people (or a hit) fades to 6%, with its skeleton left out. One within 6 m of the line of sight dims to 35%. Each is checked about eight times a second, held for 0.7 s and eased. Jev's stills are never affected.

## Next

1. **Landscapes, further:**
   - new parts on drift and on a new strand, behind `runStrand`;
   - for places across books, the landscape decided from all their books;
   - `adopt` wired to the place tree when a temporary area's name appears.
2. **Shells per landscape** from the model sets (the Kenney city kit for the modern types; castle, fantasy-town and farm kits for the others), instanced, with level of detail, in place of plain boxes.
3. **Rooms:**
   - room kinds by building role in the skeleton's `furnish`;
   - room borrowing by fit;
   - an unnamed host;
   - a mock hospital with a named security room and ward, a lab whose building is never named, and a stairwell mention.
4. **A focus window:**
   - the skeleton grid and path integral built only for the lots around the scene's focus;
   - the window following the cast's moves;
   - the camera's tightest framing with a buffer.
5. **The record:** what a run keeps of a city (seed, recipe version, born and grown radius, place circles, borrowings, spawns, growth), as part of #83's versioned runs.
6. **Then the engine:** behind `runStrand`, replace the per-place grids with windows of the filled city, and try it on the two strands before io.
