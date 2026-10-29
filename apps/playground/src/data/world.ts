import { MASS, STAIR, SKELETON_CELL, FLOOR_HEIGHT, cellIndex, furnish, generateSkeleton, skeletonStream, type Skeleton, type SkeletonKind } from "./skeleton.js";
import { EDGE, UP, DOWN, buildGraph, directionOf, launchOf, type MoveGraph } from "./pathIntegral.js";
import { ARC_EFFORT, ARC_SPEEDS, GROUND, type BuildingRole, type PlaceLot, type PlacedThing } from "./skeletonPlace.js";

/**
 * The stage's world: one city, streamed in as the story reaches it. Its source is the canvas of places with each open
 * place's landscape filled (src/ground/stage): every building, road and plaza in world metres. The world is cut into
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
export const cellKey = (i: number, j: number) => (i + OFF) * 65536 + (j + OFF);
const chunkKey = (ci: number, cj: number) => cellKey(ci, cj);
const nodeKey = (i: number, j: number, k: number) => cellKey(i, j) * 1024 + k;

export interface SourceBuilding { id: string; x: number; z: number; w: number; d: number; angle: number; floors: number; kind: string }
export interface SourceRoad { a: [number, number]; b: [number, number]; width: number; level: string }
/** A staged place where the canvas put it: a building of its own (`own`, a site) on its spot, or the middle of an open place. */
export interface Anchor { place: string; label: string; x: number; z: number; own: boolean; role: BuildingRole; floors: number }
export interface WorldSource { buildings: SourceBuilding[]; roads: SourceRoad[]; plazas: { x: number; z: number; r: number }[]; anchors: Anchor[] }

/** A lot of the world: its footprint in world cells, its skeleton walked up to WALK_FLOORS, its full `height` in floors for its shell. */
export interface WorldLot extends PlaceLot { source: string; height: number; born: number; place: string | null }
export interface World {
  source: WorldSource;
  /** Materialized chunks and the moment each was. */
  chunks: Map<number, number>;
  lots: WorldLot[];
  lotAt: Map<number, number>;
  ground: Map<number, number>;
  clutter: Set<number>;
  /** Node ids: the key of (i, j, k) → id, and each id's cell (i, j, k), never renumbered. */
  ids: Map<number, number>;
  cells: number[];
  claimed: Set<string>;
  buckets: { buildings: Map<number, number[]>; roads: Map<number, number[]> };
}

const KIND_OF: Record<string, SkeletonKind> = { skyscraper: "tower", tower: "tower", office: "tower", "block-wide": "school", hall: "school", school: "school", hospital: "school", station: "school", stadium: "school", warehouse: "school", factory: "school", keep: "tower" };
const ROLE_SIZE: Record<BuildingRole, [number, number]> = { office: [12, 10], shop: [7, 6], hospital: [15, 9], station: [15, 8] };
const ROLE_KIND: Record<BuildingRole, SkeletonKind> = { office: "tower", shop: "house", hospital: "school", station: "school" };
const roleOf = (kind: string, floors: number): BuildingRole => (KIND_OF[kind] === "tower" || floors >= 8 ? "office" : KIND_OF[kind] === "school" ? "station" : "shop");
const seedOf = (text: string) => [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);

