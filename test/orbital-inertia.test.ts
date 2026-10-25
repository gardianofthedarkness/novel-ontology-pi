import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInertiaRig, stepInertia } from "../apps/playground/src/data/orbitalMotion.js";
import type { OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldNode } from "../apps/playground/src/types.js";

const node = (id: string): WorldNode => ({ id, kind: "scene", label: id, chrono: 0, state: "canon", lane: "canon", parent: "chapter_1", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const draw = (id: string, position: [number, number, number], role: OrbitalDraw["role"] = "main", prominence?: number): OrbitalDraw => ({ node: node(id), position, radius: 100, role, prominence });
const world = () => [draw("a", [0, 0, 0]), draw("b", [600, 0, 0]), draw("c", [1200, 0, 0]), draw("d", [1800, 0, 0]), draw("moon", [650, 300, 0], "nebula", 0.2)];
const run = (rig: ReturnType<typeof buildInertiaRig>, drive: [number, number, number], seconds: number, watch?: (t: number) => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) { stepInertia(rig, drive, 1 / 60); watch?.(t); }
};

test("a still camera leaves everything at rest", () => {
  const rig = buildInertiaRig(world());
  run(rig, [0, 0, 0], 2);
  for (const body of rig.bodies.values()) assert.deepEqual(body.p, [0, 0, 0]);
});

test("a camera push sways the world with it, then the liquid settles it back", () => {
  const rig = buildInertiaRig(world());
  run(rig, [4, 0, 0], 0.25);
  assert.ok(rig.bodies.get("b")!.p[0] > 1, "spine follows the push a little");
  run(rig, [0, 0, 0], 6);
  for (const body of rig.bodies.values()) assert.ok(Math.hypot(...body.p) < 0.5, "settled");
});

test("entities hang on their timeline sphere: they lag behind it and swing further", () => {
  const rig = buildInertiaRig(world());
  assert.equal(rig.tuning.get("moon")!.anchor, "b", "tied to the nearest timeline sphere");
  let spinePeak = { t: 0, x: 0 }, moonPeak = { t: 0, x: 0 };
  run(rig, [4, 0, 0], 0.25);
  run(rig, [0, 0, 0], 3, (t) => {
    const spine = rig.bodies.get("b")!.p[0], moon = rig.bodies.get("moon")!.p[0];
    if (spine > spinePeak.x) spinePeak = { t, x: spine };
    if (moon > moonPeak.x) moonPeak = { t, x: moon };
  });
  assert.ok(moonPeak.t > spinePeak.t, "the entity peaks later");
  assert.ok(moonPeak.x > spinePeak.x, "and swings further");
});

test("timeline spheres are strung together: a nudge travels to neighbours first", () => {
  const rig = buildInertiaRig(world());
  assert.deepEqual(rig.spine, ["a", "b", "c", "d"]);
  rig.bodies.get("a")!.p = [0, 40, 0];
  run(rig, [0, 0, 0], 0.15);
  assert.ok(rig.bodies.get("b")!.p[1] > rig.bodies.get("c")!.p[1], "the neighbour moves before the far bead");
  assert.ok(rig.bodies.get("c")!.p[1] > rig.bodies.get("d")!.p[1]);
});

test("violent camera jumps can't fling anything past its limit", () => {
  const rig = buildInertiaRig(world());
  run(rig, [1e6, -1e6, 1e6], 2);
  for (const [id, body] of rig.bodies) assert.ok(Math.hypot(...body.p) <= rig.tuning.get(id)!.limit + 1e-9, id);
});

test("rebuilding for new data keeps motion already in flight", () => {
  const first = buildInertiaRig(world());
  run(first, [4, 0, 0], 0.2);
  const moving = first.bodies.get("b")!.p[0];
  const second = buildInertiaRig([...world(), draw("e", [2400, 0, 0])], first);
  assert.equal(second.bodies.get("b")!.p[0], moving);
  assert.deepEqual(second.bodies.get("e")!.p, [0, 0, 0]);
});
