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

test("a street that takes the ground's own: an avenue on a wide road, a crossing where wide roads meet; no form, the fill stays", async () => {
  const { formsTaking, fillLandscape } = await import("../src/ground/stage/landscape.js");
  const road = (id: string, a: [number, number], b: [number, number], width: number, level: string) => ({ id, a, b, width, level });
  const roads = [road("A1", [-200, 0], [0, 0], 18, "arterial"), road("A2", [0, 0], [200, 0], 18, "arterial"), road("C1", [0, -150], [0, 0], 12, "collector"), road("C2", [0, 0], [0, 150], 12, "collector"), road("L1", [100, 0], [100, 120], 8, "local")];
  const avenue = formsTaking({ road: 18 }, roads);
  assert.ok(avenue.length && avenue.every((form) => form.what === "arterial road" && form.at[1] === 0), "an avenue: along the arterial road only");
  const crossing = formsTaking({ crossing: 12 }, roads);
  assert.deepEqual(crossing.map((form) => form.at), [[0, 0]], "a crossing: where the arterial and the collector cross, not where the narrow local road meets");
  const taken = { ...street("avenue", 240, 100), takes: "road" as const };
  assert.equal(formOf(taken).buildings.length, 0, "no rows of its own");
  const landscape = { seed: "t", patches: [taken] } as unknown as Parameters<typeof fillLandscape>[0];
  assert.ok(fillLandscape(landscape).fabric.buildings.some((b) => b.use && LANDSCAPES.avenue.uses!.includes(b.use)), "the city's lots on it are its buildings, with its uses");
});

test("the building level is asked as every level is: its kinds the uses the streets spawn and the models draw, its heights in floors", async () => {
  const { TERRAIN_KINDS, terrainKinds } = await import("../src/v2/context/terrainModes.js");
  const { MODELS } = await import("../src/ground/stage/useModels.js");
  const { readFileSync } = await import("node:fs");
  const street = JSON.parse(readFileSync("config/spawning/street.json", "utf8")).types as Record<string, { uses: Record<string, number> }>;
  const kinds = TERRAIN_KINDS.building;
  for (const use of new Set(Object.values(street).flatMap((type) => Object.keys(type.uses)))) assert.ok(kinds[use], `${use}: a street spawns it, so Jev may choose it`);
  for (const [kind, entry] of Object.entries(kinds)) {
    assert.ok(MODELS.uses[kind], `${kind}: the model table draws it`);
    assert.ok(!entry.floors, `${kind}: no heights of its own: a building's height is its scenes'`);
  }
  assert.ok(Object.keys(terrainKinds("building", { platform: "a platform" })).includes("platform"), "the shapes offered too, as at every level");
  // Every building the same slices, a house as a hotel: from under the street to a hundred floors (the user, 2026-11-01).
  const house = terrainHeights("building", "house"), hotel = terrainHeights("building", "hotel");
  assert.equal(house.measure, "top");
  assert.deepEqual(house.slices, hotel.slices);
  assert.deepEqual([house.slices.find((slice) => slice.y > 0), house.slices.at(-1)!.y], [{ letter: "E", y: 3, said: "1 floor" }, 300]);
});

test("the building inventory: every type a use the world draws, its words and floors; the search finds a building by its name and leans on what stands round it", async () => {
  const { loadBuildingTypes, searchBuildingTypes, wordScore } = await import("../src/v2/spawning/inventory.js");
  const { TERRAIN_KINDS } = await import("../src/v2/context/terrainModes.js");
  const types = loadBuildingTypes();
  assert.ok(Object.keys(types).length >= 60, "many types: too many to offer them all");
  for (const [id, type] of Object.entries(types)) {
    // A building's use is a building kind (its lots, its model); a shape's, a shape every level offers.
    assert.ok(type.use ? TERRAIN_KINDS.building[type.use] : ["cut", "platform", "sphere", "donut", "hill", "plateau", "basin", "ramp"].includes(type.shape!), `${id}: a building kind or a shape (${type.use ?? type.shape})`);
    assert.ok(type.describe && type.words.length, `${id}: described, its words`);
    assert.ok(!/floor|storey|tall|high-rise|tens of|many floors|few floors/i.test(type.describe), `${id}: its description says nothing of its height (${type.describe})`);
  }
  const top = async (label: string, nearby?: Record<string, number>) => (await searchBuildingTypes({ label, around: [], nearby }, types, 10)).map((found) => found.id);
  assert.equal((await top("回转寿司店 (scene 10)"))[0], "sushi-restaurant", "a compound name: its part");
  assert.equal((await top("二手车经销商 (scene 45)"))[0], "car-dealer");
  assert.equal((await top("看守所 (scene 2)"))[0], "detention-centre");
  assert.equal((await top("学生宿舍 (scene 7)"))[0], "student-dormitory");
  assert.equal((await top("便利商店 (scene 10)"))[0], "convenience-store", "the longest word it is called by, not the most short ones");
  assert.equal((await top("大楼 (scene 2)", { office: 10 })).length, 10, "always ten to choose among");
  assert.ok((await top("那一带 (scene 21)", { office: 10, shop: 2 })).slice(0, 3).every((id) => types[id].use === "office"), "with nothing found, what stands round it");
  assert.equal((await top("隧道 (scene 21)"))[0], "tunnel", "a shape the inventory knows: a tunnel");
  const around = await searchBuildingTypes({ label: "那栋建筑", around: ["她走进那栋建筑，柜台上摆满了拉面碗。"] }, types, 10);
  assert.equal(around[0].id, "ramen-shop", "the sentences round it when the name says nothing");
  assert.ok(wordScore(types["sushi-restaurant"], { label: "寿司", around: [] }) > wordScore(types["sushi-restaurant"], { label: "x", around: ["寿司"] }), "its name counts more than its sentences");
});

test("the building level's search by meaning: with an embedder the nearest by vectors, the name's own words still counting", async () => {
  const { searchBuildingTypes } = await import("../src/v2/spawning/inventory.js");
  const types = { a: { use: "shop", describe: "alpha", words: ["甲"] }, b: { use: "office", describe: "beta", words: ["乙"] } };
  const embedder = { embed: async (texts: string[]) => texts.map((text) => (text.includes("beta") || text.includes("办公") ? [0, 1] : [1, 0])) };
  assert.equal((await searchBuildingTypes({ label: "办公的地方", around: [] }, types, 2, embedder))[0].id, "b", "by meaning");
  assert.equal((await searchBuildingTypes({ label: "甲", around: [] }, types, 2, embedder))[0].id, "a", "its own word in its name");
});

test("the search decides a building's type when it is sure, Jev only when it is not", async () => {
  const { isSure, SURE } = await import("../src/v2/spawning/inventory.js");
  const found = (a: number, b: number, meaning: number | null = 0.6, words = 11) => [{ id: "x", score: a, words, meaning }, { id: "y", score: b, words: 0, meaning }];
  assert.ok(isSure(found(7, 7 - SURE.lead)), "by meaning: its first well ahead");
  assert.ok(!isSure(found(7, 6.8)), "close behind: Jev is asked");
  assert.ok(isSure(found(12, 6, null)) && !isSure(found(12, 11, null)) && !isSure(found(3, 0, null, 3)), "by words: a word of it in the name, and a lead");
});
