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
    if (before && before.lotPlace === lot.place && plan.some(entry => entry.index === before.room) && !taken.has(`${lot.index}|${before.room}`)) {
      out[room.id] = { ...before, lot: lot.index }; taken.set(`${lot.index}|${before.room}`, room.id); continue;
    }
    const parent = room.within ? out[room.within] : null;
    let candidates = plan.filter(entry => !taken.has(`${lot.index}|${entry.index}`));
    if (parent && parent.lot === lot.index) {
      const home = plan.find(entry => entry.index === parent.room), mid = entry => [(entry.i0 + entry.i1) / 2, (entry.j0 + entry.j1) / 2];
      candidates = candidates.filter(entry => entry.floor === parent.floor).sort((a, b) => Math.hypot(...mid(a).map((v, n) => v - mid(home)[n])) - Math.hypot(...mid(b).map((v, n) => v - mid(home)[n])));
      if (!candidates.length) { out[room.id] = { lot: lot.index, lotPlace: lot.place, room: parent.room, floor: parent.floor, building: room.building, within: room.within }; continue; }
    } else {
      const upstairs = (lot.floors ?? 1) > 1 ? candidates.filter(entry => entry.floor >= 1) : candidates;
      const pool = upstairs.length ? upstairs : candidates, rng = seeded(room.id);
      candidates = pool.map(entry => ({ entry, score: Math.abs(cells(entry) - 4) + rng() * 0.5 })).sort((a, b) => a.score - b.score).map(({ entry }) => entry);
    }
    const chosen = candidates[0];
    if (!chosen) { problems.push({ place: room.id, label: room.label, problem: `every room of lot ${lot.index} is taken` }); continue; }
    out[room.id] = { lot: lot.index, lotPlace: lot.place, room: chosen.index, floor: chosen.floor, building: room.building, ...(room.within ? { within: room.within } : {}) };
    taken.set(`${lot.index}|${chosen.index}`, room.id);
  }
  return { rooms: out, problems };
}