export function createWorld(source: WorldSource): World {
  const world: World = { source, chunks: new Map(), lots: [], lotAt: new Map(), ground: new Map(), clutter: new Set(), ids: new Map(), cells: [], claimed: new Set(), buckets: { buildings: new Map(), roads: new Map() } };
  const span = CHUNK * SKELETON_CELL, add = (map: Map<number, number[]>, key: number, index: number) => { const list = map.get(key); if (list) list.push(index); else map.set(key, [index]); };
  source.buildings.forEach((b, index) => { const r = Math.hypot(b.w, b.d) / 2; for (let ci = Math.floor((b.x - r) / span); ci <= Math.floor((b.x + r) / span); ci++) for (let cj = Math.floor((b.z - r) / span); cj <= Math.floor((b.z + r) / span); cj++) add(world.buckets.buildings, chunkKey(ci, cj), index); });
  source.roads.forEach((road, index) => { const r = road.width / 2 + 1; for (let ci = Math.floor((Math.min(road.a[0], road.b[0]) - r) / span); ci <= Math.floor((Math.max(road.a[0], road.b[0]) + r) / span); ci++) for (let cj = Math.floor((Math.min(road.a[1], road.b[1]) - r) / span); cj <= Math.floor((Math.max(road.a[1], road.b[1]) + r) / span); cj++) add(world.buckets.roads, chunkKey(ci, cj), index); });
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

/** A lot standing on cells i0..i0+nx, j0..j0+nz, unless one of them is taken (a lot, or a road). */
function standLot(world: World, lot: Omit<WorldLot, "skeleton" | "rooms" | "side">, kind: SkeletonKind, seed: number): boolean {
  for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) if (world.lotAt.has(cellKey(i, j)) || onRoad(world, (i + 0.5) * SKELETON_CELL, (j + 0.5) * SKELETON_CELL)) return false;
  const skeleton: Skeleton = generateSkeleton(kind, seed, { width: lot.nx * SKELETON_CELL, depth: lot.nz * SKELETON_CELL, floors: lot.floors, cores: lot.nx * lot.nz > 48 ? 2 : 1 });
  const index = world.lots.push({ ...lot, side: "west", skeleton, rooms: furnish(skeleton, 1) }) - 1;
  for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) world.lotAt.set(cellKey(i, j), index);
  return true;
}

/** Lay one chunk: open ground, roads, plazas, the anchors' buildings, then every source building standing on it. */
function materialize(world: World, ci: number, cj: number, born: number) {
  world.chunks.set(chunkKey(ci, cj), born);
  const i0 = ci * CHUNK, j0 = cj * CHUNK, x0 = i0 * SKELETON_CELL, z0 = j0 * SKELETON_CELL, span = CHUNK * SKELETON_CELL;
  for (let j = j0; j < j0 + CHUNK; j++) for (let i = i0; i < i0 + CHUNK; i++) {
    const x = (i + 0.5) * SKELETON_CELL, z = (j + 0.5) * SKELETON_CELL;
    world.ground.set(cellKey(i, j), onRoad(world, x, z) ? GROUND.avenue : world.source.plazas.some((p) => Math.hypot(x - p.x, z - p.z) <= p.r) ? GROUND.plaza : GROUND.street);
  }
  // A staged building on its spot, clearing the source buildings under it; the street in front of its door stays open.
  for (const anchor of world.source.anchors) {
    if (!anchor.own || world.claimed.has(`anchor:${anchor.place}`) || anchor.x < x0 - 40 || anchor.x > x0 + span + 40 || anchor.z < z0 - 40 || anchor.z > z0 + span + 40) continue;
    world.claimed.add(`anchor:${anchor.place}`);
    const [w, d] = ROLE_SIZE[anchor.role], nx = w, nz = d, ai = Math.round(anchor.x / SKELETON_CELL - nx / 2), aj = Math.round(anchor.z / SKELETON_CELL - nz / 2);
    for (const b of world.source.buildings) if (Math.abs(b.x - anchor.x) < (nx * SKELETON_CELL + b.w) / 2 + 2 && Math.abs(b.z - anchor.z) < (nz * SKELETON_CELL + b.d) / 2 + 2) world.claimed.add(b.id);
    for (let j = aj; j < aj + nz; j++) for (let i = ai; i < ai + nx; i++) world.lotAt.delete(cellKey(i, j));
    const lot = { id: `anchor_${anchor.place}`, label: anchor.label, role: anchor.role, i0: ai, j0: aj, nx, nz, floors: Math.min(WALK_FLOORS, anchor.floors), height: anchor.floors, source: `anchor:${anchor.place}`, born, place: anchor.place };
    const skeleton = generateSkeleton(ROLE_KIND[anchor.role], seedOf(anchor.place), { width: nx * SKELETON_CELL, depth: nz * SKELETON_CELL, floors: lot.floors, cores: 2 });
    const index = world.lots.push({ ...lot, side: "west", skeleton, rooms: furnish(skeleton, 1) }) - 1;
    for (let j = aj; j < aj + nz; j++) for (let i = ai; i < ai + nx; i++) world.lotAt.set(cellKey(i, j), index);
  }
  for (const index of world.buckets.buildings.get(chunkKey(ci, cj)) ?? []) {
    const b = world.source.buildings[index];
    if (world.claimed.has(b.id)) continue;
    world.claimed.add(b.id);
    const [hx, hz] = inscribed(b.w, b.d, b.angle), bi = Math.ceil((b.x - hx) / SKELETON_CELL), bj = Math.ceil((b.z - hz) / SKELETON_CELL);
    const nx = Math.floor((b.x + hx) / SKELETON_CELL) - bi, nz = Math.floor((b.z + hz) / SKELETON_CELL) - bj;
    if (nx < 3 || nz < 3) continue;
    const floors = Math.max(1, Math.min(WALK_FLOORS, b.floors)), role = roleOf(b.kind, b.floors);
    standLot(world, { id: b.id, label: null, role, i0: bi, j0: bj, nx, nz, floors, height: b.floors, source: b.id, born, place: null }, KIND_OF[b.kind] ?? ROLE_KIND[role], seedOf(b.id));
  }
  // Clutter on open ground (one cell in ten), never on a road or in front of a door.
  const draw = skeletonStream("world-clutter", ci, cj);
  for (let j = j0; j < j0 + CHUNK; j++) for (let i = i0; i < i0 + CHUNK; i++) { const key = cellKey(i, j); if (world.ground.get(key) === GROUND.street && !world.lotAt.has(key) && !world.lotAt.has(cellKey(i, j - 1)) && draw() < 0.06) world.clutter.add(key); }
}

