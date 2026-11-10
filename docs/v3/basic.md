# The basic layer, and testing as a user

> "From now on, since we have a proper DMG now, testing data and real novels are outside your work tree. Everything
> simulates a user: user has some novels under documents, the app opens documents, scan and see all the epubs or
> imported specific TXT or docx later. Then, a basic layer no model call scans the basic layer of that real folder."
> — the user, 2026-11-10

Built on v3 the same day (src/v3/basic.ts; Novel Console 0.6.0).

## 1. What a folder the console opens picks up

- **EPUBs by themselves.** A folder added in the console (the dialog opens in Documents) is scanned for EPUBs only, in it
  and in every folder inside it (dot folders, node_modules, dist and build skipped). A folder scanned once keeps its rule
  (`found` in .novel/workspace.json).
- **Text files one by one.** A .txt or .md file comes in when it is imported (the folder's ⋯ menu, Import a text file…;
  `novel/import`); from then on scans keep it. DOCX: later.
- A file is known by its bytes: copies of a book anywhere in the folder are listed as copies of one book.
- A folder in the library that has never been scanned (or whose .novel is gone) is scanned when the console loads it.

## 2. The basic layer: no model

For every book, once (kept in `.novel/books/<file id>/basic.json`, keyed by the book's bytes):

| Field | How |
| --- | --- |
| title, author, language | the EPUB's package (dc:title, dc:creator, dc:language); a text file's name |
| series, volume | the title with its volume taken out: the Chinese "di N juan" form, "(N)", "Vol. N", a number at the end or before a space; Chinese numerals read |
| chapters, paragraphs, lines | the reading's own block and sentence cutters (cutBlocks, sectionBlock) |
| spoken | lines that hold quote marks (corner brackets, curly quotes) |
| pictures | the EPUB's image items |
| names | spans that look like names by fixed patterns, three times or more: Chinese honorifics and speech verbs (as the reading's name detector nominates them), Japanese honorifics and speech; at most 24 |

It runs a few books at a time (`novel/basicStep`), so the console keeps answering; the status bar says where it is.

**Series found.** Among the books not yet arranged, books whose titles (the volume taken out) share most of their
character pairs are one series (the share of the shorter title's pairs the longer one holds, 0.7 or more). The Library
offers each series of two or more books with **Arrange**: a universe named after it, its books in volume order
(`novel/series`, `novel/arrange`). An agent can still arrange or correct with the `novel folder` commands.

## 3. Testing as a user

Test books live outside the worktree, where a user's would. `~/Documents/Novels` holds the user's own 29 EPUBs (APFS
clones of the books uploaded to the Pi host: three series, Chinese and Japanese editions, one book twice). The app is
pointed at `~/Documents` as a whole, as a user would add it, which also holds 87 copies of those books inside an old
project folder, the user's own DOCX files and thousands of text and Markdown files in code projects; none of those is
taken for a book.

`apps/novel-console/test/drive.mjs ~/Documents --app <the DMG's app> [--arrange]` runs the app in a profile of its own
and works its window (`--arrange` presses the first Arrange, which changes the folder's arrangement as a user would).

## 4. Measured (Novel Console 0.6.0 from its DMG, ~/Documents, first run)

| | |
| --- | --- |
| folders walked | 11,770 (1.4 s) |
| books found | 29, plus 87 copies of them; no text or Markdown file picked up |
| scan | 3.7 s |
| basic layer, all 29 books | 1.4 s, none failed; a volume read for 28, names by pattern for all 29 |
| series found | 4: the El-Melloi II case files (9, with volume 6 twice and one untitled by volume), Fate/strange Fake (9), the Chinese edition of one series (8), its Japanese edition (3) |
| Arrange | the first series a universe of 9 books in volume order |

## 5. Not yet

- DOCX import.
- Two editions of one series in two languages are two series by their titles; an agent (or the user) joins them.
- A book whose title gives no volume goes last in its series.
