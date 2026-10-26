# Playground views: two modes, three views

The viewer has two **modes** and the same three **views** in each:

| View | Orbital (3D) | Traditional (flat, no WebGL) |
| --- | --- | --- |
| **Narrative** — reading order | The orbit: chapter spheres on a string, scenes inside, entities around | Chapters → scenes → events and dialogue as lists |
| **Story time** — when it happens | Period spheres on a string in story order; flashbacks on a raised track with an amber thread to when they were told | Story-time list |
| **Places** — where it happens | Space-time: the schematic map on the floor, scenes floating above their place and rising in story order, a story-time window choosing what floats | Schematic map with a story-time slider |

- The switch reads `Orbital | Traditional` and `Narrative | Story time |
  Places`. Deep links: `?mode=traditional` and `?view=story` or
  `?view=places` (the defaults, Orbital and Narrative, need no parameter).
- Both modes share the inspector, record stepping, book choice and live
  updates. A record open in the inspector stays open when the mode changes.
- **Following Pi** works in both Narrative views: the orbit flies to the
  work; the flat list opens the chapter and scene Pi touched and marks them.
- The Traditional Narrative list shows each chapter's gist (its most
  connected scene summary), counts, cast, and live and review states.
  Each scene carries its story time and place when the time-place faculty
  has run. Proposals and held records appear in place with their state.
  Records no scene covers yet are listed under the chapter.

## Orbital Story time and Places

Both regroup the book's world (view only) so the orbit draws them with its
usual spheres, motion, inspector and entering:

- **Story time**: one sphere per story period, in estimated story order on one
  string; flashbacks sit on a raised track, and an amber thread runs down to
  the period each was told during. Entering a period shows its scenes in
  reading order, then their records.
- **Places**: the schematic map (not geography) lies flat on the floor, one
  disc per named place, with faint lines for moves between places. Each placed
  scene floats above its place, and higher means later in story time. A thread
  runs from each scene down to the map, and the story-order string runs
  through the air.
  - The **story-time window** on the side chooses which periods' scenes float
    above the map (All, None, Present only, or any set). Places with nothing
    in the window dim.
  - Picking a character draws their path through their scenes in story order:
    an orange tube with a bead travelling it, framed as a whole.
  - Entering a scene shows its events and dialogue.
  - Scenes that name no place stay off the map; carried places are named as
    carried in each scene's summary.

The retired classic WebGL card view is gone; its camera framing helpers live
on in `components/graphCamera.ts` for the orbit.
