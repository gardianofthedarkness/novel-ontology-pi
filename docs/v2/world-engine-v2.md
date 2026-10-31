# World engine v2

The world engine is the second version of this CLI: a book is read into a world first (who is where, when, in which
building, above or under the ground), and everything else (dialogue, movement, things, fights, identity) is decided inside
that world. This document is its design going forward. The reader's version, with every feature block built so far, is
[world-engine.html](world-engine.html).

- **Branch:** `v2` on origin. Work lands on it directly, with no pull requests; `main` stays the v1 CLI.
- **Live tests** run from v2 builds (a separate fully built checkout, as before).
- **Earlier designs it builds on:** [world-first-design.md](../world-first-design.md), [underground-design.md](../underground-design.md),
  [stage-simulation-design.md](../stage-simulation-design.md), [places-holo-stage.md](../places-holo-stage.md),
  [city-fill-design.md](../city-fill-design.md).

## 1. The principle: structured input

Jev reads a **state** that can be text, a JSON object or an array. Questions can name parts of it by path, each choice
option can carry its own criterion, and a noul question takes what counts as yes and as no. A request has no limit on its
number of questions, only on its size (64k tokens a request and 32k for the state with one question, Jev 1.14), and
billing is per input token. So the state is paid once a request, however many questions read it.

The rules for every Jev request in v2:

1. **The state is a document.** A JSON object: definitions once (what each kind or option means), items keyed by id (the
   passage's sentences, the place's spots, the candidates, the units), the decision's own part last.
2. **Questions are short and point into it** (`passage.<id>`, `spots`, `candidates.<id>`, `units.<n>`), with a short
   label per option, not its definition repeated.
3. **One request per decision step**, holding every question of that step. Steps that do not depend on each other run at
   once (windows of a block, units of an event, blocks of a book).
4. **Pictures only where the picture is the evidence:** box questions (where a thing stands, where a blast hits, where
   someone starts on a floor, where a group gathers) and the model catalog. What the engine knows as data goes as data.
5. **Chains stay where answers depend on the last one** (event by event inside a scene); fan out where they do not.

Measured on 2026-10-30 (vol 1, Jev 1.14):

| Step | Before | Structured | Notes |
|---|---|---|---|
| Sentence kinds, 300 sentences | 1.1 s, 8 requests (text, definitions in every question) | 0.25 s, 3 requests at once | 86% same kinds; quoted lines now read as spoken, not thought |
| Dialogue exchanges, 300 sentences | 4.1 s, 37 chained requests (start and end selection) | 0.25 s, 3 requests | 14 exchanges both; median 6 → 11 sentences; mostly the same exchanges |
| Movement, 36 events (211 questions per kind) | 22.8 s of Jev on rendered pictures, plus 2–6 s of replay and Chrome reload per event | 4.4 s, no Chrome | confidence in the end spot 0.25 → 0.93 (8 spots); moves agree 91%, way 96% |
| One request per scene (36 events → 4) | — | 0.6 s | far less sure (0.46 against 0.92): the chain of events stays |

A recorded pick of 36 events took 449 s; Jev answered in 28 s of it. The rest was the pick loop replaying the engine from
the line's start and reopening the 3D page in headless Chrome before each event. The long stretch before the first event
question (222 s then) is the line's loads: loading the line in the page is where the world-first engine asks its own
questions (births, meetings, gatherings), one request each on a picture. On vol 1's v2 line (2026-10-30) the first load
asked 232, the model catalog 22 more, and the load after it, with things now drawn as models, asked the 232 again (the
pictures changed, so nothing was reused): about 5 minutes before the first event.

## 2. Extraction (the Digger)

### 2.0 The reading flow (the user's sketch, 2026-10-30) — built

