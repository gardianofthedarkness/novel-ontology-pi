# Terrain levels: the sea, the air, space and the deep underground

**Status (2026-11-05): design only, nothing built.** Stages are taken one at a time (§10); each is checked with picture
sheets of every combination before it is called done, as the weather was (docs/v2/sky.md).

The user, 2026-11-05: *"Do we have ripple physics in non solid terrains? Maybe it's time to build full terrain system with
sea, atmosphere, universe level terrain and full underground level terrain, if there's any possible underground city
appeared in the novel. None of vol1 has it, but you will soon see them in other books."* Then: *"This is a big terrain
department change, write them in to a design first and we tackle one by one."*

## 0. Rules this design keeps

- **Few choices for Jev.** The underground's lesson (docs/underground-design.md §0.2): too many layers make Jev unsure, so it
  picks from two overlapping intervals and the box finds the hall. Here too: a place's level is two small choices (§3.1),
  never one long list.
- **The city model is authoritative.** Grids, meshes and fields (a water surface, a ripple field) are derived from it per
  region and rebuilt when the region's entities change; never kept as truth.
- **Never place by the engine's built node positions** (the e74ebda runaway): a level's routes are built from the place
  model, not from nodes a run happened to make.
- **Casts, not faculties.** Asking a place's level is part of the terrain cast (pre-film). The wave field, buoyancy,
  falling and the ripple simulation are physics, not a cast.
- **A level comes alive only once someone goes there** (docs/underground-design.md §4.8): the sea's ripple field, the
  underwater and the air above the rooftops are simulated only round where the story is.
- **View data, never canon.** Like the scale ladder, a place's level is a view input kept per place and reused while its
  name, path and children stay the same; what the physics draws (a splash, a wake, a hole in the clouds) is recorded with
  the run so a replay plays the same, and never written to the ontology.
- **Book text stays private.** Word lists for the levels (sea, underwater, aloft, orbit, underground city) are kept as
  `\u` escapes, as the weather words are.

## 1. What exists (audited 2026-11-05)

| Level | What is there | Where |
| --- | --- | --- |
| Space | nothing | |
| The air | the story sky (time of day, weather) and a cloud layer at 420 m that beams tear holes in; nobody can be up there | sky.md, strand-demo.html |
| The surface | the city: landscapes (skyscrapers, commercial, residential, industrial, harbour, park, stadium, village, castle, farm) and street forms (including a waterfront) | `src/v2/world/landscape.ts`, `cityFill.ts` |
| Water | flat blue strips down a waterfront street's length; no shore, depth, waves, ripples, swimming or boats; a walk across water fails as "no way there on foot" | `landscape.ts` (`waters`), strand-demo.html |
| Underground | halls in the ground (subway, mall, storm water, basement, deep facility, shelter, lab, military), the ground's three bands, confined blasts, roof spans, cave-ins and dents; flooding designed, not built | `src/v2/world/underground.ts`, docs/underground-design.md |
| A place's size | one Jev choice: region, city, district, street, building, room | `src/digger/stage/scale.ts` |

Nothing says whether a place is at sea, under the water, in the air or in orbit; so the size ladder's "a ship" is a
building on land, and the route to it fails.

## 2. What the books need

Counted in the private snapshot's four books (words, some of them figures of speech; counts only):

| | vol 1 | vol 2 | vol 3 | vol 4 |
| --- | --- | --- | --- | --- |
| at sea, the sea's surface | 7 | 0 | 10 | 21 |
| under the sea, under water | 3 | 2 | 10 | 1 |
| ripples, waves, spray | 5 | 2 | 7 | 2 |
| in the air, high up | 25 | 28 | 13 | 62 |
| the atmosphere's layers | 0 | 1 | 0 | 4 |
| space, orbit, satellites | 9 | 17 | 23 | 59 |
| underground | 26 | 8 | 31 | 7 |
| an underground city or street | 0 | 1 | 0 | 0 |

Vol 3 is the watery one; vol 4 the airborne and orbital one. No underground city yet: the cavern level is built when a book
has one, from this design.

## 3. The model: one column of levels

The world is one column. Each place stands in one **level**, a medium with its own extent, units, movement and physics:

| Level | Medium | Height or depth | Units | Moving there | Physics |
| --- | --- | --- | --- | --- | --- |
| orbit | vacuum | above 100 km | km | spacecraft only; orbits, not routes | no air: no sound, no drag; things keep their speed |
| high air | thin air | 2 to 15 km | m, km | aircraft, the strongest flyers | wind aloft, cold; falling from here takes minutes |
| low air | air | rooftops to 2 km (the clouds at 420 m) | m | flyers, helicopters, a fall | gravity with drag, wind |
| surface | ground | the street | m | walking, vehicles | as now |
| water's surface | water | 0 m (with waves) | m | boats, swimming, wading where shallow | buoyancy, waves, ripples, wakes |
| underwater | water | 0 to the seabed | m | swimming, submarines | light fades with depth, drag, currents, muffled blasts |
| shallow underground | soil | 0 to 25 m | m | halls (as built) | as built: confined blasts, dents |
| deep underground | rock | 20 to 110 m | m | halls (as built) | as built: cave-ins |
| underground world, city | rock, a cavern | 30 to 300 m | m | an area's streets on the deep floor; up by the virtual elevator | a hard ceiling far up (§8.6); a city's ceiling lit as its sky (§8.7) |

