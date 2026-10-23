# Fragment-at-birth — design spec (draft for ratification, 2026-10-23)

## Problem (live evidence)

The dominant duplicate class in real ingests is **name fragments**: a
known character referred to by part of their name — surname-only
（黄泉川 for 黄泉川爱穗）, given-name-only （美琴 for 御坂美琴）,
short form （食蜂 for 食蜂操祈）, surname （上条 for 上条当麻） — minted
as a standalone entity next to its full-name twin.

Measured on the em-live run (GT vol 1, first 15K chars, 2026-10-23):

| pair | scenes (fragment / twin) | shared scenes | structural score |
|---|---|---|---|
| 食蜂操祈 ↔ 食蜂 | 2 / 1 | **0** | ~0 |
| 御坂美琴 ↔ 美琴 | 5 / 1 | **0** | ~0 |
| 上条当麻 ↔ 上条 | 7 / 0 | **0** | ~0 |
| 黄泉川爱穗 ↔ 黄泉川 | 2 / 1 | 1 | 0.42 |

Narration uses one form or the other per scene, never both, so the
fragments *partition* the text. Consequences:

- Structural EM is blind to them: scene overlap — its core signal —
  is exactly zero. This is the contiguous-partition failure from the
  structural feasibility test, reproduced on live data. No threshold
  change fixes a zero signal.
- The form-based matcher (`novel match`) does nominate containment
  pairs, but only *after* the fragment has been minted, polluting
  every intermediate graph and the gate queue.
- PR #33's variant fold does not cover this class (different
  mechanism: script variants of the *same full form*).

Fragments are therefore an identity problem **at birth**, the same
conclusion as descriptive records — resolve them at the mint
decision, not afterwards.

## Mechanism

A **fragment check** consulted at every Character mint decision:

1. **Trigger (code, not model).** A candidate name C is about to be
   minted as a new Character, and some registered character R
   (registry ∪ entities established earlier in this run) satisfies:
   `formKey(C)` is a strict substring of `formKey(any form of R)`,
   or `formKey(R's canonical)` is a strict substring of
   `formKey(C)`. Containment is computed over variant-folded form
   keys, so the check inherits PR #33's cross-script coverage when
   that lands and uses exact keys until then.
2. **Guards (code).** All must hold, else mint as today:
   - Same kind (Character; v1 scope is Characters only).
   - The shorter form is ≥ 2 characters (1-char containment is too
     weak to even ask about).
   - C is not already an exact form of R (that is the ordinary fold,
     not a fragment).
   - C was not declined for R before (memory, step 5).
   - If C is flagged *descriptive*, the descriptive birth check owns
     it — a candidate gets at most one birth round per scene:
     descriptive first, fragment for name-shaped candidates.
3. **The Jev round (load-bearing).** One choice question per
   fragment candidate, batched into the scene's existing birth-check
   call where one exists: options = the canonical names of all
   containment-matched registered characters + `NEW_PERSON`. State =
   the passage (the scene/chunk sentences where C is used) + the
   candidate list with forms. Instruction core: "A shorter name
   contained in a longer one may still be a DIFFERENT person —
   relatives sharing a surname, clones, a teacher and a student.
   Attach only when the passage treats the fragment as the same
   person; choose NEW_PERSON on introduction markers or any doubt."
4. **Verdict.** Attach only at confidence ≥ **0.85** (the
   alias-at-birth house threshold; the real test measures the
   confidence separation and may justify 0.9 — see Test plan). On
   attach: C is recorded as a form of R (kind `alias`), the mint
   never happens, scene rosters resolve C → R downstream, and the
   decision is written into the scene notes
   (`fragment-at-birth: "食蜂" folded into 食蜂操祈 (Jev confidence
   0.9x)`), visible at the gate. On decline or failure of the round:
   mint exactly as today — the check never blocks ingestion.
5. **Memory.** Declined (C, R) pairs are remembered per novel in
   `matching.json` (a `fragmentDeclines` list next to EM's
   `distinct` records) so the same question is not re-asked every
   block. The memory suppresses only the *birth question*; the pair
   remains fully eligible for EM and `novel match` later — a
   declined fragment that accumulates evidence can still be merged
   by the backstop.

## Why the Jev round is not optional

