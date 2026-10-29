import { CORRIDOR, MASS, STAIR, SKELETON_CELL, FLOOR_HEIGHT, cellAt, cellIndex, furnish, generateSkeleton, neighbours, reachable, skeletonStream, strike, type RoomBox, type Skeleton, type SkeletonKind } from "./skeleton.js";
import { EDGE, UP, DOWN, buildGraph, directionOf, launchOf, type MoveGraph } from "./pathIntegral.js";

/**
 * A group place (a street, a district) of skeleton buildings on one 2 m grid:
 * streets, alleys and a plaza on the ground, and in each lot a building's
 * circulation skeleton (corridors, stair cores, box rooms) on every floor,
 * with its roof above. The place tree decides what is named: a group's
 * building children take the widest lots.
 *
 * Walking: 8 directions outdoors and on roofs, 4 inside; stairs climb a floor
 * at a time and reach the roof; rooms open only onto their own corridors; the
 * street door joins a building to the street in front of it; roofs jump an
 * alley to a roof no higher, and fall to the street. Clutter (percolation)
 * closes outdoor cells, redrawn while it cuts any building door off the
 * avenue. Damage removes skeleton cells, and the walk sees what is left.
 */
export type BuildingRole = "shop" | "office" | "hospital" | "station";
const SKELETON_OF: Record<BuildingRole, { kind: SkeletonKind; floors: [number, number] }> = { shop: { kind: "house", floors: [2, 4] }, office: { kind: "tower", floors: [5, 8] }, hospital: { kind: "school", floors: [4, 6] }, station: { kind: "school", floors: [2, 3] } };
export const PLACE_GRID = { NX: 32, NZ: 24 };
const NORTH = 2, ROW = 7, MIDDLE = 4, AVENUE = 4, SIDE = 2, ALLEY = 1, PLAZA = 8, LAMBDA = 8;
/** Launch speeds (m/s) of a sky arc, and its effort: metres of walking per metre of launch height v²/2g, plus a landing that drops more than a floor. */
export const ARC_SPEEDS = [7, 10, 13], ARC_EFFORT = 2;
/** Outdoor cell kinds on the ground. */
export const GROUND = { building: 0, street: 1, plaza: 2, avenue: 3, north: 4 } as const;

export interface PlaceLot { id: string; label: string | null; role: BuildingRole; i0: number; j0: number; nx: number; nz: number; floors: number; side: "west" | "east"; skeleton: Skeleton; rooms: RoomBox[] }
export interface SkeletonPlace { id: string; kind: "district" | "street" | "site"; NX: number; NZ: number; K: number; ground: Uint8Array; clutter: Uint8Array; clutterDraws: number; lots: PlaceLot[] }

const between = (rng: () => number, low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
function lotsAlong(rng: () => number, from: number, to: number, min: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = from; to - x >= min; ) { const left = to - x, width = left <= max ? left : between(rng, min, Math.min(max, left - min - ALLEY)); out.push([x, width]); x += width + ALLEY; }
  return out;
}

