# The architect's rooms and the transport specialist (2026-11-06)

The user, 2026-11-06: *"before the next paid full volume rerun ... transport specialist and architect. Architect should
pick a room type when conversation happens in a room. Download 3d models if you need."*

Both are state directors of the specialists' registry (`world-engine/director/specialists.mjs`; the vault notes
`docs/v2/directing/directors/architect.md` and `transport.md`).

## The models (CC0 1.0 only: the repository and the io are public)

| Kit | For | Where | Baked by |
| --- | --- | --- | --- |
| KayKit Furniture Bits 1.0 (Kay Lousberg) | the rooms' furniture: 29 of its 53 models | GitHub, `KayKit-Game-Assets/KayKit-Furniture-Bits-1.0`; unzipped in `~/claude-world-first/downloads/kaykit-furniture` | `apps/playground/tools/furniture-models.mjs` → `src/data/furnitureModels.json` (in metres: the kit's units scaled by 0.68) |
| Kenney Car Kit 3.1 | cars, vans and trucks: 17 models (a police car, a taxi, an ambulance, a fire engine, a lorry…) | the user's download (`kenney_car-kit.zip`); unzipped in `~/claude-world-first/downloads/kenney-car-kit` | `apps/playground/tools/vehicle-models.mjs` (beside KayKit's five cars) → `src/data/vehicleModels.json` |

Kenney's Furniture Kit is only on kenney.nl, where the download is the user's to make. Buses, trains, helicopters,
aircraft, drones and boats have no CC0 model on disk: the page goes on building them from parts.

## The architect: a room's kind where a conversation plays

- **When:** a dialogue card's conversation is settled (the routine director's `talkNear`), and its anchor stands in a room of
  a building: a node on a floor of a lot, inside one of its plan's rooms. A street laid underground's buildings and a deck's
  count too.
- **The question (Jev, once a room for the run):** "What kind of room does this conversation take place in?" Jev answers from
  the room's kinds (`world-engine/digest/rooms.mjs` `ROOM_TYPES`), given:
  - the lines;
  - the building (its label, its role, its floors);
  - the room's floor and size;
  - the scene's place.

  The kinds: classroom, office, meeting room, bedroom, living room, kitchen or dining room, café or restaurant, bar, shop,
  hospital room, laboratory, library or study, lobby or hall, storage, cell, control room, not said.
- **The furniture:** `furnish(type, w, d, sizes, seed)` lays the kind's recipe out in the room (metres from its corner, a
  turn each).
  - Pieces go along the walls facing in, in rows, in the middle, or round a table.
  - Nothing overlaps, everything keeps 0.25 m off the walls, and a piece that does not fit is left out.
  - The same room, the same layout.
- **Kept:**
  - the card's `room` (lot, room, kind, how sure);
  - the page's `rooms` (each with its furniture), drawn on the room's floor in the building's own plan;
  - the world log's `room` records (a view input, never canon).

## The transport specialist

- **A pre-film step,** `experiments/v2/transport.mjs <novel> <reading>/v2/data.json --universe <library>/universe`: paid, cents, cached; `--stand-in` answers by rule, unpaid; `--dry` counts.
  - Each vehicle, weapon and machine of the book's props (`universe/props.json`, the settei cast's) is asked, eight a request.
  - A car's or a van's or truck's model: one of its kind's kit models, given the lines it is named in, or none of these.
  - Its owner: one of the people of its lines, an organization, or not said.
  - It writes `universe/transport.json`. Vol 1: 68 props, 13 with a model to pick (8 cars, 5 vans or trucks), 9 requests.
- **The director:**
  - A vehicle (a vehicle slot, or a thing on the page) is drawn as the specialist's model, else the rule of its name's words (a taxi, a police car, an ambulance, a fire engine). Only the models a page uses go on it.
  - Owners go on the page's things and vehicle props.
  - Card by card, who came to hold, drive or ride what (the things' holders, the rides' ties) and who let it go is the card's `holdings`: the world log's `possession` records, and canon's `possessionsAdd` / `possessionsRemove` on each scene's state changes.
- **Not yet:**
  - the OWNS relation in the ontology;
  - a picture of the candidate models for Jev to look at (it reads their names);
  - weapons' own models (vol 1's are small enough to stay shapes).

## Checked (2026-11-06, unpaid)

- **Units 1–84, rehearsed on a copy of library 16:** the same play as before, with 7 more calls (the rooms asked). The stand-in typed 13 cards' rooms (7 rooms) and recorded 115 holdings.
  - The stand-in turns its answers with a count of its questions, so the rooms' questions first reshuffled everything after them (252 moves against 253).
  - It now leaves them out of the count.
- **W12's underground stretch (units 114–131):** the same play, one call more.
- **On a library-shaped copy (its universe beside it, a stand-in `transport.json`):** a van slot was drawn as Kenney's van; only the models the page uses went on it.
- **Sheets** (`~/claude-world-first/rehearsals/stage3-sheets.mjs`): seven of the book's rooms furnished as seven kinds, the vehicles side by side, and a ring through an overcast frame by frame (the ripples of sky.md).
- **Unit tests:**
  - `world-engine/digest/rooms.test.mjs`: every kind laid out without overlap, a narrow strip of a room still furnished;
  - `transport.test.mjs`.
