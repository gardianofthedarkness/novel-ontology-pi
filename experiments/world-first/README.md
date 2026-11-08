# World-first extraction (experiment)

Extraction and the world model run together. First, the faculties that need no review give a book's basic layer:
- its scenes, their text and events;
- who takes part in each event;
- the roster of every character and place it names.

Then the world takes over, scene by scene in reading order. Jev reads each scene in its composed context and says who is in it, where it takes place, and when it happens against the scene before. The world keeps what the text can't break, so no reviewer is needed for presence, place or time: the engine holds the laws an agent may not.

## The laws (world.mjs)

- **Nobody vanishes.** Not being detected never removes anyone. A person stays where they were last placed until a later scene places them elsewhere; the trip between is logged. When a scene carries straight on in the same place, people from the scene before who aren't mentioned are still there (`stayed`).
- **Nobody is in two places at once.** A scene can't be at the same time as another stretch of the clock if it shares someone with a scene at another place in that stretch. So a scene that has someone from the scene before can only come after it, or be a flashback. The time question offers only the relations the law allows.
- **A flashback is the past.** It logs what people did then and moves nobody now. The scenes after it stay in the past (carrying on, or later in it) until one goes back to the main time, which picks up after the last scene before the flashback.
- **Without text, nothing changes.** A fragment scene (a stray line the scene splitter cut off) carries the scene before on, without any calls.

The clock counts scenes, not hours. A time the text names (a date, an hour, "the next morning") is kept as the scene's time node, and every person's log carries both.

## Context composition (compose.mjs)

Every decision gets the same shape, within about 10,000 characters:
- the world as it stands (who is where, since which scene and time);
- the story so far (the latest scenes, newest last);
- the scene's own full text;
- the decision's focus.

Over budget, the oldest story goes first, then the least recently placed people, then the middle of a very long scene. The scene's start and the question itself are never cut.

## Running it

```
npm run build
node experiments/world-first/base.mjs <novel-dir> <out-dir>        # the review-free layer, into <out>/base
JEV_MODEL=jev-1.14.0 node experiments/world-first/run.mjs <out-dir> [--chapters 0-5] [--max-calls 200]
node experiments/world-first/compare.mjs <out-dir> <old-novel-dir>  # against the old extraction
node --test experiments/world-first/world-first.test.mjs
```

Each scene takes two Jev calls:
1. Who of the candidates is there, and where. Candidates are the people the text names, the people its events have taking part, and whoever was in the scene before.
2. When, among the relations the laws allow; the time the text names, if any; and each present person's spot.

Answers are cached under `<out>/cache`, so a rerun pays only for what changed. The book's text and the outputs stay outside the repo (`~/claude-world-first/`).

## Vol 1, first run (2026-10-29)

77 scenes, 140 Jev calls (jev-1.14.0):

| | Old extraction | World-first |
|---|---|---|
| Scenes with nobody present | 34 | 7 |
| Vanish and return within 3 scenes, where the story carries straight on in the same place (42 scenes) | 13 | 0 (Jev alone: 7; the laws fill the rest) |
| Scenes with a place | 34 | 77 (46 named, 31 unnamed) |
| Flashbacks | 0 | 4, so 7 scenes in the past. Scene 6 opens "事情要追溯到之前……", and the old timeline missed it. |
| "Same time" ruled out by the two-places law | — | 2 |
| Times named by the text | — | 26 scenes |
| Trips between places | — | 25 |

## EM

Identity matching at birth stays with character extraction, before the world runs. The world needs one identity per person, or the two-places law misfires and a duplicate never meets itself.

After the run, the world gives EM evidence it can audit:
- two identities that are never in a scene together but share names and companions (merge candidates);
- presence the law keeps rejecting (a split candidate or a misdetection).

`compare.mjs` lists the first kind; vol 1 had none.
