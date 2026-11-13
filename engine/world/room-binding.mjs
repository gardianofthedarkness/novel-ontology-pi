// One room, one place in the world (docs/v3/design.html#indoor-fixes F1; the user, 2026-11-12: "Start with F1"). Every
// room-scale place a book's units are set in is bound once to one room of one building's plan: its building place's lot
// (the terrain's site for it), one room of that lot's plan, its floor. Kept in stage/world/rooms.json and read again on the
// next run, so the room never moves; the director starts a unit set in a room inside it. Pure: the places, the lots and the
// last binding in, the binding out.

const seeded = seed => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };

/** A place's chain up the tree (itself first). */
export function chainOf(places, id) { const out = []; for (let at = id, guard = 0; at && places[at] && guard < 16; at = places[at].parent, guard++) out.push(at); return out; }

/**
 * The room-scale places a run needs bound: each unit's place, or the first room above it, that is a room. With its building
 * (the first building-scale place above it) and the room it lies in, when it is part of another room (an entrance).
 */
export function roomsOf(script, unitIds = null) {
  const places = script.places ?? {}, wanted = unitIds ? new Set(unitIds) : null, out = new Map();
  for (const scene of script.scenes ?? []) {
    if (wanted && !wanted.has(scene.id) || !scene.place) continue;
    const chain = chainOf(places, scene.place), room = chain.find(id => places[id]?.scale === 'room');
    if (!room || out.has(room)) continue;
    const up = chainOf(places, room).slice(1);
    out.set(room, { id: room, label: places[room].label, building: up.find(id => places[id]?.scale === 'building') ?? null, within: up.find(id => places[id]?.scale === 'room') ?? null, first: scene.id });
  }
  return [...out.values()];
}

/** A room kind's size in plan cells of 2 m (F6): the cells it is nearest to; a single room 4 (16 m²), a classroom 20. */
export const KIND_CELLS = { bedroom: 4, cell: 2, storage: 3, 'kitchen or dining room': 4, 'living room': 6, office: 6, 'meeting room': 6, 'hospital room': 6, 'control room': 6, 'lobby or hall': 3, shop: 9, 'café or restaurant': 12, bar: 9, 'library or study': 9, laboratory: 12, classroom: 20, 'not said': 4 };

/**
 * The binding's hints from the story (docs/v3/design.html#room-plan): from the agent's room plan (room-plan.json: each room's
 * floor as the text counts it, 1 the ground floor, and the room it is part of), else each room's floor where its units state
 * one (`floorsOf(roomId)` gives the stated floor facts; the commonest, then the surest). A part of another room binds inside
 * it. Nothing from a room's name. Mutates and returns `rooms`.
 */
export function storyHints(rooms, floorsOf = () => [], plan = null) {
  for (const room of rooms) {
    const decided = plan?.rooms?.[room.id] ?? {};
    if (decided.floor && typeof decided.floor.value === 'number') room.floor = decided.floor.value - 1;
    else if (!decided.floor) {
      const said = floorsOf(room.id).filter(fact => typeof fact.value === 'number' && fact.value >= 1 && (fact.sure ?? 0) >= 0.7), count = new Map();
      for (const fact of said) count.set(fact.value, (count.get(fact.value) ?? 0) + 1 + (fact.sure ?? 0) / 10);
      if (count.size) room.floor = [...count].sort((a, b) => b[1] - a[1])[0][0] - 1;
    }
    if (decided.part?.of && rooms.some(other => other.id === decided.part.of)) { room.within = decided.part.of; room.entry = true; }
  }
  return rooms;
}

/**
 * A room-sized part of a plan room much bigger than its kind (more than one and a half times its cells): the cells along its
 * longest outer wall (its windows' side), as deep as two cells and as long as the kind needs, the way a studio's sleeping part
 * is walled off. `outer(i, j)` says whether a plan cell lies outside the building (no room nor corridor there). Null when the
 * room is not that big or has no outer wall.
 */
export function partOf(room, kind, outer) {
  const want = KIND_CELLS[kind] ?? 4, w = room.i1 - room.i0 + 1, d = room.j1 - room.j0 + 1;
  if (w * d <= want * 1.5) return null;
  const sides = [[0, w, (n) => outer(room.i0 + n, room.j0 - 1)], [1, w, (n) => outer(room.i0 + n, room.j1 + 1)], [2, d, (n) => outer(room.i0 - 1, room.j0 + n)], [3, d, (n) => outer(room.i1 + 1, room.j0 + n)]]
    .map(([side, length, out]) => [side, Array.from({ length }, (_, n) => out(n)).filter(Boolean).length]).sort((a, b) => b[1] - a[1]);
  if (!sides[0][1]) return null;
  const side = sides[0][0], deep = Math.min(2, side < 2 ? d : w), long = Math.min(side < 2 ? w : d, Math.max(2, Math.ceil(Math.max(want, 6) / deep)));
  const start = side < 2 ? room.i0 + Math.floor((w - long) / 2) : room.j0 + Math.floor((d - long) / 2);
  if (side === 0) return [start, room.j0, start + long - 1, room.j0 + deep - 1];
  if (side === 1) return [start, room.j1 - deep + 1, start + long - 1, room.j1];
  if (side === 2) return [room.i0, start, room.i0 + deep - 1, start + long - 1];
  return [room.i1 - deep + 1, start, room.i1, start + long - 1];
}

