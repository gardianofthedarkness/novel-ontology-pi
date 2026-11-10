# Places as open layers (the user, 2026-11-10)

> "We didn't build country level hierarchies and the second book involves cross country travelling that messed up the
> terrain. We need to build a universal abstract self growing layer of places system, not hard-coded to street district
> city country continent planet solar system etc. we need an abstract place layer, that even if we throw in a cross
> galaxy science fiction can work smoothly." — the user, 2026-11-10, stopping volume 2's run (W16)
>
> "But then we can't really deal with fantasy worlds. We need a relative scale that works with any setting. We are
> guessing the world from semantic observations. This could be done by agent terrain config design stage." — the user,
> on the first draft (sizes in metres, real-world distances)

Status: set aside (the user, 2026-11-10: travel time is not reliable, transport varies across novels). The map is
reimagined in v3: docs/v3/render-units.md. Kept as the record of the two drafts.

## 1. What broke, measured (volume 2, library 16)

Places have six fixed scales (`src/v2/rules/places.ts`: room, building, street, district, city, region), everything
above a city is "region", terrain builds one canvas topped by a city (`src/v2/terrain/config.ts`: `LEVELS = city,
district, street, building`), and the casts measure distance against a fixed ladder of referents
(`world-engine/digest/digest.mjs`: a person, the room, the building, the street, the block, a landmark, the district,
the city).

| Volume 2's place tree | Count |
| --- | --- |
| places | 158 |
| "region": one word for the planet, five countries, a river and "the world" | 8 |
| places at the root (no parent) | 19, among them a home district and a hospital that volume 1 holds inside the city |
| grounds the story is set in | 9 |
| crossings from one ground to another | 25 |
| crossings whose two grounds share no ancestor | 19 |

The tree did not grow up, a place known to volume 1 came in loose, and every ground was one more spot on one canvas, so
going abroad was a walk: the director laid walk windows kilometres wide and died twice (units 144 and 201; guarded since
by c4845a1, e83b331, cf5b4a9).

## 2. A world's own ladder, relative

No world's places are measured against ours. Each universe has its own **ladder of layers**, from the human body up:

- **The anchor is the body.** A person, a room, a building, a walk of so many minutes: the one thing every setting
  shares, and the only place the engine needs metres (walkable land is built at human scale).
- **Every layer above is relative to the one below:** how many of the layer below it holds, how far across it is in
  those, how long it takes to cross and by what (a day's ride, a week by ship, a jump). A layer's size is the chain of
  those ratios from the body up, never a figure from the real world.
- **Layers have the world's own names** ("a ward", "a barony", "a kingdom", "a march"; "a sector", "a system", "an arm
  of the galaxy"); a name is a label, the logic reads the ladder.
- **The law** is the ladder's: a place stands on a layer above every place it holds. Evidence against it is a conflict
  to review, as now.

The casts' referents (how far, how big) become the ladder's rungs: the body's (a person, the room, the building) and
the world's layers above, so a cast says "two days' ride" or "half the kingdom" in the world's own measures.

## 3. The world design pass: the agent's

After the reading and before terrain, the agent designs the world's ladder from what the text observes (the user:
"guessing the world from semantic observations ... done by agent terrain config design stage"), as it does the look pass:

1. `novel places context <book>` gives the observations: the place tree as read, each place's kinds and names, what the
   text says holds what ("a district of the city", "in the kingdom of ..."), counts ("the seven provinces"), travel with
   its duration and means ("three days on horseback", "the night train"), sizes said or implied, the places the story
   moves between, the earlier books' ladder and places.
2. The agent writes the ladder and the places on it: `novel places layer <book> <name> --above <layer> --holds <how many
   of the layer below, or how far across in them> --crossing '<duration> by <means>' --why <sentence ids: what they say>`,
   `novel places put <book> <place> --on <layer> [--in <place>] --why ...`, `novel places ground <book> <layer> --why ...`
   (the layer walkable land is built for; a kind can be its own ground: a station, a ship).
