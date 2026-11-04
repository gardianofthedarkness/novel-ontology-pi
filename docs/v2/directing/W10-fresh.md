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
