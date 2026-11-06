import { MASS, STAIR, SKELETON_CELL, FLOOR_HEIGHT, cellAt, cellIndex, furnish, generateSkeleton, skeletonStream, type Skeleton, type SkeletonKind } from "./skeleton.js";
import { EDGE, UP, DOWN, WALL_KINDS, buildGraph, buildGraphAt, directionOf, launchOf, type MoveGraph } from "./pathIntegral.js";
import { ARC_EFFORT, ARC_SPEEDS, GROUND, type BuildingRole, type PlaceLot, type PlacedThing } from "./skeletonPlace.js";
import { boundsOf, inHall, intervalsOf, pillarAt, type Hall } from "./underground.js";

/**
 * The stage's world: one city, streamed in as the story reaches it. Its source is the canvas of places with each open
 * place's landscape filled (src/v2/world): every building, road and plaza in world metres. The world is cut into
 * chunks of 32 m; a chunk is materialized (its roads and plazas laid on the 2 m grid, each source building standing on it
 * becoming a lot with its own circulation skeleton) the first moment someone, something or a blast comes within reach of
 * it, and remembers that moment, so a run can show the world being explored. A staged building (a scene's own place) is an
 * anchor: it takes the source lots under it, on its canvas spot.
 *
 * Walking follows the place grid's rules (skeletonPlace.ts): 8 directions outdoors and on roofs, 4 inside, stairs a floor
 * at a time, street doors, roof jumps across an alley, falls and sky arcs. Nodes are numbered as they are first seen and
 * never renumbered, so positions kept from earlier moments stay valid as the world grows.
 */
export const CHUNK = 16;
/** Floors a skeleton is walked up to; a taller building keeps its full height for its shell. */
export const WALK_FLOORS = 40;
const OFF = 32768, NOT = -1;
/** Each lot's room map, and each world's node places, kept between walk graph builds (worldGraph). */
const ROOMS = new WeakMap<object, Int32Array>(), POSITIONS = new WeakMap<object, { x: Float64Array; z: Float64Array; y: Float64Array }>();
export const cellKey = (i: number, j: number) => (i + OFF) * 65536 + (j + OFF);
const chunkKey = (ci: number, cj: number) => cellKey(ci, cj);
/** A chunk's ground in metres, from its key (as `world.chunks` holds it). */
export const chunkBounds = (key: number) => { const ci = Math.floor(key / 65536) - OFF, cj = (key % 65536) - OFF, m = CHUNK * SKELETON_CELL; return { x0: ci * m, x1: (ci + 1) * m, z0: cj * m, z1: (cj + 1) * m }; };
const nodeKey = (i: number, j: number, k: number) => cellKey(i, j) * 1024 + k + 64;

/**
 * Underground (docs/underground-design.md): halls in the ground, not buildings.
 * - Every building of 2 floors or more has basements under its footprint, a floor per 3 m (one; two from 10 floors; three
 *   from 20), down its stair core, with a car park's pillars on an 8 m grid.
 * - The halls of `source.underground` (stations and tunnels, malls, the storm-water tank and channels, deep facilities;
 *   src/v2/world/underground.ts) lie on the grid at their floor's level, with their pillars, when their chunk is laid.
 *   They are reached by their ways up (a station's and a mall's ends to the pavement, a shaft from a tank or a channel's
 *   end, a lift to a deep facility from the building over it or the street), and a channel meets its tank where it starts.
 * - A hall's cell closes under a pile of fallen ground 2 m or more (a cave-in: `underDamage`).
 */
/** Levels below the street a node may be on (the deepest hall's floor is above this). */
export const UNDER_LEVELS = 36;
export const basementsOf = (lot: { floors: number; height?: number }) => { const floors = lot.height ?? lot.floors; return floors >= 20 ? 3 : floors >= 10 ? 2 : floors >= 2 ? 1 : 0; };
export const levelOf = (depth: number) => -Math.round(depth / FLOOR_HEIGHT);
const carParkPillar = (lot: WorldLot, i: number, j: number) => (i - lot.i0) % 4 === 2 && (j - lot.j0) % 4 === 2 && i - lot.i0 < lot.nx - 1 && j - lot.j0 < lot.nz - 1;
/** The open ground nearest a point (metres) within `radius` cells, on ground the world has laid: where a hall's stairs come up. */
export function streetNear(world: World, x: number, z: number, radius = 30): [number, number] | null {
  const i0 = Math.floor(x / SKELETON_CELL), j0 = Math.floor(z / SKELETON_CELL);
  for (let r = 0; r <= radius; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const key = cellKey(i0 + di, j0 + dj);
    if (world.ground.has(key) && !world.lotAt.has(key) && !world.clutter.has(key)) return [(i0 + di + 0.5) * SKELETON_CELL, (j0 + dj + 0.5) * SKELETON_CELL];
  }
  return null;
}
/** A hall node's lot: past every building's and thing's, so a node says which hall it is. */
export const HALL_LOT = 1_000_000;
/** The halls on a cell, each at its floor's level, as the chunk laid them. */
export const hallsAt = (world: World, i: number, j: number) => world.under.get(cellKey(i, j)) ?? [];

/** `manifold`: a fingerprint of the landscape it was filled from, so damage kept for it applies only while that landscape stands. */
/** `model`: the 3D model its use is drawn as (useModels.ts modelFor), kept when it stands as a lot. */
export interface SourceBuilding { id: string; x: number; z: number; w: number; d: number; angle: number; floors: number; kind: string; manifold?: string; era?: string; model?: string | null }
export interface SourceRoad { a: [number, number]; b: [number, number]; width: number; level: string }
/** A staged place where the canvas put it: a building of its own (`own`, a site) on its spot, or the middle of an open place. */
export interface Anchor { place: string; label: string; x: number; z: number; own: boolean; role: BuildingRole; floors: number; era?: string }
/** What lies under the city (hallsOf and subwayOf in src/v2/world/underground.ts), in world metres; `area`: the place each hall's middle lies in. */
export interface WorldUnderground { halls: (Hall & { area?: string | null })[] }
export interface WorldSource { buildings: SourceBuilding[]; roads: SourceRoad[]; plazas: { x: number; z: number; r: number }[]; anchors: Anchor[]; underground?: WorldUnderground }

/** A lot of the world: its footprint in world cells, its skeleton walked up to WALK_FLOORS, its full `height` in floors for its shell. */
/** `era`: of the landscape patch the lot's building stands on (modern or ancient), which decides how it is drawn. */
/**
 * `frame`: a building of the city stands at its true size and turn (the user, 2026-11-02: reached buildings shrank to the
 * grid, a cinema fell between two buildings): its plan (skeleton, rooms) is laid in its own frame, centred on (x, z) and
 * turned by `angle`, and each world cell inside its footprint is the plan's cell under that cell's middle (localCell).
 * i0, j0, nx, nz are then the footprint's bounds on the world grid. Without a frame (a staged building), the plan's cells
 * are the world's from i0, j0.
 */
export interface WorldLot extends PlaceLot { source: string; manifold: string; era: string; height: number; born: number | string; place: string | null; frame?: { x: number; z: number; angle: number } }
export interface World {
  source: WorldSource;
  /** Materialized chunks and the moment each was. */
  chunks: Map<number, number | string>;
  lots: WorldLot[];
  lotAt: Map<number, number>;
  ground: Map<number, number>;
  clutter: Set<number>;
  /** The halls on each cell (by cellKey): which hall, its floor's level, whether a pillar stands there. */
  under: Map<number, { hall: number; k: number; pillar: boolean }[]>;
  /** What cave-ins left: per hall, the pile on each of its cells (metres, by cellKey); and the dents in the ground (metres). */
  underDamage: { piles: Map<number, Map<number, number>>; dents: Map<number, number> };
  /** Node ids: the key of (i, j, k) → id, and each id's cell (i, j, k), never renumbered. */
  ids: Map<number, number>;
  cells: number[];
  claimed: Set<string>;
  /** Source buildings that never stand as lots, and the moment that was settled: under a staged building, or with no room left on the grid (a road or another lot where they would stand). Their faint copies go then too. */
  dropped: Map<string, number | string>;
  buckets: { buildings: Map<number, number[]>; roads: Map<number, number[]>; halls: Map<number, number[]> };
}

const KIND_OF: Record<string, SkeletonKind> = { skyscraper: "tower", tower: "tower", office: "tower", "block-wide": "school", hall: "school", school: "school", hospital: "school", station: "school", stadium: "school", warehouse: "school", factory: "school", keep: "tower" };
const ROLE_SIZE: Record<BuildingRole, [number, number]> = { office: [12, 10], shop: [7, 6], hospital: [15, 9], station: [15, 8], school: [18, 10], home: [11, 8], mall: [18, 14] };
const ROLE_KIND: Record<BuildingRole, SkeletonKind> = { office: "tower", shop: "house", hospital: "school", station: "school", school: "school", home: "tower", mall: "school" };
export const roleOf = (kind: string, floors: number): BuildingRole => (KIND_OF[kind] === "tower" || floors >= 8 ? "office" : KIND_OF[kind] === "school" ? "station" : "shop");
const seedOf = (text: string) => [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);

