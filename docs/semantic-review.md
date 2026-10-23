# Precision-first semantic review

New work-model ingestion separates two responsibilities:

- Code validates source IDs, ordered/nonoverlapping spans, exact scene
  coverage, object IDs and schema/type integrity. Scene/dialogue boundary
  choices, minor event detection and derived summaries are not Pi review
  targets. Source is preserved verbatim, not reconstructed from summaries.
- Pi reviews identities/aliases, speaker/addressee assignments, presence,
  mentions, event participants, relationships/causality and state changes.
  Confidence is not proof and does not automatically accept a fact.

`changeset facts` projects the complete consequential values, ID/name labels,
canonical identity snapshots, derived event context and bounded source excerpts.
Raw scene payloads, all segmentation notes and repeated participation proposals
are not mandatory reading. Matching generated participation edges share the
actor decision rather than requiring a second identical semantic decision.

Pages adapt to a 28-kB byte budget. Follow the actual `page.nextOffset`.
Evidence excerpts explicitly identify remaining context. `--fact <id>` pages
original sentences with neighboring context, with no model calls. Values are
never silently truncated to earn review credit; oversize facts can stay held.

`changeset decide --revision <hash> --decisions '<array>'` records bounded
accept/hold/reject batches with source-grounded reasons. A replacement updates
only that assertion's value; changing presence does not edit speakers, dialogue
spans or event actors. Unrelated decisions are retained. Structural/proposal
changes invalidate the decision revision; changes to canonical context require
fresh decisions. Approved packets are immutable and cannot be reapplied.

`approve` preflights the entire projection before changing packet status or
writing canon. It applies source-valid scene/event organization plus only
verified, type-correct facts with available dependencies. Held identities block
their dependent relations/state/assignments, without publishing aliases or
inventing placeholders. Rejected and unresolved assertions remain in the
original packet for inspection; unresolved dependencies are reported explicitly.
Original proposals are retained, not overwritten with a lossy accepted subset.

The packet may be processed while facts remain held. This allows subsequent
blocks to proceed without asserting unsupported relationships or emotions.
Counters reserve all IDs from approved original packets, including held new
identities, so later extraction cannot recycle those IDs. Releasing old held
facts is not an implicit reapplication path; later recovery requires new
source-grounded work. No automatic resolution or negative fact is invented.

Application events distinguish deferred *facts* from unsupported *proposals*.
`changeset.merged` is not emitted when facts remain held. Pi receipts bind the
semantic decisions and source to the current packet; accepted facts require
delivery of complete fact values and source excerpts. Unreviewed facts default
to hold and do not get fabricated delivery credit. Processing completion is
distinct from `factsComplete`; the frontend reports held semantic facts.

The scoped runner's task prompt remains generic. Operational policy belongs
in the concise skill and its on-demand fact reference. Legacy packets without
`reviewSource` retain their original full-source/full-proposal review path;
they are not retroactively labeled semantically verified. Work-model extraction
rejects `--auto-approve`; the legacy miniloop-only smoke option is unchanged.
Block-wide bulk revision is unavailable on semantic packets because it can
silently remove supported dialogue while correcting unrelated presence.

Raw Cypher results carry an open-world interpretation: no match means unknown,
not proof of absence. Derived summaries are not independently reviewed semantic
assertions. The skill retrieves original evidence when an absent graph fact
matters to simulation. This implementation cannot guarantee an LLM's semantic
judgment; it constrains what is published and makes uncertainty inspectable.

Validation uses synthetic fixtures, mock HTTP providers, actual local CLI
commands and Ladybug queries. This implementation has not yet undergone a new
paid novel run; unit/integration success is not an accuracy or speed claim.
