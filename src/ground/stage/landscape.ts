import { stageStream as skeletonStream } from "./stream.js";
import { centroid, materialize, type Building, type Fabric, type FillStyle, type Lot, type Point, type Road } from "./cityFill.js";

/**
 * Landscapes: what a place's ground looks like, by type. Jev picks the type (modern skyscrapers, a commercial
 * quarter, a living area, an industrial area, a village, an ancient castle or farmland); each type is a family of
 * shapes, drawn afresh from a seed every time but always shaped like that landscape:
 *
 * - a **patch** is one such shape: a centre, a radius R and a closed outline r(θ) = R · ρ(θ) from the type's family
 *   (a compact blob for towers, a lobed village, a boxy superellipse for industry and fields, a bastioned fort);
 * - its **height** rises over the depth inside it, s = 1 − |p − c| / r(θ) (1 at the centre, 0 on the outline), by
 *   the type's profile: a core of towers peaking in the middle, a flat or low spread, a keep within walls;
 * - its **filling** is the city fabric (cityFill.ts) cut to the type's lot size, kept only inside the patch, with
 *   the type's buildings, set-backs and gaps (a farm is mostly fields).
 *
 * (also a harbour and a park). A place is filled from its centre (its first patch), never edge to edge. New parts are patches placed against the
 * place's edge where Jev or the drift of a scene puts them, and the place's circle grows to hold them. Earlier patches
 * win where patches overlap, so a new part never changes what is already there.
 *
 * What is kept (in the ontology, as the place's `landscape`): each patch's type, centre, radius, seed and the
 * numbers drawn for its shape. The filling is never kept: it is the same every time from those.
 */
export const LANDSCAPE_VERSION = 1;
export const LANDSCAPE_TYPES = ["skyscrapers", "commercial", "residential", "industrial", "harbour", "park", "stadium", "village", "castle", "farm"] as const;
/**
 * The street level's landscapes (docs/v2/world-engine-v2.md §2.0.13), each with its own 3D form: a shopping street, a
 * modern commercial centre, an avenue, a square, a station front, an alley, a terrace (a residential street), a waterfront.
 * Built from a street area's box; kept apart from the district level's list, which the landscape step asks from.
 */
export const STREET_TYPES = ["shopping", "centre", "avenue", "square", "station", "alley", "terrace", "waterfront"] as const;
export type LandscapeType = (typeof LANDSCAPE_TYPES)[number] | (typeof STREET_TYPES)[number];

type Family = "blob" | "lobes" | "box" | "fort";
/**
 * era: modern landscapes may overlap one another and merge at any height (a new part's buildings rise or fall to meet
 * its older neighbour at the seam); ancient ones (a castle, a village, farmland) never overlap anything, and keep
 * their height cap. cap: the tallest a building of the type may be, in metres; skyscrapers may peak at 1,000 m.
 */
/**
 * soft: how far the edge fades, in metres: a lot at signed distance d from the outline belongs with probability σ(d / soft).
 * A street's form: aspect, a box's width over its length (a street is long and narrow); axis, the road down its length
 * (its width and level), its heights drawn by the distance from it; band, water down its length (its half-width over the
 * ground's); narrow, how much narrower its own roads are; row, the buildings lining it (each one's frontage and depth, the
 * gap between them), set back `back` from its road, its water's promenade or its square; into, whether it builds into the
 * ground it lands on (its buildings the base of that ground's towers) or replaces it with its own low fabric.
 */
interface Kind { hint: string; era: "modern" | "ancient"; soft: number; radius: [number, number]; height: [number, number]; cap: number; lot: [number, number]; block: number; coverage: number; back: number; family: Family; profile: "core" | "flat" | "low" | "keep"; building: (floors: number) => string; aspect?: [number, number]; axis?: { width: number; level: Road["level"] }; band?: number; narrow?: number; row?: { frontage: [number, number]; depth: [number, number]; gap: number }; into?: boolean }
/** The tallest any building may be (a skyscraper core's peak): a modern merge may lift a building past its own type's cap, never past this. */
export const PEAK = 600;
/** How many times its footprint's width a building may be tall: a 600 m tower stands on a lot about 80 m across. */
export const SLENDER = 8;
/**
 * Super-tall ground: only where a skyscraper core's mean height (its manifold, H × depth) is at least SUPER_TALL and
 * within its top 30% do plots and streets widen for the towers; everywhere else, a core is cut like any district, with
 * its type's own plots and streets (regular buildings keep the density they had before the rule).
 */
