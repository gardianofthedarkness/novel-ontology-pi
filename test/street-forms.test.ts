import assert from "node:assert/strict";
import { test } from "node:test";
import { fillLandscape, frameOf, LANDSCAPE_VERSION, LANDSCAPES, patchFromBox, STREET_TYPES, type LandscapeType, type Manifold, type Patch } from "../src/v2/world/landscape.js";
import { hallsOf } from "../src/v2/world/underground.js";
import type { Building } from "../src/v2/world/cityFill.js";

const manifold: Manifold = { gradient: 0.2, core: 0.3, spread: 0.4, tail: 0.05, index: 5 };
const street = (type: LandscapeType, w = 300, d = 110, median = 15): Patch => ({ ...patchFromBox(type, `s:${type}`, `s:${type}`, { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 }, undefined, { median, manifold }), borrowed: true });
const cbd = () => patchFromBox("skyscrapers", "p0", "pool", { x0: -220, z0: -220, x1: 220, z1: 220 }, undefined, { median: 80, manifold: { gradient: 0.5, core: 0.3, spread: 0.5, tail: 0.1, index: 5 } });
const fill = (patches: Patch[]) => fillLandscape({ version: LANDSCAPE_VERSION, seed: "pool", patches });
const own = (patch: Patch, landmarks: Building[]) => landmarks.filter((b) => b.lot.startsWith(`${patch.id}:`));

test("every street type builds its own form: rows down both sides of its road, a ring round its square, a compound, water and a bridge; the same each time", () => {
  // A crossing is the ground's own (two of the city's roads meeting: config/terrain/street.json `takes`): no form of its own.
  assert.equal(own(street("crossing", 160, 160), fill([street("crossing", 160, 160)]).landmarks).length, 0, "a crossing: no form");
  for (const type of STREET_TYPES.filter((type) => type !== "crossing")) {
    const patch = street(type, type === "square" || type === "centre" ? 220 : 300, type === "square" || type === "centre" ? 220 : 110), result = fill([patch]), mine = own(patch, result.landmarks), lots = (part: string) => mine.filter((b) => b.lot.includes(part));
    assert.ok(mine.length > 0, `${type}: a form`);
    assert.equal(JSON.stringify(fill([patch]).landmarks), JSON.stringify(result.landmarks), `${type}: the same form each time`);
    const kind = LANDSCAPES[type];
    if (kind.axis) assert.ok(result.fabric.roads.some((road) => road.id === `AX:${patch.id}`) && lots(":rown").length && lots(":rows").length, `${type}: its road and a row each side`);
    if (kind.band) assert.ok(result.waters.length === 1 && lots(":bridge").length === 1, `${type}: water and a bridge`);
    if (type === "square") assert.ok(lots(":ring").length >= 8 && lots(":monument").length === 1 && result.plazas.length === 1, "a square: a ring round open ground");
    if (type === "centre") assert.ok(lots(":tower").length >= 1 && lots(":podium").length >= 2 && lots(":screen").length === 1, "a centre: towers rising from a podium, a screen");
    if (type === "station") assert.ok(lots(":hall").length === 1 && result.plazas.length === 1, "a station front: its hall and plaza");
  }
});

test("a form's pieces never overlap (the world stands each as a lot of its own): a podium's wings round its towers, a street's rows", () => {
  for (const type of ["centre", "shopping", "avenue", "terrace"] as LandscapeType[]) {
    const patch = street(type, 300, type === "centre" ? 220 : 110, type === "centre" ? 45 : 15), pieces = own(patch, fill([patch]).landmarks).filter((b) => !b.lot.includes(":ring"));
    const box = (b: (typeof pieces)[number]) => { const { along, across } = frameOf(patch, [b.x, b.z]); return [along - b.w / 2, across - b.d / 2, along + b.w / 2, across + b.d / 2]; };
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const a = box(pieces[i]), b = box(pieces[j]), overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5;
      assert.ok(!overlap, `${type}: ${pieces[i].lot} and ${pieces[j].lot} overlap`);
    }
  }
});