export function createWorld(source: WorldSource): World {
  const world: World = { source, chunks: new Map(), lots: [], lotAt: new Map(), ground: new Map(), clutter: new Set(), under: new Map(), underDamage: { piles: new Map(), dents: new Map() }, ids: new Map(), cells: [], claimed: new Set(), dropped: new Map(), buckets: { buildings: new Map(), roads: new Map(), halls: new Map() } };
  const span = CHUNK * SKELETON_CELL, add = (map: Map<number, number[]>, key: number, index: number) => { const list = map.get(key); if (list) list.push(index); else map.set(key, [index]); };
  source.buildings.forEach((b, index) => { const r = Math.hypot(b.w, b.d) / 2; for (let ci = Math.floor((b.x - r) / span); ci <= Math.floor((b.x + r) / span); ci++) for (let cj = Math.floor((b.z - r) / span); cj <= Math.floor((b.z + r) / span); cj++) add(world.buckets.buildings, chunkKey(ci, cj), index); });
  source.roads.forEach((road, index) => { const r = road.width / 2 + 1; for (let ci = Math.floor((Math.min(road.a[0], road.b[0]) - r) / span); ci <= Math.floor((Math.max(road.a[0], road.b[0]) + r) / span); ci++) for (let cj = Math.floor((Math.min(road.a[1], road.b[1]) - r) / span); cj <= Math.floor((Math.max(road.a[1], road.b[1]) + r) / span); cj++) add(world.buckets.roads, chunkKey(ci, cj), index); });
  (source.underground?.halls ?? []).forEach((hall, index) => { const b = boundsOf(hall); for (let ci = Math.floor(b.x0 / span); ci <= Math.floor(b.x1 / span); ci++) for (let cj = Math.floor(b.z0 / span); cj <= Math.floor(b.z1 / span); cj++) add(world.buckets.halls, chunkKey(ci, cj), index); });
  return world;
}

const toSegment = (x: number, z: number, a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
const onRoad = (world: World, x: number, z: number) => { const span = CHUNK * SKELETON_CELL; return (world.buckets.roads.get(chunkKey(Math.floor(x / span), Math.floor(z / span))) ?? []).some((index) => { const road = world.source.roads[index]; return toSegment(x, z, road.a, road.b) <= road.width / 2; }); };

/** The largest axis-aligned rectangle (centred) inside a building turned by `angle`: its half sizes in metres. */
export function inscribed(w: number, d: number, angle: number): [number, number] {
  let turn = ((angle % Math.PI) + Math.PI) % Math.PI, [W, D] = [w, d];
  if (turn > Math.PI / 2) turn = Math.PI - turn;
  if (turn > Math.PI / 4) { turn = Math.PI / 2 - turn; [W, D] = [d, w]; }
  const c = Math.cos(turn), s = Math.sin(turn), t = Math.min(1, W / (W * c + D * s), D / (W * s + D * c));
  return [(W * t) / 2, (D * t) / 2];
}

interface Cells { i0: number; j0: number; nx: number; nz: number }
/**
 * Where a source building stands on the grid: the largest axis-aligned rectangle inside it. A thin building turned
 * well off the grid would shrink below a lot that way (under 3 cells across), so it is turned to the nearest axis
 * instead, at nine tenths of its width and depth.
 */
function cellsFor(b: SourceBuilding): Cells {
  const cells = (hx: number, hz: number) => { const i0 = Math.ceil((b.x - hx) / SKELETON_CELL), j0 = Math.ceil((b.z - hz) / SKELETON_CELL); return { i0, j0, nx: Math.floor((b.x + hx) / SKELETON_CELL) - i0, nz: Math.floor((b.z + hz) / SKELETON_CELL) - j0 }; };
  const inside = cells(...inscribed(b.w, b.d, b.angle));
  if (inside.nx >= 3 && inside.nz >= 3) return inside;
  const across = Math.abs(Math.sin(b.angle)) > Math.SQRT1_2, [w, d] = across ? [b.d, b.w] : [b.w, b.d];
  return cells(w * 0.45, d * 0.45);
}
/** The largest rectangle (3 cells across at least) of cells no lot and no road holds (nor any `taken`), inside a rectangle of cells; null with none. */
function largestFree(world: World, { i0, j0, nx, nz }: Cells, taken?: Set<number>): Cells | null {
  const heights = new Array<number>(nx).fill(0);
  let best: Cells | null = null, area = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) heights[i] = !world.lotAt.has(cellKey(i0 + i, j0 + j)) && !taken?.has(cellKey(i0 + i, j0 + j)) && !onRoad(world, (i0 + i + 0.5) * SKELETON_CELL, (j0 + j + 0.5) * SKELETON_CELL) ? heights[i] + 1 : 0;
    // The largest rectangle standing on this row: for each run of columns, as tall as its shortest.
    const stack: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const height = i < nx ? heights[i] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= height) {
        const top = heights[stack.pop()!], left = stack.length ? stack[stack.length - 1] + 1 : 0, width = i - left;
        if (top >= 3 && width >= 3 && top * width > area) { area = top * width; best = { i0: i0 + left, j0: j0 + j - top + 1, nx: width, nz: top }; }
      }
      stack.push(i);
    }
  }
  return best;
}

/** The cell of a lot's own plan (its skeleton's i, j) under a world cell's middle; null outside its plan. */
export function localCell(lot: { i0: number; j0: number; skeleton: { nx: number; nz: number }; frame?: { x: number; z: number; angle: number } }, i: number, j: number): [number, number] | null {
  const { nx, nz } = lot.skeleton;
  if (!lot.frame) { const li = i - lot.i0, lj = j - lot.j0; return li >= 0 && lj >= 0 && li < nx && lj < nz ? [li, lj] : null; }
  const dx = (i + 0.5) * SKELETON_CELL - lot.frame.x, dz = (j + 0.5) * SKELETON_CELL - lot.frame.z, c = Math.cos(lot.frame.angle), s = Math.sin(lot.frame.angle);
  const li = Math.floor((dx * c + dz * s + (nx * SKELETON_CELL) / 2) / SKELETON_CELL), lj = Math.floor((-dx * s + dz * c + (nz * SKELETON_CELL) / 2) / SKELETON_CELL);
  return li >= 0 && lj >= 0 && li < nx && lj < nz ? [li, lj] : null;
}
/** The world cells whose middles lie inside a turned footprint (its true size), and their bounds. */
export function footprintOf(b: { x: number; z: number; w: number; d: number; angle: number }): { cells: [number, number][]; i0: number; j0: number; nx: number; nz: number } {
  const c = Math.cos(b.angle), s = Math.sin(b.angle), r = Math.hypot(b.w, b.d) / 2, cells: [number, number][] = [];
  for (let j = Math.floor((b.z - r) / SKELETON_CELL); j <= Math.floor((b.z + r) / SKELETON_CELL); j++) for (let i = Math.floor((b.x - r) / SKELETON_CELL); i <= Math.floor((b.x + r) / SKELETON_CELL); i++) {
    const dx = (i + 0.5) * SKELETON_CELL - b.x, dz = (j + 0.5) * SKELETON_CELL - b.z;
    if (Math.abs(dx * c + dz * s) <= b.w / 2 && Math.abs(-dx * s + dz * c) <= b.d / 2) cells.push([i, j]);
  }
  const is = cells.map(([i]) => i), js = cells.map(([, j]) => j);
  return cells.length ? { cells, i0: Math.min(...is), j0: Math.min(...js), nx: Math.max(...is) - Math.min(...is) + 1, nz: Math.max(...js) - Math.min(...js) + 1 } : { cells, i0: 0, j0: 0, nx: 0, nz: 0 };
}
/**
 * A source building standing at its true size and turn: its plan laid in its own frame (the corridors, stairs and rooms
 * of the building as it is, not of a rectangle cut out of it), on the cells of its footprint no road and no lot holds;
 * at least half of them, else it stands as a shell only.
 */
/**
 * Whether a cell of building `order`'s footprint is its own: no building before it in the landscape's order covers the
 * cell's middle (the landscape's own rule, earlier patches win). Decided by the buildings alone, never by which chunk was
 * reached first, so the world stands the same whatever order it is streamed in (the user's research handoff, 2026-11-02:
 * a chunk is a function of the seed and its place; the same building held different cells in two runs).
 */
