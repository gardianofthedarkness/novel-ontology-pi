---
type: "decisions"
aliases: ["Decisions needed"]
tags: ["directing", "decisions"]
---
# Decisions needed

**Where things stand (2026-11-03).** M1–M8 are built, each tried with the stand-in Jev and a work model answering by
rule; the whole volume rehearsed unpaid end to end (`world-engine/director/rehearsal.mjs`, 25 minutes): every scene
played with a cast, no move into a basement, 96 beats scaled, 38 journeys, fights exchange by exchange; camera bounces
(out over 40 m and back within three cards) 5, against W9's 12. Paid so far for M2: 56 Jev requests (block types).
What only a paid run can show: whether Jev, given the wider pictures and the readers' claims, chooses well (8, 14).
The tests: 52 world-engine tests and 790 of 792 TypeScript tests pass (the two: an existing `/var` against
`/private/var` path check, and the faculty flow, fixed since).

What building M2–M8 turned up that is yours to decide. Each says what was found, what was done for now, and the choice.
Newest last. Back to [Directing](Directing.md).

## From M2: block types (2026-11-03)

1. **Interior is the largest share in many action scenes.** Volume 1 narrates thought through its fights: scene 21 reads
   interior 0.38, catastrophe 0.22, traversal 0.21; scene 26 interior 0.39, traversal 0.27, confrontation 0.23; scene
   35 (the flashback) interior 0.77, memory 0.21. *Done for now:* the world is held still only where the damping types
   (interior, exposition, memory) hold 60% or more of a block **and** no action director's own faculty fired there
   (`damped()`); 26% of the volume is held still. *Your call:* keep this rule, or let interior still the world less.
2. **Scene 21 is not a fight to Jev.** Its blocks read the ground splitting (catastrophe), the escape from the flood
   (traversal) and Touma thinking (interior); confrontation 0.01. The combat director still leads its catastrophe beat,
   through choreography. *Your call:* is that right, or should scene 21's opening be a mega-scene beat?

## From M3: the gate (2026-11-03)

3. **Conversation fires on 36% of the volume**, just over the 10–35% aimed for (journeys 10%, ambience 18%, setting 17%,
   feeling 21%, props 23%, choreography 26%). *Your call:* accept, or raise its line (k_on 1.5 → 1.75).
4. **Check five scenes' leads on the strip** ([gate-volume-1.html](gate-volume-1.html), pick a scene): 96 beats; routine
   leads 56, mega-scene 22, combat 18. For example scene 1: routine, then traversal → mega-scene; scene 3: routine, then
   traversal → mega-scene; scene 21: catastrophe → combat, …; scene 26: traversal → mega-scene, then interior → combat;
   scene 42: mediated → routine. The full list: [Gate](Gate.md).
5. **The strip is its own page for now**, not yet in World · Live's Dev panel. *Your call:* move it into the Dev panel
   now, or after W10.

## From M4: the stage manager (2026-11-03)

6. **Four scenes are slivers of the tiling**: 15 (four sentences), 20 (one), 41 (one), 43 (two), nobody named in them.
   *Done for now:* a sliver that carries on keeps the scene before's cast where they stand. *Your call:* keep that, or
   have the reading's tiling merge slivers into their neighbours (a reading change; volume 1 would need its tiling
   redone).
7. **The cast gathers within 80 m of its middle.** Anyone carried in from further walks in (to 300 m) or is placed.
   In scene 40 the rooftop fight spreads its cast about 180 m, so scene 41 moved six of them back together. *Your
   call:* 80 m, or tie it to the scene's scale band once M5's scale faculty gives one.

## From M5: scale and view (2026-11-03)

8. **Real distances need Jev's own answers.** The stand-in proves the pictures, reach and camera follow the zoom (scene
   26's traversal beat: an aerial frame 200 m out over the towers); whether Jev then chooses the far tower is only seen
   in a paid run. *Your call:* a small paid run of scenes 1 and 26 before W10 (about 40–80 Jev calls), or wait for W10.
9. **The scale reader is one request a beat** (96 beats in volume 1, cheap on the work model), asked as each scene
   begins, so a run waits a few seconds a scene. *Your call:* fine, or fold it into the scene digest's request.

## From M6: journeys (2026-11-03)

