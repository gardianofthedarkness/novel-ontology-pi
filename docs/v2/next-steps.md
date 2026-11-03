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
| Interior flow | thought, reflection, free indirect thought | 18, 36, the long narration and thought stretches | Inner state |
| Exposition | world-building and background with no one acting | the Board (37), R&C Occultics (39) | fires no reader |
| Establishing / ambience | where and when: the place, weather, crowds, mood | the openings of 1, 2, 10, 45 | Ambience, Set description |
| Memory / flashback | what happened before this scene's now | 35 | fires no reader |
| Spectacle / catastrophe | the world itself changing: ground splits, floods, collapses | 21, 22, 26, 27 | Choreography |

**Summary faculties** (the work model reads the text) and the directors that play them (own: the director's first faculty):

| Faculty | Fired by | Writes | Read by | Status |
|---|---|---|---|---|
| Scene frame | always (each scene) | the set as a path down the place tree; who is on stage; how it follows the scene before; the beats | Stage manager (own) | partial |
| Scale and view | always (each beat) | the zoom: how many metres across the beat plays (a room ~15 m, a street ~80 m, a block ~300 m, a district ~1.5 km); the view angle: eye level, over a shoulder, high, top-down, low looking up, aerial; whose eyes or which landmark it is seen from; how far its moves reach | Routine director, Mega-scene director, Combat director | built |
| Generalist | always (each window) | stated moves (graded); facts, stated and implied; items; talk kinds; breaks | Stage manager, Routine director, Combat director, Character director, Transport specialist, Architect | built |
| Conversation and blocking | Routine interaction, Mediated exchange, spoken sentences | who talks with whom and through what; formations: beside, across a table, a ring, two sides of a door; attention: who looks at whom | Routine director (own) | built |
| Inner state | Interior flow, Routine interaction, thought sentences | each person's emotional state as it changes (a distribution); intent: what they want next; bonds: who they are to each other | Character director (own) | proposed |
| Journeys | Pursuit / traversal, action sentences, a jump in scale | from, via and to as places of the tree; the manner (alleys, up a wall, leaps, carried); distance and duration | Mega-scene director (own) | built |
| Choreography | Confrontation, Spectacle / catastrophe, action sentences | exchanges: attacker, target, attack, outcome; knock-backs, dodges, throws; what breaks and how wide | Mega-scene director, Combat director (own) | built |
| Ambience | Establishing / ambience, environment sentences, crowds named | the crowd as a density of the place: its make-up and flow; weather, light, mood; set dressing | Mega-scene director | proposed |
| Props and vehicles | action sentences, vehicles named, weapons named | vehicles: kind, who drives or rides; weapons: kind, who holds them; things held, thrown, broken | Transport specialist (own) | partial |
| Set description | Establishing / ambience, environment sentences, fact sentences, buildings named or described | a building's look, floors and uses (a 70-floor tower: mall, offices, flats); a room's make-up (a container bar, a thick-doored cell); changes to them | Architect (own) | proposed |

**Specialist directors.** The stage manager always runs; action directors record action, read the scale faculty and hold a camera (one of them leads each beat); state directors keep what rides with people and things, with no zoom and no camera:

| Director | Kind | Plays | Zoom | Camera | Asks Jev | Status |
|---|---|---|---|---|---|---|
| Stage manager | stage | the set, who is on stage, which action director leads each beat and where the cuts fall | — | — | spawnSpotMode (built); sceneGoesOnMode (built); the set on a map of the place tree | partial |
| Routine director | action | inside a room or on a street corner: positions, gaze, who talks to whom and from where | 2–15 m | medium and close at the recommended angle; a room cut away | dialogueKindMode (built); moveSpotMode (built); formation on a room plan (who sits where, facing whom); who is addressed, from the faces turned | partial |
| Mega-scene director | action | traversals and catastrophes seen from far: routes across blocks, leaps between towers, the ground splitting, crowds flowing | 100–2 km | wide and aerial at the recommended angle; follows a journey whole | moveDirectionMode at the journey's zoom (partial); a landmark on a top-down map (lettered towers, bridges, stations) (built); a route among the place graph's routes; the extent of a catastrophe (an area on the map); which way a crowd flows | partial |
| Combat director | action | a fight, exchange by exchange: the kind and shape of each attack, who it hits, what it breaks | 5–60 m | close to medium at the recommended angle, following the exchange; wider for a blast | the hit spot and size (red spheres) (built); attack kind: hand to hand, grapple, weapon, ranged power, beam, blast, thrown object, the ground itself (built); attack shape: point, line or beam, cone, sphere, wave along the ground (built); outcome: hit, dodged, blocked, cancelled; how far knocked back (partial) | partial |
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
| Who talks with whom, through what (the channel sets the card's talk kind (M8); L6 respects a remote one) | meeting | L6 |  | SPEAKS_TO relation + Scene.turns; speakers are off for now; the channel (face to face, phone, door) a property of the relation | held | partial |
| Formations and attention | meeting | L6 |  | ADDRESSES relation; formations played by rule (M8); attention read, not yet drawn | held | partial |
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
| Exchanges (attacker, target, kind and shape of the attack, outcome) | exchange | L12, L13 |  | PARTICIPATES_IN relation + conflict event; the attack's kind, shape and outcome properties of each participant's relation to the event; CAUSES from it to what it broke | held | partial |
| Knock-backs and dodges | position | L1, L10 | yes | StateChange.location | applied | partial |
| Injury and condition (hurt, unconscious, bound) | condition | — |  | StateChange.conditionsAdd + StateChange.conditionsRemove; the field added 2026-11-03 (set add/remove, as possessions) | held | partial |
| Abilities shown | exchange | L12 |  | Character.properties.abilities | held | proposed |
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
| M1 | **The reading keeps its distributions and scores**: every sentence's top kinds, full distribution and scores (confidence, turn) in the reading, from the cache | all 5,202 in `data.json`; the extraction flow keeps them from now on. **Done 2026-11-03**: `classifySentences` keeps each distribution, the flow writes `top` and `distribution` beside `kind`, `confidence`, `turn`; volume 1 backfilled from its cache by `experiments/v2/kind-scores.mjs` (5,202 of 5,202, none asked again) | no |
| M2 | **Block types in Jev's kinds pass**: one question a 12-sentence window (step 6), the nine types; each block's top types, full distribution and confidence kept | three scenes tried first; then volume 1 (about 56 requests); the dart bar reads routine, 21 confrontation, 26 traversal, 42 mediated, 35 memory. **Done 2026-11-03**: the v2 flow asks them (`blocks: true`); volume 1 by `experiments/v2/block-types.mjs`, 56 windows, 831 blocks, 56 paid Jev requests (8 the trial on 17, 21, 26); mean confidence 0.73. Read as: 17 routine 0.65, 39 exposition 0.77, 12 and 42 mediated about 0.2; 21 is catastrophe and traversal, not confrontation; interior the largest share in many action scenes ([Decisions](directing/Decisions.md) 1–2) | small |
| M3 | **The gate and the beats**: the mixed index over blocks, sentences and signals (`firing()`) and `lead()` over volume 1, the smoothing over block types, beats at its change points; the strip in the Dev panel with each faculty's index. **Built 2026-11-03**: `world-engine/director/gate.mjs`, `beats.mjs`; 96 beats; faculties read 10–36%; the strip a page of its own for now ([Gate](directing/Gate.md), [Decisions](directing/Decisions.md) 3–5) | each faculty fires on 10–35% of the volume; the leads of five scenes checked by the user on the strip | no |
| M4 | **The stage manager and the scene frame**: the set as a path, everyone present inside it (the far ones walk in or are placed), facts resolved in the set, the camera held on one group until the text cuts; scenes 36, 38, 39 played (no canon events today) and 15, 20, 41, 43 explained (spawning places nobody) | camera jumps over 40 m from 31 to 5 or fewer; no implied move into a basement or another building without a stated fact; 46 of 46 scenes accounted for. **Built 2026-11-03**: the cast gathered within 80 m of its middle (else walked in or placed), facts resolved in the set (indoors never a basement unless said; a stated fact may leave the set, recorded under L14), the camera holding the beat's group, unstaged scenes on the director's line, a scene the script has nobody in cast from the scene digest or, a one-to-four-sentence sliver that carries on, from the scene before. Stand-in trials: scenes 36–43 all play, 2 jumps over 40 m in 76 cards; 17–21 none in 89, no basement ([Decisions](directing/Decisions.md) 6–7) | trial |
| M5 | **Scale and view, and the camera operators**: zoom and angle per beat to the action directors; Jev's pictures, reach and spots sized by the zoom (the 16 m picture, 30 m leap and 100 m spot caps lifted); World · Live following the recommendation | scene 26's tower-to-tower leaps and scene 1's rooftop escape played at their real distances. **Built 2026-11-03**: `scaleBeats` (one work-model request a beat: zoom, metres, angle, from, reach); the arrows picture framed at half the beat's metres (16–400 m), what each arrow meets probed at that scale, the reach the larger of the way's and the beat's (to 600 m), spots looked for to 400 m, the camera's radius and elevation from the zoom and angle. Stand-in trial, scene 26: its traversal beat framed aerial over the towers at 200 m. Real distances wait for Jev's answers ([Decisions](directing/Decisions.md) 8) | trial |
| M6 | **Mega-scene director and journeys**: routes and landmarks on the place graph; the landmark and route questions | scene 3's chase reaches the subway through the alleys; 26 and 34 traversals; L5 and L10 clean on them. **Built 2026-11-03**: `journeysOf` (one work-model request a span where journeys fires: who, from, via, to as place ids or words, manner, distance); the mega-scene director's `megaMove`: a destination that is a placed place (its box) or a building its name labels, else the landmark question (a top-down map at the journey's reach, the twelve tallest buildings lettered); walked or run, to the roof for leaps, flight or a wall, and through the air where the walk graph has no way. Stand-in trials: scene 26 to a 94-floor roof, scene 3 one named, one by landmark ([Decisions](directing/Decisions.md) 10–11) | trial |
| M7 | **Combat director and choreography**: attack kind, shape, outcome, knock-back; the `exchange` record; conditions held | every exchange of 21, 25–31, 40 recorded with its kind and shape; knock-backs played; L13 clean. **Built 2026-11-03**: `exchangesOf` (one work-model request a span where choreography fires: attacker, target, attack, shape, range, outcome, knock-back, breaks, condition); the combat director's `fight()`: Jev asked kind, shape and outcome on a picture at the beat's zoom where the reader is under 0.6 sure; a close attacker closes in, a hit throws the target as told, a dodge steps aside, breaks to the destruction questions; `exchange` and `condition` world-log records, conditions held as proposals. Stand-in trial, scene 31: six exchanges, one asked of Jev, all six moves played ([Decisions](directing/Decisions.md) 12–13) | trial |
| M8 | **Routine director and conversation**: formations, channels (a phone or a door pulls nobody) | L6 below W8's 48 (W9 85); the calls of 12, 29, 33 and the door of 42–43 pull no one. **Built 2026-11-03**: `talkOf` (one work-model request a span where conversation fires: exchanges with their channel, formations, attention); a card's talk kind from the channel first (a phone, a door, a message remote; a loudspeaker public); formations played (beside, facing, across a table, a ring, walking side by side, behind; a door or apart leave them); those talking or in a formation keep their places against the background's drift; L6 no longer breaks on a talk the card knows is remote. Stand-in trials, scenes 11–12 and 17: channels set kinds (one phone call remote), twelve formation moves. L6 itself is measured on a real run's page ([Decisions](directing/Decisions.md) 14) | trial |
| M9 | **Ambience: the crowd as a field**: a particle cloud of the place drawn on the page, its density and flow by beat; named crowds as Organizations (held); the `extra:` walkers gone | no crowd in the people list; crowds visible in 1, 2, 10, 45, still or fleeing as the text says | no |
| M10 | **State directors**: the character director (feelings, intent, bonds, held); transport (items as cleaned since W9, vehicles and weapons, possessions under L15) | items in W10 without body parts or people, none carried past a scene that drops them; feelings held for the review, not applied | trial |
| M11 | **Into the ontology**: the new log kinds, the ledger's proposals, canon's gates for the new targets, the new held kinds in the review and in Pi's CLI and skill | a stand-in run writes every new kind; each undoes; Pi can answer each held kind | no |
| M12 | **Records and cost**: Jev's reported tokens and the work model's usage per faculty and director in the run record and report; firing coverage in the report; the vault notes regenerated and pulled | the W10 report prices itself. **Built 2026-11-03**: a meter for each faculty (scale, journeys, choreography, conversation) beside the digest's and system 2's; Jev's requests and reported tokens by question kind; each stretch of the gate in the run record with what fired there and what each fired faculty found; the leads the findings changed; priced from `stage/director/prices.json` (rates per million tokens) where the workspace has one; a "Faculties and cost" section in the run report | no |
| M13 | **Dress rehearsal, then W10**: the whole volume with the stand-in and the fake work model; the page on iPad; every test; then the paid run against W8 and W9 | the table below filled. **First rehearsal, 2026-11-03** (scenes 1–46, 25 minutes, nothing paid): every scene played with a cast (four slivers from the scene before), 608 cards, 2,194 moves (no basement), 96 beats scaled, 38 journeys (11 through the air), fights read exchange by exchange, the camera 28 jumps over 40 m of which 14 follow a long move and 8 are beat cuts, 5 bounces out and back (W9: 31 jumps, 12 bounces). **Second rehearsal** (after the user's answers: smoothing per strand, referents, physics; 20 minutes): every scene with a cast, 1,468 moves (background drift 611, down from 1,317, now speed times the beat's time), no implied move into a basement, 22 talks remote, 34 formations, camera 24 jumps and 1 bounce; 73 arrivals off-page, since the rule-made frames are mostly a room or a street. The rehearsal is `world-engine/director/rehearsal.mjs` (the stand-in Jev and a work model answering by rule, on a copy of the workspace; its report counts camera jumps, moves by source, basements, journeys, exchanges, talk kinds, laws) | W10 |
| M14 | **Segments, not blocks, and strands, not scenes** (the user, 2026-11-03): the scene tiler cuts further where Jev judges the kind of action changes, as often as the text needs and no more (no fixed size, no "split in two"), each segment typed with the nine block types in the same call; segments replace the 12-sentence blocks for the gate, the beats and the faculties; scenes stay only as building blocks and time markers of strands, and the world engine processes nothing by scene (cast, frame, smoothing moments, presence by card along a strand); what scenes catch and strands miss is fixed in strand extraction | a sample of segments read right against the text; the gate and beats from segments; no scene-level step left in the director, smoother or summarizer. **Wired in, 2026-11-03**: volume 1 tiled into 346 segments (the cut told what stretches are for, smoothed with Jev's own cut probability; 79 Jev requests beyond the tests', [Decisions](directing/Decisions.md)); the gate reads segments (220 beats), fires on their distributions as asked, above the average, with no hysteresis or margin (`FIRING.segment`); a beat's lead follows what its faculties found; long fired spans read in parts, none dropped. Left: the strands, not scenes | yes (tiling) |

Order: M1 → M2 → M3 gate the fired faculties. M4 and M5 rest on always-on faculties and can start beside M2. M6–M9 need
M3 and M5; M10–M12 go alongside; M13 last. The architect (floors, uses, looks) can follow W10.

**Paused for M14 (the user, 2026-11-03):** M9 (the crowd as a field), M10 (state directors, scoped), M11 (into the
ontology), M12 (records and cost), the smoother's cloud fix (A7 item 7, on hold) and W10 wait while M14's segment tiling
is tested; the user asked to come back to them after it. Kept from this round: the faster test cycle (A7 item 8).

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

### A7. The world back-tested: smoothing, referents, physics (the user, 2026-11-03)

The user's answers to [Decisions](directing/Decisions.md) 1–17 turn several rules into one principle: the run is a
back-test, so everything is smoothed with all its evidence, before and after; nothing is a hard-coded distance; and the
world itself (destruction, the city's layout) is part of what is smoothed.

1. **Faculties co-fire** on sufficient evidence; no type holds the world still.
2. **Block types smoothed per strand**: forward-backward over each strand's blocks in story order, across its scenes;
   the beats and the mixed index read the smoothed distributions and their confidence.
3. **Referential distance**: the scale reader names a referent and a multiple (two rooms, the street, three buildings,
   as far as a landmark); the director measures it in the world. Journeys' distances the same.
4. **Distances from physics** ([physics-laws.md](physics-laws.md) §9): presence in the frame (L16), displacement as
   speed times story time (L17).
5. **A controlled test of Jev's picking**: on cases with a known answer, does Jev pick more precisely with vectors drawn
   in the picture, with semantic descriptions, or with small thumbnail references. **Run 2026-11-03** (64 Jev requests,
   `experiments/v2/pick-test.mjs`, [Pick test](directing/Pick-test.md)): words 94%, vectors 63%, plain 56%, thumbnails 50%. Then v1's two-turn height lock (map, then side view; distributions
   multiplied): 81% with pictures alone, height 6/6; the landmark question asks both turns since.
6. **Tunnelling and destruction as a smoothed state** (L18), then **the city in back-propagation** (L19): designed, built
   after W10.
7. **Decision 21 by smoothing** (built 2026-11-03): L1 before L16, the frame a term of the action (S_frame), rehearsals
   smoothed and replayed (`--passes 2`): off-page arrivals 73 to 13. **Next, after the faster test cycle (the user,
   2026-11-03):** 35 scene starts stay outside their frame because a moment's cloud is only the 48 spots nearest where it
   was played; add the frame's own spots to a scene start's cloud.
8. **A faster test cycle first** (the user, 2026-11-03): a rehearsal's time was the walk graph rebuilt whole (about 55%)
   and Chrome reloading a growing page for pictures the stand-in never reads (about 32%); Jev (77 s of W9's 39 minutes)
   and smoothing (under a second a pass) are small. Built, each step checked to play the same run card for card
   (`~/claude-world-first/rehearsals/compare-runs.mjs`), every run's record now carrying its `timing`:
   - a stand-in is shot no pictures and Chrome's page is brought up to date only where the play reads it (a blast's
     spots); a top-down map's frame is computed as the page computes it;
   - a walk graph window is dropped only when a change of the world touches its box (the research handoff's bounded
     repair: the new chunks' ground, the new lots' footprints, a lot's earlier damage), not on every change anywhere;
   - each window's build walks only the chunks its box takes in, each lot's room map is made once, node places are kept.

   | Scenes 1–12, stand-in | Seconds | Graph builds (seconds) | Page reloads (seconds) | Shots (seconds) |
   |---|---|---|---|---|
   | Before | 193 | 231 (90) | 29 (76) | 120 (41) |
   | No pictures for the stand-in | 116 | 231 (74) | 0 | 0 |
   | Cheaper builds | 103 | 231 (61) | 0 | 0 |
   | Windows dropped only where touched | **67** | 84 (27) | 0 | 0 |

   The whole volume, one pass: 7.8 minutes against 17.5 for the committed engine on the same copy, and the same run (46
   scenes, 608 cards, 1,724 moves, no difference; 216 graph builds, 137 seconds). Next for the cycle: the fine
   grid only over the frame and its reach, the city's streets and doors as a transport graph for the rest (the research
   handoff §4); it changes the walks, so it is checked by the laws and the camera, not card for card.

### Order of work (Track A)

1. A1, the card digest, for every action and dialogue card of volume 1: one work-model request per card (cents for the
   volume); shown in Why; every Jev question about the card takes it.
2. A2, the scene digest, heading each scene's card digests.
3. A3, memory, updated card by card and scene by scene, feeding both digests.
4. A director run of volume 1 with A1–A3, against `d20261102081221`.

Still open from the first full run: 21 chosen targets never walked (a door fix and the walk's reason are in since, not
yet run); seven scenes with no record (four where spawning placed nobody: 15, 20, 41, 43).
