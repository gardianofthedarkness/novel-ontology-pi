# Novel Ontology — Pi Skill + CLI Bundle
## Founding design (v0.1, 2026-10-21)

Turns a novel in any language into an ontology — characters, events,
causality, timelines — that powers character simulation and
parallel-universe story forking. Rebuild of
`gardianofthedarkness/agentic_chinese_novel_discord_bot` on a clean,
embedded, no-Docker architecture.

> **System 1 has its own detailed design site:**
> [`docs/system1/index.html`](docs/system1/index.html) — organized by
> **functional sector** (one page per sector of the repo, in pipeline
> order: sectioning, each decision patch, the miniloop engine, extraction,
> merge gate, storage, timelines, simulation). Every sector page follows
> the same structure: what it does → its own animated demo → design
> details → implementation mapping → open questions for that sector only.
> This document covers the whole and only summarizes System 1.

> **v2 (2026-10-30 →, branch `v2`) has its own design documents** in
> [`docs/v2/`](docs/v2/): the frame they all follow is
> [`docs/v2/world-model.md`](docs/v2/world-model.md) — the world model
> (places and times are spacetime and form trees; matter moves through it
> as a graph; spatial relations tie the two), its laws, and the layers
> that read a novel into it. §6a below summarizes it.

---

## 1. Settled decisions (Qiguang, 2026-10-21)

| Decision | Choice |
|---|---|
| Language / runtime | TypeScript on the Pi agent (`earendil-works/pi`) |
| Repo | New repo; the old one stays as reference/design salvage |
| Form factor | Pi-agent-compatible **Skill + CLI bundle**: SKILL.md teaches the Pi agent the workflows; the CLI implements *all* functionality |
| Frontend order | CLI-first; the playground frontend watches the event stream (sector 13). Discord was the legacy bot form factor, superseded by the Pi Skill + CLI bundle |
| Ontology storage | Embedded only — no Docker, no hosted server. Canonical form is a portable JSONL bundle; Ladybug is the hot query engine rebuilt from it |
| Internal language | All storage naming, schema, types, relations and mechanisms in **English**, so novels in any language map to the same paradigm |
| Bring-your-own-novel | Download, drop in a novel, provide two keys, it works |
| Timelines / forking | Canon is a timeline; the **user selects a time point** to fork a parallel universe |
| Model routing | User provides **one work LLM API** (generation) + **one decision model** (Jev, TypeSafe AI). Jev is a key user input; a key will be provided for testing |
| System 1 | An **autostep miniloop inside the CLI**: a Jev-based recursive decision system over auto-sectioned sentences, organized as **decision patches** (one patch per functionality) |
| Ingestion | Rolls **block by block** (chapter / long block); the miniloop accumulates proposed changes; the **main agent approves, holds, or sends back for revision** at a merge gate |

## 2. Architecture — two loops, one boundary

```
System 2 (outer)   Pi agent + SKILL.md
                   Workflows: ingest → review → query → simulate → fork.
                   Holds the full context: conversation, memory, user
                   intent, long-range consistency. Reviews every merge.
                   NEVER touches the DB or Jev directly — only the CLI.
                              │  CLI commands, JSON in / JSON out
System 1 (inner)   The CLI  (all functionality, unit-testable, no LLM needed for tests)
                   ├─ sectioning        deterministic code, no model
                   ├─ autostep miniloop decision patches over Jev
                   ├─ extraction        work LLM, per scene (not per chapter)
                   ├─ merge gate        ChangeSets: accumulate → review → apply
                   └─ connectors        Ladybug │ bundle │ Jev │ work LLM │ embeddings
```

Why the boundary matters: everything in the CLI is deterministic code +
typed decisions, so ingestion is testable on a golden chapter with a
mocked Jev connector and zero model spend. The Skill stays a teaching
document, not a codebase.

Pi packaging note: Pi loads a skill's name/description at startup and the
full SKILL.md only when a task matches, so the frontmatter description
*is* the routing signal — keep it tight.

## 3. Storage — bundle is truth, Ladybug is the hot engine

