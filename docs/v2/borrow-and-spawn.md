# Borrowing and spawning by type (design, 2026-11-01)

> The user's design of 2026-11-01, made exact for review. It replaces sampling pools (world-engine-v2.md §2.0.11–2.0.12)
> and keeps the placement and settling that work (§2.0.21–2.0.22). Progress is tracked in [milestones.md](milestones.md).

## 1. Why: today a city grows with every scene

Today every place the text mentions without nominating it becomes an area of its own in its holder's pool, and every
pool grows to hold its members. In vol 1 alone, 学园都市's pool district holds 81 places and the terrain run had 21
streets, 18 of them unnamed (大道 in scenes 12, 26, 28 and 34 are four avenues). Only mentions with exactly the same name
merge. So a city's size grows with the number of scenes set in it: over 20 books of a universe it would grow about twenty
times over, without limit.

The fix is to make the number of areas depend on the *kinds* of places a city has, not on how often the text mentions
them.

## 2. The design

### 2.1 Every type has a spawning configuration

Each level has its types: the kinds Jev already chooses from (`TERRAIN_KINDS` in `src/v2/context/terrainModes.ts`) for
cities, districts and streets, and the building uses for buildings. For each type there is a configuration of what an area
of that type spawns one level down. Read across the levels, the configurations make a tree of spawning possibilities:

| Parent | Spawns | Example (the user's) |
| --- | --- | --- |
| a city type | district types and how many of each | a metropolis spawns 2 CBDs, 3 dwelling areas, 1 industrial area |
| a district type | street types and how many of each | a CBD spawns 2 avenues, 1 centre, 1 station front, 1 square, 1 shopping street |
| a street type | building uses by density (buildings a hectare, and the share of each use) | a shopping street: 49 a hectare, a quarter shops, the rest cafés, bars, restaurants… |

The configurations are files (§5), meant to be tuned. A count may be a number or a range (`[1, 3]`), picked once for each
parent by a seed and kept.

### 2.2 Slots

> Amended by §8 (the user, 2026-11-01): a slot is a manifold of its parent's ground, placed by the parent's topology, and
> blends into its neighbours; it is not an area of its own.

When an area's type is decided, it spawns its children as **slots**: typed areas of the level below, unnamed, each with
its type's default terrain (the type's usual size, its manifold, the middle of its medians). A slot is a real area of the
world: it is placed, built and shown whether or not the text ever uses it (the user, 2026-11-01). A slot a place has
borrowed carries that place's pin, and like every pin it is visible to Jev in its pictures; a spare slot stands as
ground and buildings with no pin (in World · Live a grey "dwelling · spare" label).

### 2.3 Borrowing

When a mention at a level is given a type by Jev, it **borrows** a slot of that type in its parent: it becomes that slot,
taking the slot's place in the world and giving it its name, its own height (Jev's answer) and its pins.

- **A named place takes a slot of its own.** A slot holds at most one name. The same name again is the same place, as
  today.
- **An unnamed mention may share a slot.** "An avenue" in scene 12 and "an avenue" in scene 26 may be the same avenue:
  an unnamed mention borrows any slot of its type, named or not, except one already taken by another mention of its own
  scene (two avenues in one scene are two avenues). A share holds only while the slot is not damaged between the two
  scenes (§2.8).
- **Which slot:** the one that makes the objective (§4) least: the slot nearest, by the characters' travel, to where the
  place's scenes are tied.

### 2.4 Spawning

**A new name** is a place name the universe has not had before: a distinct place after place EM (the aliases of one
place are one name), not a further mention of a name already placed. A name already placed, in any
book, goes back to its own slot; it never borrows or spawns again. So, with the draft configuration, 学园都市 has 2 CBD
slots: vol 1's 第六学区 and 第十五学区 take them. If vol 3 names 第一学区 and Jev types it a CBD, no CBD slot is free and a
third CBD district is spawned: the city grows by one. If Jev types it a dwelling area, it takes one of the two spare
dwelling slots and the city does not grow.

When there is no slot to borrow, a new slot of that type is **spawned** in the parent and placed by the placement
optimization that works today (ties, pin, free ground, room in the parent):

- a named place spawns when every slot of its type in its parent already holds another name;
- an unnamed mention spawns only when its parent has no slot of its type at all (the text says there is one; the
  configuration did not). Later unnamed mentions of that type share it.

