# Live series organization in the orbital explorer

Implemented locally, 2026-10-25. Deployment is explicit: existing viewers without
a configured library retain single-book behavior. No active Pi session, database
or external frontend worktree is migrated by this feature.

## One view, higher scopes

```text
Series library → Series + continuity → ordered files / volumes
  → chapters → scene groups → scenes (records reveal in place)
```

These are additional scopes of the existing orbital renderer, not a separate
construction screen. Series/file nodes are spheres. Back reaches the parent;
Series overview reaches the catalog root. Single click inspects/focuses; double
click on a library container or its revealed children opens its scope. Opening
an attached file loads its snapshot/SSE/source context only, never a Pi prompt.

Document IDs qualify file-local chapter/record identities. A loading file cannot
display the previous file's identically named chapters. Late stream callbacks
are ignored, and identity/album state resets when the loaded book changes. A file
without an explicit viewer binding is inspect-only, not permission to read a path.

Series are partitioned by continuity. Root series have no chronological arrows.
Known volume positions produce **READING ORDER** arrows, not actual story time.
Unknown order/membership gets no invented arrow. Event/dialogue uncoil pages stay
disabled. These organization nodes are labeled as metadata, not ontology facts.

## Durable facts → public snapshot → SSE

`libraryView` derives stable-ID activity from persisted sources, immutable
proposal files and recorded reviews:

- `library.source.registered`
- `library.plan.proposed`
- `library.plan.approved`, `library.plan.held`, `library.plan.rejected`

This uses committed state, not an extra log append whose failure could hide an
applied decision. New proposal files publish atomically. Repeated reads/reconnects
preserve event IDs and do not invent activity. This is the viewer snapshot stream;
the per-workspace `novel watch` command does not newly stream library metadata.

Current pending plans render as proposed ghosts; the latest held plan stays held.
Stale pending/rejected plans cannot appear as canon. Approval replaces the ghost
projection with reviewed organization, without asserting an ontology entity merge.
The observer watches the library alongside processor directories using the same
coalesced snapshot/patch transport. Activity contributes to the existing counter
and journal. Explicit follow routes to the containing series/library overview,
highlighting organization targets; same-level changes do not reframe. Reading
mode stays put; leaving follow restores its existing bookmark.

Public fields are titles/basenames, stable IDs, membership/order/status, safe
activity and viewer bindings. Source text, evidence quotes, private reasons/notes,
workspaces, original host paths and credentials stay private. At most 100 recent
proposal files plus the latest held plan are inspected; omitted older plans are
explicit. The event count reflects durable facts, not token/API call counts.

Library-wide faculties (`novel atlas`, `novel causality universe sweep`) also
write call telemetry to `telemetry/events.jsonl`: faculty name, status and time
only. It feeds the viewer's faculty graph, never this activity count or the
journal, and losing it hides nothing that was decided
([faculty-flow.md](faculty-flow.md)).

## Host configuration

Build CLI/frontend before deploying. Set **`NOVEL_LIBRARY_DIR`** to a trusted
local library directory for a new protected viewer. The default host derives
bindings from assigned workspaces' `ontology/library-source.json`, created by
`library prepare`. It does not guess source identity from names or ordinals.

Custom hosts can pass `createViewer({ libraryDirectory, libraryBindings })`;
bindings are `{ sourceId, volume }` for already assigned sources. Missing bindings
leave files unattached; unknown/duplicate/invalid bindings fail closed. Library
configuration never comes from a browser request. Exact Host/Origin checks,
private paths, independent Pi control capability, expiry and readonly APIs remain.

The wrapper enriches both custom and default `readLive` responses with
`world.library`, `world.sourceId` and `libraryActivity: { count, latest }`.
Frontend world remapping must preserve these optional fields. A library-less
world remains valid. Feed entries retain stable IDs/timestamps.

Register/prepare before configuring the bounded extraction job. An optional job
`library: { directory, bindings: [{sourceId, volume}] }` now grants hosted Pi
organization-only commands over those exact, hash-verified sources. Both skills
load; show/plan pages and cited evidence must be independently read before a
fresh-revision approval. Registration, preparation, arbitrary files, graph fusion
and changes to assigned extraction workspaces remain unavailable. An exclusive
library writer lock, immutable history, private checkpoints and receipts preserve
the review boundary. No configuration means no library capability; saving code
does not update a running worker or send an automatic processing prompt.

## Validation and limits

- Real CLI → protected loopback SSE with synthetic files: proposal ghost,
  approval, stable reconnect IDs, exact source/volume selection, private-field
  exclusion and unchanged API security.
- Orbital model tests: series/file navigation, order arrows, unknown/no arrows,
  pending/held/canon states, activity routes and old-chapter suppression.
- Labeled synthetic browser check: rendered series timeline and opening volume
  two. This is UI proof, **not a real Pi agent live-run result**.
- No paid model call, live database mutation or external frontend edit.

Actual-time nodes, cross-book EM, a fused graph and global temporal reconciliation
remain outside this feature. Integrate deliberately with Claude's frontend branch
before claiming that an existing real-data phone preview includes these changes.
