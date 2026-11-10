# The map by render units (v3; the user, 2026-11-10)

> "Walk time dependant isn't reliable. Transportation methods varies largely across different novels. What we can do is a
> most rendered entity. The director or agent or some cast, will determine the largest continuous render units in the
> story. For example planet level and a scene happened in the space ship are the same level. The details are also
> different scale. The scale of ladder different between a micro scene happening on a planet and large interdpatial
> battles destroying planets. We should make this phase v3, a new branch from v2. V2 now is from now on our legacy
> version. In v3 we reimagine how our map is built." — the user, 2026-11-10

Status: a first design to correct, nothing built. It replaces v2's fixed place scales (room to region) and the two
drafts of docs/v2/place-layers.md (sizes in metres; a ladder by travel time), both set aside by the user.

## 1. The idea

The map is not a hierarchy of sizes. It is a set of **render units**: each one the largest space the story plays in
without a break, rendered as one continuous whole.

- **Units are peers.** A planet the story roams and the inside of a spaceship are the same level: each is one unit. What
  makes a unit is continuity of the story's rendering, not physical size and not how anyone travels.
- **Each unit has its own scale.** The scale is set by what acts in it and how far the action reaches: people in rooms
  and streets; ships and fleets round planets; planets in a battle that destroys them. Detail inside a unit is laid out
  relative to that scale, on the unit's own ladder.
- **One thing may be seen at several scales.** A planet is the ground of a unit when a small scene plays on it, and an
  object inside another unit when a battle between fleets destroys planets. The two are views of one entity.
- **Between units the story cuts.** No walk, no ride, no travel time is assumed. What the text says of a journey is kept
  as told (who went, by what, how long) and played as a cut, or inside a vehicle that is a unit of its own.

## 2. A render unit

| | What it is | Examples |
| --- | --- | --- |
| **the anchor** | the entity that is rendered whole: the "most rendered entity" of a stretch of story | a city, a planet's surface, a ship, a castle, a battlefield in space |
| **the actors' scale** | what counts as a body in it | a person; a mecha; a ship; a fleet; a planet |
| **the reach** | how far the action goes, counted in actors' bodies (not metres) | a room is a few people across; a battle is a few hundred ships across |
| **the ladder** | the unit's own levels of detail, from the actors' scale up to the anchor, each relative to the one below | person, room, building, street, the city; ship, formation, orbit, the system |
| **the stretches** | the runs of story played in it | |

Only the actors' scale ties a unit to anything absolute, and only where the engine needs it: a unit whose actors are
people is built at human size, as now.

## 3. Who decides, and from what

The units are **found, not configured**: a pre-film cast (or the agent, in a pass of its own before terrain) reads the
story's own evidence and proposes them; the agent confirms or corrects, each write with a why.

- Where the story stays: runs of scenes whose people move from place to place without a break in the telling.
- Where it breaks: a move the text tells as a journey, a jump in place with no way between, a change of what acts (from
  people in a corridor to fleets in orbit).
- What is rendered most: the entity most scenes stand in or look at is the unit's anchor, and gets the most detail.
- What the text says holds what, and what it shows from outside (a ship seen from the planet, a planet seen from a ship).

## 4. Links between units

- **Seen from.** A unit can appear inside another as an object at that unit's scale: the ship in orbit over the planet,
  the planet in the fleet battle. The link names both views.
- **What happens to the object happens to the unit.** A planet destroyed in the battle closes the units on its surface;
  a ship boarded joins its unit to the boarders' strand. This is where strands and the carry across books (damage kept
  or recovered, docs/v2/borrow-and-spawn.md §4.5) meet the map.
- **Cuts.** Every other move between units is a cut, with the journey as the text tells it.

## 5. What it means for the two volumes read

| | As v2 read it | As render units (an estimate, to check when built) |
| --- | --- | --- |
| Volume 1 | one city, six scales | one unit: the city, people's scale |
| Volume 2 | 158 places, 9 grounds, 25 moves between grounds, 19 with no shared parent | about 7 units (the home city again; places abroad; a hospital and a district that are the home city's), 26 stretches, every move between units a cut |

Volume 2's run in v2 died walking between cities because every ground stood on one canvas (W16).

## 6. What v3 keeps and what it reimagines

- **Kept from v2:** the reading (scenes, cards, who is who, story time), the credit check, strands by interaction, the
  carry across books, the pre-film casts, the director's play inside a unit, the laws, smoothing, the volume runner.
- **Reimagined:** how places become a map: units instead of the scale list; a unit's own ladder instead of city,
  district, street; terrain per unit; cuts between units; an entity at several scales; the casts' measures (how far, how
  big) counted in the unit's own rungs.

## 7. Open, for the user

1. **Who proposes the units:** a new pre-film cast with the agent confirming (my reading of "the director or agent or
   some cast"), or the agent alone in its own pass?
2. **One entity at two scales:** when the battle destroys the planet, do the units on its surface close at once (their
   strands end), or only when the text shows it from the ground?
3. **Where v3 starts:** the unit finder on volumes 1 and 2 first (no terrain yet), so the units can be read against the
   text before anything is built on them?
