# Universe-scoped causal links

`novel causality universe` extends post-extraction causality across registered
books without renumbering records, merging databases, or changing ingestion.
See `skills/novel-ontology/references/causality.md` for the executable workflow.

## Scope and evidence

- Only reviewed, confirmed library assignments enter a universe query. Pairs
  must share one continuity. Other universes, branches and unresolved sources
  are excluded; different series in the same continuity are allowed.
- Endpoints are canonical events or dialogue cards, qualified as
  `doc_<source-sha256>::<local-unit-id>`. Local IDs may collide across books.
- Source and graph revisions are pinned. Dialogue fragments retain their
  complete source span; superseded append-only records are not current units.
- Graph/name overlap is a weak retrieval hint, never verified identity. Both
  directions can be nominated. No cross-book entity merging is performed.
- Publication/reading/chapter order does not establish actual story time.
  Acceptance needs original passages from both books and a source-grounded
  temporal/directional reason. Unknowns stay held; directed cycles are refused.

## Bounded pipeline

Reviewed membership → source-qualified canonical units → bounded nomination
→ paged candidates → bounded original-passage Jev checklist or agent proposal
→ independent packet/evidence review → universe ledger.

Nomination inspects at most 100,000 pairs, retaining up to 500 candidates, with
explicit truncation and non-exhaustive coverage. Pages/sweeps cap at 20 pairs;
Jev packets use a conservative 16,000-character budget including question
overhead. Oversized/missing source spans are deferred, never silently cropped
or treated as rejected. Use revisioned offsets to advance; reviewing/changing
the ledger invalidates old nomination cursors. No automatic full-universe run
or paid continuation is launched by opening the viewer.

This first cross-file retrieval path uses graph/name hints, not an embedding
service. Per-book optional embeddings remain separate. This is not the planned
actual-time faculty, temporal reconciliation, global EM or simulation engine.

## Storage and host contract

Immutable packets: `<library>/causality/packets/uc_<digest>.json`.
Reviewed decisions: `causality/state.json`, atomically replaced under the
library lock, with private generation checkpoints in `causality/history/`.
Accept/hold/reject remains explicit; a proposal never writes canon. Original
book bundles, sources and graph files are not changed by this pipeline.

Prepared library workspaces bind through their stored library-source identity.
For external workspaces the trusted host supplies `NOVEL_CAUSAL_BINDINGS`, a
private JSON path containing `{directory, bindings:[{sourceId, workspace,
inputSha256}]}`. The Pi runner derives it only from existing authorized job
bindings and pinned inputs, not browser parameters. Old story-only EPUB
workspaces retain their assigned text instead of being silently reimported.

The scoped runner requires both skills, the causal reference, actual current
candidate reads, all packet pages and both complete evidence spans before
acceptance. Changed source/membership/entity context invalidates support. It
retains private checkpoints and approval receipts. Cross-file edges are queried
through `universe list`; existing per-book Cypher queries remain local.

The protected live stream exposes qualified endpoints and proposed/held/canon
states, not source text, credentials, private reasons or host paths. Library
file/series spheres project those edges; they are not inferred file-to-file
causes. Directional, state-colored arrows remain visible with Connections on,
without selecting a sphere. Dashed arcs indicate projection onto containers;
multiple links in the same direction share an arrow while retaining their
source-qualified endpoints. Links inside one sphere are counted until its
contents are revealed. Stale edges are held and not drawn as valid projected
connections.

Synthetic two-book tests exercise the real CLI → protected SSE → independent
review flow, collision isolation, continuity boundaries, source invalidation
and cycle refusal. These tests do not measure novel-wide causal precision.
