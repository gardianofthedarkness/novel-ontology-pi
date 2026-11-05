---
type: "director"
id: "transport"
aliases: ["Transport specialist"]
kind: "state"
status: "proposed"
zoom: "none"
reads: ["propMaster", "scriptSupervisor"]
tags: ["directing/director", "kind/state", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Transport specialist

Vehicles and weapons: what they are, who drives, rides or holds them, whose they are; their motion is played by the beat's action director. A **state** director; status **proposed**. Back to [Directing](../Directing.md).

## Zoom and camera

None: a state director keeps what rides with people and things. Its questions are asked on the text and on fixed reference pictures; a thing in motion is played by the beat's action director.

## Plays

- [Prop master](../casts/propMaster.md) (its own)
- [Script supervisor](../casts/scriptSupervisor.md)

## How Jev is asked

### model · proposed

**Picture**: a model sheet: the candidate models side by side, lettered.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `model` | choice | Which lettered model is this &lt;vehicle or weapon&gt;? | `A`: &lt;a model of the packs: its kind and size&gt;<br>`B`<br>`…`<br>`none` |

### holder · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `holder` | choice | Who drives, rides or holds it now? | `<each person present>`<br>`no one` |

### owner · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `owner` | choice | Whose is it? | `<each person>`<br>`<an organization>`<br>`unknown` |

## Tools

- model packs (CC0)
- things on the page

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Vehicles and weapons | `item` (new) | — | Item.properties.class; new identities: held, as EM's are | held | proposed |
| Who holds, drives or rides | `possession` (new) | L15 a thing in one place or one hand at a time (proposed) | StateChange.possessionsAdd + StateChange.possessionsRemove | applied | proposed |
| Where things are | `item` (new), smoothed | L15 a thing in one place or one hand at a time (proposed) | LOCATED_AT relation; where the beat's action director put them, at its zoom | applied | proposed |
| Ownership | `possession` (new) | — | OWNS relation | held | proposed |
