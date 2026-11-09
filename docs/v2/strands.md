# Strands: groups in envelopes (the user, 2026-11-09)

> "The idea of strand is a timeline performed by a group of people in a limited, enveloping area. The destructions and
> physics engine doesn't interfere another strand. If the time is the same by mentioning the two groups united, the
> strands reunify into one. Today our strands simply diverge." — the user, 2026-11-09, revisiting the strand system
> before the cross-book carry (M16) and the first volume 2 run (W16).

Built 2026-11-09 (M17a–d, the user: "I agree let's build it"): the builder (§3), the run on it, a world layer per strand
(§4), re-stranding a run after smoothing (§5). §2 is what it measured on volume 1. **§0 revises the split rule** (planned
as M17e–g): the scale is no longer set; strands split and unite by interaction.

## 0. Revision: the scale comes from the context (the user, 2026-11-09, after M17a–d)

> "The stranding system should be dynamically scaled not building or street specific. As long as the group splits on
> different things and no longer interact with each other on semantic scale, they become two strands. When they
> reunited the strands become one. Whether scale is building street what ever depends on the context." — the user,
> 2026-11-09, on M17 as built.

M17a–d decide a split by place: two envelopes apart at a fixed scale (the setting `strands.envelope`, a district). The
revision decides it by interaction, and the envelope is read from where the strand happens:

1. **A unit's group is the people acting in it**: acting, speaking or spoken to (the unit's `evidence`), not the cast
   held in view. People held in view ride along and neither split nor unite strands. As built, the group is the whole
   present list (held for 30 lines), which pulls every split straight back into the main strand.
2. **A split** is part of a strand's group acting in a unit while the rest of that group is next told acting in a unit
   where none of these people is in view: they are doing different things and no longer interact. No place scale
   enters. Two rooms of one building and two ends of the city are alike.
3. **A union** is a unit where people of two or more strands act. Someone of another strand merely held in view does not
   unite them.
4. **The envelope is read, not set**: the smallest place holding the strand's units over its stretch, at whatever scale
   those places are (room, building, street, district, city). Physics stays per strand (§4) whatever the overlap; the
   envelope is what the page and the cross-book registry show.
5. **A unit is one group in the text**: the reading's cut is its own semantic boundary. 24 units of volume 1 have acting
   people in two groups no card links (16 one after another, 8 interleaved, most one person a line or two from the
   other); they are reported as a check, not split.
6. **In a run**, a unit's acting people are clustered by where they stood: people within earshot (`talk.earshot`, 25 m)
   chain into one group, and people the text has interacting in the unit (one card, or one event) stay one group at any
   distance, the distance reported as a run fault. A cluster out of reach and not linked is a sub-unit (`~2`), as in M17d.

The links are the cards' (people acting, speaking or spoken to in one card) and the script's events (their actors).

**Measured with a prototype** (volume 1, library 16, read only):

| Strands of volume 1 | Strands | Splits | Unions | Open at the end |
| --- | --- | --- | --- | --- |
| v1 lanes | 28 | | | |
| M17a, district scale | 2 | 0 | 1 | 1 |
| By interaction, the text | 21 | 20 | 17 | 4 |
| By interaction, the W15 run | 31 | 25 | 20 | 11 |

- **The text's shape.** The main strand (145 units, 12 to 286 with gaps); a second line from it at unit 68 that goes on
  to 165 and comes back at 169 (60 units); a third from 83 to 156, back at 217 (15 units); the group of 32–38, into the
  main at 66; and a string of short ones, many of one person for one to three units (someone alone doing something else
  while the others are told), each back in the main or in another strand. Of the 4 open at the end, one is unit 1 with
  nobody acting in it (to fold into the first strand when built).
- **The scale by context.** Of the text's 21: 2 in a room, 2 in a building, 2 in a street, 1 in a district and 14 at the
  city, the last because the text places most units only at the city's scale. A run's built sites give finer ones.
- **The run against the text.** 20 strands are in both. The run adds 11: six are people standing more than 25 m from
  their unit's group without interacting with it (in units 52, 95, 127, 163 and 221), five are units split from the
  main differently because someone stood apart. The text has one (unit 236) the run keeps in the main.
- **A new run fault.** In 16 units the run stood 54 pairs of people the text has interacting more than 25 m apart (13
  units, 43 pairs at 50 m); the widest group spans 183 m. This goes in the inspection beside the moved units.

### 0.1 Latency: a strand lands only when they are seen apart long enough (the user, 2026-11-09)

> "Can you add a latency such that strand lands only when we see they seperate long enough and test it out?"

