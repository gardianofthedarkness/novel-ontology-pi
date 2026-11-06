---
type: "director"
id: "stage"
aliases: ["Stage manager"]
kind: "stage"
status: "partial"
zoom: "none"
reads: ["firstAD", "scriptSupervisor"]
tags: ["directing/director", "kind/stage", "status/partial"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Stage manager

The set, who is on stage, which action director leads each beat and where the cuts fall. A **stage** director; status **partial**. Back to [Directing](../Directing.md).

## Zoom and camera

No zoom of its own: it chooses which action director leads each beat and where the cuts fall; the lead's camera operator holds the camera.

## Plays

- [1st AD](../casts/firstAD.md) (its own)
- [Script supervisor](../casts/scriptSupervisor.md)

## How Jev is asked

### spawnSpotMode · built

Asked in `src/v2/context/spawnModes.ts`, mode `spawnSpotMode` (run here on a sample whose names are placeholders).

**Task**

> The scene &lt;the scene&gt; takes place in &lt;the place&gt; (&lt;its kind&gt;). Where is each of those asked about when the scene begins? Read it from the scene's text (scene); where it says nothing, what is likeliest for such a place.

**Given**: scene, who, spots.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `<a person>` | choice | Where is &lt;a person&gt; when the scene begins? | `A`: A: &lt;spot 1: what it is&gt;<br>`B`: B: &lt;spot 2: what it is&gt;<br>`C`: C: &lt;spot 3: what it is&gt;<br>`D`: D: &lt;spot 4: what it is&gt; |

### sceneGoesOnMode · built

Asked in `src/v2/context/directorModes.ts`, mode `sceneGoesOnMode` (run here on a sample whose names are placeholders).

**Task**

> Two scenes of a novel, one after the other: the end of the first (before, set in &lt;its place&gt;) and the start of the next (now, set in &lt;its place&gt;). Does the next scene go straight on from the first, the same moment carrying on with the people where they were (the narration may only have turned to someone else there), or is it a jump to another time or place?

**Given**: before, now.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `goes_on` | choice | Does the next scene go straight on from the first? | `yes`: the same moment carries on: the people go on from where they were<br>`no`: a jump: another time, another place, or other people |

### set · proposed

**Picture**: the place tree round the scene's place, as a map with its places lettered.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `set` | choice | Which lettered place on picture "map" is where this scene plays? | `A`: &lt;a place of the tree, with its scale&gt;<br>`B`<br>`C`<br>`…`<br>`none`: none of these |

## Tools

- spawning
- the place tree
- the smoother
- the gate (lead)

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Who is on stage | `presence`, smoothed | L2 two places at once; L9 actors are there | Scene.charactersPresent + PRESENT_IN relation | applied | built |
| The set (the scene's place and its path up the tree) | `binding` | — | Scene.locationId + PART_OF relation | applied | built |
| Facts about where people are (stated or implied: indoors, a floor, near someone) | `position`, smoothed | L14 stated facts hold (recorded as it plays) | StateChange.location | applied | partial |
| Beats and who led them | `beat` (new) | — | action event + PRECEDES relation | held | proposed |
| The cuts (where one beat ends and the next begins, and who leads it) | `beat` (new) | — | the run only | run | proposed |
