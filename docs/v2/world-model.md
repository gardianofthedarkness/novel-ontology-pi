# The world model, its laws, and the engineering layers (design, 2026-10-31)

The user's frame (2026-10-31), written down so every part of v2 is built against it: a novel's world is **spacetime**
(places and times) and **matter** (people, crowds, things, vehicles, weapons) in it, tied together by **spatial
relations**. Places and matter obey different laws, so they are different kinds of entity in every system: places are
spacetime itself (a tree), matter moves through it (a graph). The systems that read a novel into this model (plain
extraction, entity recommendation, the context engine, EM and EM², the world engine) are separate layers, each with its
own job and interface, each supporting the others and none doing another's work. Status: **design for review; the place
layer (§4–§6) is being built against it**.

## 1. The world model

| Kind | What it is | Its shape | Examples |
|---|---|---|---|
| **Place** (spacetime) | where things can be; it never moves | a **tree** by containment, graded by scale | 日本 › 东京都 › 东京西部的学园都市 › 第七学区 › 公寓 › 房间 |
| **Time** (spacetime) | when things are | a **tree** (story › year › day › part of day; the past) | Year 1 › 12-24 › 00:00 (`time.ts`) |
| **Matter** (movables) | what is somewhere at some time and can move | a **graph** of relations, no shape imposed | 上条当麻, 御坂美琴, a crowd of officers, a car, a mech |
| **Spatial relation** (the middle layer) | that a movable is at a place at a time, and how | a **relation** matter × place × time (× level) | 美琴 is on the roof of a five-storey building in 第七学区 at 12-24 00:00 |
| Concept | abstract, owned by matter | no place, no time of its own | 幻想杀手 (上条's) |

The middle layer is what was new this week: 地面, 地下, 屋顶, 走廊 are not places but the level a movable stands at inside a
place (`spatial.ts`). A scene's setting is the coarse spatial relation (everyone present is at the scene's place at the
scene's time); spatial words refine it; later, movement (arrives, leaves, goes up to the roof) is a change of it. This
model is general: nothing in it is particular to this book.

## 2. The laws

### 2.1 Places are a tree (the containment matrix)

Let the book name n places, and let C be their containment matrix: C[i][j] = 1 when place j directly holds place i.
Joining the places at the top (the roots) under one virtual root, the story's world, makes one tree; its undirected
adjacency A = C + Cᵀ then has the tree's laws:

| Law | In the matrix | What the system does with it |
|---|---|---|
| One parent each | every row of C has exactly one 1, but the roots' rows, which have none | a place's parent is **one choice** from candidates, never a set of relations |
| As many links as places, less the roots | C has n − r ones; A has 2(n − r), symmetric, zero diagonal | the tree is checked by counting: a missing parent is a root, an extra one is an error |
| No loops | C is nilpotent: Cᵏ = 0 past the tree's depth | a parent that would close a loop is never taken |
| Graded by scale | C[i][j] = 1 only if scale(j) > scale(i): region › city › district › street › building › room (a region may hold a region, a building a building) | candidates for a parent are only places larger than it; this alone cuts most options |
| Leaves exist | every tree of more than one place has at least two leaves; rooms and buildings are the leaves | unnamed places (EM² slots) are leaves under a named place |
| One address | the path from a place to the root is unique | "where" is an address (region › … › room); two places relate through their lowest common ancestor |
| Bipartite by depth | the tree is two-coloured by depth parity | (not used yet) |

### 2.2 Matter is a graph

Relations among movables (knows, speaks to, owns, fights, rides) are a general graph: any number of links, loops allowed,
nothing graded. Identity (who a name or a description is) is a matching of mentions to entities, many mentions to one
entity. Nothing about the tree's laws holds here, which is why the systems that decide matter cannot be reused as they are
for places, and the reverse.

### 2.3 Spatial relations: the occupancy matrix

For each time node t, let O(t) be the occupancy matrix, movables × places: O(t)[m][p] = 1 when movable m is at place p.

| Law | In the matrix | What the system does with it |
|---|---|---|
| One place at a time | every row of O(t) has at most one 1 | a person present in a scene is at the scene's setting; a second place needs a move |
| Being somewhere is being in its ancestors | O(t)[m][p] = 1 implies m is in every place on p's address | a question about where m is only asks the finest place |
| Change is movement | a row that differs between t and the next time node is a move (a trip) | the world engine's movement is the change of this matrix, not a new fact |
| Level within a place | a spatial word gives the level inside p (underground, street, inside, roof, wall, sky) | the engine's height slices; births and moves read it |

## 3. The engineering layers

```mermaid
flowchart TB
  X[1. Plain extraction: sentences, kinds, cards, listing, typing with scale and spatial, time words] --> R
  X --> D
  R[2. Entity recommendation: candidates, scored, no model] --> C
  S[(5. The world model's stores: chart, place tree, time tree, occupancy, facts)] --> C
  S --> R
  C[3. Context composition: modes, sources, probe, budget, manifest; no decisions] --> D
  D[4. Decisions: EM, EM², place EM, story time; Jev with the composed state] --> S
  S --> W[6. World engine: terrain, births, movement; reads the model, never decides extraction]
```

| Layer | Its one job | It may use | It never |
|---|---|---|---|
| 1. Plain extraction | turn text into mentions: kinds, cards, strings typed (with a place's scale; spatial words as such), time words | the work model (listing), Jev (kinds, typing) | decide who or where anything is |
| 2. Entity recommendation | rank candidates for a decision: who a name may be, which place holds a place, which place a description means | the stores, by code | call a model, decide, or write |
| 3. Context composition | compose the state document a decision is asked on: evidence ranked and cut to a budget, with a manifest of what went in | the stores, the recommender's candidates, by code | decide, or call Jev itself |
| 4. Decisions | ask Jev the question, accept or not by rule, write the result into the stores | layers 2 and 3 through their interfaces; Jev | compose its own evidence, or reach into another decision's internals |
| 5. Stores (the world model) | hold what was decided: the chart (matter), the place tree, the time tree, occupancy, the fact ledger | — | change on its own |
| 6. World engine | build and run the world from the model: terrain, births, movement, the live view | the stores, its own visual context engine, Jev | redo an extraction decision |

**Matter and places are separate kinds in layers 2–4**, because the laws differ: the matter recommender ranks by nearness,
frequency and shared names (`em.ts` `recommend`); the place recommender ranks parents of a graded tree (§4). EM decides
matter's identities and EM² who a description of a person, crowd, vehicle or weapon is; **place EM** decides places: the
tree, what an unnamed place description means, and each scene's setting (§5). Spatial relations are written by place EM
(settings) and by code from spatial words (`spatial.ts`).

Each layer is tested alone with fixtures: a recommender test needs no model, a context test checks the document byte for
byte, a decision test runs on a mock Jev.

## 4. The place recommender (layer 2)

Code over the stores, no model call. It answers three kinds of question, each with candidates scored by evidence:

**Parent of a named place.** Candidates: every named place larger than it (the graded law). Evidence, each a score:

| Evidence | Weight | Example |
|---|---|---|
| name inside a name | 3 | 学园都市第七学区 holds 学园都市 |
| stated right before it (X的Y, X，Y, XY) | 2 each time | a city named, then a district of it, in one breath |
| named in the same sentence | 0.5 each | |
| set in the same scene's environment cards | 0.5 each | |
| narrative adjacency: scenes set in it sit next to scenes set in the candidate | 0.25 each | a scene in 第七学区 right after one in 学园都市 |
| facts about both (the ledger's `about`) | 1 each | a fact that names both |
| scale distance | +0.3 for the next scale up | a district's city before its region |

**What a place description means** (街上, 大楼, 这座城市, 便利店). Candidates: a named place on the scene's address of a
compatible scale (这座城市 → the city on the address), an unnamed place of this scene or the one before with the same
words, or a new unnamed place.

**A scene's setting.** Candidates: the named places its environment cards name (deepest first), its action cards name,
it names at all, the setting before it; then an unnamed building or room its environment names.

Each answer carries its candidates, their scores and the evidence behind each score, which the context engine shows Jev
and the manifest keeps.

## 5. Place EM (layer 4): replacing EM²'s place questions

**Why.** EM² asked about places inside its people requests: two questions per place description (`ref:` which place it
means, `within:` which named place holds it), about 546 questions on vol 1 for 273 descriptions, with every named place of
the passage offered whatever its scale, and no recommender behind the options. It made 106 unnamed places, 54 of them held
by nothing, and found only 40 descriptions meaning a named place. The tree's laws make most of that work unnecessary: a
place needs one parent from a few larger candidates, and most descriptions are a building or a room in the scene's own
setting.

**The flow,** after EM (named places, with their scale from typing) and EM² (now people, crowds, vehicles and weapons only):
1. **The tree.** For each named place, the recommender's parents. A parent is taken without Jev when the best has name or
   stated evidence and leads the second by a clear margin (score ≥ 2 and twice the second); the rest go to Jev in one
   request (mode `place-parent`), each with its top four and none. The tree is assembled surest first, under the laws:
   no loops, graded, one parent each; the counts are checked (n − r links).
2. **Settings.** Each scene's place by the recommender's tiers (environment, action, named; carried on where nothing is
   named; deeper where the scene sets a place under it). Jev (mode `setting`) only where the scene's environment names
   places on two branches of the tree, or nothing is named and the time tree says the scene does not go on.
3. **Unnamed place descriptions,** scene by scene, by rule first: the same words as an unnamed place of this scene or the
   one before are that place; words that name a named place (第七学区的便利店) are held by it; a building, room or street is a
   new unnamed place held by the scene's setting (the deepest place on its address larger than it). Jev (mode
   `place-ref`, one request a scene) only for a description that may be a named place (a city, a district, a region:
   这座城市, 学区), with the recommender's candidates. Unnamed places are leaves (the tree's law); a room the environment
   names deepens the setting.
4. **Occupancy.** Everyone present in a scene is at its setting at its time (`by: setting`); each spatial word adds a level
   for who its line ties it to (`by: spatial`).

**Outputs** (the reading's `places`): the tree (each named place's parent, scale, what said each), the unnamed places
(label, scene, scale, parent, held by what), the settings, the occupancy, and each question's manifest. The world script
(`script.ts`) reads the settings and occupancy instead of guessing them.

## 6. The context engine (layer 3), built for places first

The engine of [context-engine.md](context-engine.md) (approved 2026-10-30, not built until now): `compose(mode, focus,
stores) → { state, questions, manifest }`. Built now as the core with the place modes, then EM, EM² and the world loop's
modes move onto it one by one (each checked by identical documents before anything changes).

| Mode | Focus | Sources | Questions |
|---|---|---|---|
| `place-parent` | named places whose parent the recommender is unsure of | the place's sentences; facts about it and each candidate; its co-mentions and stated pairs; the candidates' addresses and scales; narrative adjacency | `tree:<key>`: one of the candidates or none |
| `setting` | a scene whose setting is unsure | the environment cards; the scene's opening; the setting before; the candidates' addresses | `setting:<scene>` |
| `place-ref` | a scene's descriptions that may be a named place | the passage; the scene's address; the candidates with their scales; earlier answers for the same words (habits) | `place:<key>` |

- **Sources** rank items (score, cost in characters); the **budget** cuts in the mode's order (oldest and weakest
  evidence first; the focus and the questions never); the **render** writes one state document keyed by id; the
  **manifest** records every item in and every item cut, with its source and score.
