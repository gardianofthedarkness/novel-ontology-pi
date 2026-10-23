# Scene-independent speaker attribution: bounded real-novel experiment

> Historical speaker-attribution experiment, not the current product target.
> The owner-approved design now uses multi-participant dialogue cards, with
> no sentence-by-sentence speaker assignment. See the [current benchmark
> contract](dialogue-card-benchmark.md) and DESIGN.md. Results below are kept
> unchanged as historical evidence; none is a card-participant accuracy claim.

23 October 2026. This report contains aggregate results only; private novel
source, annotation identities, raw requests/responses, credentials and audit
details are not included in the repository.

## Method

Two fresh serial runs used the same private volume-1 block of 493 sentences,
empty initial identity registries, Jev-1.13.0 and `deepseek-flash` with thinking
disabled. Existing independent annotations cover 193 sentences, including 49
spoken sentences and 38 named-speaker spoken sentences. Labels were prepared
before implementation and loaded only by the scorer, not by the models.

The control is PR #34's speaker-only context-buffer default. The prototype
discovers block identities independently of scenes, repairs turn structure
separately, attributes fixed turns with original-source context and per-turn
gates, then joins turns to scenes. It also changes candidate construction,
repair prompts and S2 context; this is not an ablation isolating topology alone.

Both runs stopped at pending proposals, before independent Pi review or
application. Thirty original ontology/draft/ChangeSet files retained identical
before/after hashes. No full-volume processing or canonical writes occurred.

## Quality and the assembly fix

| Fixed-sample measure | Fresh control | Initial live prototype | Corrected recorded-response replay |
| --- | ---: | ---: | ---: |
| Correct named-speaker sentences | 25/38 (65.8%) | 18/38 (47.4%) | **34/38 (89.5%)** |
| Named-speaker sentences assigned an identity | 36/38 | 22/38 | 38/38 |
| Spoken sentences recovered | 48/49 | 49/49 | 49/49 |
| Strict spoken-sentence precision | 88.9% | 96.1% | 96.1% |
| Included narration/silence sentences | 6 | 2 | 2 |
| Sample mixed-speaker turns | 2 | 2 | 2 |
| Sample turns with three consecutive narration sentences | 0 | 0 | 0 |
| All-block unresolved stored turns | 14 | 33 | 7 |
| Original sentences owned by exactly one scene | 493/493 | 493/493 | 493/493 |

Primary accuracy includes all 38 labelled named-speaker sentences; unknown
assignments are not discarded. Existing name-form/alias scoring rules were
unchanged. No post-hoc identity equivalences or manual corrections to the four
remaining wrong assignments were added. The earlier all-faculty buffer result
of 36/38 (94.7%) was a different observation and was **not reproduced** here.

Before assembly, the prototype already attributed 34/38 correctly. However,
the existing extractor registered identities scene by scene and did not import
the new block registry. Supported speakers were therefore lost, especially
when scene-specific identity calls were unavailable. The fix registers the
model's already returned block declarations as source-grounded pending entity
proposals before assembling scenes, without inferring physical presence.

Before the fix, strict offline replay consumed all 392 captured prototype HTTP
responses and reproduced its entity/scene payloads exactly. After the fix, the
same responses produced identical attributed turns and retained all 34 correct
assignments in final proposals. The PR implementation was separately checked
against that replay and retains the 34/38 score. No additional provider calls
were made. Joining the same turns to either run's different scene partition
also preserved every per-sentence speaker assignment.

## Budget limitation — not a completed end-to-end run

The benchmark imposed a **combined 220-work-call cap across both arms**:
81 control calls and 139 prototype calls reached DeepSeek. Six additional
prototype scene-boundary adjudications, five scene identity/participation calls
and five scene-understanding calls were rejected locally at that cap.
All prototype block-identity, turn-structure and per-turn speaker tasks completed;
the 16 other missing responses remained unavailable in both offline replays.

This combined test cap is distinct from the graph pool's default per-block
budget. It must not be presented as evidence that a complete default-budget
run succeeded or that all scene/event/state semantics were validated. The
89.5% result includes an offline deterministic assembly repair; it is **not a
fresh, complete end-to-end run of the final code**.

## Observed live resource use

Timings are through unapproved proposal assembly, before the offline fix. The
prototype timing is budget-limited and excludes the work that was blocked.

| Measure | Fresh control | Live prototype |
| --- | ---: | ---: |
| Elapsed time | 55.538 s | 68.430 s |
| Jev calls | 116 | 253 |
| Jev input / output tokens | 440,615 / 68,856 | 829,164 / 131,272 |
| Jev total tokens | 509,471 | 960,436 |
| DeepSeek successful calls | 81 | 139 |
| DeepSeek input / output tokens | 129,353 / 21,419 | 253,401 / 16,346 |
| DeepSeek total tokens | 150,772 | 269,747 |

Observed elapsed time increased 23.2%, Jev tokens 88.5% and DeepSeek tokens
78.9%, despite incomplete non-speaker work. These are provider-reported usage
counts, not dollar-cost estimates. All 589 completed HTTP responses returned
successful status and usage. There were 236 work-call attempts: 220 paid calls
and 16 locally blocked attempts. No paid retry run followed the cap.

Speaker S1 retries recovered 0/2 chunks in the control and 9/84 turns in the
prototype; S2 resolved 68/75 prototype turn tasks. These are acceptance-gate
counts, not correctness labels, with different denominators.

## Validation and rollout

The fix branch passes 225 offline core tests, including 11 new regressions.
Offline regressions cover source-bounded context, fixed writable turn spans,
scene-join invariance, per-turn retries, original-language identity handoff,
source-grounded proposal provenance, reviewer constraints/pins, failed repairs,
identity-owner conflicts and oversized states without truncation or API calls.

The new `dialogueScope: "block-turn"` mode remains **opt-in**. The default,
review boundary, canonical storage and frontend are unchanged. Duplicate
identity work, per-turn request overhead, batching and resource isolation need
further work before default promotion. No claim of statistical significance,
full-volume accuracy, comprehensive scene/emotion/state correctness or a priced
cost saving follows from this single 38-sentence speaker sample.
