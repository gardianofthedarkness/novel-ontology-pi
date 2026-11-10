# v3: a console for novels, the map reimagined

Started 2026-11-10 from v2 (branch `v2`, which is the legacy version from now on), on the user's word: "We should make
this phase v3, a new branch from v2. V2 now is from now on our legacy version. In v3 we reimagine how our map is built."

Why: volume 2 travels between countries, and v2's map (six fixed place scales, one canvas with a city at its top, a walk
for every move) could not hold it; its run was stopped (W16).

| Document | What it is |
| --- | --- |
| [plan.md](plan.md) | The plan: a console for novels as our own Mac app (a DMG, made from v1's console; VS Code set aside 2026-11-10), the world as a Unity client, smaller Jev loops with an agent keeping the long view, tests by a second Claude Code session |
| [console.md](console.md) | Built: Novel Console, the Mac app (Electron, a DMG): libraries from any folder, the reader, the cast and records, problems, keys and one-click readings |
| [workspace.md](workspace.md) | Built: the opened folder as a workspace of novels (scan, universes, order, chapters and scenes), the novel language server, the `novel folder` commands, the editor extension |
| [reader.md](reader.md) | Built: a processed book read as published in the editor (the EPUB with its pictures, sentences coloured by kind, names, descriptions and times marked, speakers, every record of a sentence) |
| [reading.md](reading.md) | Built: one-click readings in the workspace (keys in the Mac's secure store, the reading in a process of its own, linked to the book) |
| [render-units.md](render-units.md) | The first design: the map as render units, each the largest space the story plays in without a break, with its own scale |

v2's documents (docs/v2/) stay as the record of what is built: the reading, strands, the carry across books, the casts,
the director, the volume runner. v3 changes how places become a map; see render-units.md §6.
