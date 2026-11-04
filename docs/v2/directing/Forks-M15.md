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

## 4 · The objective replay (built, 2026-11-04)

A replay of the whole world, not one strand's camera:

- **Top view** of every place the run loaded, the story's time as its axis (play, pause, scrub, speed).
- **Each strand's people's paths**, rough (the moves and routes of the run, simplified), drawn in the strand's colour;
  where strands fork and join, their lines part and meet.
- **Names selectable** from the top view and a list: picking one highlights their whole path across strands and shows
  where they are at the story time; picking a strand highlights its people.
- **The places tabs shrunk**, the building list of the book kept.

Built on the run's page and world log (positions by moment, strands, forks); a page of its own beside World · Live and
the Player.

**Built (2026-11-04; the user: "build the objective timeline view mode in the design").** `play/replay` on the host,
a button on World · Live's bar (`tools/pi-review/sim-replay.html`, data from `sim-replay.mjs` at `play/replay.json`):

- **The whole world from above**: every building the run loaded, the book's named buildings outlined and named where
  there is room (the terrain's building sites), north up; drag, wheel or two fingers to move and zoom, Fit for all of it.
- **Story time as the axis**: every unit's start and every card in story order (the strands' layers, then reading
  order), a slider, play and pause, ½× to 8×; within a moment each way is walked from start to end.
- **The strands' paths, rough** (a point every 4 m and at the turns), each in its strand's colour; crowds left out (a
  field, not people).
- **Names to pick** in the People tab or by tapping a dot: the picked people bright with their whole way (still to come
  dashed), everyone else faint; the Strands tab lights one strand's people.
- **The places tab shrunk**: districts and streets only while it is open, drawn dashed; the **Buildings** tab keeps the
  book's building list (tap one to fly there). On a phone the panel starts folded.

It replays the book's newest kept run, so it shows W10 once W10 runs. Checked in headless Chrome on the first-quarter
rehearsal (26 units, 38 people, 196 moments; desktop and phone, no page errors).

## Order

1, 2, 3 and 4 are built. W10 next, so W10's report and replay show the forks.

## Decisions for the user

1. ~~Which places tabs to shrink~~ Done in the replay itself: its Places tab is folded by default, its Buildings tab kept.
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
