---
type: "faculty"
id: "frame"
aliases: ["Scene frame"]
status: "proposed"
fired_by: ["always: each scene"]
read_by: ["stage"]
tags: ["directing/faculty", "status/proposed"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Scene frame

A summary faculty: the work model reading the text. Status: **proposed**. Back to [Directing](../Directing.md).

## What it writes

- the set as a path down the place tree
- who is on stage
- how it follows the scene before
- the beats

## When it fires

Always: once each scene.


## How it is asked

How often: one request a scene, in reading order.

**System**

> You read one scene of a light novel being staged in a 3D city, and frame it for the stage manager.

**Task**

> Say where the scene is set (a path down the place tree), who is on stage and when they come and go, how it follows the scene before, and where its beats begin.

**Given**

- the scene's sentences, numbered
- the place tree round the scene's place
- the memory from the scene before
- who the script has present

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `set` | place ids, from the widest to the narrowest |
| `onStage` | [{ who, from: start \| enters at &lt;sentence&gt;, until: end \| leaves at &lt;sentence&gt; }] |
| `continues` | `carries straight on` · `later the same day` · `another day` · `elsewhere at the same time` · `a flashback` · `a montage` |
| `beats` | [{ first: &lt;sentence&gt;, what: words }] |

## Read by

- [Stage manager](../directors/stage.md) (its own faculty)
