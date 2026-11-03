---
tags: [directing, milestone, research]
---
# M9 · The crowd as a field (research note, 2026-11-03)

The user (2026-11-03): look at how a group of particles behaves; instead of the director choosing where each one goes,
the crowd enters states: scared and running away in different directions, or some other state. A discussion note, not a
design yet: what the research offers, how it maps onto our physics, and what needs the user's decision.

## What the engine does now

The scene digest says the background crowd is `none | few | many` and what it does (`crowdDoing`). The director spawns
that many anonymous walkers (`extra:<scene>:<n>`, named 路人) and drifts them like people, card by card
(`director.mjs`, around `extras`). That is the W9 complaint: a crowd moving as individuals is disturbing; a crowd is a
cloud tied to the place.

## What the research offers

| Work | What it shows | What we take |
|---|---|---|
| Helbing, Farkas & Vicsek, *Simulating dynamical features of escape panic*, Nature 2000 ([abstract](https://ideas.repec.org/a/nat/nature/v407y2000i6803d10.1038_35035023.html); [a 2024 look back](https://collective-dynamics.eu/index.php/cod/article/view/A168)) | The social force model: each body pulled toward a desired velocity, pushed off others and walls; one parameter mixes acting alone and following neighbours (herding). Clogging at exits and faster-is-slower emerge; the look back prefers "stress" to "panic" as the word | One motion law for every state, the state only changing its parameters: desired speed, what pulls, how much people follow each other |
| Moussaïd, Helbing & Theraulaz, *How simple rules determine pedestrian behavior and crowd disasters*, PNAS 2011 ([arXiv](https://arxiv.org/pdf/1105.2152)) | Two visual heuristics (the clearest way toward the goal, and a speed that keeps a safe time to collision), relaxed over 0.5 s, give lanes and, with body contact, crowd turbulence | A cheap per-particle rule for drawing a few hundred figures |
| Hughes, *A continuum theory for the flow of pedestrians*, 2002; Treuille, Cooper & Popović, *Continuum Crowds*, SIGGRAPH 2006 ([paper](https://grail.cs.washington.edu/projects/crowd-flows/78-treuille.pdf)) | The crowd as a density over space; speed falls with density; each group follows the gradient of a potential (the cost to its goals, an eikonal equation); lanes and vortices emerge, in real time | The crowd as a field on the place's walk grid: a density and, per state, a potential field to follow. No identities |
| Crowd psychology typologies: Blumer (casual, conventional, expressive, acting), Berlonghi 1995 (spectator, demonstrator, escaping) ([overview](https://en.wikipedia.org/wiki/Crowd_psychology)) | Crowds classed by purpose and emotional intensity; a crowd moves between types over time; no consensus on one list | A small set of states, the crowd moving between them, smoothed |
| Emotional contagion in crowds: Xu et al., multi-hazard panic, IEEE SMC 2021 ([arXiv](https://arxiv.org/pdf/1801.10000)); a systematic review of agent-based contagion, 2022 ([Springer](https://link.springer.com/article/10.1007/s10458-022-09589-z)) | Alarm spreads outward from a hazard's "perilous field" and between people; it decays once they are out of danger; mechanisms differ and comparisons are inconclusive | Alarm as a field that spreads from a hazard and decays, not a switch on everyone at once |
| Zhou, Tang & Wang, *Measuring Crowd Collectiveness*, CVPR 2013 ([paper](https://openaccess.thecvf.com/content_cvpr_2013/papers/Zhou_Measuring_Crowd_Collectiveness_2013_CVPR_paper.pdf)) | A measure of how much a crowd moves as one, from neighbours' consistency up to the whole crowd | A check that a state looks like itself: strolling low, flowing or fleeing high |

## How it maps onto our physics

- **The crowd is a cloud of the place, not people.** A density over the place's open ground and floors (the walk grid of
  the frame, M14 strands), its size from the digest's `few | many` and the story's time; the figures drawn are samples
  of the density each frame, with no ids, not in the cast, the camera's group or the laws.
- **The director chooses a state, not destinations.** A state is a hidden variable of the place along its strand, read
  from the text and smoothed forward and backward like everything else; the motion follows from one law (the social
  force, or its continuum form) with the state's parameters:

  | State (proposed) | What pulls | Speed (L17) | Following neighbours | Noise |
  |---|---|---|---|---|
  | Milling (strolling, shopping) | shop fronts, benches; nothing strong | stroll | low | high |
  | Flowing (going somewhere) | the place's exits and stations | walk | medium | low |
  | Gathering (watching something) | a focus, held at a ring's distance | walk, then still | medium | low |
  | Alarmed (scared, fleeing) | away from a hazard, toward exits | run | high (herding) | medium |
  | Gone | out of the frame | run or walk | — | — |

- **Hazards come from the play.** A blast, a fight's area attack, a catastrophe (the choreography faculty's findings)
  puts a hazard on the map; alarm spreads from it as a field over time and decays, so the crowd flees outward and
  thins, people near it first. No crowd state needs to be asked where a hazard already says it.
- **The quantum reading.** The crowd is literally the cloud our particles only approximate: a probability density whose
  potential the state sets; the state is the measurement the text makes of it; the smoothing collapses it with all the
  evidence, before and after.
- **Who reads it.** The ambience faculty (registry: establishing, environment sentences, the crowd signal), fired where
  a crowd is mentioned: one work-model request a fired stretch, for the crowd's size, state, focus and hazard, each
  with how sure. Jev is not needed for it.

## The field acts on the characters (the user, 2026-11-03)

> Crowd should be fields. They have pronounced states in different situations, but the reason why we want them into
> field is because they could have potential influence back on our characters such as slower moving speed.

Decided: a field (decision 2 below). Its point is the coupling, both ways, through quantities the engine already has:

- **Speed through a crowd** (the fundamental diagram): walking speed falls with the local density ρ, from free walking
  at an empty street to a standstill at a crush. Weidmann's diagram, fitted to 25 studies, uses a free speed of 1.34 m/s,
  a maximum density of 5.4 people a square metre and a constant of 1.913 (the Kladek form, commonly
  v(ρ) = v_free · (1 − exp(−1.913 (1/ρ − 1/5.4))); to check against the source before it is built)
  ([parameters](https://arxiv.org/pdf/0901.0170); [the Kladek form](https://arxiv.org/pdf/1512.01426)); there is no
  single accepted diagram for pedestrians ([ETH 2019](https://strc.ch/2018/Bosina_Weidmann.pdf)). Where it enters:
  - the path integral: a walk edge costs its metres over v(ρ) at its time, so a character goes round a thick crowd when
    a way round is cheaper, through it when not;
  - L17 (displacement): reach in a beat is v(ρ) times the beat's time, so a chase through a festival street covers less;
  - the smoother's S_walk: the effort between moments counts the crowd, so a slow stretch is not read as a teleport.
  A character's own ways keep their speed where the crowd cannot slow them (a leap over it, a flight, a vehicle on a
  road the crowd keeps off).
- **The characters act on the crowd**: a character is a moving obstacle the field parts around (a car, someone
  running through); a hazard the play makes (a blast, an area attack, a catastrophe) starts alarm that spreads and
  fades; a fight is a focus a crowd gathers round at a distance, until it becomes a hazard.
- **More couplings to weigh later**: earshot (L6) shrinks in a noisy crowd; a crowd hides a person from a pursuer or a
  camera; a dense crowd takes the open ground that spots and landmarks offer.

A proposed law, beside §9's: **L20 · Crowd drag**: a body's speed on foot through a crowd field is the field's speed at
its density; displacement, reach and walk costs read it; a way the crowd cannot hold (air, a cleared road) is exempt.

## Decisions for the user

1. **The states**: start with the five above (milling, flowing, gathering, alarmed, gone), or another list (the
   typologies' expressive or aggressive crowds, a queue, a parade).
2. ~~Field or particles~~ **Decided: a field** (the user, 2026-11-03), so it can act back on the characters (above);
   the figures drawn are samples of it.
3. **Named crowds**: a crowd the story names (a school's parade, a gang) as its own field and state, held as an
   Organization in the ontology, or plain background.
4. **Deeper research**: a research handoff for the math (the potential fields per state, alarm's spread and decay,
   the density-speed relation and its parameters), as with the percolation and trap reconstruction handouts.
