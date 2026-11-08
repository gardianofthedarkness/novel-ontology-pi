import { buildGraph, directionOf, EDGE, type MoveGraph } from "./pathIntegral.js";

/**
 * Moving between places on the place map, as the same path integral the places walk with: a lattice of ground nodes
 * over the map (8 directions, a turning cost), each step costing its metres plus, for every place boundary it crosses,
 * μ (1 + ν (1 − |cos θ|)), θ between the step and the boundary's normal where it crosses. The least action is the
 * shortest way that crosses the fewest boundaries and crosses each one squarely; a walk is one exact draw around it
 * (solveWalk and sampleWalk on this graph). A place's own grid is walked by its own graph: the map only carries a person
 * from where they leave one place's grid to where they enter the next.
 */
export interface Boundary { x: number; z: number; r: number }
export interface Crossing { mu: number; nu: number }
/** A boundary costs as much as 24 m of walking when crossed squarely, four times that when crossed along it. */
export const CROSSING: Crossing = { mu: 24, nu: 3 };

/** What a straight step from a to b costs in crossings: per boundary whose circle it crosses, μ (1 + ν (1 − |cos θ|)). */
export function crossings(boundaries: Boundary[], ax: number, az: number, bx: number, bz: number, crossing: Crossing = CROSSING): { cost: number; count: number } {
  const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
  let cost = 0, count = 0;
  if (!length) return { cost, count };
  for (const { x, z, r } of boundaries) {
    const inA = Math.hypot(ax - x, az - z) < r, inB = Math.hypot(bx - x, bz - z) < r;
    if (inA === inB) continue;
    // Where the step meets the circle: the root of |a + t d − c|² = r² in [0, 1].
    const wx = ax - x, wz = az - z, A = dx * dx + dz * dz, B = 2 * (wx * dx + wz * dz), C = wx * wx + wz * wz - r * r, root = Math.sqrt(Math.max(0, B * B - 4 * A * C));
    const t = [(-B - root) / (2 * A), (-B + root) / (2 * A)].find((value) => value >= 0 && value <= 1) ?? 0.5;
    const px = ax + t * dx - x, pz = az + t * dz - z, cos = Math.abs((dx * px + dz * pz) / (length * Math.max(1e-9, Math.hypot(px, pz))));
    cost += crossing.mu * (1 + crossing.nu * (1 - cos)); count++;
  }
  return { cost, count };
}

export interface MacroLattice { graph: MoveGraph; cell: number; x0: number; z0: number; nx: number; nz: number }

/** The map's lattice: ground nodes every `cell` metres over the boundaries' extent and a margin, joined in 8 directions. */
export function macroLattice(boundaries: Boundary[], options: { cell?: number; margin?: number; crossing?: Crossing } = {}): MacroLattice {
  const cell = options.cell ?? 4, margin = options.margin ?? 40;
  const x0 = Math.min(...boundaries.map((b) => b.x - b.r)) - margin, z0 = Math.min(...boundaries.map((b) => b.z - b.r)) - margin;
  const nx = Math.ceil((Math.max(...boundaries.map((b) => b.x + b.r)) + margin - x0) / cell) + 1, nz = Math.ceil((Math.max(...boundaries.map((b) => b.z + b.r)) + margin - z0) / cell) + 1;
  const positions: [number, number, number][] = [], edges: { from: number; to: number; dir: number; cost: number; kind: number }[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) positions.push([x0 + i * cell, z0 + j * cell, 0]);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ti = i + di, tj = j + dj;
    if (ti < 0 || tj < 0 || ti >= nx || tj >= nz) continue;
    const [ax, az] = positions[j * nx + i], [bx, bz] = positions[tj * nx + ti];
    edges.push({ from: j * nx + i, to: tj * nx + ti, dir: directionOf(di, dj), cost: cell * Math.hypot(di, dj) + crossings(boundaries, ax, az, bx, bz, options.crossing).cost, kind: EDGE.walk });
  }
  return { graph: buildGraph(positions, edges), cell, x0, z0, nx, nz };
}

/** The lattice node nearest a point on the map. */
export function latticeNode(lattice: MacroLattice, x: number, z: number): number {
  const i = Math.min(lattice.nx - 1, Math.max(0, Math.round((x - lattice.x0) / lattice.cell))), j = Math.min(lattice.nz - 1, Math.max(0, Math.round((z - lattice.z0) / lattice.cell)));
  return j * lattice.nx + i;
}

/** The lattice nodes inside a rectangle of the map (a place's grid). */
export function latticeWithin(lattice: MacroLattice, rect: { x: [number, number]; z: [number, number] }): number[] {
  const out: number[] = [];
  for (let node = 0; node < lattice.graph.nodes; node++) { const x = lattice.graph.x[node], z = lattice.graph.z[node]; if (x >= rect.x[0] && x <= rect.x[1] && z >= rect.z[0] && z <= rect.z[1]) out.push(node); }
  return out;
}

/**
 * A lattice walk drawn as a curve on the map: each inner point averaged with its neighbours within `reach` steps, twice,
 * the ends kept, so the lattice's stair-steps between its 8 directions smooth into the line they stand for.
 */
export function smoothPath(points: [number, number][], reach = 3, passes = 2): [number, number][] {
  let out = points.map(([x, z]) => [x, z] as [number, number]);
  for (let pass = 0; pass < passes; pass++) out = out.map((point, n) => {
    if (!n || n === out.length - 1) return point;
    const span = Math.min(reach, n, out.length - 1 - n), near = out.slice(n - span, n + span + 1);
    return [near.reduce((sum, p) => sum + p[0], 0) / near.length, near.reduce((sum, p) => sum + p[1], 0) / near.length];
  });
  return out;
}
