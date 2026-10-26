# Orbital revolution explorer

The default playground mode is **Orbital**; **Traditional** shows the same
three views flat (see [playground views](playground-views.md)). Layout groups
and time paths are view objects, not ontology edits. No model calls or new
dependencies are required.

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
Surrounding characters and locations reveal progressively by scoped direct and
bounded two-hop weighted connectivity: five at volume scale, ten at chapter
scale, increasing budgets in deeper groups, and all connected entities at the
bottom. An explicitly selected entity remains visible. Proposed/held states
are retained. Weighted centers and a wider three-dimensional shell spread the
nebula without distorting main chronological anchors.
Parallel preview helices use equal radius, phase and constant track offsets.

Group/chapter labels use the most-connected scene with an existing summary,
preserving its source language. No summaries are generated for navigation.
Labels are collision-culled and truncated visually. Selecting an entity reveals
all its linked scenes inside enclosing main spheres as small connection ports.
Connections through a recorded event are labeled as such, never as physical
presence. Other hidden entities are not force-revealed. The inspector lists a
main node's child summaries in chronological order, without a top-three cap.
A frame action accounts for the toolbar,
transport and open inspector, including narrow screens.

## Camera navigation

Wheel and trackpad pinch use proportional physical-distance zoom: the same
gesture covers the same fraction of the current distance at every scale.
The point under the cursor stays anchored; Shift-scroll gives quarter-speed
fine control. Zoom buttons and the focused viewport's plus/minus keys use the
same distance model. Native two-finger touch retains dolly/pan controls.
Zoom remains bounded and respects reduced motion. Lens zoom is normalized so
pinching cannot leave inspection framing at a mismatched optical scale.

Inspection stops pending camera motion, preserves the actual viewing angle,
clears residual focal offsets and updates position/target atomically. Selected
entities center in the viewport area not covered by the inspector and controls,
even after rotating or panning the camera. Inspection framing runs after the
inspector's DOM is committed, so the first click reserves the same space as
subsequent clicks rather than using the closed panel's bounds.
Single-click inspection is separate from Frame view: it never fits all of an
entity's connections or substitutes an enclosing sphere for a selected subscene.
It preserves the selected sphere's current apparent size when readable, moves
closer only when it is tiny, and backs off only when the sphere itself would
overflow the available viewport. The readable-size band scales with the free
viewport area, with stable repeated-click behavior across hierarchy scales.

The read-only snapshot projects one stable sphere per stored scene dialogue
turn, with speaker metadata and any matched event summary. These are derived
view records, not additional canonical events. Legacy dialogue-event summaries
are suppressed when per-turn records exist. The current ontology stores sentence
references, **not original utterance text**. A Mac-local source adapter can
resolve a selected scene/event/turn through those references to the exact stored
block text. Reads are on demand, preserve whitespace, and explicitly mark missing
or noncontiguous spans. No model generates transcripts and evidence summaries
are never substituted for original text. Legacy sample dialogue labels are not
upgraded into verified turns.

## Local source adapter

The host opts in using `?source=1`; the inspector requests
`api/record-source?id=<record-id>` (with an optional configured volume). The
adapter uses `tools/pi-review/record-source.mjs`, trusted scene/event records,
the deterministic `sectionBlock` function and a host-provided block reader.
It never accepts a source filepath or arbitrary sentence list from the browser.
The private Mac test host serves this route exclusively on its separate
loopback-only source listener, not on the Cloudflare-forwarded listener. The
public snapshot remains summary-only. Missing data stays explicitly unavailable.

## Validation

- Root suite: 159 tests pass, including eight orbital model/layout regressions
  and eleven proportional zoom, cursor anchor and adaptive-focus regressions.
- Optional Pi-review suite: 29 tests pass, including turn projection/privacy and two original-source regressions.
- Repository and task-local frontend production builds pass; Vite retains its
  existing large-chunk advisory.
- The private viewer's GET-only, token-path and source/payload blocking checks
  pass on loopback. No new public tunnel is needed for local verification.
- Hierarchy regression covers 20,000 scenes, complete member preservation,
  progressive weighted nebula, complete nested scene connections, chronological
  contents, explicit parallel tracks, preview bounds,
  exact morph endpoints, stored summaries and selected visible-only edges.

Manual browser checks include phone-size framing, click versus double-click,
transparent preview without navigation, uncoiling promotion and Back. The live
read-only volume snapshot is used separately from the repository's sample data.
Refinement checks verify the complete chronological chapter list, hidden-child
inspection surviving preview updates, on-demand original scene/turn text, and
Mac-local source access with public-tunnel source denial.
Camera checks verify wheel zoom anchored on a selected character, zoom buttons
at overview scale, and first-click centering with a newly opened inspector after
rotating the live graph. The selected character projects to the unobscured
viewport center rather than the full page center.
Adaptive inspection checks cover a tiny character approaching readable size,
refocusing after a manual close-up without retreating to fit its connections,
and a revealed subscene centering at readable size without changing levels.
Repeated subscene selection retains the same projected position and size.
