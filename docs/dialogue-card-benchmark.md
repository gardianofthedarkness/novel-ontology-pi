# Dialogue-card benchmark contract

Owner-approved design change, 23 October 2026. This protocol supersedes
sentence-speaker accuracy as the product target; it is not a new measured result.

## Unit and independent labels

A card is a source-grounded exchange with one or more Character participants,
possibly several alternating speakers and brief intervening narration. Sentence
IDs locate source; there is no required speaker/addressee label per sentence.
Label exchanges and participant identities independently before inspecting model
predictions. Mark uncertain memberships explicitly rather than inventing gold.
Candidates, raw requests and outputs must not contain the evaluation labels.

Freeze labels, identity equivalences, source hashes and matching rules before
comparing versions. Match predicted cards to labelled exchanges by source-span
overlap, not participants or summaries; use deterministic one-to-one maximum
overlap matching above a declared threshold. Report unmatched and split/merged
cards separately so oversegmentation cannot inflate recall. A shared logical
card clipped by scene joins is reassembled by card ID before scoring.

## Required measures

- Correct, wrong and missing participants are distinct. Wrong means a predicted
  member unsupported by the labelled exchange; missing includes absent/held
  supported members. Report counts and denominators, micro precision/recall/F1,
  exact-set card accuracy, and unmatched predicted/gold cards.
- An empty participant set is an unresolved card, not a successful abstention
  or zero-error accuracy win. Track fully/partly unknown cards explicitly.
- Track identity conflation and duplicate identities separately. Do not equate
  aliases merely by containment or generic descriptions to improve a score.
- Show raw extraction versus canonical after-review results and transitions:
  wrong membership removed/corrected, supported membership retained/lost,
  newly wrong membership and missing membership recovered. Holding is not repair.
- Boundary imperfections, a little narration and missing minor detail are
  diagnostics, not automatic review failure. Wrong participants and wrong
  identities remain consequential. Co-membership does not verify a directed
  utterance, relationship, emotion or state change.
- Report applied/held/unfinished blocks, verified/held/rejected memberships,
  source coverage and independent review receipts. Report tokens including
  provider caches, calls, failures and completed-run latency separately from
  stopped-run elapsed time. No replay claim substitutes for a fresh live run.

Historical sentence-level labels cannot be mechanically rebranded as a new
card-level gold standard. No card-accuracy percentage is currently established.
Keep source, payloads, labels and private audit reasons out of public reports.

## Implementation acceptance checks

Synthetic tests must cover alternating voices in one card, a three-person
exchange, a monologue, mentioned/bystander distractors, uncertain members,
bounded S1 widening and S2 fallback, alias identity remaps, scene-cut provenance,
independent membership holds and full-source frontend retrieval. The default
path must not emit sentence-speaker attribution requests or create directed
relationships simply because two characters share a card.

PR36 provides related identity-at-birth/EM work. Its actual diff must be checked
for ID remaps, birth-order limitations, concurrency and post-apply gate semantics;
its reported identity scores are not dialogue participation accuracy evidence.