**Ladybug** (formerly Kuzu): an embedded property-graph database —
Cypher, columnar storage, ACID, one `.lbug` file, in-process. It natively
provides **full-text search (BM25)** and a **vector index (HNSW)** in the
same engine, which removes the old stack's Neo4j *and* Qdrant *and*
Postgres *and* Redis — all five Docker services collapse into the CLI.

Retrieval pattern (GraphRAG in one engine): vector/FTS search finds seed
nodes → Cypher traversal walks causal / presence / timeline edges.

Caveats designed around:
1. **Closed schema** — node/relation tables are declared up front
   (`src/ground/ontology/schema.ts`). New types = a CLI migration.
2. **Vector dimension is fixed** at index creation — the embedding model
   is recorded in the bundle manifest; changing it means `graph reindex`.
3. **One writer + many readers** — exactly a CLI's access pattern.

Per-novel layout:
```
novels/<novel-id>/
  source/                 the novel file the user dropped in (unchanged)
  ontology/
    manifest.json         novel id, schema version, embedding model +
                          dimension, source language(s), pinned Jev version
    entities.jsonl  relations.jsonl  events.jsonl
    scenes.jsonl    timelines.jsonl  branches.jsonl
    graph.lbug            rebuilt from the bundle — disposable
  branches/<branch-id>/   delta events + fork-point state snapshot only
```
All DB access goes through one `OntologyStore` interface
(`src/ground/ontology/store.ts`), so the engine can be swapped without touching
the miniloop or extraction. Sharing an ontology = copying the folder.

## 4. Schema v1 (original-language content, English process, language-neutral identity)

- Identity: opaque IDs only (`char_000123`, `evt_…`). Names are data:
  `names: [{ text, lang, kind: canonical|alias|nickname|title }]`.
- Schema keys are English; names, summaries and verbatim source retain the
  novel's original language/script. Sentence IDs/offsets are provenance,
  not mandatory speaker-assignment units.
- Node tables: `Character | Location | Organization | Item | Concept |
  Event | Scene | Timeline | Branch`
- Relations: `CAUSES | CAUSED_BY | PARTICIPATES_IN | PRESENT_IN |
  MENTIONED_IN | LOCATED_AT | KNOWS | SPEAKS_TO | ADDRESSES | OWNS |
  MEMBER_OF | STATE_BEFORE | STATE_AFTER | FORKS_FROM | PRECEDES`
- Event types: `dialogue | action | revelation | conflict | movement |
  decision | introduction | resolution | other`
- Character state at a point = **fold of the event stream** up to that
  point — never a mutable "current state" row.
- Fork: `Branch { id, parent_timeline_id, fork_event_id, label }`
  shares the canon prefix (no copying), snapshots state at the fork
  event, then appends only its own delta events. Canon is never mutated.

### Dialogue cards: exchange-level participation (owner decision, 23 October 2026)

A dialogue card is an exchange, not a single-speaker turn. Two or more
people may speak inside it; monologues are also valid. Store a stable card
ID, original source sentence IDs, an unordered set of participating Character
IDs and an optional source-language summary. Do not assign individual
sentences to speakers/addressees or split an exchange when the voice changes.
Brief intervening narration is acceptable; source text remains available in full.

Dialogue selection runs independently of scene segmentation. Participation
waits for the selected exchange and source-grounded identity candidates, then
uses bounded original/neighbor context: S1 membership questions per candidate,
bounded S1 context widening for uncertain membership, then S2 only for unresolved
membership. This is a set-valued task, never one winner among all characters.
Scene joins preserve card identity and source provenance rather than inventing
speaker labels. Legacy turn records remain readable, not retroactively verified.

Pi reviews each participant's membership independently, not text organization
or a sentence-speaker map. Hold an uncertain member, not the entire exchange
or its supported members. Merely mentioned people and bystanders are not
automatically dialogue participants. Card co-membership does not imply physical
presence, a directed utterance, KNOWS/SPEAKS_TO, an emotion or a relationship.
Those consequential assertions still require their own source support.

