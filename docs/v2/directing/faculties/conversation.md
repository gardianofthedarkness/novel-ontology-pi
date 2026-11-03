---
type: "faculty"
id: "conversation"
aliases: ["Conversation and blocking"]
status: "proposed"
fired_by: ["routine", "mediated"]
read_by: ["routine"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Conversation and blocking

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- who talks with whom and through what
- formations: beside, across a table, a ring, two sides of a door
- attention: who looks at whom

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Routine interaction**: people together: talk and small acts (volume 1: the dart bar (13–18), the crosswalk (11–12), walking with Index (8))
- block type **Mediated exchange**: talk through a channel: a phone, a door, a broadcast, a message (volume 1: phone calls (12, 29, 33), through a door (42–43))
- sentence kind **spoken**: its share in the window's sentences, weighted by each one's confidence

## How it is asked

How often: one request a fired span.

**System**

> You read a passage of a light novel and say who talks with whom, through what, and how they stand.

**Task**

> For each exchange, its people and channel; for each group, its formation; who looks at whom.

**Given**

- the span's lines, numbered
- the people present with their ids
- the scene frame

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `exchanges` | **who**: &lt;person id&gt;; **with**: [&lt;person id&gt;]; **channel**: `face to face` · `a group together` · `phone` · `video call` · `message` · `through a door or wall` · `loudspeaker or broadcast` · `telepathy` · `a voice from afar` |
| `formations` | **who**: [&lt;person id&gt;]; **formation**: `beside` · `facing` · `across a table` · `a ring` · `side by side walking` · `behind` · `two sides of a door` · `apart` |
| `attention` | **who**: &lt;person id&gt;; **looksAt**: &lt;person id&gt; \| &lt;thing&gt; |

## Read by

- [Routine director](../directors/routine.md) (its own faculty)
