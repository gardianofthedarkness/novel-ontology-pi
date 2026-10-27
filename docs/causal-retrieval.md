# Cross-scene causal retrieval

Events and dialogue cards are equal search units. For a queried effect:

1. Exclude its own scene, missing scene membership, and candidates not strictly earlier on the established order.
2. Exclude existing direct links and directed canonical paths from candidate cause to effect. A→B→C suppresses checking A→C; it does not manufacture a direct causal assertion.
3. Retain the raw cosine floor of 0.5. Rank embedding matches by `cosine × (1 + 0.25 × earlierRank)`, where the earliest eligible candidate has rank 1 and the latest rank 0. Take top 32 only after eligibility filtering and weighting.
4. With embeddings enabled, graph-pattern matches reweight retrieved pairs rather than adding an unbounded shared-actor Cartesian product. Without vectors, graph-only nomination remains available. Apply the same cross-scene/order/path filters to both legs.
5. Ask Jev for direct causal support and a succession veto. Ranking, chronological precedence and reachability are never causal proof. Keep the existing confidence thresholds and independent shared review/apply gate.

Stored TimePoint story indices override reading order, including flashbacks. Equal or missing time anchors in an otherwise anchored book are not silently ordered. When the entire book has no extracted story-time anchors, the established sequence remains an explicitly labelled `reading-order-fallback`; this is not actual-time evidence. Cross-file reading order never establishes story order.

Sweeps limit each Jev request to ten pairs and a 16,000-character dossier budget. Endpoint text exceeding that budget is deferred, not truncated. Each returned batch persists proposed arrows immediately. Explicit reviewed application is still required for canon.

The per-book `causality-scan.json` sidecar binds evaluated pair keys to source units, scenes, non-causal relations, state, timeline and configured embedding policy. Bounded calls resume instead of repeatedly judging the first page. Coverage excludes unvisited candidates and records context deferrals. `complete` means the current bounded nomination policy was exhausted without deferrals, not exhaustive discovery of every possible causal relationship.

Narrative, Story time and Places accept live activity without switching to another view. Canonical, proposed and held arrows retain their states. Alternate views project hidden endpoints to their scene containers rather than dropping them. Camera follow keeps a page overview and avoids recentering on every new arrow.
