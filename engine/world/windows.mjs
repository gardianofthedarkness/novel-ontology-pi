// Windows (docs/v3/design.html#indoor-mode; the user, 2026-11-12: "we need to pay attention to how we render windows", then of
// the clip: "Good, I think this is good. You can wire it in"). A building's windows are decided once, from its plan and its
// kind, the same for every camera, the walk and every later book: only on a room's outer wall (an edge of the plan, or
// next to an empty cell of it), never on a door, in the pattern of the building's kind (the settings table models.windows,
// config/windows.json), seeded by the lot so a run never moves them. Pure: a lot's plan in, its openings out.

/** What an opening is: a window, a balcony door (a balcony outside it), a shop's glass front. */
export const OPENING = { window: 1, balcony: 2, storefront: 3 };
/** A room edge's side, from the room outwards: toward -v (j - 1), +v (j + 1), -u (i - 1), +u (i + 1). */
export const SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const seeded = seed => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };

/**
 * A building model's use (the models table's uses, config/models.json): the use named in the model's own name when one
 * lists it (kk-dormitory: dormitory), else the first use that lists it. The engine's roles are coarse (shop, office,
 * station in W17-17r's city, its dorm an office): the model says what the building is.
 */
export function useOfModel(model, uses) {
  if (!model || !uses) return null;
  const listing = Object.entries(uses).filter(([, entry]) => Object.values(entry ?? {}).some(models => models && typeof models === 'object' && Object.hasOwn(models, model))).map(([use]) => use);
  return listing.find(use => String(model).includes(use)) ?? listing[0] ?? null;
}

/** The pattern a lot's windows follow: its named use's, else its role's, else the default. */
export function patternOf(lot, table) {
  return { ...(table?.default ?? {}), ...((lot.use && table?.uses?.[lot.use]) || table?.roles?.[lot.role] || {}) };
}

/**
 * A lot's openings: [floor, i, j, side, kind] for each cell edge of a room's outline that faces outside (the plan's edge or
 * an empty cell of it on that floor) and carries one. `lot`: sx, sz, cells (the plan's tiles, '0' none or a room's, others
 * corridors and stairs), rooms [[floor, i0, j0, i1, j1, top, kind, doors]], floors, k0, role, use; `seed` the lot's own.
 */
export function windowsOf(lot, table, seed) {
  const { sx, sz } = lot, pattern = patternOf(lot, table), every = Math.max(0, Math.round(pattern.every ?? 2)), out = [];
  if (!every || !lot.rooms?.length) return out;
  const at = (k, i, j) => (k * sz + j) * sx + i;
  // What fills each tile of each floor: a corridor or a stair (the plan's tiles) or a room.
  const filled = new Set();
  for (let cell = 0; cell < (lot.cells?.length ?? 0); cell++) if (lot.cells[cell] !== '0') filled.add(cell);
  for (const [k, i0, j0, i1, j1, top = k] of lot.rooms) for (let f = k; f <= top; f++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) filled.add(at(f, i, j));
  const outside = (k, i, j) => i < 0 || j < 0 || i >= sx || j >= sz || !filled.has(at(k, i, j));
  const ground = (lot.k0 ?? 0) === 0;
  lot.rooms.forEach(([k, i0, j0, i1, j1, top = k, kind = 0, doors = []], r) => {
    const rng = seeded(`${seed}|${k}|${r}`), door = new Set(doors), runs = [];
    // The room's outer edges, side by side: each side's cells in order along it.
    const sides = [
      [0, Array.from({ length: i1 - i0 + 1 }, (_, n) => [i0 + n, j0])],
      [1, Array.from({ length: i1 - i0 + 1 }, (_, n) => [i0 + n, j1])],
      [2, Array.from({ length: j1 - j0 + 1 }, (_, n) => [i0, j0 + n])],
      [3, Array.from({ length: j1 - j0 + 1 }, (_, n) => [i1, j0 + n])],
    ];
    for (const [side, cells] of sides) {
      const [di, dj] = SIDES[side], open = cells.filter(([i, j]) => outside(k, i + di, j + dj) && !door.has(at(k, i + di, j + dj)));
      if (open.length) runs.push({ side, cells: open });
    }
    if (!runs.length) return;
    const storefront = ground && k === 0 && pattern.storefront;
    const mine = [];
    for (const { side, cells } of runs) {
      const offset = Math.floor(rng() * every);
      cells.forEach(([i, j], n) => { if (storefront || (n + offset) % every === 0) mine.push([k, i, j, side, storefront ? OPENING.storefront : OPENING.window]); });
    }
    // Every room with an outer wall has a window at least (the middle of its longest outer side).
    if (!mine.length) { const longest = runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a)); const [i, j] = longest.cells[Math.floor(longest.cells.length / 2)]; mine.push([k, i, j, longest.side, OPENING.window]); }
    // A balcony door on an upper floor, by the kind's chance: the first window of the room's longest outer side.
    if (!storefront && k + (lot.k0 ?? 0) > 0 && rng() < (pattern.balcony ?? 0)) { const longest = runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a)), first = mine.find(entry => entry[3] === longest.side); if (first) first[4] = OPENING.balcony; }
    out.push(...mine);
  });
  return out;
}

/** A room made to have what its lines name (a window, a balcony): the opening added or turned on its outer wall; null when it has none. */
export function withOpening(lot, windows, room, want, table, seed) {
  const [k, i0, j0, i1, j1] = lot.rooms[room], inRoom = ([f, i, j]) => f === k && i >= i0 && i <= i1 && j >= j0 && j <= j1;
  const mine = windows.filter(inRoom);
  if (!mine.length) return null;
  if (want === 'balcony' && !mine.some(entry => entry[4] === OPENING.balcony)) { const first = mine.find(entry => entry[4] === OPENING.window); if (first) first[4] = OPENING.balcony; }
  return mine;
}

/** The heights of an opening of a kind (metres from its floor): sill and head, from the pattern. */
export function heightsOf(kind, pattern = {}) {
  if (kind === OPENING.balcony) return [0, pattern.doorHead ?? 2.2];
  if (kind === OPENING.storefront) return [pattern.storefrontSill ?? 0.3, pattern.storefrontHead ?? 2.6];
  return [pattern.sill ?? 0.9, pattern.head ?? 2.1];
}
