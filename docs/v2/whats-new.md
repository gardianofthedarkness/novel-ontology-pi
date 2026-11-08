# What is new in v2 (for a teammate)

`main` is still the v1 CLI: a Pi skill that turns a novel into a queryable ontology, with gate review, the library,
portraits and the team playground. The `v2` branch (since 2026-10-26) turns the book into a **world** instead, and builds
it. Everything below is on `v2`.

## In one minute

1. **Two stages.** Extraction reads the book into a world model (who, what, when, where). The world engine builds it on
   the ground: terrain (done), then spawning positions (next), then movement.
2. **The program does geometry, Jev does meaning.** Models are never asked for coordinates or sizes. Jev answers what a
   place is, how high it rises, who a line belongs to; code turns that into ground.
3. **One context engine composes every Jev request**, as a structured state (a JSON document Jev's questions point into),
   not a hand-written prompt. A request costs its input once however many questions read it.
4. **Raw text, ranked by the question, no filler.** The user's rule after watching prompts carry a city's weather into a
   street's question: only the sentences around the place's exact name, from its best scenes.
5. **Debugging by display.** Every step is watched live (World · Live) and replayed; the user's eye on the world decides
   what is fixed next.
6. **A concept map** ([concepts.html](concepts.html), from `src/v2/concepts.ts`) names every concept we invented, with
   where it lives in code and where it is designed. A stale pointer fails `npm test`.

## What changed in the repository

| Before | Now |
| --- | --- |
| The v1 README as the front page | [README.md](../../README.md) is v2-first; the v1 README is kept whole at [docs/v1/README-v1.md](../v1/README-v1.md) |
| v2 code in one folder, `src/v2/*.ts` | `src/v2/extraction/` (the reading), `src/v2/context/` (the context engine), `src/v2/rules/` (code rules) |
| World engine scripts in `playground/`, beside the v1 team playground | `world-engine/`; `playground/` is the v1 team playground only |
| Mock pages (canvas, city fill, landscape, skeleton lab) | removed; the world engine draws the real thing |
| The design spread over four journals | [docs/v2/README.md](README.md) is the guide by stage; [status.md](status.md) says where each step stands |

Nothing in `src/` outside `src/v2/` moved. The CLI is the same (`novel sim terrain` now loads `world-engine/`).

## The ideas worth knowing before reading code

- **EM²**: EM says which entity a name is, once; EM² says who *this* line or description is, here (world-engine-v2.md §2.0.1).
- **The place tree** and its scales: city → district → street → building, each place held by one above it
  (world-model.md §2.1).
- **Sampling pools**: what the text does not nominate is drawn from a pool of the right kinds, so a barely described city
  still has its districts and streets (§2.0.11).
- **Pins, not circles**: where the text puts a place is a pin, a suggestion the optimization weighs, never a fence
  (§2.0.14–2.0.15).
- **Placement as one optimization, then settling**: distance to ties, pins, overlaps and street forms in one potential,
  minimized for the whole part (§2.0.21–2.0.22).
- **The zoom engine**: one camera layer frames what Jev sees, the same renderer the user watches (visual-context-engine.md §4.1).

## Where to start

The [terrain page](https://gardianofthedarkness.github.io/novel-ontology-pi/terrain/) shows run 11 step by step. Then
[the guide](README.md), then the concept map for anything unfamiliar.
