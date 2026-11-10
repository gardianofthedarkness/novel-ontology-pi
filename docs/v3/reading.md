# One-click readings

> Set aside 2026-11-10: VS Code is no longer v3's host (plan.md §1.6). What this page describes outside the extension
> carries into the console app (plan.md §1.5).

> "I need to be able to browse any novels on the mac. Not a copy of your environment, but a true functionality that opens
> up a path. When I enter the work model api and jev api, the reading phase work for a book is automatically run by one
> click. You don't get involved, no agent is involved." — the user, 2026-11-10

Built on v3 the same day (src/v3/reading.ts).

## 1. In the editor

1. Open any folder on the Mac (File > Open Folder, in the editor or on vscode.dev through the tunnel). Every EPUB and
   text file under it is found (workspace.md).
2. **Enter API Keys** (the key button on the Books view, or the command): Jev's key and the work model's key. They are
   kept in the Mac's secure store, `~/.config/novel-ontology/secrets.json` (folder 700, file 600): Jev's under `typesafe`
   (where `novel jev login` keeps it), the work model's under `work-llm`. They are never in the editor's settings, never
   shown again, and nothing answers a key's value; the editor only learns whether each is set.
3. The **play button** beside a book that has no reading runs it. The book's icon spins and a notification follows its
   steps with the estimate (about $0.35 for a 125,000-character volume) and a Cancel button. When it ends, **Read** opens
   it in the reader. A book with a reading can be read again from its menu.

No agent is asked anything. A missing key opens the key entry first.

## 2. What runs

The reading runs on the Mac in a process of its own (detached), so it goes on when the editor closes, a phone
disconnects or the language server restarts; an editor that opens later follows it again.

| Step | What it does |
| --- | --- |
| stored source | the book's text as the workspace shows it (an EPUB's text, or the text file), stored in `.novel/books/<file id>/novel/source/` with `ontology/source.json` (block size 24,000): the text the reading's sentence ids cite |
| the reading | experiments/v2/read.mjs `read()`, as volumes 1 and 2 were read: Jev `jev-1.14.0` and the work model `deepseek-chat` (the environment may set others), with the EPUB for its introduction and album; into `.novel/books/<file id>/reading/` (its `v2/` data and its `cache/`) |
| link | the reading linked to the book; a book in no universe is put in one named after it (why: "made when the book was read") to arrange later |

`.novel/books/<file id>/reading.json` says where it is (running, done, failed or stopped; the steps done with their
requests and time; the requests that went to the models, not the cache), and `reading.log` keeps its output. One reading
runs at a time. A stopped or failed reading started again pays only for what it had not asked: every answer is cached.
A reading whose process died without saying is shown as failed.

The scan skips `.novel`, so the stored text is never taken for a book.

## 3. From a terminal

```
novel folder keys <folder>                      # whether each key is set, and where from
printf %s "$KEY" | novel folder keys <folder> --jev     # a key from standard input, never the command line
novel folder read <folder> <file>               # starts the reading and returns
novel folder reading <folder> <file> [--stop]   # where it stands
```

The language server answers the same: `novel/keys`, `novel/setKey`, `novel/startReading`, `novel/reading`,
`novel/stopReading`; the Books tree carries each book's reading state.

## 4. Tests

- test/v3-reading.test.ts (4 tests): the keys kept and only their state answered (file mode 600); both keys needed; a
  whole reading in its own process with stand-in models (test/v3-standin.ts: the mock decision model for Jev, names
  listed from a roster): the stored source, the steps, the link, a universe made, the workspace and the reader taking it;
  one reading at a time, stopping, and a dead process seen as failed.
- A stand-in reading of a whole volume's EPUB in a fresh folder through `novel folder read` (§5).
- Paid readings are the user's: run by the button. None was run in testing.

## 5. Measured

A stand-in reading of volume 2's EPUB in a fresh folder (`novel folder read --stand-in dist/test/v3-standin.js`):

| | |
| --- | --- |
| time | 2.3 s (the stand-in answers at once; a paid reading of a volume took about 2 minutes) |
| steps kept | 12, from sentence kinds to the storyboard |
| questions | 7,451 to the stand-in Jev, none to the work model (names from the roster) |
| result | linked to the book, which was put in a universe of its own; the EPUB's album and front matter read |
| reader | 5,292 of 5,299 lettered sentences found in the EPUB |

## 6. Not yet

- Faces: the album's portraits need the cropper's Python (`NOVEL_PORTRAIT_PYTHON`); without it a reading keeps the
  book's pictures but binds no faces.
- The models are fixed to the ones volumes 1 and 2 were read with unless the environment says otherwise; there is no
  setting for them in the editor.
- A universe made for a book is named after its title; its id is a slug of that title.
