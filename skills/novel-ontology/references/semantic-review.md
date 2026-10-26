# One semantic review gate

Every faculty uses the same commands and decision schema. The scope chooses
storage, not a different review process: `book` for local packets, `universe`
for cross-book links (also supply `--universe <id>`), `library` for organization.

```
novel review show <root> <packet> --scope book --offset 0 --limit 20
novel review evidence <root> <packet> --scope book --fact <fact-id> --offset 0 --limit 20
novel review decide <root> <packet> --scope book --revision <hash> --decisions '[{"factId":"...","verdict":"accept","reason":"source-grounded explanation"}]'
novel review apply <root> <packet> --scope book --revision <hash>
```

Follow actual `page.nextOffset`, never assume the requested limit was returned.
Values are complete and byte-bounded. Read each accepted assertion and adequate
original evidence; causal links require ALL cited evidence from BOTH endpoints.
`evidencePage.nextOffset` indicates additional evidence. Reads are bound to the
current packet/context revision. Old reads cannot authorize a new revision.

Judge `meaning` against the source, not opaque `value` IDs. Prefer an accepted
decision's `semanticReplacement` for identity corrections: preserve the field
shape, but use displayed unique names in identity-reference slots. Example:
`{"factId":"...","verdict":"accept","reason":"...","semanticReplacement":{"primaryActors":["小明"],"affectedCharacters":[]}}`.
Ambiguous labels stay held. Identity corrections omit storage `id`; state event
anchors cannot change. Relation endpoint/type changes need a new evidence-bound
proposal, not an identity correction. Cross-book acceptance additionally needs
`temporalReason` supported by actual text, never merely volume/reading order.

Batch at most 50 decisions. `accept`, `hold`, `reject` have the same meaning in
every scope. Omitted assertions default to hold. Decisions stage only; explicit
apply is required. Show the current review again after source, packet or canonical
context changes. Unchanged repeated accepts preserve prior corrections.

Review consequences: identities, dialogue-card members, presence, actors,
relations and state. Do not optimize scene/dialogue boundaries or small event
detection. Review each dialogue member separately; do not assign sentences to
speakers or infer presence/relationships from dialogue co-membership.

Applying a book preserves source organization and publishes only verified facts
whose dependencies are available. Held/rejected facts remain outside canon and
recoverable; do not reapply an approved packet to release them. Universe apply
writes only its ledger. Library plans are atomic: every organization item must
be accepted, otherwise organization is not applied. Report processed, verified,
held, rejected, deferred and unfinished separately; processing is not verification.

Legacy CLI spellings remain for compatibility outside the scoped Pi host.
Use this protocol in new work; do not guess different approval commands by faculty.
