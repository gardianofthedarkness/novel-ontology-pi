import { test } from "node:test";
import assert from "node:assert/strict";
import { carryPose, carryTangent, interpolatePose, type OrbitalPose } from "../apps/playground/src/data/orbitalLayout.js";

const from: OrbitalPose = { position: [0, 0, 0], radius: 100 };
const to: OrbitalPose = { position: [1000, 0, 0], radius: 200 };

test("without a tangent a carried transition is the ordinary smooth morph", () => {
  for (const progress of [0, 0.2, 0.5, 0.9, 1]) assert.deepEqual(carryPose(from, to, progress), interpolatePose(from, to, progress));
});

test("an interrupted transition keeps moving the way it was going, then settles on target", () => {
  const tangent: [number, number, number] = [0, 600, 0];
  assert.deepEqual(carryPose(from, to, 0, tangent).position, [0, 0, 0], "starts where it was");
  assert.ok(carryPose(from, to, 0.1, tangent).position[1] > 30, "momentum carries it sideways at first");
  assert.deepEqual(carryPose(from, to, 1, tangent), to, "ends exactly on target");
  const late = carryPose(from, to, 0.999, tangent), end = carryPose(from, to, 1, tangent);
  assert.ok(Math.hypot(...late.position.map((value, axis) => value - end.position[axis])) < 1, "and arrives at rest");
});

test("tangents come from velocity over the duration, capped to avoid wild overshoot", () => {
  assert.equal(carryTangent([0, 0, 0], 1.1, from, to), undefined);
  assert.deepEqual(carryTangent([100, 0, 0], 1.1, from, to)!.map(Math.round), [110, 0, 0]);
  const fast = carryTangent([0, 1e6, 0], 1.1, from, to)!;
  assert.ok(Math.abs(Math.hypot(...fast) - 1500) < 1e-6, "capped at 1.5x the travel");
  const still = carryTangent([0, 1e6, 0], 1.1, to, to)!;
  assert.ok(Math.abs(Math.hypot(...still) - 300) < 1e-6, "short hops cap at the target's size");
});