/** A plan room's area in cells (2 m each side). */
const cells = room => (room.i1 - room.i0 + 1) * (room.j1 - room.j0 + 1);

/**
 * The binding: for each room place, { lot, lotPlace, room, floor } or a problem. `lotsOf(building)` gives that building's
 * lot ({ index, place, floors, rooms: [{ floor, i0, j0, i1, j1, top, kind }] }) or null; `kept` the last binding (rooms.json's
 * `rooms`), kept where its lot and room still exist. A room within another room binds on the same floor of the same lot,
 * the plan room nearest its parent's; two places never share a plan room otherwise. Upstairs first in a building of several
 * floors (a home, a dorm), then the room of the size nearest a single room's (4 cells), seeded by the place.
 */
export function bindRooms(rooms, lotsOf, kept = {}) {
  const out = {}, problems = [], taken = new Map();
  const order = [...rooms].sort((a, b) => (a.within ? 1 : 0) - (b.within ? 1 : 0));
  for (const room of order) {
    if (!room.building) { problems.push({ place: room.id, label: room.label, problem: 'no building above this room in the place tree' }); continue; }
    const lot = lotsOf(room.building);
    if (!lot) { problems.push({ place: room.id, label: room.label, problem: `its building ${room.building} has no lot in the world` }); continue; }
    const plan = (lot.rooms ?? []).map((entry, index) => ({ ...entry, index })).filter(entry => (entry.kind ?? 'room') === 'room');
    if (!plan.length) { problems.push({ place: room.id, label: room.label, problem: `its building's lot ${lot.index} has no rooms` }); continue; }
    const before = kept[room.id];
    const parent = room.within ? out[room.within] : null;
    // An entry (B3): the room it opens, the same plan room.
    if (room.entry && parent && parent.lot === lot.index) { out[room.id] = { lot: lot.index, lotPlace: lot.place, room: parent.room, floor: parent.floor, building: room.building, within: room.within, entry: true, ...(room.kind ? { kind: room.kind } : {}) }; continue; }
    // The floor the story states (B3), clamped to the building's top; a kept binding elsewhere, or one cell wide, is bound again.
    const wantFloor = typeof room.floor === 'number' ? Math.max(0, Math.min(room.floor, Math.max(0, ...plan.map(entry => entry.floor)))) : null;
    if (before && before.lotPlace === lot.place && plan.some(entry => entry.index === before.room) && !taken.has(`${lot.index}|${before.room}`) && !before.entry && (wantFloor === null || before.floor === wantFloor) && (() => { const kept = plan.find(entry => entry.index === before.room); return Math.min(kept.i1 - kept.i0 + 1, kept.j1 - kept.j0 + 1) >= 2; })()) {
      out[room.id] = { ...before, lot: lot.index, ...(room.kind && !before.kind ? { kind: room.kind } : {}) }; taken.set(`${lot.index}|${before.room}`, room.id); continue;
    }
    let candidates = plan.filter(entry => !taken.has(`${lot.index}|${entry.index}`));
    if (parent && parent.lot === lot.index) {
      const home = plan.find(entry => entry.index === parent.room), mid = entry => [(entry.i0 + entry.i1) / 2, (entry.j0 + entry.j1) / 2];
      candidates = candidates.filter(entry => entry.floor === parent.floor).sort((a, b) => Math.hypot(...mid(a).map((v, n) => v - mid(home)[n])) - Math.hypot(...mid(b).map((v, n) => v - mid(home)[n])));
      if (!candidates.length) { out[room.id] = { lot: lot.index, lotPlace: lot.place, room: parent.room, floor: parent.floor, building: room.building, within: room.within }; continue; }
    } else {
      // Upstairs in a building of several floors for a room people live in; on the ground floor for a shop, a café, a bar,
      // a lobby; then the plan room nearest the kind's size (F6).
      const ground = ['shop', 'café or restaurant', 'bar', 'lobby or hall'].includes(room.kind), want = KIND_CELLS[room.kind] ?? 4;
      const floorOk = wantFloor !== null ? candidates.filter(entry => entry.floor === wantFloor) : ground ? candidates.filter(entry => entry.floor === 0) : (lot.floors ?? 1) > 1 ? candidates.filter(entry => entry.floor >= 1) : candidates;
      const pool = floorOk.length ? floorOk : candidates, rng = seeded(room.id);
      // A room as narrow as one cell (2 m) holds no room's furniture: the last choice, whatever its area.
      const narrow = entry => Math.min(entry.i1 - entry.i0 + 1, entry.j1 - entry.j0 + 1) < 2;
      candidates = pool.map(entry => ({ entry, score: Math.abs(cells(entry) - want) / want + (narrow(entry) ? 10 : 0) + rng() * 0.05 })).sort((a, b) => a.score - b.score).map(({ entry }) => entry);
    }
    const chosen = candidates[0];
    if (!chosen) { problems.push({ place: room.id, label: room.label, problem: `every room of lot ${lot.index} is taken` }); continue; }
    out[room.id] = { lot: lot.index, lotPlace: lot.place, room: chosen.index, floor: chosen.floor, building: room.building, ...(room.kind ? { kind: room.kind } : {}), ...(room.within ? { within: room.within } : {}) };
    taken.set(`${lot.index}|${chosen.index}`, room.id);
  }
  return { rooms: out, problems };
}
