import assert from "node:assert/strict";
import test from "node:test";
import { columnSlices, DIRECTIONS, frameAlong, inWedge, planToGround, sideView, trueScaleSpan, wedgeOnGround } from "../../src/context/camera.js";

test("fourteen lettered directions: four level, up, down, eight diagonals; warm up, cool down", () => {
  assert.equal(DIRECTIONS.length, 14);
  assert.deepEqual(DIRECTIONS.map((d) => d.letter).join(""), "ABCDEFGHIJKLMN");
  assert.deepEqual(DIRECTIONS.reduce((n, d) => ({ ...n, [d.rise]: (n[d.rise] ?? 0) + 1 }), {} as Record<string, number>), { level: 4, up: 5, down: 5 });
  for (const d of DIRECTIONS) assert.ok(Math.abs(Math.hypot(...d.vector) - 1) < 1e-9);
  assert.notEqual(DIRECTIONS[4].color, DIRECTIONS[5].color);
});

test("the wedge: a spot ahead is in it, one behind or off to the side is not", () => {
  const at: [number, number, number] = [0, 0, 0], east = DIRECTIONS[0].vector;
  assert.ok(inWedge(at, east, [20, 0, 3]));
  assert.ok(!inWedge(at, east, [20, 0, 15]), "off by 37 degrees");
  assert.ok(!inWedge(at, east, [-5, 0, 0]));
  assert.ok(inWedge(at, DIRECTIONS[4].vector, [1, 12, 1]), "straight up: the roof above");
  assert.equal(wedgeOnGround(at, DIRECTIONS[4].vector, 30), null, "up has no wedge on the ground");
});

test("c1 frames the person and the arrow's whole reach; never under its least", () => {
  const box = frameAlong([100, 0, 50], DIRECTIONS[0].vector, 40);
  assert.ok(box[0] < 100 && box[2] > 140 && box[1] < 50 && box[3] > 50);
  assert.ok(Math.abs((box[2] - box[0]) - (box[3] - box[1])) < 0.2, "square");
  const small = frameAlong([0, 0, 0], DIRECTIONS[1].vector, 2);
  assert.ok(small[2] - small[0] >= 16);
  assert.equal(trueScaleSpan(1024), 108.8);
});

test("c2's column: underground, ground, floors, roof, then open air; letters from the lowest up", () => {
  const slices = columnSlices([{ name: "the bar", bottom: 0, floors: 2, below: 1 }]);
  assert.deepEqual(slices.slice(0, 4).map((s) => [s.letter, s.y, s.air]), [["A", -6, false], ["B", 0, false], ["C", 3, false], ["D", 6, false]]);
  assert.equal(slices[3].said, "the bar, its roof");
  assert.ok(slices.slice(4).every((s) => s.air && s.y > 7.5) && slices.at(-1)!.y === 60);
  const view = sideView([0, 0, 10, 10], DIRECTIONS[0].vector, slices);
  assert.equal(view.focus.y0, -6);
  assert.ok(Math.abs(view.yaw - Math.PI / 2) < 0.1, "square to the arrow");
});

test("a box on a north-up plan reads back onto the ground", () => {
  assert.deepEqual(planToGround([0.25, 0.25, 0.5, 0.75], { x: 100, z: 200, halfX: 40, halfZ: 20 }), [80, 190, 100, 210]);
});
