import assert from "node:assert/strict";
import { test } from "node:test";
import { formOf, LANDSCAPES, patchFromBox } from "../src/ground/stage/landscape.js";
import { shapeHall } from "../src/ground/stage/underground.js";
import { FLOATING, terrainHeights, terrainThickness } from "../src/v2/context/terrainModes.js";
import { withSlots, type KeptSlot } from "../src/v2/spawning/tree.js";

// The building level (docs/v2/borrow-and-spawn.md §6, §8.9): a street's buildings as its form builds them are its building
// slots; a building that borrows one stands in that street; floating objects asked their distance from the ground and
// their thickness.
const street = (type: string, w: number, d: number) => patchFromBox(type as never, "p0", "loc_t", { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 }, { by: "jev" });

test("a street's ground is built to its edge: rows behind its frontage, a lane between, none overlapping", () => {
  for (const [type, w, d] of [["terrace", 240, 110], ["alley", 160, 70]] as const) {
    const form = formOf(street(type, w, d)), front = form.buildings.filter((b) => /:row[ns]\d+$/.test(b.lot)), back = form.buildings.filter((b) => /:row[ns]\d+\.\d+$/.test(b.lot));
    assert.ok(front.length && back.length, `${type}: a frontage and rows behind it (${front.length}, ${back.length})`);
    for (const [n, a] of form.buildings.entries()) for (const b of form.buildings.slice(n + 1)) {
      const apart = Math.hypot(a.x - b.x, a.z - b.z) >= (Math.min(a.w, a.d) + Math.min(b.w, b.d)) / 2 - 0.5;
      assert.ok(apart, `${type}: ${a.lot} and ${b.lot} overlap`);
    }
  }
  const ring = formOf(street("square", 220, 220)).buildings.filter((b) => /:ring\d+\.\d+$/.test(b.lot));
  assert.ok(ring.length, "a square: rings behind its first");
});

test("a road along a street's axis is its own: its rows face it and do not break on it", () => {
  const avenue = street("avenue", 300, 120), alone = formOf(avenue).buildings.length;
  const [cx, cz] = [avenue.x, avenue.z], u = [Math.cos(avenue.shape.turn), Math.sin(avenue.shape.turn)];
  const along = { id: "R1", a: [cx - u[0] * 200, cz - u[1] * 200] as [number, number], b: [cx + u[0] * 200, cz + u[1] * 200] as [number, number], width: 24, level: "arterial" as const };
  assert.equal(formOf(avenue, [along]).buildings.length, alone, "the avenue's own road takes no building");
  const across = { ...along, id: "R2", a: [cx - u[1] * 200, cz + u[0] * 200] as [number, number], b: [cx + u[1] * 200, cz - u[0] * 200] as [number, number] };
  assert.ok(formOf(avenue, [across]).buildings.length < alone, "a road across it still breaks its rows");
});

test("a building slot is no place: what borrows it stands in its street; a spare lot adds nothing to the tree", () => {
  const tree = [{ id: "c1", label: "city", parentId: null }, { id: "st1", label: "a street", parentId: "c1" }, { id: "b1", label: "常盘台中学", parentId: "c1" }, { id: "unnamed:b2", label: "便利店 (scene 3)", parentId: "c1" }];
  const inputs = { placeTree: tree.map((place) => ({ ...place, path: [] })), world: { places: {} }, names: {} as Record<string, string>, scale: { places: {} } };
  const lot = (id: string, kind: string, extra: Partial<KeptSlot> = {}): KeptSlot => ({ id, parent: "st1", level: "building", kind, owner: null, sharers: [], damaged: [], layer: "form", book: "b1", toward: [10, 0], ...extra });
  const { moved, added } = withSlots(inputs, [lot("st1:rows1", "school", { owner: "b1" }), lot("st1:rows2", "convenience", { sharers: [{ book: "b1", mention: "unnamed:b2", scene: "s3" }] }), lot("st1:rows3", "house")], "b1");
  assert.deepEqual(added, [], "no building slot becomes a place");
  assert.deepEqual(moved, { b1: "st1", "unnamed:b2": "st1" }, "the named and the unnamed stand in the street");
  assert.equal(inputs.placeTree.length, 4);
});

test("a floating object is asked how far it is from the ground and how thick it is; a cavern lies from its bottom up", () => {
  for (const kind of FLOATING) assert.equal(terrainHeights("street", kind).measure, "elevation", `${kind}: its distance from the ground`);
  const elevation = terrainHeights("street", "platform").slices;
  assert.ok(elevation.some((slice) => slice.y === 0) && elevation.some((slice) => slice.y < 0) && elevation.some((slice) => slice.y >= 50), "on the ground, under it, high up");
  assert.equal(terrainHeights("street", "hill").measure, "top", "ground forms keep their top");
  assert.deepEqual(terrainThickness().map((slice) => slice.y), [1, 3, 6, 12, 25, 50]);
  const hall = shapeHall({ id: "s1", x: 0, z: 0, w: 60, d: 20, top: -6, bottom: -18 });
  assert.deepEqual([hall.depth, hall.height], [18, 12], "its floor at its bottom, as tall as it is thick");
  assert.equal(shapeHall({ id: "s2", x: 0, z: 0, w: 60, d: 20, top: -6 }).depth, 6, "an old cut keeps its depth");
  assert.ok(LANDSCAPES.terrace.row, "a residential street's rows");
});