### 2.5 A place whose parent is higher up

A place whose holder in the tree is more than one level up (an unnamed street the text puts only in 学园都市, with no
district) borrows among the slots of its level anywhere under that holder: every street slot of every district of
学园都市. If it must spawn, it spawns into the child of the holder where the objective is least (a spare district first).
A place with no holder at all borrows among the areas of its level in the universe, or spawns its own. This is what pools
did, without pools.

### 2.6 Level by level, in narrative order

Borrowing and spawning run one level at a time: every city, then every district, then every street, then every building.
Inside a level, mentions are taken in narrative order (by their first scene). A level is finished, its slots kept, before
the next starts, and its slots then spawn their own children. So a run can stop after any level, be looked at and be fixed,
and go on from there.

### 2.7 What it replaces

Pools (`src/v2/extraction/pools.ts`: pool areas, pool members, a pool's default as the average of its level, even picks)
and borrowing a pool's ground (§2.0.12, step 5). Kept: the place tree, continuity ties, Jev's kind and height questions
with their pictures, sizing by pins, placement as one optimization, settling, street forms, merging the same name.

### 2.8 Damage and sharing (the user's point, 2026-11-01)

A shared slot is one place through time: what happens to it in one scene is still true in the next. So two unnamed
mentions may be one slot only if it is not damaged between their scenes. That makes sharing depend on what happens in the
scenes, a runtime dependency, while terrain runs a whole book at once. The reading has no damage step today; damage is
decided in the simulation (impacts and destruction, `world-engine/impact-choices.mjs`), after terrain.

| Option | Terrain runs | What it costs |
| --- | --- | --- |
| A. Provisional shares, split by the simulation | a book at once, as now | a slot keeps its sharers by scene; when the simulation damages a shared slot, the sharers after that scene borrow again there and then (another slot of the type, a spawn only when none is left undamaged) |
| B. As A, and the text's own damage known first | a book at once | a damage step in extraction (which places the text says are damaged, in which scene), so terrain never shares across stated damage; the simulation's own damage still splits as in A |
| C. Scene by scene | one scene at a time, with the simulation | no provisional shares, but terrain becomes as long as the book's scenes, and a level no longer finishes before the next starts |

**Decided: A** (the user, 2026-11-01). Terrain stays a book at once, as the level-by-level loop needs; the split happens
where the damage happens, in the simulation, which runs scene by scene anyway. B can follow when the reading gets a damage
step.

## 3. Why it converges

For a parent P and a type k of the level below, let q be the configuration's count, N the distinct named places of type k
in P, and U the unnamed mentions of type k in P. The rules of §2.3–2.4 give P at most

    max(q, N) + (1 if q = 0 and U > 0, else 0)

areas of type k, however large U grows. The number of scenes, and the unnamed mentions in them, never grows a city; only
new names beyond the configuration do, and the names of a universe are finite. A city's footprint follows: its size is
what its slots take (their usual sizes, at the cover the canvas already uses), so it grows only when a slot is added.

Vol 1 as an example, with the draft configuration: 学园都市, a metropolis, spawns 6 districts (2 CBD, 3 dwelling, 1
industrial). 第七学区 (dwelling) borrows a dwelling slot, 第六学区 and 第十五学区 (CBD) the two CBD slots; 2 dwelling
and 1 industrial stay spare. Its pool district and its 81 members are gone: the 18 unnamed streets borrow among the
street slots of those 6 districts, so 大道 in scenes 12, 26, 28 and 34 become at most as many avenues as the districts'
configurations hold, fewer when they share.

## 4. The objective

### 4.1 What "the distance to the characters" is

The user's law: borrowing and spawning make the total distance the characters must go between their scenes as small as
can be, over all the areas of a level. A character in scene i at place A and in scene i+1 at place B travels from A to B.
Summed over every character and every pair of their consecutive scenes, that is

    Σ over pairs of places (p, q):  t(p, q) · d(p, q)

where t(p, q), the continuity tie (`continuityTies`), counts the characters going from a scene at p to one at q (and
scenes set in both). So minimizing the characters' travel is minimizing tie-weighted distance, the term the placement
and the settling already use.

At level ℓ the characters' places are known only to level ℓ: a scene set in a building counts as its street at the street
level, its district at the district level. A scene set higher (in a city, at the district level) counts as that fixed
area, at the distance to its box (0 inside it). Places deeper than ℓ are not placed yet; they count as their level-ℓ
holder.

### 4.2 The energy of one level

The choices: which slot each mention takes, a(m), and where each slot stands, x_s. Then

    E(a, x) =   Σ_{m < m'} t(m, m') · d(x_a(m), x_a(m'))      the characters' travel within the level (0 for a shared slot)
              + Σ_m Σ_f t(m, f) · d(x_a(m), box_f)             travel to fixed places (higher levels, earlier books)
              + λ Σ_m |x_a(m) − pin_m|                         the text's pins, as suggestions
              + μ Σ ov(s, s')                                  overlap of slots that may not share ground
              − Σ ρ_s [s on a form of its type]                streets on their road forms
              + γ Σ_spare d(x_s, c_P)                          spare slots kept compact in their parent

The first five terms are today's settling energy (`settle` in `src/v2/context/zoom.ts`, λ = 1.5, μ = 200); the slot choice
a(m) and the last term are new.

### 4.3 How it is minimized

The choice of slots is a quadratic assignment (hard in general), but small: a parent holds tens of slots at most. So:

1. **In narrative order, greedy:** each mention takes the admissible slot (or the spawn, where §2.4 allows it) that
   raises E least, given the choices before it. A spawned slot is placed by `placeArea` as today.
2. **Swaps, after the level's last mention:** two named mentions of one type in one parent exchange their slots, and an
   unnamed mention moves to another admissible slot, whenever that lowers E; repeated until nothing changes. This undoes
   what narrative order got wrong (an early mention taking the slot a later, more tied one needed).
3. **Settle**, per parent: the slots of this book move together under E (today's settle, with the spare term), until no
   move lowers it. World · Live plays it as it plays settling now.

### 4.4 Where this objective can go wrong, and the guards

| Risk | What would happen | Guard |
| --- | --- | --- |
| Sharing makes travel free | every unnamed mention of a type piles onto one slot | not two mentions of one scene; that is wanted across scenes |
| Spare slots have no ties | E does not care where they go; they drift to any free corner | γ pulls spares toward their parent's middle |
| Early mentions grab slots | narrative order alone is myopic | the swap pass (step 2) |
| Ties to another city | a district tied to New York is pulled to the edge of 学园都市 | ties across parents count at a weight w × (proposed w = 0.3), to be measured |
| Built positions feed back | run 10's runaway: placing by the canvas's drifted nodes | slots are judged by their kept offsets (holder + toward), never by built nodes |
| A name forced into a bad slot | the only free slot is far from all its scenes | first book: settle moves the slot. Later books, where slots are fixed: measure, then decide whether a spawn cost σ may let a name spawn anyway |
| A type Jev picks that the parent's configuration lacks | nothing to borrow | spawn one (§2.4); the configuration may list types a slot of another type can stand for, later |

### 4.5 Across books

What a book kept never moves in a later book: its slots, borrowed or spare, stand where they are, and only the new
book's new slots settle. What carries over differs (the user, 2026-11-01):

- **A nominated place is permanent.** Its slot is its own for good: never cleared, never given to another name; its name
  returns to it in every later book, with what happened to it.
- **What is not nominated is cleared for the next book.** An unnamed mention's share and any damage done to a slot that
  only unnamed mentions used belong to their book. When the next book starts, those slots are free and whole again, spare
  slots for that book's mentions to borrow (an earlier book's spare dwelling district is waiting for a later book's
  dwelling district).

The universe's registry (`universe/terrain.json`) keeps every slot with its type, its owner name (permanent), its sharers
and damage by book (history; only the current book's are in force), the configuration layer it came from, and its kept
offset.

## 5. The configuration files

`config/spawning/` holds one file a level, each read as a layer of the tree:

| File | Parent level → child level | What a type gives |
| --- | --- | --- |
| `city.json` | city → district | how many districts of each kind |
| `district.json` | district → street | how many streets of each kind |
| `street.json` | street → building | buildings a hectare, and the share of each use |

**Layered, so a universe or a place can have its own (the user, 2026-11-01; an option, not built now).** The files here
are the defaults. The configuration for a parent is resolved in layers, the last that has one wins:

1. the defaults, `config/spawning/<level>.json`;
2. a universe's own, `<library>/universe/spawning/<level>.json`, edited by the user for that universe;
3. a place's own, in the same file under `places` by name or id (学园都市 with its 23 districts);
4. a function of the place: code, or a review by Jev or an agent, given the place's evidence (its scenes, its facts, its
   kind) and returning its configuration.

Whichever layer gave a parent its configuration is kept with its slots in the universe's registry, so a world is made
again the same way. The loader takes a resolver from the start, so layers 2–4 can be added without changing the engine.

Every kind named must be one Jev can answer at that level (`TERRAIN_KINDS`) and every use one the language profile or
the landscapes know; `test/spawning-config.test.ts` checks this. The drafts are a start to be tuned: `street.json`'s
densities and uses are read off today's landscapes (`LANDSCAPES` in `src/ground/stage/landscape.ts`: lot size, cover,
uses), so the building level starts from what the world already builds.

## 6. The building level

The terrain stage stops at streets today; this design reaches buildings the same way. A street slot spawns building slots
by its type's density over its area, each with a use drawn by the shares. A named building (its use from the language
profile, or Jev's answer) borrows a building slot of its use in its street, the one least by E, or spawns one when none is
left; an unnamed one ("a convenience store") shares. The landscape fill then builds the slots, not a fill of its own.

**As built (M5, 2026-11-01).**
- **A street's building slots are the lots its form builds.** That is its frontage, the rows behind it out to its edge with
  a 4 m lane between, and a square's rings out to its edge. Each lot is a slot of its use, read from the world just built at
  every street level's end (`formSlots` in `world-engine/terrain-spawn.mjs`) and kept at its offset from its street.
  - A slot a building holds stays where it is.
  - The spares are the form's again after every street level, so they follow their street.
  - `street.json`'s densities are what the forms build on their own ground, measured. In a city, the roads crossing a
    street break its rows, so it holds fewer.
  - A road running along a street's axis is its own and breaks nothing. A row is laid in the stretches between the
    roads crossing it, as blocks lie between side streets.
  - The city's lots on a street's ground (round a station's hall, a centre's compound, a square's rings) are its
    building slots too.
- **Streets that are the ground's own (the user, 2026-11-01).** An avenue or a crossing is not an area laid out apart
  with its own rows. It is one of the city's roads, or the meeting of two of them, wide enough, with the city's buildings
  already round it.
  - `street.json` gives such a kind `takes`: an avenue a road at least 18 m wide (arterial or boulevard); a crossing (a
    street kind of its own now, besides the square) roads at least 12 m wide meeting from two directions or more.
  - The spawn places it only onto one (`formsTaking` in `landscape.ts`; `placeArea`'s `ontoOnly`).
  - It builds no form, and the city's fill stays on its ground. Its lots there take its heights and its uses, and they
    are its building slots.
  - With no road wide enough in its area, it is placed as before and builds its form.
  - Before, an avenue laid its own rows across the city's roads, and the roads crossing it took most of them (2 of 8 left
    in a CBD). Now it has the city's 14 or so buildings along its road.
- **A building is asked as every part is (the user, 2026-11-01: every level the same process).**
  - Jev is shown the skyline and the map, and asked its kind among ten. A universe has too many kinds of building to
    offer them all (the user, 2026-11-01), so the building's name and the sentences round it in its scenes (its own or
    those naming it, one either side) are searched against the inventory (`config/spawning/building-types.json`: about
    90 types, each with a description, its Chinese, Japanese and English words, its floors and its coarse use). The ten
    nearest are offered, the shapes beside them (`src/v2/spawning/inventory.ts`).
    - The search is by meaning when an embedding model is configured, else by words. By words: a type's words in the
      building's name count most (its longest, so 便利商店 is a convenience store, not any 店), then the character pairs
      they share with it (回转寿司店 is a 寿司 shop), then its words in the sentences round it.
    - The model is v1's causality model, BAAI/bge-small-zh-v1.5, served on this machine by `tools/embeddings/serve.py`
      (offline, CPU, 127.0.0.1 only). A run reaches it with `EMBEDDING_BASE_URL=http://127.0.0.1:8194/v1` and
      `EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`. By meaning, a name the words miss still finds its neighbours: a tunnel
      (隧道) a subway station and a construction site, a detention centre a police station beside it.
    - The rest of the ten lean to the types sharing a use with what was found, then to the uses of the lots round it.
  - The type's coarse use (`TERRAIN_KINDS.building`: a house, a block of flats, a school, a shop, an office…) is what its
    lot and its model go by. No description says how tall a type is (the user, 2026-11-01: a building's height is its
    scenes' to say), and two types that differed only by height became one (an office building or tower, a block of flats
    or a residential tower).
  - It borrows a lot of that kind under its holder: the one that keeps the characters' travel least (§4). The place its
    scene is set in counts as its pin, because most buildings the text mentions are seen from a street, not set in. A
    named building takes its lot for good; an unnamed one shares.
  - Jev is asked its height on slices through its street round that lot, the street's buildings cut where a slice meets
    them. Every building is offered the same slices, from under the street to a hundred floors (`BUILDING_FLOORS`), so a
    building is as tall as its scenes say, whatever it is.
  - The lot takes its kind and its height: a named building's, else its sharers' mean. Taller than any model of its use
    stands for, it is drawn as a tower (a 30-floor convenience store, a tower model), never cut down to its use's.
  - In World · Live it blinks on its lot while its height is asked, then is kept.
  - Before (the first M5 run), its use came from the language profile and its height from its street, so Jev saw no
    building level at all.
- **A rare building** (no lot of its use under its holder) stands where the characters' travel is least, on the spot of
  whatever lot is there. It is drawn as a building of its own, and it pushes the city's buildings round it outward, the
  nearer the more (the user, 2026-11-01).
- **A building Jev answers with a shape** stands where travel is least, a building's size.
  - A floating one (a platform, a sphere, a ring, a cavern) is asked its distance from the ground and its thickness, and
    merges into the buildings there.
  - A ground shape (a hill, a plateau, a basin, a ramp) is asked its top and pushes the buildings round it outward.
  - Both are nominated, as every shape.
- **No place of its own.** A building slot is not a place in the tree (`src/v2/spawning/tree.ts`): the building that
  borrows it stands in its street, on that lot exactly. A staged building's grid clears the fill there; a marker stands on
  the lot.
- **Floating objects.** A platform, a sphere, a ring or a cavern (`FLOATING` in `src/v2/context/terrainModes.ts`) is asked
  first how far it is from the ground (its underside, or how deep its top lies), then how thick it is.
  - It spans from its underside up, and a cavern becomes a hall from its bottom up.
  - Every shape is kept in the universe's registry as a nominated object (`shapes`, with a `nominate` entry in the map's
    log).
  - No shape or building lot takes part in unification.

## 7. Decisions

| | Proposed | The user (2026-11-01) |
| --- | --- | --- |
| 1 | Unnamed mentions share slots across scenes; spawn only when the parent has no slot of their type | Only while the place is not damaged between the scenes (§2.8): option A, terrain a book at once, the simulation splits damaged shares. Unnamed shares and damage are cleared for the next book (§4.5) |
| 2 | A new name always gets a place of its own, spawning beyond the configuration | Yes (a new name: §2.4). A nominated place is permanent: never cleared or given to another name in a later book (§4.5) |
| 3 | Spare slots are built and shown | Yes; a slot occupied by a pin is shown and visible to Jev (§2.2) |
| 4 | Ties under another parent at weight 0.3 | Yes, for now |
| 5 | JSON configurations; a count may be a range | Yes; and users may override them per universe, per place, or by a function or a review by Jev or an agent: an option, not now (§5) |

## 8. One city of manifolds, and its topology (the user, 2026-11-01, before M2)

What the user saw in M1's world, spare districts and streets standing apart from the city, is not the design. A city is one
ground made of manifolds that fade into each other, as real cities have no abrupt change between their parts; a district is
the centre of a function on that ground, not an area of its own.

### 8.1 What a city is, and what is saved

A city is a combination of manifolds over time. What is saved is its map: each manifold's kind, centre, size and seed (its
shape and its buildings are drawn from the seed), the book and scene it was born in, and the nominated places and buildings
on it, each with its id and location. Everything else (the buildings, the roads, the fades between kinds) is drawn again
from the map. A slot (§2.2) is a manifold; a spare slot is a manifold no name holds; borrowing (§2.3) assigns a place to a
manifold's centre of function.

This is the landscape engine's own model already (`src/ground/stage/landscape.ts`): a place's ground is its patches (a
centre, a radius, a seeded shape, a kind), each claiming ground by its membership σ(signed distance / softness), a newer one
only where the older ones passed over, modern heights merging across the seams. What changes is that a city's districts
become patches of the city's ground instead of areas cut out of it (M1 built each slot as a place of the canvas, its ground
apart): no holes, no gaps, no edges.

