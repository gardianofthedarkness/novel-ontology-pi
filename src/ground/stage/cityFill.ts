import { stageStream as skeletonStream } from "./stream.js";

/**
 * Auto-filling a city: its whole circle covered with roads, blocks, lots and buildings from a recipe, the same every
 * time for the same city (its id is the seed), so nothing of it is stored: runs keep only what they change (a named
 * building borrowing a lot, a street borrowing a road, a spawn, growth). Everything is in the city's own metres,
 * its centre at the origin.
 *
 * - **Arterial roads:** the plane is cut into super-blocks, the Voronoi cells of one jittered site per `cell` square;
 *   a cell's polygon depends only on the sites around it, so any part of the plane can be built on its own and
 *   agrees with every other part.
 * - **Blocks:** each super-block is split in two across its longer side, again and again, until a block is small
 *   enough; each split line is a road (a collector first, local roads after).
 * - **Lots:** each block is split the same way into lots, and only lots with a road along one side are kept.
 * - **Buildings:** each lot's building stands back from its edges, faces its road, and is as tall as the density
 *   field says: skyscrapers in the core, houses at the edge. The field is fixed by the radius the city was born
 *   with, so growing the city never changes a building already there.
 * - **Growth:** the city grows by taking in more of the plane (its radius × 1.3 each time something reaches its
 *   edge); what was inside stays exactly as it was.
 *
 * Places inside the city are circles placed once and kept (`placeChild`); named buildings borrow lots, or a whole
 * block when they need more ground (`borrowLots`); named streets borrow roads (`borrowRoad`); people with no stated
 * start spawn at a lot's door near the middle of the smallest place they are known to be in (`spawnOf`).
 */
export const CITY_FILL_VERSION = 1;

export type Point = [number, number];
interface Poly { pts: Point[]; tags: string[] }
export interface Circle { x: number; z: number; r: number }
export interface FillParams { cell: number; arterial: number; collector: number; local: number; blockArea: number; blockMin: number; lotSmall: number; lotLarge: number }
export const FILL: FillParams = { cell: 180, arterial: 18, collector: 12, local: 8, blockArea: 5200, blockMin: 36, lotSmall: 260, lotLarge: 1600 };
/** A city as a run keeps it: its seed (the place id), the radius it was born with and the radius it has grown to. */
export interface City { seed: string; r0: number; r: number }
export interface Road { id: string; a: Point; b: Point; width: number; level: "arterial" | "collector" | "local" | "boulevard" }
export interface Lot { id: string; block: string; pts: Point[]; area: number; centre: Point; frontage: { road: string; a: Point; b: Point } }
export type BuildingKind = "skyscraper" | "tower" | "office" | "house";
/** kind: a BuildingKind for the plain city; landscapes add their own (hall, keep, farmhouse, …). */
/** base: a building built into another (a street's shops under a tower of the ground it stands on): its lower floors' kind. */
export interface Building { lot: string; x: number; z: number; w: number; d: number; angle: number; floors: number; kind: string; base?: { floors: number; kind: string } }
/**
 * How a city is filled: the lot size a block is cut into (null leaves the block empty), which lots are kept, each
 * kept lot's building (null for none: a yard, a field), and which roads are drawn. The plain city fills its whole
 * circle by the density field (`densityStyle`); landscapes fill only their own shapes (landscape.ts).
 */
export interface FillStyle {
  /** The block size a super-block is cut to (default `FillParams.blockArea`): one rule for the whole super-block. */
  blockArea?(superBlock: { centre: Point; pts: Point[] }): number;
  /** How much wider than usual a super-block's roads are (default 1): busier, taller ground has wider streets. */
  roadWidth?(superBlock: { centre: Point; pts: Point[] }): number;
  lotArea(block: { centre: Point; pts: Point[] }): number | null;
  keep?(lot: Lot): boolean;
  building(lot: Lot, rng: () => number): { floors: number; kind: string; back: number } | null;
  road?(road: Road, faced: boolean): boolean;
}
export interface Fabric { roads: Road[]; blocks: { id: string; pts: Point[]; area: number }[]; lots: Lot[]; buildings: Building[] }

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Point): Point => { const length = Math.hypot(a[0], a[1]) || 1; return [a[0] / length, a[1] / length]; };
const signedArea = (pts: Point[]) => pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
export const polygonArea = (pts: Point[]) => Math.abs(signedArea(pts));
export function centroid(pts: Point[]): Point {
  let a = 0, x = 0, z = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], cross = p[0] * q[1] - q[0] * p[1]; a += cross; x += (p[0] + q[0]) * cross; z += (p[1] + q[1]) * cross; });
  return Math.abs(a) < 1e-9 ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : [x / (3 * a), z / (3 * a)];
}

