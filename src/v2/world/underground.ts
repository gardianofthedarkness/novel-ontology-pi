import { LANDSCAPES, LAYERS, LAYER_ROOM, floorOf, formOf, layerBuildings, roomUnder, sunkStreet, underground, type Landscape, type Layer, type Patch } from "./landscape.js";
import { stageStream } from "./stream.js";

/**
 * The underground as halls in the ground (docs/underground-design.md): voids carved in soil or rock that the ground around
 * them holds up, not buildings. What is here: the ground's bands, the halls' shapes, their generation (per landscape, and
 * the city's subway on its own logic), the two overlapping depth intervals Jev picks from and how a box finds its hall,
 * and the collapse after a blast (a confined blast, the roof-span test, the cave-in to a dome, a choke or a dent).
 * Pure: metres and plain data. The world (apps/playground/src/data/world.ts) puts the halls on its 2 m grid and walks them.
 */
export type Point = [number, number];
export type HallKind = "tunnel" | "station" | "corridor" | "mall" | "tank" | "channel" | "lab" | "military" | "quantum" | "parking" | "utility" | "shelter" | "basement" | "deep" | "deck" | "orbit";
/** A rotated box (centre, size, turn about y) and a bore (a segment and its width), in metres. */
export interface HallBox { x: number; z: number; w: number; d: number; angle: number }
export interface Bore { a: Point; b: Point; width: number }
/**
 * A hall: its plan (boxes and bores), its floor's depth and its height (metres, depth positive down), its pillar spacing (0:
 * none), whether it is lined, and the ways out of it it is generated with: `up` points where stairs, a lift or a ladder
 * reach the surface (a station's ends, a shaft), and `down` points where it meets the hall below (a tank's channel).
 */
/**
 * `street`: a floor of its own with its buildings standing on it, open up to its ceiling (`height`): a street laid under the
 * street (terrain-levels §8), a deep area's, a deck's, an orbit's. `virtual`: a layer whose level is not a number (§3.5).
 */
/**
 * `layer`: the layer a floor of another layer belongs to (terrain-levels §3.5): the deep underground's and the orbit's are
 * `virtual` (their level is not a number); the atmosphere's is a deck, its `depth` below 0 (a height). `parts`: the patches
 * whose floor it is (one floor holds every patch of its layer in a landscape).
 */
export interface Hall { id: string; kind: HallKind; depth: number; height: number; boxes: HallBox[]; bores: Bore[]; pillars: number; lined: boolean; up: Point[]; label?: string; street?: boolean; virtual?: boolean; layer?: Layer; parts?: string[] }

/** The ground in three bands by depth (metres): how wide an opening stands unsupported, what breaks it, how it arches and bulks when it falls. */
export interface Band { name: "soil" | "weathered" | "hard"; to: number; span: number; bond: number; arch: number; bulk: number }
export const BANDS: Band[] = [
  { name: "soil", to: 12, span: 0, bond: 3, arch: 0.5, bulk: 1.3 },
  { name: "weathered", to: 40, span: 8, bond: 6, arch: 1, bulk: 1.5 },
  { name: "hard", to: Infinity, span: 20, bond: 12, arch: 1, bulk: 1.5 },
];
export const bandAt = (depth: number) => BANDS.find((band) => depth < band.to) ?? BANDS[BANDS.length - 1];
/** A reinforced lining: the span it adds while unbroken, and what breaks it; a pillar's bond. */
export const LINING = { span: 12, bond: 4 }, PILLAR_BOND = 5;

/**
 * What Jev picks underground (docs/underground-design.md §6.1): just under the street and deep underground, two depth
 * intervals overlapping between 20 and 25 m (a hall belongs to each its span reaches); and the subway, a choice of its own.
 * The subway runs on its own logic, under buildings, so as part of the shallow interval it made a box find one hall only
 * 87–92% of the time (six generated cities); on its own, 99%, and the shallow interval without it 94–96%.
 */
