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

## 2 · The fork faculty (to build)

A fork is a group leaving the strand it was on while others stay. Passive strands only notice it afterwards (someone
turns up elsewhere); the faculty acts at the moment it happens.

- **The signal that fires it**: a split the strands find at a container (people of one container next appear in
  parallel containers at different places), a departure in the text (the summarizer's moves "elsewhere", journeys
  read), or the next container of a person at another place in story time. One work-model request per firing.
- **What it reads**: who leaves and who stays, where each group goes (a place of the tree), by what way (L12: walk, run,
  vehicle, leap, flight), and from which card they leave.
- **What it does**: each leaving person's route through the loaded blocks (the routes built today) from the card they
  leave to their next container's place, timed by their way: the route's metres over the way's speed. The new fork's
  clock starts when they arrive; their next container on that fork begins no earlier.
- **The double guard** (proposed in [Strands-M14](Strands-M14.md)): the story guard (story-time order, fork links) and
  the physics guard (the route fits the time; L2: not in two containers at once).
- In the registry: a faculty `forks` read by the stage manager, its state a `fork` record (who, from, to, way, leave,
  arrive) into the world log and, through the ledger, the timeline (the ontology's per-strand timeline).

## 3 · Forks are continuous on the map, with their time

A fork's travel is played whole on the map (no jump), its duration the route's metres over the way's speed. The page
may play it faster, but its story clock moves with it: the time shown is the story's, so a 20-minute walk played in
5 seconds still shows 20 minutes passing on that fork.

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

1 is built. 2 and 3 together (the faculty, the routes timed by way), then 4. W10 after them, so W10's report and replay
show the forks.

## Decisions for the user

1. **Which places tabs** to shrink: the places panel of World · Live, the Player's place list, or the main app's places
   view.
2. **The fork faculty's speeds**: walking or running for everyone until the abilities config exists (L12), or a draft
   config from the reading first.
