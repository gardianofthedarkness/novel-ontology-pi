---
type: "director"
id: "mega"
aliases: ["Mega-scene director"]
kind: "action"
status: "partial"
zoom: "100–2 km"
reads: ["journeys", "scale", "ambience", "choreography"]
tags: ["directing/director", "kind/action", "status/partial"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Mega-scene director

Traversals and catastrophes seen from far: routes across blocks, leaps between towers, the ground splitting, crowds flowing. An **action** director; status **partial**. Back to [Directing](../Directing.md).

## Zoom and camera

Reads the [Scale and view](../faculties/scale.md) faculty: its camera operator frames each beat, and Jev's pictures for its questions, at the recommended zoom and view angle. Zoom range 100–2 km; camera: wide and aerial at the recommended angle; follows a journey whole.

## Plays

- [Journeys](../faculties/journeys.md) (its own)
- [Scale and view](../faculties/scale.md)
- [Ambience](../faculties/ambience.md)
- [Choreography](../faculties/choreography.md)

## How Jev is asked

### moveDirectionMode · built

Asked in `src/v2/context/directorModes.ts`, mode `moveDirectionMode` (run here on a sample whose names are placeholders).

**Note**: today framed 16 m across; at the beat's zoom once the scale faculty is in.

**Task**

> In scene 1 (&lt;the place&gt;), the card's lines (card) are being played. &lt;the mover&gt; is the person asked about. &lt;the mover&gt; goes somewhere else in this card. Which way, as the picture "arrows" shows it: one of the lettered arrows out of them (each said by what it points at), or with someone? And how, and which line says so.

**Given**: card, scene, now, digest, pictures, arrows.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `direction` | choice | Which way does &lt;the mover&gt; go? | `A`: arrow A: &lt;arrow A: what it meets&gt;<br>`B`: arrow B: &lt;arrow B: what it meets&gt;<br>`C`: arrow C: &lt;arrow C: what it meets&gt;<br>`D`: arrow D: &lt;arrow D: what it meets&gt;<br>`E`: arrow E: &lt;arrow E: what it meets&gt;<br>`F`: arrow F: &lt;arrow F: what it meets&gt;<br>`G`: arrow G: &lt;arrow G: what it meets&gt;<br>`H`: arrow H: &lt;arrow H: what it meets&gt;<br>`I`: arrow I: &lt;arrow I: what it meets&gt;<br>`J`: arrow J: &lt;arrow J: what it meets&gt;<br>`K`: arrow K: &lt;arrow K: what it meets&gt;<br>`L`: arrow L: &lt;arrow L: what it meets&gt;<br>`M`: arrow M: &lt;arrow M: what it meets&gt;<br>`N`: arrow N: &lt;arrow N: what it meets&gt;<br>`with:<another>`: goes with &lt;another&gt;, to where they go |
| `how` | choice | How do they go (a step, a walk, a run, a leap, a flight)? | `step`: a step or two<br>`walk`: walking<br>`run`: running<br>`leap`: a jump or leap, a climb<br>`flight`: flying, carried through the air by a power |
| `line` | choice | Which line says where they go (or that they stay)? | `<a line of the card>`<br>`<a line near it>` |

### landmark · built

Asked in `world-engine/director/director.mjs (megaMove, M6)`.

**Picture**: top-down map at the journey's reach, north up, the mover at its middle, the twelve tallest buildings within reach lettered on red spheres.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `landmark` | choice | Which lettered landmark does &lt;the mover&gt; reach? | `A`: &lt;a building: its name, floors, distance, which way on the map&gt;<br>`B`<br>`…`<br>`none`: none of these |

### route · proposed

**Picture**: the same map with up to three routes drawn.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `route` | choice | Which route is it? | `A`: &lt;a route of the place graph: its places and length&gt;<br>`B`<br>`C`<br>`none` |

### extent · proposed

**Picture**: top-down map at the beat's zoom.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `extent` | box | Box the area the catastrophe reaches. | (a box on the picture) |

### flow · proposed

**Picture**: the street from high, the crowd field drawn.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `flow` | choice | Which way does the crowd flow? | `N`<br>`NE`<br>`E`<br>`SE`<br>`S`<br>`SW`<br>`W`<br>`NW`<br>`still`<br>`toward the marked point`<br>`away from it` |

## Tools

- map routes on the place graph
- the terrain
- the crowd field
- percolation damage

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Journeys (routes, stops, manner) | `position`, smoothed | L5 travel time; L10 reachable; L12 abilities | StateChange.location + movement event; each stop a location; the journey an event, held | applied | partial |
| A catastrophe's extent | `damage` | L13 destruction | Location.properties.damage + conflict event | applied | partial |
| Its camera (the zoom and view angle the scale faculty recommends, as framed) | — | — | the run only | run | proposed |
| Crowds | `crowd` (new) | — | Organization.properties.members + MEMBER_OF relation; a named crowd (the student column) an Organization its people are members of; an unnamed density stays with the run | held | proposed |