test("a street in a CBD: the city's roads give way along it, a shopping street's shops are the bases of the CBD's towers, an alley stays low, and the CBD's landmark moves off the street", () => {
  const shopping = street("shopping"), result = fill([cbd(), shopping]), inside = (p: [number, number]) => Math.abs(frameOf(shopping, p).across) < 6 + 26 && Math.abs(frameOf(shopping, p).along) < 140;
  const along = result.fabric.roads.filter((road) => road.id !== `AX:${shopping.id}` && Array.from({ length: 9 }, (_, n) => [road.a[0] + ((n + 1) / 10) * (road.b[0] - road.a[0]), road.a[1] + ((n + 1) / 10) * (road.b[1] - road.a[1])] as [number, number]).filter(inside).length >= 5);
  assert.equal(along.length, 0, "no road of the city's runs along inside it");
  const bases = own(shopping, result.landmarks).filter((b) => b.base);
  assert.ok(bases.length > 0 && bases.every((b) => b.floors > b.base!.floors && b.base!.kind !== b.kind), `shops under towers: ${bases.length}`);
  const landmark = result.landmarks.find((b) => b.lot === "p0:landmark")!;
  assert.ok(Math.abs(frameOf(shopping, [landmark.x, landmark.z]).across) > 32, "the CBD's landmark stands clear of the street");
  const alley = street("alley", 200, 70, 5);
  assert.equal(own(alley, fill([cbd(), alley]).landmarks).filter((b) => b.base).length, 0, "an alley keeps its own low fabric");
  assert.ok(hallsOf({ version: LANDSCAPE_VERSION, seed: "pool", patches: [street("centre", 220, 220, 45)] }).some((hall) => hall.kind === "mall"), "a mall under a centre");
});

test("a street's buildings take their uses from its kind's list (a shopping street's shops and cafés, a centre's mall and offices), the same each time", () => {
  for (const type of STREET_TYPES.filter((type) => type !== "crossing")) {
    const patch = street(type, type === "square" || type === "centre" ? 220 : 300, type === "square" || type === "centre" ? 220 : 110), mine = own(patch, fill([patch]).landmarks), uses = mine.map((b) => b.use).filter(Boolean);
    assert.ok(uses.length, `${type}: its buildings have uses`);
    const allowed = new Set([...(LANDSCAPES[type].uses ?? []), "mall", "office", "station"]);
    assert.ok(uses.every((use) => allowed.has(use!)), `${type}: only its own uses (${[...new Set(uses)].join(", ")})`);
  }
  const centre = own(street("centre", 220, 220), fill([street("centre", 220, 220)]).landmarks);
  assert.ok(centre.some((b) => b.lot.includes(":podium") && b.use === "mall") && centre.some((b) => b.lot.includes(":tower") && b.use === "office"), "a centre: a mall podium, office towers");
});

test("the terrain view draws a building as a model of its use whose floors hold its own, the nearest by proportions; old models only on ancient ground", async () => {
  const { modelFor, roleModel, useOf } = await import("../src/v2/world/useModels.js");
  const table = {
    uses: { office: { fill: { "office-c": [3, 8], "tower-a": [10, 45] } }, house: { fill: { "suburban-01": [1, 3] } }, apartment: { fill: { "kk-apartment": [3, 7] }, named: { "brick-small": [3, 6] } }, warehouse: { fill: {} } },
    kinds: { tower: "office", office: "office", house: "house", cottage: "house", apartment: "apartment", warehouse: "warehouse" },
    roles: { home: "apartment" },
    ancient: { "*": ["market"] },
  } as unknown as Parameters<typeof modelFor>[3];
  const sizes = { "tower-a": [0.5, 2, 0.5], "office-c": [0.88, 0.89, 1.09], "kk-apartment": [2.01, 2.25, 1.45], "suburban-01": [1.3, 0.74, 0.92], "brick-small": [12.5, 17, 14.5], market: [3.2, 1.2, 2.2] };
  assert.equal(modelFor({ kind: "tower", w: 30, d: 30, floors: 40 }, "a", sizes, table), "tower-a", "a tall office: a tower");
  assert.equal(modelFor({ kind: "office", w: 40, d: 40, floors: 6 }, "b", sizes, table), "office-c", "a low office: the office block");
  assert.equal(modelFor({ kind: "house", w: 12, d: 10, floors: 2 }, "c", sizes, table), "suburban-01");
  assert.equal(modelFor({ kind: "apartment", w: 20, d: 14, floors: 9 }, "d", sizes, table), "kk-apartment", "past every model's floors: the nearest");
  assert.equal(modelFor({ kind: "apartment", w: 14, d: 14, floors: 5, named: true }, "e", sizes, table), "brick-small", "a named building: its own models first");
  assert.equal(modelFor({ kind: "apartment", w: 14, d: 14, floors: 9, named: true }, "e", sizes, table), "kk-apartment", "unless none holds its floors");
  assert.equal(modelFor({ kind: "warehouse", w: 30, d: 20, floors: 2 }, "f", sizes, table), null, "a use with no model: a block");
  assert.equal(modelFor({ kind: "cottage", w: 8, d: 8, floors: 1, era: "ancient" }, "g", sizes, table), "market", "ancient ground: an older world's model");
  assert.equal(modelFor({ kind: "cottage", w: 8, d: 8, floors: 1 }, "g", sizes, table), "suburban-01", "modern ground: never one");
  assert.equal(roleModel({ role: "home", w: 20, d: 14, floors: 5 }, "h", sizes, table), "kk-apartment", "an engine lot: its role's use");
  assert.equal(modelFor({ kind: "apartment", use: "house", w: 20, d: 14, floors: 8 }, "i", sizes, table), "kk-apartment", "a house eight floors high: flats, its kind");
  assert.equal(useOf({ kind: "skyscraper" }), "office");
});

