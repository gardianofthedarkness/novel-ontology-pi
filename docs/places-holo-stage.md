# Places phase 2: the holo stage (exploration)

A place replayed like a game, inside its phase 1 hologram. Open it from orbital
**Places** (▶ Enter for a selected place, ➝ Journey) or with a deep link:
`?holo=<place id or name | journey>&holoMode=diorama|cutscene|journey&holoBeat=<n>&holoPause`.
View only: nothing here writes to the archive.

## Three designs

| | Diorama | Cutscene | Journey |
|---|---|---|---|
| Feels like | a tactics game on a holotable | a visual novel / JRPG cutscene | a strategy game's campaign map |
| Camera | slow orbit over the place (drag to turn) | low establishing shot: the speaker in front, the building rising behind | high over every place of the universe |
| People | pawns in each person's colour, name plates | pawns, portraits by the dialogue box | pawns standing at their latest place |
| A beat shows | event card · speech bubble · red face-off with a lightning arc | dialogue box (quote first, then the record) · VS splash | scene card · glowing arcs for trips, newest brightest |
| HUD | party roster, quest log, replay timeline | letterbox, dialogue box, timeline | roster, log, timeline (trips amber) |

On a phone the stage keeps the scene, the timeline and the dialogue; the roster
and log fold away.

## What drives it

`holoScript.ts` turns the archive into beats. Nothing is invented for the view.

- **Scene card:** one per scene, in story order.
- **Records:** the scene's events and dialogue, in reading order.
- **Dialogue:** a dialogue card and the event telling the same moment become one beat.
- **People:** each record names its people, in the order the text names them.
- **Speaker:** whoever is named just before a speech verb (说/道/问/开口 …), because a card lists its people, not who talks.
- **Quotes:** only words after a speech verb count, so a quoted nickname (“恶宠饲养家”) is not speech.
- **Aliases:** "白井" and "白井黑子" are one person.
- **Conflict:** a keyword guess for now (a Jev yes/no is the obvious upgrade).
- **Journey:** runs on scene presence alone, so it spans every book.
- **Same-name places** (学园都市 ×3, not yet merged in the universe) are one stage and one building.

## Movement inside a building (Jev)

Each kind of building carries a **nav grid** (`holoNav.ts`): named spots and the
ways between them.

- **Tower:** street, front door, 1F … 6F, a stairwell through every floor, roof, back door, back alley.
- **Other kinds:** church, station, market, park, castle, village and district each have their own grid.

The spots sit in the hologram's own box, which the stage scales up 2.2× so
there is room to move inside.

`apps/playground/tools/movement-pick.mjs` asks Jev, which answers typed questions
only (no text), for the movement chain of a place.

1. **Where each person starts each scene:** a choice of spot, given the scene's opening.
2. **Who moves in each event:** a yes/no per person present. Everyone's current spot is part of the question, so the moves chain.
   - Someone the event names moves on an even chance.
   - Anyone else, such as an unnamed "大叔", moves only above 0.8.
3. **Where to, and how, for each mover:**
   - The destination is a choice of spot, and a mover always ends somewhere else.
   - The manner is one of walk, run, sneak, climb up, go down, fall, teleport or dragged.

The stage then walks each pawn along the grid's shortest way at its manner's
speed. Falls drop straight down and teleports blink. The scene's moves so far
stay drawn as a chain, with spot labels and a "➝ 5F · teleport" chip on each mover.

On 废弃大楼 (book 3, 6 scenes, 50 beats) it took 60 Jev calls at about 78 ms each and produced 13 moves:

- 白井 and 乐丘 take the stairs up to 2F together.
- 白井 teleports to 6F (her ability).
- 乐丘 "冲过头摔落", falling to the street.
- 滨面 runs down and out, tries the back door, then runs out front.

What is still rough:

- Starting spots default to 1F or the street too often; 滨面 starts on 1F though he is on the TV floor.
- Dialogue-only beats rarely move anyone.

Plans are served per place at `api/holo-moves?place=<id>`. In this exploration
that endpoint is the design preview's snapshot host; the CLI would project and
serve it next to the time-place data.

## Open questions

- Should the CLI own movement extraction, recorded on events (spot, manner) with review like other facts, or stay a view-side proposal?
- Do the remaining kinds need hand-built interior grids (church nave / bell tower, station platforms), or is one generic storey grid enough?
- Conflict, speaker and alias detection could become Jev questions too, batched per scene the way movement is.
