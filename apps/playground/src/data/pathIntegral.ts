/**
 * Motion as a discrete path integral: every walk from a start to its first
 * entry into a target set Y weighs exp(−S/T), where S adds each step's cost
 * (metres walked, metres climbed ×λ, a fall's penalty) and a turning cost
 * κ(1 − cos θ) between consecutive directions. A walk is drawn exactly from
 * that ensemble with the h-transform: solve h = Q h + b once for Y (h[s] is
 * the summed weight of every walk from state s into Y), then step from s to
 * t with probability Q[s,t] h[t] / h[s]. Persistence comes from the state:
 * a state is (node, direction it arrived in), so a person keeps their
 * heading unless turning pays.
 *
 * Two safeguards from the research behind it:
 * - Convergence: the sum over walks is finite only if the transfer operator's
 *   spectral radius is below 1. `temperatureBound` gives a sufficient T from
 *   the small direction matrix (the walk's costs per direction); stay below it.
 * - Precision: weights of long walks underflow, so h is solved in reduced form
 *   h̄ = e^(φ/T) h with φ a lower bound on the cost still to go (straight-line
 *   distance to Y, plus the climb Y needs). Sampling probabilities are unchanged.
 *
 * The least-action path is this ensemble's mode at every T; a sample is what
 * happens in the animation, as one draw of what could have.
 */

/**
 * Directions a step can take, as (x across, z down the plan, y up): 8 on the
 * ground, then up and down, then the 4 rising cube diagonals of the 14
 * directions, which launch a person into the air.
 */
export const DIRECTIONS: readonly [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1]];
export const UP = 8, DOWN = 9;
/** The rising diagonal toward (dx, dz). */
export const launchOf = (dx: number, dz: number) => 10 + (dx > 0 ? 0 : 2) + (dz > 0 ? 0 : 1);
export function directionOf(dx: number, dz: number): number { return DIRECTIONS.findIndex(([x, z, y]) => y === 0 && x === Math.sign(dx) && z === Math.sign(dz)); }

/** Edge kinds, for costs that depend on the manner of moving (a fall is cheap for someone falling). */
export const EDGE = { walk: 0, climb: 1, descend: 2, jump: 3, fall: 4, arc: 5 } as const;

/** A directed movement graph in compressed rows: node positions (metres), and per edge its target, direction, cost (metres of walking) and kind. */
export interface MoveGraph { nodes: number; x: Float64Array; z: Float64Array; y: Float64Array; offsets: Int32Array; to: Int32Array; dir: Uint8Array; cost: Float64Array; kind: Uint8Array }

export function buildGraph(positions: [number, number, number][], edges: { from: number; to: number; dir: number; cost: number; kind: number }[]): MoveGraph {
  const nodes = positions.length, offsets = new Int32Array(nodes + 1);
  for (const edge of edges) offsets[edge.from + 1]++;
  for (let n = 0; n < nodes; n++) offsets[n + 1] += offsets[n];
  const fill = offsets.slice(0, nodes), to = new Int32Array(edges.length), dir = new Uint8Array(edges.length), cost = new Float64Array(edges.length), kind = new Uint8Array(edges.length);
  for (const edge of edges) { const at = fill[edge.from]++; to[at] = edge.to; dir[at] = edge.dir; cost[at] = edge.cost; kind[at] = edge.kind; }
  return { nodes, x: Float64Array.from(positions, (p) => p[0]), z: Float64Array.from(positions, (p) => p[1]), y: Float64Array.from(positions, (p) => p[2]), offsets, to, dir, cost, kind };
}

const unit = (d: number) => { const [x, z, y] = DIRECTIONS[d], length = Math.hypot(x, z, y); return [x / length, z / length, y / length]; };
const turnWeights = (kappa: number, T: number) => DIRECTIONS.map((_, a) => DIRECTIONS.map((__, b) => { const [u, v] = [unit(a), unit(b)]; return Math.exp(-kappa * (1 - (u[0] * v[0] + u[1] * v[1] + u[2] * v[2])) / T); }));

/**
 * A temperature below which the walk sum converges on any map with these
 * steps: the spectral radius of the direction matrix C[a][b] = exp(−(cost(b)
 * + κ(1 − cos ab))/T) stays under 1 (a climb counts λ/2 per metre either way,
 * after the similarity transform that removes height as a potential).
 */
export function temperatureBound(options: { step: number; kappa: number; lambda: number; floorHeight: number; arcCost?: number }): number {
  const costs = DIRECTIONS.map((_, d) => d === UP || d === DOWN ? options.lambda * options.floorHeight / 2 : d > DOWN ? options.arcCost ?? options.lambda * options.floorHeight / 2 : options.step * Math.hypot(DIRECTIONS[d][0], DIRECTIONS[d][1]));
  const radius = (T: number) => {
    const turn = turnWeights(options.kappa, T), C = costs.map((_, a) => costs.map((cost, b) => turn[a][b] * Math.exp(-cost / T)));
    let v = costs.map(() => 1), r = 0;
    for (let k = 0; k < 400; k++) { const w = C.map((row) => row.reduce((sum, c, j) => sum + c * v[j], 0)), top = Math.max(...w); r = top / Math.max(...v); v = w.map((value) => value / top); }
    return r;
  };
  let low = 1e-3, high = 50;
  for (let k = 0; k < 60; k++) { const mid = (low + high) / 2; if (radius(mid) < 1) low = mid; else high = mid; }
  return low;
}

