# The director and the camera operator (design, 2026-11-02)

The user's frame: Jev is a director turning a script into a film; an automatic camera operator gives it the angles and
zooms it needs to move the people by the text, and the user sees what Jev sees. The last piece before a full simulation
run. It extends the visual context engine ([visual-context-engine.md](visual-context-engine.md) §4) with the shots a
movement needs, and the text context engine with a `move` mode.

## 1. What is animated: dialogue and action cards

Not events: only **dialogue cards** and **action cards** are played (the user, 2026-11-02). Narration, thoughts,
monologues, description and facts are context Jev reads, never animated. Vol 1: 417 action cards (336 with someone acting:
320 with one, 16 with two) and 217 dialogue cards (184 with people present, 108 of them three or more).

- **An action card:** its actors move, each (or each unit, world-engine-v2.md §4) through the steps below.
- **A dialogue card:** people gather: who comes to whom, or where a group stands; one speaker alone does not move.

## 2. One move in three steps

| Step | What Jev is shown | What it answers |
|---|---|---|
| **a. Direction** | the master shot, lettered arrows out of the person | an arrow, *stays*, or *goes with X* |
| **b. Spot** | the text, the place's spots, the chosen arrow still drawn with its wedge | a spot inside the wedge, or *none of these* |
| **c. Box**, only when b says none | c1 then c2 below | a rough box, then the exact place |

Most moves end at b (the text names a room, the roof, the shop, someone's side: a spot the engine knows to the cell, so
the position is exact and costs no picture to draw on). *Stays* and *goes with X* end at a.

**a. The direction, drawn** (the user, 2026-11-02, like the height slices). Fourteen arrows from the person: up, down, the
four level ways and the eight diagonals between them, each lettered. Warm arrows rise, cool ones go down, level ones lie on
the floor. The camera operator probes the first thing each arrow meets (the stairs, a door, a window, the roof's edge, a
wall a metre away); the option names it ("C: toward the stairs"), never a compass point; an arrow blocked at once is drawn
dashed. An up or down move shows the same arrows through the floor slices of the section.

**b. The spot.** The chosen arrow stays drawn, solid, the others gone, its spread (about 45°) shaded; the spots inside the
wedge are offered first. A spot outside it is asked again with the reason ("against the direction you chose"), unless the
answer cites a line of the text for it.

**c. Two calls to lock the exact place** (the user, 2026-11-02: a jump onto a roof, a flight, someone held in mid-air).
- **c1, rough:** a top-down plan, framed from the person along the chosen arrow as far as the move may reach (a few metres
  for a step, a street for a run, a district for a flight), the arrow and its wedge drawn. Jev boxes *about here*.