### 8.2 Topology in the configuration

A configuration says not only how many of each kind but how the kinds lie, the way a city works:

- **ring**: how far from the city's centre a kind sits, as a share of the city's radius: a CBD from 0 to 0.3, dwelling
  areas from 0.3 to 0.8, industry from 0.7 to 1, a harbour at the edge by the water;
- **pairs**: kinds that sit near each other or apart: industry apart from a CBD, dwelling areas near one.

A draft for a metropolis:

```json
"metropolis": {
  "spawns": { "cbd": 2, "dwelling": 3, "industrial": 1 },
  "ring": { "cbd": [0, 0.3], "dwelling": [0.3, 0.8], "industrial": [0.7, 1] },
  "pairs": [["industrial", "cbd", "apart"], ["dwelling", "cbd", "near"]]
}
```

A district's streets the same way, at their own scale: a centre in its middle, a station on its edge toward the next
district, alleys among the dwellings.

### 8.3 Spawning on the topology, and squeezing

A manifold is spawned where the city's energy is least:

    E =   Σ topology    −log of its kind's ring at its distance from the city's centre
        + Σ pairs       near: their distance; apart: their closeness
        + Σ pressure    how much two manifolds' fading functions overlap beyond what their kinds may share
        + the characters' travel for the book (§4.2), and the text's pins