7. **Latency.** After the walk, a strand that left another (or a new group that joins one) and is seen apart for fewer
   than `strands.latency` lines (the lines told on its own units; a sub-unit is told beside its unit) folds back: its
   units go to the strand it left (they never really left it), a new group's to the strand it joins, else to the one
   being told. Shortest first, until none is left; the folded strand's links are renamed to the one it folded into. The
   default is **40 lines**, about four units (a unit's lines: median 10, p90 41; volume 1 has 5,202).
   A short separation then shares one world layer: a blast while they are briefly apart is seen by both.

Two ways of applying it were tried and set aside. **Counting all the story told between the split and the reunion**
folds almost nothing below 120 lines and never folds a strand that never comes back (a person who stood apart for one
unit and does not act again). **Refusing the split inside the walk and walking again** cascades: refusing the one-person
split of unit 70 put that unit on the main strand, the walk then took the main strand's other people for the rest of its
group, and the second line (units 68–165, 60 units) was read as reuniting with the main at unit 72 and folded away.
Folding after the walk keeps every split and union the full walk found.

Measured by the lines seen on the strand (prototype; volume 1, library 16, read only):

| Latency (lines) | Text: strands | splits | unions | Run W15: strands | splits | unions | Text strands also in the run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 21 | 17 | 17 | 31 | 20 | 20 | 20 |
| 10 | 18 | 14 | 15 | 25 | 16 | 16 | 16 |
| 20 | 13 | 10 | 11 | 20 | 13 | 14 | 13 |
| 30 | 11 | 8 | 9 | 17 | 10 | 11 | 11 |
| **40** | **10** | **8** | **8** | **15** | **9** | **9** | **10** |
| 60 | 10 | 8 | 8 | 13 | 9 | 9 | 10 |
| 80 | 9 | 7 | 7 | 10 | 8 | 8 | 9 |
| 120 | 6 | 4 | 4 | 7 | 5 | 5 | 6 |

- **At 40 lines the text is stable** (the same 10 strands up to 60): the main; the opening group of units 2–11; the group
  of 32–38; the second line 68–165 (back at 169); the third line 83–156 (back at 217); 130–136 (from the second line,
  into the third at 140); 146–150 (from both, into the main at 151); 187–200 (back at 201); 245–247 (back at 250); and
  unit 1 with nobody acting (to fold into the first strand when built). Folded: eleven short ones, 3 to 30 lines, each
  one or two people for one to three units, all into the main except one into 187–200.
- **Every text strand is in the run at 40 lines.** The run's 5 more are 4 people standing out of reach of their group
  without interacting in long units (52 twice, 127, 163; each seen 40 lines or more because the unit is long, and never
  acting again) and a group of 220–225 (7 units, 3 people) the run kept apart. They are run findings for the inspection.
- **Past 80 lines real lines fold**: at 120 the 187–200 and 245–247 groups go, at 160 the 130–136 group.

### 0.2 Latency by the new group's next dialogue or action (the user, 2026-11-09)

> "Try latency by next dialogue or action happens for the new group"

The same fold after the walk, measured in **beats** instead of lines: a beat is one conversation (a dialogue card; every
spoken line of volume 1 is inside one) or one action outside a conversation, with one of the unit's acting people of the
strand taking part (acting, speaking or spoken to). Volume 1 has 456 (212 conversations, 204 actions outside one; a
beat running across units counts in each). Readings of "next" tested (prototype; library 16, read only; the user then
asked "What about the next beat in the next segment", the last two rows):

| Lands when the new group has | Text: strands | splits | unions | Run W15: strands | splits | unions | Text strands also in the run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| one beat while apart | 21 | 17 | 17 | 31 | 20 | 20 | 20 of 21 |
| two beats: the one that shows them apart, then the next | 17 | 13 | 14 | 17 | 13 | 14 | 16 of 17 |
| three beats | 13 | 10 | 11 | 14 | 11 | 12 | 13 of 13 |
| one beat in any unit after the split unit | 14 | 11 | 12 | 14 | 11 | 12 | 13 of 14 |
| **a beat in the group's next segment** | **14** | **11** | **12** | **14** | **11** | **12** | **13 of 14** |
| a beat in the very next segment told in the story | 9 | 7 | 7 | 10 | 8 | 8 | 9 of 9 |
| (for comparison) 40 lines seen apart, §0.1 | 10 | 8 | 8 | 15 | 9 | 9 | 10 of 10 |

A first count let a new group (one that left nobody: a person first seen, or a sub-unit of the run) never fold under a
beat rule; corrected, the table is the corrected count. That one fix took the run's two-beat count from 24 to 17.

- **One beat folds nothing**: a split begins with someone acting, so every split strand has one.
- **Two beats** folds the four text strands of one person, one unit and one beat (units 70, 236, 248, 273), and keeps
  197, one person with two beats in one unit. In the run it also folds every person who stood out of reach of their
  group for one unit without acting again (units 52 twice, 95, 127, 163, 221).
- **The group's next segment** (the next unit of the strand in which its people appear; a unit nobody acts in rides on
  the strand being told and is skipped, else the main strand of 145 units folds at its second unit, 13): the split
  lands only when the group's next segment has a dialogue or action of theirs. It folds the text's 70, 183–185, 197,
  236, 245–247, 248 and 273: their next segment has no beat, or there is none. Kept: the main, the opening group 2–11,
  32–38, the lines 68–165 and 83–156, 130–136, 146–150, 187–200, and the short ones 166–171 (one person), 170 and 172,
  213 and 215, 214 and 241, 238–242. The run agrees on 13 of 14: it splits 170 from 172 and keeps the group of 220–225;
  every one-off person standing apart folds. Counting narration in which they act as a beat changes nothing here.
