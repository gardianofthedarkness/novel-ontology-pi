import { CELL, PLAN_SPECS, certify, generateBuilding, rasterize, stepsFrom, type BuildingPlan, type Navigation, type PlanSpec, type Portal, type Rect, type Room } from "./buildingPlan.js";
import { EDGE, UP, DOWN, buildGraph, directionOf, type MoveGraph } from "./pathIntegral.js";

/**
 * A group place (a street, a district) composed of architectures, the
 * smallest unit of place. The place tree says what a group holds: its
 * children that are buildings take the largest lots (a hospital, a station),
 * and generic buildings fill the rest; streets, alleys and a plaza join them.
 * Every building is generated around its own circulation (buildingPlan) and
 * faces a street, so the group's access holds by construction and is
 * checked again on the combined movement grid.
 *
 * Percolation comes in as clutter: snow, crowds and parked bikes outdoors,
 * furniture inside, each cell blocked independently with a small chance,
 * never in a doorway. A draw that cuts any room off from the avenue is
 * redrawn from the next independent stream, so the clutter is a draw
 * conditioned on access.
 *
 * Above the ground floors lie the roofs: reached by each building's stair
 * core, joined across narrow alleys by jumps, and left by falling to the
 * street (cheap only for someone falling).
 *
 * Layout, top to bottom (z grows toward the avenue): a north street, a row of
 * lots facing a middle street, a second row facing the avenue with the plaza
 * cut out of its middle, the avenue. Side streets close the loop.
 */
export type GroupKind = "district" | "street";
export type BuildingSpec = "shop" | "office" | "hospital" | "station";
export interface GroupMember { id: string; label: string; spec: BuildingSpec }
export interface Lot { id: string; label: string | null; spec: BuildingSpec; rect: Rect; height: number; side: "west" | "east"; plan: BuildingPlan }
export type Spot = "avenue" | "plaza" | "north" | "west" | "east" | "rooftop";
export interface GroupLayout {
  id: string; kind: GroupKind; seed: number; width: number; depth: number;
  lots: Lot[]; streets: Record<"north" | "middle" | "avenue" | "plaza", Rect>;
  rooms: Room[]; portals: Portal[]; nav: Navigation;
  /** Clutter: the chance per outdoor and indoor cell, cells blocked, and draws until access held. */
  clutter: { outdoor: number; indoor: number; cells: number; attempts: number };
  /** The movement graph: ground cells first (node = cell), then one roof node per footprint cell. */
  graph: MoveGraph; roofCells: Int32Array;
  /** Nodes per spot a decision model can name. */
  spots: Record<Spot, number[]>;
}

