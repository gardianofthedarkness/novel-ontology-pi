# Place-tree repair with scale: a test

2026-10-29, on the toaru vols 1–4 snapshot (read-only), with jev-1.14.0. The test proposed and wrote nothing; the repair was then built into the place-tree sweep and run on the stage demo's books 2 and 3 (end of this report).

## Why

The place tree grows unreliably: districts sit outside their city, and places at different levels look alike.

An audit against Jev's scale tags (region › city › district › street › building › room; see [stage-simulation-design.md](../stage-simulation-design.md)) shows:

- **Missing parents, not wrong ones.**
  - Books 1–3 on the stage demo host have one link between equal levels, 学园都市 in 东京都, both tagged city, and it is right.
  - They have no link to a smaller parent.
  - They have 9 places with no parent while a larger place exists. In book 3, only 2 of its 9 places have a parent.
- **Why the sweep misses them.** For every one of them, no sentence names the place together with its parent. The sweep (`placeTreeSweep.ts`) only nominates pairs named in the same sentence or scene, and lets Jev use only those sentences.
- **Wrong links are permanent.**
  - The review gate has `add_relation` but no way to move or remove a parent.
  - The sweep skips any pair where both places already have a parent.
- **The atlas is blocked by the same thing.** The universe atlas held 5 of its 6 cross-book joins. All 5 trace back to one place given two parents at different levels.

## Method

**1. Flag** (no model calls). A place is flagged when:
- it has no parent while a larger place exists in its book;
- its parent is not larger than it;
- a smaller place inside its parent's branch is named within 20 sentences of its scenes.

16 of 48 places were flagged: 15 without a parent and 1 under an equal-level parent.

**2. Score** every larger place as a candidate parent. The score adds:
- `exp(−d/20)`, for the nearest sentence naming the candidate, `d` sentences from the place's scenes;
- `0.3·log(1 + mentions within 60 sentences)`;
- `0.8` for naming both in one sentence;
- `1` for a name prefix;
- `1` when another book puts the place inside this candidate;
- `0.15·log(1 + trips)`, for people moving between the place and the candidate's branch;
- `0.1` per step down the ladder, so the more specific candidate wins close calls.