Entity matching is upstream identity resolution, not evidence of participation.
PR36's alias/fragment-at-birth and matching backstop are relevant, but confidence
alone must not bypass the semantic merge gate or silently fuse distinct people.
ID remaps must preserve card membership, deduplicate members and invalidate
pending decisions tied to earlier canonical context. PR36 is not implicitly merged.

The product benchmark is participant precision/recall, exact participant sets,
wrong members, missing/held members and identity conflations per dialogue card.
Report raw extraction and applied canon separately. The old 38-sentence speaker
scores remain historical diagnostics, not product acceptance criteria. See
[dialogue-card benchmark protocol](docs/dialogue-card-benchmark.md).

### Open main next steps — series, universes and story time (2026-10-25)

A source file is not necessarily a whole story. **Phase 1:** a separate, concise
`novel-library` skill + `novel library` CLI now let the main agent propose/review
series and universe/continuity membership and volume/reading order. Phase 1 uses
federated, stable-document-ID workspaces and source bindings to prevent collisions;
reordering never renumbers facts. Existing databases are not concatenated or
migrated, and grouping never automatically merges entities or starts ingestion.

**Phase 2:** different series in one universe may overlap in time or place. Add a
time faculty with first-class, evidence-backed temporal nodes/constraints, then a
Solidifier global alignment pass. Reading/publication order is not necessarily
story chronology; time precedence is not causality; shared universe is not an
automatic entity merge. Preserve parallel/unknown/conflicting times and separate
continuities. **Phase 1 is locally implemented; phase 2/time schema remains open.**

See [series, universe and time design](docs/series-universe-time.md) for the
skill/CLI contract, source-ID blocker, dependency flow, at-birth/global distinction,
frontend boundary and acceptance criteria.

**Universe causality is locally implemented:** an explicit post-extraction pass
can nominate and review cross-file event/dialogue causes within confirmed shared
continuities. Source-qualified IDs and an independently reviewed library ledger
preserve book isolation. Reading order/name overlap alone proves neither time,
identity nor causation. See [universe causal contract](docs/universe-causality.md).
The time faculty, global EM and physical graph fusion remain separate open work.

## 5. The processing model — blocks and the merge gate

### One semantic gate for every faculty (settled 26 October 2026)

**A new faculty or flow must not invent its own review/approval gate.**
Ingestion facts, standalone causal assertions, cross-book causal assertions and
library organization use `novel review show|evidence|decide|apply`. Scope is a
parameter (`book`, `universe`, `library`), not another agent workflow. Decisions
always use `factId`, `accept|hold|reject`, a source-grounded reason and an optional
supported semantic correction. `decide` stages; only explicit `apply` publishes.

Faculty code supplies assertions, readable meaning, provenance and domain
validators to the shared contract. Storage adapters preserve book isolation,
the universe ledger and atomic organization plans. They may add requirements
(both causal endpoints, actual temporal evidence, endpoint kinds, cycle checks),
but cannot weaken evidence/revision/hold rules or add an independent accept path.
Do not add a new scope just because a new faculty exists: reuse the appropriate
storage adapter and extend its typed assertion support, failing closed until it
is registered. Unsupported legacy packets must not be auto-converted/approved.

The same gate owns bounded pages, revision-bound read coverage, staged decisions,
default holds, audit history, application and duplicate-apply prevention. New
assertion types require contract tests for incomplete/stale evidence, unknown
identities, holds/rejections, scope isolation and repeated application. Legacy
CLI spellings are compatibility interfaces, not examples for new faculties;
the scoped Pi host directs all review through the shared protocol.

Implementation and migration: [unified review contract](docs/unified-review.md).

This is how a novel actually gets ingested, end to end:

