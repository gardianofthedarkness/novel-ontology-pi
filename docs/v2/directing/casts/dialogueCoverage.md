---
type: "cast"
id: "dialogueCoverage"
aliases: ["Dialogue coverage"]
status: "built"
fired_by: ["routine", "mediated"]
read_by: ["routine"]
tags: ["directing/cast", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Dialogue coverage

A summary cast: the work model reading the text. Status: **built** (`world-engine/digest/digest.mjs talkOf (M8)`). Back to [Directing](../Directing.md).

## What it writes

- who talks with whom and through what
- formations: beside, across a table, a ring, two sides of a door
- attention: who looks at whom
- talk on the move: a group walking or running while it talks, with the script supervisor's moves (world-engine/director/on-the-move.mjs lays it out and times it)
- talk while driving: a group riding a road vehicle while it talks, the drive at the car's own speed on the road network and the highway, cut across the cards by their reading (on-the-move.mjs cutDrive)

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Routine interaction**: people together: talk and small acts (volume 1: the dart bar (13–18), the crosswalk (11–12), walking with Index (8))
- block type **Mediated exchange**: talk through a channel: a phone, a door, a broadcast, a message (volume 1: phone calls (12, 29, 33), through a door (42–43))
- sentence kind **spoken**: its share in the window's sentences, weighted by each one's confidence

## How it is asked

How often: one request a span where dialogue coverage fires.

**System**

> You read a conversation in a light novel for those staging it: who talks with whom and through what (face to face, a phone, a door), how the people stand (beside each other, facing, across a table, in a ring, walking side by side, two sides of a door), and who looks at whom. Reply with JSON only.

**Task**

> For this passage: each exchange and its channel, each group's formation, who looks at whom.

**Given**

- the span's lines (up to 60)
- the people with ids
- where the scene is

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `exchanges` | **sentence**: &lt;sentence id&gt;; **who**: &lt;person id&gt;; **with**: `<person id>`; **channel**: face to face \| a group together \| phone \| video call \| message \| through a door or wall \| loudspeaker or broadcast \| telepathy \| a voice from afar; **sure**: 0..1 |
| `formations` | **sentence**: &lt;sentence id where it holds from&gt;; **who**: `<person id>`; **formation**: beside \| facing \| across a table \| a ring \| side by side walking \| behind \| two sides of a door \| apart; **sure**: 0..1 |
| `attention` | **sentence**: &lt;sentence id&gt;; **who**: &lt;person id&gt;; **looksAt**: &lt;person id&gt; |

## Read by

- [Routine director](../directors/routine.md) (its own cast)
