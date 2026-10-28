import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, BRAID, braidLayout, foldRows, packSlots, smooth, smootherstep, type BraidRun } from "../apps/playground/src/data/braidLayout.js";

const run = (id: string, layers: number[], extra: Partial<BraidRun> = {}): BraidRun => ({ id, scenes: layers.map((layer, index) => ({ id: `${id}${index}`, layer })), ...extra });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

test("the building blocks: slots are spaced, assignment is optimal, smoothing keeps pins, the ease is C²", () => {
  for (const n of [2, 3, 5, 7, 12]) {
    const slots = packSlots(n, 0.3);
    let closest = Infinity;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) closest = Math.min(closest, Math.hypot(slots[a][0] - slots[b][0], slots[a][1] - slots[b][1]));
    assert.ok(closest >= BRAID.spacing * 0.6, `${n} slots at least 0.6 spacing apart (${closest.toFixed(0)})`);
  }
  assert.deepEqual(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
  const smoothed = smooth([0, 10, 0, 10, 0, 10], [1e4, 1, 1, 1, 1, 1e4]);
  assert.ok(Math.abs(smoothed[0]) < 0.01 && Math.abs(smoothed[5] - 10) < 0.01, "pinned ends stay");
  assert.ok(Math.max(...smoothed.slice(1, 5)) - Math.min(...smoothed.slice(1, 5)) < 10, "the zigzag is smoothed");
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
  assert.equal(smootherstep(0.5), 0.5);
});

test("one strand runs down the middle of the tube", () => {
  const braid = braidLayout([run("a", range(0, 20))], 21);
  for (const [, q] of braid.at.get("a")!) assert.ok(Math.hypot(q[0], q[1]) < 1);
  assert.equal(braid.metrics.rows, braid.rows.length);
});

test("a split leaves the parent smoothly: children start on it, part to their own slots, never steeper than 30°", () => {
  const braid = braidLayout([
    run("main", range(0, 60)),
    run("left", range(21, 60), { from: { run: "main", layer: 20 } }),
    run("right", range(21, 60), { from: { run: "main", layer: 20 } }),
  ], 61);
  const main = braid.at.get("main")!.get(20)!;
  for (const id of ["left", "right"]) assert.deepEqual(braid.at.get(id)!.get(20), main, `${id} leaves from the main strand`);
  assert.ok(braid.metrics.minSeparation >= BRAID.spacing * 0.85, `apart once parted (${braid.metrics.minSeparation.toFixed(0)})`);
  assert.ok(braid.metrics.maxBranchDegrees <= BRAID.maxBranchDegrees + 3, `branch ${braid.metrics.maxBranchDegrees.toFixed(1)}°`);
  assert.ok(braid.radius[50] > braid.radius[5], "the tube swells for three strands");
});

test("a merge joins the other strand at its layer", () => {
  const braid = braidLayout([run("a", range(0, 50)), run("b", range(0, 30), { into: { run: "a", layer: 40 } })], 51);
  assert.deepEqual(braid.at.get("b")!.get(40), braid.at.get("a")!.get(40));
  assert.ok(braid.metrics.maxBranchDegrees <= BRAID.maxBranchDegrees + 3);
});

test("the time axis folds to fill the screen: more rows on a phone than a laptop, breaks on day starts", () => {
  const portrait = foldRows(300, 600, 0.46), landscape = foldRows(300, 600, 2.2);
  assert.ok(portrait.rows.length > landscape.rows.length, `${portrait.rows.length} rows portrait vs ${landscape.rows.length} landscape`);
  assert.ok(portrait.scaleGain > 1, "folding makes the bundle larger on screen");
  // Portrait: 8 rows of 37.5 layers; the fourth starts at 113, so a day starting at 111 takes its place.
  const snapped = foldRows(300, 600, 0.46, [111]);
  assert.ok(snapped.rows.some(([first]) => first === 111), "a break within 15% of the ideal moves to the day start");
  assert.ok(!foldRows(300, 600, 0.46, [97]).rows.some(([first]) => first === 97), "one farther away does not");
  // Rows join end to end: every layer is in exactly one row.
  const covered = portrait.rows.flatMap(([first, last]) => range(first, last));
  assert.deepEqual(covered, range(0, 299));
});

test("folded positions stay continuous through a turn, and the same input gives the same layout", () => {
  const runs = [run("a", range(0, 120)), run("b", range(30, 120), { from: { run: "a", layer: 29 } })];
  const braid = braidLayout(runs, 121, { aspect: 0.46 });
  assert.ok(braid.rows.length > 1);
  const turn = braid.rows[0][1];
  const before = braid.place(turn), mid = braid.place(turn + 0.5), after = braid.place(turn + 1);
  assert.ok(Math.hypot(mid[0] - before[0], mid[1] - before[1]) <= braid.band, "the turn stays near the row end");
  assert.ok(Math.abs(after[1] - (before[1] - braid.band)) < 1e-6, "the next row is one band lower");
  const axis = braid.axis("a");
  for (let index = 1; index < axis.points.length; index++) {
    const [p, q] = [axis.points[index - 1], axis.points[index]];
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < braid.band, "no jumps along an axis");
  }
  assert.deepEqual(braidLayout(runs, 121, { aspect: 0.46 }).at.get("b"), braid.at.get("b"));
});
