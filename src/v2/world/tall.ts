/**
 * Tall buildings and the streets round them (docs/v2/borrow-and-spawn.md §8.11): above 100 m the taller the thicker, and
 * a street wider the more towers stand round it, worked on a place's filled buildings and roads after the fill.
 */
import type { Building, Point, Road } from "./cityFill.js";
import { segmentDistance, SLENDER } from "./landscape.js";

/**
 * Tall buildings and the streets round them (the user, 2026-11-01), worked after the fill, so its lots (and the slots that
 * name them) stay as they are:
 *  - a street is wider the more tall buildings stand round it: its width times 1 + s / AROUND.per (at most AROUND.most),
 *    s the heights above TALL of the buildings within AROUND.reach of it, summed, over how many stand there (the share of
 *    towers times their mean height); a building the wider street now reaches gives up that much of its face to it;
 *  - above TALL a building is as thick as its height needs, no side under its height / SLENDER, so the taller the thicker:
 *    the tallest first, each grown as far as no street and no building kept before it stops it, the lower buildings it
 *    then covers cleared. A `fixed` building (one the text placed, a landmark) is never cleared or cut.
 */
export const TALL = 100;
export const AROUND = { reach: 120, per: 400, most: 2.5 };
const topOf = (b: Building) => b.floors * 3;
/** A building's half-extent toward a road's normal (as `onRoad` measures it). */
const reachToward = (b: Building, road: Road) => {
  const dx = road.b[0] - road.a[0], dz = road.b[1] - road.a[1], len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len, ux = Math.cos(b.angle), uz = Math.sin(b.angle);
  return (Math.abs(nx * ux + nz * uz) * b.w + Math.abs(nz * ux - nx * uz) * b.d) / 2;
};
const hitsRoad = (b: Building, road: Road) => segmentDistance([b.x, b.z], road.a, road.b) < road.width / 2 + reachToward(b, road) + 1;
const cornersOf = (b: Building): Point[] => {
  const ux = Math.cos(b.angle), uz = Math.sin(b.angle), hw = b.w / 2, hd = b.d / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [b.x + s * hw * ux - t * hd * uz, b.z + s * hw * uz + t * hd * ux] as Point);
};
/** Whether two turned footprints overlap (separating axes). */
export function footprintsOverlap(a: Building, b: Building): boolean {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2) return false;
  const A = cornersOf(a), B = cornersOf(b);
  for (const angle of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const ax = Math.cos(angle), az = Math.sin(angle), span = (pts: Point[]) => { const v = pts.map((p) => p[0] * ax + p[1] * az); return [Math.min(...v), Math.max(...v)]; };
    const [a0, a1] = span(A), [b0, b1] = span(B);
    if (a1 <= b0 + 0.01 || b1 <= a0 + 0.01) return false;
  }
  return true;
}
/** `least`: a building's least side whatever its height (a shopping centre's podium: the user, 2026-11-01), grown as a tower is. */
export function tallAndWide(buildings: Building[], roads: Road[], fixed: (b: Building) => boolean, least: (b: Building) => number = () => 0): { buildings: Building[]; roads: Road[]; widened: number; trimmed: number; thickened: number; cleared: number } {
  // 1. The streets: the statistics of the buildings round each.
  const wide = roads.map((road) => {
    let n = 0, tall = 0;
    for (const b of buildings) if (segmentDistance([b.x, b.z], road.a, road.b) <= AROUND.reach) { n++; if (topOf(b) > TALL) tall += topOf(b); }
    const factor = n ? Math.min(AROUND.most, 1 + tall / n / AROUND.per) : 1;
    return factor > 1.01 ? { ...road, width: Math.round(road.width * factor * 10) / 10 } : road;
  });
  // A building clear of a street before it widened gives up the face it now reaches (a fixed one moves back whole).
  let trimmed = 0;
  const kept: (Building | null)[] = buildings.map((b) => ({ ...b }));
  wide.forEach((road, k) => {
    if (road === roads[k]) return;
    for (const [i, b] of kept.entries()) {
      if (!b) continue;
      const near = segmentDistance([b.x, b.z], road.a, road.b) - reachToward(b, road), was = roads[k].width / 2 + 1, cut = road.width / 2 + 1 - near;
      if (near < was - 0.01 || cut <= 0) continue;
      const t = Math.max(0, Math.min(1, ((b.x - road.a[0]) * (road.b[0] - road.a[0]) + (b.z - road.a[1]) * (road.b[1] - road.a[1])) / ((road.b[0] - road.a[0]) ** 2 + (road.b[1] - road.a[1]) ** 2 || 1)));
      const px = road.a[0] + t * (road.b[0] - road.a[0]), pz = road.a[1] + t * (road.b[1] - road.a[1]), len = Math.hypot(b.x - px, b.z - pz) || 1, nx = (b.x - px) / len, nz = (b.z - pz) / len;
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle), along = Math.abs(nx * ux + nz * uz), across = Math.abs(nz * ux - nx * uz);
      const shrink = along >= across ? { w: b.w - cut / Math.max(along, 0.3) } : { d: b.d - cut / Math.max(across, 0.3) };
      if (fixed(b) || Math.min(shrink.w ?? b.w, shrink.d ?? b.d) < 4) { if (!fixed(b)) { kept[i] = null; trimmed++; continue; } kept[i] = { ...b, x: b.x + nx * cut, z: b.z + nz * cut }; continue; }
      kept[i] = { ...b, ...shrink, x: b.x + (nx * cut) / 2, z: b.z + (nz * cut) / 2 }; trimmed++;
    }
  });
  // 2. Above TALL, the taller the thicker: the tallest first, grown as far as the streets and what was kept allow.
  let thickened = 0, cleared = 0;
  const live = kept.filter((b): b is Building => !!b), order = [...live].sort((a, b) => topOf(b) - topOf(a)), gone = new Set<Building>(), standing: Building[] = [];
  const fixedOnes = live.filter(fixed);
  for (const b of order) {
    if (gone.has(b)) continue;
    const need = Math.max(topOf(b) > TALL ? topOf(b) / SLENDER : 0, least(b));
    if (need > 0 && Math.min(b.w, b.d) < need) {
      const reach = need + Math.hypot(b.w, b.d), near = (o: Building) => Math.hypot(o.x - b.x, o.z - b.z) < reach + Math.hypot(o.w, o.d);
      const streets = wide.filter((road) => segmentDistance([b.x, b.z], road.a, road.b) < reach + road.width && !hitsRoad(b, road));
      const stops = [...standing, ...fixedOnes.filter((o) => o !== b)].filter((o) => near(o) && !footprintsOverlap(b, o));
      // Grown round its middle, or off it, away from what stops it on one side (its own spot kept within the grown footprint).
      const gw = Math.max(0, need - b.w), gd = Math.max(0, need - b.d), ux = Math.cos(b.angle), uz = Math.sin(b.angle);
      const at = (t: number, [s, r]: number[]): Building => ({ ...b, w: b.w + gw * t, d: b.d + gd * t, x: b.x + ((s * gw * ux - r * gd * uz) * t) / 2, z: b.z + ((s * gw * uz + r * gd * ux) * t) / 2 });
      const fits = (g: Building) => !streets.some((road) => hitsRoad(g, road)) && !stops.some((o) => footprintsOverlap(g, o));
      let best = { t: 0, way: [0, 0] };
      for (const way of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        let lo = 0, hi = 1;
        if (fits(at(1, way))) lo = 1; else for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (fits(at(mid, way))) lo = mid; else hi = mid; }
        if (lo > best.t + 1e-6) best = { t: lo, way };
        if (best.t === 1) break;
      }
      if (best.t > 0) {
        const grown = at(best.t, best.way);
        Object.assign(b, { w: Math.round(grown.w * 10) / 10, d: Math.round(grown.d * 10) / 10, x: Math.round(grown.x * 10) / 10, z: Math.round(grown.z * 10) / 10 }); thickened++;
        for (const o of live) if (o !== b && !gone.has(o) && !fixed(o) && !standing.includes(o) && near(o) && footprintsOverlap(b, o)) { gone.add(o); cleared++; }
      }
    }
    standing.push(b);
  }
  return { buildings: live.filter((b) => !gone.has(b)), roads: wide, widened: wide.filter((road, k) => road !== roads[k]).length, trimmed, thickened, cleared };
}