/** Materialize every chunk within `radius` metres of (x, z) at moment `born`; how many were new. */
export function ensure(world: World, x: number, z: number, radius: number, born: number): number {
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

/** What each node is, from the last graph: 0 none, 1 outdoor, 2 circulation, 3 room, 4 roof; its lot; its ground. */
export interface WorldGraph { graph: MoveGraph; type: Uint8Array; lot: Int32Array; ground: Uint8Array }

/**
 * The movement graph over the materialized world and what stands (`standing` per lot), with the things placed in it
 * (in world cells). Every node seen so far keeps its id; one that no longer stands has no edges. With a `box` (metres),
 * only the world inside it is walked: edges stay inside, and nodes outside have none (positions are kept for every id).
 */
export function worldGraph(world: World, standing: Uint8Array[], things: PlacedThing[] = [], box?: { x0: number; z0: number; x1: number; z1: number }): WorldGraph {
  const inside = (i: number, j: number) => !box || ((i + 0.5) * SKELETON_CELL >= box.x0 && (i + 0.5) * SKELETON_CELL <= box.x1 && (j + 0.5) * SKELETON_CELL >= box.z0 && (j + 0.5) * SKELETON_CELL <= box.z1);
  const edges: { from: number; to: number; dir: number; cost: number; kind: number }[] = [];
  const roomOf = world.lots.map((lot) => { const map = new Int32Array(lot.skeleton.cells.length).fill(NOT); lot.rooms.forEach((room, r) => { for (let i = room.i0; i <= room.i1; i++) for (let j = room.j0; j <= room.j1; j++) map[cellIndex(lot.skeleton, i, j, room.floor)] = r; }); return map; });
  const thingAt = new Map<number, number>();
  things.forEach((thing, index) => { for (let j = thing.j0; j <= thing.j1; j++) for (let i = thing.i0; i <= thing.i1; i++) { const key = cellKey(i, j), there = thingAt.get(key); if (there === undefined || things[there].top < thing.top) thingAt.set(key, index); } });
  const span = CHUNK;
  const known = (i: number, j: number) => world.chunks.has(chunkKey(Math.floor(i / span), Math.floor(j / span)));
  const what = (i: number, j: number, k: number): { type: number; lot: number; local: number } => {
    if (k < 0 || !inside(i, j)) return { type: 0, lot: NOT, local: NOT };
    const key = cellKey(i, j), index = world.lotAt.get(key) ?? NOT, thing = thingAt.get(key) ?? NOT;
    if (thing >= 0 && k === things[thing].top && (index < 0 || k > world.lots[index].floors)) return { type: 4, lot: 1000 + thing, local: NOT };
    if (index < 0) return { type: k === 0 && known(i, j) && !world.clutter.has(key) && !(thing >= 0 && things[thing].grounded) ? 1 : 0, lot: NOT, local: NOT };
    const lot = world.lots[index];
    if (k === lot.floors) return { type: 4, lot: index, local: NOT };
    if (k > lot.floors) return { type: 0, lot: NOT, local: NOT };
    const local = cellIndex(lot.skeleton, i - lot.i0, j - lot.j0, k);
    if (lot.skeleton.cells[local] !== MASS) return { type: standing[index]?.[local] ? 2 : 0, lot: index, local };
    return { type: roomOf[index][local] >= 0 ? 3 : 0, lot: index, local };
  };
  // Every cell to walk: the open ground of materialized chunks, and every lot's cells on every floor up to its roof.
  const cells: [number, number, number][] = [];
  for (const [key] of world.chunks) { const ci = Math.floor(key / 65536) - OFF, cj = (key % 65536) - OFF; for (let j = cj * CHUNK; j < (cj + 1) * CHUNK; j++) for (let i = ci * CHUNK; i < (ci + 1) * CHUNK; i++) if (inside(i, j) && !world.lotAt.has(cellKey(i, j))) cells.push([i, j, 0]); }
  world.lots.forEach((lot) => { if (box && ((lot.i0 + lot.nx) * SKELETON_CELL < box.x0 || lot.i0 * SKELETON_CELL > box.x1 || (lot.j0 + lot.nz) * SKELETON_CELL < box.z0 || lot.j0 * SKELETON_CELL > box.z1)) return; for (let k = 0; k <= lot.floors; k++) for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) if (inside(i, j)) cells.push([i, j, k]); });
  for (const thing of things) for (let j = thing.j0; j <= thing.j1; j++) for (let i = thing.i0; i <= thing.i1; i++) if (inside(i, j)) cells.push([i, j, thing.top]);
  const add = (from: number, to: number, dx: number, dz: number, cost: number, kind: number, dir = directionOf(dx, dz)) => edges.push({ from, to, dir, cost, kind });
  const surface = (i: number, j: number) => { const key = cellKey(i, j), index = world.lotAt.get(key) ?? NOT, thing = thingAt.get(key) ?? NOT; return Math.max(index < 0 ? 0 : world.lots[index].floors * FLOOR_HEIGHT, thing < 0 ? 0 : things[thing].top * FLOOR_HEIGHT); };
  const ELEVATION = Math.atan(1 / Math.SQRT2), G = 9.8;
  for (const [i, j, k] of cells) {
    const here = what(i, j, k);
    if (!here.type) continue;
    const node = nodeId(world, i, j, k), eight = here.type === 1 || here.type === 4;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], ...(eight ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [])]) {
      const there = what(i + dx, j + dz, k);
      if (!there.type) continue;
      let ok = false;
      if (here.type === 1 && there.type === 1) ok = !(dx && dz) || (what(i + dx, j, k).type === 1 && what(i, j + dz, k).type === 1);
      else if (here.type === 4 && there.type === 4) ok = here.lot === there.lot;
      else if (here.lot === there.lot && here.lot >= 0) {
        const roomA = here.type === 3 ? roomOf[here.lot][here.local] : NOT, roomB = there.type === 3 ? roomOf[there.lot][there.local] : NOT;
        ok = (here.type === 2 && there.type === 2) || (roomA >= 0 && roomA === roomB) || (roomA >= 0 && there.type === 2 && world.lots[here.lot].rooms[roomA].doors.includes(there.local)) || (roomB >= 0 && here.type === 2 && world.lots[there.lot].rooms[roomB].doors.includes(here.local));
      } else if (k === 0) {
        const lot = here.type === 2 ? world.lots[here.lot] : there.type === 2 ? world.lots[there.lot] : null, inside = here.type === 2 ? here : there;
        ok = !!lot && !dx && inside.local === lot.skeleton.entrance && (here.type === 1 || there.type === 1);
      }
      if (ok) add(node, nodeId(world, i + dx, j + dz, k), dx, dz, SKELETON_CELL * Math.hypot(dx, dz), EDGE.walk);
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
  // Positions of every node ever seen (those that no longer stand have no edges), and what each is now.
  const count = world.cells.length / 3, positions: [number, number, number][] = new Array(count), type = new Uint8Array(count), lot = new Int32Array(count).fill(NOT), ground = new Uint8Array(count);
  for (let id = 0; id < count; id++) {
    const { i, j, k } = cellOf(world, id);
    positions[id] = [(i + 0.5) * SKELETON_CELL, (j + 0.5) * SKELETON_CELL, k * FLOOR_HEIGHT];
    if (!inside(i, j)) continue;
    const here = what(i, j, k);
    type[id] = here.type; lot[id] = here.lot; ground[id] = here.type === 1 ? world.ground.get(cellKey(i, j)) ?? GROUND.street : 0;
  }
  return { graph: buildGraph(positions, edges), type, lot, ground };
}

