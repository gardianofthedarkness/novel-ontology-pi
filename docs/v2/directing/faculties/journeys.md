---
type: "faculty"
id: "journeys"
aliases: ["Journeys"]
status: "built"
fired_by: ["traversal", "scaleJump"]
read_by: ["mega"]
tags: ["directing/faculty", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Journeys

A summary faculty: the work model reading the text. Status: **built** (`world-engine/digest/digest.mjs journeysOf (M6)`). Back to [Directing](../Directing.md).

## What it writes

- from, via and to as places of the tree
- the manner (alleys, up a wall, leaps, carried)
- distance and duration

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Pursuit / traversal**: going somewhere at scale: chases, escapes, crossing the city (volume 1: the escape (1), the chase to the subway (3), the tower leaps (26), the tower's shaft (34))
- sentence kind **action**: its share in the window's sentences, weighted by each one's confidence
- signal **a jump in scale**: the scene frame: a scale band wider than the scene's own

## How it is asked

How often: one request a fired span.

**System**

> You read a passage of a light novel being staged in a 3D city and trace each journey in it across the city's places.

**Task**

> For each journey: who, from where, through which places, to where, how, how far and how long.

**Given**

- the span's lines
- the place tree round the set, with named buildings, streets, bridges and stations
- where each person is now

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `journeys` | **who**: &lt;person id&gt;; **from**: &lt;place id&gt;; **via**: [&lt;place id&gt;]; **to**: &lt;place id&gt; \| words; **manner**: `walk` · `run` · `zigzag through alleys` · `up or along a wall` · `leaps between roofs` · `flight` · `carried` · `a vehicle` · `an underground passage`; **distance**: `under 50 m` · `50–300 m` · `300 m – 2 km` · `over 2 km`; **duration**: words |

## Read by

- [Mega-scene director](../directors/mega.md) (its own faculty)
