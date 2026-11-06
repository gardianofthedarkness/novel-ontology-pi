/**
 * Buildings generated around their circulation (stage 1: one floor and its
 * street). Connectivity is built in, not hoped for: a spine (a house's hall,
 * a school's corridor) is laid first, rooms are cut from the bands beside
 * it, and every room opens onto the spine (or, for a public room, onto a
 * neighbour as an extra loop). The stair core is reserved now, because it
 * couples floors. Randomness picks the spine, the room sizes, the door
 * positions and the loops, from a recorded seed.
 *
 * The result is checked again on the movement grid, the way a character
 * would walk it: cells of CELL metres, walls on cell edges, crossing between
 * rooms only through a portal, diagonal steps only where both axial routes
 * are free. For a body CELL wide that grid is exact. The certificate lists,
 * per room, the rooms a walker from the street passes on the way, through
 * public rooms only; a private room (a bedroom, a classroom) is a
 * destination, never a way through. A candidate that fails is redrawn from
 * the next independent stream, so an accepted plan is a draw from the
 * generator conditioned on passing, and a spec that cannot pass ends with a
 * diagnosed failure after a bounded number of attempts.
 *
 * Coordinates are metres: x across the footprint, z from the back wall to
 * the front wall, where the street runs.
 */
export const PLAN_VERSION = 1;
/** Metres per movement cell, and the body width the grid is exact for. */
export const CELL = 0.5;
/** Cells of yard around the footprint, and of street in front of the yard. */
const YARD = 4, STREET = 8;

export interface Rect { x: number; z: number; width: number; depth: number }
export type RoomUse = "hall" | "corridor" | "lobby" | "living" | "kitchen" | "dining" | "bedroom" | "bath" | "classroom" | "office" | "toilet" | "storage" | "stair" | "shop" | "ward" | "platform";
export interface Room { id: string; use: RoomUse; rect: Rect; transit: boolean }
/** An opening in a wall between two regions ("outside" is the yard and street). The wall runs along `axis` at `at`, open from `from` to `to`. */
export interface Portal { id: string; kind: "entrance" | "door" | "opening"; between: [string, string]; axis: "x" | "z"; at: number; from: number; to: number }
/** A reserved vertical core: its room on this floor, the floors it will serve (flights come in stage 2). */
export interface Core { id: string; kind: "stair"; room: string; floors: number[] }
export interface Floor { level: number; elevation: number; rooms: Room[]; portals: Portal[]; cores: Core[] }
export type Archetype = "hall" | "corridor";
export interface BuildingPlan { version: number; archetype: Archetype; seed: number; attempt: number; footprint: Rect; site: Rect; street: Rect; floors: Floor[] }

export interface PlanSpec {
  archetype: Archetype;
  width: number; depth: number; floors: number; floorHeight: number;
  /** Spine width and room length along the spine, as [min, max] metres; `band` is the least room depth beside the spine. */
  spine: [number, number]; slot: [number, number]; band: number;
  /** Uses by priority: the largest rooms take the first; spare rooms become `fill`. */
  program: RoomUse[]; fill: RoomUse;
  core: { width: number; depth: number };
  /** Chance of a second stair core; chance of an extra door between two neighbouring public rooms. */
  spareCore: number; loops: number;
  door: number; entrance: number; minDoor: number;
}

/** Whether a room may be walked through on the way somewhere else. */
export const TRANSIT: Record<RoomUse, boolean> = { hall: true, corridor: true, lobby: true, living: true, kitchen: true, dining: true, bedroom: false, bath: false, classroom: false, office: false, toilet: false, storage: false, stair: false, shop: false, ward: false, platform: true };