/** `site`: a place that is itself one building (its first member, on the widest lot, with its own floor range), among neighbours. */
export function composePlace(input: { id: string; kind: "district" | "street" | "site"; seed: number; members: { label: string; role: BuildingRole; floors?: [number, number] }[] }, options: { clutter?: number } = {}): SkeletonPlace {
  const { NX, NZ } = PLACE_GRID, rng = skeletonStream("place", input.id, input.seed), rowA = NORTH, rowB = NORTH + ROW + MIDDLE, plazaX = (NX - PLAZA) / 2;
  const ground = new Uint8Array(NX * NZ).fill(GROUND.street);
  const fill = (i0: number, j0: number, w: number, d: number, value: number) => { for (let j = j0; j < j0 + d; j++) for (let i = i0; i < i0 + w; i++) ground[j * NX + i] = value; };
  fill(0, 0, NX, NORTH, GROUND.north); fill(0, NZ - AVENUE, NX, AVENUE, GROUND.avenue); fill(plazaX, NORTH + ROW, PLAZA, MIDDLE + ROW, GROUND.plaza);
  const [min, max] = input.kind === "street" ? [4, 6] : [6, 11];
  const slots = [...lotsAlong(rng, SIDE, NX - SIDE, min, max).map(([i, w]) => ({ i, j: rowA, w })), ...lotsAlong(rng, SIDE, plazaX - ALLEY, min, max).map(([i, w]) => ({ i, j: rowB, w })), ...lotsAlong(rng, plazaX + PLAZA + ALLEY, NX - SIDE, min, max).map(([i, w]) => ({ i, j: rowB, w }))];
  const named = new Map([...slots].sort((a, b) => b.w - a.w).slice(0, input.members.length).map((slot, index) => [slot, input.members[index]]));
  const lots = slots.map((slot, index): PlaceLot => {
    const member = named.get(slot), role: BuildingRole = member?.role ?? (input.kind === "street" || slot.w < 7 ? "shop" : rng() < 0.6 ? "office" : "shop");
    const { kind } = SKELETON_OF[role], [low, high] = member?.floors ?? SKELETON_OF[role].floors, floors = between(rng, low, high);
    const skeleton = generateSkeleton(kind, (input.seed * 7919 + index) >>> 0, { width: slot.w * SKELETON_CELL, depth: ROW * SKELETON_CELL, floors, cores: kind === "house" ? 1 : 2 });
    fill(slot.i, slot.j, slot.w, ROW, GROUND.building);
    return { id: `lot_${index + 1}`, label: member?.label ?? null, role, i0: slot.i, j0: slot.j, nx: slot.w, nz: ROW, floors, side: slot.i + slot.w / 2 < NX / 2 ? "west" : "east", skeleton, rooms: furnish(skeleton, 1) };
  });
  // Clutter on the ground, never in front of a door, redrawn while it cuts a door off the avenue.
  const doorstep = new Set(lots.map((lot) => (lot.j0 + lot.nz) * NX + lot.i0 + Math.floor(lot.nx / 2)));
  let clutter = new Uint8Array(NX * NZ), draws = 0;
  for (; draws < 20; ) {
    draws++;
    const draw = skeletonStream("clutter", input.id, input.seed, draws);
    clutter = new Uint8Array(NX * NZ);
    for (let cell = 0; cell < clutter.length; cell++) if (ground[cell] !== GROUND.building && !doorstep.has(cell) && draw() < (options.clutter ?? 0.1)) clutter[cell] = 1;
    const seen = new Uint8Array(NX * NZ), queue: number[] = [];
    for (let cell = 0; cell < seen.length; cell++) if (ground[cell] === GROUND.avenue && !clutter[cell]) { seen[cell] = 1; queue.push(cell); }
    for (let head = 0; head < queue.length; head++) { const cell = queue[head], i = cell % NX; for (const next of [i + 1 < NX ? cell + 1 : -1, i > 0 ? cell - 1 : -1, cell + NX < seen.length ? cell + NX : -1, cell - NX]) if (next >= 0 && !seen[next] && ground[next] !== GROUND.building && !clutter[next]) { seen[next] = 1; queue.push(next); } }
    if ([...doorstep].every((cell) => seen[cell])) break;
  }
  return { id: input.id, kind: input.kind, NX, NZ, K: Math.max(...lots.map((lot) => lot.floors)) + 1, ground, clutter, clutterDraws: draws, lots };
}

/** Node of a grid cell on level k (k = a lot's floor count is its roof). */
export const nodeOf = (place: SkeletonPlace, i: number, j: number, k: number) => (k * place.NZ + j) * place.NX + i;
export const nodePosition = (place: SkeletonPlace, node: number) => { const i = node % place.NX, j = Math.floor(node / place.NX) % place.NZ, k = Math.floor(node / (place.NX * place.NZ)); return { i, j, k, x: (i + 0.5) * SKELETON_CELL, z: (j + 0.5) * SKELETON_CELL, y: k * FLOOR_HEIGHT }; };

