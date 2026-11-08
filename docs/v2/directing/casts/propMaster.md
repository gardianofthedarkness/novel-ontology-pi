---
type: "cast"
id: "propMaster"
aliases: ["Prop master"]
status: "partial"
fired_by: ["vehicles", "weapons"]
read_by: ["transport"]
tags: ["directing/cast", "status/partial"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Prop master

A summary cast: the work model reading the text. Status: **partial** (`world-engine/digest/digest.mjs (items)`). Back to [Directing](../Directing.md).

## What it writes

- vehicles: kind, who drives or rides
- weapons: kind, who holds them
- things held, thrown, broken

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- sentence kind **action**: its share in the window's sentences, weighted by each one's confidence
- signal **vehicles named**: the reading's vehicle slots and things (23 vehicle slots in volume 1)
- signal **weapons named**: the reading's weapon slots (27 in volume 1)

## How it is asked

How often: one request a fired span.

**System**

> You read a passage of a light novel and list the vehicles, weapons and things handled in it.

**Task**

> Each vehicle, weapon or thing: what kind, what happens to it, who has it.

**Given**

- the span's lines
- the reading's vehicle and weapon slots
- the things already known and who holds them

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `things` | **name**: as the text calls it; **kind**: `car` · `motorbike` · `bus or truck` · `train or subway` · `drone` · `aircraft or VTOL` · `boat` · `robot` · `handgun` · `rifle` · `blade` · `blunt weapon` · `explosive` · `tool or device` · `other`; **event**: `appears` · `held` · `picked-up` · `put-down` · `thrown` · `given` · `broken` · `used`; **who**: &lt;person id&gt; \| null; **to**: &lt;person id&gt; \| null; **size**: metres |

## Read by

- [Transport specialist](../directors/transport.md) (its own cast)
