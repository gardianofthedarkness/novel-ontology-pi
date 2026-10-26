# Story time and places — phase 1

Status: **phase 1 implemented**, 2026-10-26. Hierarchies, spatial relations,
real-world grounding and cross-volume time alignment are later phases (see
[series, universes and story time](series-universe-time.md)).

## Model

Granularity is the **scene**, not the event. Time and place words become
entities that one or more scenes belong to:

| Fact | Meaning |
| --- | --- |
| `TimePoint` entity | One time anchor: the words as written, a normalised value when the words state one, its role, flashback mark and certainty, the period it was told from, a stated-or-derived date, narrative and estimated story order. |
| `Scene -OCCURS_DURING-> TimePoint` | `via: "anchor"` when the scene contains the anchor; `via: "inherited"` when it continues an earlier period. |
| `Scene -LOCATED_AT-> Location` | The scene happens at a proper-named place (an existing or new `Location`). |

A **period** runs from one anchor to the next — the owner's model. A
flashback opens a past period "told during" the present one; it closes on a
RETURN, or when Jev says the next scene is back in the present (most
flashbacks end silently at a scene break). Scenes before the first time word
stay "time not stated": no anchor is invented.

## Pipeline

1. **Vocabulary** — `programmatic` (rule lexicon), `llm` (work model lists
   time/place words verbatim per sentence) or `hybrid` (both; the rule value
   wins where they overlap). Code rejects any item that is not in its
   sentence, drops bare connectives (之后, 然后…) and spans without a quantity,
   and parses LLM phrases with the same rules.
2. **Roles** — programmatic first: a sentence that is only a time phrase, or
   "时间到了 X" / "X 开始了", is rule-decided ADVANCE. Quoted speech and
   （inner thoughts） default to REFERENCE. Soft words (holiday, season, part
   of day, month-only date) are checked only near a scene's start or as a
   leading time phrase. Everything else goes to **Jev** with the story state
   (current anchor, current date, open flashback), one call per scene:
   ADVANCE / FLASHBACK / RETURN / REFERENCE with the full distribution.
   A FLASHBACK needs confidence ≥ 0.6, or FLASHBACK probability ≥ 0.5 on a
   past marker; an ADVANCE/RETURN below 0.5 stays a reference. Unsure
   decisions are kept in the report as `downgraded`.
3. **Periods (code)** — micro jumps (seconds, minutes, "after a while") do not
   open periods. Dates are derived only from stated words: a dated period plus
   "第二天" gives the next date; an earlier part of the day after a later one
   ("morning" after "late night", or after an eve) is the next day; a bare
   day of the month takes the current month. Derived dates are labelled.
4. **Story order (estimated)** — the present line in reading order; each
   flashback before the period it was told during, or — when its date is
   comparable — before the first present period dated later.
5. **Places** — proper-named settings become `LOCATED_AT`; quoted places are
   mentions. Generic settings (rooftop, ward, street) stay in the report; they
   are the input for the hierarchy phase.

Runs are **incremental**: only scenes without time facts, seeded from the
book's stored periods (present period, open flashback, date, story order).
Earlier periods whose story position changes are re-proposed. Output is a
`pending_review` ChangeSet; nothing writes canon.

## Using it

```
novel timeplace run <dir> [--mode hybrid|llm|programmatic] [--no-jev] [--chapter N] [--propose] [--cache dir]
novel timeplace show <dir>
novel changeset approve <dir> <id> --time-place     # after a block is approved (gate mode)
novel ingest <dir> <file> --time-place              # inline, for blocks approved during ingest
```

`--cache` reuses identical model replies (re-runs pay only for what changed).
`--force` re-runs selected scenes from scratch; because proposals cannot
retract relations, prefer incremental runs on a book with stored facts.

## Viewer

Beside the Narrative view (reading order), two views read the applied facts,
in both Orbital and Traditional mode ([playground views](playground-views.md)):

- **Story time** — periods in story order, earliest at the top; flashbacks
  offset, with when they were told and Jev's certainty; a reading-order
  ribbon coloured by period, marking where reading jumps back.
- **Places** — a schematic map (not geography): named places sized by scenes,
  lines for moves between consecutive scenes; a character's route in story
  order; a story-time slider with who is where. A scene that names no place
  carries the previous scene's place within the same chapter, always shown
  as carried (dashed / asterisk), never as stated.

Deep links: `?view=story`, `?view=places`.

## Measured (2026-10-26)

Two already-extracted volumes of one series (Chinese), on disposable copies.
Gold labels: every narration time word that could set a scene's time,
hand-labelled by role (113 in volume 1, 90 in volume 2; ambiguous cases accept
either label). Volume 1 was used for tuning; volume 2 was labelled after
tuning on volume 1, but several rules were then adjusted after seeing its
errors (date parsing, connectives, "just as" clauses, past cues), so treat
these scores as tuned, not blind.

| Mode (all with Jev roles) | Vol 1 role accuracy | Vol 2 role accuracy | Flashbacks found (vol 1 / vol 2) |
| --- | --- | --- | --- |
| Programmatic | 1.000 | 1.000 | 2/2, 2/2, no false ones |
| LLM | 0.991 | 1.000 | 1/2, 2/2 |
| **Hybrid** (default) | **1.000** | **1.000** | **2/2, 2/2, no false ones** |
| Rules only, no Jev (vol 1) | 0.823 | — | precision 0.07 |

- Jev is what makes flashback marking usable; the rule lexicon carries most
  of the time vocabulary at no model cost. Hybrid is the default because the
  LLM pass is what finds new named places.
- Past-marker flashbacks are borderline for Jev (one true flashback scored
  FLASHBACK probability 0.53 at confidence 0.37); a false one sat at 0.35.
  The thresholds separate them on these books only together with the
  lexicon rules — expect misses and false marks on other books.
- Places are the weak part: proper-named settings appear in about 20% of
  scenes (15/77 and 18/84); with carry-over, 77/77 and 73/84 scenes are
  placed. A spot check of stated settings found roughly 80% correct; errors
  were titles read as places, mentions read as settings and front/back
  matter treated as scenes.
- Chapter-by-chapter runs reproduce the whole-book timeline exactly.
- Cost per volume (hybrid, uncached): about 130–150 work-model calls
  (~170–185k prompt, ~20k completion tokens) and 70–90 Jev questions; about
  50 seconds.

These are two volumes of one series with few explicit dates; other genres,
languages and time styles are untested.