function ownCell(world: World, order: number, i: number, j: number): boolean {
  const x = (i + 0.5) * SKELETON_CELL, z = (j + 0.5) * SKELETON_CELL;
  for (const other of world.buckets.buildings.get(chunkKey(Math.floor(i / CHUNK), Math.floor(j / CHUNK))) ?? []) {
    if (other >= order) continue;
    const b = world.source.buildings[other], dx = x - b.x, dz = z - b.z, c = Math.cos(b.angle), s = Math.sin(b.angle);
    // Strictly inside: a cell on its edge is not held by its plan either, so it stays this building's.
    if (Math.abs(dx * c + dz * s) < b.w / 2 && Math.abs(-dx * s + dz * c) < b.d / 2) return false;
  }
  return true;
}
function standTurned(world: World, b: SourceBuilding, order: number, lot: Omit<WorldLot, "skeleton" | "rooms" | "side" | "i0" | "j0" | "nx" | "nz" | "frame">, kind: SkeletonKind, seed: number): boolean {
  // The building wins over a road the terrain left under it (a street moved since its lots were laid: a 65-floor tower on
  // one, 2026-11-02); where it is built into a neighbour, the part an earlier building covers is that one's (ownCell). It
  // stands with whatever is its own, so every building drawn has its inside (the user: a cinema in a mall walked out of and
  // back into).
  const foot = footprintOf(b), free = foot.cells.filter(([i, j]) => !world.lotAt.has(cellKey(i, j)) && ownCell(world, order, i, j));
  if (foot.cells.length < 4 || free.length < 4) return false;
  const w = Math.max(2 * SKELETON_CELL, b.w), d = Math.max(2 * SKELETON_CELL, b.d);
  const skeleton: Skeleton = generateSkeleton(kind, seed, { width: w, depth: d, floors: lot.floors, cores: (w * d) / (SKELETON_CELL * SKELETON_CELL) > 48 ? 2 : 1 });
  const index = world.lots.push({ ...lot, i0: foot.i0, j0: foot.j0, nx: foot.nx, nz: foot.nz, frame: { x: b.x, z: b.z, angle: b.angle }, side: "west", skeleton, rooms: furnish(skeleton, 1) }) - 1;
  // Held: the free cells that fall inside its plan (a plan is whole 2 m cells, so an edge cell may fall just outside it).
  for (const [i, j] of free) if (localCell(world.lots[index], i, j)) world.lotAt.set(cellKey(i, j), index);
  return true;
}
/** A lot standing on cells i0..i0+nx, j0..j0+nz, unless one of them is taken (a lot, or a road). */
function standLot(world: World, lot: Omit<WorldLot, "skeleton" | "rooms" | "side">, kind: SkeletonKind, seed: number): boolean {
  for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) if (world.lotAt.has(cellKey(i, j)) || onRoad(world, (i + 0.5) * SKELETON_CELL, (j + 0.5) * SKELETON_CELL)) return false;
  const skeleton: Skeleton = generateSkeleton(kind, seed, { width: lot.nx * SKELETON_CELL, depth: lot.nz * SKELETON_CELL, floors: lot.floors, cores: lot.nx * lot.nz > 48 ? 2 : 1 });
  const index = world.lots.push({ ...lot, side: "west", skeleton, rooms: furnish(skeleton, 1) }) - 1;
  for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) world.lotAt.set(cellKey(i, j), index);
  return true;
}

/** Lay one chunk: open ground, roads, plazas, the anchors' buildings, then every source building standing on it. */
function materialize(world: World, ci: number, cj: number, born: number | string) {
  world.chunks.set(chunkKey(ci, cj), born);
  const i0 = ci * CHUNK, j0 = cj * CHUNK, x0 = i0 * SKELETON_CELL, z0 = j0 * SKELETON_CELL, span = CHUNK * SKELETON_CELL;
  for (let j = j0; j < j0 + CHUNK; j++) for (let i = i0; i < i0 + CHUNK; i++) {
    const x = (i + 0.5) * SKELETON_CELL, z = (j + 0.5) * SKELETON_CELL;
    world.ground.set(cellKey(i, j), onRoad(world, x, z) ? GROUND.avenue : world.source.plazas.some((p) => Math.hypot(x - p.x, z - p.z) <= p.r) ? GROUND.plaza : GROUND.street);
    // The halls under this cell, at their floors' levels, with their pillars.
    for (const index of world.buckets.halls.get(chunkKey(ci, cj)) ?? []) { const hall = world.source.underground!.halls[index]; if (inHall(hall, [x, z])) (world.under.get(cellKey(i, j)) ?? world.under.set(cellKey(i, j), []).get(cellKey(i, j))!).push({ hall: index, k: levelOf(hall.depth), pillar: pillarAt(hall, [x, z]) }); }
  }
  // A staged building on its spot, clearing the source buildings under it; the street in front of its door stays open.
  for (const anchor of world.source.anchors) {
    if (!anchor.own || world.claimed.has(`anchor:${anchor.place}`) || anchor.x < x0 - 40 || anchor.x > x0 + span + 40 || anchor.z < z0 - 40 || anchor.z > z0 + span + 40) continue;
    world.claimed.add(`anchor:${anchor.place}`);
    const [w, d] = ROLE_SIZE[anchor.role], nx = w, nz = d, ai = Math.round(anchor.x / SKELETON_CELL - nx / 2), aj = Math.round(anchor.z / SKELETON_CELL - nz / 2);
    for (const b of world.source.buildings) if (Math.abs(b.x - anchor.x) < (nx * SKELETON_CELL + b.w) / 2 + 2 && Math.abs(b.z - anchor.z) < (nz * SKELETON_CELL + b.d) / 2 + 2 && !world.claimed.has(b.id)) { world.claimed.add(b.id); world.dropped.set(b.id, born); }
    for (let j = aj; j < aj + nz; j++) for (let i = ai; i < ai + nx; i++) world.lotAt.delete(cellKey(i, j));
    const lot = { id: `anchor_${anchor.place}`, label: anchor.label, role: anchor.role, i0: ai, j0: aj, nx, nz, floors: Math.min(WALK_FLOORS, anchor.floors), height: anchor.floors, source: `anchor:${anchor.place}`, manifold: "anchor", era: anchor.era ?? "modern", born, place: anchor.place };
    const skeleton = generateSkeleton(ROLE_KIND[anchor.role], seedOf(anchor.place), { width: nx * SKELETON_CELL, depth: nz * SKELETON_CELL, floors: lot.floors, cores: 2 });
    const index = world.lots.push({ ...lot, side: "west", skeleton, rooms: furnish(skeleton, 1) }) - 1;
    for (let j = aj; j < aj + nz; j++) for (let i = ai; i < ai + nx; i++) world.lotAt.set(cellKey(i, j), index);
  }
  for (const index of world.buckets.buildings.get(chunkKey(ci, cj)) ?? []) {
    const b = world.source.buildings[index];
    if (world.claimed.has(b.id)) continue;
    world.claimed.add(b.id);
    // At its true size and turn, on the free cells of its footprint (half of them at least).
    const floors = Math.max(1, Math.min(WALK_FLOORS, b.floors)), role = roleOf(b.kind, b.floors);
    const stood = standTurned(world, b, index, { id: b.id, label: null, role, floors, height: b.floors, source: b.id, manifold: b.manifold ?? "", era: b.era ?? "modern", born, place: null }, KIND_OF[b.kind] ?? ROLE_KIND[role], seedOf(b.id));
    if (!stood) world.dropped.set(b.id, born);
  }
  // Clutter on open ground (one cell in ten), never on a road or in front of a door.
  const draw = skeletonStream("world-clutter", ci, cj);
  for (let j = j0; j < j0 + CHUNK; j++) for (let i = i0; i < i0 + CHUNK; i++) { const key = cellKey(i, j); if (world.ground.get(key) === GROUND.street && !world.lotAt.has(key) && !world.lotAt.has(cellKey(i, j - 1)) && draw() < 0.06) world.clutter.add(key); }
}

/**
 * A building of the world no one has reached yet, as the lot it will stand as (docs/v2/world-engine-v2.md §2.0.18, the
 * user's design): its footprint on the grid, its floors, its role and model, and nothing inside it. The same engine with
 * its tiling, its destruction and its inside (rooms, stairs, corridors) switched off: when people come near, its chunk
 * materializes and the building stands as a full lot, as ever.
 */
export interface ShellLot { source: string; i0: number; j0: number; nx: number; nz: number; frame?: { x: number; z: number; angle: number; w: number; d: number }; floors: number; height: number; role: BuildingRole; era: string; model: string | null }
/**
 * Every source building that does not stand yet, as its shell: placed as `materialize` places a lot (the largest free part of
 * its footprint, kept when at least half is left), clear of the roads, the lots and each other.
 */
export function shellsOf(world: World): ShellLot[] {
  // Every building no one has reached, at its true size and turn (its frame); none is left out for want of grid room.
  const shells: ShellLot[] = [];
  for (const b of world.source.buildings) {
    if (world.claimed.has(b.id)) continue;
    const foot = footprintOf(b);
    shells.push({ source: b.id, i0: foot.i0, j0: foot.j0, nx: foot.nx, nz: foot.nz, frame: { x: b.x, z: b.z, angle: b.angle, w: b.w, d: b.d }, floors: Math.max(1, Math.min(WALK_FLOORS, b.floors)), height: b.floors, role: roleOf(b.kind, b.floors), era: b.era ?? "modern", model: b.model ?? null });
  }
  return shells;
}

