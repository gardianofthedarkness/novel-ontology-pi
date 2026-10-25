# Library, identity and universe-causality validation

## Publication scope

This follow-up is stacked on PR #45's causal-system implementation. Merge #45
first. It publishes the remaining library/series CLI and skill, isolated source
bindings, scoped Pi access, structural packet repair, semantic identity binding,
review-impact audit and universe-level causal arrows. Claude's separate frontend
PRs #46 and #47 are not included or modified by this follow-up.

| Improvement | Repository coverage |
| --- | --- |
| Reviewed series/universe/continuity membership and reading order | `skills/novel-library/`, `src/ground/workspace/library.ts`, `src/cli/commands/extract/libraryCommands.ts` |
| Stable source ownership and isolated intake/recall | `src/ground/workspace/source.ts`, ingest/recall commands and workspace tests |
| Semantic labels instead of model-selected storage IDs | `src/ground/language/identityLabels.ts`, name detector, extraction and faculty graph |
| Source-supported aliases available before downstream references | `src/digger/extraction/extraction.ts`, identity and extraction regressions |
| Readable Pi review and label-based corrections | `src/solidifier/merge/semanticIdentity.ts`, semantic commands, skill reference |
| Duplicate proposal-ID repair without payload edits or automatic approval | `src/solidifier/merge/proposalIds.ts`, revision command and tests |
| Bounded cross-book causality with independent evidence review | `src/solidifier/causality/universe.ts`, CLI command and scoped Pi access |
| Live library hierarchy and causal metadata | `tools/pi-review/library-live.mjs`, `universe-causality-live.mjs`, frontend library model |
| Directed universe causal arrows | `causalProjection.ts`, `OrbitalExplorer.tsx`, `OrbitalGraph.tsx`, library-orbit regressions |
| Read-only review intervention audit | `tools/pi-review/review-impact.mjs`, `docs/review-impact.md` |
| Album access for assigned EPUBs and live projection | Scoped album access helpers, runner and `liveAlbum.ts` |

Paths in the frontend rows are under `apps/playground/src/`.

## Automated validation — 2026-10-25

- `TMPDIR=/private/tmp npm test`: **417 passed, zero failed**.
- `node --test tools/pi-review/*.test.mjs playground/*.test.mjs`:
  **116 passed, zero failed**, including real CLI/loopback/protected-stream tests
  backed by synthetic sources and local model stubs.
- Native macOS temporary-directory rerun of `universe-causality.test.js` and
  `library-sse.test.js`: **10 passed**. New security-sensitive test fixtures
  canonicalize temporary paths; production symlink/canonical-path checks remain
  enforced.
- Frontend production TypeScript/Vite build passed. Vite still reports the
  existing large-bundle warning.
- Orbital/causal regression subset: **38 passed**. This overlaps the 417-test
  suite and is not an additional independent sample.
- `git diff --check` passed.

The first run with macOS's default `/var/...` temporary path exposed fixture
assumptions because `/var` is a symlink to `/private/var`. The new affected
fixtures were corrected. The existing unrelated `init.test.ts` path-string
assertion still needs a canonical `TMPDIR` on macOS; the complete successful
suite above uses that setting. Linux CI does not use macOS's `/var` alias.

## Real-data checks and limits

The previously completed read-only identity compatibility check paged **6,367
facts from 28 applied packets**, across three existing workspaces, in **332
bounded pages** with no errors. **60 source/proposal/ontology hashes remained
unchanged**. See `identity-flow.md` for the binding contract and flow diagram.

The protected live frontend was checked against the existing owner runtime,
not a static fixture or replay. At the observation point, three valid accepted
cross-volume causal links aggregated into one directed volume-pair arrow; one
stale link was excluded. Same-container links were counted at library scale.
Opening the view did not submit a Pi message, start extraction, approve a fact,
or initiate a paid causal sweep. Existing per-book arrows remain supported.

Tests cover direction, reverse directions, aggregate review state, qualified
endpoint provenance, stale-link exclusion, unresolved/speculative membership,
cross-series projection and file previews inside a revealed series. Projected
arrows describe underlying event/dialogue links, not inferred book-level causes.

This is implementation/integration evidence, **not a new novel-wide accuracy
measurement**. There is no new claim that identity, emotion or causality precision
improved by a particular percentage. Review interventions are reported separately
from independently verified correctness in `review-impact.md`.

No private EPUBs, source passages, databases, runtime logs, operator links,
credentials or complete private reports are included. The local hosting harness
and owner session remain private; portable hosting/access support is in
`tools/pi-review/`.
