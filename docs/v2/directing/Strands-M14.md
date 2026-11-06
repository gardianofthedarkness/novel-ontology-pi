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

## The off-page arrivals, read against the text (2026-11-03)

The user: "for the 44 sudden appears, how many of them are reasonable from the actual text reading, and how many of
them are mistakes made by our system". The 43 arrivals off-page of the last rehearsal's second pass (by segment, with
L18), each read in its lines:

| What the text says | Arrivals | Whose mistake |
|---|---|---|
| **Reasonable**: someone comes from elsewhere (walks into a bar with the others, drives up with sirens, clings to a tower's wall after leaping, shows up at a fight, is in another room with someone) | 9 | none: they should come, but by a way through the city, not appear |
| Someone carrying straight on in the same place, thrown out by a scene-level check left in the director (the scene's spawn box: people who drifted out of it during the scene count as from elsewhere at the next segment) and placed beside the group | 21 | the engine (L1 should come first: a straight-on entry stays wherever it stands) |
| The strand breaks between two segments of one office the attack splits (scenes 19 and 20): everyone in the second has no `from` | 5 | strand extraction |
| Someone the world script lists in the scene with no card of them acting, speaking or spoken to (a flashback, an interlude, a room they are not in) | 7 | presence: the script-only rule ("present from the scene's first segment") |
| A line given to the wrong speaker in the reading | 1 | the reading (EM²) |

So about one in five is the story's own arrival; the rest are three things in our system. The frames of a rule-made
reader (a street 4 m wide) make the engine's mistake show more often than real frames would, but not cause it.

**L19 reserved** (the user, 2026-11-03): planned, not used for W10.

## Between strands: the exact logic now, and a double guard (proposal, 2026-11-03)

The user: "tell me the exact logic that keeps between strands, maybe we can do a double guarded stricter physics on
that".

**What decides where someone comes from, now.**
1. **Strands** (`src/v2/extraction/strands.ts`, v1's `storyStrands` on the world script, by segment since M14): each
   container gets a layer and a lane from the evidence of order (a person shared, a flashback, stated times that differ
   within one top place); `continues` is the container its lane continues.
2. **Forks** (`src/digger/stage/environment.ts` `forkTimeline`): a container is on the fork of the one its lane
   continues, else it starts a fork. Each person's **entry** in a container: `from` is the **last container in reading
   order** where they were in the cast (a flashback has no `from` and does not count as last); `samePlace` when the two
   share a place id. So `from` may cross forks, and it follows the order of reading, not of story time.
3. **The director** (`director.mjs` `prior`): a person starts where `from` left them (the end of that container), else
   their last position on the fork of `from`, else their last on the container's own fork, else nowhere (spawned).
   Someone the strand carries straight on (same place, from the container this one continues) stays where they stood;
   anyone else outside the frame comes in (now: walks the route; before: appeared off-page).
4. **The laws** (`laws.mjs` L1): someone carried in must come from the container their entry names; carried from another
   (or carried with no `from`) is a violation, recorded, not prevented. L5 checks the time only where the story states a
   clock (W9: never). L2 (two places at once) has nothing to check when parallel containers are not marked as such.
5. **The smoother** (`smoother.mjs` `chainsOf`): a person's moments chain along the entries' `from`; a `samePlace` link
   costs one step, another link a scene change's worth; no chain crosses strands except where an entry does.

**Where it is weak.** `from` is reading order, not story time (a parallel strand read later can hand someone over);
nothing checks at the hand-over that the body could have made the trip (only L5, and only with a clock); a fallback to
"their last position on the fork" can bring someone from a stale moment; places are "same" only by equal ids (a room
and its building differ).

**A double guard (proposed).** A hand-over carries a body only when both guards pass:
- **The story guard**: the entry's `from` must precede this container in story time (the time tree, not reading order),
  on the same fork or across a fork link the strands found (a split or a merge); a flashback hands nothing over; no
  fallback to an older position.
- **The physics guard**: the way from where `from` left them to this container's frame must fit the time between at
  their fastest way (L17's speed × the beats' durations, or the clock where stated; L12's ways), and they cannot be in a
  container that overlaps it in time elsewhere (L2).

Both pass: they are carried (they stay, or walk the route). The story guard fails: they start fresh here, the gap held
for the review. The physics guard fails: they walk the route anyway and arrive late (partway into the container),
held for the review and, after W10, for L19 to weigh.

## The fixes and the routes (2026-11-03)

The user: fix the 21 and the 7, with presence that follows physics ("no one disappears or moves suddenly segment after
segment until new presence or next ground truth"), and the arrivals by a route through loaded blocks.

- **Straight on stays**: someone the strand carries straight on stays wherever they stand, ahead of the scene's spawn box.
- **Presence by physics** (`segmentPresence`): placed only by the cards' evidence; held at that place, segment after
  segment, at the same story time, until evidence puts them elsewhere or the time moves on; never by the script alone;
  a memory segment places nobody now.
- **Routes**: someone coming from beyond the frame walks the whole way, in legs that each fit one walk graph window,
  the blocks loaded as they reach them; L5 checks the route where a clock is stated; only a route with no way found ends
  off-page.

| Unpaid rehearsal, two passes | Before (pass 1 → 2) | After (pass 1 → 2) |
|---|---|---|
| Arrivals off-page | 99 → 43 | **20 → 6** |
| Routes walked (pass 2) | — | 14, 8 reaching (median 184 m, longest 1.2 km) |
| Actors not there (L9 held) | 41 → 41 | **12 → 12** |
| Moves | 1,500 → 1,542 | 3,716 → 3,651 (more people stay present, and drift) |
| Camera jumps | 6 → 7 | 6 → 9 |

The 6 left are routes that found no way (a leg with no walkable ground loaded in reach). Then the hand-overs in story
time ([Forks-M15](Forks-M15.md) §1) joined scenes 19 and 20.
