# Next steps (2026-11-02)

After the first full run of volume 1 on the director (604 cards in 39 scenes, 68 moves, 3 blasts; run
`d20261102081221`), the user decided two tracks, **decoupled and built in parallel**:

| Track | What | Where |
|---|---|---|
| **A · The summarization layer** | a work model's digest of each card and each scene, and its memory across scenes, in the context of every Jev question | this page |
| **B · The world and the ontology, one loop** | the physics law engine on every answer, the world's evidence back into the ontology, system 2 and the review escalation | [world-ontology.md](world-ontology.md) |

The user: the summarization layer "is a decoupled improvement of a different direction than the world engine ontology
loop. They can be done in parallel." Track A makes each question better informed; Track B checks every answer and keeps
the ontology. Neither waits for the other: B checks whatever answer comes, A improves what is asked.

## Track A: the summarization layer

The user on why v2 plays less smoothly than v1:

> In v1, Jev used the summary an LLM worker extracted. It helps him understand complex, sometimes mixed thought,
> facts and actions. Not only that: LLMs can figure out more than that. The work LLM would also carry cross-scene short-
> and long-term context.

### What the run showed

- **Jev gets raw lines.** Each director question carries a card's sentences, the line either side and the people
  present. A card that braids talk, an inner thought, a background fact and three actions (run into an alley, throw
  something away, leap with someone onto a roof) is untangled inside the same request that asks for an arrow on a
  picture. Jev answered such a card "go with the other person" at 42%, and the mover ended on the street, not the roof.
- **v1 had a digest; v2 has none.** v1's work model wrote each event's summary (who did what, where, to what end) and
  Jev decided on it. v2's workspace `events.jsonl` keeps a `summaryEn` that is only the source sentence.

### A1. The card digest

Once per card, before any Jev question about it, the work model reads the card with its scene around it and writes a
digest, kept with the run and shown in World · Live's Why panel:

- **Background:** facts, descriptions and thoughts in the card that are not to be played.
- **Each action:** who; what; from where to where (a building, its floor, a room, a roof, underground, another place);
  how (a step, a walk, a run, a leap, a flight, carried, with whom); and whether it is said, implied, or only intended.
- **Speech:** each spoken line's speaker and listener as the passage implies them, with how sure, beside EM²'s answer.
- **What breaks**, if the text says so, and where.
- **What it infers beyond the words** (the user: LLMs can figure out more): a movement only implied by a later line
  (someone is suddenly on a roof), where a person must be for a line to make sense, who must have arrived, what a
  pronoun or a nickname refers to here.

Jev gets the digest beside the raw lines in every question about the card (whether, direction, spot, box, breaks). The
digest frames; Jev still decides on the pictures.

### A2. The scene digest

Once per scene: what happens in it (its beats in order), who comes and goes, where it is and how it connects to the
scene before (carries straight on, a jump in time or place, a flashback), and what it leaves open. It heads every card
digest of the scene and feeds the long-term memory.

### A3. Memory across scenes

The work model carries what the story so far means for the next card:

- **Short term** (the last few cards and scenes): who is where, with whom, heading where, holding or carrying what, what
  is going on (a chase, a fight, a conversation), what was just said.
- **Long term** (the book so far): each character's goals and state (hurt, disguised, tired), relationships, places
  they have been and live, threads still open.

Updated after each card (short term) and each scene (long term), kept with the run (`stage/director/memory.json`),
given to the card and scene digests, and shown in the UI next to the card it was used for. Each entry cites the
sentences it rests on. The design page: Director Memory (its system 2 section is superseded by
[world-ontology.md](world-ontology.md) §5).

### Built (2026-11-03)

