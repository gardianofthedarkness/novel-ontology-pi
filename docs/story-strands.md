# Story strands: story time as a partial order

Status: **measured, not built**, 2026-10-27. The benchmark and its scorer
exist (`novel eval story-order`); the strand step and viewer are a plan.

## Why

[Story time](time-place.md) puts every scene on one line. Novels often cut
between two groups at different places with no word on which came first, and
the groups later meet. One line has to invent an order for those scenes.

## Model

Story time is a **partial order** of scenes:

- **Strands (worldlines).** A character cannot be in two places at once, so
  the scenes a strand follows are in story order (reading order, except
  flashbacks). A scene can sit on several strands: that is where they meet.
- **Happens-before** holds only with evidence: a shared strand, a
  flashback (it happened before the point where it is told), stated times
  that differ (part of day compared only within one city, because of time
  zones), or a cross-strand cue in the text (one strand hears what another
  just did).
- **Parallel** means no such evidence: two scenes neither of which is
  before the other. Reading order alone is never evidence across strands.
- **Merging back** needs no special case: a meeting scene comes after the
  latest scene of every strand that enters it (its vector clock is the
  component-wise maximum of theirs), so strands rejoin wherever characters
  meet.

Drawn, this is a braid: one column per strand, arrows for evidence, columns
pinched together at meetings.

## Benchmark

`novel eval story-order <gold.json> <predicted.json> [--timeplace] [--ties]`
scores a prediction pair by pair: before, after or parallel. No model calls,
metrics only.

- **Gold** (`story-order-gold-v1`, kept privately with the book): strands
  as ordered scene lists, cross-strand edges with a short note of the
  evidence, excluded scenes (front matter, headings, exposition). Edges
  marked `certain: false` are likely readings; every pair whose relation
  depends on one is left out of scoring, as are listed `uncertainPairs`.
- **Predictions**: a total `order`, `ranks` (equal ranks unordered) or a
  `dag` of happens-before edges. `--timeplace` reads a time-place run report
  as the one-line story order; `--ties` instead leaves the scenes of one
  period unordered.
- **Report**: `pairAccuracy` (the headline), `orderedAccuracy` (gold-ordered
  pairs in the right direction), `reversedPairs`, `parallelRecall` /
  `parallelPrecision`, `falseOrderPairs` (parallel pairs a prediction
  ordered) and the scenes most involved in errors.

## Measured (2026-10-27)

The two volumes the time-place faculty was tuned on, gold read from the
source text: 69 and 63 scored scenes, 2,044 and 1,701 scored pairs, of
which 361 and 361 are parallel (18% and 21%); 302 and 252 pairs depend on
likely readings and are left out. Labelled after the first prototype ran,
by the same person: treat as a first, not a blind, standard.

| Prediction | Vol 1 pairs | Vol 2 pairs | Parallel recall (1 / 2) |
| --- | --- | --- | --- |
| Time-place story line (as viewed today) | 0.822 | 0.767 | 0 / 0 |
| Time-place periods as ties | 0.687 | 0.443 | 0.56 / 0.65 |
| Prototype: line + worldlines from extracted casts | 0.864 | 0.838 | 0.85 / 0.57 |
| Worldlines from **correct** strand membership, no cross-strand cues | 0.959 | 0.977 | 1 / 1 |
| Reading line cut at cast switches, extracted casts | 0.324 | 0.375 | 0.68 / 0.77 |

- **One line cannot reach 90% here.** It gets almost every ordered pair
  right (0.999 and 0.974), but it can never say "parallel", so its ceiling
  is the share of ordered pairs: 0.823 and 0.788.
- **The partial order is the right shape.** With correct strand
  membership, worldlines alone reach 0.96 and 0.98, without detecting any
  cross-strand cue.
- **Extracted casts are the bottleneck.** 26 of 69 and 22 of 63 scored
  scenes have no recorded cast. Main-character presence has recall 0.69 and
  0.67 (precision 0.85 and 0.96). Carrying casts over from nearby scenes
  gets to 0.86 and 0.84. Cutting the line wherever casts look disjoint
  collapses, because missing casts look like switches.
- **Time-place errors the gold exposed** (they cost order, not parallels):
  - a recap ("this goes back to when…") was not marked as a flashback;
  - an evening after a holiday-night anchor was dated the next day;
  - a back-reference to an earlier date inside a present scene was marked
    as a flashback (35 reversed pairs in volume 2).

## Verdict and plan

Keep the time-place faculty for anchors, dates and flashbacks; it is not
the part that fails. Add a **strand step** between scenes and story order,
and fix the three errors above.

1. **Strand membership.** Per scene: which strands it follows, including
   characters present off the recorded cast (point of view, carried
   presence). Code first (cast, places, carried casts); Jev decides each
   scene boundary that the cast cannot: continues the previous strand,
   switches to another, or joins two. Target: presence recall ≥ 0.9.
2. **Order facts.** Store `Scene -BEFORE-> Scene` with the evidence kind
   (worldline, flashback, time, cue) through a reviewed changeset, like
   time-place facts; a scene with no strand stays unplaced, never guessed.
3. **Viewer.** Story time draws the braid: strands as columns or parallel
   helices, meetings as pinches; the one line stays as the reading order.
4. **Gate.** Re-run `novel eval story-order` on both volumes; switch the
   viewer only at ≥ 0.90 pairs on each, then label a volume of another
   series blind before trusting the number elsewhere.
