---
type: "faculty"
id: "feeling"
aliases: ["Inner state"]
status: "proposed"
fired_by: ["interior", "routine"]
read_by: ["character"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Inner state

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- each person's emotional state as it changes (a distribution)
- intent: what they want next
- bonds: who they are to each other

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Interior flow**: thought, reflection, free indirect thought (volume 1: 18, 36, the long narration and thought stretches)
- block type **Routine interaction**: people together: talk and small acts (volume 1: the dart bar (13–18), the crosswalk (11–12), walking with Index (8))
- sentence kind **thought**: its share in the window's sentences, weighted by each one's confidence

## How it is asked

How often: one request a fired span.

**System**

> You read a passage of a light novel and say how each person's feelings, wishes and bonds change in it.

**Task**

> Each change of feeling (which, how much up or down), each wish that forms, each bond that moves.

**Given**

- the span's lines
- the people present
- their feelings and bonds so far (the ontology's fold)

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `feelings` | **who**: &lt;person id&gt;; **emotion**: `joy` · `anger` · `fear` · `sadness` · `surprise` · `disgust` · `embarrassment` · `calm` · `determination` · `affection`; **change**: -1..1 |
| `intent` | **who**: &lt;person id&gt;; **wants**: words; **toward**: &lt;person id&gt; \| null |
| `bonds` | **who**: &lt;person id&gt;; **to**: &lt;person id&gt;; **change**: -1..1; **firstMeeting**: true \| false |

## Read by

- [Character director](../directors/character.md) (its own faculty)