/** The movement graph over what stands (`standing` per lot: skeleton cells still there), and the nodes a decision model's spots name. */
/** A thing the story put in the place, as the walk sees it: its footprint (cells), the level of its top, and whether it stands on the ground. */
export interface PlacedThing { i0: number; j0: number; i1: number; j1: number; top: number; grounded: boolean }

/**
 * The movement graph over what stands (`standing` per lot: skeleton cells still there), and the nodes a decision model's spots name.
 * Things the story put in the place are part of it: their tops are walked like roofs (landed on by arcs, left by falls), and a
 * thing on the ground blocks the street cells under it.
 */
export function placeGraph(place: SkeletonPlace, standing: Uint8Array[], things: PlacedThing[] = []): { graph: MoveGraph; spots: Record<string, number[]> } {
  const { NX, NZ } = place, K = Math.max(place.K, ...things.map((thing) => thing.top + 1)), positions: [number, number, number][] = [], edges: { from: number; to: number; dir: number; cost: number; kind: number }[] = [];
  for (let node = 0; node < NX * NZ * K; node++) { const p = nodePosition(place, node); positions.push([p.x, p.z, p.y]); }
  const lotAt = new Int32Array(NX * NZ).fill(-1);
  place.lots.forEach((lot, index) => { for (let j = lot.j0; j < lot.j0 + lot.nz; j++) for (let i = lot.i0; i < lot.i0 + lot.nx; i++) lotAt[j * NX + i] = index; });
  const roomOf = place.lots.map((lot) => { const map = new Int32Array(lot.skeleton.cells.length).fill(-1); lot.rooms.forEach((room, r) => { for (let i = room.i0; i <= room.i1; i++) for (let j = room.j0; j <= room.j1; j++) map[cellIndex(lot.skeleton, i, j, room.floor)] = r; }); return map; });
  // What kind of walkable node a grid node is: 0 none, 1 outdoor, 2 circulation, 3 room, 4 roof.
  const thingAt = new Int32Array(NX * NZ).fill(-1);
  things.forEach((thing, index) => { for (let j = Math.max(0, thing.j0); j <= Math.min(NZ - 1, thing.j1); j++) for (let i = Math.max(0, thing.i0); i <= Math.min(NX - 1, thing.i1); i++) if (thingAt[j * NX + i] < 0 || things[thingAt[j * NX + i]].top < thing.top) thingAt[j * NX + i] = index; });
  const what = (i: number, j: number, k: number): { type: number; lot: number; local: number } => {
    if (i < 0 || j < 0 || i >= NX || j >= NZ || k < 0 || k >= K) return { type: 0, lot: -1, local: -1 };
    const index = lotAt[j * NX + i], thing = thingAt[j * NX + i];
    // A thing's top is a roof of its own (lot ids from 1000 up); a thing on the ground blocks the street under it.
    if (thing >= 0 && k === things[thing].top && (index < 0 || k > place.lots[index].floors)) return { type: 4, lot: 1000 + thing, local: -1 };
    if (index < 0) return { type: k === 0 && !place.clutter[j * NX + i] && !(thing >= 0 && things[thing].grounded) ? 1 : 0, lot: -1, local: -1 };
    const lot = place.lots[index];
    if (k === lot.floors) return { type: 4, lot: index, local: -1 };
    if (k > lot.floors) return { type: 0, lot: -1, local: -1 };
    const local = cellIndex(lot.skeleton, i - lot.i0, j - lot.j0, k);
    if (lot.skeleton.cells[local] !== MASS) return { type: standing[index][local] ? 2 : 0, lot: index, local };
    return { type: roomOf[index][local] >= 0 ? 3 : 0, lot: index, local };
  };
  const add = (from: number, to: number, dx: number, dz: number, cost: number, kind: number, dir = directionOf(dx, dz)) => edges.push({ from, to, dir, cost, kind });
  for (let k = 0; k < K; k++) for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const here = what(i, j, k), node = nodeOf(place, i, j, k);
    if (!here.type) continue;
    const eight = here.type === 1 || here.type === 4;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], ...(eight ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [])]) {
      const there = what(i + dx, j + dz, k);
      if (!there.type) continue;
      let ok = false;
      if (here.type === 1 && there.type === 1) ok = !(dx && dz) || (what(i + dx, j, k).type === 1 && what(i, j + dz, k).type === 1);
      else if (here.type === 4 && there.type === 4) ok = here.lot === there.lot;
      else if (here.lot === there.lot && here.lot >= 0) {
        const roomA = here.type === 3 ? roomOf[here.lot][here.local] : -1, roomB = there.type === 3 ? roomOf[there.lot][there.local] : -1;
        ok = (here.type === 2 && there.type === 2) || (roomA >= 0 && roomA === roomB) || (roomA >= 0 && there.type === 2 && place.lots[here.lot].rooms[roomA].doors.includes(there.local)) || (roomB >= 0 && here.type === 2 && place.lots[there.lot].rooms[roomB].doors.includes(here.local));
      } else if (k === 0) {
        // The street door: a building's entrance cell and the street in front of it.
        const lot = here.type === 2 ? place.lots[here.lot] : there.type === 2 ? place.lots[there.lot] : null, inside = here.type === 2 ? here : there;
        ok = !!lot && !dx && inside.local === lot.skeleton.entrance && (here.type === 1 || there.type === 1);
      }
      if (ok) add(node, nodeOf(place, i + dx, j + dz, k), dx, dz, SKELETON_CELL * Math.hypot(dx, dz), EDGE.walk);
    }
    if (here.type === 2) {
      // Stairs: up and down the core, and from its top floor onto the roof.
      const lot = place.lots[here.lot], up = what(i, j, k + 1), down = what(i, j, k - 1);
      if (lot.skeleton.cells[here.local] === STAIR) {
        if ((up.type === 2 && lot.skeleton.cells[up.local] === STAIR) || (up.type === 4 && up.lot === here.lot)) add(node, nodeOf(place, i, j, k + 1), 0, 0, 2 + LAMBDA * FLOOR_HEIGHT, EDGE.climb, UP);
        if (down.type === 2 && lot.skeleton.cells[down.local] === STAIR) add(node, nodeOf(place, i, j, k - 1), 0, 0, 2 + FLOOR_HEIGHT, EDGE.descend, DOWN);
      }
    }
    if (here.type === 4) {
      const lot = place.lots[here.lot], below = what(i, j, k - 1);
      if (lot && below.type === 2 && lot.skeleton.cells[below.local] === STAIR) add(node, nodeOf(place, i, j, k - 1), 0, 0, 2 + FLOOR_HEIGHT, EDGE.descend, DOWN);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const out = what(i + dx, j + dz, k);
        if (out.type === 4 && out.lot === here.lot) continue;
        const street = what(i + dx, j + dz, 0);
        if (street.type === 1) add(node, nodeOf(place, i + dx, j + dz, 0), dx, dz, 1 + k * FLOOR_HEIGHT, EDGE.fall, DOWN);
        // Across one alley cell to a roof no higher.
        for (let level = k; level >= 1; level--) { const across = what(i + 2 * dx, j + 2 * dz, level); if (lotAt[(j + dz) * NX + i + dx] < 0 && across.type === 4 && across.lot !== here.lot) { add(node, nodeOf(place, i + 2 * dx, j + 2 * dz, level), dx, dz, 2 * SKELETON_CELL + 2, EDGE.jump); break; } }
      }
    }
  }
  // Sky arcs: from a roof or the street, launched along a rising cube diagonal at one of a few speeds, flying
  // under gravity until the arc first meets a surface no higher than the launch (so no arc gains height).
  const surface = (i: number, j: number) => { const index = lotAt[j * NX + i], thing = thingAt[j * NX + i]; return Math.max(index < 0 ? 0 : place.lots[index].floors * FLOOR_HEIGHT, thing < 0 ? 0 : things[thing].top * FLOOR_HEIGHT); };
  const ELEVATION = Math.atan(1 / Math.SQRT2), G = 9.8;
  for (let k = 0; k < K; k++) for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const here = what(i, j, k);
    if (here.type !== 1 && here.type !== 4) continue;
    const x0 = (i + 0.5) * SKELETON_CELL, z0 = (j + 0.5) * SKELETON_CELL, y0 = k * FLOOR_HEIGHT;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const speed of ARC_SPEEDS) {
      const vh = speed * Math.cos(ELEVATION) / Math.SQRT2, vy = speed * Math.sin(ELEVATION);
      for (let t = 0.05; t < 4; t += 0.05) {
        const x = x0 + sx * vh * t, z = z0 + sz * vh * t, y = y0 + vy * t - G * t * t / 2, a = Math.floor(x / SKELETON_CELL), b = Math.floor(z / SKELETON_CELL);
        if (a < 0 || b < 0 || a >= NX || b >= NZ || y < -0.5) break;
        const top = surface(a, b);
        if (y > top) continue;
        if (vy - G * t > 0) break;
        const land = what(a, b, top / FLOOR_HEIGHT), far = Math.hypot(x - x0, z - z0);
        if (top <= y0 && far >= 3 && (land.type === 1 || land.type === 4)) edges.push({ from: nodeOf(place, i, j, k), to: nodeOf(place, a, b, top / FLOOR_HEIGHT), dir: launchOf(sx, sz), cost: 2 + ARC_EFFORT * speed * speed / (2 * G) + Math.max(0, y0 - top - FLOOR_HEIGHT), kind: EDGE.arc });
        break;
      }
    }
  }
  const graph = buildGraph(positions, edges), spots: Record<string, number[]> = { avenue: [], plaza: [], north: [], west: [], east: [], rooftop: [] };
  for (let k = 0; k < K; k++) for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const here = what(i, j, k), node = nodeOf(place, i, j, k);
    if (here.type === 1) { const g = place.ground[j * NX + i]; if (g === GROUND.avenue) spots.avenue.push(node); else if (g === GROUND.plaza) spots.plaza.push(node); else if (g === GROUND.north) spots.north.push(node); }
    if (here.type === 3) spots[place.lots[here.lot].side].push(node);
    // Each building's floors (rooms and corridors) and roof, for answers that name a floor.
    if (here.type === 2 || here.type === 3) (spots[`lot${here.lot}:floor${k + 1}`] ??= []).push(node);
    if (here.type === 4 && here.lot < 1000) (spots[`lot${here.lot}:roof`] ??= []).push(node);
    if (here.type === 4) spots.rooftop.push(node);
  }
  return { graph, spots };
}


