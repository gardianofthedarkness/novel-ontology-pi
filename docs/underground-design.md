# The underground: halls in the ground

A redesign of what lies under the world (user, 2026-10-30): **underground places are halls, not buildings.** A hall is a void carved in soil or rock, and it stands or falls by the ground around it. A building stands or falls by its own walls and slabs. So gravity, damage and collapse follow different logic underground, and walking, generation and drawing change with them. This replaces the first version (four flat levels of walkable cells, built 2026-10-29 in `world.ts`). Nothing here is built yet.

## 1. What was wrong with the first version

- **Levels were planes.** Each of SUBWAY, UNDER, WATER and DEEP was one 2 m-cell layer of walkable nodes, 3 m tall, with nothing around it. A storm-water tank 18 m high, a subway box, and a lab cavern all looked and behaved like the same flat floor.
- **It borrowed a building's logic.** Basements were "every lot's footprint, one floor down", reached by the building's stairs, as if a building simply went on below the street. Nothing held the ground up, so nothing could cave in.
- **Too many tunnels.** A subway tunnel lay under every road, with stairs down from the street at random. A real city has a few lines with stations.
- **Bugs it caused:**
  - Nodes below the street were packed into negative numbers, so the live view lost anyone who went down: they vanished, and their traces flickered between real and broken points.
  - The street's see-through view flickered with them.
  - The packing is fixed (an offset of 24 levels) but not yet committed.

## 2. The model

### 2.1 The ground

Every column under the world is ground in three bands, set by depth. A landscape may shift them: harbour ground is soft fill all the way down; a castle stands on rock near the surface.

| Band | Depth | What it is | Stands unlined across (critical span) | Breaks at (bond, blast units) |
|---|---|---|---|---|
| Soil | 0–12 m | earth, fill, the water table | 0 m: every opening needs a lining | 3 |
| Weathered rock | 12–40 m | broken rock | 8 m | 6 |
| Hard rock | below 40 m | sound rock | 20 m | 12 |

A wall unit of a building breaks at 1, so a blast that tears a building open barely marks rock. A **lining** (reinforced concrete) adds 6 m to the critical span and breaks at 4.

### 2.2 Halls

A **hall** is a void in the ground: its footprint, its floor depth and its height.

**Inside it:**
- a floor slab people walk on;
- a lining round its sides and roof, or none in hard rock;
- pillars where its span is wider than its band allows;
- partitions where it has rooms (shops, labs).

**Kinds:**

| Kind | Shape | Floor depth | Height | Span and pillars |
|---|---|---|---|---|
| Subway tunnel | twin bores, 6 m wide, along a line | −15 m | 6 m | narrow, lined, no pillars |
| Subway platform | a box 120 × 20 m at a station | −15 m | 7 m | pillars every 8 m along its middle |
| Station concourse | a box over the platform, with escalators down | −7 m | 5 m | pillars on an 8 m grid |
| Underground mall (地下街) | a long hall under a commercial street, 20 m wide, from a concourse | −7 m | 4.5 m | pillars on an 8 m grid, shops partitioned along both sides |
| Basement | under a building, 1 to 3 floors (house 1; 10 floors or more 2; 20 or more 3); a car park in offices and malls | −3 m a floor | 3 m a floor | the building's own structure, inside a retaining wall |
| Storm-water channel | a 10 m bore | −50 m | 10 m | unlined, in hard rock |
| Storm-water tank | a hall about 100 × 70 m | −40 m | 18 m | pillars on a 10 m grid, as in 首都圏外郭放水路 |
| Storm-water shaft | a vertical silo, 30 m across, where a channel meets the tank or a river | from the surface down to −50 m | — | lined |
| Deep facility | a cavern complex: a main hall and side halls (military: a command hall and blast doors; experiment lab: halls of lab rooms; quantum: a shielded hall and a ring tunnel) | −80 to −100 m | 8–12 m | hard rock, little lining |