export const INTERVALS = { shallow: [0, 25], subway: [5, 20], deep: [20, 110] } as const;
export type Interval = keyof typeof INTERVALS;
const SUBWAY_KINDS = new Set(["station", "tunnel", "corridor"]);
// A floor of another layer (§3.5) is in neither interval: what Jev picks underground is the shallow layer's.
export const intervalsOf = (hall: Pick<Hall, "depth" | "height"> & { kind?: string; layer?: Layer }): Interval[] => hall.layer ? [] : (hall.kind && SUBWAY_KINDS.has(hall.kind) ? ["subway"] : (["shallow", "deep"] as Interval[]).filter((key) => hall.depth - hall.height <= INTERVALS[key][1] && hall.depth >= INTERVALS[key][0]));
export const HALL_LABEL: Record<HallKind, string> = { tunnel: "a subway tunnel", station: "a subway station", corridor: "a subway passage", mall: "an underground mall", tank: "a storm-water tank", channel: "a storm-water channel", lab: "an experiment lab", military: "a military bunker", quantum: "a quantum research facility", parking: "an underground car park", utility: "a utility tunnel", shelter: "a shelter", basement: "a basement" , deep: "the deep underground", deck: "a deck in the air", orbit: "a floor in orbit" };
/**
 * The city's common underground spaces (docs/v2/world-engine-v2.md §2.0.17; the compatibility page) and the street kinds
 * each usually lies under ("*": any): transport (the subway's tunnels, stations and passages), commerce (an underground
 * shopping street, under a road or a station's plaza), parking, utilities (a utility tunnel, the storm water), a civil
 * defence shelter (often a car park too), a building's basement, and the deep facilities. A first map, for reference and
 * for what a part below the street becomes; each level's to be worked out later.
 */
export const LIES_UNDER: Record<HallKind, string[]> = {
  tunnel: ["*"], station: ["station", "avenue", "square", "centre"], corridor: ["avenue", "station", "square", "shopping", "centre"],
  mall: ["shopping", "centre", "station", "avenue", "square"], parking: ["centre", "avenue", "square", "park", "residential", "stadium"],
  utility: ["avenue", "shopping", "alley", "residential"], tank: ["park", "stadium", "square"], channel: ["*"],
  shelter: ["park", "square", "centre", "residential"], basement: ["centre", "avenue", "shopping", "station", "residential"],
  lab: ["avenue", "centre", "park", "square"], military: ["park", "square", "stadium"], quantum: ["avenue", "centre", "park"],
  // The other layers' floors lie under no street: they are layers of their own (terrain-levels §3.5).
  deep: [], deck: [], orbit: [],
};
/** How tall each kind of hall is made for a part below the street (metres from its floor). */
const HALL_HEIGHT: Partial<Record<HallKind, number>> = { corridor: 4, mall: 5, station: 7, tunnel: 6, parking: 3, utility: 3, shelter: 4, basement: 4, channel: 6, tank: 12, lab: 6, military: 6, quantum: 8 };

