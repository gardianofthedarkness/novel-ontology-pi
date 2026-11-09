# The review by Jev (design, 2026-11-06)

The user, 2026-11-06: *"I'm thinking of whether we can build the review process also system1 jev based."* Then, after
the review's real items were listed: *"Yes, write that design."*

Today every held item goes to a main agent (Pi) through the review CLI ([world-ontology.md](world-ontology.md) §7, §7b).
This design puts a Jev review cast in front of it:

- **Jev answers** each held item from an evidence pack the engine gathers.
- **System 2:** what Jev is unsure of goes to the work model with the same pack, as everywhere else.
- **The laws** check every answer, as they check Pi's today.
- **Pi** gets only what is left over (the cases below) and a share of audits.

Nothing here is built yet.

## 1. The review today, with W12 as the record

W12 (library 16, run d20261105181503) held 154 items. Pi answered all of them on 2026-11-05 (22:33–23:38 UTC).

- **Pi:** an agent on DeepSeek Flash (Pi SDK).
- **What it was sent:** one batch per scene (62 batches), with the commands it may use.
- **What it did per batch:**
  - read the batch;
  - read the card and the scene in the reading (`novel reading`, 195 calls);
  - searched the original EPUB (66) and the source text (34);
  - read the world log (33);
  - queried the graph (20);
  - answered with one of the item's options and a reason citing sentence ids (median 392 characters).
- **Cost:** 658 tool calls, about 10 a batch (5–34). DeepSeek tokens: 0.9M fresh input, 39.4M read from its cache, 0.3M output.
- **When answers take effect:** the next director run applies them through the laws (`applyAnswers`, `lawAgainst`) and plays by the resulting pins. Answers the laws turn back return to the pool.

| Kind | Law | Items | Pi's answers | A real one (romanized) |
| --- | --- | --- | --- | --- |
| who-speaks | (speakers) | 103 | a person there 66, none of them 37 | scene 6, b0000_s0096: Jev's 42% guess was not there; Pi gave it to the supervising teacher, since the line answers Shirai's objection at s0094 and the teacher asked about the remote at s0089–90 |
| talk | L6 | 11 | live 10, public 1 | scene 52: Index 54 m from Kamijou, "public"; Pi: live, they walk side by side, the loud copy is the advertising truck's, the 54 m is placement drift |
| reach | L10 | 23 | arrives 4, stays 10, another way 9 | scene 119: Kamijou lets go, slides down the tilting ground and jumps into the passage as it shuts (another way) |
| actor | L9 | 3 | present 1, not present 2 | scene 239: Misaka 10032 not there, as the only clone girl on stage is Last Order |
| speaker | L6 | 2 | not the speaker 2 | the same scene: the narration a few lines later says Last Order made the request |
| identity | (world) | 12 | different 9, same 3 | "the girl" of scenes 199 and 252: Maidono and the 15 cm fairy in the glass tube, different |
| person (cast) | — | 7 | not answered yet | the Santa girl and Maidono; Misaka Mikoto and Last Order (their names share "Misaka") |
| sheet (cast) | — | 17 | not answered yet | Index flies (Jev 34% sure); Maidono attacks along a line at 30 m (23%) |

## 2. What Pi's answers rest on (measured)

**How far the evidence lies.** For each answer, the farthest sentence Pi cited was measured from the held card's or line's own sentence.

| | Items | Share |
| --- | --- | --- |
| Within 10 lines | 54 | 39% of the 137 with a line to measure from |
| 11–40 lines | 61 | 45% |
| Farther | 22 | 16%: mostly a person's last or next appearance, or who an unnamed speaker is from an earlier scene |
| No line to measure from | 17 | the 12 identity items (two people across chapters), 5 whose card carries no line |

The book's sentences average 23 characters, so a window of ±40 lines is about 3,000 characters with ids. One Jev
request holds that easily. The 16% farther away, and identity, need the engine to fetch lines by person, not by
distance.

**Three faults in the questions,** which hurt Pi's answers too:

1. **The real speaker is often not an option.**
   - who-speaks offers the people the world placed in the scene and leaves out the addressee (`heldItems`: `options … filter(id => id !== v.to)`). 83 of the 103 items name an addressee.
   - 37 answers were "none of them":
     - 12 of those name the addressee as the speaker (Kamijou blurting his own thought, for one);
     - others name someone the world never placed (Accelerator to Yomikawa), or a voice on a phone.
   - The pin then sets the line's speaker to null, and who it was is lost.
2. **Crowds swamp the options.** 30 who-speaks items list crowd members one by one, up to 56 options for one line.
3. **The answer command takes anything.**
   - One of Pi's answers has the reason "test" (b0002_s0768, none of them).
   - 15 of its 169 answer commands failed on a two-word option it had not quoted.

## 3. The design: a Jev review cast, Pi behind it

```
held item ──► evidence pack ──► Jev: the verdict, and the line that shows it
                                  │ below 0.5
                                  ▼
                                the work model (the same pack, the same questions: system 2)
                                  │
                                  ▼
                                G0, the laws (lawAgainst) ──► pin (at the next run's start)
                                  │ turned back, or one of the cases below
                                  ▼
                                Pi, with the review CLI, as today
```

