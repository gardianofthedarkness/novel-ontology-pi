# Roads, highways and the subway: the terrain cast's transport network (2026-11-08)

The user, 2026-11-08, after the moving-conversation clips: *"We don't have a proper transportation system and highway
system yet. Maybe we need to do that in terrain first to make riding and talking reasonable?"*, then *"Yes that order,
then highway/subway system"*: walking talk into the director first (built: `world-engine/director/on-the-move.mjs`,
[world-ontology.md](world-ontology.md) §5a), then the road system, then highways and the subway. Riding while talking
(option D of the experiment) waits for the roads.

## Status (2026-11-08)

Built (uncommitted), with the research of [highway-research.md](highway-research.md) §8:
- **Stage 1, in part:** the road graph (`world-engine/world/roads.mjs`): the streets split at their T-junctions and
  crossings, the pieces each patch lays stitched together (692 pieces to one per city on Academy City), keeping left,
  speeds by class, waits at junctions, the kerb as the nearest point of a street. Road vehicles' rides drive it in the
  director. Not yet: lanes as separate ways, turn arcs, car parks and named stops.
- **Stage 2, the highway:** kept in the terrain (`world-engine/terrain/transport.mjs`, `world-engine/world/highways.mjs`),
  drawn by the player, driven by the road graph through its ramps.
- **Riding while talking** (option D): built as talk while driving ([world-ontology.md](world-ontology.md) §5a).

## 0. What there was, and what was missing

- **Roads are laid, as ground.** The city fill (`src/v2/world/cityFill.ts`) cuts the plane into super-blocks of about
  180 m (Voronoi cells, their edges the arterials, 18 m wide), splits each block by collectors (12 m) and local roads
  (8 m), and keeps only the lots with a road along one side; a street landscape adds its own axis road (an avenue, a
  boulevard). The walk world (`apps/playground/src/data/world.ts`) lays each road on the 2 m grid as `avenue` ground and
  keeps lots and clutter off it. Roads are segments `{ a, b, width, level }`: there is no junction, lane or direction.
- **A vehicle ignores them.** A ride (`ride:<×>`, `export-strand-demo.mjs` specOf) is the walk grid's level ground at ×
  a run: a road, a pavement and a square cost the same, a car can cut across a plaza, and it never turns at a junction or
  keeps to a side. The experiment's 4WD (option D) followed a walker's route borrowed from the run.
- **The subway is halls without trains.** The shallow underground has the subway's tunnels, stations and passages as
  walkable halls (`src/v2/world/underground.ts`, 5 to 20 m down), joined to the street by stairs and lifts (the layers'
  ways, [terrain-levels.md](terrain-levels.md) §3.4). A long trip rides a virtual subway (`laws.mjs` tripTime) that is
  never drawn. There are no lines, no trains and no timetable.
- **No grade separation.** Nothing is above the street but roofs and the air layer: no elevated expressway, ramp or
  bridge.

## 1. Rules this design keeps

