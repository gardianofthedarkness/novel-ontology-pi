---
type: "dashboard"
aliases: ["Directing"]
tags: ["directing"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Directing

The director as readers and specialists (docs/v2/next-steps.md A4–A5). Faculties read the text (the work model); directors decide (Jev). Every note here is written from the code: `world-engine/director/specialists.mjs` and `questions.mjs`. The visual plan with volume 1's density strip and gate preview: [summarizer-faculties.html](../summarizer-faculties.html). The gate over volume 1 (M3): [Gate](Gate.md) and its strip [gate-volume-1.html](gate-volume-1.html). What needs the user's decision: [Decisions needed](Decisions.md).

## Faculties

| Faculty | Fired by | Read by | Status |
|---|---|---|---|
| [Scene frame](faculties/frame.md) | always (each scene) | [Stage manager](directors/stage.md) | partial |
| [Scale and view](faculties/scale.md) | always (each beat) | [Routine director](directors/routine.md), [Mega-scene director](directors/mega.md), [Combat director](directors/combat.md) | built |
| [Generalist](faculties/generalist.md) | always (each window) | [Stage manager](directors/stage.md), [Routine director](directors/routine.md), [Combat director](directors/combat.md), [Character director](directors/character.md), [Transport specialist](directors/transport.md), [Architect](directors/architect.md) | built |
| [Conversation and blocking](faculties/conversation.md) | Routine interaction, Mediated exchange, spoken sentences | [Routine director](directors/routine.md) | proposed |
| [Inner state](faculties/feeling.md) | Interior flow, Routine interaction, thought sentences | [Character director](directors/character.md) | proposed |
| [Journeys](faculties/journeys.md) | Pursuit / traversal, action sentences, a jump in scale | [Mega-scene director](directors/mega.md) | built |
| [Choreography](faculties/choreography.md) | Confrontation, Spectacle / catastrophe, action sentences | [Mega-scene director](directors/mega.md), [Combat director](directors/combat.md) | proposed |
| [Ambience](faculties/ambience.md) | Establishing / ambience, environment sentences, crowds named | [Mega-scene director](directors/mega.md) | proposed |
| [Props and vehicles](faculties/props.md) | action sentences, vehicles named, weapons named | [Transport specialist](directors/transport.md) | partial |
| [Set description](faculties/setting.md) | Establishing / ambience, environment sentences, fact sentences, buildings named or described | [Architect](directors/architect.md) | proposed |

## Directors

| Director | Kind | Zoom | Plays | Status |
|---|---|---|---|---|
| [Stage manager](directors/stage.md) | stage | — | [Scene frame](faculties/frame.md), [Generalist](faculties/generalist.md) | partial |
| [Routine director](directors/routine.md) | action | 2–15 m | [Conversation and blocking](faculties/conversation.md), [Scale and view](faculties/scale.md), [Generalist](faculties/generalist.md) | partial |
| [Mega-scene director](directors/mega.md) | action | 100–2 km | [Journeys](faculties/journeys.md), [Scale and view](faculties/scale.md), [Ambience](faculties/ambience.md), [Choreography](faculties/choreography.md) | partial |
| [Combat director](directors/combat.md) | action | 5–60 m | [Choreography](faculties/choreography.md), [Scale and view](faculties/scale.md), [Generalist](faculties/generalist.md) | partial |
| [Character director](directors/character.md) | state | — | [Inner state](faculties/feeling.md), [Generalist](faculties/generalist.md) | proposed |
| [Transport specialist](directors/transport.md) | state | — | [Props and vehicles](faculties/props.md), [Generalist](faculties/generalist.md) | proposed |
| [Architect](directors/architect.md) | state | — | [Set description](faculties/setting.md), [Generalist](faculties/generalist.md) | partial |

## Block types

| Type | What it is | In volume 1 | Fires |
|---|---|---|---|
| Routine interaction | people together: talk and small acts | the dart bar (13–18), the crosswalk (11–12), walking with Index (8) | Conversation and blocking, Inner state |
| Confrontation | a fight or standoff: blows, dodges, powers used on someone | 21–22, 25–31, 40 | Choreography |
| Pursuit / traversal | going somewhere at scale: chases, escapes, crossing the city | the escape (1), the chase to the subway (3), the tower leaps (26), the tower's shaft (34) | Journeys |
| Mediated exchange | talk through a channel: a phone, a door, a broadcast, a message | phone calls (12, 29, 33), through a door (42–43) | Conversation and blocking |
| Interior flow | thought, reflection, free indirect thought | 18, 36, the long narration and thought stretches | damps the world, Inner state |
| Exposition | world-building and background with no one acting | the Board (37), R&C Occultics (39) | damps the world |
| Establishing / ambience | where and when: the place, weather, crowds, mood | the openings of 1, 2, 10, 45 | Ambience, Set description |
| Memory / flashback | what happened before this scene's now | 35 | damps the world |
| Spectacle / catastrophe | the world itself changing: ground splits, floods, collapses | 21, 22, 26, 27 | Choreography |

## How state flows into the ontology

1. **play**: the director changes its state card by card (positions, exchanges, feelings, holdings, buildings) (`world-engine/director/director.mjs`)
2. **world log**: each change a record, append-only, with its rank (pinned, stated, met, answered, ruled) and source (`world-engine/log/world-log.mjs`)
3. **laws**: checked as it plays (held, amended) and over the whole run afterwards (`world-engine/laws/laws.mjs`)
4. **smoother**: positions and presence back-propagated: the least-action history and its clouds (later: feelings, as additive states) (`world-engine/smoother/`)
5. **ledger**: the run's proposals to the ontology, each with its evidence and the laws' verdicts (`world-engine/log/write-log.mjs`)
6. **gate**: applied by canon where a law checks it, held for the review (Pi) otherwise; some state stays with the run (`world-engine/review/canon.mjs, review.mjs`)
7. **canon**: written into ontology/*.jsonl (last write wins by id), every write logged in canon.jsonl and undoable; the graph rebuilt (`world-engine/review/canon.mjs`)
8. **next run**: the review's answers become pins; canon, pins and the smoothing are where the next run starts from (`world-engine/review/review.mjs`)

- **applied**: written by canon without review: a law checks it and nothing broke
- **held**: held for the review first; written once answered (some move to applied once audits show they are right)
- **run**: kept with the run only (its records, the page); never in the ontology
