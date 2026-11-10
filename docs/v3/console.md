# Novel Console: the Mac app

> "Let's do electron then" — the user, 2026-11-10, after "A console, could be vscode or our own custom app which I'm more
> leaned towards now ... We can make what v1 has into a DMG."

Built on v3 the same day (apps/novel-console): v3's P2 (plan.md §1.5, §5). An Electron app shipped as a DMG; nothing to
pay (Electron and its packager are free; the app is signed ad hoc, so a copy given to someone else opens once with
right-click > Open).

## 1. What it is

| Part | What it does |
| --- | --- |
| Libraries (left) | folders added with **Add a folder…**, kept between launches; each found book in its universe and order, then the ones not arranged; a book opens into chapters and scenes. A book with a reading opens in the reader; a book without one has **▶** |
| Reader (middle) | the reader page (apps/reader/reader.html, reader.md): the EPUB as published, sentences coloured by kind, names, descriptions and times marked, speakers, every record of a tapped sentence. A chapter or scene in the tree opens it there |
| Panel (right) | **Cast** (people, places, things, concepts, the unnamed, with how many lines each), **Problems** (the reading's doubted credits), **Record** (an entry's record and every line that refers to it across the universe; a line opens the reader at it, in another book if it is there) |
| Keys | the two dots: Jev's key and the work model's, set or not. The dialog stores them in the Mac's secure store (reading.md) and never shows them |
| Readings | **▶** starts a book's reading (one click; with a key missing the keys dialog comes first); the book's row spins and the status bar counts the readings running; it says when one is done, with **Open it**. Pressing the spinner stops it (cached answers stay) |

## 2. How it is made

- **main.js**: one novel server per library folder (dist/src/v3/server.js, the same JSON-RPC the editor extension
  spoke), run by the app's own Node (`ELECTRON_RUN_AS_NODE`); a reading it starts runs the same way and outlives the app.
  The console and the reader are served from `app://console/`, one origin, nothing loaded from outside; the reader page
  gets a fresh nonce and a strict policy each time. The window may ask the server only a fixed list of requests; keys
  go through the main process to the reading module, in, never out.
- **preload.js**: the window's only way to the Mac (`window.novelHost`): libraries, the fixed requests, the keys'
  state and entry, showing a folder in Finder.
