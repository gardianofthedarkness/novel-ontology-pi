# The physics law engine: what the world enforces, and what it should (2026-11-02)

**Status:** design discussion for Track B's law engine ([world-ontology.md](world-ontology.md) W2, W4). The user put
Track B first (2026-11-02): "see if that improves our vividness by a lot", and set the scope of continuity:

> The continuity law works until the end of a strand. Within a strand, it continues to work.

Measured on run `d20261102081221` (volume 1, 46 scenes, 3 strands: the main one of 38 scenes, one forking at scene 5
with 6 scenes, one at scene 37 with 2).

## 1. What the engine enforces today

Everything below is code; none of it is a check that can say no to an answer. It shapes what can happen, silently.

### The ground and the buildings (terrain, `world.ts`, `tall.ts`)

| Rule | Where | What it does |
|---|---|---|
| Buildings at their true size and turn, corridors, stairs and rooms filling them | `world.ts` standTurned | a building is walkable inside |
| No building inside another | `tall.ts` clearOverlaps | the later, lower one gives way |
| A building over a road holds the road | `world.ts` standTurned | people walk round it |
| Rooms only through their doors; a street door at the entrance, else the nearest ground-floor corridor facing open ground | `world.ts` worldGraph | a building is enterable |
| Clutter closes one outdoor cell in ten, never in front of a door | `world.ts` materialize | streets are not open fields |

### Moving (the walk graph, `world.ts` worldGraph; the path integral, `pathIntegral.ts`)

| Way | Rule | Cost |
|---|---|---|
| Walk | 8 directions outdoors and on roofs, 4 indoors (8 in a turned building) | metres |
| Stairs up | only on a stair cell, a floor at a time | 2 + 8 × 3 m per floor |
| Stairs down | the same | 2 + 3 m per floor |
| Roof to roof | across a one-cell alley, to a roof at the same height or lower | 2 × 2 m + 2 |
| Fall | from a roof's edge to the street beside it | 1 + 3 m per floor |
| Sky arc | from a roof, at 7, 10 or 13 m/s, **never gaining height**, landing on street or a lower roof | effort ∝ speed² |
| Underground | halls, shafts, stairs from a station's or a mall's ends | per level |

The path integral samples a walk e^(−S/T) (T = 0.6 of its convergence bound, κ = 1 for turning, λ = 8 for climbing).
How a move is made sets its cost factors: `walk`, `run` (jumps and arcs cheaper), `fall` (falls cheap). **A leap and a
flight are sampled as walks** (`classOf` knows only fall, run, walk). Jev's spots are looked for within a reach by how:
step 6 m, walk 40, run 90, leap 30, flight 400 (looked for within 100 m).

### Continuity (the director)

| Rule | What it does | Measured |
|---|---|---|
| Spawn once | the first time someone is present, they start at spawning's start | 65 starts |
| Carry on | someone present who stands inside the scene's place carries their spot | 93 carried |
| Travel to a scene elsewhere | walked when within 300 m of the scene's anchor | a straight-line distance, no time |
| Off-page beyond 300 m | set down at the anchor, no walk | 13 people, 6 scenes |
| A scene's people start together | round one anchor (those already here, else the first placed by the text) | |
| One state for the whole book | `where` runs through every scene in reading order | **8 people in more than one strand** |

### Talk, companions, actors, damage (the director)

| Rule | What it does | What it does not check |
|---|---|---|
| Dialogue gathers | everyone addressed walks to within 2–4 m of the first speaker, on the speaker's floor | the kind of talk (a phone call gathers too), how far they walk, who really speaks (EM², 646 of 1,666 lines with no one) |
| Go with someone | to within 2.5 m of the leader, same floor | whether the two are near; the leader's own move |
| Actors | only those with a position act | an actor not present is skipped silently |
| Destruction | asked only when Jev says the text breaks something, at 0.7 or more; Jev picks a sphere and its size | strength against what is hit; what is already gone |

### What nothing enforces

