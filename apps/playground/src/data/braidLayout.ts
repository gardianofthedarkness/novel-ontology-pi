import type { Position3 } from "./spatialLayout.js";

/**
 * Story strands as one braided tube (docs/story-strands.md, "Braid layout").
 *
 * Every strand run is a coloured axis curve inside one envelope tube that
 * swells and narrows with how many strands are alive. Per story layer k the
 * live runs take slots of a circle packing (rotated by a slow twist); each
 * run keeps the slot nearest where it was (Hungarian assignment). Positions
 * q_{s,k} (height, depth) minimise
 *
 *   Σ w_f‖q − σ‖² + w_c‖Δ²q‖² + w_v‖Δq‖²   (fidelity, curvature, wandering)
 *   + overlap and envelope hinges             (projected after each smoothing)
 *
 * with splits and merges pinned to the parent's position and eased with the
 * quintic smootherstep over a window long enough that no branch is steeper
 * than 30°. The time axis then folds into rows (a serpentine with semicircle
 * turns) so the bundle fills the screen's width and height; row breaks snap
 * to calendar day starts. Pure: the same runs give the same picture.
 */
export interface BraidRun {
  id: string;
  /** Its scenes in story order, by story layer. */
  scenes: { id: string; layer: number }[];
  /** The run it splits from, at that run's layer. */
  from?: { run: string; layer: number };
  /** The run it merges into, at that run's layer. */
  into?: { run: string; layer: number };
}
export interface BraidOptions {
  /** Viewport width / height the bundle should fill. */
  aspect?: number;
  /** Preferred row-break layers (calendar day starts). */
  breaks?: number[];
}
export interface BraidLayout {
  layers: number;
  /** Cross-section position [height, depth] of each run at each layer of its span (layout units). */
  at: Map<string, Map<number, [number, number]>>;
  /** Each run's span, including the stretch it leaves its parent or joins its merge. */
  span: Map<string, [number, number]>;
  /** Envelope radius per layer (smoothed). */
  radius: number[];
  /** [first layer, last layer] of each row; and the row height. */
  rows: [number, number][];
  band: number;
  rowOf: (layer: number) => number;
  /** Layout position of a (fractional) layer at a cross-section offset. */
  place: (layer: number, q?: [number, number]) => Position3;
  /** The axis frame at a (fractional) layer: centre, height direction, depth direction. */
  frame: (layer: number) => { center: Position3; normal: Position3; binormal: Position3 };
  /** Points along a run's axis (several per layer, more in turns) and the layer each sits at. */
  axis: (run: string) => { points: Position3[]; layers: number[] };
  metrics: { minSeparation: number; maxBranchDegrees: number; rows: number; scaleGain: number };
}

/** Layout units: story step along the axis, strand spacing, envelope margin, gap between rows. */
export const BRAID = { step: 40, spacing: 120, margin: 40, gap: 220, twist: (2 * Math.PI) / 90, maxBranchDegrees: 30 };
const W = { fidelity: 1, curvature: 30, velocity: 2, pinned: 1e4 };
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Container radius / circle diameter for the densest packing of n equal circles (n ≤ 7). */
const PACK = [0, 0.5, 1, 1.077, 1.207, 1.351, 1.5, 1.5];

/** Radius of the smallest disk holding n strands `spacing` apart (their centres and half a spacing around). */
export function packRadius(n: number, spacing = BRAID.spacing): number {
  if (n <= 0) return 0;
  return n < PACK.length ? PACK[n] * spacing : 0.5 * spacing * Math.sqrt(n / 0.78) * 1.05;
}
/** Slot centres for n strands in that disk, rotated by `phase`: centre, polygon, centre + hexagon, then a sunflower. */
export function packSlots(n: number, phase: number, spacing = BRAID.spacing): [number, number][] {
  const polar = (radius: number, angle: number): [number, number] => [radius * Math.cos(angle), radius * Math.sin(angle)];
  if (n <= 0) return [];
  if (n === 1) return [[0, 0]];
  const ring = packRadius(n, spacing) - spacing / 2;
  if (n <= 6) return Array.from({ length: n }, (_, index) => polar(ring, phase + (2 * Math.PI * index) / n));
  if (n === 7) return [[0, 0], ...Array.from({ length: 6 }, (_, index) => polar(spacing, phase + (Math.PI * index) / 3))];
  return Array.from({ length: n }, (_, index) => polar(ring * Math.sqrt((index + 0.5) / n), phase + index * GOLDEN));
}

