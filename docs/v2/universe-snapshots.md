# A universe's library and its snapshots

The user, 2026-11-05: *"we need to keep a snapshot per book per universe, and rerunning a previous volume returns to the
snapshot before that volume to recover clean status. We need a fixed ontology path system that manage snapshots and
understandable data path"*; *"do it the v1 style, and every run result snapshot should be something easily transferable to
another user of this cli to step up their universe"*.

**Why:** W11 (2026-11-05) ran on a library copied from W10's after W10 ran, and the director starts its people from the last
run's smoothing when there is one. W11 was a second pass on W10 without anyone asking for it. Rehearsing units 1–84 with only
that difference (stand-in Jev): earshot breaks 2 → 14, held place facts 2 → 12, rush faults left 8 → 15. W10's own code
started on that smoothing was as bad (layout faults left 9 → 18, rush faults 4 → 14).

## The v1 way

v1 keeps plain files as the source of truth and rebuilds the graph from them (`graph.lbug`, `buildGraphFromBundle`); its
library keeps each catalog revision as a checkpoint named by content (`history/<generation>-<sha>.json`). Ladybug itself
has export and import of a whole database (CSV or Parquet), not snapshots, and v1 does not use them.

So here: a **snapshot is a readable record** of what each tracked file held (by sha256) and which runs it holds; each
content is stored once in `snapshots/objects/`. A run's own files are written once under its id and never change, so a
snapshot names them and does not copy them. A **restore** writes each tracked file back from its object, takes away the
tracked files the snapshot did not have, and rebuilds each changed book's graph; what it replaces is snapshotted first
(a `guard`), so nothing is lost.

## The paths

Every path has one name (`libraryPaths` in [src/ground/workspace/universe.ts](../../src/ground/workspace/universe.ts);
`novel universe paths <library> --book vol-1` prints them):

```
<library>/                              one universe
  universe/                             what its books share: pools.json, terrain.json, maps/, abilities.json, props.json
  vol-<n>/
    novel/                              the book's workspace
      source/                           its text: never snapshotted, never exported
      ontology/*.jsonl                  the canon, an append log; graph.lbug is rebuilt from it
      stage/world/                      script, strands, spawn, pins, speakers, canon.jsonl (the canon's write log), pool
      stage/world/log|ledger|smoothed/<run>   a run's own files
      stage/director/                   run.json (the last run's record), runs/<run>/, cache/ (Jev's answers)
      stage/simulation/                 index.json (the runs and the accepted one), runs/director/<run>.page.json
    reading/                            the book's v2 reading and pre-film notes (data.json, in-use.json, rides.json, ...)
  snapshots/
    index.json                          every snapshot, oldest first
    objects/<ab>/<sha256>               each tracked content, once
    <book>/<seq>-<kind>[-<run>].json    one snapshot
```

What a snapshot keeps (`classify`):

| Kind | What | Kept how |
| --- | --- | --- |
| state | everything else under `universe/`, `vol-<n>/novel/`, `vol-<n>/reading/` | by content, restored |
| a run's files | `stage/world/{log,ledger,smoothed}/<run>`, `stage/director/runs/<run>/`, `stage/simulation/runs/director/<run>.page.json` | named, never copied or removed |
| derived | `graph.lbug`, `cache*/`, `stage/director/{shots,page}/`, `stage/simulation/live*` | not kept: rebuilt or reshown |
| text | `vol-<n>/novel/source/` | not kept: checked by `ontology/source.json`'s sha256 |

## Snapshot kinds

- `before`: where a book's runs start. Taken before its first run; a new one is taken on purpose when an edit should
  carry into reruns (a place float from a run's tracks, new ability sheets): `novel universe snapshot <library> --book
  vol-1 --before --why "..."`, or the director's `--keep-edits`.
- `after`: what a run left, with its `before` as parent. The unit of sharing.
- `guard`: what a restore replaced.
- `manual`, `imported`: by hand; from another user's bundle.

## The director

`node world-engine/director/director.mjs <library>/vol-<n>/novel --from ... --to ...` (the reading defaults to
`vol-<n>/reading/data.json`):

1. No `before` yet: one is taken.
2. A `before` exists: the library is restored to it, so the run starts clean. If the library is not at a known snapshot
   (an unfinished run, or edits by hand), the director stops and lists what changed: `--keep-edits` makes it the new
   `before`, `--discard-edits` starts from the clean one (the guard keeps the edits), `--from-last` plays on from it.
3. `--from-last`: a second pass on the last run (the smoothing back-propagated), never the default.
4. After the run: an `after` snapshot, named for the run.

`--no-snapshots` turns all of this off (rehearsals call `direct()` on copies and never take snapshots).

## Sharing a run's result

```
novel universe export <library> vol-1/0004-after-d20261105074708 w11.tgz [--pages]
novel universe import w11.tgz <their-library> --source vol-1=<their copy of the book>
```

The bundle (`bundle.json`, `objects/`, `runs/`) holds the `after` and its `before` (so the importer can rerun the book),
every content they name, and the files of the runs the `after` holds; run pages (~135 MB each) only with `--pages`. It never
holds the books' text, the caches, the pictures or the host's files (links, tokens). The importer brings their own copy of
each book, checked against the sha256 the book names; every path in the bundle must stay inside a library, and every
content is checked against its hash. W11's result: 4.7 MB packed (49 MB unpacked, without pages); imported, the new library
stands at exactly W11's files.

## A library made before snapshots

`novel universe adopt <library>` gives it its first snapshots: the library as found (a guard); each book's canon with its
runs taken out by the canon's own log (`undoCanon`, newest run first) and the runs' outputs set aside, as its `before`;
the library put back as found, recorded as the `after` of its last run. Library 15 (`~/claude-world-first/v2-host-state-15`,
library 14 with the reading moved in) was adopted so: its `before` has none of W10's or W11's writes (no state changes,
no timelines, every scene as the reading made it).

Adopting found a bug in `undoCanon`: undoing two runs that wrote the same records (W10, then W11) left the second run's
rows (535 state changes). Each run's rows now go whatever was there before them (canon.test.mjs covers it).
