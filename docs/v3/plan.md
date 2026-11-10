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

Status: started 2026-11-10 with the workspace on the opened folder, the language server and the extension's shell (P1,
built: [workspace.md](workspace.md)), on the user's word: "I would say yes, but not in volume 1 or volume 2, but the same
open folder vscode has. It scans through every epub or text file in the opened folder, and when we use agent clis to
arrange them, they are separated into universes and sorted out, and expandable into Chapters and smaller parts just like
how vscode manage repos". Decided before: the real editor (§1.3), the agent sets a miniloop's step length (§2), a Unity
render client launched by the extension (§1.4, my decision at the user's "You can decide"; not started).

## 0. What v3 is

One workspace for reading a novel and, later, writing one: an editor's workbench where the book is the source, the
ontology is its symbols, the world is its live preview, the checks are its problems, and every AI harness is a panel
beside it. Everything v1 and v2 built becomes a feature or an extension of it. Under it, a runtime where Jev does small,
bounded jobs and an agent keeps the long view; a map made of render units (render-units.md); tests driven by a second
Claude Code session.

## 1. The workspace: an editor for novels

### 1.1 What we have, as the workbench's parts

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
  workbench shows how sure each one is and lets it be corrected in place. A correction is a change to canon with a
  reason, through the same gate as any other.
- "Compiling" is the reading, "running" is the director, "errors" are laws broken and questions held; all three cost
  money or time, so the workbench shows what is stale and what a rerun would cost before it runs.
- Reading first, writing later: for a writer the same checks become continuity warnings while typing (someone in two
  places at one time, a thing used before it is given).

### 1.3 The pieces

0. **The opened folder is the workspace** (the user, 2026-11-10; built, workspace.md): every EPUB and text file under
   the folder the editor has open is found by a scan; an agent arranges them with commands into universes, each with
   its books in order; a book opens into chapters, scenes and cards as a repository opens into folders and files. The
   files are never moved: the arrangement is a hidden state file, and a file is known by its content.
1. **A novel language server** over that folder: each book a document; symbols, definitions, references,
   hover, outline, semantic kinds, inlay hints, problems, quick fixes. It speaks the standard protocol, so any editor
   and the web can use it. Read-only over what v2 already made, at first.
2. **The extension**: the explorer's views (the cast, the units, the strands, the album), the commands, the live
   preview (a web view holding the world page, tied to the cursor), the run-and-debug adapter over the director, the
   tasks, the side panel.
3. **The hosts**: the desktop editor; the same in a browser for the phone link; later the installable Mac app the user
   asked for (2026-10-29), as a branded build.

**Decided (the user, 2026-11-10: "I agree"):** v3 is built on the real editor: an extension plus the language server.
Its interface is cramped on a phone, so the phone keeps a slim page for the world (§1.4).

### 1.4 The world's frontend: a native engine client (decided 2026-11-10)

> "I'm thinking about whether we should build a real vscode extension activatable unity based game engine frontend. The
> first reason is our browser is very easy to get stuck, two is we might want to integrate vr and ar versions in the
> future. You can decide." — the user

**Decision: yes, Unity, as a render client the extension launches; the world engine is not ported.**

- **One world server, several render clients.** The simulation stays where it is (TypeScript on Node: terrain, the
  director, the laws, structures and blasts) and is the only truth. It sends the world to clients over one versioned
  **render protocol**: a unit's ground, lots, shells, props, people and their moves, as a compact stream of changes.
- **The Unity client** builds everything from that stream in code (no hand-made scenes: the world is procedural), with
  the engine's instancing, culling and threads. The extension starts it as its own window beside the editor and ties it
  to the cursor (a line moves the world, a click in the world finds the line) over a local socket.
- **The slim web client stays**: today's three.js page, fed by the same protocol, for the phone link and for Jev's
  camera (its 2D maps and stills), until the Unity client can take those too.
- **VR and AR later, from the same client**: a headset build is another target of the Unity project, not another
  frontend.

Why this shape (checked 2026-11-10):

| Question | What I found |
| --- | --- |
| Why the browser gets stuck | Partly our data path, not only the browser: the world page does everything on one thread (no workers) and a full run's page is an 89 MB JSON file (W15). The protocol fixes that for every client; a native engine then adds threads, instancing and culling. |
| Can a native view be docked inside the editor? | No: an editor panel is a sandboxed web view and cannot host a native window. So the client is its own window, or a picture streamed into a panel. |
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

Render units: [render-units.md](render-units.md). In the workbench a unit is a node of the explorer and a tab of the
preview; a stretch is what the debugger steps over.

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
| P1 (built 2026-11-10) | the workspace on the opened folder, the language server, read-only (documents, symbols, definitions, references, hover, outline, speaker hints, problems), the `novel folder` commands, the extension's shell (workspace.md); the reader, a processed book read as published with its marks and notes (reader.md); one-click readings in the workspace (reading.md) | the extension run inside the editor on both books; a test session arranges a folder and answers citation questions, its answers read against the text |
| P2 | the unit finder (render-units.md) as a view of the workspace: a book's render units beside its chapters | volume 2's units, set against its 25 crossings |
| P3 | the render protocol for one render unit and the Unity client's proof (§1.4); the launched world tied to the cursor | volume 1's city drawn from the protocol, frames a second against the web page; a scene opened beside its world |
| P4 | small Jev loops, the agent setting each step's length (volume 1's first quarter), stepped from the debugger; a reading made in the workspace itself (`.novel/`), no library | errors per step against W15's |
| P5 | the side panel, problems with quick fixes (a correction is a change to canon with a reason), the volume's steps as tasks | a test session does a look pass from the panel's commands |
| P6 | volume 2 again, on v3 | the run W16 could not finish |
| later | writing: continuity warnings while typing, completion that knows the world; headset builds | |

### 5.1 Decided, and what starting needs

- The workbench: the real editor (the user).
- A miniloop's step length: the agent's (the user).
- The world's frontend: a Unity render client behind a render protocol, the web page kept slim (§1.4; mine to decide).
- The first build: the language server and the extension on the opened folder, before the engine client (the user,
  2026-11-10; my recommendation, since it needs no download and everything else hangs off it).
- To start P3: the user's go, the Unity editor installed (a download, the user's Unity account), and which headset comes
  first when that time comes (Quest needs no paid seat; Vision Pro needs Unity Pro).