/** The part of a polygon on the side (p − a)·n ≤ 0; the new edge along the line carries `tag`, cut edges keep theirs. */
function clip(poly: Poly, a: Point, n: Point, tag: string): Poly {
  const pts: Point[] = [], tags: string[] = [], d = (p: Point) => dot(sub(p, a), n), m = poly.pts.length;
  for (let i = 0; i < m; i++) {
    const P = poly.pts[i], Q = poly.pts[(i + 1) % m], dP = d(P), dQ = d(Q), t = poly.tags[i];
    if (dP <= 0) { pts.push(P); tags.push(t); }
    if ((dP <= 0) !== (dQ <= 0)) { const s = dP / (dP - dQ); pts.push([P[0] + (Q[0] - P[0]) * s, P[1] + (Q[1] - P[1]) * s]); tags.push(dP <= 0 ? tag : t); }
  }
  // Drop zero-length edges: a repeated point gives its outgoing edge's tag to the point kept.
  const outPts: Point[] = [], outTags: string[] = [];
  pts.forEach((p, i) => { const last = outPts.at(-1); if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-7) outTags[outTags.length - 1] = tags[i]; else { outPts.push(p); outTags.push(tags[i]); } });
  if (outPts.length > 1 && Math.hypot(outPts[0][0] - outPts.at(-1)![0], outPts[0][1] - outPts.at(-1)![1]) < 1e-7) { outPts.pop(); outTags.pop(); }
  return { pts: outPts, tags: outTags };
}
/** Each edge moved inward by width(tag) / 2 (convex polygons). */
function inset(poly: Poly, width: (tag: string) => number): Poly {
  const sign = signedArea(poly.pts) > 0 ? 1 : -1;
  let out = poly;
  poly.pts.forEach((P, i) => {
    const w = width(poly.tags[i]) / 2; if (!w || out.pts.length < 3) return;
    const Q = poly.pts[(i + 1) % poly.pts.length], dir = norm(sub(Q, P)), inward: Point = [-dir[1] * sign, dir[0] * sign];
    out = clip(out, [P[0] + inward[0] * w, P[1] + inward[1] * w], [-inward[0], -inward[1]], poly.tags[i]);
  });
  return out;
}
/** The two sides of a line through a along dir, a gap apart; the edges along it carry `tag`. */
function split(poly: Poly, a: Point, dir: Point, gap: number, tag: string): [Poly, Poly] {
  const n = norm([-dir[1], dir[0]]);
  return [clip(poly, [a[0] - n[0] * gap / 2, a[1] - n[1] * gap / 2], n, tag), clip(poly, [a[0] + n[0] * gap / 2, a[1] + n[1] * gap / 2], [-n[0], -n[1]], tag)];
}
/** Where a line crosses a convex polygon. */
function chord(pts: Point[], a: Point, dir: Point): [Point, Point] | null {
  const ts: number[] = [], n: Point = [-dir[1], dir[0]];
  pts.forEach((P, i) => { const Q = pts[(i + 1) % pts.length], dP = dot(sub(P, a), n), dQ = dot(sub(Q, a), n); if ((dP <= 0) !== (dQ <= 0)) { const s = dP / (dP - dQ), X: Point = [P[0] + (Q[0] - P[0]) * s, P[1] + (Q[1] - P[1]) * s]; ts.push(dot(sub(X, a), dir)); } });
  if (ts.length < 2) return null;
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  return [[a[0] + dir[0] * t0, a[1] + dir[1] * t0], [a[0] + dir[0] * t1, a[1] + dir[1] * t1]];
}
/** A polygon's frame: along its longest edge (u) and across it (v), with its extents on both. */
function frame(pts: Point[]) {
  let u: Point = [1, 0], best = -1;
  pts.forEach((P, i) => { const Q = pts[(i + 1) % pts.length], length = Math.hypot(Q[0] - P[0], Q[1] - P[1]); if (length > best) { best = length; u = norm(sub(Q, P)); } });
  const v: Point = [-u[1], u[0]], us = pts.map((p) => dot(p, u)), vs = pts.map((p) => dot(p, v));
  return { u, v, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}
const rotate = (d: Point, angle: number): Point => [d[0] * Math.cos(angle) - d[1] * Math.sin(angle), d[0] * Math.sin(angle) + d[1] * Math.cos(angle)];

/** A super-block's site: one per `cell` square, jittered. */
const siteOf = (seed: string, gx: number, gz: number, cell: number): Point => { const rng = skeletonStream(seed, "site", gx, gz); return [(gx + 0.5 + (rng() - 0.5) * 0.7) * cell, (gz + 0.5 + (rng() - 0.5) * 0.7) * cell]; };
const arterialId = (a: string, b: string) => `A:${[a, b].sort().join("|")}`;
/** A super-block: the Voronoi cell of its site among the sites around it; each edge is tagged with the arterial road it lies on. */
function superBlock(seed: string, gx: number, gz: number, cell: number): Poly & { site: Point } {
  const site = siteOf(seed, gx, gz, cell), h = cell * 2, id = `${gx},${gz}`;
  let poly: Poly = { pts: [[site[0] - h, site[1] - h], [site[0] + h, site[1] - h], [site[0] + h, site[1] + h], [site[0] - h, site[1] + h]], tags: ["border", "border", "border", "border"] };
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (!dx && !dz) continue;
    const other = siteOf(seed, gx + dx, gz + dz, cell);
    poly = clip(poly, [(site[0] + other[0]) / 2, (site[1] + other[1]) / 2], sub(other, site), arterialId(id, `${gx + dx},${gz + dz}`));
  }
  return { ...poly, site };
}

