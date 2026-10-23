# Wider-context System 1 buffer: live comparison

> Historical speaker-attribution experiment. The current product benchmark
> measures multi-participant dialogue cards, not sentence speakers; see
> [the current contract](dialogue-card-benchmark.md). Scores below are not
> reinterpreted as card-participant accuracy.

23 October 2026. Two real runs over the same private 493-sentence block, with
fresh identity registries, Jev-1.13.0 and DeepSeek `deepseek-flash` with thinking
disabled. The control disables the context buffer; the treatment enables it.
Retries preserve the original questions, options and target sentence units.
Only interpretation context widens. Both runs stop at unapproved proposals,
before Pi review/application; 30 original canonical/draft files have identical
before/after hashes. No source or raw model payload is published here.

## System-wide observation

| Measure | Buffer off | Buffer on |
| --- | ---: | ---: |
| Processing through proposal assembly | 39.951 s | 43.077 s |
| Jev requests / questions | 97 / 103 | 147 / 152 |
| Jev input / output tokens | 369,051 / 58,471 | 746,179 / 103,190 |
| Jev total tokens | 427,522 | 849,369 |
| DeepSeek requests | 70 | 66 |
| DeepSeek input / output tokens | 113,313 / 19,535 | 108,553 / 19,986 |
| DeepSeek total tokens | 132,848 | 128,539 |
| DeepSeek reported cached input tokens | 65,148 | 70,137 |
| DeepSeek uncached input tokens | 48,165 | 38,416 |
| Arithmetic total tokens, both providers | 560,370 | 977,908 |
| Resulting scenes | 9 | 8 |

The observed treatment was **7.8% slower**. DeepSeek token usage decreased
**3.2%**, and its uncached input decreased **20.2%**, but Jev tokens increased
**98.7%**. The arithmetic combined token count increased **74.5%**. These are
actual provider-reported usage, not estimates from prompt length. Every final
HTTP response returned usage, and logical calls match the response count.

This is not a dollar-cost comparison. Different provider/token/cache prices
must be applied separately; summing token counts across providers does not
establish a financial saving or loss. Prompt caching, sampling and provider
load were uncontrolled. This is one observation per mode, not a statistical
latency study, and it excludes independent Pi review time.

## Retry and escalation rates

| Decision stage | Off: S2 escalations / tasks | On: S1 retry recoveries | On: S2 escalations / tasks |
| --- | ---: | ---: | ---: |
| Scene boundaries | 17/27 (63.0%) | 2/17 | 15/28 (53.6%) |
| Dialogue boundaries | No direct S2 at this stage | 1/39 | No direct S2 at this stage |
| Dialogue attribution | 23/24 (95.8%) | 0/2 | 23/23 (100%) |

Three of 58 retries met their S1 validators. This is a policy-recovery count,
not proof that those individual answers are correct. Boundary tasks count
individual choices; attribution tasks count scene-local chunks. Do not combine
those denominators into a single escalation rate. The number of actual scene
and attribution fallback calls decreased from 40 to 38; dialogue adjudication
remained at 23 calls.

Twenty-one structurally defective attribution chunks skipped a futile speaker
retry: wider context cannot split a mixed-speaker unit while keeping that unit
fixed. Structural repair belongs to the upstream boundary stage or S2. Neither
the confidence nor structural gates were lowered to improve reported rates.

Entities/participants and scene understanding remain always-on LLM faculties,
not fallbacks. They each made 15 calls with the buffer off and 14 with it on.
Different accepted scene boundaries change downstream work; this is a policy
comparison, not a fixed-segmentation attribution microbenchmark.

## Quality and deferred work

Independent annotations prepared before the implementation cover 193 source
sentences, including 49 spoken sentences and 38 named-speaker sentences.

| Measure | Buffer off | Buffer on |
| --- | ---: | ---: |
| Spoken sentences recovered | 49/49 | 48/49 |
| Strict spoken-sentence precision | 92.5% | 94.1% |
| Correctly attributed named spoken sentences | 25/38 | 36/38 |
| Named spoken sentences assigned an identity | 38/38 | 38/38 |
| Sample mixed-speaker turns | 2 | 2 |
| Sample long-narration turns | 1 | 0 |
| All-block unresolved turn records | 8 | 13 |
| Source sentences covered by exactly one scene | 493/493 | 493/493 |
| Request handling failures | 0 | 0 |
| Failed/unavailable/budget faculty-note count | 1 | 2 |

The sampled attribution result improved, but attribution also depends on scene
boundaries, generative identity discovery and alias assembly. One stochastic
pair cannot isolate the causal contribution of added context at each stage.
One spoken sentence was missed in the treatment. Both runs retain deferred
semantic/validation work; neither is a Pi-approved ontology. Full-volume scene,
event and emotion semantics have no comprehensive gold labels in this test.

## Implementation decision and provenance

This benchmark measured the **all-faculty** context-buffer configuration, which
remains opt-in because it increased S1 work and latency. The subsequent user-
selected default enables widening only for speaker attribution, using the same
shared router and per-faculty policy overrides. That speaker-only configuration
has regression coverage, but no isolated live accuracy/cost result here: the
36/38 attribution score belongs to the combined policy, and the speaker stage
itself recovered zero of two retries in that run. Do not transfer the combined
accuracy claim to the speaker-only default.

The first prototype additionally reclassified target sentences, inflating its
question count; that adapter was removed. Two earlier attempts also used a
response-cloning observer that left some bodies consumed before the real client
could read them. Those attempts, private caller-error diagnostics and prototype
sources remain archived, not counted as clean comparisons. The observer now
reads each HTTP body once and returns a fresh response with the exact same body.
It passed 139 offline captured-response checks before the final fresh paired
run; the final run has zero caller/pool errors. No baseline was reused for the
final comparison. Raw requests, responses, usage, annotations, proposals,
scoring and integrity hashes remain local and outside the repository.