/** Minimum-cost assignment of rows to columns (square matrix), O(n³). */
export function assign(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let row = 1; row <= n; row++) {
    p[0] = row;
    let column = 0;
    const least = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[column] = true;
      const current = p[column];
      let delta = Infinity, next = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const reduced = cost[current - 1][j - 1] - u[current] - v[j];
        if (reduced < least[j]) { least[j] = reduced; way[j] = column; }
        if (least[j] < delta) { delta = least[j]; next = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else least[j] -= delta;
      }
      column = next;
    } while (p[column] !== 0);
    do { const previous = way[column]; p[column] = p[previous]; column = previous; } while (column);
  }
  const result = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) if (p[j]) result[p[j] - 1] = j - 1;
  return result;
}

/**
 * Smooth one coordinate of one run: minimise Σ wᵢ(xᵢ − tᵢ)² + c‖Δ²x‖² + v‖Δx‖²,
 * a pentadiagonal SPD system solved by banded Cholesky in O(n).
 */
export function smooth(target: number[], weight: number[], curvature = W.curvature, velocity = W.velocity): number[] {
  const n = target.length;
  if (n <= 2) return [...target];
  const a0 = weight.slice(), a1 = new Array(n).fill(0), a2 = new Array(n).fill(0);
  const add = (i: number, j: number, value: number) => { const [low, high] = i <= j ? [i, j] : [j, i]; if (high === low) a0[low] += value; else if (high - low === 1) a1[low] += value / 2; else a2[low] += value / 2; };
  for (let i = 0; i + 1 < n; i++) { const idx = [i, i + 1], coefficient = [-1, 1]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) add(idx[a], idx[b], velocity * coefficient[a] * coefficient[b]); }
  for (let i = 1; i + 1 < n; i++) { const idx = [i - 1, i, i + 1], coefficient = [1, -2, 1]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) add(idx[a], idx[b], curvature * coefficient[a] * coefficient[b]); }
  // L Lᵀ with L lower-banded: l0 diagonal, l1 = L[i][i−1], l2 = L[i][i−2].
  const l0 = new Array(n).fill(0), l1 = new Array(n).fill(0), l2 = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i >= 2) l2[i] = a2[i - 2] / l0[i - 2];
    if (i >= 1) l1[i] = (a1[i - 1] - (i >= 2 ? l2[i] * l1[i - 1] : 0)) / l0[i - 1];
    l0[i] = Math.sqrt(Math.max(1e-12, a0[i] - l1[i] * l1[i] - l2[i] * l2[i]));
  }
  const y = new Array(n).fill(0), x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) y[i] = (weight[i] * target[i] - (i >= 1 ? l1[i] * y[i - 1] : 0) - (i >= 2 ? l2[i] * y[i - 2] : 0)) / l0[i];
  for (let i = n - 1; i >= 0; i--) x[i] = (y[i] - (i + 1 < n ? l1[i + 1] * x[i + 1] : 0) - (i + 2 < n ? l2[i + 2] * x[i + 2] : 0)) / l0[i];
  return x;
}

/** C² ease: zero slope and curvature at both ends. */
export const smootherstep = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * t * (t * (6 * t - 15) + 10); };

function gaussian(values: number[], sigma: number): number[] {
  const reach = Math.ceil(sigma * 3);
  return values.map((_, index) => {
    let sum = 0, total = 0;
    for (let offset = -reach; offset <= reach; offset++) {
      const at = index + offset;
      if (at < 0 || at >= values.length) continue;
      const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
      sum += values[at] * weight; total += weight;
    }
    return total ? sum / total : values[index];
  });
}

