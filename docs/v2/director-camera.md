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

## 5. Order of building

1. The camera planner (`src/v2/context/camera.ts`): the fourteen directions and their letters, the action's frame along an
   arrow, the column's height slices, reading boxes back. Code, tested.
2. The page's layers: arrows (lettered, coloured, dashed when blocked), the wedge, the column slices; people and names at
   a fixed screen size.
3. Sample shots of one card with no Jev, for the user to look at (a, b, c1, c2).
4. The text `move` mode, then the loop on one storyline with Jev.