### 3.1 How a place gets its level (the terrain cast)

Two Jev choices per place, each short, asked with the place's name, its path in the place tree and its scenes' lines (as
the scale is asked):

1. **The medium:** land, water, air, space, underground (5).
2. **Its band**, only within the medium, at most three: water: the surface or under it; air: low (rooftops to the clouds)
   or high (above them); underground: as the halls' two overlapping intervals, or a cavern city. Land and space have none.

A place's height or depth within its band comes from its scenes (a stated altitude or depth, a floor, "above the clouds")
and else the band's middle; the box finds the rest, as underground. The answer is kept per place like the scale and
reused while its name, path and children stay the same. A moving place (a ship, an aircraft, a spacecraft) is also
marked moving (§6.3). Vol 1 should come out all land and underground; the check is that it does.

### 3.2 Between levels

- **Routes know the medium.** A walk stays on the surface and in halls. Crossing water needs a boat, a bridge or a swim
  (slow, only where the text lets them); being aloft needs flight (the ability sheets already say who flies) or an
  aircraft; orbit needs a spacecraft. L10 ("no way there on foot") becomes "no way there by any means this person has",
  and says which (on foot, by boat, by air).
- **Ways between levels** are places of their own, generated with the level: a shore and a dock (land and water), a
  rooftop pad (land and air), a launch site (land and orbit), a shaft or stairs (land and the underground, as built).
- **Falling** joins every level: anyone in the air without flight falls under gravity with drag (a person reaches about
  55 m/s), into water (a splash, §4.3) or onto the ground (an impact, as a blow).

### 3.3 Layers: the third dimension of the manifold model (the user, 2026-11-06)

> "A underground street should be compatible with its upper layer. It means placing it down won't affect the streets on
> top. City and district level can be placed underground, but they will automatically be the without ceiling underground
> layer. We haven't done atmosphere level and universe levels yet which also belongs to this switching layer logic. This
> is basically, a third dimensional layer to the vector manifold mathematical model we have"

**The model.** A manifold (borrow-and-spawn.md §8) keeps its kind, its vector from its parent's centre, its radius, its seed and its average height. It now also keeps a **layer**: the plane it lies in.

| Layer | What lies there | Depth or height | Its ceiling | Built |
| --- | --- | --- | --- | --- |
| space | orbit | above 100 km | none | not yet (§7) |
| atmosphere | floating places, the sky | over the rooftops | none | not yet (§6) |
| surface | the city as now | the street | the sky | yes |
| shallow underground | every hall with a real depth: basements, malls, the subway, a street laid under, storm water, deep facilities | its own, however deep | the ground skin | yes |
| deep underground | an underground world: a virtual space | none of its own | none felt (§8.6) | not yet |

**The rules:**
1. **Each layer is its own plane.** Topology, pressure and squeezing (§8.3) and height unification (§8.6) act only between manifolds of one layer. A manifold never moves, squeezes or re-heights one in another layer, so placing a street under the street changes nothing on top.
2. **The vectors cross layers.** A manifold's parent may lie in another layer. Its vector is kept in the parent's frame (§8.5), so a street laid under a district stays under it when the district moves, and a squeeze of the parent scales it like any child.
3. **The layer follows the scale and the height answer.**
   - A street, a building or a room answered below the street lies in the shallow layer, under the skin.
   - A city or a district answered below the street lies in the deep layer automatically: no ceiling is asked, and its depth is not a number.
   - A place answered above (a floating shape, §8.9 of borrow-and-spawn) lies in the atmosphere, and an orbit in space.
4. **Neighbouring layers are compatible.** The shallow layer and the surface share the ground's column. The surface keeps its form; the shallow manifold takes only the ground under it (the surface's basements stop above its air); its ways up land on the surface's open ground; nothing of it shows on top.
5. **Switching layers is a portal:**
   - stairs, a lift or a shaft between the surface and the shallow layer;
   - the virtual elevator between the surface and the deep layer;
   - flight or a take-off into the atmosphere, a launch into space.
   - A walk is solved inside one layer, and a route switches at a portal (§8.2, `world-engine/world/layers.mjs`).
6. **Saved in the map.** A manifold's layer is part of the map (§8.1 there) and its log (§8.8).