/** Materialize every chunk within `radius` metres of (x, z) at moment `born`; how many were new. */
export function ensure(world: World, x: number, z: number, radius: number, born: number | string): number {
  const span = CHUNK * SKELETON_CELL;
  let fresh = 0;
  for (let ci = Math.floor((x - radius) / span); ci <= Math.floor((x + radius) / span); ci++) for (let cj = Math.floor((z - radius) / span); cj <= Math.floor((z + radius) / span); cj++) {
    if (world.chunks.has(chunkKey(ci, cj))) continue;
    const cx = Math.max(ci * span, Math.min(x, (ci + 1) * span)), cz = Math.max(cj * span, Math.min(z, (cj + 1) * span));
    if (Math.hypot(cx - x, cz - z) > radius) continue;
    materialize(world, ci, cj, born);
    fresh++;
  }
  return fresh;
}

/** A node's cell and its place in metres. */
export const cellOf = (world: World, id: number) => ({ i: world.cells[id * 3], j: world.cells[id * 3 + 1], k: world.cells[id * 3 + 2] });
export const nodePos = (world: World, id: number) => { const { i, j, k } = cellOf(world, id); return { i, j, k, x: (i + 0.5) * SKELETON_CELL, z: (j + 0.5) * SKELETON_CELL, y: k * FLOOR_HEIGHT }; };
/** The node of a cell, numbered the first time it is asked for. */
export function nodeId(world: World, i: number, j: number, k: number): number {
  const key = nodeKey(i, j, k), known = world.ids.get(key);
  if (known !== undefined) return known;
  const id = world.cells.length / 3;
  world.ids.set(key, id); world.cells.push(i, j, k);
  return id;
}

/** What each node is, from the last graph: 0 none, 1 outdoor, 2 circulation, 3 room, 4 roof, 5 underground, 6 rubble (L18); its lot; its ground. */
export interface WorldGraph { graph: MoveGraph; type: Uint8Array; lot: Int32Array; ground: Uint8Array }

/**
 * The movement graph over the materialized world and what stands (`standing` per lot), with the things placed in it
 * (in world cells). Every node seen so far keeps its id; one that no longer stands has no edges. With a `box` (metres),
 * only the world inside it is walked: edges stay inside, and nodes outside have none (positions are kept for every id).
 */
