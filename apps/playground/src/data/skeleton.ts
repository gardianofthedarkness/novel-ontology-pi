/**
 * Buildings as circulation skeletons: only corridors and stairs, on a 3D grid
 * of 2 m cells and 3 m floors. Rooms, doors and furniture are left out; what
 * is not circulation is the building's mass.
 *
 * Whether a cell is corridor depends on the cells around it (an auto-logistic
 * Markov random field, sampled by Gibbs sweeps):
 *
 *   P(corridor | rest) = σ(h + a·(axial corridor neighbours) + c·(diagonal ones)
 *                         + v·(same cell on the floors above and below) + f·[on the facade])
 *
 * a > 0 lets corridors run on, c < 0 keeps them one cell wide (a 2×2 block
 * pays four diagonal pairs), v > 0 stacks floors alike, f < 0 leaves the
 * facade to rooms. Stairs are protected cores: a few interior columns,
 * spaced apart, stair on every floor; the field is sampled around them
 * (letting stairs appear wherever two floors happen to align made every
 * aligned column a shaft).
 *
 * The building is the entrance's cluster: a draw where the street door does
 * not reach a core on the ground floor is redrawn (conditioning on reach),
 * and corridor fragments the entrance cannot reach are dropped.
 *
 * Damage is the same field turned down locally: a hit of a given degree
 * destroys each standing cell with chance q·exp(−d²/2σ²) around the impact.
 * What still stands but no longer connects to the entrance is cut off; a
 * lost stair cuts off every floor that relied on it, which is where the
 * percolation behaviour shows.
 */
export const SKELETON_CELL = 2, FLOOR_HEIGHT = 3;
export const MASS = 0, CORRIDOR = 1, STAIR = 2;
export type SkeletonKind = "house" | "school" | "tower";
export interface SkeletonSpec { width: number; depth: number; floors: number; h: number; a: number; c: number; v: number; f: number; cores: number; sweeps: number }
export const SKELETON_SPECS: Record<SkeletonKind, SkeletonSpec> = {
  house: { width: 12, depth: 10, floors: 2, h: -1.4, a: 1.5, c: -1.8, v: 0.8, f: -0.4, cores: 1, sweeps: 40 },
  school: { width: 60, depth: 20, floors: 4, h: -1.3, a: 1.6, c: -1.8, v: 1.2, f: -0.6, cores: 2, sweeps: 40 },
  tower: { width: 20, depth: 20, floors: 20, h: -1.5, a: 1.6, c: -1.8, v: 1.2, f: -0.6, cores: 2, sweeps: 40 },
};
export interface Skeleton { kind: string; seed: number; nx: number; nz: number; floors: number; cells: Uint8Array; entrance: number; attempts: number }

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const skeletonStream = (...parts: (number | string)[]) => { let hash = 2166136261; for (const char of parts.join(":")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return mulberry32(hash >>> 0); };
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Cell index on the grid: i across, j in depth (toward the street), k the floor. */
export const cellIndex = (s: { nx: number; nz: number }, i: number, j: number, k: number) => (k * s.nz + j) * s.nx + i;
export const cellAt = (s: { nx: number; nz: number }, cell: number) => ({ i: cell % s.nx, j: Math.floor(cell / s.nx) % s.nz, k: Math.floor(cell / (s.nx * s.nz)) });

/** Walkable neighbours of a standing cell: corridor or stair next to it on its floor, and the stair above or below a stair. */
export function neighbours(s: Skeleton, standing: Uint8Array, cell: number): number[] {
  const { i, j, k } = cellAt(s, cell), out: number[] = [];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const [a, b] = [i + di, j + dj];
    if (a >= 0 && b >= 0 && a < s.nx && b < s.nz) { const next = cellIndex(s, a, b, k); if (standing[next]) out.push(next); }
  }
  if (s.cells[cell] === STAIR) for (const dk of [1, -1]) { const level = k + dk; if (level >= 0 && level < s.floors) { const next = cellIndex(s, i, j, level); if (standing[next] && s.cells[next] === STAIR) out.push(next); } }
  return out;
}