/** Stage 1 archetypes: a house around a central hall, a school floor along a corridor spine. Prototype controls, not architectural standards. */
export const PLAN_SPECS = {
  house: { archetype: "hall", width: 12, depth: 10, floors: 2, floorHeight: 3, spine: [1, 1.5], slot: [2.5, 4.5], band: 3, program: ["living", "kitchen", "bedroom", "bedroom", "bath"], fill: "storage",
    core: { width: 1.5, depth: 3 }, spareCore: 0, loops: 0.5, door: 1, entrance: 1, minDoor: 0.8 },
  school: { archetype: "corridor", width: 60, depth: 20, floors: 4, floorHeight: 3, spine: [2.5, 3.5], slot: [6, 9], band: 6, program: ["office", "toilet", "toilet"], fill: "classroom",
    core: { width: 3, depth: 6 }, spareCore: 0.5, loops: 0, door: 1, entrance: 2, minDoor: 0.8 },
  // Buildings of a district or a street; their footprints come from the lot.
  shop: { archetype: "hall", width: 10, depth: 14, floors: 3, floorHeight: 3, spine: [1, 1.5], slot: [2.5, 5], band: 3, program: ["shop", "shop", "storage"], fill: "shop",
    core: { width: 1.5, depth: 3 }, spareCore: 0, loops: 0, door: 1, entrance: 1, minDoor: 0.8 },
  office: { archetype: "corridor", width: 18, depth: 14, floors: 6, floorHeight: 3, spine: [2, 2.5], slot: [4, 6], band: 4, program: ["office", "toilet"], fill: "office",
    core: { width: 2.5, depth: 5 }, spareCore: 0, loops: 0, door: 1, entrance: 2, minDoor: 0.8 },
  hospital: { archetype: "corridor", width: 24, depth: 14, floors: 5, floorHeight: 3, spine: [2.5, 3], slot: [4, 6], band: 4, program: ["office", "toilet"], fill: "ward",
    core: { width: 2.5, depth: 5 }, spareCore: 0.5, loops: 0, door: 1, entrance: 2, minDoor: 0.8 },
  station: { archetype: "corridor", width: 24, depth: 14, floors: 2, floorHeight: 4, spine: [3, 4], slot: [5, 8], band: 4, program: ["office", "toilet"], fill: "platform",
    core: { width: 2.5, depth: 5 }, spareCore: 0.5, loops: 0, door: 1, entrance: 2, minDoor: 0.8 },
} satisfies Record<string, PlanSpec>;

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** An independent stream per (seed, attempt, …): FNV-1a over the parts. */
const stream = (...parts: (number | string)[]) => { let hash = 2166136261; for (const char of parts.join(":")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return mulberry32(hash >>> 0); };
const cells = (metres: number) => Math.round(metres / CELL);
const between = (rng: () => number, low: number, high: number) => low + Math.floor(rng() * (high - low + 1));

/** Cut `total` cells into pieces of `min`…`max` (one piece when it cannot). */
function split(rng: () => number, total: number, min: number, max: number): number[] {
  const pieces: number[] = [];
  let left = total;
  while (left > max && left - min >= min) { const piece = between(rng, min, Math.min(max, left - min)); pieces.push(piece); left -= piece; }
  return [...pieces, left];
}

interface Box { x: number; z: number; w: number; d: number }
interface Wall { axis: "x" | "z"; at: number; from: number; to: number }
/** A room's place beside the spine: its box, the wall it shares with the spine, and how far a door keeps from that wall's ends. */
interface Slot { box: Box; wall: Wall; front: boolean; margin: number }

/** A wall shared by two boxes that touch side by side, or null. */
function sharedWall(a: Box, b: Box): Wall | null {
  for (const [first, second] of [[a, b], [b, a]]) {
    if (first.x + first.w === second.x) { const from = Math.max(first.z, second.z), to = Math.min(first.z + first.d, second.z + second.d); if (to > from) return { axis: "z", at: second.x, from, to }; }
    if (first.z + first.d === second.z) { const from = Math.max(first.x, second.x), to = Math.min(first.x + first.w, second.x + second.w); if (to > from) return { axis: "x", at: second.z, from, to }; }
  }
  return null;
}

/** One floor's rooms and portals, in cells. */
function layout(spec: PlanSpec, rng: () => number) {
  const W = cells(spec.width), D = cells(spec.depth), band = cells(spec.band), [slotMin, slotMax] = [cells(spec.slot[0]), cells(spec.slot[1])];
  const spineWidth = between(rng, cells(spec.spine[0]), cells(spec.spine[1]));
  const rooms: { id: string; use: RoomUse; box: Box }[] = [], portals: { id: string; kind: Portal["kind"]; between: [string, string]; wall: Wall }[] = [], cores: Core[] = [];
  const counts = new Map<string, number>();
  const name = (use: RoomUse) => { counts.set(use, (counts.get(use) ?? 0) + 1); return `${use}_${counts.get(use)}`; };
  /** A door of `width` cells somewhere along a wall, `margin` cells clear of its ends (narrower when the wall is short: the certificate catches it). */
  const open = (kind: Portal["kind"], pair: [string, string], wall: Wall, width: number, margin = 1) => {
    const span = wall.to - wall.from - 2 * margin, size = Math.max(0, Math.min(width, span)), from = wall.from + margin + between(rng, 0, Math.max(0, span - size));
    portals.push({ id: `${kind}_${portals.length + 1}`, kind, between: pair, wall: { ...wall, from, to: from + size } });
  };
  const slots: Slot[] = [];
  let spine: Box, entrance: { wall: Wall; into: string; margin: number } | null = null;
  const spineId = spec.archetype === "hall" ? "hall_1" : "corridor_1";
  if (spec.archetype === "hall") {
    // The hall runs back from the front door; a short hall leaves one room across the back.
    const x0 = between(rng, band, W - spineWidth - band);
    let length = between(rng, Math.ceil(D * 0.6), D);
    if (D - length < slotMin) length = D;
    spine = { x: x0, z: D - length, w: spineWidth, d: length };
    for (const [x, w] of [[0, x0], [x0 + spineWidth, W - x0 - spineWidth]]) {
      let z = D - length;
      for (const piece of split(rng, length, slotMin, slotMax)) { slots.push({ box: { x, z, w, d: piece }, wall: { axis: "z", at: x === 0 ? x0 : x0 + spineWidth, from: z, to: z + piece }, front: false, margin: 1 }); z += piece; }
    }
    // The back room opens on the hall's end wall, which is only as wide as the hall.
    if (length < D) slots.push({ box: { x: 0, z: 0, w: W, d: D - length }, wall: { axis: "x", at: D - length, from: x0, to: x0 + spineWidth }, front: false, margin: 0 });
    entrance = { wall: { axis: "x", at: D, from: x0, to: x0 + spineWidth }, into: spineId, margin: 0 };
  } else {
    // The corridor runs the length of the floor; rooms line both sides.
    const z0 = between(rng, band, D - spineWidth - band);
    spine = { x: 0, z: z0, w: W, d: spineWidth };
    for (const [z, d, front] of [[0, z0, false], [z0 + spineWidth, D - z0 - spineWidth, true]] as const) {
      let x = 0;
      for (const piece of split(rng, W, slotMin, slotMax)) { slots.push({ box: { x, z, w: piece, d }, wall: { axis: "x", at: front ? z0 + spineWidth : z0, from: x, to: x + piece }, front, margin: 1 }); x += piece; }
    }
  }
  rooms.push({ id: spineId, use: spec.archetype === "hall" ? "hall" : "corridor", box: spine });
  const free = [...slots];
  const take = (slot: Slot) => free.splice(free.indexOf(slot), 1)[0];
  const area = (slot: Slot) => slot.box.w * slot.box.d;
  if (spec.archetype === "corridor") {
    // The lobby: a front room near the middle, from the street door to the corridor.
    const near = free.filter((slot) => slot.front).sort((a, b) => Math.abs(a.box.x + a.box.w / 2 - W / 2) - Math.abs(b.box.x + b.box.w / 2 - W / 2)).slice(0, 3);
    const lobby = take(near[between(rng, 0, near.length - 1)]), id = name("lobby");
    rooms.push({ id, use: "lobby", box: lobby.box });
    open("opening", [id, spineId], lobby.wall, lobby.wall.to - lobby.wall.from - 2);
    entrance = { wall: { axis: "x", at: D, from: lobby.box.x, to: lobby.box.x + lobby.box.w }, into: id, margin: 1 };
  }
  open("entrance", ["outside", entrance!.into], entrance!.wall, cells(spec.entrance), entrance!.margin);
  // Stair cores, reserved on the spine before rooms take the space.
  const [coreA, coreB] = [cells(spec.core.width), cells(spec.core.depth)];
  const fits = (slot: Slot) => (slot.box.w >= coreA && slot.box.d >= coreB) || (slot.box.w >= coreB && slot.box.d >= coreA);
  for (let index = 0, wanted = 1 + (rng() < spec.spareCore ? 1 : 0); index < wanted; index++) {
    const options = free.filter(fits);
    if (!options.length) break;
    const slot = take(options[between(rng, 0, options.length - 1)]), id = name("stair");
    rooms.push({ id, use: "stair", box: slot.box });
    cores.push({ id: `core_${index + 1}`, kind: "stair", room: id, floors: Array.from({ length: spec.floors }, (_, level) => level) });
    open("opening", [id, spineId], slot.wall, cells(spec.door) + 1, slot.margin);
  }
  // Rooms by priority, the largest first; each opens onto the spine.
  free.sort((a, b) => area(b) - area(a)).forEach((slot, index) => {
    const use = spec.program[index] ?? spec.fill, id = name(use);
    rooms.push({ id, use, box: slot.box });
    open("door", [id, spineId], slot.wall, cells(spec.door), slot.margin);
  });
  // Loops: a door between two neighbouring public rooms, now and then.
  const publicRooms = rooms.filter((room) => room.id !== spineId && TRANSIT[room.use]);
  for (const [index, a] of publicRooms.entries()) for (const b of publicRooms.slice(index + 1)) {
    const wall = sharedWall(a.box, b.box);
    if (wall && wall.to - wall.from >= cells(spec.door) + 2 && rng() < spec.loops) open("door", [a.id, b.id], wall, cells(spec.door));
  }
  return { rooms, portals, cores };
}

const metres = (box: Box): Rect => ({ x: box.x * CELL, z: box.z * CELL, width: box.w * CELL, depth: box.d * CELL });

/** The movement grid of one floor and its site: a region per cell, and which edges a walker may cross. */
export interface Navigation {
  cell: number; cols: number; rows: number;
  /** Metres of the grid's corner (cell 0, 0). */
  x0: number; z0: number;
  /** Region names by index: 0 is "outside" (yard and street). */
  regions: string[]; region: Int16Array;
  /** Per cell: 1 = the edge to the next cell in +x is open, 2 = the edge to the next cell in +z. */
  edges: Uint8Array;
  /** Cells on the street. */
  street: number[];
  /** Cells blocked by clutter (furniture, snow, a crowd): no one steps there. */
  blocked?: Uint8Array;
}

export function navigate(plan: BuildingPlan, level = 0): Navigation {
  return rasterize(plan.site, plan.floors[level].rooms, plan.floors[level].portals, plan.street);
}

/** The movement grid over `bounds` (metres): a region per cell ("outside" where no room is), walls between regions except where a portal joins exactly those two. */
export function rasterize(bounds: Rect, rooms: Room[], portals: Portal[], street: Rect): Navigation {
  const cols = cells(bounds.width), rows = cells(bounds.depth), regions = ["outside", ...rooms.map((room) => room.id)];
  const region = new Int16Array(cols * rows), edges = new Uint8Array(cols * rows);
  const column = (x: number) => cells(x - bounds.x), row = (z: number) => cells(z - bounds.z);
  rooms.forEach((room, index) => {
    for (let j = row(room.rect.z); j < row(room.rect.z + room.rect.depth); j++) for (let i = column(room.rect.x); i < column(room.rect.x + room.rect.width); i++) region[j * cols + i] = index + 1;
  });
  // Portals by the grid line they sit on: a wall along z sits on a column line, a wall along x on a row line.
  const portalsOn = new Map<string, { from: number; to: number; between: [string, string] }[]>();
  for (const portal of portals) {
    const key = `${portal.axis}:${portal.axis === "z" ? column(portal.at) : row(portal.at)}`, along = portal.axis === "z" ? row : column;
    portalsOn.set(key, [...portalsOn.get(key) ?? [], { from: along(portal.from), to: along(portal.to), between: portal.between }]);
  }
  const crossable = (a: number, b: number, axis: "x" | "z", at: number, along: number) => a === b || (portalsOn.get(`${axis}:${at}`) ?? []).some((portal) =>
    portal.from <= along && along + 1 <= portal.to && ((portal.between[0] === regions[a] && portal.between[1] === regions[b]) || (portal.between[0] === regions[b] && portal.between[1] === regions[a])));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cell = j * cols + i;
    if (i + 1 < cols && crossable(region[cell], region[cell + 1], "z", i + 1, j)) edges[cell] |= 1;
    if (j + 1 < rows && crossable(region[cell], region[cell + cols], "x", j + 1, i)) edges[cell] |= 2;
  }
  const onStreet: number[] = [];
  for (let j = row(street.z); j < row(street.z + street.depth); j++) for (let i = column(street.x); i < column(street.x + street.width); i++) if (!region[j * cols + i]) onStreet.push(j * cols + i);
  return { cell: CELL, cols, rows, x0: bounds.x, z0: bounds.z, regions, region, edges, street: onStreet };
}

