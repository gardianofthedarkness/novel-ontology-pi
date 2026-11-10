# The reader: a processed book read as published

> "I really like how our read result html and the read button highlights different characters and types of the
> sentences and all notes etc and how the full epub is loaded. Can you make that the same for processed files?"
> — the user, 2026-11-10

Built on v3 the same day. A book of the opened folder that has a reading opens in a **Read** view in the editor. That view
brings together what World · Live's Read panel did (tools/pi-review/sim-world.html: the EPUB as published, each sentence
coloured by its kind, the names marked) and what the reading's inspection page did (experiments/v2/inspect.html: under a
sentence, every record the reading made of it).

## 1. What it shows

- **The book as published.** The EPUB is loaded one spine document at a time as you scroll, with its headings,
  paragraphs and pictures (the cover, the colour plates, the illustrations). Scripts, styles, links and event attributes
  are taken out, and pictures are inlined as data URIs, so the page loads nothing from outside (src/v3/epub.ts). A text
  file, or the **Text** button, shows the extracted text in its paragraphs with chapter headings.
- **Each sentence the reading cites, found in it.** Sentences are matched on letters and digits only, because the
  extracted text and the EPUB differ in spaces and marks. A sentence not found is passed over when one of the next five is
  found close by. At the start of a document, any of the next forty may be found.
- **Sentence kinds**: spoken, action, environment, thought and fact are tinted with a bar at the left. Narration is left
  plain.
- **Marks**: names in their entity's colour (person, place, thing, concept); a description of someone dashed, with
  "→ whom it means" or "→ ?"; times boxed, with their role and gloss on hover.
- **Who says a line**: a chip before every spoken line with the speaker's name and, where the album has one, their
  portrait. A guess the reading did not settle is dashed and ends in "?".
- **Problems**: a credit the reading doubts (the language server's credit-not-backed) has a wavy underline with the
  message on hover. A sentence with notes on the director's page shows ✎ and their number.
- **The notes on a sentence** (tap it): chapter, scene and id; the sentence with its marks; its kind with how sure and
  the top three kinds as bars; who says or does it and to whom (how sure, a guess or settled, the words the role went
  through); the people, places and things it refers to and how; descriptions and whom they mean; times; what EM listed
  from it and its verdict; the cards that hold it; facts; problems; the user's notes. A name opens its record; "every
  line" opens its references; "Show in text" opens the book's document beside the reader with the sentence selected.
- **Kinds, Names, Speakers** switch each layer off and on; **Key** shows the legend; the chapter list jumps. The view
  remembers where it was.

## 2. How it is served

The page (apps/novel-vscode/media/reader.html) runs in a webview with a strict policy: scripts only by nonce, pictures
only as data. It asks the language server through the extension. Only these requests pass:

| Request | Answer |
| --- | --- |
| `novel/read` | the book for the reader: sentences with paragraph starts, kinds, marks, names, speakers, problems, chapters, scenes, who has a portrait, notes per sentence, how many EPUB documents |
| `novel/readDocument` | one EPUB spine document, cleaned, pictures inlined |
| `novel/readLine` | every record of one sentence |
| `novel/readPortrait` | one person's portrait as a data URI (loaded when their first line is shown) |
| `novel/record`, `novel/locate`, `novel/sentenceAt` | an entity's record link; where a sentence stands in the book's document; the sentence at a place in it (the extension's, for the page's links and for Read from the cursor) |

The marks are found as experiments/v2/marks.mjs found them (src/v3/reader.ts `sentenceMarks`): the chart's proper names
and EM's descriptions, longest first, each stretch of text once, with the reading's references for whom a description
means, and story time's words where no name stands. Everyday things are not marked.

Read opens from a book in the Books view (the inline book icon), from a chapter or scene (its context menu: Read, from
where it starts), or from the editor's title bar on a book's document (from the cursor).

## 3. Measured on the two books (library 16, read-only)

| | Volume 1 | Volume 2 |
| --- | --- | --- |
| EPUB documents | 44 | 50 |
| sentences in the reading | 5,202 | 5,480 |
| of them with letters (the rest are lines such as an ellipsis alone) | 5,039 | 5,299 |
| found in the EPUB | 5,025 (99.7%) | 5,292 (99.9%) |
| marks: person / place / thing / concept / time / description | 1,231 / 136 / 10 / 82 / 225 / 1,681 | 1,509 / 120 / 82 / 161 / 189 / 1,712 |
| descriptions with whom they mean | 1,166 | 1,161 |
| speaker chips | 1,438 | 1,579 |
| portraits | 6 | 4 |
| the book for the reader | 0.19 s, 0.6 MB | 0.23 s |
| one sentence's notes | 1 ms | 1 ms |

Volume 1's reading is of its stored source, which differs from the EPUB (124,716 characters against 129,322), and still
99.7% of its sentences are found. In the editor, volume 1 loaded to its end showed 5,025 sentences in 43 documents, 15
pictures, 3,382 tinted sentences, 3,337 marks, 1,376 speaker chips and 76 doubted credits.

## 4. Tests

- test/v3-reader.test.ts (4 tests): a processed book's kinds, marks, speakers, faces, notes and chapters; every record of
  a sentence; an EPUB read as published, with nothing that runs or loads kept; the server's reader requests and finding a
  sentence in the document and back. The fixture's reading now has kinds, a description, a time, a portrait and a note.
- apps/novel-vscode/test/run.js opens the reader in the installed editor: the first page, a spoken line's notes, the end
  of the book, and Read from a chapter. Passes on the synthetic shelf (5 runs in a row) and on the two real books.
- A fault found on the way: the page asked for more text before the book had arrived, kept the failed load, and then
  spun on empty loads. Loads now wait for the book and stop when one adds nothing.

## 5. Not yet

- A line that is only punctuation is not wrapped, so it is not coloured or tappable.
- The view does not yet follow the chapter you scroll into (the chapter list jumps but does not update).
- On a phone the reader runs in the editor on vscode.dev through a VS Code tunnel (the user's idea, 2026-11-10): `code
  tunnel` with its own `--cli-data-dir`, `--server-data-dir` and `--extensions-dir`, the last holding a link to
  apps/novel-vscode named `novel-ontology-pi.novel-workbench-<version>`, signed in by GitHub's device flow. Not yet
  checked through the tunnel by me: opening it needs the user's GitHub sign-in.