const round = (value: number) => Math.round(value * 10) / 10;
const turn = (angle: number, [u, v]: Point): Point => [u * Math.cos(angle) - v * Math.sin(angle), u * Math.sin(angle) + v * Math.cos(angle)];
const toSegment = ([x, z]: Point, a: Point, b: Point) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
/** Whether a point lies in a hall's plan. */
export function inHall(hall: Pick<Hall, "boxes" | "bores">, p: Point): boolean {
  for (const box of hall.boxes) { const [u, v] = turn(-box.angle, [p[0] - box.x, p[1] - box.z]); if (Math.abs(u) <= box.w / 2 && Math.abs(v) <= box.d / 2) return true; }
  return hall.bores.some((bore) => toSegment(p, bore.a, bore.b) <= bore.width / 2);
}
/** Whether a point of a hall stands on a pillar: a 2 m square on the hall's own grid of `pillars` metres, never at its edge. */
export function pillarAt(hall: Hall, p: Point): boolean {
  if (!hall.pillars) return false;
  for (const box of hall.boxes) {
    const [u, v] = turn(-box.angle, [p[0] - box.x, p[1] - box.z]), half = [box.w / 2, box.d / 2];
    if (Math.abs(u) > half[0] || Math.abs(v) > half[1]) continue;
    const grid = (value: number, extent: number) => { const from = value + extent, nearest = Math.round(from / hall.pillars) * hall.pillars; return Math.abs(from - nearest) < 1 && nearest > 2 && nearest < 2 * extent - 2; };
    return grid(u, half[0]) && grid(v, half[1]);
  }
  return false;
}
/** A hall's plan bounds (metres). */
export function boundsOf(hall: Pick<Hall, "boxes" | "bores">) {
  const xs: number[] = [], zs: number[] = [];
  for (const box of hall.boxes) for (const corner of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as Point[]) { const [u, v] = turn(box.angle, [corner[0] * box.w / 2, corner[1] * box.d / 2]); xs.push(box.x + u); zs.push(box.z + v); }
  for (const bore of hall.bores) for (const end of [bore.a, bore.b]) { xs.push(end[0] - bore.width / 2, end[0] + bore.width / 2); zs.push(end[1] - bore.width / 2, end[1] + bore.width / 2); }
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

/**
 * What a landscape has under it, generated from its seed (its frame, metres): under a commercial quarter or a skyscraper
 * core, an underground mall under its main street (the boulevard's line); under its largest modern patch of 150 m or more,
 * a storm-water system: a pillared tank 40 m down and two or three channels 50 m down, out to the patch's edge, each with a
 * shaft up at its end; and deep facilities 90 m down (labs, quantum research, military bunkers: one plus one per 100 m of
 * radius under a skyscraper core, two under an industrial area, one under a harbour), clear of the storm water by 20 m.
 * Ancient ground has none. Basements are the buildings' own (world.ts); the subway is the city's (`subwayOf`).
 */
export function hallsOf(landscape: Landscape): Hall[] {
  // A patch of another layer has nothing under it: its layer's floor is its ground (layerFloors).
  const halls: Hall[] = layerFloors(landscape), modern = landscape.patches.filter((patch) => !patch.plane && LANDSCAPES[patch.type].era === "modern");
  // A part that lies under the street (terrain spawning: its median below 0): a hall that deep over its ground, a passage
  // along a linear part (a box patch: a street), a mall under any other; stairs up at its ends. The surface over it stays as
  // it was: it lies in another layer (docs/v2/terrain-levels.md §3.3).
  for (const patch of modern.filter(underground)) {
    const depth = Math.max(4, -(patch.median ?? 0)), linear = patch.shape.family === "box", w = round(1.8 * patch.R), d = round(Math.max(8, linear ? 1.8 * patch.R * (patch.shape.aspect ?? 0.3) : 1.2 * patch.R));
    const kind = (patch.hall && patch.hall in LIES_UNDER ? patch.hall : linear ? "corridor" : "mall") as HallKind;
    // A street laid underground, built out (landscape.ts sunkForm): the hall is its open ground, the whole street wide, open up
    // to the ground skin; its buildings stand on its floor and hold the ground up (no pillars).
    // Its box holds every building of its form with a lane of 4 m round them (sized by the area's radius, 49 of W12's 145
    // stood outside it, their doors on no floor).
    if (sunkStreet(patch)) {
      const angle = patch.shape.turn, corners = formOf(patch).buildings.flatMap((b) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => { const [dx, dz] = turn(b.angle, [(su * b.w) / 2, (sv * b.d) / 2]); return turn(-angle, [b.x + dx - patch.x, b.z + dz - patch.z]); }));
      const us = corners.map(([u]) => u), vs = corners.map(([, v]) => v), lane = 4;
      const [u0, u1, v0, v1] = corners.length ? [Math.min(...us) - lane, Math.max(...us) + lane, Math.min(...vs) - lane, Math.max(...vs) + lane] : [-patch.R, patch.R, -patch.R, patch.R];
      const [cx, cz] = turn(angle, [(u0 + u1) / 2, (v0 + v1) / 2]), sw = round(u1 - u0), sd = round(Math.max(8, v1 - v0)), x = round(patch.x + cx), z = round(patch.z + cz);
      halls.push({ id: `${patch.id}:under`, kind, depth, height: Math.max(HALL_HEIGHT[kind] ?? 4, round(roomUnder(patch))), boxes: [{ x, z, w: sw, d: sd, angle }], bores: [], pillars: 0, lined: true, up: ends(x, z, sw, angle), street: true });
      continue;
    }
    halls.push({ id: `${patch.id}:under`, kind, depth, height: HALL_HEIGHT[kind] ?? 4, boxes: [{ x: round(patch.x), z: round(patch.z), w, d, angle: patch.shape.turn }], bores: [], pillars: ["corridor", "utility", "tunnel"].includes(kind) ? 0 : 8, lined: true, up: ends(patch.x, patch.z, w, patch.shape.turn) });
  }
  for (const patch of modern) {
    if (!["commercial", "skyscrapers", "centre", "station", "shopping"].includes(patch.type) || underground(patch)) continue;
    const rng = stageStream(landscape.seed, "mall", patch.id), length = 150 + 250 * rng(), angle = patch.shape.turn;
    halls.push({ id: `${patch.id}:mall`, kind: "mall", depth: 7, height: 4.5, boxes: [{ x: round(patch.x), z: round(patch.z), w: round(Math.min(length, 1.6 * patch.R)), d: 20, angle }], bores: [], pillars: 8, lined: true, up: ends(patch.x, patch.z, Math.min(length, 1.6 * patch.R), angle) });
  }
  const storm = [...modern].sort((a, b) => b.R - a.R)[0];
  if (storm && storm.R >= 150) {
    const rng = stageStream(landscape.seed, "storm", storm.id), angle = rng() * Math.PI * 2, at: Point = [storm.x + Math.cos(angle) * 0.15 * storm.R, storm.z + Math.sin(angle) * 0.15 * storm.R];
    halls.push({ id: `${storm.id}:tank`, kind: "tank", depth: 40, height: 18, boxes: [{ x: round(at[0]), z: round(at[1]), w: 100, d: 70, angle: round(angle) }], bores: [], pillars: 10, lined: true, up: [[round(at[0]), round(at[1])]] });
    const count = 2 + (rng() < 0.5 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      // From just inside the tank's edge (where a ladder joins them), out to the patch's edge.
      const way = angle + (n / count) * Math.PI * 2 + (rng() - 0.5) * 0.6, u: Point = [Math.cos(way), Math.sin(way)], tank = halls.find((hall) => hall.kind === "tank")!.boxes[0];
      let edge = 0;
      while (inHall({ boxes: [tank], bores: [] }, [at[0] + u[0] * (edge + 1), at[1] + u[1] * (edge + 1)])) edge++;
      const start: Point = [round(at[0] + u[0] * Math.max(0, edge - 2)), round(at[1] + u[1] * Math.max(0, edge - 2))], end: Point = [round(at[0] + u[0] * 0.9 * storm.R), round(at[1] + u[1] * 0.9 * storm.R)];
      halls.push({ id: `${storm.id}:channel${n}`, kind: "channel", depth: 50, height: 10, boxes: [], bores: [{ a: start, b: end, width: 10 }], pillars: 0, lined: false, up: [end] });
    }
  }
  // Deep facilities keep 20 m clear of the storm water and of one another, so a box deep down finds one hall.
  const water = halls.filter((hall) => hall.kind === "tank" || hall.kind === "channel");
  const clear = (hall: Hall) => { const b = boundsOf(hall); return !water.some((other) => { const o = boundsOf(other); return b.x0 - 20 < o.x1 && o.x0 < b.x1 + 20 && b.z0 - 20 < o.z1 && o.z0 < b.z1 + 20 && [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]].some((p) => inHall(widen(other, 20), p as Point)); }); };
  for (const patch of modern) {
    const kinds: HallKind[] = patch.type === "skyscrapers" ? ["lab", "quantum", "military"] : patch.type === "industrial" ? ["lab", "military"] : patch.type === "harbour" ? ["military"] : [];
    const count = patch.type === "skyscrapers" ? 1 + Math.floor(patch.R / 100) : patch.type === "industrial" ? 2 : kinds.length;
    const rng = stageStream(landscape.seed, "deep", patch.id);
    for (let n = 0; n < count; n++) {
      const kind = kinds[Math.floor(rng() * kinds.length)], w = round(30 + 30 * rng()), d = round(24 + 24 * rng());
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = rng() * Math.PI * 2, distance = (0.25 + 0.4 * rng()) * patch.R;
        const hall: Hall = { id: `${patch.id}:${kind}${n}`, kind, depth: 90, height: 10, boxes: [{ x: round(patch.x + Math.cos(angle) * distance), z: round(patch.z + Math.sin(angle) * distance), w, d, angle: 0 }], bores: [], pillars: Math.min(w, d) > 20 ? 12 : 0, lined: false, up: [] };
        hall.up = [[hall.boxes[0].x, hall.boxes[0].z]];
        if (clear(hall)) { halls.push(hall); water.push(hall); break; }
      }
    }
  }
  return halls;
}
/** The kind of floor each other layer has (§3.5). */
export const LAYER_KIND: Record<Layer, HallKind> = { deep: "deep", air: "deck", space: "orbit" };
/**
 * The floors of a landscape's patches in the other layers (docs/v2/terrain-levels.md §3.5): one for each layer, a hall at the
 * layer's floor, open LAYER_ROOM metres up, holding its patches' circles and every building lifted onto it with a lane of 4 m
 * round them (landscape.ts layerBuildings); no pillars. The deep's and the orbit's are virtual. No stairs of its own: the
 * world joins every floor to the ground on its 40 m squares (world.ts ways, §3.4).
 */
