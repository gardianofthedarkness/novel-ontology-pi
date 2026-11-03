---
type: "faculty"
id: "setting"
aliases: ["Set description"]
status: "proposed"
fired_by: ["establishing", "buildings"]
read_by: ["architect"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Set description

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- a building's look, floors and uses (a 70-floor tower: mall, offices, flats)
- a room's make-up (a container bar, a thick-doored cell)
- changes to them

## When it fires

When these grow unusually dense in a span (the gate: density against the book's baseline, on at μ + 1.5σ, off below μ + 0.5σ):

- block type **Establishing / ambience**: where and when: the place, weather, crowds, mood (volume 1: the openings of 1, 2, 10, 45)
- signal **buildings named or described**: place EM's buildings and the spatial mentions

## How it is asked

How often: one request a fired span.

**System**

> You read the description of buildings and rooms in a light novel for the architect who builds them.

**Task**

> Each building: its look, its floors and what each holds, its features; each room: where it is and what is in it.

**Given**

- the span's lines
- the building the world borrowed for it (floors, size, kind)
- the place tree

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `buildings` | **place**: &lt;place id&gt; \| name; **look**: words; **floors**: a number; **uses**: **floors**: from–to; **use**: `shops` · `mall` · `cinema` · `restaurants` · `offices` · `flats` · `hotel` · `school` · `hospital` · `station` · `car park` · `plant room` · `rooftop deck`; **features**: [helipad, sky garden, atrium, elevator shaft, …] |
| `rooms` | **name**: words; **in**: &lt;place id&gt;; **floor**: a number; **makeup**: words; **size**: m² |

## Read by

- [Architect](../directors/architect.md) (its own faculty)