Time (no move or arrival is checked against the story's clock); two places at once; the kind of a conversation;
abilities (who can leap, fly, teleport); falls that would hurt; how many fit in a room or a cell; things held; knowledge;
and strands (continuity runs across them).

## 2. What the run shows the gaps cost

| Gap | On volume 1 |
|---|---|
| No way up but stairs | 12 leaps (9 played, all as walks) and 3 flights (1 played, as a walk); a leap onto a roof can only be played as climbing a building's stairs |
| Unreachable targets taken | 21 moves never walked; most "run" or "leap" into a room or hall of a 100-floor office |
| Distance instead of time | 13 off-page arrivals at a fixed 300 m |
| One state across strands | 8 people carried from one strand into another |
| Talk gathers by rule | 64 people "spoken to" (30 walked over, 34 already near), none checked for kind or distance |
| Going with someone | 44 "with" answers (12 walked), none checking the two are near or the leader's own move |

## 3. The laws, one by one

Each law is a check on a proposal (an answer of Jev's or the work model's, the reading's script, an agent's answer, a
note of the user's) against the world log, at the moment the proposal would act. Its verdict is **ok**, **amend** (with
the lawful alternatives, e.g. the reachable spots) or **reject** (with the reason). W2 logs verdicts only; W4 acts on them.

### L1 · Continuity, scoped to a strand (the user's rule)

**Rule.** Each strand keeps its own world state: who stands where, since when. Within a strand, a person is where the
strand last left them until a later scene of that strand moves them. When the strand ends, its state ends with it; it
is never carried into another strand.

- **A fork** (a strand that splits off, e.g. at scene 5) starts from its parent's state at the fork's scene: the people
  who go with it carry their spots; everyone else stays in the parent.
- **A merge** (strands meet: "meets", "joins" in `strands.json`'s checks) reconciles: each person present comes from
  the strand they were last in, and walks (or arrives, by L5) from there.
- **Order of play:** each strand is played in its own order (reading order within it), not interleaved: the director
  plays strand by strand, merging where they meet.
- **Entering a scene:** `strands.json` already says, per person, whether they come from a scene of the same place
  (`samePlace`), from elsewhere, or appear first. The director's own test ("inside the scene's box, plus 8 m") gives way
  to it.
- **A flashback** is a strand of its own in the past: it plays from the past's state and moves nobody now (v1's law 3).

**Checks.** A person proposed present in a scene of strand S at time t is where S left them; a position read from
another strand's state is rejected.

### L2 · Nobody is in two places at once

**Rule.** Two scenes at overlapping times (on the time tree) can't share a person at different places. Parallel strands
make this checkable: their scenes are at the same time by construction.

**Checks.** Presence proposals (the script's, an agent's) and speakers: a line given to someone present elsewhere at
that time is rejected (with the people who are present as alternatives).

### L5 · Travel takes time

**Rule.** A move or an arrival must fit the time it has. Speeds by way: walk 1.4 m/s, run 4, a vehicle by kind, and
abilities (L12) their own. The time a move has comes from the story's clock: within a card, the card's span (its lines'
reading time as a floor, and any time the text states); between scenes, the time tree's gap (same moment, later the
same part of the day, the next day).

- **Within a scene:** a walk longer than its card allows is amended to its reachable part, or rejected.
- **Between scenes:** an arrival from elsewhere is walked when it fits the gap, "off-page" when the gap is long enough
  but the walk is outside the world streamed in, and a **conflict** when no way fits (the relation becomes "later", or
  goes to the review). The fixed 300 m goes.

**Open:** where the clock is too coarse (no stated time), is a scene's gap "unknown, anything fits", or a default?

### L6 · Talk needs nearness, by kind

**Rule.** Every dialogue card gets a kind (v1's four): **live** (two face to face: the same room, or within 4 m outside
and in corridors), **group** (three or more face to face: inside one box), **remote** (phone, message, letter,
telepathy: the parties may be apart; the remote party is not present here), **public** (one voice to everyone within
25 m or on the same floor).

- Gathering walks only for live and group, and only within what L5 allows; remote never moves anyone.
- **Speakers:** a line's speaker must be able to speak to its listener under its kind. An EM² speaker out of earshot of a
  live talk is rejected; when only one person present could have said it, that is evidence for the ledger (W6).

**Open:** the kind is asked of whom: Jev per card, or decided by rule where the text says (a phone, a letter)?

### L9 · Actors are there

**Rule.** An action's actors are present where it happens. An actor with no position today is skipped silently; under
the law it is a **presence proposal** (the script missed them) or the card is flagged.

### L10 · Reachable

**Rule.** A target is lawful only if the walk reaches it under the mover's ways (L12), within L5's time. A target no
walk reaches is amended to the nearest reachable spot in the same direction (or the same building, the same floor),
or rejected with why: off the walk where they stand, no door, no stair to that floor, outside the world streamed in.

### L11 · Bodies

**Rule.** People stand only on walkable cells (street, corridor, room, roof, underground); never inside a wall, a mass
cell, or above a roof. At most a few people share a 2 m cell (crowds aside). A floor proposed for a building must exist
(a "floor 7" of a 5-floor building is rejected with its floors as alternatives).

### L12 · Abilities and ways of moving

**Rule.** Each person has ways of moving, and only those: everyone walks, runs, climbs stairs, steps down a floor;
the able jump a gap of a few metres and drop a floor or two; beyond that, what the story gives them, each with its
limits:
- **leap up** (to a roof or a ledge above), to a height;
- **flight**, to a height and a range;
- **teleport**, within a range, line of sight or not;
- **vehicles**, on roads.

Ways are edges added to the walk graph for that person (an upward leap from the street to a roof within its height; a
teleport to any walkable cell within its range), and their own cost factors in the path integral, so a leap is no
longer sampled as a walk. Abilities come from the reading: the concepts with their owners (an ability is a concept,
owned by a person); where the reading has none, the person is human.

**Checks.** A move by a way the person lacks is rejected (with the ways they have); a fall beyond what they survive is
evidence of harm (a state change for the ledger) or rejected when the text says nothing happened.

**Open:** a power's limits (how high, how far) from the text, from the work model, or from a table per power kind?