export function layerFloors(landscape: Landscape): Hall[] {
  if (!landscape.patches.some((patch) => patch.plane)) return [];
  const lifted = layerBuildings(landscape);
  return LAYERS.flatMap((plane) => {
    const group = landscape.patches.filter((patch) => patch.plane === plane);
    if (!group.length) return [];
    const xs: number[] = [], zs: number[] = [], lane = 4;
    for (const patch of group) xs.push(patch.x - patch.R, patch.x + patch.R), zs.push(patch.z - patch.R, patch.z + patch.R);
    for (const b of lifted.filter((entry) => entry.plane === plane)) { const r = Math.hypot(b.w, b.d) / 2 + lane; xs.push(b.x - r, b.x + r); zs.push(b.z - r, b.z + r); }
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    return [{ id: `${group[0].id}:under`, kind: LAYER_KIND[plane], depth: -floorOf(group, plane), height: LAYER_ROOM, boxes: [{ x: round((x0 + x1) / 2), z: round((z0 + z1) / 2), w: round(x1 - x0), d: round(z1 - z0), angle: 0 }], bores: [], pillars: 0, lined: true, up: [], street: true, virtual: plane !== "air", layer: plane, parts: group.map((patch) => patch.id) }];
  });
}
const ends = (x: number, z: number, length: number, angle: number): Point[] => [[round(x - Math.cos(angle) * (length / 2 - 4)), round(z - Math.sin(angle) * (length / 2 - 4))], [round(x + Math.cos(angle) * (length / 2 - 4)), round(z + Math.sin(angle) * (length / 2 - 4))]];
const widen = (hall: Hall, by: number): Hall => ({ ...hall, boxes: hall.boxes.map((box) => ({ ...box, w: box.w + 2 * by, d: box.d + 2 * by })), bores: hall.bores.map((bore) => ({ ...bore, width: bore.width + 2 * by })) });

