# Organization proposal

All four arrays are required. Use stable group IDs, source-language titles and
every registered source exactly once. `note` is required (may be empty).
Use `null` for unknown membership/order and `status: "unresolved"` when membership
is uncertain. A confirmed series member can still have `readingOrder: null`.
Unresolved rows never enter series/universe/continuity scoped results.

```json
{
  "universes": [{"id": "world-a", "title": "世界甲", "evidence": [{"sourceId": "<registered-source-id>", "field": "text", "offset": 0, "quote": "<exact source quote>"}]}],
  "continuities": [{"id": "main", "universeId": "world-a", "title": "正史", "evidence": [{"sourceId": "<registered-source-id>", "field": "title", "quote": "<exact title substring>"}]}],
  "series": [{"id": "series-a", "title": "故事甲", "evidence": [{"sourceId": "<registered-source-id>", "field": "filename", "quote": "<exact filename substring>"}]}],
  "assignments": [{"sourceId": "<registered-source-id>", "seriesId": "series-a", "continuityId": "main", "readingOrder": 1, "status": "confirmed", "evidence": [{"sourceId": "<registered-source-id>", "field": "text", "offset": 0, "quote": "<exact source quote>"}], "note": "<why this source belongs here and why this order>"}]
}
```

Evidence fields: `filename`, `title`, or `text`. Text quotes require an exact
zero-based character offset from `library evidence`; that CLI uses JavaScript
UTF-16 offsets. Each quote is at most 2000 characters. A confirmed assignment
needs evidence from its own source. Nonempty group evidence is required too.
Exact quote checks establish provenance, not semantic truth: the main agent
must still review whether it actually supports the membership/order assertion.
Shared characters or similar titles alone do not establish a shared continuity;
use original-text evidence or leave that relationship unresolved.

Reading positions must be nonnegative numbers, unique per series/continuity
among confirmed rows. Gaps and unknown positions are allowed. Prequels/side
stories do not change source IDs; reordering requires another reviewed plan.
Different continuities can belong to one universe without merging their facts.

`library propose` accepts a JSON file or inline `--organization '<JSON>'` at most
2 MiB and returns a plan ID,
review revision, base catalog revision and full normalized organization.
`library plan <dir> <plan-id>` reads that proposal and reports if it is stale.
`library decide` requires the exact review revision and a reason. Catalog
changes invalidate old plans; a decision is recorded in a new immutable history
checkpoint. Holds/rejections leave organization unchanged. To undo an applied
grouping, propose its replacement against the current catalog revision; never
overwrite history or restore old source/workspace files.

`show` and `plan` accept `--offset N --limit 1..20`. Their paged `items` are
ordered universe, continuity, series, then source (`show`) or assignment (`plan`).
Follow `page.nextOffset`; the plan revision covers the entire plan, not one page.
Hosted approval requires successful reads of every item and each exact cited
metadata/text source at the current catalog revision. Failed/oversized reads do
not count. Reordering/grouping changes metadata only, never extraction job IDs,
database identities, approved source prefixes or entity-match decisions.
