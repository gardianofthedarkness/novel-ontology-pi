# Precision-first review validation

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

## New live validation

Pending at publication of the semantic-review update. The planned test uses a
new empty database, fresh calls, block-turn attribution, the generic Pi task
prompt and installed skill, with independent fact decisions and no forced
approvals. Before/after accuracy will use the same fixed annotations and count
unknown assignments as incorrect for coverage. Published-error precision and
held/unfinished work will be reported separately; holding everything is not
an accuracy improvement. No replay-based score substitutes for a live result.
