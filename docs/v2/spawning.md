# Spawning positions (design, 2026-11-01)

Where each person and each thing of a scene stands when the scene begins, on the world the terrain built. The second step
of the world engine, after terrain; movement takes over from these positions, event by event (world-engine-v2.md §4).
Status: **designed with the user (2026-11-01); the rules built (§7), Jev's spot question next.**

## 1. What it decides

At the start of each scene, every person present and every thing in it gets a **start position**: a place (a street,
a building, its floor, a room or a composite building's part) and a point in it. Kept in `stage/world/spawn.json`, per
scene and per person or thing: the place, the floor, the point, who decided it (carried, rule, Jev) and the scene it came
from.

People and things go through **one pass** (the user's call: the reading's EM treats things as it treats people, named
things, vehicles and weapons with a presence of their own). No furniture: a thing is something the text names.

## 2. Carry on, or start fresh (rules, no model)

From the story strands (`stage/world/strands.json`, world-engine-v2.md §2.0.7a): each person's own world line, the scene
they come from and whether it was at the same place.

- **A person carries on** when their own last scene was at the same place and close in time on the time tree (the same
  day, the same or the next part of the day): they keep where they ended it.
- **A person starts fresh** otherwise: they come from another place, appear for the first time, or come back after too
  long; and in a flashback, which hands nothing on (what happens in the past moves nobody now).
- **A thing stays where it was left** (the user's call): a car people got out of, a sword nobody picked up again. It is
  never asked to move, however long ago and whoever comes, until someone picks it up; a thing held or carried moves with
  its holder (a person arriving with a weapon brings it in). A thing seen for the first time starts fresh, as a person
  does.

On vol 1: 72 people carry on and 58 start fresh, so only the fresh starts can need Jev.

## 3. Where a fresh start is, by rule

From the most specific thing known, in order:

1. **A composite building's part or a room** (a convenience store, an interrogation room): inside it, on its floor, at a
   random point of it.
2. **A building:** its floor by the scene's spatial words where it has them (on the roof, underground, upstairs); else
   asked (§4).
3. **A street, a plaza, a district:** its open ground, near the scene's setting.
4. **Together:** people (and what they carry) coming from the same scene into the same scene start as one group, a few
   metres apart.
5. **The first event's actors** start within speaking distance of each other (2–5 m), so a conversation does not open
   across a plaza.
6. **Nothing at all** (no words, no answer): a random floor of the building, a random room on it (the user's call).

A spot and a random point in it are enough (the user's call): no finer placement.

## 4. Jev, only where the rules cannot say

One question a scene, for everyone and everything starting fresh there that the rules left open: a **choice over the
place's spots**, with no picture. The spots are what the terrain built: each floor of the building, its roof, its
entrance, the street in front, each composite part inside it. A box on a picture only for a large open area with no spots.

## 5. Shown

World · Live shows each scene's start positions as the Buildings panel shows the building level: who stands where, and
who decided it.

## 6. Later

- **Crowds:** people only seen (passers-by, an audience): to discuss.
- A person coming from another place sooner than they could have travelled there: a check, then.

## 7. Built: the rules (2026-11-01)

`src/v2/spawning/positions.ts` (the rules, plain data), `world-engine/spawning/spawn.mjs` (on a book: its script, strands,
terrain and the last build's page; writes `stage/world/spawn.json`). The world script keeps each scene's things and who
holds each (`sceneThings`: a thing in an action whose only actor is one person is theirs in the scene). Until Jev's spot
question is built, a building with no spatial word starts everyone on a random floor.

Vol 1 (46 scenes; no model call): 144 starts, 130 people and 14 things. People: 72 carried on, 23 on an area's ground, 21
on a random floor, 9 with others coming from the same scene, 4 on the floor their spatial words say, 1 drawn within
speaking distance. Things: 8 on the ground, 3 on a random floor, 2 stayed where they were left, 1 by its words; no holder
found (no action names a thing with one person acting). The 4 scenes with nobody placed have nobody present.

After "mentioned is not there" (2026-11-02; the reading, terrain and spawn rerun): 144 starts. People: 69 carried on, 32 on
an area's ground, 13 on a random floor, 10 with others from the same scene, 4 by their spatial words, 2 within speaking
distance. Jev's spot question is now composed for 7 scenes (13 to place), down from 11 (24): the outdoor scenes 4, 7, 8,
11 and 12 are on the ground of 学园都市 instead of on 常盘台中学's floors.