- **The city model is authoritative; graphs are derived** (the research handoff, §4, "keep spatial adjacency and travel
  connectivity separate"). The road network is a graph of its own, derived from the city fill's roads by entity version,
  never a cost on the walk grid. People walk the walk grid; vehicles drive the road graph; the two meet only at explicit
  links (kerbs, car park ramps, station entrances).
- **Same seed, same city.** The road graph of a region is a pure function of the fill (and the places' borrowed roads):
  nothing stored but what a run changes (a road the terrain cast names, a blocked road, a crash).
- **Bounded repair.** A borrowed road, a new place or a blast rebuilds the road graph of its chunks only, with one seam
  record per chunk boundary (handoff §7).
- **Grade separation by layer.** An expressway deck and a subway line are layers (terrain-levels §3.3) with their own
  graphs; a crossing between layers is not a junction unless a ramp or a station says so.
- **Casts, not rules.** The terrain cast says what a city has (a named expressway, a subway line the text rides, a
  monorail); the transport specialist says what each vehicle is and who drives it; the director only routes on what they
  built. Physics (the path integral) routes the vehicle, as it walks a person.

## 2. Stage 1: the road graph, and riding on it

1. **Junctions.** Split the fill's road segments where they meet or cross (a split line ends in the middle of its
   parent's road: a T), merge ends closer than half a road's width; each junction is a node, each piece between two
   junctions an edge `{ class, width, length, lanes, speed }`.
2. **Lanes and sides.** Lanes by width (a local road 1 each way, a collector 2, an arterial 3), traffic keeping left (the
   books' city is in Tokyo). A lane is a centre line offset from the road's axis; an edge is driven along its lane, a
   junction by a turn arc (left turns tight, right turns wide across the oncoming lanes), each turn with a cost.
3. **Speeds.** By class (local 30 km/h, collector 40, arterial 50, an avenue or boulevard 40), the stated speed of a
   chase or an emergency vehicle over them (the transport specialist's note).
4. **Links to the walk grid.** Kerbside stops every 20 m or so along each road on both sides (where a car can pull in
   and its riders step onto the pavement), every lot's vehicle entrance (a car park ramp, a garage door, a basement
   parking hall of the underground), and named stops (a taxi rank, a bus stop) where the text has one.
5. **Riding.** A ride is: the riders walk to the nearest kerb link (or the car park the car stands in), the vehicle
   drives the road graph (least time, the path integral over the lane graph with a turning cost), and they step off at
   the kerb link nearest where they are going. On the page a vehicle's move is its lane line sampled onto the grid's road
   cells, so the player plays it as it plays any move. Option D of the experiment then plays on real roads: talking
   while the car drives at its own speed, the talk filling part of a trip instead of the car slowing to last the talk.
6. **Checks.** Every lot with a vehicle entrance reaches every other through the graph (one component per city, or a
   seam record saying why not); no vehicle move leaves a road or a link; a vehicle keeps its side (no lane crossed but
   at a junction).

## 3. Stage 2: highways

> Researched 2026-11-08 in [highway-research.md](highway-research.md): which hubs get an expressway (gravity demand,
> cost-benefit growth, loops by detour), where it runs (least action with a curvature term; over the streets at 40 to
> 50 km/h in the core, on its own corridor at 60 to 80 km/h further out) and its ramps. That proposal refines this stage.

- **The expressway layer.** A deck about 10 m over the street, above some arterials (the widest, or one the terrain
  cast names), two lanes each way, 60 to 80 km/h; its own graph, joined to the streets below only by ramps (an on-ramp
  and an off-ramp near a junction), never by a crossing.
- **Drawn** as a deck on piers in the road's median; the street keeps running under it, and its ceiling is the deck
  (terrain-levels §8.3: a ceiling over a cell).
- **Bridges and tunnels** for roads over water and under hills, the same way: a road edge on a layer of its own.

## 4. Stage 3: the subway

- **Lines.** The subway's tunnels and stations become lines: each line a chain of stations (the station halls the
  underground already has, platforms along their length) joined by its tunnels, every few minutes a train each way.
- **Riding.** Walk to a station entrance (the layers' ways down), down to the platform, wait for the next train (the
  timetable), ride, and walk up from the far station: the virtual subway of tripTime made real and drawn. Talking on a
  train is option D on the rail graph.
- **The terrain cast** says which lines a city has where the text names them; elsewhere the fill lays one line along
  the arterials through the core, a station under each landscape of the kinds that sit on one (a station front, a
  centre, a square).

## 5. Stage 4: traffic

Background vehicles as a field of the road graph, like the crowd field of the walk grid (`world-engine/crowd/field.mjs`):
density by the hour (the story sky's time of day) and the district, flowing along the lanes, stopping at junctions,
parting for a chase, and dragging on the story's own vehicles (a jam the text names). Parked cars along local roads.

## 6. Order of work

1. Stage 1, the road graph and riding on it; then option D of the moving conversations into the director, checked on
   volume 3's drive and volume 1's cars and vans (13 vehicles, `universe/transport.json`).
2. Stage 2, highways, and stage 3, the subway (the user's order: "then highway/subway system").
3. Stage 4, traffic, when a scene needs it.
