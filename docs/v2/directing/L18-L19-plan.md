---
tags: [physics, plan]
---
# L18 and L19 into the smoothing (plan, 2026-11-03)

The user: "let's do destruction and terrain in smoothing first before full volume run … stop before L18 and L19, give
me a plan on those two". The laws are in [physics-laws.md](../physics-laws.md) §9; the smoothing they join is the
smoother's action, S = S_walk + S_seen + S_talk + S_frame + S_events ([world-ontology.md](../world-ontology.md) §5a),
whose objective already counts destruction (J's μ·|ΔE|, "change the history least, in space and in destruction energy").

## Where they stand (W9, volume 1)

- **Destruction** is applied forward, once: a card the text says breaks something gets Jev's spot and size (lettered
  spheres), the blast takes the building's structure units at that card, and that is final. W9 recorded 20 blasts;
  L13 checked 27 and broke none. Nothing later in the strand can move a blast in time or size, and no walk may pass
  through matter that has not been blasted.
- **The terrain** is spawned once (terrain spawning: each place's site in its parent, the manifolds and their energy,
  `src/v2/terrain/topology.ts`), then fixed. L5 (travel takes time) checked nothing in W9: volume 1's scenes state
  periods ("late night"), not clock times, so no journey had a time to fail (decision 22). L19 needs L5 to fire first.

## L18 · Tunnelling and destruction as a smoothed state

**The state.** Each blast becomes a hidden variable, not each unit: when it happened (a card within the window its
evidence allows) and how strong (its energy, over the sizes Jev was offered: 4, 8, 16, 32 m spheres). A building
part's state (intact, damaged, gone) follows from the blasts before that moment, so it is monotone: nothing rebuilds
unless the text says so.

**The observations.**
1. The card that tells the break (the digest's breaks, the fight's exchanges that break something, the destruction
   card): the blast's prior, as sure as the reader was.
2. Later lines that show the state: something already broken, still standing, a hole someone climbs through
   (the summarizer's facts can say "broken" or "intact" of a place, one more kind of fact).
3. Paths: a walk that crosses where a wall stands is evidence it was gone by then (tunnelling read backward).

**The action.** S_events for each blast (its prior at its card, its energy at Jev's answer), S_seen for the later
states, and a coupling to S_walk: crossing matter costs −log P(gone at that moment), so a path through a wall is
possible only where a blast plausibly came first, and a walk that needs it raises that belief. Least change is the
μ·|ΔE| term J already has: a blast moves in time or size only as far as the evidence asks.

**How it is solved.** Per blast, a small grid (its window of cards × its sizes), scored by the action and smoothed
forward and backward with the paths of the strand's moments that pass near it (the smoother's clouds near a blast's
sphere); the least-action history keeps each blast's card and size. The next pass applies each blast at its smoothed
card and size (as smoothed starts are applied now), and the walk graph gets tunnelling edges through the cells a blast
has taken by then.

**Steps.**
1. Blasts as observations: each with its card window and the size distribution Jev gave (now only the top answer is kept).
2. Facts of state: "broken" and "intact" as fact kinds of the window digest (checked like the others; implied too).
3. The blast smoother (`world-engine/smoother/blasts.mjs`, pure): the grid, the action, the coupling to the people's
   clouds; its revisions in the record like the start revisions, J in metres and joules.
4. The engine: blasts applied at their smoothed card and size on the next pass; tunnelling edges in the walk graph
   (a version per blast, so windows rebuild only where it struck).
5. A law check: no path through standing matter (L18), and L13 as now.

**Checked by.** Two unpaid passes on the volume: blasts moved (how many, how far in cards, joules changed), paths
through standing matter (none), scenes 21 and 27 (the ground splitting, the rooftop) by eye. Cost: nothing paid; the
digest's new fact kinds are paid only in a real run.

## L19 · The city floats: places as relative truth (the user, 2026-11-03)

> A place's source of truth is relative source of truth. For example we are sure people are in a building, and this
> building is sure to stay in a district, but any other tree in between is floating. Think of all manifolds as floating
> on top of the city. Now, based on all ground truth confirmed in the past, we have a certainty of every tree
> relationship in places. The more firm it is, the harder for the two places to be apart. And this certainty comes from
> time tracks of characters over the past. The bigger the area, the harder to move either.

And: most arrivals off-page should be resolved by this terrain smoothing.

**The bodies.** Every place of the tree (a district, a street, a block, a building, a room) is a manifold floating over
the city, its middle x_P free to move; its mass is its area, so the bigger it is, the harder it moves. Nothing has an
absolute position as truth; the city's frame is held by its largest masses.

**The bonds: how sure each tree relation is.** A child place C in its parent P is a spring that keeps C inside P's
extent, costing k_CP · (how far C pokes out of P)². Its stiffness k_CP is the certainty of the relation, grown from
ground truth over time: every confirmed position of a character (pinned, stated, met; the world log's ranks) in C at a
moment the strand has them in P adds to it, from the place tree's own confidence as the prior, so
k_CP = 1 − Π (1 − w_e) over those confirmations e, each w_e its rank's weight. A building the text keeps putting in a
district is held there firmly; a street between them that no one confirms floats.

**The tracks: what characters' journeys say about distances.** Two places a strand passes between (a person in A, then
in B) can be no farther apart than the way allows in the time between: speed (L12's ways; walking by default) times
the time (the story's clock where it states one; else the beats' durations the scale reader gives, L17). Beyond that a
track costs k_AB · (excess)², its stiffness again the confirmations' certainty. An arrival off-page is exactly such a
track that the city cannot hold now; it pulls A and B together, the lighter one moving more.

**Least change.** Every place costs its mass times how far it moves from where the city has it (the history of the
city changes least), and siblings keep apart as the terrain's own energy has them (rings, pairs, pressure: no overlap).

**How it is solved.** The energy (bonds + tracks + mass × displacement + the terrain's) is relaxed: a few sweeps of the
places' positions, each lowering it (as the zoom engine's sweeps do), heavy places barely moving, floating ones taking
up the slack. Its input is the last pass's smoothed history (every track and confirmation of the strands so far); its
output moves the sites in `stage/terrain.json` (a version kept), the world is spawned again where sites moved, and the
next pass plays on the new city. So the city is part of back-propagation: each pass's ground truth firms its bonds.

**Steps.**
1. The bond certainties from the world log (confirmed positions per place, by rank) and the place tree's confidence.
2. The tracks from the strands (consecutive containers of a person at different places) with their time (clock, else
   beats' durations) and way (L12; walking until the abilities config exists).
3. The relaxation (`world-engine/terrain/float.mjs`, pure: places, masses, bonds, tracks in; moves out, J in metres
   weighted by area).
4. Sites moved in the terrain, the world respawned, the next pass replayed from the caches.

**Checked by.** Off-page arrivals before and after (most should go), the tracks still beyond reach (each named), the
metres the city moved weighted by area, no overlapping lots, the terrain page by eye.

## Order and size

L18 first (approved by the user): it is local (a blast and the walks near it) and its evidence is already in the runs.
L19 after: its evidence is the strands' tracks and the world log's confirmations, already in the runs; decision 22
(clock spans) and the abilities config sharpen its tracks but are not needed to begin, since the beats' durations give
the time between containers. Both before W10.

## Decisions for the user

1. **L18's later evidence**: begin with the cards, Jev's size answers and the walks that failed near a blast (nothing
   paid); "broken" and "intact" as summarizer facts later if needed.
2. **L19's speeds**: walking for everyone until the abilities config exists (a superhuman's journey then pulls places
   too hard), or a draft config from the reading first.