export function worldGraph(world: World, standing: Uint8Array[], things: PlacedThing[] = [], box?: { x0: number; z0: number; x1: number; z1: number }, rubble: (Uint8Array | undefined)[] = []): WorldGraph {
  const inside = (i: number, j: number) => !box || ((i + 0.5) * SKELETON_CELL >= box.x0 && (i + 0.5) * SKELETON_CELL <= box.x1 && (j + 0.5) * SKELETON_CELL >= box.z0 && (j + 0.5) * SKELETON_CELL <= box.z1);
  const edges: { from: number; to: number; dir: number; cost: number; kind: number }[] = [];
  // Each building's room map, made once per lot (a lot's rooms never change; the test cycle, 2026-11-03: it was made for
  // every lot of the world at every window's build).
  const roomOf = (index: number) => { const lot = world.lots[index]; let map = ROOMS.get(lot); if (!map) { map = new Int32Array(lot.skeleton.cells.length).fill(NOT); const rooms = map; lot.rooms.forEach((room, r) => { for (let level = room.floor; level <= (room.top ?? room.floor); level++) for (let i = room.i0; i <= room.i1; i++) for (let j = room.j0; j <= room.j1; j++) rooms[cellIndex(lot.skeleton, i, j, level)] = r; }); ROOMS.set(lot, map); } return map; };
  const thingAt = new Map<number, number>();
  things.forEach((thing, index) => { for (let j = thing.j0; j <= thing.j1; j++) for (let i = thing.i0; i <= thing.i1; i++) { const key = cellKey(i, j), there = thingAt.get(key); if (there === undefined || things[there].top < thing.top) thingAt.set(key, index); } });
  const span = CHUNK;
  const known = (i: number, j: number) => world.chunks.has(chunkKey(Math.floor(i / span), Math.floor(j / span)));
  const what = (i: number, j: number, k: number): { type: number; lot: number; local: number } => {
    if (!inside(i, j)) return { type: 0, lot: NOT, local: NOT };
    const key = cellKey(i, j), index = world.lotAt.get(key) ?? NOT, thing = thingAt.get(key) ?? NOT;
    if (k < 0) {
      // Underground: a building's basements under its footprint (its car park's pillars closed); else a hall laid here at
      // this level (its pillars, and its cells under a pile of fallen ground 2 m or more, closed).
      if (!known(i, j)) return { type: 0, lot: NOT, local: NOT };
      const under = index >= 0 ? world.lots[index] : null;
      if (under && -k <= basementsOf(under)) return carParkPillar(under, i, j) ? { type: 0, lot: NOT, local: NOT } : { type: 5, lot: index, local: NOT };
      const hall = hallsAt(world, i, j).find((entry) => entry.k === k);
      if (!hall || hall.pillar || (world.underDamage.piles.get(hall.hall)?.get(key) ?? 0) >= 2) return { type: 0, lot: NOT, local: NOT };
      return { type: 5, lot: HALL_LOT + hall.hall, local: NOT };
    }
    if (thing >= 0 && k === things[thing].top && (index < 0 || k > world.lots[index].floors)) return { type: 4, lot: 1000 + thing, local: NOT };
    if (index < 0) return { type: k === 0 && known(i, j) && !world.clutter.has(key) && !(thing >= 0 && things[thing].grounded) ? 1 : 0, lot: NOT, local: NOT };
    const lot = world.lots[index];
    if (k === lot.floors) return { type: 4, lot: index, local: NOT };
    if (k > lot.floors) return { type: 0, lot: NOT, local: NOT };
    const at = localCell(lot, i, j);
    if (!at) return { type: 0, lot: NOT, local: NOT };
    const local = cellIndex(lot.skeleton, at[0], at[1], k);
    // Rubble (L18, tunnelling: a body crosses matter only where it is destroyed): a cell a blast took, wall or corridor,
    // is walked over where it lies.
    if (rubble[index]?.[local]) return { type: 6, lot: index, local };
    if (lot.skeleton.cells[local] !== MASS) return { type: standing[index]?.[local] ? 2 : 0, lot: index, local };
    // A room is walked on its own floor; a room of several floors is open air above it (its upper floors are no floor).
    const room = roomOf(index)[local];
    return { type: room >= 0 && lot.rooms[room].floor === k ? 3 : 0, lot: index, local };
  };
  // A building's street doors (the user, 2026-11-02: people chose a building and never got in): its entrance cell of the
  // plan, and for a turned plan the ground-floor cells beside it, where they face open ground; where none does (the
  // building stands against a neighbour, or another holds that cell), the ground-floor corridor cell nearest the entrance
  // that faces open ground.
  const doors = new Map<number, Set<number>>();
  const doorsOf = (index: number): Set<number> => {
    const known = doors.get(index);
    if (known) return known;
    const lot = world.lots[index], s = lot.skeleton, e = cellAt(s, s.entrance), open: { cell: number; gap: number }[] = [];
    for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) {
      if (world.lotAt.get(cellKey(i, j)) !== index) continue;
      const at = localCell(lot, i, j);
      if (!at) continue;
      const cell = cellIndex(s, at[0], at[1], 0);
      if (s.cells[cell] === MASS || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => what(i + di, j + dj, 0).type === 1)) continue;
      open.push({ cell, gap: Math.max(Math.abs(at[0] - e.i), Math.abs(at[1] - e.j)) });
    }
    const near = open.filter(({ cell, gap }) => cell === s.entrance || (!!lot.frame && gap <= 1));
    const chosen = new Set((near.length ? near : open.sort((a, b) => a.gap - b.gap).slice(0, 1)).map(({ cell }) => cell));
    doors.set(index, chosen);
    return chosen;
  };
  // Every cell to walk: the open ground of materialized chunks, and every lot's cells on every floor up to its roof; and
  // under them, the levels below the street.
  const cells: [number, number, number][] = [];
  // Only the chunks the box takes in (every loaded chunk was walked, the cells outside the box then dropped).
  const chunkMetres = CHUNK * SKELETON_CELL, nearBox = (ci: number, cj: number) => !box || ((ci + 1) * chunkMetres >= box.x0 - SKELETON_CELL && ci * chunkMetres <= box.x1 + SKELETON_CELL && (cj + 1) * chunkMetres >= box.z0 - SKELETON_CELL && cj * chunkMetres <= box.z1 + SKELETON_CELL);
  for (const [key] of world.chunks) { const ci = Math.floor(key / 65536) - OFF, cj = (key % 65536) - OFF; if (!nearBox(ci, cj)) continue; for (let j = cj * CHUNK; j < (cj + 1) * CHUNK; j++) for (let i = ci * CHUNK; i < (ci + 1) * CHUNK; i++) if (inside(i, j)) {
    const index = world.lotAt.get(cellKey(i, j)), under = index === undefined ? null : world.lots[index];
    if (!under) cells.push([i, j, 0]);
    for (const entry of hallsAt(world, i, j)) if (!(under && -entry.k <= basementsOf(under))) cells.push([i, j, entry.k]);
  } }
  world.lots.forEach((lot) => { if (box && ((lot.i0 + lot.nx) * SKELETON_CELL < box.x0 || lot.i0 * SKELETON_CELL > box.x1 || (lot.j0 + lot.nz) * SKELETON_CELL < box.z0 || lot.j0 * SKELETON_CELL > box.z1)) return; for (let k = 0; k <= lot.floors; k++) for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) if (inside(i, j)) cells.push([i, j, k]); for (let k = -1; k >= -basementsOf(lot); k--) for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) if (inside(i, j)) cells.push([i, j, k]); });
  for (const thing of things) for (let j = thing.j0; j <= thing.j1; j++) for (let i = thing.i0; i <= thing.i1; i++) if (inside(i, j)) cells.push([i, j, thing.top]);
  // Each cell walked once: a cell listed twice (a hall laid twice, as library 16's mall was; ground and a thing at the same
  // level) added its steps twice, the walk sum then counted every way round a loop twice over and grew without bound,
  // and the solver's field became NaN: W12's rehearsal had 13,600 doubled steps in one window and 63 walks "no way there".
  { const seen = new Set<string>(); let kept = 0; for (const cell of cells) { const key = `${cell[0]}|${cell[1]}|${cell[2]}`; if (seen.has(key)) continue; seen.add(key); cells[kept++] = cell; } cells.length = kept; }
  const add = (from: number, to: number, dx: number, dz: number, cost: number, kind: number, dir = directionOf(dx, dz)) => edges.push({ from, to, dir, cost, kind });
  const surface = (i: number, j: number) => { const key = cellKey(i, j), index = world.lotAt.get(key) ?? NOT, thing = thingAt.get(key) ?? NOT; return Math.max(index < 0 ? 0 : world.lots[index].floors * FLOOR_HEIGHT, thing < 0 ? 0 : things[thing].top * FLOOR_HEIGHT); };
  const ELEVATION = Math.atan(1 / Math.SQRT2), G = 9.8;
  // Two cells of one building's plan joined by the plan's rules: corridor to corridor, within one room, a room to the
  // corridor only at one of its doors.
  const inPlan = (index: number, a: number, b: number, roomA: number, roomB: number) => {
    const lot = world.lots[index], corridor = (cell: number) => lot.skeleton.cells[cell] !== MASS && !!standing[index]?.[cell];
    return (corridor(a) && corridor(b)) || (roomA >= 0 && roomA === roomB) || (roomA >= 0 && corridor(b) && lot.rooms[roomA].doors.includes(b)) || (roomB >= 0 && corridor(a) && lot.rooms[roomB].doors.includes(a));
  };
  for (const [i, j, k] of cells) {
    const here = what(i, j, k);
    if (!here.type) continue;
    const node = nodeId(world, i, j, k), eight = here.type === 1 || here.type === 4 || here.type === 5;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], ...(eight ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [])]) {
      const there = what(i + dx, j + dz, k);
      if (!there.type) continue;
      let ok = false;
      // Rubble opens its floor every way: to rubble, corridors, rooms and the open ground beside it, through what stood.
      if (here.type === 6 || there.type === 6) ok = [1, 2, 3, 6].includes(here.type) && [1, 2, 3, 6].includes(there.type) && (!(dx && dz) || (what(i + dx, j, k).type > 0 && what(i, j + dz, k).type > 0));
      else if (here.type === 1 && there.type === 1) ok = !(dx && dz) || (what(i + dx, j, k).type === 1 && what(i, j + dz, k).type === 1);
      else if (here.type === 5 && there.type === 5) ok = !(dx && dz) || (what(i + dx, j, k).type === 5 && what(i, j + dz, k).type === 5);
      else if (here.type === 4 && there.type === 4) ok = here.lot === there.lot;
      else if (here.lot === there.lot && here.lot >= 0) {
        // A turned building's inside is walked on its own plan (below), never on the world's neighbours.
        if (world.lots[here.lot].frame) continue;
        const roomA = here.type === 3 ? roomOf(here.lot)[here.local] : NOT, roomB = there.type === 3 ? roomOf(there.lot)[there.local] : NOT;
        ok = inPlan(here.lot, here.local, there.local, roomA, roomB);
      } else if (k === 0) {
        // The street door: its cell of the plan (or one beside it on the ground floor, a turned plan's cells falling
        // between the world's), to the open ground next to it, any way it faces for a turned building.
        const lot = here.type === 2 ? world.lots[here.lot] : there.type === 2 ? world.lots[there.lot] : null, inside = here.type === 2 ? here : there;
        ok = !!lot && (!dx || !!lot.frame) && doorsOf(inside.lot).has(inside.local) && (here.type === 1 || there.type === 1);
      }
      if (ok) add(node, nodeId(world, i + dx, j + dz, k), dx, dz, SKELETON_CELL * Math.hypot(dx, dz), EDGE.walk);
    }
    // Up a building's outer wall to its roof, and down again (pathIntegral.ts WALL_KINDS): from the street beside it, the
    // edge's kind by the wall's height; only a climber's way of moving walks them.
    if (here.type === 1 && k === 0) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const index = world.lotAt.get(cellKey(i + dx, j + dz));
      if (index === undefined || index < 0 || index >= HALL_LOT) continue;
      const floors = world.lots[index].floors, roof = what(i + dx, j + dz, floors);
      if (roof.type !== 4 || roof.lot !== index) continue;
      const height = floors * FLOOR_HEIGHT, wall = height <= 10 ? EDGE.wallLow : height <= 30 ? EDGE.wallMid : EDGE.wallHigh, top = nodeId(world, i + dx, j + dz, floors);
      add(node, top, 0, 0, 2 + height, wall, UP); add(top, node, 0, 0, 2 + height / 2, wall, DOWN);
    }
    // A building's stairs go on down through its basements, a floor at a time.
    const stairAt = (index: number) => { if (index < 0 || index >= HALL_LOT) return false; const lot = world.lots[index], at = lot ? localCell(lot, i, j) : null; if (!at) return false; const cell = cellIndex(lot.skeleton, at[0], at[1], 0); return !!standing[index]?.[cell] && lot.skeleton.cells[cell] === STAIR; };
    const between = (level: number, cost: number) => add(node, nodeId(world, i, j, level), 0, 0, cost, level < k ? EDGE.descend : EDGE.climb, level < k ? DOWN : UP);
    if (k <= 0 && (here.type === 2 || here.type === 5) && stairAt(here.lot)) {
      if (what(i, j, k - 1).type === 5 && what(i, j, k - 1).lot === here.lot) between(k - 1, 2 + FLOOR_HEIGHT);
      if (k < 0 && (what(i, j, k + 1).type === 5 || what(i, j, k + 1).type === 2) && what(i, j, k + 1).lot === here.lot) between(k + 1, 2 + 8 * FLOOR_HEIGHT);
    }
    if (here.type === 2) {
      const lot = world.lots[here.lot], up = what(i, j, k + 1), down = what(i, j, k - 1);
      if (lot.skeleton.cells[here.local] === STAIR) {
        if ((up.type === 2 && lot.skeleton.cells[up.local] === STAIR) || (up.type === 4 && up.lot === here.lot)) add(node, nodeId(world, i, j, k + 1), 0, 0, 2 + 8 * FLOOR_HEIGHT, EDGE.climb, UP);
        if (down.type === 2 && lot.skeleton.cells[down.local] === STAIR) add(node, nodeId(world, i, j, k - 1), 0, 0, 2 + FLOOR_HEIGHT, EDGE.descend, DOWN);
      }
    }
    if (here.type === 4) {
      const lot = world.lots[here.lot], below = what(i, j, k - 1);
      if (lot && below.type === 2 && lot.skeleton.cells[below.local] === STAIR) add(node, nodeId(world, i, j, k - 1), 0, 0, 2 + FLOOR_HEIGHT, EDGE.descend, DOWN);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const out = what(i + dx, j + dz, k);
        if (out.type === 4 && out.lot === here.lot) continue;
        if (what(i + dx, j + dz, 0).type === 1) add(node, nodeId(world, i + dx, j + dz, 0), dx, dz, 1 + k * FLOOR_HEIGHT, EDGE.fall, DOWN);
        for (let level = k; level >= 1; level--) { const across = what(i + 2 * dx, j + 2 * dz, level); if (!world.lotAt.has(cellKey(i + dx, j + dz)) && across.type === 4 && across.lot !== here.lot) { add(node, nodeId(world, i + 2 * dx, j + 2 * dz, level), dx, dz, 2 * SKELETON_CELL + 2, EDGE.jump); break; } }
      }
    }
    // Sky arcs from a roof, as on a place's grid (an arc never gains height, so from the street it only lands on street a
    // walk reaches anyway); landing only on ground already in the world.
    if (here.type !== 4) continue;
    const x0 = (i + 0.5) * SKELETON_CELL, z0 = (j + 0.5) * SKELETON_CELL, y0 = k * FLOOR_HEIGHT;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const speed of ARC_SPEEDS) {
      const vh = speed * Math.cos(ELEVATION) / Math.SQRT2, vy = speed * Math.sin(ELEVATION);
      for (let t = 0.05; t < 4; t += 0.05) {
        const x = x0 + sx * vh * t, z = z0 + sz * vh * t, y = y0 + vy * t - G * t * t / 2, a = Math.floor(x / SKELETON_CELL), b = Math.floor(z / SKELETON_CELL);
        if (y < -0.5 || !known(a, b) && !world.lotAt.has(cellKey(a, b))) break;
        const top = surface(a, b);
        if (y > top) continue;
        if (vy - G * t > 0) break;
        const land = what(a, b, top / FLOOR_HEIGHT), far = Math.hypot(x - x0, z - z0);
        if (top <= y0 && far >= 3 && (land.type === 1 || land.type === 4)) edges.push({ from: node, to: nodeId(world, a, b, top / FLOOR_HEIGHT), dir: launchOf(sx, sz), cost: 2 + ARC_EFFORT * speed * speed / (2 * G) + Math.max(0, y0 - top - FLOOR_HEIGHT), kind: EDGE.arc });
        break;
      }
    }
  }
  // A turned building's inside on its own plan (the user's research handoff, 2026-11-02: interiors are areas joined to the
  // street at their doors; a grid aliases a turned plan, and its rooms were shut where a door's plan cell fell between the
  // world's): on each floor each plan cell is walked through one world cell, its representative (the held cell whose middle
  // is nearest the plan cell's; for a plan cell no world cell holds, the nearest held cell of the same kind on that floor:
  // corridor for corridor, the same room for a room's; with none, a wall's), joined to its plan neighbours by the plan's rules; every other held
  // cell joins its plan cell's representative. Its street doors are the world's (above).
  world.lots.forEach((lot, index) => {
    if (!lot.frame || (box && ((lot.i0 + lot.nx) * SKELETON_CELL < box.x0 || lot.i0 * SKELETON_CELL > box.x1 || (lot.j0 + lot.nz) * SKELETON_CELL < box.z0 || lot.j0 * SKELETON_CELL > box.z1))) return;
    const s = lot.skeleton, c = Math.cos(lot.frame.angle), sn = Math.sin(lot.frame.angle), held: { i: number; j: number; li: number; lj: number }[] = [];
    for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) { if (world.lotAt.get(cellKey(i, j)) !== index) continue; const at = localCell(lot, i, j); if (at) held.push({ i, j, li: at[0], lj: at[1] }); }
    if (!held.length) return;
    const middle = (li: number, lj: number) => { const u = (li + 0.5) * SKELETON_CELL - (s.nx * SKELETON_CELL) / 2, v = (lj + 0.5) * SKELETON_CELL - (s.nz * SKELETON_CELL) / 2; return [lot.frame!.x + u * c - v * sn, lot.frame!.z + u * sn + v * c]; };
    const gap = (cell: { i: number; j: number }, [x, z]: number[]) => Math.hypot((cell.i + 0.5) * SKELETON_CELL - x, (cell.j + 0.5) * SKELETON_CELL - z);
    // What a plan cell is on floor k: "c" corridor, "r<n>" room n, null neither (mass, or open air over a tall room).
    const kindOf = (li: number, lj: number, k: number) => { const a = cellIndex(s, li, lj, k); if (s.cells[a] !== MASS) return standing[index]?.[a] ? "c" : null; const r = roomOf(index)[a]; return r >= 0 && lot.rooms[r].floor === k ? `r${r}` : null; };
    const representativeOf = (li: number, lj: number, k: number) => {
      const at = middle(li, lj), own = held.filter((cell) => cell.li === li && cell.lj === lj), kind = kindOf(li, lj, k);
      // With none of its kind held (a small tower's whole corridor on a floor can fall between world cells), a wall's cell
      // stands for it, else any held cell: a floor is never cut off by how the grid samples it.
      const pools = own.length ? [own] : kind === null ? [] : [held.filter((cell) => kindOf(cell.li, cell.lj, k) === kind), held.filter((cell) => kindOf(cell.li, cell.lj, k) === null), held];
      const pool = pools.find((cells) => cells.length) ?? [];
      return pool.length ? pool.reduce((best, cell) => (gap(cell, at) < gap(best, at) ? cell : best)) : null;
    };
    const join = (a: { i: number; j: number } | null, b: { i: number; j: number } | null, k: number) => {
      if (!a || !b || (a.i === b.i && a.j === b.j) || !inside(a.i, a.j) || !inside(b.i, b.j)) return;
      const from = nodeId(world, a.i, a.j, k), to = nodeId(world, b.i, b.j, k), dx = b.i - a.i, dz = b.j - a.j, cost = SKELETON_CELL * Math.hypot(dx, dz);
      add(from, to, dx, dz, cost, EDGE.walk); add(to, from, -dx, -dz, cost, EDGE.walk);
    };
    const representatives: ({ i: number; j: number } | null)[][] = [];
    for (let k = 0; k < lot.floors; k++) {
      const representative: ({ i: number; j: number } | null)[] = representatives[k] = [];
      for (let lj = 0; lj < s.nz; lj++) for (let li = 0; li < s.nx; li++) representative[lj * s.nx + li] = representativeOf(li, lj, k);
      for (let lj = 0; lj < s.nz; lj++) for (let li = 0; li < s.nx; li++) {
        const a = cellIndex(s, li, lj, k), roomA = roomOf(index)[a] >= 0 && lot.rooms[roomOf(index)[a]].floor === k ? roomOf(index)[a] : NOT;
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (li + di >= s.nx || lj + dj >= s.nz) continue;
          const b = cellIndex(s, li + di, lj + dj, k), roomB = roomOf(index)[b] >= 0 && lot.rooms[roomOf(index)[b]].floor === k ? roomOf(index)[b] : NOT;
          if (inPlan(index, a, b, roomA, roomB)) join(representative[lj * s.nx + li], representative[(lj + dj) * s.nx + li + di], k);
        }
      }
      // Every held cell walks to its own plan cell's representative.
      for (const cell of held) if (what(cell.i, cell.j, k).type === 2 || what(cell.i, cell.j, k).type === 3) join(cell, representative[cell.lj * s.nx + cell.li], k);
    }
    // Its stairs on the plan too: a stair cell's representative to the one a floor up (and from the top floor to the roof),
    // so a stair no world cell holds still joins its floors.
    const climb = (a: { i: number; j: number } | null, k: number, b: { i: number; j: number } | null) => {
      if (!a || !b || !inside(a.i, a.j) || !inside(b.i, b.j)) return;
      const lower = nodeId(world, a.i, a.j, k), upper = nodeId(world, b.i, b.j, k + 1);
      add(lower, upper, b.i - a.i, b.j - a.j, 2 + 8 * FLOOR_HEIGHT, EDGE.climb, UP); add(upper, lower, a.i - b.i, a.j - b.j, 2 + FLOOR_HEIGHT, EDGE.descend, DOWN);
    };
    for (let k = 0; k < lot.floors; k++) for (let lj = 0; lj < s.nz; lj++) for (let li = 0; li < s.nx; li++) {
      const a = cellIndex(s, li, lj, k);
      if (s.cells[a] !== STAIR || !standing[index]?.[a]) continue;
      const here = representatives[k][lj * s.nx + li];
      if (k + 1 < lot.floors) { const b = cellIndex(s, li, lj, k + 1); if (s.cells[b] === STAIR && standing[index]?.[b]) climb(here, k, representatives[k + 1][lj * s.nx + li]); }
      else if (here) climb(here, k, here);
    }
  });
  // The halls' ways (underground.ts `up`): stairs from a station's or a mall's end to the nearest pavement; a shaft or a lift
  // from a tank, a channel's end or a deep facility to the street over it; and a ladder where a channel leaves its tank.
  const outdoorNear = (x: number, z: number, radius: number) => { const i0 = Math.floor(x / SKELETON_CELL), j0 = Math.floor(z / SKELETON_CELL); for (let r = 0; r <= radius; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && what(i0 + di, j0 + dj, 0).type === 1) return [i0 + di, j0 + dj]; return null; };
  const halls = world.source.underground?.halls ?? [];
  halls.forEach((hall, index) => {
    const k = levelOf(hall.depth), climb = hall.kind === "station" || hall.kind === "mall" ? 2 + 4 * -k * FLOOR_HEIGHT : 24, drop = hall.kind === "station" || hall.kind === "mall" ? 2 + -k * FLOOR_HEIGHT : 24;
    for (const [x, z] of hall.up) {
      const [i, j] = [Math.floor(x / SKELETON_CELL), Math.floor(z / SKELETON_CELL)], below = what(i, j, k);
      if (below.type !== 5 || below.lot !== HALL_LOT + index) continue;
      const street = outdoorNear(x, z, hall.kind === "station" || hall.kind === "mall" ? 30 : 40);
      if (!street) continue;
      const hallNode = nodeId(world, i, j, k), streetNode = nodeId(world, street[0], street[1], 0);
      add(hallNode, streetNode, 0, 0, climb, EDGE.climb, UP); add(streetNode, hallNode, 0, 0, drop, EDGE.descend, DOWN);
    }
    if (hall.kind !== "channel") return;
    const [x, z] = hall.bores[0].a, [i, j] = [Math.floor(x / SKELETON_CELL), Math.floor(z / SKELETON_CELL)], tank = halls.findIndex((other) => other.kind === "tank" && inHall(other, [x, z]));
    if (tank < 0 || what(i, j, k).type !== 5 || what(i, j, levelOf(halls[tank].depth)).type !== 5) return;
    const from = nodeId(world, i, j, k), to = nodeId(world, i, j, levelOf(halls[tank].depth));
    add(from, to, 0, 0, 2 + 8 * (levelOf(halls[tank].depth) - k) * FLOOR_HEIGHT, EDGE.climb, UP); add(to, from, 0, 0, 2 + (levelOf(halls[tank].depth) - k) * FLOOR_HEIGHT, EDGE.descend, DOWN);
  });
  // Positions of every node ever seen (those that no longer stand have no edges), and what each is now.
  const count = world.cells.length / 3, type = new Uint8Array(count), lot = new Int32Array(count).fill(NOT), ground = new Uint8Array(count);
  // Every node's place, kept with the world and grown as nodes are numbered (a node's place never changes).
  let at = POSITIONS.get(world);
  if (!at || at.x.length !== count) {
    const x = new Float64Array(count), z = new Float64Array(count), y = new Float64Array(count), from = at?.x.length ?? 0;
    if (at) { x.set(at.x); z.set(at.z); y.set(at.y); }
    for (let id = from; id < count; id++) { const { i, j, k } = cellOf(world, id); x[id] = (i + 0.5) * SKELETON_CELL; z[id] = (j + 0.5) * SKELETON_CELL; y[id] = k * FLOOR_HEIGHT; }
    at = { x, z, y }; POSITIONS.set(world, at);
  }
  for (let id = 0; id < count; id++) {
    const i = world.cells[id * 3], j = world.cells[id * 3 + 1], k = world.cells[id * 3 + 2];
    if (!inside(i, j)) continue;
    const here = what(i, j, k);
    type[id] = here.type; lot[id] = here.lot; ground[id] = here.type === 1 ? world.ground.get(cellKey(i, j)) ?? GROUND.street : 0;
  }
  // Each step once (the same cells, way and kind): one added by two of the rules above counted twice in the walk sum.
  const once = new Map<string, (typeof edges)[number]>();
  for (const edge of edges) { const key = `${edge.from}|${edge.to}|${edge.dir}|${edge.kind}`, known = once.get(key); if (!known || edge.cost < known.cost) once.set(key, edge); }
  return { graph: buildGraphAt(at, [...once.values()]), type, lot, ground };
}

