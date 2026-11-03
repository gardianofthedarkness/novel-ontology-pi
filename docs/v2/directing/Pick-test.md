---
type: "experiment"
aliases: ["Pick test"]
tags: ["directing", "experiment", "jev"]
---
# Pick test: how Jev picks a building on a map (2026-11-03)

The user's question ([Decisions](Decisions.md) 11): does Jev pick more precisely with vectors drawn in the picture, with
semantic descriptions, or with small thumbnail references? `experiments/v2/pick-test.mjs`: cases with a known answer,
computed from the world's geometry, at three spots each of scenes 1 and 26 (six candidate buildings a spot, apart in
height and place); three questions, each asked four ways on the same top-down map. 64 Jev requests (jev-1.14.0).
Back to [Directing](Directing.md).

| Way | Right | Tallest | Nearest | On the way to the tallest | Confidence right / wrong |
|---|---|---|---|---|---|
| Plain map (lettered spheres, you marked) | 9/16 (56%) | 1/6 | 5/6 | 3/4 | 0.55 / 0.28 |
| Vectors (an arrow from you to each) | 10/16 (63%) | 2/6 | 5/6 | 3/4 | 0.62 / 0.34 |
| Semantic (each letter in words: floors, how far, which way on the map) | 15/16 (94%) | 6/6 | 6/6 | 3/4 | 0.83 / 0.33 |
| Thumbnails (a close-up of each, marked) | 8/16 (50%) | 1/6 | 5/6 | 2/4 | 0.56 / 0.30 |

What it says, with few cases a cell:

- **Height cannot be read from a top-down map**, and the thumbnails did not help (1/6). Words carry it (6/6).
- **Nearness is read well from the picture** (5/6 any way).
- **The spatial question** (which building lies on the way to the tallest) scores alike every way (3/4); the one miss
  was the same building every time, which may be the answer key's own ambiguity (a building near you, just off the line).
- **Jev's confidence is calibrated**: higher when right than wrong every way, most clearly with words (0.83 against
  0.33), so its answers can be gated on it.
- Drawn vectors add a little (63% against 56%); thumbnails as drawn (a far view for a very tall tower, a crowded one for
  a building among others) did not.

Done since: the landmark question (the mega-scene director) describes each building in words with its floors, distance
and which way on the map it lies.
