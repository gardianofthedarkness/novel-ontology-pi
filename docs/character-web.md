# Cast web: relation web, hall of fame, two-character history

A design demo on its own host, beside the playground, reading the volumes we
have already extracted. One model drives three views: the **relation web**, the
**hall of fame** it ranks, and the **history** of any two characters.

## Run it

```bash
cd apps/playground
NOVEL_REVIEW_HOME=<pi review home> npm run character-web
```

It opens on <http://127.0.0.1:5181>, on loopback only, because it serves a
private book's records. `NOVEL_REVIEW_HOME` is the same home `tools/pi-review`
uses. The host reads the workspaces its `runtime/live-volumes.json` lists, and
shows each volume with extracted scenes. The path stays in your environment,
never in the repo. `npm run character-web:build` builds it apart from the
playground, into `dist-character-web/`.

The host sends the page names, casts, event summaries and actors, relationship
deltas, CAUSES links and the portrait images that `portraits.jsonl` lists. It
never sends evidence quotes or source text.

## The model (`character-web/src/model`)

`bundle.ts` turns ontology bundles into the web's input:

- **Ids:** namespaced per volume, because each workspace numbers its own
  `char_000001`.
- **Scene cast:** the recorded cast, plus whoever acts in or is affected by the
  scene's events. Recorded casts are sparse today (43 of 77 scenes in volume 1),
  and events are not.
- **Series · by name:** joins characters across volumes when they share a
  recorded name form. That is a provisional join for the view, not reviewed
  identity; cross-book identity does not exist yet.

`web.ts` computes view metrics, never ontology facts:

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
- **Layout:** tiers are rings, with protagonists at the heart. Groups are
  sectors, so a group stays on one side as its members change rings.
- **Pair history:** every scene the two share, every mention of one by the
  other, and every affinity shift, in order. It carries a running affinity and
  marks the largest shift as the turning point.

The scrubber replays the story scene by scene. Story time is not recorded for
these volumes yet, so it follows reading order. Once time-place facts exist, a
scene's `story` position can take its story-time rank instead.

## Next

- Read story time from time-place, so flashbacks fall in their place.
- Move the model into the live snapshot, so the playground can host the web
  with live updates.
- Reviewed cross-book identity, to replace the series join by name.
