# Review impact: logged interventions versus accuracy

Offline audit captured 2026-10-25 at 20:42 UTC. No new model calls, approvals,
extraction, canonical changes or active-worker restart were made for this audit.
Only immutable applied packets are included; the ongoing held block is excluded.
Copied developer/demo databases are not independent runs and must not be counted
again. Source, proposal payloads, names and private decision reasons are omitted.

## What the logs can establish

An accepted replacement is an intervention, not proof that the new value is
correct. A rejection can remove a bad assertion or a good one. A hold is missing
information, not a repaired fact. Independent source annotations are needed for
precision/recall claims. Unchanged accepts do not establish that review was useless.
Counts below are facts, not entities, sentences, proposals or model calls.

### Current Vol2: first six applied blocks, legacy turn mode

| Assertion | Facts | Changed accepts | Rejected | Explicit holds | Unreviewed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Identity / name forms | 128 | 0 | 38 | 2 | 0 |
| Event actors / affected characters | 243 | 53 | 2 | 0 | 0 |
| State deltas | 174 | 18 | 0 | 1 | 3 |
| Physical presence | 25 | 8 | 0 | 0 | 0 |
| Mentioned characters | 27 | 7 | 2 | 0 | 1 |
| Scene location | 9 | 2 | 0 | 0 | 0 |
| Legacy speaker / addressee | 471 | 56 | 1 | 9 | 3 |

The 18 changed states modify `characterId` in 17 cases and relationship target
maps in two cases (overlapping counts). None changes emotion scores, knowledge,
goals, possessions or location. Do not call these 18 emotion corrections: the
dominant work is identity/reference repair. Source spot-checks support examples
of removing production-credit entities, fixing duplicate identity references and
not equating a mentioned person with an affected actor. These are not a frozen
gold benchmark for every intervention.

The 1,077 facts have 1,070 final decisions. Current-revision maintenance records
contain 59 batches / 1,071 decision updates / one repeated unchanged action.
Review repetition is not the dominant waste in this particular run.

### Vol1: three dialogue-card blocks, kept separate from later legacy blocks

Of 263 dialogue membership facts:

- 144 were initially assigned: 128 accepted unchanged, five rejected, 11 held.
- 119 were unresolved candidates: two accepted, 109 rejected, eight held.

Thus 114 membership rejections are **not** 114 removed speaker errors: 109 were
already unresolved candidates. Independently evaluating uncertain candidates
recovered only two memberships, but skipping that work would sacrifice those two
recoveries. No independent card-level gold currently proves their accuracy.

Other interventions in these three blocks: 29 identity rejections; seven actor
replacements and 14 rejections; two presence replacements; eight state rejections;
two mention rejections; one causal-link rejection. Location had no replacement or
rejection in only 16 facts, but current Vol2 did have location replacements.

### Earlier independent Vol2 run and historical annotated speaker run

The separate completed ten-block Vol2 run recorded 73 causal rejections in 195
causal facts, 29 state replacements and 22 state rejections. Ten replacements
touched emotion maps; some were label normalization, not new semantic judgments.
This is evidence of interventions, not a verified causal/emotion accuracy rate.

The older annotated sentence-speaker test is the available direct harm/benefit
check: published wrong assignments fell from 8 to 3, but correct assignments
also fell from 28 to 20 out of the same 38 targets. Five wrong assertions became
unknown; none was corrected to the right answer. Eight correct assertions were
lost, including five not reviewed at all. This was abstention/coverage loss, not
an accuracy improvement, and it is not a dialogue-card benchmark.

## Review scope decision

- Keep code-only validation for segmentation, dialogue boundaries, small event
  detection and source coverage; these are already outside semantic review.
- Stop selecting obsolete sentence-speaker extraction for new demo launches.
  The local launchers had explicitly forced `block-turn` despite the CLI's
  `card` default. They now default to `card`, retaining an explicit historical
  environment override. Existing workers/packets are not silently converted.
- Retain review of identities/aliases, card memberships, actors, presence,
  mentions, locations, relations/causality and state. No remaining consequential
  category has evidence strong enough to justify wholesale unchecked promotion.
- Optimize identity resolution/reference propagation upstream before paying for
  repeated downstream fixes. Do not infer a new identity equivalence merely from
  repeated reviewer edits. Candidate-only membership review is a possible
  lower-priority/on-demand policy, not a free accuracy-preserving removal.
- Do not choose a confidence-only exemption from this audit: current Vol2
  proposals all expose generic `patchId: extraction` and confidence `0.7`.
  Per-assertion System 1 / widening / System 2 origin is not recoverable reliably
  from those fields. Faculty-stage attribution needs additional linked telemetry.

The running job retains its existing gates. No accept-all path or confidence
threshold bypass was introduced. A narrower unchecked policy is not supported
by these logs alone.

## Reproduce the aggregate audit

After building the CLI:

```sh
node tools/pi-review/review-impact.mjs /private/workspace [other-workspace ...]
node --test tools/pi-review/review-impact.test.mjs
```

The read-only tool separates card/legacy modes and candidate-only memberships,
excludes pending/stale/structurally invalid packets, deduplicates copied packets,
rejects conflicting copied decisions, detects applied-packet changes during
capture, and reports no accuracy percentage. It emits aggregate metadata only;
there is no raw-source, reason, entity-name or credential output.