**3. Ask Jev one choice per flagged place.**
- The options are the top 3 candidates, each with its nearest sentences, plus "keep" when it has a parent, and "none".
- Four variants were tried:
  - **context:** "which place is it inside?", with the two nearest sentences naming each candidate, before or after the place's scenes;
  - **located:** the same evidence, worded "it lies inside one of these; pick none only when the text shows it lies outside all of them";
  - **previous** (the user's fix): the "located" wording, but Jev sees the current text and the nearest *earlier* text naming each candidate, never text after. The current text is the opening of the place's first scene, plus each candidate's first mention in a scene at the place. The score counts only mentions in the place's scenes or before them;
  - **names only:** the candidates without any sentences.

**4. Compare** with right parents labelled by hand from the text (`truth.json`, kept with the test scripts in the session scratchpad). Any right ancestor counts as right; the most specific one the text supports counts as best.

One label was corrected after reading the scenes: 保安室 is the security room by a hospital's ambulance entrance, so it is inside 医院 (in 第七学区), not 第十五学区. Jev had picked 医院; the figures below use the corrected label.

## Results (16 flagged places)

| Policy | Right | Most specific | Wrong | Left unlinked |
|---|---|---|---|---|
| Score alone, text on either side | 13 | 11 | 3 | 0 |
| Score alone, earlier text only | 12 | 10 | 4 | 0 |
| Jev, names only | 2 | 2 | 0 | 14 |
| Jev, context | 7 | 7 | 0 | 9 |
| Jev, located | 9 | 9 | 0 | 7 |
| **Jev, previous (current text and nearest earlier text)** | **11** | **11** | **1** | **4** |
| Jev located, then the score where Jev says none | 15 | 13 | 1 | 0 |
| **Jev previous, then the earlier-only score where Jev says none** | **15** | **13** | **1** | **0** |

- **Earlier text is what lets Jev answer.** With the current text and the nearest earlier text, Jev settled 11 of 16 by itself, against 9 and 7 with text from both sides. All 11 were the most specific right parent.
  - It solved the hardest case: 女子六人病房 is in 学园都市. With text after the scene in view, the next chapter's title made 洛杉矶 look likely, and the score fell for it.
  - It found 秘密住宅 inside 第六学区, not just 学园都市.
- **Its one wrong pick was at low confidence.** 小馆Diner was placed in 学园都市 at 0.41; it is in 洛杉矶. The scene's first mention of 学园都市 is about clearance goods from there.
  - Jev's right picks ran from 0.40 to 0.80, so confidence does not separate right from wrong. The sweep's 0.7 bar would drop 5 of the 11 right picks.
- **The score never "keeps".** On its own it made 3 or 4 wrong links in 16. Jev fixed:
  - 华盛顿特区: the score said 日本, from one shared sentence;
  - 长滩市: kept in 洛杉矶.
- **Where Jev says none, the score is a good suggestion.** With the earlier-text run, all 4 of its suggestions were right: Home_Ground_Hospital, 废弃大楼 and 遁影隧道 in 学园都市, and 衣阿华战列舰 in 洛杉矶.
- **Without the sentences, Jev is no use here** (2 of 16).

**The chain rule** (no model calls): when books give a place different parents at different scales, nest the parents, smaller inside larger, instead of holding.
- The snapshot has one such conflict: 学园都市, inside 东京都 in book 1 and inside 日本 in book 4.
- Chained, it becomes 东京都 ⊂ 日本, which is right.
- This is the conflict behind all 5 held atlas joins.

## What the test supports

- **Give Jev the current text and the nearest earlier text** naming each candidate, never text after the place's scenes. The score counts the same way.
- **A Jev pick becomes a PART_OF proposal** for the shared review gate, with its confidence and the sentences it read. Here that is 12 picks, 11 right.
- **A Jev "none" becomes a review item, not a proposal,** with the score's top candidate shown as a suggestion. Here that is 4 items, all 4 suggestions right.
- **Never write a link from the score alone.** Its errors are the kind a reader spots at once: a shared sentence, a chapter title, a parent it cannot keep.
- **Do not cut on confidence.** Right picks went as low as 0.40.
- **Chain cross-book parents by scale** before the atlas holds them.

**Still needed:**
- a "move parent" proposal kind, and a sweep that revisits places that already have a parent;
- scale stored as a reviewed place property.

**Limits:**
- 16 flagged places, one series, labels by one reader; one label was wrong until checked against the text.
- The weights were set by hand once, not fitted.
- Traffic was a small part of the score; its share was not measured separately.

## Built, and run on books 2 and 3

**The repair is part of `novel timeplace tree <book> --propose`** (`src/digger/timeplace/placeTreeRepair.ts`). It runs after the pair sweep, as the test's "previous" policy:
- **Its own text:** the current text and the nearest earlier text only.
- **Jev picks** become PART_OF proposals in the sweep's pending place-tree packet, whatever their confidence.
- **Jev "none"** goes into the packet's review notes, with the score's best candidate.
- **A place that already has a parent** is never moved by a proposal: a different answer is a note.
- **Prerequisites:** it reads each place's scale from `stage/scale.json`, and without it says to run `novel stage scale` first.
- **What it sees:** stored links, links still awaiting review, and the sweep's own new links.
- **Memory:** asked places are remembered in `timeplace/place-tree.json` with what they read.

**The checklist** counts places waiting for the repair under the place-tree step (`placesToRepair`). Its questions are keyed `place_tree:repair:<place>`, so the faculty flow shows them as the place tree's.

**Run on the stage demo host** (2026-10-29, jev-1.14.0), with the links pending review and drawn as proposed:

| Book | Flagged | Proposed | Review notes (none) |
|---|---|---|---|
| 2 | 3 | 第十五学区 ⊂ 学园都市 (0.77) | Home_Ground_Hospital (the score suggests 伦敦; the text puts it in 学园都市), 保安室 (suggests 学园都市) |
| 3 | 6 | 第七学区 ⊂ 学园都市 (0.58), 第八学区 ⊂ 学园都市 (0.56), 废弃大楼 ⊂ 第七学区 (0.40), 秘密住宅 ⊂ 第六学区 (0.72), 警备员化学分析中心 ⊂ 学园都市 (0.63) | 遁影隧道 (suggests 学园都市) |

- **Every district is now inside its city** on both strand pages (github.io `stage-strand/`).
- **Book 2:** 学园都市 holds 第七学区, 第十五学区 and 第十三学区 (with 购物美食大街). Its routes between places shortened from 1,489 m to 805 m.
- **Book 3:** 学园都市 holds the analysis centre, 第六学区, and 第七学区 (with 废弃大楼).
- **Exporter fix:** a building child the strand stages as a place of its own no longer also takes a lot in its parent's grid.
- **What the reviewer sees:** 6 proposals and 3 notes. The links stay "proposed" until the packet is reviewed. Scale and architecture picks for the re-parented places are asked again (their path changed) on their next run.
