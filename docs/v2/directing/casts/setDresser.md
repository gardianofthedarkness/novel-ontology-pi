---
type: "cast"
id: "setDresser"
aliases: ["Set dresser"]
status: "proposed"
fired_by: ["establishing", "buildings"]
read_by: ["architect"]
tags: ["directing/cast", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Set dresser

A summary cast: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- a building's look, floors and uses (a 70-floor tower: mall, offices, flats)
- a room's make-up (a container bar, a thick-doored cell)
- changes to them

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Establishing / ambience**: where and when: the place, weather, crowds, mood (volume 1: the openings of 1, 2, 10, 45)
- sentence kind **environment**: its share in the window's sentences, weighted by each one's confidence
- sentence kind **fact**: its share in the window's sentences, weighted by each one's confidence
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

- [Architect](../directors/architect.md) (its own cast)
