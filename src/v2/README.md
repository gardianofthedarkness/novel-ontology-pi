# src/v2

The v2 code that is TypeScript, one folder for each layer of the concept map (`concepts.ts`): reading and the place
tree (extraction), terrain, the world, the context engine every Jev question goes through, and the code rules. The
world engine's scripts that run them are in [world-engine/](../../world-engine/README.md), in the same layers. The
guide from concept to design to code: [docs/v3/design.html#v2-readme](../../docs/v3/design.html#v2-readme).

| Folder | Layer | What it holds |
| --- | --- | --- |
| `extraction/` | Reading, the place tree | The reading flow: the book's blocks (`base`), listing and typing, EM (`em`), EM² (`roles`), facts, story time, places in EM (`placeEm`), the place recommender, spatial words, the world script |
| `context/` | Reading, terrain, view | The context engine (`engine`) and its modes: reading, places, terrain (`terrainModes`: kinds, heights, the minimum gate, a composite's floor and size); the text's own measures (`measures`); the zoom engine (`zoom`: sizing by pins, placement, settling, framing) |
| `terrain/` | Terrain | What the ground is, level by level: the spawning configurations (`config`), the slots (`slots`: borrowing and spawning under the characters'-travel objective), the slot tree (`tree`), topology, manifold unification (`heights`), the building inventory and its search (`inventory`), composite buildings (`composite`). Its dictionaries are in `config/terrain/` |
| `world/` | World | What stands: the canvas of places (`placeCanvas`), the landscape fill (`landscape`, `cityFill`: patches, streets, lots), tall buildings and wide streets (`tall`), the underground (`underground`), the model kit by use (`useModels`) |
| `rules/` | Rules | What code decides without a model: the rules catalogue (`index`), the language profile (`language`), the place, presence and typing rules |
| `concepts.ts` | All | The concept map: every concept, its stage and layer, where it lives and where it is designed (`test/concepts.test.ts` keeps it true) |

A new concept, or a renamed one, goes into `concepts.ts` first; `node experiments/v2/concepts-page.mjs` makes the page
again after `npm run build`.