/**
 * The spots a decision model names, near a point (within `radius` metres, on the world as materialized): roads (avenue),
 * plazas, open ground (street), roofs (rooftop), rooms either side (west, east), and the floors and roof of the `main`
 * building (the scene's own, or the one nearest the point) as `main:floorN` and `main:roof`.
 */
export function spotsNear(world: World, built: WorldGraph, x: number, z: number, radius: number, main: number | null): Record<string, number[]> {
  const spots: Record<string, number[]> = { avenue: [], plaza: [], north: [], west: [], east: [], rooftop: [] };
  const count = built.type.length, lotNear = main ?? nearestLot(world, x, z);
  for (let id = 0; id < count; id++) {
    const type = built.type[id];
    if (!type || !built.graph.offsets || built.graph.offsets[id + 1] === built.graph.offsets[id]) continue;
    const { i, j, k } = cellOf(world, id), px = (i + 0.5) * SKELETON_CELL, pz = (j + 0.5) * SKELETON_CELL, own = built.lot[id] === lotNear && lotNear !== null;
    if (own) { if (type === 2 || type === 3) (spots[`main:floor${k + 1}`] ??= []).push(id); else if (type === 4) (spots["main:roof"] ??= []).push(id); }
    if (Math.hypot(px - x, pz - z) > radius) continue;
    if (type === 1) (built.ground[id] === GROUND.avenue ? spots.avenue : built.ground[id] === GROUND.plaza ? spots.plaza : spots.north).push(id);
    if (type === 3 && !own) (px < x ? spots.west : spots.east).push(id);
    if (type === 4) spots.rooftop.push(id);
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
  if (spot === "basement") return spots["main:floor1"]?.length ? "main:floor1" : "avenue";
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
export function windowOf(graph: MoveGraph, box: { x0: number; z0: number; x1: number; z1: number }): { graph: MoveGraph; local: Int32Array; ids: Int32Array } {
  const local = new Int32Array(graph.nodes).fill(NOT), ids: number[] = [];
  for (let n = 0; n < graph.nodes; n++) if (graph.x[n] >= box.x0 && graph.x[n] <= box.x1 && graph.z[n] >= box.z0 && graph.z[n] <= box.z1) { local[n] = ids.length; ids.push(n); }
  const count = ids.length, offsets = new Int32Array(count + 1), to: number[] = [], dir: number[] = [], cost: number[] = [], kind: number[] = [];
  for (let m = 0; m < count; m++) {
    const n = ids[m];
    for (let e = graph.offsets[n]; e < graph.offsets[n + 1]; e++) { const there = local[graph.to[e]]; if (there < 0) continue; to.push(there); dir.push(graph.dir[e]); cost.push(graph.cost[e]); kind.push(graph.kind[e]); }
    offsets[m + 1] = to.length;
  }
  const pick = (values: Float64Array) => Float64Array.from(ids, (n) => values[n]);
  return { graph: { nodes: count, x: pick(graph.x), z: pick(graph.z), y: pick(graph.y), offsets, to: Int32Array.from(to), dir: Uint8Array.from(dir), cost: Float64Array.from(cost), kind: Uint8Array.from(kind) }, local, ids: Int32Array.from(ids) };
}

