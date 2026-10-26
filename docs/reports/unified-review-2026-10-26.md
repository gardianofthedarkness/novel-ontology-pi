# Shared review gate validation — 26 October 2026

## Scope

Validate one `show → evidence → decide → apply` contract across ingestion facts,
standalone book causality, cross-book causal packets and library organization.
This is a control-flow/safety test, not a new causal-accuracy benchmark.

## Results

- Core: **478 / 478 passing**, including nine shared-gate contract tests.
- Pi-host tooling: **121 / 121 passing**, including actual scoped CLI staging,
  application, stability receipts, loaded-skill checks, migration errors and safe
  live-review telemetry. HTTP/SSE/provider-wire tests use local mock servers.
- TypeScript build, JavaScript syntax checks and `git diff --check` pass.
- A private isolated copy of the actual pending Vol2 causal packet renders through
  the shared book adapter in **132 ms** on this Mac: one assertion, additional
  original evidence explicitly pageable, not applied. All **14** checked owner
  source/bundle/packet files retained their hashes. The copy was removed afterward.
- **Zero real model requests** and no live Pi prompts/restarts or owner database
  decisions/application were performed for this validation.

## Assertions exercised

- Inspection/staging preserve predecessor proposals and do not publish canon.
- Partial causal evidence cannot authorize acceptance; fresh revisions need new reads.
- Unknown/duplicate facts, stale original/context, endpoint edits and bypass flags
  fail closed. Cross-book acceptance needs a temporal reason grounded in text.
- Semantic label corrections survive repeated accepts. A held identity still blocks
  dependent assertions; book application reports verified versus deferred facts.
- Held/unreviewed causal assertions do not become canonical; accepted links need
  valid endpoints/direction and cannot create a causal cycle.
- Universe application changes its ledger, not book bundles. Organization stays
  atomic: partial acceptance does not publish an incomplete catalog.
- Staged decisions are not stability proof. Current applied-packet proof needs
  matching revision plus inspected/asserted evidence metadata. Dialogue cards are
  valid causal endpoints; missing cards remain structural failures.
- Repeated application is refused, and private audit/history remains available.

## Boundaries

Legacy review commands remain available outside the scoped host for compatibility;
they are not the new staged protocol. Non-causal source-less legacy producers
(including the existing standalone time/place packets) still need typed,
source-bound adapter support before hosted shared review. They fail closed, not
through a newly invented approval gate.

No nomination thresholds, Jev prompts, accuracy claims or local sweep pagination
were changed. The first unrestricted-temp-path core run exposed an existing macOS
`/var` versus `/private/var` assertion mismatch; the complete suite passes with
`TMPDIR=/private/tmp`, without changing that unrelated test.
