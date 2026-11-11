import assert from "node:assert/strict";
import { test } from "node:test";
import { formOf, LANDSCAPES, patchFromBox } from "../src/v2/world/landscape.js";
import { shapeHall } from "../src/v2/world/underground.js";
import { FLOATING, terrainHeights, terrainThickness } from "../src/v2/context/terrainModes.js";
import { withSlots, type KeptSlot } from "../src/v2/terrain/tree.js";

// The building level (docs/v3/design.html#borrow-and-spawn §6, §8.9): a street's buildings as its form builds them are its building
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
  const { formsTaking, fillLandscape } = await import("../src/v2/world/landscape.js");
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
  const { MODELS } = await import("../src/v2/world/useModels.js");
  const { readFileSync } = await import("node:fs");
  const street = JSON.parse(readFileSync("config/terrain/street.json", "utf8")).types as Record<string, { uses: Record<string, number> }>;
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
  const { loadBuildingTypes, searchBuildingTypes, wordScore } = await import("../src/v2/terrain/inventory.js");
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
  assert.deepEqual([(await top("高层大厦 (scene 40)"))[0], (await top("高层塔楼公寓 (scene 26)"))[0], (await top("大楼 (scene 2)"))[0]], ["office-tower", "residential-tower", "office-building"], "a tower is a tower, a building a building");
  const around = await searchBuildingTypes({ label: "那栋建筑", around: ["她走进那栋建筑，柜台上摆满了拉面碗。"] }, types, 10);
  assert.equal(around[0].id, "ramen-shop", "the sentences round it when the name says nothing");
  assert.ok(wordScore(types["sushi-restaurant"], { label: "寿司", around: [] }) > wordScore(types["sushi-restaurant"], { label: "x", around: ["寿司"] }), "its name counts more than its sentences");
});

test("the building level's search by meaning: with an embedder the nearest by vectors, the name's own words still counting", async () => {
  const { searchBuildingTypes } = await import("../src/v2/terrain/inventory.js");
  const types = { a: { use: "shop", describe: "alpha", words: ["甲"] }, b: { use: "office", describe: "beta", words: ["乙"] } };
  const embedder = { embed: async (texts: string[]) => texts.map((text) => (text.includes("beta") || text.includes("办公") ? [0, 1] : [1, 0])) };
  assert.equal((await searchBuildingTypes({ label: "办公的地方", around: [] }, types, 2, embedder))[0].id, "b", "by meaning");
  assert.equal((await searchBuildingTypes({ label: "甲", around: [] }, types, 2, embedder))[0].id, "a", "its own word in its name");
});

test("the search decides a building's type when it is sure, Jev only when it is not", async () => {
  const { isSure, SURE } = await import("../src/v2/terrain/inventory.js");
  const found = (a: number, b: number, meaning: number | null = 0.6, words = 11) => [{ id: "x", score: a, words, meaning }, { id: "y", score: b, words: 0, meaning }];
  assert.ok(isSure(found(7, 7 - SURE.lead)), "by meaning: its first well ahead");
  assert.ok(!isSure(found(7, 6.8)), "close behind: Jev is asked");
  assert.ok(isSure(found(12, 6, null)) && !isSure(found(12, 11, null)) && !isSure(found(3, 0, null, 3)), "by words: a word of it in the name, and a lead");
});

