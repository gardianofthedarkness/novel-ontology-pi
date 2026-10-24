# Orbital live activity and Pi console validation

## Scope

The existing orbital universe now renders in-flight scene/dialogue/name ghosts,
real faculty activity and entity-matching events without a separate construction
world. Following frames the current page overview only when the page changes.
Terminal scenes include every event/dialogue sphere; multiple edits in one refresh
highlight their shared hierarchy and visible bounds. Leaving follow restores the
reading bookmark. Captions update without driving the camera.

The phone viewer uses compressed, incrementally flushed SSE and field deltas,
with polling fallback. Its expandable glass console accepts messages for the
scoped Pi SDK session, not an unrestricted shell. Capability, Origin, private
path, heartbeat, expiry and queue limits are independently enforced. UUID
deduplication retains queued/processing/consumed/failed distinctions and never
automatically replays ambiguous paid work.

## Real-data observations

An actual serial continuation processed volume 1 chapters 3–4 in the existing
database, using real Jev and DeepSeek calls rather than cached responses/replay.
That run used the task-local guarded adapter on base `6a25c2f`; it is evidence
for native telemetry/projection, not a paid integration test of the newly
packaged server/interactive entry point.

| Result | Observed |
| --- | ---: |
| New source blocks applied | 4 / 4 |
| Supported applied operations | 713 |
| Semantic facts held outside canon | 392 |
| Unsupported proposals deferred | 0 |
| Unfinished assigned blocks | 0 |
| Structural validation issues | 0 |
| Language warnings | 0 |
| Jev / work-model / Pi requests | 1,205 / 704 / 374 |
| Observed tokens, including cached input | 28,205,233 |

Processing completed at 2026-10-24 02:10:11 UTC. `factsComplete` remained false:
held facts are not accepted canon. These counts do not establish extraction
accuracy, solve all prior held facts, or demonstrate full-volume stability.

The previous snapshot transfer was approximately 831–840 KB uncompressed, with
a one-second wait after each completed download. A real tunnel probe observed
an initial snapshot in 246 ms and subsequent 78-byte or approximately 22.7-KB
uncompressed delta frames. Projection-to-arrival was 10–12 ms in that Mac-side
probe, excluding file coalescing/projection time; this is not an Android latency
benchmark. Real packet writes can publish hundreds of proposals together, so
counter jumps are not fabricated into slower individual-agent animations.

The real console rendered historical/current command statuses, enabled Send
for a draft, and remained ready with zero new model calls and no queued messages.
No paid next-chapter console turn was initiated for this validation; the user
was given control. That live connection initially used the task-local host.

## Reproducible offline checks

The rebased implementation passed an isolated checkout validation against main
`7c6beb1`: 299 core tests, 12 console-component tests and 71 review/queue/stream/
server tests (382 total), plus the frontend production build. Isolation kept
builds away from the running private Pi session. No new paid model calls were
needed for PR packaging or this validation.

- Core CLI and orbital model/routing tests, including same-page retention,
  cross-page/cross-chapter batches, terminal scenes and reading bookmarks.
- Snapshot tests for ghosts appearing before ontology application, parallel
  dialogue attachment and truthful held/deferred statuses.
- Actual compressed SSE tests for atomic replacements, field deltas, reconnect,
  watcher cleanup and current-state resynchronization.
- Queue tests with separate processes, authentication/Origin/body/expiry limits,
  40-message capacity, private file modes, restart recovery and UUID deduplication.
- Console component tests for transport headers, retry IDs, scroll retention,
  abort cleanup, truthful acknowledgments and disabled stale/unavailable workers.
- SDK-loop tests with a synthetic session proving idle-without-user behavior,
  serial delivery and no automatic retry of failed turns.
- Portable runner tests for unchanged-source resume, retained chapter metadata,
  skipped audited applications and fail-closed credential handling.
- Portable viewer tests for scoped resources, host/Origin validation, read-only
  versus operator access, streamed batches, expiry and shutdown cleanup.

```sh
npm test
node --test test/pi-console.test.mjs
npm test --prefix tools/pi-review
npm run build --prefix apps/playground
```

On macOS, use a canonical temporary path such as `TMPDIR=/private/tmp` if the
existing init test encounters the `/var` versus `/private/var` symlink alias.
The frontend retains its existing large-bundle build warning. Source excerpts,
raw model payloads, credentials, operator links and private audit reports are
deliberately absent from this report and PR.
