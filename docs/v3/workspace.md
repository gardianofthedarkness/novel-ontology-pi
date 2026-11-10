# The opened folder as a workspace of novels (built 2026-11-10)

> Set aside 2026-11-10: VS Code is no longer v3's host (plan.md §1.6). What this page describes outside the extension
> carries into the console app (plan.md §1.5).

> "I would say yes, but not in volume 1 or volume 2, but the same open folder vscode has. It scans through every epub or
> text file in the opened folder, and when we use agent clis to arrange them, they are separated into universes and
> sorted out, and expandable into Chapters and smaller parts just like how vscode manage repos" — the user, 2026-11-10,
> on building the language server first

Status: built and tested (P1 of plan.md). Read-only over readings that v2 made; a reading made inside the workspace
itself is P4.

## 1. The model

The folder the editor has open is the workspace, as a repository is the folder that holds its `.git`.

- **The scan** finds every EPUB and text file (`.epub`, `.txt`, `.md`) under the folder, skipping hidden folders. For
  each it keeps the title (an EPUB's own, else the file's name), the length of its text, its chapters, and a hash of its
  bytes. A file whose size and time are unchanged is not read again.
- **Nothing in the folder is moved or changed.** The arrangement is one hidden file, `.novel/workspace.json`, written
  only by the commands.
- **A file is known by its content**, not its path: a book that is renamed or moved keeps its place in its universe; a
  book whose text changed follows its path; a book that is gone is kept as missing while a universe holds it; the same
  bytes at two paths are one book with a copy.
- **A universe** is a world several books share. It has a name, a reason (`--why`) and its books in reading order. The
  files no universe holds are **unsorted**.
- **Arranging is the agent's**, with commands (§4, the novel-folder skill): it reads each file's title, chapter titles
  and first lines, decides which books share a world and in what order, and says why. The editor shows the result as
  it changes.
- **A reading** gives a book its symbols. Until v3 makes readings in the workspace, an existing one (a v2 library's
  novel folder and its reading's data) is linked to a book, read-only. The link is refused when the reading was made
  from another book: places of the reading's text are looked for in the file (24 of 24 found for the right book, 0 of
  24 for the wrong one, on volumes 1 and 2). When the reading's stored source is another extraction of the same book
  than the file gives (volume 1: 124,716 characters stored, 129,322 from the EPUB today), the book is shown as that
  stored source, because the reading's sentence ids cite it.

## 2. The tree

| Level | With a reading | Without |
| --- | --- | --- |
| universe | its books in order | the same |
| book | chapters | chapters |
| chapter | scenes (the reading's units) | the parts the text marks: a line that is only a number or a row of marks starts one |
| scene | cards that no other card holds (a dialogue, an action, a monologue), with who speaks or acts | |

## 3. Documents

| Document | Address |
| --- | --- |
| a text file that is a book as it stands | its own file |
| an EPUB, or a book shown as a reading's stored source | `novel:/book/<file id>/<title>.txt` (the whole book, one read-only document) |
| an entry's record: its definition | `novel:/entity/<file id>/<entity id>/<label>.md` |

## 4. The language server

`src/v3/server.ts`, started as `novel folder serve <folder>` or `node dist/src/v3/server.js <folder>`. It speaks the
Language Server Protocol over stdio, with the framing written in the file (no dependency), so any editor's client can
use it. It rereads the state when a command changes it under it.

| The editor asks | A novel answers |
| --- | --- |
| document symbols (the outline, breadcrumbs) | chapters, scenes, cards |
| folding ranges | chapters and scenes |
| hover | whoever is under the cursor: names, kind, how this line refers to them, the reading's confidence and the words it went through, counts in the book. On a line with no name under the cursor: whoever says or does it |
| go to definition | the entry's record: names, first appearance with its line, references by kind and by chapter, who they share scenes with, the universe's other books that have them |
| go to declaration | their first appearance in the text |
| find all references | every line that names, describes, quotes or addresses them, in every book of the universe that has a reading (the same entry in another book is the one sharing a name). The span is the name itself where it stands in the line, else the line |
| workspace symbols | people, places, things and concepts by name across the folder |
| inlay hints | who says each spoken line, with a question mark where the reading kept only a guess |
| diagnostics (problems) | `credit-not-backed`: a line credited to someone the scene never names and the scene before does not have (the credit check, docs/v2/strands.md §0.6) |
| `novel/tree`, `novel/book`, `novel/cast`, `novel/document`, `novel/scan`, `novel/problems` | the explorer's tree, a book's chapters down to cards, a book's entries, a virtual document's text, a scan, a document's problems |

A reference is a judgement, not a fact: each carries how it was reached (`named`, `described`, `speaks`, `acts`,
`addressed`, `mentioned`), the reading's confidence where it gave one, the wording it went through, and whether the
reading settled it or kept a guess.

## 5. The commands: `novel folder`

The same state and index, for an agent's command line (`src/cli/commands/v3/folderCommands.ts`,
`skills/novel-folder/SKILL.md`). None calls a model.