/** Rows that fill a viewport of this aspect: maximise the scale min(W/W_b, H/H_b), breaks snapped to preferred layers. */
export function foldRows(layers: number, band: number, aspect: number, breaks: number[] = []): { rows: [number, number][]; scaleGain: number } {
  const length = Math.max(1, layers - 1) * BRAID.step, turn = band / 2;
  const scale = (k: number) => Math.min(aspect / (length / k + 2 * turn), 1 / (k * band));
  const most = Math.max(1, Math.floor(layers / 6));
  let best = 1;
  for (let k = 2; k <= most; k++) if (scale(k) > scale(best)) best = k;
  const starts = [0];
  const per = layers / best, preferred = [...new Set(breaks)].filter((layer) => layer > 0 && layer < layers).sort((first, second) => first - second);
  for (let row = 1; row < best; row++) {
    const ideal = Math.round(row * per);
    const near = preferred.filter((layer) => Math.abs(layer - ideal) <= 0.15 * per).sort((first, second) => Math.abs(first - ideal) - Math.abs(second - ideal))[0];
    const start = near ?? ideal;
    if (start - starts.at(-1)! >= 2 && layers - start >= 2) starts.push(start);
  }
  const rows = starts.map((start, index): [number, number] => [start, (starts[index + 1] ?? layers) - 1]);
  return { rows, scaleGain: scale(rows.length) / scale(1) };
}

