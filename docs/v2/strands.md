# Strands: groups in envelopes (the user, 2026-11-09)

> "The idea of strand is a timeline performed by a group of people in a limited, enveloping area. The destructions and
> physics engine doesn't interfere another strand. If the time is the same by mentioning the two groups united, the
> strands reunify into one. Today our strands simply diverge." — the user, 2026-11-09, revisiting the strand system
> before the cross-book carry (M16) and the first volume 2 run (W16).

## 1. The definition

A strand is three things at once:

| | What it is | What it means for the engine |
| --- | --- | --- |
| **the group** | the people performing it | a person is in one strand at a time; a person's state (where they stand, since when) is the strand's (L1) |
| **the envelope** | the limited area the group performs in: the smallest place of the tree, at or above the envelope scale, that holds the group's scenes; it moves with the group when the whole group moves | the physics of the strand (blasts, rubble, things moved) happens inside its envelope and in its own world layer: it never touches another strand |
| **the timeline** | its scenes in story order | the director plays a strand in its own order; a strand is smoothed on its own |

Three rules follow:

1. **A split** is a sub-group performing in another envelope while the rest of the group stays. A person stepping into
   another room, another building, another street of the same envelope is not a split: the strand goes on, with that
   person elsewhere inside it.
2. **A union** is a scene whose people were last in two or more strands: the text has the groups together, which *is*
   the statement that their time is the same. From that scene on they are one strand, with both histories: the larger
   strand (most scenes) keeps its id; the others close into it (`unites`), and their world layers merge into its own.
3. **Open or closed.** A strand not closed by a union is open; at the book's end the open strands are the candidates
   the cross-book carry reads (resolved or broken off: docs/v2/borrow-and-spawn.md §4.5, M16a). A strand closed by a
   union lives on in the strand it joined.

A flashback is a strand of its own in the past: it plays from the past's state and hands nothing on (L1, v1's law 3).

## 2. Today, measured (volume 1, library 16)

v1's strands run on the v2 world script (`src/v2/extraction/strands.ts`, world-engine-v2.md §2.0.7a): each person's
scenes are a chain; a scene continues the lane of the predecessor it shares most people with when it is that
predecessor's best continuation, else it opens a lane; a fork is a lane run (`src/digger/stage/environment.ts`
`forkTimeline`). The director builds the same on its segments (`world-engine/director/segments.mjs strandsFile`).

- **28 forks, 18 of them one scene.** The main fork holds 229 of 286 scenes. Of the 27 side forks, 16 start in the same
  street as the main fork's scene just before them (the checks say so too: 10 `split: same place`); 6 in another
  district; 5 unplaced. Someone stepping out for one scene is a fork today.
- **Time evidence is thin.** 3 scenes in the book carry a stated time node; every other node is inherited. Ordering is
  nearly all shared people (worldlines); so "the same time" can only be read from the text having the groups together.
- **The world is one.** The director plays the segments in reading order in one world; a blast in a side fork is seen
  by every later scene of every fork. Damage records carry their fork (`stage/world/log/<run>.jsonl`), nothing else is
  scoped: W15's 24 blasts are 8 in the main fork and 16 in fork `scene_000162` (6 scenes), which closes into the main
  at scene 173.
- **Unions exist but are not kept as such.** 3 forks come from two forks; the main's identity goes on, and the file
  says nothing about what was united and when.

Re-stranded by the rules of §1 (`scratchpad/w15/restrand.mjs`, the text alone):

| Envelope scale | Strands | One-scene strands | Main strand | Splits | Unions |
| --- | --- | --- | --- | --- | --- |
| today (v1 lanes) | 28 | 18 | 229 scenes | — | 3 |
| building | 27 | 16 | 213 scenes, unites 22 | 18 | 21 |
| street | 25 | 15 | 211 scenes, unites 21 | 17 | 21 |
| **district** | **18** | **10** | **244 scenes, unites 18** | 14 | 17 |

At the district scale the ten one-scene strands left are people alone in another district (eight) and environment
scenes elsewhere (two): divergences by the definition. The district is the recommended default; a book whose action
stays inside one district would set `street`.

## 3. The builder (M17a)

One builder for the book's file and the director's segments (`src/v2/extraction/strands.ts` `groupStrands(script, {
envelope })`; `experiments/v2/strands.mjs` and `segments.mjs strandsFile` call it), the scenes walked in reading order:

1. A scene's **sources** are the strands its present people were last in (flashbacks aside).
2. **No source** (an environment scene, first appearances): the open strand whose envelope holds the scene's place,
   else a new strand.
3. **One source** S: the scene continues S when its place is in S's envelope or the whole group moved (the envelope
   moves with the group); otherwise a new strand splits from S (`from: [S]`, S's `to`).
4. **Two or more**: a union; the strand with most scenes keeps its id, the others close into it (`unites`, `to`).
5. **Entries** per person as today (`from`, `samePlace`): the per-person worldline does not change.
6. **Checks** kept: `split` (always `envelopes differ` now), `union`, `apart` (a chapter ends with open strands),
   `conflict` (one person in two places at one stated moment).

`strands.json` keeps its shape (`scenes[{ id, fork, layer, lane, continues, entries }]`, `forks[{ id, scenes, people,
from, to }]`, `checks`) and adds per fork `envelope`, `unites`, `open`; `lane` is the strand's index, `layer` the scene's
story index. The envelope scale is a setting, `strands.envelope` (universe, book; default `district`).

Consumers and what changes for them: spawning (`spawn.mjs`: entries; unchanged), the director's gate and world log
(a scene's fork; fewer, longer strands), the smoother (per strand; chains follow entries; unchanged), the laws (L1
"first in this strand" amendments should fall: a step-out no longer starts a strand), the review's identity proposals
(strand order), the cross-book registry (M16a: `open` and the people by name).

## 4. Physics per strand (M17c)

The world's damage state (`shared.units`, `standing`, `rubble`, `things` in `export-strand-demo.mjs`) becomes a layer
per strand over the built world, copy-on-write by lot: a blast in a strand writes the strand's layer; the director plays
a scene in its strand's layer and the page shows that layer; a split copies the parent's layer; a union merges (a unit
broken in either is broken; a thing moved by both is where the later scene left it); a closed strand's layer goes with
the union. The world log records damage with its strand as now. At the book's end the open strands' layers are what the
cross-book carry keeps (M16c), and a nominated place's own lot keeps every strand's damage.

## 5. Re-strand after smoothing (M17d)

The text's strands are the reading's view; the run's smoothing (`world-engine/smoother`) gives each person's place at
each moment. Re-stranding reads the groups off those positions: who stood within whose frame in each unit, which
envelope of the tree held them; a split the text hid (someone who was in another district all along), a union the text
did not say (two groups within earshot) are reported against the text's strands, and the cross-book registry (M16a)
takes the smoothed strands when a run exists, the text's otherwise. Volume 1's W15 record is the first case.

## 6. Order of work

M17a–c before the first volume 2 run (the carry of M16 needs the strands' identity and openness, the layers make the
carry the strand's own); M17d built on W15's record, applied to volume 2 after its run.