With no room at its distance, a new manifold does not go elsewhere by itself: it presses on the manifolds already there,
and they give a little (each centre moves a little, each edge draws in a little) until the whole is least. A city grows
wider only when the pressure costs more than the topology charges for going out.

### 8.4 What it changes in the design so far

- A slot is placed when its parent is decided, by its parent's topology: a city's districts at the city level, a district's
  streets at the district level. The layout is the topology; borrowing chooses among the centres, by the travel (§4).
- The export builds a district, spare or named, as a patch of its city's ground, and a scene set in it stands at its centre
  of function; streets the same in their district (as pool members' borrowed patches already were, §2.0.12 of the journal).
- §3's bound holds as it is: the counts do not change, only where the manifolds lie and how they blend.
- What a book saves is the map: manifolds with their seeds, nominated places and buildings with their ids and locations.

### 8.5 Parenting: where a manifold is (the user, 2026-11-01)

Every manifold of a lower level, and every nominated building (a point), keeps a vector from the centre of its parent
manifold. When the parent moves, the child follows by adding the vectors: a city's districts move with it, a district's
streets and buildings with the district. Only the top of the tree (a city in its region) is placed in the world; everything
under it is the sum of the vectors down its chain. This is run 10's lesson made the rule: a position is its holder's
plus a kept offset, never read back from the built world.

Proposed with it:
- **The parent's turn too**: a vector is kept in the parent's own frame and turned with it (a street laid along a road has
  a turn; its buildings turn with it). For a manifold that never turns this is the plain sum.
- **A squeeze scales its children's vectors**: when a parent's edge draws in by a share, its children's vectors draw in by
  the same share (their sizes do not), so they stay inside it. A nominated building is the text's: a parent cannot be
  squeezed past its nominated points.
- **Only cities are placed by the canvas**: what is drawn under a city is exactly the map, so M1's drift (areas placed by
  direction only) has nowhere to come from.