test("every level's heights: a minimum, the text's own measures offered; far heights never share a lot", async () => {
  const { buildingHeights, terrainHeightMode, withMeasures } = await import("../src/v2/context/terrainModes.js");
  const { heightsShare, loadHeights } = await import("../src/v2/terrain/config.js");
  const { loadBuildingTypes } = await import("../src/v2/terrain/inventory.js");
  const { measuresIn, numberOf } = await import("../src/v2/context/measures.js");
  const chart = loadHeights(), types = loadBuildingTypes();
  // The dictionary (config/terrain/heights.json), whole (the user, 2026-11-01): every building type its least floors,
  // every area kind of every level its least median, each among the heights its kind is offered.
  for (const [id, type] of Object.entries(types)) if (type.use) assert.ok(Number.isInteger(chart.buildings[id]) && chart.buildings[id] >= 1, `${id}: its least floors (${chart.buildings[id]})`);
  assert.deepEqual(Object.keys(chart.buildings).sort(), Object.keys(types).filter((id) => types[id].use).sort(), "no type left out, none extra");
  const { TERRAIN_KINDS, terrainHeights } = await import("../src/v2/context/terrainModes.js");
  for (const level of ["city", "district", "street"]) {
    assert.deepEqual(Object.keys(chart.areas[level]).sort(), Object.keys(TERRAIN_KINDS[level]).sort(), `${level}: every kind`);
    for (const [kind, entry] of Object.entries(TERRAIN_KINDS[level])) { const range = entry.medians ?? entry.tops!, least = chart.areas[level][kind]; assert.ok(least >= range[0] && least <= range.at(-1)!, `${level} ${kind}: ${least}`); }
  }
  // An area's gate: its slices from its minimum up (a CBD at least 50 m here), the underground still offered at a street.
  const cbd = terrainHeights("district", "cbd", { factor: 1, underground: false }, 50);
  assert.deepEqual([cbd.standard, cbd.slices[0].y, cbd.slices.some((slice) => slice.y < 50 && slice.y > 0)], [50, 50, false]);
  assert.equal(terrainHeights("district", "cbd", { factor: 1, underground: false }).standard, 30, "without one, its own lowest");
  assert.equal(terrainHeights("district", "mountain", undefined, 200).slices.filter((slice) => slice.y > 0)[0].y, 200, "a natural ground's top too");
  assert.deepEqual([chart.buildings["office-building"], chart.buildings["apartment-block"], chart.buildings.hotel, chart.buildings.hospital, chart.buildings["office-tower"]], [12, 10, 15, 8, 30], "each at its usual height");
  // A building type's least floors, a hard gate as every area kind's: nothing above the street under it; the underground stays.
  const office = buildingHeights(chart.buildings["office-building"]);
  // An office at its usual height at least (the user, 2026-11-01): 12 floors; a real-estate firm's office building too.
  assert.equal(office.standard, 36);
  assert.deepEqual(office.slices.filter((slice) => slice.y > 0)[0], { letter: "E", y: 36, said: "12 floors" });
  assert.equal(chart.buildings["real-estate-office"], chart.buildings["office-building"]);
  assert.ok(office.slices.some((slice) => slice.y < 0), "under the street still offered");
  assert.deepEqual([chart.buildings["office-tower"], chart.buildings["residential-tower"]], [30, 30], "a tower: thirty floors at least (the user, 2026-11-01)");
  assert.equal(buildingHeights(30).slices.filter((slice) => slice.y > 0)[0].said, "30 floors");
  // The text's measures, by pattern: floors, metres beside a word of height or depth, never a layer or a walk.
  assert.deepEqual([numberOf("五十"), numberOf("一百二十"), numberOf("十几"), numberOf("两百"), numberOf("３５")], [50, 120, 15, 200, 35]);
  assert.deepEqual(measuresIn(["一座三十层的写字楼"]).map((m) => [m.y, m.said, m.named]), [[90, "30 floors", true]]);
  assert.deepEqual(measuresIn(["塔", "那座塔高达两百米。"]).map((m) => m.y), [200]);
  assert.deepEqual(measuresIn(["商场", "商场在地下二层。", "月台在地下30米。"]).map((m) => m.y).sort((a, b) => a - b), [-30, -6]);
  assert.deepEqual(measuresIn(["房间", "桌上落了一层灰。", "他沿着街走了三百米。"]), []);
  assert.deepEqual(measuresIn(["tower", "The tower is 120 m tall."]).map((m) => m.y), [120]);
  // Offered as slices of their own, even under the minimum; the question says so, and states the minimum.
  const tops = withMeasures(office.slices, [{ y: 90, said: "30 floors" }, { y: 6, said: "2 floors" }], office.standard);
  assert.deepEqual(tops.filter((slice) => slice.text).map((slice) => [slice.y, slice.said]), [[6, "2 floors, as the text says"], [90, "30 floors, as the text says"]]);
  assert.equal(tops.map((slice) => slice.letter).join(""), "ABCDEFGHIJKLMNOP".slice(0, tops.length), "lettered again from the lowest");
  const task = (terrainHeightMode.task as (focus: never) => string)({ part: { id: "x", label: "那座写字楼", scale: "building" }, kind: "office-building", measure: "top", slices: tops, standard: office.standard } as never);
  assert.match(task, /No office-building is built lower than 36 m \(12 floors\)/);
  assert.match(task, /as the text says/);
  // Unnamed buildings share a lot only when their heights are near: a tower and low offices never, a basement and a roof never.
  assert.ok(heightsShare(9, 15, chart.share) && !heightsShare(15, 180, chart.share) && !heightsShare(-6, 3, chart.share));
});

