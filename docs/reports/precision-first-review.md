# Precision-first review validation

> Design update: dialogue cards now represent multi-person exchanges, not
> single-speaker turns. The sentence-speaker results below describe the old
> implementation and do not measure the new contract. See
> [dialogue-card benchmarking](../dialogue-card-benchmark.md).

## Motivation: prior fresh three-chapter run

The earlier live test used two empty databases, fresh TypeSafe/Jev and
DeepSeek requests, the real CLI and independent skill-loaded Pi review.
The target was the prologue and chapters 1–2 of volume 1. Both arms applied
two chapters, leaving the third held at equal 60-million observed-token
limits, including provider-cached input. This was not full completion.

Fixed independent annotations cover 193 sentences in the prologue, including
38 named-speaker spoken sentences. They are not whole-volume ground truth.

| Pipeline | Correct before Pi | Correct in canon after Pi |
|---|---:|---:|
| Scene-scoped control | 29/38 (76.3%) | 16/38 (42.1%) |
| Decoupled block-turn | 27/38 (71.1%) | 27/38 (71.1%) |

The earlier 89.5% recorded-response assembly result and differently configured
94.7% result were not reproduced by that fresh run. Initial extraction was
not more accurate in the decoupled arm. The review-induced loss in the control
motivated assertion-scoped repairs rather than block-wide presence changes.
First-two-chapter application times were 24.8 and 25.3 minutes; budget-stop
times must not be described as completed-run speedups.

## New implementation: offline evidence

The semantic gate separates source-valid text organization from consequential
assertions. It defaults uncertain facts to hold outside canon, permits unrelated
supported work to proceed, binds decisions to source/proposal/canonical-context
revisions, and prevents presence repairs from rewriting dialogue or actors.
See [policy and commands](../semantic-review.md).

238 core and 34 optional Pi tests pass. Coverage includes actual local CLI and
Ladybug queries, partial approvals, source-only identity forms, immutable approved
packets, stale decisions/context, dependency holds, ID reservation, repair
persistence, byte-bounded evidence, and scoped Pi delivery checks. No model
responses or novel payloads are published as test fixtures.

An offline projection check against one copied real pre-review packet retained
all 283 consequential assertions in 15 bounded pages. Its 231,062 bytes of page
JSON compare with 222,898 bytes of raw proposals/notes, which exclude source
reads and pagination wrappers. This is not evidence of token or latency savings;
avoiding repeated whole-packet reviews still needs live measurement.

## Fresh live validation: stopped on a review loop

PR35 was published first at `03b4135`, then the same implementation ran against
a new empty Ladybug database. The target was prologue 0 and chapters 1–2:
three blocks, 2,279 sentences. Calls were real upstream Jev-1.13.0 and
`deepseek-flash`, thinking disabled, with block-turn attribution, the installed
skill/reference, the unchanged generic Pi prompt and independent fact decisions.
There was no response replay, manual semantic patch or forced approval.
Source, skill and instrumentation hashes stayed unchanged during the run.

**The three-chapter target was not achieved.** After 33.5 minutes the operator
stopped a paid review loop, before the 60-million observed-token stop threshold.
The prologue applied after 4.8 minutes. Chapter 1 remained pending despite
decisions on all 448 of its facts; chapter 2 never started. Of chapter 1's
197 successful decision batches, 128 changed no verdict or replacement:
1,225 of 1,735 decision updates repeated existing values. There were also
repeated fact-page reads. These observations establish workflow inefficiency,
not a provider failure or a successful full-run timing improvement.

### Applied versus unfinished work

- One of three blocks applied with a current independent review receipt.
- Applied packet: **154 verified facts, 113 held facts, 8 rejected facts,
  0 deferred proposals**. Held facts are outside canon and remain retrievable.
- Chapter 1: 304 accept and 144 hold decisions, but **no application**;
  these are not additional canonically verified facts. Two blocks are unfinished.
- Canon covers the prologue's 493 source sentences exactly once; the remaining
  1,786 target sentences are not in canon. No duplicate/out-of-source sentences.
- Canon contains 21 entities, 9 scenes and 63 events. Actual CLI/Ladybug queries
  independently confirm entity, scene and event counts.
- Applied-data checks found zero structural issues and zero source-language
  heuristic warnings; neither establishes semantic correctness or whole-target
  completion. Three generic faculty failure notes remain across the two
  extracted packets; their wording does not establish the underlying cause.

### Fixed prologue speaker sample

Same independent annotations and name-matching rules as the prior live test:
193 sampled sentences, 49 spoken, 38 named-speaker spoken. Unknowns remain
incorrect in fixed-denominator coverage; no labels or aliases were tuned.

