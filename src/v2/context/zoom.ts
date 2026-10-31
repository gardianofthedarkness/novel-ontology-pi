/**
 * The zoom engine (docs/v2/visual-context-engine.md §4.1, the user's design, 2026-10-31): the one layer of the visual
 * context engine that decides what area Jev looks at and at what scale. Every frame a question is shown and every box Jev
 * answers goes through it: the scale ladder (each level's sizes and parent), extents (an area's kept box, never its canvas
 * circle where anything better is known), the frames (context and work), tags by tier, the free space to build in, and the
 * sanity of a box. Code only: it never calls a model. Boxes are [x0, z0, x1, z1] in world metres.
 */
export type Box = [number, number, number, number];
export type Level = "city" | "district" | "street" | "building";

/** Each level's sizes (metres across, least and most) and the level above it. */
export const LADDER: Record<Level, { sizes: [number, number]; parent: Level | null }> = {
  city: { sizes: [800, 8000], parent: null },
  district: { sizes: [300, 2400], parent: "city" },
  street: { sizes: [40, 400], parent: "district" },
  building: { sizes: [8, 80], parent: "street" },
};
/** How much of a work frame a part's usual size should take: about a sixth, never under a twelfth nor over a third. */
export const SHARE = { aim: 1 / 6, least: 1 / 12, most: 1 / 3 };
/** A part may take at most this share of its parent's area. */
export const MOST_OF_PARENT = 1 / 3;

const round = (value: number) => Math.round(value * 10) / 10;
export const widthOf = (box: Box) => box[2] - box[0];
export const depthOf = (box: Box) => box[3] - box[1];
export const middleOf = (box: Box): [number, number] => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
export const areaOf = (box: Box) => Math.max(0, widthOf(box)) * Math.max(0, depthOf(box));
export const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
export const inside = (box: Box, [x, z]: [number, number]) => x > box[0] && x < box[2] && z > box[1] && z < box[3];
/** The span of several boxes, with a margin all round (a share of the span's larger side); null for none. */
export function spanOf(boxes: Box[], margin = 0): Box | null {
  if (!boxes.length) return null;
  const span: Box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const pad = margin * Math.max(widthOf(span), depthOf(span));
  return [round(span[0] - pad), round(span[1] - pad), round(span[2] + pad), round(span[3] + pad)];
}
/** The part of a box inside another; null when they do not meet. */
export function clip(box: Box, within: Box): Box | null {
  const out: Box = [Math.max(box[0], within[0]), Math.max(box[1], within[1]), Math.min(box[2], within[2]), Math.min(box[3], within[3])];
  return out[0] < out[2] && out[1] < out[3] ? out : null;
}

/** An area's extent and how it is known: its kept box, the span of its kept parts, or its canvas circle (a guess). */
export interface Extent { box: Box; by: "kept" | "parts" | "circle" }
/**
 * An area's extent: its kept box (Jev's, or a book before's), else the span of its kept parts (`margin` more all round: a
 * tenth, a city's more, for what lies between and round its districts), else its canvas circle, a guess; null with none.
 */
export function extentOf(kept: Box | null | undefined, parts: Box[], circle?: { x: number; z: number; r: number } | null, margin = 0.1): Extent | null {
  if (kept) return { box: kept, by: "kept" };
  const span = spanOf(parts, margin);
  if (span) return { box: span, by: "parts" };
  return circle ? { box: [round(circle.x - circle.r), round(circle.z - circle.r), round(circle.x + circle.r), round(circle.z + circle.r)], by: "circle" } : null;
}
/**
 * A sampling pool's extent: the span of the members Jev boxed in it (a fifth more all round), within its holder's extent;
 * null when none is boxed (its default ground then stands nowhere: never a sampled square).
 */
export function poolExtent(members: Box[], holder: Box | null): Box | null {
  const span = spanOf(members, 0.2);
  if (!span) return null;
  return holder ? clip(span, holder) ?? span : span;
}