- **The very next segment told** (the story stays with the new group and they act at once) is the strictest: it folds
  166–171, 170–172, 213–215, 214–241 and 238–242 as well, leaving the 9 long lines.

### 0.3 Reunite at once on a shared beat (the user, 2026-11-09)

> "How about reuniting. I think reunite should be immediate after two groups have interactions beat"

8. **A union is a shared beat**: a conversation (dialogue card), an action (in or out of a conversation) or an event in
   which people of two strands act, speak or are spoken to. The strands reunite in that unit, with no latency: the
   latency (§0.2) only ever holds back a split. Strands whose people act in one unit without a shared beat stay apart
   (`beside`): when built, such a unit is cut into a sub-unit per group, as a run's are, so each plays on its own strand.

Measured with the next-segment latency (prototype; library 16, read only):

| | Unions by co-acting in a unit (§0) | Unions by a shared beat | Strands | Units with groups side by side |
| --- | --- | --- | --- | --- |
| Text | 12 | 12 | 14, unchanged | 1 |
| Run W15 | 12 | 12 | 14, unchanged | 1 |

- **Volume 1 nearly always reunites with a beat**: 11 of 12 unions are the same. The one that moves: the group of
  146–150 acts beside the main in unit 151 without a shared beat; its people stay in view there through unit 160, and
  it reunites at unit 177, where one of them talks with the main group. Under the beat rule they are apart for those 26
  units although the text holds them in one place, in view of each other. Text and run move it alike.
- **Which strand keeps its id** follows the most units, so the main's id can change hands at a union: without the 146
  group's units, the main closes into the line of 68 at unit 169. The id is a name only; the build should keep the id
  of the strand that began first, so the main keeps its name.
- **Beats against lines.** Beats follow what the group does, lines follow how long the telling is: a long conversation
  is one beat, a quick exchange of actions is several, and a long unit of narration is none. With beats a strand of
  short scenes where the group talks again lands; with 40 lines it folds unless the telling runs on.

### 0.4 Read against the text (the user, 2026-11-09)

> "Can you do the stats again with reunion and actually look at the texts to figure out if it make sense?"

Every split, union and fold of the rules of §0–0.3 (splits by interaction, the next-segment latency, reunion on a
shared beat, the strand begun first keeping its id) was read in the book's own lines (privately; nothing of the text
is copied here). Of the 13 strands besides the main, 6 were right and 7 were wrong. Two causes, both fixed in the
prototype and measured:

9. **A group is the people acting together, not everyone held in view.** As in §0 the group was refreshed with
   everyone in view on the strand, so a person held in view at one unit and acting much later elsewhere made the people
   here "leave". This made the second line of units 68–165 (people held in view at unit 66 acting later at 70 and 83),
   split one side of a fight in two (unit 170: the third person was only held in view at 169 and acts at 181), and cut
   one fight at 183 and 187 (a person who acted at 182 acts next at 204).
10. **The rest is apart only when its next appearance is out of view of the people here.** The rest's next *action*
   skipped units where it is in view with them: in units 213–216 everyone is in one room, but one person's next action
   is at 218, so 213 and 214 split off.

With both, reunion by a shared beat and reunion by acting in one unit give the same unions on volume 1 (the case of
unit 151, §0.3, falls inside one strand: a capture, the captive carried by the captor).

| Rules | Text strands | Splits | Unions | Folded | W15 run strands | Text strands also in the run |
| --- | --- | --- | --- | --- | --- | --- |
| §0–0.3 | 14 | 11 | 12 | 7 | 15 | 13 |
| and 9: the group is the people acting | 10 | 7 | 8 | 2 | 11 | 10 |
| **and 10: the rest's next appearance** | **8** | **5** | **6** | **2** | **9** | **8** |