| Measure | Raw extraction | Canon after Pi |
|---|---:|---:|
| Correct / all 38 named spoken | 28/38 (73.7%) | 20/38 (52.6%) |
| Assigned named spoken | 36/38 | 23/38 |
| Correct / assigned | 28/36 (77.8%) | 20/23 (87.0%) |
| Wrong named-speaker assertions | 8 | 3 |
| Unknown named-speaker assignments | 2 | 15 |

Pi removed five sampled wrong assignments and introduced no new sampled wrong
assignment. However, eight previously correct assignments became unknown:
one through rejection, two through explicit holds and five through unreviewed
turn facts. Twenty correct assignments were retained; none of the originally
incorrect/unknown assignments became correct. This is a precision/coverage
tradeoff, **not an overall accuracy improvement or resolution of the review
regression**. Three wrong assignments still reached canon. The metric is only
this annotated subset, not all dialogue, relations or emotions in three chapters.
Dialogue detection was unchanged by review: 48/49 sampled spoken sentences
detected and five sampled narration/silence sentences selected.

### Usage and limitations

| Provider role | Requests | Observed tokens | Reported cached prompt tokens |
|---|---:|---:|---:|
| Jev / System 1 | 685 | 2,844,915 | not reported |
| CLI extraction / System 2 | 385 | 768,857 | 384,502 |
| Pi independent review | 704 | 40,923,304 | 38,394,624 |
| Total | 1,774 | 44,537,076 | 38,779,126 |

Observed usage includes cached input; the total is not uncached/billable tokens
or a dollar-cost estimate. All completed upstream requests reported usage and
successful HTTP status. No provider request was budget-blocked. CLI extraction
across the two attempted blocks took 155.2 seconds; stopping time must not be
described as completed three-chapter latency or a speed/cost win. Cancellation
exited the runner; its two stale lock records were archived only after verifying
the owner process was dead. No writer remains active.

Next work should make review progress explicit and resumable, prevent repeated
no-op decision/reread loops, and preserve supported speakers while retaining
uncertainty on unsupported facts. These are findings, not fixes validated by
this run. Do not resume paid processing or promote held assertions implicitly.
Only aggregates are published; source, payloads, gold identities, credentials,
private audit reasons and full runtime reports remain private.

## Dialogue-card implementation update

The approved design/benchmark contract was published first at `3ac05a2`, before
implementation. The default work-model path now stores multi-person dialogue
cards with independent membership facts instead of sentence-speaker labels.
Source-only card matching and participant scoring are available through
`novel eval dialogues`; historical sentence gold is not repurposed as card gold.

251 core and 36 Pi/viewer tests pass; the frontend production build succeeds
with its existing bundle-size warning. New synthetic tests cover alternating
voices, monologues/three-person exchanges, mentioned distractors, S1 widening,
one shared S2 fallback per card, unknown/oversized inputs, independent member
holds, scene-fragment identity/source reconstruction, actual CLI approval,
audited entity remaps/removal, Ladybug card queries and deterministic card-level
scoring/CLI execution without network. No new paid novel calls were made and
no real card-participant accuracy, latency or savings claim is established.

PR36's alias/fragment-at-birth and structural matching code was inspected at
`4e355eb`. It is not merged here. Integration must include block-level identity
births and card member remapping/evidence, without introducing confidence-only
post-apply merges through this branch's independent semantic gate. Existing
audited merge/removal operations now remap/deduplicate card members. Remaining
review-loop behavior is not claimed fixed by the new progress fields alone.
The skill's focused instructions/reference were updated; its optional Python
validator could not run because PyYAML is absent from available runtimes.

## Independent review follow-up: duplicate actor IDs

The reviewer reported a real gate-mode smoke at `e7e8241`: cards were extracted,
but four events had repeated primary-actor IDs and `changeset facts --summary`
failed structural validation. This is a failed review entry point, not a
successful canonical end-to-end run or a card-accuracy result.

A synthetic regression reproduced the failure before the fix. Extraction now
deduplicates actors and affected characters **after name/alias resolution**,
before creating events and participation proposals. Distinct people and the
same person appearing in both actor roles are preserved. These lists are
resolved from extraction's name lists, not concatenated with card membership.
The alias-resolution list construction also exists on main; strict semantic
validation exposed the previously tolerated invalid representation.

Regressions cover existing/new aliases, legacy/card extraction, four repeated
events, unique participation proposal IDs, materialization and the actual
`changeset facts --summary` CLI. Malformed already-stored packets still fail
closed: this fix does not rewrite old pending packets or relax the validator.
Fresh extraction or an authorized audited recall is needed for those artifacts.

254 core and 36 Pi/viewer tests pass. No new paid model calls or live re-test of
the fixed code was performed. Live `--auto-approve` remains prohibited, with a
regression proving rejection before model requests or canonical writes. Operator
runbooks now distinguish extraction-only held smoke tests from independent
canonical review. No trusted-batch override was added; changing that policy
requires an explicit owner decision, not a code-review suggestion.
