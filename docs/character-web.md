# Characters: relation web, hall of fame, two-character history

The playground's fourth view, after Narrative, Story time and Places. One model
drives three things:

- the **relation web**;
- the **hall of fame** it ranks;
- the **history** of any two characters.

Open it with `?view=cast`.

**Orbital** is the orbit itself, like Story time and Places: the book
regrouped, with one glass sphere per character (`apps/playground/src/data/orbitalCast.ts`).

- **Inside a sphere:** that character's scenes and their records. Entering a
  character walks their own line through the book in reading order, just as
  entering a chapter does.
- **The arrangement:**
  - stands the spheres on an amphitheater, protagonists on the top step and
    groups on one side;
  - lays the tier rings on the floor, as Places lays its map;
  - draws ties as orbit paths: the strongest as faint links at rest, a selected
    character's as routes, and the pair being compared as a thread, which
    becomes a moving route while their story is watched.
- **Selecting a character** opens the shared glass inspector, which carries its
  tier, rank and score parts.

**Traditional** draws the web flat inside the `tp-view` frame.

Both modes share one state (`components/cast/useCast.ts`) and one side panel
(`CastPanel`, in the Places atlas panel's form): the hall of fame, a scrubber,
a pair to compare and its history.

## Where the data comes from

The live snapshot carries a `cast` projection (`tools/pi-review/cast.mjs`) for
the loaded book:

- character and place names;
- each scene's recorded present and mentioned casts, and its dialogue-card
  members;
- event summaries (capped at 280 characters), importance, actors and the people
  they affect, each event with the scene it cites;
- the `relationships` part of state changes;
- CAUSES links.

Evidence quotes, source text and sentence ids stay in the workspace. Portraits
come from the album projection.

`apps/playground/src/data/castBundle.ts` turns that into the web's input:

- **Ids:** namespaced per volume, because each workspace numbers its own
  `char_000001`.
- **Scene cast:** the recorded cast, plus whoever acts in or is affected by the
  scene's events. Recorded casts are sparse today (43 of 77 scenes in volume 1),
  and events are not.

It can also join volumes by a shared recorded name (`series-by-name`). That is a
provisional join, not reviewed identity, and the view does not use it yet.

## The model (`apps/playground/src/data/castWeb.ts`)

It computes view metrics, never ontology facts.

- **Ties** say what they are made of: shared scenes, shared exchanges (dialogue
  cards), co-action (one acts on, or alongside, the other), mentions, and the
  sum of `StateChange.relationships` deltas between the two.
  - Weight: scenes + 1.5 × exchanges + 2 × co-action + 0.5 × mentions
    + 3 × |affinity|.
  - Tone: bond when affinity is above +0.15, tension below −0.15, contact
    otherwise.
  - No KNOWS/SPEAKS_TO fact is written. Sharing an exchange is evidence of
    contact, not a relation (docs/faculty-graph.md).
- **Connection score:** the weighted sum of five parts, each scaled against the
  strongest character in scope.

  | Part | Measures | Weight |
  | --- | --- | --- |
  | Presence | scenes, with a mention counting a quarter | 0.25 |
  | Agency | importance of the events they drive | 0.2 |
  | Reach | distinct characters they share ties with | 0.2 |
  | Influence | people their actions affect, plus events downstream through CAUSES | 0.2 |
  | Bridging | other groups they tie into | 0.15 |

  Influence replaces a pure causal score because the volumes hold only two
  CAUSES links each.
- **Groups:** Louvain's local-moving phase over tie weights. It is
  deterministic, and a hub joins the group it shares most with instead of
  absorbing everyone.
- **Tiers:**
  - Protagonists: up to three characters, with a score of at least 0.55.
  - Connectors: characters whose bridging outweighs their presence.
  - Pillars: anyone else with a score of at least 0.25.
  - Cameos: everyone else.
- **Layout:** tiers are rings, and groups are sectors. In 3D each tier stands on
  its own step, with the stronger a little higher.
- **Pair history:** every scene the two share, every mention of one by the
  other, and every affinity shift, in order. It carries a running affinity and
  marks the largest shift as the turning point.

## Using it

- **Scrubber:** in the panel, replays the book scene by scene; the web and the
  ranks follow.
- **Two characters:**
  - choose them in the panel's Compare selects;
  - or select one and press *Pick in view*, then pick the second on the orbit
    or the flat web (this works on touch);
  - or, in the flat web, shift-click.
- **Watch their story:** steps through every moment the pair shares. The web
  grows to that point, their tie carries the route's moving bead (orbit) or
  flows (flat), and the log follows, with later entries dimmed.

The order is reading order, because story time is not recorded for these
volumes yet. Once time-place facts exist, a scene's `story` position can take
its story-time rank instead.

## Next

- Read story time from time-place, so flashbacks fall in their place.
- A series scope across the library's books, once reviewed cross-book identity
  replaces the join by name.
- *Show in Narrative* from a character card.