export const SUPER_TALL = 250;
export const superTallAt = (patch: Patch, p: Point) => { if ((patch.type !== "skyscrapers" && !patch.manifold) || patch.H < SUPER_TALL) return 0; const mean = patch.manifold ? localMedian(patch, depthOf(patch, p)) : patch.H * depthOf(patch, p); return mean >= Math.max(SUPER_TALL, 0.7 * patch.H) ? mean : 0; };
/** How much wider streets are at a point: 1 + h/400 on super-tall ground (h the mean height there; 2.5 times at a 600 m peak), else 1. */
export const streetsFor = (patch: Patch, p: Point = [patch.x, patch.z]) => { const tall = superTallAt(patch, p); return tall ? 1 + tall / 400 : 1; };
export const LANDSCAPES: Record<LandscapeType, Kind> = {
  skyscrapers: { soft: 25, era: "modern", cap: 600, hint: "modern skyscrapers: a dense core of high-rise towers", radius: [110, 200], height: [80, 600], lot: [1400, 2600], block: 6000, coverage: 0.95, back: 4, family: "blob", profile: "core", building: (f) => (f >= 20 ? "skyscraper" : "tower") },
  commercial: { soft: 20, era: "modern", cap: 60, hint: "a commercial quarter: shops, malls and offices of a few storeys along busy streets, with a plaza and a boulevard", radius: [90, 170], height: [12, 36], lot: [500, 1300], block: 4500, coverage: 0.95, back: 2, family: "blob", profile: "flat", building: (f) => (f >= 6 ? "office" : "shop") },
  residential: { soft: 30, era: "modern", cap: 45, hint: "a living area: houses and apartment blocks", radius: [130, 250], height: [7, 22], lot: [250, 700], block: 4000, coverage: 0.9, back: 3, family: "blob", profile: "flat", building: (f) => (f >= 5 ? "apartment" : "house") },
  industrial: { soft: 12, era: "modern", cap: 30, hint: "an industrial area: factories, warehouses and yards on large plots", radius: [130, 230], height: [8, 15], lot: [2500, 6500], block: 14000, coverage: 0.85, back: 3, family: "box", profile: "flat", building: () => "hall" },
  harbour: { soft: 12, era: "modern", cap: 30, hint: "a harbour or waterfront: docks, piers, marinas and warehouses by the water", radius: [100, 200], height: [6, 15], lot: [1500, 4000], block: 9000, coverage: 0.7, back: 2, family: "box", profile: "flat", building: () => "warehouse" },
  park: { soft: 25, era: "modern", cap: 20, hint: "a park or leisure ground: lawns, gardens, an amusement park, with a few pavilions", radius: [80, 200], height: [4, 14], lot: [1500, 4000], block: 8000, coverage: 0.25, back: 8, family: "blob", profile: "low", building: () => "pavilion" },
  stadium: { soft: 15, era: "modern", cap: 60, hint: "a stadium or sports ground: an oval bowl with parking and a few halls around it", radius: [120, 220], height: [25, 50], lot: [3000, 8000], block: 20000, coverage: 0.15, back: 4, family: "blob", profile: "low", building: () => "hall" },
  village: { soft: 30, era: "ancient", cap: 12, hint: "a village: scattered low houses with gardens", radius: [70, 130], height: [4, 9], lot: [350, 900], block: 7000, coverage: 0.5, back: 3, family: "lobes", profile: "low", building: () => "cottage" },
  castle: { soft: 4, era: "ancient", cap: 60, hint: "an ancient castle: a keep within walls and a crowded old town", radius: [70, 120], height: [30, 55], lot: [200, 600], block: 2500, coverage: 0.85, back: 1, family: "fort", profile: "keep", building: () => "townhouse" },
  shopping: { soft: 10, era: "modern", cap: 60, hint: "a shopping street: a pedestrian street lined tight with shops of a few storeys", radius: [60, 140], height: [6, 25], lot: [100, 300], block: 1500, coverage: 0.98, back: 0, family: "box", aspect: [0.32, 0.5], axis: { width: 12, level: "local" }, row: { frontage: [8, 16], depth: [16, 26], gap: 0.5 }, into: true, profile: "flat", building: (f) => (f >= 6 ? "office" : "shop") },
  centre: { soft: 15, era: "modern", cap: 300, hint: "a modern commercial centre: a mall podium with towers rising from it, a plaza with a screen in front", radius: [70, 150], height: [12, 100], lot: [400, 1200], block: 4000, coverage: 0.95, back: 2, family: "blob", into: true, profile: "flat", building: (f) => (f >= 12 ? "tower" : f >= 4 ? "mall" : "shop") },
  avenue: { soft: 15, era: "modern", cap: 400, hint: "an avenue: a boulevard down its middle, offices and towers facing it", radius: [80, 160], height: [20, 120], lot: [800, 2400], block: 5000, coverage: 0.95, back: 3, family: "box", aspect: [0.34, 0.5], axis: { width: 36, level: "boulevard" }, row: { frontage: [30, 60], depth: [35, 55], gap: 8 }, into: true, profile: "flat", building: (f) => (f >= 20 ? "skyscraper" : f >= 8 ? "tower" : "office") },
  square: { soft: 12, era: "modern", cap: 80, hint: "a square: open ground with a monument, buildings ringing it", radius: [50, 120], height: [6, 40], lot: [300, 900], block: 3000, coverage: 0.95, back: 1, family: "blob", row: { frontage: [14, 26], depth: [14, 22], gap: 2 }, into: true, profile: "flat", building: (f) => (f >= 6 ? "office" : "shop") },
  station: { soft: 12, era: "modern", cap: 120, hint: "a station front: the station hall, a plaza and bus bays before it, shops round it", radius: [70, 140], height: [10, 60], lot: [400, 1000], block: 3500, coverage: 0.95, back: 2, family: "box", aspect: [0.5, 0.8], into: true, profile: "flat", building: (f) => (f >= 6 ? "office" : "shop") },
  alley: { soft: 6, era: "modern", cap: 30, hint: "an alley: a lane a few metres wide, tiny lots, low and dense", radius: [40, 100], height: [3, 12], lot: [40, 120], block: 600, coverage: 0.99, back: 0, family: "box", aspect: [0.32, 0.45], axis: { width: 4, level: "local" }, narrow: 0.5, row: { frontage: [4, 9], depth: [6, 12], gap: 0 }, profile: "flat", building: (f) => (f >= 3 ? "house" : "shop") },
  terrace: { soft: 15, era: "modern", cap: 60, hint: "a residential street: flats and houses on both sides of it", radius: [60, 140], height: [6, 25], lot: [200, 500], block: 3000, coverage: 0.9, back: 3, family: "box", aspect: [0.34, 0.5], axis: { width: 8, level: "local" }, row: { frontage: [10, 20], depth: [12, 20], gap: 4 }, profile: "flat", building: (f) => (f >= 5 ? "apartment" : "house") },
  waterfront: { soft: 10, era: "modern", cap: 40, hint: "a waterfront: water down its length, a bridge across, warehouses and walks on the banks", radius: [60, 150], height: [4, 15], lot: [400, 1500], block: 6000, coverage: 0.6, back: 8, family: "box", aspect: [0.4, 0.6], band: 0.32, row: { frontage: [24, 50], depth: [18, 30], gap: 10 }, into: true, profile: "low", building: () => "warehouse" },
  farm: { soft: 15, era: "ancient", cap: 10, hint: "farmland: wide fields with a few farmhouses", radius: [180, 320], height: [3, 6], lot: [7000, 16000], block: 60000, coverage: 0.12, back: 6, family: "box", profile: "low", building: () => "farmhouse" },
};

/**
 * A manifold: how a part's heights spread over its ground round the median Jev gives it (the user's calls, 2026-10-31:
 * every level's kinds have their own manifold; no hard caps; docs/v2/visual-context-engine.md §5.8). The local median
 * falls from the core to the edge as (r + core)^−gradient (r: 0 at the core, 1 at the edge), scaled so the median over
 * the patch's area is Jev's; a building is log-normal round it (σ = spread), or, one in 1/tail, from a Pareto tail of
 * index `index` above the local 90th percentile. Research: height falls with distance as a power (elasticity −0.25 to
 * −0.3 city-wide, steeper for commercial), heights are log-normal with a heavy Pareto tail (shape about 0.2).
 */
export interface Manifold { gradient: number; core: number; spread: number; tail: number; index: number }
/**
 * One patch of landscape, everything needed to draw it again: the numbers drawn for its shape are kept, not re-drawn.
 * `median` and `manifold`, where terrain spawning gave them: its heights are drawn from them, with no cap.
 */
export interface Patch {
  id: string; type: LandscapeType; x: number; z: number; R: number; H: number; lot: number; median?: number; manifold?: Manifold;
  /** A pool's member's ground, borrowed from the pool's default where it stands: it claims lots before the default does. */
  borrowed?: boolean;
  shape: { family: Family; turn: number; terms?: [number, number, number][]; n?: number; aspect?: number; m?: number };
  born?: { strand?: string; volume?: number; scene?: string; by?: "jev" | "drift" | "strand" };
}
/** A place's landscape: its patches in its own frame (centre at the origin), oldest first. */
export interface Landscape { version: number; seed: string; patches: Patch[] }

