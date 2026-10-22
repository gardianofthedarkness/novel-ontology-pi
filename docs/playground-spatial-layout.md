# Spatial ontology layout

Chapter chronology stays on straight overview rails. Within a chapter,
switch between **Chronology** (straight, ordered scene rails) and
**Relation cloud** (weighted free 3D neighborhoods). Both modes use the same
progressive projection and expansion state. In cloud mode scene order remains
available through numeric labels and the ordered scene navigator, not a
positional constraint on every scene. Disconnected scenes must never become dozens
of artificial parallel timelines. Optional `trackId` / `trackLabel` provide
separate soft starting regions for known concurrent stories without
claiming that disconnection itself proves parallel action. Legacy views
without scene records retain their existing chronological-chain fallback.

`spatialLayout.ts` builds weighted undirected adjacency from the **actual**
displayed edges. Optional positive `edge.weight` values are supported;
otherwise relationship kinds supply defaults. Repeated direct connections
accumulate with logarithmic damping. Shared two-hop neighbors add affinity,
discounting high-degree hubs so a common scene does not imply that everyone
has the same relationship strength. Stronger affinity sets a shorter spring
rest length. Springs also propagate effects through longer graph paths.

The initial cloud layout fixes only chapter-level overview anchors. Interior
scenes start in deterministic spherical regions, not `(chrono, row, depth)`
sequences; connected records follow their weighted neighborhoods. Once
visible, context nodes remain fixed during local expansion. Synthetic event-order
edges are excluded from the relation cloud; chronology remains available
in the scene navigator. Ninety bounded spring/repulsion
steps spread them across angles and depth. A spatial hash resolves local
collisions; weak shell forces discourage collapse onto a line. Indirect
expansion is capped at 24 neighbors per hop and 12 indirect affinities per
node. This is an interactive approximation, **not an exact all-pairs graph
distance embedding or proof of a character relationship**. Derived affinity
does not create new ontology edges. Hiding relation lines does not change
the layout. Gate-state changes alone do not move nodes.

The private read-model projector restores scene/event links from shared
sentence provenance, and presence, mention and location links from stored
scene fields. These are explicitly marked derived display links; no
canonical ontology or source file is changed. Mention links remain distinct
from physical presence. Scene labels and inspector text use existing event
summaries, never newly invented or translated prose. Missing summaries are
reported honestly. Raw quotes, sentence IDs, audit reasons and payloads are
not added to the public projection.

Characters remain spheres; other records remain cards, with camera-facing
fronts. Cached procedural glow textures provide dark-theme icons without
postprocessing dependencies or per-node lights. Proposed/held wireframes,
real relation edges and the live React Flow processing strip remain.
Floor/back grids and colored coordinate axes establish a stable 3D frame.

Selecting an individual character, event or dialogue record centers inspection
in the usable viewport. Scene/group clicks instead expand in place without
moving the camera. Transparent floating labels, the inspector's record list
and keyboard navigation use the same activation behavior. Framing includes
depth and accounts for headers, processing strip
and the details panel. Selecting a sphere now centers it just like a card.
Phone detail sheets leave the upper canvas visible. Camera orientation is
preserved during individual inspection; framing the whole graph restores
an oblique spatial overview. Reduced-motion mode disables camera flights.
Semantic scroll/pinch entry and zoom-out return remain available.

## Progressive disclosure

