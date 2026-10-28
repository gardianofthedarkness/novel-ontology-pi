# Reviewing a volume's data

For "I found errors in vol 1", "review the data in vol 1" or "something is
wrong with X". The user does not need to say which faculty is wrong; find
it. Work on one book (map the volume through `NOVEL_JOB.json`), verify every
finding against the original sentences, and change data only through the
gate or audited repairs.

## 1. What is unfinished or unverified

`novel checklist <book>`. A `review` item is a packet of unverified facts:
the first place errors live. Review it through the shared gate (show every
page, read the evidence, decide, apply) before anything else. A `todo`
item is missing work; run it after the review (it is part of the answer).

## 2. Where the reported error is

When the user named something (a person, scene, place, date, event):
- `novel search <book> '<name or phrase>'` finds the sentences;
- `novel query <book> 'MATCH …'` reads the stored facts about it (scene
  presence, events, relations);
- `novel timeline list <book>` and `novel timeplace show <book>` show event
  order, story periods and scene places;
- read the original sentences (`sed -n 'A,Bp'` on the source or evidence
  file) and decide whether the stored fact matches the text.

When the user named nothing, audit in this order:
1. `novel inspect <book>`: broken references, missing coverage.
2. `novel timeplace strands <book>` (free without `--ask`), then read the
   report it names (`cat <book>/timeplace/strands-….json`):
   - `checks` with `conflict`: one person at two places at one stated
     moment — the time, the place or the cast of one of the two scenes is
     wrong; read both scenes;
   - splits or meetings `unplaced` or at the `same place`: a place may be
     missing or a scene boundary may be wrong;
   - `guessedCasts`: scenes whose cast was borrowed from a neighbour. If the
     strands item of the checklist is `todo`, run `novel timeplace strands
     <book> --ask` (paid, bounded) so those scenes get a real cast.
3. Spot-check the scenes the user cares about (or the busiest characters)
   with `novel query`, comparing presence with the text: a name in thought,
   memory, talk or on the phone is not presence.

## 3. Fixing it

- A fact still in a packet: `novel review decide` it — reject what the text
  disproves, hold what it cannot settle — then `apply`.
- A canonical entity error (two records for one person, a wrong name, a
  wrong relation): `novel fix merge|rename|add-form|relate|unrelate|…
  --reason "<source-grounded reason>"` (see [repair](repair.md)).
- A wrong cast or event in an applied block: pin the source-verified
  correction (`novel fix correct … --key extraction:constraints`) and tell
  the user that a recall re-extracts the block (paid, replaces its facts);
  recall only on their go-ahead and with a rollback plan.
- After a change, re-run `novel checklist <book>`: story time, strands and
  the graph may need to catch up; run what it lists.

## 4. Report

In plain words: each error the user reported — found or not, what the text
says, what was changed, what is held and why — then anything else the audit
found, and what the paid steps spent. Never present a held or unverified
fact as known.
