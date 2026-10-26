# Playground views: two modes, three views

The viewer has two **modes** and the same three **views** in each:

| View | Orbital (3D) | Traditional (flat, no WebGL) |
| --- | --- | --- |
| **Narrative** — reading order | The orbit: chapter spheres on a string, scenes inside, entities around | Chapters → scenes → events and dialogue as lists |
| **Story time** — when it happens | Every scene of the book on one spiral in story order, with every stored causal link as a curved arrow | Story-time list |
| **Places** — where it happens | Space-time: the schematic map on the floor, scenes floating above their place and rising in story order, a story-time window choosing what floats | Schematic map with a story-time slider |

- The switch reads `Orbital | Traditional` and `Narrative | Story time |
  Places`. Deep links: `?mode=traditional` and `?view=story` or
  `?view=places` (the defaults, Orbital and Narrative, need no parameter).
- Library and series overviews keep their cross-volume (universe) causal
  arrows; book-level causal arrows live in Story time.
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

- **Story time**: **every scene of the book on one spiral**, in estimated story
  order. Each scene sits in a clear bubble, labelled with its period. Inside
  the bubble are the events and dialogue that stored causes join.
  - **Causal links:** every stored CAUSES link is a curved arrow. Links inside
    one scene stay inside its bubble; links between scenes arc out past the
    spiral.
  - **Routing:** arcs bend outward from the spiral's axis. Arcs whose story
    spans overlap take different lanes (interval colouring), so no two arcs
    collide.
  - **Flashbacks:** an amber thread runs from each flashback scene to the
    scene it is told after.
  - **Entering:** entering a scene shows all of its records.
  - **Causal arrows appear only here.** The Narrative views no longer draw
    them; the inspector still lists causes and effects.
  - **Hand-off to Places:** the view keeps track of which stretch of the
    spiral sits at its centre. Switching to Places then shows just those
    scenes ("From Story time: N scenes · Show all").
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
  - **Levels**: Scenes, Events and Dialogue can be shown together. With
    Scenes on, each scene is a clear bubble around its events and dialogue;
    with Scenes off, the records float where their scene would be, drawn
    larger.
  - Scenes that name no place stay off the map; carried places are named as
    carried in each scene's summary.

The retired classic WebGL card view is gone; its camera framing helpers live
on in `components/graphCamera.ts` for the orbit.