| Command | What it does |
| --- | --- |
| `scan <folder>` | finds the files; reports new, changed, moved, missing, unreadable |
| `show <folder> [--opening N]` | universes with their books in order, then the unsorted files; with `--opening`, each file's chapter titles and first characters, for sorting |
| `universe <folder> <name> [--why t] [--rename n] [--remove]` | a universe made, renamed or removed |
| `put <folder> <file> <universe> [--at N] [--title t]`, `take <folder> <file>` | a file into a universe at a place in its order, or back to unsorted |
| `link <folder> <file> <novel-dir> [--reading data.json]`, `unlink` | an existing reading linked to a book, read-only |
| `chapters <folder> <file> [--depth chapters\|parts\|cards]` | chapters, scenes or parts, cards |
| `cast <folder> <file> [--query t] [--category c]` | the book's entries by how often they are referred to |
| `who <folder> <file> <name or id>` | one entry's record |
| `refs <folder> <file> <name or id> [--how h] [--chapter N] [--scene N] [--guesses] [--via] [--universe] [--from N] [--limit N]` | the lines that refer to it (30 shown unless `--limit`), each with its text, chapter and its title, scene, how, confidence, wording |
| `line <folder> <file> <line id> [--around N]` | a line with the lines around it and who the reading says speaks it |
| `problems <folder> <file>` | the reading's doubtful credits |
| `serve <folder>` | the language server over stdio |

## 6. The extension

`apps/novel-vscode` (plain JavaScript, no dependency, no build step): it starts the server on the opened folder, scans
when the folder holds an EPUB or was scanned before, and registers the editor's providers on the server's answers.

- **Novels** in the activity bar: **Books** (universes, books in order, chapters, scenes, cards; unsorted files below;
  a click opens the book at that place) and **Cast** (the open book's people, places, things, concepts and unnamed
  people, by references; a click opens the record, a button finds every reference).
- It watches the state file and the folder's books: an agent's command in a terminal, or a file dropped in, shows in
  the tree without a reload.
- To try it: `code --extensionDevelopmentPath=<repository>/apps/novel-vscode <folder>` after `npm run build`.

The **Read** command opens a processed book as published, with the reading's marks and notes: see [reader.md](reader.md).

## 7. Measured on the two books (library 16, read-only)

| | Volume 1 | Volume 2 |
| --- | --- | --- |
| characters of text | 124,716 | 131,394 |
| chapters, scenes | 6, 286 | 7, 348 |
| lines (sentences), each checked to sit exactly at its offsets | 5,202 | 5,480 |
| named entries; unnamed people and crowds | 98; 378 | 201; 300 |
| references (an entry on a line) | 5,224 | 5,887 |
| of them narrowed to the name itself | 2,155 | 2,385 |
| spoken lines with a speaker; of them guesses | 1,438; 460 | 1,579; 470 |
| problem lines (credits not backed) | 75, from 23 credits | 0 (its reading already had the check) |

Loading both books and their readings takes 0.2 seconds the first time; a find-all-references across the universe
answers in 2 milliseconds after that.

## 8. Tests

