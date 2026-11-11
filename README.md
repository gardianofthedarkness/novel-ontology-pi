# novel-ontology-pi

Turns a novel into a world you can read, query and watch. **The reading** turns a book into an ontology (who says and
does each line, when it happens, where every place and thing is), citing the book's own sentences. **Novel Console**, a
Mac app, is where it is read: every book in any folder you open, the book as published with the reading's marks, its
people, places and strands, and the agents beside it. **The world engine** builds the world from the ontology and plays
it, and its laws check the reading in return.

## The two documents

- **[docs/v3/design.html](docs/v3/design.html)**: the design, all of it: what v3 is, and every design from v1 and v2
  that still holds, with what was replaced and why.
- **[docs/v3/milestones.html](docs/v3/milestones.html)**: what was built when, from the founding design to v3's phases,
  and what comes next.

Run reports and benchmarks: [docs/reports/](docs/reports/).

## Where it stands (v3, from 2026-11-10)

| Part | Status |
| --- | --- |
| Any folder as a library: scan, the basic layer (no model), series, arranging by an agent | **built** |
| Novel Console 0.7.0 (Electron, a DMG): the reader, Characters, Places, Strands, Record, Problems, the agents' chat, one-click readings | **built** |
| The map as render units; smaller Jev loops with an agent setting each step | designed |
| The world as a Unity client behind a render protocol | designed |
| Phones and tablets (reading packs) | proposed |

v2 (branch `v2`) is the legacy version: its reading and world engine are what v3 builds on. v1 (branch `main`) is the
original CLI.

## Where things live

The code is grouped by the design's concepts; the full map is [design §2.5](docs/v3/design.html#code-map).

```
src/        TypeScript, built to dist/
  ground/     storage, connectors, the ontology's types, events, languages, errors, paths on disk
  library/    any folder as a library: the workspace, the basic layer, books
  server/     the novel server, the reader's data, one-click readings
  reading/    the reading: text/, album/, the v2 flow; v1/ for v1's miniloop and faculties
  context/    the context engine: every Jev request composed
  universe/   one character list, calendar and causal ledger per universe
  world/      the world model's rules, terrain, the built world, spawning, models, settings
  play/       v1's stage faculties
  canon/      the one review gate, corrections
  cli/        the novel command
engine/     the engine's scripts by the same concepts: reading/, casts/, terrain/, world/, director/, laws/, smoother/, review/, view/ ...
test/       the tests by the same concepts
apps/       Novel Console (novel-console/), the reader page (reader/), the playground's shared data and v1 interface (playground/)
skills/     what an agent is taught;  adapters/  the skills and CLI in every agent host
config/     the settings registry and tables;  tools/  the Pi host, the portrait cropper, the Muse relays
archive/    set aside: the VS Code extension, the team playground's launcher
docs/v3/    design.html and milestones.html;  docs/reports/  run reports and benchmarks
```

## Running

```sh
npm install
npm run build
npm test                    # the v1, v2 and v3 tests, the concept map included
npm run engine:test         # the engine's own tests, the design's generated sections checked
cd apps/novel-console && npm start   # the console, from the repository
```

The two models (a work model and Jev) are entered in the console's keys dialog, or with `novel folder keys`. A book's text
never leaves its folder: readings live in the folder's `.novel/`, and nothing of a book is published.