/** Cells reachable from the entrance over standing cells. */
export function reachable(s: Skeleton, standing: Uint8Array): Uint8Array {
  const seen = new Uint8Array(standing.length);
  if (!standing[s.entrance]) return seen;
  const queue = [s.entrance];
  seen[s.entrance] = 1;
  for (let head = 0; head < queue.length; head++) for (const next of neighbours(s, standing, queue[head])) if (!seen[next]) { seen[next] = 1; queue.push(next); }
  return seen;
}

export function generateSkeleton(kind: SkeletonKind, seed: number, overrides: Partial<SkeletonSpec> = {}, attempts = 30): Skeleton {
  const spec = { ...SKELETON_SPECS[kind], ...overrides }, nx = Math.round(spec.width / SKELETON_CELL), nz = Math.round(spec.depth / SKELETON_CELL), floors = spec.floors;
  const shape = { nx, nz }, size = nx * nz * floors, entrance = cellIndex(shape, Math.floor(nx / 2), nz - 1, 0);
  let last: Skeleton | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const rng = skeletonStream("skeleton", kind, seed, attempt), x = new Uint8Array(size), stair = new Uint8Array(size);
    for (let cell = 0; cell < size; cell++) x[cell] = rng() < sigmoid(spec.h) ? 1 : 0;
    // Cores: interior columns at least 4 cells apart, stair on every floor.
    const columns: [number, number][] = [];
    for (let tries = 0; columns.length < spec.cores && tries < 200; tries++) {
      const [i, j] = [1 + Math.floor(rng() * Math.max(1, nx - 2)), 1 + Math.floor(rng() * Math.max(1, nz - 2))];
      if (columns.every(([a, b]) => Math.abs(a - i) + Math.abs(b - j) >= 4)) columns.push([i, j]);
    }
    for (const [i, j] of columns) for (let k = 0; k < floors; k++) stair[cellIndex(shape, i, j, k)] = 1;
    // The street door, the cell inside it and the cores are corridor whatever the draw.
    const fixed = new Set([entrance, cellIndex(shape, Math.floor(nx / 2), nz - 2, 0), ...columns.flatMap(([i, j]) => Array.from({ length: floors }, (_, k) => cellIndex(shape, i, j, k)))]);
    for (const cell of fixed) x[cell] = 1;
    const get = (i: number, j: number, k: number, field: Uint8Array) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < nz && k < floors ? field[cellIndex(shape, i, j, k)] : 0;
    for (let sweep = 0; sweep < spec.sweeps; sweep++) {
      for (let k = 0; k < floors; k++) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const cell = cellIndex(shape, i, j, k);
        if (fixed.has(cell)) continue;
        const axial = get(i + 1, j, k, x) + get(i - 1, j, k, x) + get(i, j + 1, k, x) + get(i, j - 1, k, x);
        const diagonal = get(i + 1, j + 1, k, x) + get(i - 1, j + 1, k, x) + get(i + 1, j - 1, k, x) + get(i - 1, j - 1, k, x);
        const facade = i === 0 || j === 0 || i === nx - 1 || j === nz - 1 ? 1 : 0;
        x[cell] = rng() < sigmoid(spec.h + spec.a * axial + spec.c * diagonal + spec.v * (get(i, j, k + 1, x) + get(i, j, k - 1, x)) + spec.f * facade) ? 1 : 0;
      }
    }
    const cells = new Uint8Array(size);
    for (let cell = 0; cell < size; cell++) cells[cell] = x[cell] ? CORRIDOR : MASS;
    for (let cell = 0; cell < size; cell++) if (stair[cell]) cells[cell] = floors > 1 ? STAIR : CORRIDOR;
    const skeleton: Skeleton = { kind, seed, nx, nz, floors, cells, entrance, attempts: attempt };
    // Keep the entrance's cluster; accept when every floor is in it.
    const seen = reachable(skeleton, cells);
    for (let cell = 0; cell < size; cell++) if (!seen[cell]) cells[cell] = MASS;
    last = skeleton;
    const reached = new Set<number>();
    for (let cell = 0; cell < size; cell++) if (cells[cell]) reached.add(cellAt(skeleton, cell).k);
    if (reached.size === floors) return skeleton;
  }
  return last!;
}