| Test | What it covers | Result |
| --- | --- | --- |
| `test/v3-folder.test.ts` (5) | the scan; arranging and taking out; a moved, changed, missing and copied file; chapters and parts; linking by the same text, as another extraction, and the refusal of another book's reading | pass |
| `test/v3-server.test.ts` (5) | the commands' answers (who, references with how and how sure, across the universe, guesses, a line); a credit not backed as a problem; every request of §4 on a small book; the protocol over stdio with a command changing the state under the server | pass |
| `apps/novel-vscode/test/launch.mjs [folder]` | the extension inside the installed editor (1.104.3), asked through the editor's own provider commands and set against the server's direct answers: tree, a book opened at a chapter, outline, hover, definition, references, workspace symbols, hints, problems, the cast view | pass on the small shelf and on the two books |
| a second session (Sonnet 5.5, high effort) | a fresh agent with the skill arranges an unscanned folder, links the readings and answers citation questions, checking each against the text | §9 |

## 9. The second session's test

A separate session (Sonnet 5.5, high effort; 25 tool calls, about 45 commands, 3 minutes 19 seconds) was given the
skill, a guarded `novel` that allows only `folder` verbs, an unscanned folder (the two EPUBs under file names that say
nothing, and an unrelated English note), and the two readings without being told which book each belongs to. It did not
read the source code.

**What it did, checked against the folder and the text:**

| Task | Its result | Right? |
| --- | --- | --- |
| arrange the folder | one universe with volume 1 then volume 2, ordered by the volume numbers in the titles and covers (the file names were a.epub for volume 2 and b.epub for volume 1); the note left unsorted as another work | yes |
| link the readings | each to its book; volume 1 as another extraction (24 of 24 samples), volume 2 by the same text | yes |
| the most cited person of volume 1, and their speaking lines | char_000007, 1,462 lines, 859 credited as speaking (126 of them guesses) | yes, the three commands agree |
| the third most cited person: first appearance, credits through a wording | char_000033, first at b0003_s0119; all 6 of their lines reached through a wording read against the text | yes |
| the first ten problems read against the text | 6 real, 3 not real, 1 cannot tell | see below |
| the same person in volume 2 | char_000013, 1,293 lines; 2,755 across the universe | yes (1,462 + 1,293) |
| volume 2's chapters and longest chapter | 7 with the front matter; the longest holds 100 scenes | yes (the seven sum to 348) |

**Defects it found, fixed the same day:**

| Finding | Fix |
| --- | --- |
| a universe with a name in no Latin letters got the id `universe` | numbered ids (`u1`, `u2`) |
| a problem listed twice on one line | the offset between two sentences was given to the first: a line's end is now exclusive (`lineAt`), so each problem carries its own line |
| `chapter` counted from 1 in references but `chapter-0` in the chapter list, and a chapter's number did not match its title | every answer now carries `chapterTitle`; the chapter list carries the same `chapter` number |
| no way to ask for the lines reached through a wording; the default of 30 shown lines was not stated | `refs --via`; `from` and `more` in the answer; the skill states the default |
| `chapters --depth chapters` called the count of scenes `parts` | `inside` |
| the skill did not say what `sameText: false` means, how `cast` is ordered, that `--guesses` keeps only guesses, that `guess` is not a confidence threshold, or that `first` is the first naming | the skill says each; `who` adds `firstReference` when an earlier line refers to them |

**What it found in the reading itself** (v2's data, shown as it is; work for the small loops of P4):

- The credit check has false alarms on a title that really is the person's: 3 of the first 10 problems (a form of
  address for char_000001 that the scene bears out).
- It misses wrong credits where the scene names the person in passing: 5 of the 6 lines that credit char_000033 through
  the wording "enemy" are wrong (others are meant), and none is a problem.
- One settled speaking credit of char_000007 (b0001_s0284) reads as another speaker's line.

Still open from its report: a line of `settings: overrides` on stderr when a linked novel folder has stage settings
(harmless noise from the CLI's start); the scan counts an EPUB's chapters from the file while a book shown as its
reading's stored source can have one fewer (volume 1: 7 against 6).

## 10. Not yet

- Readings made in the workspace (`.novel/`), so a folder needs no library: P4.
- Semantic colours by a line's kind, lenses over a scene (its strand, its render unit, "show in the world"), quick
  fixes on problems (a correction is a change to canon with a reason), rename as a merge of two entries.
- The world beside the text (P3), the debugger over the director (P4), the side panel (P5).
- The same entry across books is matched by a shared name; a universe's own registry of who is who comes with the
  workspace's readings.