const between = (rng: () => number, [low, high]: [number, number]) => low + (high - low) * rng();
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Draw a patch of a type: its size, height, lot size and the shape of its outline, from the seed. */
export function samplePatch(type: LandscapeType, id: string, seed: string, at: Point = [0, 0], born?: Patch["born"]): Patch {
  const kind = LANDSCAPES[type], rng = skeletonStream(seed, "patch", id, type), family = kind.family, turn = round(rng() * Math.PI * 2);
  const shape: Patch["shape"] = family === "blob" ? { family, turn, terms: [2, 3, 4].map((k) => [k, round((0.35 + 0.65 * rng()) * (type === "skyscrapers" ? 0.12 : 0.24) / (k - 1)), round(rng() * Math.PI * 2)] as [number, number, number]) }
    : family === "lobes" ? { family, turn, m: 3 + Math.floor(rng() * 3), terms: [[2, round(0.08 * rng()), round(rng() * Math.PI * 2)]] }
    : family === "box" ? { family, turn, n: round(3 + 3 * rng(), 2), aspect: round(kind.aspect ? between(rng, kind.aspect) : 0.6 + 0.4 * rng(), 2) }
    : { family, turn, m: [5, 6, 8][Math.floor(rng() * 3)] };
  // Skyscraper peaks are skewed: most cores peak at a few hundred metres, a rare one near 600.
  const R = Math.round(between(rng, kind.radius)), H = Math.round(type === "skyscrapers" ? kind.height[0] + (kind.height[1] - kind.height[0]) * rng() ** 3 : between(rng, kind.height));
  return { id, type, x: round(at[0], 1), z: round(at[1], 1), R, H, lot: Math.round(between(rng, kind.lot)), shape, ...(born ? { born } : {}) };
}

/** The outline's radius over R in direction θ, before normalising (the largest value over θ is scaled to 1). */
function rawRho(shape: Patch["shape"], theta: number): number {
  const t = theta - shape.turn;
  if (shape.family === "blob") return 1 + (shape.terms ?? []).reduce((sum, [k, a, phase]) => sum + a * Math.cos(k * t + phase), 0);
  if (shape.family === "lobes") return 1 + 0.35 * Math.cos((shape.m ?? 4) * t) + (shape.terms ?? []).reduce((sum, [k, a, phase]) => sum + a * Math.cos(k * t + phase), 0);
  if (shape.family === "box") { const n = shape.n ?? 4, b = shape.aspect ?? 1; return 1 / (Math.abs(Math.cos(t)) ** n + Math.abs(Math.sin(t) / b) ** n) ** (1 / n); }
  return 0.82 + 0.18 * Math.abs(Math.cos(((shape.m ?? 6) * t) / 2)) ** 0.6;
}
const outlines = new Map<string, Float64Array>();
/** The outline sampled at 720 directions, scaled so its farthest point is R. */
function outline(patch: Patch): Float64Array {
  const key = JSON.stringify(patch.shape);
  if (!outlines.has(key)) { const raw = Float64Array.from({ length: 720 }, (_, n) => Math.max(0.05, rawRho(patch.shape, (n / 720) * Math.PI * 2))), top = Math.max(...raw); outlines.set(key, raw.map((value) => value / top)); }
  return outlines.get(key)!;
}
/** The outline's distance from the patch centre in the direction of p. */
export const reachOf = (patch: Patch, p: Point) => { const theta = Math.atan2(p[1] - patch.z, p[0] - patch.x), n = ((Math.round((theta / (Math.PI * 2)) * 720) % 720) + 720) % 720; return patch.R * outline(patch)[n]; };
/** Signed distance (approximately): negative inside, zero on the outline. */
export const insideBy = (patch: Patch, p: Point) => reachOf(patch, p) - Math.hypot(p[0] - patch.x, p[1] - patch.z);
/** Depth inside, 1 at the centre and 0 on the outline. */
export const depthOf = (patch: Patch, p: Point) => Math.max(0, Math.min(1, 1 - Math.hypot(p[0] - patch.x, p[1] - patch.z) / reachOf(patch, p)));

/** The patch a point lies inside (by the hard outline): the oldest such. */
export const ownerOf = (landscape: Landscape, p: Point) => landscape.patches.find((patch) => insideBy(patch, p) > 0) ?? null;
/**
 * The probabilistic manifold: how surely a point belongs to a patch, σ(signed distance / softness): about 1 deep
 * inside, ½ on the outline, fading outside over the type's softness (a castle's edge is a wall, a village's fades).
 */
export const membership = (patch: Patch, p: Point) => 1 / (1 + Math.exp(-insideBy(patch, p) / LANDSCAPES[patch.type].soft));
/**
 * Which patch a lot belongs to: drawn in birth order, each patch claiming the lot with its membership's probability
 * (each patch with its own draw for the lot). The first claim wins; with none, the lot is open ground. A newer patch
 * only ever draws for lots every older patch passed over, so it never takes one an older patch has.
 */
/** Patches in the order they claim ground: borrowed ones first (docs/v2/world-engine-v2.md §2.0.12), then by birth. */
export const claimOrder = (landscape: Landscape) => [...landscape.patches.filter((patch) => patch.borrowed), ...landscape.patches.filter((patch) => !patch.borrowed)];
export function ownerOfLot(landscape: Landscape, lot: { id: string; centre: Point }): Patch | null {
  for (const patch of claimOrder(landscape)) if (insideBy(patch, lot.centre) > -fringe(patch) && skeletonStream(landscape.seed, "own", lot.id, patch.id)() < membership(patch, lot.centre)) return patch;
  return null;
}
/**
 * How surely a patch's height manifold reaches a point, for merging: like membership, but fading over the softness
 * plus a tenth of the patch's height, so a 600 m core tapers its skyline over 85 m where a 30 m one tapers over 25.
 */
