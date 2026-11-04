---
tags: [directing, run, checklist]
---
# W10 from a fresh reading (2026-11-04)

The user: "We can do a full vol1 reread. Before that check all the rules tuned and changed this time for re-read from
the last ever fresh reread. Let's do a re-read, rebuild terrain from blank canvas, no cache, and fresh run for w10."

The last reading made with no cache was `v2-vol1-uncached` at 5858c24 (2026-10-31 02:30, $0.356). Every reading since
was built on its cache: `v2-vol1-settled` (one fix), `v2-vol1-mentioned` (one paid request), then block types, kind
scores and segments added to it by separate scripts.

## What changed in the reading since then, and where it runs now

| Change | Commit | Runs in |
|---|---|---|
| A named entity's category settled by its typings; building parts and floors are no places | 0a52e62 | the flow (`read.mjs`) |
| The context engine composes every Jev request of the reading | e91d56f | the flow |
| Places: talked of is not there; mentioned is not there (a scene's setting only where it puts someone) | e16e3d1, 3579d54 | the flow (place EM), the world script |
| Unnamed people who speak or act are present and spawned | a9054a0 | the world script (`workspace.mjs`) |
| M1: sentence kinds keep their whole distribution and top three | c4afd25 | the flow (was backfilled by `kind-scores.mjs`) |
| M2: block types in the kinds pass | 1e3ceca | the flow; `read.mjs` now writes them into data.json (it computed them but never wrote them: the current reading has them only from `block-types.mjs`) |
| Things: an item, weapon or vehicle only where it matters in its passage (a dedicated name, an important role, a function that changes the scene); routine things never | 9b114e4, 1e87569 | the flow (listing, typing) |
| The move rules (a word of moving makes an action; a move with no one said to move) | e4e43bc, 5315147 | reverted (4616fa3, 0315d8a): not in |

After the reading, in order:

| Step | Commit | Runs in |
|---|---|---|
| M14: segments (Jev's cut per sentence and type per segment, smoothed, with the purpose of each kind) | c4e9a26 | `segment-tiling.mjs --mode smoothed --write` on every scene (paid) |
| The workspace: canon and the world script from the reading; sampling pools into a new universe registry | 3589741 and after | `workspace.mjs` into a new library with no `universe/` (the blank canvas) |
| Story strands on the world script | efb2d7f | `strands.mjs` |
| Terrain: kinds by level, pools, pins, compatibility, shapes, settling, spawning by type; start positions by rule | 1fe7303 … f5dbd62 | `novel sim terrain <novel> --spawn --from city --run` (paid), no terrain cache |
| The director, everything since W9: segments as containers, presence by physics, story-order strands, routes and departures, the virtual subway, the crowd field, L18 blasts, talk on one floor, places in story time, Jev's tokens metered | through 1e87569 | W10, from a fresh built checkout, on the new workspace (no director cache) |

Not in W10: L19 (floating places, reserved); a place per segment (places are still per scene, for the user to decide);
the objective replay (M15 §4).

## Segments by the tiler's wording (the user, 2026-11-04)

"There's no more scene needed anymore. Everything runs on segment level … no two prompts for two levels", and then: "we
simply tune the prompt and the wording so there's no scene, only segments. There's no even code change needed." The
reading's tiler keeps its code; its three questions and its seam's heading now ask for segments
(`src/digger/autostep/segmentation.ts` `tileScenes`): a segment is one continuous place, time and viewpoint and one kind
of action; a new one begins where the place changes, time skips, the viewpoint shifts, or the kind of action changes
(talk into a fight, a fight into a chase, action into inner thought, scene-setting into events, or back), not where a
speaker, a sentence, a blow or a moment changes within the same kind. What the code calls a scene is then a segment, and
`segment-tiling.mjs` (a second cut) is not run. (A first attempt with a new tiler was reverted at the user's word.)

**Each scene a segment (the user's choice, 2026-11-04).** A reading with no segment list (the tiler now cuts segments)
is played with each scene as its own segment under its own id (`segments.mjs` `scenesAsSegments`, `segmentWorld`): its
kind from the block answers over its own sentences, so the gate fires per segment; presence by physics, no borrowed cast
and the rest of the segment path apply. Rehearsed on the first quarter with the reading from before segments (scenes
1–13): 13 containers, all cast, none borrowed, the gate by segment, L6 1 and L10 1 broken.

**One unit downstream (the user, 2026-11-04: "examine all the places involving segment versus scene split in our
downstream codes, unify them").** The world engine has one unit, the reading's scene (a segment, as the tiler now cuts):
`segments.mjs` builds the played views by unit (cards aligned, presence by physics, starts for those present, kinds
from the blocks for the gate); the director plays them under their own ids (no `scene~part`, no parent map, no pins
copied to parts, no borrowed cast); the world builder takes them as `played` (cast, spawn, strands); the log, the laws
and the rehearsal read the played views; canon is by the units as played. A reading with M14's second cut plays its
scenes. Rehearsed on the first quarter: 13 containers, all cast, none borrowed, the gate by unit, L6 1 and L10 1.

**Built for W10 (2026-11-04), from f5ea3b5, nothing cached.** Reading `v2-vol1-w10b` (973 Jev requests, input about $0.35;
177 work-model requests): 107 units, median 40 sentences, longest 251. Library `v2-host-state-11` (a blank universe):
the workspace and strands; terrain from blank (130 Jev calls: 175 places, 2 cities, 12 districts, 103 streets, 58
buildings); starts by rule (288 starts; 12 units with nobody placed). The host serves it. Rehearsed unpaid on the first
quarter (units 1–26, its copy `rehearsal-novel-w10b`): all 26 cast, none borrowed, 150 cards, no camera jump over 40 m,
22 arrivals off-page, L6 5 (one unit: two people 291 m apart), L10 0. W10 waits for the user.

**Arrivals off-page: the solver's overflow (2026-11-04).** The first-quarter rehearsal of the build left 22 people
arriving off-page: each route from afar stopped at a leg with "no way there on foot". The replays
(`why-walk.mjs`, now drawing stopped routes from metres the record keeps) showed the ground connected in every case,
in the run's walk window and in the solver's own box. The run's own solve, replayed, gave a field of NaN: in each
window, a lift from a deep hall (90 m down, a flat cost of 24; underground.ts) let the path integral's potential fall
720 across one edge, its weight overflowed to infinity, and infinity times zero spread NaN through the field, which
then "converged" with no first step. `solveWalk` now scales its potential until it holds on every edge (most fields
keep it whole); a test keeps the lift case. First quarter after the fix: arrivals off-page 22 to 0, all 41 routes
arrive, L6 5 to 0; the rehearsal 6.3 to 5.4 minutes.

## The faculties are a reading step (the user, 2026-11-04)

The faculties read the text, not the world: none takes Jev's decisions, positions or walks; only Journeys touched the
terrain (the place ids it may name, with their boxes), and all took who is present from the run. So they run once per
reading, after the world script and before terrain and any play (`experiments/v2/faculties.mjs`, the work in
`world-engine/digest/faculties.mjs`), and write `faculties.json` beside the reading:

- the **Generalist** (the summarizer) on every unit in reading order, its memory carried; **Scale and view** on every
  beat; **Journeys**, **Choreography**, **Conversation** and **Ambience** where the gate fires them;
- who is present: the reading's cast by physics from the cards, with the review's pins over it (the world's evidence comes
  back to the reading; a rerun pays only for what changed, the work model's answers cached beside the reading);
- Journeys is offered the places the story has by then: the named places the city carries and the unnamed ones that have
  happened in story time; a place's box stays the engine's to find.

The director and the rehearsal read `faculties.json` when it is there and ask the work model nothing for the faculties
(`--no-faculties` to ask as before). First quarter, rehearsed: the same play card for card, no work-model request in the run.

Order for a fresh run: reading → segments (the tiler's own) → workspace and strands → **faculties** → terrain → starts →
the run.

**Made for W10 (2026-11-04, from e55eb87, nothing cached):** `v2-vol1-w10b/v2/faculties.json`, 107 units in 17 minutes,
663 work-model requests (1.32M prompt and 0.23M completion tokens). The Generalist on every unit (375 moves, 330 facts,
276 items, 1,589 talk, 55 breaks; 4 windows failed), Scale on 107 beats, Journeys on 36 units (81 journeys, 3 to a
place id, the rest said in words), Choreography on 38 (83 exchanges), Conversation on 48 (1,023 channels, 137
formations), Ambience on 42 (78 crowd reads).

## Two passes of one tiling (the user, 2026-11-04)

"Maybe we can do a similar structure which is double level tiling triggering with slightly different prompt, although
we still treat the final result as one process and the middle layer isn't preserved." The tiler (`tileScenes`) takes a
wording: the **scene pass** asks where the place, the time or the viewpoint changes (its wording from before, so its
answers are the earlier readings' cache), and the **kind pass** asks, inside each scene-pass span, where the kind of action
changes. The reading keeps only the kind pass's spans as its scenes; the scene pass is not kept.

First quarter (blocks 1–2, 1,331 sentences; 334 paid Jev requests with the caches of both earlier readings):

| | One pass (segment wording) | Two passes | M14's per-sentence cut |
|---|---|---|---|
| Units | 26 | **86** (median 9 sentences, longest 71, 4 of one sentence) | 124 |
| M14's starts found (±1 sentence) | 24 | **67** | — |
| Cuts at an M14 start | — | 62 of 86 | — |
| The old scene starts kept | — | 16 of 16 | — |

**The units' types in the reading (the user, 2026-11-04: "connect the type pipeline in reading").** After the two tiling
passes, each unit is typed whole (M14's type step, now the reading's own: forty units a request, the kinds with their
purpose, the whole distribution kept on the scene); the engine prefers it to the block answers over the unit's sentences,
and the sentence-kinds pass no longer asks the twelve-sentence block types. First quarter, against the 60 hand-labelled
sentences there: typed whole, 39 right at the top and 0.56 on the true type; the block average over the same units, 33 and
0.43 (M14's segments were 35 and 0.58 on its own test). 3 requests for 86 units.

**The faculties' firing on these units (the user, 2026-11-04: "check if it needs to be retuned").** The gate fires a
faculty on a unit whose mixed index (its type distribution, its sentences' kinds, its signals) stands above the reading's
mean, the rule tuned on M14's segments. Scored again per sentence against the same oracle (the real faculty reads of
scenes 1–13, 1,146 sentences, 77 of the new units over them), nothing paid:

| Rule | Units: F1 / read | conversation | journeys | choreography | M14 stretches: F1 / read |
|---|---|---|---|---|---|
| Above the mean (current) | **0.58 / 0.33** | 0.75 | 0.52 | 0.48 | 0.65 / 0.31 |
| Its types at least 0.05 | 0.59 / 0.41 | 0.81 | 0.44 | 0.51 | 0.68 / 0.37 |
| Index at least 0.5 | 0.58 / 0.26 | 0.70 | 0.58 | 0.46 | — |
| Every unit | 0.46 / 1 | 0.86 | 0.29 | 0.23 | — |

No rule on the grid beats the current one at its cost (on at −0.5…1.5, off, at least, margin, and the type floor), so
FIRING stands. The oracle's truth is M14's stretches (a stretch found something, every sentence of it counts), which
favours M14's own cuts; the gap to it (0.58 against 0.65) is partly that. What it misses on the new units is recall
(journeys 0.61, choreography 0.56); a lower bar for those two (−0.25) reads 0.95 of the fights and 0.82 of the journeys at
twice the reading. An oracle read on the new units themselves would settle both (paid; not done).

## Volume 1 rebuilt on the two-pass units (2026-11-04)

From 0b6e551, stopped before W10. **Reading** `v2-vol1-w10c` (two-pass tiling and unit types, started from the earlier
readings' caches; 966 paid Jev requests): **286 units**, median 10 sentences, longest 174, 9 of one sentence; every unit
typed; 3,111 cards. **Library** `v2-host-state-12` (a blank universe): the workspace and strands (all 286 placed);
**terrain** from blank (144 Jev calls: 185 sites, 2 cities, 12 districts, 103 streets, 68 buildings); **starts** by rule
(490: 480 people, 10 things; 68 units with nobody placed, all with nobody present in the world script, median 4
sentences, mostly interior and exposition).

**Faculties** (`v2-vol1-w10c/v2/faculties.json`; 1,341 work-model requests, 1.93M prompt and 0.31M completion tokens, none
failed): the generalist on all 286 units (354 moves, 346 facts, 260 items, 1,604 talk, 47 breaks), scale on 286 beats,
journeys on 79 units, choreography on 103, conversation on 119, ambience on 84. Three fixes on the way:

- **One retry** (0b6e551): a request whose reply is unreadable or that fails is asked once more with half as much room
  again. 5 replies were unreadable the first time; every one came back on the retry.
- **Journeys and places** (0b6e551, f4ce2e9, d460643): the places near a unit are offered first (its own, the units' either
  side, their parents, siblings and children, and the places first told in those units), and a place said in words is
  matched to one offered, its label as the text names it (without " (scene 8)" and " · pool"), the label ending latest
  in the words first (the head of a Chinese phrase). A place first told inside a unit now exists from that unit for the
  director too: before, only a unit's own place did, so the unnamed places mentioned in a unit were never offered.
  Journeys to a place: **32 of 87** (22 named by id, 10 matched from words), against 3 of 81.
- **In parallel** (deebf41, a15c8db; the user: "parallel for different faculties if they don't have dependencies"): only
  the summaries wait on each other (each takes the memory of the unit before). A unit's windows and its five other
  faculties start as soon as its summary is in, all at once, twelve requests at a time. The first run took 36 minutes:
  20 for the generalist, 16 for the others one after another. With a stand-in answering after the same delay each time,
  80 units took 66 seconds against 229. The file is the same (each faculty's answers now kept in span order, so a
  rerun is identical).

**Held is not on stage (8e9d69f; the user, 2026-11-04: "fix them").** 68 units had nobody started: spawning read the world
script's raw `present` (only who speaks, acts or is addressed in the unit itself). The director's own cast, presence by
physics, had the opposite fault: 225 of the 286 units are placed at the whole city and story time has four moments, so
everyone once seen was held in every later unit (a median cast of 15, up to 32; the 107-unit build the same, 14 and 31),
and the faculties were offered those casts. A unit's cast is now who is in view: given evidence there, named or described
there while held, or given evidence there within the last 30 lines. Everyone held stays where they were (`held`); the
director acts only on the cast, so nobody is moved or removed. Spawning starts the cast the director plays. Casts: a
median of 4, at most 11; units with nobody started: 4 (before anyone has acted).

Faculties asked again on these casts, with the parallel step: **11 minutes** (670 s) against 36, 1,340 requests (1.80M
prompt, 0.30M completion tokens), none failed. Generalist 360 moves, 343 facts, 263 items, 1,613 talk, 55 breaks; journeys
88 on 79 units, 34 to a place; choreography 90 exchanges on 103 units; conversation 1,038 channels on 119; ambience 78 on 84.

Every faculty reads the original text where it fires (numbered lines with their kinds) and part of its unit's summary:
the windows the whole summary and the memory carried from the units before; scale and journeys the summary and where;
choreography the summary and where; conversation where alone; ambience where and the background crowd. None of the five
has the memory, nor what the generalist's windows found.

**Rehearsed (units 1–84, the first quarter; unpaid, the stand-in Jev).** Followed person by person through the kept page:
of 323 unit starts, 279 exactly where the person last was, 43 first appearances, and all 23 who came back after being out
of a cast came back where they were. One jump: an off-page arrival in unit 26 (a 4-leg route found no way on its second
leg and the director put the runner at the destination; replayed in the run's own window the way is there, 110 m, so the
run failed on something the replay does not recreate). Against the same units with the old presence rule:

| | Held = present (before) | In view (8e9d69f) |
|---|---|---|
| L11, four people on one 2 m cell | 43 | 0 |
| L6, talk across a distance | 2 | 6 (5 the off-page arrival in unit 26) |
| L9 | 1 | 1 (the same card) |
| L10, moves held | 0 | 3 (the stand-in's landmark pick was the building they stood in) |
| Off-page arrivals | 2 | 1 |
| Minutes | 8 | 6 |