3. The code checks it: every ratio above one, every place below its holder, every ground's ancestors joined (two grounds
   the story moves between share an ancestor), every write with a why. A place the text leaves loose is put under a
   **virtual holder** ("somewhere in the kingdom") until the agent or a later book places it.
4. It is kept in the universe (`universe/places.json`), so it **grows**: a later book adds layers above (the story goes
   abroad, off-world) or between, and a place it meets again is the same place. The pass for a later book starts from
   the earlier books' ladder and only adds or corrects, with a why.

A book with one ground and nothing above it (volume 1) needs only its ground placed: the pass is short.

## 4. Grounds and maps

- **A ground** is a place on the ground layer (or of a kind that is its own ground): it gets walkable land, its own canvas,
  frame and world, and a terrain of its own. The levels inside it are the ladder's layers below it down to the body.
- **A map** is every place above the grounds: where its children stand relative to each other, at distances the ladder's
  ratios and the text's travel give. No streets, no lots.

## 5. Journeys between grounds

Going from one ground to another is a **journey** on the layer of their nearest common ancestor: its means and duration
from the text when it says, else from that layer's crossing in the ladder. The director never walks it: it plays it as
a cut, or as a ride in a vehicle that is a place while it travels (the aircraft rule, 2026-11-06). The walk-window
guard stays as a guard.

## 6. Generators

Terrain kinds (config/terrain/) are keyed by the layer's place in the ladder relative to the ground (the ground, one
below, two below) and by kind, not by the names city, district, street. A kind the config does not know takes its
layer's default; the look pass and the world pass can add kinds, with a why.

## 7. Any setting

A fantasy kingdom, a modern country, a galaxy are the same structure: a ladder anchored at the body, layers the agent
names from the text, ratios from what the text says about holding and travelling, grounds where the story walks. Frames
keep each ground's coordinates small, so a ground far out loses no precision.

## 8. What changes (the scan of 2026-11-10)

| Where | Now | Then |
| --- | --- | --- |
| `src/v2/rules/places.ts` | `PLACE_SCALES`, `rankOf`, `mayHold`, `holderIn` | the universe's ladder: rank by layer, the law by layer |
| `src/v2/extraction/typing.ts`, `placeEm.ts`, `placeRecommend.ts` | EM types a place's scale (one of six) | EM types its kind and what the text says of its size and travel; the layer is the world pass's |
| `world-engine/digest/digest.mjs` | referents: a fixed ladder | the body's rungs and the world's layers |
| `src/v2/extraction/script.ts`, `pools.ts` | pools one level below a named region, city or district | pools one layer below |
| the universe | slots, pools | also `places.json`: the ladder, every place on it across books |
| `src/v2/terrain/config.ts`, `config/terrain/*.json`, `world-engine/terrain/terrain-spawn.mjs` (48 uses) | levels city, district, street, building | levels by the ladder inside each ground; one terrain per ground |
| `src/v2/world/placeCanvas.ts`, `src/v2/context/zoom.ts`, `world-engine/world/export-strand-demo.mjs` | one canvas, a city at the top | a canvas per ground |
| `world-engine/director/director.mjs` | a move between places is a walk | a move between grounds is a journey |
| `world-engine/volume/volume.mjs`, the novel-volume skill | look is the agent's only step | the world pass is the agent's too, before the look pass |
| strands, restrand, carry | by holding place (the restrand's district check) | the restrand's check by layer |

## 9. Volume 1 and volume 2

- Volume 1: one ground (the city); its six scales become a ladder (room, building, street, district, the city as ground,
  region above) by a short world pass or a migration rule. Its world is the same; a rehearsal proves it.
- Volume 2: the world pass on its reading adds the layers above the city (the story's countries, the planet, as the text
  has them) and joins its loose places to volume 1's; then terrain per ground and the run again.

## 10. Open for the user

1. Is the ground always one layer for a universe (the agent's choice per world), or may two layers each have grounds
   (a city's streets and a ship's decks)?
2. Should the world pass also give travel speeds for the ladder's means when the text gives none (a horse, a train),
   or should an undated journey simply be a cut?