The gates of §7b become three:

| Gate | Who | Sees |
| --- | --- | --- |
| G0 · the laws | code | every answer |
| G1a · the Jev review | Jev, and the work model on what Jev is unsure of | every held item it has a pack for |
| G1b · a main agent | Pi, Codex or another, with all the rights | what G1a passes on, a share of audits, and what Jev cannot answer |

**Pi still gets:**

- **Kinds Jev cannot answer:**
  - the user's notes (free text);
  - an ability sheet to set by hand (Jev answers yes or no only);
  - big revisions (class R);
  - cross-book bundles (class X).
- **Escalations:**
  - the work model and Jev disagree;
  - the laws turn the answer back;
  - the evidence question says no line shows it;
  - identity or abilities not sure enough (§6).
- **Audits:** a share of what Jev settled (§6).

Nothing waits on either reviewer. A held item plays its lawful default until an answer is pinned.

## 4. Evidence packs, kind by kind

A pack is a mode of the context engine ([context-engine.md](context-engine.md)): sources with quotas, cut in order when
over budget. The focus is always kept: the item, its question and the card's own lines. Everything else is ranked.

| Kind | Beyond the card's lines (most kept first) |
| --- | --- |
| who-speaks, speaker | the scene's lines ±40; each candidate's speech habits (`reading.habits`, voices.json) and EM² guesses with how sure; who the line is to; each candidate's nearest lines before and after in the strand |
| talk | lines ±40; the two people's positions, floors and distance from the world log; any device the lines name (a phone, a speaker, a broadcast) |
| reach | lines ±20; the move the director tried and why it failed (L10's journey); the mover's sheet (abilities.json) and props or rides; the place's level (underground, a tower roof) |
| actor | the scene's lines; the person's nearest lines before and after in the strand (Pi's "last seen at b0004_s0606"); who the scene's script has present |
| identity, person | for each of the two: their first lines, the lines that describe them (references), the lines naming both, and the passages most like those (embedding search, bge-small) |
| sheet | the sheet's evidence lines ±2; the settei's kinds and limits for that part |
| continuity, two-places, travel, blast | the scene's lines; the strand's records for the person (where the world had them, at what stated moment) |

**Checked for free before anything is paid:** for W12's 137 measurable items, the share whose lines Pi cited fall inside
the pack (§8).

## 5. The questions

Each item becomes two questions in one request; a scene's items share one request where their packs overlap:

1. **The verdict:** the item's own options (a `choice`), as Pi gets them.
2. **The evidence:** "Which line shows it?" A `choice` over the pack's line ids, plus "no line shows it".
   - Jev gives no prose, so this line is the answer's reason.
   - The laws can check that the line exists and lies in the pack.
   - The Why panel shows the line's text.

**Repairs to the questions** (for Pi too):

- **who-speaks options:**
  - everyone placed there, the addressee, the reading's EM candidates, and the strand's people near the scene;
  - "a voice from elsewhere (a phone, a broadcast)";
  - "someone unnamed";
  - the crowd as one option, "someone in the crowd".

  A person answered is pinned as the speaker, so "none of them" no longer erases who it was.
- **The answer command:**
  - takes an option by its number as well as by its words;
  - turns away a reason that cites no sentence id.

## 6. Routing: when Jev's answer stands

The rule is the user's system 2 rule (2026-11-02): Jev answers. Below 0.5, the same pack goes to the work model, and
the work model's answer is the one used. The used answer goes to the laws. On top of that, an item goes to Pi when:

| When | Why |
| --- | --- |
| Jev is below 0.5 and the work model picks another option | two weak readings disagree |
| the laws turn the answer back | as for Pi's today |
| the evidence answer is "no line shows it" | a verdict with nothing under it |
| identity or abilities (classes I, A), unless Jev is at least 0.8 and the work model, asked as well, agrees | one wrong merge or sheet changes everything a person does |
| a kind whose audit error is over its limit | the gate tightens where Jev is wrong |

- **The thresholds (0.5, 0.8) are starting values.** Section 8 sets them per kind from Jev's confidence against Pi's W12 answers.
- **Audits:** a share of what Jev settles (start at 10%) also goes to Pi as an `audit` item (right or wrong; the kind exists). Each kind keeps its error rate, and a kind above its limit (start at 15%) goes to Pi until its rate falls again (§7b's audits).
- **Recorded on each answer** (`answers.jsonl`):
  - who settled it (`jev`, `work` or `pi`);
  - how sure, and the runner-up option;
  - the evidence line;
  - the pack's manifest.

  The run's report counts each.

## 7. Where it runs

1. **After the run (first).** When the director ends, `holdForReview` batches the held items as today. The Jev review answers every batch it can, and what it passes on goes to Pi's console (`sendToAgent`). The next run applies all of it under the laws.
   - Nothing about play changes.
   - The answers can be compared with Pi's one for one.
2. **Inside the run (later, a decision).** When a law holds an item, the director asks the review question there and retakes the card with the answer pinned, as it retakes a layout.
   - **Gain:** a run corrects itself instead of waiting for a rerun.
   - **Cost:** a held card may be played twice.

## 8. Measuring it on W12

Pi's 154 answers are the reference set. Pi is not ground truth (the "test" reason), so every disagreement is read
against the text before it counts against either side.

1. **Pack recall (free):** for each item, is the line Pi leaned on in the pack? Target: 90% of the 137.
2. **The plumbing (free):** the stand-in answers every item on a copy of library 16. The answers go through `applyAnswers` to pins, and units 1–84 are rehearsed with them.
3. **Jev on the 154 (paid, about $0.05):**
   - agreement with Pi per kind;
   - Jev's confidence against agreement (the calibration that sets §6's thresholds);
   - the disagreements read and settled.

   **Bar:** where Jev's answer would stand (§6), it agrees with the settled answer on at least 85% per kind.
4. **The work model on the share below 0.5:** whether system 2 rescues them or should send them on to Pi.

## 9. Cost and time

| | Pi (W12, measured) | The Jev review (estimate) |
| --- | --- | --- |
| Requests | 658 tool calls in 62 batches | about 154 Jev requests (fewer where a scene's items share one), the work model on the share below 0.5 |
| Size | 0.9M fresh input tokens, 39.4M from cache, 0.3M output | about 6,000–7,000 characters an item, about 1M characters in all: about $0.05 at the reading's rate (W12's reread: 7.0M characters ≈ $0.30) |
| Time | 65 minutes | minutes |
| Needs | a Pi worker running on a host | nothing beyond the director's own keys |

## 10. Order of work

| | What | Paid |
| --- | --- | --- |
| R1 | The question repairs (§5): who-speaks options, a person pinned instead of null, crowds folded, the answer command's checks; tests. **Built (2026-11-07)**, except the answer command's checks | no |
| R2 | The evidence packs (`world-engine/review/evidence.mjs`, pure: the reading, the text, the world log, the voices, the sheets in; a pack out); pack recall on W12. **Built:** recall 90.2% (§12); no voices or sheets in the packs yet | no |
| R3 | The review modes and the runner: `novel world review <dir> --jev [--stand-in] [--dry]`, answers written as Pi's are, with `by`; tests. **Built** as `world-engine/review/jev-review.mjs`, writing only its `--out` | no |
| R4 | The measurement on W12 (§8) on a copy of library 16. **Run twice** (§12), reading library 16 without writing it | about $0.05 (actual: about $0.22 for two runs, §13) |
| R5 | Routing (§6): system 2, escalation, audits; wired after the director's run, before `sendToAgent` | no |
| R6 | Inside the run (§7.2), if the user decides so | — |

## 11. Decisions for the user

1. **Pi's place.** Proposed: Pi stays for escalations, audits and the kinds Jev cannot answer (§3). The other way is Jev alone, with what it cannot settle playing its default.
2. **Thresholds.** Proposed: the system 2 rule as it stands (0.5), with identity and abilities stricter (0.8 and the work model agreeing); both then set per kind by §8.
3. **Where it runs.** Proposed: after the run first; inside the run once §8 has passed.
4. **Audits.** Proposed: 10% of what Jev settles, a kind's limit 15% wrong.

## 12. Built and measured on W12 (2026-11-07)

The user, 2026-11-07: "implement a jev review protocol and test out the accuracy rate and usability of confidence".

**Built:**

- **R1:** `whoSpeaksOptions` (review.mjs) offers whom the line is said to, folds a crowd into "someone in the crowd", and
  replaces "none of them" with "a voice from elsewhere" and "someone unnamed". `pinsFrom` pins the crowd's first member,
  and null for no one listed.
- **R2:** `evidence.mjs`. A pack is the lines ±20 round the item by id, then each person's names by nearness within ±100
  lines, up to 50. An item with no line of its own (identity) gets each person's own lines (slot, the reading's
  references, what they say) and the lines naming them, the nearest the scenes asked first. Packs average about 63
  lines and 4,900 characters.
- **R3:** `jev-review.mjs`. One request for the verdict. A second request on the same document for the evidence, asked
  with the verdict ("the answer is X; which line shows it?"), each line offered by its words. Below 0.5 (and always for
  identity) the work model answers both on the same document (system 2). Then the laws, then routing (§6). It writes
  only its `--out`; `--stand-in` and `--dry` are unpaid.
- **The measure:** `experiments/v2/review-measure.mjs` gives pack recall, agreement per kind, calibration, coverage
  and the disagreements; `--settled` scores against answers read by hand.

**Pack recall (free):** 369 of the 409 lines Pi cited (90.2%), and 74 of 79 items hold at least one. By kind: talk 100%,
reach 93%, who-speaks 91%, actor 75%, identity 45%.

**Two paid runs on the 154 items Pi answered** (library 16, read only):

- **v1** asked the evidence beside the verdict, over bare line ids. Jev said "no line shows it" on 110 of 154: a
  choice reaches Jev as each option's criterion, and a bare id says nothing.
- **v2** asked it after the verdict, with the line's words as the criterion: 44 of 154. Jev's line is one Pi cited on
  39 of 70 items, within two lines of one on 46.
- **Cost:** Jev 3.03M input tokens for both runs, about $0.13. The work model made 144 requests, about $0.09 (§13).

**Settled answers.** Every disagreement with Pi (70) and the 15 agreements on "none" were read against the text. 15 are
unclear and left out: 12 lines of advertisement copy on phone screens in scene 249 (no one in the scene says them), a
shout across a storm (live or public), and a body thrown by a blast (none of the reach options). 139 are scored.

| Kind | Items | Pi right | Jev right | Used right (with system 2) | Stand | Standing right | To Pi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| who-speaks | 90 | 74 | 67 | 71 | 66 | 53 | 24 |
| reach | 22 | 22 | 17 | 15 | 19 | 14 | 3 |
| talk | 10 | 10 | 7 | 8 | 6 | 5 | 4 |
| identity | 12 | 12 | 11 | 12 | 3 | 3 | 9 |
| actor | 3 | 3 | 0 | 0 | 3 | 0 | 0 |
| speaker | 2 | 2 | 1 | 0 | 1 | 0 | 1 |
| all | 139 | 123 (88%) | 103 (74%) | 106 (76%) | 98 | 75 (77%) | 41 |

Pi's 16 misses are all one case: the line was said by the one it was said to, whom Pi was never offered. Each time,
Pi's reason names the right person, but "none of them" would have pinned no one (R1 fixes this). Read for meaning, Pi
misread 4 of the 139: the lines of Index's shout to Misaka, which it gave to Misaka. They score as right here because
"none" was right among the options Pi had.

**Confidence** (Jev's verdict):

| Jev's confidence | Items | Right |
| --- | --- | --- |
| below 0.3 | 14 | 50% |
| 0.3–0.5 | 36 | 69% |
| 0.5–0.7 | 27 | 74% |
| 0.7–0.8 | 18 | 67% |
| 0.8–0.9 | 22 | 77% |
| 0.9 and above | 22 | 100% |

- **Usable at the top only.** 0.9 and above was right every time, but that is 16% of the items. Between 0.3 and 0.9 it
  is flat at about 70%. As a ranking of right over wrong, its AUC is 0.66, and the margin over the runner-up is no
  better (0.66).
- **Standing on Jev alone:**

  | Stands when Jev gives a line and is at least | Share of items | Right |
  | --- | --- | --- |
  | 0.5 | 51% | 76% |
  | 0.7 | 38% | 81% |
  | 0.8 | 28% | 87% |
  | 0.9 | 13% | 100% |

  §8's bar (85% per kind) is met only from 0.8.
- **Confident errors cluster by scene.** 7 of the 11 errors at 0.7 or more are one scene (206): Jev gave Misaka's
  explanation to 10032 at 0.75–0.89. 10032 marks her own lines with "Misaka" and Misaka says "I", but the pack carries
  no speech habits. The other confident errors: Kamijou's own thoughts given to Othinus (2), a talk whose question never
  names who talks (1), and Index's "Touma" line given to Misaka (1).
- **Flashbacks:** all 3 actor items (someone in a remembered line) Jev answered "present".
- **System 2:** when Jev is below 0.5, the work model agrees on 30 of 47, and those are right 77% of the time. When it
  disagrees, both are near a coin flip (Jev 7 of 17, the work model 10 of 17), so sending them to Pi is right.
- **"No line shows it" is no sign of a wrong verdict.** Jev's verdict is right 76% of the time when it says so, against
  73% when it names a line. As an escalation it sent 21 items to Pi, most of them right already.

**Faults found in the questions** (Pi's too):

- **Advertisement copy and screens counted as speech** (12 lines).
- **A talk question that never says who talks to whom** (the card opens with a truck's loudspeaker ad, which Jev took
  as the talk).
- **The speaker not among "those there".** On 12 items the right speaker was someone the world had not placed in the
  scene: Index, Last Order, Misaka, or Maidono in costume. The answer then is "someone unnamed", and the person is lost.

**What would raise it** (not done):

1. Each candidate's voice in the pack: their self-reference and pet words (`reading.habits`, voices.json). This covers
   the scene-206 cluster.
2. One request per scene for its who-speaks lines, so one quote keeps one speaker. Each line's verdict stays its own
   question.
3. Candidates widened to the people the window names and the reading's EM guesses, so the speaker is offered.
4. Lines inside a flashback marked as remembered.
5. Ad copy, signs and screens kept out of who-speaks.
6. Routing: stand at Jev 0.8 or more with a line; below 0.5, stand where the work model agrees; send the rest to Pi.
   Drop "no line shows it" as an escalation (keep it recorded).

A rerun on W12 after 1–5 costs about $0.3.

## 13. Cost against Pi, and when to call Pi (2026-11-07)

The user, 2026-11-07: "Can you compare the cost? Do we have a reliable way of knowing if an overall jev loop is confident
enough to whether trigger pi agent?"

**Cost of reviewing W12's 154 held items once.** These are DeepSeek's `deepseek-flash` rates as of 2026-11-07, off-peak;
peak is double. Both runs fell off-peak.

| | Pi (W12, measured) | The Jev review (v2, measured) |
| --- | --- | --- |
| Requests | 649 model turns, 658 tool calls | 308 Jev requests (verdict, evidence), 72 work-model requests |
| Tokens | 0.91M fresh input, 39.4M input read from cache (each turn resends the session), 0.30M output | Jev 1.95M input; work model about 0.29M input, 4k output |
| Cost | $0.43 ($0.14 fresh input, $0.12 cache reads, $0.18 output) | $0.13 (Jev $0.08, work model $0.05) |
| Time | 65 min | about 30 s |
| Right (139 settled) | 88% as scored; 97% by its reasons | 76% (standing answers 77%) |

- **How the work model's tokens were found:** the runner did not meter them. Its prompts were rebuilt exactly and
  counted by DeepSeek's rule (a Chinese character 0.6 tokens, other characters 0.3).
- **The assumption in its price:** the runs used the model name `deepseek-chat`, which DeepSeek's page no longer lists.
  It is priced here at the Flash rate.
- **Library 16's out-of-date rates:** `stage/director/prices.json` still has the old `deepseek-chat` rates (0.27 and
  1.10). Flash at peak is 0.30 and 1.20.

**Signals for sending an item to Pi**, measured on the 139 settled items:

| Signal | Separates right from wrong |
| --- | --- |
| Jev's verdict confidence | AUC 0.66; 0.9 and above right 22 of 22 (16% of items), 0.8 and above 89% (32%), flat at about 70% below |
| The margin over the runner-up | AUC 0.66, no better |
| Jev's confidence in its evidence line | AUC 0.47: none |
| Jev agreeing with itself (the two runs) | none: Jev is near deterministic, the same verdict on 134 of 139 |
| The work model agreeing | the best: 82% right where it agrees, 44% where it does not; measured only where it was asked (57 items, mostly below 0.5) |
| The reading's own guess agreeing (who-speaks) | too rare to use (8 items) |

Errors cluster by scene: 8 of the 36 wrong answers are one scene (206), so one missed cue spoils a whole scene at once.
A gate item by item does not see that.

**Splitting the work between Jev and Pi** on W12. Pi takes what does not stand. "With repaired options" counts Pi's
16 option misses as right, since R1 now offers the person it named.

| Gate | Stand | Right of those | To Pi | Cost | Pi's time | Right overall (Pi as scored / with repaired options) |
| --- | --- | --- | --- | --- | --- | --- |
| Jev only (system 2 below 0.5) | 139 | 76% | 0 | $0.13 | 0 | 76% / 76% |
| The routing as built (§6) | 98 | 77% | 41 | $0.26 | 19 min | 80% / 84% |
| Jev 0.8 or more, or below 0.5 with the work model agreeing | 74 | 84% | 65 | $0.33 | 30 min | 86% / 91% |
| Jev 0.8 or more | 44 | 89% | 95 | $0.42 | 44 min | 86% / 94% |
| Jev 0.9 or more | 22 | 100% | 117 | $0.49 | 55 min | 89% / 97% |
| Pi only | 0 | — | 139 | $0.43 | 65 min | 89% / 97% |

**For a whole run, there is no reliable self-check yet.**

- **Calibration** turns each answer's confidence into an expected accuracy; summed, it predicts a run's right answers.
  But it was fitted on this same run, and a new book or a fixed pack moves it.
- **Audits** are the only check that does not trust Jev, and a run's 10% share cannot settle it. At a 23% error rate,
  the 95% interval is:

  | Answers audited | Error rate's 95% interval |
  | --- | --- |
  | 15 | 7–45% |
  | 50 | 14–37% |
  | 100 | 16–32% |
  | 200 | 18–29% |

  Telling 77% right from the 85% bar takes about 100 answers audited per kind. They have to be pooled across runs and
  sampled by scene, since errors come by scene.

**What would make it reliable** (not done):

1. **The work model asked on every item** (about $0.05 more per pass). Then whether it agrees is known everywhere, not
   only below 0.5. Measuring it costs the work model on W12's other 82 items (about $0.05).
2. **Audits by scene, pooled across runs**, with a counter per kind. A kind's answers stand on their own only once its
   audited error is under the limit with about 100 behind it; until then, below 0.8 goes to Pi.
3. **The fixes of §12**, which raise what Jev gets right. A better gate only decides who answers; it does not make the
   answers better.

## 14. Jev choosing its looks: the agility test (2026-11-07)

The user, 2026-11-07: "Is jev enabled to choose different methods and accuracy of observe?" Then, to letting Jev choose
its next look: "Yes, do the with agility test."

**Built:** `world-engine/review/look.mjs`, with the runner's `--looks N` and `--min-looks K`.

- **The start:** the item's line and 5 lines each side (11 lines). An identity item starts from each person's 5 own
  lines.
- **Each look:** Jev picks one move from a list built from what it has read. Each move is offered in words: what it
  reads and how much.

  | Move | What it does |
  | --- | --- |
  | answer | Stop and answer from the lines read |
  | before, after | Read 10 more lines next to those read |
  | name | Read lines naming a person, within 100 lines (Pi's keyword search) |
  | said | Read lines the reading has a person say (Pi's graph and speaker lookups) |
  | scene | Read the rest of the scene (Pi's opening of the scene) |
  | work | Ask the work model, a larger and slower reader, whose answer joins what Jev sees: a closer read, not a wider one |
  | pi | Hand the item to the main agent |

- **The limit:** at most 4 looks, then the verdict and the line as in §5.

**Three runs on W12's items**, scored against §12's settled answers:

| | Fixed pack (§12) | Jev chooses | Jev must read twice, then chooses | Random choice (stand-in), must read twice |
| --- | --- | --- | --- | --- |
| Looks per item | — | 0.6 | 2.1 | 3.4 |
| Lines read per item | 63 | 19 | 35 | 35 |
| Pi's cited lines read | 90% | 65% | 80% | 76% |
| Jev right | 74% | 65% | 65% | (rule answers) |
| With the work model below 0.5 | 76% | 73% | 66% | — |
| Jev requests | 308 | 545 | 744 | — |
| Jev cost | $0.08 | $0.06 | $0.10 | free |

**What it showed:**

- **Jev does not choose how to look well.**
  - **It stops at once.** Left free, it answered from the first 11 lines on 52 items and handed 42 to Pi before
    reading anything more.
  - **It picks looks barely better than chance.** Made to read twice, its looks found 80% of Pi's cited lines; random
    picks from the same list found 76%.
  - **It is unsure of its own picks.** Its confidence in a move was 0.2–0.3 (an answer: 0.44), and "hand to Pi" was
    the runner-up on 47 of the first choices.
- **What each look found** (of the looks on the 70 items where Pi cited lines, the share that read one of them; forced
  run):

  | Look | Taken | Found a cited line |
  | --- | --- | --- |
  | the rest of the scene | 41 | 49% |
  | lines naming a person | 23 | 30% |
  | 10 lines before | 22 | 18% |
  | what a person says | 40 | 13% |

  Jev took the scene most, the right first choice, but it took "what a person says" almost as often, which rarely finds
  anything.
- **Its hand-offs to Pi are not selective.** The items it handed on are no harder than the rest: the fixed-pack Jev
  got 72% of them right and 76% of the others.
- **The work model as a look** was asked 31 times in the forced run, and was right on 18 (58%). It is no closer a read
  than Jev's own.
- **What the lines are matters more than how many.** The fixed pack is a contiguous ±20 plus names by nearness. It
  beats 35 lines Jev chose by 9 points, though most of its extra lines say nothing to the answer.

**So:** Jev reads a pack well and chooses what to read badly. Choosing how to look is a planning step, and Jev answers
one question at a time without a plan. The look stays the harness's, measured as §12 did. A choice of look, if any,
belongs to system 2 (the work model) or Pi.

What the harness could adapt by rule instead (not tested): below 0.5 on the fixed pack, widen it (the scene, ±40) and
ask Jev again before the work model. That is a rule on Jev's confidence, which §13 found weak, so it would need its own
measure.

Runs: `~/claude-world-first/jev-review-w12/answers-looks.jsonl` and `answers-looks-forced.jsonl`, with their reports.
The work model's share is not metered (about $0.05 a run, estimated as in §13).

## 15. Which reviewer for which kind (2026-11-07)

The user, 2026-11-07: "Hold off and let's find the best option for us. Maybe in some category of question the mini
harness of jev is enough, but for some it's not. Can we test it out?"

**The test.** The work model was asked on every W12 item with the fixed pack (runner `--work-all`; 82 new requests,
about $0.05; Jev's requests all from the cache). Then `experiments/v2/review-options.mjs` scored each option per kind
against §12's settled answers.

- **An item handed to Pi** counts as right where Pi's reason named the right person. R1 now offers the person spoken
  to, behind all 16 of Pi's misses as scored. That leaves 4 Pi misreads.
- **Cost per item** (§13): Jev $0.0005, the work model $0.0006, Pi $0.0028 and 0.42 minutes.

**Right overall per kind** (Pi takes what does not stand):

| Option | who-speaks (90) | reach (22) | identity (12) | talk (10) | actor, speaker (5) | all (139) |
| --- | --- | --- | --- | --- | --- | --- |
| Pi only | 96% | 100% | 100% | 100% | 100% | 97% |
| Jev alone | 74% | 77% | 92% | 70% | 20% | 74% |
| The work model alone | 74% | 73% | 92% | 80% | 40% | 75% |
| Jev, the work model below 0.5 | 79% | 68% | 100% | 80% | 0% | 76% |
| Jev choosing its looks (§14) | 58% | 82% | 100% | 60% | 40% | 65% |
| Jev 0.7 or more, else Pi | 84% (51 to Pi) | **100% (11 to Pi)** | 100% (4) | 90% (6) | 100% (5) | 89% (77) |
| Jev 0.9 or more, else Pi | **96% (77 to Pi)** | 100% (21) | 100% (6) | 100% (8) | 100% (5) | 97% (117) |
| Jev and the work model agreeing, else Pi | **88% (23 to Pi)** | 82% (3) | **100% (2 to Pi)** | 90% (3) | 60% (3) | 87% (34) |

**Per kind:**

- **identity: Jev's harness is enough** when the work model agrees: 10 of 12 stand, all right, and 2 go to Pi. Jev
  alone missed 1, and the work model behind it caught it. The sample is small, and 9 of the 12 were "different".
- **reach: Jev's harness is enough above 0.7.** The 11 answers that stand are all right; the other 11 go to Pi. The work
  model hurts here: below 0.5 it leaves 2 fewer right than Jev alone.
- **who-speaks** (65% of the items): **not enough.**
  - Its best gate, the two models agreeing, is 88% overall with a quarter to Pi.
  - Matching Pi takes Jev at 0.9 or more, which sends 86% to Pi.
  - Its confident errors are a cluster in one scene (§12): the lines Misaka says, given to 10032.
- **talk: not shown either way** with 10 items. The agreeing gate is 90%, with 3 to Pi.
- **actor, speaker: not enough.** These are mostly flashbacks; Jev is right on 1 of 5. All go to Pi.

**Two policies, kind by kind:**

| Policy | Right | To Pi | Cost (139 items) | Pi's time |
| --- | --- | --- | --- | --- |
| Pi only | 97% | 139 | $0.39 | 59 min |
| **Fast:** who-speaks, identity and talk stand where the two models agree; reach at Jev 0.7 or more; actor and speaker to Pi | 91% | 44 (32%) | $0.27 | 19 min |
| **As right as Pi:** who-speaks at Jev 0.9 or more; identity where the two agree; reach at Jev 0.7 or more; talk, actor and speaker to Pi | 97% | 105 (76%) | $0.37 | 44 min |
| Jev and the work model, no Pi | 76% | 0 | $0.11 | 0 |

**Caveats.**

- The gates were chosen on the same items they are scored on. talk, identity and the actor and speaker items are a
  few each.
- The next run (W13) should check them: Pi answers everything, and the policy is scored against it before it routes
  anything.
- Cost hardly separates the options; Pi's time and a running Pi host do.

**What would move who-speaks:** the fixes of §12, which change what Jev reads, not who reads it: each candidate's
voice, one request per scene, the speaker among the options, ads out. who-speaks decides how much Pi is spared.

## 16. who-speaks fixed, and the review by Jev wired in (2026-11-07)

The user, 2026-11-07: "Fix it, and I think let's do our next run of full rerun of vol1 paid. Do it after your fix, wire
it in, and do it tonight."

**The fixes** (`evidence.mjs`, `jev-review.mjs`):

- **One quote, one speaker.** `quoteSpans` finds each quotation by its marks, however many lines it runs; a quote
  left open for more than 12 lines is dropped. A scene's who-speaks items in one quote are asked once (`quoteGroups`,
  `askedQuote`), and every item takes the answer. On W12, 103 items became 64 questions.
- **The speaker among the options.** Beyond those the world placed and whom the line is said to, the options take
  the reading's own guess and up to 6 people near the line (`nearbyPeople`). Near means the reading's sure speakers and
  listeners within 10 lines, and the named characters those lines name. Slots are left out: a slot's label, "a girl",
  is in every scene.
- **Each candidate's voice.** `voicesOf` and `voiceMarks` take, from the lines the reading is sure of, the word pieces
  a person's lines carry far more often than anyone's, said in at least 3 scenes (a habit, not a topic). 10032 gets
  "Misaka" after a comma, Index an opening "Touma", Last Order the doubled "Misaka Misaka", Kamijou his trailing "ah…".
  Only speaker questions carry voices (their own task text), so the other kinds' requests stay as they were.

**Retested on W12's 90 who-speaks items** (paid, about $0.07; the other kinds from the cache):

| | Before the fixes | After |
| --- | --- | --- |
| Jev alone | 74% | 74% |
| The work model alone | 74% | 79% |
| Jev at 0.8 or more | 27 stand, 81% right | 25 stand, **100% right** |
| The two models agreeing | 67 stand, 84% right | 71 stand, 87% right |

The scene-206 cluster is gone from Jev's confident answers. As whole policies on the 138 settled items:

- **Fast:** 93% right with 28% to Pi.
- **As right as Pi:** 97% with 67% to Pi (39 minutes of Pi against 59).

**Wired** (`jev-review.mjs` `reviewHeld`, `POLICY`, `standsBy`; `director.mjs`, `--no-jev-review` to skip):

- **When it runs:** after a director run batches its held items (`holdForReview`) and before they go to the main
  agent. It is skipped on stand-in runs.
- **What it does:**
  1. Widens the who-speaks options in the pool, so Pi sees them too.
  2. Asks every item of the kinds it reviews.
  3. Records an answer the policy lets stand as Pi's are: `answers.jsonl` with `by` (`jev`, or `jev+work`) and
     `confidence`, and the item answered.
- **What goes to Pi:** only batches with an item left go to Pi's console. The next run's `applyAnswers` turns both
  reviewers' answers into pins under the laws.
- **The policy, as right as Pi:**

  | Kind | Stands when |
  | --- | --- |
  | who-speaks | Jev is at 0.8 or more |
  | reach | Jev is at 0.7 or more |
  | identity | Jev and the work model agree |
  | talk, actor, speaker, the cast's, notes, revisions | never: they go to Pi |

- **World · Live:** each review answer in a card's Why panel says who settled it, with Jev's confidence (sim-play's
  `review.json` carries `by`).

**Tested:** 41 review tests and 180 world-engine and host tests pass. On a copy of library 16 with W12 items set back to
batched, the step answered and left the rest for Pi, and `applyAnswers` applied all of it (135, none turned back).

**W13** (the user's go, 2026-11-07): run `d20261107055318`, the paid full vol 1 run on library 16.

- **Checkout:** `~/claude-pi-host/app-29617e7-w13` (29617e7 with tonight's uncommitted changes, fully built).
- **How it started:** `--live --agent <library> --discard-edits`. It restored `0001-before`; W12's state is kept as
  `0003-guard`.
- **After it:** Jev's review, Pi on the rest, then a second pass (`--from-last`) to play the volume corrected by
  both reviews.

**W13 died in scene 249 and was rerun** (07:07 UTC). The scene's crowd took its radius from the frame, half of it. Its
frame was city-wide, so the crowd asked for a walk graph over most of the city. That graph had more steps than a
JavaScript `Map` holds (2^24), and `worldGraph` threw a `RangeError`. The run never reached the review.

- **Earlier warning:** W12 and W13 both had a 718 m crowd in scene 153. It held 336,450 nodes and put 2,018,700 people
  on a district. The new layers (deep, air, space) and their ways make a window of the same size larger than before.
- **Fix** (`director.mjs`):
  - A crowd reaches at most `CROWD_REACH` (160 m) round its anchor: the open ground a camera takes in.
  - Every look round a point (`around`) builds a window of at most `AROUND_MOST` (400 m). A fact's spot was already
    bounded by a walk of 160 m.
  - Walk windows are not capped, since a long leg needs its own reach.
- **Rerun:** the same command. Calls the crashed run made are in the director's cache, which snapshots leave alone, so
  scenes 1-248 replay from it at no cost; only what changed and scenes 249-286 are paid. The crashed run's logs are in
  `w13-run-crash249.{out,err}`, and its state is kept as a guard snapshot.

**W13 rerun result:** run `d20261107071119`, 07:11–08:51 UTC.

- **The run:** 286 scenes, 525 calls, 685 cards, 866 moves. Laws broken: L6 7, L9 3, L10 7, L11 3. What it left is
  snapshot `0005-after-d20261107071119`.
- **Cost:** $0.15 (Jev $0.12, the work model $0.03). The first try that crashed cost about the same.
- **Scene 249:** its frame was the city, 2,016 m. The capped crowd played through it. Scene 153's crowd now reaches
  160 m (15,136 nodes, 90,816 people) instead of 718 m.
- **Review by Jev:**
  - Asked 51 items (48 who-speaks, 3 talk). 6 stood, in two quote groups; 45 went to Pi.
  - On re-asking from a copy of the run's cache (no new requests), Jev's who-speaks confidences were mostly 0.2–0.65.
    Six reached 0.8, four sat at 0.79, and every verdict was one of the item's options.
  - So W13's held who-speaks items are harder for Jev than W12's were. The policy held them back as it should.
- **To Pi:** 13 batches from the 12 top scenes (holdForReview's budget of 12 scenes, 10 items a batch), 52 items in
  all.
  - Jev settled 6 of them; 46 are left for Pi (42 who-speaks, 3 talk, 1 audit).
  - The other 73 of the run's 125 held items stay open for the next round's batches: 44 who-speaks, 12 identity,
    7 reach, 4 talk, 3 actor, 2 speaker, 1 audit.
  - Jev reviews only what is batched, so it has not seen them yet.

**Pi and the corrected replay** (2026-11-07):

- **Pi:** answered its 46 items between 08:52 and 09:12 UTC (13 batches). Where both answered (45 items), Jev agreed
  with Pi on 31.
- **Second pass:** run `d20261107091352` (`--from-last`), 09:13–10:51 UTC, $0.18 (Jev $0.12, the work model $0.06).
  - It applied all 52 answers (6 Jev, 46 Pi) as pins, none turned back: 48 speaker pins and 1 not-speaker.
  - The canon took 48 review-applied speakers. Speakers held for review fell from 92 to 72.
  - The Why panels carry `by` and `confidence` on each card. Jev's answers are in scene 132 (98%), 213 and 223.
  - Laws broken: L6 14, L9 3, L10 9, L11 1 (first pass: L6 7, L9 3, L10 7, L11 3). None of the L6 breaks is on a
    line the review pinned. Seven are one conversation in scene 35, where the second pass, starting from the
    smoothed history, put the two speakers 467 m and two floors apart.
- **Next round:** at the end of the second pass, Jev asked 25 items (23 who-speaks, 2 reach) and 8 stood (7 and 1).
  12 batches went to Pi, and their answers apply in the next pass.
