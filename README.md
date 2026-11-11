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

```
apps/novel-console/  the Mac app (Electron): npm start, npm run dmg
apps/reader/         the reader page
src/v3/              the folder workspace, the basic layer, the novel server, the reader's data, one-click readings
src/v2/              the reading (extraction/), the context engine (context/), terrain, the world, the code rules
src/digger, solidifier, ground   v1's extraction, review gate and storage (the ground is still everyone's)
src/cli/             the novel command
world-engine/        the world engine's scripts: terrain, the director, digests, crowds, laws, the smoother, the views
skills/              what an agent is taught (novel-folder, novel-ontology, novel-library, novel-volume, ...)
adapters/            the skills and CLI in every agent host
tools/, experiments/ the Pi host and its pages; runs and pages of the v2 reading and terrain
docs/v3/             design.html and milestones.html
```

## Running

```sh
npm install
npm run build
npm test                    # the v1, v2 and v3 tests, the concept map included
npm run world-engine:test   # the world engine's own tests, the design's generated sections checked
cd apps/novel-console && npm start   # the console, from the repository
```

The two models (a work model and Jev) are entered in the console's keys dialog, or with `novel folder keys`. A book's text
never leaves its folder: readings live in the folder's `.novel/`, and nothing of a book is published.