10. **Leaps and flights go straight through the air** where the walk graph has no way (it has no air edges; tower to
    tower in scene 26 is none). The move is marked airborne, and L12 checks the person has the ability. *Your call:*
    a straight glide is enough for now, or build arcs in the air (a sky graph) before W10.
11. **The landmark map offers the twelve tallest buildings within the journey's reach.** A low destination (a
    station entrance, a bridge) can only be picked as "none", which falls back to the arrows. *Your call:* keep the
    tallest, or mix in named places and street features (bridges, stations) once the place tree has them in the world.

## From M7: the combat director (2026-11-03)

12. **Jev is asked about an exchange only where the reader is under 0.6 sure** (its kind, shape and outcome on one
    picture). *Your call:* that line, or ask Jev on every exchange of a fight (more calls, Jev deciding on the picture
    every time).
13. **Conditions are recorded and held**, not written: a fight's "hurt", "unconscious", "bound" go into the world log
    and the ledger as held proposals, for the review; canon writes them to `conditionsAdd` in M11. *Your call:* hold
    them all, or let canon apply the sure ones (0.8 and over) without review.

## From M8: the routine director (2026-11-03)

14. **L6 can only be counted on a real run.** The talk law reads the run's page, which a stand-in run does not write.
    W9's 85 came mostly from the background's drift carrying people out of earshot mid-talk; those talking or in a
    formation now hold their places, and a talk known to be remote no longer breaks it. *Your call:* count it in W10, or
    a small paid run of scenes 11–17 first (the crosswalk, the phone call, the dart bar).
15. **Formations are placed by rule round the group's middle**, not asked of Jev (the proposed room-plan question is not
    built). *Your call:* enough for W10, or build the formation question on a room plan for the dart bar's kind of scene.

## From the rehearsal (2026-11-03)

16. **Six camera jumps happen within a beat with no long move:** someone far joins the group on screen (a talk pulls
    the addressee 150 m to the speaker in scene 3; a stated "indoors" fact moves someone). *Your call:* frame only the
    beat's first group until its members arrive, or keep framing everyone taking part.
17. **The background's routine moves most:** 1,317 of 2,194 moves in the rehearsal are routine drift (the rule-made
    digest has everyone walking or standing). The real digest decides who walks, so W10 will differ; it is the knob for
    how busy scenes look. *Your call:* keep the drift spans (strolling 2–4 m, walking 3–6 m a card), or calm them.

## Your answers (2026-11-03)

- **1 · Faculties co-fire.** "Multiple faculties are allowed to fire at the same time if evidence sufficient." No type
  holds the world still any more; thought fires the inner-state faculty beside whatever else the evidence fires.
- **2 · Smoothing per strand.** "Because our data is simply back tested, we don't need to predict the future. You can
  do smoothing on type distribution confidence scores per strand." The block types are smoothed forward and backward
  along each strand (not decoded scene by scene); the beats and the mixed index read the smoothed distributions.
- **7 · No hard-coded distance.** "Any sort of problem should be inferred by laws of physics. Propose a new physics if
  there's issues that can't be solved." The 80 m gathering and the 300 m walk-in go: presence in a scene is its frame
  (L16), and whether someone walks in is the travel time the story allows (L5, L17). New laws proposed in
  [physics-laws.md](../physics-laws.md) §9.
- **8 · Referential distance.** "Proportional or referential semantic distance description dynamically adjusted might
  work better" than metres in semantic space. The scale reader now says a referent (the room, the street, the
  building, a landmark…) and how many of it; the director measures that referent in the world.
- **10 · Yes, and tunnelling.** "When positioning during when destruction happens, later ground truth Bayesian smooth
  both path and both state of destruction. The destruction of building is also quantum and back propagatable."
  Proposed as L18 (designed; built after W10's paths).
- **11 · A controlled test of Jev's picking.** Baked-in vectors, semantic descriptions, or small thumbnail references:
  which makes Jev pick more precisely. Run on cases with a known answer.
- **16 · The city is part of back-propagation.** "Terrain can be dynamically redrawn if cost of travel time is
  impossible and review of ability groups suggest low energy level of supporting such move." Proposed as L19 (designed).

Not answered yet: 3, 4, 5, 6, 9, 12–15, 17.

## From your answers, built (2026-11-03)

- **1 and 2, built**: no hold-still switch; block types smoothed forward-backward per strand, a type changing more easily
  at a scene's cut (volume 1: 211 of 831 blocks change their top type; 109 beats; conversation now 34%, inside the aim).
  A beat's lead also weighs its smoothed type (a confrontation is the combat director's).
