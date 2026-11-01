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

test("free ground: a spot on kept ground moves to the nearest free stretch; two zooms when asked; crowding a compatible place is asked again", async () => {
  const { nearestFree, overlapShare, CROWDED } = await import("../src/v2/context/zoom.js");
  const frame = { x: 500, z: 500, half: 500, level: "street" as const, purpose: "context" as const, tag: 20 };
  const kept: Box[] = [[0, 0, 600, 1000]];
  const open = nearestFree(frame, [0, 0, 1000, 1000], kept, [300, 500], 126)!;
  assert.ok(open[0] - 63 >= 600 - 1 && Math.abs(open[1] - 500) < 60, `beside the kept ground, near the spot: ${open}`);
  assert.equal(nearestFree(frame, [0, 0, 1000, 1000], [[0, 0, 1000, 1000]], [300, 500], 126), null, "no free ground: none");
  const both = framesFor("street", [100, 100], [0, 0, 540, 400], undefined, true);
  assert.ok(both.context && both.work.half < both.context.half, "two zooms at a time, even where one would do");
  assert.ok(overlapShare([0, 0, 100, 100], [50, 0, 150, 100]) === 0.5 && overlapShare([0, 0, 100, 100], [200, 0, 300, 100]) === 0);
  const crowd = [{ box: [0, 0, 200, 100] as Box, reason: "it lies mostly over an avenue" }];
  assert.match(sanity([10, 10, 190, 90], "street", null, [], crowd).join(), /mostly over an avenue/, `over ${CROWDED} of it: asked again`);
  assert.deepEqual(sanity([180, 10, 300, 90], "street", null, [], crowd), [], "touching it: fine");
});

test("an area sized by its pins: its kind's usual size when that holds three buildings a pin, else grown, proportions kept, within its level", async () => {
  const { sizeByPins, PER_PIN } = await import("../src/v2/context/zoom.js");
  const few = sizeByPins("street", [200, 80], 200, 0.9, 5);
  assert.deepEqual(few.size, [200, 80], `five pins fit a usual street: holds ${few.holds}, needs ${few.needs}`);
  assert.equal(few.grown, false);
  const many = sizeByPins("street", [200, 80], 200, 0.9, 60);
  assert.ok(many.grown && many.size[0] > 200 && Math.abs(many.size[0] / many.size[1] - 2.5) < 0.01, `grown, proportions kept: ${many.size}`);
  assert.ok(many.holds >= 60 * PER_PIN * 0.98, "now it holds them");
  assert.ok(sizeByPins("street", [200, 80], 200, 0.9, 5000).size[0] <= 400, "never past a street's most");
  assert.ok(sizeByPins("district", [100, 100], 2000, 0.9, 0).size[0] >= 300, "never under a district's least");
});

test("placement as one optimization: near what it is tied to, on free ground, never over what it may not share, inside its parent", async () => {
  const { placeArea } = await import("../src/v2/context/zoom.js");
  const frame = { x: 500, z: 500, half: 500, level: "street" as const, purpose: "context" as const, tag: 20 };
  const parent: Box = [0, 0, 1000, 1000];
  const free = placeArea(frame, parent, [100, 60], [500, 500], [], [], [])!;
  assert.ok(Math.hypot(free.at[0] - 500, free.at[1] - 500) < 30, `nothing in the way: at its spot (${free.at})`);
  const tiedTo = placeArea(frame, parent, [100, 60], [500, 500], [{ at: [850, 850], ties: 4 }], [], [])!;
  assert.ok(tiedTo.at[0] > 700 && tiedTo.at[1] > 700, `drawn to what it is tied to: ${tiedTo.at}`);
  const blocked = placeArea(frame, parent, [100, 60], [500, 500], [], [[300, 300, 700, 700]], [])!;
  const box: Box = [blocked.at[0] - 50, blocked.at[1] - 30, blocked.at[0] + 50, blocked.at[1] + 30];
  assert.ok(!(box[0] < 700 && 300 < box[2] && box[1] < 700 && 300 < box[3]), `never over a place it may not share: ${blocked.at}`);
  assert.equal(placeArea(frame, parent, [100, 60], [500, 500], [], [[0, 0, 1000, 1000]], []), null, "no room: none");
});

test("what is there first: a street laid on a form its ground made, turned along it, when near; open ground when the form is far or taken", async () => {
  const { placeArea, turnedBox, ONTO_REACH } = await import("../src/v2/context/zoom.js");
  const frame = { x: 500, z: 500, half: 500, level: "street" as const, purpose: "context" as const, tag: 20 };
  const parent: Box = [0, 0, 1000, 1000];
  assert.deepEqual(turnedBox([0, 0], [200, 80], Math.PI / 2), [-40, -100, 40, 100], "a quarter turn swaps its sides");
  const near = { at: [560, 520] as [number, number], turn: Math.PI / 4, what: "arterial road" };
  const laid = placeArea(frame, parent, [200, 80], [500, 500], [], [], [], 48, [near])!;
  assert.equal(laid.onto?.what, "arterial road", `taken: ${laid.at}`);
  assert.deepEqual(laid.at, [560, 520]);
  const far = { at: [950, 950] as [number, number], turn: 0, what: "arterial road" };
  assert.equal(placeArea(frame, parent, [200, 80], [500, 500], [], [], [], 48, [far])!.onto, undefined, `further than ${ONTO_REACH} of its own lengths beyond open ground: not taken`);
  const taken = placeArea(frame, parent, [200, 80], [500, 500], [], [[520, 480, 620, 560]], [], 48, [near])!;
  assert.equal(taken.onto, undefined, "a form under a place it may not share is not one to lay it on");
});