const W = 64, NORTH = 5, ROW = 14, MIDDLE = 8, AVENUE = 7, SIDE = 4, ALLEY = 2, PLAZA = 16;
export const GROUP_SIZE = { width: W, depth: NORTH + ROW + MIDDLE + ROW + AVENUE };
const LAMBDA = 8;

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const stream = (...parts: (number | string)[]) => { let hash = 2166136261; for (const char of parts.join(":")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return mulberry32(hash >>> 0); };
const between = (rng: () => number, low: number, high: number) => low + Math.floor(rng() * (high - low + 1));

/** Lots of `min`…`max` metres along [from, to), alleys between, whole metres. */
function lotsAlong(rng: () => number, from: number, to: number, min: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  let x = from;
  while (to - x >= min) {
    const left = to - x, width = left <= max ? left : Math.min(max, Math.max(min, between(rng, min, Math.min(max, left - min - ALLEY))));
    out.push([x, width]);
    x += width + ALLEY;
  }
  return out;
}

export function composeGroup(input: { id: string; kind: GroupKind; seed: number; members: GroupMember[] }, options: { outdoor?: number; indoor?: number; attempts?: number } = {}): GroupLayout {
  const rng = stream("group", input.id, input.seed), D = GROUP_SIZE.depth;
  const rowA = NORTH, rowB = NORTH + ROW + MIDDLE, plazaX = (W - PLAZA) / 2;
  const streets = { north: { x: 0, z: 0, width: W, depth: NORTH }, middle: { x: 0, z: NORTH + ROW, width: W, depth: MIDDLE }, avenue: { x: 0, z: D - AVENUE, width: W, depth: AVENUE }, plaza: { x: plazaX, z: NORTH + ROW, width: PLAZA, depth: MIDDLE + ROW } };
  const [min, max] = input.kind === "street" ? [8, 12] : [12, 22];
  const slots = [
    ...lotsAlong(rng, SIDE, W - SIDE, min, max).map(([x, width]) => ({ x, z: rowA, width })),
    ...lotsAlong(rng, SIDE, plazaX - ALLEY, min, max).map(([x, width]) => ({ x, z: rowB, width })),
    ...lotsAlong(rng, plazaX + PLAZA + ALLEY, W - SIDE, min, max).map(([x, width]) => ({ x, z: rowB, width })),
  ];
  // Named buildings take the widest lots; the rest are shops on a street, offices and shops in a district.
  const order = [...slots].sort((a, b) => b.width - a.width), named = new Map(order.slice(0, input.members.length).map((slot, index) => [slot, input.members[index]]));
  const lots: Lot[] = slots.map((slot, index) => {
    const member = named.get(slot), spec: BuildingSpec = member?.spec ?? (input.kind === "street" || slot.width < 14 ? "shop" : rng() < 0.6 ? "office" : "shop");
    const base: PlanSpec = PLAN_SPECS[spec], floors = Math.max(2, base.floors + between(rng, -1, 2));
    const plan = generateBuilding({ ...base, width: slot.width, depth: ROW, floors }, (input.seed * 7919 + index) >>> 0).plan;
    return { id: `lot_${index + 1}`, label: member?.label ?? null, spec, rect: { x: slot.x, z: slot.z, width: slot.width, depth: ROW }, height: floors * base.floorHeight, side: slot.x + slot.width / 2 < W / 2 ? "west" : "east", plan };
  });
  // The buildings' rooms and portals, moved onto their lots; "outside" is the group's streets.
  const rooms: Room[] = [], portals: Portal[] = [];
  for (const lot of lots) {
    const floor = lot.plan.floors[0], id = (room: string) => room === "outside" ? room : `${lot.id}/${room}`;
    for (const room of floor.rooms) rooms.push({ ...room, id: id(room.id), rect: { ...room.rect, x: room.rect.x + lot.rect.x, z: room.rect.z + lot.rect.z } });
    for (const portal of floor.portals) portals.push({ ...portal, id: id(portal.id), between: [id(portal.between[0]), id(portal.between[1])],
      at: portal.at + (portal.axis === "z" ? lot.rect.x : lot.rect.z), from: portal.from + (portal.axis === "z" ? lot.rect.z : lot.rect.x), to: portal.to + (portal.axis === "z" ? lot.rect.z : lot.rect.x) });
  }
  const nav = rasterize({ x: 0, z: 0, width: W, depth: D }, rooms, portals, streets.avenue);
  const whole: BuildingPlan = { version: lots[0].plan.version, archetype: "corridor", seed: input.seed, attempt: 0, footprint: { x: 0, z: 0, width: W, depth: D }, site: { x: 0, z: 0, width: W, depth: D }, street: streets.avenue,
    floors: [{ level: 0, elevation: 0, rooms, portals, cores: lots.flatMap((lot) => lot.plan.floors[0].cores.map((core) => ({ ...core, id: `${lot.id}/${core.id}`, room: `${lot.id}/${core.room}` }))) }] };
  // Clutter, never in a doorway (the cells on both sides of a portal) or on a stair.
  const keep = new Uint8Array(nav.cols * nav.rows), cellAt = (x: number, z: number) => Math.floor(z / CELL) * nav.cols + Math.floor(x / CELL);
  for (const portal of portals) for (let along = portal.from; along < portal.to; along += CELL) for (const side of [-CELL / 2, CELL / 2]) for (const reach of [1, 3]) {
    const [x, z] = portal.axis === "z" ? [portal.at + side * reach, along + CELL / 2] : [along + CELL / 2, portal.at + side * reach];
    if (x >= 0 && x < W && z >= 0 && z < D) keep[cellAt(x, z)] = 1;
  }
  const regionOf = rooms.map((room) => room.use);
  const [outdoor, indoor] = [options.outdoor ?? 0.12, options.indoor ?? 0.08];
  let attempts = 0, blocked = new Uint8Array(nav.cols * nav.rows);
  for (const budget = options.attempts ?? 20; attempts < budget; ) {
    attempts++;
    const draw = stream("clutter", input.id, input.seed, attempts);
    blocked = new Uint8Array(nav.cols * nav.rows);
    for (let cell = 0; cell < blocked.length; cell++) {
      if (keep[cell]) continue;
      const use = nav.region[cell] ? regionOf[nav.region[cell] - 1] : null;
      const chance = use === null ? outdoor : use === "stair" ? 0 : ["hall", "corridor", "lobby", "platform"].includes(use) ? indoor / 2 : indoor;
      if (draw() < chance) blocked[cell] = 1;
    }
    nav.blocked = blocked;
    if (certify(whole, nav, { floors: 1, minDoor: 0.8 }).ok) break;
  }
  // The movement graph: ground cells, roof cells, and the ways between.
  const nodes = nav.cols * nav.rows, positions: [number, number, number][] = [], edges: { from: number; to: number; dir: number; cost: number; kind: number }[] = [];
  for (let cell = 0; cell < nodes; cell++) positions.push([nav.x0 + (cell % nav.cols + 0.5) * CELL, nav.z0 + (Math.floor(cell / nav.cols) + 0.5) * CELL, 0]);
  const step = (from: number, to: number) => { const dx = (to % nav.cols) - (from % nav.cols), dz = Math.floor(to / nav.cols) - Math.floor(from / nav.cols); return { dir: directionOf(dx, dz), cost: CELL * Math.hypot(dx, dz) }; };
  for (let cell = 0; cell < nodes; cell++) if (!blocked[cell]) for (const next of stepsFrom(nav, cell)) edges.push({ from: cell, to: next, ...step(cell, next), kind: EDGE.walk });
  const roofOf = new Int32Array(nodes).fill(-1), lotOf = new Int32Array(nodes).fill(-1), roofCells: number[] = [];
  lots.forEach((lot, index) => {
    for (let j = Math.round(lot.rect.z / CELL); j < Math.round((lot.rect.z + lot.rect.depth) / CELL); j++) for (let i = Math.round(lot.rect.x / CELL); i < Math.round((lot.rect.x + lot.rect.width) / CELL); i++) {
      const cell = j * nav.cols + i;
      roofOf[cell] = nodes + roofCells.length; lotOf[cell] = index; roofCells.push(cell);
      positions.push([positions[cell][0], positions[cell][1], lot.height]);
    }
  });
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < nav.cols && j < nav.rows;
  for (const cell of roofCells) {
    const i = cell % nav.cols, j = Math.floor(cell / nav.cols), lot = lots[lotOf[cell]], node = roofOf[cell];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const next = (j + dz) * nav.cols + i + dx;
      if (inside(i + dx, j + dz) && lotOf[next] === lotOf[cell]) edges.push({ from: node, to: roofOf[next], dir: directionOf(dx, dz), cost: CELL * Math.hypot(dx, dz), kind: EDGE.walk });
    }
    // Stairs: the core's cells reach the roof above them.
    const use = nav.region[cell] ? regionOf[nav.region[cell] - 1] : null;
    if (use === "stair" && !blocked[cell]) {
      edges.push({ from: cell, to: node, dir: UP, cost: 2 + LAMBDA * lot.height, kind: EDGE.climb });
      edges.push({ from: node, to: cell, dir: DOWN, cost: 2 + lot.height, kind: EDGE.descend });
    }
    // Roof edges: jumps across an alley to a roof no higher than a storey up; falls to the street below.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const out = (j + dz) * nav.cols + i + dx;
      if (!inside(i + dx, j + dz) || lotOf[out] === lotOf[cell]) continue;
      if (lotOf[out] < 0 && !blocked[out] && !nav.region[out]) edges.push({ from: node, to: out, dir: DOWN, cost: 1 + lot.height, kind: EDGE.fall });
      for (let k = 1; k <= 6; k++) {
        const [a, b] = [i + dx * k, j + dz * k], across = b * nav.cols + a;
        if (!inside(a, b)) break;
        if (lotOf[across] >= 0 && lotOf[across] !== lotOf[cell]) { if (lots[lotOf[across]].height <= lot.height + 1.5) edges.push({ from: node, to: roofOf[across], dir: directionOf(dx, dz), cost: k * CELL + 2, kind: EDGE.jump }); break; }
        if (lotOf[across] >= 0) break;
      }
    }
  }
  const graph = buildGraph(positions, edges);
  const open = (cell: number) => !blocked[cell];
  const cellsIn = (rect: Rect, test: (cell: number) => boolean) => { const out: number[] = []; for (let j = Math.round(rect.z / CELL); j < Math.round((rect.z + rect.depth) / CELL); j++) for (let i = Math.round(rect.x / CELL); i < Math.round((rect.x + rect.width) / CELL); i++) if (test(j * nav.cols + i)) out.push(j * nav.cols + i); return out; };
  const outdoorCell = (cell: number) => open(cell) && !nav.region[cell] && lotOf[cell] < 0;
  const building = (side: "west" | "east") => lots.filter((lot) => lot.side === side).flatMap((lot) => cellsIn(lot.rect, (cell) => open(cell) && nav.region[cell] > 0));
  const spots: Record<Spot, number[]> = { avenue: cellsIn(streets.avenue, outdoorCell), plaza: cellsIn(streets.plaza, outdoorCell), north: cellsIn(streets.north, outdoorCell), west: building("west"), east: building("east"), rooftop: roofCells.map((cell) => roofOf[cell]) };
  return { id: input.id, kind: input.kind, seed: input.seed, width: W, depth: D, lots, streets, rooms, portals, nav,
    clutter: { outdoor, indoor, cells: blocked.reduce((sum, value) => sum + value, 0), attempts }, graph, roofCells: Int32Array.from(roofCells), spots };
}
