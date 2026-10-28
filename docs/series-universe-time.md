# Series, shared universes and story time

Status: **phase 1 implemented locally; phase 2 open**, 2026-10-25.
The separate `novel-library` skill and `novel library` CLI now implement reviewed
organization using federated, source-bound workspaces. No existing live session
was restarted or database migrated. Time nodes/global alignment remain a design
contract, not an implemented schema or faculty.

## Phase 1 implementation

- `library init|add|show|evidence`: immutable content-based document IDs, original
  titles/filenames, byte-identical deduplication and bounded original text reads.
- `library propose|plan|decide`: complete evidence-backed organization plans,
  catalog and plan revision checks, explicit approve/hold/reject, unresolved
  assignments excluded from scoped results, immutable history checkpoints.
- `library prepare`: offline EPUB/album intake or UTF-8 copying into one isolated
  workspace per document; separate runner-compatible input copy. No model calls,
  ingestion, fact approval or automatic identity merging.
- `ontology/source.json`: binds text hash, stored filename and cut size. Resume
  rejects changed text/cut size; recall uses the exact bound source. One unchanged
  legacy source can bind without changing local IDs; ambiguous multi-file legacy
  layouts fail closed and require explicit migration.
- Source qualification is `(document ID, local record ID)` across workspaces,
  not global chapter renumbering. Series/universe/continuity scopes return source
  references, not an implicitly fused Cypher graph. Existing per-file graph and
  semantic merge gates remain the same.

