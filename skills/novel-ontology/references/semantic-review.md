# Fact review

`novel changeset facts <dir> <id> --offset 0 --limit 20`

Pages are byte-bounded. Follow the returned `page.nextOffset`, not your
requested limit. Facts contain complete assertion values, names, event
context and original-source excerpts. Excerpts are not exhaustive; inspect
`evidencePage.nextOffset`. Read more when ownership, a speaker, emotion or
relationship is unclear:

Page-level `labels`, `events` and `evidence` dictionaries are shared by facts
through `eventIds` and `evidenceIds`; source ranges summarize citation IDs,
not assertion values. Dialogue participation evidence does not imply physical
presence: remembered exchanges need not imply present-time presence.
Verify communication versus thoughts/quoted labels, not perfect
dialogue boundaries or incidental narration.

Use each fact's `meaning` for identity/role judgments against original evidence;
raw `value` IDs are storage references, not semantic evidence. For a correction,
prefer `semanticReplacement` instead of `replacement`: preserve the value's shape
but put displayed identity labels in entity-reference fields (including `...Id`
keys and state relationship keys). For example, an actor correction is
`{"factId":"...","verdict":"accept","reason":"...","semanticReplacement":{"primaryActors":["小明"],"affectedCharacters":[]}}`.
The CLI resolves only known unique labels/registered aliases, with kind checks;
it does not guess from substrings. Same-name option suffixes distinguish records,
not proof of identity: retrieve evidence or hold. Identity-object corrections omit
`id`; the CLI preserves it. State event anchors cannot change through this path.
Relation endpoint edits still use the existing relation/evidence workflow, not
this identity-only adapter. Raw replacements remain compatible with older clients.

`novel changeset facts <dir> <id> --fact '<fact-id>' --offset 0 --limit 12`

Use the current `revision` to record batches of at most 50 decisions:

`novel changeset decide <dir> <id> --revision '<hash>' --decisions '[{"factId":"...","verdict":"accept","reason":"source-grounded explanation"}]'`

Verdicts: `accept`, `hold`, `reject`. Omitted decisions default to hold.
Accept requires adequate source evidence, not a high confidence score.
For `dialogue-member`, the value is one Character ID for one exchange.
Accept supported members independently; reject wrong members and hold uncertainty.
`candidateOnly` marks initially unresolved candidates, not verified participants.
Correct a wrong identity using a source-supported Character ID replacement.
Do not assign speakers/addressees per sentence. Legacy `turn` facts retain
their original shape only for older packets.

Use an optional `replacement` on an accepted decision to correct just its
value; keep its field shape. A turn value is `{speakerId,addresseeId}`;
presence/mention is an array of character IDs; actors is
`{primaryActors,affectedCharacters}`. Identity replacements retain the ID
and use only existing candidate/source name forms. Hold a fused identity
instead of guessing a split. A missing speaker remains null, not narration.

Pages distinguish `reviewed` decisions from the default hold on unreviewed facts;
summary counts include `explicitHolds` and `unreviewed`. Do not repeatedly submit
unchanged decisions or reread completed pages to resolve intentional holds.

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