/** Cells one step away: 8 directions, a diagonal only where both axial routes around it are open. */
export function stepsFrom(nav: Navigation, cell: number): number[] {
  const i = cell % nav.cols, j = Math.floor(cell / nav.cols), out: number[] = [];
  const free = (target: number) => !nav.blocked?.[target];
  const axial = (from: number, dx: number, dz: number) => {
    const x = from % nav.cols, z = Math.floor(from / nav.cols);
    if (dx === 1) return x + 1 < nav.cols && (nav.edges[from] & 1) > 0 && free(from + 1);
    if (dx === -1) return x > 0 && (nav.edges[from - 1] & 1) > 0 && free(from - 1);
    if (dz === 1) return z + 1 < nav.rows && (nav.edges[from] & 2) > 0 && free(from + nav.cols);
    return z > 0 && (nav.edges[from - nav.cols] & 2) > 0 && free(from - nav.cols);
  };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (axial(cell, dx, dz)) out.push(cell + dx + dz * nav.cols);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (i + dx < 0 || i + dx >= nav.cols || j + dz < 0 || j + dz >= nav.rows) continue;
    const viaX = cell + dx, viaZ = cell + dz * nav.cols;
    if (axial(cell, dx, 0) && axial(viaX, 0, dz) && axial(cell, 0, dz) && axial(viaZ, dx, 0)) out.push(cell + dx + dz * nav.cols);
  }
  return out;
}

