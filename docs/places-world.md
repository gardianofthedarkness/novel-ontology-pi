# Places: the world as the engine left it

The Places page (`view=places`, **World**) shows a book's places the way the world engine built them, without filling anything itself. **Atlas**, beside it, keeps the place-tree views from before.

## What it shows

- **The canvas:** every place of the book as a circle in its parent's frame, as the latest accepted run that built it laid it (`macro`).
- **Manifolds:** each place's landscape is one or more patches, one per bounding box the world added as the story reached new ground. Each is its own manifold:
  - outlined and tinted by its landscape type (skyscrapers, commercial, residential, industrial, harbour, park, stadium, village, castle, farm);
  - filled with the buildings of its latest fill;
  - listed in the place's panel with its type, era, when it was added and its fill version.
  - Older manifolds never change when a newer one is added (the engine fingerprints a manifold by its patch, the older patches that cut its ground and the recipe).
- **Ground:** each place's roads.
- **Nominated buildings,** in gold, named:
  - the reviewed building Locations of the ontology, on the lots they borrowed;
  - the staged buildings, where the canvas put them.

Destruction, placed things and people's paths are not drawn here: they belong to the runs and the live pages.

## Where it comes from

`playground/places-registry.mjs` rebuilds `stage/simulation/places/` from each line's accepted run whenever `novel sim run` keeps runs, or on its own with `novel sim places <dir>`:
- **`index.json`:** the places, grounds, manifolds and nominated buildings. The host puts it in the book's live data as `timePlace.worldMap`.
- **`fills/<version>.json`:** one manifold's buildings or one place's ground, in the place's own metres, named by its content.
  - A version is written once and never changes, so the host serves it as immutable (`api/places/fill?version=`) and a phone keeps it.
  - A place pushed whole on the canvas moves its fills without new versions; a new patch adds one fill and leaves the others.

Nothing here is canon: it is derived view data, private with the book like the runs.

## Not yet

- **Before any run:** the registry comes from accepted runs, so a book with no world run has no World view yet (the switch is hidden and Atlas shows).
- **One canvas per book:** each line's run lays its own canvas, so a place's circle is where the latest run that built it put it. When the engine keeps one book-wide canvas, the registry will read it the same way.