### L13 · Destruction is physical

**Rule.** A blast breaks what its sphere reaches and its strength can break (a wall before a frame, glass before
concrete); what is gone stays gone within the strand (L1) and in the world after; a blast with nothing said to break is
rejected (today: Jev's "breaks" question at 0.7).

### Not yet: L7 things, L8 knowledge

Things held by one person (custody) and knowledge flowing by witnessing or hearing need the things and facts tracked
per person through the world log; they come after W1's log exists.

## 4. Where the checks run

| Moment | Proposals checked | Laws |
|---|---|---|
| A scene starts | who is present, where each comes from | L1, L2, L5 (arrivals), L9 |
| A dialogue card | its kind, its speakers, the gathering walks | L6, L2, L5 |
| An action card | whether, way, spot or box, how | L10, L11, L12, L5 |
| A blast | where it hits, how big | L13 |
| An agent's answer, a user's note | any of the above | as above |

The verdict is recorded with the card (W2), and from W4 it decides what plays: ok plays, amend plays the lawful
alternative (and says so), reject plays the lawful default (nobody moves) and holds the card for the review.

## 5. Parameters to settle

| Parameter | Proposed | Used by |
|---|---|---|
| Walk, run speed | 1.4 m/s, 4 m/s | L5 |
| A card's least span | its lines at reading pace | L5 |
| Live talk distance | same room, or 4 m | L6 |
| Public earshot | 25 m, or the same floor | L6 |
| Jump gap, safe drop | 3 m across, 2 floors down | L12 |
| People per 2 m cell | 3 (a crowd excepted) | L11 |

## 6. Decisions (the user, 2026-11-02)

1. **A strand does not end at a chapter's end**, nor at a book's: it may be continued in the next book. Continuity
   holds to a strand's last scene in whatever book that is; the world state of a strand that reaches a book's end is
   kept for the universe, for the next book to carry on.
2. **A scene gap with no stated time: anything fits.** L5 checks only where both scenes state their time; kept so to
   see how it goes.
3. **A dialogue card's kind is asked of Jev** (live, group, remote, public).
4. **Abilities: a config per character**, built and maintained by the main agent (§7). A way a person has (teleport,
   flight, an upward leap) is a way the physics engine lets them move; the checks pass it.
5. **All the laws together**: W2 logs every law at once.

## 7. The abilities config (built and maintained by the main agent)

One file per universe, `<library>/universe/abilities.json`, so a character's abilities follow them from book to book
as their strands do. The main agent writes it through the review CLI (W5), from the text: each entry cites the
sentences it rests on. Someone with no entry is human: walk, run, stairs, a short jump, a short drop.

```json
{
  "version": 1,
  "people": {
    "char_000004": {
      "name": "…",
      "ways": {
        "teleport": { "range": 80, "sight": false, "carries": 1 },
        "flight":   { "height": 30, "range": 300 },
        "leap":     { "height": 15, "across": 20 },
        "ride":     { "kind": "car" }
      },
      "evidence": ["b0001_s0123"],
      "by": "agent",
      "at": "2026-11-02T00:00:00Z"
    }
  }
}
```

| Way | What the engine allows the person (L12) |
|---|---|
| `leap` | from where they stand up to a roof or a ledge no higher than `height` m and no further than `across` m |
| `flight` | any open cell up to `height` m above the ground, within `range` m of the move's start |
| `teleport` | any walkable cell within `range` m (in sight only if `sight`), taking up to `carries` people with them |
| `ride` | roads, at the vehicle's speed (L5) |

W2's checks read the file (and treat an empty one as everyone human); the engine's edges for those ways come with W4.

## 8. W2, first results: every law over run `d20261102081221`

`world-engine/laws/laws.mjs` (the laws, pure checks) and `check-run.mjs` (a run's record and page made into the line as
played, the laws over it, `stage/director/laws.json`). Logged only, no model calls; the abilities config is still
empty, so everyone is human.

| Law | Checked | Broken | What breaks |
|---|---|---|---|
| L1 continuity, per strand | 93 carried | 4 | people carried from the wrong scene, because the director skipped scenes 36, 38 and 39 (people present, never played) |
| L2 two places | 0 | 0 | one scene states a clock time; parts of the day are not checked |
| L5 travel time | 0 | 0 | as L2 (decision 2: a gap with no stated time fits) |
| L6 talk | 1,011 lines | 68 | 5 speakers not present; 63 speaking to someone beyond 25 m or on another floor (median 18 m apart): remote, or misplaced, until Jev gives each card its kind |
| L9 actors there | 710 | 19 | someone the reading says acts or speaks has no place in the scene |
| L10 reachable | 47 chosen moves | 21 | the moves that never walked |
| L11 bodies | 68 | 0 | |
| L12 abilities | 47 | 15 | 12 leaps and 3 flights by people the (empty) config gives no such way, 7 of them 美琴's |
| L13 destruction | 8 | 0 | |

The skipped scenes are a director gap of their own: 7 scenes have no record, 4 with nobody present (15, 20, 41, 43) and
3 with people (36, 38, 39).