test("tall buildings and the streets round them: above 100 m the taller the thicker, a street wider the more towers stand round it", async () => {
  const { tallAndWide, footprintsOverlap, TALL } = await import("../src/v2/world/tall.js");
  const { SLENDER } = await import("../src/v2/world/landscape.js");
  const b = (lot: string, x: number, z: number, w: number, d: number, floors: number) => ({ lot, x, z, w, d, angle: 0, floors, kind: "tower" });
  const road = { id: "A:1", a: [-200, 100] as [number, number], b: [200, 100] as [number, number], width: 8, level: "arterial" as const };
  // A 300 m tower 10 m wide grows to 300 / SLENDER; the low building it now covers goes, the fixed one beside it stays.
  const tower = b("t", 0, 0, 10, 10, 100), low = b("low", 15, 0, 8, 8, 3), kept = b("kept", 0, 30, 10, 10, 3);
  const out = tallAndWide([tower, low, kept], [road], (x) => x.lot === "kept");
  const grown = out.buildings.find((x) => x.lot === "t")!;
  assert.equal(TALL, 100);
  assert.ok(Math.min(grown.w, grown.d) >= 300 / SLENDER - 0.1, `the tower ${grown.w} × ${grown.d}`);
  assert.deepEqual(out.buildings.map((x) => x.lot).sort(), ["kept", "t"]);
  assert.ok(!footprintsOverlap(grown, kept));
  // The street: the share of towers round it times their height, over 400 (here a third of three, 300 m: 1.25 times).
  assert.equal(out.roads[0].width, 10);
  // Under 100 m nothing grows and no street widens.
  const low3 = tallAndWide([b("a", 0, 0, 10, 10, 30), b("c", 0, 90, 10, 10, 3)], [road], () => false);
  assert.deepEqual([low3.thickened, low3.widened, low3.roads[0].width, low3.buildings[0].w], [0, 0, 8, 10]);
  // A building the wider street now reaches gives up that much of its face, turned away from it.
  const face = tallAndWide([b("t", 0, -20, 40, 40, 100), b("f", 0, 90, 10, 10, 3)], [road], () => false).buildings.find((x) => x.lot === "f")!;
  assert.ok(face.d < 10 && face.z < 90, `the face given up: ${face.d} m deep at z ${face.z}`);
});