### 8.6 Heights: manifold unification at spawn (the user, 2026-11-01)

A manifold's height is its **average**, not its median (Jev is asked the average; the landscape engine turns it into its own
manifold's numbers). When a child manifold spawns higher or lower than its parent, the parent's other parts go the other
way, so the parent's average stays the same: **manifold unification at spawn**. So a later height has the better right over
an earlier one, the way a city changes over time. A **nominated building** is the source of truth: where one is placed, its
height stands, and the manifolds of every area holding it grow to hold it.

Why the average: an area's average is the area-weighted average of its parts' averages, so keeping it is one sum. A median
has no such sum.

Proposed with it:
- **Unification as the least change, within bounds.** At a spawn the newest height is fixed, and the others change as
  little as they can while the parent's average stays: the parent's own open ground and its spare manifolds first, then
  earlier decided ones (the oldest the most), each within its kind's range of heights. Where that cannot hold the average
  (vol 1's numbers: a city of average 15 m with two CBDs of 80 m on a third of it would need the rest at −17.5 m), the
  parent's own average moves, up or down: the later choice still wins.
- **Nominated buildings add, they do not take away**: a nominated building's height is not paid for by lowering the rest;
  it adds its footprint's share to the averages of the areas above it, and its own manifold rises round it as a local peak
  (its tail), so one tower does not make a whole district tall.
- **Above and below the street apart**: what lies under the street (an average below 0) is its own budget; an underground
  mall does not lower the towers above it.

**The deformation limit (the user, 2026-11-01).** A city area's skyline bends only within a continuous limit. A lower
placement raises the rest of its parent, as cities grow. A higher one cannot make standing buildings vanish, nor make low
ground lower still (a commercial centre that was already low): it lowers only the highest parts that are not nominated, and
damaged ones, each only so far. What the limit cannot take, the parent's average takes: it rises. Proposed numbers, to be
tuned on the runs: at one spawn a part is lowered by at most 15% of its average (a damaged one 30%), never below its kind's
least, and only a part above its parent's average is lowered at all. A part spawned at that moment has no limit yet: its
height is set, within its kind's range, where it keeps the parent's average best.

### 8.8 The map's log, by book (the user, 2026-11-01)

So a book can be played again as it grew (an animation of earlier books), every change to the map is logged with the book
it happened in, in order: a manifold spawned (its kind, parent, vector, radius, seed), moved (a squeeze: from, to), its
height unified (from, to; the parent's average too), and a place borrowing or sharing it. A book's map is the map at the end
of the book before it with that book's log applied; `--from <level>` drops the book's entries at that level and under.

### 8.9 Heights asked as a standard plus an offset; floating objects (the user's ideas, 2026-11-01, for the building level)

- **A standard and an offset.** Every type at every level of the tree has a minimum standard height (its default). Jev is
  asked how many metres to add to it, with +0 always among the options: positive for what stands above the ground, negative
  for what lies under it. The decided height is the standard plus the offset; unification (§8.6) works on it as before.
  *Tried and changed (2026-11-01):* the height probe showed Jev reads absolute averages surely and alike, additions
  unsurely and unevenly. The user's call: absolute averages, **each area kind's minimum a hard gate** (no slice below it;
  no slice under the street for a city or a district); a city's average asked on pictures across it.
- **Floating objects.** Some buildings neither stand on the ground nor fill a manifold: an underground cavern, a commercial
  centre on a raised ring, a floating platform. Each is asked twice, how far it is from the ground and how thick it is.
- **Inventions are nominated.** Something that fits no category, placed as a shape, is a nominated object whatever the text
  calls it: kept with its id and location in the map for every later book.
- **Outside the manifolds.** Floating objects and shapes take no part in a manifold's average or in unification.

### 8.10 What must stand among tall buildings (the user, 2026-11-01, after M4)

Some places only make sense where the buildings round them are tall: a boulevard lined with offices and towers, a
commercial centre's towers, a helipad or a sky garden in the air. M4's world had spare avenues in industrial districts
and platforms at 100 m over dwelling areas. Two hard rules:

- **Where a street kind may stand** is a tuning of the configuration (the user's call): `only` in
  `config/spawning/district.json` lists, for the kinds that cannot be anywhere, the district kinds they may stand in (an
  avenue and a commercial centre only in a CBD); they are neither borrowed nor spawned elsewhere (a spawn with nowhere
  allowed goes to the tallest district there is). An industrial district spawns no avenue.
- **Raised objects** (a platform at some height) stand only where the area's tallest buildings (its manifold's 98th
  percentile) reach their height: one Jev boxed elsewhere moves into the nearest district of its city that is tall enough.
  This one stays dynamic: it reads the height Jev gave the object (a deck at 3 m may stand anywhere, a helipad at 100 m
  only among towers).
- **A shared street's height** (the user, 2026-11-01): every sharer is still asked its height, and a later one reshapes
  the street it shares, a later height having the better right: a higher answer raises it; a lower one lowers it only
  within the deformation limit (§8.6), the buildings already standing.

### 8.7 Decisions (the user, 2026-11-01)

1. Across books: yes, a later book's spawn may squeeze an earlier book's manifolds and re-unify its heights, the earlier
   book's world changing a little, as real cities grow.
2. Rings as shares of the city's radius: proposed, not objected to; built so.
3. The proposals of §8.5 and §8.6, with the deformation limit for any lowering (above).