export const reachOfHeights = (patch: Patch, p: Point) => 1 / (1 + Math.exp(-insideBy(patch, p) / (LANDSCAPES[patch.type].soft + 0.1 * patch.H)));
/** Whether a point lies inside a polygon (ray casting). */
function contains(pts: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > p[1]) !== (pts[j][1] > p[1]) && p[0] < ((pts[j][0] - pts[i][0]) * (p[1] - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  return inside;
}
/** How far past its outline a patch's soft edge can still claim ground: beyond it, nothing. */
function fringe(patch: Patch) { return 3 * LANDSCAPES[patch.type].soft + 10; }
/** The circle that holds the whole landscape, with a margin: it grows as patches are added. */
export const circleOf = (landscape: Landscape, margin = 10) => Math.max(0, ...landscape.patches.map((patch) => Math.hypot(patch.x, patch.z) + patch.R + fringe(patch))) + margin;
/** How far inside the landscape a point is (negative outside): a scene within `margin` of the edge needs a new part. */
export const depthInside = (landscape: Landscape, p: Point) => Math.max(-Infinity, ...landscape.patches.map((patch) => insideBy(patch, p)));

/** Whether two patches' outlines overlap (checked along each one's outline, with a small gap). */
export function overlaps(a: Patch, b: Patch, gap = 6): boolean {
  if (Math.hypot(a.x - b.x, a.z - b.z) > a.R + b.R + gap) return false;
  for (const [p, q] of [[a, b], [b, a]]) for (let n = 0; n < 96; n++) { const t = (n / 96) * Math.PI * 2, r = reachOf(p, [p.x + Math.cos(t), p.z + Math.sin(t)]) + gap; if (insideBy(q, [p.x + r * Math.cos(t), p.z + r * Math.sin(t)]) > 0) return true; }
  return insideBy(a, [b.x, b.z]) > 0 || insideBy(b, [a.x, a.z]) > 0;
}

/** The ground a scale suggests when nothing larger has a landscape: a street of shops, a district or a city of homes (a region is too varied for one). */
export const GROUND_BY_SCALE: Record<string, LandscapeType> = { street: "commercial", district: "residential", city: "residential" };
/**
 * The manifold a place stands on, and who set it: its own landscape (`by` "jev", or "agent" when the main agent answered
 * over Jev's pick); without one, the terrain rules build it as the ground of the nearest larger place that has one (a spot
 * the world made in a park district is park; `from` names that place); else the ground its scale suggests. A pick of
 * "none" (no one landscape) leaves the place bare. `ancestors`: the larger places, nearest first.
 */
export interface Ground { type: LandscapeType | null; by: "jev" | "agent" | "terrain" | "scale" | "none"; from?: string; confidence?: number }
export function groundFor(own: { type: string; by?: string; confidence?: number } | undefined, ancestors: string[], pickOf: (id: string) => { type: string } | undefined, scale: string): Ground {
  if (own?.type === "none") return { type: null, by: "none" };
  if (own) return { type: own.type as LandscapeType, by: own.by === "agent" ? "agent" : "jev", ...(own.confidence !== undefined ? { confidence: own.confidence } : {}) };
  for (const id of ancestors) { const type = pickOf(id)?.type; if (type && type !== "none") return { type: type as LandscapeType, by: "terrain", from: id }; }
  return GROUND_BY_SCALE[scale] ? { type: GROUND_BY_SCALE[scale], by: "scale" } : { type: null, by: "none" };
}

/** A place's first patch, at its centre. */
export const firstLandscape =(seed: string, type: LandscapeType, born?: Patch["born"]): Landscape => ({ version: LANDSCAPE_VERSION, seed, patches: [samplePatch(type, "p0", seed, [0, 0], born)] });
/**
 * A new part against the landscape's edge, toward a point (where a scene drifted, or where a new strand enters):
 * its centre past the edge in that direction by 0.6 of its radius, so it overlaps and joins what is there, and never
 * short of covering that point.
 */
export function addPatch(landscape: Landscape, type: LandscapeType, toward: Point, born?: Patch["born"]): Landscape {
  const id = `p${landscape.patches.length}`, draft = samplePatch(type, id, landscape.seed, [0, 0], born);
  let direction: Point = [toward[0], toward[1]];
  if (Math.hypot(...direction) < 1) { const angle = skeletonStream(landscape.seed, "toward", id)() * Math.PI * 2; direction = [Math.cos(angle), Math.sin(angle)]; }
  const length = Math.hypot(...direction), unit: Point = [direction[0] / length, direction[1] / length];
  let edge = 0;
  for (let t = 0; t < 5000; t += 4) if (landscape.patches.some((patch) => insideBy(patch, [unit[0] * t, unit[1] * t]) > 0)) edge = t;
  // Against the edge, and always over the point that called for it (a scene that drifted far gets its part where it went).
  let distance = Math.max(edge + 0.6 * draft.R, Math.hypot(...toward) - 0.5 * draft.R);
  // Ancient ground never overlaps: an ancient part, or any part beside ancient ground, moves out until it is clear.
  const ancient = (patch: Patch) => LANDSCAPES[patch.type].era === "ancient", clashes = (patch: Patch) => landscape.patches.some((other) => (ancient(patch) || ancient(other)) && overlaps(patch, other));
  let placed = { ...draft, x: round(unit[0] * distance, 1), z: round(unit[1] * distance, 1) };
  while (clashes(placed) && distance < 20000) { distance += 6; placed = { ...draft, x: round(unit[0] * distance, 1), z: round(unit[1] * distance, 1) }; }
  return { ...landscape, patches: [...landscape.patches, placed] };
}

/** A manifold's shape at r (0 at the core, 1 at the edge), and its median over the area (half the area lies within r = 1/√2). */
const shapeOf = (manifold: Manifold, r: number) => (Math.max(0, r) + manifold.core) ** -manifold.gradient;
/** A manifold patch's median at depth s (1 at the centre): Jev's median, by the manifold's shape. */
export const localMedian = (patch: Patch, s: number) => (patch.median ?? patch.H) * shapeOf(patch.manifold!, 1 - s) / shapeOf(patch.manifold!, Math.SQRT1_2);
const gaussian = (rng: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
/** The z of a probability (a logistic approximation, close enough for a profile). */
const probit = (u: number) => Math.log(Math.max(1e-6, u) / Math.max(1e-6, 1 - u)) / 1.702;
/** A building's height on a manifold patch at depth s: log-normal round the local median, or from its Pareto tail; never capped. */
export function manifoldHeight(patch: Patch, s: number, rng: () => number): number {
  const manifold = patch.manifold!, local = localMedian(patch, s);
  if (manifold.tail > 0 && rng() < manifold.tail) return local * Math.exp(1.2816 * manifold.spread) * Math.max(1e-6, rng()) ** (-1 / manifold.index);
  return local * Math.exp(manifold.spread * gaussian(rng));
}
/** The tallest a manifold patch stands: its core's 99th percentile (its landmark). */
export const peakOf = (patch: Patch) => (patch.manifold ? localMedian(patch, 1) * Math.exp(2.326 * patch.manifold.spread) : Math.min(patch.H, PEAK));
/** A patch built from Jev's median on its kind's manifold: its height H is the core's median (for its plots and streets). */
export function withManifold(patch: Patch, median: number, manifold: Manifold): Patch {
  const made = { ...patch, median: Math.round(median), manifold };
  // Underground (a median below the street): nothing stands on it, so its height above the street is none.
  return { ...made, H: underground(made) ? 1 : Math.round(localMedian(made, 1)) };
}
/** A part that lies under the street (its median below 0): its surface is open, its floors a hall that deep (underground.ts). */
export const underground = (patch: Patch) => (patch.median ?? 0) < 0;

/** A building's height in a patch, at depth s (1 at the centre), by the type's profile; `u` is the building's own draw. */
export function heightAt(patch: Patch, s: number, u: number): number {
  if (patch.manifold) return localMedian(patch, s) * Math.exp(patch.manifold.spread * probit(u));
  const kind = LANDSCAPES[patch.type];
  return kind.profile === "core" ? patch.H * (0.22 + 0.78 * s ** 1.4) * (0.75 + 0.5 * u) : kind.profile === "keep" ? patch.H * (0.18 + 0.12 * u) : patch.H * (0.6 + 0.4 * u);
}
/** The height manifold's mean at depth s: the profile without the building's own spread. */
export const meanHeight = (patch: Patch, s: number) => heightAt(patch, s, 0.5);
/** A building's height drawn from a patch's height manifold at depth s: log-normal around the mean (σ = 0.25); a manifold patch's from its own. */
export function drawHeight(patch: Patch, s: number, rng: () => number): number {
  if (patch.manifold) return manifoldHeight(patch, s, rng);
  const normal = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
  return meanHeight(patch, s) * Math.exp(0.25 * normal);
}

/**
 * A lot's size at a point of a patch: the patch's own, or on super-tall ground as large as the height expected there needs
 * (its footprint wide enough for SLENDER), so only the super-tall towers stand on the big plots.
 */
export function lotFor(patch: Patch, p: Point): number {
  const tall = superTallAt(patch, p);
  if (!tall) return patch.lot;
  const side = tall / SLENDER + 2 * LANDSCAPES.skyscrapers.back;
  return Math.max(patch.lot, Math.round(side * side));
}

/**
 * Ground a patch keeps open: a castle's courtyard round its keep; a stadium's bowl and apron; a commercial quarter's
 * plaza at its centre and its boulevard, a wide avenue through the centre along the patch's turn.
 */
export const plazaOf = (patch: Patch) => ({ x: patch.x, z: patch.z, r: Math.max(25, 0.18 * patch.R) });
export function boulevardOf(patch: Patch): Road {
  const u: Point = [Math.cos(patch.shape.turn), Math.sin(patch.shape.turn)], half = 0.85 * patch.R;
  return { id: `BV:${patch.id}`, a: [patch.x - u[0] * half, patch.z - u[1] * half], b: [patch.x + u[0] * half, patch.z + u[1] * half], width: 30, level: "boulevard" };
}
export const bowlOf = (patch: Patch) => ({ x: patch.x, z: patch.z, w: Math.round(0.62 * patch.R), d: Math.round(0.46 * patch.R), angle: patch.shape.turn });

/*
 * The street forms (docs/v2/world-engine-v2.md §2.0.13), in a patch's own frame: `along` its axis (a box's long side), and
 * `across` it. A form is a few rectangles that never overlap (the world stands each as a lot of its own; two over one
 * another would leave one of them out), so a tower rising from a podium is the tower and the podium's wings round it.
 */
const axisOf = (patch: Patch): Point => [Math.cos(patch.shape.turn), Math.sin(patch.shape.turn)];
export function frameOf(patch: Patch, p: Point): { along: number; across: number } {
  const u = axisOf(patch), dx = p[0] - patch.x, dz = p[1] - patch.z;
  return { along: dx * u[0] + dz * u[1], across: -dx * u[1] + dz * u[0] };
}
const at = (patch: Patch, along: number, across: number): Point => { const u = axisOf(patch); return [patch.x + u[0] * along - u[1] * across, patch.z + u[1] * along + u[0] * across]; };
/** How far the ground reaches along the axis, and across it (half the street's width of ground). */
const alongReach = (patch: Patch) => reachOf(patch, at(patch, 1, 0)), acrossReach = (patch: Patch) => reachOf(patch, at(patch, 0, 1));
/** A rectangle of a form as a building: its middle along and across, its length along and depth across. */
const piece = (patch: Patch, lot: string, along: number, across: number, w: number, d: number, floors: number, kind: string): Building => {
  const [x, z] = at(patch, along, across);
  return { lot: `${patch.id}:${lot}`, x: round(x, 1), z: round(z, 1), w: round(Math.max(2, w), 1), d: round(Math.max(2, d), 1), angle: patch.shape.turn, floors: Math.max(1, Math.round(floors)), kind };
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
/** The heights a form's own buildings take: the patch's manifold where it has one (its core's median and upper tail), else its H. */
const coreHeights = (patch: Patch) => {
  const core = patch.manifold ? localMedian(patch, 1) : patch.H, spread = patch.manifold?.spread ?? 0.3;
  return { median: core, high: core * Math.exp(1.2816 * spread), top: core * Math.exp(2.326 * spread) };
};
/** A podium of `w` by `d` with towers rising from it at `along` (each `side` square): the podium's wings round them, 2 m apart. */
function podiumWithTowers(patch: Patch, w: number, d: number, podium: number, towers: { along: number; side: number; floors: number }[]): Building[] {
  const gap = 2, out: Building[] = [], sorted = [...towers].sort((a, b) => a.along - b.along);
  let from = -w / 2;
  sorted.forEach((tower, n) => {
    const start = tower.along - tower.side / 2, end = tower.along + tower.side / 2;
    if (start - gap - from > 4) out.push(piece(patch, `podium${n}`, (from + start - gap) / 2, 0, start - gap - from, d, podium, "mall"));
    out.push(piece(patch, `tower${n}`, tower.along, 0, tower.side, tower.side, tower.floors, "tower"));
    const flank = (d - tower.side) / 2 - gap;
    if (flank > 4) for (const sign of [-1, 1]) out.push(piece(patch, `podium${n}${sign > 0 ? "n" : "s"}`, tower.along, sign * (tower.side / 2 + gap + flank / 2), tower.side, flank, podium, "mall"));
    from = end + gap;
  });
  if (w / 2 - from > 4) out.push(piece(patch, "podiumEnd", (from + w / 2) / 2, 0, w / 2 - from, d, podium, "mall"));
  return out;
}
/** A street's heights fall off with the distance from its road, not from its middle: 1 on the axis, 0 at its edge. */
const axisDepth = (patch: Patch, p: Point) => Math.max(0, Math.min(1, 1 - Math.abs(frameOf(patch, p).across) / Math.max(1, acrossReach(patch))));
/** Where a street's buildings start across its axis: its road's (or its water's) edge, then its setback or promenade. */
const frontOf = (patch: Patch) => { const kind = LANDSCAPES[patch.type]; return (kind.band ? Math.max(8, kind.band * acrossReach(patch)) : (kind.axis?.width ?? 0) / 2) + kind.back; };
const SQUARE = (patch: Patch) => clamp(0.5 * patch.R, 20, 80);
/** How far the city's lots keep from a compound (a centre's podium and plaza, a station's hall): about half a lot. */
const CLEAR = 20;
/** A building of a street's row: its floors drawn from the street's manifold where it stands (from its road, or its square's middle). */
function rowBuilding(patch: Patch, lot: string, along: number, across: number, w: number, d: number, rng: () => number, ring?: number): Building | null {
  const kind = LANDSCAPES[patch.type], [x, z] = ring === undefined ? at(patch, along, across) : [patch.x + Math.cos(along) * across, patch.z + Math.sin(along) * across];
  if (insideBy(patch, [x, z]) < -2 || rng() > kind.coverage) return null;
  const s = kind.axis || kind.band ? axisDepth(patch, [x, z]) : depthOf(patch, [x, z]), floors = Math.max(1, Math.round(drawHeight(patch, Math.max(0.02, s), rng) / 3));
  return { lot: `${patch.id}:${lot}`, x: round(x, 1), z: round(z, 1), w: round(w, 1), d: round(d, 1), angle: ring === undefined ? patch.shape.turn : round(along + Math.PI / 2, 3), floors, kind: kind.building(floors) };
}
/**
 * A street form's own buildings, open ground, roads and water (a street is a designed frontage, not the city's fill: its
 * buildings are laid out by its form, their heights drawn from its manifold, and the city's fill gives way inside it).
 * A shopping street, an avenue, an alley, a terrace: the road down its length and a row of buildings each side, as wide,
 * deep and far apart as its kind; a waterfront: water down its length, a bridge across, warehouses behind a promenade on
 * each bank; a square: open ground with a monument, a ring of buildings facing it; a centre: its mall podium with one or
 * two towers rising from it (its core's upper tail), a plaza before it with a screen; a station front: the long station
 * hall at its back, a plaza and bus bays before it.
 */
export function formOf(patch: Patch, crossing: Road[] = [], ground: Patch[] = []): { buildings: Building[]; plazas: { x: number; z: number; r: number }[]; roads: Road[]; waters: Road[] } {
  const form = { buildings: [] as Building[], plazas: [] as { x: number; z: number; r: number }[], roads: [] as Road[], waters: [] as Road[] }, kind = LANDSCAPES[patch.type];
  if (underground(patch)) return form;
  // A row breaks where one of the city's roads crosses the street, as at a crossing.
  const onRoad = (b: Building) => crossing.some((road) => segmentDistance([b.x, b.z], road.a, road.b) < road.width / 2 + Math.max(b.w, b.d) / 2 + 1);
  // Building into the ground it lands on (docs/v2/world-engine-v2.md §2.0.13): where a building of an `into` street stands
  // on taller ground of its place (its pool's default: a CBD), that ground's tower goes on above it, the street's building
  // its base (shops under a tower); a low street (an alley, a terrace) keeps its own low fabric.
  const into = (b: Building): Building => {
    if (!kind.into) return b;
    const under = ground.find((other) => insideBy(other, [b.x, b.z]) > 0);
    if (!under) return b;
    const floors = Math.max(1, Math.round(drawHeight(under, Math.max(0.02, depthOf(under, [b.x, b.z])), skeletonStream(patch.id, "into", b.lot)) / 3));
    return floors > b.floors ? { ...b, floors, kind: LANDSCAPES[under.type].building(floors), base: { floors: b.floors, kind: b.kind } } : b;
  };
  const long = alongReach(patch), wide = acrossReach(patch), heights = coreHeights(patch), rng = skeletonStream(patch.id, "form", patch.type), push = (b: Building | null) => { if (b && !onRoad(b)) form.buildings.push(into(b)); };
  if (kind.axis) form.roads.push({ id: `AX:${patch.id}`, a: at(patch, -0.97 * long, 0), b: at(patch, 0.97 * long, 0), width: kind.axis.width, level: kind.axis.level });
  if (kind.band) {
    const band = Math.max(8, kind.band * wide);
    form.waters.push({ id: `W:${patch.id}`, a: at(patch, -0.97 * long, 0), b: at(patch, 0.97 * long, 0), width: round(2 * band, 1), level: "local" });
    form.buildings.push(piece(patch, "bridge", 0, 0, 14, 2 * band + 2 * kind.back + 4, 1, "bridge"));
  }
  if (kind.row && (kind.axis || kind.band)) {
    const front = frontOf(patch);
    for (const side of [-1, 1]) {
      let along = -0.95 * long, n = 0;
      while (true) {
        const w = between(rng, kind.row.frontage), d = between(rng, kind.row.depth);
        if (along + w > 0.95 * long) break;
        // The bridge's landing stays clear on a waterfront.
        if (!(kind.band && Math.abs(along + w / 2) < 14)) push(rowBuilding(patch, `row${side > 0 ? "n" : "s"}${n}`, along + w / 2, side * (front + d / 2), w, d, rng));
        along += w + kind.row.gap; n++;
      }
    }
  }
  if (patch.type === "square" && kind.row) {
    const r = SQUARE(patch);
    form.plazas.push({ x: patch.x, z: patch.z, r });
    form.buildings.push(piece(patch, "monument", 0, 0, 8, 8, 3, "monument"));
    let angle = 0, n = 0;
    while (angle < Math.PI * 2 - 0.05) {
      const w = between(rng, kind.row.frontage), d = between(rng, kind.row.depth), radius = r + kind.back + d / 2, step = (w + kind.row.gap) / radius;
      if (angle + step > Math.PI * 2) break;
      push(rowBuilding(patch, `ring${n}`, angle + step / 2, radius, w, d, rng, radius));
      angle += step; n++;
    }
  }
  if (patch.type === "centre") {
    const w = clamp(1.1 * patch.R, 50, 200), d = clamp(0.6 * patch.R, 36, 120), podium = clamp(heights.median, 9, 30) / 3;
    const side = (h: number) => clamp(h / SLENDER, 16, 45), towers = w >= 2 * side(heights.top) + 40
      ? [{ along: -w / 4, side: side(heights.top), floors: heights.top / 3 }, { along: w / 4, side: side(heights.high), floors: heights.high / 3 }]
      : [{ along: 0, side: side(heights.top), floors: heights.top / 3 }];
    form.buildings.push(...podiumWithTowers(patch, w, d, podium, towers));
    const plaza = clamp(0.22 * patch.R, 15, 45), [px, pz] = at(patch, 0, -(d / 2 + plaza + 4));
    form.plazas.push({ x: round(px, 1), z: round(pz, 1), r: plaza });
    form.buildings.push(piece(patch, "screen", 0, -(d / 2 + 2 * plaza + 6), 16, 2, 5, "screen"));
  }
  if (patch.type === "station") {
    const w = clamp(1.2 * patch.R, 60, 220), d = clamp(0.28 * patch.R, 18, 40);
    form.buildings.push(piece(patch, "hall", 0, d / 2 + 4, w, d, clamp(heights.median, 9, 18) / 3, "station"));
    const plaza = clamp(0.25 * patch.R, 15, 45), [px, pz] = at(patch, 0, -(plaza + 6));
    form.plazas.push({ x: round(px, 1), z: round(pz, 1), r: plaza });
  }
  return form;
}
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
};
/** Where a street form stands (its road, water and rows; its square and ring; its compound and plaza): no road of the city's runs inside it. */
function formZone(patch: Patch, p: Point): boolean {
  const kind = LANDSCAPES[patch.type], { across } = frameOf(patch, p);
  if (kind.axis || kind.band) return insideBy(patch, p) > 0 && Math.abs(across) < frontOf(patch) + (kind.row?.depth[1] ?? 0) + 2;
  return insideBy(patch, p) > -2 && streetOpen(patch, p);
}
/**
 * Whether one of the city's roads gives way to a street form: one running along inside it (half its length or more), or
 * one through a square, a compound or a hall. A road that crosses a street stays, and the street's rows break there.
 */
function givesWay(landscape: Landscape, road: Road): boolean {
  const samples = Array.from({ length: 9 }, (_, n) => [road.a[0] + ((n + 1) / 10) * (road.b[0] - road.a[0]), road.a[1] + ((n + 1) / 10) * (road.b[1] - road.a[1])] as Point);
  return landscape.patches.some((patch) => {
    if (!(STREET_TYPES as readonly string[]).includes(patch.type) || underground(patch)) return false;
    const inside = samples.filter((p) => formZone(patch, p)).length, kind = LANDSCAPES[patch.type];
    return kind.axis || kind.band ? inside >= 5 : inside > 0;
  });
}
/** Whether a point is open ground of a street form (the city's fill gives way there): a street's whole ground (its rows are its buildings); a square's ring; a compound and its plaza. */
function streetOpen(patch: Patch, p: Point): boolean {
  const kind = LANDSCAPES[patch.type], { along, across } = frameOf(patch, p), deepest = kind.row?.depth[1] ?? 0;
  if (kind.axis || kind.band) return true;
  if (patch.type === "square") return Math.hypot(along, across) < SQUARE(patch) + kind.back + deepest + 2;
  // A compound keeps the city's lots CLEAR m away, so no building of the fill reaches into it.
  if (patch.type === "centre") {
    const w = clamp(1.1 * patch.R, 50, 200), d = clamp(0.6 * patch.R, 36, 120), plaza = clamp(0.22 * patch.R, 15, 45);
    return (Math.abs(along) < w / 2 + CLEAR && Math.abs(across) < d / 2 + CLEAR) || Math.hypot(along, across + d / 2 + plaza + 4) < plaza + CLEAR || (Math.abs(along) < 12 + CLEAR && across < -d / 2 && across > -(d / 2 + 2 * plaza + 10 + CLEAR));
  }
  if (patch.type === "station") {
    const w = clamp(1.2 * patch.R, 60, 220), d = clamp(0.28 * patch.R, 18, 40), plaza = clamp(0.25 * patch.R, 15, 45);
    return (Math.abs(along) < w / 2 + CLEAR && across > -2 && across < d + 4 + CLEAR) || Math.hypot(along, across + plaza + 6) < plaza + CLEAR;
  }
  return false;
}

/** A skyscraper core's signature tower at its centre: as tall as the core's peak, H / SLENDER wide, with open ground round it. */
export const landmarkOf = (patch: Patch) => { const peak = peakOf(patch), side = Math.max(30, Math.round(peak / SLENDER)); return { x: patch.x, z: patch.z, w: side, d: side, angle: patch.shape.turn, floors: Math.round(peak / 3) }; };
function openGround(patch: Patch, p: Point): boolean {
  if ((STREET_TYPES as readonly string[]).includes(patch.type)) return streetOpen(patch, p);
  const from: Point = [p[0] - patch.x, p[1] - patch.z];
  if (patch.type === "castle") return Math.hypot(...from) < 22;
  if (patch.type === "skyscrapers") return Math.hypot(...from) < landmarkOf(patch).w * 0.71 + 15;
  if (patch.type === "stadium") { const bowl = bowlOf(patch), c = Math.cos(-bowl.angle), s = Math.sin(-bowl.angle), x = from[0] * c - from[1] * s, z = from[0] * s + from[1] * c; return (x / (bowl.w / 2 + 25)) ** 2 + (z / (bowl.d / 2 + 25)) ** 2 < 1; }
  if (patch.type === "commercial") {
    if (Math.hypot(...from) < plazaOf(patch).r) return true;
    const u: Point = [Math.cos(patch.shape.turn), Math.sin(patch.shape.turn)], along = from[0] * u[0] + from[1] * u[1], across = Math.abs(-from[0] * u[1] + from[1] * u[0]);
    return Math.abs(along) < 0.85 * patch.R && across < 15 + 6;
  }
  return false;
}

/** How each type fills: the lot size, which lots, and each lot's building by the patch's height profile. */
export function landscapeStyle(landscape: Landscape): FillStyle {
  // Ground is cut by the oldest patch that reaches any of it: a super-block to that patch's block size, a block to its
  // lot size. So a newer patch never re-cuts ground an older one already reaches.
  const reaching = (region: { centre: Point; pts: Point[] }) => claimOrder(landscape).find((patch) => [region.centre, ...region.pts].some((p) => insideBy(patch, p) > -fringe(patch))) ?? null;
  return {
    // A super-block is cut to the largest lot any of it needs (the core's middle needs the biggest plots).
    blockArea: (superBlock) => { const patch = reaching(superBlock); return !patch ? 5200 : Math.max(LANDSCAPES[patch.type].block, 3 * Math.max(...[superBlock.centre, centroid(superBlock.pts), ...superBlock.pts, ...(contains(superBlock.pts, [patch.x, patch.z]) ? [[patch.x, patch.z] as Point] : [])].filter((p) => insideBy(patch, p) > -fringe(patch)).map((p) => lotFor(patch, p)))); },
    // Streets widen round super-tall ground anywhere in the super-block (its middle, its corners, the core's own middle).
    roadWidth: (superBlock) => { const patch = reaching(superBlock); return patch ? (LANDSCAPES[patch.type].narrow ?? 1) * Math.max(...[superBlock.centre, centroid(superBlock.pts), ...superBlock.pts, ...(contains(superBlock.pts, [patch.x, patch.z]) ? [[patch.x, patch.z] as Point] : [])].map((p) => streetsFor(patch, p))) : 1; },
    // A block touching super-tall ground is cut into its big plots; any other into the type's own.
    lotArea: (block) => { const patch = reaching(block); return patch ? Math.max(...[block.centre, ...block.pts].map((p) => lotFor(patch, p))) : null; },
    keep: (lot) => { const owner = ownerOfLot(landscape, lot); return !!owner && !underground(owner) && !openGround(owner, lot.centre); },
    building: (lot, rng) => {
      const owner = ownerOfLot(landscape, lot)!, kind = LANDSCAPES[owner.type];
      if (rng() > kind.coverage) return null;
      // Merging two height manifolds: a lot of a modern part draws its height from older modern ground beside it with
      // the chance that ground's height manifold reaches it (the older patch passed over this lot, but its heights
      // still reach it: farther for a taller core), else from its own. So heights meet across the seam, past this type's cap if the older ground is
      // taller, never past the peak. Only the newer part's lots draw this way; the older part's never change.
      let from = owner, cap = kind.cap;
      if (kind.era === "modern") for (const older of landscape.patches.slice(0, landscape.patches.indexOf(owner))) {
        if (LANDSCAPES[older.type].era === "modern" && rng() < reachOfHeights(older, lot.centre)) { from = older; cap = Math.max(cap, LANDSCAPES[older.type].cap); break; }
      }
      // No taller than SLENDER times its footprint's width: tall buildings need wide lots.
      const width = Math.max(4, Math.sqrt(lot.area) - 2 * kind.back), h = drawHeight(from, Math.max(0.02, LANDSCAPES[from.type].axis || LANDSCAPES[from.type].band ? axisDepth(from, lot.centre) : depthOf(from, lot.centre)), rng);
      // A manifold's heights are its own: no type cap, no peak, no cut for the lot (tall ground has wider plots already).
      const floors = Math.max(1, Math.round((from.manifold ? h : Math.min(h, cap, PEAK, SLENDER * width)) / 3));
      return { floors, kind: LANDSCAPES[from.type].building(floors), back: kind.back };
    },
    road: (road, faced) => !givesWay(landscape, road) && (faced || landscape.patches.some((patch) => insideBy(patch, [(road.a[0] + road.b[0]) / 2, (road.a[1] + road.b[1]) / 2]) > -LANDSCAPES[patch.type].soft)),
  };
}

/** landmarks: a stadium's bowl, a plaza's fountain; plazas: open squares (a centre and radius). */
export interface LandscapeFill { fabric: Fabric; owner: Record<string, string>; walls: [Point, Point][]; keeps: Building[]; landmarks: Building[]; plazas: { x: number; z: number; r: number }[]; radius: number; waters: Road[] }
/** A place's ground filled from its landscape (and a window of it, when given): the fabric, which patch owns each lot, and castles' walls and keeps. */
export function fillLandscape(landscape: Landscape, window?: { x0: number; z0: number; x1: number; z1: number }): LandscapeFill {
  const radius = circleOf(landscape), fabric = materialize({ seed: landscape.seed, r0: radius, r: radius }, window, undefined, landscapeStyle(landscape));
  const owner = Object.fromEntries(fabric.lots.map((lot) => [lot.id, ownerOfLot(landscape, lot)!.id]));
  const walls: [Point, Point][] = [], keeps: Building[] = [], landmarks: Building[] = [], plazas: { x: number; z: number; r: number }[] = [], waters: Road[] = [];
  for (const patch of landscape.patches) {
    if (underground(patch)) continue;
    // The ground a street lands on: its place's own modern ground (the pool's default), not another street.
    const ground = landscape.patches.filter((other) => other !== patch && !other.borrowed && !underground(other) && LANDSCAPES[other.type].era === "modern" && !(STREET_TYPES as readonly string[]).includes(other.type));
    if ((STREET_TYPES as readonly string[]).includes(patch.type)) { const form = formOf(patch, fabric.roads.filter((road) => road.level !== "boulevard"), ground); landmarks.push(...form.buildings); plazas.push(...form.plazas); fabric.roads.push(...form.roads); waters.push(...form.waters); continue; }
    if (patch.type === "skyscrapers") landmarks.push({ lot: `${patch.id}:landmark`, ...landmarkOf(patch), kind: "skyscraper" });
    if (patch.type === "stadium") { const bowl = bowlOf(patch); landmarks.push({ lot: `${patch.id}:bowl`, x: bowl.x, z: bowl.z, w: bowl.w, d: bowl.d, angle: bowl.angle, floors: Math.round(patch.H / 3), kind: "stadium" }); }
    if (patch.type === "commercial") { const plaza = plazaOf(patch); plazas.push(plaza); landmarks.push({ lot: `${patch.id}:fountain`, x: plaza.x, z: plaza.z, w: 16, d: 16, angle: 0, floors: 3, kind: "fountain" }); fabric.roads.push(boulevardOf(patch)); }
  }
  for (const patch of landscape.patches.filter((entry) => entry.type === "castle")) {
    const ring = Array.from({ length: 64 }, (_, n) => { const theta = (n / 64) * Math.PI * 2, r = 0.97 * reachOf(patch, [patch.x + Math.cos(theta), patch.z + Math.sin(theta)]); return [patch.x + r * Math.cos(theta), patch.z + r * Math.sin(theta)] as Point; });
    // Walls only where this castle owns its outline (an older patch overlapping it keeps its own ground).
    ring.forEach((p, n) => { const q = ring[(n + 1) % ring.length]; if (ownerOf(landscape, p)?.id === patch.id || !ownerOf(landscape, p)) walls.push([p, q]); });
    keeps.push({ lot: `${patch.id}:keep`, x: patch.x, z: patch.z, w: 16, d: 16, angle: patch.shape.turn, floors: Math.round(Math.min(patch.H, LANDSCAPES.castle.cap) / 3), kind: "keep" });
  }
  // A landmark of the ground (a CBD's tallest tower) that a street landed on moves just clear of the street's form, across
  // its axis or out beyond a square's ring: the tower is kept, the street stays open (the street rearranges what is there).
  const streets = landscape.patches.filter((patch) => (STREET_TYPES as readonly string[]).includes(patch.type) && !underground(patch)), moved: Building[] = [];
  for (const landmark of landmarks) {
    if (landmark.lot.includes(":row") || landmark.lot.includes(":ring") || streets.some((patch) => landmark.lot.startsWith(`${patch.id}:`))) continue;
    for (const patch of streets) {
      if (!formZone(patch, [landmark.x, landmark.z])) continue;
      const kind = LANDSCAPES[patch.type], half = Math.max(landmark.w, landmark.d) / 2 + 4;
      moved.push(landmark);
      if (kind.axis || kind.band) {
        const { along, across } = frameOf(patch, [landmark.x, landmark.z]), clear = frontOf(patch) + (kind.row?.depth[1] ?? 0) + 2 + half;
        [landmark.x, landmark.z] = at(patch, along, (across < 0 ? -1 : 1) * clear).map((value) => round(value, 1)) as Point;
      } else {
        const dx = landmark.x - patch.x, dz = landmark.z - patch.z, d = Math.hypot(dx, dz) || 1, clear = (patch.type === "square" ? SQUARE(patch) + kind.back + (kind.row?.depth[1] ?? 0) : 1.1 * patch.R) + 2 + half;
        landmark.x = round(patch.x + ((d > 1 ? dx : 1) / (d > 1 ? d : 1)) * clear, 1); landmark.z = round(patch.z + ((d > 1 ? dz : 0) / (d > 1 ? d : 1)) * clear, 1);
      }
    }
  }
  // Where a landmark moved to, the city's buildings under it give way.
  if (moved.length) fabric.buildings = fabric.buildings.filter((b) => !moved.some((landmark) => Math.hypot(b.x - landmark.x, b.z - landmark.z) < (Math.max(landmark.w, landmark.d) + Math.max(b.w, b.d)) / 2 + 4));
  return { fabric, owner, walls, keeps, landmarks, plazas, radius, waters };
}

/** The question Jev answers for a place: which landscape its ground is, from what the analysis knows of it. */
export const LANDSCAPE_HINTS: Record<LandscapeType | "none", string> = { ...Object.fromEntries(LANDSCAPE_TYPES.map((type) => [type, `${type}: ${LANDSCAPES[type].hint}`])) as Record<LandscapeType, string>, none: "none: not open ground (a single building, a room, the sky, the sea)" };

/**
 * A place beside others (a district by its city's filled centre): the nearest spot to the middle, in the direction of
 * `toward` when given, where its circle clears every circle already there by a gap. The enclosing place's circle
 * then grows to hold it; nothing already placed moves.
 */
export function placeBeside(occupied: { x: number; z: number; r: number }[], r: number, seed: string, toward?: Point, gap = 12): { x: number; z: number; r: number } {
  const turn = toward && Math.hypot(...toward) > 1 ? Math.atan2(toward[1], toward[0]) : skeletonStream(seed, "beside")() * Math.PI * 2;
  for (let d = 0; d < 20000; d += 6) for (let k = 0; k < 48; k++) {
    // Try the preferred direction first, then fan out to both sides of it.
    const angle = turn + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 24), c = { x: Math.cos(angle) * d, z: Math.sin(angle) * d, r };
    if (occupied.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= o.r + r + gap)) return { x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, r };
  }
  return { x: 0, z: 0, r };
}