/**
 * No building stands inside another (the user, 2026-11-02: a district "blowing up", towers thickened and buildings pushed
 * aside by what stands apart landing in their neighbours, once every building was drawn at its true size): what the text
 * placed (`fixed`) first, then the tallest first, each kept unless its footprint, less a hand's breadth at each face (so
 * buildings wall to wall stay), overlaps one kept before it.
 */
export function clearOverlaps(buildings: Building[], fixed: (b: Building) => boolean): { buildings: Building[]; overlapped: number } {
  const CELL = 40, grid = new Map<string, Building[]>(), kept = new Set<Building>();
  const order = [...buildings].sort((a, b) => Number(fixed(b)) - Number(fixed(a)) || topOf(b) - topOf(a));
  const inset = (b: Building): Building => ({ ...b, w: Math.max(0.2, b.w - 0.6), d: Math.max(0.2, b.d - 0.6) });
  const cellsOf = (b: Building) => { const r = Math.hypot(b.w, b.d) / 2, out: string[] = []; for (let i = Math.floor((b.x - r) / CELL); i <= Math.floor((b.x + r) / CELL); i++) for (let j = Math.floor((b.z - r) / CELL); j <= Math.floor((b.z + r) / CELL); j++) out.push(`${i},${j}`); return out; };
  for (const b of order) {
    const cells = cellsOf(b), mine = inset(b);
    if (!fixed(b) && cells.some((cell) => (grid.get(cell) ?? []).some((other) => footprintsOverlap(mine, inset(other))))) continue;
    kept.add(b);
    for (const cell of cells) (grid.get(cell) ?? grid.set(cell, []).get(cell)!).push(b);
  }
  return { buildings: buildings.filter((b) => kept.has(b)), overlapped: buildings.length - kept.size };
}