The 8 text strands, read:

| Strand | Units | What the text does | Verdict |
| --- | --- | --- | --- |
| unit 1 | 1 | opening narration, nobody acts | an artifact: fold into the first strand when built |
| the main | 225 | | |
| 12–23 | 12 | one of two people escapes alone, meets a third, whose chase follows; back when the third meets the one left behind (24) | right; the union closes the whole strand at 24 though the escaper arrives at 26 |
| 32–38 | 7 | another pair in another place | right; joins everyone at 66 |
| 83–156 | 15 | an interlude in a closed room, then that pair's own line | right; joined by 130 at 140, into the main at 217 |
| 130–136 | 7 | two people leave the others and meet a stranger | right; into 83 at 140 where they meet |
| 146–168 | 16 | a group that leaves both lines; one of them is taken captive and carried off (150–161) | right; into the main at 169, in a fight |
| 166–171 | 3 | one person alone, then turning on someone in a fight | right, but the union lands at 175: the reading has no shared card at 171, where the fight begins |

Folded, both right: unit 70 (one person walking into a shop with the group) and unit 197 (a one-unit cutaway of an
explosion). The run's one more strand, 220–225, is one scene in the text: the run stood one person more than 25 m from
the others (a run fault, already counted in §0).

**Left as it is, for the user:** an interlude not cut in with the main (units 244–248: a schemer and a partner in
another place, then a third person at a computer; the schemer faces the main group at 250) stays on the main. Under the
rules a split needs the rest told meanwhile, and nobody else is told between 244 and 249. It is a different group doing
a different thing, but no other strand runs beside it, so no physics can collide.

### 0.5 The reunions, read (the user, 2026-11-09)

> "What about reunion stats, are they also correct?"

The 6 unions of the 8-strand result of §0.4, read in the text (privately):

| Union at unit | What the text does there | Verdict |
| --- | --- | --- |
| 24 | the one who fled meets the one left behind's new companion; the one who fled arrives at 26, all act together at 27 | right in place, but the whole strand closes before half of it arrives |
| 66 | two people imagine aloud what other people would say; the reading credits those imagined lines to two absent people | **wrong**: nobody of the other strand is there |
| 140 | the guard and the chairman argue in a closed room; the reading credits a line of theirs to a person who is falling elsewhere | **wrong**: the faller's fall goes on at 145 and he is caught at 146 |
| 169 | a fight begins between the two strands' people | right |
| 175 | a third joins the fight | right, 4 units late: she turns on the fighters at 171, where the reading has no shared card |
| 217 | the guard, in the closed room, sees the others arrive at the gate on a camera and goes out; they act together at 223; the chairman stays in the room | early, and it closes the chairman's part too |

Two right, two wrong, two off in time. Unit 156 is also on the wrong strand: it is a captor on a phone call, and the
chairman is only named in it. Every wrong case comes from the reading crediting a person with acting or speaking where
the text only names, quotes or imagines them; the latency and the rules take that credit at its word.

11. **A union is confirmed by the next action.** A union stands when, at the next unit where anyone who came from the
    closing strand acts, someone of the other side acts or is in view. Otherwise it is refused (the groups act beside
    each other there) and the walk runs again, until none is refused. The next *action*, not the next appearance: a
    person wrongly credited is then held in view for 30 lines, which confirmed the wrong union of 66 at 67.

| Rules | Text strands | Splits | Unions | Unions refused | W15 run strands |
| --- | --- | --- | --- | --- | --- |
| §0.4 (rules 1–10) | 8 | 5 | 6 | | 9 |
| and 11: a union confirmed by the next action | **6** | **2** | **4** | 24, 66, 140 | 7 |

With rule 11: the wrong unions of 66 and 140 are refused and the strands they cut come back whole: the guard and the
chairman's line is 32–38, 83–87, 137–145 (and 156), into the main at 217; the faller's line is 130–136 and 146–168, into
the main at 169 in the fight. The union of 24 moves to 27, where all three act together. Left: 175 still 4 units late,
217 still 6 units early and still closing the chairman's part with the guard's, 156 still on the wrong strand. These
need the reading's credit fixed (who acts in 140, 156, 171 and 217), or a union that moves only the people who met (the
chairman stays apart when the guard goes out). The run agrees with the text on all 6, and adds the run fault of 220–225.

### 0.6 The reading's credit fixed (built; the user, 2026-11-09: "Yes let's fix it")