/** A box on the map, in metres: x across, z down the map (north up). */
export interface MapBox { x0: number; z0: number; x1: number; z1: number }
/** Where a district (or larger) starts before Jev has looked: a box at its parent's centre, as wide as its type usually is. */
export function defaultBox(type: LandscapeType, centre: Point = [0, 0]): MapBox {
  const r = (LANDSCAPES[type].radius[0] + LANDSCAPES[type].radius[1]) / 2;
  return { x0: centre[0] - r, z0: centre[1] - r, x1: centre[0] + r, z1: centre[1] + r };
}
/**
 * A patch from a box Jev drew: centred in it and as large as fits it (its shorter side, or both for the boxy
 * families, which take the box's proportions), its outline still drawn from its own seed.
 */
export function patchFromBox(type: LandscapeType, id: string, seed: string, box: MapBox, born?: Patch["born"], made?: { median: number; manifold: Manifold } | null): Patch {
  const draft = samplePatch(type, id, seed, [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2], born), w = Math.abs(box.x1 - box.x0), d = Math.abs(box.z1 - box.z0);
  const R = Math.round(Math.max(40, Math.min(1500, LANDSCAPES[type].family === "box" ? Math.max(w, d) / 2 : Math.min(w, d) / 2)));
  const shape = LANDSCAPES[type].family === "box" ? { ...draft.shape, turn: w >= d ? 0 : Math.PI / 2, aspect: round(Math.max(0.3, Math.min(w, d) / Math.max(w, d)), 2) } : draft.shape;
  const patch = { ...draft, R, shape };
  return made ? withManifold(patch, made.median, made.manifold) : patch;
}