test("the underground: a part below the street becomes the hall its name says (a car park, a passage), else one by its proportions; every kind says what it lies under", async () => {
  const U = await import("../src/v2/world/underground.js"), { undergroundKindOf } = await import("../src/v2/rules/language.js");
  assert.deepEqual(["地下停车场", "地下通道 (scene 21)", "地下街", "防空洞", "共同沟", "地铁站", "地下二层", "广场"].map((label) => undergroundKindOf(label)), ["parking", "corridor", "mall", "shelter", "utility", "station", "basement", null]);
  const shape = { id: "s", x: 0, z: 0, w: 114, d: 22, top: -6 };
  assert.equal(U.shapeHall(shape).kind, "corridor", "a long shape: a passage");
  assert.equal(U.shapeHall({ ...shape, w: 40, d: 40 }).kind, "mall", "a square one: a hall");
  assert.equal(U.shapeHall({ ...shape, hall: "parking" }).kind, "parking", "its name's kind first");
  assert.equal(U.shapeHall(shape).depth, 6);
  assert.deepEqual(Object.keys(U.LIES_UNDER).sort(), Object.keys(U.HALL_LABEL).sort(), "every kind of hall says what it lies under");
});

test("what a street is laid on: an avenue along the arterial roads its ground made, a square on a plaza, a station on none", async () => {
  const { formsFor, STREET_ON } = await import("../src/v2/world/landscape.js");
  const ground = {
    roads: [{ a: [0, 0] as [number, number], b: [200, 200] as [number, number], level: "arterial" }, { a: [0, 300] as [number, number], b: [40, 300] as [number, number], level: "arterial" }, { a: [0, 0] as [number, number], b: [0, 160] as [number, number], level: "local" }],
    waters: [{ a: [500, 0] as [number, number], b: [500, 400] as [number, number] }],
    plazas: [{ x: 300, z: 100, r: 30 }],
  };
  const avenue = formsFor("avenue", ground, 100);
  assert.ok(avenue.length >= 5 && avenue.every((form) => form.what === "arterial road" && Math.abs(form.turn - Math.PI / 4) < 0.01), "along the long arterial, turned with it");
  assert.ok(avenue.every((form) => form.at[1] < 250), "a road shorter than half the street is not one to lay it on");
  assert.deepEqual(formsFor("alley", ground).map((form) => form.what), ["local road", "local road", "local road", "local road"]);
  assert.deepEqual(formsFor("square", ground), [{ at: [300, 100], turn: 0, what: "plaza" }]);
  assert.ok(formsFor("waterfront", ground).every((form) => form.what === "water" && Math.abs(form.turn - Math.PI / 2) < 0.01));
  assert.deepEqual(formsFor("station", ground), [], "a station front is given an area of its own");
  assert.ok(Object.keys(STREET_ON).every((kind) => (STREET_TYPES as readonly string[]).includes(kind)), "only street kinds");
});
