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
texts — `novel query` / `novel state` for context, the source file for the
passages — and judge: does A directly bring about B? A cause must precede
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
novel causality sweep <novel-dir>
```

## Rules

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
