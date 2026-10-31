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
 * An area's extent: its kept box (Jev's, or a book before's), else the span of its kept parts (a tenth more all round),
 * else its canvas circle, a guess; null with none of them.
 */
export function extentOf(kept: Box | null | undefined, parts: Box[], circle?: { x: number; z: number; r: number } | null): Extent | null {
  if (kept) return { box: kept, by: "kept" };
  const span = spanOf(parts, 0.1);
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
export function framesFor(level: Level, spot: [number, number], parent: Box | null, size = usualSize(level)): { work: Frame; context: Frame | null } {
  let half = size / SHARE.aim / 2;
  if (parent) {
    const parentHalf = Math.max(widthOf(parent), depthOf(parent)) / 2 * 1.1, [px, pz] = middleOf(parent);
    // The parent fits while the part still takes at least a twelfth: one frame, the whole parent.
    if (parentHalf <= size / SHARE.least / 2) return { work: { x: round(px), z: round(pz), half: round(Math.max(parentHalf, half)), level, purpose: "work", tag: tagOf(Math.max(parentHalf, half)) }, context: null };
    // Else the work frame at the part's scale, kept inside the parent, and the parent as its context.
    const x = Math.min(Math.max(spot[0], parent[0] + half), parent[2] - half), z = Math.min(Math.max(spot[1], parent[1] + half), parent[3] - half);
    return { work: { x: round(x), z: round(z), half: round(half), level, purpose: "work", tag: tagOf(half) }, context: { x: round(px), z: round(pz), half: round(parentHalf), level: LADDER[level].parent ?? level, purpose: "context", tag: tagOf(parentHalf) } };
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

/** What is wrong with a box Jev answered, in words; none when it is sane. `clashes`: kept places it may not share, by name. */
export function sanity(box: Box, level: Level, parent: { box: Box; name: string } | null, clashes: { box: Box; reason: string }[] = []): string[] {
  const reasons: string[] = [], across = Math.max(widthOf(box), depthOf(box)), [least, most] = LADDER[level].sizes;
  for (const clash of clashes) if (overlaps(box, clash.box)) reasons.push(clash.reason);
  if (across > most) reasons.push(`${Math.round(across)} m across is too big for a ${level}`);
  if (across < least) reasons.push(`${Math.round(across)} m across is too small for a ${level}`);
  if (parent && !inside(parent.box, middleOf(box))) reasons.push(`its middle is outside ${parent.name}`);
  if (parent && areaOf(box) > MOST_OF_PARENT * areaOf(parent.box)) reasons.push(`it takes more than a third of ${parent.name}`);
  return reasons;
}
