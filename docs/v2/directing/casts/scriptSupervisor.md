---
type: "cast"
id: "scriptSupervisor"
aliases: ["Script supervisor"]
status: "built"
fired_by: ["always: each window"]
read_by: ["stage", "routine", "combat", "character", "transport", "architect"]
tags: ["directing/cast", "status/built"]
---
<!-- Written by world-engine/director/directing-vault.mjs from the code; change the code, not this note. -->

# Script supervisor

A summary cast: the work model reading the text. Status: **built** (`world-engine/digest/digest.mjs`). Back to [Directing](../Directing.md).

## What it writes

- stated moves (graded)
- facts, stated and implied
- items
- talk kinds
- breaks

## When it fires

Always: once each window.


## How it is asked

How often: a scene request, then one request a window of about 30 sentences.

### The scene digest

**System**

> You read one scene of a Chinese light novel that is being staged in a 3D city, and summarize it for the people who stage it. Use only the ids given for people. Keep every text field short (under 30 words), in English. Reply with JSON only, in the shape asked.

**Task**

> Summarize this scene for staging.

**Given**

- the scene's sentences, numbered, with their kinds
- the people with ids
- the memory from the scene before

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `summary` | what happens, in order (2-4 sentences) |
| `where` | where the scene plays: indoors or outdoors, the kind of place |
| `continues` | how it follows the scene before: carries straight on \| later the same day \| another day \| elsewhere at the same time \| a flashback |
| `background` | **doing**: what the background is doing: one of standing\|sitting\|lying\|strolling\|walking\|running\|working\|fighting\|riding\|gone, or none; **crowd**: none \| few \| many: people not named who are on stage; **crowdDoing**: what the crowd does, one of standing\|sitting\|lying\|strolling\|walking\|running\|working\|fighting\|riding\|gone |
| `people` | **who**: &lt;person id&gt;; **doing**: their routine through the scene when not acting: one of standing\|sitting\|lying\|strolling\|walking\|running\|working\|fighting\|riding\|gone; **start**: where they are at the start (words); **end**: where they are at the end (words); **holding**: `objects they carry: short names in Chinese as the text calls them; not body parts, clothes worn, or people` |
| `memory` | what the next scene needs to know: who is where, with whom, heading where, carrying what, hurt or not, what is going on (under 80 words) |

### The window digest

**System**

> You read a passage of a Chinese light novel that is being staged in a 3D city, sentence by sentence, and say what each sentence does to the people's positions, the things they carry, and how they talk. List only changes of position; leave out anyone who stays where they are. Be thorough: every verb of motion (走, 跑, 跳, 进, 出, 来, 去, 回, 靠近, 退, 跟, 追, 逃, 爬, 飞, 穿过, 冲) is a move, and so is small motion: a dodge, a step back, closing in, pacing, turning to walk off, wandering down a street. When someone carries, leads or takes another along, give a move for each of them, the one taken along "with" the other. For going elsewhere, say where they end up in "to". Also give what a sentence implies without saying it: rain drumming on the roof above them means indoors; looking down at the street from a window means upstairs, by a window; a door slammed behind them means they just went through it. Items are physical objects someone holds, carries, uses, puts down, throws or breaks: not body parts, clothes being worn, or things only mentioned. Use only the ids given for people and sentences. Reply with JSON only, in the shape asked.

**Task**

> For each sentence of the passage (not the context), list what it does.

**Given**

- the passage and three lines of context either side
- the scene digest
- the people with ids
- the memory

**Answers** (JSON; every entry with its sentence)

| Field | Answers |
|---|---|
| `moves` | **sentence**: &lt;sentence id&gt;; **who**: &lt;person id&gt;; **motion**: step\|nearby\|elsewhere (step: within 2 m; nearby: within about 10 m; elsewhere: further, or into another building, floor, roof); **toward**: &lt;person id they approach, or null&gt;; **away**: &lt;person id or null&gt;; **with**: &lt;person id they go with, or null&gt;; **to**: where they end up, in words, or null; **how**: step\|walk\|run\|leap\|flight\|carried\|vehicle; **basis**: stated \| implied; **sure**: 0..1 |
| `facts` | **sentence**: &lt;sentence id&gt;; **who**: &lt;person id&gt;; **kind**: indoors\|outdoors\|floor\|roof\|underground\|near\|apart\|feature\|vehicle; **value**: floor: ground\|upper\|&lt;number&gt;; near/apart: &lt;person id&gt;; feature: window\|door\|street\|stairs\|wall\|corner\|edge; otherwise null; **basis**: stated \| implied; **sure**: 0..1 |
| `items` | **sentence**: &lt;sentence id&gt;; **item**: short name in Chinese, as the text calls it; **event**: appears\|held\|picked-up\|put-down\|thrown\|given\|broken\|used; **who**: &lt;person id holding or acting on it, or null&gt;; **to**: &lt;person id it is given to, or null&gt;; **size**: metres across (a phone 0.15, a bag 0.4, a sword 1, a car 4) |
| `talk` | **sentence**: &lt;sentence id of a spoken line&gt;; **kind**: live\|group\|remote\|public (live: two face to face; group: several together; remote: phone, radio, a message, a voice from afar; public: an address to a crowd) |
| `breaks` | **sentence**: &lt;sentence id&gt;; **what**: what is destroyed; **sure**: 0..1 |
| `background` | **sentence**: &lt;sentence id&gt;; **who**: &lt;person id, or crowd&gt;; **doing**: standing\|sitting\|lying\|strolling\|walking\|running\|working\|fighting\|riding\|gone |

## Read by

- [Stage manager](../directors/stage.md)
- [Routine director](../directors/routine.md)
- [Combat director](../directors/combat.md)
- [Character director](../directors/character.md)
- [Transport specialist](../directors/transport.md)
- [Architect](../directors/architect.md)
