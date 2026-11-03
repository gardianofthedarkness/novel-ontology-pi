---
type: "faculty"
id: "choreography"
aliases: ["Choreography"]
status: "built"
fired_by: ["confrontation", "catastrophe"]
read_by: ["mega", "combat"]
tags: ["directing/faculty", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Choreography

A summary faculty: the work model reading the text. Status: **built** (`world-engine/digest/digest.mjs exchangesOf (M7)`). Back to [Directing](../Directing.md).

## What it writes

- exchanges: attacker, target, attack, outcome
- knock-backs, dodges, throws
- what breaks and how wide

## When it fires

On a score-based mixed index of all of these, each against its own baseline over the book and weighted by the window's scores (Jev's confidence in the block, in its sentences): on at 1.5, off below 0.5 (`firing()` in specialists.mjs).

- block type **Confrontation**: a fight or standoff: blows, dodges, powers used on someone (volume 1: 21–22, 25–31, 40)
- block type **Spectacle / catastrophe**: the world itself changing: ground splits, floods, collapses (volume 1: 21, 22, 26, 27)
- sentence kind **action**: its share in the window's sentences, weighted by each one's confidence

## How it is asked

How often: one request a span where choreography fires.

**System**

> You read a fight or a catastrophe in a light novel, exchange by exchange, for those staging it in a 3D city: who attacks whom, with what kind of attack, of what shape in space and from how far, what happens to the target, how far anyone is thrown, what breaks, and what state anyone is left in. Reply with JSON only.

**Task**

> List each exchange of this passage in order.

**Given**

- the span's lines (up to 60)
- the people with ids
- the scene digest

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `exchanges` | **sentence**: &lt;sentence id&gt;; **attacker**: &lt;person id, or null for the world itself&gt;; **target**: &lt;person id, or null when a place or thing&gt;; **attack**: hand to hand \| grapple or throw \| blade or blunt weapon \| firearm \| ranged power \| beam or laser \| area blast \| thrown object \| the ground or a building itself \| an ability that cancels; **shape**: point \| line or beam \| cone \| sphere \| ring \| wave along the ground \| rain from above; **range**: touch \| close (under 3 m) \| near (under 15 m) \| far (under 100 m) \| very far; **outcome**: hit \| dodged \| blocked \| cancelled \| missed; **knockback**: metres the target is thrown (0 if none); **breaks**: what is destroyed, or null; **condition**: hurt \| badly hurt \| unconscious \| bound \| freed \| recovered \| null: the target's state after it; **sure**: 0..1 |

## Read by

- [Mega-scene director](../directors/mega.md)
- [Combat director](../directors/combat.md) (its own faculty)
