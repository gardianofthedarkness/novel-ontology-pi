---
type: "faculty"
id: "scale"
aliases: ["Scale and view"]
status: "built"
fired_by: ["always: each beat"]
read_by: ["routine", "mega", "combat"]
tags: ["directing/faculty", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Scale and view

A summary faculty: the work model reading the text. Status: **built** (`world-engine/digest/digest.mjs scaleBeats (M5); the director sizes the action directors' pictures, reach and camera by it`). Back to [Directing](../Directing.md).

## What it writes

- the zoom: how many metres across the beat plays (a room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km)
- the view angle: eye level, over a shoulder, high, top-down, low looking up, aerial
- whose eyes or which landmark it is seen from
- how far its moves reach

## When it fires

Always: once each beat.


## How it is asked

How often: one request a beat, as each scene begins.

**System**

> You read one beat of a light novel being staged in a 3D city, and recommend to its camera operator how far out to stand and from where to look. The scale is often only implied: leaping between towers, crossing districts, a fight in one room. Reply with JSON only.

**Task**

> How wide does this beat play, from what angle and whose view, and how far do its moves go?

**Given**

- the scene digest (where, summary)
- the beat's type and lead
- the people with ids
- the beat's lines (up to 40)

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `zoom` | room \| street \| block \| district \| city (how wide the beat plays: a room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km, the city) |
| `metres` | a number: metres across the frame |
| `angle` | eye level \| over a shoulder \| high \| top-down \| low, looking up \| aerial |
| `from` | &lt;person id&gt; \| &lt;place&gt; \| none: whose eyes or which landmark it is seen from |
| `reach` | under 50 m \| 50–300 m \| 300 m – 2 km \| over 2 km: how far its moves go |
| `sure` | 0..1 |

## Read by

- [Routine director](../directors/routine.md)
- [Mega-scene director](../directors/mega.md)
- [Combat director](../directors/combat.md)