/** Floors, by the density field of a city born with radius r0: high in the core, falling off outward. */
export const densityAt = (r0: number, p: Point) => Math.exp(-((Math.hypot(p[0], p[1]) / (0.35 * r0)) ** 2));
const kindOf = (floors: number): BuildingKind => (floors >= 20 ? "skyscraper" : floors >= 8 ? "tower" : floors >= 4 ? "office" : "house");
/** The plain city: the whole circle filled, lots and floors by the density field fixed at birth. */
export const densityStyle = (city: City, p: FillParams = FILL): FillStyle => ({
  lotArea: (block) => p.lotSmall + (p.lotLarge - p.lotSmall) * densityAt(city.r0, block.centre),
  building: (lot, rng) => { const rho = densityAt(city.r0, lot.centre), floors = Math.max(1, Math.round(2 + 34 * rho * rho + rng() * (3 + 8 * rho))); return { floors, kind: kindOf(floors), back: floors >= 8 ? 4 : 2 }; },
});

/** Split a polygon across its longer side, again and again, while `big` says it is too big; each split calls `road`. */
function subdivide(poly: Poly, id: string, depth: number, rng: () => number, big: (poly: Poly) => boolean, gap: (depth: number) => number, tag: (id: string) => string, out: { id: string; poly: Poly }[], road?: (id: string, a: Point, b: Point, depth: number) => void) {
  const f = frame(poly.pts), along = f.u1 - f.u0 >= f.v1 - f.v0;
  if (!big(poly)) { out.push({ id, poly }); return; }
  const [axis, across, lo, hi, mid] = along ? [f.u, f.v, f.u0, f.u1, (f.v0 + f.v1) / 2] as const : [f.v, f.u, f.v0, f.v1, (f.u0 + f.u1) / 2] as const;
  const t = lo + (hi - lo) * (0.5 + (rng() - 0.5) * 0.2), dir = norm(rotate(across, (rng() - 0.5) * 0.25));
  const a: Point = [axis[0] * t + across[0] * mid, axis[1] * t + across[1] * mid], name = tag(id), [A, B] = split(poly, a, dir, gap(depth), name);
  if (A.pts.length < 3 || B.pts.length < 3 || polygonArea(A.pts) < 40 || polygonArea(B.pts) < 40) { out.push({ id, poly }); return; }
  const line = chord(poly.pts, a, dir);
  if (line && road) road(name, line[0], line[1], depth);
  subdivide(A, `${id}.0`, depth + 1, rng, big, gap, tag, out, road);
  subdivide(B, `${id}.1`, depth + 1, rng, big, gap, tag, out, road);
}

