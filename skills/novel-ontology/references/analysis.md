# Completed analysis

A novel's analysis is complete when every faculty below is done for every
book, and the cross-book faculties are done for its universe.
`novel checklist` computes this from stored data (read-only) and prints each
item's status, counts and the exact next command.

## Dependency order

```
book:      source ─▶ blocks ─┬─▶ causality   (cross-scene, in this book)
           (album, optional) ├─▶ time-place ─┬─▶ place-tree
                             │               └─▶ strands     (who is in each scene; report for the story view)
                             └─▶ graph       (rebuilt after canon changes)

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
| causality | the sweep is not pending and no causal packet waits | `novel causality sweep <dir>` | `cs_causality_*`, after reading `causality.md` |
| time-place | every scene was processed (a period, or processed without one) | `novel timeplace run <dir> --propose` | `cs_timeplace_*` |
| place-tree | no unasked place pair remains | `novel timeplace tree <dir> --propose` | `cs_timeplace_place-tree_*` |
| strands | nothing is worth asking, or the latest asked report is newer than the casts and story time it read | `novel timeplace strands <dir> --ask` | — (a report the story view draws; no packet) |
| graph | `graph.lbug` is newer than the bundle | `novel graph build <dir>/ontology` | — |
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
- **Paid steps** (ingest, the sweeps, time-place runs, strands with `--ask`) spend model and Jev
  calls. Respect the job's limits and the user's budget. Report what each
  step spent.
- **When done**, report each item's status and counts. Separate verified,
  held and missing work; never present held or unprocessed facts as known.

## Not covered yet

- Characters are not joined across books (only places are, by the atlas).
- Story periods are not aligned across books: books follow reading order
  within a continuity.
- Spatial relations beyond containment (next to, on the way to).
