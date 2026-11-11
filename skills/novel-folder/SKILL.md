---
name: novel-folder
description: Arrange an opened folder of novels (EPUB and text files) into universes and reading order, and answer who someone is and where they are cited, with the `novel folder` commands. Use when asked to sort a folder of books, to set up a novel workspace, or to look up a character, place or thing and the lines that refer to it.
---

# A folder of novels as a workspace

A folder of books the user added to Novel Console is a workspace. Its books stay where they are: you never move, rename
or edit the user's files. The arrangement is kept in a hidden `.novel/workspace.json` that only the `novel folder`
commands write. Novel Console shows the same arrangement and updates when a command changes it, so the user can watch
what you do there.

## 0. The command

`novel` comes with Novel Console: its "Set up your agent" button installs it as `~/.local/bin/novel`. If `novel` is not
found, run `~/.local/bin/novel` instead. If that is missing too, tell the user to open Novel Console and press "Set up your
agent" in its chat panel (⌘I); do not look for or install another `novel`.

Every command is `novel folder <verb> <folder> ...` and prints JSON (add `--pretty` to read it). A file is named by its
path, the end of its path, or its id (`f_...`). None of these commands calls a model or costs anything, except
`novel folder read` (section 4). `novel folder scan <folder>` lists what the folder holds; run it first on a folder
Novel Console has not opened yet.

## 1. Arrange the folder

The arrangement has two levels, as v1's library had: a **universe** is one fictional world; inside it, each book belongs
to a **series**, and the universe keeps its books in reading order. Different series of one world share a universe (a
main series and its side series); one series stays one series whatever its titles say (a renamed volume, another
edition, another language).

1. `novel folder basics <folder>` lists every book with its basic layer, read with no model: title, author, language,
   the series and volume its title gives, its chapters and lines, the names found in it by pattern, how many copies the
   folder holds, and where it is placed now. Start here.
2. `novel folder show <folder> --opening 400` adds each book's chapter titles and first 400 characters. Read the
   openings of the books you are unsure of (a synopsis or a cast list in the front matter says a lot).
3. Decide, from that evidence: which books are one series (the series title, volume numbers, the same people), and which
   series share a world (the same author's shared setting, the same people or places, a front matter that says so).
   A similar title alone is weak evidence; a different title alone is not evidence against. Two editions of one series
   in two languages are one series.
4. Make each universe, saying why: `novel folder universe <folder> "<name>" --why "<what the books share>"`. Name it after
   the world (the franchise), not one series.
5. Put each book in, in reading order, with its series:
   `novel folder put <folder> <file> <universe> --series "<series name>" [--at N]`. Order by volume within a series; put
   a series' books together, the main series first.
6. Leave a file unsorted when it is not a novel or when you cannot tell where it belongs, and say so in your report.
   `novel folder take <folder> <file>` takes a book back out; `novel folder universe <folder> <name> --remove` removes a
   universe (its books go back to unsorted); `--rename "<new name>"` renames one.
7. `novel folder show <folder>` again, and report: each universe with its series and books in order, and every file you
   left unsorted with the reason.

## 2. Link a reading that already exists

A book's cast, references and problems come from a reading. Where one exists already (a v2 library's novel folder):

`novel folder link <folder> <file> <novel-dir> [--reading <data.json>]`

The command refuses a reading made from another book (it looks for the reading's text in the file). Do not use
`--force` to get past that: find the right book instead. Linking only reads the library; nothing is written to it.

A link that succeeds says which text the book is shown as. `sameText: true`: the file's own text. `sameText: false`
with "another extraction of this book": the reading was made from an older extraction of the same book, so the book is
shown as the reading's stored text. Both are success; chapter counts can differ slightly between the two texts.

## 3. Look things up

| Question | Command |
| --- | --- |
| What is in this book? | `novel folder chapters <folder> <file> [--depth chapters\|parts\|cards]` |
| Who and what is in it? | `novel folder cast <folder> <file> [--query <words>] [--category person\|place\|thing\|concept] [--limit N]` |
| Who is this? | `novel folder who <folder> <file> <name or id>` (the record: names, first appearance, counts, other books) |
| Where are they cited? | `novel folder refs <folder> <file> <name or id> [--how named\|described\|speaks\|acts\|addressed\|mentioned] [--chapter N] [--scene N] [--guesses] [--via] [--universe] [--from N] [--limit N]` |
| What does the text say there? | `novel folder line <folder> <file> <line id> [--around N]` |
| What does the reading doubt? | `novel folder problems <folder> <file> [--limit N]` |

Numbers and names in the output:

- `chapter` counts from 1 in the order `novel folder chapters` lists them, front matter included when the text has
  some; `chapterTitle` beside it is the chapter's own title, so quote the title, not the number. `--chapter N` filters
  by the same number. `scene` counts from 1 through the whole book.
- `chapters --depth chapters` gives each chapter with `inside`: how many scenes it holds (with a reading) or marked
  parts (without). `--depth parts` lists those scenes or parts; `--depth cards` goes down to cards.
- `cast` is ordered by the number of lines that refer to each entry, most first, and counts unnamed people and crowds
  too (`--category person` leaves places, things and concepts out).
- `refs` shows 30 lines unless `--limit` says more; `references` is the full count, `more` what is left after the ones
  shown, `--from N` starts further in. `--guesses` keeps only the guesses, `--via` only the lines reached through a
  wording, `--how` one way of referring.
- `who` gives `first`: where they are first named. `firstReference` appears when an earlier line already refers to
  them (by a description, or as the one spoken to).

Reading a reference: `how` says in what way the line refers to them (`named`: their name is in the line; `speaks`,
`acts`: the reading credits the line to them; `addressed`: they are spoken to; `described`: by a description). `via` is
the wording the reading went through ("the girl"); it comes with any of these, not only with speaking. `confidence` is
the model's own score for that answer. `guess: true` marks an answer the reading left unassigned and kept only as its
best candidate; it is not a confidence threshold, and a settled credit can carry a low score. A reference is the
reading's judgement, not a fact: before you repeat one that matters, read the line and the lines around it with
`novel folder line` (each line there carries its scene number) and say whether the text bears it out.

A problem `credit-not-backed` is a line credited to someone the scene never names and the scene before does not have:
often a description read as the wrong person, sometimes a title that really is theirs. It does not catch every wrong
credit (a person the scene names in passing can still be credited wrongly). Check each against the text the same way.

## 4. Readings made in the folder

A book with no reading can be read on this Mac with `novel folder read <folder> <file>`: it starts the reading in a
process of its own and returns at once; `novel folder reading <folder> <file>` says where it is (`--stop` stops it). It
is paid (about $0.35 a volume) and needs both model keys (`novel folder keys <folder>` says whether they are set). The
user runs readings from Novel Console's ▶ button; run one only when the user asks you to, and say what it will cost
first.