- **Facts by Cypher.** Once the facts are settled, the reading builds its own graph in memory (`readingGraph.ts`: the
  entities with a place's scale, the scenes in order, which places each scene names and whether its environment does, the
  facts and what each is about) and the sources ask it in Cypher: the latest facts about a place, the facts about a place
  and a candidate parent together, how often scenes naming the two sit side by side. The world engine asks the
  workspace's graph the same way once canon is written (`retrieval.ts`).
- **The probe** measures the focus's surroundings and scales the quotas by the complexity score (§3.1 of the engine's
  design): for places, the recommender's margin (ambiguity), the evidence count (evidence gap), and the scene's cut
  (continuity).
- **Deterministic:** the same stores and focus give the same document, so the cache keeps working.

## 7. What changes in the code

| Where | Change |
|---|---|
| `src/v2/placeRecommend.ts` (new) | the place recommender: evidence index, parents, setting tiers, description candidates |
| `src/v2/context/` (new) | the engine: `compose`, sources, budget, render, manifest, probe; `modes/place.ts` |
| `src/v2/placeEm.ts` (new; `places.ts` folds into it) | place EM: tree, settings, unnamed places, occupancy |
| `src/v2/roles.ts` | EM² no longer asks about places (no `ref:`/`within:` for place descriptions; no `placeLinks`) |
| `src/v2/flow.ts` | place EM after EM²; the result carries `places` (tree, unnamed, settings, occupancy) |
| `src/v2/script.ts` | the world script takes settings and occupancy from place EM; its own tiers stay only for older readings |

## 8. How it is measured (vol 1)

Against the reading of 2026-10-31 (`v2-vol1-scales`): place questions asked (≈546 in EM²), requests, named places with a
parent (5 of 14), unnamed places held (52 of 106), descriptions found to be named places (40), scenes whose setting needed
Jev, and the tree's law checks (links = n − r, no loop, graded). The data page shows each place answer with its manifest.

## 9. Open questions

- Should a place description that means a named place also teach the recommender (a habit: 这座城市 has meant 学园都市
  three times), as EM²'s habits do for people?
- Occupancy over time: is a scene's setting enough for every present person, or should a person who only phones in (on
  the line, elsewhere) be asked where they are?
- Time is a tree too: the same law-checks (one parent, graded by level) could validate the time tree.
