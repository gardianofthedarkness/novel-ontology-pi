# The v3 plan (the user, 2026-11-10)

> "Let's first make a huge plan change for v3. First, we might want to make the runtime jev loops smaller. Jev miniloop
> of casts are good, but they lack fundamental ability to correct itself in long term. It's errors stack and our final
> effect goes out of control. But jev does have the ability to place spatial things in 2d and do structural extractions
> at high-speed, which we don't want to abandon. Instead of using our agent console as test, what we can establish in v3
> is you can spin up another Claude code session using sonnet5.5 high effort for testing. The next big design is
> frontend: I believe I know what we are trying to build. We are trying to build vscode for novels. The character names
> nominated objects buildings, actions dialogues all those ontology things, can be done like a vscode way. You can almost
> map everything we have to a vscode functionality or extension. The world live use the live preview when doing frontend
> design. We can loop through ontology the 'definition of characters and where they are cited' way. But of course novels
> are different, but the philosophy is like this, a unified console for reading and later, help writing novels. All the
> ai harnesses naturally becomes the side panel console thing. This basically combines what we have in v1 and v2, but
> just now they all become extensions and features of this unified workspace." — the user, 2026-11-10

> "Let's no longer do the tunnel for phone for now. But you get my idea. A console, could be vscode or our own custom app
> which I'm more leaned towards now since it's so hard to use vscode experience wise so bad especially in the phone. We
> can make what v1 has into a DMG. And then, we build the world live from web to a proper unity. You can modify v3 design
> first that vscode doesn't really work and we are not perusing it further." — the user, 2026-11-10, after trying the
> workbench in VS Code on a phone through a tunnel

Status (revised 2026-11-10): **the editor is no longer the host.** v3's console is our own Mac app, shipped as a DMG,
made from what v1's console already does; World · Live moves from the web page to a Unity client. What P1 built stays and
becomes the app's backend: the opened folder as a workspace (workspace.md), the novel server and its requests, the
`novel folder` commands, the reader (reader.md) and one-click readings (reading.md). The VS Code extension is set aside
(§1.6). Decided before and still standing: the agent sets a miniloop's step length (§2); a Unity render client behind a
render protocol (§1.4). The phone is set aside for now, with the tunnel.

## 0. What v3 is

One console for reading a novel and, later, writing one: our own app, where the library is every book in the folders the
user opens, a book opens into chapters, scenes and cards, the ontology is its symbols (records, references, who says
each line), the checks are its problems, a reading runs with one click, and every AI harness is a panel beside it. The
world is a Unity window the console drives. Everything v1 and v2 built becomes a part of it. Under it, a runtime where
Jev does small, bounded jobs and an agent keeps the long view; a map made of render units (render-units.md); tests
driven by a second Claude Code session.

## 1. The console

### 1.1 What we have, as the console's parts

The table maps an editor's ideas onto a novel. The ideas stay (they are how the console is organised); the editor itself
does not (§1.6).

| In an editor's workbench | For a novel | What we have for it |
| --- | --- | --- |
| the source files | the book: chapters, sentences | the stored source and its sentence ids; read mode; the EPUB album |
| a symbol and its definition | a character, a place, a thing, a concept, with its record | the chart's entities, settei sheets, portraits, the warehouse part bound to a thing |
| find all references | every line that names, describes, quotes or addresses them | EM and the roles (who says or does each line), with confidence and how it was reached (`via`) |
| hover | the card of whoever is under the cursor: names, sheet, face, where they are now | the record inspector, the cast's sheets |
| rename a symbol | two entries are one person; a name corrected everywhere | `novel cast merge`, the review's identity questions |
| outline, breadcrumbs | book, chapter, scene, card | scenes, cards, the storyboard's cuts |
| semantic colours, inlay hints | a line's kind (narration, speech, action, thought); who speaks an unattributed line; the scene's place and story time | sentence kinds, speakers settled, the world script, story time |
| a lens over a block | over a scene: its unit, its strand, "play this scene", "show in the world" | strands, render units, the director |
| problems, quick fixes | a law the run broke, a held question, a credit the unit does not back, a conflict in canon or in the strands; answering it | the laws, the review pool and its batches, the credit check, the strands' checks |
| call hierarchy, type hierarchy | who interacts with whom; what holds what | interaction beats, causality; the place tree, render units |
| the timeline view | a scene in story time and on its strand | the time tree, strands, the story timeline |
| source control | snapshots before and after a run; a reading's changes reviewed before they are canon | universe snapshots; v1's changesets and review gates |
| settings: user, workspace, folder | the world generator's settings: defaults, universe, book, place | `config/world.schema.json` and its layers, profiles |
| run and debug | the director's run: start at a unit, stop at one, step unit by unit, look at positions and layers | the director, terrain's step mode, why-walk, the world log |
| tasks | the volume's steps: reading, terrain, the casts | the volume runner |
| tests | rehearsals with a stand-in; the laws as assertions per unit | `rehearsal.mjs`, the laws |
| the live preview | the world beside the text: the cursor on a line moves the world to that moment, a click in the world finds the line | World · Live, the director's page, the replays |
| the side panel | every AI harness: the agent with its skills, the casts' answers, the review's batches | the Pi console, the skills, the casts |
| extensions, a marketplace | casts, readers of pictures, model packs | the pre-film and runtime casts, the warehouse |
| search | the text by words or by meaning | `novel search`, `novel source grep|similar` |

