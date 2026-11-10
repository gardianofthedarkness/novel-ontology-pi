# Places as open layers (the user, 2026-11-10)

> "We didn't build country level hierarchies and the second book involves cross country travelling that messed up the
> terrain. We need to build a universal abstract self growing layer of places system, not hard-coded to street district
> city country continent planet solar system etc. we need an abstract place layer, that even if we throw in a cross
> galaxy science fiction can work smoothly." — the user, 2026-11-10, stopping volume 2's run (W16)

Status: design, not built (milestones M18).

## 1. What broke, measured (volume 2, library 16)

The place scale is a fixed list of six (`src/v2/rules/places.ts`: room, building, street, district, city, region), and
everything above a city is "region". Terrain builds one canvas whose top is a city (`src/v2/terrain/config.ts`:
`LEVELS = city, district, street, building`), and the engine lays every built place on that one canvas.

Volume 2 travels between countries:

| Volume 2's place tree | Count |
| --- | --- |
| places | 158 |
| "region": one word for the planet, five countries, a river and "the world" | 8 |
| places at the root (no parent) | 19, among them a home district and a hospital that volume 1 holds inside the city |
| grounds the story is set in (a city, or a place with no city above it) | 9 |
| crossings from one ground to another | 25 |
| crossings whose two grounds share no ancestor | 19 |

- **The tree does not grow up.** A city abroad, a country and the planet are not put over one another, so 19 of 25
  crossings join places with nothing in common.
- **A place known to an earlier book comes in loose.** The district volume 1 holds inside the city is a root in volume
  2's reading: places are not one across books.
- **Every ground is one more spot on one canvas,** and going abroad is a walk: the director laid walk windows kilometres
  wide between grounds, the engine's graph passed a Map's size limit, and the run died twice (units 144 and 201; fixed
  only as guards: c4845a1, e83b331, cf5b4a9).

## 2. A place is a size and a kind, not a scale name

A place has:

| | What it is | Example |
| --- | --- | --- |
| **size** | its extent as a power of ten of metres, with how sure (`band`: log10 metres, a number) | a room 0.7, a building 1.5, a city 4, a country 5.8, a planet 7.1, a star system 13, a galaxy 21 |
| **kind** | free words for what it is (no list) | "a planet", "a country", "a river", "a space station", "an orbital ring", "a cathedral" |
| **parent** | the place that holds it | |
| **frame** | its own coordinates, in which its children stand | |

Names like "district" or "country" become **labels** for bands, kept in a table (`config/places/bands.json`) for the
prompts and the pages, never in the logic. A new kind needs no code; a size needs no new level.

**The law** (the graded law, by size): a parent is larger than what it holds, by at least a slack (a band apart, or the
same band only when the kinds say so: a building in a building, a region in a region). Evidence that breaks the law is
a conflict to review, as now.

## 3. The tree grows

- **Up.** When a place larger than the current roots appears (a country over two cities, a planet over countries), it
  holds them where evidence or world knowledge says so.
- **Joined.** Two grounds the story moves between must share an ancestor. When they do not, each loose root is asked
  once where it stands ("Where is X?": an existing place, or a new one by name); the answer is cached in the universe.
  A real place takes world knowledge (the work model knows the city abroad is in its country, the country on the
  planet); an invented one takes the text, else a **virtual holder** one band above the larger of the two ("somewhere
  that holds both"), which a later answer replaces.
- **One across books.** The universe keeps every place by name (as it keeps slots): a book's place that matches an
  earlier book's is that place, with its parent, its size and its built ground. Volume 2's home district is volume 1's.

## 4. Grounds and maps

- **A ground** is a place the engine builds walkable land for: a place of walkable size (up to a band near a city's,
  configurable) whose parent is larger than that, or a place whose kind says it is built (a station, a ship). Each ground
  has its own canvas, frame and world, built by terrain on its own.
- **A map** is every place above the grounds: a point or an outline in its parent's frame, at the distances the world
  (or the text, or the band) gives. No streets, no lots: what stands on a map is its grounds and their routes.
- Terrain's levels inside a ground are the bands under it (what is now district, street, building), chosen by size,
  not by name; a ground the size of a town has fewer levels than a megacity.

## 5. Journeys between grounds

Going from one ground to another is a **journey** at the band of their nearest common ancestor: its means (on foot,
by car, train, plane, ship, a starship's jump) from the text or the band, its duration from the distance and the means.
The director never walks it: it plays it as a cut, or as a ride in a vehicle that is a place while it travels (the
aircraft rule, 2026-11-06). The walk-window guard stays as a guard.

## 6. Generators by band and kind

Terrain kinds (config/terrain/) are keyed by band and kind, not by level name. A kind the config does not know takes its
band's default. Bands above the grounds have map generators only (an outline, where its children stand).

## 7. Cross-galaxy

A galaxy (21), a star system (13), a planet (7), a station in orbit (3, a ground), a starship (2.5, a ground that moves,
a place in transit): sizes and kinds, no new code. Frames keep each ground's coordinates small (a ground is built
round its own origin), so a ground far out loses no precision.

## 8. What changes (the scan of 2026-11-10)

| Where | Now | Then |
| --- | --- | --- |
| `src/v2/rules/places.ts` | `PLACE_SCALES`, `rankOf`, `mayHold`, `holderIn` | sizes, the law by size, bands as labels |
| `src/v2/extraction/typing.ts`, `placeEm.ts`, `placeRecommend.ts` | EM types a place's scale (one of six) | EM types its kind and size band; parents by the law by size |
| `src/v2/extraction/script.ts`, `pools.ts` | pools one level below a named region, city or district | pools one band below |
| the universe | slots, pools | also places: one place across books, with its parent, size and ground |
| `src/v2/terrain/config.ts`, `config/terrain/*.json`, `world-engine/terrain/terrain-spawn.mjs` (48 uses) | levels city, district, street, building | levels by band inside each ground; one terrain per ground |
| `src/v2/world/placeCanvas.ts`, `src/v2/context/zoom.ts`, `world-engine/world/export-strand-demo.mjs` | one canvas, a city at the top | a canvas per ground |
| `world-engine/director/director.mjs` | a move between places is a walk | a move between grounds is a journey |
| strands, restrand, carry | already by place (holding place, district check) | the restrand's district check by band |

## 9. Volume 1 and volume 2

- Volume 1 has one ground (the city): its scales map to bands (room 0.7, building 1.5, street 2.3, district 3.2, city
  4, region ≥ 5), its world is the same. A rehearsal proves it.
- Volume 2 needs its places read again for kind and size (the place steps of the reading, paid, cents) and joined to
  volume 1's in the universe; then terrain per ground and the run again.

## 10. Questions for the user

1. Distances between real places: real-world geography where the work model knows it (Tokyo to London about 9,500 km),
   else the text, else the band?
2. Where is the line between a ground and a map: a city's band (about 10 km), or larger (a country of walkable land)?