- **7 and 8, built**: the scale reader answers in referents (the room, the street, the block, a landmark, body lengths)
  and a beat's duration; the director measures them in the world (rehearsal, scenes 1–3: the street 16 and 40 m wide
  where it played, rooms 6–20 m). The cast gathers within the measured frame (L16); someone from outside it arrives
  off-page, and where both scenes state their time L5 is held when the distance cannot fit (pointing to L19). A card's
  reach is its way's speed times its share of the beat's time, drift the same (L17); a step is about a body's length,
  nearby within the frame, a fight's throw said in body lengths or a referent and measured. The only unit kept is a
  person's height (1.7 m).

18. **Distances still fixed**, and whether each should go: the talk law's live 4 m and public 25 m (L6; the conversation
    reader's channel and the room or street could replace them), the 400 m ceiling on a picture and on the spots looked
    for (what the world streams in at once, an engineering limit), and the camera's own reaches when a beat has no
    scale. *Your call:* which to make referential next.

## The pick test (2026-11-03)

11, answered by a test ([Pick test](Pick-test.md), 64 Jev requests): words (floors, distance, which way on the map)
94%, vectors 63%, the plain map 56%, thumbnails 50%. Height cannot be read from a top-down map; words carry it. The
landmark question now says which way each building lies on the map, beside its floors and distance.

19. **Words beat pictures for attributes, and pictures alone are weak at height.** *Your call:* give every Jev question
    on a map (arrows, spots, landmarks) its options in words too, or test the arrows and spots the same way first.
20. **Jev's confidence separates right from wrong** (0.83 against 0.33 with words). *Your call:* hold a pick under a
    confidence line for system 2 or the review, as with the text questions.

## The second rehearsal (2026-11-03)

After 1, 2, 7 and 8 were built: every scene played with a cast, camera bounces 1 (the first rehearsal 5, W9 12), the
background's drift halved (now speed times the beat's time), 22 talks recognized as remote.

21. **Presence in the frame moves many off-page.** With frames of a room or a street (what the rule-made reader gave),
    73 people arrived off-page rather than being carried in. The real reader will frame wider where the text does, but
    L16 makes the frame decide who is in a scene. *Your call:* keep L16 as is, or let someone carried in stay when the
    strands say the scene carries straight on, whatever the frame.
22. **L5 rarely has a clock to check against**: volume 1's scenes mostly state "late night", not a time, so the walk-in
    travel check never fired. *Your call:* read story time's periods as spans (late night: 22:00–04:00) so L5 and L19
    have something to work with.

## v1's two turns (2026-11-03)

"You should be able to find the two turn height locking design in v1. Quantum applied to boxes." Found
(`two-view-things.mjs`: find by a choice, lock from a second turn at right angles) and tested ([Pick test](Pick-test.md),
16 more requests): the side view locks height (1/6 on the map, 6/6 with it), two turns 81% with pictures alone. The
landmark question now asks both turns and multiplies their distributions. The director's boxes already had it (a rough
box on a plan, then the exact box and lettered heights from the side).

23. **Words and two turns together are untested.** Words alone 94%, two turns alone 81%. *Your call:* keep both on the
    landmark question (as now), or test the pair before W10.
24. **How the turns combine**: a plain product, or each turn weighed by Jev's sureness (equal with 16 cases). *Your
    call:* more cases first, or the plain product.

## Decision 21, answered by smoothing (2026-11-03)

"All our time space physics work on strand basis. If a ground truth came in and physics disagrees, Bayesian smoothing is
applied to back propagate the sampled likely path … If problems are met, the first thing you think of whether this is
something the physics didn't cover, or the back propagation least action definition didn't converge."