export type PlanFailure = "core_does_not_fit" | "no_clear_door" | "unreachable_target";
export interface Certificate {
  ok: boolean;
  /** Per room: the regions a walker from the street passes, ending in the room (null: unreachable through public rooms). */
  access: Record<string, string[] | null>;
  failures: { code: PlanFailure; room?: string; detail: string }[];
}

/** Check a floor on its movement grid: the cores it needs, clear doors, and every room reachable from the street through public rooms only. */
export function certify(plan: BuildingPlan, nav: Navigation, spec: Pick<PlanSpec, "floors" | "minDoor">, level = 0): Certificate {
  const floor = plan.floors[level], failures: Certificate["failures"] = [], access: Certificate["access"] = {};
  if (spec.floors > 1 && !floor.cores.length) failures.push({ code: "core_does_not_fit", detail: `${spec.floors} floors need a stair core, and none fits beside the spine.` });
  for (const portal of floor.portals) if (portal.to - portal.from < spec.minDoor - 1e-9) failures.push({ code: "no_clear_door", room: portal.between.find((id) => id !== "outside"), detail: `${portal.id} is ${portal.to - portal.from} m wide, under ${spec.minDoor} m.` });
  const passable = new Set([0, ...floor.rooms.flatMap((room, index) => room.transit ? [index + 1] : [])]);
  for (const [index, room] of floor.rooms.entries()) {
    const target = index + 1, from = new Int32Array(nav.cols * nav.rows).fill(-2), queue = nav.street.filter((cell) => !nav.blocked?.[cell]);
    for (const cell of queue) from[cell] = -1;
    let found = -1;
    for (let head = 0; head < queue.length && found < 0; head++) for (const next of stepsFrom(nav, queue[head])) {
      if (from[next] !== -2 || !(passable.has(nav.region[next]) || nav.region[next] === target)) continue;
      from[next] = queue[head];
      if (nav.region[next] === target) { found = next; break; }
      queue.push(next);
    }
    if (found < 0) { access[room.id] = null; failures.push({ code: "unreachable_target", room: room.id, detail: `${room.id} cannot be reached from the street through public rooms.` }); continue; }
    const via: string[] = [];
    for (let cell = found; cell >= 0; cell = from[cell]) { const name = nav.regions[nav.region[cell]]; if (via[0] !== name) via.unshift(name); }
    access[room.id] = via;
  }
  return { ok: failures.length === 0, access, failures };
}

