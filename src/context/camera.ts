/**
 * The camera operator (docs/v3/design.html#director-camera; the user's design, 2026-11-02): the shots a move needs, planned in code
 * for Jev, the director, to answer on. A move is three steps: a direction (fourteen lettered arrows out of the person), a
 * spot inside the chosen arrow's wedge, and only when no spot fits, a box in two calls (c1 rough on a plan framed along the
 * arrow, c2 exact: the rough box's column from the side, its heights lettered, and the box zoomed top-down). Plain data and
 * arithmetic: the page draws what this plans (engine/view/strand-demo.html's capture layers), and never a model call.
 * Points are [x, y, z] in world metres (y up); boxes on the ground are [x0, z0, x1, z1].
 */
import type { Box } from "./zoom.js";

export type Point = [number, number, number];
export type Rise = "up" | "level" | "down";
/** One of the fourteen directions: its letter, its unit vector, whether it rises, and its colour (warm up, cool down). */
export interface Direction { letter: string; vector: Point; rise: Rise; color: string }

const S3 = 1 / Math.sqrt(3), COLORS: Record<Rise, string> = { up: "#ff9d5c", level: "#7ce6ff", down: "#8fb6ff" };
/**
 * The fourteen directions (the six along the axes and the eight cube diagonals, the user's N14): the four level ways first,
 * then up and down, then the diagonals, rising before falling. Lettered A–N in that order.
 */
export const DIRECTIONS: Direction[] = ([
  [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0], [0, -1, 0],
  [S3, S3, S3], [-S3, S3, S3], [-S3, S3, -S3], [S3, S3, -S3],
  [S3, -S3, S3], [-S3, -S3, S3], [-S3, -S3, -S3], [S3, -S3, -S3],
] as Point[]).map((vector, n) => {
  const rise: Rise = vector[1] > 0 ? "up" : vector[1] < 0 ? "down" : "level";
  return { letter: String.fromCharCode(65 + n), vector, rise, color: COLORS[rise] };
});
/** The answers a direction question also has besides the arrows. */
export const STAYS = "stays", WITH = "with";

/** How far a move may reach, by how it goes (metres): a step, a walk or run through a street, a leap, a flight. */
export const REACH = { step: 6, walk: 40, run: 90, leap: 30, flight: 400 } as const;
export type Way = keyof typeof REACH;
/** The usual spread of a direction's wedge (degrees across). */
export const SPREAD = 45;

const round = (value: number) => Math.round(value * 10) / 10;
const length = (v: Point) => Math.hypot(v[0], v[1], v[2]);
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const along = (at: Point, v: Point, t: number): Point => [at[0] + v[0] * t, at[1] + v[1] * t, at[2] + v[2] * t];

