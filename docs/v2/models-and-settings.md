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