/**
 * A building's plan from its spec and seed: candidates drawn from independent
 * streams until one passes its certificate, at most `attempts`; the last
 * candidate and its failures otherwise.
 */
export function generateBuilding(spec: PlanSpec, seed: number, attempts = 12): { plan: BuildingPlan; nav: Navigation; certificate: Certificate; attempts: number } {
  let last: { plan: BuildingPlan; nav: Navigation; certificate: Certificate; attempts: number } | null = null;
  const W = cells(spec.width), D = cells(spec.depth);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { rooms, portals, cores } = layout(spec, stream(PLAN_VERSION, seed, attempt));
    const floor: Floor = { level: 0, elevation: 0, cores,
      rooms: rooms.map((room) => ({ id: room.id, use: room.use, rect: metres(room.box), transit: TRANSIT[room.use] })),
      portals: portals.map((portal) => ({ id: portal.id, kind: portal.kind, between: portal.between, axis: portal.wall.axis, at: portal.wall.at * CELL, from: portal.wall.from * CELL, to: portal.wall.to * CELL })) };
    const plan: BuildingPlan = { version: PLAN_VERSION, archetype: spec.archetype, seed, attempt, footprint: metres({ x: 0, z: 0, w: W, d: D }),
      site: metres({ x: -YARD, z: -YARD, w: W + 2 * YARD, d: D + 2 * YARD + STREET }), street: metres({ x: -YARD, z: D + YARD, w: W + 2 * YARD, d: STREET }), floors: [floor] };
    const nav = navigate(plan);
    last = { plan, nav, certificate: certify(plan, nav, spec), attempts: attempt + 1 };
    if (last.certificate.ok) break;
  }
  return last!;
}

