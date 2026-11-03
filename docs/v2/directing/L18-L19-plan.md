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

## L19 · Elastic terrain: the city in back-propagation

**The state.** Each terrain site (a place's position in its parent) becomes latent, its prior the spawned position with
the terrain's own energy (`energyOf`: rings, pairs, pressure, squeeze) as the cost of moving it, so the city's shape
holds unless the story needs otherwise.

**The observations.** L5's failures: a person who must be at place B a story-time t after being at place A, too far at
the fastest way their abilities allow. Each is a soft term: the distance beyond what speed × time covers, at a cost.

**Who explains a failure, cheapest first** (the user's "review of ability groups suggest low energy level of
supporting such move"): a way the person has (L12: a leap, a flight, a vehicle; the abilities config, still empty);
a time read wrongly (the time tree); only then the places nearer (L19). The review (Pi) is asked where abilities are
the question.

**How it is solved.** The sites' positions minimise the terrain energy plus the travel terms (the zoom engine's sweeps
already minimise E over a grid with a strict decrease, so it ends), moving only the sites the failures involve and
their neighbours. The world is spawned again from the moved sites (`stage/terrain.json` versioned, the old kept in the
world's history), and the director replays from its caches (nothing asked again where nothing changed).

**Steps.**
1. Decision 22 first: story time's periods as spans (late night 22:00–04:00), so L5 has times to check.
2. L12's abilities config (the main agent's): who leaps, flies, drives; otherwise every superhuman journey looks
   impossible.
3. L5's failures collected per strand, each with the distance, the time and the explanations tried.
4. The site solver (`world-engine/terrain/elastic.mjs`): the terrain energy plus the travel terms, the sites moved, J in
   metres of city.
5. Respawn and replay; the laws again.

**Checked by.** L5 failures before and after (each explained by an ability, a time or a moved site), the metres the
city moved, no overlapping lots, the terrain page by eye. Cost: nothing paid for the solver; a respawn is the engine's
own work.

## Order and size

L18 first: it is local (a blast and the walks near it) and its evidence is already in the runs. L19 after: it needs
decision 22 and the abilities config before it has anything to act on, and moving the city changes every path in it.
L18 is about the size of the smoother (W5b); L19 about the size of terrain spawning's site placement.

## Decisions for the user

1. **L18's later evidence**: add "broken" and "intact" as fact kinds of the summarizer (paid in a real run), or begin
   with the cards and paths only.
2. **L19's prerequisites**: decide decision 22 (periods as spans) and give the abilities config (or let Pi draft it from
   the reading for the review), before L19 is built.
3. **Before W10 or after**: L18 before W10 (its evidence comes from runs we have); L19 after decision 22 and the
   abilities config, possibly after W10.
