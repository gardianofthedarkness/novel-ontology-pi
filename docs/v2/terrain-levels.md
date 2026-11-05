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
| underground city | rock, a cavern | 30 to 300 m | m | a city's streets on a cavern floor | a ceiling for a sky; the cavern's roof span (§8) |

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

## 4. Water (stage 2)

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

## 5. Underwater (stage 3)

- **Light:** fades with depth (most of the red gone by 5 m, little light below 50 m), the colour toward blue-green; the
  surface seen from below as a bright, wavering ceiling; caustics on the seabed in the shallows by day.
- **Seeing:** visibility short (fog by depth and how murky: a harbour 5 m, the open sea 30 m).
- **Moving:** swimming in three dimensions, slow; drag; currents drift what floats and swims.
- **Blasts:** water carries a blast farther and harder than air; a bubble column and a surge at the surface above (§4.3).
- **The seabed:** the depth field's surface, sand or rock; wrecks and things that sank lie on it.

## 6. The air (stage 4)

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

## 7. Space (stage 5)

- **The zoom ladder goes on** past a region: the planet (its curve, the atmosphere a glowing rim lit by the sun, night
  side with city lights), then orbit (places in it: satellites, stations), then the sky's stars.
- **Units:** kilometres above 100 km; the view keeps its precision with a floating origin (the world moved so the camera
  stays near zero) and a logarithmic depth buffer.
- **Moving:** orbits, not routes; a launch and a re-entry pass through the levels (the air bands, the clouds).
- **Physics:** no air: no drag, no sound, no fire's smoke rising; a beam's light unscattered.

## 8. Underground cities (stage 6)

A new hall kind, **cavern**: a void as large as a district (100 m to several km across, 20 to 200 m high), in hard rock
deep enough to hold its span (the bands of docs/underground-design.md §2.1, extended: a cavern needs the hard band and a
vaulted roof, or pillars). Its floor is filled as a city (cityFill on the cavern's outline, with the landscape type the
text gives: a market, homes, a facility), its ceiling lit as its sky (lamps, or none), and it is reached by shafts, ramps
or a subway line. Destruction follows the halls' rules at the cavern's scale: a confined blast, the roof-span test, a
cave-in to a dome; a cave-in of a shallow cavern dents the surface, never destroys it (§0.3 of the underground design).
Built when a book first has one.

## 9. Records

- Per place: its medium and band, how sure, from what (kept as the scale is; never canon).
- Per region of water: its bodies' outlines and depth profiles (derived from the place model; rebuilt when it changes).
- Per run: the disturbances (splashes, wakes, rings, falls), with the blows and the holes in the clouds, so a replay is
  the same.
- Per book's snapshot: as the universe snapshots keep everything else (docs/v2/universe-snapshots.md).

## 10. Order of work

Each stage is done when its picture sheets of every combination have been looked at and sent, its tests pass, and the
book it is for reads right.

| Stage | What | Done when | Paid |
| --- | --- | --- | --- |
| 1 | Each place's level (§3.1) and routes that know the medium (§3.2) | vol 1's places come out land and underground; vols 3 and 4's sea, air and orbit places are found; L10 says by what means | cents (one or two Jev questions per place) |
| 2 | Water: bodies, waves by the weather, the ripple field, floating, drawing (§4) | sheets: sea, lake, river by the times of day by calm, breezy, gale, with rain, and each disturbance | none |
| 3 | Underwater (§5) | sheets: depths by times of day, a blast underwater | none |
| 4 | The air: bands, flyers, falling, moving places (§6) | a flyer's route over the towers; a fall into water and onto the ground; a ship and an aircraft carrying people | none |
| 5 | Space (§7) | the zoom from a room to orbit and back; a launch | none |
| 6 | Underground cities (§8) | when a book has one: its cavern built, walked, and a cave-in | none |

Open questions for the user, taken stage by stage: whether swimming is allowed for anyone (or only where the text says
they swim); how a moving place's path is drawn when the text only says where it set off and where it arrived.