### 1.2 Where novels differ

- A definition is a record, not a span of text; a reference is a judgement with a confidence and a route, so the
  console shows how sure each one is and lets it be corrected in place. A correction is a change to canon with a
  reason, through the same gate as any other.
- "Compiling" is the reading, "running" is the director, "errors" are laws broken and questions held; all three cost
  money or time, so the console shows what is stale and what a rerun would cost before it runs.
- Reading first, writing later: for a writer the same checks become continuity warnings while typing (someone in two
  places at one time, a thing used before it is given).

### 1.3 The pieces

0. **The opened folder is the library** (built, workspace.md): every EPUB and text file under a folder the user opens is
   found by a scan; the user or an agent arranges them into universes, each with its books in order; a book opens into
   chapters, scenes and cards. The files are never moved: the arrangement is a hidden state file, and a file is known by
   its content. Any folder on the Mac, several at once.
1. **The novel server** (built): the folder's books answered over JSON-RPC, the requests a console needs: the tree, a
   book's text and outline, symbols and records, references with how and how sure, speakers, problems, the reader's data,
   the model keys' state, readings started, followed and stopped. It was written to the Language Server Protocol, which
   it keeps; the console is its main client.
2. **The console app** (§1.5): the library, the reader, the cast and records, problems, readings with one click, the
   settings, the agent's panel, and the world's window launched beside it.
3. **The world client** (§1.4): Unity, its own window, driven by the console.

### 1.4 The world's frontend: a native engine client (decided 2026-11-10)

> "I'm thinking about whether we should build a real vscode extension activatable unity based game engine frontend. The
> first reason is our browser is very easy to get stuck, two is we might want to integrate vr and ar versions in the
> future. You can decide." — the user

**Decision: yes, Unity, as a render client the console launches; the world engine is not ported.**

- **One world server, several render clients.** The simulation stays where it is (TypeScript on Node: terrain, the
  director, the laws, structures and blasts) and is the only truth. It sends the world to clients over one versioned
  **render protocol**: a unit's ground, lots, shells, props, people and their moves, as a compact stream of changes.
- **The Unity client** builds everything from that stream in code (no hand-made scenes: the world is procedural), with
  the engine's instancing, culling and threads. The console starts it as its own window beside it and ties it to the
  reader (a line moves the world, a click in the world finds the line) over a local socket.
- **The web page stays only where it must**: today's three.js page, fed by the same protocol, for Jev's camera (its 2D
  maps and stills) until the Unity client can take those, and inside the console as the world view until the Unity
  client is ready.
- **VR and AR later, from the same client**: a headset build is another target of the Unity project, not another
  frontend.

Why this shape (checked 2026-11-10):

| Question | What I found |
| --- | --- |
| Why the browser gets stuck | Partly our data path, not only the browser: the world page does everything on one thread (no workers) and a full run's page is an 89 MB JSON file (W15). The protocol fixes that for every client; a native engine then adds threads, instancing and culling. |
| Can a native view be docked inside the console? | Not inside a web view (the console's pages are web pages, as an editor's panels were). So the client is its own window beside the console, which the console opens, places and drives. |
| Streaming Unity's picture into a panel (and to the phone) | Not a base to build on: Unity's Render Streaming has had no release since December 2024, and its WebRTC package was reported marked deprecated in August 2026. |
| Unity's cost | Unity Personal is free under 200,000 USD of revenue and funding a year. Apple Vision Pro support (visionOS, PolySpatial) needs Unity Pro, a paid seat (about 2,300 USD a year, to verify when it is needed). Quest and phone AR need no Pro. |
| The open alternative | Godot is free, small and text-based (easier for an agent to drive), with good Quest support through OpenXR; its Vision Pro path is unclear, and phone AR is weaker. Unity has the widest headset reach, which is the second reason for a native engine at all. |
| Can an agent build it without the editor's interface? | Yes: C# and project files are text, builds and play-mode tests run from the command line. It needs the Unity editor installed once (a download of several GB and the user's Unity account). |

