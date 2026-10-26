# Precision-first semantic review

The canonical agent interface is now the [shared review contract](unified-review.md):
`novel review show|evidence|decide|apply --scope book|universe|library`.
Historical spellings below describe the underlying compatible book fact API;
new faculties must reuse the shared gate, not create their own approval flow.

New work-model ingestion separates two responsibilities:

- Code validates source IDs, ordered/nonoverlapping spans, exact scene
  coverage, object IDs and schema/type integrity. Scene/dialogue boundary
  choices, minor event detection and derived summaries are not Pi review
  targets. Source is preserved verbatim, not reconstructed from summaries.
- Pi reviews identities/aliases, dialogue-card participant memberships, presence,
  mentions, event participants, relationships/causality and state changes.
  Confidence is not proof and does not automatically accept a fact.

New dialogue cards represent exchanges with any number of participants, not
one speaker. `dialogue-member` facts each hold one Character ID, with `cardId`
and `candidateOnly` metadata. Each member can be accepted, replaced, rejected
or held independently. A decision applies to all scene-cut fragments sharing
that card ID; source spans and other members remain untouched. Initially
unresolved candidates do not materialize unless independently accepted.
Legacy `turn` facts are retained only for older single-speaker packets.

`changeset facts` projects the complete consequential values, ID/name labels,
canonical identity snapshots, derived event context and bounded source excerpts.
Each fact also exposes human-readable identity `meaning`. Pi judges those names
and roles against the source, not opaque storage IDs. `semanticReplacement` binds
displayed names/registered aliases to current unique identities in the CLI before
the same type, source, dependency and revision checks; raw replacements remain
compatible. See [identity flow](identity-flow.md) for the mapping and boundaries.
Raw scene payloads, all segmentation notes and repeated participation proposals
are not mandatory reading. Matching generated participation edges share the
actor decision rather than requiring a second identical semantic decision.

Pages adapt to a 28-kB byte budget. Follow the actual `page.nextOffset`.
Evidence excerpts explicitly identify remaining context. `--fact <id>` pages
original sentences with neighboring context, with no model calls. Values are
never silently truncated to earn review credit; oversize facts can stay held.

`changeset decide --revision <hash> --decisions '<array>'` records bounded
accept/hold/reject batches with source-grounded reasons. A replacement updates
only that assertion's value; changing presence does not edit dialogue members, dialogue
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

Pages expose `reviewed`, `unreviewed` and `explicitHolds` to distinguish recorded
decisions from default holds rather than repeatedly reviewing completed pages.
Validation uses synthetic fixtures, mock HTTP providers, actual local CLI
commands and Ladybug queries. The earlier speaker-based live attempt stopped
in a review loop; it is not validation of the new dialogue-card contract. No
new paid card-based novel accuracy or speed result is claimed.