**Basements are the exception.** They are part of their building: the building's structural units continue down, inside a retaining wall that the soil presses on. When a basement fails, the building above loses its footing (§4.5).

### 2.3 Ways between them

| Way | Joins | Cost (walking metres) |
|---|---|---|
| Station entrance stairs | the pavement to a concourse | 2 + 4 per 3 m, down or up |
| Escalators | a concourse to a platform | 2 per 3 m |
| Mall entrances | the mall to the basements of the buildings beside it | — |
| Basement ramps and stairs | a building's ground floor to its basements | — |
| Lifts | in a deep facility's shaft: a building on the surface to the facility; in a storm-water shaft: the surface to the channel | 24 for any depth |
| Service ladders | along shafts | — |

Each way is an edge in the walk graph, with its cost; nothing else crosses the ground. Every hall is reachable from the street by its own ways. A test walks to each kind.

## 3. Walking

- A hall's floor is walked like open ground: 8 directions, on its 2 m cells.
- Pillars and partitions close their cells; a shop is a room with a door onto the hall.
- **One floor per hall.** A hall is one walkable level at its floor, however tall it is. Its height matters only for drawing and collapse.
- **One node numbering.** Levels are numbers in 3 m steps (−5 for the platform, −2 for the concourse, −17 for a tank, −27 to −33 deep), packed from 34 levels down, so every node is a non-negative number.
- **Nothing jumps underground.** Rubble from a cave-in closes the cells it buries, until a rubble slope is walkable, and the walk is solved again.

## 4. Gravity and destruction underground

### 4.1 What differs from a building

| | A building | A hall |
|---|---|---|
| **What holds it up** | Its own units, each resting on the one below or spanning 2 units sideways | The ground arching over the void, its lining, its pillars |
| **What fails** | Units without a load path | A roof wider than its critical span |
| **What falls** | Units, straight down onto the first support | Ground: soil or rock from above, into the void |
| **Where it ends** | Rubble at the support | A dome that holds, a hall filled with debris, or a sinkhole at the street |

### 4.2 A blast in a hall is confined

**The model:**
- In the open, a unit at distance ρ gets E / (4π ρ²).
- In a hall, the energy cannot spread into the rock, so it runs along the void. At path distance ρ along the hall, a unit gets about E / (2 A) · e^(−ρ/L).
  - A is the hall's cross-section (6 m × 6 m in a tunnel); L is 60 m.
  - The unit gets whichever of the two is greater.
- So a blast in a tunnel carries far down the tunnel. In a wide hall it spreads almost as in the open.

**What it breaks:** linings, pillars, partitions and the floor, by their bonds. Rock breaks only close to the centre (the cavity a blast carves), by its band's bond.

### 4.3 Is the roof still held?

**The test, after a blast:**
- For every roof cell, measure the open span around it: the distance to the nearest standing support along each axis, the support being a pillar, a hall wall, or ground beside the hall.
- The roof fails where the span is over the critical span of its band. The lining still standing above it counts as long as it is unbroken.
- At rest, every hall is generated stable. Pillars are spaced so every span is within its band, so only damage brings a hall down.

### 4.4 The cave-in: the ground falls into the void

Over the failed roof the void works upward one 2 m layer at a time.

**What each layer does:**
1. The ground over the open area falls into the hall.
2. The open area shrinks as an arch forms. Each layer up, the open area is eroded by about one cell in rock and half a cell in soil, so the cave narrows into a dome.
3. What fell bulks up (rock by 1.5, soil by 1.3) and piles on the hall floor below. It fills the hall from the floor up, and the cells it buries close.

**It stops at the first of these:**
- **The dome closes:** the open area reaches nothing. The cave is a dome that holds; the street never knows. Deep halls end here.
- **Debris fills the void:** the pile reaches the cave's base. The hall is choked with rubble.
- **It reaches the street:** that is a sinkhole (§4.5).

Like a building's settle, every step only lowers the ground's potential energy and never adds support, so one pass reaches the lowest stable shape.

### 4.5 Sinkholes, and buildings over a hall

