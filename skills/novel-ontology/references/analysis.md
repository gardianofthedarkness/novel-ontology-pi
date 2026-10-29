# Completed analysis

A novel's analysis is complete when every faculty below is done for every
book, and the cross-book faculties are done for its universe.
`novel checklist` computes this from stored data (read-only) and prints each
item's status, counts and the exact next command.

## Dependency order

```
book:      source ─▶ blocks ─┬─▶ identities  (the universe's shared character list: universal EM)
           (album, optional) ├─▶ time-place ─┬─▶ calendar    (the universe's one clock: every book's story time on it)
                             │               ├─▶ place-tree
                             │               └─▶ strands     (who is in each scene) ─▶ causality (cross-scene, in this book,
                             │                                                              ordered by story time and strands)
                             └─▶ graph       (rebuilt after canon changes)

read mode (the checklist's `stage` section, on request only; never part of `complete` or `next`):
           time-place + place-tree ─▶ architecture (each place's building) ─┐
           blocks (whole file) + strands ────────────────────────────────────┴─▶ movement ─▶ … every analysis item done ─▶ stage (animation prep, last)

universe:  organization ─▶ books (each complete) ─┬─▶ atlas              (same place / inside, across books)
                                                  └─▶ universe causality (causes across books)
```

An item is **blocked** while something it depends on is not done. Work on
the earliest unblocked item; for a library, finish books in reading order.

## What "done" means, faculty by faculty

| Item | Done when | Produce | Review |
|---|---|---|---|
| source | the original text is stored and bound | `novel ingest` (or the host's prepared input) | — |
| album | optional: EPUB pictures imported before ingestion | `novel album import` (only when the job allows) | — |
| blocks | every block of the source is applied | `novel ingest <dir> <input>` (continues at the first unapplied block) | `novel review … --scope book` per `cs_bNNNN` |
| identities | every character is in the universe's shared list and no `um_` packet waits | runs on every apply; `novel em sweep <dir>` re-checks the whole book | `um_*` (`--scope universe --universe <id>` at the library; `--scope book` when standalone) |
| causality | after story time and strands: the sweep is not pending and no causal packet waits | `novel causality sweep <dir>` | `cs_causality_*`, after reading `causality.md` |
| time-place | every scene was processed (a period, or processed without one) | `novel timeplace run <dir> --propose` | `cs_timeplace_*` |
| calendar | the universe calendar is current and no `ut_` year question waits | rebuilt on every story-time apply; `novel calendar build <dir>` | `ut_*` (`--scope universe --universe <id>`) |
| place-tree | no unasked place pair remains | `novel timeplace tree <dir> --propose` | `cs_timeplace_place-tree_*` |
| strands | nothing is worth asking, or the latest asked report is newer than the casts and story time it read | `novel timeplace strands <dir> --ask` | — (a report the story view draws; no packet) |
| graph | `graph.lbug` is newer than the bundle | `novel graph build <dir>/ontology` | — |
| architecture (`stage` section) | every reviewed place a scene happens in has a building picked, from its current name and path | `novel stage architecture <dir>` (one Jev picture choice per place), only when animation is asked for | — (a report read mode draws; no packet) |
| movement (`stage` section) | every scene in a building was asked who moves where, from its present cast and recorded events | `novel stage movement <dir> --max-calls N` (N: `maxRequests` from `novel stage show`; answers are kept, so run it again to continue), only when animation is asked for | — (a report; no packet) |
| stage (`stage` section) | the animation prep matches both reports; only once every analysis item is done | `novel stage prep <dir>` (no model calls) | — |
| organization | no unresolved library assignment | novel-library skill | `--scope library` |
| atlas | no unasked cross-book place pair remains | `novel atlas sweep <library> <universe> --propose` | `ua_*` with `--scope universe` |
| universe causality | no candidate pair remains | `novel causality universe candidates …` | `uc_*` with `--scope universe` |

## Rules

- **Review before producing more.** An item in `review` has a packet waiting.
  Review it through the shared gate (show every page, read the evidence,
  decide, apply) before running more of that faculty.
- **Held is an answer.** Facts held at review stay outside canon. Their
  scenes and pairs are remembered as processed or asked, and are not
  re-asked; that is not a gap. Re-asking needs new evidence, or `--force`
  on an explicit request.
- **Atlas exception: holds are revisable when their places change.** Places
  are paths that grow (a book can add a parent or an intermediate level), so
  a held or already-asked cross-book pair is reopened when either of its
  places changes (names, kind, parent, universe cluster) — and only then,
  not on every sweep.
- **Re-run the checklist after each step.** If a step leaves its item
  unchanged, stop and report it as stuck with the reason. Do not loop.
- **Paid steps** (ingest, the sweeps, time-place runs, strands with `--ask`, and, only when animation is asked for, stage architecture and movement) spend model and Jev
  calls. Respect the job's limits and the user's budget. Report what each
  step spent.
- **When done**, report each item's status and counts. Separate verified,
  held and missing work; never present held or unprocessed facts as known.

## Not covered yet

- Characters are not joined across books (only places are, by the atlas).
- Story periods are not aligned across books: books follow reading order
  within a continuity.
- Spatial relations beyond containment (next to, on the way to).