export const USE_COLOR: Record<RoomUse, string> = { hall: "#1d4a5c", corridor: "#1d4a5c", lobby: "#24607a", living: "#2b5f4a", kitchen: "#5c5326", dining: "#5c4a26", bedroom: "#4a3460", bath: "#2d4566", classroom: "#3d3a66", office: "#5a3a3a", toilet: "#2d4566", storage: "#333b44", stair: "#5f3d1d", shop: "#4f4a24", ward: "#34485e", platform: "#24607a" };

/** The plan as an SVG drawing: street, rooms by use, walls from the movement grid (so doors are the gaps), stair cores hatched, the entrance in amber. */
export function planSvg(plan: BuildingPlan, nav: Navigation, options: { title?: string; maxWidth?: number } = {}): string {
  const scale = Math.min(36, (options.maxWidth ?? 900) / (nav.cols * CELL)), px = (x: number) => ((x - nav.x0) * scale).toFixed(1), pz = (z: number) => ((z - nav.z0) * scale).toFixed(1);
  const width = nav.cols * CELL * scale, height = nav.rows * CELL * scale + 22, out: string[] = [];
  const floor = plan.floors[0], font = Math.max(8, Math.min(13, scale * 0.42));
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -22 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}" font-family="system-ui, sans-serif">`);
  const hatch = `hatch-${plan.archetype}-${plan.seed}-${plan.attempt}`;
  out.push(`<defs><pattern id="${hatch}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#c98a3c" stroke-width="1.5"/></pattern></defs>`);
  out.push(`<rect x="0" y="-22" width="${width}" height="${height}" fill="#060c12"/><rect x="0" y="0" width="${width}" height="${nav.rows * CELL * scale}" fill="#0b1712"/>`);
  out.push(`<rect x="${px(plan.street.x)}" y="${pz(plan.street.z)}" width="${(plan.street.width * scale).toFixed(1)}" height="${(plan.street.depth * scale).toFixed(1)}" fill="#1b2530"/><text x="${(width / 2).toFixed(0)}" y="${(Number(pz(plan.street.z)) + plan.street.depth * scale / 2 + font / 3).toFixed(0)}" fill="#6b7d8c" font-size="${font}" text-anchor="middle">street</text>`);
  for (const room of floor.rooms) {
    const [x, z, w, d] = [px(room.rect.x), pz(room.rect.z), (room.rect.width * scale).toFixed(1), (room.rect.depth * scale).toFixed(1)];
    out.push(`<rect x="${x}" y="${z}" width="${w}" height="${d}" fill="${USE_COLOR[room.use]}" opacity="0.85"/>`);
    if (room.use === "stair") out.push(`<rect x="${x}" y="${z}" width="${w}" height="${d}" fill="url(#${hatch})" opacity="0.7"/>`);
    out.push(`<text x="${(Number(x) + Number(w) / 2).toFixed(1)}" y="${(Number(z) + Number(d) / 2 + font / 3).toFixed(1)}" fill="#d9e3ea" font-size="${font}" text-anchor="middle">${room.use}</text>`);
  }
  // Walls: runs of closed edges between two different regions.
  const segment = (x1: number, z1: number, x2: number, z2: number) => out.push(`<line x1="${px(x1)}" y1="${pz(z1)}" x2="${px(x2)}" y2="${pz(z2)}" stroke="#7ce6ff" stroke-width="2" stroke-linecap="square"/>`);
  const closedX = (i: number, j: number) => i + 1 < nav.cols && nav.region[j * nav.cols + i] !== nav.region[j * nav.cols + i + 1] && !(nav.edges[j * nav.cols + i] & 1);
  const closedZ = (i: number, j: number) => j + 1 < nav.rows && nav.region[j * nav.cols + i] !== nav.region[(j + 1) * nav.cols + i] && !(nav.edges[j * nav.cols + i] & 2);
  for (let i = 0; i < nav.cols; i++) for (let j = 0; j < nav.rows; j++) if (closedX(i, j) && !(j > 0 && closedX(i, j - 1))) {
    let end = j;
    while (end + 1 < nav.rows && closedX(i, end + 1)) end++;
    segment(nav.x0 + (i + 1) * CELL, nav.z0 + j * CELL, nav.x0 + (i + 1) * CELL, nav.z0 + (end + 1) * CELL);
  }
  for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) if (closedZ(i, j) && !(i > 0 && closedZ(i - 1, j))) {
    let end = i;
    while (end + 1 < nav.cols && closedZ(end + 1, j)) end++;
    segment(nav.x0 + i * CELL, nav.z0 + (j + 1) * CELL, nav.x0 + (end + 1) * CELL, nav.z0 + (j + 1) * CELL);
  }
  for (const portal of floor.portals.filter((entry) => entry.kind === "entrance")) {
    const [x1, z1, x2, z2] = portal.axis === "x" ? [portal.from, portal.at, portal.to, portal.at] : [portal.at, portal.from, portal.at, portal.to];
    out.push(`<line x1="${px(x1)}" y1="${pz(z1)}" x2="${px(x2)}" y2="${pz(z2)}" stroke="#ffb547" stroke-width="5"/>`);
  }
  out.push(`<text x="6" y="-7" fill="#9fb4c3" font-size="12">${options.title ?? `${plan.archetype} · seed ${plan.seed}${plan.attempt ? ` (attempt ${plan.attempt + 1})` : ""}`}</text></svg>`);
  return out.join("");
}