/** Degrees of damage a decision model can name, as the chance a cell at the impact is destroyed and the reach of the blast (m). */
export const DAMAGE = [{ name: "none", q: 0, reach: 0 }, { name: "scratched", q: 0.25, reach: 3 }, { name: "damaged", q: 0.5, reach: 5 }, { name: "heavy", q: 0.75, reach: 8 }, { name: "destroyed", q: 0.95, reach: 12 }] as const;
export interface Hit { x: number; y: number; z: number; degree: number }
export const cellCentre = (s: Skeleton, cell: number) => { const { i, j, k } = cellAt(s, cell); return { x: (i + 0.5) * SKELETON_CELL, y: k * FLOOR_HEIGHT + FLOOR_HEIGHT / 2, z: (j + 0.5) * SKELETON_CELL }; };

/** One hit on a standing skeleton: the cells it destroys, and the standing cells it cuts off from the entrance. */
export function strike(s: Skeleton, standing: Uint8Array, hit: Hit, rng: () => number): { standing: Uint8Array; destroyed: number[]; cutOff: number[] } {
  const { q, reach } = DAMAGE[hit.degree], after = standing.slice(), destroyed: number[] = [], sigma = Math.max(1e-6, reach / 2);
  for (let cell = 0; cell < after.length; cell++) {
    if (!after[cell]) continue;
    const c = cellCentre(s, cell), d2 = (c.x - hit.x) ** 2 + (c.y - hit.y) ** 2 + (c.z - hit.z) ** 2;
    if (rng() < q * Math.exp(-d2 / (2 * sigma * sigma))) { after[cell] = 0; destroyed.push(cell); }
  }
  const seen = reachable(s, after), cutOff: number[] = [];
  for (let cell = 0; cell < after.length; cell++) if (after[cell] && !seen[cell]) cutOff.push(cell);
  return { standing: after, destroyed, cutOff };
}

/** How a building falls apart under uniform damage: per level q, the mean share of its circulation still reached, and the chance its top floor is. */
export function robustness(s: Skeleton, levels: number[], samples: number, seed = 1): { q: number; reached: number; top: number }[] {
  const walkable = s.cells.reduce((sum, value) => sum + (value ? 1 : 0), 0), top = s.floors - 1;
  return levels.map((q) => {
    let reached = 0, topHits = 0;
    for (let sample = 0; sample < samples; sample++) {
      const rng = skeletonStream("robust", s.kind, s.seed, seed, q, sample), standing = new Uint8Array(s.cells.length);
      for (let cell = 0; cell < standing.length; cell++) standing[cell] = s.cells[cell] && (cell === s.entrance || rng() >= q) ? 1 : 0;
      const seen = reachable(s, standing);
      let count = 0, onTop = false;
      for (let cell = 0; cell < seen.length; cell++) if (seen[cell]) { count++; if (cellAt(s, cell).k === top) onTop = true; }
      reached += count / walkable; if (onTop) topHits++;
    }
    return { q, reached: reached / samples, top: topHits / samples };
  });
}