/**
 * The city's subway, on its own logic (not the streets'): lines through the stops it must serve (the centres of the city's
 * districts and areas, and any station the story names), ordered as a path from the stop farthest out, split into two
 * lines when there are more than five stops; stations at the stops and every 600 m between, each a platform 120 × 20 m with
 * a concourse 30 m long at each end on one level, 12 m down; twin-bore tunnels 12 m wide between them. With fewer than two
 * stops, one line straight across the city through its middle. Each station has four entrances, two at each end, one on
 * either side: a passage 5 m wide from the station's end out 30 m to the side, and stairs up from its far end to the street
 * (the passage's `up`). The world joins the stairs to the pavement nearest them.
 */
export function subwayOf(stops: { id: string; x: number; z: number }[], seed: string, radius: number): Hall[] {
  const rng = stageStream(seed, "subway");
  let points = stops.map((stop) => [stop.x, stop.z] as Point);
  if (points.length < 2) { const angle = rng() * Math.PI, middle = points[0] ?? [0, 0]; points = [[middle[0] - Math.cos(angle) * radius * 0.8, middle[1] - Math.sin(angle) * radius * 0.8], [middle[0] + Math.cos(angle) * radius * 0.8, middle[1] + Math.sin(angle) * radius * 0.8]]; }
  const centre: Point = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  const order: Point[] = [], left = [...points];
  let at = left.splice(left.reduce((best, p, index) => (Math.hypot(p[0] - centre[0], p[1] - centre[1]) > Math.hypot(left[best][0] - centre[0], left[best][1] - centre[1]) ? index : best), 0), 1)[0];
  order.push(at);
  while (left.length) { const index = left.reduce((best, p, n) => (Math.hypot(p[0] - at[0], p[1] - at[1]) < Math.hypot(left[best][0] - at[0], left[best][1] - at[1]) ? n : best), 0); at = left.splice(index, 1)[0]; order.push(at); }
  const lines = order.length > 5 ? [order.filter((_, n) => n % 2 === 0), order.filter((_, n) => n % 2 === 1)] : [order];
  const halls: Hall[] = [];
  lines.forEach((line, l) => {
    if (line.length < 2) return;
    const stations: Point[] = [];
    for (let n = 0; n < line.length - 1; n++) {
      const [a, b] = [line[n], line[n + 1]], length = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(length / 600));
      for (let s = 0; s < steps; s++) stations.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
    }
    stations.push(line[line.length - 1]);
    stations.forEach((p, n) => {
      const next = stations[Math.min(n + 1, stations.length - 1)], prev = stations[Math.max(n - 1, 0)], angle = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
      // Its entrances: from each end, a passage out to either side, and stairs up at the passage's far end.
      const entrances: Point[] = [];
      for (const [end, along] of ends(p[0], p[1], 180, angle).map((end, e) => [end, e ? 1 : -1] as const)) for (const side of [-1, 1]) {
        const out: Point = [round(end[0] + Math.cos(angle) * along * 6 - Math.sin(angle) * side * 30), round(end[1] + Math.sin(angle) * along * 6 + Math.cos(angle) * side * 30)];
        halls.push({ id: `subway${l}:station${n}:entrance${entrances.length}`, kind: "corridor", depth: 12, height: 3.5, boxes: [], bores: [{ a: end, b: out, width: 5 }], pillars: 0, lined: true, up: [out] });
        entrances.push(out);
      }
      halls.push({ id: `subway${l}:station${n}`, kind: "station", depth: 12, height: 7, boxes: [{ x: round(p[0]), z: round(p[1]), w: 180, d: 20, angle: round(angle) }], bores: [], pillars: 8, lined: true, up: entrances });
      // The tunnel to the next station runs from this station's end to that one's (so a tunnel never lies under a station).
      if (n < stations.length - 1) { const along = Math.atan2(next[1] - p[1], next[0] - p[0]), u: Point = [Math.cos(along), Math.sin(along)], length = Math.hypot(next[0] - p[0], next[1] - p[1]); if (length > 190) halls.push({ id: `subway${l}:tunnel${n}`, kind: "tunnel", depth: 12, height: 6, boxes: [], bores: [{ a: [round(p[0] + u[0] * 90), round(p[1] + u[1] * 90)], b: [round(next[0] - u[0] * 90), round(next[1] - u[1] * 90)], width: 12 }], pillars: 0, lined: true, up: [] }); }
    });
  });
  return halls;
}

