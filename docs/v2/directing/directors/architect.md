---
type: "director"
id: "architect"
aliases: ["Architect"]
kind: "state"
status: "partial"
zoom: "none"
reads: ["setDresser", "scriptSupervisor"]
tags: ["directing/director", "kind/state", "status/partial"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Architect

A building borrowed from the world made the one the text describes: its look, floors, uses, rooms and what changes in it. A **state** director; status **partial**. Back to [Directing](../Directing.md).

## Zoom and camera

None: a state director keeps what rides with people and things. Its questions are asked on the text and on fixed reference pictures; a thing in motion is played by the beat's action director.

## Plays

- [Set dresser](../casts/setDresser.md) (its own)
- [Script supervisor](../casts/scriptSupervisor.md)

## How Jev is asked

### terrainPartMode · built

Asked in `src/v2/context/terrainModes.ts`, mode `terrainPartMode` (run here on a sample whose names are placeholders).

**Task**

> &lt;a part&gt; (&lt;its kind&gt;) is part of a larger building, &lt;the building&gt; (&lt;its type&gt;, 70 floors, about 2000 m² a floor). On which of its floors is it, and how large is it? Read it from the scenes it is in, as the text tells them (scenes); where the text says nothing, what a place of its kind usually is in such a building.

**Given**: part, within, scenes, facts, environment, standing, floors, sizes.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `floor` | choice | Which floor of &lt;the building&gt; is &lt;a part&gt; on? | `A`: A: &lt;floor 1&gt;<br>`B`: B: &lt;floor 2&gt;<br>`C`: C: &lt;floor 3&gt;<br>`D`: D: &lt;floor 4&gt; |
| `size` | choice | How large is &lt;a part&gt;, its floor area? | `A`: A: &lt;size 1&gt;<br>`B`: B: &lt;size 2&gt;<br>`C`: C: &lt;size 3&gt; |

### look · proposed

**Picture**: the building's elevation in each candidate look, side by side.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `look` | choice | Which lettered look fits &lt;the building&gt; as the text describes it? | `A`: &lt;a model or theme&gt;<br>`B`<br>`…` |

### uses · proposed

**Picture**: the building's section, the floors asked about marked.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `uses` | choice | What is on floors &lt;from–to&gt;? | `shops`<br>`mall`<br>`cinema`<br>`restaurants`<br>`offices`<br>`flats`<br>`hotel`<br>`school`<br>`hospital`<br>`station`<br>`car park`<br>`plant room`<br>`rooftop deck` |

### room · proposed

**Picture**: the floor's plan with candidate layouts.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `room` | choice | Which lettered layout is &lt;the room&gt;? | `A`<br>`B`<br>`…` |

## Tools

- building skeletons
- architecture models
- model packs
- building EM

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Which building it is | `binding` | — | Location.properties.world; W6: building identity from the lot each scene played in; unsure ones held | held | built |
| Floors, uses, look | `building` (new) | L11 bodies | Location.properties.floors + Location.properties.uses; a room's floor is in canon (W6); uses and look proposed | held | partial |
| Rooms | `building` (new) | L11 bodies | PART_OF relation; container and split held items (W6); a room's kind where a conversation plays (the world log's room records), a view input | held | partial |
| Changes to it | `damage` | L13 destruction | Location.properties.damage | applied | built |