Naive substring folding is dangerous in this universe: 御坂 can be
御坂美琴 or any of the Sisters; 黄泉川 can gain a same-surname
relative; a surname-only narration can introduce a *new* person
before disambiguation. Code computes containment exactly (rule
zero), but sameness is a judgment over the passage — that is
precisely the split the strict round exists for. The descriptive
policy test is the calibration precedent: the tempting wrong
attachment leaned 0.66 and was refused by the 0.85 line, correct
attachments came in at 0.94–0.99.

## Birth sites (implementation mapping)

- **Primary — faculty identity stage** (the default live path):
  the fragment round rides the same per-scene batched decide call
  as the descriptive birth check (keys `fragment:<name>`), resolved
  at the same point in `resolveDescriptiveBirths`' flow, before
  declarations reach extraction. Candidates include same-scene
  proper-name declarations, as with descriptions.
- **Secondary — miniloop name patch** (legacy/no-faculty path): the
  name patch already puts new candidates to Jev. No new round —
  instead the containment match is injected as explicit evidence
  into the existing question ("this candidate is contained in
  registered name X") with the same strict instruction. ⚠️ This
  touches DecisionPatch question design — flagged for explicit
  sign-off as part of ratifying this spec.
- **Extraction mint path:** unchanged in v1. It inherits verdicts
  from whichever upstream stage produced the scene (faculty scenes
  carry fragment verdicts; miniloop scenes carry the patch
  decision).

## Interplay

- **Alias-at-birth (descriptions):** runs first; mutually exclusive
  per candidate per scene.
- **Variant fold (PR #33):** containment over `formKey()` upgrades
  automatically when the fold lands; no spec change needed.
- **EM faculty:** fragment-folded forms are existing aliases → the
  pairs are excluded from EM nomination by the standing rule.
  Declined pairs stay EM-eligible.
- **`novel match`:** unchanged; remains the post-hoc net for
  fragments born before this feature or declined at birth.

## Known v1 limits

- A fragment and its twin born in *different scenes of the same
  block* may miss each other (candidates are run-established
  entities; concurrent scenes race). The backstop owns those.
- Characters only. Location/Organization fragments （学园都市 short
  forms etc.) are the same shape but unevidenced; generalize only
  with data.
- Cross-script fragments with no shared substring （安娜 vs "Anna")
  are untouched — that remains EM's scale game.

## Test plan (real-test before PR, per the standing bar)

1. **Offline policy test** (the alias-at-birth method): the four
   live fragment pairs above + traps labeled from the text —
   candidates that are substrings but different people, incl. the
   bare 御坂 record's referent checked against the Sisters problem
   by hand-labeling the slice. Report: folds correct / false folds
   (the dangerous class, target 0) / Jev confidence separation at
   0.85 vs 0.9.
2. **Fresh live re-ingest** of the 15K slice with the feature on:
   success = none of 食蜂 / 美琴 / 上条 / 黄泉川 minted standalone;
   all other entities unchanged in kind; scene notes carry the
   fragment-at-birth lines for audit.
3. Unit tests alongside: containment trigger + guards, memory
   suppression, batched-round wiring through FacultyGraph with
   mocks (the alias-at-birth test pattern).

## Decisions embedded in this spec (ratify or amend)

1. Threshold starts at 0.85, revisable to 0.9 on test evidence.
2. Shorter-form length floor: 2 characters.
3. Miniloop site = evidence injection into the existing name
   question (no new round) — needs your sign-off (patch design).
4. Declines remembered in `matching.json`, suppressing only the
   birth question, never later matching.

## Live results (2026-10-23, added with the implementation)

Offline policy check (real Jev, passage windows, the four live
fragment pairs): **4/4 fold at confidence 1.00** （食蜂→食蜂操祈,
美琴→御坂美琴, 上条→上条当麻, 黄泉川→黄泉川爱穗).

Fresh live re-ingest of the same 15K slice with the feature on:
**2 of 4 fragment classes resolved at birth** — 美琴 and 御坂 both
folded into 御坂美琴's record (fragment notes at 0.94/0.96), 上条
folded into 上条当麻. The two misses trace to this spec's own named
v1 limits, not to the round: 食蜂 was minted before 食蜂操祈 entered
the registry (birth-order race; the descriptive 蜂蜜色少女 then
attached to the fragment record at 0.99), and 黄泉川's records were
born through extraction's cast-name mint path, which v1 explicitly
leaves unguarded. Closing those is the v2 question — guarding
extraction's mint path — and sits in the owner's keep-list
territory, so it is proposed, not built, here.