/** A frame: a square of the world straight down (its middle and half side), its level and what it is for. */
export interface Frame { x: number; z: number; half: number; level: Level; purpose: "context" | "work" | "detail"; tag: number }
/** A part's usual size at its level (the geometric mean of the level's sizes), unless its kind gives one. */
export const usualSize = (level: Level, kind?: number) => kind ?? Math.sqrt(LADDER[level].sizes[0] * LADDER[level].sizes[1]);
/** The size of a frame's tags: its half side over 24, scaled by what they name (tagScale). */
const tagOf = (half: number) => round(half / 24);
/**
 * The frames for a part (its level, its suggested spot, its parent's extent and its usual size): a work frame in which the
 * usual size takes about a sixth (kept within the parent where the parent is larger), and, when the parent does not fit it
 * at that scale, a context frame of the parent's extent and a margin. One frame (`work` only) when the parent fits.
 */
export function framesFor(level: Level, spot: [number, number], parent: Box | null, size = usualSize(level), both = false): { work: Frame; context: Frame | null } {
  let half = size / SHARE.aim / 2;
  if (parent) {
    const parentHalf = Math.max(widthOf(parent), depthOf(parent)) / 2 * 1.1, [px, pz] = middleOf(parent);
    // The parent fits while the part still takes at least a twelfth: one frame, the whole parent (unless `both` are wanted:
    // two zooms at a time, the whole area and the part's own scale, the user's call).
    if (!both && parentHalf <= size / SHARE.least / 2) return { work: { x: round(px), z: round(pz), half: round(Math.max(parentHalf, half)), level, purpose: "work", tag: tagOf(Math.max(parentHalf, half)) }, context: null };
    // Else the work frame at the part's scale, kept inside the parent, and the parent as its context.
    const keep = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high));
    const x = keep(spot[0], parent[0] + half, parent[2] - half), z = keep(spot[1], parent[1] + half, parent[3] - half);
    // The context is always the bigger picture: the whole parent, and at least two and a half times the work frame.
    const wide = Math.max(parentHalf, half * 2.5);
    return { work: { x: round(x), z: round(z), half: round(half), level, purpose: "work", tag: tagOf(half) }, context: { x: round(px), z: round(pz), half: round(wide), level: LADDER[level].parent ?? level, purpose: "context", tag: tagOf(wide) } };
  }
  half = Math.max(half, size);
  return { work: { x: round(spot[0]), z: round(spot[1]), half: round(half), level, purpose: "work", tag: tagOf(half) }, context: null };
}
/** A detail frame round a proposed box: as wide as the box (at least its level's least size), a little more. */
export function detailFrame(box: Box, level: Level): Frame {
  const half = Math.max(LADDER[level].sizes[0], widthOf(box), depthOf(box)) * 0.95, [x, z] = middleOf(box);
  return { x: round(x), z: round(z), half: round(half), level, purpose: "detail", tag: tagOf(half) };
}
/** How large a tag is drawn, by what it names against the part asked about: the parent's level largest, then the part's own. */
export function tagScale(named: Level | null, part: Level, own = false): number {
  if (own) return 1.5;
  if (!named) return 0.8;
  const rank = (level: Level) => ["building", "street", "district", "city"].indexOf(level);
  return rank(named) > rank(part) ? 2.2 : rank(named) === rank(part) ? 1 : 0.7;
}

/**
 * The free space in a frame: the cells of a grid over it (`cells` a side) inside the parent's extent and under none of the
 * `taken` boxes, merged into rectangles row by row; and the largest free rectangle among them.
 */