- **c2, exact:** the camera operator turns to the side of the arrow, low (about 20° above level), and zooms into the rough
  box's column, which reveals its height: lettered slices across the column at the ground, each floor and roof of what
  stands in it, underground levels below, and open air above (every few metres to 60 m). The same request carries the
  rough box zoomed top-down, for the exact ground position. Jev answers both: the exact box on the plan, the height by its
  slice. A level move on the same floor needs no side view (its height is the floor's).
- **In the air:** a slice in open air is *in the air at N m*. It stands only for someone the text gives a way to be there
  (flying, a power, a fall under way); otherwise the sanity check says so and asks again.

Only c2's answer is read back into the world, checked (inside the place, reachable, not in a wall) and snapped to the cells
a person can stand on (or kept in the air when it stands).

## 3. The camera operator (code, no model)

- **Frame the action, not the place.** The extent is the people of the card, where they may reach in it, and the spots the
  text names; the zoom is held to the zoom engine's ladder and set so a person is at least ~16 pixels tall.
- **People and their names are drawn at a fixed size on the screen,** so they read at any zoom (the user's view too).
- **The shots:** *master* (wide, about 35° above level; context, never drawn on), *plan* (straight down, orthographic, a
  grid in metres; exact to read back), *section/column* (a side cut, floors lettered), *two-shot* for fights (both
  fighters, the camera kept on one side of the line between them so left and right hold from shot to shot).
- **Seeing through:** indoors the roof is lifted and the floor cut at the mover's level (the slices); outdoors the camera
  tries eight turns and takes the one that hides fewest people, going higher or seeing through buildings when none is clear.
- **Every shot is labelled and has a manifest:** names and letters, a scale bar and north, metres per pixel, and how a box
  on it reads back into the world.
- **Continuity:** the camera holds through a scene's cards while the action stays in frame; it cuts when the action leaves
  the frame or goes to another place.
- **Another take** (the user: agreed): once per decision Jev may ask for one more shot: closer, wider, turned, a floor up or
  down.
- **The user sees the same:** World · Live gets the director's monitor (the shots Jev got, its boxes and answers) and a
  *look from Jev* button; the user's camera stays free.

## 4. The text Jev reads (the `move` mode of the text context engine)

For each card: its own sentences as written; the lines just before; every line of the scene naming who moves or saying
where; the scene's description lines; where everyone stands now in words (place, floor, spot). Each line keeps its
sentence id, and an answer says which line it rests on. The events' repeated "（原文：…）" is dropped.

## 5. Rooms, before the run (the user, 2026-11-02)

The corridors and stair cores stay as they were; the rooms are laid again (`apps/playground/src/data/skeleton.ts`
`furnish`):
- **By where in the building.** A bigger building (a floor of 60 cells, 240 m², or more) has halls and rooms of several
  floors, at its bottom (a lobby, a gym, an auditorium) or its top (a hall, a penthouse); its rooms grow larger toward its
  ends (mean m̄·(1 + 2·e(k)), e the pull toward the ends, 1 at the bottom and the top) and keep the building's usual size
  between. A small building rarely has a hall.
- **Doors.** A room keeps one door (a hall two, a room of several floors three), spread along its walls, not every
  corridor cell beside it; the walk graph leaves a room only through them, and a room of several floors is walked on its
  own floor, open air above it.
- **Drawn hollow:** its floor, thin walls with a gap at each door and a bright line along their tops, no ceiling.
- Vol 1's world (2026-11-02): 23,995 rooms in 598 buildings, 699 halls and 58 rooms of several floors.

Also before the run: every building's marker on its building (a built one kept its canvas spot: 飞镖酒吧 35 m off).

## 6. What loads, so the service does not grow without end (checked 2026-11-02)

The user: only the current scene's characters' surroundings and the buildings hit there may load in full.
- **The world streams in where people go** (export-strand-demo.mjs `reach`: chunks within the asked radius plus 32 m);
  a building no one has reached is a shell. Lots are never let go again, so memory grows with the ground explored (linear,
  not worse); each reached building gets its whole inside at once (every floor to 40).
- **The walk graph is a window** (128 m squares, at most 384 m across) round where a walk goes, cached until the world changes.
- **Destruction is per building hit:** only a hit building is drawn wall by wall and roof by roof.
- **Drawing (fixed 2026-11-02):** a building's inside is built only within 60 m of the scene's people and where Jev
  looks (dropped beyond 90 m), in every view: the live story view, the terrain stage and Jev's stills (which built every
  reached building's inside: 192,000 room-wall pieces in scene 23's still, 25,000 after). The live story view also drops
  the ground and buildings beyond 112 m.
- **Still to do in the run's loop:** the old picker (`sim pick`) replays the whole line from its start for every event and
  rewrites the whole live page (3.3 MB on vol 1 now) each time: work that grows with the square of the story. The
  director's loop plays forward card by card and writes the world once, then each step's changes.

## 7. Built: the director's loop, and its first run (2026-11-02)

`world-engine/director/director.mjs` plays a line's scenes forward card by card on the engine as the export built it
(`strandDemo`'s `engine` hook: its world, walk windows, solver and page assembler), people posed on the page where the
loop has them (`__stage.pose`), the page written once a scene (and reloaded only when the world has grown). Per person
acting in an action card: first, from the text alone, whether they go anywhere (`move-whether`; asked on the arrows
straight away, Jev answered "stays" 45 times in 50); then the arrows, the spot in the wedge, and only then the two boxes.
Jev's image service's 503s and 529s are tried again after a pause.

Scenes 1–13 of vol 1 (92 calls, about a minute): 105 cards; 65 people asked, 55 stay (read again by hand: knocking on a
door, turning round, bending down, a lunge into someone beside them: right), 10 go (8 to a spot, 2 boxed); 15 moves walked
with the 6 of 20 dialogue gatherings. What is not played: travel the text tells in narration (walking to the station
front, to 小萌's door), which is in no action card; and inside a building the shots look at it from outside (the cut at
the mover's floor is not built yet).

**Every move an action (the user, 2026-11-02).** Told in the sentence kinds' definitions that any change of place is an
action, Jev moved 3 of the 35 narration and description sentences holding a word of moving, and 217 other sentences
changed kind back and forth (its run-to-run noise is larger than the wording's effect). A word list (the move rule) was
tried and taken out again: it holds for one language and the words someone thought of (the user: not generalizable). The
director's pass (§7a) asks instead.

### 7a. The director's pass (the user, 2026-11-02: a mini Jev call per narrative sentence, not a word list)

`world-engine/director/pass.mjs` (`directorPassMode`): every narration and description sentence of a scene, asked on its
own with the line either side and the people present, twenty a request: does someone change place in it, do something
visible where they are, or is there nothing to show; and who (one present, or "they": everyone). The reading is not
changed; the director plays the sentences that move someone as action cards of those it names, the "does X go anywhere"
question still in front of them. Scenes 1–13 (407 sentences, 27 requests): two runs from empty caches agreed on 404
(99.3%); 10–11 moves, among them "they came to a building that looked like containers" (all three present), with a few the
same both times that a reader would not call moves ("这条路既容易迷路").

## 8. Order of building

1. The camera planner (`src/v2/context/camera.ts`): the fourteen directions and their letters, the action's frame along an
   arrow, the column's height slices, reading boxes back. Code, tested.
2. The page's layers: arrows (lettered, coloured, dashed when blocked), the wedge, the column slices; people and names at
   a fixed screen size.
3. Sample shots of one card with no Jev, for the user to look at (a, b, c1, c2).
4. The text `move` mode, then the loop on one storyline with Jev.

## 9. The viewer's camera: the group orbit (the user, 2026-11-08)

The user: *"We need to revolutionize the camera system from places orbit to group of character center orbit native
system. Try it out."* The player's Follow camera (`world-engine/view/strand-demo.html`, `groupCamTick`) is now the group
orbit; the pinned camera of 2026-11-05 (the centre locked to the smallest building, street or district round the card's
people, moving only when they leave it, and stopped by any touch) stays behind `?pin` to compare.

- **The centre is the people.** The card's group: the director's camera group for the beat or cut (`event.camera.group`:
  everyone who has acted, spoken or moved in it so far; the director writes it on every card's camera), else the card's
  actors, movers and speakers with the card before's; the one speaking counted twice; of groups more than 90 m apart, the
  one nearest where the camera looks. The centre is their middle 1.2 m up (underground and up a tower alike).
- **It moves with them.** Each frame the centre and the camera move by the group's own step (same people, under 6 m a
  frame), then ease off what is left, so a steady walk is held without lag; a jump of over 250 m (another place, a seek, a
  cut to a group far off) glides over, the viewer's angle kept.
- **The viewer owns the angle and the zoom; the group owns where.** Turning and zooming orbit the moving centre and keep
  following (World · Live's touch no longer stops Follow in this mode); the distance eases to one that fits the group
  (16 m plus 2.4 times its spread, 14 to 700 m) times the viewer's zoom, which a zoom sets. No panning while following.
- **Cuts** (the photographer's shots) are unchanged; turning Follow off frees the camera as before.

**Tried** (headless, unit 52's stroll from the first-quarter rehearsal, 60 samples over 30 s of play, a drag turning the
camera 90° and zooming 40% in partway): the centre's distance from Kamijou and Index, median 0.5 m (the pinned camera:
30.4 m, up to 87.5 m, the pair at the edge of the frame while it held the station); camera distance 22 m against 60; after
the drag the angle and the zoom were kept and it went on following. Its 90th percentile, 32 m, is a card whose beat group
holds a third person 35 m off: the camera frames all three, as the group says.

**With it, the walking group's formation was fixed** (on-the-move.mjs): a way beside the leader's is now an offset across
the smoothed heading that keeps its side, and every re-timed move carries `at`, each node's time, so a member reaches each
node when the leader reaches its own; Kamijou and Index walk the stroll 2 to 2.8 m apart throughout (before: drifting up to
21 m apart mid-card on the 217 m piece, Index's way 11% longer).
