import { test } from "node:test";
import assert from "node:assert/strict";
import { borrowLots, borrowRoad, growToReach, materialize, placeChild, polygonArea, spawnOf, type City, type Circle, type Fabric } from "../src/ground/stage/cityFill.js";

// An invented city, 600 m across at birth.
const city: City = { seed: "loc_mock_city", r0: 300, r: 300 };
const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((entry) => [entry.id, entry]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test("the same city fills the same every time, and any window of it agrees with the whole", () => {
  const whole = materialize(city), again = materialize(city);
  assert.ok(same(whole, again), "the recipe, not the run, decides the city");
  assert.ok(whole.lots.length > 150 && whole.buildings.length > 150, `filled (${whole.lots.length} lots, ${whole.buildings.length} buildings)`);
  const lots = byId(whole.lots), part = materialize(city, { x0: -120, z0: -120, x1: 60, z1: 60 });
  assert.ok(part.lots.length > 10 && part.lots.length < whole.lots.length);
  for (const lot of part.lots) assert.ok(same(lot, lots.get(lot.id)), `window lot ${lot.id} matches the whole`);
  assert.ok(!same(materialize({ ...city, seed: "loc_other" }).lots.slice(0, 5), whole.lots.slice(0, 5)), "another city fills differently");
});

test("the fabric is a road network: every lot faces a road, lots fit inside their block, and the core is taller than the edge", () => {
  const fabric = materialize(city), roads = new Set(fabric.roads.map((road) => road.id)), blocks = byId(fabric.blocks);
  for (const lot of fabric.lots) assert.ok(roads.has(lot.frontage.road), `${lot.id} faces a road the city has`);
  const byBlock = new Map<string, number>();
  for (const lot of fabric.lots) byBlock.set(lot.block, (byBlock.get(lot.block) ?? 0) + lot.area);
  for (const [block, area] of byBlock) assert.ok(area <= blocks.get(block)!.area + 1, `${block}: its lots fit inside it`);
  const floors = (inside: (d: number) => boolean) => { const list = fabric.buildings.filter((b) => inside(Math.hypot(b.x, b.z))); return list.reduce((s, b) => s + b.floors, 0) / list.length; };
  assert.ok(floors((d) => d < 80) > 3 * floors((d) => d > 220), "skyscrapers in the core, houses at the edge");
  assert.ok(fabric.roads.some((road) => road.level === "arterial") && fabric.roads.some((road) => road.level === "collector") && fabric.roads.some((road) => road.level === "local"));
});

test("growing the city takes in more ground and changes nothing already there", () => {
  const before = materialize(city), grown = growToReach(city, [380, 0]);
  assert.deepEqual([grown.steps, grown.left], [1, false], "one step of × 1.3 reaches 380 m");
  const after = materialize({ ...city, r: grown.r }), lots = byId(after.lots), buildings = new Map(after.buildings.map((b) => [b.lot, b]));
  assert.ok(after.lots.length > before.lots.length * 1.4, `more ground (${before.lots.length} → ${after.lots.length} lots)`);
  for (const lot of before.lots) assert.ok(same(lot, lots.get(lot.id)), `lot ${lot.id} unchanged`);
  for (const building of before.buildings) assert.ok(same(building, buildings.get(building.lot)), `building on ${building.lot} unchanged`);
  assert.equal(growToReach(city, [2000, 0]).left, true, "past three times its birth radius, the scene has left the place");
});

test("places inside the city are placed once and kept, inside it and apart, whatever is born after them", () => {
  const parent: Circle = { x: 0, z: 0, r: city.r0 }, first = placeChild(parent, [], 90, "d1")!, second = placeChild(parent, [first], 70, "d2")!;
  const third = placeChild(parent, [first, second], 70, "d3")!, otherOrder = placeChild(parent, [first], 70, "d3")!;
  for (const c of [first, second, third]) assert.ok(Math.hypot(c.x, c.z) + c.r <= parent.r, "inside the city");
  for (const [a, b] of [[first, second], [first, third], [second, third]]) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= a.r + b.r, "apart");
  assert.ok(Math.hypot(first.x, first.z) < 30, "the first born takes the middle");
  assert.ok(same(placeChild(parent, [], 90, "d1"), first), "the same birth places it the same");
  assert.ok(Math.hypot(otherOrder.x - third.x, otherOrder.z - third.z) > 1, "a later birth goes where there is room then; the earlier ones never move");
});

test("named buildings borrow lots by the ground their kind needs, a whole block when no lot is enough; streets borrow roads; nothing is borrowed twice", () => {
  const fabric = materialize(city), district: Circle = { x: 0, z: 0, r: 150 }, taken = new Set<string>(), area = (f: Fabric, ids: string[]) => ids.reduce((sum, id) => sum + f.lots.find((lot) => lot.id === id)!.area, 0);
  const hospital = borrowLots(fabric, { circle: district }, "hospital", taken, "loc_hospital")!;
  hospital.lots.forEach((id) => taken.add(id));
  assert.ok(area(fabric, hospital.lots) >= 3000 * 0.7, `a hospital gets the ground it needs (${Math.round(area(fabric, hospital.lots))} m², ${hospital.lots.length} lot(s))`);
  const house = borrowLots(fabric, { circle: district }, "house", taken, "loc_house")!;
  assert.ok(area(fabric, house.lots) <= 400 * 1.5 && house.lots.every((id) => !taken.has(id)), "a house gets a small free lot");
  house.lots.forEach((id) => taken.add(id));
  const street = borrowRoad(fabric, district, [80, 260], new Set(), "loc_street")!;
  assert.ok(street, "a road of a street's length in the district");
  const shop = borrowLots(fabric, { road: street }, "shop", taken, "loc_shop")!;
  assert.ok(shop.lots.every((id) => fabric.lots.find((lot) => lot.id === id)!.frontage.road === street), "a building on the street faces it");
  // After the city grows, every borrowed lot is still the same ground.
  const grown = materialize({ ...city, r: 390 }), lots = byId(grown.lots);
  for (const id of [...hospital.lots, ...house.lots, ...shop.lots]) assert.ok(same(lots.get(id), fabric.lots.find((lot) => lot.id === id)), `${id} kept`);
  assert.ok(polygonArea(fabric.lots[0].pts) > 0);
});

test("a person with no stated start spawns at a door near the middle of the place, the same one each time, never in a borrowed building", () => {
  const fabric = materialize(city), district: Circle = { x: 40, z: -30, r: 120 }, taken = new Set(fabric.lots.slice(0, 40).map((lot) => lot.id));
  const spawn = spawnOf(fabric, district, "char_1", "loc_d", taken)!;
  assert.ok(same(spawnOf(fabric, district, "char_1", "loc_d", taken), spawn), "the same person and place, the same door");
  assert.ok(!taken.has(spawn.lot), "not in a named building");
  const doors = Array.from({ length: 60 }, (_, n) => spawnOf(fabric, district, `char_${n}`, "loc_d", taken)!.door), mean = doors.reduce((s, d) => s + Math.hypot(d[0] - district.x, d[1] - district.z), 0) / doors.length;
  assert.ok(doors.every((d) => Math.hypot(d[0] - district.x, d[1] - district.z) <= district.r + 20), "inside the place");
  assert.ok(mean < district.r * 0.75 && new Set(doors.map(String)).size > 20, `near the middle on average (${Math.round(mean)} m), and spread out`);
});