**A sinkhole:** where a cave-in reaches the surface, the street cells over its open area drop by the void left (its volume over its area).
- They are no longer walkable: a hole, with a rubble slope at its edges.
- Shallow halls in soil (the concourse at −7 m, the mall, a subway box) can do this from one blast that breaks their lining, because soil has no arch. That is how a road falls into the subway.

**A building over it:** a building whose ground cells lie in the sinkhole loses its footing there.
- Its units over the hole rest on nothing.
- The building gravity already built (`structure.ts`, settle) brings them down into the hole as rubble.

**A failed basement:** the building above loses its footing over the basement's failed cells, in the same way.

### 4.6 Water

A breach between a storm-water hall and another hall can flood the lower one, with water filling to the breach's level.
- Flooded cells cost a lot to walk (swimming), and nothing falls in water.
- **Proposed as a later stage:** the first build marks breaches but does not flood.

### 4.7 Jev and the impacts underground

The impact choice (`impact-choices.mjs`) works underground as it does on the surface, with three differences:
- When the fight is underground, the lettered points are inside the hall: the faces of its pillars by the fighters, its roof over them, and its walls.
- The size question keeps the spheres of 4, 8, 16 and 32 m. They are drawn clipped to the hall, so Jev sees how far the blast runs down a tunnel.
- The strength still comes from the event's embedding.

## 5. Generation: the modern kit under the city

What lies under a modern landscape is generated with it, from its seed, as the city above is. Ancient ground has none, except a castle's cellars, which are basements.

### 5.1 Subway lines

- **Lines:** one or two per city patch, along its arterial roads (18 m or wider), chained across the patch.
  - One for a patch under 200 m in radius, two above that, crossing near the centre.
  - A line carries on into the next patch when an arterial carries on.
- **Stations:** every 400–600 m along a line, at a crossing.
  - Each is a platform box, a concourse over it, and 2 to 4 entrances on the pavement.
  - A scene's station building (a `station` anchor) is the station there: its stairs go down to the concourse.
- **Tunnels** join the stations along the line.

### 5.2 Underground malls

Under a commercial quarter, or a skyscraper core's main street, a mall runs from the station concourse along the street for 150–400 m.
- Shops are partitioned on both sides.
- It has entrances to the basements of the buildings it passes.

### 5.3 Basements

Every building of 2 floors or more has basements by its height (§2.2). Offices and malls of 10 floors or more have a car-park ramp to the street.

### 5.4 Storm water

- **Tank:** one per city (the largest modern patch), under its middle.
- **Channels:** from the tank along the main arterials, to the patch edges.
- **Shafts:** one where each channel ends, and one at the tank.
- A city large enough (over 1 km across) gets a second system.

### 5.5 Deep facilities

The kinds by ground:

| Ground | Facilities |
|---|---|
| Skyscraper core | one per 100 m of radius, plus one: labs, quantum facilities, military |
| Industrial area | two: labs and military |
| Harbour | one military |

**How each is reached:**
- A lift shaft from a building on its footprint (a scene's own building when there is one, else the tallest);
- An emergency adit that slopes up to a storm-water channel or a subway tunnel.

### 5.6 Models from the kit

The hall shapes above are generated, and are what the walk and the collapse use. Models, from the packs found (KayKit Space Base Bits, Quaternius Sci-Fi MegaKit, the Metro pack), only dress them, in the hologram style:
- platform furniture;
- turnstiles;
- lab consoles;
- blast doors;
- tank pillars.

Like a building's shell, a model is drawn, never walked.

## 6. Jev's choices

**Births and moves name the hall, not a level:**
- the subway platform;
- the station concourse;
- the underground mall;
- a building's basement (its own, else the nearest);
- the storm-water tank or channels;
- the deep facility (by kind).

**A move into a hall:**
- When the text gives no hall, the nearest of the right kind.
- When the text names a station or a place, that one, through building EM (§9).

**Map pictures:** each hall has a slice at its floor, showing it, its pillars and partitions, the ways out of it, and the people in it. A box on it picks a cell of the hall.

## 7. Drawing

- **Halls:** each hall is a translucent volume.
  - Its lining shows as edges, its pillars as columns, its floor as faint tiles.
  - Each kind has its colour: subway teal, mall amber, basement violet, storm water blue, deep red.
- **The street:** see-through as now.
  - Faint always, nearly clear while anyone shown is below it, and on the Underground button.
  - Pawns underground show through it, and their traces are drawn underground too.
- **A cave-in:**
  - the dome as a faint shell;
  - the debris pile on the hall floor;
  - falling ground animated, as building rubble falls;
  - a sinkhole as missing street tiles with a rim of rubble.

## 8. Records

Underground damage is kept like a building's, per run, in story order (`stage/simulation/world.json`'s damage). For each hit underground, it records:
- the hall's id;
- the units it broke (linings, pillars);
- the roof cells that failed;
- the cave's layers;
- the sinkhole cells, and the buildings over them that fell.