export interface WalkField { target: Uint8Array; h: Float64Array; weight: Float64Array; turn: number[][]; sweeps: number; converged: boolean }

/** Solve the reduced partition function h̄ for first entry into `targets` (symmetric Gauss–Seidel). `factors` scale edge costs by kind. */
export function solveWalk(graph: MoveGraph, targets: Iterable<number>, options: { T: number; kappa: number; lambda: number; factors?: number[]; tolerance?: number; maxSweeps?: number }): WalkField {
  const D = DIRECTIONS.length, target = new Uint8Array(graph.nodes);
  let [minX, maxX, minZ, maxZ, minY] = [Infinity, -Infinity, Infinity, -Infinity, Infinity];
  for (const node of targets) { target[node] = 1; minX = Math.min(minX, graph.x[node]); maxX = Math.max(maxX, graph.x[node]); minZ = Math.min(minZ, graph.z[node]); maxZ = Math.max(maxZ, graph.z[node]); minY = Math.min(minY, graph.y[node]); }
  // φ: straight-line distance to Y's bounding box plus the climb Y needs; it never exceeds the cost still to go.
  const phi = new Float64Array(graph.nodes);
  for (let n = 0; n < graph.nodes; n++) phi[n] = Math.hypot(Math.max(0, minX - graph.x[n], graph.x[n] - maxX), Math.max(0, minZ - graph.z[n], graph.z[n] - maxZ)) + options.lambda * Math.max(0, minY - graph.y[n]);
  const weight = new Float64Array(graph.to.length);
  for (let n = 0; n < graph.nodes; n++) for (let e = graph.offsets[n]; e < graph.offsets[n + 1]; e++) weight[e] = Math.exp(-(graph.cost[e] * (options.factors?.[graph.kind[e]] ?? 1) + phi[graph.to[e]] - phi[n]) / options.T);
  const turn = turnWeights(options.kappa, options.T), h = new Float64Array(graph.nodes * D), a = new Float64Array(64);
  const tolerance = options.tolerance ?? 1e-9, maxSweeps = options.maxSweeps ?? 5000;
  let sweeps = 0, converged = false;
  const relax = (n: number) => {
    const first = graph.offsets[n], count = graph.offsets[n + 1] - first;
    let change = 0;
    for (let k = 0; k < count; k++) { const e = first + k, next = graph.to[e]; a[k] = weight[e] * (target[next] ? 1 : h[next * D + graph.dir[e]]); }
    for (let d = 0; d < D; d++) {
      let sum = 0;
      for (let k = 0; k < count; k++) sum += turn[d][graph.dir[first + k]] * a[k];
      const old = h[n * D + d];
      if (sum > 0) change = Math.max(change, Math.abs(sum - old) / sum);
      h[n * D + d] = sum;
    }
    return change;
  };
  while (sweeps < maxSweeps && !converged) {
    let change = 0;
    for (let n = 0; n < graph.nodes; n++) if (!target[n]) change = Math.max(change, relax(n));
    for (let n = graph.nodes - 1; n >= 0; n--) if (!target[n]) change = Math.max(change, relax(n));
    sweeps++;
    converged = change < tolerance;
  }
  return { target, h, weight, turn, sweeps, converged };
}

/** One walk drawn exactly from the ensemble, as nodes from `start` (arriving with `heading`) to its first node in Y; null when Y cannot be reached. */
export function sampleWalk(graph: MoveGraph, field: WalkField, start: number, heading: number, rng: () => number, maxSteps = 50000): number[] | null {
  const D = DIRECTIONS.length, path = [start];
  let node = start, direction = heading;
  while (!field.target[node]) {
    if (path.length > maxSteps) return null;
    const first = graph.offsets[node], last = graph.offsets[node + 1];
    let total = 0;
    for (let e = first; e < last; e++) total += field.turn[direction][graph.dir[e]] * field.weight[e] * (field.target[graph.to[e]] ? 1 : field.h[graph.to[e] * D + graph.dir[e]]);
    if (!(total > 0)) return null;
    let pick = rng() * total, chosen = last - 1;
    for (let e = first; e < last; e++) { pick -= field.turn[direction][graph.dir[e]] * field.weight[e] * (field.target[graph.to[e]] ? 1 : field.h[graph.to[e] * D + graph.dir[e]]); if (pick <= 0) { chosen = e; break; } }
    node = graph.to[chosen];
    direction = graph.dir[chosen];
    path.push(node);
  }
  return path;
}
