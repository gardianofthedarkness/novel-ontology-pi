# world-engine

The world engine's scripts: the second stage of v2, which builds the world the extraction read. They run on a built
checkout (`npm run build`) and on a world-first workspace (`experiments/v2/workspace.mjs`). The guide:
[docs/v2/README.md](../docs/v2/README.md).

One folder for each layer of the concept map (`src/v2/concepts.ts`):

| Folder | File | What it does |
| --- | --- | --- |
| `terrain/` | `terrain-spawn.mjs` | The terrain loop (done, 2026-11-01): level by level, part by part, Jev asked each place's kind and height with two pictures, then sized, placed, settled and laid; buildings typed by the inventory's search, held to the minimum gate; `novel sim terrain` |
| `terrain/` | `tenants.mjs` | Composite buildings: a shop, a restaurant, a cinema joins its host, on a floor at a size |
| `terrain/` | `terrain.mjs` | The earlier terrain-and-spawn plan, kept for `novel sim terrain --sites` |
| `world/` | `export-strand-demo.mjs` | The world built from the terrain: the canvas, the filled landscapes, tall buildings and wide streets, the world's lots; one strand's page data |
| `world/` | `composite.mjs` | Where a composite building's parts stand in their host; markers on what stands |
| `world/` | `world-map.mjs`, `impact-choices.mjs` | A top-down map for Jev's box questions; where a fight hits and how big |
| `view/` | `strand-demo.html`, `landscape-mock.html` | The page the world is seen in, and the first terrain mock |
| `view/` | `building-list.mjs` | The Buildings panel's list in World · Live |
| `view/` | `two-view-things.mjs`, `record-scene.mjs` | Jev placing a strand's things on two pictures; a scene recorded as a video |
| `live/` | `sim-jev.mjs` | The live record World · Live reads (Jev's questions, the world at each moment), and the stage simulation decided live |

Tests: `npm run world-engine:test` (`world-engine/*/*.test.mjs`).