/**
 * How surely a box finds its hall in an interval (docs/underground-design.md §6.1): for points drawn over the halls of the
 * interval (by area), the share under exactly one hall of it. A box finds the hall under its middle, so this is the share
 * of boxes that find their hall without a tie. Basements count as halls here (pass them as boxes 3–9 m down).
 */
export function intervalPrecision(halls: (Pick<Hall, "boxes" | "bores" | "depth" | "height"> & { kind?: string })[], interval: Interval, samples = 4000, seed = "precision"): { boxes: number; unique: number; share: number } {
  const own = halls.filter((hall) => intervalsOf(hall).includes(interval)), rng = stageStream(seed, interval);
  if (!own.length) return { boxes: 0, unique: 0, share: 1 };
  // Points drawn uniformly over the plan the interval's halls cover (by their true area, not their bounds).
  const bounds = own.map(boundsOf), x0 = Math.min(...bounds.map((b) => b.x0)), x1 = Math.max(...bounds.map((b) => b.x1)), z0 = Math.min(...bounds.map((b) => b.z0)), z1 = Math.max(...bounds.map((b) => b.z1));
  let boxes = 0, unique = 0;
  for (let n = 0; n < samples * 400 && boxes < samples; n++) {
    const p: Point = [x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0)], under = own.filter((hall, index) => p[0] >= bounds[index].x0 && p[0] <= bounds[index].x1 && p[1] >= bounds[index].z0 && p[1] <= bounds[index].z1 && inHall(hall, p)).length;
    if (!under) continue;
    boxes++;
    if (under === 1) unique++;
  }
  return { boxes, unique, share: boxes ? unique / boxes : 1 };
}

/**
 * Collapse after a blast in a hall, on its cells (2 m, `cells`: each with its plan point, whether it is a pillar, and its
 * path distance to the blast along the hall in metres, Infinity where the void does not reach). The blast carries E and
 * reaches a cell with the greater of the open-air E/(4πρ²) and the confined E/(2A)·e^(−ρ/60): the void channels it.
 *
 * Then: pillars and lining whose share exceeds their bond break; a roof cell fails where the open span round it (twice its
 * distance to the nearest support: a standing pillar, or the ground beside the hall) exceeds its band's span, plus the
 * lining's while that is unbroken.
 * The ground over the failed cells falls in, one 2 m layer at a time from the roof up, the open area eroding by the band's
 * arch each layer (a dome forming); what falls bulks and piles on the failed cells. It stops when the dome closes, when the
 * pile fills the hall (a choke), or, for a hall whose roof is in the soil band only, at the surface, where the open area
 * left dents the ground by the void remaining, at most 3 m (the user's rule: a dent, never total destruction). A deeper
 * hall's cave never reaches the surface. Every step lowers the ground; one pass is the fixed point.
 */
