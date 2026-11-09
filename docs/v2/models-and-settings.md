# Models as code, and one place for settings

Design, 2026-11-09. The user: "construct a set of bash CLI universal concise and context aware. Pi agent or any of our
adapters list can do so. A work model is baked into one of the commands, or the agent can go and make the model itself.
This stage needs to be done at the last stage of reading or during, before terrain loop. Nominated and ranked important
objects, buildings can get their own modeling if they have enough description and important enough to the story. Also,
the main agent should have quick and context aware way to modify the building generative configurations in a elegant
way. We need to unify all the configuration files we have, and maybe utilize the model warehouse."

Background: Yi Kay Ming's two articles on gkNextEngine ("don't let AI output 3D models, have it write code", parts 1
and 2), and our test of 2026-11-09: the work model wrote five of volume 1's things as OpenSCAD, all five closed solids
(window-cleaning robot, drum cleaning robot, observation helicopter, tilt-rotor, wind turbine; about 10,500 tokens).

## 1. What we take from the articles

| Their idea | Ours |
|---|---|
| A model writes code (OpenSCAD), never a mesh: diffable, parametric, fixable by changing a number | Every model we make is a `.scad` file kept in the universe; meshes are derived and can be thrown away |
| A parts library with **contracts** (bottom at z = 0, fronts toward a fixed axis, names carry the category) | The same contract for our things and buildings; the director turns and places any part without opening it |
| A **catalogue** that evaluates every part (footprint, height, triangles, warnings) | `novel model check` writes the same record per model; size is checked against the text's size |
| **Rules from real failures** written back into the prompt (their tower legs, their bridge) | The same: a failure class found once becomes a check plus a line in the brief (the wind turbine's blades under the ground is our first) |
| **Distribution operators**: the model sets the parameters of a few placement operators (grid, line, ring, scatter by area or along a line, with seeds) instead of placing thousands of things | Settings for building generation are operators with parameters, per place (§4); structures the text names are placed one by one, never scattered |
| **Semantic anchors**: spawn and loot points are tiny modules in the scene; an item table keyed by module name gives behaviour | Our things already carry kinds and owners; a model's name is its key, so a thing with a model behaves as its kind does |
| **Rigid-bone characters**: parts hung on bones, clips as keyframe data in the same file (7-bone standard; 17 bones when the game needs it) | Later stage: our people are capsules; a character kit with a 7-bone standard and shared walk, run, sit, fall clips (§6) |
| **Visual editing** of the text (drag a feature's handle, the text changes) | World · Live's Spawn and Buildings panels get handles that write settings (§4) |
| Boundary: code is good for structures (buildings, machines, vehicles, furniture), not faces or trees | Same boundary: people's faces stay pictures (the album); trees stay instanced kit models |

Their engine is **MIT-licensed** (github.com/gameknife/gkNextEngine), with 576 SCAD modules in `assets/scad/lib`
(city blocks, a detailed city, office, old city, airport, island, road, cold-war props, characters) and a 400 KB
`catalog.json`. Our model rule was CC0 only; **the user allowed MIT on 2026-11-09** ("Yes you can use mit"), the licence
notice kept with the vendored files.

## 2. Where it sits

```
reading (v2)  ->  [models: nominate -> write or put -> check]  ->  terrain loop (map, highway, fill)  ->  director
                     during the reading's last step, or right after it
```

Models come before the terrain because a landmark's footprint and height are inputs to the fill (its lot, its height),
and the transport and things casts already run there. A model changes nothing in canon: it is a look, kept per universe
(a thing seen in two books is one model).

## 3. The commands

One group, `novel model`, with the same shape as the rest of the CLI (JSON out, bounded pages, `--dry`), published to
every agent host by the adaptor (`adapters/README.md`) with a skill `skills/novel-models/SKILL.md`. Each command is
usable by Pi, Codex or Claude Code as is; the agent either lets the baked-in work model write the code or writes it
itself.

| Command | What it does | Model calls |
|---|---|---|
| `novel model nominate <novel-dir> [--top N]` | Ranks the book's things and named buildings by how much they matter (scenes they are in, cards they act in, damage, being carried or ridden) and how well the text describes them (descriptive sentences, a size, colours, parts); marks which deserve a model of their own | none |
| `novel model list <novel-dir> [--state todo\|made\|kit]` | The nominations with their state: no model, made, bound to a kit part | none |
| `novel model brief <novel-dir> <thing>` | Everything an agent needs to write one, concisely: the lines about it (best first, bounded), kind and size from the reading, the contract, the checks it must pass, the closest kit parts | none |
| `novel model write <novel-dir> <thing> [--tries N]` | The work model writes the code from the brief; the check's failures go back to it | work model |
| `novel model put <novel-dir> <thing> <file.scad\|->` | The agent's own code, checked the same way | none |
| `novel model check <novel-dir> <thing> [--still]` | Evaluates (OpenSCAD, manifold backend), checks the contract (on the ground, front, size against the text, floating pieces, triangle budget, closed solid with manifold-3d) and writes its catalogue record; `--still` renders pictures for an agent to look at | none |
| `novel model use <novel-dir> <thing> <part>` | Binds a thing to an existing part (our model packs, or a kit module) instead of writing one | none |
| `novel model show <novel-dir> <thing>` | Its code, record and pictures | none |

Kept in the universe: `universe/models/<id>.scad`, `<id>.mesh.json` (derived), `catalog.json` (records), all in the
universe snapshots like `transport.json`. The player draws a thing or a building with a model from its mesh; the rest
keep today's shapes.

**Which get one.** Nominate scores each candidate on importance (scenes, acting cards, damage done or taken, carried or
ridden, named by several people) and on description (sentences that describe it, given size, colours, parts). A model is
made when both pass: a thing named once as "a knife" gets the kit's knife; the Hammerhead powered suit, which several
scenes describe and fight with, gets its own. Buildings the same: a named landmark with a described look gets a shell
(walls, roof, the parts the text names); an ordinary building stays a fill building.

## 4. One place for settings

Today the knobs live in at least four kinds of place:

- `config/terrain/*.json` (building types, city, district, street, heights, composite tenants) and `config/models.json`;
- constants in code (`FILL` and `BUILDING_AREA` in cityFill.ts; `KNOBS` in highways.mjs; `SPEEDS`, `WAITS` in
  roads.mjs; some 29 named numbers in the director, world and player: earshot, crowd reach, demo speed, ...);
- per-universe answers that are really settings (terrain registry knobs, the highway's `knobs`);
- the reading's `settings.json`.

Proposal: **one registry of settings**, `config/world.schema.json` (built 2026-11-09, M8a), each key with its default, unit, range, one
sentence of meaning, where it is used, and which layers may override it. Values resolve through layers:

```
defaults (the schema)  <  universe (universe/settings.json)  <  book (vol-<n>/novel/stage/settings.json)  <  place (by place id)
```

Code reads through one function, `setting(key, { universe, book, place })`. Outputs (terrain.json, transport.json,
models) stay outputs, not settings.

The agent's commands, concise and context-aware:

| Command | |
|---|---|
| `novel settings show <novel-dir> [<prefix>] [--place <id>]` | Effective values with the layer each comes from |
| `novel settings explain <key>` | Meaning, unit, range, where it is used, what changes downstream (e.g. `fill.arterial` -> the fill, the road graph, the highway) |
| `novel settings set <novel-dir> <key> <value> [--place <id>] --why <text>` | Validated against the schema, written to the right layer, logged; a pre-film change becomes a new `before` snapshot |
| `novel settings diff <novel-dir> [--from <snapshot>]` | What differs from the defaults, or from a snapshot |

**Building generation as operators.** A place's fill becomes a short list the agent can read and change in a line:

```json
"places": { "loc_000001": { "fill": [
  { "op": "streets", "cell": 180, "arterial": 18 },
  { "op": "lots", "area": [260, 2400] },
  { "op": "heights", "towers": 0.12, "near": "ramps", "pull": 0.6 },
  { "op": "scatter", "what": "tree", "on": "green", "n": 400, "seed": 7 },
  { "op": "line", "what": "street-light", "along": "arterial", "every": 30 }
]}}
```

Named buildings are never scattered: the text places them, one by one, as now. World · Live's Buildings and Spawn panels
show each operator's area and numbers with handles; dragging writes the setting.

## 5. The model warehouse

Three sources, searched together by `novel model brief` and `use`:

1. Our CC0 packs (`~/claude-world-first/model-packs`: KayKit, Kenney, Quaternius), already baked to JSON.
2. Models we write (`universe/models`).
3. gkNextEngine's SCAD kits (MIT, allowed 2026-11-09): their catalogue gives footprint, height and category for each
   of 576 modules, and our local embeddings (bge) can match a thing's description to a module.

## 6. Later: people with bodies

Their character kit (a 7-bone standard: root, torso, head, two arms, two legs; walk, run and sit clips shared by every
character; parts by slot: head, hair, hat, torso, arms, legs, accessories) fits our people: each cast member assembled
from slots by their sheet (looks from the stills cast), clips for walk, run, sit, fall and fight, a weapon socket for
what they hold. This also helps the smooth replay (walks with steps instead of sliding capsules).

## 7. First slice

1. `novel model nominate|brief|write|put|check|list|show` on volume 1 (library 16), OpenSCAD + manifold-3d as installed.
2. The player draws things with a model from its mesh (World · Live, behind a Models toggle like Smooth).
3. The settings schema with the terrain and highway knobs moved in, `novel settings show|explain|set|diff`, the fill
   reading `fill` operators per place.
4. The skill file, published by the adaptor.

The steps, each with its tests, evidence and cost, are milestones M8 (settings), M10 (models), M11 (landmark shells),
M12 (bodies) and the paid run W15 in [milestones.md](milestones.md); the decision is in the journal,
[world-engine-v2.md](world-engine-v2.md) §2.0.23. Open: how many models per book (cost is small: about 2,000 tokens a
thing).

## 8. Handles for anything, and the warehouse registry (M8d, M10g–i; the user, 2026-11-09)

The user, after W15: "We will do m8d first, but not only think about American or European or anything, think of it as
anything. We should have guidance in the skill to have agent being able to register their own model warehouse, search
in internet to supply the warehouse, and connect warehouse to configurations." And whether to use the blog's warehouse
management system.

### 8.1 gkNextEngine's warehouse, and what we take

- `gnb scad catalog` evaluates every kit module and writes one record per module: its category from the module's name
  (the second segment: `cw_bldg_barn` is a `bldg`), footprint, height, zMin, centre, triangles, colours, warnings, ok.
  We already read its output: `catalog.json` (12 kits, 668 modules) is what `novel model parts|bind` search.
- `ScadLibrary` is a parts browser inside their C++/Vulkan engine (a preview and parameters on the left, the modules by
  category on the right), driven by their agent scripts. It is their engine's; ours is World · Live.
- Taken: one evaluated record per part whatever its source; the name contract as the default classifier of a SCAD kit;
  a browser of our own. Not taken: their engine or its tools.

### 8.2 Handles are the schema's own interface

World · Live gets a **Settings** panel generated from `config/world.schema.json`: the groups with their `about` and
`after`; every key with its value, where it came from (default, universe, book, place), unit and range (a slider for a
ranged number, a field for the rest); the tables as rows (`fill.ops` as its list of operators). Its scope is the book,
or the place shown. A change goes `POST /play/settings` to the host, which runs `settingsSet` (checked against the
schema, written to its layer, logged with the panel's `why`, `--before` as a tick) and answers with the problems or
with when it takes effect. Nothing in it is a region: "an East Asian megacity" is only today's defaults.

**Profiles** are named sets of overrides, nothing more: `novel settings profile save <novel> <name> --why` keeps the
overrides in force as `<universe>/profiles/<name>.json`; `profile apply <novel> <name> --why [--before]` sets each one
through the schema; `profile list`. Anyone makes one ("a European old town", "a space colony", "my test city"); none is
built in.

### 8.3 The warehouse registry

One registry of sources, `~/claude-world-first/model-packs/warehouse.json` (`NOVEL_WAREHOUSE` moves it), outside any
library because packs are shared by every library:

```json
{ "version": 1, "sources": { "gk": { "kind": "scad", "path": "gknextengine-scad", "licence": "MIT",
  "url": "https://github.com/gameknife/gkNextEngine", "fetched": "2026-11-09", "by": "claude", "note": "668 modules" } } }
```

A source's catalogue is `<path>/catalog.json` in gk's record shape, built by us (`novel warehouse add|refresh`):

- a **SCAD kit** (`kind: scad`): every `module name()` with no required parameter in every `.scad` file is evaluated with
  OpenSCAD and measured as a model is (`evaluate`, `measure`, `solidOf`): footprint, height, zMin, closed, pieces,
  triangles, colours; its category from the name's second segment, or from `--categories '{"regex": "category"}'`;
- a **glTF/GLB folder** (`kind: gltf`): every `.glb` or `.gltf` measured and baked with the playground baker's reader
  (size, triangles; positions and indices to `<path>/meshes/<part>.mesh.json` in the player's mesh shape, grey where a
  file has no colours); its category from its folder or a `--categories` map.

Our own `universe/models` is the source `own`; gk's kits are `kit` and the baked CC0 packs `pack`, registered at first
use so the references already written keep working. A part is `<source>:<part>`.

`novel warehouse`:

| Command | Does | Model calls |
| --- | --- | --- |
| `list [--source <name>]` | The sources, their counts by category, licences, paths | none |
| `add <name> <path> --licence <SPDX> --why <text> [--from <url>] [--kind scad\|gltf] [--categories <json>]` | Registers a folder already on disk and builds its catalogue. Refused unless the licence is allowed (CC0-1.0, MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC-BY-4.0 with its attribution kept); `--allowed-by "<the user's words>"` records the user's OK for another | none |
| `fetch <name> <url> --licence <SPDX> --ok "<the user's words>" [--path <folder in the repository>] [--limit <MB>]` | Downloads a git repository (or one folder of it) or a zip into its own new folder under the packs root, keeps its LICENSE and writes SOURCE.txt (url, commit, date), then `add`. Never without `--ok`: a download needs the user's permission, asked with the name, licence and size. Default limit 200 MB (13 GB free on this Mac) | none |
| `refresh <name>` | Rebuilds a source's catalogue | none |
| `find "<words>" [--kind <thing kind>] [--category <c>] [--size <m>] [--source <name>] [--top N]` | Searches every catalogue: an exact name first (a part's name, a model's label given at birth, or its reference), then the words against name and category (synonyms from the kinds' categories) and a size filter near the reading's size. Results as `<source>:<part>` with size and category. No embeddings (the user, 2026-11-09: names at birth recall for nothing) | none |
| `show <source>:<part>` | Its record and its mesh's size | none |
| `use <source>:<part> for <slot> <novel> --why <text> [--place <id>] [--before] [--floors a b]` | Connects a part to a configuration slot (8.4); sugar over `novel settings set` | none |

### 8.4 Connecting the warehouse to the configuration

Each slot is a setting in the schema, so it resolves by layer, logs, diffs, snapshots and shows in the handles like
every other knob:

| Slot | Setting | Layers | Drawn as |
| --- | --- | --- | --- |
| `prop:<kind>` (tree, street-light, bench, bin, car, bollard) | `fill.props` `{ "tree": "kit:cw_nature_pine" }` | universe, book, place | the export puts each used part's mesh in the page's `scadModels` and the reference on the landscape's `props`; the player draws the kind as the part (one instanced mesh a kind, as now) instead of the plain shape |
| `vehicle:<kind>` (a car, a bus, …) | `models.vehicles` `{ "a bus": "kit:cw_veh_bus" }` | universe, book | `carModel`: after a thing's own model, before transport.json's pick |
| `kind:<thing kind>` (a small weapon, …) | `models.parts` `{ "a small weapon": "kit:cw_wpn_knife" }` | universe, book | `novel model bind` binds a thing of that kind to it without asking the work model; `novel model use <thing> <part>` stays per thing |
| `use:<building use>` / `role:<role>` | the `models.uses` table, `uses.<use>.fill[<part>] = [floors]` | universe, book | like a landmark shell: `scad:` on the lot, the lot's plan scaling it |

When it shows: props and uses at the next run or rehearsal (the fill is built then); vehicles and kinds at the next
director run. No model call anywhere.

### 8.5 The skill

`skills/novel-models/SKILL.md` grows "Your own warehouse": register, supply, connect. Supply says where to look (Kenney,
KayKit, Quaternius, Poly Haven, OpenGameArt filtered to CC0; GitHub OpenSCAD libraries whose LICENSE is MIT, Apache or
BSD; per-asset sites like Sketchfab or Poly Pizza only asset by asset), what never to take (GPL, CC-NC, CC-ND, no
licence, anything whose licence is unclear), and the rules: ask the user before any download with its name, licence
and size; a download goes into its own new folder and nothing from it is ever run as a script; keep its LICENSE; record
the URL. Pi's manifest and allowlist take `novel warehouse`.

### 8.6 World · Live

A **Warehouse** panel beside Settings: the sources and categories, the parts with size and category, a search box
(`GET /play/warehouse.json?find=…`), and Assign to a slot (`POST /play/warehouse/use`, the same `why`). A part's
preview is its mesh in a small view when the part is on the page (the player's own `scadGeometry`), else its size and
category; a still later.

### 8.7 Tests, evidence, cost

Tests: a scratch SCAD kit of three modules and a one-file glTF folder registered and catalogued (records, categories,
the licence gate), `find` by words and size, `use` writing the setting and refusing a bad slot or part, profiles save
and apply, the host's settings and warehouse routes. Evidence: the first quarter's rehearsal identical with no
override; with `prop:tree` bound to a kit tree, the page's `scadModels` holds it and the trees' instanced mesh is the
part's geometry; a settings change from the panel lands in the layer's log. Cost: none.

## 9. Could the whole project be SCAD? (the user, 2026-11-09)

The user: "check if we can entirely switch to scad for our entire project and unified warehouse system that minimize
context size and effort level for agent or work model", and "I support embedding word matching because we can have
custom build models be recalled at 100% without cost, if the exact name is assigned at birth, or for this part we can
do programmatic". Measured on this repository and the rehearsal copy, 2026-11-09.

### 9.1 What is not SCAD today

| Asset | Count | Where | Bytes |
| --- | --- | --- | --- |
| Baked building models (Kenney, KayKit, Quaternius, CC0) | 92 | `apps/playground/src/data/architectureModels.json` | 2.1 MB in the repository |
| Baked vehicles | 22 | `vehicleModels.json` | 545 KB |
| Baked furniture (KayKit) | 28 | `furnitureModels.json` | 129 KB |
| The packs on disk | 5 folders | `~/claude-world-first/model-packs` | 525 MB (Quaternius alone 468 MB) |
| Hand-built vehicle forms in the player | 9 kinds | `strand-demo.html vehicleForm`, 56 lines | |
| Plain prop shapes in the player | 6 kinds | `PROP_LOOK` | |
| Three baking tools | | `apps/playground/tools/*-models.mjs` | |

Already SCAD: the universe's own models (25 in volume 1), the two landmark shells, gkNextEngine's kits (616 KB of
SCAD for 668 modules: bldg 88, prop 218, veh 50, nature 54, furn 35, ground, roads, terrain, char parts), and the
props slot (`fill.props`).

### 9.2 What the page pays

The rehearsal copy's world page is 2.8 MB: the walk grid 973 KB, the baked models 830 KB (74 models, 65,000
triangles, **13 bytes a triangle**, int16 positions in base64), the SCAD models 133 KB (3 models, 4,500 triangles,
**30 bytes a triangle**, plain JSON floats and a colour a triangle). An all-SCAD page in today's encoding would carry
about 2.3× the model bytes; the same quantisation the baked models use (int16 positions and a step, a colour palette
with an index a triangle) brings SCAD to the same 13 bytes a triangle. That is the first step, and it is ours to make.

### 9.3 Coverage of our kinds by the MIT kits

- **Vehicles (9 kinds):** all covered (car, taxi, van, bus, truck, pickup, helicopter, airliner, boat, tank, tractor).
  The player's 56 lines of hand-built forms can go once `models.vehicles` names a part per kind.
- **Props (6 kinds):** all covered (lamp_post, bench, bin, bollard_pair, tree/pine, car), plus 200 more (bus shelters,
  traffic lights, hydrants, mailboxes, containers, cranes).
- **Furniture:** 35 modules (cafe, shop, office, hospitality) against our 28 baked KayKit pieces; the architect's rooms
  (`digest/rooms.mjs`) would take a `models.furniture` slot (kind → part) like the others.
- **Buildings (28 uses):** 88 modules cover house, apartment, shop, cafe, hospital, hotel, school, office, warehouse,
  factory, church, supermarket, police, gas station, market, barracks; **none is taller than 20 m** (8 over 15 m). A
  megacity's towers, stations, banks, cinemas, department stores, labs and halls are ours to write: one module per use
  and style, scaled to its lot as shells are now, by the work model from the use's brief (the two landmarks cost
  $0.004 together; 60 modules would cost about $0.1).
- **People:** gk's `kit_char` (M12). **Faces:** pictures (the album), never code (the articles' own boundary).
- **The terrain and the walk grid:** ours and procedural; nothing to gain from SCAD there.

### 9.4 The unified warehouse, and what it saves an agent

One source kind (SCAD), one catalogue record a part, one contract, one way to name: the part's name is given at birth
and never changes. For an agent that means: `novel warehouse find "<words>"` (20 lines back), `use <part> for <slot>`,
or `novel model write` with a brief of about 1,200 tokens (the contract, at most six lines of the novel, the nearest
parts named as examples) and an answer of 600–2,000 tokens; no glTF, no baking recipe, no per-pack licence, no table
of categories to read. The work model's cost a model, measured: $0.0017 on average (62 requests, $0.108).

**Recall by name, free:** `find` now matches the words as a slug against a part's name, its label and its reference
first (+10, `exact: true`), before the words, the kinds' categories and the size; a model written by `novel model`
is `own:<label's slug>` as well as `own:<id>`. Embeddings stay a last, optional ranking for fuzzy natural-language
searches when the local server is up; they never decide an exact name.

### 9.5 The steps (milestones M13)

1. **Quantised SCAD meshes on the page** (int16 + step, a colour palette): the page at 13 bytes a triangle for any
   model; the first-quarter page's bytes before and after as evidence.
2. **Vehicles from the kits:** `models.vehicles` names a kit part for each of the 9 kinds as the universe's default;
   the player's hand-built forms and the baked `vehicleModels.json` retired. Evidence: a rehearsal page with every
   vehicle a `scad:` model; W15's unit 52 van and 154 car stills again.
3. **A building kit of our own** (`kits/nv_kit.scad`, MIT, in the repository): one module per use and style, written
   by the work model from a use brief and the contract, named `nv_bldg_<use>_<n>` at birth; towers and podiums
   included; the `models.uses` table filled with them. Evidence: the first quarter drawn from the kit alone; page
   bytes; cost per module.
4. **Furniture from the kits:** a `models.furniture` slot; `rooms.mjs` and the player read it; `furnitureModels.json`
   retired.
5. **The baked packs retired:** `architectureModels.json`, the bakers and the glTF path in the warehouse dropped
   (kept as a registered source kind for anyone who wants a glTF folder, but no longer needed); 2.8 MB out of the
   repository, 525 MB off this Mac if the user empties the packs folder.
6. **People as a rig** (M12, as planned).

Cost: steps 1, 2, 4 and 5 none; step 3 about $0.1 of work-model calls. Risk: a look of its own against gk's cold-war
and old-town styles (the contract says low-poly and stylised; our kit sets the city's style), and OpenSCAD's time per
new module (seconds, cached).

### 9.6 The Ponytail review of this change (the user: "check with ponytail skill")

Ponytail ([DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail), MIT) is a Claude Code skill set: a
"lazy senior dev" stance (the best code is code never written; reuse, then the standard library, then the least new
code; delete before adding; every shortcut marked `shortcut: <limit>, <when to upgrade>`) and a review that lists
findings only, each with a concrete wrong result, grouped as must fix, should fix and nice to have. Its rules applied to
the warehouse change (6c8d4e1 and the exact-name commit), 2026-11-09:

- **Must fix, fixed:** `meshOfPart` for a baked pack decoded int16 positions from `Buffer.buffer.slice(0)`: a Buffer
  from base64 may sit in Node's shared pool, so a small part read the whole pool's bytes. A typed array over the
  Buffer's own offset and length now; a test holds the sedan's vertices inside its box.
- **Should fix, deleted:** the embeddings ranking (a third matcher, needing a server, never exercised) and `show
  --still` (a picture nobody asked for): −36 lines. Exact name, words, kinds and size remain.
- **Should fix, merged:** the panel's hard-coded list of 32 slot choices duplicated the kinds in `partRefs.ts` and
  the uses in `config/models.json`; the host now serves one list built from them.
- **Nice to have, fixed:** `propModelsFor` ran twice per landscape.
- **Kept as shortcuts, marked:** `fetchSource` (git, zip, sparse, a size limit) tested only for its refusals, not
  against a real download; the glTF reader copied from the playground's baker, both to go with the baked packs (M13e).
- **Not checked:** a vehicle slot and a building-use part in a rehearsal; `fetch` end to end.

At Ponytail's "ultra" level the all-SCAD request itself: justified where it deletes (the baked packs and their three
bakers, the player's 56 lines of vehicle forms, two mesh encodings into one); not yet justified for furniture (129 KB
that works) until the kit's furniture is seen to look right, so M13d goes last.

## 10. The look pass: the world generator set from the text, top down (M14; the user, 2026-11-09)

The user, after the console tests: "It needs to be end to end. We can't reply on the user to tell the agent there's
turbines. The agent has to be able to figure it out on its own by a workflow hooked of modifying terrain generation
setting for a place before terrain loop after reading, so he can query the environment sentences. It needs to be able
to modify on the level of places tree top down."

**The step.** After a book's reading and before its terrain loop, a pre-film cast: the main agent sets the world
generator for the book's places from the text alone. Nothing of the book is in the request it gets; the workflow's
message is the same for every book (`tools/pi-review/look-pass.mjs`, sent to Pi's console the way the director's
review batches are).

**The query.** `novel look context <novel> [--place <id>] [--top N]`: the place tree top down (the book, its cities,
their districts and streets, ordered by how much happens in each), and for each place its telling sentences: the
reading's environment sentences first, then facts and narration that name something a setting answers (streets,
buildings, trees, lights, vehicles, turbines, water, sky, underground, industry, crowds), each with its id, scene and
the words found; the counts of those words; the warehouse parts the text names (a model of this universe by its label
in the sentences, kit parts by the words); and the keys a place may set against those a book sets. Bounded (`--top`
sentences a place, 8 by default), no model call.

**The writes.** The agent decides the book-level look first (what every place shares), then each place's overrides
where its own sentences differ, with `novel settings set ... --place <id> --why "<sentence ids>: <what they say>"` and
`novel warehouse use <part> for <slot> ... --place <id>`; a kind of thing the fill does not know gets a kind of its own
(`prop:wind-turbine`) and a `fill.ops` operator; the last change carries `--before`. A child inherits its parent's
settings and is set only for what the text says about it. A look is never canon.

**The hook.** `node tools/pi-review/look-pass.mjs <library> <volume>`: refuses without the book's reading; the message's
id is a hash of the book and its reading, so a second send is a duplicate, not a repeat; waits for Pi to go idle and
reports the commands run and the settings written. In the pipeline it runs after the reading and before `terrain`.

**Evidence.** `test/look.test.ts` (the tree top down, environment first, words counted, a model found by its label,
`--place`); the pass run with no hint on volume 1 (M14c in the milestones): 240 s, 52 commands, the book's look, the
city's fill and nine places' overrides from the sentences alone, 502 turbines in the world built after it. The context
for volume 1 is 20 KB of JSON at `--top 4` (26 places); the agent narrows with `--place` where it wants more.