/** The city's fabric inside its radius (and inside a window, when given): roads, blocks, lots and their buildings. */
export function materialize(city: City, window?: { x0: number; z0: number; x1: number; z1: number }, p: FillParams = FILL, style: FillStyle = densityStyle(city, p)): Fabric {
  const { cell } = p, reach = city.r + cell, fabric: Fabric = { roads: [], blocks: [], lots: [], buildings: [] }, roads = new Map<string, Road>();
  const addRoad = (road: Road) => { if (!roads.has(road.id)) roads.set(road.id, road); };
  const inWindow = (q: Point, margin: number) => !window || (q[0] >= window.x0 - margin && q[0] <= window.x1 + margin && q[1] >= window.z0 - margin && q[1] <= window.z1 + margin);
  for (let gx = Math.floor(-reach / cell) - 1; gx <= Math.ceil(reach / cell); gx++) for (let gz = Math.floor(-reach / cell) - 1; gz <= Math.ceil(reach / cell); gz++) {
    const site = siteOf(city.seed, gx, gz, cell);
    if (Math.hypot(site[0], site[1]) > city.r + cell * 1.2 || !inWindow(site, cell * 1.5)) continue;
    const block = superBlock(city.seed, gx, gz, cell), id = `${gx},${gz}`, wide = style.roadWidth?.({ centre: site, pts: block.pts }) ?? 1;
    block.pts.forEach((P, i) => { const tag = block.tags[i]; if (tag.startsWith("A:")) addRoad({ id: tag, a: P, b: block.pts[(i + 1) % block.pts.length], width: p.arterial * wide, level: "arterial" }); });
    const blocks: { id: string; poly: Poly }[] = [], ground = inset(block, (tag) => (tag.startsWith("A:") ? p.arterial * wide : 0)), blockArea = style.blockArea?.({ centre: site, pts: ground.pts }) ?? p.blockArea;
    subdivide(ground, `B${id}`, 0, skeletonStream(city.seed, "blocks", id), (poly) => { const f = frame(poly.pts); return polygonArea(poly.pts) > blockArea && Math.max(f.u1 - f.u0, f.v1 - f.v0) > 2 * p.blockMin; },
      (depth) => (depth === 0 ? p.collector : p.local) * wide, (name) => `L:${name}`, blocks, (name, a, b, depth) => addRoad({ id: name, a, b, width: (depth === 0 ? p.collector : p.local) * wide, level: depth === 0 ? "collector" : "local" }));
    for (const entry of blocks) {
      const c = centroid(entry.poly.pts), target = Math.hypot(c[0], c[1]) > city.r + 60 || !inWindow(c, 60) ? null : style.lotArea({ centre: c, pts: entry.poly.pts });
      if (target === null) continue;
      fabric.blocks.push({ id: entry.id, pts: entry.poly.pts, area: polygonArea(entry.poly.pts) });
      const lots: { id: string; poly: Poly }[] = [];
      // Each piece is split while it is bigger than the lot size where it sits (a tall core wants its middle in big plots).
      subdivide(entry.poly, `${entry.id}/l`, 0, skeletonStream(city.seed, "lots", entry.id), (poly) => { const f = frame(poly.pts); return polygonArea(poly.pts) > (style.lotArea({ centre: centroid(poly.pts), pts: poly.pts }) ?? target) && Math.min(f.u1 - f.u0, f.v1 - f.v0) > 12; }, () => 0, () => "lot", lots);
      for (const lot of lots) {
        const centre = centroid(lot.poly.pts);
        if (Math.hypot(centre[0], centre[1]) > city.r || !inWindow(centre, 0)) continue;
        // Its frontage: the longest edge along a road; a lot with none is the block's yard.
        let frontage: Lot["frontage"] | null = null, longest = 0;
        lot.poly.pts.forEach((P, i) => { const tag = lot.poly.tags[i], Q = lot.poly.pts[(i + 1) % lot.poly.pts.length], length = Math.hypot(Q[0] - P[0], Q[1] - P[1]); if ((tag.startsWith("A:") || tag.startsWith("L:")) && length > longest) { longest = length; frontage = { road: tag, a: P, b: Q }; } });
        if (!frontage) continue;
        const record: Lot = { id: lot.id, block: entry.id, pts: lot.poly.pts, area: polygonArea(lot.poly.pts), centre, frontage };
        if (style.keep && !style.keep(record)) continue;
        fabric.lots.push(record);
        const spec = style.building(record, skeletonStream(city.seed, "building", lot.id)), building = spec ? buildingOn(record, lot.poly, spec) : null;
        if (building) fabric.buildings.push(building);
      }
    }
  }
  // The roads the city has: those reaching inside it (and the window), and every road a lot faces.
  // Each cut a road's width past the city's edge (so the outermost lots still face theirs): it goes on once the city grows.
  const faced = new Set(fabric.lots.map((lot) => lot.frontage.road));
  fabric.roads = [...roads.values()].flatMap((road) => { const cut = withinCircle(road.a, road.b, city.r + p.arterial); return cut && inWindow([(cut[0][0] + cut[1][0]) / 2, (cut[0][1] + cut[1][1]) / 2], 60) && (!style.road || style.road(road, faced.has(road.id))) ? [{ ...road, a: cut[0], b: cut[1] }] : []; });
  return fabric;
}