export function braidLayout(input: BraidRun[], layers: number, options: BraidOptions = {}): BraidLayout {
  const runs = [...input].filter((run) => run.scenes.length).sort((first, second) => first.id.localeCompare(second.id));
  const byId = new Map(runs.map((run) => [run.id, run]));
  const span = new Map<string, [number, number]>();
  for (const run of runs) {
    const first = run.scenes[0].layer, last = run.scenes.at(-1)!.layer;
    const from = run.from && byId.has(run.from.run) && run.from.layer < first ? run.from.layer : first;
    const into = run.into && byId.has(run.into.run) && run.into.layer > last ? run.into.layer : last;
    span.set(run.id, [from, into]);
  }
  const live: string[][] = Array.from({ length: layers }, () => []);
  for (const run of runs) { const [from, to] = span.get(run.id)!; for (let k = Math.max(0, from); k <= Math.min(layers - 1, to); k++) live[k].push(run.id); }

  // Envelope: the packing radius, dilated ±3 layers and smoothed, so the tube swells before strands arrive.
  const need = live.map((ids) => ids.length ? packRadius(ids.length) + BRAID.margin : 0);
  const dilated = need.map((_, index) => Math.max(...need.slice(Math.max(0, index - 3), index + 4)));
  const radius = gaussian(dilated, 2);

  // Targets: packing slots per layer, each run keeping the slot nearest where it was.
  const target = new Map<string, Map<number, [number, number]>>(runs.map((run) => [run.id, new Map()]));
  const last = new Map<string, [number, number]>();
  for (let k = 0; k < layers; k++) {
    const ids = live[k];
    if (!ids.length) continue;
    const slots = packSlots(ids.length, BRAID.twist * k);
    const previous = ids.map((id) => last.get(id) ?? (span.get(id)![0] === k && byId.get(id)!.from ? last.get(byId.get(id)!.from!.run) : undefined));
    const order = assign(ids.map((_, row) => slots.map((slot) => previous[row] ? (slot[0] - previous[row]![0]) ** 2 + (slot[1] - previous[row]![1]) ** 2 : 0)));
    ids.forEach((id, row) => { target.get(id)!.set(k, slots[order[row]]); last.set(id, slots[order[row]]); });
  }

  // Splits and merges: pinned to the other run, eased in over a window long enough for a ≤ 30° branch.
  type Event = { run: string; other: string; layer: number; direction: 1 | -1; window: number };
  const events: Event[] = [];
  const tangent = Math.tan((BRAID.maxBranchDegrees * Math.PI) / 180);
  for (const run of runs) {
    const [from, to] = span.get(run.id)!;
    for (const [other, layer, direction] of [[run.from?.run, from, 1], [run.into?.run, to, -1]] as const) {
      if (!other || !byId.has(other) || !target.get(other)!.has(layer) || (direction === 1 ? layer === run.scenes[0].layer : layer === run.scenes.at(-1)!.layer)) continue;
      // A strand that splits off and merges back gives each move at most half its span, so it always parts visibly.
      const both = !!run.from && !!run.into && byId.has(run.from.run) && byId.has(run.into.run);
      const anchor = target.get(other)!.get(layer)!, room = both ? Math.floor((to - from) / 2) : direction === 1 ? to - layer : layer - from;
      const probe = target.get(run.id)!.get(layer + direction * Math.min(room, 8)) ?? anchor;
      const window = Math.max(1, Math.min(room, Math.ceil((15 / 8) * Math.hypot(probe[0] - anchor[0], probe[1] - anchor[1]) / (tangent * BRAID.step))));
      events.push({ run: run.id, other, layer, direction, window });
      for (let j = 1; j <= window; j++) {
        const k = layer + direction * j, own = target.get(run.id)!.get(k);
        if (!own) continue;
        const ease = smootherstep(j / window);
        target.get(run.id)!.set(k, [anchor[0] + (own[0] - anchor[0]) * ease, anchor[1] + (own[1] - anchor[1]) * ease]);
      }
    }
  }
  // While they part (or meet), a run and the run it leaves, and siblings leaving the same point, may touch.
  const exempt = new Set<string>();
  for (const event of events) for (let j = 0; j < event.window; j++) exempt.add(`${event.layer + event.direction * j}|${[event.run, event.other].sort().join("|")}`);
  for (const event of events) for (const sibling of events) {
    if (sibling.run <= event.run || sibling.other !== event.other || sibling.layer !== event.layer || sibling.direction !== event.direction) continue;
    for (let j = 0; j < Math.max(event.window, sibling.window); j++) exempt.add(`${event.layer + event.direction * j}|${[event.run, sibling.run].sort().join("|")}`);
  }

  // Alternate: smooth each run (curvature, wandering, fidelity; event points pinned to the other run), then project overlaps and the envelope.
  const at = new Map<string, Map<number, [number, number]>>(runs.map((run) => [run.id, new Map(target.get(run.id))]));
  const minimum = BRAID.spacing * 0.9;
  for (let iteration = 0; iteration < 14; iteration++) {
    for (const run of runs) {
      const [from, to] = span.get(run.id)!;
      const ks = Array.from({ length: to - from + 1 }, (_, index) => from + index).filter((k) => target.get(run.id)!.has(k));
      const weight = ks.map(() => W.fidelity), goal = ks.map((k) => [...target.get(run.id)!.get(k)!] as [number, number]);
      for (const event of events.filter((entry) => entry.run === run.id)) {
        const index = ks.indexOf(event.layer), pin = at.get(event.other)!.get(event.layer);
        if (index >= 0 && pin) { weight[index] = W.pinned; goal[index] = [...pin]; }
      }
      const ys = smooth(goal.map((point) => point[0]), weight), zs = smooth(goal.map((point) => point[1]), weight);
      ks.forEach((k, index) => at.get(run.id)!.set(k, [ys[index], zs[index]]));
    }
    for (let k = 0; k < layers; k++) {
      const ids = live[k];
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (exempt.has(`${k}|${[ids[a], ids[b]].sort().join("|")}`)) continue;
        const p = at.get(ids[a])!.get(k)!, q = at.get(ids[b])!.get(k)!;
        const dy = q[0] - p[0], dz = q[1] - p[1], distance = Math.hypot(dy, dz) || 1e-6;
        if (distance >= minimum) continue;
        const push = (minimum - distance) / 2, uy = distance > 1e-6 ? dy / distance : 1, uz = distance > 1e-6 ? dz / distance : 0;
        at.get(ids[a])!.set(k, [p[0] - uy * push, p[1] - uz * push]);
        at.get(ids[b])!.set(k, [q[0] + uy * push, q[1] + uz * push]);
      }
      const room = Math.max(0, radius[k] - BRAID.spacing * 0.35);
      for (const id of ids) { const p = at.get(id)!.get(k)!, length = Math.hypot(p[0], p[1]); if (length > room) at.get(id)!.set(k, [(p[0] / length) * room, (p[1] / length) * room]); }
    }
  }
  // Event points sit exactly on the other run.
  for (const event of events) { const pin = at.get(event.other)!.get(event.layer); if (pin) at.get(event.run)!.set(event.layer, [...pin]); }

  // Fold: rows of the serpentine, alternating direction, joined by semicircles.
  const band = 2 * Math.max(BRAID.spacing, ...radius) + BRAID.gap;
  const { rows, scaleGain } = foldRows(layers, band, options.aspect ?? 16 / 9, options.breaks);
  const starts = rows.map((row) => row[0]);
  const rowOf = (layer: number) => { let row = 0; while (row + 1 < rows.length && layer >= starts[row + 1]) row++; return row; };
  const rowX: [number, number][] = [];
  let cursor = 0;
  rows.forEach(([first, lastLayer], index) => { const direction = index % 2 ? -1 : 1; rowX.push([cursor, direction]); cursor += direction * (lastLayer - first) * BRAID.step; });
  const xs = rowX.flatMap(([x0], index) => [x0, x0 + rowX[index][1] * (rows[index][1] - rows[index][0]) * BRAID.step]);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2, centreY = ((rows.length - 1) * band) / 2;
  const frame = (layer: number) => {
    const row = rowOf(Math.floor(layer)), [first, lastLayer] = rows[row], [x0, direction] = rowX[row], y0 = centreY - row * band;
    if (layer <= lastLayer || row + 1 >= rows.length) {
      const along = Math.min(layer, lastLayer + (row + 1 >= rows.length ? Infinity : 0)) - first;
      return { center: [x0 + direction * along * BRAID.step - centreX, y0, 0] as Position3, normal: [0, direction, 0] as Position3, binormal: [0, 0, 1] as Position3 };
    }
    // The turn: a semicircle beyond the row's end, its outward radius the height direction.
    const t = layer - lastLayer, endX = x0 + direction * (lastLayer - first) * BRAID.step, angle = Math.PI / 2 - direction * Math.PI * t;
    const normal: Position3 = [Math.cos(angle), Math.sin(angle), 0];
    return { center: [endX + (band / 2) * normal[0] - centreX, y0 - band / 2 + (band / 2) * normal[1], 0] as Position3, normal, binormal: [0, 0, 1] as Position3 };
  };
  const place = (layer: number, q: [number, number] = [0, 0]): Position3 => {
    const { center, normal, binormal } = frame(layer);
    return [center[0] + normal[0] * q[0] + binormal[0] * q[1], center[1] + normal[1] * q[0] + binormal[1] * q[1], center[2] + normal[2] * q[0] + binormal[2] * q[1]];
  };
  const turnAfter = new Set(rows.slice(0, -1).map((row) => row[1]));
  const axis = (id: string) => {
    const [from, to] = span.get(id) ?? [0, -1], points: Position3[] = [], at_ = at.get(id), atLayers: number[] = [];
    if (!at_) return { points, layers: atLayers };
    const ks = Array.from({ length: to - from + 1 }, (_, index) => from + index).filter((k) => at_.has(k));
    const q = (index: number) => at_.get(ks[Math.min(ks.length - 1, Math.max(0, index))])!;
    ks.forEach((k, index) => {
      const subs = index + 1 >= ks.length ? 1 : turnAfter.has(k) ? 24 : 4;
      for (let sub = 0; sub < subs; sub++) {
        const t = sub / subs, p0 = q(index - 1), p1 = q(index), p2 = q(index + 1), p3 = q(index + 2);
        // Catmull–Rom between equally spaced layers: no cusps, passes through every sample.
        const blend = (axisIndex: 0 | 1) => 0.5 * (2 * p1[axisIndex] + (-p0[axisIndex] + p2[axisIndex]) * t + (2 * p0[axisIndex] - 5 * p1[axisIndex] + 4 * p2[axisIndex] - p3[axisIndex]) * t * t + (-p0[axisIndex] + 3 * p1[axisIndex] - 3 * p2[axisIndex] + p3[axisIndex]) * t * t * t);
        const layer = k + t * (index + 1 < ks.length ? ks[index + 1] - k : 0);
        points.push(place(layer, [blend(0), blend(1)]));
        atLayers.push(layer);
      }
    });
    return { points, layers: atLayers };
  };

  // Metrics the tests hold the layout to.
  let minSeparation = Infinity, maxBranch = 0;
  for (let k = 0; k < layers; k++) {
    const ids = live[k];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      if (exempt.has(`${k}|${[ids[a], ids[b]].sort().join("|")}`)) continue;
      const p = at.get(ids[a])!.get(k)!, q = at.get(ids[b])!.get(k)!;
      minSeparation = Math.min(minSeparation, Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
  }
  for (const event of events) for (let j = 0; j < event.window; j++) {
    const p = at.get(event.run)!.get(event.layer + event.direction * j), q = at.get(event.run)!.get(event.layer + event.direction * (j + 1));
    if (p && q) maxBranch = Math.max(maxBranch, (Math.atan2(Math.hypot(q[0] - p[0], q[1] - p[1]), BRAID.step) * 180) / Math.PI);
  }
  return { layers, at, span, radius, rows, band, rowOf, place, frame, axis, metrics: { minSeparation, maxBranchDegrees: maxBranch, rows: rows.length, scaleGain } };
}