**Built first: the shallow layer (2026-11-06).**
- **Slots keep their layer** as `plane` (`layer` already names a slot's kind of holding). The terrain loop gives a place the note puts underground the shallow layer (a street, a building, a room) or the deep one (a city, a district) (`planeOfPart` in terrain-spawn.mjs).
- **Choosing, moving and spares stay inside one layer:**
  - a place borrows or spawns only a slot of its own layer;
  - a spawn is placed by its story's travel among its own layer's places, and a surface spawn's re-layout of its parent is never run for it;
  - the level's moves and its spares' places look only at their own layer;
  - children's slots take their parent's layer.
  - W12's stretch now spawns `slot:loc_000004:alley:2` in the shallow layer, where before it took district 7's surface alley.
- **The surface's fabric ignores what lies below** (`landscape.ts` `surfacePatches`): a patch answered under the street claims no surface lot, cuts no block, lends no height and does not widen the city's circle. A world test checks that the surface over a street laid 30 m under is the same, building for building, as without it.
- **The canvas keeps layers apart** (`placeCanvas.ts` `onSurface`):
  - a place of another layer is never the area a surface building is sampled into, dwells in or is hosted by;
  - it takes no room, pushes nothing and grows nothing on top.
  - The export lays the surface out as if a below-street place's scenes stood at its holder (the area the script filed them in: the trips, the continuity ties, the order places are born in), and lays the below-street places out after it.
- **Adding to a built world** (`terrain-spawn.mjs --add`, option `add`):
  - a level with nothing new keeps its end as it was;
  - one whose new places all lie under the street settles only their layer;
  - only the slots the run changed are written back into the book's sites.
  - Run again over a built library, the full loop re-settles every level end, and with today's code that moves 46 of library 16's places with nothing added.
- **Checked on copies of library 16 with their universe, W12's stretch placed by Jev's answers replayed:** with `--add`, the stretch moves none of the 221 places on the map, changes none of the library's 166 sites, and adds exactly two things: itself and its shallow slot. With no new place, `--add` changes nothing at all.
- **Still to come:**
  - the deep layer's own plane for a city or a district put underground (its virtual space, the virtual elevator);
  - the atmosphere and space, by the same rules.

**A correction (2026-11-06).** "Adding one place re-ran the whole city" (the test of 2026-11-05) was the test copies' doing, not the engine's. A book copied outside its library keeps its universe inside the copy (`pools.ts` `universeOf`), so the copies started with no slot registry and the terrain loop spawned every spare slot afresh: with no new place at all, a first run moved 87 spare slots, and a second run moved none. A test copy needs its library's universe beside it.

### 3.4 Ways between layers: dense, general, always there (the user, 2026-11-06)

> "Before you move to the deep and sky and universe, we need to make sure there are general and dense enough virtual stairs
> and elevators that always connects the underground to the ground, for any layer."

**The rule.** Every space of another layer is joined to the ground by ways that are always there, dense enough that nobody
has to look for one:
- **Where:** over the space's floor, one way on each 40 m square of the world's grid, from the floor cell nearest that square's middle. So no spot of a floor is more than about 30 m from a way.
- **To:** the nearest open ground above, within 20 m.
- **Always:** a space whose floor gets no way that way (the ground over it all built) gets one from its cell nearest open ground, however far.
- **What:** stairs where the rise is up to 20 m, costed as a building's stairs, a floor's climb at a time (a climb never cheaper than the solver's guide, so it never scales its guide down). Deeper, a lift, costed as the ride: its rise at 5 m/s plus a 20 s wait, at a walk's 1.4 m/s.
- **Virtual:** they are the world's own, not the text's. The text's own ways (a station's stairs, a facility's shaft: a hall's `up`) stand beside them, and a route takes whichever is cheaper.
- **In the walk graph** (`world.ts` `worldGraph`, its `ways`): every walk and route sees them. A way into a space more than 20 m down is a portal between the solver's bands (§8.2).

**For any layer, by the same rule.** Each layer joins the ground by its own kind of way on the same grid:

| Layer | Its ways to the ground |
| --- | --- |
| shallow underground | stairs to 20 m, a lift deeper (built) |
| deep underground | the virtual elevator: a lift on every square (§8.6) |
| atmosphere | a lift or a landing down to the ground under a floating place (stage 5) |
| space | a launch or a space elevator (stage 6) |

## 4. Water (stage 3)

### 4.1 Bodies of water

The landscape gains water types beside its land ones: **sea** (the outside of a coastline), **bay**, **lake**,
**river** and **canal** (a band along a line, as the waterfront's strip is now), **pool**, and later **flood** (water filling
a hall to a breach, docs/underground-design.md §4.6). Each body has an outline (a patch's outline, as land's) and a depth
profile: a shore that shelves (about 1 in 20 for a beach, steep at a quay), a river deepest in its middle. The seabed is
the depth field's surface. A harbour and a waterfront keep their buildings and gain their water as a body, not a strip.

### 4.2 The surface: waves by the weather

The open water's surface is a sum of a few Gerstner waves (the way games draw open water cheaply), their height and
length set by the wind (weather's `wind`, sky.md) and by how open the water is:

| Wind | Sea | Wave height | Rivers and lakes |
| --- | --- | --- | --- |
| calm | glassy, a long low swell | 0.1 to 0.3 m | still, reflections |
| breezy | small waves, a few whitecaps | 0.5 to 1 m | catspaws, ruffled |
| gale | rough, breaking crests, spray | 3 to 5 m | choppy, whitecaps on a lake |

Rain roughens it (fine rings everywhere, §4.3), fog greys its distance, a storm brings the gale's sea. A river flows: its
surface drifts down its line.

### 4.3 Ripples: the local field

Round where the story is, a ripple field: a height grid (256 by 256 cells over about 200 m round the camera's target) run
by the wave equation on the GPU (two textures, each step from the last two, damped), added to the waves. What disturbs it,
each a ring or a line pushed into the grid:

| Source | From | What it makes |
| --- | --- | --- |
| a step in shallow water | a pawn wading | small rings at each step |
| a body falling in | a fall (§3.2), a throw | a ring and a crown of spray as big as its mass and speed |
| rain | the weather's rain | fine rings everywhere, denser the heavier |
| a blast on or by the water | an area blow (laws/attacks.mjs) | a large ring, a column of spray, a wave that runs to the shore |
| a beam into the water | a line blow landing on water | a burst of steam and a ring |
| a boat | a moving thing on the water | a Kelvin wake (a V about 39 degrees wide) and a bow wave |
| the wind | the weather | nothing local: it is the waves' (§4.2) |

Things on the water bob and tilt with the surface (sampled at their footprint); a body in it floats or sinks by what it is.
The splashes, wakes and rings are recorded with the run (like the holes in the clouds) so a replay plays the same.

### 4.4 Drawing

A water shader: the sky's colour reflected by the Fresnel term (the hour's sky from daylight; at night the city's lights
as smeared streaks), the depth's colour through it (clear in the shallows, dark far out), the sun's glint by day, foam on
crests and at the shore, the ripples' normals on top. Fog and the weather as on land. Checked like the weather: every body
(sea, lake, river) by the times of day by calm, breezy and a gale, with and without rain, and each disturbance.

## 5. Underwater (stage 4)

- **Light:** fades with depth (most of the red gone by 5 m, little light below 50 m), the colour toward blue-green; the
  surface seen from below as a bright, wavering ceiling; caustics on the seabed in the shallows by day.
- **Seeing:** visibility short (fog by depth and how murky: a harbour 5 m, the open sea 30 m).
- **Moving:** swimming in three dimensions, slow; drag; currents drift what floats and swims.
- **Blasts:** water carries a blast farther and harder than air; a bubble column and a surge at the surface above (§4.3).
- **The seabed:** the depth field's surface, sand or rock; wrecks and things that sank lie on it.

## 6. The air (stage 5)

### 6.1 Bands

Low air: the rooftops to the clouds (the cloud layer at 420 m, sky.md, is its ceiling where the weather has clouds). High
air: above them to cruising height. Each band has the weather's wind, stronger with height.

### 6.2 Moving

Flyers (the ability sheets) move on straight lines at a height that clears the towers, rise and descend at the ends;
helicopters likewise, slower. A fall is the physics of §3.2. A beam through the clouds is as built.

### 6.3 Moving places

A ship, an aircraft, a spacecraft is a **moving place**: a room or a building whose frame moves along a path. Those inside
it move with it; its interior is built once, as a building's; its path comes from the scenes (where it sets off, where it
is said to be). Its scale stays the size ladder's (building or room); its level is where it is (water, air, orbit).

## 7. Space (stage 6)

- **The zoom ladder goes on** past a region: the planet (its curve, the atmosphere a glowing rim lit by the sun, night
  side with city lights), then orbit (places in it: satellites, stations), then the sky's stars.
- **Units:** kilometres above 100 km; the view keeps its precision with a floating origin (the world moved so the camera
  stays near zero) and a logarithmic depth buffer.
- **Moving:** orbits, not routes; a launch and a re-entry pass through the levels (the air bands, the clouds).
- **Physics:** no air: no drag, no sound, no fire's smoke rising; a beam's light unscattered.

## 8. The underground in two layers, and ceilings (stage 2)

The user, 2026-11-05, after W12: *"Looks like we really need to build the layering of terrain system. I think for
underground we can do with ground skin interaction near ground layer and space like without ceiling deep underground
layer. We need to figure out how to deal with ceilings."*

Then, on the questions: *"1 yes it can break through. For deep level I would go up to terrain loop area thing. I think we
actually already have a underground option, but jev never picks anything larger than building level to go underground.
Maybe we need implicit casts to leave a note to certain area that it's highly likely an underground area with or without
ceiling. The fact of without ceiling isn't actually without ceiling, but conceptually too deep and wide that it feels like
an underground world, it would still hit the ceiling if high enough but it can't penetrate, and if anyone comes back up
to the ground they have a dense enough virtual elevator to do so."*

What W12 (d20261105181503) showed:
- **No underground place.** Scenes 120–131 really are underground (an escape up stairs to the street), and the reread says so, but the scenes stand at the whole city's place. Their underground moves found no hall, and half of scene 123's moves did not play.
- **One shared walk graph.** 7 arrivals failed only because a deep lab's lift (90 m at a flat cost of 24) was inside a street route's walk graph window. To stay within the lift's cost, the solver's guide is scaled almost to nothing, and on a 100–136 m leg the walk's start weight falls to zero.

Both come from the street and the underground sharing one walk graph and one notion of "up".

### 8.1 Two layers

**Corrected (the user, 2026-11-05):** "30m to be honest is a shallow layer, not a deep layer ... A deep layer is a virtual space provided with no actual how deep and how tall the space is."
- **The shallow layer is everything with a real depth,** however deep: basements, malls, the subway, W12's underground stretch at −30 m, storm water at −40 to −50 m, deep facilities at −90 m. Its halls are joined to the street and to each other by their own stairs, lifts and shafts.
- **The deep layer is a virtual space:** an underground world the terrain loop lays there, with no depth or height of its own. Its ceiling is too far to feel, and it is left by the virtual elevator. Nothing in vol 1 is there yet.
- **The table below splits the layers by depth (20–25 m). That split is wrong** and is kept only as the record of what was built first. The engine's split at 20 m (`DEEP` in export-strand-demo.mjs) is to be replaced:
  - the layer becomes what a place is (a real hall, or the virtual space), not its depth;
  - the virtual elevator serves the virtual deep layer only;
  - a street walk's window keeps leaving out halls far below what its ends need (that is what kept W12's 90 m lifts from breaking long legs), as a matter of the solver's window, not of layers.