Read that way, decision 21 was both: L16 was built as a cut outside the action that overrode L1 (the strands' "same place,
straight on"), and the smoother never saw the frame, nor ran in a rehearsal. Now someone the strands carry straight on
stays where they stood; the frame is a term of the action (S_frame, [world-ontology §5a](../world-ontology.md)); the
rehearsal smooths each pass, and a second pass plays from the first one's smoothing (`rehearsal.mjs --passes 2`).

The whole volume, unpaid, two passes (20 minutes each):

| | Second rehearsal | Pass 1 (L1 first) | Pass 2 (from pass 1's smoothing) |
|---|---|---|---|
| Arrivals off-page | 73 | 55 | **13** |
| Carried straight on, outside the frame | — | 19 | 18 |
| Scene starts the smoothing moves | — | 136 | 118 |
| Camera jumps over 40 m | 24 | 20 | 20 |

**Not converged yet:** 35 scene starts stay more than 8 m outside their frame after smoothing (the frame term moved the
total only from 6,789 m outside to 6,515 m), some far (915 m in scene 11, 492 m in scene 39). The cause is the search
space, not the action: a moment's cloud is the 48 spots nearest where it was played, so a frame hundreds of metres away is
not among the places the smoother may put them. The fix is to add the frame's own spots to a scene start's cloud, as a
talk partner's place is added.

## M14, segment tiling: the first test (2026-11-03)

`experiments/v2/segment-tiling.mjs` on scenes 3, 12, 21, 26, 35 and 40 (1,123 sentences; 20 Jev requests, 1,326
questions): per sentence, one yes/no "does a stretch of another kind begin here?", a cut where Jev holds it more likely
than not; then each segment typed with the nine block types in one document a scene.

| Scene | Sentences | Segments | One-sentence segments | Cuts that keep the type | Beats from blocks |
|---|---|---|---|---|---|
| 3 | 114 | 27 | 15 | 7 | 3 |
| 12 | 144 | 36 | 22 | 19 | 4 |
| 21 | 278 | 31 | 15 | 13 | 8 |
| 26 | 92 | 29 | 20 | 15 | 2 |
| 35 | 18 | 3 | 2 | 1 | 1 |
| 40 | 477 | 83 | 49 | 47 | 5 |

- **Per sentence, Jev over-cuts.** Its cut probabilities sit at 0.5–0.8 (median about 0.6), it marks every one-line
  shift (a single thought inside a fight, one sound before an attack), and about half its cuts lead into the same type.
  That is the sentence level, which the sentence kinds already carry.
- **Merged where neighbours share a type, the stretches read right, and better than the blocks.** Scene 26: the blocks
  gave traversal then interior and missed the fight; the stretches give who she is (exposition), her thoughts, the leap
  between towers carrying a girl (traversal), the cars bursting out through the glass (confrontation), a long inner
  stretch, and the attack at the end (confrontation). Scene 3 opens with a short memory the blocks smeared into routine.
- **Not right yet:** one-sentence islands and alternations (traversal, confrontation, traversal) inside one stretch.

Next, with no length rule: ask for starts as the scene tiler does (Jev detects a boundary better choosing where the
next stretch begins than voting sentence by sentence), or keep the per-sentence probabilities and type distributions
and let the strand's forward-backward smoothing absorb islands by their evidence. Both on the same six scenes.

### Tuned (2026-11-03): smoothing wins

| Scene | Raw cuts | Smoothed (from the cache, nothing paid) | Start selection (33 requests) | Beats from blocks |
|---|---|---|---|---|
| 3 | 27 | 12 | 11 | 3 |
| 12 | 36 | 12 | 4 | 4 |
| 21 | 31 | 9 | 1 | 8 |
| 26 | 29 | 13 | 1 | 2 |
| 35 | 3 | 2 | 1 | 1 |
| 40 | 83 | 22 | 5 | 5 |

- **Smoothed**: each sentence observes its segment's type distribution, and the type changes at a sentence as likely
  as Jev held a stretch of another kind to begin there (Jev's own cut probability is the transition: no fixed stay, no
  length). 209 raw pieces become 70 stretches; read against the text they hold: scene 26's leap between towers, the
  attack through the showroom glass and the attack at the end as their own stretches; scene 40's opening fight, the
  exposition on how the magic spread, who the councillor is, and the rooftop starting to give way (one sentence,
  catastrophe, sure at 0.86). Left: a few one-line islands, all where Jev was unsure (0.27–0.6); their weak
  distributions add little to a faculty's index, so they are kept, not ruled away.
- **Start selection** fails for this: a change of kind is not crisp as a change of place or time is, and Jev mostly
  answers none (scene 21, 278 sentences, one stretch; scene 40, one of 255), sure at 0.1–0.4.

For M14: one per-sentence cut request a window and one typing request a scene (about 100 and 46 requests for volume 1),
then this smoothing along each strand. Paid so far for M14: 53 Jev requests.

### The cut told what the stretches are for (2026-11-03)

The user: Jev "might need to know what will be the types of following questions being asked to have motivation of
tiling the right way". The first cut had the nine kinds in its document but not why; now the document says each stretch
is typed next with exactly one kind, a different specialist taking over for each, and to cut only where the specialist
would change (`PURPOSE`; 20 more requests).

| Six scenes | Pieces | One-sentence | Cuts into the same type | After smoothing |
|---|---|---|---|---|
| First cut | 209 | 123 | 102 | 70 |
| With the purpose | 169 | 81 | 78 | 73 |

Scene 26 reads cleaner (9 stretches: clinging to the wall and the leap between towers one traversal of 18). Scene 40
reads finer and right: its long middle alternates the face-to-face argument with the councillor and the boy's thoughts
on the city's dark side. Kept: the purpose goes with the cut.

25. **A standoff argued face to face is typed routine.** Routine is "talk and small acts in one place"; confrontation
    reads as blows and powers. *Your call:* say in confrontation that a standoff carried by talk is one too, or keep
    routine (the conversation faculty) for it and let the combat director come in only with blows.

### Segments against blocks, on labelled sentences (2026-11-03)

Sixty sentences drawn at random (a fixed seed) from the six scenes, each labelled with the nine types from the text by
the main agent before looking up either method's answer (one labeller; a standoff argued face to face labelled
confrontation, after the user's "the implicit needs to determine the attitude"). Each method's type for a sentence: the
smoothed beat holding it (blocks, the gate as it is) or the smoothed stretch holding it (segments).

| Method | Right | 3 | 12 | 21 | 26 | 35 | 40 |
|---|---|---|---|---|---|---|---|
| Blocks, smoothed beats (the gate now) | 28/60 (47%) | 4/10 | 7/10 | 7/12 | 3/10 | 0/4 | 7/14 |
| Blocks, raw | 27/60 (45%) | 2/10 | 7/10 | 8/12 | 6/10 | 0/4 | 4/14 |
| **Segments, smoothed** (with the purpose) | **35/60 (58%)** | 7/10 | 9/10 | 8/12 | 6/10 | 0/4 | 5/14 |
| Segments, smoothed (without) | 35/60 (58%) | 6/10 | 8/10 | 8/12 | 7/10 | 1/4 | 5/14 |

On the same sentences, segments were right where blocks were wrong 9 times, the reverse twice (an exact test of the
eleven gives p ≈ 0.07: better, with only sixty sentences behind it). Both miss in the same places, which no tiling
fixes:
- **A flashback typed interior** (scene 35, 0/4 for both): memory is rarely chosen; the type needs the time cue (the
  past of the story) that story time already reads.
- **A standoff argued face to face** typed routine or interior (scene 40, six misses for segments): decision 25, the
  attitude the implicit faculty should read.
- **An essayistic aside inside a fight** (a magician's misdirection, how a spell was learned) typed by the fight round
  it rather than exposition.

Decision: segments replace the 12-sentence blocks as the type questions' input (M14), with the cut's purpose kept;
memory and standoff attitude go to the type question itself (decision 25, and a time cue for memory).

### The whole distribution, not the top type (2026-11-03)

The user: "we don't need the first type to be 100% true because we have all type confidence distribution". The same
sixty labelled sentences, scored on each method's whole distribution for the sentence (blocks: the mean of the windows
holding it; segments: its segment's, then the forward-backward posterior):

| Method | Mean probability on the true type | True type in the top three | Log-loss |
|---|---|---|---|
| Blocks, raw | 0.44 | 53/60 | 1.27 |
| Blocks, smoothed (the gate now) | 0.46 | 50/60 | 2.12 |
| Segments, raw | 0.55 | 51/60 | 1.32 |
| **Segments, smoothed** | **0.58** | 49/60 | 2.05 |

- **Segments carry more of the truth**: about a quarter more probability on the true type (0.58 against 0.46), with
  the true type within the top three as often as the blocks (about 85% for every method).
- **Smoothing sharpens too far, for both**: it lifts the mean on the truth a little but, where it is wrong, leaves the
  truth almost nothing (log-loss from about 1.3 to about 2.1). A flashback or a standoff then has no second type left
  for its faculty to fire on. The beats can take the smoothed type; the faculties' mixed index should read a softer
  posterior (the smoothing tempered, or the raw distribution beside it).

## Firing on real faculty reads, scenes 1–13 (2026-11-03)

The user: test with a real faculty run (scenes 1–13), compare the abnormality detection's parameters, and the residual
flow of typing (faculties read the smoothed stretches; what they find is the next type question's context).
`experiments/v2/faculty-firing.mjs`: the scenes tiled into 109 stretches (25 Jev requests); every built faculty reader
run on every stretch (about 330 work-model requests): where a reader finds something at least 0.5 sure is where its
faculty should have fired (conversation 56 stretches, journeys 13, choreography 8). The firing rule then replayed over a
grid and scored against that, nothing paid.

| Rule | F1, mean of three | Stretches read | Conversation R / P | Journeys R / P | Choreography R / P |
|---|---|---|---|---|---|
| Every faculty everywhere | 0.34 | 100% | 1 / 0.51 | 1 / 0.12 | 1 / 0.07 |
| **Now**: the index, on at 1.5, off below 0.5, at least 2, a margin of 1, smoothed | 0.33 | 39% | 0.73 / 0.59 | 0.38 / 0.17 | 0.25 / 0.07 |
| **Best**: the index above the stretches' average (on at 0), no hysteresis, no margin, raw distributions | **0.52** | 32% | 0.71 / 0.89 | 0.77 / 0.32 | 0.75 / 0.19 |
| The faculty's types holding at least 0.1 (no z-score), raw | 0.52 | 25% | 0.75 / 0.78 | 0.46 / 0.43 | 0.50 / 0.29 |

- The rule as built was tuned for 12-sentence windows: the margin and the minimum run cover whole stretches, and on at
  1.5 misses three fights in four. On stretches, "above average" is the abnormality.
- Raw distributions fire better than smoothed (smoothing sharpens away the second type a faculty listens for).
- Per faculty the best differs (conversation fires best more freely, on at 0, off below −0.5: F1 0.82 reading half the
  stretches), but with eight fight stretches a per-faculty setting would be fitted to noise.

**The residual flow** (13 Jev requests): each scene's stretches retyped with what the fired faculties found.

| | F1 (same rule) | Recall (conversation, journeys, choreography) | Types right, 60 labelled sentences of scenes 1–13 | Mean probability on the true type |
|---|---|---|---|---|
| Before | 0.52 | 0.71, 0.77, 0.75 | 39/60 | 0.58 |
| After retyping | 0.55 | 0.70, 0.77, 0.75 | 38/60 | 0.59 |

It finds no stretch the first firing missed and does not make the types truer; the precision it adds comes from being
told what the fired faculties found, which the director can use directly (a fight stretch whose choreographer found no
blows is not the combat director's) without another type question. On the same sixty sentences the blocks' beats were
right 30 times and the segments 39.

26. **Firing settings for segments**: the index above average, no hysteresis or margin, on raw distributions; *your
    call:* adopt (with M14), and use what the faculties find for the lead instead of the residual retype.

### Co-firing, benchmarked (2026-11-03)

The grid above scored each faculty on its own, which lets several fire on one stretch but never checks that the right
ones fire together. On the same 109 stretches, 17 need two or more faculties (talk on the move 10, talk in a fight 5,
all three 2):

| Rule | Of the 17: all fired / some | Stretches fired by 2+ faculties (of them, all needed) | The fired set exactly right |
|---|---|---|---|
| Now (smoothed) | 2 / 13 | 32 (3) | 33/109 |
| Best (raw, above average) | 6 / 11 | 31 (5) | 60/109 |
| Best after the residual retype | 5 / 12 | 26 (5) | 65/109 |

Co-firing is weak under every rule: where two faculties are needed usually only one fires, and most co-firing is
spurious. Each faculty's index leans on the stretch's one type distribution, which a mixed stretch splits; the
sentence kinds (spoken lines for conversation, action lines for journeys and fights) do not depend on the stretch's
type and should carry more weight for co-firing (MIX, a free grid on the same data).

**Co-firing measured as sets** (per stretch, the fired set against the needed set): set Jaccard |fired ∩ needed| ÷
|fired ∪ needed| (both empty counts 1), averaged; the set exactly right; on stretches needing two or more, all fired
and the share of the needed that fired; and spurious co-firing (fired by two or more with one finding nothing).

| Rule | Set Jaccard | Exactly right | Multi: all fired | Multi: share fired | Co-fired (spurious) |
|---|---|---|---|---|---|
| Now (smoothed) | 0.39 | 33/109 | 2/17 | 0.51 | 32 (29) |
| Index above average, raw (MIX block 1, sentence 0.6) | 0.65 | 60/109 | 6/17 | 0.69 | 31 (26) |
| Same, MIX block 0.5, sentence 3 | 0.68 | 65/109 | 10/17 | 0.74 | 33 (29) |

Weighting the sentence kinds over the stretch's type helps co-firing a little (all needed fired in 10 of 17 against
6); spurious co-firing stays high under every weight (most stretches fired by two have one that finds nothing). Small
numbers (17 multi stretches); not adopted yet.

**Adopted (the user, 2026-11-03: "let's do wire in and M12"):** decision 26 as proposed; segments are the gate's input;
the faculties' findings steer each beat's lead; M9 waits for its details to be discussed.

## Places in story time, and what the reading extracts (2026-11-04)

From the L10 replays of the paid pilot ([physics-laws.md](../physics-laws.md), L10).

**Which places a container may name.** The user: "why there's no positive time direction order of buildings?" and "the
list should be composed of places that have happened plus a list of nominated places the city itself carries cross
volumes." The journeys reader had been offered every place of the volume's spawn plan at once, so a stair down in
scene 3 (whose own place is the whole city) was matched to the underpass of scene 21. Now a container is offered:

- the **unnamed places that have happened** by it in story time (the strands' layers, then reading order): a place is
  born at its first container, with every place it stands in;
- the **named places the city carries** (the book's terrain sites, and the universe's registry where there is one),
  whenever the story is, at the box the spawn plan gave them, else their terrain site.

A place still to come is said in words, as the text names it, and the journey falls back to a landmark in reach. The
same rule guards the journey's box (`director.mjs`, `existsBy`, `boxOf`).

**What the reading extracts as a thing.** The user: "A dart is something not important to the novel at all. It is not
nominated, not a vehicle, not a weapon. It's just something small in routine basis. There's no hint that it's something
important, don't extract it", and then the rule: "only weapons, vehicles or items that in that segment look like
probably play an important role, has a dedicated name, or has impact on the scene because of its functionality, will be
extracted. Routine things used will not." The typing step had "weapon: a weapon"; volume 1's 27 weapon slots include a
thrown dart, flames, a current, a blast and handcuffs. Now (`typing.ts`, `listing.ts`) an item, a weapon or a vehicle
is a thing only where, in the passage it stands in, it has a dedicated name of its own, probably plays an important
role, or changes the scene by what it does; the fire, lightning or blast of an ability is the ability's; anything only
used in routine there (darts at a board, a kitchen knife at cooking, traffic passing by, a bus taken home) is routine,
never extracted. The same kind of thing can matter in one passage and be routine in another. It takes effect when a
reading is made again; on a reading already made, `experiments/v2/retype-things.mjs` asks the typing step again for each
unnamed weapon and vehicle in the segment where it is first described (volume 1: 50 slots, 36 segments, one paid
request each) and can write the reading without the routine ones.

**Still decided per scene (found, not changed).** The world engine plays segments, but the place layer under them is
the reading's, made per scene: a segment stands in its scene's place (in all 39 scenes with several segments, every
segment has the scene's place; 215 of the 346 segments stand in the whole city, because their scene's place is the
city); the 96 unnamed places are born and named per scene ("… (scene 21)"); the spawn plan sets places per scene. A
place per segment, from the segment's own lines, is the next step on this layer (for the user to decide).
