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

Status: a plan to correct. Nothing here is built. §2 and §3 are my reading of the user's direction, marked where I chose.

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

1. **A novel language server** over a library: the book's chapters as documents; symbols, definitions, references,
   hover, outline, semantic kinds, inlay hints, problems, quick fixes. It speaks the standard protocol, so any editor
   and the web can use it. Read-only over what v2 already made, at first.
2. **The extension**: the explorer's views (the cast, the units, the strands, the album), the commands, the live
   preview (a web view holding the world page, tied to the cursor), the run-and-debug adapter over the director, the
   tasks, the side panel.
3. **The hosts**: the desktop editor; the same in a browser for the phone link; later the installable Mac app the user
   asked for (2026-10-29), as a branded build.

**Choice to make (§5.1):** build on the real editor (its open-source core, an extension plus the language server), or
build our own workbench that looks like it. I recommend the real one: the editor, the panels, the debugger's interface,
the settings layers and the chat panel exist already, and the language server is reusable either way. Its cost: the
interface is cramped on a phone, so the phone keeps a slim page for the world.

## 2. The runtime: smaller Jev loops (my reading, to correct)

What goes wrong today: an answer of Jev's becomes the input of the next, for a whole volume (516 calls in W15), and
nothing looks back. One wrong step stays: a fighter sent up an office tower at unit 14 was still there at unit 26; a
line credited to the wrong person walked the protagonist 40 floors up; 28 units of W15 played in the wrong district.

What Jev keeps doing, because it is fast and good at it: placing things on a 2D frame (a spot, a formation, a direction,
a box, a kind and a height in terrain), and structural extraction in the reading.

The change:

- **A Jev loop is one bounded job**: one stretch of one render unit, on one 2D frame, a handful of questions. Its inputs
  are the text and checked state, never Jev's own earlier answers unchecked.
- **Every stretch starts from the text again**: who is there and where the text puts them. An error cannot outlive its
  stretch.
- **Every answer is checked at once by code** (the laws as assertions): a failing answer is asked once more with the
  failure shown, then left to a rule.
- **The long view is the agent's**: after each stretch the agent sees what was placed and what the checks say, and
  corrects (a pin, a note to the next stretch) before the next stretch runs, not after the whole book.
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
| P1 | the language server, read-only, on volumes 1 and 2 as v2 left them: documents, symbols, definitions, references, hover, outline, problems | a test session answers citation questions through it; I read its answers against the text |
| P2 | the extension's shell: explorer views, the live preview tied to the cursor | a scene opened beside its world |
| P3 | the unit finder and small Jev loops inside one unit (volume 1's first quarter), stepped from the debugger | errors per stretch against W15's |
| P4 | the side panel, problems with quick fixes, the volume's steps as tasks | a test session does a look pass from the panel's commands |
| P5 | volume 2 again, on v3 | the run W16 could not finish |
| later | writing: continuity warnings while typing, completion that knows the world | |

### 5.1 To decide

1. **The workbench**: on the real editor (recommended), or our own.
2. **Smaller loops**: is §2 the meaning: a stretch of one unit as the largest thing Jev's answers chain over, with the
   agent between stretches?
3. **The first phase**: P1 (the language server over what exists) first, as proposed, or the runtime first.