/**
 * The spots a decision model names, near a point (within `radius` metres, on the world as materialized): roads (avenue),
 * plazas, open ground (street), roofs (rooftop), rooms either side (west, east), and the floors and roof of the `main`
 * building (the scene's own, or the one nearest the point) as `main:floorN` and `main:roof`.
 */
export function spotsNear(world: World, built: WorldGraph, x: number, z: number, radius: number, main: number | null): Record<string, number[]> {
  const spots: Record<string, number[]> = { avenue: [], plaza: [], north: [], west: [], east: [], rooftop: [], under: [], subway: [], deep: [], basement: [] };
  const count = built.type.length, lotNear = main ?? nearestLot(world, x, z);
  for (let id = 0; id < count; id++) {
    const type = built.type[id];
    if (!type || !built.graph.offsets || built.graph.offsets[id + 1] === built.graph.offsets[id]) continue;
    const { i, j, k } = cellOf(world, id), px = (i + 0.5) * SKELETON_CELL, pz = (j + 0.5) * SKELETON_CELL, own = built.lot[id] === lotNear && lotNear !== null;
    if (own) { if (type === 2 || type === 3) (spots[`main:floor${k + 1}`] ??= []).push(id); else if (type === 4) (spots["main:roof"] ??= []).push(id); else if (type === 5 && built.lot[id] === lotNear) (spots["main:basement"] ??= []).push(id); }
    if (Math.hypot(px - x, pz - z) > radius) continue;
    if (type === 1) (built.ground[id] === GROUND.avenue ? spots.avenue : built.ground[id] === GROUND.plaza ? spots.plaza : spots.north).push(id);
    if (type === 3 && !own) (px < x ? spots.west : spots.east).push(id);
    if (type === 4) spots.rooftop.push(id);
    // Underground, by the two depth intervals (a hall in both is in both), and by kind for a text that names one.
    if (type === 5) {
      const hall = built.lot[id] >= HALL_LOT ? world.source.underground!.halls[built.lot[id] - HALL_LOT] : null;
      for (const interval of hall ? intervalsOf(hall) : ["shallow"]) spots[interval === "shallow" ? "under" : interval].push(id);
      if (hall && hall.kind !== "tunnel" && hall.kind !== "station") (spots[hall.kind === "tank" || hall.kind === "channel" ? "water" : hall.kind === "mall" ? "mall" : "facility"] ??= []).push(id);
      if (!hall) spots.basement.push(id);
    }
  }
  return spots;
}