/**
 * The spot a decision model names, on this place's graph: its own spots as
 * they are; the floors, stairs, roof and basement of the place's own building
 * (the lot named like the place) on that building; doors and streets on the
 * avenue, back ways on the north lane, open ground on the plaza.
 */
export function placeSpot(place: SkeletonPlace, label: string, spots: Record<string, number[]>, spot: string | null | undefined): string | null {
  if (!spot) return null;
  if (spots[spot]?.length) return spot;
  const main = place.lots.findIndex((lot) => lot.label === label), level = /^(?:floor|stairs)-(\d+)$/.exec(spot);
  if (level && main >= 0) return `lot${main}:floor${Math.min(place.lots[main].floors, Math.max(1, Number(level[1])))}`;
  if (["roof", "bell-tower", "keep-top", "tower-top"].includes(spot)) return main >= 0 ? `lot${main}:roof` : "rooftop";
  if (spot === "basement") return main >= 0 ? `lot${main}:floor1` : "avenue";
  return ({ street: "avenue", "front-door": "avenue", entrance: "avenue", gate: "avenue", road: "avenue", alley: "north", "back-door": "north", "side-door": "east", concourse: "plaza", platform: "plaza", path: "plaza", courtyard: "plaza", garden: "east" } as Record<string, string>)[spot] ?? null;
}
/** A hit on a lot at a point (place metres): the lot's new standing cells, what it destroyed and what it cut off (cells and rooms). */
export function hitLot(place: SkeletonPlace, index: number, standing: Uint8Array, point: { x: number; y: number; z: number }, degree: number, rng: () => number) {
  const lot = place.lots[index], local = { x: point.x - lot.i0 * SKELETON_CELL, y: point.y + FLOOR_HEIGHT / 2, z: point.z - lot.j0 * SKELETON_CELL, degree };
  const result = strike(lot.skeleton, standing, local, rng), seen = reachable(lot.skeleton, result.standing);
  const cutRooms = lot.rooms.flatMap((room, r) => room.doors.some((door) => result.standing[door] && seen[door]) ? [] : [r]);
  return { ...result, cutRooms };
}
export { CORRIDOR, STAIR, cellAt };

