# Causality (Solidifier skill category)

Cross-scene CAUSES links — the one causality the extraction step never
emits. Extraction owns no CAUSES at all: the causality faculty owns every
CAUSES link, systematic and agent-adjudicated alike.

## Two paths, one machinery

**Systematic (Jev-determined).** Runs automatically: per block, over pairs
touching the block's new events and dialogue cards; and at chapter close,
over old × old pairs. Candidate generation is hybrid — graph patterns
(shared actors, shared location, state-change chains) plus embedding top-K
over events and dialogue cards as uniform search units — and one batched
Jev checklist adjudicates at threshold 0.85 (direct textual support +
temporal consistency on the novel sequence; succession, correlation, or
shared topic alone is NOT causation). Confident links join the block's
ChangeSet or a sweep changeset for the same gate review as everything
else. Nothing here writes canon directly.

**Agent-adjudicated (this skill).** After a full run, you adjudicate:

```
novel causality candidates <novel-dir> [--unit ID] [--chapter N] [--limit N]
```

Candidates carry their nominating legs and both units' summaries. Read the
original passages for BOTH endpoints, not just summaries:

```
novel causality evidence <novel-dir> <from> <to> [--changeset ID] --offset 0 --limit 10
```

Follow `page.nextOffset` until complete. Missing provenance means hold;
never guess. Use `--changeset` when reviewing a proposal, so reads are
bound to that exact revision. `novel query` adds graph context. Judge:
does A directly bring about B? A cause must precede
its effect on the novel sequence (chapter order, scene order,
`chronologicalOrder`). Succession alone, shared topic, or coincidence is
not enough. Dialogue cards are full endpoints: a line can cause an event,
an event can cause a line, and two lines can stand in a causal relation.

Propose only links you judge causal:

```
novel causality propose <novel-dir> <from> <to> [--reason "..."]
```

The proposal lands in a `pending_review` changeset for the gate. The
command refuses self-links, already-linked pairs, and pairs whose
novel-sequence order contradicts the proposed direction (swap from/to
instead). Order-ambiguous pairs are allowed — direction is your judgment
from the text; say so in `--reason`.

On demand, the systematic sweep runs outside ingest:

```
novel causality sweep <novel-dir> --limit 10
```

## Across books in one universe

Use the library from `NOVEL_JOB.json`. Inspect its reviewed universe IDs
with `novel library show`. Only confirmed assignments in the SAME continuity
are eligible; another universe/continuity or unresolved membership is not.

```
novel causality universe candidates <library-dir> <universe-id> --offset 0 --limit 10
novel causality universe sweep <library-dir> <universe-id> --revision <candidate-revision> --offset 0 --limit 10
```

Candidates return source-qualified IDs, coverage and `page.nextOffset`.
Names nominate only: matching local IDs or names do not merge identities.
Reading order is NOT story time; both causal directions may be nominated.
Jev receives original passages, not summaries alone. Each batch is capped
at 20 pairs and a conservative context budget; report `deferred` explicitly.
Unprocessed books have no canonical units yet: do not invent events or start
extraction without a user request. Universe retrieval is graph/name-hint based;
the optional embedding leg of the per-book commands is not used here.

For your own source-supported link, use `universe evidence <library> <world>
<from-qualified-id> <to-qualified-id>` first, then `universe propose` with
those IDs, `--revision <candidate-revision>` and `--reason "..."`.

Review the resulting universe packet independently:

```
novel causality universe show <library-dir> <universe-id> <packet-id> --offset 0 --limit 10
novel causality universe evidence <library-dir> <universe-id> <from> <to> --packet <packet-id> --offset 0 --limit 10
novel causality universe decide <library-dir> <universe-id> <packet-id> --revision <show-revision> --decisions '<JSON-array>'
novel causality universe list <library-dir> <universe-id> --offset 0 --limit 10
```

Read every proposal and both full original spans, following all evidence pages.
Decide each proposal once with `proposalId`, `verdict` (`accept|hold|reject`),
and `reason`. Acceptance additionally requires `temporalReason`: explain from
the text why this cause precedes/brings about this effect, not volume numbering.
Hold uncertain identity, timing or missing evidence. Keep reasons/summaries in
the source language. Changed source, entity identity or membership invalidates
support; cycles are refused. Refresh stale packets rather than reusing old reads.

Universe packets use a reviewed, audited library ledger, NOT per-book
`changeset approve`. Book databases/IDs remain separate. List/read this ledger
for cross-book causes; per-book `novel query` still queries only that book.

## Rules

- The hosted CLI caps each sweep at 20 pairs (default 10). No automatic
  continuation or approval. Read the skill/reference, all proposal/note
  pages and current endpoint evidence before approval; then explicitly
  approve or hold. Standalone causal packets use proposal review, not
  scene-bound `changeset facts`. Existing extraction packets keep their
  semantic fact gate and additionally require both causal endpoints.
- At-birth extraction remains local. The explicit universe pass above adds
  cross-file review over existing canon; it is not global EM, database fusion,
  or an actual-time extraction faculty. Membership alone is not causal evidence.
- Never infer causality from order or adjacency alone. The snapshot
  viewer counts unprojected endpoints instead of guessing, and so do you.
- Never propose a link the text does not directly support, even when the
  candidate legs look strong. Legs nominate; only textual support decides.
- Never edit `relations.jsonl` by hand. `novel fix relate` exists for
  pointwise maintenance, but CAUSES links belong to this skill's paths so
  their provenance stays auditable.
- Embeddings are causality-only (scoped activation): vectors live in a
  rebuildable sidecar under the novel's ontology directory
  (`embeddings.jsonl`) with model + dimension in the bundle manifest.
  They nominate candidates; they never decide a link.
- Timeline: the novel sequence is the timeline for now. A universe
  timeline faculty arrives in a later PR and upgrades the ordering; do
  not build timeline machinery inside causality work.
