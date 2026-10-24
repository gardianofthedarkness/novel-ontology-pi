# EM system evaluation — alias-at-birth, fragment-at-birth, structural EM
### Measured on real Jev (jev-1.13.0) + DeepSeek, 2026-10-23. Companion to PR #36.

## Test beds and ground truth

- **Offline policy tests**: hand-labeled cases judged by real Jev in
  isolation (the alias-at-birth round and the fragment round exactly
  as implemented), ground truth read from the source text.
- **Live runs**: two independent full ingests of the same slice
  （创约·魔法禁书目录 vol 1, first 15K chars, auto-approve, faculty
  path) — `em-live` (PR #36 base) and `em-live2` (with
  fragment-at-birth). Every birth decision below is quoted from the
  runs' changeset review notes; EM verdicts from `matching.json`.
- **Feasibility test**: synthetic twin injection on a real graph
  (spelling-alternated vs contiguous partitions).
- Ground-truth labels were read from the text; the one case flagged
  uncertain during analysis （统括理事长 as a title) was confirmed by
  the repo owner: in this volume the title refers to 一方通行.

## 1. Alias-at-birth (descriptive candidates)

### Offline policy test (5 labeled records)

| candidate | truth | Jev | conf | outcome |
|---|---|---|---|---|
| 蜂蜜色少女 | 食蜂操祈 | 食蜂操祈 | 0.99 | attached ✓ |
| 幼女 | 全裸的幼女 (same unnamed girl) | 全裸的幼女 | 0.94 | attached ✓ |
| 全裸的幼女 | 幼女 | 幼女 | 0.80 | right answer, under threshold — kept |
| 女老师 | NEW (unnamed chaperone) | leaned 黄泉川爱穗 | 0.66 | refused ✓ |
| 看守的男人 | NEW (unnamed guard) | NEW_PERSON | 0.74 | kept ✓ |

Score: **4/5 correct, 0 false attachments.** The universal-EM
alternative scored 2/5 on the same set (both correct by inaction).

### Live run 1 (em-live) — 13 decisions

Attached (3, all correct): 双马尾少女→白井黑子 @1.00,
蜂蜜色少女→食蜂操祈 @0.99, 统括理事长→一方通行 @1.00 (owner-confirmed).
Kept (10): 女老师 NEW @1.00 ×2 ✓, 幼女 @0.98 ✓, 小混混 @1.00 ✓,
污浊幼女 @1.00 ✓, 小女孩 @1.00 ✓, 赤身裸体的幼女 @0.95 ✓,
门卫 @1.00 ✓, 宿管大姐姐 NEW @0.87 ✓ — and 全裸的幼女 NEW @1.00,
the one imperfection: she is the same unnamed girl as 幼女, so the
pair did not unify live (offline, with both records in the
candidate set, it unified at 0.94).

### Live run 2 (em-live2) — 12 decisions

Attached (1): 蜂蜜色少女→食蜂 @0.99 (correct person; the host was
the fragment record — see §2's birth-order limit).
Kept (11): correct refusals 女老师 @0.95, 幼女 @0.95, 污浊幼女 @0.98,
统括理事长 NEW @1.00 (correct for this slice's usage), 看守的男人
@1.00, 宿管大姐姐 @0.82. Strictness/variance misses, all refused
rather than wrongly attached: 金发少女 leaned 食蜂 @0.60 (right
person, under threshold), 双马尾少女 NEW @0.44 (she is 白井黑子 —
a Jev miss this run; run 1 attached her @1.00), 小萌老师 leaned
女老师 @0.64 (wrong lean, refusal prevented the error; correct
target 月咏小萌 missed), 小学女生 leaned 芙蕾米娅 @0.49 (probable
right person, refused), 三花猫 leaned 茵蒂克丝 @0.50 (a cat —
refusal correct).

## 2. Fragment-at-birth

### Offline (4 live fragment pairs, passage windows)

食蜂→食蜂操祈, 美琴→御坂美琴, 上条→上条当麻, 黄泉川→黄泉川爱穗 —
**4/4 fold at Jev confidence 1.00.**

### Live run 2

Fragment round fired twice in the notes, both correct:
御坂→御坂美琴 @0.96, 御坂美琴→御坂 @0.94 (the pair arrived in both
directions across scenes; one record resulted). Final-graph
classes resolved: **2 of 4** （美琴/御坂 folded into 御坂美琴's
record, 上条 into 上条当麻's). Misses, both tracing to the spec's
named v1 limits: 食蜂 was minted before 食蜂操祈 entered the
registry (birth-order race), and 黄泉川's records were born through
extraction's unguarded cast-name mint path. No false folds.

## 3. Structural EM faculty

- **Feasibility (injected twin)**: alternating partition — the
  twin ranks #1 of 47 pairs (score 0.77); contiguous partition —
  rank 16/45 (0.18). Recall is partition-dependent by construction.
- **Universal-EM policy test (strict gate)**: nominated 2 of 95
  descriptive pairs, both wrong (same-scene shadows); Jev rejected
  both from the dossier (same-entity 0.15/0.14). 0 false merges,
  0 true resolutions — the gate + checklist protect precision and
  resolve almost nothing for descriptions.
- **Live run 1**: 0 nominations. Offline landscape check: the top
  pair scores 0.75 but has 1 shared scene / 2 shared neighbors —
  the support floor stops it, and it is a false pair anyway.
- **Live run 2**: per-block passes nominated; 4 verdicts recorded
  in `matching.json`, all DISTINCT: 女老师↔金发少女 ✓,
  女老师↔双马尾少女 ✓, 女老师↔食蜂 ✓ — and 金发少女↔食蜂 ✗, a
  **false distinct** （金发少女 is 食蜂操祈 descriptively; the
  structural dossier cannot see it — the same lesson as the policy
  test: descriptive identity is textual, not structural). The error
  is in the safe direction (a missed merge, and the remembered
  verdict only delays re-review until evidence grows by +2), but
  it is an error and is recorded here as one.
- **Confident merges live: 0 attempted.** The merge path itself
  (audited `mergeEntities`, incl. state-change rewiring) is
  exercised by unit tests, not yet by a live confident verdict.

## 4. Aggregate

- **Attachments/folds attempted: 12** (2 offline descriptive,
  4 offline fragments, 3 live descriptive in run 1, 1 live
  descriptive in run 2, 2 live fragment decisions) — **12 correct,
  0 false.** Precision on consequential actions: 100% at n=12.
- **EM verdicts live: 4, of which 3 correct, 1 false distinct.**
  False merges: 0 in every test and run.
- **Recall is the cost, by design**: descriptive offline 80%;
  fragment classes live 2/4; structural recall ≈ 0 for the
  description/fragment classes at this scale. Everything declined
  remains eligible for the backstops (EM, `novel match`, the gate).

## 5. Caveats

- One 15K-char slice of one novel; n is small and run variance is
  real (cf. 双马尾少女 across the two runs).
- No substring-but-different-person traps exist in this slice, so
  fragment *refusal* precision is inferred from the descriptive
  traps, not measured. The Sisters case is the known untested risk.
- EM's confident-merge path has no live exercise yet.
- Expected movers: volume (structural scores grow with data),
  the proposed v2 guard on extraction's mint path, and a corpus
  with genuine same-surname different-person cases.