![The user's sketch of the flow](flow-sketch.jpg)

```mermaid
flowchart TD
  book["EPUB → sentences (ids) + pictures anchored on sentence ids"] --> tiling["Scene tiling (Jev, start selection)"]
  book --> kinds["Sentence kinds (Jev, one document a window): spoken / thought / fact / action / environment / narration + carrier turn"]
  book --> listing["Listing (System 2: the work model, structured output: a list of strings a batch)"]
  tiling --> scenes["Scenes: lists of sentence ids"]
  kinds --> cards["Cards: type + first + last id; adjacent sentences of a kind, split where the carrier changes; exchanges and monologues nested over them"]
  listing --> typing["Typing (Jev, one document a batch): person / object, weapon, vehicle / place, building, room / time; proper name or not"]
  typing --> em["Unified EM: time → the calendar; exact proper name → that entity (System 0); else the recommender's best three + their latest facts → Jev (groups in parallel)"]
  cards -- "fact cards" --> em
  em --> scan["Card scan (System 0): which entities each card names"]
  cards --> scan
  scenes --> compose["Each scene's context: its world cards, the scene before's cards of the same kind, the people the recommender expects, the world's view"]
  scan --> compose
  em -- "descriptions of people" --> roles["EM² (Jev, one document a 12 lines, scene by scene): who says or acts, who a line is said to, who each description means here; slots for the unnamed"]
  compose -- "the cast" --> roles
  roles --> world["World engine: world loop (presence, place, time, dialogue), stage steps, the engine"]
  cards -- "thought, fact, narration" --> ontology["Ontology (canon)"]
  em --> ontology
```

Three systems, as in the sketch: **System 0** is string match (sentence and card scans, exact names), **System 1** is Jev
with a composed context, **System 2** is the main model (the work model for listing; the agent for the review pool).

**The flow, step by step** (`src/v2/`, run with `experiments/v2/read.mjs`):
1. **Sentences.** The book's sentences keep their ids (`b<block>_s<n>`); the album's pictures hang on sentence ids. The
   sentence is the smallest unit of everything after: scenes, cards and appearances are lists of sentence ids.
2. **At once:** scene tiling (the mature start-selection tiler); sentence kinds; listing then typing, batch by batch.
3. **Sentence kinds** (`segmentation.ts`): six kinds, `environment` (a place, the weather, what stands around) new beside
   narration; and for every sentence whether its **carrier** changes (who speaks it, who acts in it, or what it is about).
   **Cards** (`kindCards`): adjacent sentences of one kind are one card, `{kind, first, last}`, a new card where the carrier
   changes. Exchanges (a conversation as long as its people stay, its narration and actions inside) and monologues are
   cards over those runs, nested (`inside`). Dialogue, action and environment cards go to the world engine; thought, fact and
   narration to the ontology.
4. **Listing** (`listing.ts`, System 2): 30 sentences a batch to the work model with fixed instructions and a structured
   output, `{"names": [...]}`: every important person, object, weapon, vehicle, place, building, room and time, as the
   passage writes it. A string the passage does not hold word for word is dropped, and so are pronouns.
5. **Typing** (`typing.ts`, System 1): one structured document a batch (the types once, the sentences by id, the strings by
   key with the sentences that hold them); each string chooses a type, and a noul says whether it is a **proper name**.
6. **Unified EM** (`em.ts`), batch by batch in reading order (the chart grows as it reads):
   - a time goes to the times (EM for times is the calendar's, later);
   - a string that is a proper name already in the chart (the whole chart) is that entity, with no model: its sentences are
     recorded as appearances;
   - otherwise the **recommender** scores the chart's entities of its category: nearness of their appearances before it
     (within 80 sentences, nearer counting more), how often they appear, and the names they share; the best three, and the
     latest facts that name them, go to **Jev** in one structured request per group of 16 strings (a batch's groups in
     parallel). Each string chooses a candidate, another new string of the same batch (two names of one person born together
     find each other), or new. Below 0.6 it is new, its best candidate kept for the world engine's second EM.
   - **A description is not a name** (the one change to the sketch, after the first run): typing's proper-name answer
     decides. A proper name joins the chart's names and matches anywhere. A description of a person (少女, 那个刺猬头,
     姐姐大人) is no one's name at all: it goes to EM² (§2.0.1), which says who it means each time it stands. A thing's or a
     place's description (屋顶, 手机) is its name only where EM said it. On the first run the lister's 他 had become 上条当麻's
     alias, which would have tagged every 他 in the book; on the second, 姐姐大人 had become a person of its own.
7. **Card scan** (System 0): every card's sentences scanned for the chart's proper names (a longer name masks the shorter
   inside it), plus the appearances EM recorded; each card lists the entities it names and where.
8. **Context** for each scene: its world cards, the scene before's cards of the same kinds in order, the people the
   recommender expects from the last three scenes, and (at run time) the world's view of who is where.
9. **EM²** (`roles.ts`, §2.0.1): who says or does each line, who a line is said to, and who each description of a person
   means there. Each card's people are then the ones it names and the ones its lines and descriptions point at
   (`people: [{id, how: [named, speaks, acts, addressed, described], at}]`); an event's actors and an exchange's people
   come from them.
10. **Out:** the data and the run's log as YAML (`docs/v2/schema.yaml` is the schema; `<out>/v2/*.yaml`), the world loop's base
   layer (`<out>/base/`), and with `experiments/v2/workspace.mjs` a world-first workspace whose canon is this reading (scenes,
   entities, events from action cards, who takes part), so the stage steps and the engine run on it as they are. Its world
   script (`stage/world/script.json`: each scene's place, who is present, the past, its events) is read off the reading
   too (`src/v2/script.ts`, §2.0.9), so the v1 world loop no longer runs before terrain and the world engine.

**Measured on vol 1, 2026-10-30, before EM²** (5,202 sentences, Jev 1.14, deepseek-chat; a fraction of a dollar in all):

| Step | Requests | Time |
|---|---|---|
| Scene tiling | 224 Jev | 5.4 s |
| Sentence kinds | 56 Jev | 1.6 s |
| Listing | 177 work model | 3.0 s |
| Typing | 177 Jev | 24.8 s (inside the listing loop) |
| EM | 158 Jev | 14.2 s |
| Card scan | — | 0.1 s |
| **The whole reading** | 552 Jev + 160 work model | **42 s wall** |

46 scenes; 227 exchanges, 337 monologues, 450 action cards, 120 environment cards, 183 facts; 2,231 strings, of which 657
matched a proper name exactly, 569 joined an entity through Jev, 632 were new, 120 were times. The chart: 174 people, 318
things, 140 places, 57 times. Then, on the same reading: the world loop (46 scenes, 332 Jev calls, 40 s); scale (140
places), landscape (27), objects (14 work-model calls, 50 objects), building EM (7 buildings), movement (41 scenes, 615
calls, 16 s, 174 moves); one story line of 46 scenes for the engine.

**EM against the old extraction's people** (vol 1's earlier roster, 31 people): 上条当麻 gathers 上条, 当麻, 阿上, 上条先生
and his descriptions where they were said; 御坂美琴 gathers 美琴, 御坂, 御坂同学, 超电磁炮, 第三位; 食蜂操祈 gathers 食蜂, 蜂蜜色少女,
常盘台的女王. Still apart, for the world engine's second EM: 姐姐大人 (where EM met it before 美琴 was a candidate), 禁书目录 and
茵蒂克丝, 最后之作 and 御坂御坂, 一方通行 and 统括理事长. Many more people than before (174 against 31): one-scene descriptions
(小混混, 追击者) are people of their own, and a description EM was unsure of is a new one each time. EM² (below) answers both.

### 2.0.1 EM² — who is this, here (the user's call, 2026-10-30) — built

**Why.** After the first full run, 137 of the 174 people had only descriptions for names (姐姐大人, 少女, 那个刺猬头, 老师), and
the worst was a sink: 姐姐大人 stands in the book's first sentence, before 美琴 is named, so it became a person of its own, and
every later 姐姐大人 joined that person (the recommender ranks a shared name highest). And 1,789 of the 2,419 world sentences
(spoken, action, environment) name no one: their people are 我 and 你 (743 in spoken lines), 他 and 她 (206), or no word at
all. The world engine needs exactly that: who speaks, who acts, who is spoken to. EM answers *which entity is this name*,
once. The new question is *who is this, here*: asked where it stands, because the same words point at different people (少女
is 茵蒂克丝 in one scene and someone else in the next; 姐姐大人 is 美琴 in 白井黑子's lines).

**Two plans were weighed;** the user chose the second:
- A: each vague string (pronoun, description) triggers its own EM, answered per occurrence and never added to the names.
  It misses 我 and 你 and the lines with no word for the person, and a description before any name still has no one to
  point at.
- **B: roles and slots.** Only names enter the chart. Lines and descriptions are resolved against the scene's cast.

**How** (`src/v2/roles.ts`, after the card scan and the contexts; scenes in reading order, a scene's batches in order):
- **Asked:** every spoken and action sentence, and every sentence that holds a description of a person (the descriptions
  typing found, scanned everywhere, a longer name masking the ones inside it: 御坂妹妹 is a name, not 妹妹). 12 asked
  sentences a request; the passage runs from 3 sentences before the first to the last.
- **The cast**, most likely first, at most 16: the people named in the passage, then in the scene, the people already
  placed in the scene, the people a description of the batch has meant before (habits), the world's present people (when
  the engine has them), the scene before's people, the recommender's people; and up to 6 slots of this scene and the one
  before. Each with its other names and its latest fact.
- **The document:** `{task, cast: {id: {name, also, named, fact}}, before: {id: {text, who, to}}, passage: {id: text},
  descriptions: {d1: {text, in, meant}}}`. `before` carries the last answered lines of the previous batch; `meant` is a
  description's habit (御坂美琴 ×5 (in lines of 白井黑子 ×3)).
- **The questions:** `role:who:<id>` (spoken: who says it; action: who acts), `role:to:<id>` (spoken: who it is said to),
  each a choice over the cast, the batch's descriptions (`d1`: whoever it means here), `unnamed` and `none`; `ref:d1` for
  each description, a choice over the cast, `new`, `general` (people in general: 学生 as students at large) and `none`.
- **Answers:** below 0.5 no one is sure (the answer is kept: `answer`, `confidence`). A description that is `new`, or not
  sure, opens a **slot**: an unnamed person of the scene (`slot_<scene>_<n>`), later lines and descriptions can choose it,
  the scene after sees it too. A slot is never anyone's name; the world engine's second EM may join a slot to a person.
  A line that points at a description takes whoever it meant.
- **Habits:** each description that meant a person is counted, with the speaker of the line it stood in; shown with it next
  time (`meant`) and its people put in the cast. A prior, never an exact match.

**Measured on vol 1** (the same reading; tiling, kinds, listing and typing from the cache): EM 154 Jev requests, 17 s; EM²
247 requests, 37 s; 54 s wall, 398 Jev requests paid (the `general` choice cost 244 more on a rerun). The chart now holds
**35 people** (174 before; the old extraction had 31), 318 things, 140 places, 57 times.
- 2,272 lines: 1,561 with a sure speaker or actor; of 1,677 spoken lines, 741 with a sure listener (391 answered no one in
  particular). Unsure answers sit at a median 0.38: often right, but a cast of 16 spreads the odds.
- 692 descriptions where they stand: 401 meant a person, 206 an unnamed one (141 slots), 74 people in general, 11 not a
  person. 姐姐大人 → 御坂美琴 every time (8; three in 白井黑子's lines); 少年 → 上条当麻 37 of 41; 第三位 → 美琴 10 of 10;
  警备员 → 黄泉川爱穗 19 of 24; 克隆人 → 妹妹们 14 of 15; 三色猫 is not a person.
- Read against the text (16 sure answers drawn at random): about 12 right; one wrong person (御坂妹's line given to
  御坂御坂, a name EM split); the rest not decidable from the passage. A wrong one seen in passing: a line whose speaker calls
  themself a Level 0 given to 美琴 at 0.9 (the speaker is 上条).
- Still split, for the second EM: 最后之作 / 御坂御坂 / 最终信号, 茵蒂克丝 / 禁书目录.

### 2.0.2 Facts, the action rule and crowds (the user's notes, 2026-10-30) — built

**Facts are the source of truth for every EM** (`src/v2/facts.ts`). Every fact card is a fact in an ordered ledger
(`fact_000001` …, reading order), so the facts grow as the book does. Who a fact is about: the chart's proper names in it
(rescanned as EM gives people more names, so a fact read before a name was known is found once it is), and the descriptions
EM² resolved in it (`via: description`). Each fact keeps its time (the latest time node at or before it); facts are
ordered by reading order until the calendar places the time nodes, and then a later fact about the same thing (an update)
is ordered by story time. As EM and EM² run, the ledger is asked for the latest facts before the place they decide: for
EM, about each candidate and holding the string itself; for EM², about the first eight of the cast and holding each
description. They go in the document once each, keyed by id, with what they were fetched for (`facts: {fact_000012:
{about: [char_000001, names.n3], text}}`), and the task says to trust them. Each EM result and EM² reference keeps the
fact ids it was given.

**The action rule.** An action is an action or movement by someone or something that matters (a person, a crowd, an
important object, weapon or vehicle, a building or a place), or the story going back in time; something happening in the
background with no one who matters in it is narration. Three places carry it:
- the sentence kinds' definitions say so (action, and narration's "what happens in the background");
- EM² asks of every action who or what acts (the cast, slots, the things and places the passage names, or `time`: the
  story goes back in time), and a noul, whether it matters to the story or is background;
- after EM², an action where nothing acts (`none`, `unnamed`, people in general) or that is background becomes narration
  (`was: action`, and `actor` if something acted); the cards are cut again.
A count of appearances was tried first and dropped: EM had made every cleaning robot of the book one thing, seen in eight
scenes, so the robot passing in scene 1 still counted as important.

**Crowds.** The listing asks for crowds and groups of people who are there; typing has a `crowd` type; a crowd is never a
name (EM keeps it as a description); EM² resolves it where it stands: a person of the cast, a crowd slot (`kind: crowd`),
people in general, or not a person. A crowd can act, be spoken to, and is drawn by the world engine as a group.

**Measured on vol 1** (`~/claude-world-first/v2-vol1-facts`; the listing changed, so everything after the tiling was asked
again: 177 work-model requests, 645 Jev, 87 s; then the matters question, 259 Jev, 43 s):
- Kinds with the new definitions: 425 action cards (450 before), 82 environment (120), 923 narration (841); then the action
  rule turned 31 more actions into narration (the cleaning robot among them). 43 actions have a thing or a place acting.
  No line was answered as going back in time: vol 1 has no flashback the classifier took for an action.
- Facts: 155; 76 are about someone (32 through a description); EM gave facts for 277 of the 878 strings it asked about,
  EM² for 364 of 1,141 descriptions.
- Crowds: 129 crowd slots. 暗部 → a crowd 20 times, people in general 10; 大人 → people in general 21 of 21; 人们 → people in
  general 13, a crowd 4.
- 1,588 of 2,216 lines with a sure speaker or actor; 720 of 1,674 spoken lines with a sure listener (a line is no longer
  said to its own speaker: the next answer is taken).
- 38 people (35 before). New wrong ones from the new listing's typing: 圣诞少女 (舞殿's epithet, typed as a proper name),
  10032号 (御坂妹), 斯芬克斯 (the cat), 停机坪 (a helipad).
- Found: EM for things has the sink EM for people had. A thing's description (机器人, 清扫机器人) is a name only where EM
  said it, but the recommender pulls each new one to the entity that already has it, so every cleaning robot is one thing.
  The same answer as for people fits: a thing's description resolved where it stands, in its scene.

### 2.0.3 Things: only named things, vehicles and weapons (the user's rule, 2026-10-30) — built

The user's answer to the sink above: only important named things, vehicles or weapons count, never everyday things. Vol 1's
chart had 351 things, 283 of them unnamed everyday objects (手机 seen 42 times, the cleaning robots, a plastic bag, bread,
a wall), and only six named objects. Now:
- **typing** has a `routine` type (an everyday thing: a phone, a bag, food, clothes, furniture, a door or a wall, a machine
  at its routine work) with no category, and `object` is an important thing the story names or singles out. The listing
  asks for weapons, vehicles and things with a name of their own, not everyday things.
- **EM**: a thing is an entity only with a name of its own (typing's proper ≥ 0.5): a named object, vehicle or weapon. An
  unnamed vehicle or weapon (那辆车, 手枪) is a description, as a person's is; an unnamed object or an everyday thing is
  `routine`: no entity, never asked, never an actor.
- **EM²** resolves a vehicle's or a weapon's description where it stands: a named one of its type in the passage, an
  unnamed one of the scene or the scene before (a slot, `kind: vehicle | weapon`), vehicles in general, or none. Such a slot
  can act; a spoken line is never said by one. The matters noul and the `none` answer name everyday things as background,
  so an everyday thing acting makes the line narration.
- **The world engine** gets the scene's unnamed vehicles and weapons with its things (an event's `things`, the roster's
  things), apart from the unnamed people and crowds (`extras`).

**Measured on vol 1** (`~/claude-world-first/v2-vol1-things`; the listing and typing changed, so everything after the
tiling was asked again: 177 work-model requests, 602 Jev, 81 s):
- The chart's things went from 351 to 14: 10 named objects (天空之眼, 禁书目录, 圣经 …), 1 named vehicle (锤头鲨), 3 named
  weapons. 145 strings were everyday things (手机, 清扫机器人, 遥控器, 大门, 面包 …), now no entity.
- 40 slots of unnamed vehicles and weapons (20 each: 货车, 救援直升机, VTOL战斗机, 手枪, 暗杀用手枪 …); other descriptions of
  them went to vehicles or weapons in general (无人机, 航母) or to 锤头鲨 (无人追踪车, 警备员的特殊车辆).
- 49 actions became narration (31 before), ten of them holding an everyday thing (the cleaning robot of scene 1, a phone
  showing errors, a door opening). 25 lines have a thing or a place acting (a van, a helicopter, a fighter, a pistol, a
  building), none of them an everyday thing.
- Wrong still: typing took an ability (幻想杀手) and a network (御坂网络) for named objects, and a fist (拳头) for a weapon
  (six slots); a few lines went the wrong way (two people's fists clashing became narration; a TV broadcast was given to the
  fireworks).
- The sentence kinds' definition of an action names everyday things as narration; the run used a longer short label for
  action than the one kept (labels stay under 50 characters).

### 2.0.4 Concepts, and whose they are (the user's call, 2026-10-30) — built, run on vol 1

Typing took an ability (幻想杀手) and a network (御坂网络) for named objects. A concept is now one of the options: an
ability, a power, a technique or a spell, a network or a system, a project or a plan, which someone has, uses or runs. The
listing asks for the concepts the story names; typing has `concept`; EM makes a named concept an entity (`concept_…`, its
own category, its candidates only concepts), and a concept with no name of its own is no entity. A concept can be owned:
for the concepts of a batch with no owner yet, one Jev request asks whose each is (the people the passage names, many
people or a group, or no one's), and a sure answer becomes the concept's owner, kept with the sentence it was said from.
Until an owner is known, the question comes back the next time the concept appears. A fact about a concept is about its
owner too: EM and EM² get it among the owner's facts, and the ledger lists the owner (`via: concept`). EM² shows the
concepts of its passage with their owners as context; a concept never acts, its owner does. Canon has the concepts
(`Concept`) and `OWNS` from the owner; the world base has them in its roster.

### 2.0.5 Story time and the calendar — built, run on vol 1

**Before (2026-10-30, until this was built), in the v2 reading:** a time word is listed, typed `time`, and EM keeps it as a time node keyed by its exact text,
with the sentences it is in. So 早上 in chapter 1 and 早上 in chapter 5 are one node, and nothing reads its value. A fact's
time is the latest time node at or before it, in reading order. EM² can answer that an action line goes back in time (none
did on vol 1). Nothing decides whether a time word sets the scene's time or is only mentioned, nothing makes story periods,
and canon has no time at all, so `novel calendar build` finds nothing to place: the calendar of the v2 vol 1 workspace has
0 periods (and so does the v1 world-first one).

**In the world loop:** the clock counts scenes. Jev says when each scene is against the one before, among the relations
the laws allow (carrying on, later, the same time elsewhere, a flashback, back to the present), and keeps the time words
the scene names as its time node. That is the only story time the engine has.

**What exists from v1** (the time-place faculty and the calendar, never run on these workspaces): the time lexicon reads
a time word's value (a date, a clock time, a part of the day, "the next day", "three years ago"); Jev gives each time word
that could set a scene's time a role (ADVANCE, FLASHBACK, RETURN, REFERENCE); code makes story periods from them (an anchor
until the next one, a flashback stack, story order, a date derived only from stated words); periods become TimePoints with
scenes OCCURS_DURING them; the calendar places every period of a universe on one clock (Year 1 relative; a stated or
derived day, at its clock time or part of the day; an undated period as a range between dated neighbours; a date that
contradicts story order reported, never reordered).

**The proposal** (for approval, then one vol 1 run to check it):
1. Each time word where it stands, with its value from the lexicon, not one node per text.
2. In EM²'s existing request per batch (no extra requests), a `time:` question per time word of the batch: the four
   roles, with the current period, its date, and an open flashback in the document. Flashbacks then come from time words
   too, not only from action lines.
3. The v1 assembly code makes the periods; canon writes TimePoints and OCCURS_DURING; the calendar is built from them, with
   no model.
4. Each fact's time is its period, and the ledger orders facts by story time on the calendar: the latest facts before a
   decision are the latest in the story, a flashback's facts sort into the past, an update comes after what it updates.
5. Checked on vol 1: the periods with their dates and flashbacks, the conflicts, a time strip per scene on the data page,
   and the world loop's "when" answers against the calendar's order.

**Built** (`src/v2/time.ts`, after the user agreed): as proposed, with one change. The roles are not asked inside EM²'s
requests but in a request of their own per scene with time words to ask about (at most one a scene, plus a continuation
question after a flashback scene), run after EM and before EM². This way EM² already gets its facts ranked by story time.
The request is a structured document: the four roles defined once, the story's time so far (the current anchor, its
date, an open flashback), the sentences around each time word, and the words keyed `t1…`. A strong cue is ADVANCE by rule;
a word in a quote or deep in a scene only mentions a time; Jev's answer goes through v1's floors (an unsure move or an
unsure flashback stays a mention). Each scene gets a caption ("Year 1 · 12-24", "the past: 3 years before", "time not
stated"), each fact its period, and the ledger ranks facts by story order. Canon writes TimePoints and OCCURS_DURING, so
`novel calendar build` works on the workspace; the world base carries each scene's time and caption. The data page
shows the caption at each scene and marks each time word with its role.

**Measured on vol 1, concepts and story time together** (`~/claude-world-first/v2-vol1-time`, 2026-10-31 00:37 UTC, a
Saturday; the listing, typing and kinds changed, the tiling came from the cache):
- **Time and price:** 83 s wall (listing 24 s, EM 14 s, story time 2.7 s, EM² 42 s). Jev: 673 paid requests, 7,242,024
  input tokens as TypeSafe reports them (and 2,328,220 output tokens), $0.30 at $0.042 per million input tokens. DeepSeek:
  177 requests, 158,028 prompt tokens (25,344 from its cache) and 11,250 completion tokens, $0.027 off-peak ($0.053 at
  peak). About $0.33 in all; a run from nothing also pays for the 224 tiling requests, a few cents more.
- **Where Jev's tokens go:** the states of the paid requests are 2.3 million characters, but 17.6 million were sent: the
  questions, each repeating its options' hints (EM² repeats the whole cast's), are most of the input. Hints once in the
  state is the largest saving there is (context-engine.md §2, render).