test("room for one more: a city with no box of its own grows round its parts until a second district fits beside its first", async () => {
  const { roomFor, placeArea, COVER, extentOf } = await import("../src/v2/context/zoom.js");
  const first: Box = [41.6, 326.1, 641.6, 926.1], span = extentOf(null, [first], null, 0.3)!;
  const frame = (box: Box) => ({ x: (box[0] + box[2]) / 2, z: (box[1] + box[3]) / 2, half: Math.max(box[2] - box[0], box[3] - box[1]) / 2, level: "district" as const, purpose: "context" as const, tag: 20 });
  assert.equal(placeArea(frame(span.box), span.box, [600, 600], [-338, 200], [], [first], []), null, "its first district's span alone holds no second beside it (vol 1's second district)");
  const room = roomFor(span, [first], [600, 600], 8000);
  assert.ok((room.box[2] - room.box[0]) * (room.box[3] - room.box[1]) * COVER >= 2 * 600 * 600 * 0.99, `room for both at ${COVER}: ${room.box}`);
  assert.ok(placeArea(frame(room.box), room.box, [600, 600], [-338, 200], [], [first], []), "a second district fits");
  assert.deepEqual(roomFor({ box: [0, 0, 100, 100], by: "kept" }, [first], [600, 600]).box, [0, 0, 100, 100], "a kept box is as it was kept");
  assert.ok(roomFor(span, [first], [600, 600], 1000).box[2] - roomFor(span, [first], [600, 600], 1000).box[0] <= 1000.1, "never past its level's most");
});

test("settling: one objective for an area's placed parts; each move lowers it, the sweeps end, clashes are never crossed", async () => {
  const { settle } = await import("../src/v2/context/zoom.js");
  const parent: Box = [0, 0, 1000, 1000];
  // A one-pass order left two tied streets apart: the first placed before the second existed.
  const movers = [
    { id: "a", size: [100, 60] as [number, number], turn: 0, at: [150, 150] as [number, number], pin: [150, 150] as [number, number] },
    { id: "b", size: [100, 60] as [number, number], turn: 0, at: [850, 850] as [number, number], pin: [850, 850] as [number, number] },
    { id: "c", size: [100, 60] as [number, number], turn: 0, at: [500, 150] as [number, number], pin: [500, 150] as [number, number] },
  ];
  const ties: Record<string, number> = { "a|b": 6, "b|c": 1 }, tie = (x: string, y: string) => ties[[x, y].sort().join("|")] ?? 0;
  const wall = { id: "w", box: [400, 400, 600, 600] as Box, at: [500, 500] as [number, number] };
  const out = settle(movers, [wall], tie, (x, y) => (y === "w" ? "clash" : "adjoin"), parent);
  assert.ok(out.sweeps.length >= 1 && out.sweeps.length < 12, `the sweeps end: ${out.sweeps.length}`);
  assert.equal(out.overlaps[0], 0, "a feasible start");
  assert.ok(out.objective.every((e, i) => i === 0 || e < out.objective[i - 1]), `from a feasible start the objective falls every sweep: ${out.objective}`);
  assert.ok(out.energy.every((e, i) => i === 0 || e <= out.energy[i - 1]), `never rising: ${out.energy}`);
  assert.ok(out.energy.at(-1)! < out.energy[0] * 0.5, `the tied pair drawn together: ${out.energy[0]} → ${out.energy.at(-1)}`);
  for (const m of out.movers) { const [x, z] = m.at; assert.ok(!(x + 50 > 400 && x - 50 < 600 && z + 30 > 400 && z - 30 < 600), `never over the clash: ${m.id} at ${m.at}`); }
  assert.deepEqual(settle(out.movers, [wall], tie, (x, y) => (y === "w" ? "clash" : "adjoin"), parent).sweeps, [], "settled stays settled");
});

test("settling takes a form of its kind when near, turned along it (what is there first, inside the one objective)", async () => {
  const { settle } = await import("../src/v2/context/zoom.js");
  const road = { at: [560, 520] as [number, number], turn: Math.PI / 4, what: "arterial road" };
  const out = settle([{ id: "a", size: [200, 80], turn: 0, at: [500, 500], pin: [500, 500], onto: [road] }], [], () => 0, () => "adjoin", [0, 0, 1000, 1000]);
  assert.deepEqual(out.movers[0].at, [560, 520]);
  assert.equal(out.movers[0].on, true);
  assert.ok(Math.abs(out.movers[0].turn - Math.PI / 4) < 1e-9);
  const far = settle([{ id: "a", size: [200, 80], turn: 0, at: [500, 500], pin: [500, 500], onto: [{ ...road, at: [950, 950] }] }], [], () => 0, () => "adjoin", [0, 0, 1000, 1000]);
  assert.equal(far.movers[0].on ?? false, false, "a form further than its own length is not worth its pin");
});

test("settling clears an overlap the objective cannot price first, whatever it costs", async () => {
  const { settle } = await import("../src/v2/context/zoom.js");
  const wall = { id: "w", box: [400, 400, 600, 600] as Box, at: [500, 500] as [number, number] };
  const out = settle([{ id: "a", size: [100, 60], turn: 0, at: [500, 500], pin: [500, 500] }], [wall], () => 0, () => "clash", [0, 0, 1000, 1000]);
  assert.deepEqual([out.overlaps[0], out.overlaps.at(-1)], [1, 0]);
  assert.ok(out.objective.at(-1)! > out.objective[0], "it moves off its pin to clear it");
});
