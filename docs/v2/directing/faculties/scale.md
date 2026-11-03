---
type: "faculty"
id: "scale"
aliases: ["Scale and view"]
status: "proposed"
fired_by: ["always: each beat"]
read_by: ["routine", "mega", "combat"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Scale and view

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- the zoom: how many metres across the beat plays (a room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km)
- the view angle: eye level, over a shoulder, high, top-down, low looking up, aerial
- whose eyes or which landmark it is seen from
- how far its moves reach

## When it fires

Always: once each beat.


## How it is asked

How often: one request a beat.

**System**

> You read one beat of a light novel being staged in a 3D city, and recommend to its camera operator how far out to stand and from where to look.

**Task**

> Say how many metres across this beat plays, the angle to see it from, whose eyes or which landmark it is seen from, and how far its moves reach.

**Given**

- the beat's lines
- the scene frame (the set, who is on stage)
- which action director leads it
- the place tree round the set

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `zoom` | `a room (~15 m)` · `a street (~80 m)` · `a block (~300 m)` · `a district (~1.5 km)` · `the city` |
| `metres` | a number |
| `angle` | `eye level` · `over a shoulder` · `high` · `top-down` · `low, looking up` · `aerial` |
| `from` | &lt;person id&gt; \| &lt;place id&gt; \| none |
| `reach` | `under 50 m` · `50–300 m` · `300 m – 2 km` · `over 2 km` |

## Read by

- [Routine director](../directors/routine.md)
- [Mega-scene director](../directors/mega.md)
- [Combat director](../directors/combat.md)
