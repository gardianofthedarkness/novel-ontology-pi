import { test } from "node:test";
import assert from "node:assert/strict";
import { dphi, ease, phi, solveSpiral, spiralTracks, SPIRAL, type SpiralRun } from "../src/digger/timeplace/spiral.js";

const knots = (id: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => ({ id: `${id}${from + k}`, x: (from + k) * SPIRAL.dx }));
/** The handout's shape: a parent forks into A, B, C; A and B later merge into A+B; C runs on. */
const demo: SpiralRun[] = [
  { id: "P", knots: knots("p", 0, 12) },
  { id: "A", knots: knots("a", 13, 40), from: { run: "P", x: 12 * SPIRAL.dx }, into: { run: "AB", x: 41 * SPIRAL.dx } },
  { id: "B", knots: knots("b", 13, 40), from: { run: "P", x: 12 * SPIRAL.dx }, into: { run: "AB", x: 41 * SPIRAL.dx } },
  { id: "C", knots: knots("c", 13, 54), from: { run: "P", x: 12 * SPIRAL.dx } },
  { id: "AB", knots: knots("m", 41, 54) },
];

test("the exact half-turn average and its derivative match numeric integration; the ease is C²", () => {
  const numeric = (A: number, B: number) => { let sum = 0; const n = 20000; for (let k = 0; k < n; k++) sum += Math.max(A - B * Math.cos(((k + 0.5) * Math.PI) / n) ** 2, 0); return sum / n; };
  for (const [A, B] of [[0.5, 0.2], [0.5, 0.5], [0.5, 1.4], [0.9, 4], [0.2, 0.9]]) {
    assert.ok(Math.abs(phi(A, B) - numeric(A, B)) < 1e-4, `Φ(${A}, ${B})`);
    const h = 1e-5;
    assert.ok(Math.abs(dphi(A, B) - (phi(A, B + h) - phi(A, B - h)) / (2 * h)) < 1e-3, `Φ′(${A}, ${B})`);
  }
  assert.equal(phi(0, 1), 0);
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.equal(ease(0.5), 0.5);
});

test("the solver lowers crowding on a fork and merge, keeps every knot in the frame, and is deterministic", () => {
  const solution = solveSpiral(demo, { iterations: 250 });
  assert.ok(solution.objective < solution.initial.objective, `objective ${solution.initial.objective.toFixed(4)} → ${solution.objective.toFixed(4)}`);
  assert.ok(solution.overlap <= solution.initial.overlap, `overlap ${solution.initial.overlap.toFixed(3)} → ${solution.overlap.toFixed(3)}`);
  for (const [id, c] of solution.centers) assert.ok(Math.hypot(...c) + solution.coils.get(id)! + SPIRAL.knot <= SPIRAL.radial + 1e-6, `${id} in the frame`);
  // Children leave from the parent and the merge meets its target exactly (tracks join).
  const tracks = spiralTracks(demo, solution);
  const at = (id: string, x: number) => tracks.find((track) => track.id === id)!.track.find((point) => Math.abs(point[0] - x) < 1e-6)!;
  const fork = 12 * SPIRAL.dx, merge = 41 * SPIRAL.dx;
  for (const child of ["A", "B", "C"]) assert.ok(Math.hypot(at(child, fork)[1] - at("P", fork)[1], at(child, fork)[2] - at("P", fork)[2]) < 25, `${child} starts at the parent's coil`);
  for (const parent of ["A", "B"]) assert.ok(Math.hypot(at(parent, merge)[1] - at("AB", merge)[1], at(parent, merge)[2] - at("AB", merge)[2]) < 25, `${parent} ends at the merge`);
  assert.deepEqual(solveSpiral(demo, { iterations: 250 }).centers, solution.centers);
});

test("three equal parallel strands settle near an equilateral arrangement", () => {
  const solution = solveSpiral([{ id: "x", knots: knots("x", 0, 30) }, { id: "y", knots: knots("y", 0, 30) }, { id: "z", knots: knots("z", 0, 30) }], { iterations: 300 });
  const c = [...solution.centers.values()];
  const d = [[0, 1], [1, 2], [0, 2]].map(([i, j]) => Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]));
  assert.ok(Math.max(...d) / Math.min(...d) < 1.25, `pair distances ${d.map((value) => value.toFixed(0)).join(", ")}`);
});

test("tracks pass through their knots and carry a tube radius", () => {
  const solution = solveSpiral(demo, { iterations: 50, starts: 1 });
  for (const track of spiralTracks(demo, solution)) {
    for (const knot of track.knots) assert.ok(track.track.some((point) => point[0] === knot.x && point[1] === knot.q[0] && point[2] === knot.q[1]), `${knot.id} on its track`);
    assert.ok(track.tube > SPIRAL.knot);
  }
});