/** The lot nearest a point (by its footprint), or null in an empty world. */
export function nearestLot(world: World, x: number, z: number): number | null {
  let best: number | null = null, gap = Infinity;
  world.lots.forEach((lot, index) => { const d = Math.hypot(Math.max(0, lot.i0 * SKELETON_CELL - x, x - (lot.i0 + lot.nx) * SKELETON_CELL), Math.max(0, lot.j0 * SKELETON_CELL - z, z - (lot.j0 + lot.nz) * SKELETON_CELL)); if (d < gap) { gap = d; best = index; } });
  return best;
}

/** A spot as a decision model names it (holoNav's spot ids), among spotsNear's: as placeSpot does on a place's grid. */
export function worldSpot(spots: Record<string, number[]>, spot: string | null | undefined): string | null {
  if (!spot) return null;
  if (spots[spot]?.length) return spot;
  const level = /^(?:floor|stairs)-(\d+)$/.exec(spot);
  if (level) { const key = `main:floor${level[1]}`; return spots[key]?.length ? key : spots["main:floor1"]?.length ? "main:floor1" : "avenue"; }
  if (["roof", "bell-tower", "keep-top", "tower-top"].includes(spot)) return spots["main:roof"]?.length ? "main:roof" : "rooftop";
  // Underground, by Jev's three choices (docs/underground-design.md §6.1): just under the street (the scene's building's
  // basement, a mall), the subway, and deep (the storm water, a deep facility); a kind the text names when there is one.
  const under = ["under", "subway", "tunnel", "arcade", "underground-mall", "mall-underground", "underground", "basement"], deep = ["deep", "water", "sewer", "drain", "facility", "lab"];
  if (under.includes(spot) || deep.includes(spot)) {
    const own = ["basement", "underground"].includes(spot) ? "main:basement" : ["subway", "tunnel"].includes(spot) ? "subway" : spot.includes("mall") || spot === "arcade" ? "mall" : ["water", "sewer", "drain"].includes(spot) ? "water" : ["facility", "lab"].includes(spot) ? "facility" : null;
    if (own && spots[own]?.length) return own;
    if (own === "subway") return spots.under?.length ? "under" : "avenue";
    if (under.includes(spot)) return spots.under?.length ? "under" : spots.deep?.length ? "deep" : "avenue";
    return spots.deep?.length ? "deep" : spots.under?.length ? "under" : "avenue";
  }
  const named = ({ street: "avenue", "front-door": "avenue", entrance: "avenue", gate: "avenue", road: "avenue", alley: "north", "back-door": "north", "side-door": "east", concourse: "plaza", platform: "plaza", path: "plaza", courtyard: "plaza", garden: "north" } as Record<string, string>)[spot] ?? null;
  return named && !spots[named]?.length && named === "plaza" ? "north" : named;
}

