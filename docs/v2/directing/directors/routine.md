---
type: "director"
id: "routine"
aliases: ["Routine director"]
kind: "action"
status: "partial"
zoom: "2–15 m"
reads: ["dialogueCoverage", "cinematographer", "scriptSupervisor"]
tags: ["directing/director", "kind/action", "status/partial"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Routine director

Inside a room or on a street corner: positions, gaze, who talks to whom and from where. An **action** director; status **partial**. Back to [Directing](../Directing.md).

## Zoom and camera

Reads the [Cinematographer](../casts/cinematographer.md) cast: its camera operator frames each beat, and Jev's pictures for its questions, at the recommended zoom and view angle. Zoom range 2–15 m; camera: medium and close at the recommended angle; a room cut away.

## Plays

- [Dialogue coverage](../casts/dialogueCoverage.md) (its own)
- [Cinematographer](../casts/cinematographer.md)
- [Script supervisor](../casts/scriptSupervisor.md)

## How Jev is asked

### dialogueKindMode · built

Asked in `src/v2/context/directorModes.ts`, mode `dialogueKindMode` (run here on a sample whose names are placeholders).

**Task**

> A conversation in a novel, in &lt;the place&gt;: its lines, who speaks first (&lt;the speaker&gt;), and the others present with how far each stands from the speaker now. What kind of talk is it?

**Given**: lines, present.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `kind` | choice | What kind of talk is it? | `live`: two people face to face<br>`group`: three or more face to face, together<br>`remote`: apart: a phone, a video call, a message, a letter, telepathy<br>`public`: one voice to everyone around: a shout, an announcement, a loudspeaker |

### moveSpotMode · built

Asked in `src/v2/context/directorModes.ts`, mode `moveSpotMode` (run here on a sample whose names are placeholders).

**Task**

> In scene 1 (&lt;the place&gt;), the card's lines (card) are being played. &lt;the mover&gt; is the person asked about. They go &lt;toward what&gt;, the shaded wedge on picture "wedge". Where do they end up in this card: one of the spots (spots), or none of these when the text puts them somewhere the spots do not name?

**Given**: card, scene, now, digest, pictures, notes, spots.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `spot` | choice | Where does &lt;the mover&gt; end up? | `A`: A: &lt;spot 1&gt;<br>`B`: B: &lt;spot 2&gt;<br>`C`: C: &lt;spot 3&gt;<br>`none`: none of these spots |

### formation · proposed

**Picture**: the room's plan from above at the beat's zoom, its furniture and free spots lettered, everyone placed so far.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `formation` | choice | Where in the room is &lt;a person&gt; during this beat? | `A`: &lt;a seat or spot on the plan&gt;<br>`B`<br>`C`<br>`…` |

### facing · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `facing` | choice | Whom or what does &lt;a person&gt; face? | `<each person present>`<br>`the door`<br>`the window`<br>`away` |

### addressed · proposed

**Picture**: the beat at its recommended angle, faces turned.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `addressed` | choice | To whom is this line said, judging by the faces turned? | `<each person present>`<br>`everyone`<br>`no one present` |

## Tools

- rooms and doors of the building skeleton
- talk rings (L6)

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Positions in the room | `position`, smoothed | L1 continuity by strand; L10 reachable; L11 bodies | StateChange.location + PART_OF relation; today at the building; a room becomes a Location inside it | applied | partial |
| Who talks with whom, through what (the channel sets the card's talk kind (M8); L6 respects a remote one) | `meeting` | L6 talk needs nearness | SPEAKS_TO relation + Scene.turns; speakers are off for now; the channel (face to face, phone, door) a property of the relation | held | partial |
| Formations and attention | `meeting` | L6 talk needs nearness | ADDRESSES relation; formations played by rule (M8); attention read, not yet drawn | held | partial |
| Its camera (the zoom and view angle the scale cast recommends, as framed) | — | — | the run only | run | proposed |