/** The part of a segment inside the circle of radius r around the origin, or null. */
function withinCircle(a: Point, b: Point, r: number): [Point, Point] | null {
  const d = sub(b, a), A = dot(d, d), B = 2 * dot(a, d), C = dot(a, a) - r * r, disc = B * B - 4 * A * C;
  if (A < 1e-9 || disc <= 0) return null;
  const t0 = Math.max(0, (-B - Math.sqrt(disc)) / (2 * A)), t1 = Math.min(1, (-B + Math.sqrt(disc)) / (2 * A));
  return t1 - t0 < 1e-6 ? null : [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]];
}

/** A lot's generated building: set back from its edges, facing its road, as tall and of the kind its style says. */
function buildingOn(lot: Lot, poly: Poly, { floors, kind, back }: { floors: number; kind: string; back: number }): Building | null {
  const inner = inset(poly, () => 2 * back);
  if (inner.pts.length < 3) return null;
  const u = norm(sub(lot.frontage.b, lot.frontage.a)), v: Point = [-u[1], u[0]], us = inner.pts.map((q) => dot(q, u)), vs = inner.pts.map((q) => dot(q, v));
  const w = Math.max(...us) - Math.min(...us), d = Math.max(...vs) - Math.min(...vs);
  if (w < 4 || d < 4) return null;
  const cu = (Math.max(...us) + Math.min(...us)) / 2, cv = (Math.max(...vs) + Math.min(...vs)) / 2;
  return { lot: lot.id, x: u[0] * cu + v[0] * cv, z: u[1] * cu + v[1] * cv, w, d, angle: Math.atan2(u[1], u[0]), floors, kind };
}

/**
 * A place inside a place: a circle of radius r inside the parent, clear of the siblings already placed, as near the
 * target (the parent's centre unless given) as it fits. Placed once and kept: later births never move it.
 */
export function placeChild(parent: Circle, siblings: Circle[], r: number, seed: string, toward?: Point): Circle | null {
  const target = toward ?? [parent.x, parent.z], turn = skeletonStream(seed, "turn")() * Math.PI * 2, tries = 900;
  let best: Circle | null = null, nearest = Infinity;
  for (let k = 0; k < tries; k++) {
    const rho = Math.max(0, parent.r - r - 4) * Math.sqrt((k + 0.5) / tries), theta = turn + k * 2.399963, c = { x: parent.x + rho * Math.cos(theta), z: parent.z + rho * Math.sin(theta), r };
    if (siblings.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < s.r + r + 6)) continue;
    const distance = Math.hypot(c.x - target[0], c.z - target[1]);
    if (distance < nearest) { nearest = distance; best = c; }
  }
  return best;
}

/** The ground a building of each kind needs, in m² (a range). */
export const BUILDING_AREA: Record<string, [number, number]> = { house: [80, 400], home: [80, 400], shop: [150, 800], office: [500, 3000], tower: [400, 2000], skyscraper: [1000, 4000], market: [800, 4000], church: [400, 2500], station: [2000, 9000], school: [4000, 16000], hospital: [3000, 14000], castle: [3000, 20000] };
const inCircle = (q: Point, c: Circle) => Math.hypot(q[0] - c.x, q[1] - c.z) <= c.r;
const tieBreak = (seed: string, id: string) => skeletonStream(seed, id)() * 1e-3;
/**
 * A named building borrows ground in its region (a place's circle, or a street's road): the free lot whose area is
 * nearest what its kind needs; a building that needs more than any lot gives borrows a whole free block instead.
 */