/**
 * Rooms: whole boxes of mass, each opening onto circulation through a door or a few.
 * The conditions a room R = [i0..i1] × [j0..j1] on floors k0..k1 must meet:
 *   (1) R ⊆ mass on every one of its floors, and no cell of R in another room;
 *   (2) R holds a door cell on its bottom floor: a cell with a corridor or stair beside it (axially);
 *   (3) R grows from that door cell, a side strip at a time, each with chance
 *       σ(g − α·(|R ∪ strip| − m̄_k)), only onto free mass;
 * so every room reaches a corridor by construction. Mass that no room reaches stays solid (structure, shafts).
 *
 * How large, by where in the building (the user, 2026-11-02): in a bigger building halls and rooms of several floors
 * come first, at the bottom (a lobby, a gym, an auditorium) or the top (a hall, a penthouse), and the rooms between are
 * the building's usual size. On floor k of F the pull toward the ends is e(k) = max(e^(−k/λ), e^(−(F−1−k)/λ)), λ = max(1,
 * F/6); a room's mean there is m̄·(1 + 2·e(k)) in a big building (a floor of 60 cells or more, 240 m²), m̄ elsewhere. A
 * hall (mean a third of the floor's free mass, 12 to 120 cells) is tried on a floor with chance 0.8·e(k) in a big
 * building, 0.15·e(k) in a small one; one at the bottom or the top of a big building of three floors or more may rise
 * through two floors (three in a tall one: ten floors and a floor of 120 cells), its upper floors open air over its floor.
 * A room keeps one door (two for a hall, three for one of several floors), spread along its walls, not every corridor
 * cell beside it: a way in is a door.
 */
export type RoomKind = "room" | "hall" | "tall";
export interface RoomBox { floor: number; top: number; kind: RoomKind; i0: number; j0: number; i1: number; j1: number; doors: number[] }
export const ROOM_SIZE: Record<SkeletonKind, number> = { house: 4, school: 18, tower: 6 };
/** A floor of this many cells or more makes a big building (halls, rooms of several floors). */
export const BIG_FLOOR = 60;

/** The pull of floor k of F toward the building's ends (1 at the bottom and the top). */
export const endPull = (k: number, floors: number) => { const lambda = Math.max(1, floors / 6); return Math.max(Math.exp(-k / lambda), Math.exp(-(floors - 1 - k) / lambda)); };