```
┌─ for each block (one chapter, or a long block of text) ────────────┐
│  1. SECTION     code splits the block into sentences (stable IDs,   │
│                 offsets = provenance for everything downstream)     │
│  2. MINIloop    decision patches run over the sentences; every      │
│                 conclusion becomes a PROPOSAL                       │
│  3. EXTRACT     work LLM reads the structured scenes and proposes   │
│                 events, causality, state changes                    │
│  4. ACCUMULATE  all proposals collect into ONE ChangeSet for the    │
│                 block — the main graph is NOT touched               │
│  5. MERGE GATE  the main agent reviews the ChangeSet:               │
│        approve → proposals applied to the main graph; roll on       │
│        hold    → nothing applied; processing pauses; user consulted │
│        revise  → named parts go back; the miniloop re-runs ONLY     │
│                  those parts and returns a revised ChangeSet        │
└─────────────────────────────────────────────────────────────────────┘
        … repeat until the novel the user asked for is done.
```

Why a human-shaped gate with an agent behind it: the miniloop is fast
and local, but it cannot hold what the main agent holds — earlier
chapters, naming consistency across a whole book, who a nickname really
belongs to, the user's intent. Making the fast system *propose* and the
context-rich system *decide* is the core safety property of the design.
ChangeSets are also the audit trail: every node in the graph can answer
"which block, which sentences, which patch, what confidence, who
approved you."

## 6. System 1 — summary (detail lives in docs/system1/index.html)

- **Decision patches.** Each functionality is an independent patch with
  its own Jev questions, primitives, and confidence gates:
  `scene-boundary`, `dialogue-detector`, `name-detector`,
  `presence-detector`, `dialogue-participants`, … Adding a functionality
  = adding a patch. Patches run in a fixed order and pass accepted
  decisions to each other.
- **Rule zero:** never ask a model what code can compute exactly.
  Sectioning, offsets, and scanning for *known* names are code. The
  decision model only judges what is genuinely ambiguous: which
  sentences are dialogue, whether a candidate is a *new* name or a
  nickname, who is present vs. merely mentioned, who participates in an exchange.
- **Primitives:** `noul` (yes/no → probability), `choice` (one pick from
  a fixed set), `score` (ordered scale). Presence must be one `noul`
  per candidate — `choice` can only return a single pick.
- **Recursion:** high confidence → accept and advance; middling →
  expand the context window and re-ask; split/low or a discovery →
  subdivide, or escalate that unit only to the work LLM.
- **Output is structure + proposals**, never text and never writes:
  scenes, multi-participant dialogue cards, and a ChangeSet.
- The full patch catalog (state changes, event-worthiness, causal
  candidates, foreshadowing, …) and the animated walkthrough are on the
  System 1 page — kept as an **open discussion list** to cut, keep, and
  add to together.

## 6a. v2 — the world model and its layers (2026-10-31)

Detail: [`docs/v2/world-model.md`](docs/v2/world-model.md); the reading
flow in [`docs/v2/world-engine-v2.md`](docs/v2/world-engine-v2.md), the
context engine in [`docs/v2/context-engine.md`](docs/v2/context-engine.md),
the visual context engine and terrain in
[`docs/v2/visual-context-engine.md`](docs/v2/visual-context-engine.md).

- **The world model.** A novel's world is spacetime and matter. Places
  and times are spacetime: each is a **tree** (a place has one parent,
  graded by scale region › city › district › street › building › room;
  time is an ordered tree, story › year › day › part of day, its children in
  story order). People, crowds, things,
  vehicles and weapons are matter: movables, related as a general
  **graph**. **Spatial relations** tie them: a movable is at one place at
  a time (the occupancy matrix), at a level inside it (on the ground,
  underground, on the roof). The world engine holds occupancy by scene
  continuity; the text's spatial relations interrupt or correct it when
  they come in. Places and matter are separate entity kinds
  in every system, because their laws differ.
- **The laws as checks.** The place tree's containment matrix has one 1
  per row but the roots', n − r ones, no loops, and is graded by scale;
  the decision for a place is one parent from a few larger candidates.
  A movable's occupancy row has at most one 1 at a time; a change of it
  is a move.