export function borrowLots(fabric: Fabric, region: { circle?: Circle; road?: string }, kind: string, taken: Set<string>, seed: string): { lots: string[]; block?: string } | null {
  const [low, high] = BUILDING_AREA[kind] ?? BUILDING_AREA.office, target = Math.sqrt(low * high), fit = (area: number) => Math.abs(Math.log(area / target));
  const inRegion = (lot: Lot) => (!region.circle || inCircle(lot.centre, region.circle)) && (!region.road || lot.frontage.road === region.road);
  const free = fabric.lots.filter((lot) => inRegion(lot) && !taken.has(lot.id));
  const single = free.filter((lot) => lot.area >= low * 0.7).sort((a, b) => fit(a.area) + tieBreak(seed, a.id) - fit(b.area) - tieBreak(seed, b.id))[0];
  if (single && single.area <= high * 1.5) return { lots: [single.id] };
  // A whole block, every lot of it free and in the region.
  const byBlock = new Map<string, Lot[]>();
  for (const lot of fabric.lots) byBlock.set(lot.block, [...(byBlock.get(lot.block) ?? []), lot]);
  const blocks = [...byBlock].filter(([, lots]) => lots.every((lot) => inRegion(lot) && !taken.has(lot.id))).map(([block, lots]) => ({ block, lots, area: lots.reduce((sum, lot) => sum + lot.area, 0) }))
    .filter((entry) => entry.area >= low * 0.7).sort((a, b) => fit(a.area) + tieBreak(seed, a.block) - fit(b.area) - tieBreak(seed, b.block));
  if (blocks[0] && (!single || fit(blocks[0].area) < fit(single.area))) return { lots: blocks[0].lots.map((lot) => lot.id), block: blocks[0].block };
  return single ? { lots: [single.id] } : null;
}
/** A named street borrows a road inside its region: the free one whose length is nearest the middle of the range. */
export function borrowRoad(fabric: Fabric, region: Circle, length: [number, number], taken: Set<string>, seed: string): string | null {
  const target = (length[0] + length[1]) / 2, size = (road: Road) => Math.hypot(road.b[0] - road.a[0], road.b[1] - road.a[1]);
  return fabric.roads.filter((road) => !taken.has(road.id) && inCircle([(road.a[0] + road.b[0]) / 2, (road.a[1] + road.b[1]) / 2], region) && size(road) >= length[0] && size(road) <= length[1])
    .sort((a, b) => Math.abs(size(a) - target) + tieBreak(seed, a.id) - Math.abs(size(b) - target) - tieBreak(seed, b.id))[0]?.id ?? null;
}
/**
 * Where a person with no stated start comes into a place: the door of a free lot in its circle, drawn with weights
 * falling off from the middle (a normal of σ = r / 2), the same lot every time for the same person and place.
 */
export function spawnOf(fabric: Fabric, region: Circle, person: string, place: string, taken: Set<string>): { lot: string; door: Point } | null {
  const sigma = region.r / 2, lots = fabric.lots.filter((lot) => inCircle(lot.centre, region) && !taken.has(lot.id));
  const weights = lots.map((lot) => Math.exp(-((lot.centre[0] - region.x) ** 2 + (lot.centre[1] - region.z) ** 2) / (2 * sigma * sigma)));
  let pick = skeletonStream("spawn", person, place)() * weights.reduce((sum, w) => sum + w, 0);
  const lot = lots.find((_, i) => (pick -= weights[i]) <= 0) ?? lots.at(-1);
  return lot ? { lot: lot.id, door: [(lot.frontage.a[0] + lot.frontage.b[0]) / 2, (lot.frontage.a[1] + lot.frontage.b[1]) / 2] } : null;
}
/**
 * Growth when something reaches the edge: the radius × 1.3 until the point is inside, at most `cap` × the radius the
 * city was born with; past that the scene has left the place.
 */
export function growToReach(city: City, point: Point, cap = 3): { r: number; steps: number; left: boolean } {
  let r = city.r, steps = 0;
  while (Math.hypot(point[0], point[1]) > r - 10) { if (r * 1.3 > city.r0 * cap) return { r, steps, left: true }; r *= 1.3; steps++; }
  return { r, steps, left: false };
}
