---
tags: [directing, milestone, design]
---
# M14 · Strands, not scenes (design proposal, 2026-11-03)

The user (2026-11-03): "all of our design should revolve around strands, there should be no scene level processing in
world engine. They are only meaningful for building blocks of strands. The minimum unit of processing is cards and
blocks of sentence for summary faculties … If there's things scenes caught but strand didn't, that's a strand issue, and
we need to rewrite the logic from scenes to strand extraction process." Then: "finish M14 first before W10".

Segments are in (the first half of M14). This is the second half: what still works by scene, and what replaces it.

## What works by scene today

| Where | By scene now | Seen to go wrong |
|---|---|---|
| Strand extraction (`experiments/v2/strands.mjs`, `src/v2/extraction/strands.ts`) | a strand is a chain of scenes; a person's entry says which scene they come from and whether at the same place | scene 39, a passage of advertisements and narration, carries four people "same place" into the fight of scene 40 |
| The director's cast (`director.mjs`, scene start) | who is present is decided once, at the scene's start, from the script, else the digest, else the scene before | everyone appears at once, though some first act halfway through |
| The frame (L16) | measured once a scene, on its first beat | a scene of several beats keeps one frame |
| Arrivals (L5, L17) | walk in or arrive off-page at the scene's start | an arrival halfway through is placed at the start |
| The summarizer (`digest.mjs`) | one digest a scene, beside its windows | a long scene's digest blurs its stretches |
| The crowd field (M9) | one field a scene, on the scene's frame | a crowd that changes place within a scene |
| Block-type smoothing (`beats.mjs`) | a scene's cut is evidence the type changes | (segments now carry their own change) |
| The smoother and presence (`smoother.mjs`, `occupation.mjs`) | moments at scene starts; on or off the stage per scene | a person on stage for one stretch of a long scene counts for all of it |

## The proposal

1. **Strands from segments.** A strand is a chain of segments. Each segment (the stretch Jev cut, typed) has:
   - **its people**: those who act, speak or are spoken to in its cards, weighted by how much of the segment is
     happening now (1 − P(exposition) − P(memory) from its distribution): an exposition or memory stretch carries
     nobody physically, so scene 39's advertisements carry no one into the fight;
   - **its place**: the scene's, or a place the segment's own lines state;
   - **its time**: the scene's time node; a memory segment in the past.
   Each person's entry in a segment says which segment of theirs it continues and whether at the same place and
   time. `strands.json` keeps `scenes` (derived, for what reads them) and gains `segments`.
2. **The world engine works by card along the strands.** Scenes stay only as the page's containers (the Player and
   World · Live play by scene) and as time markers. A person enters at their first card in a segment, from where their
   strand left them; walking in, or arriving off-page, is decided there by L5 and L17 on the time between the two
   segments. The frame (L16) and the crowd field are the beat's, not the scene's.
3. **The summarizer reads segments.** The scene digest becomes a segment digest (one work-model request a segment: 346
   for volume 1, against 46), beside the window digests.
4. **The smoother and presence by segment.** Moments at a person's entry into a segment and at their cards; presence on
   or off per segment along the strand, an exposition or memory segment a weak reading.
5. **Block-type smoothing** drops the scene cut; a segment's own change is the transition.

## Checked by

The unpaid rehearsal, against the last one: arrivals off-page, camera jumps, the laws, nobody moved by an exposition or
memory segment, the frames' unsettled starts; then a few scenes by eye in World · Live.

## Decisions for the user

1. An exposition or memory segment carries nobody physically (its people are weighed by how much of it is now).
2. Scenes stay as the page's containers (the Player, World · Live) and time markers for now.

## The user's answers and what was built (2026-11-03)

- Segments are the unit (a card, median one sentence, is too thin to decide on); **a card's evidence first, weighting
  second**: the sample showed people acting in 17 of 39 exposition or memory segments (one character singing, another asking
  the clone her number), so presence is by the cards' evidence and only a memory segment (the past) places nobody now;
  each entry keeps the share that is now for the smoothing.
- The page plays by segment too, aligned: a card across a segment's boundary (74, 12%) is split there into consecutive
  cards, each with the people of its own lines (`at`); the segments stay as Jev cut them.

Built (`world-engine/director/segments.mjs`, tested): the segment world at a run's start: the reading's scenes, the
world script's, the spawn plan's (spawning places a scene's people at its first segment, later ones carry them) and the
strands (v1's extractor on the segment script: 9 forks, 1,545 entries); written beside the run in
`stage/world/segments/`, which the world log and the law check read for a run by segment. The engine splits each scene
into its segments as containers, looking up a segment's world data in its scene; the review's pins by scene apply to
each of its segments; canon folds the segments back into their scene. Then the smoother cloud fix (a start's cloud
holds the frame's own spots, those nearest where the person was played, up to half the cloud) and the frame measured
round the smoothed starts.

| Unpaid rehearsal, two passes | By scene, pass 1 → 2 | By segment, pass 1 → 2 |
|---|---|---|
| Containers played (with a cast) | 46 (46) | 346 (301) |
| Camera jumps over 40 m | 20 → 20 | **12 → 7** |
| Arrivals off-page | 55 → 13 | 99 → 46 |
| Starts outside their frame: metres before → after smoothing | 6,517 → 6,270 (4%) | **28,032 → 5,163 (82%)**; 7,338 → 2,201 |
| Starts still more than 8 m outside after smoothing | 33 → 35 of 65–73 | 142 → 76 of 653–494 |

The cloud fix works: the smoothing now closes most of the distance to the frame where it closed almost none. Segments
have seven times the starts (each a container), so more arrivals and frames to settle in all; the camera holds better.
Left for W10: the digest is now one request a segment (346), paid in a real run.
