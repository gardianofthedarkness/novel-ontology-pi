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
export type LandscapeType = (typeof LANDSCAPE_TYPES)[number];

type Family = "blob" | "lobes" | "box" | "fort";
/**
 * era: modern landscapes may overlap one another and merge at any height (a new part's buildings rise or fall to meet
 * its older neighbour at the seam); ancient ones (a castle, a village, farmland) never overlap anything, and keep
 * their height cap. cap: the tallest a building of the type may be, in metres; skyscrapers may peak at 1,000 m.
 */
/** soft: how far the edge fades, in metres: a lot at signed distance d from the outline belongs with probability σ(d / soft). */
interface Kind { hint: string; era: "modern" | "ancient"; soft: number; radius: [number, number]; height: [number, number]; cap: number; lot: [number, number]; block: number; coverage: number; back: number; family: Family; profile: "core" | "flat" | "low" | "keep"; building: (floors: number) => string }
/** The tallest any building may be (a skyscraper core's peak): a modern merge may lift a building past its own type's cap, never past this. */
export const PEAK = 600;
/** How many times its footprint's width a building may be tall: a 600 m tower stands on a lot about 80 m across. */
export const SLENDER = 8;
/** How much wider a tall core's streets are: busier ground, 1 + H/400 (2.5 times around a 600 m core). */
export const streetsFor = (patch: Patch) => (patch.type === "skyscrapers" ? 1 + patch.H / 400 : 1);
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
  farm: { soft: 15, era: "ancient", cap: 10, hint: "farmland: wide fields with a few farmhouses", radius: [180, 320], height: [3, 6], lot: [7000, 16000], block: 60000, coverage: 0.12, back: 6, family: "box", profile: "low", building: () => "farmhouse" },
};

