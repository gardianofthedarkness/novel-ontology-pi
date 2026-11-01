# world-engine

The world engine's scripts: the second stage of v2, which builds the world the extraction read. They run on a built
checkout (`npm run build`) and on a world-first workspace (`experiments/v2/workspace.mjs`). The guide:
[docs/v2/README.md](../docs/v2/README.md).

| File | Step | What it does |
| --- | --- | --- |
| `terrain-spawn.mjs` | Terrain (done) | Part by part, asks Jev each place's kind and height with two pictures, then sizes, places, settles and lays it; `novel sim terrain` runs it |
| `export-strand-demo.mjs`, `strand-demo.html` | The view | One strand's world as a page: the places from the place tree, pins with their status, the settle playback; also the page World · Live and Jev's pictures are drawn from |
| `sim-jev.mjs` | Movement (later) | The stage simulation decided live, as `novel sim pick` runs it; the vendored three.js files |
| `world-map.mjs` | The view | A top-down map around a point, for Jev's box questions |
| `two-view-things.mjs`, `impact-choices.mjs` | Spawning, movement | Jev places a strand's things, and a fight's damage, from pictures the reader would see |
| `record-scene.mjs` | The view | One scene recorded as a video |
| `terrain.mjs`, `landscape-mock.html` | Terrain (first version) | The earlier terrain-and-spawn plan, kept for `novel sim terrain --sites` |

Tests: `npm run world-engine:test`.
