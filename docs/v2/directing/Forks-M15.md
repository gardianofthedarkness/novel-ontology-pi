---
tags: [directing, milestone, plan]
---
# M15 · Forks in story time, the fork faculty, and the objective replay (plan, 2026-11-03)

The user (2026-11-03): "We need to make it story objective time order, as strands become forks. If a new set of
characters appeared in a different strand, that's fine. If a group of characters depart from the previous main strand
leaving the people to find someone else, it is a fork. A fork takes ability time to go from one place to another. This
is continuous on the map, although in frontend we can expedite the process, but the corresponding time changes as
well. A better idea is a fork might need a faculty to manage it. We can't do it passively, but as a signal of
triggering. Then, our frontend should give an objective replay mode that replays the whole view of the world with rough
strand character activity paths highlighted and names selectable from top view. Shrink the places tabs but keep the
building list for that book."

## 1 · Hand-overs in story time (built)

A person's `from` is the last container they were in **in story time**: the strands' layers (the order the evidence
allows: worldlines, flashbacks, stated times), then reading order within a layer; no longer the last in reading order.
A container is on the fork of the one it continues. A container with nobody in it stands alone (it no longer borrows a
nearby cast). Someone new in a strand comes from nowhere. (`segments.mjs` `strandsFile`; scenes 19 and 20 now join.)

## 2 · Regrouping without a faculty of its own (built, 2026-11-03)

The user: "I don't know if we should actually make it a faculty, I don't know what summarization will do to it, if we
can we can have one of the existing faculties output the regrouping … They just run."

No new faculty and no new request: a regrouping is already in what is read. The strands, in story time, say where each
person goes next (their next container); the summarizer's moves ("elsewhere", "gone") and the journeys reader say where
and from which line. The director reads the strands:

- **Departures**: whoever's next container in story time is at another place leaves at the end of this one, running out
  of the frame toward that place, while the rest stay (a `leave` event; `departures` in the record).
- **Arrivals**: at the next container they come the whole way from where they left (the routes).
- The double guard ([Strands-M14](Strands-M14.md)) can be laid over both later.

## 3 · Everyone runs; a virtual subway beyond (built, 2026-11-03)

The user: "Set a virtual subway system: if a character needs to go across a country its time increase isn't linear, but
a public transport time. We don't need a real transportation system by now."