export interface CollapseCell { i: number; j: number; pillar: boolean; reach: number }
export interface Collapse { pillars: number[]; lining: number[]; failed: number[]; pile: Record<number, number>; dent: Record<number, number>; layers: number; stopped: "none" | "dome" | "choke" | "dent" }
export function collapse(hall: Pick<Hall, "depth" | "height" | "lined" | "pillars"> & { width: number }, cells: CollapseCell[], energy: number, section = hall.width * hall.height): Collapse {
  const CELL = 2, key = (i: number, j: number) => `${i},${j}`, index = new Map(cells.map((cell, n) => [key(cell.i, cell.j), n]));
  const share = (reach: number) => (Number.isFinite(reach) ? Math.max(energy / (4 * Math.PI * Math.max(reach, 0.5) ** 2), (energy / (2 * section)) * Math.exp(-reach / 60)) : 0);
  const pillars = cells.flatMap((cell, n) => (cell.pillar && share(cell.reach) > PILLAR_BOND ? [n] : []));
  const lining = hall.lined ? cells.flatMap((cell, n) => (!cell.pillar && share(cell.reach) > LINING.bond ? [n] : [])) : [];
  const broken = new Set(pillars), unlined = new Set(lining), top = hall.depth - hall.height, band = bandAt(top);
  // The open span at a cell: twice its distance to the nearest support (a standing pillar, or the ground beside the hall),
  // by a chamfer walk from the supports over the hall's cells.
  const reachSupport = new Float64Array(cells.length).fill(Infinity), queue: number[] = [];
  const step = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  cells.forEach((cell, n) => {
    const support = cell.pillar && !broken.has(n) ? 0 : step.slice(0, 4).some(([di, dj]) => !index.has(key(cell.i + di, cell.j + dj))) ? 0.5 : Infinity;
    if (support < Infinity) { reachSupport[n] = support; queue.push(n); }
  });
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head], cell = cells[n];
    for (const [di, dj, cost] of step) { const m = index.get(key(cell.i + di, cell.j + dj)); if (m !== undefined && reachSupport[n] + cost < reachSupport[m] - 1e-9) { reachSupport[m] = reachSupport[n] + cost; queue.push(m); } }
  }
  const failed = cells.flatMap((cell, n) => {
    if (cell.pillar && !broken.has(n)) return [];
    const span = 2 * reachSupport[n] * CELL, allowed = band.span + (hall.lined && !unlined.has(n) ? LINING.span : 0);
    return span > allowed ? [n] : [];
  });
  const result: Collapse = { pillars, lining, failed, pile: {}, dent: {}, layers: 0, stopped: "none" };
  if (!failed.length) return result;
  // The cave over the failed cells: layer by layer up, eroded by the arch of the band each layer is in.
  let open = failed.map((n) => cells[n]), fallen = 0, depth = top;
  const area = failed.length * CELL * CELL, room = area * hall.height;
  const shallow = top < BANDS[0].to;
  while (open.length && depth > 0) {
    const layer = Math.min(2, depth);
    fallen += open.length * CELL * CELL * layer * bandAt(depth).bulk;
    depth -= layer; result.layers++;
    if (fallen >= room) { result.stopped = "choke"; break; }
    const keep = new Set(open.map((cell) => key(cell.i, cell.j))), erode = bandAt(depth).arch * result.layers;
    open = open.filter((cell) => { const r = Math.ceil(erode); for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.hypot(di, dj) <= erode && !keep.has(key(cell.i + di, cell.j + dj))) return false; return true; });
    if (!shallow && depth <= BANDS[0].to) { open = []; break; }
  }
  if (result.stopped !== "choke") result.stopped = open.length && depth <= 0 && shallow ? "dent" : "dome";
  const height = Math.min(hall.height, fallen / area);
  for (const n of failed) result.pile[n] = Math.round(height * 10) / 10;
  if (result.stopped === "dent") { const left = Math.max(0, room - fallen) / (open.length * CELL * CELL); for (const cell of open) result.dent[index.get(key(cell.i, cell.j))!] = Math.round(Math.min(3, Math.max(0.5, left)) * 10) / 10; }
  return result;
}

