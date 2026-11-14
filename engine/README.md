# engine

The engine's scripts: plain JavaScript run with Node on a built checkout (`npm run build`), loading the built code from
`dist/`. Each folder is a concept of the design; where a concept also has TypeScript, it has the same name in `src/`.
The full map, concept by concept: [design §2.5, the code map](../docs/v3/design.html#code-map).

| Folder | What it holds | Design |
| --- | --- | --- |
| `reading/` | the reading's runner the console starts (`read.mjs`), and pages and tools over a reading (`inspect`, `compare`, `marks`, `time`, `strands`, `workspace`) | §5 |
| `library/` | adopting a v2 universe library | §3 |
| `casts/` | the casts before the film and the digests (settei, stills, sky, transport, set dresser, rooms, mounts, in-use); `run/` runs each on a reading | §8.2 |
| `characters/` | the figure pipeline (pictures to a rigged VRM hologram figure; `pipeline/`, versions in `VERSIONS.md`) and the figure page (`viewer/`); the store and EM's assignment are `src/characters/` | §8.6 |
| `terrain/` | the terrain loop, composite buildings, highways, the terrain's pages and the street compatibility tables; `run/float.mjs` | §7 |
| `world/` | the world built from the terrain: layers, roads, highways, air, composite parts, the carry across books, one strand's page data | §6–§7 |
| `spawning/` | where each person and thing stands when a scene begins | §7.8 |
| `director/` | the director, its specialists and questions, the gate, rehearsals, moving conversations; the design's registry and directing notes (`specialists-doc.mjs`, `directing-vault.mjs`) | §8.2 |
| `crowd/`, `laws/`, `smoother/`, `log/` | the crowd field, the laws, smoothing, the world log | §8.3–§8.5 |
| `review/` | the review by Jev, the cast's review, voices, canon from a run; `run/voices.mjs` | §9 |
| `view/`, `live/` | World · Live's page, its panels, replays and the live record | §12.2 |
| `volume/` | a whole volume's steps in order | §8.2 |
| `design/` | the concept map's section of the design | §17.3 |

Tests sit beside their scripts: `npm run engine:test` (`engine/**/*.test.mjs`).
