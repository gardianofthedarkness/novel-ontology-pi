# Cross-scene causal retrieval validation

- Core tests: 483 passed. Host tests: 124 passed. Frontend production build passed; existing bundle-size warning remains.
- New regressions cover exclusion before embedding top-K, an earlier-position ranking boost without lowering the raw similarity floor, directed path pruning including inverse serialization, stored story-order overrides, resumable rejected-pair coverage, live causal endpoint touches, and proposed-arrow projection in Story time and Places.
- The owner's disposable live demo was privately checkpointed before removing 149 canonical causal relation rows, 494 saved causal proposals and five universe-ledger decision records. Hash checks verified 147 non-causal canonical files were unchanged. Archived material is private and is not included here.
- Real local BAAI/bge-small-zh-v1.5 retrieval over Vol1: 676 units and cached vectors, 17,798 nominated pairs, zero same-scene/missing-scene/non-earlier violations. Every nominated pair had an embedding leg. This is policy conformance, not a causal-accuracy measurement.
- Real TypeSafe/Jev bounded sweeps were started for both Vol1 and Vol2, with the existing independent shared review/apply gate preserved. The full rebuild was still running at this report's checkpoint; no full-volume completion or accuracy result is claimed.
- Both books currently lack extracted story-time anchors. Their ordering is explicitly reported as `reading-order-fallback`, not actual story-time proof.
- Browser verification confirmed that activity follow stays in Story time, also works in Places without time facts when scene locations exist, and restores the pinned book when follow is turned off. Pi chat controls remain available through the protected owner viewer.

No source excerpts, raw model inputs, review reasons, credentials, private viewer links or owner database files are included.
