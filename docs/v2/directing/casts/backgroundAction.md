---
type: "cast"
id: "backgroundAction"
aliases: ["Background action"]
status: "built"
fired_by: ["establishing", "crowds"]
read_by: ["mega"]
tags: ["directing/cast", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Background action

A summary cast: the work model reading the text. Status: **built**. Back to [Directing](../Directing.md).

## What it writes

- the crowd as a field of the place (M9, world-engine/crowd/field.mjs): its size and state (milling, flowing, gathering, alarmed, gone), its focus; hazards from the fight; drag on the characters (L20)
- weather, light, mood (not yet)
- set dressing (not yet)

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Establishing / ambience**: where and when: the place, weather, crowds, mood (volume 1: the openings of 1, 2, 10, 45)
- sentence kind **environment**: its share in the window's sentences, weighted by each one's confidence
- signal **crowds named**: the reading's crowd slots (134 in volume 1)

## How it is asked

How often: one request a span where background action fires (where the scene has a crowd).

**System**

> You read a passage of a light novel being staged in a 3D city, for the crowd of the place: the people not named who fill it. Say how many there are and what state the crowd is in as the passage goes on, each time it changes: milling (strolling, shopping, standing about), flowing (going somewhere, commuting, passing through), gathering (watching or drawn to something or someone), alarmed (scared, fleeing, scattering), gone (the place emptied). Name what a gathering crowd watches, and what alarms an alarmed one, by the person it centres on where there is one. Say how sure you are of each. Reply in JSON only.

**Task**

> The crowd of this passage's place, each time it changes.

**Given**

- the span's lines (sixty a request)
- the people with ids
- the scene digest (where, background)

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `crowd` | **sentence**: &lt;sentence id where this holds from&gt;; **size**: none \| few \| some \| many \| packed; **state**: milling \| flowing \| gathering \| alarmed \| gone; **focus**: &lt;person id the crowd watches or flees, or null&gt;; **sure**: 0..1 |

## Read by

- [Mega-scene director](../directors/mega.md)