Every wrong union and wrong unit of §0.4–0.5 came from a credit: the roles of the reading put a person in a line
through a description ("the girl", "the big sister", "the Number One") or as the one spoken to, and the description
was someone else's, imagined, or on a phone. The roles keep how they got there (`via`, the description), so the fix is
code over the saved reading, with no new paid reading.

**The credit check (built):** `corroborateCredits` in `src/v2/rules/presence.ts`. A credit is weak when it came through
a description that is not one of that person's aliases, or when the person is the one spoken to. A weak credit puts the
person in a unit only when the unit also names them or credits them strongly, or the unit before names or credits them;
otherwise the card keeps them as described, and the line's role loses them (`id: null`, `unbacked` keeps who the
reading had). An alias is a description that, across the book, credits one person only and credits them at least once
where they are named ("the Number Three" for the fighter). People the text only describes (slots) are never weak. A
credit spanning units keeps the units that back it. It runs where new readings build their cards (`flow.ts`) and where
the world engine loads a saved reading (`segments.mjs segmentWorld`, for the director and the pre-film casts), behind
the setting `director.backCredits` (on; off plays as before). Tests: `test/v2-presence-credits.test.ts`.

**Volume 1:** 23 of 443 unit credits demoted. Read against the text, 21 are right: imagined speakers (66), titles and
descriptions of one person read as another (24 and 27, where the girl who calls out is the one who fled, not the one
left behind; 140 and 217; 142, 143 and 231; 151, 168 and 181; 252 and 254), speech to a stranger read as to a known
person (253, 284, 285). Two are real people (60 and 64), who stay in view through the hold.

12. **An action aimed at someone is an interaction** (for strands): in an action's line, the one acting and a person
    named in that line who is in the unit; the person aimed at takes part in the unit's union. "She turns her gaze to
    the fighter" at 171 now reunites there (prototype, for M17e).

| Rules (prototype) | Text strands | Splits | Unions | Unions refused by rule 11 |
| --- | --- | --- | --- | --- |
| 1–11 on the reading as saved (§0.5) | 6 | 2 | 4 | 24, 66, 140 |
| 1–12 on the checked credit | **4** | **1** | **2** | none |

The 4: the main; the guard and the chairman's line (32–38, 83–87, 137–144, and 156), into the main at 217; the faller's
line (130–136, 145–155, 157–161, 168), into the main at 169 in the fight; unit 1 with nobody acting. Folded: 70, 197,
and the lone costumed girl of 166–167, who now rejoins at 171, two units after she is first seen. With the false
credits at 24 and 27 gone, the one left behind at unit 11 is next told at 58, together with the one who fled, so the
flight of 12–23 is no longer a strand: the case of an interlude not cut in with the main (§0.4). Rule 11 refuses nothing
now; it stays as a guard. Still open: 217 is early (a camera) and closes the chairman's part with the guard's, and 156
stays on the guard and chairman's line (the chairman spoken to on a phone, backed by the unit before).

**What it does to a played run** (the first quarter rehearsed with a stand-in Jev, unpaid):

| Measure | Before the check | With it |
| --- | --- | --- |
| largest smoothing correction (m) | 623 | 397 |
| metres outside the frame after smoothing | 792 | 231 |
| far back-and-forth while talking (m) | 288 | 217 |
| speaker-present law (L6) broken | 0 | 5 |

The 5 L6 are all unit 26: two people talk 91 m and 40 floors apart. Before the check the wrong credit at 24 had the
protagonist "spoken to" by someone on a rooftop, so he was walked up 40 floors and stood, by chance, near the fighter,
whom the stand-in had sent up an office tower at unit 14; the text has both at a subway exit on the ground. With the
check he stays on the ground and the fighter's height shows. A real run asks Jev the kind of talk there (the stand-in
does not). With the setting off, the rehearsal is the one before, 212 of 213 measures equal (the 213th a timing).

The W15 run was played with the old credits: re-stranded under the checked presence it gives 7 strands (people stood
where the old credit put them) until a run is played with the check.

