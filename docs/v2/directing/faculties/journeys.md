---
type: "faculty"
id: "journeys"
aliases: ["Journeys"]
status: "proposed"
fired_by: ["traversal", "scaleJump"]
read_by: ["mega"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Journeys

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- from, via and to as places of the tree
- the manner (alleys, up a wall, leaps, carried)
- distance and duration

## When it fires

When these grow unusually dense in a span (the gate: density against the book's baseline, on at μ + 1.5σ, off below μ + 0.5σ):

- block type **Pursuit / traversal**: going somewhere at scale: chases, escapes, crossing the city (volume 1: the escape (1), the chase to the subway (3), the tower leaps (26), the tower's shaft (34))
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
