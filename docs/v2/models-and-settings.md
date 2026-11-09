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
| `find "<words>" [--kind <thing kind>] [--category <c>] [--size <m>] [--source <name>] [--top N]` | Searches every catalogue: words against name and category (synonyms from the kinds' categories), a size filter near the reading's size, and, when the local embedding server is up, embeddings of "name, category, size" ranked by the words. Results as `<source>:<part>` with size and category | none (local) |
| `show <source>:<part>` | Its record; `--still <file.png>` renders it with OpenSCAD for an agent that can look | none |
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