export function freeSpace(frame: Frame, parent: Box | null, taken: Box[], cells = 32): { rects: Box[]; largest: Box | null } {
  const size = (2 * frame.half) / cells, x0 = frame.x - frame.half, z0 = frame.z - frame.half, free: boolean[][] = [];
  for (let j = 0; j < cells; j++) {
    free.push([]);
    for (let i = 0; i < cells; i++) {
      const cell: Box = [x0 + i * size, z0 + j * size, x0 + (i + 1) * size, z0 + (j + 1) * size], middle = middleOf(cell);
      free[j].push((!parent || inside(parent, middle)) && !taken.some((box) => overlaps(cell, box)));
    }
  }
  const rects: Box[] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; ) {
    if (!free[j][i]) { i++; continue; }
    let k = i; while (k < cells && free[j][k]) k++;
    rects.push([round(x0 + i * size), round(z0 + j * size), round(x0 + k * size), round(z0 + (j + 1) * size)]);
    i = k;
  }
  // The largest free rectangle (the histogram method, as the world places a lot).
  const heights = new Array<number>(cells).fill(0);
  let largest: Box | null = null, best = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) heights[i] = free[j][i] ? heights[i] + 1 : 0;
    const stack: number[] = [];
    for (let i = 0; i <= cells; i++) {
      const height = i < cells ? heights[i] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= height) {
        const top = heights[stack.pop()!], left = stack.length ? stack[stack.length - 1] + 1 : 0, width = i - left;
        if (top * width > best) { best = top * width; largest = [round(x0 + left * size), round(z0 + (j - top + 1) * size), round(x0 + i * size), round(z0 + (j + 1) * size)]; }
      }
      stack.push(i);
    }
  }
  return { rects, largest };
}

/** How much of the smaller of two boxes they share (0: apart, 1: one inside the other). */
export function overlapShare(a: Box, b: Box): number {
  const meet = clip(a, b);
  return meet ? areaOf(meet) / Math.max(1, Math.min(areaOf(a), areaOf(b))) : 0;
}
/** More than this share of a box over a kept place it may adjoin (a compatible one) is crowding: it is asked again. */
export const CROWDED = 0.5;
/**
 * The nearest point to `point` with a free square of `size` round it: free of the `taken` boxes and inside the parent, on a
 * grid over the frame (`cells` a side); null with none. Where a suggested spot lies on kept ground, it moves there.
 */
export function nearestFree(frame: Frame, parent: Box | null, taken: Box[], point: [number, number], size: number, cells = 48): [number, number] | null {
  const step = (2 * frame.half) / cells, x0 = frame.x - frame.half, z0 = frame.z - frame.half, reach = Math.max(1, Math.ceil(size / step / 2));
  const free = (i: number, j: number) => { const cell: Box = [x0 + i * step, z0 + j * step, x0 + (i + 1) * step, z0 + (j + 1) * step]; return (!parent || inside(parent, middleOf(cell))) && !taken.some((box) => overlaps(cell, box)); };
  const grid = Array.from({ length: cells }, (_, j) => Array.from({ length: cells }, (_, i) => free(i, j)));
  let best: [number, number] | null = null, bestDistance = Infinity;
  for (let j = reach; j < cells - reach; j++) for (let i = reach; i < cells - reach; i++) {
    let open = true;
    for (let b = j - reach; b <= j + reach && open; b++) for (let a = i - reach; a <= i + reach; a++) if (!grid[b][a]) { open = false; break; }
    if (!open) continue;
    const at: [number, number] = [x0 + (i + 0.5) * step, z0 + (j + 0.5) * step], distance = Math.hypot(at[0] - point[0], at[1] - point[1]);
    if (distance < bestDistance) { bestDistance = distance; best = [round(at[0]), round(at[1])]; }
  }
  return best;
}

/**
 * What is wrong with a box Jev answered, in words; none when it is sane. `clashes`: kept places it may not share, by name;
 * `crowds`: kept places it may adjoin, which it may not lie mostly over (CROWDED): there is free ground for it.
 */
export function sanity(box: Box, level: Level, parent: { box: Box; name: string } | null, clashes: { box: Box; reason: string }[] = [], crowds: { box: Box; reason: string }[] = []): string[] {
  const reasons: string[] = [], across = Math.max(widthOf(box), depthOf(box)), [least, most] = LADDER[level].sizes;
  for (const clash of clashes) if (overlaps(box, clash.box)) reasons.push(clash.reason);
  for (const crowd of crowds) if (overlapShare(box, crowd.box) > CROWDED) reasons.push(crowd.reason);
  if (across > most) reasons.push(`${Math.round(across)} m across is too big for a ${level}`);
  if (across < least) reasons.push(`${Math.round(across)} m across is too small for a ${level}`);
  if (parent && !inside(parent.box, middleOf(box))) reasons.push(`its middle is outside ${parent.name}`);
  if (parent && areaOf(box) > MOST_OF_PARENT * areaOf(parent.box)) reasons.push(`it takes more than a third of ${parent.name}`);
  return reasons;
}