- **Concepts:** 33, 18 with an owner (心理掌握 → 食蜂操祈, 超电磁炮 → 御坂美琴, 幻想杀手 → 上条当麻, 御坂网络 → many, the
  named spells and weapons of 根丘 → 根丘). The chart's things are down to 10; 38 people, still with titles and epithets
  as people of their own (第五位"心理掌握", 圣诞少女, 魔神) and the cat.
- **Story time:** 229 time words: 157 only mentioned without asking (in a quote, or deep in a scene), 68 asked, 4 by rule;
  8 move the story on, 1 flashback. 7 periods (3 dated, 3 derived, 1 in the past); every scene has a caption, three in
  all: Year 1 · 12-24 · late night (scenes 2–14), 12-24 · night (1, 15–34), 12-25 · evening (35–46). One conflict, reported:
  the opening heading's 平安夜 set scene 1 at night before its own "12-24, 00:00". Probably wrong: 傍晚 after 平安夜 rolled
  over to the 25th, because the lexicon reads 平安夜 as the night of the 24th; and the one flashback is a question in a
  thought ("what happened back then?").

### 2.0.6 The time tree, and option meanings once a request (the user's calls, 2026-10-31) — built, run on vol 1

**The time tree** (`timeTree` in `src/v2/time.ts`), as places have theirs: the story, a year, its days (a date, or "day N"
while nothing is dated), a day's parts (a part of the day or a clock time), and the past (flashbacks, by how far back).
The tree walks the present line with a cursor and settles the days of parts of the day itself: one earlier than the last
the story reached that day is the next day, and a late night after an evening is that night past midnight. So a coarse
word and a finer one of the same day are containment (the day 12-24, then its 00:00), not a sequence, and a conflict is
the story going back on the tree without a flashback. With it, three fixes from vol 1: a holiday names its day, not a part
of it (平安夜 is the 24th, and an evening after it is the 24th's evening); a time word in a spoken line or a thought only
mentions a time (the sentence kinds decide, before Jev is asked); a past marker in a question is no flashback. Captions
are the tree's paths; the data page shows the tree. `experiments/v2/time.mjs` reruns story time alone on a reading.
- **Story time alone, again, on the last vol 1 reading:** 15 paid requests, 17,279 input tokens (under $0.001), 1.6 s. No
  conflicts and no false flashback (it was a thought); scene 1 at 12-24 › 00:00 (not the heading's 平安夜), 2–14 late
  night, 15–34 the 24th, 35–46 the 24th's evening (not the 25th's).

**Option meanings once a request** (`src/v2/hints.ts`): a meaning two questions give an option the same way goes into the
state once (`answerOptions`), a shared yes-and-no once (`yesNo`). Run on vol 1 for every step but the tiling (57 s),
against the last reading (`experiments/v2/compare.mjs`; the listing came from the same cache, so the same strings):
- **Price:** Jev 7,242,024 → 5,951,354 input tokens, $0.304 → $0.250 (−18%). By step (Jev reports each request's tokens,
  and the steps run one after another): kinds and typing 2.73 M → 1.96 M (−28%), EM² 3.83 M → 3.60 M on the same inputs
  (−6%; a choice option with no meaning is sent with its id as its meaning, so `char_000001` twice instead of the id and
  a short name: the ids are what costs in EM²). DeepSeek $0 (the listing came from the cache; $0.027 fresh, off-peak).
- **Precision, judged by hand** on the disagreements (agreement is not precision; the samples are small):
  - *Typing* (92.7% the same types): of 10 disagreements that could be judged, the old way was right in all 10. With the
    meanings out of the questions, Jev typed descriptions of people as none of the types (少女, 老师, 少年, 魔术师); EM's
    descriptions fell from 686 to 605 and its skipped strings rose from 259 to 348.
  - *Sentence kinds* (91.8% the same): 6 to 5 for the old way, with no pattern: no worse.
  - *EM², on the same inputs* (81.5% the same speakers or actors, 76.6% listeners, 87% descriptions; sure answers 69.8% and
    69.4%): most differences are between two unsure answers; where both were sure and differed (29 of 2,144 lines), 11 of
    the 14 that could be judged were right the old way (in 4 batches), 3 the new way (in 3 batches).
- **So** (the user's call): the saving is not worth the correctness. Every step sends the meanings in each question again,
  as before (`HINTS_ONCE_STEPS` is empty; `V2_HINTS=once` turns it on for a comparison). The saving that is left in EM² is the ids: short keys for the cast's options (p1, p2 … in the state, the
  name still with each option) would cut what EM² sends without taking the names out of the questions.

### 2.0.7 Terrain and spawns before the world plays (the user's call, 2026-10-31) — built

After the whole extraction and the world script (which says where each scene happens: the v1 world loop's then, the
reading's own since §2.0.9), `novel sim terrain`
(`playground/terrain.mjs`), recorded on the host's live page:
1. **Terrain.** The book's main sites (the places its scenes happen in), in story order of their first scene, each placed
   by Jev in the place that holds it on the place tree, on a picture of that place from above: its ground (the
   landscape the engine fills, the manifold), the sites placed so far by name, and boxes O (over the middle) and A–H
   (round the edge); then whether the box fits, and a better box if not. Evidence: the sentences that name the site and its
   scenes' environment cards. Kept in `stage/terrain.json`; the engine bears each site toward where Jev put it (before,
   toward the sibling it had the most travel with), and its canvas keeps sites clear of one another as before.
2. **Spawns: carry on, or start anew.** Scene by scene against the scene before: by rule where the time tree and the world
   loop say it (into or out of the past, or a different node of the time tree: anew; the same place and time node,
   carrying on, the same chapter: carries on); asked of Jev, eight scenes a request, where they do not, with both scenes'
   places, times, environment cards, the scene before's end and this scene's opening, and who is still there. Kept in
   `stage/world/spawn.json`. In a scene that starts anew the engine asks a fresh start (the level, then a box on the map)
   for everyone present, and places them there instead of walking them from where they were hours before; every start
   question now carries the scene's environment and who is already placed, how far and which way from the middle of the
   map (the red dots).

### 2.0.8 Places in EM and EM², and the place tree from the reading (the user's call, 2026-10-31) — built, run on vol 1

**The check first** (vol 1's reading before this, no requests): of 107 places below a city, a name inside a name or the
text naming the larger right before gave 12 parents, places named together in environment and fact cards 8 weak ones, and
87 nothing; and 115 of the chart's 128 places were descriptions EM had kept as places (大楼, 街上, 便利店, even 墙壁), with
the sink people and things had (五层建筑的屋顶 gathering 楼顶 and 屋顶). So the place tree has to start in EM and EM².

**Built:** EM keeps only named places. EM² settles every place description where it stands, with the scene's environment
cards as its setting: a named place of the passage, the scene or the scene before, or an unnamed place of the scene (a
slot of kind place, building or room), and which named place holds it (`within:`). `src/v2/places.ts` makes the tree: a
named place's parent from a name inside its name, the text naming the larger right before it, EM²'s answers, and Jev once
(`tree:`) for the rest; never a loop. Canon writes PART_OF, which the stage's place tree and the engine's central build read.

**Measured on vol 1** (`~/claude-world-first/v2-vol1-places`; 303 paid Jev requests, 4.50 M input tokens, $0.19):
- 13 named places (128 before). The tree: 东京西部的学园都市 ⊂ 东京都 ⊂ 日本; 学园都市第七学区 (by its name), 第十五学区 and
  第六学区 ⊂ 学园都市; 纽约 ⊂ 合众国. Not placed: 常盘台中学, 飞镖酒吧, 豚草不动产写字楼, 魔道书图书馆 (the text does not say).
- 418 place descriptions: 43 meant a named place (城市 → 学园都市 22 times, 学校 → 常盘台中学 5), 293 an unnamed place of
  their scene (165 places, 95 of them held by a named place: 58 by 学园都市, 24 by 第十五学区, 8 by 第七学区), 64 places in
  general (学校, 建筑物, 医院), 18 not a place (墙壁, 天花板).
- 36 of the 46 scenes have a place anchored in the tree (named, or an unnamed one a named place holds).
- Wrong: a part of a place taken for the place itself (走廊, 宿舍 → 常盘台中学; 紧急出口, 办公室 → 飞镖酒吧) where it should be
  an unnamed place inside it; 70 unnamed places held by nothing.

`experiments/v2/inspect.mjs` makes one private page of a reading: each scene's text tiled into its cards and coloured by
kind, the names, descriptions and times marked where they stand, each line's people, and under any sentence every record
it is part of (the book's text is in it: never public).

### 2.0.9 The world script from the reading (the user's call, 2026-10-31) — built

Terrain is the first step after extraction, before any world loop. But the engine built its world from the v1 world-first
loop's script (the main agent deciding presence, place, time and dialogue batch by batch), so a v2 workspace could not
reach terrain without running that loop first. The reading decides all of it already, so `src/v2/script.ts` reads the
script off it, with no model call, and `experiments/v2/workspace.mjs` writes it with the canon (`--script` writes it
again into a workspace made from that reading):
- **place:** where the scene is set: the deepest named place its environment cards name, else the place its action cards
  name most, else any it names most (but talk of a place that holds the last scene's place keeps that one: a school or a
  country named in passing is not where a scene is); then the deepest place under it set in an environment card or named
  twice; an unnamed building or room an environment card names (an EM² slot) is more specific still, under the place
  that holds it (rooms are the smallest unit; big unnamed places are left to the world engine, placed live). A scene that
  names none goes on where the last one was, unless it is in the past or the time tree says it does not go on.
- **present:** who speaks, acts or is spoken to in its cards; **firstSeen:** present for the first time (where births are);
  **clock:** null in the past, else its story-time span; **timeline:** its events; **context:** its environment cards.
- **scales:** a named building or room by its type, any other place by its name; the stage takes them where Jev's scale
  step has not answered (or has not run), so terrain finds the cities and their districts before any paid stage step.

On vol 1 (the places reading, 46 scenes): 2 placed by their environment, 4 by their action cards, 24 by what they name, 8
in an unnamed room or building, 8 carried on; none left without a place. Most scenes are in 东京西部的学园都市 itself:
the reading names few places finer than the city. 41 scenes are staged (5 have no events).

### 2.0.10 Scale in EM, spatial words, and sampling in the engine (the user's calls, 2026-10-31) — built

(The frame this belongs to, places as spacetime and matter as movables tied by spatial relations, with the layers that
read a book into it and place EM replacing EM²'s place questions, is [world-model.md](world-model.md).)

The tree of places drawn from EM and EM² alone showed what was not done: 58 unnamed places held by the city itself, each
given a stand-in district of its own by the canvas (a city of 58 districts); 地面, 地下, 街上, 马路上 as places; buildings
the tree put nowhere; 70 unnamed places held by nothing, and so never drawn.
- **Scale is EM's.** Typing says a place's scale where it reads the name: region, city, district, street, building or
  room (the open "place" type is gone); no stage step asks it again for a v2 book. The place tree (`places.ts`) checks it:
  a place its type and name say nothing of is a step above the largest place it holds (日本 holding 东京都: a region),
  and a parent no larger than an open place it holds is raised (东京都, a city holding 东京西部的学园都市: a region). Jev's
  tree question offers only larger places. The world engine keeps what is not in the text: how big, what ground, where in
  its parent (terrain, the canvas).
- **Spatial words are no places.** Typing has a spatial type (on the ground, underground, on the street, on a roof, in a
  corridor, at an exit, in the air): no entity, no EM² slot, kept as evidence (`spatial.ts`, `spatial.yaml`): each tied,
  with no model call, to who or what acts or speaks in its line (EM²'s role, else its card), with the level of the world it
  points at (underground, street, inside, roof, wall, sky). The world script carries them per scene; the world engine
  gives them to Jev at run time with the sentence. Rooms stay rooms, the smallest unit; parts of a building (a roof, a
  corridor, an exit) are spatial.
- **Sampling keeps the city bounded.** A building or room the tree puts only in a city goes into an area already there
  at the next larger scale (a street, else a district), picked by a seed, as a place the tree puts nowhere dwells (the
  canvas's `holderFor`; a stand-in only when the city has no area at all). Every EM² place is on the canvas: in what EM²
  said holds it, else its scene's named place; big unnamed places as street-sized markers, not ground. What is placed by
  sampling (a dwelling, a seed's pick, a scene's guess) is drawn gold and blinks in the live view until the text or Jev
  places it; Jev's stills hold it still (a picture must not change with the moment it is taken). Places no scene is set
  in are markers only (unbuilt): off the walking lattice and the subway's stops.
On vol 1's places reading, with the old types (before the rerun): no stand-in areas (58 before), 东京西部的学园都市 about
1 km across (3 km before), all 165 EM² places on the canvas, 130 of them sampled into the three districts.
- **A named building the tree puts nowhere** is sampled first where its scenes are set (the named area its scenes are
  in most: the script's `near`, the stage's proposed parent), not anywhere in the build: 常盘台中学 had dwelt in a London
  district sampled into 纽约. A district or a city the tree puts nowhere still dwells by step 3 (being talked of somewhere
  is not being there).

**Rerun on vol 1 (2026-10-31, `~/claude-world-first/v2-vol1-scales`, cache from the places reading):** 52 s, 526 Jev
requests (5.87 M input tokens: $0.25 at $0.042/M), no work-model request (the listing reused); then one request more for
the tree once regions could hold regions. Every named place's scale came from typing (14: 4 regions, 2 cities, 4
districts, 4 buildings; 纽约 a city, 东京都 a region, as Jev's old scale step said). The tree: 日本 › 东京都 ›
东京西部的学园都市 › 第七, 第十五, 第六学区; 合众国 › 纽约; the buildings and 英国清教第零圣堂区 with no parent (the text never
says). EM² found 106 unnamed places (165 before): 地面, 地下, 屋顶, 楼顶, 最上层, 走廊, 出口 are spatial now (34 mentions of 23
words, 21 tied to who is there, most with a level); 马路上 and 街上 were still typed as streets. The engine from it: no
stand-in area, 学园都市 931 m across, 100 markers, 93 places sampled (gold, blinking).

### 2.0.11 Sampling pools (the user's design, 2026-10-31)

Sampling (§2.0.10) put what the tree held only in a city into one of the city's districts picked by a seed, at the
smallest boundary that fits: true random sampling. A pool replaces it:
- **Every nominated area has a pool**: a region a pool city, a city a pool district, a district a pool street (named
  `<area> · pool`, id `pool:<area>`). A nominated street is the last level of areas: it holds its own. The pool is the
  area's backup, sampled by default: its terrain is the average of the places of its own level in the area (§2.0.12;
  first built as the area's own terrain, which the user corrected).
- **What is not nominated goes into the pool.** Every place the text mentions in an area without a name of its own (place
  EM's unnamed places held there), and every named building or room the tree puts nowhere, stands in that area's pool,
  not in a named sibling picked at random. A pool is a sampling area, not a place of the text: it may hold places of its
  own scale (an alley in 第七学区's pool street), as a region may hold a region.
- **Apart, and growing.** Members of a pool stand at least a spacing from each other (40 m between street-sized ones, 20 m
  between buildings); when the pool is too small it grows (the canvas's own growth: a circle holds what is in it, and
  pushes its siblings aside).
- **Even chances.** Where a thing could be in several areas (a named building whose scenes are set in more than one), the
  pools of those areas are even chances, picked by a seed, once: a pick is kept.
- **Permanent, across the books of one universe.** The pools live in the universe's registry
  (`<library>/universe/pools.json`, the library a series' volumes are imported into): a pool once made is never dropped,
  keyed by its area's name, with its members by book in the order they were placed. A later book's members are placed
  after the earlier ones' (which never move); a book stands the other books' members as markers.
- **Terrain reaches the street level.** A pool is a part of its level for terrain: a pool district among the districts, a
  pool street among the streets, so the loop always has a street level. A pool is not asked: its terrain is its default,
  proposed at the spot the engine sampled for it and kept on the user's step (`by: "pool"`), last in its level
  (§2.0.12). Jev builds on top of the sampling: every map shows the pools and what stands in them.

Built (`src/v2/pools.ts`, the canvas's `poolOf`/`POOL_SPACING`, `experiments/v2/workspace.mjs --script`). Vol 1's tree
rebuilt (2026-10-31): 9 pools, 91 places in them, the registry at `~/claude-world-first/v2-host-state-7/universe/pools.json`.
学园都市's pool district holds 81 (42 buildings, 16 streets, 23 rooms the text puts only in the city); 第六学区's pool
street 6, 第七学区's 3 (an alley among them); 合众国's pool city an unnamed city; the pools of 纽约, 第十五学区, 东京都 and
the others stand empty, ready. Terrain on it (stand-in answers, no paid call): 2 cities, then 5 districts (第七学区,
学园都市's pool, 第六学区, 第十五学区, 纽约's pool), then 3 streets (the three districts' pools): 10 parts, Jev asked about
the 5 named ones only.

### 2.0.12 Pools refined: same-level defaults, members as real places, street types, borrowing (the user's design, 2026-10-31)

The first run on pools (§2.0.11) built no street: vol 1 names none, the three pool streets copied their districts' CBD
ground, and the 18 unnamed streets in the pools stood as markers. The user's corrections, in the order they are built:

1. **No ground level, anywhere.** The ground is at 0, period: no site, shape or proposal keeps a `y`, no question
   speaks of the ground's height, and every terrain run starts its own live record (the old runs' "at what height is
   its ground" questions no longer show beside the new ones; they are kept in an archive folder).
2. **A pool copies its own level.** A pool's default is not its area's terrain but the average of the areas at its own
   level inside that area, since every level has its own kinds: a pool district copies the city's districts, a pool
   street the district's streets. The average is the most common kind and the mean of their medians (with that kind's
   manifold). With no area of its level decided yet, the pool stays empty: no default ground, no default buildings.
   So a pool is settled last in its level, after the places of that level.
3. **What a pool holds is a real place.** A place put in a pool has a belonging and a full tree (学园都市 › 学园都市 ·
   pool › 站前广场), so it is a real place, and Jev processes it at its level like a named one: an unnamed street in a
   pool is a street part (its kind and median; its spot is the one sampling gave it in the pool), an unnamed district
   in a city's pool a district part. Its evidence is its own sentences and the terrain kept for the places holding it.
4. **Street types.** The street level gets its own kinds, each with its manifold and the engine landscape it is built
   with: a shopping street, a modern commercial centre, an avenue, a square, a station front, an alley, a residential
   street, a waterfront or a bridge, a park, a stadium (§ table below). A crossing is a square; an underground passage
   is spatial, not a street.
5. **Borrowing.** A pool's default ground is there to be borrowed: a member Jev decides borrows the part of its pool's
   default buildings where it stands and turns it into its own kind (a patch of the pool's ground with its kind, median
   and manifold; the default fill gives way there). As the city fill borrows lots for a named building and a road for a
   named street (`cityFill.ts`), a pool's member borrows ground. An already decided member can be borrowed again only by
   a mention with exactly the same name (the same string, in the same pool). Two of the same name whose kind and median
   are the same stay one place; when they differ, the later merges into the original: the original keeps its place and
   gains the later's kind as a further patch, and where both are modern the landscape engine's own merge of height
   manifolds keeps the modern features of both.

| Street kind | What it is | Built with | Manifold (gradient, spread, tail) |
|---|---|---|---|
| shopping | a shopping street: shops of a few storeys on both sides, signs, a tower at a corner | commercial | 0, 0.35, 0.05 |
| centre | a modern commercial centre: a mall podium, towers over it, a plaza with screens | commercial | 0.4, 0.6, 0.1 |
| avenue | an avenue: a wide road lined with offices and towers | skyscrapers | 0.1, 0.5, 0.08 |
| square | a square or a crossing: open ground with buildings round it | commercial | 0, 0.3, 0.03 |
| station | a station front: the station, a plaza, bus stops, shops round it | commercial | 0.3, 0.4, 0.05 |
| alley | an alley or a lane: narrow, low and dense | residential | 0, 0.2 |
| residential | a residential street: flats and houses along it | residential | 0, 0.25, 0.02 |
| waterfront | a waterfront or a bridge: water, a deck, warehouses and walks by it | harbour | 0, 0.3 |
| park | a park or an amusement park: lawns, rides, pavilions | park | 0, 0.4, 0.02 |
| stadium | a stadium or a sports ground | stadium | 0, 0.2 |

**Built (2026-10-31; commits 75614c5 for step 1, dd806c8 for steps 2 to 5).** Terrain spawning keeps no `y` and starts
a live record of its own (the old one archived in `stage/simulation/live-archive/`); the terrain modes carry the street
kinds, a member's own sentences (`own`: place EM's sentences for the unnamed place) and no box question for a sampled
member; terrain spawning queues every pool's member at an area's level by its scene, settles each level's pools last
with the average of their level (or empty), and keeps a member's site with no box (`member`); the engine gives a pool
its own default only, builds each decided member's patch where it stands in the pool (`borrowed`: claiming lots before
the default, `claimOrder` in `landscape.ts`), and stands a later member of the same name on the first, merging a
different kind or median in as a further patch. On vol 1, with stand-in answers (no paid call): 28 parts (2 cities, 5
districts, 21 streets); 学园都市's pool district the average of its three districts, 纽约's empty; the 18 unnamed
streets asked as streets; 第七学区's pool street the average of its streets, 第十五学区's empty; 14 members borrowed
their pool's ground and 3 merged (the four 大道 and two 广场 of different scenes).

### 2.0.13 Street areas: Jev's box, street manifolds, and building into what is there (the user's design, 2026-10-31)

The first real run on pools (2026-10-31, vol 1, stopped at 27 of 28 parts when the user asked for these changes; only the
empty pool street of 第十五学区 was left): 学园都市 and 纽约 metropolises at a 15 m median; 第七学区 and 第六学区 CBDs at
50 m, 第十五学区 at 80 m; 学园都市's pool district their average (a CBD at 60 m), 纽约's empty; the 18 unnamed streets typed
by Jev; 第七学区's pool street an alley at 5 m and 第六学区's an avenue at 35 m, the averages of their streets. Jev typed the streets well (小巷 an alley at 5 m, 站前广场 a station front at 25 m, 大桥 a
waterfront, the 大道 avenues at 50 m, 平台 and 停机坪 platforms), but every street area had the same size: its marker a
30 m circle, its borrowed ground a 120 m square, fixed by its level, only its spot sampled. The user's next steps:

1. **Jev boxes a street area** (built). A member of a pool is asked, between its kind and its height, where it lies and
   how large it is: one box on a map of its pool, close up (its pool in blue, where sampling put it in grey, the boxes of
   the members already kept in white), with what the text says of it and of the places holding it. A box out of a
   street's sizes (40 to 400 m), or over another member that is not of the same name, is asked again closer up. The site
   keeps the box; the engine builds the member's borrowed ground on it and stands its marker at its middle (a later
   member of the same name still stands on the first, §2.0.12).
The user (2026-10-31): steps 2 and 3 are modelling, to fine-tune and polish without a design check from them.

2. **Street manifolds** (next). The street kinds are built today with district landscapes (a shopping
   street as a commercial blob, an avenue as a skyscraper blob). Each needs its own 3D build: a frontage along a line
   (shopping, avenue, residential, alley), a podium with towers over it (centre), open ground ringed by buildings
   (square, station front), a deck by the water (waterfront).
3. **Building into what is there** (next). A street area lands on ground its district or city has already
   built. Modern cities build things into each other (a commercial centre in the base of a tower), so the street is not
   simply laid over: what it overlaps is rearranged. A first proposal, to settle: a podium kind (centre, station, shopping)
   takes the lower floors of the towers it overlaps and keeps them above; an open kind (square, park, waterfront) clears
   its ground; a low kind (alley, residential) replaces what it overlaps with its own fabric; a linear kind (avenue,
   shopping) cuts its own road through the blocks, which split along it.
1. **(built in order)** 1, then 2, then 3, each checked on vol 1 with stand-in answers before a run with Jev.

### 2.1 Sentence kinds — built
Every sentence is spoken, thought, fact, action or narration, and for each, whether the people in a conversation change
there (`dlg_kind`, `dlg_turn`). One structured document per 100 sentences (the kinds defined once, the sentences keyed by
id, the 8 before as context), windows asked at once. From the kinds:
- a **dialogue exchange** runs as long as the same people talk, narration and actions between the lines inside it; it
  ends where the people change or after 8 sentences with no one speaking;
- a **monologue** is a run of thought (two asides allowed): a card of its own, its member the one thinking;
- **facts** (background knowledge of the world) go to the changeset's `faculty:facts` note, the base layer's
  `facts.json`, and every later scene's context.

Why sentence kinds came back after 2026-10-22: the retired design joined a sentence to the one before only when it
continued the same speaker's turn with no narration between, so it found turns (median one sentence). The new stitch keeps
an exchange open through narration and replies.

### 2.2 Events as actions and movements — built
The scene prompt asks for what a person does or what physically happens: who goes where and how (walks, runs, climbs,
jumps, falls, flies, enters, leaves, goes up or down, carries someone, fights, strikes, breaks something), saying where
they go when the text does. Speech and thought are no longer events: they are exchanges and monologues.

### 2.3 Things that move — proposed (new)
Vehicles, mechs and other nominated objects become movable things: the objects step lists them per scene with their kind
(vehicle, mech, carried object), they enter the roster beside the characters, and they can join a unit (§4).

### 2.4 Scene tiling — candidate
The same pattern could tile scenes (a noul per sentence: does a new scene start here, in one document per window). The
2026-10-22 note says per-sentence scene starts fragmented scenes; a stitch rule (a start needs a change of place, time or
viewpoint, and a minimum length) must be tested on vol 1 before it replaces start selection.

## 3. The world loop

Built: scene by scene, Jev says who is there and where, and when against the scene before; the world keeps its laws
(nobody vanishes, nobody is in two places at once, a flashback moves nobody now), adds or flags event actors, settles
dialogue nodes (live, group, remote, public), and sends what is unsure to the review pool (Pi). v2 changes:
- **The composed context becomes a document:** `{ world: {person: {at, since}}, facts: [...], story: [...], scene: {...},
  focus: {...} }`, trimmed the same way when over budget.
- **Presence and time in one request** where possible: the time questions for each place option asked at once
  (speculative fan-out), the one for the chosen place kept.
- **Building EM batched per scene:** every building mention of a scene in one request, the book's named buildings in the
  state once by id.

## 4. Movement: units, ways, destinations (the user's design)

Per event, in story order (the chain stays):

1. **Units.** One request: for each person (and each movable thing in the scene), does it move, and who or what it moves
   with as one unit (carrying or carried, dragged, holding on, riding together; chasing or following is not together).
   The units are the joined groups. A unit of one is a person on their own.
2. **Way.** Per unit: which way it goes (up, down, same level, out of the building, into the building; for people with
   powers, the direct directions).
3. **Destination.** Per unit, all at once:
   - a **choice over the place's spots** on the structured state (the place, its spots by id with what each is, where each
     unit stands now, the scene's text, the events so far, this event) when the destination is one of the spots;
   - a **box on that unit's own picture** (its floor slice, its level underground, the map around it) when the
     destination is a room, a roof or a place the spots do not name. A box needs a picture and each unit's picture
     differs, so each such unit is its own request, sent in parallel.
4. **The engine plays the event** with those answers (one destination per unit; its members end beside each other), and
   the world as it stands (each person's spot, from the engine's nodes) is the next event's `now`.

What changes in the pick loop: no Chrome reload and no full-line replay per event for movement. Pictures are drawn only
for box destinations, things and fights. The engine plays forward event by event instead of replaying from the start.

Measured (36 recorded events, 211 person slots): 12 movers in 11 units, 10 with more than one member; the units question
took 3.5 s in all, destinations 0.9 s as parallel requests per unit and 1.0 s as one request. Right: she grabs 食蜂 and
jumps to the rooftop (one unit, one destination); 上条 carrying the girl across the plaza. Wrong: a unit kept after one
member leaves the other behind; a person paired with another name of herself (an EM miss). So: ask the pair question
with criteria for leaving, and settle identities before units.

Today's state: the v1 movement faculty (`novel stage movement`) asks pairs per event and the engine joins them into
groups with a leader; the live picker (`novel sim pick`) does not ask pairs, and treats two people the event names going
to the same spot as together.

## 5. Identity (EM)

Five matchers today: universal EM at birth (per block, the recommender's candidates), universal EM after apply (pairs:
same and distinct), world identity (`identity.mjs`: confident matches merged unless the world has them in two places at
once; epithets), traces alike (two people whose scenes run alike, at a chapter's end), and building EM (`buildings.mjs`).
v2 makes each a structured request:
- **Candidates once, by id:** `{ candidates: {id: {names, where, passages}}, passages: {scene: text}, names: {key: {name,
  aliases, scene}} }`; each name's question is a choice over candidate ids plus `NEW_PERSON`. Descriptions are no longer
  repeated per question, so more candidates fit (beyond today's 12).
- **One request per block** (every scene's names together) instead of one per scene; blocks in parallel.
- **Pairs as a document** (`pairs: [{a, b}]`, each side's dossier once), same and distinct per pair.
- **Units ask after identities**, so one person under two names never makes a unit with herself.

## 6. Live, host and Pi
- The live page shows each request's exact state (a structured state as its JSON) and pictures, folded on the world page.
- `novel sim pick` asks movement on structured states (pictures only for boxes); `novel sim run --pace` plays it.
- Pi runs the commands the guard allows (`sim pick --max-calls ≤ 60`, `sim run --pace 0.5–5`), from v2 builds.

## 7. Order of work
0. **Done 2026-10-30:** the reading flow of the sketch (§2.0), on vol 1 end to end into the engine; the model catalog in one
   request per theme (21 things: 0.42 s, 17 of 21 the same as one request each); the stretch before the first event
   explained (the line's loads, above). Then EM² (§2.0.1): roles and slots, on vol 1 (35 people; 1,561 of 2,272 lines
   with a sure speaker or actor), and the reading's data page. Then the fact ledger as the evidence of both EMs, the action
   rule, and crowds (§2.0.2). Then things: only named things, vehicles and weapons (§2.0.3). Then concepts and their
   owners (§2.0.4, not run yet); the calendar's proposal (§2.0.5) and the context composing engine's design
   ([context-engine.md](context-engine.md)), both for approval. Not yet run through the world engine.
0a. **Built 2026-10-31 (§2.0.7), after the full extraction run (the user, 2026-10-31):** extraction runs to the end first, then the world
   engine (later text changes earlier results; not in parallel). With every environment extracted, a Jev miniloop and its
   visual harness first arrange the terrain: the vol's existing main sites modified with the probabilistic manifold
   ([city-fill-design.md](../city-fill-design.md)), and from each environment and the blocks around it, with the characters
   in them, where the characters spawn. Then the world loop, per strand ([context-engine.md](context-engine.md) §9).
0b. **Next (the user, 2026-10-31): the visual context engine, debugging by display, the user's own camera, and terrain
   spawning on it** ([visual-context-engine.md](visual-context-engine.md)); the world engine's run is redesigned after,
   for the new extraction. The order for a book: the reading → its workspace and world script (§2.0.9, no model calls)
   → scales and landscapes (Jev, cheap) → terrain → the world engine, per strand, with births where people are first seen.
1. Movement on structured states in the pick loop (each person's spot now from the engine); births and meetings of the
   line's load as structured requests too (one per scene, not one per person on a picture), and kept across the reload
   after models.
2. Units of people, ways and per-unit destinations (spots by choice, boxes for rooms, roofs and underground).
3. Identity as structured requests (at birth and universal); identities before units.
4. Movable things (vehicles, mechs, nominated objects) in the objects step, the roster and units.
5. The world loop's context as a document; presence and time in one request; building EM per scene.
6. Scene tiling test with a stitch rule.
7. The engine playing forward without replays.

## 8. Open questions
- When a destination is a spot choice and when a box: by the unit's way (a floor, a roof, underground → box), or always
  ask both and keep the surer?
- The way's vocabulary: the five ways, or the fourteen cube directions the v1 movement faculty had.
- Jev reads Chinese less well than English (its docs say so): keep confidence gates, and the review pool for what falls
  under them.
