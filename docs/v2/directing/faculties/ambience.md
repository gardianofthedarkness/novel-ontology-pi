---
type: "faculty"
id: "ambience"
aliases: ["Ambience"]
status: "proposed"
fired_by: ["establishing", "crowds"]
read_by: ["mega"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Ambience

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- the crowd as a density of the place: its make-up and flow
- weather, light, mood
- set dressing

## When it fires

When these grow unusually dense in a span (the gate: density against the book's baseline, on at μ + 1.5σ, off below μ + 0.5σ):

- block type **Establishing / ambience**: where and when: the place, weather, crowds, mood (volume 1: the openings of 1, 2, 10, 45)
- signal **crowds named**: the reading's crowd slots (134 in volume 1)

## How it is asked

How often: one request a fired span.

**System**

> You read the setting of a scene of a light novel and describe its crowd and atmosphere for the stage.

**Task**

> The crowd (how many, who, how it moves, whether it is a named group), the weather, the light, the mood.

**Given**

- the span's lines
- the reading's crowd slots in the scene
- the set

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `crowd` | **present**: `none` · `few` · `many` · `packed`; **makeup**: [couples, shoppers, students, workers, security, onlookers, …]; **flow**: `still` · `milling` · `along the street` · `a queue` · `marching as one body` · `fleeing` · `gathering`; **named**: &lt;crowd slot id&gt; \| null |
| `weather` | words |
| `light` | words |
| `mood` | words |

## Read by

- [Mega-scene director](../directors/mega.md)
