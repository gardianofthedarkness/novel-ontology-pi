import { test } from "node:test";
import assert from "node:assert/strict";
import { addRipple, breathOffset, createMotionBus, glintLevel, rayPlanePoint, rippleOffset, RIPPLE_LIFE, RIPPLE_SPEED, scheduleGlints } from "../apps/playground/src/data/orbitalMotion.js";
import type { OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const node = (id: string): WorldNode => ({ id, kind: "scene", label: id, chrono: 0, state: "canon", lane: "canon", parent: "chapter_1", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const draw = (id: string, x: number, role: OrbitalDraw["role"] = "main", prominence?: number): OrbitalDraw => ({ node: node(id), position: [x, 0, 0], radius: 100, role, prominence });
const edge = (from: string, to: string, weight: number): WorldEdge => ({ id: `${from}:${to}`, from, to, kind: "contains", state: "canon", parent: "chapter_1", weight });

test("spine spheres breathe as a wave travelling along time, a few percent of their radius", () => {
  const a = breathOffset(draw("a", 0), 1), b = breathOffset(draw("b", 600), 1);
  assert.notEqual(a[1], b[1], "neighbours are out of phase");
  assert.equal(a[0], 0); assert.equal(a[2], 0);
  for (let t = 0; t < 10; t += 0.37) assert.ok(Math.abs(breathOffset(draw("a", 0), t)[1]) <= 5.0001);
  const strong = draw("strong", 0, "nebula", 1), weak = draw("weak", 0, "nebula", 0);
  const reach = (entry: OrbitalDraw) => Math.max(...Array.from({ length: 50 }, (_, index) => Math.hypot(...breathOffset(entry, index * 0.5))));
  assert.ok(reach(weak) > reach(strong), "weakly linked entities drift further");
  assert.deepEqual(breathOffset(draw("x", 0, "connection"), 3), [0, 0, 0]);
});

test("a blank click pushes spheres outward as the front passes, then fades out", () => {
  const ripples = [{ kind: "blank" as const, origin: [0, 0, 0] as [number, number, number], start: 0 }];
  const at = (x: number, t: number) => rippleOffset([x, 0, 0], t, ripples)[0];
  const arrival = 1300 / RIPPLE_SPEED;
  assert.ok(at(1300, arrival) > 30, "pushed outward when the front arrives");
  assert.ok(at(-1300, arrival) < -30, "outward on the other side too");
  assert.ok(Math.abs(at(1300, arrival + 1)) < Math.abs(at(1300, arrival)), "front has moved on");
  assert.deepEqual(rippleOffset([1300, 0, 0], RIPPLE_LIFE + 0.1, ripples), [0, 0, 0]);
  assert.deepEqual(rippleOffset([1300, 0, 0], -1, ripples), [0, 0, 0], "not before it starts");
});

test("a selection wave lifts along the timeline only", () => {
  const ripples = [{ kind: "select" as const, origin: [0, 500, 0] as [number, number, number], start: 0 }];
  const offset = rippleOffset([1200, -400, 300], 1200 / RIPPLE_SPEED, ripples);
  assert.equal(offset[0], 0); assert.equal(offset[2], 0);
  assert.ok(offset[1] > 30, "distance is measured along time (x), not in 3D");
});

test("ripples are bounded and old ones expire", () => {
  const bus = createMotionBus();
  for (let index = 0; index < 9; index++) addRipple(bus, { kind: "blank", origin: [0, 0, 0], start: index * 0.1 });
  assert.equal(bus.ripples.length, 6);
  addRipple(bus, { kind: "blank", origin: [0, 0, 0], start: 10 });
  assert.equal(bus.ripples.length, 1, "expired ripples are dropped");
});

test("linked entities glint strongest first, staggered, and fade", () => {
  const bus = createMotionBus();
  const order = scheduleGlints(bus, "scene", [edge("weak", "scene", 1), edge("scene", "strong", 5), edge("mid", "scene", 3), edge("other", "x", 9)], 10);
  assert.deepEqual(order, ["strong", "mid", "weak"]);
  assert.ok(bus.glints.get("strong")! < bus.glints.get("weak")!);
  const start = bus.glints.get("strong")!;
  assert.equal(glintLevel(start, start - 0.1), 0);
  assert.ok(glintLevel(start, start + 0.45) > 0.9);
  assert.equal(glintLevel(start, start + 2), 0);
  assert.equal(glintLevel(undefined, 1), 0);
});

test("blank clicks find their point on the timeline plane", () => {
  assert.deepEqual(rayPlanePoint([0, 1000, 0], [0, -1, 0], 0), [0, 0, 0]);
  assert.equal(rayPlanePoint([0, 1000, 0], [1, 0, 0], 0), null, "parallel ray");
  assert.equal(rayPlanePoint([0, 1000, 0], [0, 1, 0], 0), null, "plane behind the camera");
});
