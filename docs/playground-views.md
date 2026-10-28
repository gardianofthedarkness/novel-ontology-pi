# Playground views: two modes, three views

The viewer has two **modes** and the same three **views** in each:

| View | 3D (orbital) | Flat (no WebGL) |
| --- | --- | --- |
| **Narrative** — reading order | The orbit: chapter spheres on a string, scenes inside, entities around | Chapters → scenes → events and dialogue as lists |
| **Story time** — when it happens | Every scene of the book on one spiral in story order, with every stored causal link as a curved arrow | Story-time list |
| **Places** — where it happens | Space-time: the schematic map on the floor, scenes floating above their place and rising in story order, a story-time window choosing what floats | Schematic map with a story-time slider |

- The switch at the top centre reads `3D | Flat` and `Narrative | Story time |
  Places`. Deep links: `?mode=traditional` and `?view=story` or
  `?view=places` (the defaults, 3D and Narrative, need no parameter).
- One navigation row: back (Esc), where you are (click a crumb to go up),
  and the book picker. Round view controls at the right edge: zoom, reset
  view, connections, and `?` (how to move, the legend, counts, motion).
- The processing dock (pipeline, Pi review, record bar) folds to one status
  line at the bottom left; the choice is remembered per browser.
- Library and series overviews keep their cross-volume (universe) causal
  arrows; book-level causal arrows live in Story time.
- Both modes share the inspector, record stepping, book choice and live
  updates. A record open in the inspector stays open when the mode changes.
- Album illustrations render as image cards between their anchored scene and
  the next scene in the current view's order, including the Story time spiral
  and flat Story-time list. Story-time regrouping preserves the canonical
  scene anchor; it never changes the source or asserts a new chronology.
- Clicking an illustration opens Album, highlights that exact book-scoped
  picture, and scrolls only the inspector to it. Repeated clicks keep Album
  open. Passive live refreshes do not reopen the panel or reset its scroll.
- Bound character portraits render next to visible characters. Both portrait
  and illustration artwork preserve aspect ratio; 3D textures are capped at
  1024 pixels on their longest side. Missing images keep a placeholder.
- Ambiguous or unresolved image anchors stay unplaced. Images between scenes
  hidden in the same collapsed group stay hidden until that group opens.
- Sentence offsets preserve the complete original paragraph separators, including
  blank lines and CRLF. This corrects positional image anchors without changing
  sentence IDs, scene membership or ontology decisions. Albums imported before
  the fix need their stored sentence anchors regenerated from the unchanged
  source and its bound block size. `novel album list` resolves offsets read-only;
  re-importing the identical EPUB regenerates stored anchors. Back up the album
  and quiesce its writer before repair; never substitute another source.
- **Following Pi** reads its work across all three views, in either mode:
  - **Switching:** following switches tabs by itself. New or newly confirmed
    story periods open Story time; new places open Places, a few seconds
    after the periods. Pi running `novel timeplace run` points to Story
    time, and other new work to Narrative. A view stays at least 5 s unless
    something new emerged.
  - **What each view shows:** Narrative flies to (or opens) the work. The
    Story time and Places orbits go to the scene Pi touches, framed with its
    neighbours or its place's column, without opening the inspector. The flat
    views scroll to it and mark it.
  - **Just emerged:** periods and places that just appeared are highlighted
    and brought into view first.
- **Proposed time and place:** a time-place changeset still awaiting review
  shows its periods and places at once, marked proposed: dashed rows and
  nodes, or amber spheres. They become canon only after review.
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
- **Story time · Strands** (orbital switch `Line | Strands`, remembered per
  browser): each strand is its own coil, the busiest where the line was and
  the others stacked above it (all above the floor); S-curves cross between coils where strands split and meet, and a faint
  rung joins the scenes of one moment. A scene comes after another only with
  evidence (a shared character, a flashback, stated times), so scenes the
  story cuts between at different places sit on one rung, unordered.
  Estimated from who is in each scene (scenes without a recorded cast borrow
  a nearby scene's); about 0.87 of scene pairs agree with a hand-read gold on
  two volumes. A universe gives each book its own strands, books in reading
  order along the axis.
  - **Shredding**: switching to Strands, or new evidence that moves scenes,
    glides every sphere from where it was to its coil, staggered in story
    order, with the curves bending along. A switch frames the new shape (at
    once with reduced motion); new evidence moves the camera only while
    following Pi. Back to Line weaves them together the same way.
  - **Time and place check each other** (time key): each split is at
    different places, at one place (doubtful) or unplaced; each meeting joins
    a strand's place, meets at a new place, or is unplaced; chapters that end
    with strands apart are counted; and one person at two places at one
    stated moment is a conflict (time, place or cast is wrong).
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
