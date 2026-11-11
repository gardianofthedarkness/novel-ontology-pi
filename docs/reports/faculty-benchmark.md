# Small-batch live faculty comparison

> Historical single-speaker pipeline results. The current product uses
> multi-participant dialogue cards; see [the current benchmark
> contract](dialogue-card-benchmark.md). No historical speaker percentage is
> a measured card-participant accuracy result.

23 October 2026. Two fresh, unapproved processing paths over the same private
493-sentence source block, with an initially empty identity registry. Both use
Jev-1.13.0 and DeepSeek's configured `deepseek-flash` model with thinking disabled.
No source text, private model payloads, credentials or audit reasons are included
here. No canonical records, previous ChangeSets or working drafts were modified;
30 original JSON/JSONL files were hash-checked before and after each run.

The baseline uses the existing miniloop and sequential scene extractor. The
optimized path uses scene-streamed identity/understanding work, automatic bounded
adjudication, four shared workers and deterministic ordered proposal assembly.
An initial optimized attempt exposed overly broad response rejection: one
out-of-core record discarded an otherwise useful chunk. One bounded follow-up
validated the corrected row-level handling, reusing the completed baseline
rather than paying to repeat it. Both attempts remain archived privately.

## Observed result

| Measure | Legacy path | Corrected faculty path |
| --- | ---: | ---: |
| Whole-block processing latency | 51.888 s | 36.731 s |
| Strict spoken-sentence precision in manual sample | 38.7% | 94.1% |
| Spoken-sentence recall in manual sample | 48/49, 98.0% | 48/49, 98.0% |
| Correctly attributed named spoken sentences | 0/38 | 30/38 |
| Accuracy among assigned named spoken sentences | Not applicable | 30/32, 93.8% |
| Sampled turns combining known different speakers | 9 | 3 |
| Sampled turns containing 3+ narration sentences | 9 | 0 |
| All-block unresolved turn records | 27/27 | 19/81 |
| Source sentences covered by exactly one scene | 493/493 | 493/493 |
| Jev calls | 91 | 97 |
| Work-LLM calls | 8 | 63 |
| Work-LLM prompt tokens | 22,199 | 103,426 |
| Work-LLM completion tokens | 9,784 | 18,841 |
| Maximum observed work-call prompt tokens | 4,094 | 3,057 |
| Work-call latency median / observed p95 | 6.014 / 8.950 s | 1.291 / 5.850 s |

The observed wall-time reduction is **29.2%**, or about **1.41× throughput** for
this block. It comes with **3.82× total work-model tokens** and substantially
more calls. This is a latency/quality improvement, not a cost reduction. No
provider prices or dollar costs are inferred.

### Where the work-model tokens went

| Faculty | Execution | Calls | Input tokens | Output tokens |
| --- | --- | ---: | ---: | ---: |
| Scene-boundary adjudication | Low-confidence fallback | 13 | 31,992 | 195 |
| Dialogue/speaker adjudication | Uncertainty or structural-risk fallback | 22 | 27,364 | 3,417 |
| Entities and participants | Always-on generation | 14 | 18,091 | 1,663 |
| Scene understanding, including emotion/state observations | Always-on generation | 14 | 25,979 | 13,566 |

Identity discovery and scene understanding are not triggered fallback calls.
Emotion/state observations share scene-understanding calls; deterministic state
folding, alignment and grounding make no LLM calls. Cache-hit/miss billing
details were not captured, so token shares are not dollar-cost shares.

## What the quality numbers mean

Manual annotation covers 193 source sentences in three fixed regions, including
49 explicitly spoken sentences and 38 with an attributable, named speaker.
The annotation was prepared during the earlier dialogue validation, before
the faculty implementation. Quoted silence and silent communication are
distinguished; lip-reading is excluded from strict spoken scoring rather than
automatically counted as hallucinated dialogue. Strict precision counts included
narration as nonspoken even though one or two brief narration beats are allowed
by the intended turn policy. Coverage and speaker scoring use source sentence
IDs, not label text or quotation heuristics. Anonymous voices are not forced
into named-character accuracy scores.

## Limits and next work

- This is one observed live comparison plus one bounded implementation follow-up,
  not a statistically powered speed study. Provider load, sampling and prompt
  caching are not controlled. Different scene/turn counts also change work done.
- It is not a full-volume semantic pass or a Pi-approved ingestion. End-to-end
  time to final independent review/application is not included.
- Three sampled mixed-speaker turns, two wrong named speech assignments, one
  missed spoken sentence and 19 all-block unresolved turns remain. Abstention
  stays visible rather than being counted as correct attribution.
- Event summaries, aliases, emotion interpretation and state deltas do not have
  comprehensive semantic gold labels in this benchmark. Their presence and
  structurally valid references must not be reported as semantic accuracy.
- The shorter-call target is plausible at the median; p95 is still above 2.5 s.
  Further optimization should target call coalescing and redundant scene context,
  without removing evidence or hiding unresolved work.

Synthetic regressions separately cover streaming overlap, bounded scheduling,
source conservation, deadlines, per-row validation, explicit failure handling,
ordered assembly/state preview and the unchanged review boundary. Synthetic
tests are not substitutes for these live semantic measurements.
