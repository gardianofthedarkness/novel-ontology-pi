# Strands: groups in envelopes (the user, 2026-11-09)

> "The idea of strand is a timeline performed by a group of people in a limited, enveloping area. The destructions and
> physics engine doesn't interfere another strand. If the time is the same by mentioning the two groups united, the
> strands reunify into one. Today our strands simply diverge." — the user, 2026-11-09, revisiting the strand system
> before the cross-book carry (M16) and the first volume 2 run (W16).

Built 2026-11-09 (M17a–d, the user: "I agree let's build it"): the builder (§3), the run on it, a world layer per strand
(§4), re-stranding a run after smoothing (§5). §2 is what it measured on volume 1.

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
   person elsewhere inside it.
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

M16 (across books, per strand) builds on these: the registry reads `open` and the people from the strands file (the
run's when there is one), the carry keeps the open strands' layers. Then W16, the first volume 2 run, on the user's go.
Open from M17: the layer gaps listed in §4; why W15 played the 28 moved units away from their places.
