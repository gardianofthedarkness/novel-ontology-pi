---
type: "director"
id: "combat"
aliases: ["Combat director"]
kind: "action"
status: "partial"
zoom: "5–60 m"
reads: ["choreography", "scale", "generalist"]
tags: ["directing/director", "kind/action", "status/partial"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Combat director

A fight, exchange by exchange: the kind and shape of each attack, who it hits, what it breaks. An **action** director; status **partial**. Back to [Directing](../Directing.md).

## Zoom and camera

Reads the [Scale and view](../faculties/scale.md) faculty: its camera operator frames each beat, and Jev's pictures for its questions, at the recommended zoom and view angle. Zoom range 5–60 m; camera: close to medium at the recommended angle, following the exchange; wider for a blast.

## Plays

- [Choreography](../faculties/choreography.md) (its own)
- [Scale and view](../faculties/scale.md)
- [Generalist](../faculties/generalist.md)

## How Jev is asked

### where · built

Asked in `world-engine/director/director.mjs (destruction)`.

**Picture**: the place at this moment, red spheres where it might break.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `where` | choice | Which lettered red sphere in picture "where" is where this card breaks something? Answer none if it breaks nothing. | `A`: &lt;a spot on a building&gt;<br>`B`<br>`…`<br>`none`: it breaks nothing |

### size · built

Asked in `world-engine/director/director.mjs (destruction)`.

**Picture**: where it hits, close up from two sides, four spheres round the point.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `size` | choice | Which labelled sphere is the size of what this card breaks? | `1`: 4 m across<br>`2`: 8 m<br>`3`: 16 m<br>`4`: 32 m |

### attack · proposed

**Picture**: the fighters at the beat's zoom and angle.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `attack` | choice | What kind of attack is this exchange? | `hand to hand`<br>`grapple or throw`<br>`blade or blunt weapon`<br>`firearm`<br>`ranged power`<br>`beam or laser`<br>`area blast`<br>`thrown object`<br>`the ground or a building itself`<br>`an ability that cancels` |

### shape · proposed

**Picture**: the same, with the attacker and target marked.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `shape` | choice | What shape does it take in space? | `point`<br>`line or beam`<br>`cone`<br>`sphere`<br>`ring`<br>`wave along the ground`<br>`rain from above` |

### outcome · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `outcome` | choice | What happens to the target? | `hit`<br>`dodged`<br>`blocked`<br>`cancelled`<br>`missed` |

### knockback · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `knockback` | score | How far is the target thrown? | `0 m`<br>`1 m`<br>`3 m`<br>`10 m`<br>`30 m` |

## Tools

- hitSphere and percolation
- graded moves
- destruction (L13)

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Exchanges (attacker, target, kind and shape of the attack, outcome) | `exchange` (new) | L12 abilities; L13 destruction | PARTICIPATES_IN relation + conflict event; the attack's kind, shape and outcome properties of each participant's relation to the event; CAUSES from it to what it broke | held | proposed |
| Knock-backs and dodges | `position`, smoothed | L1 continuity by strand; L10 reachable | StateChange.location | applied | partial |
| Injury and condition (hurt, unconscious, bound) | `condition` (new) | — | StateChange.conditionsAdd + StateChange.conditionsRemove; the field added 2026-11-03 (set add/remove, as possessions) | held | proposed |
| Abilities shown | `exchange` (new) | L12 abilities | Character.properties.abilities | held | proposed |
| What breaks | `damage` | L13 destruction | Location.properties.damage | applied | built |
| Its camera (the zoom and view angle the scale faculty recommends, as framed) | — | — | the run only | run | partial |
