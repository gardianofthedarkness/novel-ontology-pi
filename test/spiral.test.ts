import { test } from "node:test";
import assert from "node:assert/strict";
import { dphi, ease, phi, solveSpiral, spiralTracks, stretchTime, SPIRAL, type SpiralRun } from "../src/digger/timeplace/spiral.js";

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

test("the solver lowers crowding on a fork and merge, keeps every knot in the floor box, and is deterministic", () => {
  const solution = solveSpiral(demo, { iterations: 250 });
  assert.ok(solution.objective < solution.initial.objective, `objective ${solution.initial.objective.toFixed(4)} → ${solution.objective.toFixed(4)}`);
  assert.ok(solution.overlap <= solution.initial.overlap, `overlap ${solution.initial.overlap.toFixed(3)} → ${solution.overlap.toFixed(3)}`);
  const { width, height } = solution.frame;
  assert.ok(width > height, "the box is wider than tall");
  for (const [id, [y, z]] of solution.centers) {
    const edge = solution.coils.get(id)! + SPIRAL.knot;
    assert.ok(y >= edge - 1e-6 && y <= height - edge + 1e-6 && Math.abs(z) <= width / 2 - edge + 1e-6, `${id} in the floor box`);
  }
  // Children leave from the parent and the merge meets its target exactly (tracks join).
  const tracks = spiralTracks(demo, solution);
  const at = (id: string, x: number) => tracks.find((track) => track.id === id)!.track.find((point) => Math.abs(point[0] - x) < 1e-6)!;
  const fork = 12 * SPIRAL.dx, merge = 41 * SPIRAL.dx;
  for (const child of ["A", "B", "C"]) assert.ok(Math.hypot(at(child, fork)[1] - at("P", fork)[1], at(child, fork)[2] - at("P", fork)[2]) < 1, `${child} starts at the parent's coil`);
  for (const parent of ["A", "B"]) assert.ok(Math.hypot(at(parent, merge)[1] - at("AB", merge)[1], at(parent, merge)[2] - at("AB", merge)[2]) < 1, `${parent} ends at the merge`);
  assert.deepEqual(solveSpiral(demo, { iterations: 250 }).centers, solution.centers);
});

test("strands spread over the floor before they stack up: three equal strands side by side at one low height", () => {
  const solution = solveSpiral([{ id: "x", knots: knots("x", 0, 30) }, { id: "y", knots: knots("y", 0, 30) }, { id: "z", knots: knots("z", 0, 30) }], { iterations: 300 });
  const c = [...solution.centers.values()].sort((first, second) => first[1] - second[1]);
  const heights = c.map(([y]) => y), depths = c.map(([, z]) => z);
  assert.ok(Math.max(...heights) - Math.min(...heights) < 0.25 * solution.frame.height, `heights ${heights.map((value) => value.toFixed(0)).join(", ")}`);
  assert.ok(Math.max(...heights) < 0.5 * solution.frame.height, "low in the box");
  for (let k = 1; k < 3; k++) { const [a, b] = [c[k - 1], c[k]], need = 2 * solution.coils.get("x")! + 2 * SPIRAL.knot + SPIRAL.gap + SPIRAL.clearance; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 0.9 * need, `neighbours ${depths.map((value) => value.toFixed(0)).join(", ")} apart`); }
});

test("the denser a strand's scenes, the thicker its coil", () => {
  const every = knots("d", 0, 30), sparse = knots("s", 0, 30).filter((_, k) => k % 5 === 0);
  const solution = solveSpiral([{ id: "dense", knots: every }, { id: "sparse", knots: sparse }], { iterations: 50, starts: 1 });
  assert.equal(solution.coils.get("dense"), SPIRAL.coil[1], "the densest strand is the thickest");
  assert.ok(solution.coils.get("sparse")! < SPIRAL.coil[0] + 0.3 * (SPIRAL.coil[1] - SPIRAL.coil[0]), `sparse coil ${solution.coils.get("sparse")!.toFixed(1)}`);
  const tubes = new Map(spiralTracks([{ id: "dense", knots: every }, { id: "sparse", knots: sparse }], solution).map((track) => [track.id, track.tube]));
  assert.ok(tubes.get("dense")! > tubes.get("sparse")!, "and its tube guide is wider");
});

test("time widens where more strands are alive", () => {
  assert.deepEqual(stretchTime([[0, 4], [2, 3]], 6), [0, 9, 22.5, 36, 49.5, 58.5]);
  assert.deepEqual(stretchTime([], 3), [0, 9, 18], "a quiet stretch keeps one step per layer");
});

test("tracks pass through their knots and carry a tube radius", () => {
  const solution = solveSpiral(demo, { iterations: 50, starts: 1 });
  for (const track of spiralTracks(demo, solution)) {
    for (const knot of track.knots) assert.ok(track.track.some((point) => point[0] === knot.x && point[1] === knot.q[0] && point[2] === knot.q[1]), `${knot.id} on its track`);
    assert.ok(track.tube > SPIRAL.knot);
  }
});