/** The walkable node nearest a point on a level (or any level), among nodes that have edges. */
export function nodeNear(world: World, built: WorldGraph, x: number, z: number, k: number | null = 0): number | null {
  let best: number | null = null, gap = Infinity;
  for (let id = 0; id < built.type.length; id++) {
    if (!built.type[id] || built.graph.offsets[id + 1] === built.graph.offsets[id]) continue;
    const p = nodePos(world, id);
    if (k !== null && p.k !== k) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < gap) { gap = d; best = id; }
  }
  return best;
}

/** A chunk's place on the grid from its key. */
export const chunkOf = (key: number) => ({ ci: Math.floor(key / 65536) - OFF, cj: (key % 65536) - OFF });
/** The cells everything explored covers (chunks and every lot's footprint): [i0, j0) to [i1, j1). */
export function worldBounds(world: World): { i0: number; j0: number; i1: number; j1: number } {
  let [i0, j0, i1, j1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const key of world.chunks.keys()) { const { ci, cj } = chunkOf(key); i0 = Math.min(i0, ci * CHUNK); j0 = Math.min(j0, cj * CHUNK); i1 = Math.max(i1, (ci + 1) * CHUNK); j1 = Math.max(j1, (cj + 1) * CHUNK); }
  for (const lot of world.lots) { i0 = Math.min(i0, lot.i0); j0 = Math.min(j0, lot.j0); i1 = Math.max(i1, lot.i0 + lot.nx); j1 = Math.max(j1, lot.j0 + lot.nz); }
  return Number.isFinite(i0) ? { i0, j0, i1, j1 } : { i0: 0, j0: 0, i1: 1, j1: 1 };
}
/** A chunk's ground, row by row, one digit a cell (GROUND kinds). */
export const chunkGround = (world: World, key: number) => { const { ci, cj } = chunkOf(key); let out = ""; for (let j = cj * CHUNK; j < (cj + 1) * CHUNK; j++) for (let i = ci * CHUNK; i < (ci + 1) * CHUNK; i++) out += world.lotAt.has(cellKey(i, j)) ? GROUND.building : world.ground.get(cellKey(i, j)) ?? GROUND.street; return out; };

/**
 * The part of a graph inside a box (metres): its own small graph, with each node's id there (`local`, -1 outside) and back
 * (`ids`). A walk is solved on the ground round where it goes, not on the whole explored city.
 */
export function windowOf(graph: MoveGraph, box: { x0: number; z0: number; x1: number; z1: number }, keep?: (node: number) => boolean): { graph: MoveGraph; local: Int32Array; ids: Int32Array } {
  const local = new Int32Array(graph.nodes).fill(NOT), ids: number[] = [];
  // `keep`: which nodes the walk may use besides being in the box (docs/v2/terrain-levels.md §8.2: a walk sees only the
  // layers its ends are in, so a street walk never holds a deep facility's lift).
  for (let n = 0; n < graph.nodes; n++) if (graph.x[n] >= box.x0 && graph.x[n] <= box.x1 && graph.z[n] >= box.z0 && graph.z[n] <= box.z1 && (!keep || keep(n))) { local[n] = ids.length; ids.push(n); }
  const count = ids.length, offsets = new Int32Array(count + 1), to: number[] = [], dir: number[] = [], cost: number[] = [], kind: number[] = [];
  for (let m = 0; m < count; m++) {
    const n = ids[m];
    for (let e = graph.offsets[n]; e < graph.offsets[n + 1]; e++) { const there = local[graph.to[e]]; if (there < 0) continue; to.push(there); dir.push(graph.dir[e]); cost.push(graph.cost[e]); kind.push(graph.kind[e]); }
    offsets[m + 1] = to.length;
  }
  const pick = (values: Float64Array) => Float64Array.from(ids, (n) => values[n]);
  return { graph: { nodes: count, x: pick(graph.x), z: pick(graph.z), y: pick(graph.y), offsets, to: Int32Array.from(to), dir: Uint8Array.from(dir), cost: Float64Array.from(cost), kind: Uint8Array.from(kind) }, local, ids: Int32Array.from(ids) };
}


/**
 * The nodes a walk from `start` can get to on a graph (a window's own ids): every edge whose factor is finite, as the path
 * integral weighs them (walls closed unless `factors` opens them). A spot is chosen only among these, so a walk is never
 * sent where its window has no way (docs/v2/terrain-levels.md §8.2: a basement whose stair lies outside the window).
 */
export function reachableIn(graph: MoveGraph, start: number, factors?: number[]): Uint8Array {
  const seen = new Uint8Array(graph.nodes);
  if (start < 0 || start >= graph.nodes) return seen;
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const n = queue.pop()!;
    for (let e = graph.offsets[n]; e < graph.offsets[n + 1]; e++) {
      const m = graph.to[e], kind = graph.kind[e], factor = factors?.[kind] ?? (WALL_KINDS.includes(kind) ? Infinity : 1);
      if (seen[m] || !(factor < Infinity) || !(graph.cost[e] >= 0)) continue;
      seen[m] = 1;
      queue.push(m);
    }
  }
  return seen;
}

/** What can be wrong with the world a graph covers (the user's research handoff, 2026-11-02: each failure with a code). */
export interface WorldIssue { code: "NO_ENTRANCE" | "SHUT_ROOM"; lot: number; source: string; room?: number; nodes: number }
/**
 * The world's own check, before anyone walks in it: from the street (every outdoor node of the graph), every building the
 * graph holds whole is entered, and every room of it reached. A building only partly in the graph (its door may lie
 * outside it) is not judged.
 */
export function worldIssues(world: World, built: WorldGraph): WorldIssue[] {
  const { graph, type, lot } = built, seen = new Uint8Array(type.length), queue: number[] = [];
  for (let id = 0; id < type.length; id++) if (type[id] === 1 && graph.offsets[id + 1] > graph.offsets[id]) { seen[id] = 1; queue.push(id); }
  while (queue.length) { const id = queue.pop()!; for (let e = graph.offsets[id]; e < graph.offsets[id + 1]; e++) { const to = graph.to[e]; if (!seen[to]) { seen[to] = 1; queue.push(to); } } }
  const inside = new Map<number, { nodes: number; reached: number; rooms: Map<number, { nodes: number; reached: number }> }>();
  // The graph's extent: over the nodes it walks (a loop, not a spread: a city's graph is too big for one call's arguments).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let id = 0; id < type.length; id++) if (graph.offsets[id + 1] > graph.offsets[id]) { x0 = Math.min(x0, graph.x[id]); x1 = Math.max(x1, graph.x[id]); z0 = Math.min(z0, graph.z[id]); z1 = Math.max(z1, graph.z[id]); }
  for (let id = 0; id < type.length; id++) {
    if ((type[id] !== 2 && type[id] !== 3) || lot[id] < 0 || lot[id] >= world.lots.length || graph.offsets[id + 1] === graph.offsets[id]) continue;
    const entry = inside.get(lot[id]) ?? inside.set(lot[id], { nodes: 0, reached: 0, rooms: new Map() }).get(lot[id])!;
    entry.nodes++; if (seen[id]) entry.reached++;
    if (type[id] === 3) { const here = world.lots[lot[id]], at = localCell(here, Math.floor(graph.x[id] / SKELETON_CELL), Math.floor(graph.z[id] / SKELETON_CELL)); const room = at ? here.rooms.findIndex((box) => box.floor === Math.round(graph.y[id] / FLOOR_HEIGHT) && at[0] >= box.i0 && at[0] <= box.i1 && at[1] >= box.j0 && at[1] <= box.j1) : -1; if (room >= 0) { const r = entry.rooms.get(room) ?? entry.rooms.set(room, { nodes: 0, reached: 0 }).get(room)!; r.nodes++; if (seen[id]) r.reached++; } }
  }
  const out: WorldIssue[] = [];
  for (const [index, entry] of inside) {
    const here = world.lots[index];
    if (here.i0 * SKELETON_CELL < x0 || (here.i0 + here.nx) * SKELETON_CELL > x1 || here.j0 * SKELETON_CELL < z0 || (here.j0 + here.nz) * SKELETON_CELL > z1) continue;
    // Judged only with its ground streamed in all round it: a building whose street is not loaded yet is not shut.
    let loaded = true;
    for (let ci = Math.floor((here.i0 - 1) / CHUNK); ci <= Math.floor((here.i0 + here.nx) / CHUNK) && loaded; ci++) for (let cj = Math.floor((here.j0 - 1) / CHUNK); cj <= Math.floor((here.j0 + here.nz) / CHUNK); cj++) if (!world.chunks.has(chunkKey(ci, cj))) { loaded = false; break; }
    if (!loaded) continue;
    if (!entry.reached) { out.push({ code: "NO_ENTRANCE", lot: index, source: here.source, nodes: entry.nodes }); continue; }
    for (const [room, r] of entry.rooms) if (!r.reached) out.push({ code: "SHUT_ROOM", lot: index, source: here.source, room, nodes: r.nodes });
  }
  return out;
}