/**
 * The ceiling over a hall's floor (docs/v2/terrain-levels.md §8.3): it belongs to the level, not laid as geometry.
 *   skin  a hall with a real depth (the shallow layer): the ground over it, the street's slab with the hall's cover under it,
 *         its underside at the hall's top (`at`, metres, negative below the street); `cover` its thickness; `bond` what
 *         breaks it a cell at a time (the band its top lies in, and a lining's while unbroken: §8.4, soil 3 + 4);
 *   hard  the deep layer's (virtual: §8.6): so high it reads as none, a floor above its tallest building at least, hit and
 *         never broken (no bond);
 *   sky   a deck's and an orbit's: open.
 */
export interface Ceiling { kind: "skin" | "hard" | "sky"; at: number; cover: number; bond: number }
export function ceilingOf(hall: Pick<Hall, "depth" | "height" | "lined"> & { layer?: Layer }, tallest = 0): Ceiling {
  if (hall.layer === "air" || hall.layer === "space") return { kind: "sky", at: Infinity, cover: 0, bond: Infinity };
  if (hall.layer === "deep") return { kind: "hard", at: -hall.depth + Math.max(hall.height, tallest + 3), cover: Infinity, bond: Infinity };
  const cover = Math.max(0, hall.depth - hall.height);
  return { kind: "skin", at: -cover, cover, bond: bandAt(cover).bond + (hall.lined ? LINING.bond : 0) };
}
/** A beam bores through the ground of the shallow layer's near band (§8.1's table, 25 m), no deeper: past it the rock stops it. */
export const BEAM_BORE = 25;
/**
 * The skin a blast breaks (§8.4; the user, 2026-11-05: "yes it can break through"): a cell of a hall's ceiling opens where the
 * blast's sphere takes in the whole of its cover there (its underside and the street over it, metres from the centre) and the
 * blow it gives the near face is more than the skin's bond. The blow is the cave-in's (`collapse`): the open blast's spread
 * over a sphere, or along a hall it is confined in (`section`, its cross-section; Infinity in the open). `cells`: the hall's
 * cells as 2 m squares (i, j); returns the indices of those that open. A hard ceiling or the sky breaks nowhere.
 */
export function breach(ceiling: Ceiling, cells: { i: number; j: number }[], centre: { x: number; y: number; z: number }, r: number, energy: number, section = Infinity): number[] {
  if (ceiling.kind !== "skin" || r <= 0) return [];
  const CELL = 2, below = centre.y < ceiling.at;
  const share = (reach: number) => Math.max(energy / (4 * Math.PI * Math.max(reach, 0.5) ** 2), Number.isFinite(section) ? (energy / (2 * section)) * Math.exp(-reach / 60) : 0);
  return cells.flatMap((cell, n) => {
    const x = (cell.i + 0.5) * CELL, z = (cell.j + 0.5) * CELL, flat = Math.hypot(x - centre.x, z - centre.z);
    const under = Math.hypot(flat, centre.y - ceiling.at), over = Math.hypot(flat, centre.y), near = below ? under : over;
    return Math.max(under, over) <= r && share(near) > ceiling.bond ? [n] : [];
  });
}

/**
 * A terrain shape kept below the street (terrain spawning: a cut, a ramp down, a basin; docs/v2/world-engine-v2.md
 * §2.0.17): a hall that deep over its box, a passage along a long one (three times as long as wide) and a hall under any
 * other, stairs up at its ends, so the underground shows what Jev placed there.
 */
export function shapeHall(shape: { id: string; x: number; z: number; w: number; d: number; top: number; bottom?: number; hall?: string | null }): Hall {
  // A floating cavern (its top under the street and its thickness: terrainModes.ts FLOATING) lies from its bottom up.
  const depth = Math.max(4, -(shape.bottom ?? shape.top)), length = Math.max(shape.w, shape.d), width = Math.max(6, Math.min(shape.w, shape.d)), long = length >= 3 * width, angle = shape.w >= shape.d ? 0 : Math.PI / 2;
  // Its name's kind when the language profile knows it (a car park, a shelter), else a passage or a hall by its proportions.
  const kind = (shape.hall && shape.hall in LIES_UNDER ? shape.hall : long ? "corridor" : "mall") as HallKind, narrow = ["corridor", "utility", "tunnel"].includes(kind);
  return { id: `${shape.id}:shape`, kind, depth, height: shape.bottom != null ? Math.max(3, shape.top - shape.bottom) : HALL_HEIGHT[kind] ?? 4, boxes: [{ x: round(shape.x), z: round(shape.z), w: round(length), d: round(narrow ? Math.min(width, 12) : width), angle }], bores: [], pillars: narrow ? 0 : 8, lined: true, up: ends(shape.x, shape.z, length, angle) };
}