/** How many buildings an area must hold for each of its pins: the pins are a third of what stands there. */
export const PER_PIN = 3;
/**
 * An area's size from its pins (docs/v2/world-engine-v2.md §2.0.21, the user's design): its kind's usual size (`usual`:
 * length and width, metres) holds `area × coverage / lot` buildings (`lot`: its kind's mean lot, m²); when that is fewer than
 * PER_PIN buildings a pin, it grows, its proportions kept, within its level's sizes. Says how many it holds and needs.
 */
export function sizeByPins(level: Level, usual: [number, number], lot: number, coverage: number, pins: number): { size: [number, number]; holds: number; needs: number; grown: boolean } {
  const holdsAt = ([w, d]: [number, number]) => Math.floor((w * d * coverage) / Math.max(1, lot)), needs = pins * PER_PIN;
  let size: [number, number] = [usual[0], usual[1]];
  const grown = holdsAt(size) < needs;
  if (grown) { const scale = Math.sqrt(needs / Math.max(1, holdsAt(size))); size = [size[0] * scale, size[1] * scale]; }
  // Within its level's sizes: its longer side at most the most, at least the least.
  const [least, most] = LADDER[level].sizes, long = Math.max(size[0], size[1]), fit = long > most ? most / long : long < least ? least / long : 1;
  size = [round(size[0] * fit), round(size[1] * fit)];
  return { size, holds: holdsAt(size), needs, grown };
}

/** A placed place an area is tied to by continuity: where it stands and how many ties. */
export interface Tie { at: [number, number]; ties: number }
/**
 * Where an area goes (docs/v2/world-engine-v2.md §2.0.21, the user's framing: terrain at 2D is one optimization a part).
 * Over a grid on the frame (`cells` a side), the middle of a box of `size` that sits inside the parent and overlaps none of
 * the `clashes` (places it may not share) nor lies mostly over any `crowds` (places it may only adjoin), at the least cost:
 * the mean distance to the places it is tied to (weighted by their ties), a third as much the distance from its suggested
 * spot (`prior`), and the share it lies over the crowds. Distances are in frame halves. Null when no middle is allowed.
 */
export function placeArea(frame: Frame, parent: Box | null, size: [number, number], prior: [number, number], tied: Tie[], clashes: Box[], crowds: Box[], cells = 48): { at: [number, number]; cost: number } | null {
  const step = (2 * frame.half) / cells, x0 = frame.x - frame.half, z0 = frame.z - frame.half, weight = tied.reduce((sum, tie) => sum + tie.ties, 0);
  const boxAt = ([x, z]: [number, number]): Box => [x - size[0] / 2, z - size[1] / 2, x + size[0] / 2, z + size[1] / 2];
  let best: { at: [number, number]; cost: number } | null = null;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const at: [number, number] = [x0 + (i + 0.5) * step, z0 + (j + 0.5) * step], box = boxAt(at);
    if (parent && !inside(parent, at)) continue;
    if (clashes.some((other) => overlaps(box, other)) || crowds.some((other) => overlapShare(box, other) > CROWDED)) continue;
    const pull = weight ? tied.reduce((sum, tie) => sum + tie.ties * Math.hypot(at[0] - tie.at[0], at[1] - tie.at[1]), 0) / weight : 0;
    const crowding = crowds.reduce((sum, other) => sum + overlapShare(box, other), 0);
    const cost = (pull + (weight ? 1 / 3 : 1) * Math.hypot(at[0] - prior[0], at[1] - prior[1])) / frame.half + crowding;
    if (!best || cost < best.cost) best = { at: [round(at[0]), round(at[1])], cost: Math.round(cost * 1000) / 1000 };
  }
  return best;
}