/** One patch of landscape, everything needed to draw it again: the numbers drawn for its shape are kept, not re-drawn. */
export interface Patch {
  id: string; type: LandscapeType; x: number; z: number; R: number; H: number; lot: number;
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
    : family === "box" ? { family, turn, n: round(3 + 3 * rng(), 2), aspect: round(0.6 + 0.4 * rng(), 2) }
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
export function ownerOfLot(landscape: Landscape, lot: { id: string; centre: Point }): Patch | null {
  for (const patch of landscape.patches) if (insideBy(patch, lot.centre) > -fringe(patch) && skeletonStream(landscape.seed, "own", lot.id, patch.id)() < membership(patch, lot.centre)) return patch;
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

/** A place's first patch, at its centre. */
export const firstLandscape = (seed: string, type: LandscapeType, born?: Patch["born"]): Landscape => ({ version: LANDSCAPE_VERSION, seed, patches: [samplePatch(type, "p0", seed, [0, 0], born)] });
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

/** A building's height in a patch, at depth s (1 at the centre), by the type's profile; `u` is the building's own draw. */
export function heightAt(patch: Patch, s: number, u: number): number {
  const kind = LANDSCAPES[patch.type];
  return kind.profile === "core" ? patch.H * (0.22 + 0.78 * s ** 1.4) * (0.75 + 0.5 * u) : kind.profile === "keep" ? patch.H * (0.18 + 0.12 * u) : patch.H * (0.6 + 0.4 * u);
}
/** The height manifold's mean at depth s: the profile without the building's own spread. */
export const meanHeight = (patch: Patch, s: number) => heightAt(patch, s, 0.5);
/** A building's height drawn from a patch's height manifold at depth s: log-normal around the mean (σ = 0.25). */
export function drawHeight(patch: Patch, s: number, rng: () => number): number {
  const normal = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
  return meanHeight(patch, s) * Math.exp(0.25 * normal);
}

/**
 * A lot's size at a point of a patch: the patch's own, or for a skyscraper core as large as the height expected there
 * needs (its footprint wide enough for SLENDER), so the core's plots are the big ones.
 */
export function lotFor(patch: Patch, p: Point): number {
  if (patch.type !== "skyscrapers") return patch.lot;
  // Plots are planned for the tallest towers likely there, a broader plateau than the mean profile.
  const tall = patch.H * (0.4 + 0.6 * depthOf(patch, p)), side = tall / SLENDER + 2 * LANDSCAPES.skyscrapers.back;
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
/** A skyscraper core's signature tower at its centre: as tall as the core's peak, H / SLENDER wide, with open ground round it. */
export const landmarkOf = (patch: Patch) => { const side = Math.max(30, Math.round(patch.H / SLENDER)); return { x: patch.x, z: patch.z, w: side, d: side, angle: patch.shape.turn, floors: Math.round(Math.min(patch.H, PEAK) / 3) }; };
function openGround(patch: Patch, p: Point): boolean {
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
  const reaching = (region: { centre: Point; pts: Point[] }) => landscape.patches.find((patch) => [region.centre, ...region.pts].some((p) => insideBy(patch, p) > -fringe(patch))) ?? null;
  return {
    // A super-block is cut to the largest lot any of it needs (the core's middle needs the biggest plots).
    blockArea: (superBlock) => { const patch = reaching(superBlock); return !patch ? 5200 : Math.max(LANDSCAPES[patch.type].block, 3 * Math.max(...[superBlock.centre, centroid(superBlock.pts), ...superBlock.pts, ...(contains(superBlock.pts, [patch.x, patch.z]) ? [[patch.x, patch.z] as Point] : [])].filter((p) => insideBy(patch, p) > -fringe(patch)).map((p) => lotFor(patch, p)))); },
    roadWidth: (superBlock) => { const patch = reaching(superBlock); return patch ? streetsFor(patch) : 1; },
    lotArea: (block) => { const patch = reaching(block); return patch ? lotFor(patch, block.centre) : null; },
    keep: (lot) => { const owner = ownerOfLot(landscape, lot); return !!owner && !openGround(owner, lot.centre); },
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
      const width = Math.max(4, Math.sqrt(lot.area) - 2 * kind.back), h = drawHeight(from, Math.max(0.02, depthOf(from, lot.centre)), rng);
      const floors = Math.max(1, Math.round(Math.min(h, cap, PEAK, SLENDER * width) / 3));
      return { floors, kind: LANDSCAPES[from.type].building(floors), back: kind.back };
    },
    road: (road, faced) => faced || landscape.patches.some((patch) => insideBy(patch, [(road.a[0] + road.b[0]) / 2, (road.a[1] + road.b[1]) / 2]) > -LANDSCAPES[patch.type].soft),
  };
}

/** landmarks: a stadium's bowl, a plaza's fountain; plazas: open squares (a centre and radius). */
export interface LandscapeFill { fabric: Fabric; owner: Record<string, string>; walls: [Point, Point][]; keeps: Building[]; landmarks: Building[]; plazas: { x: number; z: number; r: number }[]; radius: number }
/** A place's ground filled from its landscape (and a window of it, when given): the fabric, which patch owns each lot, and castles' walls and keeps. */
export function fillLandscape(landscape: Landscape, window?: { x0: number; z0: number; x1: number; z1: number }): LandscapeFill {
  const radius = circleOf(landscape), fabric = materialize({ seed: landscape.seed, r0: radius, r: radius }, window, undefined, landscapeStyle(landscape));
  const owner = Object.fromEntries(fabric.lots.map((lot) => [lot.id, ownerOfLot(landscape, lot)!.id]));
  const walls: [Point, Point][] = [], keeps: Building[] = [], landmarks: Building[] = [], plazas: { x: number; z: number; r: number }[] = [];
  for (const patch of landscape.patches) {
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
  return { fabric, owner, walls, keeps, landmarks, plazas, radius };
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
export function patchFromBox(type: LandscapeType, id: string, seed: string, box: MapBox, born?: Patch["born"]): Patch {
  const draft = samplePatch(type, id, seed, [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2], born), w = Math.abs(box.x1 - box.x0), d = Math.abs(box.z1 - box.z0);
  const R = Math.round(Math.max(40, Math.min(1500, LANDSCAPES[type].family === "box" ? Math.max(w, d) / 2 : Math.min(w, d) / 2)));
  const shape = LANDSCAPES[type].family === "box" ? { ...draft.shape, turn: w >= d ? 0 : Math.PI / 2, aspect: round(Math.max(0.3, Math.min(w, d) / Math.max(w, d)), 2) } : draft.shape;
  return { ...draft, R, shape };
}
