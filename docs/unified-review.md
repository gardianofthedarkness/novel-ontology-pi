# One semantic review contract

Every faculty uses one review lifecycle. A new producer registers typed assertions,
human-readable meaning, original-source evidence and domain validators; it must not
create a parallel review/approval gate. A storage scope is not a faculty name.

```text
faculty proposals → scope adapter → shared show / evidence
                                      ↓
                              decide (stage only)
                                      ↓
                         apply (fresh evidence + validators)
                                      ↓
                      book bundle | universe ledger | catalog
```

## CLI

```sh
novel review show ROOT PACKET --scope book --offset 0 --limit 20
novel review evidence ROOT PACKET --scope book --fact FACT --offset 0 --limit 20
novel review decide ROOT PACKET --scope book --revision HASH --decisions '[{"factId":"FACT","verdict":"accept","reason":"Original evidence supports this assertion."}]'
novel review apply ROOT PACKET --scope book --revision HASH
```

Use `--scope universe --universe WORLD` for cross-book causal packets or
`--scope library` for organization plans. `factId`, verdict and reason have the
same schema in every scope. Cross-book acceptance additionally requires a
source-grounded `temporalReason`; reading order is not story time. Corrections
to entity references use unique displayed labels through `semanticReplacement`.
Changing relation endpoints/type requires a new evidence-bound proposal.

`show` returns complete assertion values/meaning and up to three evidence
sentences. Follow actual `page.nextOffset`, including byte-shortened pages.
`evidence --fact` pages remaining original evidence, at most 20 sentences / 24 kB.
Assertion pages cap at 28 kB and decisions at 50 entries / 64 KiB. Nothing is
silently truncated to earn coverage. Oversize assertions can remain held.

Only reads at the current packet/context revision earn acceptance credit.
Accepted ordinary book facts need adequate original evidence; causal links need
all cited evidence for both endpoints. Accepted assertions must have been shown
in full. `decide` validates and persists private staged decisions but does not
write canonical ontology/catalog/causal ledger. `apply` rechecks revision,
evidence, dependencies and domain rules. Unreviewed facts default to hold.

## Storage and safety

- **Book:** existing semantic materialization publishes valid source organization
  plus verified assertions with available identity dependencies. Standalone causal
  packets hydrate original source in memory, without changing proposal IDs,
  payloads, confidence, provenance or the predecessor during inspection/staging.
  Explicit application records the source-bound semantic review and uses the same
  book apply helper as the compatibility CLI. Causal cycles, contrary sequence
  direction, missing endpoints and already-linked pairs fail closed.
- **Universe:** immutable causal packets become relation assertions with qualified
  source identities. Decisions stage privately; apply uses the existing
  same-continuity, temporal-evidence and cycle-checked ledger writer. Book bundles
  never fuse or receive these edges.
- **Library:** each organization item is an assertion. The plan is atomic: all
  items must be accepted to publish organization. Any rejection rejects the plan;
  missing/held items hold it. No partial catalog is assembled from incompatible
  accepted fragments. Corrections require a freshly validated plan.

Private `ROOT/review/` stores revision-bound coverage, decisions and append-only
review history; it is not canonical data and must not be published. A per-root
review lock serializes CLI review operations. Source text is not copied into the
coverage receipt. Approved/applied packets cannot be applied twice. Subsequent
recovery of held book facts requires new source-grounded work, not reapplication.

The Pi host uses this protocol exclusively for review, validates exact assigned
workspaces/library scopes, requires installed skills, retains private checkpoints
before decisions/application and emits safe review progress/receipt metadata.
Proposal/ingest commands remain faculty-specific; review does not. Legacy review
commands receive an actionable migration error in this host.

## Compatibility and extension

Historical `changeset facts|decide|approve`, `causality universe show|decide` and
`library plan|decide` remain available to non-scoped existing clients. Their old
response shapes and immediate-application behavior are not the new protocol;
universe/library callers must use the new `review decide` to stage without
publishing. They reuse the existing semantic validators and storage writers;
the new gate wraps those writers with shared evidence/read/staging safeguards.
Do not use the historical commands as a template for a new faculty.

Source-less non-causal legacy packets are explicitly unsupported by the new
adapter. They must gain source-bound typed assertion support before participating
in hosted review; a new approval shortcut is not a migration strategy. Historical
packets are neither silently verified nor bulk rewritten. New assertion types
must add positive and fail-closed tests to the shared contract. An additional
storage adapter is justified by storage/transaction semantics, not a new faculty.

Tests use synthetic original-language passages and isolated temporary workspaces;
they do not send novel text to providers or modify the owner's databases. This
change repairs the review/control contract, not Jev nomination quality or the
local sweep's separate pagination limitation.
