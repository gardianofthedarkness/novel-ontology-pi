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

## 4 · The objective replay (to build)

A replay of the whole world, not one strand's camera:

- **Top view** of every place the run loaded, the story's time as its axis (play, pause, scrub, speed).
- **Each strand's people's paths**, rough (the moves and routes of the run, simplified), drawn in the strand's colour;
  where strands fork and join, their lines part and meet.
- **Names selectable** from the top view and a list: picking one highlights their whole path across strands and shows
  where they are at the story time; picking a strand highlights its people.
- **The places tabs shrunk**, the building list of the book kept.

Built on the run's page and world log (positions by moment, strands, forks); a page of its own beside World · Live and
the Player.

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