Costs and risks: two render clients on one protocol (the web one kept slim); a slower build loop than a web page; the
engine is proprietary (the project files are ours and can be public, the engine's cache folder is never committed).

**The first step when v3 starts is a proof, with a way out:** the render protocol for one render unit, and a Unity
client that draws volume 1's city from it with its people moving, measured in frames a second against the web page on
the same data. If it does not clearly beat the page, or the build loop is too slow to work in, the protocol still
stands and the client can be Godot or the web page with workers.

### 1.5 The console app: v1's console as a Mac app (proposed 2026-11-10)

What v1's console does today, in a browser on the Pi host: the library and its books, read mode (the EPUB with sentence
kinds and marks), the agent's console beside the work, the review's batches, settings and the warehouse, and World ·
Live. The app keeps those and adds what P1 built (any folder as a library, the reader's notes, one-click readings). It
loses the host, the tunnel, the links and their time limits: it is a program on the Mac.

My proposal for its shape (to confirm):

- **Electron**, packaged as a signed DMG. Our backend is Node (the novel server, the reading, the world engine), and
  Electron carries its own Node, so the app runs the backend in its own processes with nothing else to install; the
  console's pages are the web pages v1 and the reader already are. Tauri would make a smaller app but needs the Node
  backend shipped beside it as a separate program, for little gain here.
- **Windows of its own**: the library beside the book; the reader as the main view; records, references and problems as
  panels; the agent's panel at the side; a status bar with the readings running. Laid out for this work, not for code.
- **Keys** in the Mac's Keychain (Electron's safe storage), moved from today's `secrets.json` on first run; a reading
  still runs as a process of its own and survives the window closing.
- **The agent's panel** is optional: one-click readings and the reader never need it (the user: "no agent is involved").
- **Packaging**: a DMG built from the repository by one command; unsigned at first (opened once with right-click >
  Open), signed and notarized with an Apple Developer ID (99 USD a year) when it is given to anyone else.

Needs before building: the user's OK for the downloads (Electron and its packager, about 200 MB), and later the
Developer ID if it is shared.

### 1.5a The console's layout (P3, the user, 2026-11-10)

