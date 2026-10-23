# Orbital revolution explorer

The default playground view is orbital; **Orbital / switch to classic** retains
the existing chronology/cloud explorer. Layout groups and time paths are view
objects, not ontology edits. No model calls or new dependencies are required.

## Interaction

- Each local level has stationary spherical main nodes on straight chronological
  spines. Blue arrows show increasing narrative order. Explicit story tracks
  remain parallel; equal chronological keys align across tracks.
- Click a sphere to center it and inspect its stored information in the glass
  panel. Only its relationships with currently visible endpoints are drawn.
- Close zoom makes the enclosing sphere transparent and reveals one child
  timeline as a helix. Zoom alone never changes the current level.
- Double-click a revealed child, or press Shift+Enter on its label, to promote
  that preview level. Its spheres expand and uncoil to the local straight spine
  while the camera changes orientation. Single-click never enters a level.
- Back, Escape on the stage, or an extreme outward zoom gesture returns one
  level. Ordinary zoom-out only changes the camera and hides previews.
- Reduced motion disables ambient drift and animated geometry/camera changes.

## Data and scale

Scene ranges recursively condense to at most 20 scene/group slots. Unassigned
records have explicit auxiliary groups, so they are not silently discarded.
All chapter characters and locations remain in the surrounding nebula at every
depth, including proposed and held records. Direct and bounded two-hop weighted
connections position the nebula; they never distort main chronological anchors.
Parallel preview helices use equal radius, phase and constant track offsets.

Group/chapter labels use the most-connected scene with an existing summary,
preserving its source language. No summaries are generated for navigation.
Labels are collision-culled and truncated visually; the full stored information
remains available in the inspector. A frame action accounts for the toolbar,
transport and open inspector, including narrow screens.

The read-only snapshot projects one stable sphere per stored scene dialogue
turn, with speaker metadata and any matched event summary. These are derived
view records, not additional canonical events. Legacy dialogue-event summaries
are suppressed when per-turn records exist. The current ontology stores sentence
references, **not original utterance text**: the inspector explicitly says when
the transcript is unavailable rather than inventing it or exporting evidence
quotations. Legacy sample dialogue labels are not upgraded into verified turns.

## Validation

- Root suite: 146 tests pass on current main, including six orbital model/layout regressions.
- Optional Pi-review suite: 27 tests pass, including turn projection/privacy.
- Repository and task-local frontend production builds pass; Vite retains its
  existing large-chunk advisory.
- The private viewer's GET-only, token-path and source/payload blocking checks
  pass on loopback. No new public tunnel is needed for local verification.
- Hierarchy regression covers 20,000 scenes, complete member preservation,
  chapter nebula at every depth, explicit parallel tracks, preview bounds,
  exact morph endpoints, stored summaries and selected visible-only edges.

Manual browser checks include phone-size framing, click versus double-click,
transparent preview without navigation, uncoiling promotion and Back. The live
read-only volume snapshot is used separately from the repository's sample data.