| | Near-ground layer | Deep layer |
| --- | --- | --- |
| Depth | 0 to 25 m: basements, malls at −7 m, stations and tunnels at −12 m | below 20 m: storm water at −40 to −50 m, deep facilities at −80 to −100 m, and **underground worlds**: whole areas the terrain loop places down there (§8.5) |
| Its ceiling | **the ground skin:** the street's slab and the soil over the hall. One sheet: the hall's ceiling below, the street above (§8.4) | **a hard ceiling, far up:** so deep and wide that it feels like none, as space does. It is hit if one goes high enough, but never penetrated (§8.6) |
| With the surface | through the skin: entrances and stairs, dents, breaches, light and sound through openings | its own shafts and lifts, and a dense virtual elevator everywhere (§8.6); a cave-in never reaches the street (decided 2026-10-30) |
| Drawing | the street see-through over it, as now; the skin's underside as the hall's ceiling, cut away toward the camera | no lid: the camera looks straight in, and the void's walls fade into the dark |
| Moving | walking on hall floors; a leap or a flight stops under the skin | walking on the floor; a leap or a flight stops only at the hard ceiling |

The two overlap from 20 to 25 m, as the halls' two Jev intervals do (docs/underground-design.md §0.2): Jev still picks one of two, and the box finds the hall. A place's band from §3.1 is its layer.

