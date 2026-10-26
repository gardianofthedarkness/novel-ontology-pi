# Pending repair and recall

If `facts` fails with `Duplicate proposal ids`, use this metadata-only repair:

`novel changeset revise <dir> <id> --edits '{"rekeyDuplicateIds":true}' --reason '<structural defect>'`

This is the sole semantic-packet exception to bulk-revision rejection. It
renames all colliding proposal IDs, preserves every payload/source/provenance
and their order, archives the old packet, clears stale decisions and leaves
the packet held. No dropping, merging or choosing between facts; no extraction
or model call. Re-read the repaired `facts` and original evidence before review.
Never use it on an applied packet or combine it with other edits.

Payload-changing bulk edits below are for legacy packets only. Semantic packets use targeted
`facts` / `decide` instead; bulk revision is rejected to protect speakers.
For a legacy packet, read every source line and every proposal/note page,
including after each revision, before approval. Do not retrofit an old
approval into a semantic verification receipt.

`novel changeset revise <dir> <id> --edits '<JSON>' --reason '<reason>'`
preserves the predecessor, records an audit and leaves a fresh held packet.
Review the entire fresh revision before approval. Batch related verified
edits rather than spending one revision per defect.

Edit fields:
- `dropProposalIds`: remove unsupported proposals, including a wrong
  alias-fold upsert; do not drop a valid person's only identity for a typo.
- `removeEntityIds`: remove invalid newly proposed identities and dependent
  references; canonical entities require canonical maintenance instead.
- `sanitizeTypes: true`: remove invalid Character/Location slot references.
- `retypeEntities: [{"entityId":"...","kind":"Organization"}]`: correct a
  new entity's kind without changing its id/provenance. Requires
  `sanitizeTypes: true`. Other kinds: Character, Location, Item, Concept.
- `mentionedOnlyEntityIds`: downgrade presence/actor/speaker references
  throughout this block for people who are ONLY mentioned in the block.
  Do not use this globally for someone present in other scenes.

For an upstream cascade, pin a source-verified correction, then recall:

`novel fix correct <dir> --block <block-id> --key extraction:constraints --value '<JSON>' --reason '<reason>'`

`novel recall <dir> <block-id>`

`recall` is a top-level command, not `novel changeset recall` or `reject`.
For ID-only corruption, prefer the lossless repair above rather than a paid recall.

Constraint fields: `distinctNames` (groups of DIFFERENT identities),
`rejectCharacterNames` (unsupported placeholders), `instructions`
(source-grounded extraction guidance). Same-person aliases must NOT go
into `distinctNames`. Recall preserves the old packet and honors the pin.
Never recall an applied block without a canonical rollback plan. Respect
the supplied limits; do not re-ingest a held block to evade them.