**What it changes in what is built:**
- M17e: rules 1–12 (the credit check is built; rule 12 is the strand builder's); the group is the people acting together (rule 9); the split test reads the rest's next appearance
  (rule 10); the union keeps the id of the strand begun first; the latency is the next-segment beat (§0.2), the fold
  after the walk; a strand of nobody folds into the first. The strands file keeps each folded strand (`folded`: its
  units, its beats, where it went) for the review.
- M17a: the walk's place tests become the interaction tests; the setting `strands.envelope` goes; `envelopes()` stays
  for the envelope read from the places and the stated-time conflict check.
- M17b: the director's units keep one strand each; a rehearsal measures the change.
- M17c: unchanged, keyed by strand; more strands are more layers, cheap while copy-on-write.
- M17d: `runUnits` groups by distance and the text's links, not by site envelopes; `--envelope` goes; the report gains
  the pairs the text has interacting that stood beyond earshot.
- M16 reads the open strands by interaction.

## 1. The definition

A strand is three things at once:

| | What it is | What it means for the engine |
| --- | --- | --- |
| **the group** | the people performing it | a person is in one strand at a time; a person's state (where they stand, since when) is the strand's (L1) |
| **the envelope** | the limited area the group performs in: the smallest place of the tree, at or above the envelope scale, that holds the group's scenes; it moves with the group when the whole group moves | the physics of the strand (blasts, rubble, things moved) happens inside its envelope and in its own world layer: it never touches another strand |
| **the timeline** | its scenes in story order | the director plays a strand in its own order; a strand is smoothed on its own |

Three rules follow:

1. **A split** is a sub-group performing in another envelope while the rest of the group stays. A person stepping into
   another room, another building, another street of the same envelope is not a split: the strand goes on, with that
   person elsewhere inside it. *(As built in M17a; superseded by §0: a split is a sub-group that no longer interacts
   with the rest, at whatever scale.)*
2. **A union** is a scene whose people were last in two or more strands: the text has the groups together, which *is*
   the statement that their time is the same. From that scene on they are one strand, with both histories: the larger
   strand (most scenes) keeps its id; the others close into it (`unites`), and their world layers merge into its own.
3. **Open or closed.** A strand not closed by a union is open; at the book's end the open strands are the candidates
   the cross-book carry reads (resolved or broken off: docs/v2/borrow-and-spawn.md §4.5, M16a). A strand closed by a
   union lives on in the strand it joined.

A flashback is a strand of its own in the past: it plays from the past's state and hands nothing on (L1, v1's law 3).

## 2. Before and after, measured (volume 1, library 16)

**Before.** v1's strands ran on the v2 world script (`scriptStrands`, world-engine-v2.md §2.0.7a): each person's scenes
a chain; a scene continued the lane of the predecessor it shared most people with when it was that predecessor's best
continuation, else it opened a lane; a fork was a lane run.

- **28 forks, 18 of them one scene.** The main fork held 229 of 286 scenes. Of the 27 side forks, 16 started in the same
  street as the main fork's scene just before them; 6 in another district; 5 unplaced. Someone stepping out for one
  scene was a fork.
- **Time evidence is thin.** 3 scenes in the book carry a stated time node; every other node is inherited. Ordering is
  nearly all shared people (worldlines); so "the same time" can only be read from the text having the groups together.
- **The world was one.** The director played the segments in reading order in one world; a blast in a side fork was seen
  by every later scene of every fork.
- **Unions existed but were not kept as such.** 3 forks came from two forks; the file said nothing about what was united
  and when.

**After** (the builder of §3 on the same 286 units, the built tree from the terrain registry; read only):

| Envelope scale | Strands | Main strand | Side strands (units) | Splits | Unions |
| --- | --- | --- | --- | --- | --- |
| v1 lanes (before) | 28 | 229 units | 27, 18 of one unit | — | not kept |
| building | 5 | 272 units | 32–38, 70, 162–165, 166–167 | 2 | 4 |
| street | 2 | 284 units | 166–167 | 0 | 1 |
| **district** (the default) | **2** | **284 units** | 166–167: one person alone in another district, into the main at 171 | 0 | 1 |
| city | 1 | 286 units | — | 0 | 0 |

The plan's first estimate (18 strands at the district scale) came from a prototype without the built tree and without
the "told elsewhere meanwhile" rule; it was wrong. Volume 1 is, by the text, one group's story with one short absence.
The 28 forks were over-stranding: every one of the other 26 was someone stepping out inside the envelope or a place
the text left coarse. A book whose action stays inside one district would set `strands.envelope` to `street`.

**The run on them (M17b).** The director's segment strands regenerated through the wired pipeline are the builder's for
all 286 units. The first quarter (units 1–84) rehearsed before and after: 188 of 189 measures identical (one lead
count 25 to 24): the first quarter of volume 1 has a single strand either way, so nothing in its play depends on the
change, and nothing broke.

## 3. The builder (M17a, built)

One builder for the book's file and the director's segments: `groupStrands(script, { envelope, tree })` in
`src/v2/extraction/strands.ts`, bound to a book by `world-engine/director/strand-builder.mjs` (the envelope scale from
the setting `strands.envelope`: universe, book; default `district`; the built tree from the terrain registry). The
director, the pre-film casts, `why-walk` and `experiments/v2/strands.mjs` are all handed the same strands.