A1–A3 are in `world-engine/digest/digest.mjs`, run by the director ahead of the play: the scene digest (summary, where,
how it follows, the background, each person's routine, start, end and holdings, the memory for the next scene), then the
windows (moves, facts, items, talk, breaks, background), the memory carried scene to scene. The digest replaces the
pass and the text-only questions (whether someone goes, the talk kind, whether something breaks); Jev decides on the
pictures, with the digest in its state. Items are placed with their holders or where they fall (v1's things on the
page). `--no-digest` plays as before. See [world-ontology.md](world-ontology.md) "One observation, several updates".

### What W9 left (the user, 2026-11-03, watching d20261103060830)

The summarizer run played "way better than all previous runs" (743 moves against W8's 64, 269 Jev calls against 792).
Three problems remain:

1. **The camera shifts back and forth.** A scene's people end up in groups far apart, and each card's camera frames its
   own actors. Scene 19: "indoors" (stated) moved 御坂美琴 72 m to the nearest indoor node, a basement under an office,
   while the cast stayed at the scene's spawn point; scene 40: 食蜂操祈 was carried in from scene 1's roof, 460 m away.
   31 camera jumps of more than 40 m over the volume. Facts are not tied to the scene's own set; people carried from
   far are not brought into it; the camera switches groups where the text does not cut.
2. **The crowd plays as people.** Each walker is an individual with a path; the user: a crowd is "a cloud of particles
   tied to the place", not characters.
3. **Scale is capped.** Jev picks a direction on a picture 16 m across, a leap reaches 30 m, spots are offered within
   100 m. Scene 26 goes from one tower's 44th floor to the next one's 38th, then to a third one's 52nd, across an
   avenue above a river: hundreds of metres. The user: "the camera man needs to understand the implicit in the scene";
   the zoom a scene implies is how far and how big its movement is.

### A4. Faculties, fired by block types (proposal, the user and Claude, 2026-11-03)

The user: one reader per concern (actions, two people talking, implicit movement at scale...) fits the measurement
picture (each faculty an instrument for its own observable at its own resolution), but split out it costs ten times
the input. Instead:

> When jev is classifying sentence types, it will output the distribution of all types... we record the top candidates
> and their distribution all. We also provide classification in blocks, where we no longer determine if a block is a
> dialogue or a action. We derive a new set of types... Then, based on distribution, a corresponding faculty is only
> activated once it's related types become abnormally dense, signaling it should kick in.

**What volume 1 shows** (the reading's own cache, no new calls):

- All 5,202 sentence-kind answers (`dlg_kind:<id>`) are cached with Jev's full distribution over the six kinds; the
  reading kept only the top one. 1,216 sentences (23%) have a second kind at 0.3 or more, most often narration and
  thought (free indirect thought).
- Over 12-sentence windows (866, step 6), each kind is unusually dense (above its mean + 1.5σ) in only 6–10% of them.
- Sentence kinds cannot tell what a block is about: action is as dense in the dart games (scene 17) and the shopping
  walk (8) as in the fights (21, 25–31, 40). The gate needs block types.
- The kinds pass is 56 Jev requests for the volume; a block-type question per window rides in the same requests.

**Block types** (a window of about 12 sentences, step 6; Jev's distribution kept whole, so a block can be combat 0.5
and pursuit 0.4):

| Type | In volume 1 | Fires |
|---|---|---|
| Routine interaction | the dart bar (13–18), the crosswalk (11–12), walking with Index (8) | conversation and blocking |
| Confrontation | 21–22, 25–31, 40 | choreography |
| Pursuit / traversal | the escape (1), the chase to the subway (3), the tower leaps (26), the tower's shaft (34) | journeys at scale |
| Mediated exchange | phone calls (12, 29, 33), through a door (42–43) | conversation by channel (pulls nobody) |
| Interior flow | 18, 36, the narration and thought stretches | damps the world: no implied moves, no drift, camera close |
| Exposition | the Board (37), R&C Occultics (39) | nothing staged |
| Establishing / ambience | the openings of 1, 2, 10, 45; crowds, weather | ambience: the crowd field, set dressing |
| Memory / flashback | 35 | played outside the present world |
| Spectacle / catastrophe | the ground splits, floods, collapses (21, 22, 26, 27) | choreography's destruction, at the scene's scale |

**The gate** (amended by the user, 2026-11-03: "we keep top distributions and scores for blocks and sentences, and we use
them all for faculty triggering calculates on a score based mixed index"). For both blocks and sentences the top
candidates, the whole distribution and Jev's scores (confidence; a sentence's turn) are kept. A faculty fires on a
mixed index: its block types' share, its sentence kinds' share (each sentence weighted by its confidence) and its
signals, each a z-score against its baseline over the book, mixed by weight × the window's score for it, so an unsure
block leans on its sentences (`firing()`, `MIX`). Before this amendment: a type's density over a span is its expected
share (summed from the distributions, not the top answer), against the book's baseline (its mean and spread). A faculty turns on above mean + kσ and off below a lower line
(hysteresis), runs a minimum span with a margin either side; several can be on at once. A hidden Markov model over the
block types, Jev's distributions as soft observations (as `occupation.mjs` does for presence), smooths them; its change
points are the beats, where the camera may cut.

**The faculties** (merged from the nine first proposed):

- Always on, once per scene: the **scene frame and camera**: the set as a path down the place tree, the scale band (a
  room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km), who is on stage, how it follows the scene before; the
  shot per beat (close, medium, wide, aerial) and the scale of Jev's pictures. Everyone present starts inside the set;
  facts resolve against it ("indoors" is this building).
- Always on, slim: the **generalist**, today's summarizer trimmed to stated moves, facts and items (stated moves occur
  in every kind of block).
- Fired: **journeys** (pursuit: from, via and to as places of the tree, a manner, a distance, routed on the place graph,
  Jev confirming on a picture at the journey's scale); **choreography** (confrontation, catastrophe: steps, dodges,
  impacts, what breaks); **conversation and blocking** (routine interaction, mediated exchange: groups, formations,
  channels); **ambience** (establishing: the crowd as a density field of the place with its make-up and flow, set
  dressing).
- No faculty: interior flow, exposition and memory only damp the world.

**Cost.** About 1.3–1.5× W9's work-model use (some $0.15–0.35 a volume); block types ride in Jev's kinds pass. Jev
reports its tokens with each answer (`usage.jev.reported`), so runs can price Jev too once its rate is known.

**Order.** 1. Keep the kind distributions in the reading (volume 1's from the cache, free). 2. The block-type question
in the kinds pass: three scenes first, then volume 1 (about 56 requests). 3. Density, smoothing and the gate, with a
strip in the Dev panel (the types over the book, the faculties firing) to check against the text before anything plays
from it. 4. The scene frame and camera. 5. The fired faculties one at a time, each measured on volume 1 (camera jumps
over 40 m from 31 toward none; scene 26 and scene 3 at their real distances; L6 down from 85). The page:
[summarizer-faculties.html](summarizer-faculties.html).

### A5. Specialist directors (the user, 2026-11-03)

> The part that is the most exciting is jev can be asked for different questions based on what the input director sees.
> Basically, what it means is that we can split our directors into specialist... This is a general mini harness design
> change, we need to have a pre written and derived from code active summary faculty to director group relationship.

The block types gate the readers and also choose who directs. Each specialist asks Jev its own questions: the
**routine director** in a room (formations, who is addressed, and, split out since, a character director for how people feel), the
**mega-scene director** from far (landmarks, routes, a catastrophe's extent, the crowd's flow), the **combat director**
exchange by exchange (the kind of attack: hand to hand, a weapon, a ranged power, a beam, a blast, a thrown object; its
shape: a point, a line, a cone, a sphere, a wave along the ground; the outcome), the **transport specialist** for
vehicles and weapons (which model, its path on the road, rails or air, who rides or holds it) and the **architect**, who
makes a borrowed building the one the text describes (its look, floors and uses, its rooms). The **stage manager**
always runs: the set, the cast, the camera, and who leads each beat. A fight alone is the combat director's; a fight
during a chase the mega-scene director's, the combat director answering the attack questions.

The user, on zoom (2026-11-03):

> An implicit or scale faculty of summarization pass the zoom and view angle recommendation to it's associated directors
> and the directors camera man. Only directors who records actions need the zoom parameter, other character, weaponry or
> state management directors doesn't need them.

So the directors are of three kinds. The **stage manager** (always on): the set, the cast, which action director leads
each beat, where the cuts fall. **Action directors** (routine, mega-scene, combat) record action: only they read the
**scale-and-view** faculty, and each has a camera operator framing its beats (and Jev's pictures) at the zoom and view
angle it recommends; one of them always leads. **State directors** (the character director for feelings, intent and
bonds; the transport specialist; the architect) keep what rides with people and things, with no zoom and no camera,
asking on the text and on fixed reference pictures; a thing in motion is played by the beat's action director.

The relationship lives in one registry, `world-engine/director/specialists.mjs` (block types, the reading's signals,
faculties, directors, the gate `firing()`, `lead()`), checked by `specialists.test.mjs` (every type fires or damps,
every faculty is fired and read, the built questions are modes in the code). The tables below and the plan page are
written from it by `node world-engine/director/specialists-doc.mjs`; change the registry, not them. A page per faculty and
per director, with how each is asked and its options (built ones run through their own modes), is in
[directing/Directing.md](directing/Directing.md), written by `directing-vault.mjs` from `specialists.mjs` and `questions.mjs`.

<!-- specialists:start -->
_Written from `world-engine/director/specialists.mjs` by `specialists-doc.mjs`; change the registry, not this._

**Block types** (Jev, in the kinds pass, as one distribution a window):

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

**Summary faculties** (the work model reads the text) and the directors that play them (own: the director's first faculty):

| Faculty | Fired by | Writes | Read by | Status |
|---|---|---|---|---|
| Scene frame | always (each scene) | the set as a path down the place tree; who is on stage; how it follows the scene before; the beats | Stage manager (own) | proposed |
| Scale and view | always (each beat) | the zoom: how many metres across the beat plays (a room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km); the view angle: eye level, over a shoulder, high, top-down, low looking up, aerial; whose eyes or which landmark it is seen from; how far its moves reach | Routine director, Mega-scene director, Combat director | proposed |
| Generalist | always (each window) | stated moves (graded); facts, stated and implied; items; talk kinds; breaks | Stage manager, Routine director, Combat director, Character director, Transport specialist, Architect | built |
| Conversation and blocking | Routine interaction, Mediated exchange, spoken sentences | who talks with whom and through what; formations: beside, across a table, a ring, two sides of a door; attention: who looks at whom | Routine director (own) | proposed |
| Inner state | Interior flow, Routine interaction, thought sentences | each person's emotional state as it changes (a distribution); intent: what they want next; bonds: who they are to each other | Character director (own) | proposed |
| Journeys | Pursuit / traversal, action sentences, a jump in scale | from, via and to as places of the tree; the manner (alleys, up a wall, leaps, carried); distance and duration | Mega-scene director (own) | proposed |
| Choreography | Confrontation, Spectacle / catastrophe, action sentences | exchanges: attacker, target, attack, outcome; knock-backs, dodges, throws; what breaks and how wide | Mega-scene director, Combat director (own) | proposed |
| Ambience | Establishing / ambience, environment sentences, crowds named | the crowd as a density of the place: its make-up and flow; weather, light, mood; set dressing | Mega-scene director | proposed |
| Props and vehicles | action sentences, vehicles named, weapons named | vehicles: kind, who drives or rides; weapons: kind, who holds them; things held, thrown, broken | Transport specialist (own) | partial |
| Set description | Establishing / ambience, environment sentences, fact sentences, buildings named or described | a building's look, floors and uses (a 70-floor tower: mall, offices, flats); a room's make-up (a container bar, a thick-doored cell); changes to them | Architect (own) | proposed |

**Specialist directors.** The stage manager always runs; action directors record action, read the scale faculty and hold a camera (one of them leads each beat); state directors keep what rides with people and things, with no zoom and no camera:

| Director | Kind | Plays | Zoom | Camera | Asks Jev | Status |
|---|---|---|---|---|---|---|
| Stage manager | stage | the set, who is on stage, which action director leads each beat and where the cuts fall | — | — | spawnSpotMode (built); sceneGoesOnMode (built); the set on a map of the place tree | partial |
| Routine director | action | inside a room or on a street corner: positions, gaze, who talks to whom and from where | 2–15 m | medium and close at the recommended angle; a room cut away | dialogueKindMode (built); moveSpotMode (built); formation on a room plan (who sits where, facing whom); who is addressed, from the faces turned | partial |
| Mega-scene director | action | traversals and catastrophes seen from far: routes across blocks, leaps between towers, the ground splitting, crowds flowing | 100–2 km | wide and aerial at the recommended angle; follows a journey whole | moveDirectionMode at the journey's zoom (partial); a landmark on a top-down map (lettered towers, bridges, stations); a route among the place graph's routes; the extent of a catastrophe (an area on the map); which way a crowd flows | proposed |
| Combat director | action | a fight, exchange by exchange: the kind and shape of each attack, who it hits, what it breaks | 5–60 m | close to medium at the recommended angle, following the exchange; wider for a blast | the hit spot and size (red spheres) (built); attack kind: hand to hand, grapple, weapon, ranged power, beam, blast, thrown object, the ground itself; attack shape: point, line or beam, cone, sphere, wave along the ground; outcome: hit, dodged, blocked, cancelled; how far knocked back | partial |
| Character director | state | what rides with a person: how they feel, what they want, who they are to each other | — | — | emotional state as a score (Jev's score primitive); intent: what they want next; a bond changing (closer, colder, a first meeting) | proposed |
| Transport specialist | state | vehicles and weapons: what they are, who drives, rides or holds them, whose they are; their motion is played by the beat's action director | — | — | which model a vehicle or weapon is (on the model packs' sheets); who rides, drives or holds it; whose it is | proposed |
| Architect | state | a building borrowed from the world made the one the text describes: its look, floors, uses, rooms and what changes in it | — | — | terrainHeightMode and terrainPartMode (built); its look among the model packs and themes (on its elevation); floors and uses (the mall below, offices, flats, the rooftop deck); a room's make-up and furniture (on its plan) | partial |

**State and the ontology.** What each director keeps as it plays, and how it flows:

1. **play**: the director changes its state card by card (positions, exchanges, feelings, holdings, buildings) (`world-engine/director/director.mjs`)
2. **world log**: each change a record, append-only, with its rank (pinned, stated, met, answered, ruled) and source (`world-engine/log/world-log.mjs`)
3. **laws**: checked as it plays (held, amended) and over the whole run afterwards (`world-engine/laws/laws.mjs`)
4. **smoother**: positions and presence back-propagated: the least-action history and its clouds (later: feelings, as additive states) (`world-engine/smoother/`)
5. **ledger**: the run's proposals to the ontology, each with its evidence and the laws' verdicts (`world-engine/log/write-log.mjs`)
6. **gate**: applied by canon where a law checks it, held for the review (Pi) otherwise; some state stays with the run (`world-engine/review/canon.mjs, review.mjs`)
7. **canon**: written into ontology/*.jsonl (last write wins by id), every write logged in canon.jsonl and undoable; the graph rebuilt (`world-engine/review/canon.mjs`)
8. **next run**: the review's answers become pins; canon, pins and the smoothing are where the next run starts from (`world-engine/review/review.mjs`)

Gates: **applied**, written by canon without review: a law checks it and nothing broke; **held**, held for the review first; written once answered (some move to applied once audits show they are right); **run**, kept with the run only (its records, the page); never in the ontology.

*Stage manager*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Who is on stage | presence | L2, L9 | yes | Scene.charactersPresent + PRESENT_IN relation | applied | built |
| The set (the scene's place and its path up the tree) | binding | — |  | Scene.locationId + PART_OF relation | applied | built |
| Facts about where people are (stated or implied: indoors, a floor, near someone) | position | L14 | yes | StateChange.location | applied | partial |
| Beats and who led them | beat (new) | — |  | action event + PRECEDES relation | held | proposed |
| The cuts (where one beat ends and the next begins, and who leads it) | beat (new) | — |  | the run only | run | proposed |

*Routine director*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Positions in the room | position | L1, L10, L11 | yes | StateChange.location + PART_OF relation; today at the building; a room becomes a Location inside it | applied | partial |
| Who talks with whom, through what | meeting | L6 |  | SPEAKS_TO relation + Scene.turns; speakers are off for now; the channel (face to face, phone, door) a property of the relation | held | partial |
| Formations and attention | meeting | L6 |  | ADDRESSES relation | held | proposed |
| Its camera (the zoom and view angle the scale faculty recommends, as framed) | — | — |  | the run only | run | proposed |

*Character director*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Feelings | feeling (new) | — | yes | StateChange.emotions; additive deltas clamped to [-1, 1] (the ontology's rule); applied once audits show them right | held | proposed |
| Bonds and first meetings | feeling (new) | — |  | StateChange.relationships + KNOWS relation | held | proposed |
| Intent | feeling (new) | — |  | StateChange.goalsAdd | held | proposed |

*Mega-scene director*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Journeys (routes, stops, manner) | position | L5, L10, L12 | yes | StateChange.location + movement event; each stop a location; the journey an event, held | applied | partial |
| A catastrophe's extent | damage | L13 |  | Location.properties.damage + conflict event | applied | partial |
| Its camera (the zoom and view angle the scale faculty recommends, as framed) | — | — |  | the run only | run | proposed |
| Crowds | crowd (new) | — |  | Organization.properties.members + MEMBER_OF relation; a named crowd (the student column) an Organization its people are members of; an unnamed density stays with the run | held | proposed |

*Combat director*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Exchanges (attacker, target, kind and shape of the attack, outcome) | exchange (new) | L12, L13 |  | PARTICIPATES_IN relation + conflict event; the attack's kind, shape and outcome properties of each participant's relation to the event; CAUSES from it to what it broke | held | proposed |
| Knock-backs and dodges | position | L1, L10 | yes | StateChange.location | applied | partial |
| Injury and condition (hurt, unconscious, bound) | condition (new) | — |  | StateChange.conditionsAdd + StateChange.conditionsRemove; the field added 2026-11-03 (set add/remove, as possessions) | held | proposed |
| Abilities shown | exchange (new) | L12 |  | Character.properties.abilities | held | proposed |
| What breaks | damage | L13 |  | Location.properties.damage | applied | built |
| Its camera (the zoom and view angle the scale faculty recommends, as framed) | — | — |  | the run only | run | partial |

*Transport specialist*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Vehicles and weapons | item (new) | — |  | Item.properties.class; new identities: held, as EM's are | held | proposed |
| Who holds, drives or rides | possession (new) | L15 |  | StateChange.possessionsAdd + StateChange.possessionsRemove | applied | proposed |
| Where things are | item (new) | L15 | yes | LOCATED_AT relation; where the beat's action director put them, at its zoom | applied | proposed |
| Ownership | possession (new) | — |  | OWNS relation | held | proposed |

*Architect*

| State | World log | Laws | Smoothed | Into the ontology | Gate | Status |
|---|---|---|---|---|---|---|
| Which building it is | binding | — |  | Location.properties.world; W6: building identity from the lot each scene played in; unsure ones held | held | built |
| Floors, uses, look | building (new) | L11 |  | Location.properties.floors + Location.properties.uses; a room's floor is in canon (W6); uses and look proposed | held | partial |
| Rooms | building (new) | L11 |  | PART_OF relation; container and split held items (W6) | held | partial |
| Changes to it | damage | L13 |  | Location.properties.damage | applied | built |

Into each ontology file:

| File | From |
|---|---|
| `scenes.jsonl` | Stage manager (Who is on stage, The set); Routine director (Who talks with whom, through what) |
| `relations.jsonl` | Stage manager (Who is on stage, The set, Beats and who led them); Routine director (Positions in the room, Who talks with whom, through what, Formations and attention); Character director (Bonds and first meetings); Mega-scene director (Crowds); Combat director (Exchanges); Transport specialist (Where things are, Ownership); Architect (Rooms) |
| `state-changes.jsonl` | Stage manager (Facts about where people are); Routine director (Positions in the room); Character director (Feelings, Bonds and first meetings, Intent); Mega-scene director (Journeys); Combat director (Knock-backs and dodges, Injury and condition, Injury and condition); Transport specialist (Who holds, drives or rides, Who holds, drives or rides) |
| `events.jsonl` | Stage manager (Beats and who led them); Mega-scene director (Journeys, A catastrophe's extent); Combat director (Exchanges) |
| `entities.jsonl` | Mega-scene director (A catastrophe's extent, Crowds); Combat director (Abilities shown, What breaks); Transport specialist (Vehicles and weapons); Architect (Which building it is, Floors, uses, look, Floors, uses, look, Changes to it) |
<!-- specialists:end -->

### A6. Milestones to the next whole-volume run, W10 (agreed 2026-11-03)

The user: "I agree and I think we are ready to start implementing. Give a clear list of milestones to achieve before
the next whole volume test." Each milestone ends in something measured on volume 1; unpaid trials (stand-in Jev, a fake
work model) come before anything paid. Speakers stay off for W10, as in W9.

| # | Milestone | Done when | Paid |
|---|---|---|---|
| M1 | **The reading keeps its distributions and scores**: every sentence's top kinds, full distribution and scores (confidence, turn) in the reading, from the cache | all 5,202 in `data.json`; the extraction flow keeps them from now on | no |
| M2 | **Block types in Jev's kinds pass**: one question a 12-sentence window (step 6), the nine types; each block's top types, full distribution and confidence kept | three scenes tried first; then volume 1 (about 56 requests); the dart bar reads routine, 21 confrontation, 26 traversal, 42 mediated, 35 memory | small |
| M3 | **The gate and the beats**: the mixed index over blocks, sentences and signals (`firing()`) and `lead()` over volume 1, the smoothing over block types, beats at its change points; the strip in the Dev panel with each faculty's index | each faculty fires on 10–35% of the volume; the leads of five scenes checked by the user on the strip | no |
| M4 | **The stage manager and the scene frame**: the set as a path, everyone present inside it (the far ones walk in or are placed), facts resolved in the set, the camera held on one group until the text cuts; scenes 36, 38, 39 played (no canon events today) and 15, 20, 41, 43 explained (spawning places nobody) | camera jumps over 40 m from 31 to 5 or fewer; no implied move into a basement or another building without a stated fact; 46 of 46 scenes accounted for | trial |
| M5 | **Scale and view, and the camera operators**: zoom and angle per beat to the action directors; Jev's pictures, reach and spots sized by the zoom (the 16 m picture, 30 m leap and 100 m spot caps lifted); World · Live following the recommendation | scene 26's tower-to-tower leaps and scene 1's rooftop escape played at their real distances | trial |
| M6 | **Mega-scene director and journeys**: routes and landmarks on the place graph; the landmark and route questions | scene 3's chase reaches the subway through the alleys; 26 and 34 traversals; L5 and L10 clean on them | trial |
| M7 | **Combat director and choreography**: attack kind, shape, outcome, knock-back; the `exchange` record; conditions held | every exchange of 21, 25–31, 40 recorded with its kind and shape; knock-backs played; L13 clean | trial |
| M8 | **Routine director and conversation**: formations, channels (a phone or a door pulls nobody) | L6 below W8's 48 (W9 85); the calls of 12, 29, 33 and the door of 42–43 pull no one | trial |
| M9 | **Ambience: the crowd as a field**: a particle cloud of the place drawn on the page, its density and flow by beat; named crowds as Organizations (held); the `extra:` walkers gone | no crowd in the people list; crowds visible in 1, 2, 10, 45, still or fleeing as the text says | no |
| M10 | **State directors**: the character director (feelings, intent, bonds, held); transport (items as cleaned since W9, vehicles and weapons, possessions under L15) | items in W10 without body parts or people, none carried past a scene that drops them; feelings held for the review, not applied | trial |
| M11 | **Into the ontology**: the new log kinds, the ledger's proposals, canon's gates for the new targets, the new held kinds in the review and in Pi's CLI and skill | a stand-in run writes every new kind; each undoes; Pi can answer each held kind | no |
| M12 | **Records and cost**: Jev's reported tokens and the work model's usage per faculty and director in the run record and report; firing coverage in the report; the vault notes regenerated and pulled | the W10 report prices itself | no |
| M13 | **Dress rehearsal, then W10**: the whole volume with the stand-in and the fake work model; the page on iPad; every test; then the paid run against W8 and W9 | the table below filled | W10 |

Order: M1 → M2 → M3 gate the fired faculties. M4 and M5 rest on always-on faculties and can start beside M2. M6–M9 need
M3 and M5; M10–M12 go alongside; M13 last. The architect (floors, uses, looks) can follow W10.

What W10 is measured on, against W8 (`d20261103011140`) and W9 (`d20261103060830`):

| Measure | W8 | W9 | W10 target |
|---|---|---|---|
| Moves played | 64 | 743 | as many, at their real scale |
| Camera jumps over 40 m | — | 31 | 5 or fewer |
| L6 talk breaks | 48 | 85 | under 48 |
| L10 unreachable | 19 | 11 | under 11 |
| Scenes played | 39 of 46 | 39 of 46 | 46 accounted for |
| Jev calls | 792 | 269 | under 400 |
| Crowd | — | 93 walkers | a field, no walkers |

### Order of work (Track A)

1. A1, the card digest, for every action and dialogue card of volume 1: one work-model request per card (cents for the
   volume); shown in Why; every Jev question about the card takes it.
2. A2, the scene digest, heading each scene's card digests.
3. A3, memory, updated card by card and scene by scene, feeding both digests.
4. A director run of volume 1 with A1–A3, against `d20261102081221`.

Still open from the first full run: 21 chosen targets never walked (a door fix and the walk's reason are in since, not
yet run); seven scenes with no record (four where spawning placed nobody: 15, 20, 41, 43).