See [usage](../README.md#multiple-files-and-series), the
[skill](../skills/novel-library/SKILL.md) and its
[plan schema](../skills/novel-library/references/organization.md).

**Live-view integration is now locally implemented:** safe library activity joins
snapshot/SSE updates; the existing orbital renderer adds series and ordered file
scopes, proposal/held ghosts and activity following. Deployment needs explicit
library configuration and source bindings; an older running preview does not
automatically gain it. See [live series view](library-live.md).

## The distinction we need

A file is a source artifact, not necessarily a whole story or an isolated world.
One series can span many ordered volumes. Different series can share a universe
while describing different periods, places or overlapping events.

Keep these dimensions separate:

- **Source/document**: immutable identity, original filename, content hash,
  edition/translation metadata, local chapter/block/span provenance.
- **Series and volume**: editorial grouping and reading/volume order. A series
  can have main volumes, side stories, prequels and uncertain placement.
- **Universe and continuity**: the shared setting and the particular compatible
  canon. Adaptations, reboots, alternate continuities and simulation branches
  must not silently become one set of facts.
- **Story time**: when events actually happen inside that continuity. It can be
  partially known, concurrent or contradictory; it is not source position.

Volume order is an important sequence to browse, but is not proof that every
event in volume 2 happens after every event in volume 1. Publication order,
reading order, ingestion order and in-world chronological order are separate.

```text
Library sources
  → catalog/identity validation
  → separate series/universe organization skill + CLI
      → proposed series membership + volume/reading order
      → proposed universe/continuity membership
      → review → versioned catalog plan
          → existing per-source Digger → semantic gate → applied facts
              → at-birth time faculty: textual time anchors + constraints
                  → reviewed temporal facts
                      → global temporal reconciliation across sources/series
                          → timeline views, scoped queries, later simulation
```

The diagram shows data dependencies, not a requirement to block all extraction
until global time is known. Local temporal observations can stream as source
spans/scenes/events become available; unresolved alignment remains explicit.

## Phase 1 — organize a multi-file series safely

Give the main agent a **separate, concise organization skill** and corresponding
CLI surface. Do not bury this reasoning in the extraction prompt, frontend file
picker or a list of hard-coded series names. The skill teaches a workflow; the
CLI owns validation, persistent identity, proposals and audited application.

Workflow contract (implemented by the phase 1 command group above):

1. Inspect the selected source catalog and bounded relevant source evidence.
2. Propose which documents belong to a series and compatible universe/continuity,
   and their volume/reading order. Filenames, EPUB metadata and explicit text are
   evidence, not individually authoritative rules. Preserve original-language
   names/titles. Same author, matching names or similar titles alone are not proof.
3. Expose rationale/evidence references, unknown membership, order gaps, duplicate
   editions and conflicts. Ask the user about genuinely ambiguous organization;
   do not invent a date or force an unrelated work into the nearest series.
4. Review and apply a versioned organization plan through the CLI. Keep uncertain
   memberships/links pending and unrelated universes isolated. Plan changes must
   be reversible/auditable without rewriting original source or applied IDs.
5. Ingest selected volumes with explicit source-qualified references, then query
   the series/universe scope. Same-universe identity candidates still require EM
   evidence and the existing semantic safeguards; grouping is not entity merging.

### Source identity before shared ingestion

Claude's unfinished draft identified a concrete collision in the current CLI:
each file starts with blocks `b0001…`, changesets use `cs_${blockId}`, recall can
find the first matching block across source files, and viewer chapter keys use
`chapter_<index>`. Feeding a second volume into an existing first-volume workspace
can mistake its blocks for already-approved work. **Do not use shared-workspace
multi-file ingestion until this is fixed and tested.** The hosted runner currently
avoids that collision by assigning separate per-book workspaces.

The remaining requirements for any later physical consolidation/migration:

- Stable document IDs and source-qualified block/chapter/scene/event/proposal
  references throughout ingest, recall, source lookup, drafts, review revision
  digests, matching evidence, graph projection and live activity.
- Keep source-local indices separate from derived series display order. Do not
  mint permanent identity from a mutable volume position or globally incremented
  chapter offset: inserting a prequel must not rename existing facts.
- Duplicate content/editions need explicit handling; identical bytes, alternate
  translation and distinct narrative volume are not equivalent categories.
- Phase 1 chooses **federated per-source workspaces** with reviewed organization
  and scoped source references. A shared canonical graph or cross-book identity
  layer is still future work, not implied by the word "merge". Preserve provenance
  and continuity boundaries before extending it.
- Migrate legacy single-file/per-book bundles only through a planned mapping
  with checkpoints, audit, dry-run validation and rollback. Do not renumber the
  active test databases or silently bypass the runner's ordered review gates.

Claude's archived `--volume` draft is an untested suggestion, not an accepted
implementation. A shared registry and chapter offsets alone do not settle the
above identity, migration and continuity questions.

## Phase 2 — shared universes and a first-class time faculty

The explicit, reviewed cross-book causal ledger is now implemented separately:
see [universe causality](universe-causality.md). It uses existing canonical units
and source-qualified endpoints within reviewed continuities; no book database
fusion, global EM or actual-time faculty is implied. The temporal design below
remains open work.

Different series sharing a world are not necessarily consecutive. They may run
in parallel, occur centuries apart, overlap one incident from different viewpoints,
or disagree. Preserve series identity and align only what evidence supports.

Add a **time faculty** to the dependency-aware extraction graph. **Phase 1 of
it is implemented** at scene granularity — TimePoint entities, OCCURS_DURING,
Jev flashback marks, periods and an estimated story order within one book;
see [story time and places](time-place.md). Global temporal alignment across
books is now the [universe calendar](universe-calendar.md): one clock per
universe that every book's periods are placed on. Existing narrative timeline/PRECEDES handling is not
proof of this capability.

Proposed temporal model, subject to schema design:

- Time anchors as nodes: points, intervals and explicit unresolved/relative
  anchors, scoped to a universe, continuity and calendar/time system.
- Each observation retains original time wording, source/span evidence, precision,
  bounds where supported, an anchor reference and uncertainty/review status.
- Separate explicitly stated dates from derived normalization. "Next morning"
  remains relative to an evidenced anchor; do not fabricate a Gregorian date or
  timezone. Fictional calendars need an explicit mapping, not an implicit one.
- Event/scene links to anchors plus temporal constraints such as before, after,
  overlaps, during and same-time. These relation names are proposals, not current
  schema declarations. Absence of an order is unknown, not simultaneity.
- At birth, nominate local expressions/relations using bounded source context;
  use the established S1 → bounded context widening → S2-if-unresolved policy
  where applicable, with shared budgets. Deterministic parsing/constraint checks
  belong in code. Never promote an uncertain guess into canon.
- Globally, reconcile new anchors against previously reviewed evidence across
  scenes, volumes and series. Check contradictions, incompatible calendars and
  impossible strict-order cycles; hold conflicting links instead of rewriting
  history or treating ingestion sequence as physical time.
- Temporal assertions are consequential facts: independent semantic review,
  versioned provenance and invalidation after relevant identity/context changes.
  Revisions/retractions must invalidate dependent derived alignments and cached
  views. Local uncertainty must not require re-review of harmless segmentation.

Time order does not prove **CAUSES**. Overlapping events do not prove the same
event or shared participants. Cross-series entity/event equivalence still needs
its own evidence; chronology merely helps bound retrieval candidates.

Keep a partial order for story time. A deterministic tie-break may produce a
stable UI list, but label it as display order, not an asserted before/after fact.
Parallel tracks must remain visible rather than forced into a single total order.
Existing append/review order is a reproducible audit sequence, not story time.
Later character-state folding and fork selection need explicit semantics for
incomparable/conflicting events; do not silently change their current behavior.

### At birth versus long-term maintenance

At birth, extract source-grounded time facts for the newly ingested material.
In the **Solidifier**, a later global temporal reconciliation pass should maintain
cross-volume/series alignment as evidence grows, alongside but separate from
global EM and causal maintenance. Simulation/user-chat turns add branch-local
temporal observations; they must not rewrite source canon or another continuity.
This long-term pass and simulation integration remain planned, not production.

## Frontend contract and coordination

Claude's separate frontend branch now has a file picker and location path. That
selects assigned books; it does **not** implement series inference, shared canon
or global chronology. Keep its work separate from backend/skill implementation.

The target navigation is universe/continuity → series → volume/file → chapter
→ scene group → scene/record. Keep source-reading order and in-world-time views
distinguishable; expose the evidence/status for inferred placements. Do not make
switching books start ingestion, mutate grouping or send the main agent a prompt.
Reader selection remains separate from the active agent's book/scope.

The local implementation now adds library → series/continuity → file scopes to
the existing renderer; a separate universe navigation page remains future work.

## Acceptance before claiming this works

- Two volumes with local `b0001` / chapter 0 ingest without skips/collisions;
  recall, review, source text and live ghosts resolve the correct original file.
- Re-ingest is idempotent; volume insertion/reordering preserves all existing
  references; unsupported cross-universe queries/EM cannot leak identities.
- Same-series volumes, unrelated books with matching character names, editions,
  prequels and ambiguous metadata produce the correct grouping or explicit hold.
- Shared-world series support parallel periods/locations without automatic fact
  fusion. Flashbacks separate narrative position from actual story time.
- Explicit date, relative day, unknown date, overlapping intervals, fictional
  calendars and contradictory evidence are tested; uncertainty remains visible.
- Report organization/order correctness and temporal-link precision separately
  from coverage/missing/held facts. No accuracy claim exists for this plan yet.

Phase 1's synthetic two-EPUB test exercises registration → reviewed series plan
→ isolated preparation → two independent held ingestion gates with local Jev
wire mocks. It proves collision avoidance/workflow, not real-world grouping or
temporal accuracy. The time faculty and global alignment remain phase 2; physical
legacy consolidation and cross-book EM are not implemented.