**Envelopes** (`envelopes(places, { envelope, tree })`). A place's envelope is the first place at or above the envelope
scale on the way up from it; a place that never reaches that scale has none known. Two envelopes are **apart** only on
evidence: both known, neither inside the other, and either side by side under a place they share or two top places of
one scale that is a city's or larger. A scene placed coarsely (the whole city) is never evidence of leaving, and neither
is a sampling pool (a place the text left "somewhere in" an area). Where the engine built such a place is known to the
terrain registry: `builtTree(slots, book)` reads it.

**The walk.** Scenes in story order (the script's clock, then reading order). For a scene, each strand its people are
on either plays it or is left by them:

1. A strand whose envelope is not known to be apart from the scene's plays it.
2. One that is apart plays it too when its whole group is here (the strand moves), or when the rest of its group is not
   told elsewhere meanwhile (the next scene with any of them has someone from here, or is not apart from here).
3. Otherwise the people here leave it: a **split**. The rest is told in its own envelope while they are in another.
4. No strand plays it: a new strand, from the ones left (`splitFrom`). One: it goes on. Several: a **union**, the strand
   with the most scenes keeps its id and the others close into it (`unites`, `into`, `intoAt`).
5. A scene of people first seen is on the strand being told unless its place is known to be apart (a new group in
   another area is a new strand). A scene with nobody in it is on the strand being told, or on the open strand whose
   envelope it looks at.
6. A flashback is told where it is read and is a closed strand of its own (`past`), handing nothing on.

**Checks**: `split`, `union`, `apart` (a chapter ends with open strands), `conflict` (one person at one stated moment in
two envelopes that are apart).

**The file** (`strandsDocument`; `stage/world/strands.json` and the director's `segments/strands.json`): `version: 2`,
`order: "story"`, `envelope`, `scenes[{ id, fork, layer, lane, continues, envelope, entries }]`, `forks[{ id, scenes,
people, envelope, open, past?, splitFrom, into?, intoAt?, unites }]`, `checks`. A strand's id is its first scene's;
`lane` is the strand's index, `layer` the scene's story index. Entries per person are as before (the per-person
worldline did not change; spawning reads them unchanged).

## 4. Physics per strand (M17c, built)

The world's damage is a layer per strand over the built world (`world-engine/world/strand-layers.mjs`, pure; the engine
in `export-strand-demo.mjs` hands in its state):

- a layer holds what its strand changed: the lots it broke (their units, standing cells and rubble, copied when first
  written: copy-on-write by lot), the things it stood, moved or took away, the underground's cave-ins, the hits it saw;
- a scene is played in its strand's layer (`enter`): what the last layer changed is taken out of the world and this
  one's put in; only the lots, things and underground cells that differ are reported, and only the walk graph's windows
  over them are rebuilt;
- a strand that began as a split starts as a copy of the strands its people left; a strand of people first seen, and
  the past, start from the world as it was built;
- a union merges the closed strand's layer into the one that kept the id: a unit broken in either is broken, rubble of
  either lies, a thing moved by both is where the later scene left it, a cave-in of either is there.

The director plays each unit in its strand's layer; the page draws a unit with the hits its strand has seen
(`window.__layers()` is the page's check hook); the rehearsal measures `layers` (strands left and begun, layers copied,
unions, hits, units with a hit they do not see).

**Proof** (units 160–175 at the building scale, a stand-in Jev): the strand of 162–165 blasts at 163; the side strand of
166–167 and the main strand at 168 do not see it (3 units with an unseen hit); at the union (unit 169) and after, every
strand's hits are drawn. The first quarter at the district scale is unchanged but for timing and the new measures.

**What a layer does not hold yet:**

- a digest thing's own cells (`hitThings`) are the world's, not a layer's;
- the earlier-run damage log (legacy) is written to the world it finds;
- the page filters a building's hits by strand but shows the underground's holes of every strand;
- a union's merge settles the lot, and may drop more units than the page shows for either strand alone;
- vehicles' standing places are one for the world, in reading order (re-stood after a strand switch);
- the standalone engine (v1 strands, no `splitFrom`) has no layers: `layered(strands)` says which it is.

## 5. Re-strand after smoothing (M17d, built)

The text's strands are the reading's view: a unit's group is whom the text names, its envelope the place the text gives
it. A run knows where each person stood, card by card, smoothed (`world-engine/smoother`). `world-engine/smoother/
restrand.mjs` applies the same builder to **the run as a script**:

1. **A spot's envelope** is the built place that holds it: the smallest site of the terrain registry whose box holds
   the spot (of several of one size, the one whose centre is nearest: districts' boxes overlap), then up its parents to
   the envelope scale. The run's place tree is the script's places under the built tree under the sites.
2. **A unit's envelope** is where most of its people ended it (a tie goes to the text's envelope); a unit nobody was
   placed in keeps the text's.
3. **Apart** is a person every one of whose spots in the unit lies in an envelope known to be apart from the unit's:
   someone who walks in or out is with the group. Those apart are told in a sub-unit (`<unit>~2`) in their envelope;
   where the builder makes a strand of them, the run has a split the text hid.
4. **With** the group is anyone on the stage the unit does not name who stood within earshot of it (`talk.earshot`,
   25 m, chained through the group); farther off they are left out of the unit.
5. The builder runs on these units. The run's strands are matched to the text's by the units they share (a strand is
   named by its first unit, and the run's may begin at another).

**What it says against the text** (`against`, in the file and in lines from the CLI): strands the run does not have and
strands only the run has; units with a hidden split; the run's unions and whether the text says each; stretches of
units played in another envelope than the text gives them (`moved`); stretches of units on another strand (`changed`).

**The file**: `stage/world/restrand/<run>.json`, the strands file's shape (`version: 2`, `from: "run:<id>"`) with `run`,
`earshot`, `units` and `against`. It is a run's own file (universe snapshots name it and never copy it, like the
smoothed positions). The director writes it at a run's end, after smoothing, with a summary in the record
(`record.restrand`) and the run's index (`files.restrand`); the rehearsal measures it per pass (`restrand`, nothing
written). A run of a part of the script (`only`) is read over that part alone.

    npm run build && node world-engine/smoother/restrand.mjs <novel-dir> [--run <id>] [--envelope <scale>] [--out <file>] [--write]