`laws.mjs` `tripTime(metres)`: running (4 m/s), or a virtual transit, whichever is sooner: run to a station, wait, ride,
run from the far one. A metro within 60 km (a station every kilometre: 500 m run at each end; a 2-minute wait; about
32 km/h, stops included), a rapid rail beyond (2 km at each end; 10 minutes' wait; about 150 km/h). No network: the
ride is a straight hop, so a long trip loads only its two ends. 1 km runs in about 4 minutes; 2 km takes 8 by metro,
20 km 42, 100 km about an hour by rail, 500 km under 4 hours. L5 checks a route against this time. The page may play it
faster; the story clock (the replay, §4) keeps its time.

## 4 · Traces, strands and the timeline on World · Live (built, 2026-11-04)

The user: "Revert the new page you have pushed, build on top of what we have. The highlight of traces and strands
selection are all directly on the page. A narrative replay as if reading the book can be simply locating them to the
reader, but simply focusing on different part of the strands tree. The traces are visible directly on live, with timeline
selectable that can go back in strand"; and "a specific debugger console for seeing the Jev decisions and input. It can be
clicked either on the page or if I have a question about a step goes straight to the debug page of that Jev step."

A first try as a page of its own (2D, then 3D with plain boxes) lost the player's rendering and was reverted. Now, in the
engine's own 3D player and World · Live:

- **Traces** (strand-demo.html): every way walked before the card now stays on the world, faint, in each person's colour
  (one line set per unit, drawn up to the moment played); the card now's ways are tubes, tapped to fly in on them, and the
  tap tells World · Live who and which card. Traces on or off from the bar.
- **Strands** (World · Live's HUD): one chip per strand, marked now or near on the story's calendar against the card
  shown (the director's units: each unit's strand and clock, in the live notes). A strand picked keeps its traces and dims
  the others', and the reader dims the other strands' sentences and goes to its latest card: reading along it is the
  narrative replay.
- **The timeline**: the cards in calendar order (of the strand picked, or all); dragged back, the card there plays again in
  the live world.
- **The Jev debugger** (the questions page): every Jev step with its exact prompt, pictures and answers; each card (its
  "Jev steps ↗") and each tapped way opens it at that card's steps (`live?card=<unit>|<event>`; each step now records its
  card). It can be framed by World · Live (it could not before: the panel was blank).

Checked on a private test copy with a stand-in run (`--live-test`) through a local host in headless Chrome.

## Order

1, 2 and 3 are built. 4 next. W10 after it, so W10's report and replay show the forks.

## Decisions for the user

1. **Which places tabs** to shrink: the places panel of World · Live, the Player's place list, or the main app's places
   view.
2. ~~The fork faculty's speeds~~ Decided: everyone runs; a virtual subway beyond what running beats.

## Rehearsed (unpaid, one pass, 2026-11-03)

| | Story-order hand-overs | With departures and the subway |
|---|---|---|
| Arrivals off-page | 28 | **19** |
| Arrivals that walked a route (reached) | — | 58 (39) |
| Departures (ran out of the frame) | — | 35 (21), in 12 containers |
| Moves held as unreachable (L10) | 26 | **4** |
| Camera jumps over 40 m | 9 | 16 |

All 58 routes were runs (the longest, 1.3 km, is still sooner on foot than by the virtual metro). The 19 left off-page
are routes that found no way at some leg. Camera jumps rose with people leaving and coming the whole way: the camera
follows them out and in; the beat camera should hold its group as they go (to look at in the replay).

## Pilot (paid, scenes 1–13, 2026-11-03)

The user: "Yes let's pilot first." Run d20261103230048 on the live host (World · Live, the questions log started fresh),
real Jev and the work model, 26.7 minutes, 59 Jev calls.

| Played | |
|---|---|
| Containers (segments) / with a cast | 109 / 109 |
| Cards / moves | 166 / 291 |
| Camera jumps over 40 m / arrivals off-page | 5 / 6 |
| Routes walked (reached) / departures (ran) | 15 (9) / 12 (8) |
| Containers with a crowd field | 51 |
| Canon | 13 scenes, 53 state changes, 3 timelines; 37 held for review |

| Law | Checked | Broken | Read |
|---|---|---|---|
| L1 continuity | 800 | 6 | All one cause: an empty establishing segment opening scene 2 borrowed scene 1's cast (the old scene-sliver rule, `reads.sentences ≤ 4`, now firing on every short segment). Off by segment: an empty segment stands alone. |
| L6 talk | 258 | 13 | Two people talking from 3 m, five floors apart: a start's floor (to look at; spawning's height, not the talk). |
| L10 reachable | 68 | 7 | Journeys to a box with no way in (held). |
| L11 bodies | 112 | 34 | All 34 the crowd field's samples stacked on a cell; none with more than three people. The samples are a density (L20), not bodies: L11 no longer counts them. |

Also fixed from the pilot: Jev's tokens were metered as 0 (the decision cache hid the client's `usage`; carried
through now, and read under any of the provider's names); the record kept all 346 stretches of the gate, now only the
109 the run played.

| Faculty (played stretches) | Fired | Found something |
|---|---|---|
| conversation | 45 | 44 (377 channels and formations) |
| journeys | 31 | 13 (27 journeys) |
| choreography | 22 | 3 (6 exchanges) |
| ambience, setting, feeling, props | 32, 36, 62, 35 | not counted yet |

Timing: 1602 s, of which graph builds 168 s (128 builds), Chrome reloads 118 s, pictures 75 s; the rest is the models.