- **console.html, console.css, console.js**: the window. No framework.
- **The backend in the app**: `scripts/backend.mjs` copies the built code (dist, not its tests), the reading's scripts
  (experiments/v2/*.mjs), config/, the reader page and the 46 production packages (Apple Silicon only) into
  `build/backend`, laid out as in the repository; `scripts/dmg.mjs` puts it into the packed app's resources, signs the app
  ad hoc and makes the DMG.

```
npm run build                       # at the repository's root
cd apps/novel-console
npm start                           # the app from the repository (development)
npm run dmg                         # release/Novel-Console-<version>-arm64.dmg
node test/drive.mjs <folder>[,<folder>…] [--app <path to Novel Console.app>] [--shots <dir>]
```

## 3. Tests

`test/drive.mjs` starts the app (from the repository, or a packed app) with a profile and a key store of its own, works
its window through its debugging port, and takes pictures of its window only. It never starts a paid reading: the
**▶** it presses has no keys behind it and must open the keys dialog.

| On the two volumes (library 16's readings, read-only) | From the repository | From the DMG's app |
| --- | --- | --- |
| libraries and books listed, ▶ on the book with no reading | yes | yes |
| reader at a spoken line: sentences, marks, speaker chips, pictures | 395, 344, 104, 8 | the same |
| the line's notes | who says it, people, descriptions, times, EM's listing, cards | the same |
| cast, a record and its references across both books | 400 entries, 400 lines | the same |
| problems | 75 | 75 |
| ▶ with no keys | the keys dialog, both "not set" | the same |

A reading started with the packed app's own runtime (stand-in models, `novel folder read --stand-in`) on a fresh folder
with volume 1's EPUB: §4.

## 4. Measured

| | |
| --- | --- |
| the DMG | 173 MB (Apple Silicon) |
| the app | 371 MB on disk |
| a stand-in reading of volume 1's EPUB by the packed app's own runtime (0.1.0) | done: 12 steps, 7,302 questions to the stand-in, none to the work model; the process ended by itself |

## 5. The layout (P3's first part; 0.3.0)

Built to plan.md §1.5a, then reshaped on the user's word (2026-11-10, on 0.2.0): "It would be nice if we can build strands
like real strands, forking and reunion like how vscode visualize git. Next, entire section of jev and all these stuff
should be foldable into a debugging icon. Then, flatten each individual view into the right hand side icons like vscode."

| Area | What it does |
| --- | --- |
| Left icon strip | every view, as VS Code's activity bar (the user, 2026-11-10: "where is the left hand side icons to switch left panels like vscode?", then "move all of them to the left, right panel should be agent panel only"): **Library** (folders, universes, books, chapters, scenes), **Outline** (the open book's chapters, scenes and cards), **Search** (the words in the open book's lines, highlighted; the names that hold them), **Characters**, **Places**, **Strands**, **Record**, **Problems**, **Reading details**, **Readings** (every book's reading state, the books not read yet with ▶, the keys' state), and the keys at its foot; one view at a time; the active icon pressed again folds the left panel (⌘B) |
| Right side | the agents' chat only, opened and folded from the top bar's chat button (⌘I) |
| Book | always there; the reader alone |
| Characters | people, things, the unnamed; a movable's path scene by scene in story order, runs at one place on one strand joined, each stop in its strand's colour with its time; a stop opens its scene |
| Places | the place tree, unordered, each place with how many scenes are in it and under it; a place lists its people and its scenes |
| Strands | a git graph, vertical (the user, 2026-11-10: "verticle in our case ... what's important is the strand lines terminates at node end"): time runs down, scene by scene in story order, days tagged where they change; each strand a lane of its own, the main one leftmost (a lane is freed once its strand has ended or joined); a lane's line runs only from node to node, starting at the strand's first scene and stopping at its last; a strand that split from others curves out of their lane (from their last node before it) into its first node; a strand that rejoins curves (dashed) from its last node into the ringed node of the scene where it joined; a label on the row of each strand's tip names its people and whom it joins; a node or row opens its scene; a strand's chip dims the others |
| Reading details (the debug icon) | Jev's and the reading's records of the line tapped in the book: kind and how sure, the top kinds, who says or does it and to whom, references, descriptions, times, EM's listing, cards, facts, problems, notes. The reader no longer shows them itself in the console |
| Record, Problems | as before |
| Chat | the hosts the adapter registry lists (src/adapters/hosts.ts), each with its sessions on this Mac, newest first; a session's last messages (runs of tool calls joined); continued in place where the host's command can resume it (Claude Code, `claude -p --resume`, in the session's own folder). Codex, Gemini CLI and Pi are read only; Cursor and Muse keep no sessions here |
| Day or night | v1's World · Live palettes; the reader follows |
| Remembered | the panel's state and view, the widths, the palette |

The views come from one server answer, `novel/world` (src/v3/world.ts): the reading's time tree, its place tree, each
scene with who and what is present, its time node and its place, and the strands, built with the director's own
builders (readingScript, segmentWorld, strandsFile) from the reading alone. Volume 1: 286 scenes, 131 places, 100
movables, 3 strands, in 0.1 s; volume 2: 348 scenes, 138 places, 143 movables, 11 strands, in 0.15 s.

Driven from the 0.5.0 DMG (every view on the left, the chat alone on the right) (the left strip: volume 1's outline 6 chapters, a search for its most present person 94 lines with each match marked, the readings view, the left panel folded and back); volume 1's graph has 286 nodes, 3 lanes, 3 fork and join curves and 3 tip labels; volume 2's
has 348 nodes, 10 lanes, 12 curves and 10 tip labels; every lane's line ends on a node; one view shows at a time; the reader's own notes are hidden and the debug icon
is marked when a line is tapped; folding the panel widens the book. Sessions found on this Mac: Pi 37, Codex 40, Claude
Code 6, Gemini CLI 2. A session is continued in a test only through a stand-in command (`NOVEL_CONSOLE_AGENT_COMMAND`).

Since 0.7.0 the Library has **Arrange with an agent**: the agent open in the chat (Claude Code or Pi, the user's pick)
arranges the folder into universes and series with the folder's own `novel` command only, in the session open there or
a new one, its commands shown in the chat as they run (basic.md §5). Pi's sessions started by the console can be continued
from the chat.

## 6. Not yet

- An icon of its own (the app shows Electron's).
- The rest of v1's console (P3): the review's batches, settings, the warehouse, World · Live.
- Continuing Codex, Gemini and Pi sessions from the chat; starting a new session there.
- Keys stay in `~/.config/novel-ontology/secrets.json` (mode 600), shared with the `novel` commands; the Keychain (plan.md
  §1.5) is not used yet.
- Intel Macs: the DMG is for Apple Silicon only.
- Signing with a Developer ID and notarizing, if the app is ever given to others.
