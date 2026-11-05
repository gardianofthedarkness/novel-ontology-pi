---
type: "director"
id: "character"
aliases: ["Character director"]
kind: "state"
status: "proposed"
zoom: "none"
reads: ["actingCoach", "scriptSupervisor"]
tags: ["directing/director", "kind/state", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Character director

What rides with a person: how they feel, what they want, who they are to each other. A **state** director; status **proposed**. Back to [Directing](../Directing.md).

## Zoom and camera

None: a state director keeps what rides with people and things. Its questions are asked on the text and on fixed reference pictures; a thing in motion is played by the beat's action director.

## Plays

- [Acting coach](../casts/actingCoach.md) (its own)
- [Script supervisor](../casts/scriptSupervisor.md)

## How Jev is asked

### feeling · proposed

**Picture**: none: the text and their feelings so far.

| Key | Kind | Asks | Options |
|---|---|---|---|
| `feeling` | choice | What does &lt;a person&gt; feel most strongly now? | `joy`<br>`anger`<br>`fear`<br>`sadness`<br>`surprise`<br>`disgust`<br>`embarrassment`<br>`calm`<br>`determination`<br>`affection` |

### strength · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `strength` | score | How strongly? | `faint`<br>`clear`<br>`strong`<br>`overwhelming` |

### bond · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `bond` | choice | How does &lt;a person&gt; stand with &lt;another&gt; after this? | `closer`<br>`colder`<br>`unchanged`<br>`a first meeting` |

### intent · proposed

| Key | Kind | Asks | Options |
|---|---|---|---|
| `intent` | choice | What does &lt;a person&gt; want next? | `<each wish the inner-state cast found>`<br>`none of these` |

## Tools

- the ontology's state fold (additive deltas)
- the smoother, later

## State and the ontology

What it keeps as it plays, and where that lands (the flow and the gates: [Directing](../Directing.md)).

| State | World log | Laws | Into the ontology | Gate | Status |
|---|---|---|---|---|---|
| Feelings | `feeling` (new), smoothed | — | StateChange.emotions; additive deltas clamped to [-1, 1] (the ontology's rule); applied once audits show them right | held | proposed |
| Bonds and first meetings | `feeling` (new) | — | StateChange.relationships + KNOWS relation | held | proposed |
| Intent | `feeling` (new) | — | StateChange.goalsAdd | held | proposed |