Neo4j Browser documents an initial visualization node limit in its
[settings](https://neo4j.com/docs/browser/visual-tour/) and node
[expansion/collapse](https://neo4j.com/docs/browser/operations/result-frames/).
Our automatic chronological grouping is an application-specific extension
of that bounded-view interaction, not a claim that Neo4j automatically
groups every query result into twenty clusters.

`sceneHierarchy.ts` partitions scenes into chronological ranges, preserving
explicit story tracks when they fit the current display budget. Twenty is
the initial scene-card budget and per-expansion fan-out, on phones as well
as desktop. Characters and the separate unattached-record group do not
consume scene slots. With a budget of twenty, 200 scenes become twenty groups
of ten. Much larger graphs recursively add more levels. Known concurrent
tracks stay separate; if more tracks exist than fit, mixed groups are
explicitly labeled and must be expanded before interpreting their tracks.
Chronology aligns equal order keys across known tracks; these are stored
narrative order keys, not inferred absolute story timestamps.

Click a range to add its scenes around it, then a scene to add its connected
records. The parent, siblings and earlier expansions remain on the same
canvas. Expanding and collapsing do not move the camera, recenter the graph,
or reposition existing records. New neighbors are laid out locally around
their parent; expanded chronological scene rows remain straight. Frame view
is available explicitly when the user wants to fit all open content.
Dense neighborhoods recursively group again, retaining the focus scene.
Every chapter character, including proposed/held character ghosts, remains
an individual sphere at every depth. This is chapter context, not a claim
that every character is physically present in every expanded scene. Only
actual scene relationships are projected. Shared characters are never
duplicated or folded into group counts. The coordinate grid keeps its root
frame as neighbors expand.
Unattached records have an explicit Other records group; no records are
discarded to meet the budget. The scene selector jumps directly to a hidden
scene by opening its ancestor groups without replacing unrelated context.
Click an open node again to collapse its branch. Undo, Collapse all, Escape
and semantic zoom-out collapse expansions without zooming the camera.
Zooming close enough to a group or scene expands it without an extra button.
Mode switching retains the expanded branches and explicitly reframes the
alternative layout. Resizing does not lower the twenty-scene threshold.

Groups exist only in the UI, show represented record/ghost/held counts, and
never enter the database. Cross-group edges aggregate existing displayed
connections and are marked derived with counts. Shared records use a stable
earliest-scene owner for aggregation, but opening any scene shows all of its
direct neighbors, not only owned records. Group/child membership connectors
are marked view-only and never presented as canonical ontology relations.
Only the visible projection is
laid out, meshed and indexed in the inspector; underlying source records
remain available for navigation. Stored summaries remain unchanged.

Regression tests cover weighted/shared affinities, 3D occupancy/collisions,
deterministic positions, anchor immutability, non-collinear scene clouds,
ghost tethers, finite malformed-weight handling, and panel-aware camera fit.
Run `npm run build && node --test dist/test/playground-*.test.js` at the
repository root; build the UI with `npm run build --prefix apps/playground`.

## Manual review

Run `npm run dev --prefix apps/playground` and open the reported localhost
URL. Enter a chapter, toggle Chronology / Relation cloud, and click a scene
to expand its neighbors without changing the camera. Select a character to
inspect it, use Undo / Collapse all, toggle Relations, and replay the sample
to check ghost states and the live processing strip. The bundled fixture
is small; the automated hierarchy tests cover 200 and 20,000 scenes.

Grouping is client-side progressive disclosure, not database query pagination.
The scene selector retains access to the full chapter. Many open branches or
a very large cast can still require manual pan/zoom; Frame view explicitly
fits the open graph. This change does not package the task-local private
viewer, expose a tunnel, change ontology data or invoke paid models.

## Verification (2026-10-22, Mac)

- Root CLI/regression suite: **128/128 passed**.
- Optional Pi review/read-model suite: **26/26 passed**, using synthetic
  fixtures without paid model calls.
- Playground TypeScript/Vite production build passed. Vite still reports
  the existing large-bundle warning (approximately 2.6 MB uncompressed).
- Browser checks covered desktop and a 390 × 844 phone viewport. On the
  existing private chapter, the initial view contained 20 scene cards plus
  all 18 characters and one unattached-record group. Expanding increased
  visible nodes from 39 to 41 while retaining all original nodes; common
  visible labels kept identical screen transforms. Deeper scene expansion
  retained all 18 characters and its stored summary.
- Synthetic tests cover 200-scene condensation, recursive 20,000-scene
  grouping, reachable records/ghosts, independent open branches, stable
  positions during expansion/collapse in both layouts, and honest derived
  relation/context projection without raw source leakage.

Private source, runtime files, audit logs, viewer URLs and real-data
screenshots are intentionally excluded from the repository and PR.
