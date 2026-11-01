# src/v2

The v2 code that is TypeScript: extraction, the context engine, the code rules, and the concept map. The world engine's
scripts are in [world-engine/](../../world-engine/README.md); the ground they build on is in `src/ground/stage/`.
The guide from concept to design to code: [docs/v2/README.md](../../docs/v2/README.md).

| Folder | Stage | What it holds |
| --- | --- | --- |
| `extraction/` | Extraction | The reading flow: the book's blocks (`base`), listing and typing, EM (`em`), EM² (`roles`), facts, story time, places in EM (`placeEm`), the place recommender, spatial words, the world script (`script`), the canon a world-first workspace reads (`canon`), sampling pools |
| `context/` | Both | The context engine (`engine`) and its modes: reading, places, terrain; the zoom engine (`zoom`: sizing by pins, placement, settling, framing) |
| `rules/` | Both | What code decides without a model: the rules catalogue (`index`), the language profile (`language`), the place, presence and typing rules |
| `concepts.ts` | Both | The concept map: every concept, its stage and layer, where it lives and where it is designed (`test/concepts.test.ts` keeps it true) |

A new concept, or a renamed one, goes into `concepts.ts` first; `node experiments/v2/concepts-page.mjs` makes the page
again after `npm run build`.
