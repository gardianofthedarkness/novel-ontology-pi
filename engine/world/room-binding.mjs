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
/** A room's kind when the text does not say: by its building's use (the terrain site's kind), else a single room. */
export function defaultKind(buildingKind, label = '') {
  if (/\u7384\u5173|entrance|lobby|hall/i.test(label)) return 'lobby or hall';
  const use = String(buildingKind ?? '').toLowerCase();
  const by = [[/dorm|apartment|hotel|house|home|residential|flat/, 'bedroom'], [/school|university|college|academy/, 'classroom'], [/hospital|clinic/, 'hospital room'], [/office|bank|government/, 'office'], [/shop|store|convenience|market|mall/, 'shop'], [/cafe|caf\u00e9|restaurant|diner/, 'café or restaurant'], [/bar|pub/, 'bar'], [/lab|research/, 'laboratory'], [/library/, 'library or study'], [/church|station|hall/, 'lobby or hall']];
  return by.find(([test]) => test.test(use))?.[1] ?? 'bedroom';
}

/** A room that is another room's way in (a flat's genkan, an entrance, a doorway): bound inside the room it opens (B3). */
export const ENTRY_WORDS = /\u7384\u5173|\u5165\u53e3|genkan|entrance|entry|doorway|foyer|vestibule/i;
/** Rooms people live in, whose entry an entrance-like room of the same building is. */
const LIVED_IN = ['bedroom', 'living room', 'kitchen or dining room', 'hospital room', 'cell'];

/**
 * The binding's hints from the story (B3, docs/v3/design.html#indoor-benchmark): each room's floor where its units state one
 * (`floorsOf(roomId)` gives the stated floor facts, 1 the ground floor; the commonest, then the surest), and an entrance-like
 * room made the entry of a lived-in room of the same building. Mutates and returns `rooms`.
 */
export function storyHints(rooms, floorsOf = () => []) {
  for (const room of rooms) {
    const said = floorsOf(room.id).filter(fact => typeof fact.value === 'number' && fact.value >= 1 && (fact.sure ?? 0) >= 0.7), count = new Map();
    for (const fact of said) count.set(fact.value, (count.get(fact.value) ?? 0) + 1 + (fact.sure ?? 0) / 10);
    if (count.size) room.floor = [...count].sort((a, b) => b[1] - a[1])[0][0] - 1;
  }
  for (const room of rooms) {
    if (room.within || !ENTRY_WORDS.test(String(room.label ?? ''))) continue;
    const home = rooms.find(other => other !== room && other.building === room.building && LIVED_IN.includes(other.kind) && !ENTRY_WORDS.test(String(other.label ?? '')));
    if (home) { room.within = home.id; room.entry = true; }
  }
  return rooms;
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
    // The floor the story states (B3), clamped to the building's top; a kept binding elsewhere is bound again.
    const wantFloor = typeof room.floor === 'number' ? Math.max(0, Math.min(room.floor, Math.max(0, ...plan.map(entry => entry.floor)))) : null;
    if (before && before.lotPlace === lot.place && plan.some(entry => entry.index === before.room) && !taken.has(`${lot.index}|${before.room}`) && !before.entry && (wantFloor === null || before.floor === wantFloor)) {
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
      candidates = pool.map(entry => ({ entry, score: Math.abs(cells(entry) - want) / want + rng() * 0.05 })).sort((a, b) => a.score - b.score).map(({ entry }) => entry);
    }
    const chosen = candidates[0];
    if (!chosen) { problems.push({ place: room.id, label: room.label, problem: `every room of lot ${lot.index} is taken` }); continue; }
    out[room.id] = { lot: lot.index, lotPlace: lot.place, room: chosen.index, floor: chosen.floor, building: room.building, ...(room.kind ? { kind: room.kind } : {}), ...(room.within ? { within: room.within } : {}) };
    taken.set(`${lot.index}|${chosen.index}`, room.id);
  }
  return { rooms: out, problems };
}