### 8.2 Layers are separate walk graphs, joined by ways

- **Each layer is its own walk graph:** the surface (with the buildings), the near-ground layer, the deep layer.
- **The ways between layers are portals:** station stairs, mall entrances, basement ramps, shaft lifts and ladders, a breach in the skin (§8.4), and the deep layer's virtual elevator (§8.6).
- **A route across layers is solved in two steps:**
  1. first a short path over the portals: which stairs, which lift;
  2. then one walk per layer, each solved inside that layer only.
- **What this fixes:** no surface leg's window ever holds a lift, so the solver's guide is never scaled down for one (the 7 W12 failures). A lift's cost (24 for any depth) is paid once, on the portal path.
- **L10 learns more:** "no way there" also says which layer the way is missing in.

### 8.3 Ceilings

A ceiling belongs to the level a person is in; it is not geometry laid everywhere. Five kinds:

| Ceiling | Where | What it is |
| --- | --- | --- |
| the sky | the surface, the air | open: the story sky, its weather and clouds (docs/v2/sky.md) |
| a floor slab | inside a building | as built: the floor above |
| the ground skin | the near-ground layer | a shared, breakable sheet (§8.4) |
| the hard ceiling | the deep layer | far up and never drawn: hit, never penetrated (§8.6) |
| a cavern sky | an underground city (§8.7) | a dome lit as its sky: lamps, or dark |

What a ceiling decides, one rule each:
- **The camera:** a ceiling never hides the people under it.
  - The skin is see-through while anyone shown is below it, as now.
  - A hall's ceiling is drawn only from below, and fades out within a few metres of the camera.
  - The deep layer has no lid to fade.
