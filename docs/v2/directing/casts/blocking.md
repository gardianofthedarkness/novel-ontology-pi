---
type: "cast"
id: "blocking"
aliases: ["Blocking"]
status: "built"
fired_by: ["traversal", "scaleJump"]
read_by: ["mega"]
tags: ["directing/cast", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Blocking

A summary cast: the work model reading the text. Status: **built** (`world-engine/digest/digest.mjs journeysOf (M6)`). Back to [Directing](../Directing.md).

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

How often: one request a span where blocking fires.

**System**

> You read a passage of a light novel being staged in a 3D city and trace each journey in it across the city's places: who goes, from where, through which places, to where, how. Use the place ids given where a place is one of them; else say the place in words as the text names it (a tower, a bridge, a station). Reply with JSON only.

**Task**

> Trace each journey in this passage.

**Given**

- the span's lines (up to 60)
- the places the world has placed, with their labels and scales
- the people with ids
- the scene digest

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `journeys` | **sentence**: &lt;sentence id where the journey ends or is told&gt;; **who**: &lt;person id&gt;; **from**: &lt;place id or words&gt;; **via**: `<place id or words>`; **to**: &lt;place id or words&gt;; **manner**: walk \| run \| zigzag through alleys \| up or along a wall \| leaps between roofs \| flight \| carried \| a vehicle \| an underground passage; **distance**: **referent**: a person \| the room \| the building \| the street \| the block \| a landmark \| the district \| the city: how far, said by what it spans; **of**: which one, in words as the text names it (a landmark), or null; **times**: how many of it (0.5, 1, 2, 3…); **duration**: words; **sure**: 0..1 |

## Read by

- [Mega-scene director](../directors/mega.md) (its own cast)