> "In p3, let's first start with user experience. Our design Principle can follow vscode, panels other than the left repo
> structure and the main body which is displaying the file itself is all foldable. We can inherit the styling from v1 in
> terms of colour and design. Then, like the worktree system in vscode, we can build the strand view in a side panel. We
> can connect to existing sessions from all agent adapters we have in adaptors and put it in like a chat panel like in
> vscode. We can have a character view and place view as well. The idea is still, like in v2 design doc, time is
> oriented tree (calender, place is uniriented tree, characters and objects are movables relative two those two trees.
> Strands is a visualization if that relationship" — the user

| Area | Always there or foldable | What it holds |
| --- | --- | --- |
| Library (left) | always | folders, universes, books, chapters, scenes |
| The book (middle) | always | the reader |
| Left icon strip | every view behind its icon, one at a time, foldable (as VS Code's activity bar; the user, on 0.2.0 and 0.4.0) |
| Right side | the agents' chat only (the user: "right panel should be agent panel only") | **Characters**: people and things (movables) and each one's path: where and when it is, scene by scene. **Places**: the place tree (unoriented: containment only), each place with who was there and when. **Strands**. **Record** and **Problems** of what is open |
| Chat (far right) | foldable | the agent hosts' existing sessions (the adapters: Claude Code, Codex, Pi, Gemini CLI and the others the registry adds), read and continued in place |
| The bar's buttons | | fold or open the side bar, the chat; day or night (v1's two palettes) |

**The world model, as the views show it** (docs/v2/world-model.md): time is an **ordered tree** (the calendar: story ›
year › day › part of day), places an **unordered tree** (what holds what), characters and things are **movables**, each at a
place at a time. A **strand** is a group of movables that stay together; strands split when the group parts and unite
when it meets again. The Strands view draws exactly that relationship, as a source-control graph draws branches: time runs
down by the calendar's nodes, each strand is a lane, each scene a point on its lane labelled with its place, and lanes fork
and join where the strands split and unite. Tapping a point opens its scene in the book; tapping a movable shows its path
in Characters; tapping a place opens it in Places.

Styling: v1's World · Live palette, deep navy with a cyan accent and Jev's gold (night), and its "day" palette.

### 1.6 VS Code, set aside (2026-11-10)

Tried on 2026-11-10: the extension worked in the desktop editor (the tree, hover, definitions, references, the reader,
one-click readings), but the editor's interface was hard to use for reading a novel, and on a phone through a tunnel it
was not usable. The extension (apps/novel-vscode) and its editor tests stay in the repository as a record and are not
developed further. Nothing else depended on it: the folder workspace, the server, the commands, the reader page and the
readings are the app's.

## 2. The runtime: smaller Jev loops

What goes wrong today: an answer of Jev's becomes the input of the next, for a whole volume (516 calls in W15), and
nothing looks back. One wrong step stays: a fighter sent up an office tower at unit 14 was still there at unit 26; a
line credited to the wrong person walked the protagonist 40 floors up; 28 units of W15 played in the wrong district.

What Jev keeps doing, because it is fast and good at it: placing things on a 2D frame (a spot, a formation, a direction,
a box, a kind and a height in terrain), and structural extraction in the reading.

The change:

- **A Jev loop is one bounded job** on one 2D frame, a handful of questions. **The agent decides the step's length**
  (the user, 2026-11-10: "The agent can decide the step length of the miniloop"): a card, a scene, a stretch of a
  render unit, shorter where the last steps went wrong and longer where they held. Its inputs are the text and checked
  state, never Jev's own earlier answers unchecked.
- **Every step starts from the text again**: who is there and where the text puts them. An error cannot outlive its
  step.
- **Every answer is checked at once by code** (the laws as assertions): a failing answer is asked once more with the
  failure shown, then left to a rule.
- **The long view is the agent's**: after each step the agent sees what was placed and what the checks say, corrects
  (a pin, a note to the next step) and sets the next step's length, before it runs, not after the whole book.
- **What leaves Jev**: anything that needs memory across units (a journey's route across places, who went where since
  when) goes to code and the agent.

## 3. The map

Render units: [render-units.md](render-units.md). In the console a unit is a node of the library under its book and a
place in the world's window; a stretch is what a step of the director covers.

## 4. Tests: a second Claude Code session

In v3 a test of the agent's side is run by a separate Claude Code session (Sonnet 5.5, high effort) that I start: it is
given the skills and the commands as a user's agent would have them and a task ("do the look pass", "find the units and
check them against the text", "where is this character cited, and which citations are wrong?"), and its transcript is
the test's record. It replaces driving the Pi console for tests, which needed a host, a tunnel, a guard and a time
window (W16). It is unpaid unless the user says otherwise (stand-in models), and it never touches a live library.

What it shows that a unit test cannot: whether a fresh agent can do the work from the skill alone, where a command's
form trips it, and whether its result holds against the text.

## 5. Order

| Phase | What | Proof |
| --- | --- | --- |
| P0 | this plan, corrected by the user | |
| P1 (built 2026-11-10) | any folder as a library (workspace.md), the novel server, the `novel folder` commands, the reader (reader.md), one-click readings (reading.md); first shown in VS Code, which is set aside (§1.6) | both books read in it; a test session arranges a folder and answers citation questions against the text |
| P2 (built 2026-11-10) | the console app as a DMG (§1.5, console.md): open folders, the library, one-click readings with the keys, the reader with its notes, records and references, problems | the DMG's app driven on both volumes; a stand-in reading run by its own runtime |
| P3 (started 2026-11-10: the layout built and reshaped to an icon strip, a git-graph Strands view and a debug view, console.md §5) | the console's layout (§1.5a: foldable side bar and chat, v1's palettes; Characters, Places and Strands views; the agent hosts' sessions in the chat), then the rest of v1's console: the review's batches, settings, the warehouse, and World · Live's page as the interim world view | the views on both volumes, against the reading; a session of each installed host continued from the chat; a test session does a look pass from the app |
| P3 (also built) | the basic layer for every book a folder holds, with no model, and series arranged by one click (basic.md); universes and series arranged by one click by the agent open in the chat, Claude Code or Pi (basic.md §5); tests as a user on ~/Documents | the DMG's app on ~/Documents: 29 books, 87 copies, 4 series |
| P4 | the render protocol and the Unity world client (§1.4), launched and driven by the console | volume 1's city drawn from the protocol, frames a second against the web page; a line in the reader moves the world |
| P5 | the unit finder (render-units.md) and small Jev loops with the agent setting each step's length (§2) | volume 2's units against its 25 crossings; errors per step against W15's |
| P6 | volume 2 again, on v3 | the run W16 could not finish |
| later | the phone; writing (continuity warnings while typing); headset builds | |

### 5.1 Decided, and what starting needs

- The console: our own app, not an editor (the user, 2026-11-10); made from v1's console; shipped as a DMG.
- The world: a Unity client behind a render protocol, launched by the console (§1.4; mine to decide, the user's
  direction 2026-11-10: "we build the world live from web to a proper unity").
- A miniloop's step length: the agent's (the user).
- The phone: set aside for now (the user).
- The app: Electron (the user, 2026-11-10: "Let's do electron then"); built as P2.
- To start P4: the Unity editor installed (a download, the user's Unity account), and which headset comes first when
  that time comes (Quest needs no paid seat; Vision Pro needs Unity Pro).
