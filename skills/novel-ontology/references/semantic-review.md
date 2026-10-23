# Fact review

`novel changeset facts <dir> <id> --offset 0 --limit 20`

Pages are byte-bounded. Follow the returned `page.nextOffset`, not your
requested limit. Facts contain complete assertion values, names, event
context and original-source excerpts. Excerpts are not exhaustive; inspect
`evidencePage.nextOffset`. Read more when ownership, a speaker, emotion or
relationship is unclear:

Page-level `labels`, `events` and `evidence` dictionaries are shared by facts
through `eventIds` and `evidenceIds`; source ranges summarize citation IDs,
not assertion values. Dialogue speaker evidence does not imply physical
presence: remembered speech can retain its speaker without present-time
presence. Verify communication versus thoughts/quoted labels, not perfect
dialogue boundaries or incidental narration.

`novel changeset facts <dir> <id> --fact '<fact-id>' --offset 0 --limit 12`

Use the current `revision` to record batches of at most 50 decisions:

`novel changeset decide <dir> <id> --revision '<hash>' --decisions '[{"factId":"...","verdict":"accept","reason":"source-grounded explanation"}]'`

Verdicts: `accept`, `hold`, `reject`. Omitted decisions default to hold.
Accept requires adequate source evidence, not a high confidence score.
Use an optional `replacement` on an accepted decision to correct just its
value; keep its field shape. A turn value is `{speakerId,addresseeId}`;
presence/mention is an array of character IDs; actors is
`{primaryActors,affectedCharacters}`. Identity replacements retain the ID
and use only existing candidate/source name forms. Hold a fused identity
instead of guessing a split. A missing speaker remains null, not narration.

Decisions preserve unrelated facts and segmentation. A presence correction
must not change a turn, addressee or event actor. Relations and emotions
remain held until independently supported, even if nearby events are clear.
An accepted assertion whose identity dependency is held remains deferred;
the decision command reports this explicitly.

Approve once the source-supported decisions are recorded. Unreviewed facts
remain absent from canon and retained in the original packet for retrieval;
do not claim they were verified. Approved packets are immutable; do not
re-apply them to release held facts. Later recovery needs new source-grounded
work, not silent promotion. Structural corruption requires a hold/recall;
small segmentation imperfections do not. Original source and held evidence
remain retrievable with `facts --fact` after application.