**First case: W15** (run `d20261109081436`, library 16 read only, the result in the scratchpad):

| Envelope scale | Text's strands | Run's strands | Units with a hidden split | Unions (unsaid) | Units played in another envelope | Units on another strand |
| --- | --- | --- | --- | --- | --- | --- |
| **district** | 2 | 4 | 0 | 3 (3) | 28 in 4 stretches | 11 in 4 stretches |
| street | 2 | 14 | 15 | 10 (9) | 36 in 9 | 52 in 13 |
| building | 5 | 20 | 27 | 13 (11) | 73 in 16 | 61 in 20 |

At the district scale (286 units, 274 with people placed, 1,100 placings, 1 on no built site):

- **The main strand**: 275 units, open.
- **Units 162–167** (3 people, split from the main, into it at 169): the text places the units before (159–161) only at
  the city's scale, so going to loc_000005 at 162 is no evidence of leaving; the run played 159–161 in loc_000006, and
  the group in loc_000005 is then known to be apart. The run sees at the district scale the fork the text shows only at
  the building scale; the text's own side strand (166–167) is part of it, and the text's union at 171 happens in the
  run at 169.
- **Unit 197** (one person first seen, into the main at 198): placed by the text at the city's scale, spawned in
  loc_000005 while the group stood in loc_000004.
- **Units 245–248** (3 people, split from the main, into it at 250): placed by the text at the city's scale, played in
  loc_000005 while the rest of the group was in loc_000006.

All three come from units the text places only coarsely: the run settled where they were, and the same rules then see
groups apart. Whether the run settled them rightly is the inspection's question, not the builder's.
- **Moved, not split**: units 126–129 (text loc_000005, played in loc_000006), 165, and 189–196 with 202–216 (text
  loc_000006, the whole group stayed at a crossing in loc_000004, about 800 m away). These 28 units are a finding about
  the run, not about strands: the director did not take the group to the unit's place. Cause not yet investigated.

What W15 taught:

- **District is the re-strand scale.** At street and building scales smoothed spots fall into neighbouring boxes a few
  metres away and the run over-strands (14 and 20 strands).
- **The earshot rule did not fire** (0 with, 0 left out): the director's segment script already lists everyone on the
  stage as present, carried people included. It applies when a plain reading script is re-stranded.
- **A run settles what the text left coarse, and carries its own place faults.** The cross-book registry (M16a) takes
  the run's strands when a run exists; `against.moved` is the list to read with them, and a strand only the run has
  (`strands.begun`) is a run fact until the inspection says the play was right.

## 6. What is next

M17e–g (§0, strands by interaction) first, on the user's go. Then M16 (across books, per strand) builds on these: the
registry reads `open` and the people from the strands file (the run's when there is one), the carry keeps the open
strands' layers. Then W16, the first volume 2 run, on the user's go.
Open from M17: the layer gaps listed in §4; why W15 played the 28 moved units away from their places.
