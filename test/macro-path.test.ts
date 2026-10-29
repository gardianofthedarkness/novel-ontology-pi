import { test } from "node:test";
import assert from "node:assert/strict";
import { CROSSING, crossings, latticeNode, latticeWithin, macroLattice, smoothPath, type Boundary } from "../apps/playground/src/data/macroPath.js";
import { sampleWalk, solveWalk, temperatureBound } from "../apps/playground/src/data/pathIntegral.js";

const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const T = 0.6 * temperatureBound({ step: 4, kappa: 2, lambda: 8, floorHeight: 3, arcCost: 7 });

test("a boundary crossed squarely costs μ; crossed at a slant, more; a step that stays on one side, nothing", () => {
  const circle: Boundary[] = [{ x: 0, z: 0, r: 10 }];
  assert.equal(crossings(circle, 8, 0, 12, 0).cost, CROSSING.mu, "straight out along the radius");
  const slanted = crossings(circle, 9, -2, 11, 2).cost, along = crossings(circle, 9.5, -1, 10.5, 3).cost;
  assert.ok(slanted > CROSSING.mu && along > slanted, "the more slanted the crossing, the more it costs");
  assert.ok(along <= CROSSING.mu * (1 + CROSSING.nu) + 1e-9);
  assert.deepEqual(crossings(circle, 1, 1, 3, 2), { cost: 0, count: 0 });
  assert.equal(crossings([...circle, { x: 0, z: 0, r: 30 }], 8, 0, 40, 0).count, 2, "every boundary on the way counts");
});

// Invented map: two places 200 m apart with a third between them on the straight line.
const from = { x: 0, z: 0, r: 20 }, to = { x: 200, z: 0, r: 20 }, between = { x: 100, z: 0, r: 25 };
const walks = (boundaries: Boundary[], count: number, crossing = CROSSING) => {
  const lattice = macroLattice(boundaries, { cell: 4, margin: 40, crossing }), field = solveWalk(lattice.graph, latticeWithin(lattice, { x: [192, 208], z: [-8, 8] }), { T, kappa: 2, lambda: 8 }), rng = seeded(11);
  return { lattice, paths: Array.from({ length: count }, () => sampleWalk(lattice.graph, field, latticeNode(lattice, 0, 0), 0, rng)!) };
};

test("between places the walk goes around a place in its way rather than through it", () => {
  const { lattice, paths } = walks([from, to, between], 20);
  const through = paths.filter((path) => path.some((node) => Math.hypot(lattice.graph.x[node] - between.x, lattice.graph.z[node] - between.z) < between.r)).length;
  assert.ok(paths.every(Boolean), "every walk arrives");
  assert.ok(through <= 3, `few walks cross the place between (${through} of 20)`);
});

test("the walk enters a place more squarely when slanted crossings cost more", () => {
  // How square each walk's crossing into the destination's circle is: |cos| between its step and the radius there.
  const squareness = (crossing: typeof CROSSING) => {
    const { lattice, paths } = walks([from, to], 30, crossing), x = lattice.graph.x, z = lattice.graph.z;
    return paths.reduce((sum, path) => {
      const k = path.findIndex((node) => Math.hypot(x[node] - to.x, z[node] - to.z) < to.r), a = path[k - 1], b = path[k];
      const dx = x[b] - x[a], dz = z[b] - z[a], rx = x[b] - to.x, rz = z[b] - to.z;
      return sum + Math.abs(dx * rx + dz * rz) / (Math.hypot(dx, dz) * Math.max(1e-9, Math.hypot(rx, rz)));
    }, 0) / paths.length;
  };
  assert.ok(squareness(CROSSING) > squareness({ mu: CROSSING.mu, nu: 0 }), "ν > 0 squares the entry");
});

test("a lattice walk smooths into the line it stands for, its ends kept", () => {
  // A stair-step walk toward (12, 6): two steps along x, one diagonal, repeated.
  const stairs: [number, number][] = [[0, 0], [4, 0], [8, 0], [12, 4], [16, 4], [20, 4], [24, 8], [28, 8], [32, 8], [36, 12]];
  const smooth = smoothPath(stairs), off = (points: [number, number][]) => Math.max(...points.map(([x, z]) => Math.abs(z - x / 3)));
  assert.deepEqual([smooth[0], smooth.at(-1)], [stairs[0], stairs.at(-1)]);
  assert.ok(off(smooth.slice(2, -2)) < off(stairs.slice(2, -2)) / 2, "the inner points lie much nearer the line");
});