- **The sky:** under any ceiling but the sky, there is no sun, rain, snow, fog or cloud layer.
  - The light is the hall's own, by its kind: a mall's warm lamps, a deep facility's hard white, a storm-water channel nearly dark.
  - Under a breach in the skin, the sky shows through. Its light falls in as a shaft (the cloud hole's shaft, reused), and rain or snow falls through the hole.
- **Moving:**
  - A leap, a flight or a thrown body under a ceiling stops at it, a body's height below. Misaka's magnetic leaps underground stay under the skin.
  - A fall from above is stopped by a ceiling unless there is a breach.
- **Blows:**
  - A blast is confined, as built. Its upward reach stops at the ceiling; against the skin, it can breach it (§8.4).
  - A beam fired upward under a ceiling hits it. Under the skin, it can breach it.
  - Only a beam that reaches the open sky tears the clouds: `cutsClouds` checks the level first.
  - In the deep layer, a beam or a blast that reaches the hard ceiling is stopped by it and marks it, never breaks through.
- **Earshot:** a ceiling stops sound between levels. A talk across the skin is remote unless an open way (stairs, a breach) is within earshot. L6 then holds fewer talks between people one level apart.

### 8.4 The ground skin

The skin is one sheet per region over the near-ground layer, derived from the city model. Over each hall it is the street's slab with the hall's cover beneath: the hall's depth less its height. Each of its cells is a street cell above and a ceiling cell below: one state serves both.
- **A dent** (decided 2026-10-30): a cave-in that reaches the skin drops it by at most 3 m, and it stays walkable.
- **A breach** (the user, 2026-11-05: "yes it can break through"): a blow strong enough to break the skin's cells opens a hole. A cell breaks at the soil band's bond of 3, plus 4 for a lining.
  - Through the hole, people and things can drop (a fall), the sky's light, rain and snow come in, sound carries, and the camera sees through.
  - A hole is a portal (§8.2), so a route can use it: down as a drop, up only for those who leap or fly.
- **Load:** a heavy thing on the street over a shallow hall (a crashed vehicle, rubble) presses on the skin. Past what the span holds, the underground's roof test runs (docs/underground-design.md §4.3). This is how a fight in the street reaches the mall below it.
- **Entrances** are holes made on purpose: stairs, with a roof over them.

### 8.5 Which areas lie underground: the casts' note and the terrain loop

**Today:** the terrain loop asks every part's height with the underground's slices first. But a city or a district is never offered them (the user's gate of 2026-11-01, in `terrain-spawn.mjs`), so only a street, a building or a room can go under the street. An area that is underground as a whole, like an underground world, a district below the city, or a whole facility zone, has no way to be placed there.

**The note:** a pre-film cast leaves one on each place the text puts underground: how likely it is, and which layer.
- **Who writes it:** the set dresser, which already reads a scene's environment facts and the buildings named. Each place's note gathers what its scenes say:
  - its underground facts (W12's reading has them, such as "underground (implied, 80%)");
  - its stairs down and lifts;
  - the words for no sky.
- **What it says:**
  - near the street, with a ceiling: the skin;
  - or deep, an underground world, its ceiling too far to feel;
  - with how sure, and the sentences.
- **What it is:** a view input kept per place like the scale, never canon.

**The terrain loop reads the note:**
- **The gate is lifted for a noted area:** a city or a district with a sure note is offered the underground's slices, as a street is now.
- **Two slices only,** as Jev's choices underground always are: near the street (under the skin), or an underground world (deep).
- **An area answered deep** is laid out in the deep layer by the terrain loop as any area is: its kind, its box, its height. Its streets and buildings stand on the deep floor, and its height sets where its hard ceiling is (§8.6).
- **An area with no note** keeps today's gate.

**Places inside an underground area** (its streets, buildings and rooms) inherit its layer, so a scene in one is underground without being asked again. That is what scenes 120–131 lacked.

**Built first, before the note (2026-11-05):**
- **A unit the set dresser calls underground** (W12: units 118, 121, 123) starts under the street. Its anchor goes to the nearest spot below the street that a walk reaches within 120 m, the near-ground layer first. Whoever stands above walks down to it. The record keeps where it was moved from and to (`underground`).
- **A fact's spot is picked only where a walk reaches** (`reachableIn` in world.ts, the engine's `onFoot`). Before, a basement or hall a few metres off, whose way down lay outside the walk's window, was chosen card after card and never reached.
- **Said to be underground, with no way down near:** a stated fact looks for the nearest way down a walk reaches within 120 m (L14 `went down`).
- **A walk whose way leaves its 40 m margin** is solved once more with a wider one, but only where a walk is known to reach the target. The unit's record counts these (`widened`).
- **Rehearsed on W12's units 115–131 (unpaid):** failing facts 23 → 14, "no way there" 6 → 0, layout retakes 26 → 4, key-check retakes 14 → 5.

**Then the rest of stage 1 (2026-11-05):**
- **The note** is built as a free step: `experiments/v2/underground-notes.mjs` writes `underground-notes.json` beside the reading. It gathers the set dresser's settings and the pre-film notes' underground facts by place (`world-engine/digest/underground-note.mjs`), and asks nothing.
  - A place is noted when at least 2 of its units are underground and they are at least half of all its units. Its places inherit the note.
  - The layer is near unless the evidence says deep. The set dresser cannot tell the two apart, so every note says near for now.
  - It has to run after the set dresser and before the terrain loop, so the set dresser moves ahead of the terrain in a library's build.
- **The gate:** the terrain loop offers the underground's slices to a noted city or district (`terrain-spawn.mjs`, option `notes`).
- **The director** starts a noted place's units under the street, as it does a unit the set dresser calls underground.
- **Vol 1 notes nothing.** W12's underground stretch (units 118–125) is filed under the whole city: 7 of its 144 units are underground. The note is right not to put the city under the street, but that stretch has no place of its own to note. Today the units' own settings carry it.
- **Underground stretches get a place of their own** (the user, 2026-11-05: yes). `experiments/v2/underground-stretches.mjs` (free, `--write` to apply) finds runs of units with underground evidence at one city- or district-scale place, in one sequence, at most two units apart (W12: units 118–123, with 119 between). Each becomes an unnamed place of the street's scale under that city, written into the reading (a slot, its units set there) and the world script. The note then notes it (W12: 5 of its 6 units).
  - **The terrain loop offers a noted place only the underground's slices.** Offered every height, Jev answered W12's stretch "an alley, 5 m" with 10% confidence. Offered only the underground, it answered "−30 m, a deep hall" with 73% (2 paid calls each time, on test copies).
  - **The director starts a noted place's units in its own hall:** `<place>:shape`, `<place>:under`, or the hall of the slot it borrows in spawn mode.
  - **Tried on a test copy of library 16 with Jev's real answers:** units 118–123 start in the stretch's corridor at −30 m, ride lifts down 9 times and up 8, and every route arrives. But in spawn mode the place took a spare alley slot of district 7, 1.8 km from where the story was. So against the units' own settings it does worse: failing facts 14 → 18 and arrivals over 500 m 0 → 6, though key-check retakes 5 → 2. Library 16 is not changed.
  - **Open:** placing a stretch near the place its story comes from (the bar of units 114–117), before it is adopted.
- **Portals** (`world-engine/world/layers.mjs`, the engine's `portalsNear`): a walk between the street's band and the halls more than 20 m down goes to a portal in its own band (a lift, a shaft, stairs, a ladder), rides it, and walks on, each leg solved inside its band. The portals are tried cheapest first, up to four. The bands are the solver's, not layers: every real hall is the shallow layer, and a hall's or a building's band is where it stands (a building of a street 30 m under is in the lower band up to its roof).
- **The virtual elevator,** now part of the general ways of §3.4: every hall's floor has stairs or a lift on every 40 m square of the world's grid, built into the walk graph. A virtual deep layer will take the same grid of lifts.
  - Checked on library 16 (before the correction, with virtual lifts over real halls): down into and up out of a 90 m military facility by its lift; every trip crossed bands once.
- **L10 says how and where:** "no way there on foot (at street level and just under it)", "no way climbing more than 20 m down from the lift to there", "no lift, shaft, stairs or ladder within 120 m".
- **A start walled into a sliver** of open ground between buildings (a cell or two; W12's unit 169) steps out to the nearest ground a walk leaves from, within 8 m. The unit's record counts these (`freed`).
- **Rehearsed (unpaid):** units 1–84 unchanged with the portals in; units 144–171, where W12 failed near lifts, have 0 "no way there" and 0 of 5 arrivals unreached.

**A street laid underground, built out (the user, 2026-11-05: "Yes, build it out"):**
- **Its form:** a street-scale area the terrain loop answers below the street is laid as a street of its kind (its rows, a square's rings) on its floor (`landscape.ts` `sunkForm`). Its heights are half the room up to the 3 m ground skin on average, and every roof stays under the skin. It has no road, water or plaza: its open ground is its hall's floor.
- **Its hall** (`underground.ts`, `street: true`) holds every building of the form with a 4 m lane round them, open up to the skin, with stairs up at its ends and no pillars.
- **One street per place:** a place that borrows a slot (spawn mode) takes its underground street from the slot's form only. Its depth keeps the terrain loop from mapping it, so the export also gave it a landscape of its own, and two streets were laid 30 m down on one spot at two angles.
- **Its buildings** stand on its floor as lots with a level `k0` (world.ts), holding their cells in `lotBelow`, so a building on the street above keeps the same column. Their doors open onto the hall's floor, their floors count from their own ground floor, and the street's basements stop above its air.
- **Its heights from Jev:** a building borrowing a lot of such a street is offered only the floors that fit under the skin, and no slice below its street.
- **The director** names such spots ("a room of the shop (5 floors), floor 1, 30 m under the street"; "an underground street, 30 m down") and counts floor facts from the building's own ground floor. "Underground, on the ground floor" (W12's unit 120) now holds there.
- **The viewer** draws its buildings on its floor, the hall as its floor and its ceiling in outline, and fades the street's buildings over it while anyone is below.
- **Rehearsed (unpaid)** on a copy of library 16, with W12's stretch placed by the real Jev's answers replayed (an alley, −30 m): units 118–123 start in it, walk into its shops and up its stairs, and every walk and arrival is found. Units 1–84 and 115–131 come out the same as before the change.
- **Open:** where a stretch is placed (spawn mode put it in a spare alley slot 1.8 km from the bar), and adding a place without moving the rest of a built world.

### 8.6 The deep layer's ceiling, and the virtual elevator

**The hard ceiling.** An underground world has a ceiling, but it is so high and so wide that from inside it reads as open, the way space does.
- **Where:** the area's own height (what the terrain loop answered) plus a margin, and no less than a floor above its tallest building.
- **Drawing:** none. The view fades into the dark above, as the deep layer's walls do.
- **Moving:** a leap, a flight or a thrown body that goes high enough hits it, and stops.
- **Blows:** a blast or a beam that reaches it is stopped and marks it, and never breaks through.
- **The street above:** no cave-in, blast or beam from the deep layer ever reaches the street.

**The virtual elevator.** Nobody in the deep layer has to find a shaft to get back up. Like the virtual subway of a long trip (`laws.mjs` tripTime: run to a virtual station, ride, run from the far one), the deep layer has a lift everywhere:
- **Where:** a grid of virtual lifts over every deep area, dense enough that no one walks more than about 30 m to one (one every 40 m).
- **Joins:** each lift's foot, on the deep floor, to the nearest open ground on the street above it. It is a portal (§8.2), so a route up or down is a walk to the nearest lift, the ride, and a walk from its top.
- **Time:** the ride takes its depth at a lift's speed, about 5 m/s, plus a wait. It is not a flat cost, so a deep world is farther from the street than a basement is.
- **What is built:** no shaft. A lift in use is drawn as a faint column while someone rides it.
- **The text first:** a lift, a shaft or a ramp the text names is built as a real one, and routes prefer it; the virtual grid only fills in.

### 8.7 Underground cities (stage 7)

A new hall kind in the deep layer, the **cavern**:
- **Size:** a void as large as a district, 100 m to several km across and 20 to 200 m high.
- **Where:** in hard rock deep enough to hold its span. This extends the bands of docs/underground-design.md §2.1: a cavern needs the hard band and a vaulted roof, or pillars.
- **Inside:** its floor is filled as a city (cityFill on the cavern's outline, with the landscape type the text gives: a market, homes, a facility).
- **Its ceiling** is the deep layer's one exception: drawn as a faint dome lit as its sky (lamps, or dark). In physics it is still the hard ceiling (§8.6).
- **Ways in:** shafts, ramps or a subway line, all of them portals, with the virtual elevator (§8.6) filling in.
- **How it is placed:** as an underground world (§8.5), whose floor is filled as a city.
- **Destruction** follows the halls' rules at the cavern's scale: a confined blast, the roof-span test, a cave-in to a dome. A deep cavern's cave-in never reaches the street.

It is built when a book first has one.

## 9. Records

- Per place: its medium and band, how sure, from what (kept as the scale is; never canon). An underground band is the
  place's layer (§8.1).
- Per region: the ground skin over its near-ground halls (derived; rebuilt when its halls or streets change), and the
  portals between the layers.
- Per region of water: its bodies' outlines and depth profiles (derived from the place model; rebuilt when it changes).
- Per run: the disturbances (splashes, wakes, rings, falls), the skin's dents and breaches, with the blows and the holes
  in the clouds, so a replay is the same.
- Per book's snapshot: as the universe snapshots keep everything else (docs/v2/universe-snapshots.md).

## 10. Order of work

Each stage is done when its picture sheets of every combination have been looked at and sent, its tests pass, and the
book it is for reads right.

| Stage | What | Done when | Paid |
| --- | --- | --- | --- |
| 1 | Each place's level (§3.1), with the set dresser's underground note and the terrain loop's gate lifted for noted areas (§8.5); the layers as separate walk graphs joined by portals, the virtual elevator among them (§8.2, §8.6); routes that know the medium (§3.2) | vol 1's places come out land and underground (scenes 120–131 in the near-ground layer); vols 3 and 4's sea, air and orbit places are found; W12's 7 lift failures walk; L10 says by what means and in which layer | cents (one or two Jev questions per place; the note rides on the set dresser's reading) |
| 2 | The underground's two layers and ceilings: the skin, breaches and load, the deep layer's hard ceiling, the sky and light under a ceiling, leaps and beams stopped by a ceiling, earshot (§8.1–8.6) | sheets: each hall kind and an underground world, by day and night, with the camera above, at and below the skin; a breach by a blast and by a beam, with rain falling through; a leap stopped by the hard ceiling; a ride up the virtual elevator; vol 1's first quarter rehearsed with no underground move unplayed | none |
| 3 | Water: bodies, waves by the weather, the ripple field, floating, drawing (§4) | sheets: sea, lake, river by the times of day by calm, breezy, gale, with rain, and each disturbance | none |
| 4 | Underwater (§5) | sheets: depths by times of day, a blast underwater | none |
| 5 | The air: bands, flyers, falling, moving places (§6) | a flyer's route over the towers; a fall into water and onto the ground; a ship and an aircraft carrying people | none |
| 6 | Space (§7) | the zoom from a room to orbit and back; a launch | none |
| 7 | Underground cities (§8.7) | when a book has one: its cavern built, walked, and a cave-in | none |

Open questions for the user, taken stage by stage:
- whether swimming is allowed for anyone, or only where the text says they swim;
- how a moving place's path is drawn when the text only says where it set off and where it arrived.