- **The layers, decoupled.** 1 plain extraction (mentions, typing with a
  place's scale, spatial words, time words) → 2 entity recommendation
  (candidates scored by code: the matter recommender, the place
  recommender) → 3 context composition (modes, sources, budget, manifest;
  facts by Cypher over the reading's own graph) → 4 decisions (EM, EM²,
  place EM, story time: Jev on the composed state) → 5 the world model's
  stores → 6 the world engine (terrain, births, movement), which reads the
  model and never redoes extraction. No layer does another's job.
- **Place EM** replaces EM²'s place questions: the tree by the place
  recommender with Jev only where it is unsure, each scene's setting,
  unnamed places as leaves under the setting, what descriptions mean
  (learned as the book goes, like EM²'s habits), and occupancy evidence.
  On vol 1's saved reading: 26 place questions in 11 requests, against
  about 546 in EM²'s.

## 7. CLI command surface

```
novel init <path>                  create a novel workspace + manifest
novel section <file>               deterministic sectioning only (free)
novel ingest <file>                section → miniloop → extract → ChangeSet
novel miniloop run|inspect         run the Jev loop; inspect decisions
novel changeset list|show|approve|hold|revise
                                   the merge gate
novel query <novel-dir> <cypher>   graph traversal via OntologyStore
novel search <novel-dir> <text>    graph-first text search (CONTAINS scan;
                                   FTS + vector deferred, §9)
novel timeline list|show <novel-dir> [id]
                                   browse fork points by importance
novel fork create --at <event-id> --label <name>
novel simulate <character> [--branch <id>]
novel bundle export|import         portable ontology in / out
novel graph build|reindex          (re)build Ladybug from the bundle
novel llm ping|probe               work-LLM plumbing smoke tests (tiny
                                   completions; not wired into ingest)
novel inspect <novel-dir>          corpus diagnostics over the bundle
                                   (counts, coverage, integrity tallies)
novel eval run <dataset> <preds>   golden-chapter scoring of prediction
                                   files (precision/recall; metrics only)
novel config                       model routing (keys via secure entry)
```
JSON out by default, `--pretty` for humans.

## 8. Test plan that costs nothing

1. Golden chapter fixture (short, dialogue-heavy, multi-character).
2. Sectioning unit tests: CJK punctuation, nested quotes, abbreviations. ✅ (in repo)
3. Miniloop tests with a **mocked Jev connector** returning recorded
   probabilities — verifies gates, recursion, and ChangeSet accumulation. ✅ (in repo)
4. Bundle → Ladybug rebuild round-trip: same answers after a rebuild.
5. Only then: one live chapter with the real Jev key + one work LLM.

## 9. Open questions (to plan together)

Progress and decisions are tracked on the dashboard's roadmap page
(`docs/system1/roadmap.html`) — updated in GitHub every time something
completes. Decided 2026-10-21: first test novel = re-ingest the legacy
Index corpus; work LLM for testing = DeepSeek API; embeddings =
DEFERRED — graph-first, no embedding model until relational Cypher is
proven insufficient for a concrete need (fallback design: local CPU
model ~500–1000 dims + Jev post-selection over the top-32); name
candidates = hybrid (below).

- **Patch catalog details** — the full candidate list is on the System 1
  page. Which patches are v1, which wait? Current skeleton: scene
  boundary, dialogue detector, name detector, presence, speaker.
- **Name-candidate generation** — DECIDED: plain-text scan against a
  cumulative registry of every name ever seen in the novel; a new
  candidate triggers a zero-context LLM call to extract the new name.
  Remaining: which surface patterns nominate candidate spans.
- **Merge revision granularity** — when the main agent sends a ChangeSet
  back, what is the unit of revision: a proposal, a scene, a patch's
  whole output for the block?
- **Confidence thresholds** — starting proposal: accept ≥ 0.85,
  re-ask 0.55–0.85, escalate < 0.55 (per patch). To tune with the test key.
- **First test novel** — DECIDED: re-ingest the legacy Index corpus.
- **Embedding provider/model** — DEFERRED (2026-10-21): graph-first.
  Phase 1's retrieval layer is pure Cypher (src/ground/ontology/retrieval.ts);
  an embedding model is added only when a concrete need defeats it.
  Fallback design: lightweight local CPU model (~500–1000 dims) + Jev
  post-selection over top-32 candidates.
- **Jev access route** — he has an API and will provide it later;
  route (direct vs. gateway) settled at handover, via secure entry.