/**
 * Damage as a step down the building's percolation curve, confined to a box: the 3D region a decision model's
 * bounding box on the rendered view back-projects to (place metres, y up). Inside it each standing cell's
 * occupation drops by `strength` × 0.6 (stair cores, reinforced, by a third of that); outside nothing changes.
 * So a strong blast guts the box and cuts off what depended on it, and a glancing one thins it.
 */
export function degrade(place: SkeletonPlace, index: number, standing: Uint8Array, box: { x: [number, number]; y: [number, number]; z: [number, number] }, strength: number, rng: () => number) {
  const lot = place.lots[index], after = standing.slice(), destroyed: number[] = [], loss = Math.min(1, Math.max(0, strength)) * 0.6;
  for (let cell = 0; cell < after.length; cell++) {
    if (!after[cell]) continue;
    const { i, j, k } = cellAt(lot.skeleton, cell), x = (lot.i0 + i + 0.5) * SKELETON_CELL, z = (lot.j0 + j + 0.5) * SKELETON_CELL, y = (k + 0.5) * FLOOR_HEIGHT;
    if (x < box.x[0] || x > box.x[1] || y < box.y[0] || y > box.y[1] || z < box.z[0] || z > box.z[1]) continue;
    if (rng() < (lot.skeleton.cells[cell] === STAIR ? loss / 3 : loss)) { after[cell] = 0; destroyed.push(cell); }
  }
  // Cut off: what can no longer reach the ground floor. A blasted ground floor opens its own way out, so losing the door alone does not cut the building off.
  const seen = new Uint8Array(after.length), queue: number[] = [];
  for (let cell = 0; cell < after.length; cell++) if (after[cell] && cellAt(lot.skeleton, cell).k === 0) { seen[cell] = 1; queue.push(cell); }
  for (let head = 0; head < queue.length; head++) for (const next of neighbours(lot.skeleton, after, queue[head])) if (!seen[next]) { seen[next] = 1; queue.push(next); }
  const cutOff: number[] = [];
  for (let cell = 0; cell < after.length; cell++) if (after[cell] && !seen[cell]) cutOff.push(cell);
  const cutRooms = lot.rooms.flatMap((room, r) => room.doors.some((door) => after[door] && seen[door]) ? [] : [r]);
  return { standing: after, destroyed, cutOff, cutRooms };
}

/** A direction in an embedding space and where events fall along it: strength 0 at the typical calm event, 1 at the typical destructive one. */
export function semanticAxis(vectors: Map<string, number[]>, positive: string[], negative: string[]) {
  const mean = (ids: string[]) => { const dims = vectors.values().next().value!.length, sum = new Array(dims).fill(0); let n = 0; for (const id of ids) { const v = vectors.get(id); if (!v) continue; n++; for (let d = 0; d < dims; d++) sum[d] += v[d]; } return sum.map((value) => value / Math.max(1, n)); };
  const [p, q] = [mean(positive), mean(negative)], axis = p.map((value, d) => value - q[d]), norm = Math.hypot(...axis) || 1;
  const project = (id: string) => { const v = vectors.get(id); return v ? v.reduce((sum, value, d) => sum + value * axis[d] / norm, 0) : null; };
  const median = (values: number[]) => { const sorted = values.filter((value) => value !== null).sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
  const [low, high] = [median(negative.map(project) as number[]), median(positive.map(project) as number[])];
  return { strength: (id: string) => { const value = project(id); return value === null ? null : Math.min(1, Math.max(0, (value - low) / Math.max(1e-9, high - low))); }, positives: positive.length, negatives: negative.length };
}