export function furnish(s: Skeleton, seed: number, options: { mean?: number; g?: number; alpha?: number } = {}): RoomBox[] {
  const base = options.mean ?? ROOM_SIZE[s.kind as SkeletonKind] ?? 6, g = options.g ?? 3, alpha = options.alpha ?? 0.5;
  const rng = skeletonStream("rooms", s.kind, s.seed, seed), taken = new Uint8Array(s.cells.length), out: RoomBox[] = [];
  const big = s.nx * s.nz >= BIG_FLOOR, tall = s.floors >= 10 && s.nx * s.nz >= 120;
  const mass = (i: number, j: number, k: number) => i >= 0 && j >= 0 && i < s.nx && j < s.nz && k < s.floors && s.cells[cellIndex(s, i, j, k)] === MASS && !taken[cellIndex(s, i, j, k)];
  const circulation = (i: number, j: number, k: number) => i >= 0 && j >= 0 && i < s.nx && j < s.nz && s.cells[cellIndex(s, i, j, k)] !== MASS;
  const doorsOf = (i: number, j: number, k: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => circulation(i + di, j + dj, k)).map(([di, dj]) => cellIndex(s, i + di, j + dj, k));
  // A room grown from a door cell on floor k through `rise` floors (free mass on each), toward its mean; null when it cannot stand.
  const grow = (start: number, rise: number, mean: number, kind: RoomKind): RoomBox | null => {
    const { i, j, k } = cellAt(s, start), free = (a: number, b: number) => { for (let level = k; level < k + rise; level++) if (!mass(a, b, level)) return false; return true; };
    if (!free(i, j)) return null;
    const box = { i0: i, j0: j, i1: i, j1: j };
    for (let grew = true; grew; ) {
      grew = false;
      for (const side of [0, 1, 2, 3].sort(() => rng() - 0.5)) {
        const strip: [number, number][] = side === 0 ? range(box.j0, box.j1).map((b) => [box.i1 + 1, b]) : side === 1 ? range(box.j0, box.j1).map((b) => [box.i0 - 1, b])
          : side === 2 ? range(box.i0, box.i1).map((a) => [a, box.j1 + 1]) : range(box.i0, box.i1).map((a) => [a, box.j0 - 1]);
        const area = (box.i1 - box.i0 + 1) * (box.j1 - box.j0 + 1) + strip.length;
        if (!strip.every(([a, b]) => free(a, b)) || rng() >= sigmoid(g - alpha * (area - mean) / Math.max(1, mean / 6))) continue;
        if (side === 0) box.i1++; else if (side === 1) box.i0--; else if (side === 2) box.j1++; else box.j0--;
        grew = true;
      }
    }
    // A hall smaller than a third of its mean is no hall: left for rooms.
    if (kind !== "room" && (box.i1 - box.i0 + 1) * (box.j1 - box.j0 + 1) < Math.max(8, mean / 3)) return null;
    for (let level = k; level < k + rise; level++) for (let a = box.i0; a <= box.i1; a++) for (let b = box.j0; b <= box.j1; b++) taken[cellIndex(s, a, b, level)] = 1;
    // Its doors: the circulation cells beside its bottom floor, a few of them spread apart (the first at random, each next
    // the farthest from those kept).
    const all = new Set<number>();
    for (let a = box.i0; a <= box.i1; a++) for (let b = box.j0; b <= box.j1; b++) for (const door of doorsOf(a, b, k)) all.add(door);
    const candidates = [...all], want = kind === "tall" ? 3 : kind === "hall" ? 2 : 1, doors: number[] = [];
    if (candidates.length) doors.push(candidates[Math.floor(rng() * candidates.length)]);
    while (doors.length < Math.min(want, candidates.length)) {
      const far = (cell: number) => Math.min(...doors.map((door) => { const p = cellAt(s, cell), q = cellAt(s, door); return Math.abs(p.i - q.i) + Math.abs(p.j - q.j); }));
      doors.push(candidates.filter((cell) => !doors.includes(cell)).sort((x, y) => far(y) - far(x))[0]);
    }
    return { floor: k, top: k + rise - 1, kind, ...box, doors };
  };
  const seedsOn = (k: number) => { const list: number[] = []; for (let j = 0; j < s.nz; j++) for (let i = 0; i < s.nx; i++) if (mass(i, j, k) && doorsOf(i, j, k).length) list.push(cellIndex(s, i, j, k)); for (let n = list.length - 1; n > 0; n--) { const m = Math.floor(rng() * (n + 1)); [list[n], list[m]] = [list[m], list[n]]; } return list; };
  // Halls first, the ends of the building before its middle.
  for (let k = 0; k < s.floors; k++) {
    const pull = endPull(k, s.floors);
    if (rng() >= (big ? 0.8 : 0.15) * pull) continue;
    let freeMass = 0; for (let j = 0; j < s.nz; j++) for (let i = 0; i < s.nx; i++) if (mass(i, j, k)) freeMass++;
    const mean = Math.max(12, Math.min(120, freeMass / 3)), end = k === 0 || k === s.floors - 2 || k === s.floors - 1;
    const rise = big && s.floors >= 3 && end && k + 1 < s.floors && rng() < (k === 0 ? 0.5 : 0.3) ? (tall && k + 2 < s.floors ? 3 : 2) : 1;
    for (const start of seedsOn(k).slice(0, 6)) { const room = grow(start, rise, mean, rise > 1 ? "tall" : "hall") ?? (rise > 1 ? grow(start, 1, mean, "hall") : null); if (room) { out.push(room); break; } }
  }
  // Then rooms, larger toward the ends of a big building.
  for (let k = 0; k < s.floors; k++) {
    const mean = big ? base * (1 + 2 * endPull(k, s.floors)) : base;
    for (const start of seedsOn(k)) { if (taken[start]) continue; const room = grow(start, 1, mean, "room"); if (room) out.push(room); }
  }
  return out;
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