test("composite buildings: a shop, a restaurant, a cinema joins a host where travel is least; its floor and size fixed or asked, at a spot of that floor", async () => {
  const { chooseHost, loadTenancies, partFloors, partSizes, spotOf } = await import("../src/v2/terrain/composite.js");
  const { loadBuildingTypes } = await import("../src/v2/terrain/inventory.js");
  const { TERRAIN_KINDS } = await import("../src/v2/context/terrainModes.js");
  const tenancies = loadTenancies(), types = loadBuildingTypes();
  // Every tenant is a type of the inventory; every host use one the world draws.
  for (const [type, tenancy] of Object.entries(tenancies)) {
    assert.ok(types[type]?.use, `${type}: a building type of the inventory`);
    for (const use of tenancy.in) assert.ok(TERRAIN_KINDS.building[use], `${type}: ${use} is a building kind`);
  }
  assert.ok(!tenancies["office-tower"] && !tenancies["shopping-mall"] && !tenancies["school"], "a host, a school: buildings of their own");
  const travel = (at: [number, number]) => Math.hypot(at[0] - 100, at[1]);
  const hosts = [
    { id: "mall", use: "mall", at: [400, 0] as [number, number], kept: true },
    { id: "tower", use: "office", at: [120, 0] as [number, number], kept: true, top: 300 },
    { id: "lot", use: "office", at: [110, 0] as [number, number], kept: false },
    { id: "metro", use: "station", at: [90, 0] as [number, number], kept: true, top: -12 },
  ];
  // Where travel is least, among the uses it may be part of: a convenience store the station; a cinema only a mall.
  assert.equal(chooseHost(tenancies["convenience-store"], hosts, travel)?.id, "metro");
  assert.equal(chooseHost(tenancies.cinema, hosts, travel)?.id, "mall");
  assert.equal(chooseHost(tenancies.bank, hosts, travel)?.id, "lot", "an office lot nearer than the tower");
  assert.equal(chooseHost(tenancies.cinema, hosts.filter((host) => host.use !== "mall"), travel), null, "no mall: no host");
  // A convenience store always on floor one, about 120 m², asked nothing; a cinema asked, two floors tall.
  assert.deepEqual([tenancies["convenience-store"].floor, tenancies["convenience-store"].size], [1, 120]);
  assert.ok(tenancies.cinema.floor === undefined && tenancies.cinema.floors === 2);
  for (const [type, tenancy] of Object.entries(tenancies)) assert.equal(tenancy.floor === undefined, tenancy.size === undefined, `${type}: a fixed floor with a fixed size`);
  // Its floors: two under the street, then its host's up to its top; its sizes up to a floor of its host.
  const floors = partFloors(35);
  assert.deepEqual(floors.slice(0, 3).map((option) => option.value), [-2, -1, 1]);
  assert.deepEqual([floors.at(-1)!.value, floors.at(-1)!.said], [35, "floor 35, its top floor"]);
  assert.ok(floors.length <= 20 && partFloors(null).at(-1)!.value === 20);
  const sizes = partSizes(600);
  assert.deepEqual(sizes.map((option) => option.value), [20, 50, 100, 200, 500, 600]);
  // Its spot on that floor: random, the same each time.
  assert.deepEqual(spotOf("unnamed:x"), spotOf("unnamed:x"));
  assert.ok(spotOf("unnamed:x").every((v) => v >= -0.5 && v <= 0.5) && spotOf("unnamed:x").join() !== spotOf("unnamed:y").join());
});

test("no building stands inside another: the tallest kept first, what the text placed always; buildings wall to wall stay", async () => {
  const { clearOverlaps } = await import("../src/v2/world/tall.js");
  const b = (lot: string, x: number, z: number, w: number, d: number, floors: number, angle = 0) => ({ lot, x, z, w, d, angle, floors, kind: "office" });
  const tower = b("tower", 0, 0, 40, 40, 60), inside = b("inside", 10, 5, 12, 12, 8), turned = b("turned", 24, 0, 12, 12, 5, 0.7), wall = b("wall", 26, 0, 12, 12, 5);
  const placed = b("placed", 60, 40, 10, 10, 3), taller = b("taller", 64, 44, 8, 8, 90);
  const { buildings, overlapped } = clearOverlaps([inside, tower, turned, wall, placed, taller], (o) => o.lot === "placed");
  assert.deepEqual(buildings.map((o) => o.lot).sort(), ["placed", "tower", "wall"]);
  assert.equal(overlapped, 3, "the one inside the tower, the turned one cutting its corner and a taller one on what the text placed give way; the one wall to wall at its face stays");
});

test("two buildings the text placed one inside the other: the later moves to the nearest clear spot, the first stays", async () => {
  const { clearOverlaps } = await import("../src/v2/world/tall.js");
  const b = (lot: string, x: number, z: number, w: number, d: number, floors: number, angle = 0) => ({ lot, x, z, w, d, angle, floors, kind: "office" });
  const tower = b("tower", 178, 666, 56, 38, 100), office = b("office", 153, 666, 26, 16, 10, 3.835);
  const { buildings, overlapped, moved } = clearOverlaps([office, tower], () => true);
  assert.deepEqual([overlapped, moved], [0, 1]);
  const [still, aside] = [buildings.find((o) => o.lot === "tower")!, buildings.find((o) => o.lot === "office")!];
  assert.deepEqual([still.x, still.z], [178, 666]);
  assert.ok(aside.x < 153 && Math.hypot(aside.x - 153, aside.z - 666) <= 30, `moved away from the tower, not far: ${aside.x}, ${aside.z}`);
});
