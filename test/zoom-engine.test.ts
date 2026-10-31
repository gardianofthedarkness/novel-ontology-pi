import assert from "node:assert/strict";
import { test } from "node:test";
import { detailFrame, extentOf, framesFor, freeSpace, LADDER, poolExtent, sanity, tagScale, widthOf, type Box } from "../src/v2/context/zoom.js";

test("an area's extent is its kept box, else its kept parts' span, else its circle (a guess); a pool's is its members' span within its holder", () => {
  const circle = { x: 0, z: 0, r: 800 };
  assert.deepEqual(extentOf([0, 0, 500, 400], [], circle), { box: [0, 0, 500, 400], by: "kept" });
  assert.equal(extentOf(null, [[0, 0, 100, 100], [200, 0, 300, 100]], circle)?.by, "parts");
  assert.deepEqual(extentOf(null, [], circle), { box: [-800, -800, 800, 800], by: "circle" });
  assert.equal(poolExtent([], [0, 0, 1000, 1000]), null, "no member boxed: no ground, never a sampled square");
  const pool = poolExtent([[100, 100, 200, 150], [300, 120, 380, 200]], [0, 0, 1000, 1000])!;
  assert.ok(pool[0] < 100 && pool[2] > 380 && widthOf(pool) < 500, `the members' span and a margin: ${pool}`);
  assert.deepEqual(poolExtent([[900, 900, 990, 990]], [0, 0, 1000, 1000])?.slice(2), [1000, 1000], "within its holder");
});

test("frames: one when the parent fits at the part's scale, else the parent for context and a work frame at the part's scale, kept inside it", () => {
  const small: Box = [0, 0, 540, 400];
  const one = framesFor("street", [100, 100], small);
  assert.equal(one.context, null, "a 540 m district holds a street's scale");
  assert.ok(one.work.half >= 270, "the whole district shown");
  const big: Box = [0, 0, 3000, 2400], two = framesFor("street", [2900, 100], big);
  assert.ok(two.context && two.context.half >= 1500, "the district as context");
  const share = Math.sqrt(LADDER.street.sizes[0] * LADDER.street.sizes[1]) / (2 * two.work.half);
  assert.ok(Math.abs(share - 1 / 6) < 0.01, `a street's usual size a sixth of the work frame: ${share.toFixed(3)}`);
  assert.ok(two.work.x + two.work.half <= 3000 && two.work.z - two.work.half >= 0, "kept inside the district");
  const detail = detailFrame([0, 0, 20, 10], "street");
  assert.ok(detail.half >= LADDER.street.sizes[0] * 0.95, "a detail frame at least a street's least size");
});

test("tags by tier: the parent's level largest, the part's own large, its siblings middling, smaller places small", () => {
  assert.ok(tagScale("district", "street") > tagScale("street", "street") && tagScale("street", "street") > tagScale("building", "street"));
  assert.ok(tagScale(null, "street", true) > tagScale("street", "street"));
});

test("free space: the parent's ground under no taken box, with the largest free rectangle", () => {
  const frame = { x: 500, z: 500, half: 500, level: "street" as const, purpose: "work" as const, tag: 20 };
  const { rects, largest } = freeSpace(frame, [0, 0, 1000, 1000], [[0, 0, 500, 1000]], 16);
  assert.ok(rects.every((rect) => rect[0] >= 500), "nothing free under the taken half");
  assert.deepEqual(largest, [500, 0, 1000, 1000], "the free half");
  assert.equal(freeSpace(frame, [0, 0, 1000, 1000], [[0, 0, 1000, 1000]], 8).largest, null);
});

test("sanity: too big or small for its level, its middle outside its parent, more than a third of it, over a place it may not share", () => {
  const parent = { box: [0, 0, 600, 400] as Box, name: "District Seven" };
  assert.deepEqual(sanity([100, 100, 200, 150], "street", parent), []);
  assert.match(sanity([100, 100, 110, 105], "street", parent).join(), /too small for a street/);
  assert.match(sanity([0, 0, 500, 300], "street", parent).join(), /too big for a street|more than a third/);
  assert.match(sanity([700, 100, 800, 150], "street", parent).join(), /outside District Seven/);
  assert.match(sanity([100, 100, 200, 150], "street", parent, [{ box: [150, 120, 300, 200], reason: "it is over a square" }]).join(), /over a square/);
});