/** The angle (degrees) between a direction and the way from `at` to `point`; 0 when the point is `at` itself. */
export function angleTo(at: Point, direction: Point, point: Point): number {
  const to = minus(point, at), n = length(to) * length(direction);
  if (!n) return 0;
  const cos = (to[0] * direction[0] + to[1] * direction[1] + to[2] * direction[2]) / n;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
/** Whether a point lies in a direction's wedge (within half its spread of the arrow). */
export const inWedge = (at: Point, direction: Point, point: Point, spread = SPREAD) => angleTo(at, direction, point) <= spread / 2;

/**
 * The wedge on the ground, for drawing: from the person along the arrow's level part, its spread either side, as far as the
 * move reaches. A straight up or down arrow has none on the ground (it is drawn as a column, the section's).
 */
export function wedgeOnGround(at: Point, direction: Point, reach: number, spread = SPREAD, steps = 8): [number, number][] | null {
  const flat = Math.hypot(direction[0], direction[2]);
  if (flat < 1e-6) return null;
  const heading = Math.atan2(direction[2], direction[0]), half = (spread * Math.PI) / 360, out: [number, number][] = [[round(at[0]), round(at[2])]];
  for (let n = 0; n <= steps; n++) { const a = heading - half + (2 * half * n) / steps; out.push([round(at[0] + Math.cos(a) * reach), round(at[2] + Math.sin(a) * reach)]); }
  return out;
}

/**
 * c1's frame: a square on the ground holding the person and the whole reach of the chosen arrow (its wedge's far edge), with
 * a margin, never under `least` metres across. A straight up or down arrow frames the person's surroundings at its reach.
 */
export function frameAlong(at: Point, direction: Point, reach: number, { margin = 0.15, least = 16, spread = SPREAD } = {}): Box {
  const wedge = wedgeOnGround(at, direction, reach, spread) ?? [[at[0] - reach / 3, at[2] - reach / 3], [at[0] + reach / 3, at[2] + reach / 3]];
  const xs = wedge.map((p) => p[0]), zs = wedge.map((p) => p[1]);
  let [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const side = Math.max(least, (Math.max(x1 - x0, z1 - z0)) * (1 + 2 * margin)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  [x0, x1, z0, z1] = [cx - side / 2, cx + side / 2, cz - side / 2, cz + side / 2];
  return [round(x0), round(z0), round(x1), round(z1)];
}

/** How many metres a frame may span across `pixels` for a person (1.7 m) to stand `least` pixels tall at true scale. */
export const trueScaleSpan = (pixels: number, least = 16) => round((pixels * 1.7) / least);

/** What stands in a column, as heights: each building's floors (its bottom, its floor height, how many) and its roof. */
export interface Standing { name: string; bottom: number; floors: number; floorHeight?: number; below?: number }
/** A height of the column, lettered, and what it is. */
export interface Slice { letter: string; y: number; said: string; air: boolean }

/**
 * c2's heights: the column over the rough box, lettered from the lowest up: the underground levels of what stands there,
 * the ground, each floor and the roof of each building, then open air every few metres to `top` (5 m steps to 20 m, then
 * 10 m). Heights within 1.5 m of a lower one are dropped (the floor already says it); letters run A, B, … in height order.
 */
export function columnSlices(standing: Standing[], { top = 60 } = {}): Slice[] {
  const heights: { y: number; said: string; air: boolean }[] = [{ y: 0, said: "the ground", air: false }];
  for (const building of standing) {
    const step = building.floorHeight ?? 3;
    for (let n = 1; n <= (building.below ?? 0); n++) heights.push({ y: -n * 6, said: `${building.name}, underground level ${n}`, air: false });
    for (let n = 2; n <= building.floors; n++) heights.push({ y: building.bottom + (n - 1) * step, said: `${building.name}, floor ${n}`, air: false });
    heights.push({ y: building.bottom + building.floors * step, said: `${building.name}, its roof`, air: false });
  }
  const roof = Math.max(0, ...heights.filter((h) => !h.air).map((h) => h.y));
  for (let y = 5; y <= top; y += y < 20 ? 5 : 10) if (y > roof + 1.5) heights.push({ y, said: `in the air, ${y} m up`, air: true });
  const kept: typeof heights = [];
  for (const h of heights.sort((a, b) => a.y - b.y || Number(a.air) - Number(b.air))) if (!kept.length || h.y - kept[kept.length - 1].y >= 1.5) kept.push(h);
  return kept.map((h, n) => ({ letter: n < 26 ? String.fromCharCode(65 + n) : `Z${n - 25}`, y: round(h.y), said: h.said, air: h.air }));
}

/**
 * c2's side view: the camera turned to the side of the arrow (square to its level part; any side for a straight up or
 * down arrow), low (`elevation` degrees above level), at a distance that frames the column from below its lowest slice to
 * above its highest. Returns the camera's yaw (radians, the page's `yaw`) and what it must frame.
 */
export function sideView(box: Box, direction: Point, slices: Slice[], { elevation = 20 } = {}): { yaw: number; elevation: number; focus: { x: number; z: number; y0: number; h: number; w: number; d: number } } {
  const flat = Math.hypot(direction[0], direction[2]), heading = flat < 1e-6 ? 0 : Math.atan2(direction[2], direction[0]);
  const low = Math.min(0, ...slices.map((s) => s.y)), high = Math.max(3, ...slices.map((s) => s.y));
  return { yaw: round(heading + Math.PI / 2), elevation, focus: { x: round((box[0] + box[2]) / 2), z: round((box[1] + box[3]) / 2), y0: low, h: round(high - low + 2), w: round(box[2] - box[0]), d: round(box[3] - box[1]) } };
}

/** A box drawn on a plan (fractions of the picture, [left, top, right, bottom]) read back onto the ground, north up. */
export function planToGround(fractions: [number, number, number, number], map: { x: number; z: number; halfX: number; halfZ: number }): Box {
  const [l, t, r, b] = fractions, x = (f: number) => round(map.x - map.halfX + 2 * map.halfX * f), z = (f: number) => round(map.z - map.halfZ + 2 * map.halfZ * f);
  return [Math.min(x(l), x(r)), Math.min(z(t), z(b)), Math.max(x(l), x(r)), Math.max(z(t), z(b))];
}

/** Where an arrow ends at its reach (for drawing it, and probing what it meets). */
export const arrowEnd = (at: Point, direction: Point, reach: number): Point => along(at, direction, reach).map(round) as Point;