A later scene sees the cave-in and the sinkhole if the hit came before it.

## 9. Building EM (the same pass, user 2026-10-30)

The user's report: the same building is placed several times.
- **Example:** 飞镖酒吧 stands as the nominated place's real building, as a yellow box where Jev boxed a mention of it, and as further boxes in other scenes.
- **Why:** the objects step had detected these mentions as buildings in shape only, so each became a box. A named building detected in two places took a generic lot in each (its key was place and name).

**The design:**
1. **One question per building mention:** for every building the objects step finds in a scene, Jev answers one choice in the scene's composed context. Which building is it:
   - the building this scene happens in;
   - one of the book's named buildings so far;
   - the subway (a station, a tunnel);
   - another building of its own;
   - or not a building here (a part of one, a description, something seen from afar)?
2. **Union by answer:** answers join mentions, scene spots and named places into one building each. A name answered as "another building of its own" is one building for the whole book, not one per place.
3. **A real building over a box:** a building mention never becomes a box again.
   - It is its building's real lot.
   - A new one takes a generic lot of its role, near where it is first mentioned.
4. **The least-travel building:** when one building has several real lots, the kept lot is the one with the least total travel for everyone who went there in the book. For every visit (a person in a scene there), the travel is the distance from where they were in their previous scene to the lot.
   - Every scene at any of its lots moves to the kept one: its people's traces, starts and moves.
   - Its name labels it.
5. **Jev's sight follows:** later questions see the kept building in its place. That covers map pictures, slices, the thing boxes it no longer gets, and the moves to it.

## 10. Build plan

1. **The walk:**
   - hall shapes and the ground bands (`world.ts`, replacing the four planes);
   - pillars, partitions and the ways between halls;
   - generation per landscape (`landscape.ts` `undergroundOf`, rewritten);
   - tests: every hall kind is reached from the street; generated halls are stable at rest.
2. **Collapse:**
   - the confined blast, the roof test, the cave-in to a dome, a choke or a sinkhole, and sinkholes taking buildings down through `structure.ts`;
   - tests:
     - a shallow box with its lining broken makes a sinkhole;
     - a deep hall with a pillar lost makes a dome;
     - a building over a sinkhole falls;
     - one pass reaches the fixed point.
3. **Jev:**
   - halls named in births, moves and impacts;
   - map slices of halls;
   - building EM (§9).
4. **Drawing and records:**
   - the halls, cave-ins and sinkholes in the live view and the player;
   - underground damage kept per run.
5. **The engine version rises to 3.** The record's node packing changes (the level offset).

## 11. Questions for the user

1. **Subway:** lines along the arterials with stations, instead of a tunnel under every road (§5.1)?
2. **Depths:** the depths in §2.2 (concourse and mall −7 m, platform −15 m, tank −40 m, channels −50 m, deep facilities −80 to −100 m)?
3. **Sinkholes:** may a cave-in reach the street and take the buildings over it down (§4.5)?
4. **Water:** flooding later, as proposed (§4.6)?
